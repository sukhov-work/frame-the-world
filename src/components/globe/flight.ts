import * as THREE from "three";
import { FLIGHT } from "./tuning";

/**
 * Cinematic camera flight to a placed photo / searched place (design-board motion spec: 2200 ms,
 * cubic-bezier(.65, 0, .35, 1); reduced-motion = instant cut).
 *
 * Path: great-circle slerp of the geocentric direction + geocentric-altitude blend with a
 * ballistic mid-flight bump (FLIGHT.arcBump*) — short hops rise a little, long hauls arc properly.
 * Phase 5.5 S2 additions:
 *   • PATH FLOOR — the ellipsoid-only blend was terrain-blind (flights clipped through mountains
 *     between/near low endpoints). Callers pass a `floorM` (terrain at the endpoints + clearance);
 *     `pathAltitude` enforces it mid-flight and ramps it at both ends so the endpoint poses stay
 *     EXACT (the arrival pose is already terrain-clamped by the caller).
 *   • PATH-FOLLOWING ORIENTATION — the old independent q0→q1 slerp swept the view sideways on
 *     long heading changes ("spin"). Long flights now look along the path tangent with radial up
 *     (banked-turn style), blending out of the start pose over the first ~15% and into the final
 *     pose over the last ~25% (`pathFrameWeight`). Short hops keep the plain slerp — their
 *     orientation change IS the point (`pathFollowWeight` gates by ground distance).
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

interface FlightStartOpts {
  /** Path-altitude floor (m above the ellipsoid) — usually max(rendered terrain at both
   *  endpoints) + FLIGHT.floorClearM. Enforced mid-flight, ramped near the endpoints so the
   *  start/end poses stay exact. null/undefined = no floor (pure ellipsoid blend). */
  floorM?: number | null;
  /** Override the flight duration (ms). Defaults to FLIGHT.durationMs — used for the full
   *  cinematic arrival; a short value gives a quick corrective re-frame (e.g. the arrival
   *  re-framing after a pin's terrain settles). */
  durationMs?: number | null;
}

