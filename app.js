import { isUnavailableImageUrl } from "./wp-card-utils.js?v=2";

(function () {
  const STORAGE_KEY = "oaklandZooCardChecklist.v1";
  const COLLAPSE_KEY = "oaklandZooCardChecklist.collapsed.v1";

  const setsContainer = document.getElementById("setsContainer");
  const searchInput = document.getElementById("searchInput");
  const setFilter = document.getElementById("setFilter");
  const toggleButtons = document.querySelectorAll(".toggle-btn");
  const resetBtn = document.getElementById("resetBtn");
  const emptyState = document.getElementById("emptyState");
  const ownedCountEl = document.getElementById("ownedCount");
  const totalCountEl = document.getElementById("totalCount");
  const dupCountEl = document.getElementById("dupCount");
  const progressPercentEl = document.getElementById("progressPercent");
  const progressBarFill = document.getElementById("progressBarFill");
  const syncStatusEl = document.getElementById("syncStatus");
  const dataSourceBadge = document.getElementById("dataSourceBadge");
  const dataSourceLabel = dataSourceBadge.querySelector(".data-source-label");

  function setDataSourceBadge(state, label, title) {
    dataSourceBadge.classList.remove("is-checking", "is-live", "is-cached");
    dataSourceBadge.classList.add("is-" + state);
    dataSourceLabel.textContent = label;
    dataSourceBadge.title = title || "";
  }

  // Populated by init() from data.json. Declared here (not just as a
  // window global) so every function in this file sees the same live
  // reference via closure; also mirrored onto window.OAKLAND_ZOO_CARD_SETS
  // so live-sync.js (a separate script) can read/mutate the same array.
  let OAKLAND_ZOO_CARD_SETS = [];

  let owned = loadOwned();
  let collapsed = loadCollapsed();
  let searchTerm = "";
  let setFilterValue = "all";
  let statusFilter = "all";

  // owned[key] is a quantity (integer >= 1); absent/0 means "don't have it".
  // Older saved data stored `true` for "owned" with no quantity concept —
  // migrated to a count of 1 on load so nobody's progress resets.
  function loadOwned() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const migrated = {};
      Object.keys(parsed).forEach((key) => {
        const value = parsed[key];
        const count = typeof value === "number" ? value : value ? 1 : 0;
        if (count > 0) migrated[key] = count;
      });
      return migrated;
    } catch (e) {
      return {};
    }
  }

  function saveOwned() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(owned));
  }

  function getCount(key) {
    return owned[key] || 0;
  }

  // Single place that changes a card's owned quantity, so the grid item,
  // the modal, and all the summary stats/filters stay in sync regardless of
  // which UI triggered the change.
  function setCount(setId, item, checkbox, key, newCount) {
    const count = Math.max(0, newCount);
    if (count > 0) {
      owned[key] = count;
    } else {
      delete owned[key];
    }
    saveOwned();

    checkbox.checked = count > 0;
    item.classList.toggle("owned", count > 0);
    item.dataset.qty = String(count);

    const stepper = item.querySelector(".qty-stepper");
    if (stepper) stepper.hidden = count === 0;
    const qtyBadge = item.querySelector(".qty-badge");
    if (qtyBadge) {
      qtyBadge.hidden = count <= 1;
      qtyBadge.textContent = "×" + count;
    }

    if (modalContext && modalContext.key === key) {
      modalOwnedCheckbox.checked = count > 0;
      modalQtyStepper.hidden = count === 0;
      modalQtyValue.textContent = String(count);
    }

    updateSetProgress(setId);
    updateOverallProgress();
    applyFilters();
  }

  function loadCollapsed() {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveCollapsed() {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
  }

  function cardKey(setId, cardName) {
    return setId + "::" + cardName;
  }

  const PAW_PLACEHOLDER =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e9dfc9'/%3E%3Ctext x='50' y='62' font-size='44' text-anchor='middle'%3E%F0%9F%90%BE%3C/text%3E%3C/svg%3E";

  // Precomputed once per card by applyImageCache() below, rather than
  // re-derived from the URL each time — a locally cached file's own name
  // won't contain "Unavailable" even when it *is* the last-ditch fallback
  // tier, so the flag has to travel with the card, not be re-guessed later.
  function isUnavailable(card) {
    return !!card.unavailable;
  }

  // Merges the local image cache (cache/manifest.json, refreshed weekly by
  // .github/workflows/refresh-image-cache.yml) into the data.json snapshot,
  // per card, per the preference order:
  //   1. a live image found by live-sync.js (applied later, always wins)
  //   2. a cached "available" real photo (this function)
  //   3. data.json's own `image` (today's live zoo-hosted URL, available or not)
  //   4. a cached "fallback" image — only for cards data.json has none for
  //   5. the generic paw placeholder (app.js's own PAW_PLACEHOLDER, used
  //      automatically wherever card.image ends up unset)
  function applyImageCache(sets, manifest) {
    sets.forEach((set) => {
      set.cards.forEach((card) => {
        const cached = manifest[cardKey(set.id, card.name)];
        card.unavailable = isUnavailableImageUrl(card.image);
        if (cached && cached.tier === "available") {
          card.image = cached.file;
          card.unavailable = false;
        } else if (!card.image && cached && cached.tier === "fallback") {
          card.image = cached.file;
          card.unavailable = true;
        }
      });
    });
  }

  const modalOverlay = document.getElementById("cardModalOverlay");
  const modalImage = document.getElementById("modalImage");
  const modalSetName = document.getElementById("modalSetName");
  const modalCardName = document.getElementById("modalCardName");
  const modalNumberBadge = document.getElementById("modalNumberBadge");
  const modalUnavailableBadge = document.getElementById("modalUnavailableBadge");
  const modalOwnedCheckbox = document.getElementById("modalOwnedCheckbox");
  const modalQtyStepper = document.getElementById("modalQtyStepper");
  const modalQtyValue = document.getElementById("modalQtyValue");
  const modalQtyDec = document.getElementById("modalQtyDec");
  const modalQtyInc = document.getElementById("modalQtyInc");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  let modalContext = null; // { setId, item, checkbox, key }

  function openModal(setId, card, item, checkbox, key) {
    modalContext = { setId, item, checkbox, key };
    modalImage.src = card.image || PAW_PLACEHOLDER;
    modalImage.alt = card.name;
    modalSetName.textContent = (OAKLAND_ZOO_CARD_SETS.find((s) => s.id === setId) || {}).name || "";
    modalCardName.textContent = card.name;
    if (card.number != null) {
      modalNumberBadge.hidden = false;
      modalNumberBadge.textContent = "#" + card.number;
    } else {
      modalNumberBadge.hidden = true;
    }
    modalUnavailableBadge.hidden = !isUnavailable(card);
    const count = getCount(key);
    modalOwnedCheckbox.checked = count > 0;
    modalQtyStepper.hidden = count === 0;
    modalQtyValue.textContent = String(count);
    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
    modalContext = null;
  }

  modalCloseBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.hidden) closeModal();
  });
  modalOwnedCheckbox.addEventListener("change", () => {
    if (!modalContext) return;
    const { setId, item, checkbox, key } = modalContext;
    setCount(setId, item, checkbox, key, modalOwnedCheckbox.checked ? Math.max(1, getCount(key)) : 0);
  });
  modalQtyDec.addEventListener("click", () => {
    if (!modalContext) return;
    const { setId, item, checkbox, key } = modalContext;
    setCount(setId, item, checkbox, key, getCount(key) - 1);
  });
  modalQtyInc.addEventListener("click", () => {
    if (!modalContext) return;
    const { setId, item, checkbox, key } = modalContext;
    setCount(setId, item, checkbox, key, getCount(key) + 1);
  });

  function populateSetFilter() {
    OAKLAND_ZOO_CARD_SETS.forEach((set) => {
      const opt = document.createElement("option");
      opt.value = set.id;
      opt.textContent = set.name;
      setFilter.appendChild(opt);
    });
  }

  function buildSets() {
    setsContainer.innerHTML = "";
    OAKLAND_ZOO_CARD_SETS.forEach((set) => {
      const setCard = document.createElement("div");
      setCard.className = "set-card";
      setCard.dataset.setId = set.id;
      if (collapsed[set.id]) setCard.classList.add("collapsed");

      const header = document.createElement("div");
      header.className = "set-header";
      header.innerHTML = `
        <div class="set-title-group">
          <div class="set-title">${escapeHtml(set.name)}</div>
          <div class="set-desc">${escapeHtml(set.description || "")}</div>
        </div>
        <div class="set-progress">
          <span class="set-progress-text" data-role="set-progress-text"></span>
          <div class="set-progress-track">
            <div class="set-progress-fill" data-role="set-progress-fill"></div>
          </div>
          <span class="chevron">&#9660;</span>
        </div>
      `;
      header.addEventListener("click", () => {
        collapsed[set.id] = !collapsed[set.id];
        setCard.classList.toggle("collapsed", collapsed[set.id]);
        saveCollapsed();
      });

      const list = document.createElement("div");
      list.className = "card-list";

      set.cards.forEach((card) => {
        const key = cardKey(set.id, card.name);
        const item = document.createElement("label");
        item.className = "card-item";
        item.dataset.cardName = card.name.toLowerCase();

        const initialCount = getCount(key);
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = initialCount > 0;
        if (checkbox.checked) item.classList.add("owned");
        item.dataset.qty = String(initialCount);

        checkbox.addEventListener("change", () => {
          setCount(set.id, item, checkbox, key, checkbox.checked ? Math.max(1, getCount(key)) : 0);
        });

        const thumbWrap = document.createElement("span");
        thumbWrap.className = "card-thumb-wrap";

        const thumb = document.createElement("img");
        thumb.className = "card-thumb";
        thumb.src = card.image || PAW_PLACEHOLDER;
        thumb.loading = "lazy";
        thumb.alt = "";
        if (isUnavailable(card)) thumb.classList.add("unavailable");
        thumb.addEventListener("error", () => {
          thumb.src = PAW_PLACEHOLDER;
          thumb.classList.remove("unavailable");
        });
        thumbWrap.appendChild(thumb);

        if (isUnavailable(card)) {
          const badge = document.createElement("span");
          badge.className = "card-thumb-badge";
          // Plain monochrome clock icon (inherits color: currentColor) rather
          // than a colorful emoji, to stay visually unobtrusive.
          badge.innerHTML =
            '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75V8l2.25 1.25"/></svg>';
          badge.setAttribute("role", "img");
          badge.setAttribute("aria-label", "Currently unavailable at the zoo");
          badge.title = "Currently unavailable at the zoo";
          thumbWrap.appendChild(badge);
        }

        thumbWrap.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openModal(set.id, card, item, checkbox, key);
        });

        const textWrap = document.createElement("span");
        textWrap.className = "card-text";

        if (card.number != null) {
          const numberSpan = document.createElement("span");
          numberSpan.className = "card-number";
          numberSpan.textContent = "#" + card.number;
          textWrap.appendChild(numberSpan);
        }

        const nameSpan = document.createElement("span");
        nameSpan.className = "card-name";
        nameSpan.textContent = card.name;
        textWrap.appendChild(nameSpan);

        // Quantity stepper: only meaningful (and only shown) once owned.
        // Its own click handlers stop propagation so clicking +/- doesn't
        // toggle the surrounding label's checkbox.
        const qtyStepper = document.createElement("span");
        qtyStepper.className = "qty-stepper";
        qtyStepper.hidden = initialCount === 0;

        const decBtn = document.createElement("button");
        decBtn.type = "button";
        decBtn.className = "qty-btn";
        decBtn.textContent = "−";
        decBtn.setAttribute("aria-label", "Decrease quantity");
        decBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          setCount(set.id, item, checkbox, key, getCount(key) - 1);
        });

        const qtyBadge = document.createElement("span");
        qtyBadge.className = "qty-badge";
        qtyBadge.hidden = initialCount <= 1;
        qtyBadge.textContent = "×" + initialCount;

        const incBtn = document.createElement("button");
        incBtn.type = "button";
        incBtn.className = "qty-btn";
        incBtn.textContent = "+";
        incBtn.setAttribute("aria-label", "Increase quantity (mark a duplicate)");
        incBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          setCount(set.id, item, checkbox, key, getCount(key) + 1);
        });

        qtyStepper.appendChild(decBtn);
        qtyStepper.appendChild(qtyBadge);
        qtyStepper.appendChild(incBtn);

        item.appendChild(checkbox);
        item.appendChild(thumbWrap);
        item.appendChild(textWrap);
        item.appendChild(qtyStepper);
        list.appendChild(item);
      });

      setCard.appendChild(header);
      setCard.appendChild(list);
      setsContainer.appendChild(setCard);

      updateSetProgress(set.id);
    });
  }

  function updateSetProgress(setId) {
    const set = OAKLAND_ZOO_CARD_SETS.find((s) => s.id === setId);
    if (!set) return;
    const total = set.cards.length;
    const ownedCount = set.cards.filter((card) => owned[cardKey(setId, card.name)]).length;
    const pct = total === 0 ? 0 : Math.round((ownedCount / total) * 100);

    const setCard = setsContainer.querySelector(`[data-set-id="${cssEscape(setId)}"]`);
    if (!setCard) return;
    const textEl = setCard.querySelector('[data-role="set-progress-text"]');
    const fillEl = setCard.querySelector('[data-role="set-progress-fill"]');
    if (textEl) textEl.textContent = `${ownedCount}/${total}`;
    if (fillEl) fillEl.style.width = pct + "%";
  }

  function updateOverallProgress() {
    let total = 0;
    let ownedTotal = 0;
    let dupTotal = 0;
    OAKLAND_ZOO_CARD_SETS.forEach((set) => {
      total += set.cards.length;
      set.cards.forEach((card) => {
        const count = getCount(cardKey(set.id, card.name));
        if (count > 0) ownedTotal++;
        if (count > 1) dupTotal++;
      });
    });
    const pct = total === 0 ? 0 : Math.round((ownedTotal / total) * 100);
    ownedCountEl.textContent = ownedTotal;
    totalCountEl.textContent = total;
    progressPercentEl.textContent = pct + "%";
    progressBarFill.style.width = pct + "%";
    dupCountEl.hidden = dupTotal === 0;
    dupCountEl.textContent = dupTotal === 0 ? "" : `• ${dupTotal} duplicate${dupTotal === 1 ? "" : "s"}`;
  }

  function applyFilters() {
    let anyVisibleOverall = false;

    OAKLAND_ZOO_CARD_SETS.forEach((set) => {
      const setCard = setsContainer.querySelector(`[data-set-id="${cssEscape(set.id)}"]`);
      if (!setCard) return;

      const matchesSetFilter = setFilterValue === "all" || setFilterValue === set.id;
      let anyVisibleInSet = false;

      const items = setCard.querySelectorAll(".card-item");
      items.forEach((item) => {
        const name = item.dataset.cardName || "";
        const qty = parseInt(item.dataset.qty || "0", 10);
        const isOwned = qty > 0;

        const matchesSearch = !searchTerm || name.includes(searchTerm);
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "owned" && isOwned) ||
          (statusFilter === "missing" && !isOwned) ||
          (statusFilter === "duplicates" && qty > 1);

        const visible = matchesSetFilter && matchesSearch && matchesStatus;
        item.classList.toggle("hidden-by-filter", !visible);
        if (visible) {
          anyVisibleInSet = true;
          anyVisibleOverall = true;
        }
      });

      const setShouldShow = matchesSetFilter && anyVisibleInSet;
      setCard.style.display = setShouldShow ? "" : "none";
    });

    emptyState.hidden = anyVisibleOverall;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function cssEscape(str) {
    return String(str).replace(/["\\]/g, "\\$&");
  }

  searchInput.addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  setFilter.addEventListener("change", (e) => {
    setFilterValue = e.target.value;
    applyFilters();
  });

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      statusFilter = btn.dataset.filter;
      applyFilters();
    });
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("Clear your entire collection checklist? This cannot be undone.")) return;
    owned = {};
    saveOwned();
    document.querySelectorAll(".card-item").forEach((item) => {
      item.classList.remove("owned");
      item.dataset.qty = "0";
      item.querySelector("input[type=checkbox]").checked = false;
      const stepper = item.querySelector(".qty-stepper");
      if (stepper) stepper.hidden = true;
      const qtyBadge = item.querySelector(".qty-badge");
      if (qtyBadge) qtyBadge.hidden = true;
    });
    if (modalContext) {
      modalOwnedCheckbox.checked = false;
      modalQtyStepper.hidden = true;
    }
    OAKLAND_ZOO_CARD_SETS.forEach((set) => updateSetProgress(set.id));
    updateOverallProgress();
    applyFilters();
  });

  function renderAll() {
    buildSets();
    updateOverallProgress();
    applyFilters();
  }

  // Hook for live-sync.js: this file always renders the data.json snapshot
  // first (fetched from the same origin, so it works with no other network
  // access at all), then live-sync.js tries to refresh card numbers/photos
  // from the zoo's live API in the background and reports back here.
  window.__oaklandZooChecklist = {
    onSyncResult(ok, changed, err) {
      if (ok) {
        if (changed) renderAll();
        syncStatusEl.textContent = changed
          ? "Synced with the zoo's live card list just now."
          : "Checked the zoo's live card list — already up to date.";
        setDataSourceBadge(
          "live",
          "Live",
          changed
            ? "Numbers/photos just refreshed from oaklandzoo.org's live card list."
            : "Confirmed up to date with oaklandzoo.org's live card list."
        );
      } else {
        syncStatusEl.textContent = "Showing the saved card snapshot (live sync unavailable).";
        setDataSourceBadge(
          "cached",
          "Cached snapshot",
          "Couldn't reach oaklandzoo.org's live card list — showing the saved data.json snapshot instead."
        );
        if (err) console.warn("Oakland Zoo live sync failed:", err);
      }
    },
  };

  async function init() {
    try {
      // no-cache: always revalidate with the server rather than trusting a
      // stale local copy — data.json is meant to be hand-edited over time.
      const res = await fetch("data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      OAKLAND_ZOO_CARD_SETS = Array.isArray(data.sets) ? data.sets : [];
    } catch (err) {
      console.error("Failed to load data.json:", err);
      emptyState.hidden = false;
      emptyState.textContent = "Couldn't load the card data (data.json). Try refreshing the page.";
      setDataSourceBadge("cached", "Failed to load", "Couldn't load data.json at all.");
      return;
    }

    // The image cache manifest is optional/best-effort — unlike data.json,
    // its absence or failure isn't fatal, it just means fewer real photos.
    let manifest = {};
    try {
      const res = await fetch("cache/manifest.json", { cache: "no-cache" });
      if (res.ok) manifest = await res.json();
    } catch (err) {
      console.warn("Couldn't load cache/manifest.json (continuing without it):", err);
    }
    applyImageCache(OAKLAND_ZOO_CARD_SETS, manifest);

    // What's rendered right now is the snapshot; live-sync.js may upgrade
    // this to "Live" shortly (see onSyncResult above).
    setDataSourceBadge("checking", "Checking live status…", "Showing the saved data.json snapshot for now.");

    // Expose the same array reference globally so live-sync.js can merge
    // fresher numbers/photos into it in place.
    window.OAKLAND_ZOO_CARD_SETS = OAKLAND_ZOO_CARD_SETS;

    populateSetFilter();
    renderAll();
    document.dispatchEvent(new CustomEvent("oaklandzoo:data-ready"));
  }

  init();
})();
