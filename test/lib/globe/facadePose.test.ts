import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  eulerFromQuaternion,
  offsetGeodetic,
  quaternionFromTilt,
} from "../../../src/lib/models/modelPlacement";
import { normalizeDeg, type FeatureTransform } from "../../../src/lib/globe/featureTransform";
import {
  clampFacadeEdit,
  facadeBodyQuaternion,
  facadeStartTransform,
  facadeWriteFromStart,
  hFovScaleFactor,
  ringAngleDeg,
  scaleAxisFactor,
  scaleHFovDeg,
  wrapHeadingDeg,
  type FacadeDragStart,
  type FacadeGains,
  type FacadeRails,
  type RingAxis,
} from "../../../src/lib/globe/facadePose";

// FACADE F1 (2026-10-21) — the gizmo's pure pose maths: the ring read, the H-FOV law, the gained
// + railed edit per op. The SIGN triple (−heading / +pitch / +roll under the ENU rig) is pinned
// against `frustumGeometry` in `test/components/globe/facadeGizmo.test.ts`; here the maths.

const GAINS: FacadeGains = { move: 0.5, rotate: 0.5, scale: 0.5 };
const RAILS: FacadeRails = {
  altMinM: 0,
  altMaxM: 60,
  hFovMinDeg: 5,
  hFovMaxDeg: 120,
  pitchMaxDeg: 45,
  rollMaxDeg: 30,
};
const START: FacadeDragStart = {
  lat: 48.46,
  lon: 35.04,
  aboveGroundM: 30,
  headingDeg: 200,
  pitchDeg: 20,
  rollDeg: 0,
  hFovDeg: 60,
};

const T = (start: FacadeDragStart, over: Partial<FeatureTransform> = {}): FeatureTransform => ({
  ...facadeStartTransform(start),
  ...over,
});

/** The body after three's LOCAL-space ring drag — `q_start · axisAngle(local axis, θ)` (three
 *  0.185 `pointerMove`, rotate branch) — read back the way the gizmo's `tilt` instance reads it:
 *  the canonical YXZ triple of the whole quaternion (`eulerFromQuaternion`). */
const ringRaw = (start: FacadeDragStart, axis: RingAxis, thetaDeg: number): FeatureTransform => {
  const qs = facadeBodyQuaternion(start.headingDeg, start.pitchDeg, start.rollDeg);
  const q = new THREE.Quaternion(qs[0], qs[1], qs[2], qs[3]);
  const unit =
    axis === "X"
      ? new THREE.Vector3(1, 0, 0)
      : axis === "Y"
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(unit, (thetaDeg * Math.PI) / 180)).normalize();
  const e = eulerFromQuaternion(q.x, q.y, q.z, q.w);
  return T(start, { rotDeg: e.yawDeg, pitchDeg: e.pitchDeg, rollDeg: e.rollDeg });
};

describe("wrapHeadingDeg — [0, 360)", () => {
  it("wraps both ways and folds −0", () => {
    expect(wrapHeadingDeg(370)).toBe(10);
    expect(wrapHeadingDeg(-10)).toBe(350);
    expect(wrapHeadingDeg(360)).toBe(0);
    expect(wrapHeadingDeg(-360)).toBe(0);
    expect(Object.is(wrapHeadingDeg(-0), 0)).toBe(true);
    expect(wrapHeadingDeg(Number.NaN)).toBe(0);
  });
});

describe("facadeBodyQuaternion — YXZ (−heading, pitch, roll)", () => {
  it("is quaternionFromTilt with the heading negated", () => {
    expect(facadeBodyQuaternion(0, 0, 0)).toEqual([0, 0, 0, 1]);
    expect(facadeBodyQuaternion(90, 10, -5)).toEqual(quaternionFromTilt(-90, 10, -5));
  });
});

