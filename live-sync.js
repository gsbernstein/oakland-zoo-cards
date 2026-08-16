// Best-effort progressive enhancement: tries to refresh card numbers and
// photos from the zoo's own live WordPress REST API
// (oaklandzoo.org/wp-json/wp/v2/trading_card), using the OAKLAND_ZOO_CARD_SETS
// already assembled by app.js (from data.json, then the local image cache —
// see app.js) as the fallback. If this fetch fails for any reason (offline,
// the zoo's API not sending CORS headers for this origin, the endpoint
// changing shape, etc.) nothing breaks — whatever app.js already rendered
// just keeps being what's shown, silently.
// The ?v= here needs bumping on wp-card-utils.js changes too — an import
// specifier's own cache entry isn't tied to live-sync.js's script-tag
// query param (see index.html's cache-busting comment).
import { fetchAllTradingCards, parseCardPost, LIVE_CATEGORIES_FOR_SET } from "./wp-card-utils.js?v=2";

// Mutates OAKLAND_ZOO_CARD_SETS in place, preferring live values field by
// field and falling back to whatever was already there. Returns true if
// anything actually changed.
function mergeLiveDataIntoSets(livePosts) {
  const parsed = livePosts.map(parseCardPost).filter(Boolean);
  let changed = false;

  window.OAKLAND_ZOO_CARD_SETS.forEach((set) => {
    const allowedSlugs = LIVE_CATEGORIES_FOR_SET[set.id] || [];
    if (!allowedSlugs.length) return;

    const lookup = {};
    parsed.forEach((p) => {
      const inScope = p.categorySlugs.some((slug) => allowedSlugs.indexOf(slug) !== -1);
      if (inScope && !(p.name in lookup)) lookup[p.name] = p;
    });

    set.cards.forEach((card) => {
      const live = lookup[card.name];
      if (!live) return;
      if (live.number != null && live.number !== card.number) {
        card.number = live.number;
        changed = true;
      }
      if (live.image && live.image !== card.image) {
        card.image = live.image;
        card.unavailable = !live.available;
        changed = true;
      }
    });
  });

  return changed;
}

async function attemptLiveSync() {
  const hook = window.__oaklandZooChecklist;
  try {
    const posts = await fetchAllTradingCards();
    const changed = mergeLiveDataIntoSets(posts);
    if (hook) hook.onSyncResult(true, changed);
  } catch (err) {
    if (hook) hook.onSyncResult(false, false, err);
  }
}

// app.js fetches data.json/manifest.json asynchronously before
// OAKLAND_ZOO_CARD_SETS exists at all, so wait for its ready signal if
// we've beaten it here rather than racing against that fetch.
if (window.OAKLAND_ZOO_CARD_SETS && window.OAKLAND_ZOO_CARD_SETS.length) {
  attemptLiveSync();
} else {
  document.addEventListener("oaklandzoo:data-ready", attemptLiveSync, { once: true });
}
