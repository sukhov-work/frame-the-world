import * as THREE from "three";
import { geodeticToEcef } from "../../lib/geo/projection";
import { arrivalPose, type FlightHandle, type FlightTarget } from "./flight";
import { EXPLORE, WGS84_A, WGS84_B } from "./tuning";

/**
 * Explore ambient pin journey (Phase 5.5 S4, §Item 11) — the meditative auto-cruise behind the
 * Explore nav item and the Welcome backdrop. The journey begins CRUISING from whatever pose the
 * camera already holds (owner: no entry flight — the welcome screen must open already gliding,
 * never jump toward a pin) and glides from public pin to public pin in nearest-neighbour order:
 * each leg is a constant-angular-velocity great-circle rotation (deliberately NOT the 2.2 s
 * cinematic bezier) with a soft speed ramp at both ends and a dwell at each pin. Altitude and
 * the look point ease in over the first leg, so any starting pose blends into the cruise.
 * Reduced motion turns every leg into the flight's instant cut.
 *
 * The controller OWNS the camera while cruising (`update` returns true) — the orchestrator
 * skips the idle drift and the store glides for those frames, and exits the mode on ANY direct
 * interaction (the noteInteract pattern) so it never fights the user.
 *
 * The pure leg math (`orderByNearestNeighbour`, `lookAheadArcRad`, `legOmegaRadPerS`,
 * `edgeRamp`) is exported for tests, mirroring flight.ts.
 */

export interface ExplorePoint {
  lat: number;
  lon: number;
}

/** Unit ECEF-direction of a geodetic point (altitude 0 — direction only). */
function dirOf(p: ExplorePoint): THREE.Vector3 {
  return new THREE.Vector3(...geodeticToEcef(p.lat, p.lon, 0)).normalize();
}

/**
 * Greedy nearest-neighbour ordering over the loaded pins, starting from the camera's current
 * focus (pure — unit-tested): visits every point once, always hopping to the closest unvisited
 * one — the "no zigzag" ordering the design asks for. O(n²) on ≤1000 pins, once per entry.
 */
export function orderByNearestNeighbour(
  points: readonly ExplorePoint[],
  startLat: number,
  startLon: number,
): number[] {
  const dirs = points.map(dirOf);
  const order: number[] = [];
  const visited = new Array<boolean>(points.length).fill(false);
  let cur = dirOf({ lat: startLat, lon: startLon });
  for (let step = 0; step < points.length; step++) {
    let best = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < points.length; i++) {
      if (visited[i]) continue;
      const d = cur.dot(dirs[i]); // monotone in angular distance — no acos needed
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    if (best < 0) break;
    visited[best] = true;
    order.push(best);
    cur = dirs[best];
  }
  return order;
}

/**
 * Arc (rad) between the camera's ground point and the point it LOOKS AT, for a camera at
 * `altM` tilted `tiltDeg` from nadir (pure — unit-tested). Spherical triangle: the view ray
 * from radius R+h at angle α off nadir meets the sphere where sin(∠L) = (R+h)/R·sin α —
 * near intersection = the obtuse ∠L, so γ = asin((R+h)/R·sinα) − α. Rays past the limb
 * clamp to the horizon arc acos(R/(R+h)).
 */
export function lookAheadArcRad(altM: number, tiltDeg: number, radiusM: number): number {
  const a = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(tiltDeg, 0, 88));
  const s = ((radiusM + altM) / radiusM) * Math.sin(a);
  if (s >= 1) return Math.acos(radiusM / (radiusM + altM));
  return Math.asin(s) - a;
}

/** Leg angular speed (rad/s): arc/target duration, clamped to the meditative band (pure). */
export function legOmegaRadPerS(
  arcRad: number,
  targetS: number,
  minDegPerS: number,
  maxDegPerS: number,
): number {
  return THREE.MathUtils.clamp(
    arcRad / Math.max(targetS, 1e-6),
    THREE.MathUtils.degToRad(minDegPerS),
    THREE.MathUtils.degToRad(maxDegPerS),
  );
}

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Speed multiplier along a leg (pure — unit-tested): 1 through the middle, easing toward the
 * floor across `frac` of the leg at each end — soft starts/stops that still complete (a pure
 * ramp-to-zero never arrives).
 */
export function edgeRamp(progress: number, frac: number, floor: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.max(floor, Math.min(smoothstep01(p / frac), smoothstep01((1 - p) / frac)));
}

