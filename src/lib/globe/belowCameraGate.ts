import * as THREE from "three";

/**
 * T79 — the below-camera GATE: skip the triangle loop for every mesh that cannot reach the
 * controls' camera-clearance band (2026-09-06, T77 slice 0).
 *
 * WHY. `GlobeControls.update()` fires `_getPointBelowCamera()` twice a frame while
 * `adjustHeight` is on (`EnvironmentControls.js:995` and `:1059`): a vertical ray from 1e5 m
 * above the camera, `raycaster.intersectObject(scene)` over the WHOLE scene. three's default
 * `Mesh.raycast` gates on the bounding sphere and box — both of which a vertical ray through the
 * planet always passes — then tests EVERY triangle. `scripts/probe-below-camera.mjs` at the Dnipro
 * orbit pose (2026-09-06): 21 ms per call, of which 15.9 ms is the stylized BASE EARTH — a
 * 384-segment sphere (294 k triangles) sitting 1.9 km under the terrain as a backdrop — 3.1 ms the
 * enriched cells and 2.1 ms the OSM building tiles; the terrain's tile traversal costs 0.02 ms.
 * Two calls a frame = the 42 ms orbit frame MEASURE found (`MEASUREMENTS_2026-09-05.md` §7), and
 * 74–105 ms on an iPhone 17 Pro.
 *
 * WHAT THE CALLERS ACTUALLY CONSUME. Both per-frame callers use ONE bit of the hit: whether
 * `hit.distance − 1e5 − actionHeightOffset < cameraRadius` (then they push the camera up by the
 * difference, which needs the exact distance ONLY when that test is true). A mesh whose whole
 * volume lies more than `cameraRadius + actionHeightOffset` below the camera can therefore never
 * change the outcome: if a band-reaching mesh is hit, it is the first hit anyway (the ray comes
 * from above); if none is, the true answer is "no push" whether the first hit is a far mesh or
 * the ellipsoid fallback — PROVIDED the ellipsoid itself is below the band, which the controls
 * subclass checks before arming the gate (`scene/pluxGlobeControls.ts`). The zoom path
 * (`_updateZoom`, `:1371`) scales by the exact distance and runs UNGATED.
 *
 * HOW. `installBelowCameraGate()` wraps `THREE.Mesh.prototype.raycast` ONCE. While the gate is
 * armed (only inside the subclass's `_getPointBelowCamera`), a mesh proven to top out below
 * `camera − band` returns before the triangle loop; everything else — and every raycast outside
 * the armed window (picks, `heightAt`, the gizmos) — runs the original method byte-for-byte.
 * Three UPPER BOUNDS on "the mesh's highest point along `up`", cheapest first, each exact (a
 * triangle never leaves the hull of its vertices, so a bound on the vertices bounds the surface):
 *   1. the local AABB's eight corners through `matrixWorld` — tight for flat cells and tiles;
 *   2. for a `SphereGeometry`, the scaled ellipsoid's support point — O(1), tight for the base
 *      earth whose AABB and bounding sphere both reach 9–11 km ABOVE the camera at 48° N;
 *   3. the vertex support `max(p · Lᵀup) + t · up` — one pass over the position attribute, cached
 *      per geometry by `(version, count, local up)`, so a static pose pays it once.
 * Boxes and supports come from the POSITION ATTRIBUTE, never `geometry.boundingBox`: the enriched
 * seats rewrite vertex positions after load (the padded `boundingSphere` is what frustum culling
 * trusts), so a loader box can be stale and the gate must recompute when positions change.
 * Skinned and morphed meshes are never skipped (their vertices live in bones, not the attribute).
 *
 * EXACTNESS CONTRACT (unit-pinned in `test/lib/globe/belowCameraGate.test.ts`): for any scene,
 * camera and band, the gated first hit has the same truth value of `distance − 1e5 < band` as
 * the ungated one, and when true it is the SAME intersection (object, distance, point).
 */

export interface BelowCameraGateStats {
  /** `_getPointBelowCamera` calls that ran under the gate. */
  gated: number;
  /** Calls routed to the exact path (zoom scaling, or the ellipsoid inside the band). */
  exact: number;
  /** Mesh raycasts seen while armed. */
  seen: number;
  /** Mesh raycasts skipped while armed, by the bound that proved it. */
  skipped: number;
  skipBox: number;
  skipSphere: number;
  skipScan: number;
  /** Local boxes (re)built and vertex scans run from a position attribute. */
  boxesBuilt: number;
  scans: number;
  /** ms spent inside the last gated `_getPointBelowCamera`. */
  lastMs: number;
}

