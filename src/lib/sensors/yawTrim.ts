/**
 * YAW TRIM (owner order 2026-09-19) — "the image drifts each time you move the phone from side to
 * side, and pretty soon you can't trust your headings": the one filter both platforms' AR rungs
 * now share. Pure, three-free, unit-pinned (`test/lib/sensors/yawTrim.test.ts`).
 *
 * THE DIAGNOSIS (the 2026-09-19 research; DECISIONS 2026-09-19 carries the citations). A phone has
 * two yaw sources with OPPOSITE vices:
 *  · the GYRO-led relative attitude (iOS Core Motion `xArbitraryZVertical`; Android
 *    `TYPE_GAME_ROTATION_VECTOR`, which "MUST NOT use the magnetometer") is smooth and exact over
 *    seconds — a swing comes back to where it started — but has no idea where north is and creeps
 *    by a fraction of a degree per second;
 *  · the COMPASS-led absolute heading (iOS `webkitCompassHeading`; Android `TYPE_ROTATION_VECTOR`)
 *    knows north but LAGS a fast turn, is bent by every steel railing, and re-converges after each
 *    swing — following it directly is what makes an AR view wander.
 * Until today the iOS rung tracked the compass with a 0.8 s EMA (compass-led in all but name) and
 * the Android rung took the magnetometer-fused stream as it came.
 *
 * THE REMEDY is the textbook complementary split (Oculus's "α ≪ 1 so corrections are
 * imperceptible"; Madgwick's β caps the correction at ~2°/s): the relative attitude DRIVES the
 * view; the absolute source only OBSERVES one number — the yaw offset between the two frames —
 * and this class decides how much of each observation to believe:
 *   1. the FIRST fix lands exactly (north is right from the first frame), then a short fast window
 *      refines that one noisy sample;
 *   2. after that the offset moves toward the observations SLOWLY and never faster than a cap the
 *      eye cannot see — it only has to beat the gyro's creep;
 *   3. it is FROZEN while the phone turns fast and for a moment after (the compass lags the turn —
 *      the swing error), and while the observations themselves disagree or slide (the
 *      quasi-static-field test: in a clean field `compass − gyro` is a constant; when it moves
 *      while the phone does not, the FIELD moved);
 *   4. a big disagreement must PERSIST before it is believed, and is then slewed, never jumped;
 *   5. the user's VISUAL calibration is a measured compass bias: the trim target is
 *      `observation + bias`, and once the user has calibrated this session the trim slows again —
 *      their eyes outrank the magnetometer.
 */

import { circDiffDeg, wrapDeg360 } from "./deviceOrientation";

export interface YawTrimOptions {
  /** After the first fix: how long (ms) the fast refine runs, and its EMA time constant. */
  acquireMs: number;
  acquireTauMs: number;
  /** The steady trim: EMA time constant (ms) and the correction-rate cap (deg/s). */
  tauMs: number;
  maxRateDegPerS: number;
  /** …and after a visual calibration THIS session (the offset is known-good; only drift remains). */
  calibratedTauMs: number;
  calibratedMaxRateDegPerS: number;
  /** Angular rate (deg/s) above which the trim freezes; it thaws once the rate has stayed under
   *  `settleRateDegPerS` for `settleMs`. */
  fastRateDegPerS: number;
  settleRateDegPerS: number;
  settleMs: number;
  /** The observation window (ms) the median / spread / slope gates read, and how many samples it
   *  needs before it is believed. */
  windowMs: number;
  minWindowSamples: number;
  /** Disturbance gates: the window's median absolute deviation (deg) and the slide of its median
   *  (deg/s) above which the field is judged disturbed. */
  maxSpreadDeg: number;
  maxSlopeDegPerS: number;
  /** An innovation beyond `jumpDeg` must persist `jumpHoldMs` (longer once calibrated) and is then
   *  slewed at `jumpSlewDegPerS` — all the way down to `jumpDoneDeg` (hysteresis: a slew that
   *  handed back to the slow trim at 20° would take another quarter-minute to finish). */
  jumpDeg: number;
  jumpDoneDeg: number;
  jumpHoldMs: number;
  calibratedJumpHoldMs: number;
  jumpSlewDegPerS: number;
  /** One observation never integrates more than this much time (ms) — a gap is not a giant step. */
  maxStepMs: number;
}

