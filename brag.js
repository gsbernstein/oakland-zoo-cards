// "Brag About Your Progress": a shareable snapshot image plus a link to the
// site itself — deliberately separate from sync.js's "Copy my collection"
// link, which carries your actual card counts. This one carries none of
// that; the link here always points at the bare site with no query string,
// so it's safe to post anywhere.
import { renderSnapshotCanvas, copyImageAndText } from "./snapshot-image.js?v=5";

const bragBtn = document.getElementById("bragBtn");
const bragModalOverlay = document.getElementById("bragModalOverlay");
const bragCloseBtn = document.getElementById("bragCloseBtn");
const bragImagePreview = document.getElementById("bragImagePreview");
const bragCopyBtn = document.getElementById("bragCopyBtn");
const bragImageShareBtn = document.getElementById("bragImageShareBtn");

let bragImageBlobUrl = null;

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

async function updateBragImagePreview() {
  const { canvas } = await renderSnapshotCanvas();
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (bragImageBlobUrl) URL.revokeObjectURL(bragImageBlobUrl);
    bragImageBlobUrl = URL.createObjectURL(blob);
    bragImagePreview.src = bragImageBlobUrl;
    bragImageShareBtn.hidden = !(navigator.share && navigator.canShare);
  }, "image/png");
}

bragCopyBtn.addEventListener("click", async () => {
  const { canvas, siteUrl } = await renderSnapshotCanvas();
  const url = siteUrl.toString();
  const rich = await copyImageAndText(canvas, url);
  let copied = rich;
  if (!rich) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (err) {
      copied = false;
    }
  }
  const original = bragCopyBtn.textContent;
  bragCopyBtn.textContent = copied ? "Copied!" : "Copy failed";
  setTimeout(() => (bragCopyBtn.textContent = original), 1500);
});

bragImageShareBtn.addEventListener("click", async () => {
  const { canvas, ownedTotal, total, siteUrl } = await renderSnapshotCanvas();
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      const file = new File([blob], "oakland-zoo-cards.png", { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return;
      await navigator.share({
        files: [file],
        title: "Oakland Zoo Card Checklist",
        text: "I've got " + ownedTotal + "/" + total + " Oakland Zoo trading cards!",
        url: siteUrl.toString(),
      });
    } catch (err) {
      // User cancelled, or sharing files isn't actually supported — Copy
      // next to it is always a working fallback.
      if (err && err.name !== "AbortError") console.warn("Image share failed:", err);
    }
  }, "image/png");
});

async function openBragModal() {
  await waitForCardData();
  if (!window.__oaklandZooChecklist) return;
  updateBragImagePreview();
  bragModalOverlay.hidden = false;
}

function closeBragModal() {
  bragModalOverlay.hidden = true;
}

bragBtn.addEventListener("click", openBragModal);
bragCloseBtn.addEventListener("click", closeBragModal);
bragModalOverlay.addEventListener("click", (e) => {
  if (e.target === bragModalOverlay) closeBragModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !bragModalOverlay.hidden) closeBragModal();
});
