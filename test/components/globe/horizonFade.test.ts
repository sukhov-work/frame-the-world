import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { horizonBandSin, horizonTerms } from "../../../src/components/globe/scene/sky";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import { SKY } from "../../../src/components/globe/tuning";

/**
 * True-horizon fade guard (owner 2026-07-15 — the FPV razor-cut fix). The shader fade is
 * smoothstep(uSinHor, uSinHor + uHorizonBandSin, sinEl) over the ray's elevation sine in
 * ellipsoid-scaled space; uSinHor/uHorizonBandSin come from these CPU twins. The OLD metric
 * band produced binary 1/0 at street level (regression this test pins): fade values strictly
 * between 0 and 1 must exist across the band above the TRUE horizon (dip included).
 */
const camAt = (latDeg: number, lonDeg: number, altM: number) => {
  const [x, y, z] = geodeticToEcef(latDeg, lonDeg, altM);
  return { x, y, z };
};

const fade = (sinEl: number, sinHor: number, bandSin: number) =>
  THREE.MathUtils.smoothstep(sinEl, sinHor, sinHor + bandSin);

describe("horizonTerms — true horizon elevation sine (with dip)", () => {
  const up = new THREE.Vector3();

  it("matches the classic dip ≈ √(2h/R) at Dnipro street level (95 m eye)", () => {
    const sinHor = horizonTerms(camAt(48.4647, 35.0462, 95), up);
    const expectedDip = -Math.sqrt((2 * 95) / 6_367_000); // ≈ −0.00546 (−0.313°)
    expect(sinHor).toBeLessThan(0); // below the horizontal — the dip exists
    expect(sinHor).toBeCloseTo(expectedDip, 4);
    expect(up.length()).toBeCloseTo(1, 9);
  });

  it("reaches the LEO limb depression (~32°) at 1,100 km", () => {
    const sinHor = horizonTerms(camAt(48.4647, 35.0462, 1_100_000), up);
    // Spherical bounds with R ∈ [b, a]: sinHor ≈ −sin(acos(R/(R+h))) ≈ −0.52…−0.54.
    expect(sinHor).toBeGreaterThan(-0.56);
    expect(sinHor).toBeLessThan(-0.5);
  });

  it("degrades safely for a camera at/under the surface (transient flight states)", () => {
    const sinHor = horizonTerms(camAt(48.4647, 35.0462, -500), up);
    expect(Math.abs(sinHor)).toBe(0); // horizon pinned at the horizontal (−0 ok) — no NaN
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true);
  });
});

describe("fade across the band — the razor cut is gone", () => {
  const up = new THREE.Vector3();

  it("produces a genuine gradient just above the true horizon at street level", () => {
    const sinHor = horizonTerms(camAt(48.4647, 35.0462, 95), up);
    const band = horizonBandSin(95);
    const mid = fade(sinHor + band / 2, sinHor, band);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    // Above the band: fully visible; below the horizon: fully gone.
    expect(fade(sinHor + band * 1.5, sinHor, band)).toBe(1);
    expect(fade(sinHor - 0.001, sinHor, band)).toBe(0);
    // A body ABOVE the horizontal (old cut line) but at street level stays fully visible.
    expect(fade(Math.sin(THREE.MathUtils.degToRad(0.2)), sinHor, band)).toBe(1);
  });

  it("the band blends street → orbit width with altitude, monotonically", () => {
    const street = horizonBandSin(0);
    const cruise = horizonBandSin((SKY.horizonFadeAltLoM + SKY.horizonFadeAltHiM) / 2);
    const orbit = horizonBandSin(SKY.horizonFadeAltHiM * 2);
    expect(street).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(SKY.horizonFadeStreetDeg)), 9);
    expect(orbit).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(SKY.horizonFadeOrbitDeg)), 9);
    expect(cruise).toBeGreaterThan(street);
    expect(cruise).toBeLessThan(orbit);
  });
});
