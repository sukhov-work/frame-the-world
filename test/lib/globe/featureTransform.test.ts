import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  IDENTITY_XF,
  XF_NEUTRAL_EPS,
  boundsGrowthM,
  clampXf,
  easeXf,
  isExactIdentityXf,
  isIdentityTransform,
  isIdentityXf,
  normalizeDeg,
  pristineFromIncremental,
  pristineIndexed,
  recomposeIndexed,
  recomposeVerts,
  runRadiusXZ,
  xfPivotLocal,
  type SpatialXf,
  type XfPivot,
} from "../../../src/lib/globe/featureTransform";

// MESH SUITE MS1 — the pure half of the spatial-edit substrate. The load-bearing claim is the
// §4a-3 no-regression contract: for the IDENTITY spatial transform the absolute recompose must
// reproduce the incremental seat writer's invariant `y = baseY + dyM + (y0 − baseY)·sy`, X/Z
// untouched — that is what lets 99 % of buildings stay on the fast path and an edited one drop
// back to it.

/** A 10 × 6 m prism, 12 m tall, base at y = −2 (RC13-style skirt below a true base of 0 would be
 *  handled by baseY — here baseY = −2 to keep the arithmetic honest), centroid at (100, −2 → 4, 50). */
const PRISM = (() => {
  const xs = [95, 105];
  const ys = [-2, 10];
  const zs = [47, 53];
  const v: number[] = [];
  for (const x of xs) for (const y of ys) for (const z of zs) v.push(x, y, z);
  return new Float32Array(v);
})();
const PIVOT: XfPivot = { cx: 100, baseY: -2, cz: 50 };
const RAILS = { scaleMin: 0.1, scaleMax: 10, translateMaxM: 60, liftMaxM: 25 };

/** The incremental writer's invariant, applied to a pristine vertex. */
const incremental = (y0: number, baseY: number, dyM: number, sy: number) =>
  baseY + dyM + (y0 - baseY) * sy;

describe("featureTransform — identity/neutrality", () => {
  it("IDENTITY constants are identity, exactly and within tolerance", () => {
    expect(isExactIdentityXf(IDENTITY_XF)).toBe(true);
    expect(isIdentityXf(IDENTITY_XF)).toBe(true);
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true);
  });

  it("a rotated-but-unscaled transform is NOT identity (the scalar-only neutrality bug the plan named)", () => {
    expect(isIdentityXf({ ...IDENTITY_XF, rotDeg: 15 })).toBe(false);
    expect(isIdentityTransform({ ...IDENTITY_TRANSFORM, tE: 3 })).toBe(false);
    expect(isIdentityTransform({ ...IDENTITY_TRANSFORM, sy: 2 })).toBe(false);
    expect(isIdentityTransform({ ...IDENTITY_TRANSFORM, tU: 0.5 })).toBe(false);
  });

  it("sub-threshold jitter counts as identity; 360° is 0°", () => {
    expect(isIdentityXf({ ...IDENTITY_XF, tE: XF_NEUTRAL_EPS.m / 2, rotDeg: 360 })).toBe(true);
    expect(isExactIdentityXf({ ...IDENTITY_XF, rotDeg: 360 })).toBe(false);
  });

  it("normalizeDeg lands in (−180, 180] and maps junk to 0", () => {
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(NaN)).toBe(0);
    expect(Object.is(normalizeDeg(-360), 0)).toBe(true);
  });
});

describe("featureTransform — rails", () => {
  it("clamps scales to the absolute band, lift to [0, max], rotation to (−180, 180]", () => {
    const c = clampXf({ sx: 99, sz: 0.001, rotDeg: 400, tE: 0, tN: 0, tU: -3 }, RAILS);
    expect(c).toEqual({ sx: 10, sz: 0.1, rotDeg: 40, tE: 0, tN: 0, tU: 0 });
    expect(clampXf({ ...IDENTITY_XF, tU: 999 }, RAILS).tU).toBe(25);
  });

  it("shortens an over-long translation, keeping its direction", () => {
    const c = clampXf({ ...IDENTITY_XF, tE: 300, tN: 400 }, RAILS); // |t| = 500 → 60
    expect(Math.hypot(c.tE, c.tN)).toBeCloseTo(60, 9);
    expect(c.tE / c.tN).toBeCloseTo(0.75, 9);
    const inside = clampXf({ ...IDENTITY_XF, tE: -30, tN: 20 }, RAILS);
    expect(inside).toMatchObject({ tE: -30, tN: 20 });
  });

  it("non-finite components degrade to identity, never throw", () => {
    const c = clampXf({ sx: NaN, sz: Infinity, rotDeg: NaN, tE: NaN, tN: 1, tU: NaN }, RAILS);
    expect(c).toEqual({ sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 1, tU: 0 }); // Infinity is not "too big", it is junk
  });
});

