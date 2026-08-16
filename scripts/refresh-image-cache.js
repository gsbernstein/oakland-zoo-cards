#!/usr/bin/env node
// Run weekly by .github/workflows/refresh-image-cache.yml (and by hand via
// `node scripts/refresh-image-cache.js` / workflow_dispatch).
//
// Oakland Zoo periodically swaps a card's live photo between a real numbered
// shot and a grayscale "Unavailable" placeholder as it rotates in and out of
// physical circulation. Sometimes the real numbered photo is still sitting
// in the zoo's WordPress media library even while a post's current featured
// image is the "Unavailable" one — it just isn't attached to that post
// anymore. This script finds those cases (by searching the whole media
// library for "N of 100" titled images, not just each post's current
// featured image) and downloads whatever real photos it can find into
// cache/images/, recording them in cache/manifest.json.
//
// This never modifies data.json — that file stays human-curated. The cache
// is purely additive: app.js prefers a live image if the site currently has
// one, then this local cache, then whatever data.json already has, in that
// order (see app.js's applyImageCache for the exact tier logic).
//
// This only ever *adds or upgrades* cache entries; it never deletes one,
// even if a card's live photo temporarily disappears again, since a stale
// real photo is strictly better than falling back further down the chain.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WP_MEDIA_API_BASE,
  fetchAllTradingCards,
  fetchAllWpItems,
  parseCardPost,
  parseNumberedMediaItem,
  LIVE_CATEGORIES_FOR_SET,
} from "../wp-card-utils.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_JSON_PATH = path.join(ROOT, "data.json");
const MANIFEST_PATH = path.join(ROOT, "cache", "manifest.json");
const IMAGES_DIR = path.join(ROOT, "cache", "images");

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extensionFromUrl(url) {
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  return match ? match[1].toLowerCase() : "webp";
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Fetch failed with status " + res.status + " for " + url);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

async function main() {
  const data = await readJsonIfExists(DATA_JSON_PATH, null);
  if (!data || !Array.isArray(data.sets)) {
    throw new Error("Couldn't read sets from " + DATA_JSON_PATH);
  }

  console.log("Fetching live trading_card posts...");
  const posts = (await fetchAllTradingCards()).map(parseCardPost).filter(Boolean);
  console.log("  " + posts.length + " posts");

  console.log('Searching media library for "N of 100" titled images...');
  const mediaItems = await fetchAllWpItems(WP_MEDIA_API_BASE, "per_page=100&search=" + encodeURIComponent("of 100"));
  const numberedMedia = mediaItems.map(parseNumberedMediaItem).filter(Boolean);
  console.log("  " + numberedMedia.length + " numbered media items");

  // number -> best available image for that collector number, preferring
  // whichever came first if there happen to be duplicates.
  const numberToAvailableImage = {};
  numberedMedia.forEach((m) => {
    if (m.available && !(m.number in numberToAvailableImage)) {
      numberToAvailableImage[m.number] = m.image;
    }
  });

  // Per-set lookup of each live post's own current image, scoped to the
  // categories that actually feed that set (mirrors live-sync.js).
  function liveImageForCard(setId, cardName) {
    const allowedSlugs = LIVE_CATEGORIES_FOR_SET[setId] || [];
    if (!allowedSlugs.length) return null;
    const match = posts.find(
      (p) => p.name === cardName && p.categorySlugs.some((slug) => allowedSlugs.indexOf(slug) !== -1)
    );
    return match || null;
  }

  const previousManifest = await readJsonIfExists(MANIFEST_PATH, {});
  const nextManifest = {};
  await mkdir(IMAGES_DIR, { recursive: true });

  let discoveredAvailable = 0;
  let discoveredFallback = 0;
  let downloaded = 0;
  let stillNothing = 0;

  for (const set of data.sets) {
    for (const card of set.cards) {
      const key = set.id + "::" + card.name;
      const prior = previousManifest[key];
      const liveCard = liveImageForCard(set.id, card.name);

      // Tier "available": a real numbered photo, found either by number
      // (independent of which post currently claims it) or because the
      // post's own current image just happens to already be a real photo.
      let candidate = null;
      if (card.number != null && numberToAvailableImage[card.number]) {
        candidate = numberToAvailableImage[card.number];
      } else if (liveCard && liveCard.available) {
        candidate = liveCard.image;
      }

      if (candidate) {
        discoveredAvailable++;
        if (prior && prior.tier === "available" && prior.sourceUrl === candidate) {
          nextManifest[key] = prior; // unchanged, keep byte-identical entry
          continue;
        }
        const ext = extensionFromUrl(candidate);
        const file = "cache/images/" + slugify(set.id) + "--" + slugify(card.name) + "." + ext;
        try {
          const bytes = await downloadImage(candidate, path.join(ROOT, file));
          nextManifest[key] = { tier: "available", file, sourceUrl: candidate };
          downloaded++;
          console.log("  [available] " + key + " <- " + candidate + " (" + bytes + " bytes)");
        } catch (err) {
          console.warn("  Failed to download available image for " + key + ": " + err.message);
          if (prior) nextManifest[key] = prior;
        }
        continue;
      }

      // Tier "fallback": only for cards data.json has literally no image
      // for at all — better to show the zoo's own "Unavailable" art than
      // our generic paw placeholder, once, cached in case the live URL
      // ever goes away entirely.
      if (!card.image) {
        if (prior && prior.tier === "fallback") {
          nextManifest[key] = prior;
          discoveredFallback++;
          continue;
        }
        if (liveCard && liveCard.image) {
          discoveredFallback++;
          const ext = extensionFromUrl(liveCard.image);
          const file = "cache/images/" + slugify(set.id) + "--" + slugify(card.name) + "." + ext;
          try {
            const bytes = await downloadImage(liveCard.image, path.join(ROOT, file));
            nextManifest[key] = { tier: "fallback", file, sourceUrl: liveCard.image };
            downloaded++;
            console.log("  [fallback]  " + key + " <- " + liveCard.image + " (" + bytes + " bytes)");
          } catch (err) {
            console.warn("  Failed to download fallback image for " + key + ": " + err.message);
          }
        } else {
          stillNothing++;
        }
        continue;
      }

      // Nothing to do: data.json already has a usable (if "Unavailable")
      // image for this card, and no better one was discovered live.
      if (prior) nextManifest[key] = prior;
    }
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(nextManifest, null, 2) + "\n");

  console.log("");
  console.log("Summary:");
  console.log("  Cards with a discoverable real photo: " + discoveredAvailable);
  console.log("  Cards needing a last-resort cached fallback: " + discoveredFallback);
  console.log("  Newly downloaded/updated files this run: " + downloaded);
  console.log("  Cards with no image anywhere (still using the placeholder): " + stillNothing);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
