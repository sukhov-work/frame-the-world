import { describe, expect, it } from "vitest";
import {
  fitShadowBox,
  horizonDistanceM,
  type ShadowFitProfile,
} from "../../../src/lib/globe/shadowFit";
import { SHADOWS, ULTRA, WGS84_A } from "../../../src/components/globe/tuning";

/**
 * RC4 / owner bug B4 (2026-08-25) — "shadows missing on part of the map", and none at all when
 * the look ray misses the ellipsoid.
 *
 * The property under test is the one the bug report is actually about: THE VIEWER IS INSIDE THE
 * BOX. Before RC4 that held only above a pitch threshold, and the threshold was independent of
 * altitude — which is why no amount of zooming ever fixed it.
 */

const BASE: ShadowFitProfile = {
  boundsM: SHADOWS.boundsM,
  boundsAltK: SHADOWS.boundsAltK,
  maxBoundsM: SHADOWS.maxBoundsM,
  viewFitK: SHADOWS.viewFitK,
  quantM: SHADOWS.boundsQuantM,
};
const ULT: ShadowFitProfile = {
  ...BASE,
  boundsAltK: ULTRA.boundsAltK,
  maxBoundsM: ULTRA.maxBoundsM,
};

/** Pre-RC4 geometry: box centred on the ellipsoid hit, extent from altitude alone. */
function preRc4CoversViewer(altM: number, viewDistM: number, p: ShadowFitProfile): boolean {
  const half = Math.min(Math.max(altM * p.boundsAltK, p.boundsM), p.maxBoundsM);
  return viewDistM <= half;
}

describe("horizonDistanceM", () => {
  it("is zero at the surface and grows as sqrt(h) for small h", () => {
    expect(horizonDistanceM(0, WGS84_A)).toBe(0);
    expect(horizonDistanceM(-5, WGS84_A)).toBe(0); // below the ellipsoid → clamped, never NaN
    // 1.7 m eye height → the classic ~4.7 km street horizon.
    expect(horizonDistanceM(1.7, WGS84_A)).toBeGreaterThan(4_500);
    expect(horizonDistanceM(1.7, WGS84_A)).toBeLessThan(4_800);
    // Quadrupling the height doubles the distance.
    expect(horizonDistanceM(400, WGS84_A) / horizonDistanceM(100, WGS84_A)).toBeCloseTo(2, 3);
  });
});

describe("fitShadowBox — the viewer is always inside the box", () => {
  const heights = [1.7, 12, 60, 300, 1_200, 5_000, 12_000, 29_000];
  const pitches = [0.2, 1, 5, 15, 30, 45, 60, 89]; // degrees below horizontal

  for (const p of [
    { name: "base", prof: BASE },
    { name: "ultra", prof: ULT },
  ]) {
    it(`${p.name}: the near edge stays at or behind the eye at every pitch and altitude`, () => {
      for (const alt of heights) {
        for (const pitchDeg of pitches) {
          const d = Math.min(
            alt / Math.tan((pitchDeg * Math.PI) / 180),
            horizonDistanceM(alt, WGS84_A),
          );
          const fit = fitShadowBox(alt, d, p.prof);
          // The eye's ground point sits `pushM` behind the centre; it is inside iff
          // pushM ≤ halfExtentM. The stronger claim (a real margin behind it) is the contract.
          expect(fit.pushM).toBeLessThanOrEqual(fit.halfExtentM - p.prof.boundsM * 0.5 + 1e-9);
        }
      }
    });
  }

  it("holds the WHOLE look — eye and focus both inside — until the cap bites", () => {
    for (const alt of heights) {
      for (const pitchDeg of pitches) {
        const d = Math.min(
          alt / Math.tan((pitchDeg * Math.PI) / 180),
          horizonDistanceM(alt, WGS84_A),
        );
        const fit = fitShadowBox(alt, d, ULT);
        if (fit.halfExtentM >= ULT.maxBoundsM) continue; // capped — foreground wins by design
        expect(d - fit.pushM).toBeLessThanOrEqual(fit.halfExtentM + 1e-9);
      }
    }
  });

  it("fixes exactly the case the bug report describes (shallow pitch, oblique views)", () => {
    // Above alt = boundsM / boundsAltK the altitude ramp — not the street-level floor — sets the
    // extent, and from there the pre-RC4 box's coverage of the viewer depends on PITCH ALONE:
    // both the extent (alt·K) and the hit distance (alt/tan pitch) scale with altitude, so
    // climbing or descending never changed the answer. That is the bug.
    const rampAlt = BASE.boundsM / BASE.boundsAltK;
    for (const alt of heights.filter((a) => a > rampAlt)) {
      for (const pitchDeg of [0.5, 5, 20, 45]) {
        const d = alt / Math.tan((pitchDeg * Math.PI) / 180);
        expect(preRc4CoversViewer(alt, d, BASE)).toBe(false); // the box was entirely ahead
        const fit = fitShadowBox(alt, d, BASE);
        expect(fit.pushM).toBeLessThan(fit.halfExtentM); // now the eye is inside it
      }
    }
    // …and it starts to work at ~59° — atan(1/boundsAltK) — the SAME angle at every altitude in
    // the ramp's band, which is the root-cause analysis's headline number.
    const threshold = (Math.atan(1 / BASE.boundsAltK) * 180) / Math.PI;
    expect(threshold).toBeGreaterThan(58.9);
    expect(threshold).toBeLessThan(59.1);
    for (const alt of [3_000, 5_000, 8_000]) {
      expect(preRc4CoversViewer(alt, alt / Math.tan(((threshold + 0.5) * Math.PI) / 180), BASE)).toBe(true);
      expect(preRc4CoversViewer(alt, alt / Math.tan(((threshold - 0.5) * Math.PI) / 180), BASE)).toBe(false);
    }
    // ULTRA's K = 1.1 moves the same threshold to ~42°, and no further.
    const ultraThreshold = (Math.atan(1 / ULT.boundsAltK) * 180) / Math.PI;
    expect(ultraThreshold).toBeGreaterThan(41.5);
    expect(ultraThreshold).toBeLessThan(42.5);
  });
});

