import { describe, expect, it } from "vitest";
import { bandCurve } from "../../../src/lib/globe/lightBands";
import { aboveGateK, type KeyGateProfile } from "../../../src/lib/globe/keyHandoff";
import { shadowDirectShareK, shadowLengthK } from "../../../src/lib/globe/duskLight";
import { DRAPE, EARTH, GROUND, SHADOWS, ULTRA } from "../../../src/components/globe/tuning";

/**
 * THE NUMBER THE OWNER IS ACTUALLY LOOKING AT (taste pass, 2026-08-27c).
 *
 * *"notice how bright are the mountains just below the sun which should be in complete shadow at
 *  this point."* That is a RATIO — the shade a slope facing directly away from the sun gets against
 *  the shade a slope facing into it gets — and the first dusk pass left it at **0.969 at a +2°
 *  sun**: a mountain in complete shadow rendering at 96.9 % of one in full sun.
 *
 * This file is the JS twin of the shipped `imageryGround` shade chain (the `skyBudget.test.ts`
 * idiom — keep them in sync), and it earned its place twice while being written: it caught a sign
 * error in its own geometry, and then it refuted the first version of the azimuth term, which
 * reused the air-light's Mie lobe and moved the ratio by 0.06 instead of the 0.3 the arithmetic on
 * paper had promised. A surface integrates a whole hemisphere; a lobe is one ray.
 */

const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The ULTRA knobs this twin lets a test knock back to their pre-fix values. */
interface Knobs {
  groundAmbientAzK: number;
  groundAmbientLevelK: number;
  photo3dShadePow: number;
}

/**
 * One terrain fragment's `shade`, exactly as the shader computes it in 3D satellite mode
 * (`uFtwDark` 0, `uFtwFlat2d` 0, `uFtwHiAlt` 0).
 *
 * @param facing true = tilted TOWARD the sun's azimuth, false = directly away.
 */
function shadeAt(
  elevDeg: number,
  slopeDeg: number,
  facing: boolean,
  ultra: boolean,
  over: Partial<Knobs> = {},
): number {
  const K: Knobs = {
    groundAmbientAzK: ULTRA.groundAmbientAzK,
    groundAmbientLevelK: ULTRA.groundAmbientLevelK,
    photo3dShadePow: ULTRA.photo3dShadePow,
    ...over,
  };
  const sinElev = sinDeg(elevDeg);
  const u = ultra ? 1 : 0; // uFtwUltraLight
  // The angle between the normal and the sun is (90 − elev) ∓ slope; the anti-sun case is the PLUS
  // branch and runs past 90°, where the cosine is already negative. (An earlier draft negated it
  // as well and reported 0.96 for a fix that works.)
  const nSun = Math.cos(((90 - elevDeg + (facing ? -slopeDeg : slopeDeg)) * Math.PI) / 180);
  const nUp = Math.cos((slopeDeg * Math.PI) / 180);

  const legacyDayK = (() => {
    const t = clamp01((sinElev - EARTH.termBand[0]) / (EARTH.termBand[1] - EARTH.termBand[0]));
    return t * t * (3 - 2 * t);
  })();
  const dayK = mix(legacyDayK, bandCurve(ULTRA.dayCurve, sinElev), u);
  const directK = ultra ? bandCurve(ULTRA.keyExtinctCurve, sinElev) : 1;
  const skyLevel = ultra ? bandCurve(ULTRA.skyLevelCurve, sinElev) : 0;

  const legacyShade = mix(EARTH.dayGradMin, 1, Math.sqrt(Math.max(nSun, 0)));
  const skyExposure = mix(1, 0.5 + 0.5 * nUp, ULTRA.groundAmbientSkyK);
  const azK = K.groundAmbientAzK * Math.pow(clamp01(1 - directK), ULTRA.groundAmbientAzPow);
  const skyAz = mix(1, 0.5 + 0.5 * nSun, ultra ? azK : 0);
  const lambert = Math.max((nSun + ULTRA.groundDirectWrap) / (1 + ULTRA.groundDirectWrap), 0);
  const dayShadeU =
    ULTRA.groundAmbientK * skyExposure * skyAz * mix(1, skyLevel, K.groundAmbientLevelK) +
    (1 - ULTRA.groundAmbientK) * directK * lambert;
  const dayShade = mix(legacyShade, dayShadeU, u);

  let shade = mix(GROUND.nightFloor * mix(1, skyLevel, u), dayShade, dayK);
  const photoShade = ultra
    ? ULTRA.photo3dK * mix(1, Math.pow(clamp01(directK), K.photo3dShadePow), u)
    : 0;
  shade = mix(shade, 1, photoShade);
  return shade;
}

