import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ENRICHED } from "../tuning";
import { clampGizmoEdit, LIFT_MAX_M } from "../../../lib/globe/bldgOverrides";
import {
  rigToTransform,
  type FeatureTransform,
  type RigFrame,
} from "../../../lib/globe/featureTransform";
import type { BldgEditOp } from "../../../store/bldgEdit";
import type { GhostRig } from "./enrichedBuildings";

/**
 * MESH SUITE MS2 (owner order 2026-09-01; design MESH_SUITE_PLAN.md §7) — the MOVE / ROTATE /
 * SCALE gizmo: three 0.185's `TransformControls` driven on the engine's ghost RIG.
 *
 * THE PROXY IS THE RIG. `scene/enrichedBuildings` already previews an edit on a ghost — the
 * pristine run rebased about its pivot, carrying the live transform as Object3D writes. MS2 splits
 * that ghost into an `anchor` (a Group under the cell mesh, ENU frame: +X east, +Y up, −Z north —
 * it carries the translation) and its child `body` (the ghost mesh — yaw + scale). MOVE attaches
 * the controls to the anchor (world-like ENU arrows that never turn with the building), ROTATE and
 * SCALE to the body (the Y ring / the per-axis boxes follow the building's own frame, which is the
 * frame the recompose applies S and R in). Every drag is therefore a plain Object3D edit that
 * `rigToTransform` reads back and `clampGizmoEdit` rails; the clamped value is written BACK to the
 * rig (the handle stops at the rail) and previewed live; the orchestrator commits on release
 * through the same `commitBldgTransform` path as a U8 drag.
 *
 * NO DOM LISTENERS. The controls are constructed without a domElement and FED pointers by the
 * orchestrator's FPV handlers through their public `pointerHover/Down/Move/Up(pointer)` API — the
 * same handlers that arbitrate the look-drag, the pinch and the U8 claimed height drag, so ONE
 * gesture table owns every pointer and the touch shell gets the gizmo for free. `space` is LOCAL:
 * "world" in three is raw ECEF, meaningless here; the rig's world quaternion already carries the
 * ENU basis (the cell mesh's matrixWorld), so local = ENU.
 *
 * WHY NO CAMERA LAYER. The research trap ("GlobeControls raycasts the whole scene and three's
 * Raycaster ignores `visible`, so the invisible pickers catch globe drags") is real and only HALF
 * moot: a building can only be armed inside FPV, where `controls.enabled` is already false (the
 * orchestrator owns the pointer there) — true for the pickers WHILE armed. It was wrong for the
 * helper AFTER the session (owner bug 2026-09-02j, MESH_SUITE_PLAN §11.4): the DRAG PLANE (a
 * 100 km `PlaneGeometry`, a helper child whose raycast must stay live for the drag maths) and the
 * pickers stay in the scene at the last edited building once `detach()` runs (`detach` only flips
 * `_root.visible`; three's Raycaster ignores `visible`), and GlobeControls' first-hit pivot /
 * camera-height raycasts then land on the plane instead of the terrain — an orbit drag "barely
 * moves". So the helper is IN THE SCENE ONLY WHILE SOMETHING IS ATTACHED (`setTarget`), and out
 * of it — no raycast target, nothing drawn — the rest of the time. The visible gizmo meshes still
 * get a no-op `raycast` so no other scene-wide raycast (a pick, a probe) ever sees them while
 * attached; the pickers keep theirs — the controls hit-test exactly those. Rendering: three draws
 * the helper depth-free at `renderOrder Infinity`; bloom may glow it on the ULTRA tier (accepted, §7).
 *
 * VERSION PIN. `handleScreenPx` (a DEV/harness accessor) and the raycast no-op reach into
 * `TransformControls._gizmo` — an underscore field of three 0.185; a bump re-verifies it (the
 * 3d-tiles-renderer internals trap, DECISIONS §Traps).
 */
