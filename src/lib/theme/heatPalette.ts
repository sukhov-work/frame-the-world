import { tokens } from "./tokens";

/**
 * BEST SPOT heat ramps (SPEC_V2 §6.1) — the score sheet's colour scale, assembled the way
 * `findPalette.ts` assembles the FIND wheel: every stop carries BOTH faces, so the DOM legend
 * swatch (`css`) and the GL LUT (`gl`) provably cannot drift apart (ADR D14 — no colour literal
 * lives outside `src/styles/tokens.css` and its bridge `tokens.ts`).
 *
 * The ramp is the ONE documented exception to the house no-rainbow rule, and INFERNO earns it by
 * being read through LIGHTNESS rather than hue memory: it is strictly monotone in OKLab L over all
 * 11 stops, so "brighter = better" holds over a photographic basemap and for every kind of colour
 * vision. TURBO is a chip-gated A/B *because it is not* — its lightness peaks in the middle of the
 * scale, which puts the best spot in dark red. `test/lib/theme/heatPalette.test.ts` asserts both
 * facts, so the two ramps can never be quietly swapped.
 *
 * Pure data + arithmetic: no `three`, no DOM. `tuning.ts` names a ramp by id, never by colour.
 */

export interface HeatStop {
  /** CSS custom-property reference — the legend / swatch face. */
  css: string;
  /** Hex from the GL token bridge — the LUT face. */
  gl: string;
}

/** The shipping ramp: monotone in OKLab L (0.0482 → 0.9777, min adjacent ΔL 0.0779). */
export const HEAT_INFERNO: readonly HeatStop[] = [
  { css: "var(--color-heat-0)", gl: tokens.heat0 }, // t 0.0 — near-black floor
  { css: "var(--color-heat-1)", gl: tokens.heat1 }, // t 0.1 — deep indigo
  { css: "var(--color-heat-2)", gl: tokens.heat2 }, // t 0.2 — violet
  { css: "var(--color-heat-3)", gl: tokens.heat3 }, // t 0.3 — plum
  { css: "var(--color-heat-4)", gl: tokens.heat4 }, // t 0.4 — magenta
  { css: "var(--color-heat-5)", gl: tokens.heat5 }, // t 0.5 — crimson
  { css: "var(--color-heat-6)", gl: tokens.heat6 }, // t 0.6 — ember red
  { css: "var(--color-heat-7)", gl: tokens.heat7 }, // t 0.7 — orange
  { css: "var(--color-heat-8)", gl: tokens.heat8 }, // t 0.8 — amber
  { css: "var(--color-heat-9)", gl: tokens.heat9 }, // t 0.9 — gold
  { css: "var(--color-heat-10)", gl: tokens.heat10 }, // t 1.0 — pale straw peak
] as const;

/** The A/B chip's rainbow: NOT monotone in lightness — the top of the scale goes dark red. */
export const HEAT_TURBO: readonly HeatStop[] = [
  { css: "var(--color-heat-alt-0)", gl: tokens.heatAlt0 }, // t 0.0 — indigo
  { css: "var(--color-heat-alt-1)", gl: tokens.heatAlt1 }, // t 0.1 — blue
  { css: "var(--color-heat-alt-2)", gl: tokens.heatAlt2 }, // t 0.2 — azure
  { css: "var(--color-heat-alt-3)", gl: tokens.heatAlt3 }, // t 0.3 — cyan
  { css: "var(--color-heat-alt-4)", gl: tokens.heatAlt4 }, // t 0.4 — spring green
  { css: "var(--color-heat-alt-5)", gl: tokens.heatAlt5 }, // t 0.5 — chartreuse (lightness peak)
  { css: "var(--color-heat-alt-6)", gl: tokens.heatAlt6 }, // t 0.6 — yellow
  { css: "var(--color-heat-alt-7)", gl: tokens.heatAlt7 }, // t 0.7 — amber
  { css: "var(--color-heat-alt-8)", gl: tokens.heatAlt8 }, // t 0.8 — orange
  { css: "var(--color-heat-alt-9)", gl: tokens.heatAlt9 }, // t 0.9 — red
  { css: "var(--color-heat-alt-10)", gl: tokens.heatAlt10 }, // t 1.0 — dark maroon
] as const;