const SLOPE = 30;
const lit = (d: number, u: boolean, o?: Partial<Knobs>) => shadeAt(d, SLOPE, true, u, o);
const dark = (d: number, u: boolean, o?: Partial<Knobs>) => shadeAt(d, SLOPE, false, u, o);
const ratioAt = (d: number, u: boolean, o?: Partial<Knobs>) => dark(d, u, o) / lit(d, u, o);

describe("the anti-sun / sun-facing shade ratio", () => {
  it("REGRESSION — a +2° sun no longer leaves the shadowed face at 97 % of the lit one", () => {
    expect(ratioAt(2, true)).toBeLessThan(0.72);
    expect(ratioAt(2, true)).toBeGreaterThan(0.15); // …and not a black cut-out either
  });

  it("separates further all the way down to the horizon", () => {
    // Monotone only ABOVE the horizon, and deliberately so: once the direct term is gone there is
    // no sun to face, the remaining light is the (broad) sky, and the two faces converge again.
    // That is the physics, not a regression — the frame is very dark by then (next test).
    const rs = [10, 6, 3, 2, 1, 0].map((d) => ratioAt(d, true));
    for (let i = 1; i < rs.length; i++) expect(rs[i]).toBeLessThanOrEqual(rs[i - 1] + 1e-9);
    expect(rs.at(-1)!).toBeLessThan(0.7);
    expect(rs[0]).toBeGreaterThan(0.8); // …and it has NOT collapsed at a still-high sun
  });

  it("the scene also DARKENS — the ratio is not bought by lifting the shadow side", () => {
    // "instead of naturally darkening scene and sky". Absolute shade on a LIT slope:
    const l = [50, 10, 3, 2, 0].map((d) => lit(d, true));
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
    expect(lit(50, true)).toBeGreaterThan(0.9);
    expect(lit(2, true)).toBeLessThan(0.55);
    expect(dark(2, true)).toBeLessThan(0.4);
  });

  it("leaves NOON essentially where it was — the change is where he was looking", () => {
    expect(Math.abs(ratioAt(50, true) - ratioAt(50, false))).toBeLessThan(0.05);
    // …and the azimuth term is EXACTLY inert at high sun, because its strength is (1 − directK).
    expect(ratioAt(50, true)).toBe(ratioAt(50, true, { groundAmbientAzK: 0 }));
  });

  /**
   * T96 (owner ruling 2026-09-06i) — WHAT THE `ultra` PARAMETER MEANS NOW.
   *
   * The twin's second argument was "is the ULTRA chip on". Since T96 it is "is the LOOK on", and
   * the two are no longer the same question: `lookOn() = ultraOn || ULTRA.baseTakesLook`, and
   * `baseTakesLook` ships TRUE. So the `true` column is what a default `high` user sees, and the
   * `false` column is the pre-T96 base rig — still exact, still pinned, but no longer shipped.
   */
  it("T96 — the BASE rig now runs the MODEL, and that is what shipped", () => {
    expect(ULTRA.baseTakesLook).toBe(true);
    // The ruling, as the number the owner was looking at: a mountain face turned away from a +2°
    // sun used to render at 96.9 % of a face turned into it, on every default install, because the
    // fix rode a chip almost nobody turns on. It does not any more.
    expect(ratioAt(2, true)).toBeLessThan(0.72);
    expect(ratioAt(2, false)).toBeGreaterThan(0.79); // …which is the state it replaces
    // And the replacement is a DARKENING, not a re-balance: the absolute shade on a lit slope at
    // +2° falls too, which is the other half of "naturally darkening scene and sky".
    expect(lit(2, true)).toBeLessThan(lit(2, false));
  });

  it("`baseTakesLook: false` reproduces the OLD base rig exactly — the off-state, re-pointed", () => {
    // The off-state contract is unchanged in KIND: with the look off, no value on this path can
    // change a pixel and every lever reads exactly its pre-track value. What changed is which
    // state ships. This block is the pre-T96 base, preserved to the digit, so the ruling stays a
    // one-line flip rather than a rewrite — and so "false restores it exactly" is checkable.
    for (const d of [50, 10, 2, 0, -4]) {
      const r = ratioAt(d, false);
      expect(r).toBeLessThanOrEqual(1);
      // With the look off the ratio is the legacy dayGradMin ramp diluted by the night floor, so
      // it can only ever RISE toward 1 as the sun sets — the defect, preserved exactly.
      expect(r).toBeGreaterThan(0.79);
      expect(
        ratioAt(d, false, { groundAmbientAzK: 0, groundAmbientLevelK: 0, photo3dShadePow: 0 }),
      ).toBe(r);
    }
  });

  it("names WHICH knob does WHICH job, so neither can be neutralised by accident", () => {
    const base = ratioAt(2, true);
    // The two that move the RATIO…
    expect(ratioAt(2, true, { groundAmbientAzK: 0 })).toBeGreaterThan(base + 0.15);
    expect(ratioAt(2, true, { photo3dShadePow: 0 })).toBeGreaterThan(base + 0.2);
    // …and the one that moves absolute BRIGHTNESS instead. It scales both faces, so it barely
    // touches the ratio — stated here because assuming otherwise is exactly the error this file
    // caught the first time it was written.
    expect(Math.abs(ratioAt(2, true, { groundAmbientLevelK: 0 }) - base)).toBeLessThan(0.02);
    expect(lit(2, true, { groundAmbientLevelK: 0 })).toBeGreaterThan(lit(2, true) * 1.15);
  });
});

