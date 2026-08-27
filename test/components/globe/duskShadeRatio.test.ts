import { describe, expect, it } from "vitest";
import { bandCurve } from "../../../src/lib/globe/lightBands";
import { EARTH, GROUND, ULTRA } from "../../../src/components/globe/tuning";

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

  it("is untouched with the chip OFF at every elevation — the off-state contract", () => {
    for (const d of [50, 10, 2, 0, -4]) {
      const r = ratioAt(d, false);
      expect(r).toBeLessThanOrEqual(1);
      // With the chip off the ratio is the legacy dayGradMin ramp diluted by the night floor, so
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
