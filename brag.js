// "Brag About Your Progress": a shareable snapshot image plus a link to the
// site itself — deliberately separate from sync.js's "Copy my collection"
// link, which carries your actual card counts. This one carries none of
// that; the link here always points at the bare site with no query string,
// so it's safe to post anywhere.
const bragBtn = document.getElementById("bragBtn");
const bragModalOverlay = document.getElementById("bragModalOverlay");
const bragCloseBtn = document.getElementById("bragCloseBtn");
const bragImagePreview = document.getElementById("bragImagePreview");
const bragImageDownloadBtn = document.getElementById("bragImageDownloadBtn");
const bragImageShareBtn = document.getElementById("bragImageShareBtn");
const bragSiteLink = document.getElementById("bragSiteLink");

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

// The general, no-query link to the site itself (never the personal
// "?share=" sync link) — this is what gets baked into the image and passed
// to the share sheet, so re-sharing just the image still points people
// here rather than nowhere.
function buildSiteUrl() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.slice(0, -"index.html".length);
  }
  return url;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderBragImage() {
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

  // Baked into the image itself (not just the share sheet's url field) so
  // the invite survives even a plain re-shared/downloaded copy.
  const siteUrl = buildSiteUrl();
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.font = "italic 24px sans-serif";
  ctx.fillText("Make your own: " + siteUrl.host + siteUrl.pathname, 60, 590);

  return { canvas, ownedTotal, total, siteUrl };
}

function updateBragImagePreview() {
  const { canvas, ownedTotal, total, siteUrl } = renderBragImage();
  bragSiteLink.href = siteUrl.toString();
  bragSiteLink.textContent = siteUrl.host + siteUrl.pathname;
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (bragImageBlobUrl) URL.revokeObjectURL(bragImageBlobUrl);
    bragImageBlobUrl = URL.createObjectURL(blob);
    bragImagePreview.src = bragImageBlobUrl;
    bragImageDownloadBtn.href = bragImageBlobUrl;
    bragImageDownloadBtn.download = "oakland-zoo-cards-" + ownedTotal + "-of-" + total + ".png";
    bragImageShareBtn.hidden = !(navigator.share && navigator.canShare);
  }, "image/png");
}

bragImageShareBtn.addEventListener("click", async () => {
  const { canvas, ownedTotal, total, siteUrl } = renderBragImage();
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
      // User cancelled, or sharing files isn't actually supported — the
      // Download button next to it is always a working fallback.
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
