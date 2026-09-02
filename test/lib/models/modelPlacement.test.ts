import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/lib/geo/geohash";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import { IDENTITY_TRANSFORM } from "../../../src/lib/globe/featureTransform";
import {
  IDENTITY_MODEL_EDIT,
  MODEL_MOVE_MAX_M,
  MODEL_SCALE_MAX,
  MODEL_SCALE_MIN,
  clampModelEdit,
  densityWarning,
  editToFeatureTransform,
  groundFitOffset,
  isIdentityModelTransform,
  offsetGeodetic,
  planModelCover,
  planResidency,
  sameCover,
  sanitizeModelTransform,
  uniformScaleFrom,
} from "../../../src/lib/models/modelPlacement";

// MESH SUITE MS5 — the placement contract: the uniform-scale read-back, the rails, the geodetic
// fold-in of a move, the ground-fit re-base, the world-read cover and closest-first residency.

const dist = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("modelPlacement — transform seats", () => {
  it("sanitizes a stored row's seats: null = identity, garbage = identity, scale clamped onto the rails", () => {
    expect(sanitizeModelTransform(null, null)).toEqual({ rotDeg: 0, scale: 1 });
    expect(sanitizeModelTransform("x", Number.NaN)).toEqual({ rotDeg: 0, scale: 1 });
    expect(sanitizeModelTransform(370, 50)).toEqual({ rotDeg: 10, scale: MODEL_SCALE_MAX });
    expect(sanitizeModelTransform(-180, 0.001).scale).toBe(MODEL_SCALE_MIN);
    expect(isIdentityModelTransform({ rotDeg: 0.01, scale: 1.001 })).toBe(true);
    expect(isIdentityModelTransform({ rotDeg: 12, scale: 1 })).toBe(false);
  });

  it("collapses the gizmo's per-axis scales to the axis that moved most from the start", () => {
    expect(uniformScaleFrom(2, 1, 1, 1)).toBe(2);
    expect(uniformScaleFrom(1, 1, 0.5, 1)).toBe(0.5);
    expect(uniformScaleFrom(1.3, 1.3, 1.3, 1)).toBe(1.3);
    expect(uniformScaleFrom(3, 2, 2, 2)).toBe(3);
    expect(uniformScaleFrom(Number.NaN, 0, -1, 2)).toBe(2); // nothing usable → the start
  });

  it("clamps a read-back: the per-edit band about the start, the yaw wrapped, the move shortened, the lift dropped", () => {
    const e = clampModelEdit({ sx: 4, sy: 1, sz: 1, rotDeg: 370, tE: 300, tN: 400, tU: 9 }, { rotDeg: 0, scale: 1 });
    expect(e.scale).toBe(3); // 3× per edit
    expect(e.rotDeg).toBe(10);
    expect(Math.hypot(e.tE, e.tN)).toBeCloseTo(MODEL_MOVE_MAX_M, 9);
    expect(e.tE / e.tN).toBeCloseTo(0.75, 9); // direction kept
    expect("tU" in e).toBe(false);
    // Ten drags reach the absolute rail, one cannot.
    // (three's scale mode leaves the undragged axes at the START scale — 4 here, not 1.)
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 9, sy: 4, sz: 4 }, { rotDeg: 0, scale: 4 }).scale).toBe(9);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 40, sy: 4, sz: 4 }, { rotDeg: 0, scale: 4 }).scale).toBe(MODEL_SCALE_MAX);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM }, { rotDeg: 0, scale: 1 })).toEqual(IDENTITY_MODEL_EDIT);
  });

  it("the forward map speaks the gizmo's FeatureTransform with a uniform scale and no lift", () => {
    expect(editToFeatureTransform({ rotDeg: 30, scale: 1.5, tE: 2, tN: -3 })).toEqual({
      sx: 1.5,
      sy: 1.5,
      sz: 1.5,
      rotDeg: 30,
      tE: 2,
      tN: -3,
      tU: 0,
    });
  });
});

