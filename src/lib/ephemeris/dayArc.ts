/**
 * Day-arc sampling for the FPV planning overlays (Phase 5.5 S6, §Item 4).
 *
 * The arc is the body's topocentric az/alt path across the OBSERVER's local solar day — sampled
 * from the SAME ephemeris as everything else (`horizontal`; ADR D6: never a second ephemeris).
 * "Local day" uses the scene's solar-time convention (offset = round(lon/15°) h — the
 * `captureTime.ts` trade-off, documented there), so the arc window matches how EXIF capture
 * times were seeded onto the scrubber.
 *
 * Pure and three-free: the renderer (globe/scene/dayArcs.ts) converts az/alt to ECEF directions
 * at the pin and anchors the polyline to the camera. Points carry their UTC instant so the
 * past/future split at scene time is a per-vertex shader compare, not a geometry rebuild.
 */

import { horizontal, type AzAlt } from "./bodies";
import { targetAzAlt, type SkyTarget } from "./targets";

export interface DayArcPoint extends AzAlt {
  utcMs: number;
  /** Normalized position in the local day window, 0..1 — the shader's past/future axis. */
  t01: number;
}

/** One body's az/alt path across the observer's local solar day — the body-agnostic shape
 *  (ASTRO ENGINE phase C: the tracked sky target rides the same grammar as the sun/moon). */
export interface SkyArc {
  /** Local solar day window [startMs, endMs) containing the scene instant. */
  startMs: number;
  endMs: number;
  /** Whole-hour solar offset used for the window (h; round(lon/15)). */
  offsetHours: number;
  /** Dense samples, first point at startMs, last at endMs (inclusive). */
  points: DayArcPoint[];
  /** On-the-(local)-hour samples — tick marks. Every `tickEveryH` hours, 0h..24h inclusive. */
  hourTicks: DayArcPoint[];
  /** True if any sample rises above the horizon (a body can stay down all day). */
  everUp: boolean;
}

export interface DayArc extends SkyArc {
  body: "sun" | "moon";
}

