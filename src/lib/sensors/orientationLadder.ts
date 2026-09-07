/**
 * The AR look-around DEGRADATION LADDER (owner order 2026-09-07g), as a pure state machine over
 * raw `deviceorientation` samples. The engine module `scene/arLook.ts` owns the listeners and the
 * permission; this file owns WHICH rung a sample lands on and what heading it yields, so the whole
 * ladder is unit-pinned without a browser. Every rung's premise is cited in DECISIONS 2026-09-07h
 * (the 2026-09-07 research: WebKit source, Chromium source, the W3C specs, Apple's docs).
 *
 * THE RUNGS, best first:
 *
 *  1. `android-absolute` — Chromium's `deviceorientationabsolute` (Chrome 50+, Firefox 110+): α, β,
 *     γ in the Earth frame whose Y is MAGNETIC north (Android `TYPE_ROTATION_VECTOR`; Chromium
 *     applies no declination — verified in `platform_sensor_android.cc` / `orientation_util.cc`).
 *     Heading = the pose's yaw + declination. No calibration, no drift.
 *  2. `ios-compass` — WebKit fires `deviceorientation` only, with α RELATIVE to the orientation the
 *     motion service started in (Core Motion `xArbitraryZVertical`, no magnetometer correction →
 *     drifts) plus `webkitCompassHeading`, the MAGNETIC heading of the device's TOP EDGE (Core
 *     Location's default `headingOrientation`), and `webkitCompassAccuracy` (degrees; negative =
 *     invalid). The two are fused: the relative frame differs from magnetic ENU by ONE yaw offset,
 *     learned as `compassHeading − topHeadingRel` whenever the compass is trustworthy AND the top
 *     edge has a defined ground heading (`topHoriz ≥ compassMinTopHoriz` — held upright, the top
 *     points at the sky and the compass says nothing about yaw). The offset is EMA-tracked so gyro
 *     drift is re-absorbed each time the phone dips; while it holds, the gyro carries. Heading =
 *     yawRel + offset + declination. UNVERIFIED on a real iPhone which tilt the compass stays
 *     usable at (the gate is the conservative bet; the device pass will tune it).
 *  3. `relative-aligned` — no compass at all (Firefox/Android without absolute, a WebKit whose
 *     compass reads invalid): the user ALIGNS once — "point the phone where the camera looks, tap"
 *     — which sets the yaw offset so the current pose maps to the current camera heading. Drifts
 *     with the gyro; re-align on demand.
 *  4. `relative-unaligned` — samples flow but no offset is known: turning the phone turns the
 *     camera by the right AMOUNT from wherever it was (the offset is seeded from the camera's own
 *     heading at arming), so the mode is useful immediately and the ALIGN chip makes it exact.
 *
 * Below the ladder (no samples, permission denied, no sensors) the engine reports and stays off;
 * that state never reaches this file.
 */

import { circDiffDeg, poseFromEuler, wrapDeg360, type DevicePose } from "./deviceOrientation";

export type ArRung = "android-absolute" | "ios-compass" | "relative-aligned" | "relative-unaligned";

export interface RawOrientationSample {
  tMs: number;
  alphaDeg: number | null;
  betaDeg: number | null;
  gammaDeg: number | null;
  /** The event's `absolute` (Chromium's `deviceorientationabsolute` → true). WebKit leaves it
   *  undefined; the engine passes `false`. */
  absolute: boolean;
  /** iOS only: `webkitCompassHeading` (magnetic, clockwise, of the top edge) — null elsewhere. WebKit
   *  reports 0 with accuracy −1 when the heading is unavailable (the simulator, no fix yet). */
  compassHeadingDeg?: number | null;
  /** iOS only: `webkitCompassAccuracy` — ± degrees, negative = unreliable/invalid. */
  compassAccuracyDeg?: number | null;
  /** `screen.orientation.angle` at the sample (roll only). */
  screenAngleDeg?: number;
}

export interface ArAim {
  /** TRUE heading of the rear camera, degrees clockwise from true north, [0, 360). */
  headingDeg: number;
  /** Elevation of the rear camera above the horizon, [−90, 90]. */
  pitchDeg: number;
  rollDeg: number;
  rung: ArRung;
  /** ms since the last compass sample that was ACCEPTED into the yaw offset (Infinity = never). */
  compassAgeMs: number;
  /** The learned/aligned yaw offset (degrees) between the sample frame and magnetic ENU — 0 on the
   *  absolute rung. Exposed for the DBG chip and the harness. */
  yawOffsetDeg: number;
  /** The raw pose the aim was derived from. */
  pose: DevicePose;
}

export interface OrientationLadderOptions {
  /** WMM declination at the pose, degrees east-positive: `true = magnetic + declination`. */
  declinationDeg: number;
  /** A compass sample with `webkitCompassAccuracy` above this (degrees) is not trusted. AR.js uses
   *  50; PLUX tightens (the DBG chip shows the live value so the device pass can tune it). */
  compassMaxAccuracyDeg: number;
  /** The top edge's horizontal magnitude below which its heading is ill-conditioned (upright phone). */
  compassMinTopHoriz: number;
  /** EMA time constant (ms) for the yaw offset learned from the compass. */
  compassOffsetTauMs: number;
  /** An absolute sample this recent (ms) makes a relative one be ignored — Chromium fires both
   *  event streams; never mix their frames. */
  absoluteHoldMs: number;
}

