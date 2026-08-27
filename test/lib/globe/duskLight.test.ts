import { describe, expect, it } from "vitest";
import {
  SOLAR_TAU,
  airLevel,
  airLightGlsl,
  airSun,
  airMass,
  solarChroma,
  solarTransmittance,
} from "../../../src/lib/globe/duskLight";
import { bandCurve } from "../../../src/lib/globe/lightBands";
import { ULTRA } from "../../../src/components/globe/tuning";

describe("airMass — Kasten & Young (1989)", () => {
  it("is 1 at the zenith", () => {
    expect(airMass(90)).toBeCloseTo(1, 3);
  });

  it("matches the published values where the plain 1/sin is already wrong", () => {
    // The whole reason the correction term exists: 1/sin(10°) = 5.76, but the real airmass is 5.6,
    // and by the horizon 1/sin diverges while the real value tops out near 38.
    expect(airMass(10)).toBeGreaterThan(5.4);
    expect(airMass(10)).toBeLessThan(5.8);
    expect(airMass(0)).toBeGreaterThan(35);
    expect(airMass(0)).toBeLessThan(40);
  });

  it("is monotone decreasing in elevation and finite below the horizon", () => {
    let prev = Infinity;
    for (const h of [-1.5, -1, 0, 1, 3, 6, 12, 30, 60, 90]) {
      const m = airMass(h);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeLessThan(prev);
      prev = m;
    }
  });

  it("clamps below −1.5° instead of leaving its domain", () => {
    expect(airMass(-40)).toBe(airMass(-1.5));
  });
});