export interface DayArcOptions {
  /** Sampling step (min). 10 min ≈ 145 pts — sub-pixel kinks at any FOV (design §Item 4). */
  stepMin?: number;
  /** Hour-tick cadence (h). */
  tickEveryH?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Whole-hour solar-time offset at a longitude (the scene's captureTime convention). */
export function solarOffsetHours(lonDeg: number): number {
  return Math.round(Math.max(-180, Math.min(180, lonDeg)) / 15);
}

/** The local solar day window [start, end) containing `utcMs` at `lonDeg`. */
export function localDayWindow(
  utcMs: number,
  lonDeg: number,
): { startMs: number; endMs: number; offsetHours: number } {
  const offsetHours = solarOffsetHours(lonDeg);
  const local = utcMs + offsetHours * HOUR_MS;
  const startMs = Math.floor(local / DAY_MS) * DAY_MS - offsetHours * HOUR_MS;
  return { startMs, endMs: startMs + DAY_MS, offsetHours };
}

/** Shared arc builder — dense polyline + hour ticks from ONE az/alt sampler. */
function buildArc(
  at: (utcMs: number) => AzAlt,
  sceneUtcMs: number,
  lonDeg: number,
  opts: DayArcOptions,
): SkyArc {
  const stepMin = opts.stepMin ?? 10;
  const tickEveryH = opts.tickEveryH ?? 1;
  const { startMs, endMs, offsetHours } = localDayWindow(sceneUtcMs, lonDeg);

  const pt = (utcMs: number): DayArcPoint => ({
    utcMs,
    t01: (utcMs - startMs) / DAY_MS,
    ...at(utcMs),
  });

  const points: DayArcPoint[] = [];
  const stepMs = stepMin * 60_000;
  for (let t = startMs; t < endMs; t += stepMs) points.push(pt(t));
  points.push(pt(endMs)); // inclusive tail — the arc closes the day

  const hourTicks: DayArcPoint[] = [];
  for (let h = 0; h <= 24; h += tickEveryH) hourTicks.push(pt(startMs + h * HOUR_MS));

  return {
    startMs,
    endMs,
    offsetHours,
    points,
    hourTicks,
    everUp: points.some((p) => p.altDeg > 0),
  };
}

/**
 * Sample a body's day arc for the local solar day containing `sceneUtcMs` at the observer.
 * Both the dense polyline and the hour ticks come from the one `horizontal` ephemeris face.
 */
export function sampleDayArc(
  body: "sun" | "moon",
  sceneUtcMs: number,
  latDeg: number,
  lonDeg: number,
  opts: DayArcOptions = {},
): DayArc {
  return {
    body,
    ...buildArc((utcMs) => horizontal(body, utcMs, latDeg, lonDeg), sceneUtcMs, lonDeg, opts),
  };
}

/**
 * The tracked sky target's arc across the SAME local solar day window (ASTRO ENGINE phase C —
 * the owner's missing trajectory). `targetAzAlt` is the sampler, so the trail can never
 * disagree with the marker or the panel: one target, one ephemeris, three faces. Within a day
 * even the fastest tracked body (a comet, ~0.3°/day against the stars) is dominated by the
 * diurnal rotation, so the day window is the right span for every kind.
 */
export function sampleTargetArc(
  target: SkyTarget,
  sceneUtcMs: number,
  latDeg: number,
  lonDeg: number,
  opts: DayArcOptions = {},
): SkyArc {
  return buildArc(
    (utcMs) => {
      const { azDeg, altDeg } = targetAzAlt(target, utcMs, latDeg, lonDeg);
      return { azDeg, altDeg };
    },
    sceneUtcMs,
    lonDeg,
    opts,
  );
}

/** Fraction of the local day elapsed at `utcMs`, clamped 0..1 — the shader's uNow01 uniform. */
/** One altitude sample of the scrubber-rail elevation curves (QoL-1, PLANNING_QOL_PLAN §3.1.C). */
export interface AltSample {
  utcMs: number;
  altDeg: number;
}

/**
 * Altitude-vs-time series over an ARBITRARY window (the rail's sliding span — unlike the day
 * arcs this is not tied to the local solar day). Same single ephemeris face (`horizontal`);
 * pure and cheap (~145 calls per 24 h at the default step) — consumers memoise per quantized
 * (window, lat, lon), never per frame (the twilight.ts discipline).
 */
export function elevationSeries(
  body: "sun" | "moon",
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
  stepMin = 10,
): AltSample[] {
  if (!(endMs > startMs) || !(stepMin > 0)) return [];
  const stepMs = stepMin * 60_000;
  const out: AltSample[] = [];
  for (let t = startMs; t < endMs; t += stepMs) {
    out.push({ utcMs: t, altDeg: horizontal(body, t, latDeg, lonDeg).altDeg });
  }
  out.push({ utcMs: endMs, altDeg: horizontal(body, endMs, latDeg, lonDeg).altDeg });
  return out;
}

export function dayFraction(arc: Pick<DayArc, "startMs" | "endMs">, utcMs: number): number {
  return Math.min(1, Math.max(0, (utcMs - arc.startMs) / (arc.endMs - arc.startMs)));
}

/** One tracked-target trace sample (QoL-1 §3.1.D) — the rail needs the azimuth too: skyline
 *  classification and the FPV frame test are both az-dependent. */
export interface TargetAltSample extends AltSample {
  azDeg: number;
}

/**
 * The tracked SkyTarget's altitude-vs-time series over an arbitrary window — the target twin of
 * `elevationSeries`, through the SAME `targetAzAlt` face the marker/trail/panel read (one
 * target, one ephemeris). Sea-level observer: at trace granularity even a comet's diurnal
 * parallax shift from eye height is far below a rail pixel (the jumpEvent fallback discipline).
 */
export function targetElevationSeries(
  target: SkyTarget,
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
  stepMin = 8,
): TargetAltSample[] {
  if (!(endMs > startMs) || !(stepMin > 0)) return [];
  const stepMs = stepMin * 60_000;
  const out: TargetAltSample[] = [];
  const at = (t: number) => {
    const { azDeg, altDeg } = targetAzAlt(target, t, latDeg, lonDeg);
    out.push({ utcMs: t, azDeg, altDeg });
  };
  for (let t = startMs; t < endMs; t += stepMs) at(t);
  at(endMs);
  return out;
}

/** Next horizon RISE of the target after `fromMs` (the goto-chip below-horizon jump, owner
 *  2026-08-19b: "move to the point where it will appear from the horizon next") — the first
 *  ≤0 → >0 crossing in the scan window, time + azimuth linearly interpolated at the crossing
 *  (wrap-aware az lerp; at 8-min sampling the az step is small at planning latitudes, and
 *  the goto glide is a look, not a measurement). Null = no rise in the window (never-up /
 *  circumpolar-down from here — callers fall back to the current azimuth). */
export function nextRiseAzimuth(
  target: SkyTarget,
  fromMs: number,
  latDeg: number,
  lonDeg: number,
  scanHours = 48,
): { utcMs: number; azDeg: number } | null {
  const samples = targetElevationSeries(
    target,
    fromMs,
    fromMs + scanHours * 3_600_000,
    latDeg,
    lonDeg,
  );
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.altDeg <= 0 && b.altDeg > 0) {
      const f = b.altDeg > a.altDeg ? (0 - a.altDeg) / (b.altDeg - a.altDeg) : 0;
      let dAz = b.azDeg - a.azDeg;
      if (dAz > 180) dAz -= 360;
      if (dAz < -180) dAz += 360;
      const azDeg = (((a.azDeg + dAz * f) % 360) + 360) % 360;
      return { utcMs: a.utcMs + (b.utcMs - a.utcMs) * f, azDeg };
    }
  }
  return null;
}

/** Rail-trace visibility class of one sample: below the horizon / up but skyline-blocked /
 *  clear sky (§3.1.D). */
export type TraceState = "down" | "blocked" | "clear";

/**
 * Classify trace samples against a skyline sampler (deg az → deg elevation; the mirrored
 * planFeed profile). Without a sampler (no photo/FPV anchor → no profile) every up sample is
 * `clear` — horizon-only classification, the honest fallback.
 */
export function traceStates(
  samples: readonly TargetAltSample[],
  skylineAltDegAt: ((azDeg: number) => number) | null,
): TraceState[] {
  return samples.map((s) => {
    if (s.altDeg <= 0) return "down";
    if (skylineAltDegAt && s.altDeg < skylineAltDegAt(s.azDeg)) return "blocked";
    return "clear";
  });
}

/**
 * Az/alt → local ENU unit direction (x=east, y=north, z=up). The renderer maps ENU to ECEF
 * with the pin's geodetic basis; kept here so the trig has a unit test against known bearings.
 */
export function azAltToEnu(azDeg: number, altDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const alt = (altDeg * Math.PI) / 180;
  const c = Math.cos(alt);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)];
}
