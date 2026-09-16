/**
 * The map SCALE BAR (owner 2026-09-16: "a subtle but readable scale bar for the user to
 * understand current map scale and distances") — the classic cartographic instrument: pick the
 * largest 1 · 2 · 5 × 10ⁿ ground distance whose bar fits in `maxPx`, draw a bar exactly that
 * many pixels wide, label it. Pure, so both the /m 2D globe map (metres-per-pixel from the
 * camera mirror) and the MapWindow chart (metres-per-pixel from web-mercator zoom) share ONE
 * rounding rule and read identically.
 */

export interface ScaleBar {
  /** Ground distance the bar spans (m). */
  meters: number;
  /** Bar width (CSS px) — `meters / mPerPx`, ≤ `maxPx` by construction. */
  px: number;
  /** `500 m` · `2 km` · `1 000 km` (the mono readout grammar; thin space as thousands mark). */
  label: string;
}

const STEPS = [1, 2, 5] as const;

/** The largest 1/2/5×10ⁿ metre distance whose bar fits in `maxPx` at `mPerPx` metres per CSS
 *  pixel; null when the scale is unknown (non-finite / non-positive) — the bar hides then. */
export function scaleBarFor(mPerPx: number, maxPx = 120): ScaleBar | null {
  if (!Number.isFinite(mPerPx) || !(mPerPx > 0) || !(maxPx > 0)) return null;
  const maxM = mPerPx * maxPx;
  // Work in the decade at or below maxM and walk the 1/2/5 ladder down to the first that fits.
  let exp = Math.floor(Math.log10(maxM));
  for (let guard = 0; guard < 40; guard++, exp--) {
    const base = 10 ** exp;
    for (let i = STEPS.length - 1; i >= 0; i--) {
      const m = STEPS[i] * base;
      if (m <= maxM) return { meters: m, px: m / mPerPx, label: formatScaleMeters(m) };
    }
  }
  return null;
}

/** `250 m` under a kilometre, `2 km` / `2.5 km` / `1 000 km` above — no unit switch inside the
 *  bar's own decade (the 1/2/5 ladder only ever produces one significant digit, or `2.5`). */
export function formatScaleMeters(m: number): string {
  if (m < 1000) return `${trimNum(m)} m`;
  return `${groupThousands(trimNum(m / 1000))} km`;
}

/** Drop float noise (`0.1 + 0.2`) and trailing zeros: `2.5`, `250`, `1000`. */
function trimNum(v: number): string {
  return String(Number(v.toPrecision(6)));
}

/** `1000` → `1 000` (U+2009 thin space — the mono readouts' thousands mark). */
function groupThousands(s: string): string {
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${grouped}.${frac}` : grouped;
}
