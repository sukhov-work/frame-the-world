/**
 * SKY search — pure fuzzy ranking over a flat target index (ASTRO ENGINE phase A).
 *
 * Requirement 2 of the owner ask: "advanced — good suggestions for crude/misspelled queries."
 * The grammar this must handle for free (each row is one normalized KEY on some entry):
 *   `M31` · `messier 31` · `NGC 224` · `andromeda` · `jupiter` · `10P` · `orion nebula`
 * Matching: normalize (case / diacritics / collapsed spacing) → tier by exact / prefix /
 * token-prefix / substring / Damerau-Levenshtein ≤ 2 → break ties by fame+brightness `boost`
 * (a named Messier outranks an anonymous globular; a planet outranks both).
 *
 * Pure and DOM-free — unit-tested directly. The index itself is built in `catalog.ts` and
 * lazy-loaded on the first SKY interaction (never in the boot chunk — the 14-island lesson).
 */

import type { TargetKind } from "../ephemeris/targets";

export interface SkyIndexEntry {
  /** Target id resolvable by `catalog.targetById` — `planet:mars` · `comet:10P` · `dso:M31`. */
  id: string;
  /** Display name for the result row. */
  name: string;
  /** Second line of the row: type · constellation · magnitude. */
  detail: string;
  kind: TargetKind;
  /** Pre-normalized search keys (name + aliases + space-stripped catalog ids). */
  keys: string[];
  /** Catalog/typical visual magnitude — display only (planets vary; the row says so). */
  mag: number | null;
  /** Fame + brightness prior, 0..1 — the tie-breaker between equal text matches. */
  boost: number;
}

/** Greek letters spelled out — `α lyr` and `alpha lyr` must be the same key. */
const GREEK: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "epsilon",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ι: "iota",
  κ: "kappa",
  λ: "lambda",
  μ: "mu",
  ν: "nu",
  ξ: "xi",
  ο: "omicron",
  π: "pi",
  ρ: "rho",
  σ: "sigma",
  τ: "tau",
  υ: "upsilon",
  φ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
};

/** Lowercase, strip diacritics, spell out greek, collapse whitespace. */
export function normalizeSky(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[α-ω]/g, (c) => GREEK[c] ?? c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Optimal-string-alignment (Damerau-Levenshtein with adjacent transposition) capped at `max` —
 * bails early so a long key against a short query costs almost nothing.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let d = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1; // the whole row exceeded the cap — no path back under it
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Match quality of one query against one key — the tier ladder, 0 = no match. */
function keyScore(q: string, qCompact: string, key: string): number {
  if (key === q || key.replace(/ /g, "") === qCompact) return 100;
  if (key.startsWith(q)) return 82 - Math.min(12, key.length - q.length);
  if (key.replace(/ /g, "").startsWith(qCompact)) return 78 - Math.min(12, key.length - q.length);
  const tokens = key.split(" ");
  if (tokens.some((t) => t.startsWith(q))) return 62;
  if (key.includes(q)) return 50;
  if (q.length >= 4) {
    // Typos: whole-key first, then per-token — "andromedia" must still find "andromeda galaxy".
    const dKey = editDistance(q, key.length > q.length + 2 ? key.slice(0, q.length + 2) : key);
    const dTok = Math.min(...tokens.map((t) => editDistance(q, t)));
    const d = Math.min(dKey, dTok);
    if (d <= 2) return 40 - d * 8;
  }
  return 0;
}

/** Rank the index against a query — top `limit`, best first; empty when nothing clears 0. */
export function searchSky(
  index: readonly SkyIndexEntry[],
  query: string,
  limit = 8,
): SkyIndexEntry[] {
  const q = normalizeSky(query);
  if (!q) return [];
  const qCompact = q.replace(/ /g, "");
  const scored: Array<{ e: SkyIndexEntry; s: number }> = [];
  for (const e of index) {
    let best = 0;
    for (const key of e.keys) {
      const s = keyScore(q, qCompact, key);
      if (s > best) best = s;
      if (best >= 100) break;
    }
    if (best > 0) scored.push({ e, s: best + e.boost * 10 });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}

/** Does a query look like a small-body designation worth a JPL SBDB round-trip? Lives here
 *  (boot-safe, pure) so the finder can consult it without pulling the sbdb module. */
export function looksLikeSmallBody(query: string): boolean {
  const q = query.trim();
  return (
    /^[cpdai]\/\d{4}\s?[a-z]+\d*(-[a-z])?$/i.test(q) || // C/2023 A3 · P/2016 BA14
    /^\d{4}\s?[a-z]{2}\d*$/i.test(q) || // 2024 YR4 (provisional)
    /^\d+[pP]$/.test(q) || // 73P
    /^\(?\d{1,7}\)?(\s+[a-z][a-z' -]+)?$/i.test(q) // 433 · (99942) · 99942 apophis
  );
}

/** Kind glyph for result rows + the panel pill — the one place the mapping lives. */
export function kindGlyph(kind: TargetKind): string {
  switch (kind) {
    case "sun":
      return "☀";
    case "planet":
      return "◉";
    case "moon":
      return "☾";
    case "star":
      return "✦";
    case "comet":
      return "☄";
    case "asteroid":
      return "◆";
    case "galaxy":
      return "❍";
    case "nebula":
      return "❋";
    case "cluster":
      return "⁘";
    case "constellation":
      return "✶";
    case "shower":
      return "☄";
    default:
      return "•";
  }
}
