/**
 * Device orientation → where the phone's REAR CAMERA looks (owner order 2026-09-07g: AR look-around
 * in mobile FPV). Pure, three-free, unit-pinned; the engine module `scene/arLook.ts` feeds it the
 * browser's `deviceorientation` samples and reads back a heading + pitch for the FPV camera.
 *
 * THE FRAMES (W3C DeviceOrientation Event spec §3.1, https://w3c.github.io/deviceorientation/):
 * device x = right of the screen, y = top of the screen, z = out of the screen toward the user —
 * FIXED TO THE HARDWARE in its portrait pose ("if the orientation of the screen changes when the
 * device is rotated … this does not affect the orientation of the coordinate frame relative to the
 * device"). Earth frame X east, Y north, Z up (the Orientation Sensor spec's, MAGNETIC north).
 * `R = Rz(α)·Rx(β)·Ry(γ)` maps a device vector to the Earth frame (intrinsic Z-X'-Y'', right-hand;
 * spec eq. 13a is the matrix below).
 *
 * THE LOOK VECTOR is the rear camera's, device `(0, 0, −1)` — the spec's own worked example §A.1
 * ("the horizontal component of a vector which is orthogonal to the device's screen and pointing out
 * of the back of the screen"). Its heading needs NO `screen.orientation.angle` correction: the rear
 * camera points where it points whichever way the UI is rotated. The screen angle only decides ROLL
 * (which device axis is the picture's "up"), computed here and — by decision (DECISIONS
 * 2026-09-07h) — NOT applied: the FPV camera has no roll seam and a level horizon is what a planning
 * viewfinder wants.
 *
 * NEVER THROUGH THE EULER ANGLES THEMSELVES. WebKit's extraction flips α by 180° and γ's sign as
 * the screen passes through vertical — the AR pose exactly — but both triples describe the SAME
 * rotation, so the vectors below are continuous where the angles are not. Only the vectors are
 * ever used downstream.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Degrees wrapped to [0, 360). */
export function wrapDeg360(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/** Signed circular difference `a − b` in (−180, 180]. */
export function circDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The rotation matrix `R = Rz(α)·Rx(β)·Ry(γ)` applied to a device-frame vector — returns the
 * vector in the Earth frame (east, north, up). Spec eq. 13a, columns as written.
 */
export function deviceToEarth(alphaDeg: number, betaDeg: number, gammaDeg: number, v: Vec3): Vec3 {
  const a = alphaDeg * D2R;
  const b = betaDeg * D2R;
  const g = gammaDeg * D2R;
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);
  // R = [[cA·cG − sA·sB·sG, −cB·sA, cG·sA·sB + cA·sG],
  //      [cG·sA + cA·sB·sG,  cA·cB, sA·sG − cA·cG·sB],
  //      [−cB·sG,            sB,    cB·cG]]
  return {
    x: (cA * cG - sA * sB * sG) * v.x + -cB * sA * v.y + (cG * sA * sB + cA * sG) * v.z,
    y: (cG * sA + cA * sB * sG) * v.x + cA * cB * v.y + (sA * sG - cA * cG * sB) * v.z,
    z: -cB * sG * v.x + sB * v.y + cB * cG * v.z,
  };
}

/** Heading (degrees clockwise from the frame's north, [0, 360)) and the horizontal magnitude of
 *  an Earth-frame vector; `horiz` near 0 means the heading is ill-conditioned. */
export function headingOf(v: Vec3): { headingDeg: number; horiz: number } {
  const horiz = Math.hypot(v.x, v.y);
  return { headingDeg: wrapDeg360(Math.atan2(v.x, v.y) * R2D), horiz };
}

/** Elevation of an Earth-frame unit vector above the horizon, degrees in [−90, 90]. */
export function pitchOf(v: Vec3): number {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return Math.asin(Math.max(-1, Math.min(1, v.z / n))) * R2D;
}

/** How small the horizontal component of the look vector may get before the heading is taken
 *  from the top-of-screen vector instead (a phone held flat: the camera looks straight down and
 *  "where it points" is where its top edge points — the spec's flat-device example). */
export const LOOK_HORIZ_MIN = 0.08;

export interface DevicePose {
  /** The rear camera's heading in the sample's frame, [0, 360) — the top edge's when the camera
   *  looks nearly straight up or down (`lookHoriz < LOOK_HORIZ_MIN`). */
  yawDeg: number;
  /** The rear camera's elevation above the horizon, [−90, 90]. */
  pitchDeg: number;
  /** The horizontal magnitude of the look vector (0 = straight up/down). */
  lookHoriz: number;
  /** The heading of the TOP OF THE SCREEN (device +y) projected on the ground, [0, 360) — what iOS
   *  `webkitCompassHeading` reports (Core Location's default `headingOrientation`, portrait: "the
   *  top of the device … represents due north"). */
  topHeadingDeg: number;
  /** …and its horizontal magnitude: 1 flat, 0 upright. The compass fusion gates on it. */
  topHoriz: number;
  /** Roll of the picture about the look axis, degrees, positive = clockwise as seen by the viewer;
   *  0 when the screen's up (after `screenAngleDeg`) is level with the world's up. Computed, not
   *  applied (see the module note). */
  rollDeg: number;
}

/**
 * The pose from one `deviceorientation` triple. `screenAngleDeg` is `screen.orientation.angle`
 * (0 / 90 / 180 / 270, counter-clockwise from the natural portrait); it affects ONLY `rollDeg`.
 */
