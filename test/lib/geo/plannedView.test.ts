import { describe, expect, it } from "vitest";
import {
  integratePlanned,
  plannedAtRest,
  stickRate,
  type PlannedIntegration,
} from "../../../src/lib/geo/plannedView";

const rest = (headingDeg: number, hFovDeg: number): PlannedIntegration => ({
  headingDeg,
  hFovDeg,
  appliedHeadingDegPerS: 0,
  appliedHFovPerS: 0,
});

describe("stickRate (the Encoder.tsx expo curve)", () => {
  it("full deflection hits the ceiling, sign preserved", () => {
    expect(stickRate(1, 45, 2.2)).toBeCloseTo(45, 10);
    expect(stickRate(-1, 45, 2.2)).toBeCloseTo(-45, 10);
  });
  it("expo bends small deflections toward fine control (γ 2.2)", () => {
    expect(stickRate(0.5, 45, 2.2)).toBeCloseTo(45 * 0.5 ** 2.2, 10);
    expect(stickRate(0.5, 45, 2.2)).toBeLessThan(45 * 0.5); // below linear
  });
  it("clamps runaway deflection to the unit range", () => {
    expect(stickRate(3, 45, 2.2)).toBeCloseTo(45, 10);
  });
  it("zero is zero (no drift at rest)", () => {
    expect(stickRate(0, 45, 2.2)).toBe(0);
  });
});

describe("integratePlanned", () => {
  it("advances heading linearly once the low-pass converges and wraps 360", () => {
    // Long dt ⇒ the applied rate ≈ commanded; 350° + 45°/s × 1 s ⇒ 35° (wrapped).
    let s = rest(350, 60);
    s = integratePlanned(s, 45, 0, 10_000, 1, 3, 120); // tau 1 ms ⇒ instant convergence
    s = integratePlanned({ ...s, headingDeg: 350 }, 45, 0, 1_000, 1, 3, 120);
    expect(s.headingDeg).toBeCloseTo(35, 3);
  });
  it("hFov moves in LOG space: + rate = zoom in, − = zoom out, symmetric", () => {
    const zoomIn = integratePlanned(rest(0, 60), 0, 0.5, 1_000, 1, 3, 120);
    const zoomOut = integratePlanned(rest(0, 60), 0, -0.5, 1_000, 1, 3, 120);
    expect(zoomIn.hFovDeg).toBeCloseTo(60 * Math.exp(-0.5), 2);
    expect(zoomOut.hFovDeg).toBeCloseTo(60 * Math.exp(0.5), 2);
  });
  it("clamps hFov at both ends", () => {
    expect(integratePlanned(rest(0, 4), 0, 5, 10_000, 1, 3, 120).hFovDeg).toBe(3);
    expect(integratePlanned(rest(0, 110), 0, -5, 10_000, 1, 3, 120).hFovDeg).toBe(120);
  });
  it("low-pass eases toward the commanded rate (never snaps)", () => {
    // One 140 ms-tau step of 140 ms ⇒ applied = 1 − e⁻¹ ≈ 63% of commanded.
    const s = integratePlanned(rest(0, 60), 45, 0, 140, 140, 3, 120);
    expect(s.appliedHeadingDegPerS).toBeCloseTo(45 * (1 - Math.exp(-1)), 6);
    expect(s.appliedHeadingDegPerS).toBeLessThan(45);
  });
  it("release (commanded 0) decays the applied rate toward rest", () => {
    let s: PlannedIntegration = {
      ...rest(10, 60),
      appliedHeadingDegPerS: 45,
      appliedHFovPerS: 0.9,
    };
    for (let i = 0; i < 60; i++) s = integratePlanned(s, 0, 0, 100, 140, 3, 120);
    expect(plannedAtRest(s)).toBe(true);
  });
  it("plannedAtRest is false while a rate is live", () => {
    expect(plannedAtRest({ ...rest(0, 60), appliedHeadingDegPerS: 1 })).toBe(false);
  });
});
