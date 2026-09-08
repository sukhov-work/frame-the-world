import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/lib/geo/geohash";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import { IDENTITY_TRANSFORM } from "../../../src/lib/globe/featureTransform";
import {
  IDENTITY_MODEL_EDIT,
  IDENTITY_MODEL_TRANSFORM,
  MODEL_LIFT_KEEP,
  MODEL_LIFT_MAX_M,
  MODEL_MOVE_MAX_M,
  MODEL_SCALE_MAX,
  MODEL_SCALE_MIN,
  canonicalTilt,
  clampLiftFor,
  clampLiftM,
  clampModelEdit,
  densityWarning,
  editToFeatureTransform,
  eulerFromQuaternion,
  groundFitOffset,
  isIdentityModelTransform,
  isTilted,
  liftFloorFor,
  liftFloorM,
  offsetGeodetic,
  quaternionFromTilt,
  tiltedExtent,
  planModelCover,
  planResidency,
  sameCover,
  sanitizeModelScale,
  sanitizeModelTransform,
  formatModelScale,
  scaledSizeM3,
  uniformModelScale,
  STANDPOINT,
  modelStandpoint,
} from "../../../src/lib/models/modelPlacement";

// MESH SUITE MS5 — the placement contract: the gizmo read-back (T128, owner 2026-09-08b: the
// scale PER AXIS, the buildings' shape — the MS5 uniform collapse is gone), the rails, the
// geodetic fold-in of a move, the ground-fit re-base, the world-read cover and closest-first
// residency.