export function poseFromEuler(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg = 0,
): DevicePose {
  const look = deviceToEarth(alphaDeg, betaDeg, gammaDeg, { x: 0, y: 0, z: -1 });
  const top = deviceToEarth(alphaDeg, betaDeg, gammaDeg, { x: 0, y: 1, z: 0 });
  const lh = headingOf(look);
  const th = headingOf(top);
  // Roll: the screen's up axis (device frame, rotated by the UI angle) against the level frame
  // built on the look vector. At a degenerate look (straight down) the level frame is arbitrary
  // — roll reads 0 there, which is also what "ignore roll" makes of it.
  const sa = screenAngleDeg * D2R;
  const screenUp = deviceToEarth(alphaDeg, betaDeg, gammaDeg, { x: -Math.sin(sa), y: Math.cos(sa), z: 0 });
  let rollDeg = 0;
  if (lh.horiz >= LOOK_HORIZ_MIN) {
    // level "up" = world up with its along-look component removed; level "right" = look × up
    const f = look;
    const fn = Math.hypot(f.x, f.y, f.z) || 1;
    const fx = f.x / fn;
    const fy = f.y / fn;
    const fz = f.z / fn;
    const ux = -fz * fx;
    const uy = -fz * fy;
    const uz = 1 - fz * fz;
    const un = Math.hypot(ux, uy, uz) || 1;
    const u0 = { x: ux / un, y: uy / un, z: uz / un };
    const r0 = { x: fy * u0.z - fz * u0.y, y: fz * u0.x - fx * u0.z, z: fx * u0.y - fy * u0.x };
    const cu = screenUp.x * u0.x + screenUp.y * u0.y + screenUp.z * u0.z;
    const cr = screenUp.x * r0.x + screenUp.y * r0.y + screenUp.z * r0.z;
    rollDeg = Math.atan2(cr, cu) * R2D;
  }
  return {
    yawDeg: lh.horiz >= LOOK_HORIZ_MIN ? lh.headingDeg : th.headingDeg,
    pitchDeg: pitchOf(look),
    lookHoriz: lh.horiz,
    topHeadingDeg: th.headingDeg,
    topHoriz: th.horiz,
    rollDeg,
  };
}

/**
 * The spec's §A.1 `compassHeading(alpha, beta, gamma)` as written — the heading of the rear camera
 * for ABSOLUTE angles. Kept as the independent cross-check of `poseFromEuler` (the test pins the
 * two against each other over a lattice); the product never calls it.
 */
export function specCompassHeading(alphaDeg: number, betaDeg: number, gammaDeg: number): number {
  const _x = betaDeg * D2R;
  const _y = gammaDeg * D2R;
  const _z = alphaDeg * D2R;
  const cY = Math.cos(_y);
  const cZ = Math.cos(_z);
  const sX = Math.sin(_x);
  const sY = Math.sin(_y);
  const sZ = Math.sin(_z);
  const Vx = -cZ * sY - sZ * sX * cY;
  const Vy = -sZ * sY + cZ * sX * cY;
  let heading = Math.atan(Vx / Vy);
  if (Vy < 0) heading += Math.PI;
  else if (Vx < 0) heading += 2 * Math.PI;
  return heading * R2D;
}

/**
 * A low-pass on a DIRECTION, for the camera: exponential smoothing of the look vector in the
 * Earth frame (no wrap seams — a heading EMA jumps at 0/360, a vector EMA does not) followed by a
 * dead-band with hysteresis, so a hand's tremor (±0.2°) does not shimmer the skyline while a real
 * turn tracks within one time constant. `tauMs` 0 = pass-through.
 */
export class LookSmoother {
  private sx = 0;
  private sy = 0;
  private sz = 0;
  private seeded = false;
  private lastT = 0;
  private outHeading = 0;
  private outPitch = 0;

  constructor(
    private readonly tauMs: number,
    private readonly deadbandDeg: number,
  ) {}

  reset(): void {
    this.seeded = false;
  }

  /** Push a heading/pitch pair (degrees) at time `tMs`; returns the smoothed, dead-banded pair. */
  push(headingDeg: number, pitchDeg: number, tMs: number): { headingDeg: number; pitchDeg: number } {
    const h = headingDeg * D2R;
    const p = pitchDeg * D2R;
    const vx = Math.cos(p) * Math.sin(h);
    const vy = Math.cos(p) * Math.cos(h);
    const vz = Math.sin(p);
    if (!this.seeded) {
      this.sx = vx;
      this.sy = vy;
      this.sz = vz;
      this.seeded = true;
      this.lastT = tMs;
      this.outHeading = wrapDeg360(headingDeg);
      this.outPitch = pitchDeg;
      return { headingDeg: this.outHeading, pitchDeg: this.outPitch };
    }
    const dt = Math.max(0, tMs - this.lastT);
    this.lastT = tMs;
    const k = this.tauMs > 0 ? 1 - Math.exp(-dt / this.tauMs) : 1;
    this.sx += (vx - this.sx) * k;
    this.sy += (vy - this.sy) * k;
    this.sz += (vz - this.sz) * k;
    const sm = { x: this.sx, y: this.sy, z: this.sz };
    const heading = headingOf(sm);
    const pitch = pitchOf(sm);
    // The dead-band: emit only when the smoothed direction has left the last emitted one by more
    // than the band (angular distance, so a heading change at pitch 80° is weighed by cos pitch).
    const dh = circDiffDeg(heading.headingDeg, this.outHeading) * Math.cos(this.outPitch * D2R);
    const dp = pitch - this.outPitch;
    if (Math.hypot(dh, dp) >= this.deadbandDeg) {
      this.outHeading = heading.horiz >= LOOK_HORIZ_MIN ? heading.headingDeg : this.outHeading;
      this.outPitch = pitch;
    }
    return { headingDeg: this.outHeading, pitchDeg: this.outPitch };
  }
}