describe("modelPlacement — geodesy", () => {
  it("offsets a point by ENU metres on the ellipsoid to the centimetre (Dnipro)", () => {
    const lat = 48.4647;
    const lon = 35.0462;
    const o = geodeticToEcef(lat, lon) as [number, number, number];
    const east = offsetGeodetic(lat, lon, 100, 0);
    const north = offsetGeodetic(lat, lon, 0, -250);
    expect(east.latDeg).toBe(lat);
    expect(east.lonDeg).toBeGreaterThan(lon);
    expect(dist(geodeticToEcef(east.latDeg, east.lonDeg) as [number, number, number], o)).toBeCloseTo(100, 2);
    expect(north.lonDeg).toBe(lon);
    expect(north.latDeg).toBeLessThan(lat);
    expect(dist(geodeticToEcef(north.latDeg, north.lonDeg) as [number, number, number], o)).toBeCloseTo(250, 2);
  });

  it("wraps the longitude and clamps the latitude at the edges", () => {
    expect(offsetGeodetic(0, 179.9999, 500, 0).lonDeg).toBeLessThan(0);
    expect(offsetGeodetic(89.9999, 0, 0, 50_000).latDeg).toBe(90);
    expect(offsetGeodetic(90, 10, 100, 0).lonDeg).toBe(10); // no east at the pole
  });

  it("re-bases a GLB so its footprint centre is the origin and its lowest point is y = 0", () => {
    expect(groundFitOffset([-2, 3, -4], [6, 9, 4])).toEqual([-2, -3, 0]);
    expect(groundFitOffset([Number.NaN, Number.NaN, Number.NaN], [1, 1, 1])).toEqual([0, 0, 0]);
  });
});

describe("modelPlacement — the world-read cover", () => {
  const cfg = { radiusM: 4000, maxAltM: 40_000, maxCells: 16 };
  it("covers a 4 km square around the focus with p5 cells, sorted, and always holds the focus cell", () => {
    const cells = planModelCover(48.4647, 35.0462, 500, cfg)!;
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells.length).toBeLessThanOrEqual(9);
    expect(cells).toContain(encodeGeohash(48.4647, 35.0462, 5));
    expect(cells.every((c) => c.length === 5)).toBe(true);
    expect([...cells].sort()).toEqual(cells);
  });
  it("asks for nothing above the altitude ceiling or on a broken focus", () => {
    expect(planModelCover(48.4647, 35.0462, 50_000, cfg)).toBeNull();
    expect(planModelCover(Number.NaN, 35, 100, cfg)).toBeNull();
  });
  it("keeps the nearest cells when the cover exceeds the cap", () => {
    const cells = planModelCover(48.4647, 35.0462, 500, { ...cfg, maxCells: 1 })!;
    expect(cells).toEqual([encodeGeohash(48.4647, 35.0462, 5)]);
    expect(planModelCover(0, 0, 500, { ...cfg, radiusM: 40_000, maxCells: 6 })!.length).toBe(6);
  });
  it("compares covers by content", () => {
    expect(sameCover(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameCover(["a", "b"], ["a", "c"])).toBe(false);
    expect(sameCover(null, [])).toBe(false);
    expect(sameCover(null, null)).toBe(true);
  });
});

describe("modelPlacement — residency + density", () => {
  const cfg = { loadRadiusM: 3000, unloadRadiusM: 4000, maxResident: 24, triBudget: 1500 };
  it("loads closest-first under the triangle budget and counts what it refused nearby", () => {
    const rows = [
      { id: "b", tris: 1000, distM: 200 },
      { id: "a", tris: 1000, distM: 100 },
      { id: "c", tris: 1000, distM: 3500 },
    ];
    const plan = planResidency(rows, new Set(), cfg);
    expect(plan.load).toEqual(["a"]);
    expect(plan.skipped).toBe(1); // b refused by the budget; c is outside the load radius
    expect(plan.tris).toBe(1000);
    expect(plan.unload).toEqual([]);
  });
  it("keeps a resident model inside the unload radius (hysteresis) and releases one past it or refused", () => {
    const rows = [
      { id: "far", tris: 100, distM: 3900 },
      { id: "gone", tris: 100, distM: 4500 },
      { id: "near", tris: 1400, distM: 50 },
    ];
    const plan = planResidency(rows, new Set(["far", "gone"]), cfg);
    expect(plan.keep).toEqual(["far"]);
    expect(plan.load).toEqual(["near"]);
    expect(plan.unload).toEqual(["gone"]);
    // The budget evicts a resident when a nearer model needs the triangles.
    const evict = planResidency(rows, new Set(["far"]), { ...cfg, triBudget: 1400 });
    expect(evict.load).toEqual(["near"]);
    expect(evict.unload).toEqual(["far"]);
    expect(evict.skipped).toBe(0); // far sits outside the load radius — not a density signal
  });
  it("honours the count cap and treats garbage triangle counts as zero", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, tris: Number.NaN, distM: i * 10 }));
    const plan = planResidency(rows, new Set(), cfg);
    expect(plan.load.length).toBe(24);
    expect(plan.skipped).toBe(6);
    expect(plan.tris).toBe(0);
  });
  it("warns on a skipped model nearby or a heavy resident load", () => {
    expect(densityWarning(0, 500_000, 1_000_000)).toBe(false);
    expect(densityWarning(1, 0, 1_000_000)).toBe(true);
    expect(densityWarning(0, 1_000_000, 1_000_000)).toBe(true);
  });
});
