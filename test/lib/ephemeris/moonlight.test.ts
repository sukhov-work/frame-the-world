import { describe, expect, it } from "vitest";
import { moonPhaseIntensity } from "../../../src/lib/ephemeris/moonlight";
import { bodyStatesAt } from "../../../src/lib/ephemeris/bodies";

/** K&S 1991 anchors, computed directly from the published polynomial (PASP 103, 1033):
 *  I(α)/I(0) = 10^(−0.4(0.026α + 4e−9·α⁴)). The DoD-pinned fact: quarter ≈ 9% of full. */
describe("moonPhaseIntensity (Krisciunas & Schaefer 1991)", () => {
  it("full moon is the unit anchor", () => {
    expect(moonPhaseIntensity(0)).toBe(1);
  });

  it("quarter moon delivers ~9% of full (the S5 DoD number — NOT 50%)", () => {
    const q = moonPhaseIntensity(90);
    expect(q).toBeGreaterThan(0.085);
    expect(q).toBeLessThan(0.098); // 10^(−0.4(2.34 + 0.2624)) ≈ 0.0911
  });

  it("gibbous (45°) ≈ 33% — the moon-shadow gate edge (illum 0.85)", () => {
    expect(moonPhaseIntensity(45.57)).toBeCloseTo(0.33, 1);
  });

  it("new moon is photometrically dark", () => {
    expect(moonPhaseIntensity(180)).toBeLessThan(1e-3);
  });

  it("is monotonically decreasing over 0..180 and symmetric in sign", () => {
    let prev = Infinity;
    for (let a = 0; a <= 180; a += 5) {
      const v = moonPhaseIntensity(a);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(moonPhaseIntensity(-90)).toBe(moonPhaseIntensity(90));
  });

  it("clamps out-of-range angles instead of exploding (α⁴ term)", () => {
    expect(moonPhaseIntensity(720)).toBe(moonPhaseIntensity(180));
  });
});

describe("bodyStatesAt phase-angle plumbing", () => {
  it("phase_fraction and phase_angle agree via (1 + cos α)/2", () => {
    const s = bodyStatesAt(Date.UTC(2026, 5, 29, 21, 0, 0));
    const expected = (1 + Math.cos((s.moonPhaseAngleDeg * Math.PI) / 180)) / 2;
    expect(s.moonIllumination).toBeCloseTo(expected, 3);
    expect(s.moonPhaseAngleDeg).toBeGreaterThanOrEqual(0);
    expect(s.moonPhaseAngleDeg).toBeLessThanOrEqual(180);
  });
});
