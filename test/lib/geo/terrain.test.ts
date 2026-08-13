import { describe, expect, it } from "vitest";
import { clampGroundM, MAX_TERRAIN_M, sampleGroundM } from "../../../src/lib/geo/terrain";

describe("clampGroundM", () => {
  it("clamps negative garbage (loading / coarse-LOD tiles) up to 0", () => {
    expect(clampGroundM(-500)).toBe(0);
    expect(clampGroundM(-0.0001)).toBe(0);
  });

  it("passes plausible heights through unchanged", () => {
    expect(clampGroundM(0)).toBe(0);
    expect(clampGroundM(123.4)).toBe(123.4);
    expect(clampGroundM(MAX_TERRAIN_M)).toBe(MAX_TERRAIN_M);
  });

  it("caps above Everest-plausible ground", () => {
    expect(clampGroundM(50_000)).toBe(MAX_TERRAIN_M);
    expect(clampGroundM(MAX_TERRAIN_M + 1)).toBe(MAX_TERRAIN_M);
  });
});

describe("sampleGroundM (audit A1 — the pin ground-latch regression)", () => {
  it("missing sample falls back and stays not-real (resnap keeps trying)", () => {
    expect(sampleGroundM(null, 120)).toEqual({ h: 120, real: false });
    expect(sampleGroundM(undefined, 120)).toEqual({ h: 120, real: false });
    expect(sampleGroundM(Number.NaN, 120)).toEqual({ h: 120, real: false });
  });

  it("negative loading-phase garbage is clamped for placement but NEVER latched as real", () => {
    expect(sampleGroundM(-500, 120)).toEqual({ h: 0, real: false });
    expect(sampleGroundM(-0.0001, 120)).toEqual({ h: 0, real: false });
  });

  it("over-ceiling garbage is capped and not latched", () => {
    expect(sampleGroundM(50_000, 120)).toEqual({ h: MAX_TERRAIN_M, real: false });
  });

  it("in-range answers pass through and latch", () => {
    expect(sampleGroundM(0, 120)).toEqual({ h: 0, real: true });
    expect(sampleGroundM(97.3, 120)).toEqual({ h: 97.3, real: true });
    expect(sampleGroundM(MAX_TERRAIN_M, 120)).toEqual({ h: MAX_TERRAIN_M, real: true });
  });
});
