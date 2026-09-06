import { describe, expect, it } from "vitest";
import {
  SOLAR_TAU,
  airLevel,
  airLightGlsl,
  airSun,
  airMass,
  shadowDirectShareK,
  shadowLengthK,
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
    const peak = at(ULTRA.afterglowCurve, -5);
    expect(peak).toBeGreaterThan(at(ULTRA.afterglowCurve, 0));
    expect(peak).toBeGreaterThan(at(ULTRA.afterglowCurve, -9));
    expect(at(ULTRA.afterglowCurve, -14)).toBe(0);
    // T66 (owner ruling 2026-09-06i) — RE-POINTED, not relaxed. It still outlives the sky, and
    // the assertion still says so; what moved is WHERE. The shipped table asserted this at −2°,
    // which is precisely where the owner's frame B sits and precisely where the ruling says the
    // afterglow may not outrun the sky: the dome band it feeds is `afterglow × skyLevel` since
    // F4, and a curve that beat `skyLevelCurve` at −2° made that product climb × 1.71 through
    // the half hour after sunset. It now crosses the sky level in the deep tail (−5°, where the
    // sky is 0.28 and the arch is the only thing left in the frame) instead of at the horizon.
    expect(peak).toBeGreaterThan(at(ULTRA.skyLevelCurve, -5));
    // …and the crossing is real, not an artefact of the sample point: below civil dusk the
    // afterglow is the larger of the two everywhere it is still visible.
    for (const d of [-4, -5, -6, -7]) {
      expect(at(ULTRA.afterglowCurve, d)).toBeGreaterThan(at(ULTRA.skyLevelCurve, d));
    }
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

/**
 * SUNSET SHADOW-RELEASE (2026-09-06) — the two bounds that let the shadow field live to true
 * sunset without the release being visible.
 *
 * The measured defect these answer (`verify-shots/sunset-lightpath-report.md` §4): between the
 * owner's two Everest frames — geometric sun +1.30° and −0.14° — terrain that had been in shadow
 * came back **× 5.22 brighter**, because the field was deleted at +0.4584° while a quarter of the
 * direct sun was still on the ground AND the ground overlay was at its deepest-ever 0.855 the
 * frame before it vanished.
 */
describe("shadowDirectShareK — the overlay may never be deeper than the arm it stands for", () => {
  const a = ULTRA.groundAmbientK;

  it("is EXACTLY 1 at full direct sun — the off-state contract, not an approximation", () => {
    // `a + (1 − a)·1 = 1` with no rounding, which is what makes the daytime overlay byte-identical
    // and — because `ultraDirectK` is seeded and re-settled to exactly 1 with the chip off — makes
    // the OFF-state overlay byte-identical too. toBe, not toBeCloseTo, on purpose.
    expect(shadowDirectShareK(1, a)).toBe(1);
    expect(shadowDirectShareK(1, 0.5)).toBe(1);
    expect(shadowDirectShareK(1, 0)).toBe(1);
  });

  it("is 0 when no direct sun survives — a shadow of nothing removes nothing", () => {
    expect(shadowDirectShareK(0, a)).toBe(0);
    expect(shadowDirectShareK(-1, a)).toBe(0); // clamped, never negative opacity
  });

  it("is monotone increasing in directK, and always inside [0, 1]", () => {
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.005) {
      const k = shadowDirectShareK(d, a);
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      prev = k;
    }
    expect(shadowDirectShareK(2, a)).toBe(1); // clamped above, too
  });

  it("bites hardest exactly where the cliff was — the last degree of sunlight", () => {
    // `keyExtinctCurve` levels at the elevations in the report's ULTRA table.
    const at = (deg: number) => bandCurve(ULTRA.keyExtinctCurve, Math.sin((deg * Math.PI) / 180));
    expect(shadowDirectShareK(at(3), a)).toBeCloseTo(0.706, 2);
    expect(shadowDirectShareK(at(1.06), a)).toBeCloseTo(0.432, 2); // the darkest frame, 0.047
    expect(shadowDirectShareK(at(0.4584), a)).toBeCloseTo(0.329, 2); // the old gate, 0.302
    expect(shadowDirectShareK(at(-0.5), a)).toBe(0); // extinction is over; so is the overlay
  });

  it("never NaN, whatever the ambient weight", () => {
    for (const ak of [0, 0.5, 1, -1, 2]) {
      for (const d of [0, 0.3, 1]) {
        expect(Number.isNaN(shadowDirectShareK(d, ak))).toBe(false);
      }
    }
    // a = 1 is an all-ambient ground: there is no reference direct arm to normalise against, so
    // the expression degrades to a plain linear `directK` instead of to 0/0.
    expect(shadowDirectShareK(0.5, 1)).toBe(0.5);
    // a = 0 with d = 0 is the only input that reaches the guard, and it is 0 either way.
    expect(shadowDirectShareK(0, 0)).toBe(0);
  });
});

