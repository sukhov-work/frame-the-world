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
 *     SINCE 2026-09-19 the rung is GYRO-LED whenever Chromium's RELATIVE stream is live beside it
 *     (`deviceorientation` = `TYPE_GAME_ROTATION_VECTOR`, which "must not use the magnetometer"):
 *     the relative pose DRIVES the view and each absolute sample only OBSERVES the yaw offset
 *     between the two gravity-aligned frames, which `YawTrim` believes slowly, rate-capped, and
 *     not at all while the phone swings or the field is disturbed (`lib/sensors/yawTrim.ts` — the
 *     owner's "it drifts each time you move the phone from side to side"). With no relative
 *     stream (Firefox, a phone without a game rotation vector) the absolute pose is taken as it
 *     comes, exactly as before. Heading = yaw + offset + declination.
 *  2. `ios-compass` — WebKit fires `deviceorientation` only, with α RELATIVE to the orientation the
 *     motion service started in (Core Motion `xArbitraryZVertical`, no magnetometer correction →
 *     drifts) plus `webkitCompassHeading`, the MAGNETIC heading of the device's TOP EDGE (Core
 *     Location's default `headingOrientation`), and `webkitCompassAccuracy` (degrees; negative =
 *     invalid). The two are fused: the relative frame differs from magnetic ENU by ONE yaw offset,
 *     learned as `compassHeading − topHeadingRel` whenever the compass is trustworthy AND the top
 *     edge has a defined ground heading (`topHoriz ≥ compassMinTopHoriz` — held upright, the top
 *     points at the sky and the compass says nothing about yaw) AND the screen faces the sky
 *     (`screenUp ≥ compassMinScreenUp`: tipped back past vertical, "the top edge's heading" and
 *     "the camera's heading" are 180° apart and it is UNVERIFIED which one Core Location reports —
 *     below vertical they are the same number, so the gate makes the question moot). The offset is
 *     `YawTrim`'s (2026-09-19; it was a 0.8 s EMA — compass-led in all but name): gyro drift is
 *     re-absorbed each time the phone dips, slowly; while it holds, the gyro carries. Heading =
 *     yawRel + offset + declination.
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

import { circDiffDeg, deviceToEarth, poseFromEuler, wrapDeg360, type DevicePose } from "./deviceOrientation";
import { YawTrim, type YawTrimOptions, type YawTrimState } from "./yawTrim";

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
  /** Rung 1 only: true while the RELATIVE stream drives and the absolute one only trims. */
  fused: boolean;
  /** What the yaw trim is doing (the DBG chip / the harness). */
  trim: YawTrimState;
}

export interface OrientationLadderOptions {
  /** WMM declination at the pose, degrees east-positive: `true = magnetic + declination`. */
  declinationDeg: number;
  /** A compass sample with `webkitCompassAccuracy` above this (degrees) is not trusted. AR.js uses
   *  50; PLUX tightens (the DBG chip shows the live value so the device pass can tune it). */
  compassMaxAccuracyDeg: number;
  /** The top edge's horizontal magnitude below which its heading is ill-conditioned (upright phone). */
  compassMinTopHoriz: number;
  /** The screen normal's up-component (device +z · world up: 1 flat on a table, 0 upright, < 0
   *  tipped back) below which an iOS compass sample is ignored. −1 disables the gate. */
  compassMinScreenUp: number;
  /** The STEADY time constant (ms) of the yaw trim — `YawTrim.tauMs` (it was the whole filter
   *  until 2026-09-19; the name is kept for the tunable's sake). */
  compassOffsetTauMs: number;
  /** An absolute sample this recent (ms) means the absolute stream is LIVE: a relative sample
   *  then either drives the fused rung or — before the first pairing — is held back. Chromium
   *  fires both event streams; their frames are never mixed without the trimmed offset. */
  absoluteHoldMs: number;
  /** An absolute and a relative sample at most this far apart (ms) are one observation. */
  pairMaxMs: number;
  /** No sample of the driving frame for this long (ms) ⇒ the frame may have re-seeded (the page
   *  was hidden, Core Motion restarted): the trim re-acquires on the next observation. */
  reacquireGapMs: number;
  /** The angular-rate EMA (ms) the trim's rate gate reads. */
  rateTauMs: number;
  /** Everything else about the trim (`YAW_TRIM_DEFAULTS`). */
  trim: Partial<YawTrimOptions>;
}

export const ORIENTATION_LADDER_DEFAULTS: OrientationLadderOptions = Object.freeze({
  declinationDeg: 0,
  compassMaxAccuracyDeg: 25,
  compassMinTopHoriz: 0.35,
  compassMinScreenUp: 0.2,
  compassOffsetTauMs: 8000,
  absoluteHoldMs: 500,
  pairMaxMs: 50,
  reacquireGapMs: 1000,
  rateTauMs: 150,
  trim: Object.freeze({}),
});

