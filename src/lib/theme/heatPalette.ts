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