const dist = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("modelPlacement — transform seats", () => {
  it("sanitizes a stored row's seats: null = identity, garbage = identity, scale clamped onto the rails", () => {
    expect(sanitizeModelTransform(null, null)).toEqual({ rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 });
    expect(sanitizeModelTransform("x", Number.NaN)).toEqual({ rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 });
    expect(sanitizeModelTransform(370, 50)).toEqual({ rotDeg: 10, sx: 50, sy: 50, sz: 50, liftM: 0, pitchDeg: 0, rollDeg: 0 }); // inside the loose sanity rail (MS5b)
    expect(sanitizeModelTransform(370, 5000)).toEqual({ rotDeg: 10, sx: MODEL_SCALE_MAX, sy: MODEL_SCALE_MAX, sz: MODEL_SCALE_MAX, liftM: 0, pitchDeg: 0, rollDeg: 0 });
    expect(sanitizeModelTransform(-180, 0.0001).sy).toBe(MODEL_SCALE_MIN);
    expect(isIdentityModelTransform({ rotDeg: 0.01, sx: 1.001, sy: 1.001, sz: 1.001, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toBe(true);
    expect(isIdentityModelTransform({ rotDeg: 12, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toBe(false);
    // T128: any ONE axis off 1 is an edit.
    expect(isIdentityModelTransform({ ...IDENTITY_MODEL_TRANSFORM, sx: 1.2 })).toBe(false);
    expect(isIdentityModelTransform({ ...IDENTITY_MODEL_TRANSFORM, sz: 0.9 })).toBe(false);
  });

  it("T128 — reads a scale per axis: a legacy uniform number fans out, a row object falls back `scaleX/Z → scale → 1`, each axis on the rail", () => {
    // A row written before T128 (`scale` alone) is the same uniform box it always was.
    expect(sanitizeModelScale(2)).toEqual({ sx: 2, sy: 2, sz: 2 });
    expect(sanitizeModelScale({ scale: 2 })).toEqual({ sx: 2, sy: 2, sz: 2 });
    expect(sanitizeModelScale({ scale: 2, sx: null, sz: null })).toEqual({ sx: 2, sy: 2, sz: 2 });
    // Per axis: a missing axis takes the height factor; `sy` outranks `scale` when both are given.
    expect(sanitizeModelScale({ sx: 3 })).toEqual({ sx: 3, sy: 1, sz: 1 });
    expect(sanitizeModelScale({ scale: 2, sz: 1 })).toEqual({ sx: 2, sy: 2, sz: 1 });
    expect(sanitizeModelScale({ sx: 1.5, sy: 1, sz: 2 })).toEqual({ sx: 1.5, sy: 1, sz: 2 });
    expect(sanitizeModelScale({ scale: 2, sy: 3 })).toEqual({ sx: 3, sy: 3, sz: 3 });
    // Garbage per axis reads as the fallback; the rail applies per axis; nothing at all is identity.
    expect(sanitizeModelScale({ scale: 2, sx: "wide", sz: Number.NaN })).toEqual({ sx: 2, sy: 2, sz: 2 });
    expect(sanitizeModelScale({ sx: 5000, sy: 0.0001, sz: 1 })).toEqual({ sx: MODEL_SCALE_MAX, sy: MODEL_SCALE_MIN, sz: 1 });
    expect(sanitizeModelScale(null)).toEqual({ sx: 1, sy: 1, sz: 1 });
    expect(sanitizeModelScale("x")).toEqual({ sx: 1, sy: 1, sz: 1 });
    expect(sanitizeModelTransform(0, { scale: 2, sx: 3 }, 0, [4, 2, 10])).toMatchObject({ sx: 3, sy: 2, sz: 2 });
    // A transform IS a ModelScale (the scene hands its target straight back in).
    expect(sanitizeModelScale({ ...IDENTITY_MODEL_TRANSFORM, sx: 0.5 })).toEqual({ sx: 0.5, sy: 1, sz: 1 });
  });

  it("T128 — the readouts: ONE factor while the axes agree (within the eps), the `sx × sz × sy` triple otherwise; the scaled size per axis", () => {
    expect(uniformModelScale({ sx: 2, sy: 2, sz: 2 })).toBe(2);
    expect(uniformModelScale({ sx: 2.004, sy: 2, sz: 1.996 })).toBe(2); // the height factor speaks for the three
    expect(uniformModelScale({ sx: 2, sy: 1, sz: 2 })).toBeNull();
    expect(uniformModelScale({ sx: 1, sy: 1, sz: 1.01 })).toBeNull();
    expect(formatModelScale({ sx: 2, sy: 2, sz: 2 })).toBe("2.00×");
    expect(formatModelScale({ sx: 0.5, sy: 0.5, sz: 0.5 })).toBe("0.50×");
    // The triple follows the SIZE readout's order — width × depth × height = sx × sz × sy.
    expect(formatModelScale({ sx: 1.5, sy: 2, sz: 1 })).toBe("1.50 × 1.00 × 2.00");
    expect(formatModelScale({ sx: 1, sy: 1, sz: 3 })).toBe("1.00 × 3.00 × 1.00");
    expect(formatModelScale({ sx: Number.NaN, sy: 1, sz: 1 })).toBe("1.00×"); // garbage reads as 1
    // `[w, d, h]` at scale 1 → `[w·sx, d·sz, h·sy]`.
    expect(scaledSizeM3([3, 5, 4], { sx: 2, sy: 2, sz: 2 })).toEqual([6, 10, 8]);
    expect(scaledSizeM3([3, 5, 4], { sx: 1.5, sy: 2, sz: 1 })).toEqual([4.5, 5, 8]);
  });

  it("clamps a read-back: the per-edit band about the start PER AXIS (T128), the yaw wrapped, the move shortened, the lift railed", () => {
    const e = clampModelEdit({ sx: 40, sy: 1, sz: 1, rotDeg: 370, tE: 300, tN: 400, tU: 9 }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 }, 4);
    expect(e.sx).toBe(10); // 10× per edit (MS5b — was 3×) — on the X axis ALONE
    expect(e.sy).toBe(1);
    expect(e.sz).toBe(1);
    expect(e.rotDeg).toBe(10);
    expect(Math.hypot(e.tE, e.tN)).toBeCloseTo(MODEL_MOVE_MAX_M, 9);
    expect(e.tE / e.tN).toBeCloseTo(0.75, 9); // direction kept
    expect(e.liftM).toBe(9); // MS7: the lift is a seat (inside the rail: a 4 m model, 10× WIDE but still 4 m tall — the ceiling is 50)
    // T128: a drag on one box leaves the other two at their start — a wide model stays as tall
    // and as deep as it was; each axis is railed on its own about ITS committed factor.
    const start211 = { rotDeg: 0, sx: 2, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 };
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 2, sy: 1, sz: 1 }, start211)).toMatchObject({ sx: 2, sy: 1, sz: 1 });
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 2, sy: 3, sz: 1 }, start211)).toMatchObject({ sx: 2, sy: 3, sz: 1 });
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 2, sy: 1, sz: 0.25 }, start211)).toMatchObject({ sx: 2, sy: 1, sz: 0.25 });
    // The band is per axis about that axis's start: X may reach 20 (2 × 10) while Y stops at 10 (1 × 10) and Z at 0.1.
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 50, sy: 50, sz: 0.001 }, start211)).toMatchObject({ sx: 20, sy: 10, sz: 0.1 });
    // A non-finite axis reads as its start, never a jump.
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: Number.NaN, sy: 1, sz: 1 }, start211)).toMatchObject({ sx: 2, sy: 1, sz: 1 });
    // Edits compound about the committed scale with no absolute cap — only the loose sanity rail.
    // (three's scale mode leaves the undragged axes at the START scale — 4 here, not 1.)
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 9, sy: 4, sz: 4 }, { rotDeg: 0, sx: 4, sy: 4, sz: 4, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toMatchObject({ sx: 9, sy: 4, sz: 4 });
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 40, sy: 4, sz: 4 }, { rotDeg: 0, sx: 4, sy: 4, sz: 4, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toMatchObject({ sx: 40, sy: 4, sz: 4 });
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 5000, sy: 400, sz: 400 }, { rotDeg: 0, sx: 400, sy: 400, sz: 400, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toMatchObject({
      sx: MODEL_SCALE_MAX,
      sy: 400,
      sz: 400,
    });
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 })).toEqual(IDENTITY_MODEL_EDIT);
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
    expect(sanitizeModelTransform(0, 1, -7, 10)).toEqual({ rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -7, pitchDeg: 0, rollDeg: 0 });
    expect(sanitizeModelTransform(0, 0.5, -7, 10).liftM).toBe(-3.75); // 5 m tall at 0.5× → floor −3.75
    expect(sanitizeModelTransform(0, 1, -7, null).liftM).toBe(0); // unknown height pins
    expect(sanitizeModelTransform(0, 1, 500, 10).liftM).toBe(MODEL_LIFT_MAX_M);
    expect(isIdentityModelTransform({ rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0.005, pitchDeg: 0, rollDeg: 0 })).toBe(true);
    expect(isIdentityModelTransform({ rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0.02, pitchDeg: 0, rollDeg: 0 })).toBe(false);
    // The gizmo read-back: the floor follows the CLAMPED scale of the same read-back, so a shrink
    // that would bury a sunk model lifts it instead (10 m model sunk 7 m, HEIGHT scaled to 0.5× →
    // −3.75). T128: the floor is about the HEIGHT axis — a shrink on X alone leaves it be.
    const shrunk = clampModelEdit({ sx: 1, sy: 0.5, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: -7 }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -7, pitchDeg: 0, rollDeg: 0 }, 10);
    expect(shrunk).toMatchObject({ sx: 1, sy: 0.5, sz: 1 });
    expect(shrunk.liftM).toBe(-3.75);
    const narrowed = clampModelEdit({ sx: 0.5, sy: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: -7 }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -7, pitchDeg: 0, rollDeg: 0 }, 10);
    expect(narrowed).toMatchObject({ sx: 0.5, sy: 1, sz: 1, liftM: -7 });
    // A drag past the ceiling stops at it; NaN reads as on the ground.
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, tU: 80 }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 }, 10).liftM).toBe(MODEL_LIFT_MAX_M);
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, tU: Number.NaN }, { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 2, pitchDeg: 0, rollDeg: 0 }, 10).liftM).toBe(0);
  });

  it("the forward map speaks the gizmo's FeatureTransform with the scale per axis (T128), the lift as tU and (MS8) the tilt", () => {
    expect(editToFeatureTransform({ rotDeg: 30, sx: 1.5, sy: 0.5, sz: 2, liftM: -2, pitchDeg: 12, rollDeg: -5, tE: 2, tN: -3 })).toEqual({
      sx: 1.5,
      sy: 0.5,
      sz: 2,
      rotDeg: 30,
      tE: 2,
      tN: -3,
      tU: -2,
      pitchDeg: 12,
      rollDeg: -5,
    });
  });
});