interface CachedBox {
  version: number;
  count: number;
  box: THREE.Box3;
}

interface CachedSupport {
  version: number;
  count: number;
  ux: number;
  uy: number;
  uz: number;
  max: number;
}

const boxes = new WeakMap<THREE.BufferGeometry, CachedBox>();
const supports = new WeakMap<THREE.BufferGeometry, CachedSupport>();

const freshStats = (): BelowCameraGateStats => ({
  gated: 0,
  exact: 0,
  seen: 0,
  skipped: 0,
  skipBox: 0,
  skipSphere: 0,
  skipScan: 0,
  boxesBuilt: 0,
  scans: 0,
  lastMs: 0,
});

const state = {
  armed: false,
  /** `camera.position · up` — the camera's height along the ray axis. */
  camDotUp: 0,
  /** metres below the camera a surface may sit and still matter (`cameraRadius + offset + margin`). */
  bandM: 0,
  up: new THREE.Vector3(0, 1, 0),
  installed: null as null | ((this: THREE.Mesh, r: THREE.Raycaster, i: THREE.Intersection[]) => void),
  stats: freshStats(),
};

const _corner = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _uLocal = new THREE.Vector3();

/**
 * The geometry's local AABB from its position attribute, cached by `(version, count)`.
 * `null` when there is no position attribute (nothing to raycast anyway).
 */
export function localBoxFor(geometry: THREE.BufferGeometry): THREE.Box3 | null {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;
  const hit = boxes.get(geometry);
  if (hit && hit.version === pos.version && hit.count === pos.count) return hit.box;
  const box = hit?.box ?? new THREE.Box3();
  box.setFromBufferAttribute(pos);
  boxes.set(geometry, { version: pos.version, count: pos.count, box });
  state.stats.boxesBuilt++;
  return box;
}

/**
 * Height of the box's highest corner above the camera along `up`, in metres (negative = below).
 * Eight corners through `matrixWorld`, dotted with `up`, minus `camDotUp`.
 */
export function topHeightAbove(
  box: THREE.Box3,
  matrixWorld: THREE.Matrix4,
  up: THREE.Vector3,
  camDotUp: number,
): number {
  let max = -Infinity;
  const { min, max: mx } = box;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? mx.x : min.x, i & 2 ? mx.y : min.y, i & 4 ? mx.z : min.z);
    _corner.applyMatrix4(matrixWorld);
    const h = _corner.dot(up) - camDotUp;
    if (h > max) max = h;
  }
  return max;
}

/**
 * The support point of a `SphereGeometry(radius)` under `matrixWorld` (translation · rotation ·
 * scale) along `up`, above the camera. The scaled sphere is an ellipsoid with semi-axes
 * `radius · scale`; its extent along a unit direction `u` (in the mesh frame) is
 * `radius · |scale ∘ u|`. The polygonal sphere lies inside it (vertices ON the surface, chords
 * inside), so this bounds every triangle point.
 */
