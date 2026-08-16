// Fuzzy-matches noisy OCR text against the known card list. Pure/dependency-
// free so it's usable both from the browser (scan.js) and from a plain Node
// test harness with no DOM or OCR involved.

export function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(str) {
  return normalize(str)
    .split(" ")
    .filter((t) => t.length > 1);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
      );
    }
    prev = row;
  }
  return prev[b.length];
}

// 0 (no relation) .. 1 (identical), tolerant of a handful of misread
// characters — exactly what a noisy OCR pass on a small printed word tends
// to produce.
export function tokenSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// Any digit-based hints in the OCR text that might be this card's collector
// number: "18 of 100", "18/100", "#18", or a bare small number.
export function extractNumberHints(text) {
  const hints = new Set();
  const patterns = [/(\d{1,3})\s*(?:of|\/)\s*100/gi, /#\s*(\d{1,3})\b/g];
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(text))) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 100) hints.add(n);
    }
  });
  return hints;
}

// Score a single card's name against the OCR text's tokens (0..1), plus a
// bonus if a detected number hint matches the card's own collector number.
export function scoreCard(card, ocrTokens, numberHints) {
  const nameTokens = tokenize(card.name);
  if (!nameTokens.length) return 0;

  let total = 0;
  nameTokens.forEach((nameToken) => {
    let best = 0;
    ocrTokens.forEach((ocrToken) => {
      const sim = tokenSimilarity(nameToken, ocrToken);
      if (sim > best) best = sim;
    });
    total += best;
  });
  let score = total / nameTokens.length;

  if (card.number != null && numberHints.has(card.number)) {
    score = Math.min(1, score + 0.25);
  }

  return score;
}

// Ranks every card in `sets` against raw OCR `text`. Returns the top
// `limit` matches with score > `minScore`, sorted best-first.
export function matchCards(sets, text, { limit = 5, minScore = 0.45 } = {}) {
  const ocrTokens = tokenize(text);
  const numberHints = extractNumberHints(text);
  if (!ocrTokens.length) return [];

  const results = [];
  sets.forEach((set) => {
    set.cards.forEach((card) => {
      const score = scoreCard(card, ocrTokens, numberHints);
      if (score > minScore) results.push({ setId: set.id, setName: set.name, card, score });
    });
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
