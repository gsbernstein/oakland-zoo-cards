// Shared by brag.js and sync.js: draws the same "X/Y cards collected"
// progress snapshot canvas either can attach to a share (Brag's own
// image, or as a visual riding along with Sync's copy-to-clipboard).
// Pure/no DOM side effects beyond building the canvas.
//
// 4:3 (1200x900), between the two extremes tried before: the original
// 1200x630 widescreen got zoomed/cropped hard by iMessage's bubble
// thumbnail (cutting off the title/logo/footer, leaving only the big
// number), while a full 1080x1080 square rendered taller than it needed
// to be. Every element stays centered so there's no edge to clip even if
// some destination still crops slightly.

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

  const WIDTH = 1200;
  const HEIGHT = 900;
  const midX = WIDTH / 2;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#1f6b3a");
  gradient.addColorStop(1, "#164f2b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#e9dfc9";
  ctx.beginPath();
  ctx.arc(1010, 120, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(160, 800, 230, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#ffffff";
  ctx.font = "120px sans-serif";
  ctx.fillText("🦁", midX, 175);

  ctx.font = "700 60px sans-serif";
  ctx.fillText("Oakland Zoo", midX, 260);
  ctx.fillText("Card Checklist", midX, 325);

  ctx.font = "700 165px sans-serif";
  ctx.fillText(ownedTotal + "/" + total, midX, 520);

  ctx.fillStyle = "#e0812a";
  ctx.font = "600 50px sans-serif";
  ctx.fillText("cards collected", midX, 590);

  const barW = 1000;
  const barH = 40;
  const barX = midX - barW / 2;
  const barY = 665;
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  roundRect(ctx, barX, barY, barW, barH, 20);
  ctx.fill();
  ctx.fillStyle = "#e0812a";
  roundRect(ctx, barX, barY, Math.max(barH, (barW * pct) / 100), barH, 20);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 40px sans-serif";
  ctx.fillText(pct + "%", midX, barY - 18);

  // Baked into the image itself (not just a share sheet's url field) so
  // the invite survives even a plain re-shared/downloaded copy.
  const siteUrl = buildSiteUrl();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = "italic 32px sans-serif";
  ctx.fillText("Make your own: " + siteUrl.host + siteUrl.pathname, midX, 855);

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