/**
 * SUNSET SHADOW-RELEASE (2026-09-06) — the OTHER number the owner is looking at, and the one the
 * ratio above cannot see: the ABSOLUTE brightness of ground that is inside a cast shadow.
 *
 * *"notice how bright are the mountains just below the sun"* — measured at his own Everest FPV
 * pose between geometric sun +1.30° and −0.14°, in-shadow terrain got **× 5.22 brighter**, and
 * across the shipped release band (+1.06° → +0.4584°, 2.7 minutes) **× 6.5**. That is not the
 * ratio this file was written for; both faces of the ridge were correct, and the frame still
 * inverted, because the shadow FIELD was deleted 5.9 minutes before sunset while the ground it
 * darkened was still lit.
 *
 * The twin below is the shipped composition of the three terms that decide an in-shadow pixel —
 * the `ShadowMaterial` overlay opacity (`StylizedTiles.stepKeyLightAndShadow`), the field strength
 * `sunLight.shadow.intensity` that `getShadowMask()` multiplies it by, and the exposure ramp — laid
 * over the same `shadeAt` chain. It reproduces the report's ULTRA table exactly, which is what
 * makes the "before" numbers below quotable rather than asserted.
 */
const EXPOSURE = (deg: number) => bandCurve(ULTRA.exposureCurve, sinDeg(deg));
const DIRECT_K = (deg: number) => bandCurve(ULTRA.keyExtinctCurve, sinDeg(deg));
/** The ULTRA half-extent at the owner's Everest FPV pose (report §7) — the live `shadowBoundsM`. */
const EVEREST_FIT_M = 10_688;

const BASE_GATE: KeyGateProfile = {
  gateSin: SHADOWS.minSunElevSin,
  bandSin: SHADOWS.fadeBandSin,
  moonMinIllum: SHADOWS.moonMinIllum,
  moonIllumSoftFrac: SHADOWS.moonIllumSoftFrac,
};

/** `false` = the pre-fix rig, so every "before" number here is computed, not transcribed. */
function inShadowGround(elevDeg: number, fixed: boolean): number {
  const sinElev = sinDeg(elevDeg);
  const gate = fixed ? ULTRA.shadowGateSin : SHADOWS.minSunElevSin;
  const keyGate: KeyGateProfile = { ...BASE_GATE, gateSin: gate };
  const fieldGate: KeyGateProfile = { ...keyGate, bandSin: ULTRA.shadowFadeBandSin };
  // The field. F2 moves its crossing to true sunset; F3 sizes its band to the solar disc; the
  // length guard is the geometric bound that makes a below-horizon gate safe at all.
  const field =
    aboveGateK(sinElev, fieldGate) *
    (fixed ? shadowLengthK(sinElev, ULTRA.shadowLengthCasterM, EVEREST_FIT_M) : 1);
  // The overlay. `dark01` = 0 (satellite imagery, not the CARTO drape); `eclipseK` = 1.
  const duskK = 1 - aboveGateK(sinElev, keyGate);
  const opacity =
    mix(mix(SHADOWS.groundOpacity, DRAPE.shadowOpacity, 0), ULTRA.groundShadowDuskK, duskK) *
    // F1: the overlay multiplies the WHOLE composite, so it is bounded by the DIRECT share.
    (fixed ? shadowDirectShareK(DIRECT_K(elevDeg), ULTRA.groundAmbientK) : 1);
  const lit = shadeAt(elevDeg, 0, true, true) * EXPOSURE(elevDeg);
  // Below the gate `castShadow` is false and the mask is 1 everywhere — nothing is in shadow.
  return sinElev > gate ? lit * (1 - opacity * field) : lit;
}

