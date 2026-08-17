// "Copy My Collection": encodes your owned counts into a link/code. The
// receiving side (import.js) is a dedicated modal, not a section tacked
// onto this one — this file only builds/copies/sends the link, plus a
// thin entry point that hands a pasted link/code off to import.js.
import { renderSnapshotCanvas, copyImageAndText } from "./snapshot-image.js?v=5";

const syncBtn = document.getElementById("syncBtn");
const syncModalOverlay = document.getElementById("syncModalOverlay");
const syncCloseBtn = document.getElementById("syncCloseBtn");
const syncLinkInput = document.getElementById("syncLinkInput");
const syncCopyBtn = document.getElementById("syncCopyBtn");
const syncNativeBtn = document.getElementById("syncNativeBtn");
const syncImportInput = document.getElementById("syncImportInput");
const syncCompareBtn = document.getElementById("syncCompareBtn");

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

// UTF-8-safe, URL-safe base64 (no padding) so the code can travel either
// as a bare string or as a "?share=" query value with no extra escaping.
function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

async function openSyncModal() {
  await waitForCardData();
  const hooks = window.__oaklandZooChecklist;
  if (!hooks) return;
  syncImportInput.value = "";
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
  // Attach the same progress snapshot Brag uses (aggregate totals only, no
  // per-card specifics) so pasting into an image-aware app (Notes, Mail,
  // Slack) carries a visual alongside the link — the exact per-card counts
  // that make this link actually sync-able still travel only in the text.
  const { canvas } = await renderSnapshotCanvas();
  let copied = await copyImageAndText(canvas, text);
  if (!copied) {
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

// Pasting a link/code here and hitting Compare hands off to the dedicated
// Import modal (import.js) rather than expanding a diff inline in this
// one — same destination an incoming "?share=" link opens directly into.
syncCompareBtn.addEventListener("click", () => {
  const code = extractShareCode(syncImportInput.value);
  if (!code) {
    syncImportInput.focus();
    return;
  }
  if (!window.__oaklandZooImport) return;
  closeSyncModal();
  window.__oaklandZooImport.openWithCode(code);
});
