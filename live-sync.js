// Best-effort progressive enhancement: tries to refresh card numbers and
// photos from the zoo's own live WordPress REST API
// (oaklandzoo.org/wp-json/wp/v2/trading_card), using the OAKLAND_ZOO_CARD_SETS
// snapshot bundled in data.js as the fallback. The page has already rendered
// from that snapshot by the time this runs, so if this fetch fails for any
// reason (offline, the zoo's API not sending CORS headers for this origin,
// the endpoint changing shape, etc.) nothing breaks — the snapshot just
// keeps being what's shown, silently.
(function () {
  "use strict";

  var WP_API_BASE = "https://www.oaklandzoo.org/wp-json/wp/v2/trading_card";
  var TIMEOUT_MS = 8000;
  var MAX_PAGES = 20;

  // Cases where our data.js naming differs from the zoo's WP post titles
  // (see data.js header comment for how these were found).
  var NAME_RENAMES = {
    "Dyeing Poison Dart Frog": "Poison Dart Frog (Dyeing)",
    "Green and Black Poison Dart Frog": "Poison Dart Frog (Green and Black)",
    "Yellow-Banded Poison Dart Frog": "Poison Dart Frog (Yellow-Banded)",
    "Crowned Lemur (Female)": "Crowned Lemur",
    "Crowned Lemur (Male)": "Crowned Lemur",
    "Mallard - Female": "Mallard (Female)",
    "Mallard - Male": "Mallard (Male)",
    "White Bark Pine": "Whitebark Pine",
  };

  // Which live trading_card_category taxonomy slugs feed each of our set
  // ids, so a live card can only update a set it actually belongs to (never
  // borrow art/numbers across sets just because two cards share a name).
  // Empty arrays mean no live category currently covers that set, per the
  // investigation recorded in data.js — those sets always keep the snapshot.
  var LIVE_CATEGORIES_FOR_SET = {
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

  function decodeHtmlEntities(str) {
    var el = document.createElement("textarea");
    el.innerHTML = str;
    return el.value;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("Live sync timed out after " + ms + "ms"));
        }, ms);
      }),
    ]);
  }

  async function fetchAllTradingCards() {
    var all = [];
    var page = 1;
    while (page <= MAX_PAGES) {
      var url = WP_API_BASE + "?per_page=100&page=" + page + "&_embed=1";
      var res = await withTimeout(fetch(url), TIMEOUT_MS);
      if (!res.ok) throw new Error("WP API responded with status " + res.status);
      var batch = await res.json();
      if (!Array.isArray(batch)) throw new Error("Unexpected WP API response shape");
      all = all.concat(batch);
      var totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "1", 10) || 1;
      if (!batch.length || page >= totalPages) break;
      page++;
    }
    return all;
  }

  function parsePost(post) {
    var rawName =
      post && post.title && typeof post.title.rendered === "string"
        ? decodeHtmlEntities(post.title.rendered).trim()
        : "";
    if (!rawName) return null;
    var name = NAME_RENAMES[rawName] || rawName;

    var media = post._embedded && post._embedded["wp:featuredmedia"] && post._embedded["wp:featuredmedia"][0];
    var image = media && typeof media.source_url === "string" ? media.source_url : null;
    var mediaTitle =
      media && media.title && typeof media.title.rendered === "string"
        ? decodeHtmlEntities(media.title.rendered)
        : "";
    var numberMatch = mediaTitle.match(/(\d+)\s+of\s+100/i);
    var number = numberMatch ? parseInt(numberMatch[1], 10) : null;

    var termGroups = (post._embedded && post._embedded["wp:term"]) || [];
    var categorySlugs = [];
    termGroups.forEach(function (group) {
      (group || []).forEach(function (term) {
        if (term && term.taxonomy === "trading_card_category" && term.slug) {
          categorySlugs.push(term.slug);
        }
      });
    });

    return { name: name, number: number, image: image, categorySlugs: categorySlugs };
  }

  // Mutates OAKLAND_ZOO_CARD_SETS in place, preferring live values field by
  // field and falling back to whatever the snapshot already had. Returns
  // true if anything actually changed.
  function mergeLiveDataIntoSets(livePosts) {
    var parsed = livePosts.map(parsePost).filter(Boolean);
    var changed = false;

    OAKLAND_ZOO_CARD_SETS.forEach(function (set) {
      var allowedSlugs = LIVE_CATEGORIES_FOR_SET[set.id] || [];
      if (!allowedSlugs.length) return;

      var lookup = {};
      parsed.forEach(function (p) {
        var inScope = p.categorySlugs.some(function (slug) {
          return allowedSlugs.indexOf(slug) !== -1;
        });
        if (inScope && !(p.name in lookup)) lookup[p.name] = p;
      });

      set.cards.forEach(function (card) {
        var live = lookup[card.name];
        if (!live) return;
        if (live.number != null && live.number !== card.number) {
          card.number = live.number;
          changed = true;
        }
        if (live.image && live.image !== card.image) {
          card.image = live.image;
          changed = true;
        }
      });
    });

    return changed;
  }

  async function attemptLiveSync() {
    var hook = window.__oaklandZooChecklist;
    try {
      var posts = await fetchAllTradingCards();
      var changed = mergeLiveDataIntoSets(posts);
      if (hook) hook.onSyncResult(true, changed);
    } catch (err) {
      if (hook) hook.onSyncResult(false, false, err);
    }
  }

  attemptLiveSync();
})();