describe("featureTransform — ease", () => {
  it("converges on every component, snaps the tail exactly, and reports settled", () => {
    const target: SpatialXf = { sx: 1.5, sz: 0.8, rotDeg: 30, tE: 10, tN: -4, tU: 2 };
    let a: SpatialXf = { ...IDENTITY_XF };
    let settled = false;
    let frames = 0;
    while (!settled && frames < 200) {
      const e = easeXf(a, target, 0.18);
      a = e.next;
      settled = e.settled;
      frames++;
    }
    expect(settled).toBe(true);
    expect(a).toEqual(target);
    expect(frames).toBeLessThan(80); // ~0.18 ease: settles in ~a second at 60 Hz
  });

  it("rotation eases the SHORT way round and lands on the normalized target", () => {
    const e = easeXf({ ...IDENTITY_XF, rotDeg: 170 }, { ...IDENTITY_XF, rotDeg: -170 }, 0.5);
    expect(e.next.rotDeg).toBeCloseTo(180, 9); // 170 → −170 is +20°, not −340°
    let a = e.next;
    for (let i = 0; i < 60; i++) a = easeXf(a, { ...IDENTITY_XF, rotDeg: -170 }, 0.5).next;
    expect(a.rotDeg).toBe(-170);
  });

  it("an applied state already AT its target neither moves nor un-settles", () => {
    const e = easeXf({ ...IDENTITY_XF }, { ...IDENTITY_XF }, 0.18);
    expect(e.moved).toBe(false);
    expect(e.settled).toBe(true);
  });
});

describe("featureTransform — recompose ≡ the incremental writer for identity (§4a-3)", () => {
  it("identity spatial + any (dyM, sy) reproduces y = baseY + dyM + (y0 − baseY)·sy, X/Z untouched", () => {
    for (const [dyM, sy] of [
      [0, 1],
      [3.25, 1],
      [0, 2],
      [-7.5, 0.5],
      [12.125, 3],
    ]) {
      const out = new Float32Array(PRISM.length);
      recomposeVerts(PRISM, 0, out, 0, 8, PIVOT, IDENTITY_XF, sy, dyM);
      for (let i = 0; i < 8; i++) {
        expect(out[i * 3]).toBe(PRISM[i * 3]);
        expect(out[i * 3 + 2]).toBe(PRISM[i * 3 + 2]);
        expect(out[i * 3 + 1]).toBeCloseTo(incremental(PRISM[i * 3 + 1], PIVOT.baseY, dyM, sy), 5);
      }
    }
  });

  it("pristineFromIncremental inverts the live state back to the pristine run (round trip)", () => {
    const live = new Float32Array(PRISM.length);
    recomposeVerts(PRISM, 0, live, 0, 8, PIVOT, IDENTITY_XF, 2.5, 4.75);
    const back = pristineFromIncremental(live, 0, 8, PIVOT.baseY, 4.75, 2.5);
    for (let i = 0; i < PRISM.length; i++) expect(back[i]).toBeCloseTo(PRISM[i], 4);
    // load-model case: dyM 0, sy 1 is a straight copy
    const copy = pristineFromIncremental(PRISM, 0, 8, PIVOT.baseY, 0, 1);
    expect(Array.from(copy)).toEqual(Array.from(PRISM));
  });

  it("offset reads/writes: srcOffset/dstOffset address a run inside a larger buffer", () => {
    const big = new Float32Array(30 + PRISM.length);
    big.set(PRISM, 30);
    const out = new Float32Array(big.length);
    recomposeVerts(big, 30, out, 30, 8, PIVOT, IDENTITY_XF, 1, 0);
    expect(Array.from(out.subarray(30))).toEqual(Array.from(PRISM));
    expect(Array.from(out.subarray(0, 30))).toEqual(new Array(30).fill(0));
  });
});

