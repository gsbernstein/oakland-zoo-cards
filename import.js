// "Import a Collection": dedicated modal for reviewing and applying
// someone else's shared collection — deliberately its own screen rather
// than a section at the bottom of the Sync modal, since this is the
// destination for both ways of receiving a collection: opening a
// "?share=" link directly, or pasting a link/code into sync.js's entry
// box. Still NOT an auto-merge: every differing card gets its own row and
// nothing is written until "Apply selected" is clicked. Rows default to
// "theirs" (the usual intent when importing) but each one — and each
// bulk action — can be flipped before applying.
const importModalOverlay = document.getElementById("importModalOverlay");
const importCloseBtn = document.getElementById("importCloseBtn");
const importDiffSummary = document.getElementById("importDiffSummary");
const importDiffKeepAllBtn = document.getElementById("importDiffKeepAllBtn");
const importDiffTakeAllBtn = document.getElementById("importDiffTakeAllBtn");
const importDiffList = document.getElementById("importDiffList");
const importApplyBtn = document.getElementById("importApplyBtn");
const importApplyStatus = document.getElementById("importApplyStatus");

let currentDiffRows = [];
let currentTheirFlat = {};

function waitForCardData() {
  if (window.OAKLAND_ZOO_CARD_SETS && window.OAKLAND_ZOO_CARD_SETS.length) {
    return Promise.resolve(window.OAKLAND_ZOO_CARD_SETS);
  }
  return new Promise((resolve) => {
    document.addEventListener(
      "oaklandzoo:data-ready",
      () => resolve(window.OAKLAND_ZOO_CARD_SETS),
      { once: true }
    );
  });
}

function getCardSets() {
  return window.OAKLAND_ZOO_CARD_SETS || [];
}

function flattenPayload(payload) {
  const flat = {};
  const bySet = (payload && payload.o) || {};
  Object.keys(bySet).forEach((setId) => {
    Object.keys(bySet[setId]).forEach((cardName) => {
      const count = bySet[setId][cardName];
      if (count > 0) flat[setId + "::" + cardName] = count;
    });
  });
  return flat;
}

function decodeShare(code) {
  const sanitized = code.replace(/\s+/g, "");
  let b64 = sanitized.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || typeof payload.o !== "object") throw new Error("Not a share payload");
  return payload;
}

// A row is either a real diff (both `mine`/`theirs` refer to a card that
// exists in the current data.json) or `notFound: true` — the key came from
// one side but doesn't match any known card (a rename/removal since the
// link was made, or a bad paste). Surfaced rather than silently dropped,
// since applying it would otherwise be an invisible no-op.
function computeDiff(localOwned, theirFlat, sets) {
  const keys = new Set([...Object.keys(localOwned), ...Object.keys(theirFlat)]);
  const rows = [];
  keys.forEach((key) => {
    const mine = localOwned[key] || 0;
    const theirs = theirFlat[key] || 0;
    if (mine === theirs) return;
    const idx = key.indexOf("::");
    const setId = key.slice(0, idx);
    const cardName = key.slice(idx + 2);
    const set = sets.find((s) => s.id === setId);
    const cardExists = !!(set && set.cards.some((c) => c.name === cardName));
    rows.push({
      key,
      setId,
      cardName,
      setName: set ? set.name : setId,
      mine,
      theirs,
      choice: "theirs", // default: adopt the imported collection, easy to flip per-row
      notFound: !cardExists,
    });
  });
  rows.sort((a, b) => (a.setName + a.cardName).localeCompare(b.setName + b.cardName));
  return rows;
}

function makeChoiceLabel(groupName, value, text, checked) {
  const label = document.createElement("label");
  if (checked) label.classList.add("selected");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = groupName;
  input.value = value;
  input.checked = checked;
  label.appendChild(input);
  label.appendChild(document.createTextNode(text));
  return label;
}

function renderDiffRows() {
  importDiffList.innerHTML = "";
  currentDiffRows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "share-diff-row";

    const info = document.createElement("span");
    info.className = "share-diff-info";
    const nameEl = document.createElement("span");
    nameEl.className = "share-diff-name";
    nameEl.textContent = row.cardName;
    const setEl = document.createElement("span");
    setEl.className = "share-diff-set";
    setEl.textContent = row.notFound ? row.setName + " — not in the current card list" : row.setName;
    info.appendChild(nameEl);
    info.appendChild(document.createElement("br"));
    info.appendChild(setEl);
    li.appendChild(info);

    if (row.notFound) {
      li.classList.add("share-diff-row-not-found");
      const note = document.createElement("span");
      note.className = "share-diff-not-found-note";
      note.textContent = "Not found";
      note.title =
        "This card doesn't match anything in the current list (renamed or removed since this link was made) — nothing to apply.";
      li.appendChild(note);
    } else {
      const choice = document.createElement("span");
      choice.className = "share-diff-choice";
      const groupName = "import-diff-" + i;
      const mineLabel = makeChoiceLabel(groupName, "mine", "Yours: " + row.mine, row.choice === "mine");
      const theirsLabel = makeChoiceLabel(groupName, "theirs", "Theirs: " + row.theirs, row.choice === "theirs");

      mineLabel.querySelector("input").addEventListener("change", () => {
        row.choice = "mine";
        mineLabel.classList.add("selected");
        theirsLabel.classList.remove("selected");
      });
      theirsLabel.querySelector("input").addEventListener("change", () => {
        row.choice = "theirs";
        theirsLabel.classList.add("selected");
        mineLabel.classList.remove("selected");
      });

      choice.appendChild(mineLabel);
      choice.appendChild(theirsLabel);
      li.appendChild(choice);
    }

    importDiffList.appendChild(li);
  });
}

