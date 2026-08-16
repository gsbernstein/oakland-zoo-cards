// Shared WordPress-API parsing logic for the Oakland Zoo trading card
// checklist. Used by both live-sync.js (runs in the browser) and
// scripts/refresh-image-cache.mjs (runs under Node in a GitHub Action) —
// kept as one module so the two never drift apart on naming/category rules.
//
// Both environments have a global `fetch` (Node 18+, all modern browsers),
// so this file is plain, dependency-free ESM usable from either.

export const WP_API_BASE = "https://www.oaklandzoo.org/wp-json/wp/v2/trading_card";
export const WP_MEDIA_API_BASE = "https://www.oaklandzoo.org/wp-json/wp/v2/media";

// Cases where our data.json naming differs from the zoo's WP post titles
// (see data.json's own header notes for how these were found).
export const NAME_RENAMES = {
  "Dyeing Poison Dart Frog": "Poison Dart Frog (Dyeing)",
  "Green and Black Poison Dart Frog": "Poison Dart Frog (Green and Black)",
  "Yellow-Banded Poison Dart Frog": "Poison Dart Frog (Yellow-Banded)",
  "Crowned Lemur (Female)": "Crowned Lemur",
  "Crowned Lemur (Male)": "Crowned Lemur",
  "Mallard - Female": "Mallard (Female)",
  "Mallard - Male": "Mallard (Male)",
  "White Bark Pine": "Whitebark Pine",
};

// Which live trading_card_category taxonomy slugs feed each of our set ids,
// so a live card can only update a set it actually belongs to (never borrow
// art/numbers across sets just because two cards share a name). Empty
// arrays mean no live category currently covers that set — those sets
// always keep whatever data.json/the local cache already has.
export const LIVE_CATEGORIES_FOR_SET = {
  standard: ["1-20", "21-40", "41-60", "61-80", "81-100"],
  "boo-at-the-zoo": [],
  "city-of-oakland": ["city-of-oakland"],
  "coexist-with-wildlife": ["coexist-ca"],
  "main-entrance": ["special-edition"],
  "native-pollinators": ["special-edition"],
  "oakland-ballers": ["special-edition"],
  "oakland-roots-soul": [],
  "protect-the-pride": ["protect-the-pride", "special-edition"],
  "tortugas-marinas": ["tortugas-de-guatemala"],
  zoocamp: [],
};

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Decodes the handful of HTML entities WordPress's REST API renders inside
// title.rendered strings. Regex-based (not DOM-based) so it works
// identically in a browser and under Node.
export function decodeHtmlEntities(str) {
  if (typeof str !== "string" || str.indexOf("&") === -1) return str;
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : match;
  });
}

// The zoo's own site names uploaded files with an "Unavailable" (or
// "Retired Unavailable") suffix for cards not currently in physical
// rotation — see data.json's header notes for how this was confirmed
// (holds with zero exceptions across every known image URL).
export function isUnavailableImageUrl(url) {
  return !!url && /unavailable/i.test(url);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out after " + ms + "ms")), ms);
    }),
  ]);
}

// Fetches every page of a WP REST collection endpoint (any post type or
// media), following X-WP-TotalPages. `paramString` is appended as-is
// (e.g. "per_page=100&_embed=1" or "per_page=100&search=of%20100").
export async function fetchAllWpItems(baseUrl, paramString, { timeoutMs = 8000, maxPages = 20, fetchImpl = fetch } = {}) {
  let all = [];
  let page = 1;
  while (page <= maxPages) {
    const url = baseUrl + "?" + paramString + "&page=" + page;
    const res = await withTimeout(fetchImpl(url), timeoutMs);
    if (!res.ok) throw new Error(baseUrl + " responded with status " + res.status);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("Unexpected response shape from " + baseUrl);
    all = all.concat(batch);
    const totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "1", 10) || 1;
    if (!batch.length || page >= totalPages) break;
    page++;
  }
  return all;
}

export function fetchAllTradingCards(opts) {
  return fetchAllWpItems(WP_API_BASE, "per_page=100&_embed=1", opts);
}

// Parses one trading_card post (optionally _embed'd) into our normalized
// shape. `name` is renamed per NAME_RENAMES so it matches data.json.
export function parseCardPost(post) {
  const rawName =
    post && post.title && typeof post.title.rendered === "string" ? decodeHtmlEntities(post.title.rendered).trim() : "";
  if (!rawName) return null;
  const name = NAME_RENAMES[rawName] || rawName;

  const media = post._embedded && post._embedded["wp:featuredmedia"] && post._embedded["wp:featuredmedia"][0];
  const image = media && typeof media.source_url === "string" ? media.source_url : null;
  const mediaTitle =
    media && media.title && typeof media.title.rendered === "string" ? decodeHtmlEntities(media.title.rendered) : "";
  const numberMatch = mediaTitle.match(/(\d+)\s+of\s+100/i);
  const number = numberMatch ? parseInt(numberMatch[1], 10) : null;

  const termGroups = (post._embedded && post._embedded["wp:term"]) || [];
  const categorySlugs = [];
  termGroups.forEach((group) => {
    (group || []).forEach((term) => {
      if (term && term.taxonomy === "trading_card_category" && term.slug) {
        categorySlugs.push(term.slug);
      }
    });
  });

  return { name, number, image, categorySlugs, available: !isUnavailableImageUrl(image) };
}

// Parses one media-library item into {number, image} if its title matches
// the "N of 100" pattern — independent of whether any post currently uses
// it as a featured image. This is how "hidden" numbered photos (uploaded
// at some point, then superseded as a post's featured image, but never
// deleted) get discovered automatically going forward.
export function parseNumberedMediaItem(item) {
  const title = item && item.title && typeof item.title.rendered === "string" ? decodeHtmlEntities(item.title.rendered) : "";
  const match = title.match(/(\d+)\s+of\s+100/i);
  if (!match) return null;
  const image = typeof item.source_url === "string" ? item.source_url : null;
  if (!image) return null;
  return { number: parseInt(match[1], 10), image, available: !isUnavailableImageUrl(image) };
}
