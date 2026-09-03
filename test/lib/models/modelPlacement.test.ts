import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/lib/geo/geohash";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import { IDENTITY_TRANSFORM } from "../../../src/lib/globe/featureTransform";
import {
  IDENTITY_MODEL_EDIT,
  MODEL_LIFT_KEEP,
  MODEL_LIFT_MAX_M,
  MODEL_MOVE_MAX_M,
  MODEL_SCALE_MAX,
  MODEL_SCALE_MIN,
  clampLiftM,
  clampModelEdit,
  densityWarning,
  editToFeatureTransform,
  groundFitOffset,
  isIdentityModelTransform,
  liftFloorM,
  offsetGeodetic,
  planModelCover,
  planResidency,
  sameCover,
  sanitizeModelTransform,
  uniformScaleFrom,
  STANDPOINT,
  modelStandpoint,
} from "../../../src/lib/models/modelPlacement";

// MESH SUITE MS5 — the placement contract: the uniform-scale read-back, the rails, the geodetic
// fold-in of a move, the ground-fit re-base, the world-read cover and closest-first residency.

const dist = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("modelPlacement — transform seats", () => {
  it("sanitizes a stored row's seats: null = identity, garbage = identity, scale clamped onto the rails", () => {
    expect(sanitizeModelTransform(null, null)).toEqual({ rotDeg: 0, scale: 1, liftM: 0 });
    expect(sanitizeModelTransform("x", Number.NaN)).toEqual({ rotDeg: 0, scale: 1, liftM: 0 });
    expect(sanitizeModelTransform(370, 50)).toEqual({ rotDeg: 10, scale: 50, liftM: 0 }); // inside the loose sanity rail (MS5b)
    expect(sanitizeModelTransform(370, 5000)).toEqual({ rotDeg: 10, scale: MODEL_SCALE_MAX, liftM: 0 });
    expect(sanitizeModelTransform(-180, 0.0001).scale).toBe(MODEL_SCALE_MIN);
    expect(isIdentityModelTransform({ rotDeg: 0.01, scale: 1.001, liftM: 0 })).toBe(true);
    expect(isIdentityModelTransform({ rotDeg: 12, scale: 1, liftM: 0 })).toBe(false);
  });

  it("collapses the gizmo's per-axis scales to the axis that moved most from the start", () => {
    expect(uniformScaleFrom(2, 1, 1, 1)).toBe(2);
    expect(uniformScaleFrom(1, 1, 0.5, 1)).toBe(0.5);
    expect(uniformScaleFrom(1.3, 1.3, 1.3, 1)).toBe(1.3);
    expect(uniformScaleFrom(3, 2, 2, 2)).toBe(3);
    expect(uniformScaleFrom(Number.NaN, 0, -1, 2)).toBe(2); // nothing usable → the start
  });

  it("clamps a read-back: the per-edit band about the start, the yaw wrapped, the move shortened, the lift railed", () => {
    const e = clampModelEdit({ sx: 40, sy: 1, sz: 1, rotDeg: 370, tE: 300, tN: 400, tU: 9 }, { rotDeg: 0, scale: 1, liftM: 0 }, 4);
    expect(e.scale).toBe(10); // 10× per edit (MS5b — was 3×)
    expect(e.rotDeg).toBe(10);
    expect(Math.hypot(e.tE, e.tN)).toBeCloseTo(MODEL_MOVE_MAX_M, 9);
    expect(e.tE / e.tN).toBeCloseTo(0.75, 9); // direction kept
    expect(e.liftM).toBe(9); // MS7: the lift is a seat now (inside the rail: a 4 m model at 10× is 40 m tall)
    // Edits compound about the committed scale with no absolute cap — only the loose sanity rail.
    // (three's scale mode leaves the undragged axes at the START scale — 4 here, not 1.)
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 9, sy: 4, sz: 4 }, { rotDeg: 0, scale: 4, liftM: 0 }).scale).toBe(9);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 40, sy: 4, sz: 4 }, { rotDeg: 0, scale: 4, liftM: 0 }).scale).toBe(40);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 5000, sy: 400, sz: 400 }, { rotDeg: 0, scale: 400, liftM: 0 }).scale).toBe(MODEL_SCALE_MAX);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM }, { rotDeg: 0, scale: 1, liftM: 0 })).toEqual(IDENTITY_MODEL_EDIT);
  });

  it("MS7 — the lift rail: the ceiling, and a floor that keeps a quarter (≥ 0.5 m) of the SCALED model above the seat", () => {
    expect(MODEL_LIFT_MAX_M).toBe(50);
    expect(MODEL_LIFT_KEEP).toEqual({ frac: 0.25, minM: 0.5 });
    // A 10 m model may sink 7.5 m; a 1 m model 0.5 m; a 0.4 m one not at all; unknown height → pinned.
    expect(liftFloorM(10)).toBe(-7.5);
    expect(liftFloorM(1)).toBe(-0.5);
    expect(liftFloorM(0.4)).toBe(0);
    expect(liftFloorM(null)).toBe(0);
    expect(liftFloorM(Number.NaN)).toBe(0);
    // A 400 m model is capped by the absolute rail, not its height.
    expect(liftFloorM(400)).toBe(-MODEL_LIFT_MAX_M);
    expect(clampLiftM(-100, 10)).toBe(-7.5);
    expect(clampLiftM(100, 10)).toBe(MODEL_LIFT_MAX_M);
    expect(clampLiftM(-3, 10)).toBe(-3);
    expect(clampLiftM("x", 10)).toBe(0);
    expect(Object.is(clampLiftM(-0, 10), 0)).toBe(true);
    // The read path: the floor is taken at height × scale; garbage reads as on the ground.
    expect(sanitizeModelTransform(0, 1, -7, 10)).toEqual({ rotDeg: 0, scale: 1, liftM: -7 });
    expect(sanitizeModelTransform(0, 0.5, -7, 10).liftM).toBe(-3.75); // 5 m tall at 0.5× → floor −3.75
    expect(sanitizeModelTransform(0, 1, -7, null).liftM).toBe(0); // unknown height pins
    expect(sanitizeModelTransform(0, 1, 500, 10).liftM).toBe(MODEL_LIFT_MAX_M);
    expect(isIdentityModelTransform({ rotDeg: 0, scale: 1, liftM: 0.005 })).toBe(true);
    expect(isIdentityModelTransform({ rotDeg: 0, scale: 1, liftM: 0.02 })).toBe(false);
    // The gizmo read-back: the floor follows the CLAMPED scale of the same read-back, so a shrink
    // that would bury a sunk model lifts it instead (10 m model sunk 7 m, scaled to 0.5× → −3.75).
    const shrunk = clampModelEdit({ sx: 0.5, sy: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: -7 }, { rotDeg: 0, scale: 1, liftM: -7 }, 10);
    expect(shrunk.scale).toBe(0.5);
    expect(shrunk.liftM).toBe(-3.75);
    // A drag past the ceiling stops at it; NaN reads as on the ground.
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, tU: 80 }, { rotDeg: 0, scale: 1, liftM: 0 }, 10).liftM).toBe(MODEL_LIFT_MAX_M);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, tU: Number.NaN }, { rotDeg: 0, scale: 1, liftM: 2 }, 10).liftM).toBe(0);
  });

  it("the forward map speaks the gizmo's FeatureTransform with a uniform scale and the lift as tU", () => {
    expect(editToFeatureTransform({ rotDeg: 30, scale: 1.5, liftM: -2, tE: 2, tN: -3 })).toEqual({
      sx: 1.5,
      sy: 1.5,
      sz: 1.5,
      rotDeg: 30,
      tE: 2,
      tN: -3,
      tU: -2,
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

describe("modelPlacement — the MS6 standpoint (stand beside a model)", () => {
  it("stands three longest-extents back along the opposite of the heading, eye 1.7 m, pitched at mid-height", () => {
    // A 3 × 5 × 3 m box (w, d, h) at scale 1: the longest extent is 5 → 15 m out, heading 0 → the
    // eye sits 15 m SOUTH, looking north; mid-height 1.5 m is below the eye → a slight down pitch.
    const p = modelStandpoint(48.4647, 35.0462, [3, 5, 3], 1, 0);
    expect(p.distM).toBe(15);
    expect(p.headingDeg).toBe(0);
    expect(p.eyeM).toBe(STANDPOINT.eyeM);
    expect(p.fovDeg).toBe(STANDPOINT.fovDeg);
    expect(p.lonDeg).toBeCloseTo(35.0462, 9);
    expect(p.latDeg).toBeLessThan(48.4647);
    const back = offsetGeodetic(p.latDeg, p.lonDeg, 0, 15);
    expect(back.latDeg).toBeCloseTo(48.4647, 8);
    expect(p.pitchDeg).toBeCloseTo((Math.atan2(1.5 - 1.7, 15) * 180) / Math.PI, 6);
    // Heading 90 (look east): the eye stands WEST of the model.
    const e = modelStandpoint(48.4647, 35.0462, [3, 5, 3], 1, 90);
    expect(e.lonDeg).toBeLessThan(35.0462);
    expect(e.latDeg).toBeCloseTo(48.4647, 8);
    expect(e.headingDeg).toBe(90);
  });

  it("scales with the committed scale, clamps to [6, 120] m, and tolerates an unknown size or a bad heading", () => {
    expect(modelStandpoint(0, 0, [3, 5, 3], 3, 0).distM).toBe(45);
    expect(modelStandpoint(0, 0, [0.5, 0.5, 0.5], 1, 0).distM).toBe(STANDPOINT.minM);
    expect(modelStandpoint(0, 0, [80, 10, 10], 1, 0).distM).toBe(STANDPOINT.maxM);
    const unknown = modelStandpoint(0, 0, null, 1, 0);
    expect(unknown.distM).toBe(STANDPOINT.minM);
    expect(unknown.pitchDeg).toBe(0); // mid-height defaults to the eye
    expect(modelStandpoint(0, 0, null, Number.NaN, Number.NaN).headingDeg).toBe(0);
    expect(modelStandpoint(0, 0, null, 1, 370).headingDeg).toBe(10);
    expect(modelStandpoint(0, 0, null, 1, -90).headingDeg).toBe(270);
    // A tall model pitches the eye UP, within the FPV rails.
    expect(modelStandpoint(0, 0, [10, 10, 200], 1, 0).pitchDeg).toBeGreaterThan(30);
    expect(modelStandpoint(0, 0, [10, 10, 200], 1, 0).pitchDeg).toBeLessThanOrEqual(89);
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