describe("ringAngleDeg — the relative angle about ONE body axis", () => {
  const starts: FacadeDragStart[] = [
    START,
    { ...START, headingDeg: 45, pitchDeg: -10, rollDeg: 15 },
    { ...START, headingDeg: 315, pitchDeg: 30, rollDeg: -20 },
  ];
  for (const axis of ["X", "Y", "Z"] as const) {
    for (const theta of [20, -20, 170, 200, -350]) {
      it(`${axis} ring, θ = ${theta}° reads ${normalizeDeg(theta)}° and leaks nothing into the other rings`, () => {
        for (const s of starts) {
          const qs = facadeBodyQuaternion(s.headingDeg, s.pitchDeg, s.rollDeg);
          const q = new THREE.Quaternion(qs[0], qs[1], qs[2], qs[3]);
          const unit = new THREE.Vector3(axis === "X" ? 1 : 0, axis === "Y" ? 1 : 0, axis === "Z" ? 1 : 0);
          q.multiply(new THREE.Quaternion().setFromAxisAngle(unit, (theta * Math.PI) / 180)).normalize();
          const raw: [number, number, number, number] = [q.x, q.y, q.z, q.w];
          expect(ringAngleDeg(qs, raw, axis)).toBeCloseTo(normalizeDeg(theta), 9);
          for (const other of ["X", "Y", "Z"] as const) {
            if (other !== axis) expect(Math.abs(ringAngleDeg(qs, raw, other))).toBeLessThan(1e-9);
          }
          // −q is the same rotation (three normalises either way): the read must not care.
          const neg: [number, number, number, number] = [-q.x, -q.y, -q.z, -q.w];
          expect(ringAngleDeg(qs, neg, axis)).toBeCloseTo(normalizeDeg(theta), 9);
        }
      });
    }
  }
});

describe("scaleHFovDeg / hFovScaleFactor — the H-FOV law", () => {
  it("hFov' = 2·atan(s · tan(hFov0 / 2))", () => {
    expect(scaleHFovDeg(60, 2)).toBeCloseTo(98.21, 2);
    expect(scaleHFovDeg(60, Math.SQRT2)).toBeCloseTo(78.46, 2); // 2^0.5 — the gain-0.5 factor
    expect(scaleHFovDeg(60, 1)).toBeCloseTo(60, 12);
    expect(scaleHFovDeg(60, 0.5)).toBeCloseTo(32.2, 1);
  });
  it("a non-positive or non-finite factor holds the start (three's ratio can cross the origin)", () => {
    expect(scaleHFovDeg(60, 0)).toBe(60);
    expect(scaleHFovDeg(60, -1)).toBe(60);
    expect(scaleHFovDeg(60, Number.NaN)).toBeCloseTo(60, 12);
  });
  it("hFovScaleFactor inverts it", () => {
    expect(hFovScaleFactor(60, scaleHFovDeg(60, 2))).toBeCloseTo(2, 12);
    expect(hFovScaleFactor(60, 120)).toBeCloseTo(3, 9); // tan 60° / tan 30°
    expect(hFovScaleFactor(60, 60)).toBeCloseTo(1, 12);
  });
});

describe("facadeStartTransform / facadeWriteFromStart", () => {
  it("the rest transform: rotDeg = −heading (normalised), the angles, scale 1, no offset", () => {
    expect(facadeStartTransform(START)).toEqual({
      sx: 1,
      sy: 1,
      sz: 1,
      rotDeg: normalizeDeg(-200),
      pitchDeg: 20,
      rollDeg: 0,
      tE: 0,
      tN: 0,
      tU: 0,
    });
    expect(facadeStartTransform({ ...START, headingDeg: 370 }).rotDeg).toBe(-10);
  });
  it("the no-op write: the start as absolute values, the altitude = the above-ground height", () => {
    expect(facadeWriteFromStart(START)).toEqual({
      lat: 48.46,
      lon: 35.04,
      altitudeM: 30,
      headingDeg: 200,
      pitchDeg: 20,
      rollDeg: 0,
      hFovDeg: 60,
    });
    expect(facadeWriteFromStart({ ...START, headingDeg: -10 }).headingDeg).toBe(350);
  });
});

describe("scaleAxisFactor — the dragged handle's factor (first axis letter)", () => {
  const raw = T(START, { sx: 2, sy: 3, sz: 4 });
  it("X / Y / Z / XYZ / XZ / E / null", () => {
    expect(scaleAxisFactor(raw, "X")).toBe(2);
    expect(scaleAxisFactor(raw, "Y")).toBe(3);
    expect(scaleAxisFactor(raw, "Z")).toBe(4);
    expect(scaleAxisFactor(raw, "XYZ")).toBe(2);
    expect(scaleAxisFactor(raw, "XZ")).toBe(2);
    expect(scaleAxisFactor(raw, "YZ")).toBe(3);
    expect(scaleAxisFactor(raw, "E")).toBe(2);
    expect(scaleAxisFactor(raw, null)).toBe(2);
    expect(scaleAxisFactor(T(START, { sx: Number.NaN }), "X")).toBe(1);
  });
});