export interface FlightHandle {
  /** Begin a flight (or cut instantly under reduced motion). Replaces any flight in progress. */
  start(target: FlightTarget, opts?: FlightStartOpts): void;
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

/** Hermite smoothstep of a pre-scaled 0..1 input. */
function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Path altitude at eased progress `e` (pure — unit-tested): endpoint blend + ballistic bump,
 * clamped from below by the terrain floor. The floor ramps in/out across `rampFrac` of the path
 * from each endpoint's own (possibly lower) altitude, so alt(0) = h0 and alt(1) = h1 EXACTLY,
 * while the mid-path can never dip under `floorM`.
 */
export function pathAltitude(
  e: number,
  h0: number,
  h1: number,
  bump: number,
  floorM: number | null | undefined,
  rampFrac: number,
): number {
  const blend = h0 + (h1 - h0) * e;
  let alt = blend + bump * Math.sin(Math.PI * e);
  if (floorM != null) {
    const startF = Math.min(h0, floorM);
    const endF = Math.min(h1, floorM);
    const floorNow = Math.min(
      startF + (floorM - startF) * smoothstep01(e / rampFrac),
      endF + (floorM - endF) * smoothstep01((1 - e) / rampFrac),
    );
    alt = Math.max(alt, floorNow);
  }
  return alt;
}

/**
 * Weight of the path-following orientation frame at eased progress `e` (pure — unit-tested):
 * 0 at both endpoints (the pose blends out of q0 and into q1), 1 through the middle. The exit
 * ramp is the design's "blend into the final pose in the last ~25%".
 */
export function pathFrameWeight(e: number, inFrac: number, outFrac: number): number {
  return Math.min(smoothstep01(e / inFrac), smoothstep01((1 - e) / outFrac));
}

/**
 * How much this flight follows its path tangent at all (pure — unit-tested): 0 for short hops
 * (their q0→q1 orientation change is the point — a pin 2 km away facing the other way MUST pan),
 * 1 for long hauls (where the free slerp read as a spin against the sweeping ground).
 */
export function pathFollowWeight(groundDistM: number, loM: number, hiM: number): number {
  return smoothstep01((groundDistM - loM) / (hiM - loM));
}

/** Everything the shared arrival pose needs (used by placed-photo flights AND search fly-tos). */
export interface ArrivalPoseOpts {
  /** ECEF point the camera frames on arrival (image-plane centre / searched place). */
  lookAt: THREE.Vector3;
  /** Unit HORIZONTAL direction (⊥ local up) from `lookAt` toward the camera side. */
  approachHoriz: THREE.Vector3;
  /** Rendered-terrain height (m above the ellipsoid) at the target; 0 when unknown. */
  groundAltM: number;
  /** Camera height above that ground on arrival. */
  altAboveGroundM: number;
  /** Arrival camera tilt (deg; 0 = nadir, 90 = horizon) — sets the horizontal back-off. */
  tiltDeg: number;
  wgs84A: number;
  wgs84B: number;
}

/**
 * The ONE arrival-pose derivation (Phase 5.5 S2): camera `altAboveGroundM` above the rendered
 * ground, backed off along the approach azimuth so the look-down angle reads as `tiltDeg`.
 * Replaces the old planeDist·backFactor/liftFactor multiples (which ignored terrain and pinned
 * the framing to the frustum size instead of an explicit pose).
 */
export function arrivalPose(o: ArrivalPoseOpts): FlightTarget {
  const upT = o.lookAt.clone().normalize();
  const hLook = o.lookAt.length() - radiusAlong(upT, o.wgs84A, o.wgs84B);
  // Never arrive below the point being framed (a lookAt above the requested camera altitude
  // would flip the pose into looking up from underground).
  const camAlt = Math.max(o.groundAltM + o.altAboveGroundM, hLook + 1);
  const drop = Math.max(camAlt - hLook, 1);
  const tiltRad = (Math.min(Math.max(o.tiltDeg, 5), 88) * Math.PI) / 180;
  const position = o.lookAt
    .clone()
    .addScaledVector(upT, camAlt - hLook)
    .addScaledVector(o.approachHoriz, drop * Math.tan(tiltRad));
  return { position, lookAt: o.lookAt.clone() };
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
  let floorM: number | null = null;
  let durationMs: number = FLIGHT.durationMs; // per-flight (default = the full cinematic arrival)
  let followW = 0; // path-following orientation weight for THIS flight (by ground distance)
  let q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  let target: FlightTarget | null = null;
  const qArc = new THREE.Quaternion(); // full d0→d1 rotation
  const qIdent = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _qPath = new THREE.Quaternion();
  const _dir = new THREE.Vector3();
  const _ahead = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  function finalPose(t: FlightTarget): void {
    camera.position.copy(t.position);
    camera.up.copy(t.position).normalize(); // radial up — the globe pose convention
    camera.lookAt(t.lookAt);
  }

  /** Position on the path at eased progress e, written into `out`. */
  function pathPosition(e: number, out: THREE.Vector3): void {
    _q.slerpQuaternions(qIdent, qArc, e);
    out.copy(d0).applyQuaternion(_q);
    const alt = pathAltitude(e, h0, h1, bump, floorM, FLIGHT.floorRampFrac);
    out.multiplyScalar(radiusAlong(out, a, b) + alt);
  }

  return {
    start(t, o) {
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
      floorM = o?.floorM ?? null;
      durationMs = o?.durationMs ?? FLIGHT.durationMs;
      followW = pathFollowWeight(groundDist, FLIGHT.pathFollowLoM, FLIGHT.pathFollowHiM);
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
      const x = (nowMs - startMs) / durationMs;
      if (x >= 1) {
        finalPose(target);
        flying = false;
        target = null;
        return true; // landing frame still counts as flight (suppresses drift this frame)
      }
      const e = ease(x);
      pathPosition(e, camera.position);
      _dir.copy(camera.position).normalize();
      // Orientation: endpoint slerp, pulled toward the path-following frame (forward = path
      // tangent via a look-ahead point, up = radial) through the middle of long flights.
      camera.quaternion.slerpQuaternions(q0, q1, e);
      const w = followW * pathFrameWeight(e, FLIGHT.orientInFrac, FLIGHT.orientOutFrac);
      if (w > 1e-3) {
        pathPosition(Math.min(e + FLIGHT.lookAheadE, 1), _ahead);
        if (_ahead.distanceToSquared(camera.position) > 1) {
          _m.lookAt(camera.position, _ahead, _dir);
          _qPath.setFromRotationMatrix(_m);
          camera.quaternion.slerp(_qPath, w);
        }
      }
      camera.up.copy(_dir); // radial — keeps GlobeControls happy on handover
      return true;
    },
    active: () => flying,
  };
}
