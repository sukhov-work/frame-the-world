import { describe, expect, it } from "vitest";
import { horizonFade, pointDirs } from "../../../src/components/globe/scene/dayArcs";
import { enuBasis } from "../../../src/lib/geo/projection";
import { DAYARC } from "../../../src/components/globe/tuning";
import type { DayArcPoint } from "../../../src/lib/ephemeris/dayArc";

/** C3 (audit-2): the day-arc pure twins were exported but untested — pin the band edges and
 *  the ENU→ECEF direction mapping (shared with skyTrail.ts). */

describe("horizonFade — smoothstep melt band across rise/set", () => {
  const lo = DAYARC.horizonFadeLoDeg;
  const hi = DAYARC.horizonFadeHiDeg;

  it("clamps to 0 below the band and 1 above it", () => {
    expect(horizonFade(lo - 10)).toBe(0);
    expect(horizonFade(lo)).toBe(0);
    expect(horizonFade(hi)).toBe(1);
    expect(horizonFade(hi + 10)).toBe(1);
  });

  it("is a genuine smoothstep inside the band (0.5 at the midpoint, monotonic)", () => {
    expect(horizonFade((lo + hi) / 2)).toBeCloseTo(0.5, 9);
    const q1 = horizonFade(lo + (hi - lo) * 0.25);
    const q3 = horizonFade(lo + (hi - lo) * 0.75);
    expect(q1).toBeGreaterThan(0);
    expect(q1).toBeLessThan(0.5);
    expect(q3).toBeGreaterThan(0.5);
    expect(q3).toBeLessThan(1);
    expect(q1 + q3).toBeCloseTo(1, 9); // smoothstep symmetry about the midpoint
  });
});

describe("pointDirs — ENU components ride the anchor basis into ECEF", () => {
  const pt = (t01: number): DayArcPoint => ({ azDeg: 0, altDeg: 0, utcMs: 0, t01 });

  it("maps unit east/north/up inputs onto the basis vectors (orthonormal, length-preserving)", () => {
    const basis = enuBasis(48.4647, 35.0462); // Dnipro anchor
    const axes: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const out = pointDirs([pt(0), pt(0.5), pt(1)], basis, (p) => axes[Math.round(p.t01 * 2)]);
    const expected = [basis.east, basis.north, basis.up];
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      // Float32Array output — float32 tolerance, not float64.
      expect(x).toBeCloseTo(expected[i][0], 6);
      expect(y).toBeCloseTo(expected[i][1], 6);
      expect(z).toBeCloseTo(expected[i][2], 6);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6); // basis is orthonormal
    }
  });

  it("preserves linear combinations (a diagonal ENU direction keeps its length)", () => {
    const basis = enuBasis(0, 0);
    const out = pointDirs([pt(0)], basis, () => [3, 4, 12] as const);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(13, 4); // float32
  });
});