describe("clampFacadeEdit — MOVE (gain 0.5, the altitude as metres above the ground)", () => {
  it("raw tE 10 → 5 m east through offsetGeodetic; nothing else moves", () => {
    const { write, railed } = clampFacadeEdit(T(START, { tE: 10 }), START, "move", "X", GAINS, RAILS);
    const want = offsetGeodetic(START.lat, START.lon, 5, 0);
    expect(write.lon).toBe(want.lonDeg);
    expect(write.lon).toBeGreaterThan(START.lon);
    expect(write.lat).toBe(START.lat);
    expect(write.altitudeM).toBe(30);
    expect(write.headingDeg).toBe(200);
    expect(write.pitchDeg).toBe(20);
    expect(write.rollDeg).toBe(0);
    expect(write.hFovDeg).toBe(60);
    expect(railed).toEqual({ ...facadeStartTransform(START), tE: 5, tN: 0, tU: 0 });
  });
  it("raw tN 10 → 5 m north", () => {
    const { write, railed } = clampFacadeEdit(T(START, { tN: 10 }), START, "move", "Z", GAINS, RAILS);
    expect(write.lat).toBe(offsetGeodetic(START.lat, START.lon, 0, 5).latDeg);
    expect(write.lat).toBeGreaterThan(START.lat);
    expect(railed.tN).toBe(5);
    expect(railed.tE).toBe(0);
  });
  it("the Y arrow: aboveGround0 30 + 0.5 × 4 = 32; the railed lift is the gained delta", () => {
    const { write, railed } = clampFacadeEdit(T(START, { tU: 4 }), START, "move", "Y", GAINS, RAILS);
    expect(write.altitudeM).toBe(32);
    expect(railed.tU).toBe(2);
    expect(write.lat).toBe(START.lat);
    expect(write.lon).toBe(START.lon);
  });
  it("the altitude band [0, 60] rails both ways, and the handle stops at the rail", () => {
    const up = clampFacadeEdit(T(START, { tU: 100 }), START, "move", "Y", GAINS, RAILS);
    expect(up.write.altitudeM).toBe(60);
    expect(up.railed.tU).toBe(30);
    const down = clampFacadeEdit(T(START, { tU: -100 }), START, "move", "Y", GAINS, RAILS);
    expect(down.write.altitudeM).toBe(0);
    expect(down.railed.tU).toBe(-30);
  });
  it("RAILS NEVER YANK: a start above the band is held, not snapped, and can be dragged back in", () => {
    const drone = { ...START, aboveGroundM: 80 };
    expect(clampFacadeEdit(T(drone), drone, "move", "X", GAINS, RAILS).write.altitudeM).toBe(80);
    expect(clampFacadeEdit(T(drone, { tU: 20 }), drone, "move", "Y", GAINS, RAILS).write.altitudeM).toBe(80);
    expect(clampFacadeEdit(T(drone, { tU: -10 }), drone, "move", "Y", GAINS, RAILS).write.altitudeM).toBe(75);
  });
  it("gain 1 is the raw metre; a zero / NaN gain degrades to 1 rather than freezing the handle", () => {
    expect(clampFacadeEdit(T(START, { tU: 4 }), START, "move", "Y", { ...GAINS, move: 1 }, RAILS).write.altitudeM).toBe(34);
    expect(clampFacadeEdit(T(START, { tU: 4 }), START, "move", "Y", { ...GAINS, move: 0 }, RAILS).write.altitudeM).toBe(34);
  });
  it("a non-finite read-back degrades to no move", () => {
    const { write } = clampFacadeEdit(T(START, { tE: Number.NaN, tU: Number.POSITIVE_INFINITY }), START, "move", "X", GAINS, RAILS);
    expect(write).toEqual(facadeWriteFromStart(START));
  });
});

