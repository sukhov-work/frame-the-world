import * as THREE from "three";
import { ENRICHED, PHOTO_PROJECT } from "../tuning";
import { attachBldgGizmo } from "./bldgGizmo";
import type { GhostRig } from "./enrichedBuildings";
import { enuBasis } from "../../../lib/geo/projection";
import { quaternionFromTilt } from "../../../lib/models/modelPlacement";
import {
  clampFacadeEdit,
  facadeStartTransform,
  type FacadeDragStart,
  type FacadeGains,
  type FacadeOp,
  type FacadePoseWrite,
  type FacadeRails,
} from "../../../lib/globe/facadePose";
import type { FeatureTransform } from "../../../lib/globe/featureTransform";

/**
 * FACADE PHOTO F1 (owner order 2026-10-21: "gizmos to move, rotate and scale the projected view,
 * a bit less sensitive than the meshes flow, so I can position the texture before save or edit
 * it later"; `rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md` §1 F1; T169) — the MOVE / ROTATE /
 * SCALE gizmo on the facade-photo FRUSTUM, as a facade over MESH SUITE's `attachBldgGizmo`.
 *
 * THE PROXY IS A RIG, NOT THE FRUSTUM. `PhotoFrustum` rebuilds its geometry from the store every
 * frame; the gizmo needs an Object3D it can write. So this module keeps a three-Group rig of its
 * own — `frame` (the ECEF apex + the ENU basis, exactly `userModels.placeFrame`) → `anchor` (the
 * move offset, metres east / up / −north) → `body` (the camera's orientation as
 * `facadeBodyQuaternion`, scale 1) — and re-seats it from the orchestrator's `setPose` whenever
 * the store or the frustum moves while NO drag is live. A drag writes the anchor (move) or the
 * body (rotate / scale) through the inner gizmo; `lib/globe/facadePose.clampFacadeEdit` gains +
 * rails the raw read-back and hands back BOTH the absolute store values (`onChange`) and the
 * railed rig transform the inner gizmo re-places the rig at (the handle trails the pointer).
 *
 * ORBIT, NOT FPV. The MS2 / MS5 instances live inside FPV where `controls.enabled` is already
 * false; this one is armed in ORBIT (the facade flow is desktop-only, `?facade=1`), where
 * GlobeControls raycasts the whole scene on pointerdown and twice per frame (`adjustHeight`) and
 * an attached 100 km drag plane would catch those rays (the §11.4 trap, while attached). Hence
 * `guardRaycast: true` on the inner gizmo: the plane and the pickers answer only while this
 * module is feeding a pointer. The pointer arbitration itself (claim on a handle → disable the
 * orbit controls → capture) is the orchestrator's — a capture-phase listener on the canvas's
 * PARENT, which fires before GlobeControls' own (the wiring recipe in the F1 build report).
 *
 * SIGNS (pinned by `test/components/globe/facadeGizmo.test.ts` against `frustumGeometry`): the
 * body's −Z is the frustum's forward, +Y its up, +X its right, for `quaternionFromTilt(−heading,
 * pitch, roll)` under the (east, up, −north) basis. No store import (`fences.test.ts`): the pose
 * is PUSHED in, the writes go OUT through callbacks.
 */
export interface FacadeGizmoPose {
  /** The rendered apex (ECEF, m) — from the frustum's geometry this frame. */
  apex: readonly [number, number, number];
  lat: number;
  lon: number;
  /** The apex height above the RENDERED ground (m) — the altitude's MANUAL origin at press. */
  aboveGroundM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  hFovDeg: number;
}

export type FacadeGizmoOp = "none" | FacadeOp;

export interface FacadeGizmoCallbacks {
  /** The absolute store values after every drag step (the op's fields changed, the rest = start). */
  onChange(write: FacadePoseWrite): void;
  /** Release. `write` = the final values when anything changed; null = cancelled OR an unmoved
   *  release — either way the orchestrator may restore `facadeWriteFromStart(start)`. */
  onCommit(write: FacadePoseWrite | null, start: FacadeDragStart): void;
  /** Default `PHOTO_PROJECT.gizmoGain*`. */
  gains?: FacadeGains;
  /** Default the `PHOTO_PROJECT` bands. */
  rails?: FacadeRails;
}