export interface BldgGizmoHandle {
  /** Attach to the rig for a spatial op; `extrude` or a null rig detaches. Idempotent per
   *  (rig, op) so the orchestrator may call it every frame; refused under a live drag. */
  setTarget(rig: GhostRig | null, op: BldgEditOp): void;
  readonly attached: boolean;
  /** The helper (gizmo meshes + pickers + the drag plane) is a scene child — true exactly while
   *  attached (MS5b §11.4); a detached helper in the scene is the orbit-drag bug. */
  readonly inScene: boolean;
  readonly dragging: boolean;
  /** The handle under the pointer / being dragged (`X`, `Y`, `Z`, `XZ`, `XYZ`, …), else null. */
  readonly axis: string | null;
  /** Hover test at NDC (mouse/pen per move; touch re-tests at down). True over a handle. */
  hover(ndcX: number, ndcY: number): boolean;
  /** Press at NDC. True = the gizmo CLAIMED this pointer (a drag began on a handle).
   *  `liveBaseY` = the building's seated base at press time (the lift rail's floor);
   *  `start` = the committed transform the drag re-anchors on (the per-edit scale band). */
  down(ndcX: number, ndcY: number, liveBaseY: number, start: FeatureTransform): boolean;
  /** Drag to NDC; `snap` = the Shift-held step snaps. Fires `onChange` with the clamped live
   *  transform (and re-places the rig when the clamp bit). */
  move(ndcX: number, ndcY: number, snap: boolean): void;
  /** Release: ends the drag. The final clamped transform when anything changed, else null. */
  up(): FeatureTransform | null;
  /** Abandon the drag (Escape / pointercancel): ends it and returns the START transform for the
   *  caller to re-place the rig from; null when nothing was in flight. */
  cancel(): FeatureTransform | null;
  /** DEV (harness): client px of a handle's visual centre in the CURRENT mode — the picker mesh
   *  named `name` (`X` / `Y` / `Z` / `XZ` / `XYZ` …); for the rotate ring, a point ON the ring.
   *  Null when unattached, unknown, or behind the camera. */
  handleScreenPx(name: string, rect: DOMRect): { x: number; y: number } | null;
  /** DEV (harness): client px of the gizmo origin (the attached object's world position). */
  originPx(rect: DOMRect): { x: number; y: number } | null;
  /** DEV: the controls' drag internals + a plane probe at an NDC point (diagnostics only). */
  debug(ndcX?: number, ndcY?: number): Record<string, unknown>;
  /** DEV (harness POSITIVE CONTROL, §11.4): the helper root itself — a harness re-adds it to the
   *  scene for one raycast to prove its probe CAN see a parked drag plane, then removes it. */
  helperRoot(): THREE.Object3D;
  dispose(): void;
}

type NdcPointer = { x: number; y: number; button: number };
/** TransformControls' public pointer methods take `{x, y, button}` in NDC — the shape its own
 *  `getPointer(event)` produces; the d.ts names it PointerEvent. */
const asPointer = (p: NdcPointer) => p as unknown as PointerEvent;

/** three 0.185 internals this module reads (version-pinned; see the module header). */
interface GizmoInternals {
  picker: Record<string, THREE.Object3D>;
  gizmo: Record<string, THREE.Object3D>;
  helper: Record<string, THREE.Object3D>;
}

const _v = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _ndc = new THREE.Vector3();

