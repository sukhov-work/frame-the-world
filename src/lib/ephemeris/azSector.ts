/**
 * Azimuth-sector geometry for the map direction lines + visibility cones (UPLIFT U4,
 * UPLIFT_PLAN §2/U4). From a ground point, a body's "visibility cone" is the fan of azimuths it
 * sweeps while above the horizon across the observer's local solar day — split at the scene
 * instant into swept-already (past, amber) and still-to-come (future, blue).
 *
 * Azimuth is NOT linear in time, so the sector is built from time-ordered az samples of the
 * SAME `targetAzAlt` ephemeris face everything else reads (ADR D6: never a second ephemeris;
 * sun/moon ride `bodyTarget()` so all three systems share one path). Horizon crossings and the
 * now-split are linearly interpolated between samples with wrap-aware azimuth lerp.
 *
 * Pure and three-free (the dayArc.ts contract): explicit epoch ms in, plain data out. The GL
 * consumer (globe/scene/aimCones.ts) bakes `t01` per vertex and splits past/future in the
 * shader (uNow01 — the dayArcs grammar); the canvas consumer (panels/MapWindow.tsx) calls
 * `splitAimRuns` per paint. Both memoise `sampleAimDay` on (target id, day window, quantized
 * lat/lon) — ~145 ephemeris calls per rebuild, never per frame.
 */

import { localDayWindow, targetElevationSeries, type TargetAltSample } from "./dayArc";
import type { SkyTarget } from "./targets";

/** One az/alt/time sample of an above-horizon run (interpolated endpoints ride altDeg≈0). */
export type AimSample = TargetAltSample;

/** Day classification of a body's sky path at the observer. */
type AimDayKind = "arc" | "ring" | "none";

/** The expensive per-day pass — memoise on (target id, window start, quantized lat/lon). */
export interface AimDay {
  /** Local solar day window (dayArc.ts convention). */
  startMs: number;
  endMs: number;
  /**
   * Time-ordered above-horizon runs (a body can be up twice in one local day — a moon that
   * sets after midnight and rises again before the next). Run endpoints are horizon-crossing
   * interpolations except where the day window itself cuts a run.
   */
  runs: AimSample[][];
  /** "arc" = rises/sets · "ring" = up the whole day (circumpolar: full 360° fan) · "none". */
  kind: AimDayKind;
}

/** A day's runs split at the scene instant — the canvas twin's two-colour paths. */
export interface AimSplit {
  past: AimSample[][];
  future: AimSample[][];
}

/** Normalize an angle to [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Wrap an angle difference to [−180, 180) — the shared home (was duplicated in
 *  frameFinder.ts / sunEventFrame.ts before U4). */
export function wrap180(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

/** Wrap-aware azimuth lerp: shortest way around the compass from `a` toward `b`. */
export function lerpAzDeg(a: number, b: number, t: number): number {
  return norm360(a + wrap180(b - a) * t);
}

/** Linear interpolation of a sample between two neighbours at `utcMs` (az wrap-aware). */
function sampleAt(a: AimSample, b: AimSample, utcMs: number): AimSample {
  const t = b.utcMs === a.utcMs ? 0 : (utcMs - a.utcMs) / (b.utcMs - a.utcMs);
  return {
    utcMs,
    azDeg: lerpAzDeg(a.azDeg, b.azDeg, t),
    altDeg: a.altDeg + (b.altDeg - a.altDeg) * t,
  };
}

/** The horizon-crossing instant between an up and a down sample (linear in altitude). */
function crossing(a: AimSample, b: AimSample): AimSample {
  const dAlt = b.altDeg - a.altDeg;
  const t = dAlt === 0 ? 0 : -a.altDeg / dAlt;
  return sampleAt(a, b, a.utcMs + (b.utcMs - a.utcMs) * t);
}

/**
 * Pure core over an already-sampled series — unit-testable on synthetic samples. Up = altDeg>0
 * (the everUp convention; airless like every annotation — rise/set INSTANTS elsewhere are
 * refracted, so edges here sit ~0.5° az from the almanac instant. A map fan cannot show the
 * difference).
 */
export function aimDayFromSamples(
  samples: readonly AimSample[],
  startMs: number,
  endMs: number,
): AimDay {
  const runs: AimSample[][] = [];
  let run: AimSample[] | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const up = s.altDeg > 0;
    if (up) {
      if (!run) {
        run = [];
        // Rising edge inside the window → start the run at the interpolated crossing.
        if (i > 0) run.push(crossing(samples[i - 1], s));
      }
      run.push(s);
    } else if (run) {
      run.push(crossing(run[run.length - 1], s));
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);

  const kind: AimDayKind =
    runs.length === 0
      ? "none"
      : samples.length > 0 && samples.every((s) => s.altDeg > 0)
        ? "ring"
        : "arc";
  return { startMs, endMs, runs, kind };
}

/**
 * Sample a target's aim day at the observer: the local solar day window containing
 * `sceneUtcMs`, classified into above-horizon runs. Sun/moon callers pass `bodyTarget()`.
 */
export function sampleAimDay(
  target: SkyTarget,
  sceneUtcMs: number,
  latDeg: number,
  lonDeg: number,
  stepMin = 10,
): AimDay {
  const { startMs, endMs } = localDayWindow(sceneUtcMs, lonDeg);
  const samples = targetElevationSeries(target, startMs, endMs, latDeg, lonDeg, stepMin);
  return aimDayFromSamples(samples, startMs, endMs);
}

/**
 * Split a day's runs at the scene instant — swept-already vs still-to-come. A straddling run
 * is cut at an interpolated now-sample (present in BOTH halves so the two paths meet). Cheap
 * (one walk over ≤ ~150 samples) — safe per paint; only `sampleAimDay` needs the memo.
 */
export function splitAimRuns(day: AimDay, nowMs: number): AimSplit {
  const past: AimSample[][] = [];
  const future: AimSample[][] = [];
  for (const run of day.runs) {
    if (run.length === 0) continue;
    if (run[run.length - 1].utcMs <= nowMs) {
      past.push(run);
    } else if (run[0].utcMs >= nowMs) {
      future.push(run);
    } else {
      const i = run.findIndex((s) => s.utcMs > nowMs);
      const at = sampleAt(run[i - 1], run[i], nowMs);
      past.push([...run.slice(0, i), at]);
      future.push([at, ...run.slice(i)]);
    }
  }
  return { past, future };
}
