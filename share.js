// "Share & Sync": async, no-backend way for two people to compare
// collections. Deliberately NOT an auto-merge (taking the max of both
// sides' counts would make it impossible to ever record trading a card
// away — a decrease is a legitimate, intentional edit, not "stale data").
// Instead this encodes your counts into a link/code; opening it elsewhere
// computes a per-card diff and lets you pick, card by card, which side
// wins. Nothing is ever applied automatically.
const shareBtn = document.getElementById("shareBtn");
const shareModalOverlay = document.getElementById("shareModalOverlay");
const shareCloseBtn = document.getElementById("shareCloseBtn");
const shareLinkInput = document.getElementById("shareLinkInput");
const shareCopyBtn = document.getElementById("shareCopyBtn");
const shareNativeBtn = document.getElementById("shareNativeBtn");
const shareImagePreview = document.getElementById("shareImagePreview");
const shareImageDownloadBtn = document.getElementById("shareImageDownloadBtn");
const shareImageShareBtn = document.getElementById("shareImageShareBtn");
const shareImportInput = document.getElementById("shareImportInput");
const shareCompareBtn = document.getElementById("shareCompareBtn");
const shareDiffWrap = document.getElementById("shareDiffWrap");
const shareDiffSummary = document.getElementById("shareDiffSummary");
const shareDiffKeepAllBtn = document.getElementById("shareDiffKeepAllBtn");
const shareDiffTakeAllBtn = document.getElementById("shareDiffTakeAllBtn");
const shareDiffList = document.getElementById("shareDiffList");
const shareApplyBtn = document.getElementById("shareApplyBtn");
const shareApplyStatus = document.getElementById("shareApplyStatus");

let currentDiffRows = [];
let currentTheirFlat = {};
let shareImageBlobUrl = null;

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
    // Skip cards that don't exist in the current data.json (e.g. renamed or
    // removed since the link was generated) — applying them would silently
    // no-op, so there's nothing useful to show or let the user pick.
    if (!set || !set.cards.some((c) => c.name === cardName)) return;
    rows.push({
      key,
      setId,
      cardName,
      setName: set ? set.name : setId,
      mine,
      theirs,
      choice: "mine", // default: no change, keep picking explicit
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
  shareDiffList.innerHTML = "";
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
    setEl.textContent = row.setName;
    info.appendChild(nameEl);
    info.appendChild(document.createElement("br"));
    info.appendChild(setEl);

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
    li.appendChild(info);
    li.appendChild(choice);
    shareDiffList.appendChild(li);
  });
}

async function runCompare() {
  const code = extractShareCode(shareImportInput.value);
  shareApplyStatus.textContent = "";
  if (!code) {
    shareDiffWrap.hidden = false;
    shareDiffList.innerHTML = "";
    shareDiffSummary.textContent = "Paste a share link or code first.";
    return;
  }

  let payload;
  try {
    payload = decodeShare(code);
  } catch (err) {
    shareDiffWrap.hidden = false;
    shareDiffList.innerHTML = "";
    shareDiffSummary.textContent = "That doesn't look like a valid share link/code.";
    return;
  }

  await waitForCardData();
  currentTheirFlat = flattenPayload(payload);
  const localOwned = window.__oaklandZooChecklist.getOwnedSnapshot();
  currentDiffRows = computeDiff(localOwned, currentTheirFlat, getCardSets());
  shareDiffWrap.hidden = false;

  if (!currentDiffRows.length) {
    shareDiffSummary.textContent = "No differences — your collections already match.";
    shareDiffList.innerHTML = "";
  } else {
    shareDiffSummary.textContent =
      currentDiffRows.length + " difference" + (currentDiffRows.length === 1 ? "" : "s") + " found — pick which to bring in.";
    renderDiffRows();
  }
}

shareCompareBtn.addEventListener("click", () => runCompare());
shareDiffKeepAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => (r.choice = "mine"));
  renderDiffRows();
});
shareDiffTakeAllBtn.addEventListener("click", () => {
  currentDiffRows.forEach((r) => (r.choice = "theirs"));
  renderDiffRows();
});

shareApplyBtn.addEventListener("click", () => {
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  let applied = 0;
  currentDiffRows.forEach((row) => {
    if (row.choice === "theirs") {
      hooks.applyOwnedChange(row.setId, row.cardName, row.theirs);
      applied++;
    }
  });

  const localOwned = hooks.getOwnedSnapshot();
  currentDiffRows = computeDiff(localOwned, currentTheirFlat, getCardSets());
  renderDiffRows();
  shareApplyStatus.textContent = applied
    ? "Applied " + applied + " change" + (applied === 1 ? "" : "s") + "."
    : "No changes selected — nothing applied.";
  shareDiffSummary.textContent = currentDiffRows.length
    ? currentDiffRows.length + " difference" + (currentDiffRows.length === 1 ? "" : "s") + " remaining."
    : "Everything matches now.";

  shareLinkInput.value = buildShareUrl(localOwned);
  updateShareImagePreview();
});