/** Which frame the trimmed offset is expressed in: the absolute stream taken as it comes
 *  (`abs` — the observation is identically 0, the offset IS the user's bias) or the gyro-led
 *  relative frame (`rel` — Android fused, iOS compass). A change of frame re-acquires. */
type TrimFrame = "none" | "abs" | "rel";

export class OrientationLadder {
  private opts: OrientationLadderOptions;
  private trim: YawTrim;
  private trimFrame: TrimFrame = "none";
  /** Rungs 3/4: the offset the user ALIGNED (or the engine seeded) — no compass involved. */
  private alignOffsetDeg = 0;
  private alignKind: "none" | "seed" | "aligned" = "none";
  private lastCompassT = -Infinity;
  private lastAbsoluteT = -Infinity;
  private lastRel: { pose: DevicePose; tMs: number } | null = null;
  private rateDegPerS = 0;
  private ratePrev: { pose: DevicePose; tMs: number; absolute: boolean } | null = null;
  private lastAim: ArAim | null = null;

  constructor(opts: Partial<OrientationLadderOptions> = {}) {
    this.opts = { ...ORIENTATION_LADDER_DEFAULTS, ...opts };
    this.trim = new YawTrim({ tauMs: this.opts.compassOffsetTauMs, ...this.opts.trim });
  }

  setDeclination(declinationDeg: number): void {
    this.opts = { ...this.opts, declinationDeg };
  }

  /** The last aim, or null before the first accepted sample. */
  aim(): ArAim | null {
    return this.lastAim;
  }

  /** The stored visual calibration's yaw (`lib/sensors/arCalibration.ts`) — a measured COMPASS
   *  BIAS, so it lives where the compass is believed: inside the trim's target. It therefore
   *  never touches the relative rungs, whose yaw is the user's own ALIGN. Applied at once. */
  setUserBias(biasDeg: number): void {
    if (circDiffDeg(biasDeg, this.trim.biasDeg()) === 0) return;
    this.trim.setBias(biasDeg);
    this.recompose();
  }

  userBiasDeg(): number {
    return this.trim.biasDeg();
  }

  /**
   * CONFIRM in calibration mode: the user dragged the view `deltaYawDeg` against the live camera.
   * On a compass rung the trim takes it and answers the NEW bias to persist; on a relative rung
   * there is no compass to be biased — the drag folds into the alignment (it IS an ALIGN, done by
   * eye) and null says "keep the stored bias as it was".
   */
  commitCalibration(deltaYawDeg: number, tMs: number): number | null {
    const d = Number.isFinite(deltaYawDeg) ? deltaYawDeg : 0;
    if (this.trimFrame !== "none" && this.trim.has()) {
      const bias = this.trim.commit(d, tMs);
      this.recompose();
      return bias;
    }
    this.alignOffsetDeg = wrapDeg360(this.alignOffsetDeg + d);
    this.alignKind = "aligned";
    this.recompose();
    return null;
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
    this.alignOffsetDeg = wrapDeg360(cameraHeadingTrueDeg - this.opts.declinationDeg - pose.yawDeg);
    this.alignKind = explicit ? "aligned" : "seed";
    this.recompose();
  }

  /** Forget everything learned (the toggle turned off, FPV exited). The user's bias is not
   *  something learned — it survives (`YawTrim.reset` keeps it). */
  reset(): void {
    this.trim.reset();
    this.trimFrame = "none";
    this.alignOffsetDeg = 0;
    this.alignKind = "none";
    this.lastCompassT = -Infinity;
    this.lastAbsoluteT = -Infinity;
    this.lastRel = null;
    this.rateDegPerS = 0;
    this.ratePrev = null;
    this.lastAim = null;
  }

  /** The trim's live state (the DBG chip / the harness). */
  trimDebug(): ReturnType<YawTrim["debug"]> & { frame: TrimFrame; rateDegPerS: number } {
    return { ...this.trim.debug(), frame: this.trimFrame, rateDegPerS: this.rateDegPerS };
  }

