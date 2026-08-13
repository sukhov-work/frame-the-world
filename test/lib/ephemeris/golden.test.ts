import { describe, expect, it } from "vitest";
import { goldenFactor, type GoldenCurve } from "../../../src/lib/ephemeris/golden";
import { GOLDEN } from "../../../src/components/globe/tuning";

// THE shipped curve, imported straight from tuning (audit C1, 2026-08-13: the previous hand
// mirror had silently pinned the pre-2026-07-13 numbers — a drifted copy tests nothing). The
// runtime lib stays layering-clean of the globe fence (the orchestrator passes the knobs);
// importing tuning from a TEST is sanctioned (quality.test.ts precedent).
const CURVE: GoldenCurve = {
  fadeInLo: GOLDEN.fadeInLo,
  fadeInHi: GOLDEN.fadeInHi,
  fadeOutLo: GOLDEN.fadeOutLo,
  fadeOutHi: GOLDEN.fadeOutHi,
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