// --- shareable "I've got X cards" image -----------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderShareImage() {
  const sets = getCardSets();
  const owned = window.__oaklandZooChecklist.getOwnedSnapshot();
  let total = 0;
  let ownedTotal = 0;
  sets.forEach((set) => {
    total += set.cards.length;
    set.cards.forEach((card) => {
      if ((owned[set.id + "::" + card.name] || 0) > 0) ownedTotal++;
    });
  });
  const pct = total ? Math.round((ownedTotal / total) * 100) : 0;

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#1f6b3a");
  gradient.addColorStop(1, "#164f2b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#e9dfc9";
  ctx.beginPath();
  ctx.arc(1020, 110, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#ffffff";
  ctx.font = "64px sans-serif";
  ctx.fillText("🦁", 60, 130);

  ctx.font = "600 34px sans-serif";
  ctx.fillText("Oakland Zoo Card Checklist", 150, 118);

  ctx.font = "700 110px sans-serif";
  ctx.fillText(ownedTotal + "/" + total, 60, 330);

  ctx.fillStyle = "#e0812a";
  ctx.font = "600 40px sans-serif";
  ctx.fillText("cards collected", 60, 390);

  const barX = 60;
  const barY = 440;
  const barW = 1080;
  const barH = 28;
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  roundRect(ctx, barX, barY, barW, barH, 14);
  ctx.fill();
  ctx.fillStyle = "#e0812a";
  roundRect(ctx, barX, barY, Math.max(barH, (barW * pct) / 100), barH, 14);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 30px sans-serif";
  ctx.fillText(pct + "%", barX + barW - 90, barY - 14);

  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.font = "italic 24px sans-serif";
  ctx.fillText("oaklandzoo.org trading cards", 60, 590);

  return { canvas, ownedTotal, total };
}

function updateShareImagePreview() {
  const { canvas, ownedTotal, total } = renderShareImage();
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (shareImageBlobUrl) URL.revokeObjectURL(shareImageBlobUrl);
    shareImageBlobUrl = URL.createObjectURL(blob);
    shareImagePreview.src = shareImageBlobUrl;
    shareImageDownloadBtn.href = shareImageBlobUrl;
    shareImageDownloadBtn.download = "oakland-zoo-cards-" + ownedTotal + "-of-" + total + ".png";
    shareImageShareBtn.hidden = !(navigator.share && navigator.canShare);
  }, "image/png");
}

shareImageShareBtn.addEventListener("click", async () => {
  const { canvas, ownedTotal, total } = renderShareImage();
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      const file = new File([blob], "oakland-zoo-cards.png", { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return;
      await navigator.share({
        files: [file],
        title: "Oakland Zoo Card Checklist",
        text: "I've got " + ownedTotal + "/" + total + " Oakland Zoo trading cards!",
      });
    } catch (err) {
      // User cancelled, or sharing files isn't actually supported — the
      // Download button next to it is always a working fallback.
      if (err && err.name !== "AbortError") console.warn("Image share failed:", err);
    }
  }, "image/png");
});

// --- modal open/close ------------------------------------------------------

async function openShareModal() {
  await waitForCardData();
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  shareDiffWrap.hidden = true;
  shareDiffList.innerHTML = "";
  shareDiffSummary.textContent = "";
  shareApplyStatus.textContent = "";
  shareLinkInput.value = buildShareUrl(hooks.getOwnedSnapshot());
  shareNativeBtn.hidden = !navigator.share;
  updateShareImagePreview();
  shareModalOverlay.hidden = false;
}

function closeShareModal() {
  shareModalOverlay.hidden = true;
}

shareBtn.addEventListener("click", openShareModal);
shareCloseBtn.addEventListener("click", closeShareModal);
shareModalOverlay.addEventListener("click", (e) => {
  if (e.target === shareModalOverlay) closeShareModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !shareModalOverlay.hidden) closeShareModal();
});

shareCopyBtn.addEventListener("click", async () => {
  const text = shareLinkInput.value;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (err) {
    try {
      shareLinkInput.select();
      copied = document.execCommand("copy");
    } catch (err2) {
      copied = false;
    }
  }
  const original = shareCopyBtn.textContent;
  shareCopyBtn.textContent = copied ? "Copied!" : "Select & copy";
  setTimeout(() => (shareCopyBtn.textContent = original), 1500);
});

shareNativeBtn.addEventListener("click", async () => {
  try {
    await navigator.share({
      title: "Oakland Zoo Card Checklist",
      text: "Here's my Oakland Zoo trading card collection — open this to compare with yours.",
      url: shareLinkInput.value,
    });
  } catch (err) {
    if (err && err.name !== "AbortError") console.warn("Link share failed:", err);
  }
});

// If this page was opened from someone else's share link, surface the diff
// immediately rather than making them dig for the Share button themselves.
async function checkUrlForIncomingShare() {
  const code = new URLSearchParams(location.search).get("share");
  if (!code) return;
  history.replaceState(null, "", location.pathname + location.hash);
  await openShareModal();
  shareImportInput.value = code;
  await runCompare();
}

checkUrlForIncomingShare();
