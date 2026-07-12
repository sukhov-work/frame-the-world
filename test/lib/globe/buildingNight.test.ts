import { describe, it, expect } from "vitest";
import { buildingNightFactor, smoothstep01 } from "../../../src/lib/globe/buildingNight";
import { EARTH } from "../../../src/components/globe/tuning";

describe("smoothstep01", () => {
  it("clamps below edge0 to 0 and above edge1 to 1", () => {
    expect(smoothstep01(-0.12, -0.005, -1)).toBe(0);
    expect(smoothstep01(-0.12, -0.005, 1)).toBe(1);
  });

  it("is exactly 0.5 at the midpoint (symmetric Hermite)", () => {
    expect(smoothstep01(0, 1, 0.5)).toBeCloseTo(0.5, 15);
  });

  it("matches the GLSL 3t²−2t³ shape at a quarter point", () => {
    // t = 0.25 → 0.25²·(3 − 2·0.25) = 0.0625·2.5 = 0.15625
    expect(smoothstep01(0, 1, 0.25)).toBeCloseTo(0.15625, 15);
  });

  it("treats edge0 === edge1 as a hard step", () => {
    expect(smoothstep01(0.2, 0.2, 0.1)).toBe(0);
    expect(smoothstep01(0.2, 0.2, 0.3)).toBe(1);
  });
});

describe("buildingNightFactor (RENDERING_QUALITY_PASS R3)", () => {
  const band = EARTH.lightsBand; // [-0.12, -0.005] — the shared terminator band

  it("is full night (1) when the sun is well below the horizon", () => {
    expect(buildingNightFactor(-0.5, band)).toBe(1);
    expect(buildingNightFactor(band[0] - 1e-6, band)).toBe(1);
  });

  it("is full day (0) once the sun clears the upper band edge", () => {
    expect(buildingNightFactor(0.5, band)).toBe(0);
    expect(buildingNightFactor(band[1] + 1e-6, band)).toBe(0);
  });

  it("eases monotonically from night → day across the band (windows fade with the terminator)", () => {
    const lo = band[0];
    const hi = band[1];
    const samples = Array.from({ length: 11 }, (_, i) =>
      buildingNightFactor(lo + ((hi - lo) * i) / 10, band),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]); // never re-brightens toward day
    }
    expect(samples[0]).toBeCloseTo(1, 12);
    expect(samples[samples.length - 1]).toBeCloseTo(0, 12);
  });

  it("agrees with the earth/ground shader definition (1 − smoothstep over the same band)", () => {
    const s = -0.05; // civil-twilight-ish sine of elevation
    expect(buildingNightFactor(s, band)).toBeCloseTo(1 - smoothstep01(band[0], band[1], s), 15);
  });
});
