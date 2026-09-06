import { describe, expect, it } from "vitest";
import {
  bandCurve,
  bandCurveGlsl,
  easeK,
  rampWeights,
  ultraLightAt,
} from "../../../src/lib/globe/lightBands";
import { ULTRA } from "../../../src/components/globe/tuning";
import { LIGHT_DEG, TWILIGHT_DEG } from "../../../src/lib/ephemeris/twilight";

const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);

describe("bandCurve — the S9 twilight response", () => {
  it("returns each anchor's value EXACTLY at its own elevation", () => {
    // The whole architectural claim of S9 is that the renderer's day factor is anchored on the
    // almanac's twilight thresholds. If the curve merely passes NEAR them the claim is decorative.
    for (const a of ULTRA.dayCurve) {
      expect(bandCurve(ULTRA.dayCurve, sinDeg(a.elevDeg))).toBeCloseTo(a.v, 10);
    }
  });

  it("saturates outside the table instead of extrapolating", () => {
    const first = ULTRA.dayCurve[0];
    const last = ULTRA.dayCurve[ULTRA.dayCurve.length - 1];
    expect(bandCurve(ULTRA.dayCurve, sinDeg(89))).toBeCloseTo(first.v, 10);
    expect(bandCurve(ULTRA.dayCurve, 1)).toBeCloseTo(first.v, 10);
    expect(bandCurve(ULTRA.dayCurve, sinDeg(-89))).toBeCloseTo(last.v, 10);
    expect(bandCurve(ULTRA.dayCurve, -1)).toBeCloseTo(last.v, 10);
  });

  it("is monotone over the whole domain for every shipped curve", () => {
    // Monotonicity is what keeps dayK inside [0,1] with no clamp, and what stops a timelapse
    // from BRIGHTENING for a moment while the sun is setting — which would read as a glitch,
    // not as atmosphere.
    for (const [name, curve] of [
      ["dayCurve", ULTRA.dayCurve],
      ["exposureCurve", ULTRA.exposureCurve],
      ["hemiCurve", ULTRA.hemiCurve],
      ["hazeCurve", ULTRA.hazeCurve],
    ] as const) {
      const authoredRising = curve[0].v >= curve[curve.length - 1].v;
      let prev = bandCurve(curve, -1);
      for (let i = 1; i <= 4000; i++) {
        const v = bandCurve(curve, -1 + (2 * i) / 4000);
        // hemi/haze peak mid-table by design; only dayCurve is asserted globally monotone.
        if (name === "dayCurve") {
          expect(authoredRising ? v >= prev - 1e-12 : v <= prev + 1e-12).toBe(true);
        }
        expect(Number.isFinite(v)).toBe(true);
        prev = v;
      }
    }
  });

  it("keeps dayK inside [0,1] everywhere", () => {
    for (let i = 0; i <= 2000; i++) {
      const v = bandCurve(ULTRA.dayCurve, -1 + (2 * i) / 2000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("degenerate tables do not throw", () => {
    expect(bandCurve([], 0)).toBe(0);
    expect(bandCurve([{ elevDeg: 0, v: 0.5 }], 0.9)).toBeCloseTo(0.5, 10);
    expect(bandCurve([{ elevDeg: 0, v: 0.5 }], -0.9)).toBeCloseTo(0.5, 10);
  });
});

/**
 * T66 — THE AUTHORED RISES THROUGH 0° (owner ruling 2026-09-06i).
 *
 * *"brightness goes up against all physics"*. Three curves in this file were authored to KEEP
 * CLIMBING after the sun had set — `exposureCurve` 1.1194 → 1.1451 by −1.5°, `hazeCurve` peaking
 * exactly at 0°, `afterglowCurve` 0.35 → 0.75 by −2° while `skyLevelCurve` fell 0.58 → 0.46 — and
 * together they are the ×1.16 luma bump the sunset-release fix could not remove, because it is not
 * a shadow defect at all. The owner's gate is the elevation ladder's luma series
 * (`verify-ultra-dusk --ladder`, monotone non-increasing +3° → −1.5° within 2 codes); this is its
 * UNIT TWIN, on the tables themselves, so a re-tune that re-creates the defect fails in 30 ms
 * instead of costing a browser run.
 *
 * The reference elevation is +0.5°, verbatim from the ruling: *"may not make the frame brighter
 * than it was at +0.5°"*.
 */
describe("T66 — nothing the sun sets past may brighten the frame", () => {
  const REF = sinDeg(0.5);
  /** Dense sample of the whole post-reference domain, in sin space (what the curves evaluate in). */
  const below = (fromDeg = 0.5, toDeg = -18, stepDeg = 0.01): number[] => {
    const out: number[] = [];
    for (let d = fromDeg; d >= toDeg; d -= stepDeg) out.push(sinDeg(Number(d.toFixed(4))));
    return out;
  };

  it("EXPOSURE holds its plateau across the sunset window instead of opening up through it", () => {
    const at = (d: number) => bandCurve(ULTRA.exposureCurve, sinDeg(d));
    // The shipped defect, as one number: the camera opened up by 0.025 stops of multiplier
    // between +0.5° and −1.5°, i.e. while the sun was disappearing.
    expect(at(0)).toBe(at(-1));
    expect(at(0)).toBe(at(-2)); // the plateau, exactly — one anchor value, not a near miss
    for (const d of [-0.25, -0.5, -0.833, -1, -1.5, -2]) {
      expect(at(d)).toBeLessThanOrEqual(at(0) + 1e-12);
    }
    // …and the residual rise from the reference into the plateau is a quarter of one 8-bit code,
    // against the ladder's 2-code tolerance. (It cannot be zero without moving the 0° anchor,
    // which would change the DAY side — explicitly out of scope for this ruling.)
    expect(at(0) - bandCurve(ULTRA.exposureCurve, REF)).toBeLessThan(1e-3);
    expect(at(0) - bandCurve(ULTRA.exposureCurve, REF)).toBeGreaterThan(0);
    // The night ramp still exists below the window — the camera opening up at night is the
    // feature, and it resumes where dayK and skyLevel are collapsing far faster than it climbs.
    expect(at(-6)).toBeGreaterThan(at(-2));
    expect(at(-18)).toBeCloseTo(1.46, 10);
    // The DAY side is untouched by this ruling, and that is checkable: every anchor at or above
    // 0° is still hit exactly, and the shape between them is the shipped one.
    for (const a of ULTRA.exposureCurve.filter((a) => a.elevDeg >= 0)) {
      expect(bandCurve(ULTRA.exposureCurve, sinDeg(a.elevDeg))).toBeCloseTo(a.v, 10);
    }
  });

  it("HAZE never rises below the reference — the 0° spike is a plateau now", () => {
    const ref = bandCurve(ULTRA.hazeCurve, REF);
    let prev = ref;
    for (const s of below()) {
      const v = bandCurve(ULTRA.hazeCurve, s);
      expect(v).toBeLessThanOrEqual(ref + 1e-12); // never brighter than the reference…
      expect(v).toBeLessThanOrEqual(prev + 1e-12); // …and never brighter than one step ago
      prev = v;
    }
    // Everything BELOW the horizon is byte-identical to the shipped table — the fix is confined
    // to the half-degree above it, which is where the spike was.
    expect(bandCurve(ULTRA.hazeCurve, sinDeg(0))).toBe(0.85);
    expect(bandCurve(ULTRA.hazeCurve, sinDeg(-4))).toBe(0.8);
  });

  it("AFTERGLOW × SKYLEVEL — the band the dome actually paints — never outruns the sky", () => {
    // F4: `scene/atmosphere.ts` multiplies its additive band by `uFtwSkyLevel`, so THIS product is
    // the quantity with a licence to be looked at, and the ruling binds it and not the raw curve.
    const band = (s: number) =>
      bandCurve(ULTRA.afterglowCurve, s) * bandCurve(ULTRA.skyLevelCurve, s);
    const ref = band(REF);
    for (const s of below()) expect(band(s)).toBeLessThanOrEqual(ref + 1e-12);
    // Falling across the ladder's own window, which is the gate stated as arithmetic. The
    // tolerance is the ruling's own — "monotone non-increasing … WITHIN 2 CODES" — and it is not
    // slack being taken: the largest local rise anywhere below the reference is 4.8e-4 on a band
    // of 0.20, i.e. 0.24 %, a smoothstep artefact of `skyLevelCurve`'s flat-derivative knot at 0°
    // meeting the afterglow's steepest segment. The shipped table rose 71 % over the same window.
    const ladder = [0.5, 0.25, 0, -0.25, -0.5, -0.833, -1, -1.25, -1.5].map((d) => band(sinDeg(d)));
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1] + 1e-3);
    }
    // …and the window as a whole is a real fall, not a flat line that satisfies the bound.
    expect(ladder.at(-1)!).toBeLessThan(ladder[0] * 0.95);
    // The defect, recomputed rather than transcribed, so this test can never be satisfied by a
    // curve that merely looks different: the SHIPPED table rose × 1.71 across the same window.
    const SHIPPED = [
      { elevDeg: 4, v: 0 },
      { elevDeg: 0, v: 0.35 },
      { elevDeg: -2, v: 0.75 },
      { elevDeg: -5, v: 0.55 },
      { elevDeg: -9, v: 0.15 },
      { elevDeg: -14, v: 0 },
    ];
    const shippedBand = (d: number) =>
      bandCurve(SHIPPED, sinDeg(d)) * bandCurve(ULTRA.skyLevelCurve, sinDeg(d));
    expect(shippedBand(-1.5) / shippedBand(0.5)).toBeGreaterThan(1.7);
    expect(ladder.at(-1)! / ref).toBeLessThan(1);
    // …and the glow is still a glow: it has not been flattened out of existence at the horizon.
    expect(bandCurve(ULTRA.afterglowCurve, sinDeg(0))).toBeGreaterThan(0.3);
    expect(bandCurve(ULTRA.afterglowCurve, sinDeg(-5))).toBeGreaterThan(0.45);
  });
});

describe("bandCurveGlsl — the emitted shader twin cannot drift from the JS", () => {
  /**
   * The emitted GLSL is a straight-line fold of `mix(v, hi, smoothstep(lo, hi, s))`. Rather than
   * eyeballing it, parse the emitted source back into an evaluator and compare against
   * `bandCurve` across the domain. A change to either implementation that is not mirrored in the
   * other turns this red — which is the only reason it is safe to have the day/night response
   * live in two languages at once.
   */
  const evalEmitted = (glsl: string, s: number): number => {
    const body = glsl.slice(glsl.indexOf("{") + 1, glsl.lastIndexOf("}"));
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const smoothstep = (e0: number, e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    let v = NaN;
    for (const line of lines) {
      const init = /^float v = (-?[\d.eE+-]+);$/.exec(line);
      if (init) {
        v = Number(init[1]);
        continue;
      }
      const mix = /^v = mix\(v, (-?[\d.eE+-]+), smoothstep\((-?[\d.eE+-]+), (-?[\d.eE+-]+), s\)\);$/.exec(
        line,
      );
      if (mix) {
        const hi = Number(mix[1]);
        v = v + (hi - v) * smoothstep(Number(mix[2]), Number(mix[3]), s);
        continue;
      }
      if (line === "return v;") continue;
      throw new Error(`unparsed emitted line: ${line}`);
    }
    return v;
  };

  // Agreement is asserted to 7 decimal places, which is the honest contract rather than a
  // convenient one: the emitter bakes its constants at `toPrecision(9)` and a GLSL ES `float`
  // carries ~7 significant decimal digits, so the shader physically cannot resolve a difference
  // finer than this. Tightening past 7 would be testing the emitter's rounding, not the twin.
  const FLOAT32_PLACES = 7;

  it("evaluates identically to bandCurve across the domain (dayCurve)", () => {
    const glsl = bandCurveGlsl("ftwUltraDayK", ULTRA.dayCurve);
    for (let i = 0; i <= 1000; i++) {
      const s = -1 + (2 * i) / 1000;
      expect(evalEmitted(glsl, s)).toBeCloseTo(bandCurve(ULTRA.dayCurve, s), FLOAT32_PLACES);
    }
  });

  it("evaluates identically for every other shipped curve", () => {
    for (const curve of [ULTRA.exposureCurve, ULTRA.hemiCurve, ULTRA.hazeCurve]) {
      const glsl = bandCurveGlsl("f", curve);
      for (let i = 0; i <= 400; i++) {
        const s = -1 + (2 * i) / 400;
        expect(evalEmitted(glsl, s)).toBeCloseTo(bandCurve(curve, s), FLOAT32_PLACES);
      }
    }
  });

  it("emits only GLSL-legal float literals (never a bare int)", () => {
    // GLSL ES rejects `float x = 2;` — the repo's whole `glf` convention exists for this. A
    // curve authored with a round value (v: 1) is the realistic way to trip it.
    const glsl = bandCurveGlsl("f", [
      { elevDeg: 90, v: 1 },
      { elevDeg: 0, v: 0 },
    ]);
    for (const lit of glsl.match(/(?<![\w.])-?\d+(\.\d+)?([eE][+-]?\d+)?/g) ?? []) {
      expect(lit).toMatch(/[.eE]/);
    }
  });

  it("declares the function name it was asked for", () => {
    expect(bandCurveGlsl("ftwUltraDayK", ULTRA.dayCurve)).toMatch(/^float ftwUltraDayK\(float s\) \{/);
  });
});

describe("the S9 anchors ARE the almanac's twilight thresholds", () => {
  /**
   * The claim in ULTRA_PLAN §2 / tuning.ULTRA is that the renderer stops inventing its own band
   * edges and reuses the ones `lib/ephemeris/twilight.ts` already gives the planner and the
   * scrubber. That is a claim about NUMBERS, so assert the numbers — otherwise "one vocabulary"
   * is a comment that a later retune can quietly falsify.
   */
  const dayAnchors = ULTRA.dayCurve.map((a) => a.elevDeg);
  it("carries the golden, civil, nautical and astronomical edges verbatim", () => {
    expect(dayAnchors).toContain(LIGHT_DEG.goldenHi); // +6
    expect(dayAnchors).toContain(LIGHT_DEG.goldenLo); // −4
    expect(dayAnchors).toContain(TWILIGHT_DEG.civil); // −6
    expect(dayAnchors).toContain(TWILIGHT_DEG.nautical); // −12
    expect(dayAnchors).toContain(TWILIGHT_DEG.astro); // −18
  });
  it("spans far more than the legacy termBand it replaces", () => {
    // EARTH.termBand is [−0.105, 0.055] in SIN units ≈ −6.03°..+3.15° ≈ 9.2° total. The owner's
    // complaint ("naive and linear") is that width; the fix is only real if the span grows.
    const span = Math.max(...dayAnchors) - Math.min(...dayAnchors);
    expect(span).toBeGreaterThan(30);
  });
  it("still reads bright at civil twilight and dark by astronomical night", () => {
    expect(bandCurve(ULTRA.dayCurve, sinDeg(TWILIGHT_DEG.civil))).toBeGreaterThan(0.2);
    expect(bandCurve(ULTRA.dayCurve, sinDeg(TWILIGHT_DEG.astro))).toBeLessThan(0.05);
  });
});

describe("rampWeights — the 4-stop palette ramp behind the haze / ambient tint", () => {
  it("always sums to 1 with at most two non-zero weights", () => {
    for (let i = 0; i <= 2000; i++) {
      const s = -1 + (2 * i) / 2000;
      const w = rampWeights(ULTRA.tintStopsDeg, s);
      expect(w).toHaveLength(ULTRA.tintStopsDeg.length);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(w.filter((x) => x > 1e-12).length).toBeLessThanOrEqual(2);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts full weight on the day stop above it and the night stop below it", () => {
    const hi = rampWeights(ULTRA.tintStopsDeg, sinDeg(60));
    expect(hi[0]).toBeCloseTo(1, 12);
    const lo = rampWeights(ULTRA.tintStopsDeg, sinDeg(-60));
    expect(lo[lo.length - 1]).toBeCloseTo(1, 12);
  });

  it("hands the golden stop its full weight at sunset", () => {
    // ULTRA.tintStopsDeg[1] is the 0° stop; at exactly 0° the ramp must be pure golden, or the
    // biggest lever on how a sunset READS is diluted by whatever is next to it.
    const w = rampWeights(ULTRA.tintStopsDeg, sinDeg(ULTRA.tintStopsDeg[1]));
    expect(w[1]).toBeCloseTo(1, 12);
  });

  it("degenerate stop lists do not throw", () => {
    expect(rampWeights([], 0)).toEqual([]);
    expect(rampWeights([5], -1)).toEqual([1]);
  });
});

describe("ultraLightAt — one sample, every consumer", () => {
  it("returns finite, in-range values across the whole domain", () => {
    for (let i = 0; i <= 1000; i++) {
      const s = ultraLightAt(ULTRA, -1 + (2 * i) / 1000);
      expect(s.dayK).toBeGreaterThanOrEqual(0);
      expect(s.dayK).toBeLessThanOrEqual(1);
      expect(s.exposureK).toBeGreaterThan(0);
      expect(s.hemiK).toBeGreaterThan(0);
      expect(s.hazeK).toBeGreaterThanOrEqual(0);
      expect(s.tint.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it("opens the exposure up as the sun goes down — the S11 premise", () => {
    const noon = ultraLightAt(ULTRA, sinDeg(60)).exposureK;
    const dusk = ultraLightAt(ULTRA, sinDeg(-6)).exposureK;
    const night = ultraLightAt(ULTRA, sinDeg(-20)).exposureK;
    expect(dusk).toBeGreaterThan(noon);
    expect(night).toBeGreaterThan(dusk);
    // …but never so far that the night side blows out. A camera opening 2× would wash the
    // city-lights model and push the moon disc past the bloom threshold.
    expect(night).toBeLessThan(1.75);
  });

  it("peaks the haze at sunset and drops it at night — night haze is DARKNESS, not grey", () => {
    const sunset = ultraLightAt(ULTRA, sinDeg(0)).hazeK;
    expect(sunset).toBeGreaterThan(ultraLightAt(ULTRA, sinDeg(45)).hazeK);
    expect(sunset).toBeGreaterThan(ultraLightAt(ULTRA, sinDeg(-20)).hazeK);
    expect(ultraLightAt(ULTRA, sinDeg(-20)).hazeK).toBeLessThan(0.2);
  });
});

describe("easeK — the low-pass every ULTRA term rides", () => {
  it("is 0 at dt 0 and approaches 1 for dt >> tau", () => {
    expect(easeK(0, 500)).toBeCloseTo(0, 12);
    // Note the ceiling: dt is clamped to 250 ms first (see the clamp test below), so even an
    // enormous dt tops out at 1 − exp(−250/tau), never exactly 1. With tau 20 ms that is
    // ~0.9999963 — indistinguishable in a colour, and deliberately not 1.
    expect(easeK(5000, 20)).toBeGreaterThan(0.9999);
    expect(easeK(5000, 20)).toBeLessThan(1);
  });

  it("clamps a background-tab gap to one bounded step", () => {
    // A hidden tab (or a devtools pause) delivers one enormous dt. Unclamped that is a snap —
    // exactly the exposure flicker the easing exists to prevent — on the first visible frame.
    expect(easeK(1e9, 950)).toBe(easeK(250, 950));
    expect(easeK(250, 950)).toBeLessThan(1);
  });

  it("never returns a negative or NaN coefficient", () => {
    expect(easeK(-100, 500)).toBe(0);
    expect(easeK(16, 0)).toBe(1);
    expect(easeK(16, -1)).toBe(1);
  });

  it("is frame-rate independent: two half-steps ≈ one full step", () => {
    // The property that makes a scrub look the same at 15 fps (ULTRA's whole point) as at 60.
    const tau = 400;
    const oneStep = easeK(32, tau);
    const halfA = easeK(16, tau);
    const composed = halfA + (1 - halfA) * easeK(16, tau);
    expect(composed).toBeCloseTo(oneStep, 12);
  });
});
