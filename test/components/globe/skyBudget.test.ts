import { describe, expect, it } from "vitest";
import { tokens } from "../../../src/lib/theme/tokens";
import { ATMOSPHERE, BLOOM, GOLDEN, ULTRA } from "../../../src/components/globe/tuning";
import { bandCurve, rampWeights } from "../../../src/lib/globe/lightBands";
import { airLevel, airSun } from "../../../src/lib/globe/duskLight";

/**
 * Horizon sky budget guard (S7 feedback — "white mess at strong tilt"). The low-altitude sky
 * dome is ADDITIVE: at the horizon (sinEl = 0, full day) the shader sums
 *   zenith term  = mix(skyDay, skyHorizon, skyHorizonWhiteness) × skyDayGain
 *   haze term    = mix(skyHorizon, skyDay, skyHazeBlue) × skyHorizonGain × hazeAltK
 * If that total crosses BLOOM.threshold, UnrealBloom picks the band up and SPREADS it — the
 * exact white-out the owner reported (the old budget ran ~1.2 vs threshold 0.9). This test is
 * the JS twin of the shader math in scene/atmosphere.ts — keep them in sync.
 *
 * 2026-09-17 (audit 2026-09-11 finding C1): since T96 (owner ruling 2026-09-06i) the DIRECTIONAL
 * LOOK ships on the base rig, and `horizonSky()` above models only the rotationally-symmetric
 * dome. `horizonSkyLook()` below is the twin of the SHIPPED horizon — the RC24 haze tint
 * (`atmosphere.ts:275`) and the `uFtwDirK` directional mix + afterglow band
 * (`atmosphere.ts:283-318`) — searched over every sun azimuth.
 */