describe("featureTransform — recompose geometry", () => {
  const corner = (out: Float32Array, i: number) => [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];

  it("translation adds (tE, tU, −tN): east is +X, north is −Z, lift is +Y", () => {
    const out = new Float32Array(PRISM.length);
    recomposeVerts(PRISM, 0, out, 0, 8, PIVOT, { ...IDENTITY_XF, tE: 5, tN: 7, tU: 1.5 }, 1, 0);
    for (let i = 0; i < 8; i++) {
      expect(corner(out, i)).toEqual([PRISM[i * 3] + 5, PRISM[i * 3 + 1] + 1.5, PRISM[i * 3 + 2] - 7]);
    }
  });

  it("scale is about the pivot: the centroid stays put, the base plane stays put", () => {
    const out = new Float32Array(PRISM.length);
    recomposeVerts(PRISM, 0, out, 0, 8, PIVOT, { ...IDENTITY_XF, sx: 2, sz: 0.5 }, 1, 0);
    // x: 95/105 → 90/110 about 100; z: 47/53 → 48.5/51.5 about 50; y unchanged
    expect(corner(out, 0)).toEqual([90, -2, 48.5]);
    expect(corner(out, 7)).toEqual([110, 10, 51.5]);
  });

  it("rotation follows three's makeRotationY sense: +90° turns +X (east) into −Z (north)", () => {
    const src = new Float32Array([PIVOT.cx + 10, PIVOT.baseY, PIVOT.cz]); // 10 m east of the pivot
    const out = new Float32Array(3);
    recomposeVerts(src, 0, out, 0, 1, PIVOT, { ...IDENTITY_XF, rotDeg: 90 }, 1, 0);
    expect(out[0]).toBeCloseTo(PIVOT.cx, 9);
    expect(out[2]).toBeCloseTo(PIVOT.cz - 10, 9); // north
    recomposeVerts(src, 0, out, 0, 1, PIVOT, { ...IDENTITY_XF, rotDeg: -90 }, 1, 0);
    expect(out[2]).toBeCloseTo(PIVOT.cz + 10, 9); // south
  });

  it("composition order is scale → rotate → translate about the pivot (a 90° twist of a 2× east stretch)", () => {
    const src = new Float32Array([PIVOT.cx + 10, PIVOT.baseY + 4, PIVOT.cz]);
    const out = new Float32Array(3);
    recomposeVerts(src, 0, out, 0, 1, PIVOT, { sx: 2, sz: 1, rotDeg: 90, tE: 1, tN: 2, tU: 3 }, 1.5, 0.5);
    // scale: +20 east; rotate 90°: → 20 north (−Z); translate: +1 E, −2 Z, +3 up; y: (4)·1.5 + 0.5 seat + 3 lift
    expect(out[0]).toBeCloseTo(PIVOT.cx + 1, 9);
    expect(out[1]).toBeCloseTo(PIVOT.baseY + 4 * 1.5 + 0.5 + 3, 9);
    expect(out[2]).toBeCloseTo(PIVOT.cz - 20 - 2, 9);
  });

  it("recomposeIndexed writes scattered destination indices from a packed pristine bucket", () => {
    const dst = new Float32Array(9 * 3);
    const idx = new Int32Array([0, 4, 8, 2]); // bucket = [4, 8] (from 1 to 3)
    const packed = pristineIndexed(PRISM, new Int32Array([0, 1, 2, 3]), 1, 3, PIVOT.baseY, 0, 1); // verts 1, 2 of PRISM
    recomposeIndexed(packed, dst, idx, 1, 3, PIVOT, { ...IDENTITY_XF, tE: 1 }, 1, 0);
    expect(corner(dst, 4)).toEqual([PRISM[3] + 1, PRISM[4], PRISM[5]]);
    expect(corner(dst, 8)).toEqual([PRISM[6] + 1, PRISM[7], PRISM[8]]);
    expect(corner(dst, 0)).toEqual([0, 0, 0]); // untouched
  });
});

