import * as THREE from "three";
import { geodeticToEcef } from "../../lib/geo/projection";
import { arrivalPose, type FlightHandle, type FlightTarget } from "./flight";
import { EXPLORE, WGS84_A, WGS84_B } from "./tuning";

/**
 * Explore ambient pin journey (Phase 5.5 S4, §Item 11) — the meditative auto-cruise behind the
 * Explore nav item. The camera settles to EXPLORE.altM / EXPLORE.tiltDeg and glides from public
 * pin to public pin in nearest-neighbour order: each leg is a constant-angular-velocity
 * great-circle rotation (DRIFT pacing × a few — deliberately NOT the 2.2 s cinematic bezier)
 * with a soft speed ramp at both ends and a dwell at each pin. Entry and the <2-pins fallback
 * ride the normal cinematic flight; reduced motion turns every leg into the flight's instant cut.
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
  type State = "inactive" | "entering" | "cruising" | "dwelling" | "fallback";
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

  /** Ellipsoid radius along a unit direction (flight.ts's metric). */
  const radiusAlong = (d: THREE.Vector3): number => {
    const s = (WGS84_A / WGS84_B) * d.z;
    return WGS84_A / Math.sqrt(d.x * d.x + d.y * d.y + s * s);
  };

  /** The explore pose framing a point: EXPLORE.altM above it at EXPLORE.tiltDeg, approached
   *  from the camera's current side (no corkscrew). */
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

  /** Begin the journey: NN order from the focus, cinematic entry flight to the first pin. */
  const begin = () => {
    const pins = deps.getPins();
    const focus = deps.getFocus();
    legs = 0;
    if (pins.length < 2) {
      // Graceful fallback: settle to the Explore pose over the current focus; the idle drift
      // owns the motion from there (update() returns false in this state).
      state = "fallback";
      const pose = poseFor(
        pins.length === 1 ? pins[0] : { lat: focus.latDeg, lon: focus.lonDeg },
      );
      flight.start(pose);
      return;
    }
    order = orderByNearestNeighbour(pins, focus.latDeg, focus.lonDeg).map((i) => pins[i]);
    state = "entering";
    flight.start(poseFor(order[0]));
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
      if (on && state === "inactive") begin();
      else if (!on && state !== "inactive") {
        state = "inactive";
        order = [];
        if (flight.active()) flight.cancel(); // a user exit mid-entry hands the camera back
      }
    },

    update(nowMs: number, dtMs: number): boolean {
      switch (state) {
        case "inactive":
          return false;
        case "fallback": {
          // The idle drift owns the camera here — but if pins arrive late (the welcome page
          // arms the journey before the first viewport query lands), begin the real journey.
          if (deps.getPins().length >= 2) begin();
          return false;
        }
        case "entering": {
          if (flight.active()) return false; // the flight steers this frame
          state = "dwelling";
          legs++; // arriving at the first pin counts — DoD counts legs flown
          if (order.length > 0) _dwellPin.copy(dirOf(order[0]));
          order.shift();
          dwellUntil = nowMs + EXPLORE.dwellMs;
          return true;
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
            _look.copy(_dwellPin).multiplyScalar(radiusAlong(_dwellPin));
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
          _look.copy(_lookDir).multiplyScalar(radiusAlong(_lookDir));
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