export interface FacadeGizmoHandle {
  /** Re-seat the rig from the live pose (per frame from the orchestrator; ignored under a live
   *  drag — the drag owns the rig until release). Null detaches. */
  setPose(pose: FacadeGizmoPose | null): void;
  /** The armed op; "none" detaches (the helper leaves the scene). Ignored under a live drag. */
  setOp(op: FacadeGizmoOp): void;
  readonly op: FacadeGizmoOp;
  readonly attached: boolean;
  /** The inner helper is a scene child — true exactly while attached (§11.4). */
  readonly inScene: boolean;
  readonly dragging: boolean;
  readonly axis: string | null;
  hover(ndcX: number, ndcY: number): boolean;
  /** Press at NDC. True = claimed (a drag began on a handle); the START is the last `setPose`. */
  down(ndcX: number, ndcY: number): boolean;
  move(ndcX: number, ndcY: number, snap: boolean): void;
  /** Release → `onCommit`. Returns the final write, null when nothing changed. */
  up(): FacadePoseWrite | null;
  /** Abandon (Escape / pointercancel): the rig snaps back to the start, `onCommit(null, start)`. */
  cancel(): void;
  handleScreenPx(name: string, rect: DOMRect): { x: number; y: number } | null;
  originPx(rect: DOMRect): { x: number; y: number } | null;
  ringPx(name: string, rect: DOMRect, count?: number): Array<{ x: number; y: number }>;
  debug(ndcX?: number, ndcY?: number): Record<string, unknown>;
  helperRoot(): THREE.Object3D;
  /** DEV/test seam — the inner `guardRaycast` gate (positive control of the orbit-trap test). */
  _setFeeding(on: boolean): void;
  dispose(): void;
}

const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _d = new THREE.Vector3();

const startFromPose = (p: FacadeGizmoPose): FacadeDragStart => ({
  lat: p.lat,
  lon: p.lon,
  aboveGroundM: p.aboveGroundM,
  headingDeg: p.headingDeg,
  pitchDeg: p.pitchDeg,
  rollDeg: p.rollDeg,
  hFovDeg: p.hFovDeg,
});