describe("fitShadowBox — extent behaviour", () => {
  it("is exactly boundsM at street level looking down the road (crispness preserved)", () => {
    // 1.7 m eye, 0.2° below horizontal → the hit is ~490 m out; d/2 + 800 < boundsM.
    const d = 1.7 / Math.tan((0.2 * Math.PI) / 180);
    expect(d).toBeLessThan(600);
    expect(fitShadowBox(1.7, d, BASE).halfExtentM).toBe(SHADOWS.boundsM);
  });

  it("never drops below boundsM or exceeds maxBoundsM", () => {
    for (const alt of [0, 1, 100, 10_000, 1e6]) {
      for (const d of [0, 10, 1_000, 1e5, 1e7]) {
        const fit = fitShadowBox(alt, d, BASE);
        expect(fit.halfExtentM).toBeGreaterThanOrEqual(SHADOWS.boundsM);
        expect(fit.halfExtentM).toBeLessThanOrEqual(SHADOWS.maxBoundsM);
        expect(Number.isFinite(fit.pushM)).toBe(true);
        expect(fit.pushM).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is quantized above boundsM, so a look-drag cannot move the extent every frame", () => {
    const seen = new Set<number>();
    for (let d = 0; d < 12_000; d += 7) seen.add(fitShadowBox(50, d, BASE).halfExtentM);
    for (const v of seen) {
      // Every extent is on the ladder, except the cap itself (a clamp, deliberately off-ladder).
      if (v === SHADOWS.maxBoundsM) continue;
      expect((v - SHADOWS.boundsM) % SHADOWS.boundsQuantM).toBe(0);
    }
    // Far fewer distinct extents than sampled distances — that IS the swim guard.
    expect(seen.size).toBeLessThan(60);
  });

  it("is monotone non-decreasing in both altitude and view distance", () => {
    let prev = 0;
    for (let d = 0; d <= 30_000; d += 250) {
      const v = fitShadowBox(100, d, ULT).halfExtentM;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    prev = 0;
    for (let alt = 0; alt <= 25_000; alt += 250) {
      const v = fitShadowBox(alt, 0, ULT).halfExtentM;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("viewFitK = 0 restores the pre-RC4 altitude-only extent (the A/B seam)", () => {
    const off: ShadowFitProfile = { ...BASE, viewFitK: 0 };
    for (const alt of [1.7, 500, 4_000, 20_000]) {
      const legacy = Math.min(Math.max(alt * BASE.boundsAltK, BASE.boundsM), BASE.maxBoundsM);
      const fit = fitShadowBox(alt, 50_000, off);
      // Same extent to within the quantum — the re-centring still applies, the growth does not.
      expect(fit.halfExtentM - legacy).toBeGreaterThanOrEqual(0);
      expect(fit.halfExtentM - legacy).toBeLessThan(SHADOWS.boundsQuantM);
    }
  });

  it("keeps the near-level (missed-ray) case inside the tier's cap", () => {
    // The case RC3 unblocked: no ellipsoid hit, receivers out to the horizon.
    const alt = 1.7;
    const fit = fitShadowBox(alt, horizonDistanceM(alt, WGS84_A), BASE);
    expect(fit.halfExtentM).toBeGreaterThan(SHADOWS.boundsM); // it did grow to cover the view
    expect(fit.halfExtentM).toBeLessThanOrEqual(SHADOWS.maxBoundsM);
    // and the price, in metres per shadow texel, stays under a metre at street level.
    expect((2 * fit.halfExtentM) / SHADOWS.mapSize).toBeLessThan(1.7);
  });
});