export interface ExploreDeps {
  camera: THREE.PerspectiveCamera;
  flight: FlightHandle;
  reduceMotion: boolean;
  /** Loaded public pins (fresh read per leg — the viewport query may swap the list). */
  getPins: () => readonly ExplorePoint[];
  /** Current view-focus geodetic position (the NN ordering's start). */
  getFocus: () => { latDeg: number; lonDeg: number };
}

export interface ExploreHandle {
  /** Arm/disarm from the store flag; disarming mid-leg just stops steering (camera stays). */
  setActive(on: boolean): void;
  /** Steer one frame. Returns true while explore OWNS the camera (orchestrator skips drift). */
  update(nowMs: number, dtMs: number): boolean;
  /** Dev/verification introspection. */
  state(): string;
  legsFlown(): number;
}

export function createExplore(deps: ExploreDeps): ExploreHandle {
  const { camera, flight } = deps;
  type State = "inactive" | "arming" | "cruising" | "dwelling" | "fallback";
  let state: State = "inactive";
  let order: ExplorePoint[] = []; // remaining journey, front = current target
  let legs = 0;
  let dwellUntil = 0;
  let hM = EXPLORE.altM; // cruise geocentric altitude (eases toward EXPLORE.altM)
  let omega = 0; // rad/s for the current leg
  let legArc = 0; // total arc of the current leg
  const gamma = () => lookAheadArcRad(hM, EXPLORE.tiltDeg, WGS84_A);

  const _dir = new THREE.Vector3();
  const _pinDir = new THREE.Vector3();
  const _targetDir = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _tangent = new THREE.Vector3();
  const _lookDir = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _dwellPin = new THREE.Vector3(); // unit dir of the pin we're dwelling at (orbit axis)
  const _up = new THREE.Vector3(); // local ENU basis at the camera (per easeLookToward call)
  const _east = new THREE.Vector3();
  const _north = new THREE.Vector3();
  const _ray = new THREE.Vector3();
  const _Z = new THREE.Vector3(0, 0, 1);
  let easeTilt = 0; // eased view ray, as (tilt from nadir, heading) at the camera — the
  let easeHead = 0; // anti-snap low-pass lives in ANGLE space (see easeLookToward)

  const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  /** Local ENU basis at the current camera position (fills _up/_east/_north). */
  const localBasis = () => {
    _up.copy(camera.position).normalize();
    _east.crossVectors(_Z, _up);
    if (_east.lengthSq() < 1e-12) _east.set(1, 0, 0); // pole guard
    _east.normalize();
    _north.crossVectors(_up, _east);
  };

  /** (tilt from nadir, heading) of a world-space unit ray at the current camera position. */
  const rayAngles = (ray: THREE.Vector3): [number, number] => {
    const tilt = Math.acos(THREE.MathUtils.clamp(-ray.dot(_up), -1, 1));
    const e = ray.dot(_east);
    const n = ray.dot(_north);
    const head = Math.abs(e) + Math.abs(n) < 1e-9 ? easeHead : Math.atan2(e, n);
    return [tilt, head];
  };

  /** Clamped low-pass of the rendered view ray toward "look at `target` (unit surface dir)":
   *  exponential approach (τ poseEaseTauMs) in TILT/HEADING space, capped at
   *  lookMaxRateDegPerS. Angle space matters twice over: err/τ on a large entry error would
   *  be a >90°/s whip pan (measured), and easing the look POINT along the surface drags the
   *  gaze through a nadir stare mid-pan (measured too) — here the tilt stays oblique while
   *  the heading pans around. Leaves the eased look point in `_look` for camera.lookAt. */
  const easeLookToward = (target: THREE.Vector3, dtMs: number) => {
    localBasis();
    _ray.copy(target).multiplyScalar(radiusAlong(target)).sub(camera.position);
    if (_ray.lengthSq() < 1) {
      _look.copy(target).multiplyScalar(radiusAlong(target)); // degenerate: camera at target
      return;
    }
    _ray.normalize();
    const [tTilt, tHead] = rayAngles(_ray);
    const k = 1 - Math.exp(-dtMs / EXPLORE.poseEaseTauMs);
    const cap = THREE.MathUtils.degToRad(EXPLORE.lookMaxRateDegPerS) * (dtMs / 1000);
    easeTilt += THREE.MathUtils.clamp((tTilt - easeTilt) * k, -cap, cap);
    easeHead = wrapPi(easeHead + THREE.MathUtils.clamp(wrapPi(tHead - easeHead) * k, -cap, cap));
    const sinT = Math.sin(easeTilt);
    _ray
      .copy(_up)
      .multiplyScalar(-Math.cos(easeTilt))
      .addScaledVector(_north, sinT * Math.cos(easeHead))
      .addScaledVector(_east, sinT * Math.sin(easeHead));
    _look.copy(camera.position).addScaledVector(_ray, WGS84_A); // any point along the ray
  };

  /** Ellipsoid radius along a unit direction (flight.ts's metric). */
  const radiusAlong = (d: THREE.Vector3): number => {
    const s = (WGS84_A / WGS84_B) * d.z;
    return WGS84_A / Math.sqrt(d.x * d.x + d.y * d.y + s * s);
  };

  /** The explore pose framing a point: EXPLORE.altM above it at EXPLORE.tiltDeg, approached
   *  from the camera's current side (no corkscrew). Reduced-motion legs cut to this pose. */
  const poseFor = (p: ExplorePoint): FlightTarget => {
    const target = new THREE.Vector3(...geodeticToEcef(p.lat, p.lon, 0));
    const upT = target.clone().normalize();
    const horiz = camera.position.clone().sub(target);
    horiz.addScaledVector(upT, -horiz.dot(upT));
    if (horiz.lengthSq() < 1) horiz.set(0, 0, 1).addScaledVector(upT, -upT.z);
    horiz.normalize();
    return arrivalPose({
      lookAt: target,
      approachHoriz: horiz,
      groundAltM: 0, // 900 km up — terrain is sub-pixel here
      altAboveGroundM: EXPLORE.altM,
      tiltDeg: EXPLORE.tiltDeg,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
  };

  /** Seed the look low-pass from the camera's ACTUAL forward ray — the first cruise frame
   *  then renders the exact pose the user already sees (zero initial error by construction)
   *  and eases toward the leg's tangent look instead of snapping to it. */
  const seedLook = () => {
    localBasis();
    camera.getWorldDirection(_ray);
    [easeTilt, easeHead] = rayAngles(_ray);
  };

  /** Begin the journey: NN order from the focus, then cruise straight from the CURRENT pose —
   *  no entry flight (the welcome backdrop must open already gliding, never lunge at a pin);
   *  the altitude + look low-passes absorb the starting pose over the first leg. Returns
   *  whether the journey owns the camera (false = <2-pins fallback, drift keeps flying). */
  const begin = (nowMs: number): boolean => {
    const pins = deps.getPins();
    const focus = deps.getFocus();
    legs = 0;
    if (pins.length < 2) {
      // Graceful fallback: the idle drift owns the motion (update() returns false in this
      // state); the journey begins as soon as the viewport query lands ≥2 pins.
      state = "fallback";
      return false;
    }
    order = orderByNearestNeighbour(pins, focus.latDeg, focus.lonDeg).map((i) => pins[i]);
    seedLook();
    startLeg(nowMs);
    return true;
  };

  /** Arm the next leg toward order[0] (called with the camera settled at the previous pin). */
  const startLeg = (nowMs: number) => {
    if (order.length === 0) {
      // Journey exhausted — re-order from here over the FRESH pin list and keep wandering.
      const pins = deps.getPins();
      const focus = deps.getFocus();
      if (pins.length < 2) {
        state = "fallback";
        return;
      }
      order = orderByNearestNeighbour(pins, focus.latDeg, focus.lonDeg).map((i) => pins[i]);
      // The nearest "next" pin is where we already stand — skip it to actually travel.
      if (order.length > 1) order.shift();
    }
    const next = order[0];
    if (deps.reduceMotion) {
      // Reduced motion: every leg is the flight's instant cut, then the dwell.
      _dwellPin.copy(dirOf(next));
      flight.start(poseFor(next));
      order.shift();
      legs++;
      state = "dwelling";
      dwellUntil = nowMs + EXPLORE.dwellMs;
      return;
    }
    _dir.copy(camera.position).normalize();
    _pinDir.copy(dirOf(next));
    _dwellPin.copy(_pinDir); // whatever ends this leg dwells at this pin
    _axis.crossVectors(_dir, _pinDir);
    const g = gamma();
    if (_axis.lengthSq() < 1e-12) {
      _targetDir.copy(_dir); // degenerate (already overhead) — arrive immediately
    } else {
      _axis.normalize();
      // Rest position = γ BEHIND the pin along this leg's great circle (pin at the view focus).
      _q.setFromAxisAngle(_axis, -g);
      _targetDir.copy(_pinDir).applyQuaternion(_q);
    }
    legArc = _dir.angleTo(_targetDir);
    if (legArc < THREE.MathUtils.degToRad(EXPLORE.minLegDeg)) {
      order.shift();
      legs++;
      state = "dwelling";
      dwellUntil = nowMs + EXPLORE.dwellMs;
      return;
    }
    omega = legOmegaRadPerS(
      legArc,
      EXPLORE.legTargetS,
      EXPLORE.omegaMinDegPerS,
      EXPLORE.omegaMaxDegPerS,
    );
    hM = camera.position.length() - radiusAlong(_dir);
    state = "cruising";
  };

  return {
    setActive(on: boolean) {
      // Arming defers to the next update() — begin() needs the frame clock for the first leg.
      if (on && state === "inactive") state = "arming";
      else if (!on && state !== "inactive") {
        state = "inactive";
        order = [];
        if (flight.active()) flight.cancel(); // a user exit mid-cut hands the camera back
      }
    },

    update(nowMs: number, dtMs: number): boolean {
      switch (state) {
        case "inactive":
          return false;
        case "arming":
          return begin(nowMs); // cruising/dwelling own the camera from frame one
        case "fallback": {
          // The idle drift owns the camera here — but if pins arrive late (the welcome page
          // arms the journey before the first viewport query lands), begin the real journey.
          if (deps.getPins().length >= 2) begin(nowMs);
          return false;
        }
        case "dwelling": {
          if (flight.active()) return false; // reduced-motion legs ride the flight (a cut)
          if (nowMs >= dwellUntil) {
            startLeg(nowMs);
            return true;
          }
          // Slow orbit around the pin while dwelling — the journey never freezes, even when
          // every loaded pin shares one city (their rest poses nearly coincide).
          if (!deps.reduceMotion && _dwellPin.lengthSq() > 0.5) {
            const ang = THREE.MathUtils.degToRad(EXPLORE.dwellOrbitDegPerS) * (dtMs / 1000);
            _q.setFromAxisAngle(_dwellPin, ang);
            camera.position.applyQuaternion(_q);
            easeLookToward(_dwellPin, dtMs);
            camera.up.copy(camera.position).normalize();
            camera.lookAt(_look);
            camera.updateMatrixWorld();
          }
          return true; // holding the pose still counts as owning the camera
        }
        case "cruising": {
          _dir.copy(camera.position).normalize();
          const remaining = _dir.angleTo(_targetDir);
          const progress = 1 - remaining / Math.max(legArc, 1e-9);
          const ramp = edgeRamp(progress, EXPLORE.edgeRampFrac, EXPLORE.edgeRampFloor);
          const step = omega * (dtMs / 1000) * ramp;
          _axis.crossVectors(_dir, _targetDir);
          if (remaining <= Math.max(step, 1e-7) || _axis.lengthSq() < 1e-12) {
            _dir.copy(_targetDir); // arrived — snap the last sliver
            order.shift();
            legs++;
            state = "dwelling";
            dwellUntil = nowMs + EXPLORE.dwellMs;
          } else {
            _axis.normalize();
            _q.setFromAxisAngle(_axis, step);
            _dir.applyQuaternion(_q);
          }
          // Altitude eases toward the cruise altitude (absorbs whatever the entry left us at).
          hM += (EXPLORE.altM - hM) * (1 - Math.exp(-dtMs / EXPLORE.altEaseTauMs));
          camera.position.copy(_dir).multiplyScalar(radiusAlong(_dir) + hM);
          // Pose: radial up, looking γ ahead along the travel direction — constant tilt, and
          // the look-at lands exactly on the pin as the leg completes.
          _tangent.crossVectors(_axis.crossVectors(_dir, _targetDir).normalize(), _dir);
          if (state === "dwelling" || _tangent.lengthSq() < 1e-12) {
            // Arrival frame (or degenerate tangent): aim at the pin itself.
            _lookDir.copy(_pinDir);
          } else {
            _tangent.normalize();
            const g = gamma();
            _lookDir.copy(_dir).multiplyScalar(Math.cos(g)).addScaledVector(_tangent, Math.sin(g));
          }
          // Low-pass the view ray (anti-snap): absorbs the arbitrary entry pose on the
          // first leg and the heading change at every dwell→leg handover. The steady-state
          // lag at cruise ω is a fraction of a degree — invisible, and the dwell converges it.
          easeLookToward(_lookDir, dtMs);
          camera.up.copy(_dir);
          camera.lookAt(_look);
          camera.updateMatrixWorld();
          return true;
        }
      }
    },

    state: () => state,
    legsFlown: () => legs,
  };
}