export function attachFacadeGizmo(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  cb: FacadeGizmoCallbacks,
): FacadeGizmoHandle {
  const gains: FacadeGains = cb.gains ?? {
    move: PHOTO_PROJECT.gizmoGainMove,
    rotate: PHOTO_PROJECT.gizmoGainRotate,
    scale: PHOTO_PROJECT.gizmoGainScale,
  };
  const rails: FacadeRails = cb.rails ?? {
    altMinM: PHOTO_PROJECT.altMinM,
    altMaxM: PHOTO_PROJECT.altMaxM,
    hFovMinDeg: PHOTO_PROJECT.hFovMinDeg,
    hFovMaxDeg: PHOTO_PROJECT.hFovMaxDeg,
    pitchMaxDeg: PHOTO_PROJECT.pitchMaxDeg,
    rollMaxDeg: PHOTO_PROJECT.rollMaxDeg,
  };
  const gMove = gains.move > 0 && Number.isFinite(gains.move) ? gains.move : 1;
  const gRot = gains.rotate > 0 && Number.isFinite(gains.rotate) ? gains.rotate : 1;

  const frame = new THREE.Group();
  frame.name = "facadeGizmoFrame";
  const anchor = new THREE.Group();
  anchor.name = "facadeGizmoAnchor";
  const body = new THREE.Group();
  body.name = "facadeGizmoBody";
  frame.add(anchor);
  anchor.add(body);
  // The model rig contract (`userModels.rig`): no pivot offset, the lift about Y = 0, no inflate.
  const rig: GhostRig = { anchor, body, cx: 0, cz: 0, liveBaseY: 0, inflate: 1 };

  let pose: FacadeGizmoPose | null = null;
  let op: FacadeGizmoOp = "none";
  let disposed = false; // the inner handle keeps its last target after dispose; this one does not lie
  let dragStart: FacadeDragStart | null = null;
  let dragOp: FacadeOp | null = null;
  /** The write `clamp` derived for the step `onChange` is about to report (the inner gizmo calls
   *  `clamp` then `onChange` in the same `objectChange`, so the pair is always from one read). */
  let stepWrite: FacadePoseWrite | null = null;

  const placeFrame = (p: FacadeGizmoPose) => {
    frame.position.set(p.apex[0], p.apex[1], p.apex[2]);
    const b = enuBasis(p.lat, p.lon);
    _e.set(b.east[0], b.east[1], b.east[2]);
    _u.set(b.up[0], b.up[1], b.up[2]);
    _n.set(-b.north[0], -b.north[1], -b.north[2]); // local +Z = south (−Z = north)
    _m.makeBasis(_e, _u, _n);
    frame.quaternion.setFromRotationMatrix(_m);
  };

  /** The rig from a transform — the inner gizmo's `place` (the model rig's `placeRig` twin). */
  const placeRig = (t: FeatureTransform) => {
    anchor.position.set(t.tE, t.tU, 0 - t.tN); // `0 −`: a −0 would fail the harness's exact reads
    const q = quaternionFromTilt(t.rotDeg, t.pitchDeg ?? 0, t.rollDeg ?? 0);
    body.quaternion.set(q[0], q[1], q[2], q[3]);
    // A zero scale would make the matrix singular — floor each at a thousandth (T128's rule).
    body.scale.set(Math.max(0.001, t.sx), Math.max(0.001, t.sy), Math.max(0.001, t.sz));
    frame.updateMatrixWorld(true);
  };

  const seat = (p: FacadeGizmoPose) => {
    placeFrame(p);
    placeRig(facadeStartTransform(startFromPose(p)));
  };

  const inner = attachBldgGizmo(scene, camera, {
    place: placeRig,
    onChange: () => {
      if (stepWrite) cb.onChange(stepWrite);
    },
    clamp: (raw, _start, axis) => {
      if (!dragStart || !dragOp) return raw;
      const r = clampFacadeEdit(raw, dragStart, dragOp, axis, gains, rails);
      stepWrite = r.write;
      return r.railed;
    },
    lift: true,
    // The Y arrow's RAW rail: three clamps the anchor's own Y before the gain, so the band is
    // (alt − aboveGround0) / gain about the seated 0 — widened to hold the start (RAILS NEVER
    // YANK, facadePose header); `clampFacadeEdit` is the belt to these braces.
    liftRail: () => {
      const ag = dragStart?.aboveGroundM ?? 0;
      return {
        minM: (Math.min(rails.altMinM, ag) - ag) / gMove,
        maxM: (Math.max(rails.altMaxM, ag) - ag) / gMove,
      };
    },
    tilt: true,
    guardRaycast: true,
    snap: {
      m: ENRICHED.gizmoSnapM / gMove,
      deg: ENRICHED.gizmoSnapDeg / gRot,
      scale: ENRICHED.gizmoSnapScale,
    },
  });

  /** The inner target from (pose, op): attached exactly when both are set; the rig is a scene
   *  child exactly while attached (the helper follows inside `setTarget`). */
  const applyTarget = () => {
    if (inner.dragging) return;
    if (!pose || op === "none") {
      inner.setTarget(null, "move");
      if (frame.parent) frame.parent.remove(frame);
      return;
    }
    if (frame.parent !== scene) scene.add(frame);
    frame.updateMatrixWorld(true);
    inner.setTarget(rig, op);
  };

  const clearDrag = () => {
    dragStart = null;
    dragOp = null;
    stepWrite = null;
  };

  const axisWorld = (x: number, y: number, z: number) =>
    _d.set(x, y, z).transformDirection(body.matrixWorld).toArray() as [number, number, number];

  return {
    setPose(p) {
      if (inner.dragging) return;
      pose = p;
      if (p) seat(p);
      applyTarget();
    },
    setOp(o) {
      if (inner.dragging) return;
      op = o;
      applyTarget();
    },
    get op() {
      return op;
    },
    get attached() {
      return !disposed && inner.attached;
    },
    get inScene() {
      return inner.inScene;
    },
    get dragging() {
      return inner.dragging;
    },
    get axis() {
      return inner.axis;
    },
    hover(ndcX, ndcY) {
      return inner.hover(ndcX, ndcY);
    },
    down(ndcX, ndcY) {
      if (!pose || op === "none" || !inner.attached || inner.dragging) return false;
      // The rig IS the pose at press (a release leaves the rig where the drag ended until the
      // next `setPose`; a press in that gap must still start from the pose it was handed).
      seat(pose);
      inner.helperRoot().updateMatrixWorld(true);
      const start = startFromPose(pose);
      dragStart = start;
      dragOp = op;
      stepWrite = null;
      const ok = inner.down(ndcX, ndcY, 0, facadeStartTransform(start));
      if (!ok) clearDrag();
      return ok;
    },
    move(ndcX, ndcY, snap) {
      inner.move(ndcX, ndcY, snap);
    },
    up() {
      if (!inner.dragging) return null;
      const start = dragStart;
      const t = inner.up();
      const write = t && stepWrite ? stepWrite : null;
      clearDrag();
      if (start) cb.onCommit(write, start);
      return write;
    },
    cancel() {
      if (!inner.dragging) return;
      const start = dragStart;
      const st = inner.cancel();
      if (st) placeRig(st);
      clearDrag();
      if (start) cb.onCommit(null, start);
    },
    handleScreenPx(name, rect) {
      return inner.handleScreenPx(name, rect);
    },
    originPx(rect) {
      return inner.originPx(rect);
    },
    ringPx(name, rect, count) {
      return inner.ringPx(name, rect, count);
    },
    debug(ndcX, ndcY) {
      body.updateMatrixWorld(true);
      return {
        ...inner.debug(ndcX, ndcY),
        op,
        pose,
        dragStart,
        stepWrite,
        gains,
        rails,
        framePos: frame.position.toArray(),
        anchorPos: anchor.position.toArray(),
        bodyQuat: body.quaternion.toArray(),
        bodyScale: body.scale.toArray(),
        rigInScene: frame.parent === scene,
        /** The body's world axes — forward (−Z), up (+Y), right (+X); the sign-pin test's probe. */
        bodyAxes: { forward: axisWorld(0, 0, -1), up: axisWorld(0, 1, 0), right: axisWorld(1, 0, 0) },
      };
    },
    helperRoot() {
      return inner.helperRoot();
    },
    _setFeeding(on) {
      inner._setFeeding(on);
    },
    dispose() {
      disposed = true;
      inner.dispose();
      if (frame.parent) frame.parent.remove(frame);
      pose = null;
      op = "none";
      clearDrag();
    },
  };
}
