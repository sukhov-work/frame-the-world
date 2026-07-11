import { describe, expect, it } from "vitest";
import { clampGroundM, MAX_TERRAIN_M } from "../../../src/lib/geo/terrain";

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
