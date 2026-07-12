import { describe, it, expect } from "vitest";
import { driftRadiansForDt } from "../../../src/lib/globe/drift";
import { DRIFT } from "../../../src/components/globe/tuning";

describe("driftRadiansForDt", () => {
  it("matches the legacy 0.0011°/frame exactly at the 60 Hz baseline (behavior-identical)", () => {
    const legacyDegPerFrame = 0.0011; // the pre-F5 constant (DRIFT.degPerFrame)
    const at60 = driftRadiansForDt(DRIFT.degPerSec, 1000 / 60);
    expect(at60).toBeCloseTo((legacyDegPerFrame * Math.PI) / 180, 12);
  });

  it("is frame-rate independent — 120 Hz steps half the angle of 60 Hz, 30 Hz steps double", () => {
    const at60 = driftRadiansForDt(DRIFT.degPerSec, 1000 / 60);
    const at120 = driftRadiansForDt(DRIFT.degPerSec, 1000 / 120);
    const at30 = driftRadiansForDt(DRIFT.degPerSec, 1000 / 30);
    expect(at120).toBeCloseTo(at60 / 2, 15);
    expect(at30).toBeCloseTo(at60 * 2, 15);
    // …so the per-second rate is conserved: two 120 Hz frames == one 60 Hz frame.
    expect(at120 * 2).toBeCloseTo(at60, 15);
  });

  it("scales linearly with dt and is zero for a zero-length frame", () => {
    expect(driftRadiansForDt(DRIFT.degPerSec, 0)).toBe(0);
    expect(driftRadiansForDt(0.066, 2000)).toBeCloseTo(driftRadiansForDt(0.066, 1000) * 2, 15);
  });

  it("returns the exact per-second radian rate at dtMs = 1000", () => {
    expect(driftRadiansForDt(0.066, 1000)).toBeCloseTo((0.066 * Math.PI) / 180, 15);
  });
});
