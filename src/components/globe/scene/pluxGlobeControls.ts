import * as THREE from "three";
import { GlobeControls } from "3d-tiles-renderer";
import {
  beginBelowCameraGate,
  belowCameraGateStats,
  endBelowCameraGate,
  installBelowCameraGate,
  noteBelowCameraExact,
  noteBelowCameraMs,
  resetBelowCameraGateStats,
  type BelowCameraGateStats,
} from "../../../lib/globe/belowCameraGate";
import { CONTROLS } from "../tuning";

/**
 * T79 (T77 slice 0) — `GlobeControls` with the below-camera GATE around its per-frame down-ray.
 *
 * The library (3d-tiles-renderer 0.4.28) raycasts the whole scene straight down from 1e5 m above
 * the camera twice a frame (`EnvironmentControls.update` :995 and `adjustCamera` :1059) and uses
 * ONE bit of the answer: is the surface closer than `cameraRadius` (+ the previous frame's push)?
 * `lib/globe/belowCameraGate.ts` explains why every mesh whose bounding box tops out below that
 * band can be skipped without changing the outcome. This subclass arms the gate for exactly those
 * two calls and routes everything else — the zoom path that scales by the exact distance, and any
 * pose where the ELLIPSOID fallback itself could fire a push — through the untouched library code.
 *
 * Behaviour contract: the orbit camera's clearance over terrain, rooftops and models is
 * byte-for-byte what it was (the same hit, the same push) — a terrain-only raycast target was
 * the alternative and would have changed the rooftop clearance, which is the owner's call, not
 * this slice's. The three library-private names this leans on (`_getPointBelowCamera`,
 * `_updateZoom`, `actionHeightOffset`) are source-pinned in `test/components/globe/pluxGlobeControls.test.ts`
 * so a library bump that moves them fails loudly instead of silently un-gating.
 */

/** The library-private surface this file reads or overrides (not in the shipped `.d.ts`). */
interface ControlsPrivate {
  _getPointBelowCamera(point?: THREE.Vector3, up?: THREE.Vector3): THREE.Intersection | null;
  _updateZoom(): void;
  actionHeightOffset: number;
}

const superPrivate = GlobeControls.prototype as unknown as ControlsPrivate;

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();

export class PluxGlobeControls extends GlobeControls {
  /** True while `_updateZoom` runs — its down-ray scales the zoom by the EXACT distance. */
  private _exactBelow = false;
  /** DEV kill-switch for A/B runs (`__globe.belowCameraGate(false)`); production is always on. */
  belowCameraGateEnabled = true;

  constructor(scene?: THREE.Object3D, camera?: THREE.Camera, domElement?: HTMLElement | null) {
    super(scene, camera, domElement ?? undefined);
    installBelowCameraGate();
  }

  _updateZoom(): void {
    this._exactBelow = true;
    try {
      superPrivate._updateZoom.call(this);
    } finally {
      this._exactBelow = false;
    }
  }

  _getPointBelowCamera(
    point: THREE.Vector3 = this.camera.position,
    up: THREE.Vector3 = this.up,
  ): THREE.Intersection | null {
    if (!this.belowCameraGateEnabled || this._exactBelow) {
      noteBelowCameraExact();
      return superPrivate._getPointBelowCamera.call(this, point, up);
    }
    // The band: the callers compare `distance − 1e5 − actionHeightOffset` against `cameraRadius`;
    // `update()` reads the offset the previous frame left, `adjustCamera` the one this frame set.
    const self = this as unknown as ControlsPrivate;
    const band =
      this.cameraRadius + Math.max(0, self.actionHeightOffset || 0) + CONTROLS.belowCameraGateMarginM;
    // If the ellipsoid fallback could itself land inside the band (a camera hugging — or under —
    // the ellipsoid where no mesh is resident) the exact answer depends on whether ANY mesh is hit,
    // so the gate stays off. Same ray the library builds: origin 1e5 m up, pointing down.
    const hEllipsoid = this._ellipsoidHeightBelow(point, up);
    if (hEllipsoid === null || hEllipsoid <= band) {
      noteBelowCameraExact();
      return superPrivate._getPointBelowCamera.call(this, point, up);
    }
    const t0 = performance.now();
    beginBelowCameraGate(point, up, band);
    try {
      return superPrivate._getPointBelowCamera.call(this, point, up);
    } finally {
      endBelowCameraGate();
      noteBelowCameraMs(performance.now() - t0);
    }
  }

  /**
   * The camera's height above the ellipsoid along the library's down-ray (metres; negative when
   * the camera is under the surface), computed exactly as `GlobeControls._raycast`'s fallback
   * does — the ray into the ellipsoid frame, `intersectRay`, back out, distance from the origin.
   */
  _ellipsoidHeightBelow(point: THREE.Vector3, up: THREE.Vector3): number | null {
    const { ellipsoid, ellipsoidFrame, ellipsoidFrameInverse } = this;
    if (!ellipsoid) return null;
    _ray.origin.copy(point).addScaledVector(up, 1e5);
    _ray.direction.copy(up).multiplyScalar(-1);
    _ray.applyMatrix4(ellipsoidFrameInverse);
    const p = ellipsoid.intersectRay(_ray, _hit);
    if (p === null) return null;
    p.applyMatrix4(ellipsoidFrame);
    _ray.origin.copy(point).addScaledVector(up, 1e5);
    return p.distanceTo(_ray.origin) - 1e5;
  }

  /** DEV seam: `__globe.belowCameraGate(enabled?)` — toggles the gate, returns the counters. */
  belowCameraGate(enabled?: boolean): BelowCameraGateStats & { enabled: boolean } {
    if (typeof enabled === "boolean") {
      this.belowCameraGateEnabled = enabled;
      resetBelowCameraGateStats();
    }
    return { ...belowCameraGateStats(), enabled: this.belowCameraGateEnabled };
  }
}
