// Frame-crossing finder (QoL-2, PLANNING_QOL_PLAN §3.2) — pure, three-free.
//
// "When does this body cross MY frame?" — the FPV frame rectangle (heading/pitch/fov/aspect,
// the roll-free azAltFrameMarker math) evaluated over time: coarse scan + bounded bisection
// (the twilight.ts / planner.bisectCrossing engine idiom), each window annotated with the
// skyline verdict (injected profile sampler — the store/plan.profileBins mirror), the
// photographic light phase and the moon's interference at the window's centre-nearest moment.
// Beats PhotoPills' Find: their user types az/el numbers — here the frame IS the query.
//
// Samplers are INJECTED (`(utcMs) => AzAlt` — the planner.ts AzAltSampler precedent) so sun,
// moon and any SkyTarget go through one engine; public wrappers live at the call sites
// (bodies.horizontal / targets.targetAzAlt). All functions take explicit epoch ms — no Date.now().

import type { AzAlt } from "./bodies";
import { bodyStatesAt, horizontal } from "./bodies";
import { moonPhaseIntensity } from "./moonlight";
import { lightPhaseAt, type LightPhase } from "./twilight";
import { azAltFrameMarker } from "../geo/offscreen";

/** The FPV pose the frame test runs against (store/camera.fpvHud + the anchor geodetics). */
export interface FramePose {
  latDeg: number;
  lonDeg: number;
  headingDeg: number;
  pitchDeg: number;
  /** VERTICAL field of view (deg) — the azAltFrameMarker convention. */
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
}

/** Injected position sampler — wrap `horizontal(body, …)` or `targetAzAlt(target, …)`. */
export type FrameSampler = (utcMs: number) => AzAlt;

/** Skyline sampler (az → apparent skyline elevation deg) — `sampleBins` over the plan mirror. */
export type ProfileFn = (azDeg: number) => number;

export interface FrameCrossing {
  /** The body enters the frame rectangle (above the horizon). */
  startMs: number;
  /** The body leaves the frame rectangle (or sets). */
  endMs: number;
  /** The in-window moment the body passes nearest the frame CENTRE. */
  peakMs: number;
  /** Angular separation from the frame centre at peakMs (deg). */
  peakSepDeg: number;
  /** Skyline verdict across the window's coarse samples (profileFn == null → "unknown"). */
  skyline: "clear" | "blocked" | "mixed" | "unknown";
  /** Photographic light phase at peakMs. */
  light: LightPhase;
  /** Moon above the horizon at peakMs? (interference gate — mwSeason recipe). */
  moonUp: boolean;
  /** Illuminated fraction 0..1 at peakMs (display: "78% moon"). */
  moonIllum: number;
  /** K&S-1991 phase intensity × moonUp — the comparable interference score (0 = no moon). */
  moonGlare: number;
}

export interface FrameCrossingOptions {
  /** Skyline sampler; omit/null → skyline verdicts are "unknown". */
  profileFn?: ProfileFn | null;
  /** Coarse scan step (min). 5 ≈ the twilight engine idiom; sun/moon move ≤ 1.25°/step. */
  stepMin?: number;
  /** Stop after this many windows (the card shows the next one or two). */
  maxWindows?: number;
}

const REFINE_TOL_MS = 1_000;
const REFINE_MAX_ITER = 22; // planner.bisectCrossing bound: 2^22 × 1 s ≫ any scan window

/** Angular separation (deg) between two az/alt directions — great-circle, wrap-safe. */
export function angularSepDeg(a: AzAlt, b: { azDeg: number; altDeg: number }): number {
  const d = Math.PI / 180;
  const cosSep =
    Math.sin(a.altDeg * d) * Math.sin(b.altDeg * d) +
    Math.cos(a.altDeg * d) * Math.cos(b.altDeg * d) * Math.cos((a.azDeg - b.azDeg) * d);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / d;
}

/** The frame predicate: inside the rectangle AND above the geometric horizon. */
function inFrameAt(sample: FrameSampler, pose: FramePose, utcMs: number): boolean {
  const p = sample(utcMs);
  return p.altDeg > 0 && azAltFrameMarker(p.azDeg, p.altDeg, pose).inFrame;
}