function diffSummaryText() {
  const actionable = currentDiffRows.filter((r) => !r.notFound);
  const notFound = currentDiffRows.filter((r) => r.notFound);
  if (!actionable.length && !notFound.length) return "No differences — your collections already match.";
  let text = "";
  if (actionable.length) {
    text +=
      actionable.length + " difference" + (actionable.length === 1 ? "" : "s") + " found — pick which to bring in.";
  } else {
    text += "No actionable differences.";
  }
  if (notFound.length) {
    text += " (" + notFound.length + " card" + (notFound.length === 1 ? "" : "s") + " not found — see below.)";
  }
  return text;
}

// Distinct from diffSummaryText(): this is what the top summary shows right
// after Apply, so it reads as a confirmation of what just happened rather
// than reverting to a plain "no differences" line that looks like nothing
// occurred. `applied` is the count just written; the rest describes what,
// if anything, is left to review.
function appliedSummaryText(applied) {
  const actionable = currentDiffRows.filter((r) => !r.notFound);
  const notFound = currentDiffRows.filter((r) => r.notFound);
  let text;
  if (!applied) {
    text = "No changes selected — nothing applied.";
  } else {
    text = "Applied " + applied + " change" + (applied === 1 ? "" : "s") + ".";
    if (actionable.length) {
      text +=
        " " +
        actionable.length +
        " difference" +
        (actionable.length === 1 ? " remains" : "s remain") +
        " — pick which to bring in.";
    } else {
      text += " Your collections now match.";
    }
  }
  if (notFound.length) {
    text += " (" + notFound.length + " card" + (notFound.length === 1 ? "" : "s") + " not found — see below.)";
  }
  return text;
}

importDiffKeepAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => {
    if (!r.notFound) r.choice = "mine";
  });
  renderDiffRows();
});
importDiffTakeAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => {
    if (!r.notFound) r.choice = "theirs";
  });
  renderDiffRows();
});

importApplyBtn.addEventListener("click", () => {
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  let applied = 0;
  currentDiffRows.forEach((row) => {
    if (!row.notFound && row.choice === "theirs") {
      hooks.applyOwnedChange(row.setId, row.cardName, row.theirs);
      applied++;
    }
  });

  const localOwned = hooks.getOwnedSnapshot();
  currentDiffRows = computeDiff(localOwned, currentTheirFlat, getCardSets());
  renderDiffRows();
  importApplyStatus.textContent = applied
    ? "Applied " + applied + " change" + (applied === 1 ? "" : "s") + "."
    : "No changes selected — nothing applied.";
  importDiffSummary.textContent = appliedSummaryText(applied);
});

function closeImportModal() {
  importModalOverlay.hidden = true;
}

importCloseBtn.addEventListener("click", closeImportModal);
importModalOverlay.addEventListener("click", (e) => {
  if (e.target === importModalOverlay) closeImportModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !importModalOverlay.hidden) closeImportModal();
});

// Entry point used both by an incoming "?share=" link and by sync.js's
// paste-a-link box — both land here rather than showing the diff inline
// somewhere else, so importing always gets this same dedicated screen.
async function openWithCode(code) {
  await waitForCardData();
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  importApplyStatus.textContent = "";
  importModalOverlay.hidden = false;

  let payload;
  try {
    payload = decodeShare(code);
  } catch (err) {
    currentDiffRows = [];
    importDiffList.innerHTML = "";
    importDiffSummary.textContent = "That doesn't look like a valid share link/code.";
    return;
  }

  currentTheirFlat = flattenPayload(payload);
  const localOwned = hooks.getOwnedSnapshot();
  currentDiffRows = computeDiff(localOwned, currentTheirFlat, getCardSets());
  importDiffSummary.textContent = diffSummaryText();
  renderDiffRows();
}

window.__oaklandZooImport = { openWithCode };

// If this page was opened from someone else's share link, jump straight
// into this dedicated import screen rather than the Sync ("copy mine")
// modal, and strip the param so a reload doesn't redo it.
(function checkUrlForIncomingShare() {
  const code = new URLSearchParams(location.search).get("share");
  if (!code) return;
  history.replaceState(null, "", location.pathname + location.hash);
  openWithCode(code);
})();