describe("featureTransform — pivot, radius, bounds", () => {
  it("xfPivotLocal is the translated pivot before the seat delta", () => {
    expect(xfPivotLocal(PIVOT, { ...IDENTITY_XF, tE: 2, tN: 3, tU: 4 })).toEqual([102, 2, 47]);
  });

  it("runRadiusXZ takes the farther extent on each axis", () => {
    expect(runRadiusXZ(100, 50, 95, 110, 47, 53)).toBeCloseTo(Math.hypot(10, 3), 9);
  });

  it("boundsGrowthM is ≥ 0, monotone, and sums the four growth terms", () => {
    expect(boundsGrowthM(IDENTITY_XF, 1, 8, 12)).toBe(0);
    expect(boundsGrowthM(IDENTITY_XF, 0.5, 8, 12)).toBe(0); // shrink never un-grows
    expect(boundsGrowthM({ sx: 2, sz: 1, rotDeg: 0, tE: 3, tN: 4, tU: 1 }, 2, 8, 12)).toBeCloseTo(
      5 + 1 + 8 + 12,
      9,
    );
  });
});

// ── MESH SUITE MS2 — the gizmo rig read-back ────────────────────────────────────────────────
import {
  rigToTransform,
  transformToRig,
  yawDegFromQuaternion,
  type FeatureTransform,
  type RigFrame,
} from "../../../src/lib/globe/featureTransform";

describe("MS2 rig read-back (the exact inverse of placeGhost)", () => {
  const FRAME: RigFrame = { cx: 120.5, cz: -44, liveBaseY: 3.25, inflate: 1.015 };
  const T: FeatureTransform = { sx: 1.2, sz: 0.9, sy: 1.4, rotDeg: 25, tE: 6, tN: -4, tU: 1.5 };

  it("yaw from a pure-Y quaternion is exact over the whole circle (Euler .y is not)", () => {
    for (const deg of [0, 30, 90, 120, 179, -45, -120, -179.5]) {
      const rad = (deg * Math.PI) / 180;
      expect(yawDegFromQuaternion(Math.sin(rad / 2), Math.cos(rad / 2))).toBeCloseTo(deg, 9);
    }
    // 180° lands on +180 (the (−180, 180] convention) whichever way the quaternion signs it.
    expect(Math.abs(yawDegFromQuaternion(1, 0))).toBe(180);
    expect(Math.abs(yawDegFromQuaternion(-1, 0))).toBe(180);
    // The identity quaternion never yields −0 (a −0 would survive JSON as "0" but fail ===).
    expect(Object.is(yawDegFromQuaternion(0, 1), 0)).toBe(true);
  });

  it("transformToRig ∘ rigToTransform is the identity on every component", () => {
    const back = rigToTransform(transformToRig(T, FRAME), FRAME);
    for (const k of Object.keys(T) as (keyof FeatureTransform)[]) expect(back[k]).toBeCloseTo(T[k], 9);
  });

  it("the rig numbers are placeGhost's writes: anchor = pivot + t, body = R_y · S·inflate", () => {
    const rig = transformToRig(T, FRAME);
    expect(rig.ax).toBeCloseTo(FRAME.cx + T.tE, 12);
    expect(rig.ay).toBeCloseTo(FRAME.liveBaseY + T.tU, 12);
    expect(rig.az).toBeCloseTo(FRAME.cz - T.tN, 12); // −Z is north
    expect(rig.sx).toBeCloseTo(FRAME.inflate * T.sx, 12);
    expect(rig.sz).toBeCloseTo(FRAME.inflate * T.sz, 12);
    expect(rig.sy).toBe(T.sy); // Y carries no inflate
    expect(2 * Math.atan2(rig.qy, rig.qw)).toBeCloseTo((T.rotDeg * Math.PI) / 180, 12);
  });

  it("an untouched rig reads back as the identity transform", () => {
    const id: FeatureTransform = { sx: 1, sz: 1, sy: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 };
    const back = rigToTransform(transformToRig(id, FRAME), FRAME);
    expect(back).toEqual(id);
  });

  it("a bad inflate degrades to 1 instead of dividing by zero", () => {
    const rig = transformToRig(T, { ...FRAME, inflate: 1 });
    const back = rigToTransform(rig, { ...FRAME, inflate: 0 });
    expect(back.sx).toBeCloseTo(T.sx, 12);
    expect(back.sz).toBeCloseTo(T.sz, 12);
  });
});
