# Vendored Tesseract.js (self-hosted, no CDN)

Used by the "Scan a Card" feature for client-side OCR. Vendored instead of
loaded from a CDN so the feature has zero runtime third-party dependency —
consistent with the rest of this project only ever depending on
oaklandzoo.org's own live API as a best-effort enhancement, never as a hard
requirement.

## What's here

- `tesseract.min.js`, `worker.min.js` — from the `tesseract.js` npm package
  (v5.1.1, Apache-2.0).
- `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` — from the
  `tesseract.js-core` npm package (v5.1.1, Apache-2.0). Each `.wasm.js` file
  embeds its wasm binary as an inline base64 data URI, so the plain `.wasm`
  files that `tesseract.js-core` also ships are redundant here and were
  intentionally not copied. Both the SIMD and non-SIMD builds are kept —
  Tesseract.js feature-detects and picks whichever the browser supports.
- `lang-data/eng.traineddata.gz` — from the `@tesseract.js-data/eng` npm
  package (v1.0.0, MIT), the `4.0.0_best_int` variant (LSTM-optimized, the
  smallest of the variants that ships — 2.9MB vs ~11MB for the non-`_int`
  "best" model). Plenty accurate for printed card text at this resolution.

## Updating

```
npm install tesseract.js@latest tesseract.js-core@latest @tesseract.js-data/eng@latest --prefix /tmp/tess-update
cp /tmp/tess-update/node_modules/tesseract.js/dist/{tesseract,worker}.min.js .
cp /tmp/tess-update/node_modules/tesseract.js-core/tesseract-core{,-simd}-lstm.wasm.js .
cp /tmp/tess-update/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz lang-data/
```

Bump the `?v=` on `scan.js`'s script tag in `index.html` after any change here
(same cache-busting convention as the rest of the site) — the worker/core
paths themselves aren't versioned, so a stale cached copy of these files
could otherwise linger after an update.
