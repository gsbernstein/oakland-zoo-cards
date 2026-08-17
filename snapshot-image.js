// Shared by brag.js and sync.js: draws the same "X/Y cards collected"
// progress snapshot canvas either can attach to a share (Brag's own
// image, or as a visual riding along with Sync's copy-to-clipboard).
// Pure/no DOM side effects beyond building the canvas.

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The general, no-query link to the site itself (never the personal
// "?share=" sync link) — this is what gets baked into the image, so
// re-sharing just the image still points people here rather than nowhere.
export function buildSiteUrl() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.slice(0, -"index.html".length);
  }
  return url;
}

export function renderSnapshotCanvas() {
  const sets = window.OAKLAND_ZOO_CARD_SETS || [];
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

  // Baked into the image itself (not just a share sheet's url field) so
  // the invite survives even a plain re-shared/downloaded copy.
  const siteUrl = buildSiteUrl();
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.font = "italic 24px sans-serif";
  ctx.fillText("Make your own: " + siteUrl.host + siteUrl.pathname, 60, 590);

  return { canvas, ownedTotal, total, siteUrl };
}

// Attempts to write both an image and text to the clipboard as two
// representations of one clipboard item — the richest one the paste
// destination supports "wins" (an image-aware app like Notes/Mail/Slack
// typically pastes the photo; a plain text field gets the text). Returns
// true if the rich write succeeded, false if the browser doesn't support
// it (caller should fall back to a text-only copy).
export async function copyImageAndText(canvas, text) {
  if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) return false;
  const blobPromise = new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blobPromise,
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch (err) {
    console.warn("Rich clipboard write failed, falling back to text-only:", err);
    return false;
  }
}
