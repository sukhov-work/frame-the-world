import { describe, expect, it } from "vitest";
import { surfaceCapIndexCount } from "../../../src/lib/globe/terrainSkirt";

/**
 * The cap/skirt group contract the shadow-seam fix rests on (owner defect 3, 2026-08-27).
 * `surfaceCapIndexCount` is what keeps the terrain skirt out of BOTH the depth pass and the
 * ShadowMaterial overlay; its only interesting property is that it fails SAFE — an unrecognised
 * layout returns 0 ("draw everything, as before") and it can never clip real surface away.
 */
describe("surfaceCapIndexCount", () => {
  const geom = (
    total: number,
    groups: Array<{ start: number; count: number }>,
  ) => ({ index: total > 0 ? { count: total } : null, groups });

  it("returns the cap count for the loader's cap → bottom → skirt layout", () => {
    // QuantizedMeshLoader.js:136 / :173 / :247 — cap first at offset 0.
    expect(surfaceCapIndexCount(geom(900, [
      { start: 0, count: 300 },
      { start: 300, count: 300 },
      { start: 600, count: 300 },
    ]))).toBe(300);
  });

  it("returns the cap count for the region clipper's cap → skirt layout", () => {
    // QuantizedMeshClipper.js:238 / :252 — same rule, no solid bottom.
    expect(surfaceCapIndexCount(geom(750, [
      { start: 0, count: 480 },
      { start: 480, count: 270 },
    ]))).toBe(480);
  });

  it("returns 0 for a single-group geometry (nothing to clip — this is the whole surface)", () => {
    expect(surfaceCapIndexCount(geom(600, [{ start: 0, count: 600 }]))).toBe(0);
  });

  it("returns 0 when there are no groups at all", () => {
    expect(surfaceCapIndexCount(geom(600, []))).toBe(0);
  });

  it("returns 0 when the first group does NOT start at 0 — the layout is not the one we know", () => {
    expect(surfaceCapIndexCount(geom(900, [
      { start: 300, count: 300 },
      { start: 0, count: 300 },
    ]))).toBe(0);
  });

  it("returns 0 for a non-indexed geometry", () => {
    expect(surfaceCapIndexCount(geom(0, [{ start: 0, count: 300 }]))).toBe(0);
  });

  it("never returns a range longer than the index buffer", () => {
    for (const [total, cap] of [[900, 300], [750, 480], [12, 4], [2, 1]] as const) {
      const n = surfaceCapIndexCount(geom(total, [
        { start: 0, count: cap },
        { start: cap, count: total - cap },
      ]));
      expect(n).toBeLessThanOrEqual(total);
      expect(n).toBe(cap);
    }
  });

  it("treats a degenerate (zero-count) cap as unrecognised rather than as an empty draw", () => {
    // A 0 here would otherwise mean "draw nothing", i.e. a terrain that silently stops casting.
    expect(surfaceCapIndexCount(geom(900, [
      { start: 0, count: 0 },
      { start: 0, count: 900 },
    ]))).toBe(0);
  });
});