export function attachBldgGizmo(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  cb: {
    /** Re-place the rig from a transform (the engine's `setGhostTransform`). */
    place(t: FeatureTransform): void;
    /** The clamped live transform after every drag step. */
    onChange(t: FeatureTransform): void;
    /** Rail the raw read-back. Default = the building rails (`clampGizmoEdit`); MESH SUITE MS5
     *  hands a user model its own (uniform scale, no lift, a wider move). */
    clamp?(raw: FeatureTransform, start: FeatureTransform): FeatureTransform;
    /** MOVE shows the Y (lift) arrow. Default true; a user model has no lift seat (MS5), so
     *  its instance hides it — the X/Z arrows and the ground plane stay. */
    lift?: boolean;
  },
): BldgGizmoHandle {
  const clamp = cb.clamp ?? clampGizmoEdit;
  const lift = cb.lift !== false;
  const tc = new TransformControls(camera); // no domElement — pointers are fed (module header)
  tc.space = "local";
  tc.size = ENRICHED.gizmoSize;
  // NOT added to the scene here — `setTarget` adds it on attach and removes it on detach (MS5b
  // §11.4, module header): a parked helper is an invisible 100 km raycast target at the last
  // edited building, and GlobeControls' pivot raycast finds it before the terrain.
  const helper = tc.getHelper();

  const internals = (): GizmoInternals | null =>
    (tc as unknown as { _gizmo?: GizmoInternals })._gizmo ?? null;
  // The VISIBLE gizmo/helper meshes must never answer a scene-wide raycast. Only those: the
  // PICKERS are what the controls hit-test, and the drag PLANE (a helper child too) is what every
  // pointerDown/Move intersects to measure the drag — no-op either and a drag silently moves
  // nothing (browser-caught 2026-09-02: a sweep over "every non-picker mesh" took the plane).
  {
    const g = internals();
    if (g) {
      for (const grp of [...Object.values(g.gizmo), ...Object.values(g.helper)]) {
        grp.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.raycast = () => {};
        });
      }
    }
  }

  let attachedObj: THREE.Object3D | null = null;
  let attachedOp: BldgEditOp | null = null;
  let rigRef: GhostRig | null = null;
  let startT: FeatureTransform | null = null;
  let frame: RigFrame | null = null;
  let live: FeatureTransform | null = null;
  let changed = false;

  const applyMode = (op: BldgEditOp) => {
    if (op === "move") {
      // ENU arrows + the ground plane; the Y arrow is the lift, railed by minY/maxY at down()
      // (hidden outright for a rig without a lift seat — three hides XY/YZ/XYZ with it).
      tc.setMode("translate");
      tc.showX = tc.showZ = true;
      tc.showY = lift;
      tc.showXY = tc.showYZ = false;
      tc.showXZ = true;
    } else if (op === "rotate") {
      // Yaw only: hiding X and Z also hides the screen-space E ring (three shows it only with
      // all three axes on); XYZE (free trackball) off explicitly.
      tc.setMode("rotate");
      tc.showX = tc.showZ = false;
      tc.showY = true;
      tc.showXYZE = false;
    } else if (op === "scale") {
      // Per-axis X/Z (footprint) + Y (height, the extrude twin), the XZ plane (uniform
      // footprint — the owner's default gesture) and the centre XYZ (uniform all).
      tc.setMode("scale");
      tc.showX = tc.showY = tc.showZ = true;
      tc.showXY = tc.showYZ = false;
      tc.showXZ = true;
    }
  };

  const sameT = (a: FeatureTransform, b: FeatureTransform) =>
    a.sx === b.sx &&
    a.sz === b.sz &&
    a.sy === b.sy &&
    a.rotDeg === b.rotDeg &&
    a.tE === b.tE &&
    a.tN === b.tN &&
    a.tU === b.tU;

  const onObjectChange = () => {
    if (!rigRef || !frame || !startT || !tc.dragging) return;
    const a = rigRef.anchor;
    const b = rigRef.body;
    const raw = rigToTransform(
      {
        ax: a.position.x,
        ay: a.position.y,
        az: a.position.z,
        qy: b.quaternion.y,
        qw: b.quaternion.w,
        sx: b.scale.x,
        sy: b.scale.y,
        sz: b.scale.z,
      },
      frame,
    );
    const clamped = clamp(raw, startT);
    if (!sameT(clamped, raw)) cb.place(clamped); // the handle stops at the rail
    live = clamped;
    changed = true;
    cb.onChange(clamped);
  };
  tc.addEventListener("objectChange", onObjectChange);

  const endDrag = () => {
    tc.pointerUp(asPointer({ x: 0, y: 0, button: 0 }));
    const out = live;
    live = null;
    startT = null;
    frame = null;
    changed = false;
    return out;
  };

  const toPx = (world: THREE.Vector3, rect: DOMRect): { x: number; y: number } | null => {
    // The label module's guard sequence: behind-camera cull, then NDC → client px.
    _vc.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (_vc.z >= 0) return null;
    _ndc.copy(world).project(camera);
    return {
      x: rect.left + (_ndc.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_ndc.y * 0.5 + 0.5) * rect.height,
    };
  };

  return {
    setTarget(rig, op) {
      const obj = rig && op !== "extrude" ? (op === "move" ? rig.anchor : rig.body) : null;
      if (obj === attachedObj && (obj ? op : null) === attachedOp) return;
      if (tc.dragging) return; // never re-target under a live drag (the orchestrator guards too)
      attachedObj = obj;
      attachedOp = obj ? op : null;
      rigRef = obj ? rig : null;
      if (!obj) {
        tc.detach();
        if (helper.parent) helper.parent.remove(helper); // out of every scene-wide raycast (§11.4)
        return;
      }
      applyMode(op);
      tc.attach(obj);
      if (helper.parent !== scene) scene.add(helper);
      // Fresh picker/plane matrices for a hover or press landing in this same frame (the scene
      // walk that normally refreshes them runs at the next render).
      helper.updateMatrixWorld(true);
    },
    get attached() {
      return attachedObj !== null;
    },
    get inScene() {
      return helper.parent === scene;
    },
    get dragging() {
      return tc.dragging;
    },
    get axis() {
      return (tc.axis as string | null) ?? null;
    },
    hover(ndcX, ndcY) {
      if (!attachedObj) return false;
      tc.pointerHover(asPointer({ x: ndcX, y: ndcY, button: -1 }));
      return tc.axis !== null;
    },
    down(ndcX, ndcY, liveBaseY, start) {
      if (!attachedObj || !rigRef || tc.dragging) return false;
      tc.pointerHover(asPointer({ x: ndcX, y: ndcY, button: -1 })); // touch has no prior hover
      if (tc.axis === null) return false;
      startT = start;
      frame = { cx: rigRef.cx, cz: rigRef.cz, liveBaseY, inflate: rigRef.inflate };
      live = null;
      changed = false;
      // The lift rail on the anchor's own Y (parent = the cell mesh, so parent space IS the
      // bake-local frame the seat lives in): never below the seated base, never past LIFT_MAX_M.
      const move = attachedOp === "move";
      tc.minY = move ? liveBaseY : -Infinity;
      tc.maxY = move ? liveBaseY + (lift ? LIFT_MAX_M : 0) : Infinity;
      tc.pointerDown(asPointer({ x: ndcX, y: ndcY, button: 0 }));
      if (!tc.dragging) {
        startT = null;
        frame = null;
        return false;
      }
      return true;
    },
    move(ndcX, ndcY, snap) {
      if (!tc.dragging) return;
      tc.translationSnap = snap ? ENRICHED.gizmoSnapM : null;
      tc.rotationSnap = snap ? (ENRICHED.gizmoSnapDeg * Math.PI) / 180 : null;
      tc.scaleSnap = snap ? ENRICHED.gizmoSnapScale : null;
      tc.pointerMove(asPointer({ x: ndcX, y: ndcY, button: -1 }));
    },
    up() {
      if (!tc.dragging) return null;
      const wasChanged = changed;
      const out = endDrag();
      return wasChanged ? out : null;
    },
    cancel() {
      if (!tc.dragging) return null;
      const st = startT;
      endDrag();
      return st;
    },
    handleScreenPx(name, rect) {
      const g = internals();
      if (!g || !attachedObj) return null;
      const grp = g.picker[tc.mode];
      const child = grp?.children.find((c) => c.name === name) as THREE.Mesh | undefined;
      if (!child || !child.geometry || !child.visible) return null;
      const geom = child.geometry;
      if (tc.mode === "rotate") {
        // A point ON the ring's centre-line. The torus is centred on the origin (its
        // bounding-sphere centre is the hole), so take the vertex farthest on screen from the
        // origin — that is the tube's OUTER silhouette, where a ray only grazes the surface — and
        // pull it back to the tube's centre-line: three's picker is `TorusGeometry(0.5, 0.1, …)`,
        // so the centre-line sits at 0.5 / 0.6 of the outer radius (version-pinned, like _gizmo).
        const origin = this.originPx(rect);
        const pos = geom.getAttribute("position");
        if (!origin || !pos) return null;
        let best: { x: number; y: number } | null = null;
        let bestD = -1;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
          const p = toPx(_v, rect);
          if (!p) continue;
          const d = Math.hypot(p.x - origin.x, p.y - origin.y);
          if (d > bestD) {
            bestD = d;
            best = p;
          }
        }
        if (!best) return null;
        const k = 0.5 / 0.6;
        return { x: origin.x + (best.x - origin.x) * k, y: origin.y + (best.y - origin.y) * k };
      }
      if (!geom.boundingSphere) geom.computeBoundingSphere();
      if (!geom.boundingSphere) return null;
      _v.copy(geom.boundingSphere.center).applyMatrix4(child.matrixWorld);
      return toPx(_v, rect);
    },
    originPx(rect) {
      if (!attachedObj) return null;
      attachedObj.getWorldPosition(_v);
      return toPx(_v, rect);
    },
    debug(ndcX, ndcY) {
      const t = tc as unknown as {
        pointStart: THREE.Vector3;
        pointEnd: THREE.Vector3;
        worldPositionStart: THREE.Vector3;
        worldPosition: THREE.Vector3;
        eye: THREE.Vector3;
        _positionStart: THREE.Vector3;
        _plane: THREE.Mesh;
        getRaycaster(): THREE.Raycaster;
      };
      let plane: unknown = null;
      if (ndcX !== undefined && ndcY !== undefined) {
        const rc = t.getRaycaster();
        rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = rc.intersectObject(t._plane, true);
        const pl = t._plane;
        const n = new THREE.Vector3(0, 0, 1).transformDirection(pl.matrixWorld);
        const pos = new THREE.Vector3().setFromMatrixPosition(pl.matrixWorld);
        const dn = rc.ray.direction.dot(n);
        const tt = pos.clone().sub(rc.ray.origin).dot(n) / dn;
        const inv = pl.matrixWorld.clone().invert();
        const lo = rc.ray.origin.clone().applyMatrix4(inv);
        const ld = rc.ray.direction.clone().transformDirection(inv);
        const geom = pl.geometry as THREE.BufferGeometry;
        if (!geom.boundingSphere) geom.computeBoundingSphere();
        plane = {
          hit: hits.length ? { distance: hits[0].distance, point: hits[0].point.toArray() } : "MISS",
          rayOrigin: rc.ray.origin.toArray(),
          rayDir: rc.ray.direction.toArray(),
          normalW: n.toArray(),
          dirDotN: dn,
          analyticT: tt,
          localOrigin: lo.toArray(),
          localDir: ld.toArray(),
          sphere: geom.boundingSphere ? [geom.boundingSphere.center.toArray(), geom.boundingSphere.radius] : null,
          maxScale: pl.matrixWorld.getMaxScaleOnAxis(),
          posCount: geom.getAttribute("position")?.count,
          indexCount: geom.index?.count ?? null,
          drawRange: geom.drawRange,
          side: (pl.material as THREE.Material).side,
          layersMask: pl.layers.mask,
          rcLayers: rc.layers.mask,
          near: rc.near,
          far: rc.far,
        };
      }
      return {
        mode: tc.mode,
        axis: tc.axis,
        dragging: tc.dragging,
        space: tc.space,
        pointStart: t.pointStart.toArray(),
        pointEnd: t.pointEnd.toArray(),
        worldPositionStart: t.worldPositionStart.toArray(),
        worldPosition: t.worldPosition.toArray(),
        eye: t.eye.toArray(),
        positionStart: t._positionStart.toArray(),
        object: attachedObj ? attachedObj.position.toArray() : null,
        objectQuat: attachedObj ? attachedObj.quaternion.toArray() : null,
        objectScale: attachedObj ? attachedObj.scale.toArray() : null,
        rotationAngle: (tc as unknown as { rotationAngle: number }).rotationAngle,
        planeWorld: t._plane.matrixWorld.elements.slice(12, 15),
        planeVisible: t._plane.visible,
        planeParent: t._plane.parent === helper,
        helperVisible: helper.visible,
        helperInScene: helper.parent === scene,
        plane,
        startT,
        live,
      };
    },
    helperRoot() {
      return helper;
    },
    dispose() {
      tc.removeEventListener("objectChange", onObjectChange);
      tc.detach();
      if (helper.parent) helper.parent.remove(helper);
      // Not `tc.dispose()`: with no domElement its disconnect() dereferences null (three 0.185
      // TransformControls.js `disconnect`). The root owns every geometry/material.
      helper.dispose();
    },
  };
}
