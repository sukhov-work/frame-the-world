/**
 * AR LOOK-AROUND (owner order 2026-09-07g) — in mobile FPV, the phone's physical orientation aims
 * the virtual camera: point the phone north-east and up, the camera looks north-east and up.
 *
 * THE SEAM. The mobile shell (`components/mobile/FpvControls.tsx`) owns the toggle and the
 * permission — `DeviceOrientationEvent.requestPermission()` must be called SYNCHRONOUSLY inside
 * the tap (WebKit checks `processingUserGesture`, not a time window) — and writes ONE boolean into
 * `store/camera.arLook`. THIS module owns the listeners and the math: it attaches
 * `deviceorientationabsolute` + `deviceorientation` while `arLook && fpvActive`, feeds every sample
 * to the pure ladder (`lib/sensors/orientationLadder`), and hands the orchestrator a per-frame
 * `aim()` — an `{ azDeg, altDeg }` in the `#f=` convention (degrees clockwise from TRUE north,
 * elevation above the horizon) that `stepFpvPose` consumes exactly like the TRACKING lock's
 * `skyTrackAim`: a closure value read at 60 fps, never a store write (iOS delivers ~60 samples/s
 * with no change dedup; the store mirror below runs at the HUD cadence).
 *
 * TRUE NORTH is the WMM's job: every platform compass is magnetic (`lib/geo/wmm.ts`), and the
 * declination is evaluated at the FPV eye and refreshed when it moves.
 *
 * THE DEGRADATION LADDER is `lib/sensors/orientationLadder.ts` (rungs 1–4, cited there). Below it:
 * no samples within `FPV.arSampleStaleMs` → `aim()` is null, the look-drag works again, and the
 * mirror says `stale` so the chip can say "NO SENSOR DATA — IS MOTION ACCESS ON?".
 *
 * VISUAL CALIBRATION (owner order 2026-09-19 — `lib/sensors/arCalibration.ts`). The stored
 * calibration arrives on `update(ctx)` like every other request: its YAW is a compass bias and goes
 * INTO the ladder's trim (`setUserBias` — so it never touches the relative rungs, whose yaw is the
 * user's own ALIGN); its PITCH is added to the aim here, after the smoother. While the user is
 * calibrating, the DRAFT yaw delta rides on top of the aim so the view follows their finger; on
 * CONFIRM (`calCommitEpoch`) the ladder commits it and this module answers the bias to persist
 * through the pushed `calibrated` writer. The seed and ⌖ ALIGN subtract the draft delta from the
 * camera heading they are given — the camera already includes it, and an align that did not would
 * jump the view by it. ROLL is smoothed here and read per frame by the camera overlay (`roll()`).
 *
 * C4: this attaches in the island (`StylizedTiles`), never at SSR — `window` is touched only in
 * `update()` on the rising edge.
 */

import { declinationDeg, decimalYear } from "../../../lib/geo/wmm";
import { applyArCalibration, smoothRollDeg } from "../../../lib/sensors/arCalibration";
import { LookSmoother, wrapDeg360 } from "../../../lib/sensors/deviceOrientation";
import { OrientationLadder, type ArAim, type ArRung } from "../../../lib/sensors/orientationLadder";
import type { ArLookState } from "../../../store/camera";
import { FPV } from "../tuning";

export interface ArLookCtx {
  /** `store/camera.arLook` — the toggle. */
  enabled: boolean;
  fpvActive: boolean;
  /** The FPV eye's geodetic position — the WMM is evaluated here. */
  latDeg: number;
  lonDeg: number;
  /** The camera's CURRENT true heading — the seed for the relative rungs and the ALIGN target. */
  cameraHeadingDeg: number;
  /** `store/camera.arAlignEpoch` — bumped by the ALIGN chip; each new value aligns once. */
  alignEpoch: number;
  /** The STORED visual calibration: yaw = the compass bias, pitch = added to the aim (deg). */
  calBiasYawDeg: number;
  calPitchDeg: number;
  /** Calibration mode's live drag (deg, 0 outside it): rides on top of the aim until CONFIRM. */
  calDraftYawDeg: number;
  /** `store/camera.arCalCommitEpoch` — CONFIRM; each new value commits the draft once. */
  calCommitEpoch: number;
  nowMs: number;
  frameCount: number;
}

export interface ArLookHandle {
  update(ctx: ArLookCtx): void;
  /** The aim for THIS frame, or null when AR is off, not in FPV, or the sensors went quiet. */
  aim(): { azDeg: number; altDeg: number } | null;
  /** True while `aim()` is non-null — the FPV look-drag and the aim stick's heading stand down. */
  live(): boolean;
  /** The phone's smoothed roll about the look axis (deg, + = clockwise), 0 while not live — the
   *  camera overlay counter-rotates its `<video>` by it (the FPV camera has no roll seam). */
  roll(): number;
  dispose(): void;
  debug(): {
    attached: boolean;
    samples: number;
    absoluteSamples: number;
    compassSamples: number;
    lastSampleAgeMs: number;
    declinationDeg: number;
    aim: ArAim | null;
    smoothed: { headingDeg: number; pitchDeg: number } | null;
    rollDeg: number;
    trim: ReturnType<OrientationLadder["trimDebug"]>;
    cal: { biasYawDeg: number; pitchDeg: number; draftYawDeg: number };
  };
}

