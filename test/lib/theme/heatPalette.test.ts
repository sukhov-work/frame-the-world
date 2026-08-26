import { describe, expect, it } from "vitest";
import {
  buildHeatLut,
  HEAT_INFERNO,
  HEAT_LUT_SIZE,
  HEAT_SPOTS,
  HEAT_TURBO,
  heatRampById,
  okLightness,
  spotQualityCss,
  spotQualityGl,
  type HeatRampId,
  type HeatStop,
} from "../../../src/lib/theme/heatPalette";
import { tokens } from "../../../src/lib/theme/tokens";
import { read, stripComments } from "../../styles/_css";

/**
 * BEST SPOT heat ramp (SPEC_V2 §6.1) + the token-bridge parity fence.
 *
 * Two contracts live here, and both are load-bearing rather than decorative:
 *
 * 1. **INFERNO is monotone in OKLab L, TURBO is not.** The sheet is a quantitative surface read by
 *    LIGHTNESS ("brighter = better"), which is the only reason a rainbow-family ramp is allowed at
 *    all. If someone reorders Inferno, or promotes Turbo to the default, the reading inverts at the
 *    top of the scale — the best spot goes dark red — and nothing else in the repo would notice.
 *
 * 2. **`tokens.css` (the D14 source of truth) and `lib/theme/tokens.ts` (its hand-written GL
 *    mirror) agree.** There is no generator between them, so until now the mirror could drift by a
 *    typo and the DOM legend and the GL sheet would quietly disagree about what "0.9" looks like.
 *    This is the first test in the repo that reads the CSS at runtime and checks it.
 *
 * Mutation that makes these RED: swap two Inferno stops · point `heatRampById("inferno")` at Turbo
 * · change one hex digit in either token file · drop a stop from a ramp.
 */

/** §6.1's published OKLab L table — the numbers the ramp choice was argued from. */
const SPEC_INFERNO_L = [
  0.0482, 0.2006, 0.3068, 0.3839, 0.4618, 0.5416, 0.6201, 0.7038, 0.7893, 0.8808, 0.9777,
];

const lightness = (stops: readonly HeatStop[]) => stops.map((s) => okLightness(s.gl));

/** Adjacent pairs where lightness FALLS — the thing Inferno must never have and Turbo must. */
const descents = (ls: readonly number[]) =>
  ls.map((v, i) => (i > 0 && v < ls[i - 1] ? i : -1)).filter((i) => i >= 0);

