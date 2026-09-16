import { describe, expect, it } from "vitest";
import { formatScaleMeters, scaleBarFor } from "../../../src/lib/format/scaleBar";

/** The map scale bar (owner 2026-09-16) — one rounding rule for the /m 2D map and the chart. */
describe("scaleBarFor — the largest 1/2/5×10ⁿ distance that fits", () => {
  it("picks the ladder rung under the pixel budget and sizes the bar exactly", () => {
    // 1 m/px, 120 px budget → 100 m (200 would be 200 px)
    expect(scaleBarFor(1, 120)).toEqual({ meters: 100, px: 100, label: "100 m" });
    // 2.3 m/px → 276 m budget → 200 m at 86.96 px
    const b = scaleBarFor(2.3, 120)!;
    expect(b.meters).toBe(200);
    expect(b.px).toBeCloseTo(200 / 2.3, 9);
    // 0.7 m/px → 84 m budget → 50 m
    expect(scaleBarFor(0.7, 120)!.meters).toBe(50);
    // exactly on a rung: 5 m/px × 120 = 600 → 500 m
    expect(scaleBarFor(5, 120)!.meters).toBe(500);
    // 100 m/px → 12 km budget → 10 km
    expect(scaleBarFor(100, 120)!.label).toBe("10 km");
  });

  it("never exceeds the budget and is monotone in the scale", () => {
    let prev = 0;
    for (let mpp = 0.01; mpp < 5e5; mpp *= 1.37) {
      const b = scaleBarFor(mpp, 120)!;
      expect(b.px).toBeLessThanOrEqual(120 + 1e-9);
      expect(b.px).toBeGreaterThan(120 / 2.5 - 1e-9); // a 1/2/5 ladder never leaves the bar under 40 %
      expect(b.meters).toBeGreaterThanOrEqual(prev);
      prev = b.meters;
    }
  });

  it("hides on an unknown scale", () => {
    expect(scaleBarFor(0, 120)).toBeNull();
    expect(scaleBarFor(-1, 120)).toBeNull();
    expect(scaleBarFor(Number.NaN, 120)).toBeNull();
    expect(scaleBarFor(1, 0)).toBeNull();
  });
});

describe("formatScaleMeters — the readout grammar", () => {
  it("metres under a kilometre, km above, thin-space thousands", () => {
    expect(formatScaleMeters(5)).toBe("5 m");
    expect(formatScaleMeters(500)).toBe("500 m");
    expect(formatScaleMeters(1000)).toBe("1 km");
    expect(formatScaleMeters(2500)).toBe("2.5 km");
    expect(formatScaleMeters(20_000)).toBe("20 km");
    expect(formatScaleMeters(1_000_000)).toBe("1 000 km");
    expect(formatScaleMeters(0.2)).toBe("0.2 m");
  });
});