export const YAW_TRIM_DEFAULTS: YawTrimOptions = Object.freeze({
  acquireMs: 1500,
  acquireTauMs: 800,
  tauMs: 8000,
  maxRateDegPerS: 1.5,
  calibratedTauMs: 40_000,
  calibratedMaxRateDegPerS: 0.3,
  fastRateDegPerS: 30,
  settleRateDegPerS: 10,
  settleMs: 400,
  windowMs: 1000,
  minWindowSamples: 5,
  maxSpreadDeg: 4,
  maxSlopeDegPerS: 2,
  jumpDeg: 20,
  jumpDoneDeg: 2,
  jumpHoldMs: 3000,
  calibratedJumpHoldMs: 5000,
  jumpSlewDegPerS: 6,
  maxStepMs: 250,
});

export type YawTrimState = "empty" | "acquiring" | "trimming" | "frozen-rate" | "frozen-field" | "jump-hold" | "jump-slew";

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class YawTrim {
  private opts: YawTrimOptions;
  private offset: number | null = null;
  private bias = 0;
  private calibrated = false;
  private acquiredT = -Infinity;
  private lastObsT = -Infinity;
  private lastFastT = -Infinity;
  private jumpSinceT: number | null = null;
  private slewing = false;
  /** Trim TARGETS (`observation + bias`), newest last. */
  private ring: { t: number; v: number }[] = [];
  private st: YawTrimState = "empty";
  private lastInnovation = 0;
  private lastSpread = 0;

  constructor(opts: Partial<YawTrimOptions> = {}) {
    this.opts = { ...YAW_TRIM_DEFAULTS, ...opts };
  }

  has(): boolean {
    return this.offset !== null;
  }
  /** The trimmed yaw offset, [0, 360); 0 before the first fix. */
  offsetDeg(): number {
    return this.offset ?? 0;
  }
  biasDeg(): number {
    return this.bias;
  }
  isCalibrated(): boolean {
    return this.calibrated;
  }
  state(): YawTrimState {
    return this.st;
  }
  debug(): { state: YawTrimState; offsetDeg: number; biasDeg: number; innovationDeg: number; spreadDeg: number; calibrated: boolean } {
    return {
      state: this.st,
      offsetDeg: this.offsetDeg(),
      biasDeg: this.bias,
      innovationDeg: this.lastInnovation,
      spreadDeg: this.lastSpread,
      calibrated: this.calibrated,
    };
  }

  /** Forget the learned offset (the sensors stopped, the frame may have re-seeded) — the next
   *  observation lands exactly again. The user's bias and the calibrated flag SURVIVE: they are
   *  facts about the compass, not about this frame. */
  reacquire(): void {
    this.offset = null;
    this.ring = [];
    this.acquiredT = -Infinity;
    this.lastObsT = -Infinity;
    this.lastFastT = -Infinity;
    this.jumpSinceT = null;
    this.slewing = false;
    this.st = "empty";
  }

  /** Everything learned this session, the calibrated flag included (AR switched off). */
  reset(): void {
    this.reacquire();
    this.calibrated = false;
  }

  /**
   * A stored calibration arrived / was RESET: the target moves by the change and so does the
   * offset, at once — a bias is not something to ease toward.
   */
  setBias(biasDeg: number): void {
    const next = circDiffDeg(Number.isFinite(biasDeg) ? biasDeg : 0, 0);
    const d = circDiffDeg(next, this.bias);
    if (d === 0) return;
    if (this.offset !== null) this.offset = wrapDeg360(this.offset + d);
    for (const r of this.ring) r.v = wrapDeg360(r.v + d);
    this.bias = next;
    this.jumpSinceT = null;
  }

  /**
   * The user dragged the view by `deltaDeg` against the camera feed and CONFIRMED: the view is
   * now TRUTH. The offset takes the drag whole; the bias becomes whatever makes the compass's
   * CURRENT reading agree with it (`offset − median(observations)`) — not merely `bias + delta`,
   * because a trim that had not finished converging would otherwise keep pulling the calibrated
   * view for the next τ. Returns the new bias (the number to persist).
   */
  commit(deltaDeg: number, tMs: number): number {
    const d = Number.isFinite(deltaDeg) ? deltaDeg : 0;
    if (this.offset === null) {
      // Nothing observed yet: the bias just carries the drag.
      this.bias = circDiffDeg(this.bias + d, 0);
      this.calibrated = true;
      return this.bias;
    }
    this.offset = wrapDeg360(this.offset + d);
    const fresh = this.ring.filter((r) => tMs - r.t <= this.opts.windowMs);
    let next: number;
    if (fresh.length >= this.opts.minWindowSamples) {
      // median of the RAW observations, taken about the offset so the wrap seam cannot split it
      const rawAboutOffset = median(fresh.map((r) => circDiffDeg(r.v - this.bias, this.offset!)));
      next = circDiffDeg(0, rawAboutOffset); // bias = offset − medianObs
    } else {
      next = circDiffDeg(this.bias + d, 0);
    }
    const shift = circDiffDeg(next, this.bias);
    for (const r of this.ring) r.v = wrapDeg360(r.v + shift);
    this.bias = next;
    this.calibrated = true;
    this.jumpSinceT = null;
    return this.bias;
  }

  /**
   * One observation of the yaw offset between the driving (relative) frame and magnetic north,
   * with the phone's angular rate at that moment. Returns the (possibly unchanged) offset.
   */
  observe(obsDeg: number, tMs: number, rateDegPerS: number): number {
    const o = this.opts;
    if (!Number.isFinite(obsDeg) || !Number.isFinite(tMs)) return this.offsetDeg();
    const rate = Number.isFinite(rateDegPerS) ? Math.abs(rateDegPerS) : 0;
    const target = wrapDeg360(obsDeg + this.bias);
    if (rate > o.fastRateDegPerS) this.lastFastT = tMs;
    this.ring.push({ t: tMs, v: target });
    while (this.ring.length && tMs - this.ring[0].t > o.windowMs) this.ring.shift();

    if (this.offset === null) {
      this.offset = target; // 1. the first fix lands exactly
      this.acquiredT = tMs;
      this.lastObsT = tMs;
      this.st = "acquiring";
      return this.offset;
    }
    const dtMs = Math.min(o.maxStepMs, Math.max(0, tMs - this.lastObsT));
    this.lastObsT = tMs;

    if (tMs - this.acquiredT < o.acquireMs) {
      const k = o.acquireTauMs > 0 ? 1 - Math.exp(-dtMs / o.acquireTauMs) : 1;
      this.offset = wrapDeg360(this.offset + circDiffDeg(target, this.offset) * k);
      this.st = "acquiring";
      return this.offset;
    }

    // 3a. the rate gate — the compass lags a turn; believe nothing until the phone has settled.
    if (rate > o.settleRateDegPerS || tMs - this.lastFastT < o.settleMs) {
      this.st = "frozen-rate";
      this.jumpSinceT = null;
      this.slewing = false;
      return this.offset;
    }
    if (this.ring.length < o.minWindowSamples) {
      this.st = "frozen-field";
      return this.offset;
    }
    // Innovations about the CURRENT offset (no wrap seam inside the window).
    const inn = this.ring.map((r) => circDiffDeg(r.v, this.offset!));
    const m = median(inn);
    const spread = median(inn.map((x) => Math.abs(x - m)));
    const half = this.ring.length >> 1;
    const tA = median(this.ring.slice(0, half).map((r) => r.t));
    const tB = median(this.ring.slice(half).map((r) => r.t));
    const slope = tB > tA ? ((median(inn.slice(half)) - median(inn.slice(0, half))) / (tB - tA)) * 1000 : 0;
    this.lastInnovation = m;
    this.lastSpread = spread;
    // 3b. the quasi-static-field gate.
    if (spread > o.maxSpreadDeg || Math.abs(slope) > o.maxSlopeDegPerS) {
      this.st = "frozen-field";
      this.jumpSinceT = null;
      this.slewing = false;
      return this.offset;
    }
    const dtS = dtMs / 1000;
    if (this.slewing && Math.abs(m) <= o.jumpDoneDeg) this.slewing = false;
    if (!this.slewing && Math.abs(m) <= o.jumpDeg) {
      // 2. the slow trim, rate-capped.
      this.jumpSinceT = null;
      const tau = this.calibrated ? o.calibratedTauMs : o.tauMs;
      const cap = (this.calibrated ? o.calibratedMaxRateDegPerS : o.maxRateDegPerS) * dtS;
      const k = tau > 0 ? 1 - Math.exp(-dtMs / tau) : 1;
      const step = Math.max(-cap, Math.min(cap, m * k));
      this.offset = wrapDeg360(this.offset + step);
      this.st = "trimming";
      return this.offset;
    }
    // 4. a big disagreement: hold, then slew.
    if (this.jumpSinceT === null) this.jumpSinceT = tMs;
    const hold = this.calibrated ? o.calibratedJumpHoldMs : o.jumpHoldMs;
    if (!this.slewing && tMs - this.jumpSinceT < hold) {
      this.st = "jump-hold";
      return this.offset;
    }
    this.slewing = true;
    const slew = o.jumpSlewDegPerS * dtS;
    this.offset = wrapDeg360(this.offset + Math.max(-slew, Math.min(slew, m)));
    this.st = "jump-slew";
    return this.offset;
  }
}