describe("HEAT_INFERNO — the shipping ramp is monotone in lightness (SPEC_V2 §6.1)", () => {
  it("has 11 stops and both faces of every one", () => {
    expect(HEAT_INFERNO).toHaveLength(11);
    for (const [i, stop] of HEAT_INFERNO.entries()) {
      expect(stop.css).toBe(`var(--color-heat-${i})`);
      expect(stop.gl).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("okL(stop[i+1]) > okL(stop[i]) for all 10 adjacent pairs", () => {
    const ls = lightness(HEAT_INFERNO);
    for (let i = 0; i < ls.length - 1; i++) {
      expect(ls[i + 1], `stop ${i + 1} must be lighter than stop ${i}`).toBeGreaterThan(ls[i]);
    }
    expect(descents(ls)).toEqual([]);
  });

  it("measures the OKLab L values §6.1 published (to 2 dp)", () => {
    const ls = lightness(HEAT_INFERNO);
    expect(ls).toHaveLength(SPEC_INFERNO_L.length);
    ls.forEach((v, i) => expect(v).toBeCloseTo(SPEC_INFERNO_L[i], 2));
  });

  it("keeps §6.1's minimum adjacent ΔL — no two stops collapse into one another", () => {
    const ls = lightness(HEAT_INFERNO);
    const deltas = ls.slice(1).map((v, i) => v - ls[i]);
    expect(Math.min(...deltas)).toBeGreaterThan(0.07); // §6.1 measures 0.0779 (0.3 → 0.4)
  });
});

describe("HEAT_TURBO — the A/B chip's ramp is NOT monotone, and that must stay true", () => {
  it("has 11 stops with the canonical Turbo end points", () => {
    expect(HEAT_TURBO).toHaveLength(11);
    expect(HEAT_TURBO[0].gl).toBe("#30123B");
    expect(HEAT_TURBO[10].gl).toBe("#7A0403");
  });

  it("falls in lightness at least once — the chip's warning is a measured fact", () => {
    const ls = lightness(HEAT_TURBO);
    expect(descents(ls).length).toBeGreaterThanOrEqual(1);
  });

  it("peaks in the MIDDLE, so the best spot is not the brightest cell", () => {
    const ls = lightness(HEAT_TURBO);
    const peak = ls.indexOf(Math.max(...ls));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(ls.length - 1); // the top of the scale is NOT the top of the light
    expect(ls[ls.length - 1]).toBeLessThan(ls[peak]);
  });

  it("is the ramp Inferno is not — the two can never be swapped by accident", () => {
    expect(descents(lightness(HEAT_TURBO)).length).toBeGreaterThan(
      descents(lightness(HEAT_INFERNO)).length,
    );
  });
});

/**
 * The SHORTLIST-MARKER ramp (owner batch 2026-08-26, item 2). Three constraints, all measurable,
 * and each one is a repair the obvious alternative would have failed:
 *  1. MONOTONE in OKLab L — the INFERNO discipline, so "brighter = better" needs no hue memory.
 *  2. BRIGHTER THAN THE CELLS IT STANDS ON — a marker painted from the sheet's own scale would be
 *     invisible against its own cell, and the shortlist lives in INFERNO's near-black foot in a
 *     real disc (a dense-Dnipro pedestrian best measured 0.381 against a 0.9 display ceiling).
 *  3. NOT `tokens.accent` — cyan is the reserved signal ink, and it is the flat colour the owner
 *     asked to move away from.
 */
describe("HEAT_SPOTS — the shortlist marker ramp is its own scale (owner 2026-08-26 item 2)", () => {
  it("is monotone in OKLab lightness, like the ramp it borrows its discipline from", () => {
    const L = lightness(HEAT_SPOTS);
    expect(descents(L)).toEqual([]);
    expect(L[L.length - 1] - L[0]).toBeGreaterThan(0.15);
  });

  /**
   * THE CELLS A MARKER ACTUALLY STANDS ON. This is the constraint, and it is narrower than "brighter
   * than INFERNO" — INFERNO's top stop is pale straw at L 0.978 and nothing sane is brighter.
   *
   * The band that matters is the one a shortlist cell paints its own sheet with. Measured in a
   * dense-Dnipro pedestrian disc, the best cell scored 0.381 against `displayHi` 0.9, i.e.
   * `displayT ≈ 0.31` — the whole top-8 lands inside INFERNO stops 0–3 (L 0.048 → 0.384). Even
   * generously doubling that band to stop 5 (crimson, L 0.542), every marker stop still out-lights
   * the cell beneath it. THAT is why the markers cannot be drawn from the sheet's own ramp, and it
   * is a claim about a measurement rather than about taste.
   */
  it("out-lights every sheet colour a top-K cell can realistically be painted with", () => {
    const SHORTLIST_BAND_TOP = 5; // ≈ displayT 0.5 — twice the measured worst case
    const sheet = lightness(HEAT_INFERNO).slice(0, SHORTLIST_BAND_TOP + 1);
    expect(Math.min(...lightness(HEAT_SPOTS))).toBeGreaterThan(Math.max(...sheet));
    // POSITIVE CONTROL: the band really is the dark half, so the comparison is not vacuous.
    expect(Math.max(...sheet)).toBeLessThan(Math.max(...lightness(HEAT_INFERNO)));
  });

  it("never uses the reserved accent ink, and never a heat token", () => {
    for (const stop of HEAT_SPOTS) {
      expect(stop.gl.toUpperCase()).not.toBe(tokens.accent.toUpperCase());
      expect(stop.css).not.toMatch(/^var\(--color-heat-/);
      // D14: every face is a token reference, never a literal.
      expect(stop.css).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  /**
   * THE BROWSER FINDING, pinned (2026-08-26). The first live run of the new markers snapped each
   * quality to the NEAREST of five stops, and a real Dnipro shortlist spans `score ÷ best`
   * 1.000 → 0.802 — so six markers came out one colour and two came out another. Two colours for
   * eight rows is most of the way back to the flat accent this replaced, which is the defect the
   * owner reported in the first place.
   */
  it("is CONTINUOUS — a tightly-clustered shortlist still gets eight different colours", () => {
    // The measured ratios from that run, best-first.
    const measured = [1.0, 0.989, 0.955, 0.949, 0.923, 0.859, 0.809, 0.802];
    const css = new Set(measured.map(spotQualityCss));
    const gl = new Set(measured.map(spotQualityGl));
    expect(css.size).toBe(measured.length);
    expect(gl.size).toBe(measured.length);
    // …and BOTH faces are still tokens / valid colours — continuity may not cost D14.
    for (const c of css) expect(c).toMatch(/^(var\(--color-[a-z0-9-]+\)|color-mix\(in srgb, var\(--color-[a-z0-9-]+\) \d{1,3}%, var\(--color-[a-z0-9-]+\)\))$/);
    for (const g of gl) expect(g).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("the two faces interpolate in the SAME space, between the SAME pair", () => {
    // sRGB on both sides: `color-mix(in srgb, …)` in the DOM, a byte lerp for GL. Lerping two
    // `THREE.Color`s instead would blend in the LINEAR working space and miss the swatch beside it.
    const q = 0.5; // exactly the middle stop, so the answer is a stop rather than a mix
    expect(spotQualityCss(q)).toBe(HEAT_SPOTS[2].css);
    expect(spotQualityGl(q)).toBe(HEAT_SPOTS[2].gl.toUpperCase());
    // A quarter of the way from stop 2 to stop 3 is a quarter of the way in BYTES.
    const t = 0.25;
    const mid = spotQualityGl(0.5 + t * 0.25);
    const a = HEAT_SPOTS[2].gl;
    const b = HEAT_SPOTS[3].gl;
    const ch = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
    for (const k of [0, 1, 2]) {
      expect(ch(mid, k)).toBe(Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t));
    }
  });

  it("spotQualityCss is the ONE door — clamped at both ends, and never throws on rubbish", () => {
    expect(spotQualityCss(1)).toBe(HEAT_SPOTS[HEAT_SPOTS.length - 1].css);
    expect(spotQualityCss(0)).toBe(HEAT_SPOTS[0].css);
    expect(spotQualityCss(9)).toBe(HEAT_SPOTS[HEAT_SPOTS.length - 1].css);
    expect(spotQualityCss(-9)).toBe(HEAT_SPOTS[0].css);
    // A NaN reaching a swatch would be `undefined.css`; a NaN reaching the GL twin is a black
    // marker. Both are the same upstream mistake (a divide by an empty shortlist), so both clamp.
    expect(spotQualityCss(NaN)).toBe(HEAT_SPOTS[0].css);
  });
});

describe("heatRampById — an id is all tuning/state may hold (D14)", () => {
  it("maps both ids to their own ramp", () => {
    const ids: HeatRampId[] = ["inferno", "turbo"];
    expect(ids.map(heatRampById)).toEqual([HEAT_INFERNO, HEAT_TURBO]);
  });
});

describe("buildHeatLut — 256 × RGB8, ends exact", () => {
  const lut = buildHeatLut(HEAT_INFERNO);

  it("is exactly 768 bytes of valid bytes", () => {
    expect(HEAT_LUT_SIZE).toBe(256);
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(256 * 3);
    for (const v of lut) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("hits the end-point colours EXACTLY at index 0 and 255", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect([...lut.slice(0, 3)]).toEqual(rgb(HEAT_INFERNO[0].gl));
    expect([...lut.slice(255 * 3, 256 * 3)]).toEqual(rgb(HEAT_INFERNO[10].gl));
  });

  it("is monotone in lightness across all 256 entries, not just at the stops", () => {
    const hex = (i: number) =>
      "#" +
      [0, 1, 2].map((k) => lut[i * 3 + k].toString(16).padStart(2, "0")).join("").toUpperCase();
    let prev = -1;
    for (let i = 0; i < 256; i++) {
      const l = okLightness(hex(i));
      expect(l, `LUT entry ${i} is not lighter than ${i - 1}`).toBeGreaterThan(prev);
      prev = l;
    }
  });

  it("interpolates BETWEEN the stops (the LUT is a ramp, not 11 plateaus)", () => {
    const mid = 128; // between heat5 and heat6
    const at = (i: number) => [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];
    expect(at(mid)).not.toEqual(at(mid + 1));
    expect(new Set([...lut]).size).toBeGreaterThan(11);
  });

  it("refuses a degenerate ramp rather than emitting black", () => {
    expect(() => buildHeatLut(HEAT_INFERNO.slice(0, 1))).toThrow(/at least 2 stops/);
    expect(() => buildHeatLut([{ css: "var(--x)", gl: "teal" }, HEAT_INFERNO[0]])).toThrow(
      /#RRGGBB/,
    );
  });
});

/**
 * The bridge fence. `tokens.css` is the source of truth (D14) and `tokens.ts` is a HAND-WRITTEN
 * mirror with no generator — so this reads the CSS off disk and compares every `--color-*` with its
 * camelCase twin. Measured 2026-08-24 when this test was written: 40 shared tokens, ZERO drift.
 *
 * The two exception lists are exhaustive on purpose. A new CSS token that is not bridged, or a new
 * GL token with no CSS declaration, turns this red — which is the decision ("is this colour the
 * scene's business?") being forced at the moment it is made rather than discovered later.
 */
describe("tokens.css ↔ tokens.ts parity (ADR D14 — the mirror has no generator)", () => {
  const css = stripComments(read("src/styles/tokens.css"));
  const cssTokens = new Map<string, string>();
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    cssTokens.set(m[1], m[2]);
  }
  const camel = (k: string) => k.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const gl = tokens as unknown as Record<string, string | undefined>;

  /** CSS name → GL name where the two vocabularies legitimately differ. */
  const ALIAS: Record<string, string> = { text: "textPrimary" };
  /** Chrome-only ink: declared for the DOM, deliberately never handed to the scene. */
  const DOM_ONLY = new Set(["bg-raise", "surface-2", "danger", "blue-hour", "night-band"]);
  /** Scene-only ink: no DOM surface paints it (owner 2026-08-18 split moonDial off moonlight). */
  const GL_ONLY = new Set(["moonDial"]);

  it("found the CSS tokens at all (positive control — a broken regex must not pass silently)", () => {
    expect(cssTokens.size).toBeGreaterThanOrEqual(46);
    expect(cssTokens.get("bg")).toBe("#05070b");
  });

  it("every bridged --color-* equals its tokens.ts twin (case-insensitive)", () => {
    const drift: string[] = [];
    for (const [key, value] of cssTokens) {
      if (DOM_ONLY.has(key)) continue;
      const name = ALIAS[key] ?? camel(key);
      const mirrored = gl[name];
      if (mirrored === undefined) {
        drift.push(`${key}: no tokens.ts twin "${name}" (bridge it, or add it to DOM_ONLY)`);
      } else if (mirrored.toLowerCase() !== value.toLowerCase()) {
        drift.push(`${key}: css ${value} vs tokens.ts ${name} ${mirrored}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("every tokens.ts colour is declared in tokens.css (the mirror invents nothing)", () => {
    const claimed = new Set(
      [...cssTokens.keys()].map((k) => ALIAS[k] ?? camel(k)).concat([...GL_ONLY]),
    );
    const orphans = Object.keys(tokens).filter(
      (k) => typeof gl[k] === "string" && gl[k]!.startsWith("#") && !claimed.has(k),
    );
    expect(orphans).toEqual([]);
  });

  it("covers the 22 heat tokens specifically — both ramps, both faces", () => {
    for (const stops of [HEAT_INFERNO, HEAT_TURBO]) {
      for (const stop of stops) {
        const key = /^var\(--color-(.+)\)$/.exec(stop.css)?.[1];
        expect(key, `${stop.css} is not a --color-* reference`).toBeTruthy();
        expect(cssTokens.get(key!)?.toLowerCase()).toBe(stop.gl.toLowerCase());
      }
    }
    expect([...cssTokens.keys()].filter((k) => k.startsWith("heat-"))).toHaveLength(22);
  });
});