describe("shadowLengthK — the field fades when its own shadow stops fitting", () => {
  const CASTER = ULTRA.shadowLengthCasterM;
  const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);
  const EVEREST_FIT_M = 10_688; // the ULTRA half-extent at the owner's FPV pose (report §7)

  it("is exactly 1 at any ordinary sun — the raking hour is untouched", () => {
    for (const deg of [90, 30, 6, 3, 1]) {
      expect(shadowLengthK(sinDeg(deg), CASTER, EVEREST_FIT_M)).toBe(1);
    }
  });

  it("is 0 at and below the horizon, where the projected length is infinite or inverted", () => {
    expect(shadowLengthK(0, CASTER, EVEREST_FIT_M)).toBe(0);
    expect(shadowLengthK(sinDeg(-0.5), CASTER, EVEREST_FIT_M)).toBe(0);
    expect(shadowLengthK(-1, CASTER, EVEREST_FIT_M)).toBe(0);
  });

  it("falls as 1/length once the box cannot hold the shadow", () => {
    // Knee at atan(caster / reach) = 0.536° for this box; halved at twice that length.
    const knee = (Math.atan(CASTER / EVEREST_FIT_M) * 180) / Math.PI;
    expect(knee).toBeCloseTo(0.536, 2);
    expect(shadowLengthK(sinDeg(knee), CASTER, EVEREST_FIT_M)).toBeCloseTo(1, 3);
    expect(shadowLengthK(sinDeg(knee / 2), CASTER, EVEREST_FIT_M)).toBeCloseTo(0.5, 2);
    expect(shadowLengthK(sinDeg(knee / 4), CASTER, EVEREST_FIT_M)).toBeCloseTo(0.25, 2);
  });

  it("measured from TRUE SUNSET with the ladder's reach, the owner's frame B still casts (2026-09-06h)", () => {
    // The first cut zeroed the field at geometric 0° while the disc was still up — frame B is
    // −0.14° geometric = +0.36° apparent. With the horizon at the ULTRA gate (−0.833°) and the
    // 260 km cascade as the reach, the knee is atan(100 / 260 000) = 0.022° above true sunset.
    const REACH = Math.max(EVEREST_FIT_M, ...ULTRA.cascades.map((c) => c.maxBoundsM));
    expect(REACH).toBeGreaterThan(100_000);
    expect(shadowLengthK(sinDeg(-0.14), CASTER, REACH, ULTRA.shadowGateSin)).toBe(1);
    expect(shadowLengthK(sinDeg(-0.5), CASTER, REACH, ULTRA.shadowGateSin)).toBe(1);
    expect(shadowLengthK(sinDeg(-0.8), CASTER, REACH, ULTRA.shadowGateSin)).toBeGreaterThan(0.9);
    expect(shadowLengthK(ULTRA.shadowGateSin, CASTER, REACH, ULTRA.shadowGateSin)).toBe(0);
    expect(shadowLengthK(sinDeg(-1.5), CASTER, REACH, ULTRA.shadowGateSin)).toBe(0);
  });

  it("is monotone in elevation and never NaN, including the degenerate inputs", () => {
    let prev = -1;
    for (let deg = -2; deg <= 5; deg += 0.01) {
      const k = shadowLengthK(sinDeg(deg), CASTER, EVEREST_FIT_M);
      expect(Number.isNaN(k)).toBe(false);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = k;
    }
    // A zero/absent box is NO BOUND, not a blackout: `shadowBoundsM` is 0 on the first frames.
    expect(shadowLengthK(sinDeg(0.2), CASTER, 0)).toBe(1);
    expect(shadowLengthK(sinDeg(0.2), 0, EVEREST_FIT_M)).toBe(1);
    // …and a sun at the zenith divides by cos = 0 if written naively.
    expect(shadowLengthK(1, CASTER, EVEREST_FIT_M)).toBe(1);
    expect(Number.isNaN(shadowLengthK(1, CASTER, EVEREST_FIT_M))).toBe(false);
  });
});
