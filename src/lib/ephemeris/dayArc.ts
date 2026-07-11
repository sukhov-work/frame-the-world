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

export interface DayArcPoint extends AzAlt {
  utcMs: number;
  /** Normalized position in the local day window, 0..1 — the shader's past/future axis. */
  t01: number;
}

export interface DayArc {
  body: "sun" | "moon";
  /** Local solar day window [startMs, endMs) containing the scene instant. */
  startMs: number;
  endMs: number;
  /** Whole-hour solar offset used for the window (h; round(lon/15)). */
  offsetHours: number;
  /** Dense samples, first point at startMs, last at endMs (inclusive). */
  points: DayArcPoint[];
  /** On-the-(local)-hour samples — tick marks. Every `tickEveryH` hours, 0h..24h inclusive. */
  hourTicks: DayArcPoint[];
  /** True if any sample rises above the horizon (a moon can stay down all day at high lat). */
  everUp: boolean;
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
  const stepMin = opts.stepMin ?? 10;
  const tickEveryH = opts.tickEveryH ?? 1;
  const { startMs, endMs, offsetHours } = localDayWindow(sceneUtcMs, lonDeg);

  const at = (utcMs: number): DayArcPoint => ({
    utcMs,
    t01: (utcMs - startMs) / DAY_MS,
    ...horizontal(body, utcMs, latDeg, lonDeg),
  });

  const points: DayArcPoint[] = [];
  const stepMs = stepMin * 60_000;
  for (let t = startMs; t < endMs; t += stepMs) points.push(at(t));
  points.push(at(endMs)); // inclusive tail — the arc closes the day

  const hourTicks: DayArcPoint[] = [];
  for (let h = 0; h <= 24; h += tickEveryH) hourTicks.push(at(startMs + h * HOUR_MS));

  return {
    body,
    startMs,
    endMs,
    offsetHours,
    points,
    hourTicks,
    everUp: points.some((p) => p.altDeg > 0),
  };
}

/** Fraction of the local day elapsed at `utcMs`, clamped 0..1 — the shader's uNow01 uniform. */
export function dayFraction(arc: Pick<DayArc, "startMs" | "endMs">, utcMs: number): number {
  return Math.min(1, Math.max(0, (utcMs - arc.startMs) / (arc.endMs - arc.startMs)));
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
