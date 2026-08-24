import { describe, expect, it } from "vitest";
import {
  buildHeatLut,
  HEAT_INFERNO,
  HEAT_LUT_SIZE,
  HEAT_TURBO,
  heatRampById,
  okLightness,
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
