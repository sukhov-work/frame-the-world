import { describe, expect, it } from "vitest";
import { goldenFactor, type GoldenCurve } from "../../../src/lib/ephemeris/golden";

// Mirror of tuning.GOLDEN's curve (lib stays layering-clean of the globe fence — the orchestrator
// passes the real knobs; these tests assert the SHAPE with the shipped numbers).
const CURVE: GoldenCurve = {
  fadeInLo: -0.139, // sin(−8°)
  fadeInHi: -0.0175, // sin(−1°)
  fadeOutLo: 0.122, // sin(+7°)
  fadeOutHi: 0.276, // sin(+16°)
};

const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);

describe("goldenFactor", () => {
  it("peaks with the sun on the horizon", () => {
    expect(goldenFactor(sin(0), CURVE)).toBe(1);
    expect(goldenFactor(sin(3), CURVE)).toBe(1);
  });

  it("is dark at night and at high sun", () => {
    expect(goldenFactor(sin(-20), CURVE)).toBe(0);
    expect(goldenFactor(sin(-90), CURVE)).toBe(0);
    expect(goldenFactor(sin(30), CURVE)).toBe(0);
    expect(goldenFactor(sin(90), CURVE)).toBe(0);
  });

  it("ramps smoothly through twilight and out of the first hour", () => {
    const twilight = goldenFactor(sin(-4), CURVE);
    expect(twilight).toBeGreaterThan(0);
    expect(twilight).toBeLessThan(1);
    const morning = goldenFactor(sin(11), CURVE);
    expect(morning).toBeGreaterThan(0);
    expect(morning).toBeLessThan(1);
    // monotonic rise across the fade-in band
    expect(goldenFactor(sin(-6), CURVE)).toBeLessThan(goldenFactor(sin(-2), CURVE));
    // monotonic fall across the fade-out band
    expect(goldenFactor(sin(9), CURVE)).toBeGreaterThan(goldenFactor(sin(14), CURVE));
  });
});
