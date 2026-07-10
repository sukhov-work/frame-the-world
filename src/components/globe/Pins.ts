import * as THREE from "three";
import { geodeticToEcef } from "../../lib/geo/projection";
import { tokens } from "../../lib/theme/tokens";
import type { PublicPin } from "../../store/pins";
import { PINS } from "./tuning";

/**
 * Pins — public pins on the shared globe (Phase 5), the attach-module the convention doc
 * anticipated. One InstancedMesh of accent spheres, scaled per frame with camera distance so
 * a pin reads as a constant-size signal from LEO down to street level; the soft bloom pass
 * picks the accent up for free.
 *
 * Picking: the mesh keeps its default raycast (unlike the decorations, which null it out) —
 * the orchestrator raycasts it in the pointerup click gate and flies to the hit pin.
 * Terrain: markers sit `ground + liftM`; ground height comes from terrainHeightAt (Cesium
 * World Terrain raycast) and re-resolves lazily as tiles refine (same idea as frustum.resnap).
 */

export interface PinsHandle {
  mesh: THREE.InstancedMesh;
  setPins(pins: PublicPin[]): void;
  update(camera: THREE.PerspectiveCamera): void;
  /** Re-ask the terrain for ground height under the pins (cheap, call at low cadence). */
  resnap(): void;
  /** The pin under the pointer ray, or null. */
  pick(raycaster: THREE.Raycaster): PublicPin | null;
  dispose(): void;
}

export function attachPins(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
  } = {},
): PinsHandle {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const material = new THREE.MeshBasicMaterial({
    color: tokens.accent,
    transparent: true,
    opacity: PINS.opacity,
    depthWrite: false, // a translucent signal — never punches holes into the ground/buildings
  });
  const mesh = new THREE.InstancedMesh(geometry, material, PINS.maxRender);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the whole planet
  scene.add(mesh);

  let pins: PublicPin[] = [];
  const positions: THREE.Vector3[] = [];
  const grounded: boolean[] = []; // true once real terrain height answered for this pin

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  let dirty = true;

  const groundHeight = (pin: PublicPin): { h: number; real: boolean } => {
    const h = opts.terrainHeightAt?.(pin.lat, pin.lon);
    if (h !== null && h !== undefined && Number.isFinite(h)) return { h, real: true };
    return { h: PINS.fallbackGroundM, real: false };
  };

  const placePin = (i: number) => {
    const pin = pins[i];
    const { h, real } = groundHeight(pin);
    const [x, y, z] = geodeticToEcef(pin.lat, pin.lon, h + PINS.liftM);
    (positions[i] ??= new THREE.Vector3()).set(x, y, z);
    grounded[i] = real;
  };

  return {
    mesh,

    setPins(next: PublicPin[]) {
      pins = next.slice(0, PINS.maxRender);
      positions.length = pins.length;
      grounded.length = pins.length;
      for (let i = 0; i < pins.length; i++) placePin(i);
      mesh.count = pins.length;
      dirty = true;
      // TRAP: three caches InstancedMesh.boundingSphere on first raycast — GlobeControls
      // raycasts the scene BEFORE pins load (count 0 → EMPTY sphere), and a stale empty
      // sphere makes every later pick return nothing. Invalidate whenever instances change.
      mesh.boundingSphere = null;
    },

    update(camera: THREE.PerspectiveCamera) {
      if (mesh.count === 0) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      // Matrices only rebuild when the camera actually moved (or the pin set changed) — the
      // scale is distance-dependent, so a static camera needs no per-frame work.
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      if (!dirty && !camMoved) return;
      _camLast.copy(camera.position);
      dirty = false;
      for (let i = 0; i < pins.length; i++) {
        const p = positions[i];
        const size = THREE.MathUtils.clamp(
          camera.position.distanceTo(p) * PINS.angularSize,
          PINS.minSizeM,
          PINS.maxSizeM,
        );
        _s.setScalar(size);
        _m.compose(p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null; // scales changed — see the setPins trap note
    },

    resnap() {
      // Re-resolve ground height for pins that never got a real terrain answer (tiles refine
      // over time). Real answers are kept — terrain height is stable once resolved.
      let changed = false;
      for (let i = 0; i < pins.length; i++) {
        if (grounded[i]) continue;
        const before = positions[i].y;
        placePin(i);
        if (positions[i].y !== before || grounded[i]) changed = true;
      }
      if (changed) dirty = true;
    },

    pick(raycaster: THREE.Raycaster): PublicPin | null {
      if (mesh.count === 0) return null;
      const hits = raycaster.intersectObject(mesh, false);
      const id = hits[0]?.instanceId;
      return id !== undefined && id < pins.length ? pins[id] : null;
    },

    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
