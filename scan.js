// "Scan a Card": client-side OCR (self-hosted Tesseract.js, see
// vendor/tesseract/README.md — no CDN, nothing uploaded anywhere) fuzzy-
// matched against the known card list, since the cache includes grayscale/
// obscured "Unavailable" placeholders and some cards have no photo at all —
// image matching wouldn't work here, but text matching doesn't care.
import { matchCards } from "./card-matcher.js?v=1";

const scanBtn = document.getElementById("scanBtn");
const scanModalOverlay = document.getElementById("scanModalOverlay");
const scanCloseBtn = document.getElementById("scanCloseBtn");
const scanFileInput = document.getElementById("scanFileInput");
const scanPreviewWrap = document.getElementById("scanPreviewWrap");
const scanPreviewImage = document.getElementById("scanPreviewImage");
const scanStatus = document.getElementById("scanStatus");
const scanResults = document.getElementById("scanResults");

let tesseractLoadPromise = null;
function loadTesseractScript() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/tesseract/tesseract.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load vendor/tesseract/tesseract.min.js"));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

// Created lazily on first scan, then reused for every scan after — spinning
// up the worker (loading the wasm core + language data) takes a couple of
// seconds, not worth repeating per photo.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = loadTesseractScript().then(() =>
      window.Tesseract.createWorker("eng", 1, {
        workerPath: "vendor/tesseract/worker.min.js",
        corePath: "vendor/tesseract/",
        langPath: "vendor/tesseract/lang-data",
        gzip: true,
      })
    );
  }
  return workerPromise;
}

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

function resetScanUI() {
  scanPreviewWrap.hidden = true;
  scanPreviewImage.src = "";
  scanStatus.textContent = "";
  scanResults.innerHTML = "";
  scanFileInput.value = "";
}

function openScanModal() {
  resetScanUI();
  scanModalOverlay.hidden = false;
  // Warm the worker up in the background as soon as the modal opens, so
  // it's more likely already ready by the time a photo comes in.
  getWorker().catch(() => {
    /* surfaced properly when a scan is actually attempted */
  });
}

function closeScanModal() {
  scanModalOverlay.hidden = true;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderResults(matches) {
  scanResults.innerHTML = "";
  if (!matches.length) {
    scanStatus.textContent = "No confident match — try a closer, well-lit photo of the card's name.";
    return;
  }
  scanStatus.textContent = `Found ${matches.length} possible match${matches.length === 1 ? "" : "es"}:`;
  matches.forEach((m) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scan-result-item";
    btn.innerHTML = `
      <img class="scan-result-thumb" src="${m.card.image || ""}" alt="" />
      <span class="scan-result-info">
        <span class="scan-result-name">${escapeHtml(m.card.name)}</span><br />
        <span class="scan-result-set">${escapeHtml(m.setName)}${m.card.number != null ? " · #" + m.card.number : ""}</span>
      </span>
      <span class="scan-result-score">${Math.round(m.score * 100)}%</span>
    `;
    btn.addEventListener("click", () => {
      const opened = window.__oaklandZooChecklist && window.__oaklandZooChecklist.openCardByKey(m.setId, m.card.name);
      if (opened) closeScanModal();
    });
    li.appendChild(btn);
    scanResults.appendChild(li);
  });
}

async function handleFile(file) {
  if (!file) return;
  scanPreviewImage.src = URL.createObjectURL(file);
  scanPreviewWrap.hidden = false;
  scanResults.innerHTML = "";
  scanStatus.textContent = "Loading the on-device text reader…";

  let worker;
  try {
    worker = await getWorker();
  } catch (err) {
    console.error("Scan a Card: OCR engine failed to load:", err);
    scanStatus.textContent = "Couldn't load the OCR engine — try reloading the page.";
    return;
  }

  scanStatus.textContent = "Reading text…";
  let text;
  try {
    const result = await worker.recognize(file);
    text = (result && result.data && result.data.text) || "";
  } catch (err) {
    console.error("Scan a Card: recognition failed:", err);
    scanStatus.textContent = "Couldn't read that photo — try again with better lighting.";
    return;
  }

  const sets = await waitForCardData();
  const matches = matchCards(sets, text, { limit: 5 });
  renderResults(matches);
}

scanBtn.addEventListener("click", openScanModal);
scanCloseBtn.addEventListener("click", closeScanModal);
scanModalOverlay.addEventListener("click", (e) => {
  if (e.target === scanModalOverlay) closeScanModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !scanModalOverlay.hidden) closeScanModal();
});
scanFileInput.addEventListener("change", (e) => handleFile(e.target.files && e.target.files[0]));