  /** Feed one raw sample; returns the aim it yields, or null when the sample is unusable. */
  push(s: RawOrientationSample): ArAim | null {
    if (s.alphaDeg == null || s.betaDeg == null || s.gammaDeg == null) return null;
    if (!Number.isFinite(s.alphaDeg) || !Number.isFinite(s.betaDeg) || !Number.isFinite(s.gammaDeg)) return null;
    const pose = poseFromEuler(s.alphaDeg, s.betaDeg, s.gammaDeg, s.screenAngleDeg ?? 0);

    if (s.absolute) {
      this.lastAbsoluteT = s.tMs;
      const rel = this.lastRel;
      if (rel && Math.abs(s.tMs - rel.tMs) <= this.opts.pairMaxMs) {
        // Rung 1, GYRO-LED: both frames are gravity-aligned, so they differ by ONE yaw — this
        // pairing observes it. The relative sample drives (below); this one only trims.
        this.useTrimFrame("rel");
        this.trim.observe(wrapDeg360(pose.yawDeg - rel.pose.yawDeg), s.tMs, this.rateDegPerS);
        if (this.lastAim?.fused) return this.lastAim; // the relative stream is already driving
        this.lastAim = this.compose(rel.pose, true, Infinity);
        return this.lastAim;
      }
      if (this.trimFrame === "rel" && this.trim.has() && rel && s.tMs - rel.tMs <= this.opts.absoluteHoldMs) {
        return this.lastAim; // fused, and the relative stream is merely between samples
      }
      // Rung 1, DIRECT: no relative stream beside it — the sample frame IS magnetic ENU and the
      // only offset is the user's bias (the observation is identically 0).
      this.trackRate(pose, s.tMs, true);
      this.useTrimFrame("abs");
      this.trim.observe(0, s.tMs, this.rateDegPerS);
      this.lastAim = this.compose(pose, true, Infinity);
      return this.lastAim;
    }

    // ── a RELATIVE sample ──
    const prevRel = this.lastRel;
    if (prevRel && s.tMs - prevRel.tMs > this.opts.reacquireGapMs && this.trimFrame === "rel") {
      this.trim.reacquire(); // the frame may have re-seeded while the page slept
      this.lastCompassT = -Infinity;
    }
    this.lastRel = { pose, tMs: s.tMs };
    const absoluteLive = s.tMs - this.lastAbsoluteT < this.opts.absoluteHoldMs;
    if (absoluteLive) {
      if (this.trimFrame === "rel" && this.trim.has()) {
        this.trackRate(pose, s.tMs, false);
        this.lastAim = this.compose(pose, true, Infinity);
        return this.lastAim;
      }
      return this.lastAim; // an absolute stream is live and not yet paired — do not mix frames
    }
    this.trackRate(pose, s.tMs, false);
    if (this.trimFrame === "abs") this.useTrimFrame("none"); // the absolute stream died un-fused

    // Rung 2: observe the yaw offset from the compass when it is trustworthy and well-conditioned.
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
    if (compassValid && pose.topHoriz >= this.opts.compassMinTopHoriz && this.screenUp(s) >= this.opts.compassMinScreenUp) {
      this.useTrimFrame("rel");
      this.trim.observe(wrapDeg360(ch - pose.topHeadingDeg), s.tMs, this.rateDegPerS);
      this.lastCompassT = s.tMs;
    }
    const compassAge = Number.isFinite(this.lastCompassT) ? s.tMs - this.lastCompassT : Infinity;
    this.lastAim = this.compose(pose, false, compassAge);
    return this.lastAim;
  }

  /** Device +z (out of the screen, toward the user) · world up. */
  private screenUp(s: RawOrientationSample): number {
    return deviceToEarth(s.alphaDeg!, s.betaDeg!, s.gammaDeg!, { x: 0, y: 0, z: 1 }).z;
  }

  private useTrimFrame(f: TrimFrame): void {
    if (this.trimFrame === f) return;
    this.trimFrame = f;
    this.trim.reacquire();
  }

  /** The phone's angular rate (deg/s), EMA'd — from consecutive poses of ONE stream. */
  private trackRate(pose: DevicePose, tMs: number, absolute: boolean): void {
    const p = this.ratePrev;
    this.ratePrev = { pose, tMs, absolute };
    if (!p || p.absolute !== absolute) return;
    const dt = tMs - p.tMs;
    if (!(dt > 0) || dt > this.opts.reacquireGapMs) return;
    const cosP = Math.cos((pose.pitchDeg * Math.PI) / 180);
    const inst =
      (Math.hypot(circDiffDeg(pose.yawDeg, p.pose.yawDeg) * cosP, pose.pitchDeg - p.pose.pitchDeg, circDiffDeg(pose.rollDeg, p.pose.rollDeg)) /
        dt) *
      1000;
    const k = this.opts.rateTauMs > 0 ? 1 - Math.exp(-dt / this.opts.rateTauMs) : 1;
    this.rateDegPerS += (inst - this.rateDegPerS) * k;
  }

  private recompose(): void {
    const last = this.lastAim;
    if (last) this.lastAim = this.compose(last.pose, last.rung === "android-absolute", last.compassAgeMs);
  }

  private compose(pose: DevicePose, absolute: boolean, compassAgeMs: number): ArAim {
    const trimmed = this.trimFrame !== "none" && this.trim.has();
    const offset = trimmed ? this.trim.offsetDeg() : this.alignOffsetDeg;
    const rung: ArRung = absolute
      ? "android-absolute"
      : trimmed
        ? "ios-compass"
        : this.alignKind === "aligned"
          ? "relative-aligned"
          : "relative-unaligned";
    return {
      headingDeg: wrapDeg360(pose.yawDeg + offset + this.opts.declinationDeg),
      pitchDeg: pose.pitchDeg,
      rollDeg: pose.rollDeg,
      rung,
      compassAgeMs,
      yawOffsetDeg: offset,
      pose,
      fused: absolute && this.trimFrame === "rel",
      trim: this.trim.state(),
    };
  }
}
