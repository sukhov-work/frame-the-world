/**
 * FACADE PHOTO F1 — the gizmo's pose maths (owner order 2026-10-21: "gizmos to move, rotate and
 * scale the projected view, a bit less sensitive than the meshes flow"; design
 * `rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md` §1 F1; backlog T169). Pure + three-free: the
 * body quaternion that seats a frustum's forward on the shared gizmo rig, the per-ring angle
 * read, the H-FOV scale law and the GAINED + RAILED edit that turns the gizmo's raw read-back
 * into absolute store values. `scene/facadeGizmo.ts` owns the Object3D plumbing; this module is
 * unit-pinned by `test/lib/globe/facadePose.test.ts`, the sign triple below by
 * `test/components/globe/facadeGizmo.test.ts` against `frustumGeometry`.
 *
 * THE RIG. The frustum is driven through MESH SUITE's gizmo (`scene/bldgGizmo.ts`) on a
 * model-style rig: a `frame` at the apex (the ECEF seat, ENU basis +X east, +Y up, −Z north —
 * `userModels.placeFrame`), an `anchor` (the move offset in metres) and a `body` whose quaternion
 * is `facadeBodyQuaternion`. Under that basis the body's −Z is the frustum's FORWARD when the YXZ
 * triple is (−heading, pitch, roll): three's +Y rotation is counter-clockwise seen from above
 * (`Matrix4.makeRotationY`) while a heading is clockwise from north, so `rotDeg = −headingDeg`;
 * pitch + tips the forward up on both sides; roll keeps its sign too (`lib/geo/frustum.ts`
 * rotates its basis about forward by −roll, which tips `right` toward `up` — exactly what
 * R_z(+r) does to a body's +X).
 *
 * ABSOLUTE FROM THE START (three 0.185 `TransformControls.pointerMove`): the controls recompute
 * the attached object from the pose captured at `pointerDown` plus the current pointer —
 * translate = `_positionStart + offset`, scale = `_scaleStart × ratio`, rotate =
 * `_quaternionStart · axisAngle`. Re-placing the rig at a GAINED value therefore never fights
 * them (the next move starts from the same start pose), which is what lets "less sensitive" be a
 * plain `start + (raw − start) × gain` for move (m) and rotate (deg), and the raw factor to the
 * power of the gain for scale — written back as `railed` so the handle visibly trails the pointer
 * (the "handle stops at the rail" idiom of `bldgGizmo`).
 *
 * SCALE IS THE H-FOV: `hFov' = 2·atan(s · tan(hFov0 / 2))` — a wider frustum IS a shorter focal.
 * Every scale handle (the X / Y / Z boxes, the centre) means "the field of view": the dragged
 * axis's factor is collapsed to all three so the photo is never stretched. The write is the
 * store's H-FOV OVERRIDE, never a focal — a focal write would jump the FOV off the focal35 path
 * on the first drag.
 *
 * ROTATE reads ONE ring. three's local-space rotate composes `q_start · axisAngle(local axis)`,
 * so `q_rel = q_start⁻¹ · q_raw` is a pure turn about the dragged axis and its angle is
 * `2·atan2(q_rel[axis], q_rel.w)`. A full YXZ decomposition instead would leak a Y-ring turn on a
 * pitched body into roll. Y ring → heading (minus, the sign above), X ring → pitch, Z ring → roll.
 *
 * MOVE writes a placement + an altitude. `tE / tN` from the START placement go through
 * `offsetGeodetic`; the Y arrow is the altitude as METRES ABOVE THE RENDERED GROUND (the pin
 * flow's MANUAL semantics): `alt' = aboveGround0 + g·tU`, where `aboveGround0` is the rendered
 * apex height above the ground at press time — so the first write reproduces what the owner saw,
 * never a jump.
 *
 * RAILS NEVER YANK. Every band (altitude, H-FOV, pitch, roll) is widened to include the start
 * value: an EXIF pose outside a band (a drone frame at 80 m, a 50° tilt) can be dragged back in
 * but is never snapped to the edge on the first frame of an unrelated drag.
 */

import { normalizeDeg, type FeatureTransform } from "./featureTransform";
import { offsetGeodetic, quaternionFromTilt, type Quat } from "../models/modelPlacement";

export type FacadeOp = "move" | "rotate" | "scale";
export type RingAxis = "X" | "Y" | "Z";

/** The pose a drag starts from — captured at press from the last `setPose` (never mid-drag). */
export interface FacadeDragStart {
  lat: number;
  lon: number;
  /** The rendered apex height above the ground at press time (m) — the altitude's MANUAL origin. */
  aboveGroundM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  hFovDeg: number;
}

/** Every field ABSOLUTE — the orchestrator writes the store from it (the op's fields; see the
 *  wiring recipe: move → placement + altitude, rotate → the three angles, scale → the H-FOV). */
