import { describe, expect, it } from "vitest";
import {
  focalMmFromHFov,
  horizontalFovDeg,
  integratePlanned,
  plannedAtRest,
  stickRate,
  type PlannedIntegration,
} from "../../../src/lib/geo/plannedView";
import { focalFromHorizontalFov, verticalFovDeg } from "../../../src/lib/decode/sensors";

/**
 * AUDIT #3 C7 — the FOV inverse pair is a PRODUCTION ROUND TRIP (`plannedView.hFovDeg` is
 * emitted by StylizedTiles and inverted at MapWindow's FPV jump), but until now no test file
 * imported both halves: each was pinned only at aspect 1 plus a monotonicity direction.
 * This also REFUTES a claim recorded in DECISIONS 2026-08-21h ("the FOV inverse pair is
 * transitively pinned") — it was not, and the recovered agent output that asserted it was
 * pre-verification. Portrait aspects matter most: /m is 390×844 ⇒ aspect ≈ 0.46.
 */
describe("FOV inverse pair — horizontalFovDeg ∘ verticalFovDeg = identity", () => {
  it("round-trips across real viewport aspects and the full focal band", () => {
    for (const aspect of [16 / 9, 3 / 2, 1, 390 / 844, 844 / 390]) {
      for (const vFov of [3, 20, 58, 80, 110]) {
        expect(verticalFovDeg(horizontalFovDeg(vFov, aspect), aspect)).toBeCloseTo(vFov, 9);
      }
    }
  });

  it("…and the other way round, so neither half can drift alone", () => {
    for (const aspect of [16 / 9, 1, 390 / 844]) {
      for (const hFov of [5, 40, 90, 120]) {
        expect(horizontalFovDeg(verticalFovDeg(hFov, aspect), aspect)).toBeCloseTo(hFov, 9);
      }
    }
  });

  // AUDIT #3 C9 — the same formula ships from two modules with divergent guards
  // (`focalMmFromHFov` unguarded, `focalFromHorizontalFov` throws outside (0,180)).
  // Cross-pin them so a change to one cannot silently fork the AIM stick's mm readout.
  it("focalMmFromHFov agrees with the sensors-module twin", () => {
    for (const hFov of [5, 20, 40, 63.4, 90, 120]) {
      expect(focalMmFromHFov(hFov)).toBeCloseTo(focalFromHorizontalFov(hFov), 9);
    }
  });
});

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

describe("focalMmFromHFov — 35mm-equivalent focal for a horizontal fov (batch #6 item 3)", () => {
  it("matches the full-frame 36 mm geometry", () => {
    expect(focalMmFromHFov(90)).toBeCloseTo(18, 6); // tan 45° = 1
    expect(focalMmFromHFov(60)).toBeCloseTo(18 / Math.tan(Math.PI / 6), 6); // ≈31.18
    expect(focalMmFromHFov(39.6)).toBeCloseTo(50, 0); // the classic "normal" lens
  });
  it("monotone: narrower fov = longer lens", () => {
    expect(focalMmFromHFov(20)).toBeGreaterThan(focalMmFromHFov(40));
    expect(focalMmFromHFov(40)).toBeGreaterThan(focalMmFromHFov(80));
  });
});
