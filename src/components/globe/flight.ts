import * as THREE from "three";
import { FLIGHT } from "./tuning";

/**
 * Cinematic camera flight to a placed photo (design-board motion spec: 2200 ms,
 * cubic-bezier(.65, 0, .35, 1); reduced-motion = instant cut).
 *
 * Path: great-circle slerp of the geocentric direction + geocentric-altitude blend with a
 * ballistic mid-flight bump (FLIGHT.arcBump*) — short hops rise a little, long hauls arc properly.
 * Endpoints are EXACT (the final frame snaps to the target pose); mid-flight altitude is
 * geocentric, which differs from geodetic by metres — invisible in motion.
 *
 * The orchestrator calls `update()` after GlobeControls (the drift pattern: controls first, then
 * override the pose) and treats an active flight as an interaction so the idle drift stays paused
 * through the flight and for DRIFT.resumeMs after landing.
 */
export interface FlightTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export interface FlightHandle {
  /** Begin a flight (or cut instantly under reduced motion). Replaces any flight in progress. */
  start(target: FlightTarget): void;
  /** Abort — the camera stays where it is and GlobeControls takes over. */
  cancel(): void;
  /** Apply the in-flight pose. Returns true while flying (incl. the landing frame). */
  update(nowMs: number): boolean;
  active(): boolean;
}

/** cubic-bezier(x1, y1, x2, y2) easing — Newton on the parametric x, then evaluate y. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const sample = (p1: number, p2: number, t: number) =>
    3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  const derivX = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sample(x1, x2, t) - x;
      const d = derivX(t);
      if (Math.abs(err) < 1e-6 || d === 0) break;
      t -= err / d;
    }
    return sample(y1, y2, t);
  };
}

/** Ellipsoid radius along a unit geocentric direction (a/b-scaled sphere). */
function radiusAlong(d: THREE.Vector3, a: number, b: number): number {
  const s = (a / b) * d.z;
  return a / Math.sqrt(d.x * d.x + d.y * d.y + s * s);
}

export function createFlight(
  camera: THREE.PerspectiveCamera,
  opts: { reduceMotion?: boolean; wgs84A: number; wgs84B: number },
): FlightHandle {
  const ease = cubicBezier(...FLIGHT.easing);
  const [a, b] = [opts.wgs84A, opts.wgs84B];

  let flying = false;
  let startMs = 0;
  let d0 = new THREE.Vector3(); // start geocentric direction (unit)
  let h0 = 0; // start geocentric altitude
  let h1 = 0;
  let bump = 0;
  let q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  let target: FlightTarget | null = null;
  const qArc = new THREE.Quaternion(); // full d0→d1 rotation
  const qIdent = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _dir = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  function finalPose(t: FlightTarget): void {
    camera.position.copy(t.position);
    camera.up.copy(t.position).normalize(); // radial up — the globe pose convention
    camera.lookAt(t.lookAt);
  }

  return {
    start(t) {
      if (opts.reduceMotion) {
        // Reduced motion: no sweep — an instant cut to the destination pose.
        flying = false;
        finalPose(t);
        return;
      }
      target = t;
      startMs = performance.now();
      d0 = camera.position.clone().normalize();
      const d1 = t.position.clone().normalize();
      h0 = camera.position.length() - radiusAlong(d0, a, b);
      h1 = t.position.length() - radiusAlong(d1, a, b);
      qArc.setFromUnitVectors(d0, d1);
      const groundDist = d0.angleTo(d1) * a;
      bump = Math.min(FLIGHT.arcBumpFactor * groundDist, FLIGHT.arcBumpMaxM);
      q0 = camera.quaternion.clone();
      _m.lookAt(t.position, t.lookAt, d1); // end orientation (radial up)
      q1.setFromRotationMatrix(_m);
      flying = true;
    },
    cancel() {
      flying = false;
      target = null;
    },
    update(nowMs) {
      if (!flying || !target) return false;
      const x = (nowMs - startMs) / FLIGHT.durationMs;
      if (x >= 1) {
        finalPose(target);
        flying = false;
        target = null;
        return true; // landing frame still counts as flight (suppresses drift this frame)
      }
      const e = ease(x);
      _q.slerpQuaternions(qIdent, qArc, e);
      _dir.copy(d0).applyQuaternion(_q);
      const alt = h0 + (h1 - h0) * e + bump * Math.sin(Math.PI * e);
      camera.position.copy(_dir).multiplyScalar(radiusAlong(_dir, a, b) + alt);
      camera.quaternion.slerpQuaternions(q0, q1, e);
      camera.up.copy(_dir); // radial — keeps GlobeControls happy on handover
      return true;
    },
    active: () => flying,
  };
}