export interface FacadePoseWrite {
  lat: number;
  lon: number;
  /** Metres above the rendered ground (MANUAL semantics). */
  altitudeM: number;
  /** [0, 360). */
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  hFovDeg: number;
}

/** The sensitivity: move (m per raw m), rotate (deg per raw deg), scale (the raw factor's power). */
export interface FacadeGains {
  move: number;
  rotate: number;
  scale: number;
}

export interface FacadeRails {
  altMinM: number;
  altMaxM: number;
  hFovMinDeg: number;
  hFovMaxDeg: number;
  /** Symmetric bands: |pitch| ≤ pitchMaxDeg, |roll| ≤ rollMaxDeg. */
  pitchMaxDeg: number;
  rollMaxDeg: number;
}

const DEG = Math.PI / 180;
const fin = (v: unknown, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : dflt;
/** A gain must be a positive finite number — zero would freeze the handle (and divide the lift rail). */
const gain = (g: number): number => (Number.isFinite(g) && g > 0 ? g : 1);
/** Clamp to a band that is first widened to include `start` (RAILS NEVER YANK, header). */
const railAbout = (v: number, start: number, lo: number, hi: number): number =>
  Math.max(Math.min(lo, start), Math.min(Math.max(hi, start), v));

/** Heading to [0, 360) (a −0 folded to +0). */
export function wrapHeadingDeg(d: number): number {
  const x = fin(d, 0) % 360;
  const w = x < 0 ? x + 360 : x;
  return w >= 360 || w === 0 ? 0 : w;
}

/** The rig body's quaternion for a camera pose — YXZ (−heading, pitch, roll); see the header. */
export function facadeBodyQuaternion(headingDeg: number, pitchDeg: number, rollDeg: number): Quat {
  // `0 - h`, not `-h`: a negated zero heading would ride through sin(−0) into a −0 component.
  return quaternionFromTilt(0 - fin(headingDeg, 0), fin(pitchDeg, 0), fin(rollDeg, 0));
}

/** The signed angle (deg, (−180, 180]) of `qRaw` relative to `qStart` about the body's own
 *  `axis`: `q_rel = q_start⁻¹ · q_raw` (three's `multiplyQuaternions` order), then
 *  `2·atan2(q_rel[axis], q_rel.w)`. Exact over the whole circle and sign-flip tolerant (−q is the
 *  same rotation: atan2 shifts by π, the doubled angle by 2π, the wrap folds it). */
export function ringAngleDeg(qStart: Quat, qRaw: Quat, axis: RingAxis): number {
  // conj(qStart) — the inverse of a unit quaternion.
  const ax = -qStart[0];
  const ay = -qStart[1];
  const az = -qStart[2];
  const aw = qStart[3];
  const [bx, by, bz, bw] = qRaw;
  const x = ax * bw + aw * bx + ay * bz - az * by;
  const y = ay * bw + aw * by + az * bx - ax * bz;
  const z = az * bw + aw * bz + ax * by - ay * bx;
  const w = aw * bw - ax * bx - ay * by - az * bz;
  const c = axis === "X" ? x : axis === "Y" ? y : z;
  return normalizeDeg((2 * Math.atan2(c, w)) / DEG);
}

/** The H-FOV after a uniform factor `s` on the image plane: `2·atan(s · tan(hFov0 / 2))`.
 *  A non-positive factor (three's ratio crosses the origin) holds the start FOV. */
export function scaleHFovDeg(hFov0: number, s: number): number {
  const h = fin(hFov0, 60);
  const k = fin(s, 1);
  if (k <= 0) return h;
  return (2 * Math.atan(k * Math.tan((h * DEG) / 2))) / DEG;
}

/** The inverse of `scaleHFovDeg`: the uniform factor that takes `hFov0` to `hFov` — what the
 *  railed body scale is set to so the boxes trail the pointer and stop at the band's edge. */
export function hFovScaleFactor(hFov0: number, hFov: number): number {
  const t0 = Math.tan((fin(hFov0, 60) * DEG) / 2);
  return t0 > 0 ? Math.tan((fin(hFov, hFov0) * DEG) / 2) / t0 : 1;
}

/** The start pose as the rig's rest transform: the body at (−heading, pitch, roll), scale 1,
 *  the anchor at the frame (`tE = tN = tU = 0`) — what `bldgGizmo.down()` re-anchors on. */
export function facadeStartTransform(start: FacadeDragStart): FeatureTransform {
  return {
    sx: 1,
    sy: 1,
    sz: 1,
    rotDeg: normalizeDeg(-fin(start.headingDeg, 0)),
    pitchDeg: fin(start.pitchDeg, 0),
    rollDeg: fin(start.rollDeg, 0),
    tE: 0,
    tN: 0,
    tU: 0,
  };
}

/** The start pose as an absolute write — the no-op write (what a cancelled drag restores to). */
export function facadeWriteFromStart(start: FacadeDragStart): FacadePoseWrite {
  return {
    lat: fin(start.lat, 0),
    lon: fin(start.lon, 0),
    altitudeM: fin(start.aboveGroundM, 0),
    headingDeg: wrapHeadingDeg(start.headingDeg),
    pitchDeg: fin(start.pitchDeg, 0),
    rollDeg: fin(start.rollDeg, 0),
    hFovDeg: fin(start.hFovDeg, 60),
  };
}

/** The scale factor the dragged handle wrote: the FIRST axis letter's component (`X` / `XZ` →
 *  sx, `Y` → sy, `Z` → sz; `XYZ` is uniform in three already); anything else reads sx. Every
 *  handle is "the field of view" — the caller collapses this one factor to all three axes. */
export function scaleAxisFactor(raw: FeatureTransform, axis: string | null): number {
  const first = axis ? axis.match(/[XYZ]/)?.[0] : undefined;
  const v = first === "Y" ? raw.sy : first === "Z" ? raw.sz : raw.sx;
  return fin(v, 1);
}

/**
 * The gained + railed edit. `write` = the absolute store values after the gain and the rails;
 * `railed` = the same values back in rig terms (gained `tE / tN / tU`, gained angles, the uniform
 * factor) — the transform the rig is re-placed at. An op whose handle cannot be read (a rotate on
 * a non-ring axis) returns the start on both sides.
 */
export function clampFacadeEdit(
  raw: FeatureTransform,
  start: FacadeDragStart,
  op: FacadeOp,
  axis: string | null,
  gains: FacadeGains,
  rails: FacadeRails,
): { write: FacadePoseWrite; railed: FeatureTransform } {
  const base = facadeStartTransform(start);
  const write0 = facadeWriteFromStart(start);

  if (op === "move") {
    const g = gain(gains.move);
    const tE = g * fin(raw.tE, 0);
    const tN = g * fin(raw.tN, 0);
    const tU = g * fin(raw.tU, 0);
    const ag = fin(start.aboveGroundM, 0);
    const alt = railAbout(ag + tU, ag, rails.altMinM, rails.altMaxM);
    // A component that did not move keeps its coordinate EXACTLY (three zeroes the off-axis
    // components of an arrow drag; `offsetGeodetic`'s longitude wrap would add float dust to a
    // pure-north move and turn a no-op into a store write).
    const p = offsetGeodetic(write0.lat, write0.lon, tE, tN);
    return {
      write: {
        ...write0,
        lat: tN === 0 ? write0.lat : p.latDeg,
        lon: tE === 0 ? write0.lon : p.lonDeg,
        altitudeM: alt,
      },
      railed: { ...base, tE, tN, tU: alt - ag },
    };
  }

  if (op === "rotate") {
    if (axis !== "X" && axis !== "Y" && axis !== "Z") return { write: write0, railed: base };
    const g = gain(gains.rotate);
    const qS = facadeBodyQuaternion(start.headingDeg, start.pitchDeg, start.rollDeg);
    // The raw read-back is the body's YXZ triple (`eulerFromQuaternion` in the gizmo's `tilt`
    // read) — recomposing it is the same rotation up to sign, which `ringAngleDeg` tolerates.
    const qR = quaternionFromTilt(
      fin(raw.rotDeg, base.rotDeg),
      fin(raw.pitchDeg, base.pitchDeg ?? 0),
      fin(raw.rollDeg, base.rollDeg ?? 0),
    );
    const th = g * ringAngleDeg(qS, qR, axis);
    if (axis === "Y") {
      const h = wrapHeadingDeg(write0.headingDeg - th);
      return { write: { ...write0, headingDeg: h }, railed: { ...base, rotDeg: normalizeDeg(-h) } };
    }
    if (axis === "X") {
      const m = Math.abs(fin(rails.pitchMaxDeg, 90));
      const p = railAbout(write0.pitchDeg + th, write0.pitchDeg, -m, m);
      return { write: { ...write0, pitchDeg: p }, railed: { ...base, pitchDeg: p } };
    }
    const m = Math.abs(fin(rails.rollMaxDeg, 180));
    const r = railAbout(write0.rollDeg + th, write0.rollDeg, -m, m);
    return { write: { ...write0, rollDeg: r }, railed: { ...base, rollDeg: r } };
  }

  // scale — the H-FOV
  const g = gain(gains.scale);
  const sRaw = scaleAxisFactor(raw, axis);
  const sG = sRaw > 0 ? Math.pow(sRaw, g) : 1;
  const hFov = railAbout(
    scaleHFovDeg(write0.hFovDeg, sG),
    write0.hFovDeg,
    rails.hFovMinDeg,
    rails.hFovMaxDeg,
  );
  const s = hFovScaleFactor(write0.hFovDeg, hFov);
  return { write: { ...write0, hFovDeg: hFov }, railed: { ...base, sx: s, sy: s, sz: s } };
}
