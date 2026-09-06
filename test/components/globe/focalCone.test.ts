import { describe, expect, it } from "vitest";
import { focalConeFillTiltK } from "../../../src/components/globe/scene/focalCone";
import { CONTROLS, FOCALCONE } from "../../../src/components/globe/tuning";

/**
 * T92 (classified 2026-09-06k2, owner ruled 2026-09-06m option (a)): at `dnipro-cityscape`
 * (`#p=48.46008,35.07720,553,276.7,74.9` — tilt 74.9°) the focal cone's FILL read as a
 * translucent magenta wedge over the right third of the frame. The fix fades the FILL alone
 * across a band of ORBIT tilt and leaves the two boundary rays exactly as they were. The
 * multiplier is a pure function of the tilt, so its whole contract is pinned here; the pixels
 * belong to the `probe-focalcone` gate and the contact sheet.
 */
describe("focalConeFillTiltK — FILL-only grazing-tilt fade (T92, owner 2026-09-06m (a))", () => {
  const K = (tiltDeg: number) => focalConeFillTiltK(tiltDeg);

  it("the band is well-formed inside the orbit tilt clamp, and starts no lower than 50°", () => {
    expect(FOCALCONE.fillTiltFadeStartDeg).toBeLessThan(FOCALCONE.fillTiltFadeEndDeg);
    expect(FOCALCONE.fillTiltFadeStartDeg).toBeGreaterThanOrEqual(CONTROLS.tiltMinDeg);
    expect(FOCALCONE.fillTiltFadeEndDeg).toBeLessThanOrEqual(CONTROLS.tiltMaxDeg);
    // The owner's descent arrives at 54.9° and `legacy-orbit` sits at 40°: a start under 50
    // would dim poses the owner reads the cone at.
    expect(FOCALCONE.fillTiltFadeStartDeg).toBeGreaterThanOrEqual(50);
    // …and the cityscape (74.9°) must land at ≈0, so the band closes before it.
    expect(FOCALCONE.fillTiltFadeEndDeg).toBeLessThanOrEqual(74.9);
  });

  it("EXACTLY 1 (not 0.9999) at every pose below the band — nadir, the descent start, legacy-orbit, the band start itself", () => {
    // The `high` tier must be byte-identical outside the ruled change: the multiplier is the
    // number 1, so `fillAlpha * overlayA * 1` is the pre-T92 product bit for bit.
    for (const tilt of [0, 29.3, 40, 50, FOCALCONE.fillTiltFadeStartDeg]) {
      expect(K(tilt)).toBe(1);
    }
  });

  it("≈0 at the cityscape (74.9°) and exactly 0 at the tilt clamp (88°)", () => {
    expect(K(74.9)).toBeLessThan(0.003); // below the shader's discard gate — nothing is drawn
    expect(K(FOCALCONE.fillTiltFadeEndDeg)).toBe(0);
    expect(K(88)).toBe(0);
    expect(K(CONTROLS.tiltMaxDeg)).toBe(0);
  });

  it("the descent ARRIVAL (54.9°) and the 3D toggle tilt (55°) keep most of the fill", () => {
    // Just inside the band: readable, not gone — the owner reads the cone at the arrival pose.
    expect(K(54.9)).toBeGreaterThan(0.8);
    expect(K(CONTROLS.toggle3dTiltDeg)).toBeGreaterThan(0.8);
    expect(K(CONTROLS.toggle3dTiltDeg)).toBeLessThan(1);
  });

  it("monotone non-increasing across the whole clamp range, bounded in [0, 1]", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let tilt = 0; tilt <= 88; tilt += 0.1) {
      const k = K(tilt);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
  });

  it("is the smoothstep across the band: C¹ at both ends, the midpoint at exactly ½", () => {
    const s = FOCALCONE.fillTiltFadeStartDeg;
    const e = FOCALCONE.fillTiltFadeEndDeg;
    expect(K((s + e) / 2)).toBeCloseTo(0.5, 12);
    // Zero slope at the band edges — the fill neither snaps in nor snaps out.
    const eps = 1e-3;
    expect(K(s + eps)).toBeCloseTo(1, 5);
    expect(K(e - eps)).toBeCloseTo(0, 5);
    // The explicit-band form is the same function the default-band form evaluates.
    expect(focalConeFillTiltK(60, s, e)).toBe(K(60));
  });

  it("DISABLED semantics: start >= end keeps the fill full at every tilt (never a divide-by-zero)", () => {
    for (const [s, e] of [
      [50, 50],
      [70, 50],
      [88, 0],
    ] as const) {
      for (const tilt of [0, 40, 50, 60, 74.9, 88]) {
        expect(focalConeFillTiltK(tilt, s, e)).toBe(1);
      }
    }
  });

  it("a NaN tilt is 'no opinion' — full fill, never a NaN alpha reaching the shader", () => {
    expect(K(Number.NaN)).toBe(1);
    expect(Number.isNaN(focalConeFillTiltK(60, Number.NaN, 70))).toBe(false);
    expect(focalConeFillTiltK(60, Number.NaN, 70)).toBe(1);
  });
});
