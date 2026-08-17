// "Sync Collections": async, no-backend way for two people to compare
// collections. Deliberately NOT an auto-merge (taking the max of both
// sides' counts would make it impossible to ever record trading a card
// away — a decrease is a legitimate, intentional edit, not "stale data").
// Instead this encodes your counts into a link/code; opening it elsewhere
// computes a per-card diff and lets you pick, card by card, which side
// wins. Nothing is ever applied automatically.
const syncBtn = document.getElementById("syncBtn");
const syncModalOverlay = document.getElementById("syncModalOverlay");
const syncCloseBtn = document.getElementById("syncCloseBtn");
const syncLinkInput = document.getElementById("syncLinkInput");
const syncCopyBtn = document.getElementById("syncCopyBtn");
const syncNativeBtn = document.getElementById("syncNativeBtn");
const syncImportInput = document.getElementById("syncImportInput");
const syncCompareBtn = document.getElementById("syncCompareBtn");
const syncDiffWrap = document.getElementById("syncDiffWrap");
const syncDiffSummary = document.getElementById("syncDiffSummary");
const syncDiffKeepAllBtn = document.getElementById("syncDiffKeepAllBtn");
const syncDiffTakeAllBtn = document.getElementById("syncDiffTakeAllBtn");
const syncDiffList = document.getElementById("syncDiffList");
const syncApplyBtn = document.getElementById("syncApplyBtn");
const syncApplyStatus = document.getElementById("syncApplyStatus");

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

// --- encode/decode -----------------------------------------------------

// Groups owned's flat "setId::cardName" keys by set, so the set id isn't
// repeated per card — keeps the encoded link shorter.
function buildPayload(owned) {
  const bySet = {};
  Object.keys(owned).forEach((key) => {
    const idx = key.indexOf("::");
    if (idx === -1) return;
    const setId = key.slice(0, idx);
    const cardName = key.slice(idx + 2);
    if (!bySet[setId]) bySet[setId] = {};
    bySet[setId][cardName] = owned[key];
  });
  return { v: 1, o: bySet };
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

// UTF-8-safe, URL-safe base64 (no padding) so the code can travel either
// as a bare string or as a "?share=" query value with no extra escaping.
function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

function buildShareUrl(owned) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("share", encodeShare(buildPayload(owned)));
  return url.toString();
}

// Pasted input might be the whole link or just the bare code — accept both.
function extractShareCode(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, location.href);
    const fromParam = url.searchParams.get("share");
    if (fromParam) return fromParam;
  } catch (e) {
    /* not a URL — treat the whole thing as a bare code below */
  }
  return trimmed;
}

// --- diff ----------------------------------------------------------------

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
      choice: "mine", // default: no change, keep picking explicit
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
  syncDiffList.innerHTML = "";
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
      const groupName = "share-diff-" + i;
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

    syncDiffList.appendChild(li);
  });
}

function diffSummaryText() {
  const actionable = currentDiffRows.filter((r) => !r.notFound);
  const notFound = currentDiffRows.filter((r) => r.notFound);
  if (!actionable.length && !notFound.length) return "No differences — your collections already match.";
  let text = "";
  if (actionable.length) {
    text += actionable.length + " difference" + (actionable.length === 1 ? "" : "s") + " found — pick which to bring in.";
  } else {
    text += "No actionable differences.";
  }
  if (notFound.length) {
    text += " (" + notFound.length + " card" + (notFound.length === 1 ? "" : "s") + " not found — see below.)";
  }
  return text;
}

async function runCompare() {
  const code = extractShareCode(syncImportInput.value);
  syncApplyStatus.textContent = "";
  if (!code) {
    syncDiffWrap.hidden = false;
    syncDiffList.innerHTML = "";
    syncDiffSummary.textContent = "Paste a share link or code first.";
    return;
  }

  let payload;
  try {
    payload = decodeShare(code);
  } catch (err) {
    syncDiffWrap.hidden = false;
    syncDiffList.innerHTML = "";
    syncDiffSummary.textContent = "That doesn't look like a valid share link/code.";
    return;
  }

  await waitForCardData();
  currentTheirFlat = flattenPayload(payload);
  const localOwned = window.__oaklandZooChecklist.getOwnedSnapshot();
  currentDiffRows = computeDiff(localOwned, currentTheirFlat, getCardSets());
  syncDiffWrap.hidden = false;
  syncDiffSummary.textContent = diffSummaryText();
  renderDiffRows();
}

syncCompareBtn.addEventListener("click", () => runCompare());
syncDiffKeepAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => {
    if (!r.notFound) r.choice = "mine";
  });
  renderDiffRows();
});
syncDiffTakeAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => {
    if (!r.notFound) r.choice = "theirs";
  });
  renderDiffRows();
});

syncApplyBtn.addEventListener("click", () => {
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
  syncApplyStatus.textContent = applied
    ? "Applied " + applied + " change" + (applied === 1 ? "" : "s") + "."
    : "No changes selected — nothing applied.";
  syncDiffSummary.textContent = diffSummaryText();
  syncLinkInput.value = buildShareUrl(localOwned);
});

// --- modal open/close ------------------------------------------------------

async function openSyncModal() {
  await waitForCardData();
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  syncDiffWrap.hidden = true;
  syncDiffList.innerHTML = "";
  syncDiffSummary.textContent = "";
  syncApplyStatus.textContent = "";
  syncLinkInput.value = buildShareUrl(hooks.getOwnedSnapshot());
  // Web Share API isn't available on most desktop browsers — fall back to
  // an email compose link there instead of hiding the button, so there's
  // always a one-click "send this" option next to Copy.
  syncNativeBtn.textContent = navigator.share ? "Share…" : "Share via Email…";
  syncModalOverlay.hidden = false;
}

function closeSyncModal() {
  syncModalOverlay.hidden = true;
}

syncBtn.addEventListener("click", openSyncModal);
syncCloseBtn.addEventListener("click", closeSyncModal);
syncModalOverlay.addEventListener("click", (e) => {
  if (e.target === syncModalOverlay) closeSyncModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !syncModalOverlay.hidden) closeSyncModal();
});

syncCopyBtn.addEventListener("click", async () => {
  const text = syncLinkInput.value;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (err) {
    try {
      syncLinkInput.select();
      copied = document.execCommand("copy");
    } catch (err2) {
      copied = false;
    }
  }
  const original = syncCopyBtn.textContent;
  syncCopyBtn.textContent = copied ? "Copied!" : "Select & copy";
  setTimeout(() => (syncCopyBtn.textContent = original), 1500);
});

syncNativeBtn.addEventListener("click", async () => {
  const url = syncLinkInput.value;
  const text = "Here's my Oakland Zoo trading card collection — open this to compare with yours.";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Oakland Zoo Card Checklist", text, url });
    } catch (err) {
      if (err && err.name !== "AbortError") console.warn("Link share failed:", err);
    }
    return;
  }
  const subject = encodeURIComponent("My Oakland Zoo Card Checklist");
  const body = encodeURIComponent(text + "\n\n" + url);
  window.location.href = "mailto:?subject=" + subject + "&body=" + body;
});

// If this page was opened from someone else's share link, surface the diff
// immediately rather than making them dig for the Sync button themselves.
async function checkUrlForIncomingShare() {
  const code = new URLSearchParams(location.search).get("share");
  if (!code) return;
  history.replaceState(null, "", location.pathname + location.hash);
  await openSyncModal();
  syncImportInput.value = code;
  await runCompare();
}

checkUrlForIncomingShare();