describe("clampFacadeEdit — ROTATE (one ring, gain 0.5)", () => {
  it("Y ring +20° raw → heading0 − 10 (three's +Y is CCW from above; a heading is clockwise)", () => {
    const { write, railed } = clampFacadeEdit(ringRaw(START, "Y", 20), START, "rotate", "Y", GAINS, RAILS);
    expect(write.headingDeg).toBeCloseTo(190, 9);
    expect(write.pitchDeg).toBe(20);
    expect(write.rollDeg).toBe(0);
    expect(write.lat).toBe(START.lat);
    expect(write.hFovDeg).toBe(60);
    expect(railed.rotDeg).toBeCloseTo(normalizeDeg(-190), 9);
    expect(railed.pitchDeg).toBe(20);
    expect(railed.rollDeg).toBe(0);
    expect(railed.sx).toBe(1);
  });
  it("a Y-ring turn on a PITCHED, ROLLED body leaks into neither pitch nor roll", () => {
    const s = { ...START, headingDeg: 45, pitchDeg: 30, rollDeg: -15 };
    const { write } = clampFacadeEdit(ringRaw(s, "Y", 40), s, "rotate", "Y", GAINS, RAILS);
    expect(write.headingDeg).toBeCloseTo(25, 9);
    expect(write.pitchDeg).toBe(30);
    expect(write.rollDeg).toBe(-15);
  });
  it("the heading wraps at 0 / 360", () => {
    const near0 = { ...START, headingDeg: 5 };
    expect(clampFacadeEdit(ringRaw(near0, "Y", 20), near0, "rotate", "Y", GAINS, RAILS).write.headingDeg).toBeCloseTo(355, 9);
    const near360 = { ...START, headingDeg: 355 };
    expect(clampFacadeEdit(ringRaw(near360, "Y", -20), near360, "rotate", "Y", GAINS, RAILS).write.headingDeg).toBeCloseTo(5, 9);
  });
  it("X ring +20° raw → pitch0 + 10; railed at ±pitchMaxDeg", () => {
    const { write, railed } = clampFacadeEdit(ringRaw(START, "X", 20), START, "rotate", "X", GAINS, RAILS);
    expect(write.pitchDeg).toBeCloseTo(30, 9);
    expect(write.headingDeg).toBe(200);
    expect(write.rollDeg).toBe(0);
    expect(railed.pitchDeg).toBeCloseTo(30, 9);
    const steep = { ...START, pitchDeg: 40 };
    const hit = clampFacadeEdit(ringRaw(steep, "X", 20), steep, "rotate", "X", GAINS, RAILS);
    expect(hit.write.pitchDeg).toBe(45);
    expect(hit.railed.pitchDeg).toBe(45);
    const neg = { ...START, pitchDeg: -40 };
    expect(clampFacadeEdit(ringRaw(neg, "X", -20), neg, "rotate", "X", GAINS, RAILS).write.pitchDeg).toBe(-45);
  });
  it("RAILS NEVER YANK on pitch: a 50° EXIF tilt holds, can come back, cannot go further", () => {
    const s = { ...START, pitchDeg: 50 };
    expect(clampFacadeEdit(ringRaw(s, "X", 0), s, "rotate", "X", GAINS, RAILS).write.pitchDeg).toBe(50);
    expect(clampFacadeEdit(ringRaw(s, "X", 20), s, "rotate", "X", GAINS, RAILS).write.pitchDeg).toBe(50);
    expect(clampFacadeEdit(ringRaw(s, "X", -20), s, "rotate", "X", GAINS, RAILS).write.pitchDeg).toBeCloseTo(40, 9);
  });
  it("Z ring +20° raw → roll0 + 10; railed at ±rollMaxDeg", () => {
    const { write, railed } = clampFacadeEdit(ringRaw(START, "Z", 20), START, "rotate", "Z", GAINS, RAILS);
    expect(write.rollDeg).toBeCloseTo(10, 9);
    expect(write.pitchDeg).toBe(20);
    expect(write.headingDeg).toBe(200);
    expect(railed.rollDeg).toBeCloseTo(10, 9);
    const banked = { ...START, rollDeg: 25 };
    expect(clampFacadeEdit(ringRaw(banked, "Z", 20), banked, "rotate", "Z", GAINS, RAILS).write.rollDeg).toBe(30);
  });
  it("a non-ring axis (E / XYZE / null) is a no-op on both sides", () => {
    for (const axis of ["E", "XYZE", null]) {
      const { write, railed } = clampFacadeEdit(ringRaw(START, "Y", 20), START, "rotate", axis, GAINS, RAILS);
      expect(write).toEqual(facadeWriteFromStart(START));
      expect(railed).toEqual(facadeStartTransform(START));
    }
  });
});

