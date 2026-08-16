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
  const progressPercentEl = document.getElementById("progressPercent");
  const progressBarFill = document.getElementById("progressBarFill");

  let owned = loadOwned();
  let collapsed = loadCollapsed();
  let searchTerm = "";
  let setFilterValue = "all";
  let statusFilter = "all";

  function loadOwned() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveOwned() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(owned));
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

  // The zoo's own site names these image files with an "Unavailable" (or
  // "Retired Unavailable") suffix for cards not currently in physical
  // rotation, rendering the same grayed-out photo + notice we mirror here.
  function isUnavailable(card) {
    return !!card.image && /unavailable/i.test(card.image);
  }

  const modalOverlay = document.getElementById("cardModalOverlay");
  const modalImage = document.getElementById("modalImage");
  const modalSetName = document.getElementById("modalSetName");
  const modalCardName = document.getElementById("modalCardName");
  const modalNumberBadge = document.getElementById("modalNumberBadge");
  const modalUnavailableBadge = document.getElementById("modalUnavailableBadge");
  const modalOwnedCheckbox = document.getElementById("modalOwnedCheckbox");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  let modalContext = null; // { setId, card, gridCheckbox }

  function openModal(setId, card, gridCheckbox) {
    modalContext = { setId, card, gridCheckbox };
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
    modalOwnedCheckbox.checked = gridCheckbox.checked;
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
    modalContext.gridCheckbox.checked = modalOwnedCheckbox.checked;
    modalContext.gridCheckbox.dispatchEvent(new Event("change"));
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

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!owned[key];
        if (checkbox.checked) item.classList.add("owned");

        checkbox.addEventListener("change", () => {
          owned[key] = checkbox.checked;
          if (!checkbox.checked) delete owned[key];
          saveOwned();
          item.classList.toggle("owned", checkbox.checked);
          updateSetProgress(set.id);
          updateOverallProgress();
          applyFilters();
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
          badge.textContent = "Unavailable";
          thumbWrap.appendChild(badge);
        }

        thumbWrap.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openModal(set.id, card, checkbox);
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

        item.appendChild(checkbox);
        item.appendChild(thumbWrap);
        item.appendChild(textWrap);
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
    OAKLAND_ZOO_CARD_SETS.forEach((set) => {
      total += set.cards.length;
      ownedTotal += set.cards.filter((card) => owned[cardKey(set.id, card.name)]).length;
    });
    const pct = total === 0 ? 0 : Math.round((ownedTotal / total) * 100);
    ownedCountEl.textContent = ownedTotal;
    totalCountEl.textContent = total;
    progressPercentEl.textContent = pct + "%";
    progressBarFill.style.width = pct + "%";
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
        const checkbox = item.querySelector("input[type=checkbox]");
        const isOwned = checkbox.checked;

        const matchesSearch = !searchTerm || name.includes(searchTerm);
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "owned" && isOwned) ||
          (statusFilter === "missing" && !isOwned);

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
    document.querySelectorAll(".card-item input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
      cb.closest(".card-item").classList.remove("owned");
    });
    OAKLAND_ZOO_CARD_SETS.forEach((set) => updateSetProgress(set.id));
    updateOverallProgress();
    applyFilters();
  });

  populateSetFilter();
  buildSets();
  updateOverallProgress();
  applyFilters();
})();
