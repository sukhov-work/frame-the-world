import { describe, expect, it } from "vitest";
import { sunExtinctionK } from "../../../src/components/globe/scene/sky";
import { SKY } from "../../../src/components/globe/tuning";

/** CPU twin of the sun impostor's horizon-extinction uniform (owner 2026-08-14: a setting sun
 *  dims "like the real atmosphere does") — the moonDiscArms twin discipline. */
describe("sunExtinctionK", () => {
  it("high sun at street level is untouched", () => {
    expect(sunExtinctionK(45, 1)).toBe(1);
    expect(sunExtinctionK(SKY.sunExtinctAltHiDeg, 1)).toBe(1);
  });

  it("ramps down monotonically toward the horizon", () => {
    let prev = sunExtinctionK(SKY.sunExtinctAltHiDeg, 1);
    for (let alt = SKY.sunExtinctAltHiDeg - 1; alt >= 0; alt--) {
      const k = sunExtinctionK(alt, 1);
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
  });

  it("floors at the tuned value at (and below) 0° — dimmed, never erased", () => {
    expect(sunExtinctionK(0, 1)).toBeCloseTo(SKY.sunExtinctFloor, 12);
    expect(sunExtinctionK(-3, 1)).toBeCloseTo(SKY.sunExtinctFloor, 12);
    expect(SKY.sunExtinctFloor).toBeGreaterThan(0);
  });

  it("relaxes to 1 in space — no air, no extinction (skyK = 0)", () => {
    expect(sunExtinctionK(0, 0)).toBe(1);
    expect(sunExtinctionK(0, 0.5)).toBeCloseTo(1 - 0.5 * (1 - SKY.sunExtinctFloor), 12);
  });
});