/**
 * THE SHORTLIST-MARKER RAMP (owner batch 2026-08-26, item 2) — five stops, and it is deliberately
 * NOT one of the two above.
 *
 * The markers used to be one flat `tokens.accent` cyan, with the docstring's reasoning that "the
 * sheet under the marker already encodes the score". The owner overruled that: a shortlist of eight
 * that all look identical carries no ranking at a glance. But re-using INFERNO for the markers is
 * the wrong repair twice over:
 *  · a marker painted its own cell's colour is *invisible* against its own cell, and
 *  · the top-K live at the BOTTOM of the absolute display window in a real disc (a dense-Dnipro
 *    pedestrian best measured 0.381 against `displayHi` 0.9, i.e. ramp t ≈ 0.31), so all eight
 *    would come out inside INFERNO's near-black-to-violet foot — darker than the sheet they sit on.
 *
 * So the markers get their own scale, chosen against three constraints:
 *  1. **Monotone in OKLab L** (0.7610 → 0.9668, min adjacent ΔL 0.0292) — the INFERNO discipline:
 *     brighter = better, readable without hue memory. `heatPalette.test.ts` asserts it.
 *  2. **Bright everywhere.** The dimmest stop is lighter than INFERNO's brightest, so a marker
 *     always reads AS a marker over its own sheet cell rather than melting into it.
 *  3. **No `tokens.accent`.** Cyan is the app's reserved signal ink and it is what the owner asked
 *     to move away from; the arc goes lavender → ice → mint → sun-glow → sun-core instead, which is
 *     the PIN family (these are places) walking into the sun family (the event).
 *
 * It is driven by SHORTLIST-RELATIVE quality (`score ÷ the best of the eight`) — the same quantity
 * the panel row's bar has always drawn — precisely so the range is always visible. §3.5 is not
 * weakened by that: the ABSOLUTE score still rides beside it on the row and in the marker's hover
 * tip, and the marker's *vividness* is driven by the absolute display t, so an all-bad disc's eight
 * markers are washed out rather than triumphant.
 */
export const HEAT_SPOTS: readonly HeatStop[] = [
  { css: "var(--color-pin-lavender)", gl: tokens.pinLavender }, // q 0.00 — the eighth-best
  { css: "var(--color-pin-ice)", gl: tokens.pinIce }, // q 0.25
  { css: "var(--color-pin-mint)", gl: tokens.pinMint }, // q 0.50
  { css: "var(--color-sun-glow)", gl: tokens.sunGlow }, // q 0.75
  { css: "var(--color-sun-core)", gl: tokens.sunCore }, // q 1.00 — stand HERE
] as const;

/**
 * Where a shortlist-relative quality lands on `HEAT_SPOTS`: the two stops it sits BETWEEN and how
 * far along. Pure; clamps, and treats a non-finite input as the bottom of the scale (an empty
 * shortlist divides by zero upstream, and a NaN in a vertex attribute is a silently black marker).
 *
 * It exists so the DOM swatch and the GL marker cannot drift: BOTH interpolate, both between the
 * same pair, both by the same t, and both in **sRGB** — `color-mix(in srgb, …)` on one side and a
 * byte lerp on the other. (Lerping two `THREE.Color`s instead would blend in the LINEAR working
 * space and land on a different colour than the swatch beside it.)
 */
export function spotQualityStops(q: number): { lo: HeatStop; hi: HeatStop; t: number } {
  const c = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 0));
  const x = c * (HEAT_SPOTS.length - 1);
  const i = Math.min(HEAT_SPOTS.length - 2, Math.floor(x));
  return { lo: HEAT_SPOTS[i], hi: HEAT_SPOTS[i + 1], t: x - i };
}