/** The worst brightening anywhere down a ladder: how far above its own running minimum a later
 *  (lower) sample climbs. 1 = never brightens. This is the defect, as one number. */
const worstRise = (series: number[]): number => {
  let worst = 1;
  let min = series[0];
  for (const v of series.slice(1)) {
    worst = Math.max(worst, v / min);
    min = Math.min(min, v);
  }
  return worst;
};

describe("the in-shadow ground across sunset", () => {
  const LADDER = [3, 2, 1.06, 0.5, 0.4584, 0, -0.5];

  it("REGRESSION — the shipped rig brightens in-shadow ground × 6.5 as the field is released", () => {
    // The "before", recomputed from the shipped tunables so it cannot rot into a stale comment.
    const before = LADDER.map((d) => inShadowGround(d, false));
    expect(worstRise(before)).toBeGreaterThan(6);
    // …and it is a CLIFF, not a ramp: two adjacent stops 0.60° apart carry the whole of it.
    expect(inShadowGround(1.06, false)).toBeLessThan(0.05);
    expect(inShadowGround(0.4584, false)).toBeGreaterThan(0.29);
  });

  it("the fixed rig turns that cliff into a bounded ramp", () => {
    const after = LADDER.map((d) => inShadowGround(d, true));
    expect(worstRise(after)).toBeLessThan(1.35);
    // The step that WAS the defect — the two frames either side of the old gate — is now flat to
    // within 1 %, against × 6.5 before.
    const across = inShadowGround(0.4584, true) / inShadowGround(1.06, true);
    expect(across).toBeGreaterThan(0.9);
    expect(across).toBeLessThan(1.01);
  });

  it("falls monotonically through the raking hour, which is where the cliff was", () => {
    // +3° → +0.7° is the band the report measured and the owner photographed: the direct arm is
    // still 30-62 % of its high-sun level, the shadow is the most dramatic thing in the frame, and
    // the fixed rig is now STRICTLY decreasing across every stop of it. The shipped rig inverts
    // inside this same window (0.047 at +1.06° → 0.302 at +0.4584°).
    const seq = [3, 2.5, 2, 1.63, 1.2975, 1.06, 0.7].map((d) => inShadowGround(d, true));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThan(seq[i - 1]);
    expect(seq[0]).toBeCloseTo(0.263, 2);
    expect(seq.at(-1)!).toBeCloseTo(0.219, 2);
  });

  it("PRICES the bound: a shadow loses depth between 12° and 3.5°, and by how much", () => {
    // The honest cost of F1, stated as a number so nobody has to rediscover it. `keyExtinctCurve`
    // leaves 1 only above 12°, so the overlay starts shallowing there and an in-shadow pixel
    // brightens ~16 % on the way down to 3.5° — against a scene that darkens 37 % over the same
    // stretch, so CONTRAST falls throughout and only the absolute value drifts. Deeper shapes for
    // the bound flatten this and pay for it in the tail (sqrt(directK) measured: this drift 0.4 %,
    // the post-sunset convergence × 1.46 instead of × 1.29). The share is the derived one and sits
    // between them; this test exists so a future taste pass changes it deliberately.
    const hi = inShadowGround(12, true);
    const lo = inShadowGround(3.457, true);
    expect(lo / hi).toBeGreaterThan(1.1);
    expect(lo / hi).toBeLessThan(1.2);
    // …and it is exactly the shipped value at 12°, where the extinction curve is still 1.
    expect(hi).toBe(inShadowGround(12, false));
    // And the shadow's DEPTH relative to the ground it sits in shrinks monotonically the whole
    // way down — never reversing. That direction is the physics the bound encodes: as the direct
    // arm dies a shadow has less and less to remove, so in-shadow/lit must climb toward 1.
    const contrast = (d: number) =>
      inShadowGround(d, true) / (shadeAt(d, 0, true, true) * EXPOSURE(d));
    const cs = [12, 8, 6, 4, 3.457, 2].map(contrast);
    for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
  });

  it("and the last degree CONVERGES rather than steps — which is the physics, not a fudge", () => {
    // Below +0.5° `keyExtinctCurve` collapses to 0 at −0.5°, so "in shadow" and "lit" become the
    // same surface: there is no direct light left to remove. The in-shadow value therefore has to
    // climb back to the lit one, and the only question is whether it does so in a step or a ramp.
    // No step here may exceed 8 % — the shipped rig's single worst step is × 6.5.
    const tail = [0.5, 0.4584, 0.36, 0.3, 0.2, 0.1, 0, -0.1403, -0.3, -0.5];
    const vals = tail.map((d) => inShadowGround(d, true));
    for (let i = 1; i < vals.length; i++) expect(vals[i] / vals[i - 1]).toBeLessThan(1.08);
    // It lands ON the lit ground, exactly — the release itself is a no-op by then.
    expect(inShadowGround(-0.5, true)).toBe(shadeAt(-0.5, 0, true, true) * EXPOSURE(-0.5));
    // …and the lit ground it lands on is itself still falling, so nothing brightens in absolute
    // terms once the two have met.
    const litTail = [0, -0.5, -1, -2].map((d) => shadeAt(d, 0, true, true) * EXPOSURE(d));
    for (let i = 1; i < litTail.length; i++) expect(litTail[i]).toBeLessThan(litTail[i - 1]);
  });

  it("high sun is BYTE-identical — the overlay bound is exactly 1 where directK is 1", () => {
    // `shadowDirectShareK(1, a)` is exactly 1 and the length guard is exactly 1 far from the
    // horizon, so a daytime frame gets the shipped expression back with no rounding at all.
    for (const d of [50, 30, 12]) {
      expect(inShadowGround(d, true)).toBe(inShadowGround(d, false));
      expect(DIRECT_K(d)).toBe(1);
    }
  });

  it("the gate really did move to the sun's own upper limb — and since T96, on every rig", () => {
    const gateDeg = (Math.asin(ULTRA.shadowGateSin) * 180) / Math.PI;
    expect(gateDeg).toBeCloseTo(-0.8333, 3); // 34' refraction + 16' semidiameter
    // The band now fades the field over the half-degree the horizon takes to eat the disc.
    const topDeg = (Math.asin(ULTRA.shadowGateSin + ULTRA.shadowFadeBandSin) * 180) / Math.PI;
    expect(topDeg).toBeCloseTo(-0.3, 2);
    // T96 (owner ruling 2026-09-06i): the base rig READS `ULTRA.shadowGateSin` now — a field
    // released 5.9 minutes before sunset is wrong on every rig, and the owner reported it on a
    // default `high` frame. The pre-T96 constant is UNCHANGED and still live behind
    // `baseTakesLook: false`, which is what makes the ruling reversible rather than destructive.
    expect(ULTRA.baseTakesLook).toBe(true);
    expect(SHADOWS.minSunElevSin).toBe(0.008);
    expect((Math.asin(SHADOWS.minSunElevSin) * 180) / Math.PI).toBeCloseTo(0.4584, 3);
    // The gate the base rig actually uses, expressed the way `StylizedTiles.stepKeyLightAndShadow`
    // selects it (`lookOn() ? ULTRA.shadowGateSin : SHADOWS.minSunElevSin`) with the chip off.
    const baseGateSin = ULTRA.baseTakesLook ? ULTRA.shadowGateSin : SHADOWS.minSunElevSin;
    expect(baseGateSin).toBe(ULTRA.shadowGateSin);
    // …and the 5.9 minutes it buys back, as a number: 1.29° of solar elevation at the crossing.
    expect(
      (Math.asin(SHADOWS.minSunElevSin) * 180) / Math.PI -
        (Math.asin(ULTRA.shadowGateSin) * 180) / Math.PI,
    ).toBeCloseTo(1.2917, 3);
  });
});