const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const hexToLinear = (hex: string): [number, number, number] => {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(v.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
};
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const skyDay = hexToLinear(tokens.skyDay);
const skyHorizon = hexToLinear(tokens.skyHorizon);

/** The shader's horizon-ray sky total (sinEl = 0, dayK = 1, no golden), per channel. */
function horizonSky(hazeAltK: number): number[] {
  const zenith = mix(skyDay, skyHorizon, ATMOSPHERE.skyHorizonWhiteness).map(
    (c) => c * ATMOSPHERE.skyDayGain,
  );
  const haze = mix(skyHorizon, skyDay, ATMOSPHERE.skyHazeBlue).map(
    (c) => c * ATMOSPHERE.skyHorizonGain * hazeAltK,
  );
  return zenith.map((c, i) => c + haze[i]);
}

// --- THE SHIPPED (LOOK-ON) HORIZON ------------------------------------------------------------
//
// Exact JS port of the two lobes `airLightGlsl` emits into the dome's fragment shader
// (`src/lib/globe/duskLight.ts:118-127`, injected at `scene/atmosphere.ts:194`):
//   float ftwAirSun(float x) { return clamp(pow(max(x, 0.0), miePow), 0.0, 1.0); }
//   float ftwAirLevel(float x) {
//     float ray = 0.75 * (1.0 + x * x);
//     return (rayleighK * ray + mieGain * ftwAirSun(x)) * (1 / (rayleighK * 1.5 + mieGain));
//   }
// Ported here (rather than imported) so this file stays a twin of the SHADER; the drift guard
// below asserts the port agrees with duskLight's own exported CPU twin.
const ftwAirSun = (x: number): number =>
  Math.min(1, Math.max(0, Math.pow(Math.max(x, 0), ULTRA.airMiePow)));
const ftwAirLevel = (x: number): number => {
  const ray = 0.75 * (1 + x * x);
  return (
    (ULTRA.airRayleighK * ray + ULTRA.airMieGain * ftwAirSun(x)) *
    (1 / (ULTRA.airRayleighK * 1.5 + ULTRA.airMieGain))
  );
};

/**
 * What the orchestrator pushes through `atmosphere.setUltraBand(...)` on the BASE rig by day
 * (`StylizedTiles.ts:6876-6886`, the ONE call site; live because `lookOn() = ultraOn ||
 * ULTRA.baseTakesLook` at `:900` and `baseTakesLook` ships true, `tuning.ts:1011`):
 *   · uFtwUltraK   = hazeNow × ULTRA.domeTintK (`:6877`). hazeNow is the ground's eased
 *                    `uFtwHaze`, whose target is `bandCurve(ULTRA.hazeCurve) × hazeAlt ×
 *                    lerp(1, hazeDarkK, dark)` (`imageryGround.ts:1584-1588`). The worst case is
 *                    the ungated one: imagery ground, alt ≤ hazeFullAltM, no dark drape → the
 *                    haze curve alone. Above 30° the curve holds its top anchor (0.5).
 *   · uFtwUltraHaze= `_hazeCol`, the 4-stop tint ramp; at sun ≥ tintStopsDeg[0] (10°) the day
 *                    weight is 1 (`lightBands.ts:123-126`) → `_hazeDayCol` = tokens.skyHorizon
 *                    (`StylizedTiles.ts:3621`).
 *   · uFtwDirK     = `ultraDomeDir`, eased toward ULTRA.domeDirK (`:6849-6851`).
 *   · uFtwSkyCool  = `_hazeBlueCol.lerp(_hazeDayCol, tint[0])` (`:6855`) → tokens.skyHorizon
 *                    by day (tint[0] = 1).
 *   · uFtwSkyLevel = bandCurve(ULTRA.skyLevelCurve, sinSun) (`:6844`) — 1 at/above 12°.
 *   · uFtwAfterglow= bandCurve(ULTRA.afterglowCurve, sinSun) (`:6845`) — 0 at/above 4°.
 */
interface LookInputs {
  dirK: number;
  ultraK: number;
  ultraHaze: number[];
  skyCool: number[];
  skyLevel: number;
  afterglow: number;
}
/** sin(90°): the high-sun plateau where every band curve holds its top anchor. */
const HIGH_SUN = 1;
const baseRigDay = (): LookInputs => ({
  dirK: ULTRA.domeDirK,
  ultraK: bandCurve(ULTRA.hazeCurve, HIGH_SUN) * ULTRA.domeTintK,
  ultraHaze: skyHorizon,
  skyCool: skyHorizon,
  skyLevel: bandCurve(ULTRA.skyLevelCurve, HIGH_SUN),
  afterglow: bandCurve(ULTRA.afterglowCurve, HIGH_SUN),
});

/**
 * The SHIPPED horizon-ray sky total at sinEl = 0 (sRel = 0 → zenithCol = horizonAnchor, the
 * haze crest = 1 × hazeAltK, hzA = 1 × hazeAltK), dayK = 1, uEclipse = 1, no golden (hGold = 0),
 * per channel — `scene/atmosphere.ts:257-318` line for line:
 *   hazeCol = mix(mix(skyHorizon, skyDay, skyHazeBlue), uFtwUltraHaze, uFtwUltraK)   (:270,:275)
 *   skyCol  = zenith × skyDayGain + hazeCol × haze × skyHorizonGain                   (:276-277)
 *   if (uFtwDirK > 0):                                                                 (:283)
 *     sunSide = ftwAirSun(cosG); dirCol = mix(uFtwSkyCool, hazeCol, sunSide × airWarmSwing)
 *     lvl = uFtwSkyLevel × dayK                                                        (:287-293)
 *     dirSky  = zenith × skyDayGain × dayK × uFtwSkyLevel
 *             + dirCol × haze × skyHorizonGain × lvl × ftwAirLevel(cosG)               (:294-295)
 *     skyCol  = mix(skyCol, dirSky, uFtwDirK)                                          (:296)
 *     skyCol += dirCol × hzA × afterglowGain × uFtwAfterglow × uFtwSkyLevel × sunSide × uFtwDirK
 *                                                                                      (:303-317)
 * `cosG` is the cosine of the angle between the view ray and the sun; a horizontal ray can only
 * reach cosG = cos(sunEl), so searching the full [-1, 1] is deliberately CONSERVATIVE.
 */
function horizonSkyLook(hazeAltK: number, cosG: number, inp: LookInputs = baseRigDay()): number[] {
  const dayK = 1;
  const zenith = mix(skyDay, skyHorizon, ATMOSPHERE.skyHorizonWhiteness);
  const haze = hazeAltK; // exp(-0 / tau) × hazeAltK — the crest
  const hazeCol = mix(mix(skyHorizon, skyDay, ATMOSPHERE.skyHazeBlue), inp.ultraHaze, inp.ultraK);
  let skyCol = zenith.map(
    (z, i) => z * ATMOSPHERE.skyDayGain * dayK + hazeCol[i] * haze * ATMOSPHERE.skyHorizonGain,
  );
  if (inp.dirK > 0) {
    const sunSide = ftwAirSun(cosG);
    const dirCol = mix(inp.skyCool, hazeCol, sunSide * ULTRA.airWarmSwing);
    const lvl = inp.skyLevel * dayK;
    const level = ftwAirLevel(cosG);
    const dirSky = zenith.map(
      (z, i) =>
        z * ATMOSPHERE.skyDayGain * dayK * inp.skyLevel +
        dirCol[i] * haze * ATMOSPHERE.skyHorizonGain * lvl * level,
    );
    skyCol = mix(skyCol, dirSky, inp.dirK);
    const hzA = hazeAltK; // exp(-0) × exp(0) × hazeAltK at sRel = 0
    skyCol = skyCol.map(
      (s, i) =>
        s +
        dirCol[i] * hzA * ULTRA.afterglowGain * inp.afterglow * inp.skyLevel * sunSide * inp.dirK,
    );
  }
  return skyCol;
}

/** Fine-grid search over cosG ∈ [-1, 1] for the worst channel max and the worst luminance. */
const COS_G_STEPS = 4000;
function worstHorizon(inp: LookInputs, hazeAltK = 1) {
  let channelMax = -Infinity;
  let cosGAtChannelMax = NaN;
  let luminanceMax = -Infinity;
  let cosGAtLuminanceMax = NaN;
  for (let i = 0; i <= COS_G_STEPS; i++) {
    const cosG = -1 + (2 * i) / COS_G_STEPS;
    const sky = horizonSkyLook(hazeAltK, cosG, inp);
    const m = Math.max(...sky);
    const l = luminance(sky);
    if (m > channelMax) {
      channelMax = m;
      cosGAtChannelMax = cosG;
    }
    if (l > luminanceMax) {
      luminanceMax = l;
      cosGAtLuminanceMax = cosG;
    }
  }
  return { channelMax, cosGAtChannelMax, luminanceMax, cosGAtLuminanceMax };
}

describe("low-altitude horizon sky budget", () => {
  it("stays under the bloom threshold at every altitude (no bloom-amplified white-out)", () => {
    const atCruise = horizonSky(1); // above hazeLowAltHi — the strongest haze
    expect(Math.max(...atCruise)).toBeLessThan(BLOOM.threshold);
    expect(luminance(atCruise)).toBeLessThan(BLOOM.threshold);
  });

  it("is dimmer at street level than at cruise (the very-low-altitude subtlety ramp)", () => {
    const street = luminance(horizonSky(ATMOSPHERE.hazeLowAltK));
    const cruise = luminance(horizonSky(1));
    expect(street).toBeLessThan(cruise);
    expect(ATMOSPHERE.hazeLowAltK).toBeLessThan(1);
    expect(ATMOSPHERE.hazeLowAltLo).toBeLessThan(ATMOSPHERE.hazeLowAltHi);
  });

  it("the horizon anchor is tinted, not white (whiteness strictly below 1)", () => {
    expect(ATMOSPHERE.skyHorizonWhiteness).toBeLessThan(1);
    expect(ATMOSPHERE.skyHorizonWhiteness).toBeGreaterThan(0);
  });
});

describe("the shipped base-rig horizon (directional LOOK + RC24 tint, T96)", () => {
  it("the ftwAirSun / ftwAirLevel port agrees with lib/globe/duskLight's CPU twin", () => {
    for (let i = 0; i <= 400; i++) {
      const x = -1 + i / 200;
      expect(ftwAirSun(x)).toBeCloseTo(airSun(x, ULTRA.airMiePow), 12);
      expect(ftwAirLevel(x)).toBeCloseTo(
        airLevel(x, ULTRA.airRayleighK, ULTRA.airMiePow, ULTRA.airMieGain),
        12,
      );
    }
    expect(ftwAirLevel(1)).toBeCloseTo(1, 12); // normalised: looking into the sun reads 1
  });

  it("the daytime inputs are what the twin assumes (skyLevel 1, afterglow 0, both tints = skyHorizon)", () => {
    const day = baseRigDay();
    expect(day.skyLevel).toBe(1);
    expect(day.afterglow).toBe(0);
    expect(day.dirK).toBe(ULTRA.domeDirK);
    expect(day.ultraK).toBeGreaterThan(0); // the LOOK is live on the base rig, not 0
    expect(day.ultraK).toBeLessThanOrEqual(ULTRA.domeTintK);
    // The 4-stop tint ramp is all day-stop from tintStopsDeg[0] upward, and that stop AND the
    // anti-solar cool tint both resolve to tokens.skyHorizon (StylizedTiles.ts:3621, :6855).
    const w = rampWeights(ULTRA.tintStopsDeg, Math.sin((ULTRA.tintStopsDeg[0] * Math.PI) / 180));
    expect(w[0]).toBe(1);
  });

  it("with uFtwDirK = 0 and uFtwUltraK = 0 the LOOK twin collapses to the symmetric twin", () => {
    const off: LookInputs = { ...baseRigDay(), dirK: 0, ultraK: 0 };
    for (const hazeAltK of [1, ATMOSPHERE.hazeLowAltK]) {
      const a = horizonSkyLook(hazeAltK, 0.3, off);
      const b = horizonSky(hazeAltK);
      a.forEach((c, i) => expect(c).toBeCloseTo(b[i], 12));
    }
  });

  it("stays under the bloom threshold at every sun azimuth (worst channel AND worst luminance)", () => {
    const w = worstHorizon(baseRigDay());
    expect(w.channelMax).toBeLessThan(BLOOM.threshold);
    expect(w.luminanceMax).toBeLessThan(BLOOM.threshold);
    // …and at street level, where the haze crest is dimmer.
    const street = worstHorizon(baseRigDay(), ATMOSPHERE.hazeLowAltK);
    expect(street.channelMax).toBeLessThan(w.channelMax);
  });

  it("stays under the bloom threshold across the whole golden-free day (sun ≥ GOLDEN.fadeOutHi)", () => {
    // Below 30° the haze curve is above its plateau (0.64 at 6°), so uFtwUltraK is larger than
    // the high-sun value; hGold is 0 only from GOLDEN.fadeOutHi (sin 21°) up, which is where this
    // twin's "no golden" premise holds. The tint stays the day stop throughout (≥ 10°).
    for (let deg = 90; deg >= 0; deg -= 0.25) {
      const s = Math.sin((deg * Math.PI) / 180);
      if (s < GOLDEN.fadeOutHi) break;
      const inp: LookInputs = {
        ...baseRigDay(),
        ultraK: bandCurve(ULTRA.hazeCurve, s) * ULTRA.domeTintK,
        skyLevel: bandCurve(ULTRA.skyLevelCurve, s),
        afterglow: bandCurve(ULTRA.afterglowCurve, s),
      };
      expect(rampWeights(ULTRA.tintStopsDeg, s)[0]).toBe(1);
      const w = worstHorizon(inp);
      expect(w.channelMax).toBeLessThan(BLOOM.threshold);
      expect(w.luminanceMax).toBeLessThan(BLOOM.threshold);
    }
  });

  it("the margin is pinned, and a raised domeDirK is VISIBLE to the twin (2026-09-17 recomputation)", () => {
    const shipped = worstHorizon(baseRigDay());
    const raised = worstHorizon({ ...baseRigDay(), dirK: ULTRA.domeDirK + 0.05 });
    // The knob is live in the twin: raising it moves the worst case (the thing the pre-T96 twin
    // could not see — audit 2026-09-11 finding C1).
    expect(raised.channelMax).toBeGreaterThan(shipped.channelMax);
    // Positive margin at the shipped value. domeDirK + 0.05 does NOT cross 0.9 (the directional
    // haze term at cosG = 1 is only ~0.0007 above the symmetric one), so the margin is pinned
    // numerically rather than by a crossing.
    expect(BLOOM.threshold - shipped.channelMax).toBeGreaterThan(0);
    expect(BLOOM.threshold - raised.channelMax).toBeGreaterThan(0);
    // THE 2026-09-17 RECOMPUTATION of the shipped worst case — worst channel (blue) 0.8975 at
    // cosG = 1, luminance 0.6732 at cosG = 1, margin 0.0025 (0.27 %) under BLOOM.threshold 0.9.
    // A palette / gain / domeTintK / domeDirK / hazeCurve change moves these: re-pin CONSCIOUSLY.
    expect(shipped.channelMax).toBeCloseTo(0.8975, 2);
    expect(shipped.channelMax).toBeCloseTo(0.8975, 3); // |Δ| < 0.0005 — tighter than the margin
    expect(shipped.cosGAtChannelMax).toBeCloseTo(1, 6);
    expect(shipped.luminanceMax).toBeCloseTo(0.6732, 3);
    expect(BLOOM.threshold - shipped.channelMax).toBeCloseTo(0.0025, 3);
  });
});