export const ORIENTATION_LADDER_DEFAULTS: OrientationLadderOptions = Object.freeze({
  declinationDeg: 0,
  compassMaxAccuracyDeg: 25,
  compassMinTopHoriz: 0.35,
  compassOffsetTauMs: 800,
  absoluteHoldMs: 500,
});

export class OrientationLadder {
  private opts: OrientationLadderOptions;
  private yawOffsetDeg = 0;
  private offsetKind: "none" | "seed" | "aligned" | "compass" = "none";
  private lastCompassT = -Infinity;
  private lastAbsoluteT = -Infinity;
  private lastAim: ArAim | null = null;

  constructor(opts: Partial<OrientationLadderOptions> = {}) {
    this.opts = { ...ORIENTATION_LADDER_DEFAULTS, ...opts };
  }

  setDeclination(declinationDeg: number): void {
    this.opts = { ...this.opts, declinationDeg };
  }

  /** The last aim, or null before the first accepted sample. */
  aim(): ArAim | null {
    return this.lastAim;
  }

  /**
   * Seed the yaw offset so that the CURRENT pose maps to `cameraHeadingTrueDeg` — rung 3's ALIGN
   * (and the arming seed of rung 4, which marks it `seed` rather than `aligned` so the UI can still
   * ask for an explicit align). A compass sample accepted later overrides either.
   */
  align(cameraHeadingTrueDeg: number, explicit: boolean): void {
    const pose = this.lastAim?.pose;
    if (!pose) return;
    // headingTrue = yawRel + offset + declination  ⇒  offset = headingTrue − declination − yawRel
    this.yawOffsetDeg = wrapDeg360(cameraHeadingTrueDeg - this.opts.declinationDeg - pose.yawDeg);
    this.offsetKind = explicit ? "aligned" : "seed";
    const last = this.lastAim!;
    this.lastAim = this.compose(pose, last.rung === "android-absolute", last.compassAgeMs);
  }

  /** Forget everything learned (the toggle turned off, FPV exited). */
  reset(): void {
    this.yawOffsetDeg = 0;
    this.offsetKind = "none";
    this.lastCompassT = -Infinity;
    this.lastAbsoluteT = -Infinity;
    this.lastAim = null;
  }

  /** Feed one raw sample; returns the aim it yields, or null when the sample is unusable. */
  push(s: RawOrientationSample): ArAim | null {
    if (s.alphaDeg == null || s.betaDeg == null || s.gammaDeg == null) return null;
    if (!Number.isFinite(s.alphaDeg) || !Number.isFinite(s.betaDeg) || !Number.isFinite(s.gammaDeg)) return null;
    if (s.absolute) this.lastAbsoluteT = s.tMs;
    else if (s.tMs - this.lastAbsoluteT < this.opts.absoluteHoldMs) return this.lastAim; // an absolute stream is live — do not mix frames
    const pose = poseFromEuler(s.alphaDeg, s.betaDeg, s.gammaDeg, s.screenAngleDeg ?? 0);

    if (s.absolute) {
      // Rung 1: the sample frame IS magnetic ENU.
      this.yawOffsetDeg = 0;
      this.offsetKind = "compass"; // an absolute frame counts as "north is known"
      this.lastAim = this.compose(pose, true, Infinity);
      return this.lastAim;
    }

    // Rung 2: learn the yaw offset from the compass when it is trustworthy and well-conditioned.
    const ch = s.compassHeadingDeg;
    const acc = s.compassAccuracyDeg;
    const compassValid =
      ch != null &&
      Number.isFinite(ch) &&
      acc != null &&
      Number.isFinite(acc) &&
      acc >= 0 &&
      acc <= this.opts.compassMaxAccuracyDeg &&
      !(ch === 0 && acc === -1); // WebKit's "no heading" combo (accuracy −1 already fails above; belt and braces)
    if (compassValid && pose.topHoriz >= this.opts.compassMinTopHoriz) {
      const observed = wrapDeg360(ch - pose.topHeadingDeg);
      if (this.offsetKind !== "compass" || !Number.isFinite(this.lastCompassT)) {
        this.yawOffsetDeg = observed; // first compass fix lands exactly
      } else {
        const dt = Math.max(0, s.tMs - this.lastCompassT);
        const k = this.opts.compassOffsetTauMs > 0 ? 1 - Math.exp(-dt / this.opts.compassOffsetTauMs) : 1;
        this.yawOffsetDeg = wrapDeg360(this.yawOffsetDeg + circDiffDeg(observed, this.yawOffsetDeg) * k);
      }
      this.offsetKind = "compass";
      this.lastCompassT = s.tMs;
    }
    const compassAge = Number.isFinite(this.lastCompassT) ? s.tMs - this.lastCompassT : Infinity;
    this.lastAim = this.compose(pose, false, compassAge);
    return this.lastAim;
  }

  private compose(pose: DevicePose, absolute: boolean, compassAgeMs: number): ArAim {
    const rung: ArRung = absolute
      ? "android-absolute"
      : this.offsetKind === "compass"
        ? "ios-compass"
        : this.offsetKind === "aligned"
          ? "relative-aligned"
          : "relative-unaligned";
    return {
      headingDeg: wrapDeg360(pose.yawDeg + this.yawOffsetDeg + this.opts.declinationDeg),
      pitchDeg: pose.pitchDeg,
      rollDeg: pose.rollDeg,
      rung,
      compassAgeMs,
      yawOffsetDeg: this.yawOffsetDeg,
      pose,
    };
  }
}
