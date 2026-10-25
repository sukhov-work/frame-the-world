import { describe, expect, it } from "vitest";
import {
  moonAirTerms,
  moonDaySkyK,
  moonDiscArms,
  moonNightShare,
} from "../../../src/components/globe/scene/sky";
import { SKY } from "../../../src/components/globe/tuning";

/**
 * T200 (owner 2026-10-25e/f) — the moon through the air and the dark limb against the current
 * sky: the CPU twins of `uMoonAir` / `uMoonTint` and of the `uDaySky` weight. The invariants
 * these pin are the ones the prior rulings own: at/above the band and from orbit the disc is
 * BYTE-IDENTICAL to the shipped one; by day the arm weight is EXACTLY 1 (the day arm additive
 * only, owner 2026-08-14); at night it is 0; the eclipse factor still multiplies the weight.
 */
describe("moonAirTerms — level + tint by the moon's own altitude", () => {
  it("is exactly the shipped disc at and above the band, and from orbit (skyK 0)", () => {
    for (const alt of [SKY.moonAirHiDeg, 15, 21.3, 45, 90]) {
      const a = moonAirTerms(alt, 1);
      expect(a.level).toBe(1);
      expect(a.tint).toEqual([1, 1, 1]);
    }
    const space = moonAirTerms(2, 0);
    expect(space.level).toBe(1);
    expect(space.tint).toEqual([1, 1, 1]);
  });

  it("floors at moonAirFloor on the horizon — dimmed, never erased", () => {
    expect(moonAirTerms(0, 1).level).toBeCloseTo(SKY.moonAirFloor, 12);
    expect(moonAirTerms(-1, 1).level).toBeCloseTo(SKY.moonAirFloor, 12);
    expect(SKY.moonAirFloor).toBeGreaterThan(0.3);
  });

  it("level falls and the tint warms monotonically toward the horizon; red is the peak", () => {
    let prevLevel = 1;
    let prevB = 1;
    for (let alt = SKY.moonAirHiDeg; alt >= 0; alt -= 0.5) {
      const { level, tint } = moonAirTerms(alt, 1);
      expect(level).toBeLessThanOrEqual(prevLevel + 1e-12);
      expect(tint[0]).toBe(1);
      expect(tint[1]).toBeGreaterThanOrEqual(tint[2]);
      expect(tint[2]).toBeLessThanOrEqual(prevB + 1e-12);
      prevLevel = level;
      prevB = tint[2];
    }
  });

  it("the owner's dusk moon (8.4°) is visibly orange, the setting one (4.5°) deeper, never crimson", () => {
    const dusk = moonAirTerms(8.4, 1);
    expect(dusk.tint[2]).toBeLessThan(0.75);
    expect(dusk.tint[1]).toBeGreaterThan(dusk.tint[2]);
    const setting = moonAirTerms(4.5, 1);
    expect(setting.tint[2]).toBeLessThan(dusk.tint[2]);
    expect(setting.level).toBeLessThan(dusk.level);
    // the per-channel floor holds at the horizon: blue never dies
    const horizon = moonAirTerms(0, 1);
    expect(horizon.tint[2]).toBeGreaterThanOrEqual(1 + (SKY.moonChromaFloor[2] - 1) * SKY.moonChromaK - 1e-12);
    expect(horizon.tint[1]).toBeGreaterThanOrEqual(1 + (SKY.moonChromaFloor[1] - 1) * SKY.moonChromaK - 1e-12);
  });

  it("skyK relaxes both terms linearly toward the shipped values", () => {
    const full = moonAirTerms(3, 1);
    const half = moonAirTerms(3, 0.5);
    expect(half.level).toBeCloseTo(1 - 0.5 * (1 - full.level), 12);
    expect(half.tint[2]).toBeGreaterThan(full.tint[2]);
    expect(half.tint[2]).toBeLessThan(1);
  });
});

describe("moonDiscArms with the air — albedo-side, both arms, alpha untouched", () => {
  it("defaults are byte-identical to the shipped twin", () => {
    for (const lit of [0, 0.3, 1])
      for (const d of [0, 0.5, 1]) {
        const a = moonDiscArms(lit, 0.3, d, 1);
        const b = moonDiscArms(lit, 0.3, d, 1, 1);
        expect(b.rgb).toBe(a.rgb);
        expect(b.alpha).toBe(a.alpha);
      }
  });
  it("air scales rgb in both arms and never the alpha", () => {
    for (const d of [0, 0.5, 1]) {
      const a = moonDiscArms(0.8, 0.3, d, 1, 1);
      const b = moonDiscArms(0.8, 0.3, d, 1, 0.45);
      expect(b.rgb).toBeCloseTo(a.rgb * 0.45, 12);
      expect(b.alpha).toBe(a.alpha);
    }
    expect(moonDiscArms(0.8, 0.3, 1, 1, 0.45).alpha).toBe(0); // the day arm stays additive-only
  });
});

describe("moonNightShare / moonDaySkyK — the dark limb against the current sky", () => {
  const E = SKY.moonMeanAlbedo * SKY.moonEarthshine;

  it("a dark sky → the night arm owns the disc; by day the share is EXACTLY 0", () => {
    expect(moonNightShare(0)).toBe(1);
    expect(moonDaySkyK(0, 1, 1)).toBe(0); // night
    expect(moonDaySkyK(1, 1, 1)).toBe(1); // full day — bit-exact, the 2026-08-14 ruling
    expect(moonDaySkyK(1, 0, 1)).toBe(0); // space: no sky at all → the opaque disc, as shipped
  });

  it("crosses over where the sky equals the earthshine, and is monotone in the sky", () => {
    expect(moonNightShare(E)).toBeCloseTo((0.25 - SKY.moonNightShareCut) / (1 - SKY.moonNightShareCut), 12);
    let prev = 1;
    for (let s = 0; s <= 0.5; s += 0.005) {
      const v = moonNightShare(s);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
  });

  it("the measured hole is gone: at sun +1° (dayK ≈ 0.6) the dark limb's opacity is under 1 %", () => {
    const d = moonDaySkyK(0.6, 1, 1);
    expect(1 - d).toBeLessThan(0.01);
    // …and the old derivation would have left it 40 % opaque — the 16/255 hole on the twins
    expect(1 - 0.6).toBeCloseTo(0.4, 12);
  });

  it("the dark limb reads as max(sky, earthshine) within 30 % through the ramp", () => {
    for (const sky of [0, 0.002, 0.01, E, 0.05, 0.1, 0.2, 0.38]) {
      const share = moonNightShare(sky);
      const limb = share * E + (1 - share) * sky; // lerp(sky, earthshine, night share)
      const want = Math.max(sky, E);
      expect(limb).toBeGreaterThanOrEqual(want * 0.7 - 1e-12);
      expect(limb).toBeLessThanOrEqual(want + 1e-12);
    }
  });

  it("the eclipse factor multiplies the whole weight — a total eclipse by day still turns the disc opaque", () => {
    expect(moonDaySkyK(1, 1, 0.04)).toBeCloseTo(0.04, 12);
    expect(moonDaySkyK(1, 1, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("is monotone in dayK", () => {
    let prev = 0;
    for (let k = 0; k <= 1; k += 0.01) {
      const v = moonDaySkyK(k, 1, 1);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});