/**
 * The marker ramp's DOM face at a shortlist-relative quality 0..1 — one door, so the row swatch and
 * the GL marker cannot drift.
 *
 * CONTINUOUS, not the nearest of five stops, and that is a measured requirement rather than
 * polish: a real Dnipro shortlist measured `score ÷ best` spanning 1.000 → 0.802, which snapping
 * collapsed onto just **two** of the five stops — six markers identical, two identical, which is
 * most of the way back to the one flat colour the owner asked to be rid of. `color-mix` keeps every
 * face a token reference, so D14 holds.
 */
export function spotQualityCss(q: number): string {
  const { lo, hi, t } = spotQualityStops(q);
  if (t <= 0.001) return lo.css;
  if (t >= 0.999) return hi.css;
  return `color-mix(in srgb, ${hi.css} ${Math.round(t * 100)}%, ${lo.css})`;
}

/** …and its GL face: the same pair, the same t, lerped over sRGB BYTES so the two agree. Returns
 *  an `#RRGGBB` string, which is what `THREE.Color.set` takes. Pure. */
export function spotQualityGl(q: number): string {
  const { lo, hi, t } = spotQualityStops(q);
  const a = hexToRgb(lo.gl);
  const b = hexToRgb(hi.gl);
  return (
    "#" +
    [0, 1, 2]
      .map((k) =>
        Math.round(a[k] + (b[k] - a[k]) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/** What `tuning.ts` and the store are allowed to hold: an ID, never a colour. */
export type HeatRampId = "inferno" | "turbo";

/** Ramp lookup by id — the only door between a stored preference and a colour. */
export function heatRampById(id: HeatRampId): readonly HeatStop[] {
  return id === "turbo" ? HEAT_TURBO : HEAT_INFERNO;
}

/** LUT entries. 256 is the score texture's own quantisation, so a finer LUT buys nothing. */
export const HEAT_LUT_SIZE = 256;

/** `#RRGGBB` → three 0–255 channels. Throws rather than silently painting black. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`heatPalette: expected #RRGGBB, got "${hex}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** sRGB channel (0–1) → linear light. The piecewise EOTF, not a 2.2 power approximation. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * OKLab lightness of an `#RRGGBB` colour (Ottosson's matrices), 0 = black, ~1 = white.
 *
 * This is the measure §6.1 specifies, and the reason the whole ramp choice is testable rather than
 * a matter of taste: it is perceptually uniform, so "the next stop is brighter" is a claim about
 * what an eye sees, not about what the bytes happen to say.
 */
export function okLightness(hex: string): number {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/**
 * The ramp as `HEAT_LUT_SIZE × RGB8` bytes (768), linearly interpolated between the 11 stops — the
 * payload the sheet uploads as its LUT. These are sRGB COLOURS, not data: the texture carrying
 * them is tagged `SRGBColorSpace` at the use site, and the globe-tuning rule that data textures
 * take `NoColorSpace` does not apply to a colour ramp.
 *
 * Index 0 and index 255 land on the first and last stop EXACTLY, so the legend's end caps and the
 * sheet agree at the extremes where a reader checks them.
 */
export function buildHeatLut(stops: readonly HeatStop[]): Uint8Array {
  const n = stops.length;
  if (n < 2) throw new Error(`heatPalette: a ramp needs at least 2 stops, got ${n}`);
  const rgb = stops.map((s) => hexToRgb(s.gl));
  const out = new Uint8Array(HEAT_LUT_SIZE * 3);
  for (let i = 0; i < HEAT_LUT_SIZE; i++) {
    const u = (i / (HEAT_LUT_SIZE - 1)) * (n - 1);
    const a = Math.min(Math.floor(u), n - 2); // the top index folds into the last SEGMENT, not past it
    const f = u - a;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(rgb[a][k] + (rgb[a + 1][k] - rgb[a][k]) * f);
  }
  return out;
}