describe("clampFacadeEdit — SCALE (= the H-FOV, uniform from any handle, gain 0.5)", () => {
  const EXPECT_HFOV = scaleHFovDeg(60, Math.SQRT2); // 78.46°
  it("X box ×2 raw → 2^0.5 → 78.46°, the railed factor collapsed to all three axes", () => {
    const { write, railed } = clampFacadeEdit(T(START, { sx: 2 }), START, "scale", "X", GAINS, RAILS);
    expect(write.hFovDeg).toBeCloseTo(78.46, 2);
    expect(write.hFovDeg).toBeCloseTo(EXPECT_HFOV, 12);
    expect(write.lat).toBe(START.lat);
    expect(write.lon).toBe(START.lon);
    expect(write.headingDeg).toBe(200);
    expect(write.altitudeM).toBe(30);
    expect(railed.sx).toBeCloseTo(Math.SQRT2, 9);
    expect(railed.sy).toBe(railed.sx);
    expect(railed.sz).toBe(railed.sx);
    expect(railed.tE).toBe(0);
    expect(railed.rotDeg).toBe(normalizeDeg(-200));
  });
  it("every handle means the field of view: Y, Z, XYZ, XZ all give the same answer", () => {
    for (const [axis, raw] of [
      ["Y", T(START, { sy: 2 })],
      ["Z", T(START, { sz: 2 })],
      ["XYZ", T(START, { sx: 2, sy: 2, sz: 2 })],
      ["XZ", T(START, { sx: 2, sz: 3 })],
    ] as const) {
      const { write, railed } = clampFacadeEdit(raw, START, "scale", axis, GAINS, RAILS);
      expect({ axis, hFov: write.hFovDeg }).toEqual({ axis, hFov: EXPECT_HFOV });
      expect(railed.sx).toBe(railed.sy);
      expect(railed.sy).toBe(railed.sz);
    }
  });
  it("gain 1 is the raw law (×2 → 98.21°)", () => {
    expect(clampFacadeEdit(T(START, { sx: 2 }), START, "scale", "X", { ...GAINS, scale: 1 }, RAILS).write.hFovDeg).toBeCloseTo(98.21, 2);
  });
  it("railed to [hFovMinDeg, hFovMaxDeg] — the boxes stop at the band's factor", () => {
    const wide = clampFacadeEdit(T(START, { sx: 100 }), START, "scale", "X", GAINS, RAILS);
    expect(wide.write.hFovDeg).toBe(120);
    expect(wide.railed.sx).toBeCloseTo(3, 9); // tan 60° / tan 30°
    const narrow = clampFacadeEdit(T(START, { sx: 1e-4 }), START, "scale", "X", GAINS, RAILS);
    expect(narrow.write.hFovDeg).toBe(5);
    expect(narrow.railed.sx).toBeCloseTo(hFovScaleFactor(60, 5), 12);
  });
  it("a factor through the origin or non-finite holds the start FOV at scale 1", () => {
    for (const sx of [-1, 0, Number.NaN]) {
      const { write, railed } = clampFacadeEdit(T(START, { sx }), START, "scale", "X", GAINS, RAILS);
      expect(write.hFovDeg).toBeCloseTo(60, 12);
      expect(railed.sx).toBeCloseTo(1, 12);
    }
  });
  it("RAILS NEVER YANK on the FOV: a 130° start holds and can narrow", () => {
    const s = { ...START, hFovDeg: 130 };
    expect(clampFacadeEdit(T(s), s, "scale", "X", GAINS, RAILS).write.hFovDeg).toBeCloseTo(130, 12);
    expect(clampFacadeEdit(T(s, { sx: 4 }), s, "scale", "X", GAINS, RAILS).write.hFovDeg).toBe(130);
    expect(clampFacadeEdit(T(s, { sx: 0.25 }), s, "scale", "X", GAINS, RAILS).write.hFovDeg).toBeLessThan(130);
  });
});