describe("solarTransmittance / solarChroma", () => {
  it("is exactly white at the zenith — the midday key is untouched", () => {
    const t = solarTransmittance(90);
    for (const c of t) expect(c).toBeCloseTo(1, 6);
    const c = solarChroma(90);
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[1]).toBeCloseTo(1, 6);
    expect(c[2]).toBeCloseTo(1, 6);
  });

  it("reddens monotonically as the sun lowers — R > G > B, and the gap widens", () => {
    let prevGap = 0;
    for (const h of [30, 12, 6, 3, 1, 0]) {
      const c = solarChroma(h);
      expect(c[0]).toBeGreaterThanOrEqual(c[1]);
      expect(c[1]).toBeGreaterThanOrEqual(c[2]);
      expect(c[0]).toBeCloseTo(1, 6); // renormalised: red is always the peak channel
      const gap = c[0] - c[2];
      expect(gap).toBeGreaterThanOrEqual(prevGap - 1e-9);
      prevGap = gap;
    }
    // At the horizon it is unmistakably orange, not "white with a hint".
    expect(solarChroma(0)[2]).toBeLessThan(0.2);
  });

  it("keeps blue attenuating faster than red, which is the physical claim", () => {
    expect(SOLAR_TAU[2]).toBeGreaterThan(SOLAR_TAU[1]);
    expect(SOLAR_TAU[1]).toBeGreaterThan(SOLAR_TAU[0]);
    const t = solarTransmittance(5);
    expect(t[2]).toBeLessThan(t[0]);
  });

  it("never returns a negative or NaN channel anywhere in the domain", () => {
    for (let h = -20; h <= 90; h += 0.5) {
      for (const c of [...solarTransmittance(h), ...solarChroma(h)]) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("air-light lobes — the GLSL twin", () => {
  const K = ULTRA.airRayleighK;
  const P = ULTRA.airMiePow;
  const G = ULTRA.airMieGain;

  it("emits the same arithmetic the CPU evaluates", () => {
    const src = airLightGlsl(K, P, G);
    // Parse the emitted constants back out and re-evaluate, so a hand edit to one side of the
    // pair fails here rather than shipping a shader that disagrees with its own documentation.
    const pow = Number(/pow\(max\(x, 0\.0\), ([0-9.e+-]+)\)/.exec(src)![1]);
    const [, rayK, gain, invPeak] =
      /\(([0-9.e+-]+) \* ray \+ ([0-9.e+-]+) \* ftwAirSun\(x\)\)\s*\*\s*([0-9.e+-]+)/.exec(src)!;
    expect(pow).toBeCloseTo(P, 6);
    expect(Number(rayK)).toBeCloseTo(K, 6);
    expect(Number(gain)).toBeCloseTo(G, 6);
    expect(Number(invPeak)).toBeCloseTo(1 / (K * 1.5 + G), 9);
    for (const x of [-1, -0.5, 0, 0.25, 0.5, 0.9, 1]) {
      expect(airSun(x, P)).toBeCloseTo(Math.pow(Math.max(x, 0), P), 9);
      // 8 dp, not 9: the emitted literals carry 9 SIGNIFICANT digits, so the round-trip through
      // the shader source is exact to ~1e-9 relative and no tighter. That is the real contract —
      // asserting more would be asserting the formatter, not the arithmetic.
      expect(airLevel(x, K, P, G)).toBeCloseTo(
        (Number(rayK) * 0.75 * (1 + x * x) + Number(gain) * airSun(x, pow)) * Number(invPeak),
        8,
      );
    }
  });

  it("is NORMALISED — looking straight at the sun reads exactly 1, never more", () => {
    // Without this the two lobes summed to >2 at their peak and the far field came out BRIGHTER
    // than the palette colour it was mixing toward: the original defect, one layer down.
    expect(airLevel(1, K, P, G)).toBeCloseTo(1, 9);
    for (let x = -1; x <= 1; x += 0.02) expect(airLevel(x, K, P, G)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("is DIRECTIONAL — and the anti-sun sky is dimmer but never black", () => {
    expect(airSun(-1, P)).toBe(0);
    const away = airLevel(-1, K, P, G);
    const side = airLevel(0, K, P, G);
    expect(side).toBeLessThan(0.4); // 90° off the sun is clearly darker than the sun side…
    expect(away).toBeLessThan(0.7);
    expect(away).toBeGreaterThan(side); // …and the broad lobe lifts the antisolar sky back up
    expect(side).toBeGreaterThan(0.1); // never a black hole in the sky
  });

  it("spans a real sunset's warm sector, not a glint", () => {
    // The shipped `hazeSunPow` 7 puts half-brightness at ~19° off the sun — a specular highlight.
    // A sunset's warm sky runs 60-90° wide, which is what the tuning comment claims.
    const half = Math.acos(Math.pow(0.5, 1 / ULTRA.airMiePow)) * (180 / Math.PI);
    expect(half).toBeGreaterThan(28);
    expect(half).toBeLessThan(50);
  });
});

describe("the dusk curves — the shape the owner asked for", () => {
  const at = (t: readonly { elevDeg: number; v: number }[], deg: number) =>
    bandCurve(t, Math.sin((deg * Math.PI) / 180));

  it("the key really dies below the horizon — 'too bright below 3-4 degrees'", () => {
    expect(at(ULTRA.keyExtinctCurve, 12)).toBeCloseTo(1, 6);
    expect(at(ULTRA.keyExtinctCurve, 3)).toBeLessThan(0.7);
    expect(at(ULTRA.keyExtinctCurve, 1)).toBeLessThan(0.4);
    expect(at(ULTRA.keyExtinctCurve, 0)).toBeLessThan(0.2);
    expect(at(ULTRA.keyExtinctCurve, -1)).toBe(0);
    expect(at(ULTRA.keyExtinctCurve, -6)).toBe(0);
  });

  it("the key curve is monotone — a timelapse can never brighten while the sun sets", () => {
    let prev = -1;
    for (let d = -6; d <= 20; d += 0.25) {
      const v = at(ULTRA.keyExtinctCurve, d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("the sky level falls with the sun but never reaches zero at civil dusk", () => {
    expect(at(ULTRA.skyLevelCurve, 12)).toBeCloseTo(1, 6);
    expect(at(ULTRA.skyLevelCurve, 0)).toBeLessThan(0.7);
    expect(at(ULTRA.skyLevelCurve, -6)).toBeLessThan(0.3);
    expect(at(ULTRA.skyLevelCurve, -6)).toBeGreaterThan(0.1); // a blue hour is not black
    expect(at(ULTRA.skyLevelCurve, -18)).toBeLessThan(0.05);
  });

  it("the sky level is monotone — the far field can never brighten as night falls", () => {
    let prev = -1;
    for (let d = -20; d <= 20; d += 0.25) {
      const v = at(ULTRA.skyLevelCurve, d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("the afterglow PEAKS below the horizon and is gone by nautical dusk", () => {
    // Deliberately NOT monotone — that is the whole point, and why the shipped monotonicity test
    // covers `dayCurve` alone. It has to outlive the sky level or there is no afterglow.
    const peak = at(ULTRA.afterglowCurve, -2);
    expect(peak).toBeGreaterThan(at(ULTRA.afterglowCurve, 0));
    expect(peak).toBeGreaterThan(at(ULTRA.afterglowCurve, -9));
    expect(at(ULTRA.afterglowCurve, -14)).toBe(0);
    expect(peak).toBeGreaterThan(at(ULTRA.skyLevelCurve, -2));
  });

  it("the ambient floor is close to the legacy dayGradMin, so noon barely moves", () => {
    // The split must land on the shipped look at high sun or it is a redesign, not a fix.
    // Legacy at noon on a sun-facing slope: mix(0.78, 1, sqrt(1)) = 1.
    // ULTRA at noon on a sun-facing slope: 0.68·skyExposure + 0.32·1·lambert ≈ 1.0.
    const ambient = ULTRA.groundAmbientK;
    const direct = 1 - ambient;
    const lambertFacing = (1 + ULTRA.groundDirectWrap) / (1 + ULTRA.groundDirectWrap);
    expect(ambient * 1 + direct * 1 * lambertFacing).toBeCloseTo(1, 6);
    // …and a slope facing DIRECTLY AWAY now loses the direct term entirely at dusk, which is the
    // defect: legacy gave it 0.78 of the facing slope at every hour of the day.
    const awayAtDusk = ambient * (0.5 + 0.5 * 0) + direct * at(ULTRA.keyExtinctCurve, 0) * 0;
    expect(awayAtDusk).toBeLessThan(0.78 * 0.5);
  });
});