/** The DOM event, with WebKit's two extras (typed locally — lib.dom has no iOS fields). */
interface OrientationEventLike extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

const screenAngleDeg = (): number => {
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  const w = (typeof window !== "undefined" ? (window as unknown as { orientation?: number }).orientation : undefined) ?? 0;
  return ((w % 360) + 360) % 360;
};

export interface ArLookOpts {
  /** The store mirror's writer (`useCameraStore.getState()._syncArLook`), PUSHED in by the
   *  orchestrator: scene modules never value-import a store (`fences.test.ts`
   *  "mirror-never-seats"); the request half (`arLook`, `arAlignEpoch`) arrives on `update(ctx)`. */
  mirror: (state: ArLookState | null) => void;
  /** CONFIRM's answer, pushed the same way: the compass bias to persist, or null when the rung
   *  had no compass to bias (the drag became an ALIGN — the stored yaw stays as it was). */
  calibrated: (biasYawDeg: number | null) => void;
}

export function attachArLook(opts: ArLookOpts): ArLookHandle {
  const ladder = new OrientationLadder({
    compassMaxAccuracyDeg: FPV.arCompassMaxAccuracyDeg,
    compassMinTopHoriz: FPV.arCompassMinTopHoriz,
    compassMinScreenUp: FPV.arCompassMinScreenUp,
    compassOffsetTauMs: FPV.arCompassOffsetTauMs,
    trim: {
      maxRateDegPerS: FPV.arTrimMaxRateDegPerS,
      fastRateDegPerS: FPV.arTrimFreezeRateDegPerS,
    },
  });
  const smoother = new LookSmoother(FPV.arSmoothTauMs, FPV.arDeadbandDeg);
  let attached = false;
  let samples = 0;
  let absoluteSamples = 0;
  let compassSamples = 0;
  let lastSampleT = -Infinity;
  let seeded = false;
  let seenAlignEpoch = 0;
  let declination = 0;
  let declAtLat = NaN;
  let declAtLon = NaN;
  let lastCameraHeading = 0;
  let smoothed: { headingDeg: number; pitchDeg: number } | null = null;
  let lastMirrorSig = "";
  let nowMs = 0;
  let calPitch = 0;
  let calDraftYaw = 0;
  let seenCommitEpoch = 0;
  let roll: number | null = null;
  let rollT = 0;

  const onSample = (e: OrientationEventLike, absolute: boolean) => {
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    const aim = ladder.push({
      tMs: t,
      alphaDeg: e.alpha,
      betaDeg: e.beta,
      gammaDeg: e.gamma,
      absolute: absolute || e.absolute === true,
      compassHeadingDeg: typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : null,
      compassAccuracyDeg: typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null,
      screenAngleDeg: screenAngleDeg(),
    });
    if (!aim) return;
    samples++;
    if (absolute || e.absolute === true) absoluteSamples++;
    if (typeof e.webkitCompassHeading === "number") compassSamples++;
    lastSampleT = t;
    // Rung 4's seed: the FIRST usable sample maps the phone's current pose to the camera's own
    // heading, so turning is right from the first frame and nothing jumps at arming.
    if (!seeded) {
      seeded = true;
      // (the camera's heading already carries any calibration drag — the ladder's must not)
      if (aim.rung === "relative-unaligned") ladder.align(wrapDeg360(lastCameraHeading - calDraftYaw), false);
    }
  };
  const onAbsolute = (e: Event) => onSample(e as OrientationEventLike, true);
  const onRelative = (e: Event) => onSample(e as OrientationEventLike, false);

  const attach = () => {
    if (attached || typeof window === "undefined") return;
    attached = true;
    window.addEventListener("deviceorientationabsolute", onAbsolute);
    window.addEventListener("deviceorientation", onRelative);
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    window.removeEventListener("deviceorientationabsolute", onAbsolute);
    window.removeEventListener("deviceorientation", onRelative);
    ladder.reset();
    smoother.reset();
    samples = 0;
    absoluteSamples = 0;
    compassSamples = 0;
    lastSampleT = -Infinity;
    seeded = false;
    smoothed = null;
    roll = null;
  };

  const fresh = () => attached && nowMs - lastSampleT <= FPV.arSampleStaleMs;

  const mirror = (state: ArLookState | null) => {
    const sig = state
      ? `${state.rung}|${state.compassAccuracyDeg ?? "-"}|${Math.round(state.compassAgeMs / 1000)}|${state.stale ? 1 : 0}|${Math.round(state.headingDeg)}|${Math.round(state.pitchDeg)}|${state.samples > 0 ? 1 : 0}`
      : "null";
    if (sig === lastMirrorSig) return;
    lastMirrorSig = sig;
    opts.mirror(state);
  };

  return {
    update(ctx) {
      nowMs = ctx.nowMs;
      lastCameraHeading = ctx.cameraHeadingDeg;
      const want = ctx.enabled && ctx.fpvActive;
      if (want && !attached) attach();
      else if (!want && attached) detach();
      calPitch = ctx.calPitchDeg;
      calDraftYaw = ctx.calDraftYawDeg;
      ladder.setUserBias(ctx.calBiasYawDeg);
      if (!attached) {
        seenCommitEpoch = ctx.calCommitEpoch; // a CONFIRM with no sensors is the store's to handle
        mirror(null);
        return;
      }
      // The WMM at the eye — re-evaluated when the eye has moved ~5 km (0.05°); ~0.1 ms. The
      // first evaluation is explicit: `NaN` never compares (the harness caught a +0.00° eye).
      if (
        !Number.isFinite(declAtLat) ||
        Math.abs(ctx.latDeg - declAtLat) > 0.05 ||
        Math.abs(ctx.lonDeg - declAtLon) > 0.05
      ) {
        declAtLat = ctx.latDeg;
        declAtLon = ctx.lonDeg;
        declination = declinationDeg(ctx.latDeg, ctx.lonDeg, 0, decimalYear(new Date()));
        ladder.setDeclination(declination);
      }
      // The ALIGN chip (rungs 3/4): each new epoch aligns once to the camera's live heading.
      if (ctx.alignEpoch !== seenAlignEpoch) {
        seenAlignEpoch = ctx.alignEpoch;
        if (ladder.aim()) ladder.align(wrapDeg360(ctx.cameraHeadingDeg - calDraftYaw), true);
      }
      // CONFIRM: the ladder takes the drag (the trim's bias on a compass rung, an ALIGN by eye on
      // a relative one) and the answer goes back to the store, which persists it and zeroes the
      // draft. THIS frame's draft is already inside the ladder — it must not be added twice.
      if (ctx.calCommitEpoch !== seenCommitEpoch) {
        seenCommitEpoch = ctx.calCommitEpoch;
        const bias = ladder.aim() ? ladder.commitCalibration(calDraftYaw, performance.now()) : null;
        calDraftYaw = 0;
        opts.calibrated(bias);
      }
      const raw = ladder.aim();
      smoothed = raw && fresh() ? smoother.push(raw.headingDeg, raw.pitchDeg, nowMs) : null;
      // Roll reads 0 at a degenerate look (straight up / down — `poseFromEuler`): HOLD the last
      // value there instead of snapping the picture level.
      if (raw && smoothed) {
        if (raw.pose.lookHoriz >= 0.08) roll = smoothRollDeg(roll, raw.rollDeg, nowMs - rollT, FPV.arRollSmoothTauMs);
        rollT = nowMs;
      } else roll = null;
      if (ctx.frameCount % FPV.hudSyncEveryFrames === 0) {
        mirror({
          rung: raw ? raw.rung : ("relative-unaligned" as ArRung),
          compassAccuracyDeg: null,
          compassAgeMs: raw ? raw.compassAgeMs : Infinity,
          samples,
          stale: !fresh(),
          headingDeg: smoothed ? wrapDeg360(smoothed.headingDeg + calDraftYaw) : ctx.cameraHeadingDeg,
          pitchDeg: smoothed ? smoothed.pitchDeg + calPitch : 0,
          declinationDeg: declination,
        });
      }
    },
    aim() {
      if (!smoothed || !fresh()) return null;
      return applyArCalibration({ azDeg: smoothed.headingDeg, altDeg: smoothed.pitchDeg }, { yawDeg: calDraftYaw, pitchDeg: calPitch });
    },
    live() {
      return smoothed !== null && fresh();
    },
    roll() {
      return roll !== null && fresh() ? roll : 0;
    },
    dispose() {
      detach();
      mirror(null);
    },
    debug() {
      return {
        attached,
        samples,
        absoluteSamples,
        compassSamples,
        lastSampleAgeMs: Number.isFinite(lastSampleT) ? nowMs - lastSampleT : Infinity,
        declinationDeg: declination,
        aim: ladder.aim(),
        smoothed,
        rollDeg: roll ?? 0,
        trim: ladder.trimDebug(),
        cal: { biasYawDeg: ladder.userBiasDeg(), pitchDeg: calPitch, draftYawDeg: calDraftYaw },
      };
    },
  };
}