export function sphereSupportAbove(
  radius: number,
  matrixWorld: THREE.Matrix4,
  up: THREE.Vector3,
  camDotUp: number,
): number {
  matrixWorld.decompose(_pos, _quat, _scale);
  _uLocal.copy(up).applyQuaternion(_quat.invert());
  const ex = _scale.x * _uLocal.x;
  const ey = _scale.y * _uLocal.y;
  const ez = _scale.z * _uLocal.z;
  return _pos.dot(up) - camDotUp + Math.abs(radius) * Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * The exact vertex support along `up`: `max over vertices p of (M p) · up`, computed as
 * `max(p · Lᵀ up) + t · up` with `L` the linear 3×3 of `matrixWorld` and `t` its translation.
 * The max is cached per geometry by `(version, count, Lᵀup)` — at a static pose it is computed
 * once; during a drag it is one pass over the attribute per frame.
 */
export function vertexSupportAbove(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  up: THREE.Vector3,
  camDotUp: number,
): number {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!pos || pos.count === 0) return Infinity;
  const e = matrixWorld.elements;
  // Lᵀ · up (column-major: e[0..2] is the first column = L's first column)
  const ux = e[0] * up.x + e[1] * up.y + e[2] * up.z;
  const uy = e[4] * up.x + e[5] * up.y + e[6] * up.z;
  const uz = e[8] * up.x + e[9] * up.y + e[10] * up.z;
  const tDotUp = e[12] * up.x + e[13] * up.y + e[14] * up.z;
  const version = (pos as THREE.BufferAttribute).version ?? (pos as THREE.InterleavedBufferAttribute).data?.version ?? 0;
  const c = supports.get(geometry);
  if (c && c.version === version && c.count === pos.count && c.ux === ux && c.uy === uy && c.uz === uz) {
    return c.max + tDotUp - camDotUp;
  }
  let max = -Infinity;
  const n = pos.count;
  const plain = pos as THREE.BufferAttribute;
  if (!(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !plain.normalized && plain.itemSize === 3) {
    const a = plain.array as ArrayLike<number>;
    for (let i = 0, k = 0; i < n; i++, k += 3) {
      const d = a[k] * ux + a[k + 1] * uy + a[k + 2] * uz;
      if (d > max) max = d;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = pos.getX(i) * ux + pos.getY(i) * uy + pos.getZ(i) * uz;
      if (d > max) max = d;
    }
  }
  supports.set(geometry, { version, count: n, ux, uy, uz, max });
  state.stats.scans++;
  return max + tDotUp - camDotUp;
}

/**
 * May this mesh own a surface point higher than `camera − bandM`? Three upper bounds, cheapest
 * first; conservative (`true`) whenever the answer cannot be bounded (no positions, skinning,
 * morph targets).
 */
export function meshMayReachBand(
  mesh: THREE.Mesh,
  up: THREE.Vector3,
  camDotUp: number,
  bandM: number,
): boolean {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return true;
  if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) return true;
  const geometry = mesh.geometry;
  if (!geometry) return true;
  const box = localBoxFor(geometry);
  if (!box) return true;
  if (topHeightAbove(box, mesh.matrixWorld, up, camDotUp) < -bandM) {
    state.stats.skipBox++;
    return false;
  }
  const g = geometry as THREE.BufferGeometry & { parameters?: { radius?: number } };
  if (g.type === "SphereGeometry" && typeof g.parameters?.radius === "number") {
    if (sphereSupportAbove(g.parameters.radius, mesh.matrixWorld, up, camDotUp) < -bandM) {
      state.stats.skipSphere++;
      return false;
    }
  }
  if (vertexSupportAbove(geometry, mesh.matrixWorld, up, camDotUp) < -bandM) {
    state.stats.skipScan++;
    return false;
  }
  return true;
}

/** Arm the gate for one `_getPointBelowCamera` call. Pair with `endBelowCameraGate()` in `finally`. */
export function beginBelowCameraGate(camPos: THREE.Vector3, up: THREE.Vector3, bandM: number): void {
  state.up.copy(up);
  state.camDotUp = camPos.dot(up);
  state.bandM = bandM;
  state.armed = true;
  state.stats.gated++;
}

export function endBelowCameraGate(): void {
  state.armed = false;
}

export function belowCameraGateArmed(): boolean {
  return state.armed;
}

/** Count an exact-path call (kept here so one seam reports both routes). */
export function noteBelowCameraExact(): void {
  state.stats.exact++;
}

export function noteBelowCameraMs(ms: number): void {
  state.stats.lastMs = ms;
}

export function belowCameraGateStats(): BelowCameraGateStats {
  return { ...state.stats };
}

export function resetBelowCameraGateStats(): void {
  state.stats = freshStats();
}

/**
 * Wrap `THREE.Mesh.prototype.raycast` once (idempotent). Returns the uninstaller (tests).
 * `InstancedMesh.raycast` funnels every instance through a shared `Mesh` whose `matrixWorld` is
 * the instance's — so instances are gated one by one through this same wrapper.
 */
export function installBelowCameraGate(): () => void {
  if (state.installed) return uninstallBelowCameraGate;
  const original = THREE.Mesh.prototype.raycast;
  const gated = function gatedMeshRaycast(
    this: THREE.Mesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ): void {
    if (state.armed) {
      state.stats.seen++;
      if (!meshMayReachBand(this, state.up, state.camDotUp, state.bandM)) {
        state.stats.skipped++;
        return;
      }
    }
    original.call(this, raycaster, intersects);
  };
  THREE.Mesh.prototype.raycast = gated;
  state.installed = original;
  return uninstallBelowCameraGate;
}

export function uninstallBelowCameraGate(): void {
  if (!state.installed) return;
  THREE.Mesh.prototype.raycast = state.installed;
  state.installed = null;
  state.armed = false;
}

export function belowCameraGateInstalled(): boolean {
  return state.installed !== null;
}