/** Bisect the predicate flip between t0 (state s0) and t1 (state !s0) to ≤ 1 s. */
function bisectFlip(sample: FrameSampler, pose: FramePose, t0: number, t1: number): number {
  let lo = t0;
  let hi = t1;
  const loIn = inFrameAt(sample, pose, lo);
  for (let i = 0; i < REFINE_MAX_ITER && hi - lo > REFINE_TOL_MS; i++) {
    const mid = (lo + hi) / 2;
    if (inFrameAt(sample, pose, mid) === loIn) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Annotate a finished window: centre-nearest peak (coarse + fine), skyline, light, moon. */
function finishWindow(
  sample: FrameSampler,
  pose: FramePose,
  startMs: number,
  endMs: number,
  profileFn: ProfileFn | null,
  stepMs: number,
): FrameCrossing {
  const centre = { azDeg: pose.headingDeg, altDeg: pose.pitchDeg };
  // Coarse peak + skyline census over the window samples.
  let peakMs = startMs;
  let peakSep = Infinity;
  let sawClear = false;
  let sawBlocked = false;
  for (let t = startMs; ; t = Math.min(t + stepMs, endMs)) {
    const p = sample(t);
    const sep = angularSepDeg(p, centre);
    if (sep < peakSep) {
      peakSep = sep;
      peakMs = t;
    }
    if (profileFn) {
      if (p.altDeg > profileFn(p.azDeg)) sawClear = true;
      else sawBlocked = true;
    }
    if (t >= endMs) break;
  }
  // Fine pass around the coarse peak (±step, 1/16 step ≈ 19 s at the 5-min default —
  // sun/moon move ≤ 0.25°/min ⇒ ≤ 0.08° peak-time error, below the readout's resolution).
  const fineStep = Math.max(1_000, stepMs / 16);
  const lo = Math.max(startMs, peakMs - stepMs);
  const hi = Math.min(endMs, peakMs + stepMs);
  for (let t = lo; t <= hi; t += fineStep) {
    const sep = angularSepDeg(sample(t), centre);
    if (sep < peakSep) {
      peakSep = sep;
      peakMs = t;
    }
  }
  const moon = horizontal("moon", peakMs, pose.latDeg, pose.lonDeg);
  const states = bodyStatesAt(peakMs);
  const moonUp = moon.altDeg > 0;
  return {
    startMs,
    endMs,
    peakMs,
    peakSepDeg: peakSep,
    skyline: !profileFn ? "unknown" : sawClear && sawBlocked ? "mixed" : sawClear ? "clear" : "blocked",
    light: lightPhaseAt(peakMs, pose.latDeg, pose.lonDeg),
    moonUp,
    moonIllum: states.moonIllumination,
    moonGlare: moonUp ? moonPhaseIntensity(states.moonPhaseAngleDeg) : 0,
  };
}

/**
 * All windows in [fromMs, fromMs + horizonDays] where the sampled body sits inside the frame
 * rectangle and above the horizon. Windows tile nothing (they are sparse); edges bisected ≤ 1 s.
 * A window already open at fromMs starts AT fromMs (honest: "in frame NOW").
 */
export function frameCrossings(
  sample: FrameSampler,
  pose: FramePose,
  fromMs: number,
  horizonDays: number,
  opts: FrameCrossingOptions = {},
): FrameCrossing[] {
  const stepMs = Math.max(1, opts.stepMin ?? 5) * 60_000;
  const maxWindows = opts.maxWindows ?? 4;
  const profileFn = opts.profileFn ?? null;
  if (!(horizonDays > 0)) return [];
  const endMs = fromMs + horizonDays * 86_400_000;
  const out: FrameCrossing[] = [];
  let openStart: number | null = inFrameAt(sample, pose, fromMs) ? fromMs : null;
  let prevT = fromMs;
  for (let t = fromMs + stepMs; ; t = Math.min(t + stepMs, endMs)) {
    const clamped = Math.min(t, endMs);
    const inNow = inFrameAt(sample, pose, clamped);
    if (inNow !== (openStart !== null)) {
      const flip = bisectFlip(sample, pose, prevT, clamped);
      if (openStart === null) {
        openStart = flip;
      } else {
        out.push(finishWindow(sample, pose, openStart, flip, profileFn, stepMs));
        openStart = null;
        if (out.length >= maxWindows) return out;
      }
    }
    prevT = clamped;
    if (clamped >= endMs) break;
  }
  if (openStart !== null) out.push(finishWindow(sample, pose, openStart, endMs, profileFn, stepMs));
  return out;
}

// ------------------------------------------------------------------------------------------
// P4 Find FULL (QoL-3, PLANNING_QOL_PLAN §1.1 R8): "when does the body stand at az±tol/el±tol?"
// The R8 craft constants: az+el modes ONLY, tol ≈ 3° az / 0.5° el. A generic minute-scan over a
// year is ~10⁵ samples — instead each local day is solved by ROOT-FINDING the azimuth crossing
// (az is monotonic ~15°/h along a branch; MOBILE_PLAN §5 row 4), then checking the elevation
// tolerance and bisecting the joint box window edges. ~10² samples per day ⇒ a year is cheap,
// and the per-day face lets the card chunk long ranges without blocking a frame.
// ------------------------------------------------------------------------------------------

export interface AzElQuery {
  azDeg: number;
  elDeg: number;
  /** R8 defaults: 3° az / 0.5° el. */
  azTolDeg: number;
  elTolDeg: number;
}

export interface AzElHit {
  /** The instant the body crosses the target azimuth (bisected ≤ 1 s). */
  utcMs: number;
  /** Body elevation at the crossing (deg). */
  elDeg: number;
  /** Joint box window (az AND el inside tolerance) around the crossing. */
  startMs: number;
  endMs: number;
  /** Above the injected skyline at the crossing ("unknown" without a profile). */
  skyline: "clear" | "blocked" | "unknown";
  light: LightPhase;
  moonUp: boolean;
  moonIllum: number;
  moonGlare: number;
}

const wrap180 = (deg: number) => ((deg + 540) % 360) - 180;

/** All az±tol/el±tol standings in ONE local day [dayStartMs, dayStartMs + 24 h).
 *  `observer` annotates light/moon at the hit; `profileFn` gives the skyline verdict. */
export function azElHitsInDay(
  sample: FrameSampler,
  q: AzElQuery,
  dayStartMs: number,
  observer: { latDeg: number; lonDeg: number },
  profileFn: ProfileFn | null = null,
): AzElHit[] {
  const dayEndMs = dayStartMs + 86_400_000;
  const stepMs = 3_600_000; // az moves ≤ ~16°/h — hourly sign sampling cannot skip a crossing
  const dAz = (t: number) => wrap180(sample(t).azDeg - q.azDeg);
  const out: AzElHit[] = [];
  let prevT = dayStartMs;
  let prevD = dAz(prevT);
  for (let t = dayStartMs + stepMs; t <= dayEndMs; t += stepMs) {
    const d = dAz(t);
    // A sign flip marks either the azimuth crossing (near 0) or the wrap seam (near ±180).
    if ((prevD <= 0) !== (d <= 0) && Math.abs(prevD) < 90 && Math.abs(d) < 90) {
      let lo = prevT;
      let hi = t;
      const loNeg = prevD <= 0;
      for (let i = 0; i < REFINE_MAX_ITER && hi - lo > REFINE_TOL_MS; i++) {
        const mid = (lo + hi) / 2;
        if ((dAz(mid) <= 0) === loNeg) lo = mid;
        else hi = mid;
      }
      const crossMs = Math.round((lo + hi) / 2);
      const at = sample(crossMs);
      if (Math.abs(at.altDeg - q.elDeg) <= q.elTolDeg && at.altDeg > -1) {
        // Joint box window: expand out from the crossing to the first minute outside the box,
        // then bisect each edge (box residence is minutes — az tol alone is ~±12 min).
        const inBox = (ms: number) => {
          const p = sample(ms);
          return (
            Math.abs(wrap180(p.azDeg - q.azDeg)) <= q.azTolDeg &&
            Math.abs(p.altDeg - q.elDeg) <= q.elTolDeg
          );
        };
        const edge = (dir: -1 | 1): number => {
          let inside = crossMs;
          for (let k = 1; k <= 60; k++) {
            const probe = crossMs + dir * k * 60_000;
            if (!inBox(probe)) {
              let a = inside;
              let b = probe;
              for (let i = 0; i < REFINE_MAX_ITER && Math.abs(b - a) > REFINE_TOL_MS; i++) {
                const mid = (a + b) / 2;
                if (inBox(mid)) a = mid;
                else b = mid;
              }
              return Math.round((a + b) / 2);
            }
            inside = probe;
          }
          return inside;
        };
        const states = bodyStatesAt(crossMs);
        const moon = horizontal("moon", crossMs, observer.latDeg, observer.lonDeg);
        const moonUp = moon.altDeg > 0;
        out.push({
          utcMs: crossMs,
          elDeg: at.altDeg,
          startMs: inBox(crossMs) ? edge(-1) : crossMs,
          endMs: inBox(crossMs) ? edge(1) : crossMs,
          skyline: !profileFn ? "unknown" : at.altDeg > profileFn(at.azDeg) ? "clear" : "blocked",
          light: lightPhaseAt(crossMs, observer.latDeg, observer.lonDeg),
          moonUp,
          moonIllum: states.moonIllumination,
          moonGlare: moonUp ? moonPhaseIntensity(states.moonPhaseAngleDeg) : 0,
        });
      }
    }
    prevT = t;
    prevD = d;
  }
  return out;
}

/** Convenience range face (tests + short presets) — the card chunks days itself for long ones. */
export function azElHits(
  sample: FrameSampler,
  q: AzElQuery,
  fromMs: number,
  days: number,
  observer: { latDeg: number; lonDeg: number },
  profileFn: ProfileFn | null = null,
): AzElHit[] {
  const out: AzElHit[] = [];
  for (let d = 0; d < days; d++)
    out.push(...azElHitsInDay(sample, q, fromMs + d * 86_400_000, observer, profileFn));
  return out;
}

/**
 * "When is the body nearest the frame CENTRE?" — the single-target Find inversion (P4 seed).
 * Global minimum of the angular separation over the scan horizon (no in-frame requirement —
 * it answers even when the body never quite enters), refined around the coarse minimum.
 * Returns null only for a degenerate horizon.
 */
export function nearestFrameCentre(
  sample: FrameSampler,
  pose: FramePose,
  fromMs: number,
  horizonDays: number,
  opts: { stepMin?: number; requireUp?: boolean } = {},
): { utcMs: number; sepDeg: number; altDeg: number } | null {
  const stepMs = Math.max(1, opts.stepMin ?? 5) * 60_000;
  const requireUp = opts.requireUp ?? true;
  if (!(horizonDays > 0)) return null;
  const endMs = fromMs + horizonDays * 86_400_000;
  const centre = { azDeg: pose.headingDeg, altDeg: pose.pitchDeg };
  let bestMs: number | null = null;
  let bestSep = Infinity;
  for (let t = fromMs; ; t = Math.min(t + stepMs, endMs)) {
    const p = sample(t);
    if (!requireUp || p.altDeg > 0) {
      const sep = angularSepDeg(p, centre);
      if (sep < bestSep) {
        bestSep = sep;
        bestMs = t;
      }
    }
    if (t >= endMs) break;
  }
  if (bestMs === null) return null;
  const fineStep = Math.max(1_000, stepMs / 16);
  const lo = Math.max(fromMs, bestMs - stepMs);
  const hi = Math.min(endMs, bestMs + stepMs);
  for (let t = lo; t <= hi; t += fineStep) {
    const p = sample(t);
    if (requireUp && p.altDeg <= 0) continue;
    const sep = angularSepDeg(p, centre);
    if (sep < bestSep) {
      bestSep = sep;
      bestMs = t;
    }
  }
  const at = sample(bestMs);
  return { utcMs: bestMs, sepDeg: bestSep, altDeg: at.altDeg };
}