// MESH SUITE MS8 (owner 2026-09-03; built 2026-09-05) — the VERTICAL rotation: pitch / roll as
// two more seats beside the yaw, the YXZ quaternion pair, the canonical read-back and the
// tilt-aware lift floor ("never fully into the texture" holds for a tipped or flipped model).
describe("modelPlacement — MS8 the tilt (pitch / roll)", () => {
  const closeQ = (a: readonly number[], b: readonly number[], digits = 9) => {
    // A quaternion and its negation are the same rotation.
    const s = a[3] * b[3] + a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(s * b[i], digits);
  };

  it("quaternionFromTilt is three's Euler 'YXZ' (R_y · R_x · R_z), a pure yaw for an upright model", () => {
    const yawOnly = quaternionFromTilt(120, 0, 0);
    closeQ(yawOnly, [0, Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)]);
    // Column vectors: R_y(90)·R_x(90) sends +Y (the model's up) to +Z first (three's R_x: y' =
    // c·y − s·z, z' = s·y + c·z), then R_y turns +Z toward +X (x' = c·x + s·z). Check the rotated
    // up-vector against the quaternion's second column.
    const q = quaternionFromTilt(90, 90, 0);
    const [x, y, z, w] = q;
    const up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    expect(up[0]).toBeCloseTo(1, 9);
    expect(up[1]).toBeCloseTo(0, 9);
    expect(up[2]).toBeCloseTo(0, 9);
    // Identity and unit length.
    expect(quaternionFromTilt(0, 0, 0)).toEqual([0, 0, 0, 1]);
    const r = quaternionFromTilt(33, -21, 170);
    expect(Math.hypot(...r)).toBeCloseTo(1, 12);
  });

  it("eulerFromQuaternion is the exact inverse over the canonical range, and reads a pure yaw to the ulp", () => {
    for (const [y, p, r] of [
      [0, 0, 0],
      [45, 30, -10],
      [-120, -60, 170],
      [180, 89, 180],
      [10, -89.9, -179],
      [77, 0, 0],
      [0, 0, 90],
    ]) {
      const q = quaternionFromTilt(y, p, r);
      const e = eulerFromQuaternion(q[0], q[1], q[2], q[3]);
      expect(e.yawDeg).toBeCloseTo(y, 6);
      expect(e.pitchDeg).toBeCloseTo(p, 6);
      expect(e.rollDeg).toBeCloseTo(r, 6);
    }
    // A pure yaw: the same answer the buildings' `yawDegFromQuaternion` gives.
    const q = quaternionFromTilt(-135, 0, 0);
    expect(eulerFromQuaternion(q[0], q[1], q[2], q[3])).toEqual({ yawDeg: -135, pitchDeg: 0, rollDeg: 0 });
    // The gimbal pole: pitch ±90 is representable; the roll folds into the yaw (three's rule),
    // and the composed rotation is the SAME.
    const pole = quaternionFromTilt(40, 90, 25);
    const e = eulerFromQuaternion(pole[0], pole[1], pole[2], pole[3]);
    expect(e.pitchDeg).toBeCloseTo(90, 5); // (asin near 1 — a few 1e-7° of dust)
    closeQ(quaternionFromTilt(e.yawDeg, e.pitchDeg, e.rollDeg), pole, 7);
    // Float dust on x / z reads as upright; a −0 never leaks.
    const dusty = eulerFromQuaternion(1e-12, Math.sin(0.3), -1e-12, Math.cos(0.3));
    expect(dusty.pitchDeg).toBeCloseTo(0, 6);
    expect(Object.is(eulerFromQuaternion(0, 0, 0, 1).yawDeg, 0)).toBe(true);
  });

  it("canonicalTilt folds a pitch past ±90° into the SAME rotation with the yaw and roll turned 180°", () => {
    expect(canonicalTilt(30, -10)).toEqual({ pitchDeg: 30, rollDeg: -10, yawAddDeg: 0 });
    expect(canonicalTilt(90, 0)).toEqual({ pitchDeg: 90, rollDeg: 0, yawAddDeg: 0 });
    const folded = canonicalTilt(120, 10);
    expect(folded).toEqual({ pitchDeg: 60, rollDeg: -170, yawAddDeg: 180 });
    closeQ(quaternionFromTilt(20 + folded.yawAddDeg, folded.pitchDeg, folded.rollDeg), quaternionFromTilt(20, 120, 10));
    expect(canonicalTilt(-100, 0)).toEqual({ pitchDeg: -80, rollDeg: 180, yawAddDeg: 180 });
    expect(canonicalTilt(370, 725)).toEqual({ pitchDeg: 10, rollDeg: 5, yawAddDeg: 0 });
  });

  it("tiltedExtent: the rotated box's top and span about the pivot — upright = the height, on its side = the depth, flipped = all below", () => {
    // A 4 wide × 2 deep × 10 tall box (w, d, h) at 1×.
    expect(tiltedExtent([4, 2, 10], 1, 0, 0)).toEqual({ topM: 10, extentM: 10 });
    expect(tiltedExtent([4, 2, 10], 2, 0, 0)).toEqual({ topM: 20, extentM: 20 });
    // Pitched 90°: the height lies flat; the depth (2) straddles the pivot — 1 above, 1 below.
    const side = tiltedExtent([4, 2, 10], 1, 90, 0)!;
    expect(side.topM).toBeCloseTo(1, 9);
    expect(side.extentM).toBeCloseTo(2, 9);
    // Rolled 90°: the width (4) straddles the pivot.
    const bank = tiltedExtent([4, 2, 10], 1, 0, 90)!;
    expect(bank.topM).toBeCloseTo(2, 9);
    expect(bank.extentM).toBeCloseTo(4, 9);
    // Flipped (roll 180): everything hangs below the pivot.
    const flip = tiltedExtent([4, 2, 10], 1, 0, 180)!;
    expect(flip.topM).toBeCloseTo(0, 9);
    expect(flip.extentM).toBeCloseTo(10, 9);
    // Tipped 30°: top = cos30·10 + sin30·1 (half the depth swings up), bottom = −sin30·1.
    const tip = tiltedExtent([4, 2, 10], 1, 30, 0)!;
    expect(tip.topM).toBeCloseTo(Math.cos(Math.PI / 6) * 10 + 0.5, 9);
    expect(tip.extentM).toBeCloseTo(Math.cos(Math.PI / 6) * 10 + 1, 9);
    // The yaw changes nothing; a bare height reads as a pole; unknown / degenerate → null.
    expect(tiltedExtent(10, 1, 0, 0)).toEqual({ topM: 10, extentM: 10 });
    expect(tiltedExtent(10, 1, 90, 0)).toBeNull(); // a pole on its side has no vertical span
    expect(tiltedExtent(null, 1, 30, 0)).toBeNull();
    expect(tiltedExtent([0, 0, 0], 1, 0, 0)).toBeNull();
    expect(tiltedExtent([4, 2, 10], Number.NaN, 0, 0)).toEqual({ topM: 10, extentM: 10 }); // a bad scale reads as 1
    // T128: the scale per axis — upright, only the HEIGHT factor moves the floor; on its side the
    // DEPTH factor does; a bad axis reads as 1; a uniform triple is the uniform number to the bit.
    expect(tiltedExtent([4, 2, 10], { sx: 3, sy: 1, sz: 3 }, 0, 0)).toEqual({ topM: 10, extentM: 10 });
    expect(tiltedExtent([4, 2, 10], { sx: 1, sy: 0.5, sz: 1 }, 0, 0)).toEqual({ topM: 5, extentM: 5 });
    const sideZ = tiltedExtent([4, 2, 10], { sx: 1, sy: 1, sz: 3 }, 90, 0)!; // depth 6 straddles the pivot
    expect(sideZ.topM).toBeCloseTo(3, 9);
    expect(sideZ.extentM).toBeCloseTo(6, 9);
    const bankX = tiltedExtent([4, 2, 10], { sx: 0.5, sy: 7, sz: 1 }, 0, 90)!; // width 2 straddles it; the height is sideways
    expect(bankX.topM).toBeCloseTo(1, 9);
    expect(bankX.extentM).toBeCloseTo(2, 9);
    expect(tiltedExtent([4, 2, 10], { sx: Number.NaN, sy: -1, sz: 2 }, 0, 0)).toEqual({ topM: 10, extentM: 10 });
    expect(tiltedExtent([4, 2, 10], { sx: 2, sy: 2, sz: 2 }, 30, 0)).toEqual(tiltedExtent([4, 2, 10], 2, 30, 0));
    // The floor follows: a model 3× wide but 1× tall may sink no further than at 1×.
    expect(liftFloorFor(tiltedExtent(10, { sx: 3, sy: 1, sz: 3 }, 0, 0))).toBe(-7.5);
    expect(liftFloorFor(tiltedExtent([4, 2, 10], { sx: 1, sy: 0.5, sz: 1 }, 0, 0))).toBe(-3.75);
  });

  it("liftFloorFor keeps a quarter (≥ 0.5 m) of the ROTATED span above the seat — the MS7 number upright, a POSITIVE floor for a flip", () => {
    // Upright: byte-identical to liftFloorM.
    for (const h of [0.3, 0.4, 1, 2.5, 10, 31.2, 400]) expect(liftFloorFor({ topM: h, extentM: h })).toBe(liftFloorM(h));
    // On its side (top 1, span 2): keep max(0.5, 0.5) = 0.5 → floor 0.5 − 1 = −0.5.
    expect(liftFloorFor({ topM: 1, extentM: 2 })).toBe(-0.5);
    // Flipped (top 0, span 10): keep 2.5 → the model is HELD UP 2.5 m so a quarter shows.
    expect(liftFloorFor({ topM: 0, extentM: 10 })).toBe(2.5);
    // A thin plate upright (top = span = 0.1): the keep (0.5) exceeds the span → floor 0, never up.
    expect(liftFloorFor({ topM: 0.1, extentM: 0.1 })).toBe(0);
    // Inside the absolute rail both ways.
    expect(liftFloorFor({ topM: 0, extentM: 400 })).toBe(MODEL_LIFT_MAX_M);
    expect(liftFloorFor({ topM: 400, extentM: 400 })).toBe(-MODEL_LIFT_MAX_M);
    expect(liftFloorFor(null)).toBe(0);
    expect(Object.is(liftFloorFor({ topM: 0.5, extentM: 0.5 }), 0)).toBe(true);
    // clampLiftFor rails onto [floor, 50]: a flipped model at "0" is lifted to its floor.
    expect(clampLiftFor(0, { topM: 0, extentM: 10 })).toBe(2.5);
    expect(clampLiftFor(-3, { topM: 1, extentM: 2 })).toBe(-0.5);
    expect(clampLiftFor(80, { topM: 10, extentM: 10 })).toBe(MODEL_LIFT_MAX_M);
  });

  it("sanitizeModelTransform reads the tilt (null = upright), makes it canonical, and takes the lift floor from the TILTED box", () => {
    expect(sanitizeModelTransform(0, 1, 0, null, null, undefined)).toEqual(IDENTITY_MODEL_TRANSFORM);
    expect(sanitizeModelTransform(0, 1, 0, null, "x", Number.NaN)).toEqual(IDENTITY_MODEL_TRANSFORM);
    expect(sanitizeModelTransform(10, 1, 0, null, 30, -370)).toMatchObject({ rotDeg: 10, pitchDeg: 30, rollDeg: -10 });
    // A pitch past 90 folds (same rotation): yaw +180, pitch mirrored, roll +180.
    expect(sanitizeModelTransform(10, 1, 0, null, 120, 0)).toMatchObject({ rotDeg: -170, pitchDeg: 60, rollDeg: 180 });
    // The floor: a 4 × 2 × 10 box flipped is held up 2.5 m even when the row says 0 / −7.
    expect(sanitizeModelTransform(0, 1, 0, [4, 2, 10], 0, 180).liftM).toBe(2.5);
    expect(sanitizeModelTransform(0, 1, -7, [4, 2, 10], 0, 180).liftM).toBe(2.5);
    // On its side it may sink half a metre; upright the MS7 floor (−7.5) still holds.
    expect(sanitizeModelTransform(0, 1, -7, [4, 2, 10], 90, 0).liftM).toBe(-0.5);
    expect(sanitizeModelTransform(0, 1, -7, [4, 2, 10], 0, 0).liftM).toBe(-7);
    expect(sanitizeModelTransform(0, 1, -9, [4, 2, 10], 0, 0).liftM).toBe(-7.5);
    // A bare height (the MS7 shape) still works for an upright model; unknown pins.
    expect(sanitizeModelTransform(0, 1, -7, 10, 0, 0).liftM).toBe(-7);
    expect(sanitizeModelTransform(0, 1, -7, null, 0, 180).liftM).toBe(0);
    expect(isTilted({ pitchDeg: 0.01, rollDeg: -0.04 })).toBe(false);
    expect(isTilted({ pitchDeg: 0, rollDeg: 0.05 })).toBe(true);
    expect(isIdentityModelTransform({ ...IDENTITY_MODEL_TRANSFORM, pitchDeg: 0.04 })).toBe(true);
    expect(isIdentityModelTransform({ ...IDENTITY_MODEL_TRANSFORM, rollDeg: 1 })).toBe(false);
  });

  it("clampModelEdit carries the gizmo's pitch / roll (absent = upright — the building read-back) and re-rails the lift for them", () => {
    const start = { ...IDENTITY_MODEL_TRANSFORM };
    // The building-shaped read-back (no tilt fields) reads as upright.
    expect(clampModelEdit({ ...IDENTITY_TRANSFORM, rotDeg: 20 }, start, [4, 2, 10])).toMatchObject({ rotDeg: 20, pitchDeg: 0, rollDeg: 0 });
    // A tilt instance's read-back: canonical, the floor from the tilted box (a flip at lift 0 is held up).
    const flip = clampModelEdit({ ...IDENTITY_TRANSFORM, rollDeg: 180 }, start, [4, 2, 10]);
    expect(flip).toMatchObject({ rotDeg: 0, pitchDeg: 0, rollDeg: 180, liftM: 2.5 });
    const folded = clampModelEdit({ ...IDENTITY_TRANSFORM, rotDeg: 20, pitchDeg: 100, rollDeg: 0 }, start, [4, 2, 10]);
    expect(folded).toMatchObject({ rotDeg: -160, pitchDeg: 80, rollDeg: 180 });
    // Sunk 7 m upright, then tipped onto its side: the floor rises to −0.5 (the depth straddles the pivot).
    const tipped = clampModelEdit({ ...IDENTITY_TRANSFORM, tU: -7, pitchDeg: 90 }, { ...start, liftM: -7 }, [4, 2, 10]);
    expect(tipped.liftM).toBe(-0.5);
    // The scale still compounds (T128: on its own axis) and the tilt rides through with a bad
    // number reading as 0.
    const scaled = clampModelEdit({ ...IDENTITY_TRANSFORM, sx: 2, pitchDeg: Number.NaN, rollDeg: 15 }, start, [4, 2, 10]);
    expect(scaled).toMatchObject({ sx: 2, sy: 1, sz: 1, pitchDeg: 0, rollDeg: 15 });
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

  it("scales with the committed scale (T128: per axis — the longest SCALED extent, the mid-height at sy), clamps to [6, 120] m, and tolerates an unknown size or a bad heading", () => {
    expect(modelStandpoint(0, 0, [3, 5, 3], 3, 0).distM).toBe(45);
    expect(modelStandpoint(0, 0, [3, 5, 3], { sx: 3, sy: 3, sz: 3 }, 0)).toEqual(modelStandpoint(0, 0, [3, 5, 3], 3, 0));
    // w 3 × sx 4 = 12 outranks d 5 × sz 1 → 36 m out; the mid-height follows sy alone (h 3 × 2 / 2 = 3).
    const wide = modelStandpoint(0, 0, [3, 5, 3], { sx: 4, sy: 2, sz: 1 }, 0);
    expect(wide.distM).toBe(36);
    expect(wide.pitchDeg).toBeCloseTo((Math.atan2(3 - STANDPOINT.eyeM, 36) * 180) / Math.PI, 9);
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
