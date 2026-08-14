// Moon phase calendar + apsides (QoL-3 P6, PLANNING_QOL_PLAN §1.1 R10, owner 2026-08-14):
// walk the quarter phases (SearchMoonQuarter/NextMoonQuarter) and the perigee/apogee series
// (SearchLunarApsis/NextLunarApsis) over a date range, tag supermoons, and annotate every event
// with the geocentric distance + apparent disc size from the ONE house ephemeris (bodies.ts).
// Pure: explicit epoch ms in, plain data out — no Date.now(), no store reads (frameFinder's
// purity contract).

import {
  NextLunarApsis,
  NextMoonQuarter,
  SearchLunarApsis,
  SearchMoonQuarter,
  type Apsis,
  type MoonQuarter,
} from "astronomy-engine";
import { angularRadiusRad, bodyStatesAt, MOON_RADIUS_KM } from "./bodies";

export type MoonCalKind =
  | "newMoon"
  | "firstQuarter"
  | "fullMoon"
  | "thirdQuarter"
  | "perigee"
  | "apogee";

export interface MoonCalEvent {
  kind: MoonCalKind;
  utcMs: number;
  /** Geocentric distance at the event (km). */
  distanceKm: number;
  /** Apparent disc diameter (arcmin) at the event — the R9 "size" readout everywhere. */
  discArcmin: number;
  /** Illuminated fraction 0..1 at the event (phase picture for the row glyph). */
  illum: number;
  /** Full moon within SUPERMOON_MAX_KM — the popular threshold definition. */
  supermoon: boolean;
}

/** Common supermoon threshold: a full moon at ≤ 360,000 km geocentric distance
 *  (the timeanddate.com / practical-astronomy convention — Nolle's 90%-of-perigee-range
 *  definition lands within a few thousand km of it). */
export const SUPERMOON_MAX_KM = 360_000;

const QUARTER_KIND: MoonCalKind[] = ["newMoon", "firstQuarter", "fullMoon", "thirdQuarter"];

function eventAt(kind: MoonCalKind, utcMs: number, distanceKm?: number): MoonCalEvent {
  const s = bodyStatesAt(utcMs);
  const d = distanceKm ?? s.moonDistanceKm;
  return {
    kind,
    utcMs,
    distanceKm: Math.round(d),
    discArcmin: 2 * angularRadiusRad(MOON_RADIUS_KM, d) * (180 / Math.PI) * 60,
    illum: s.moonIllumination,
    supermoon: kind === "fullMoon" && d <= SUPERMOON_MAX_KM,
  };
}

/** All quarter phases + perigees/apogees in [fromMs, fromMs + days], time-sorted. */
export function moonCalendar(fromMs: number, days: number): MoonCalEvent[] {
  const endMs = fromMs + days * 86_400_000;
  const out: MoonCalEvent[] = [];

  let q: MoonQuarter = SearchMoonQuarter(new Date(fromMs));
  while (q.time.date.getTime() <= endMs) {
    out.push(eventAt(QUARTER_KIND[q.quarter], q.time.date.getTime()));
    q = NextMoonQuarter(q);
  }

  let a: Apsis = SearchLunarApsis(new Date(fromMs));
  while (a.time.date.getTime() <= endMs) {
    out.push(eventAt(a.kind === 0 ? "perigee" : "apogee", a.time.date.getTime(), a.dist_km));
    a = NextLunarApsis(a);
  }

  return out.sort((x, y) => x.utcMs - y.utcMs);
}

/** The next N supermoons after fromMs (walks full moons; capped at ~4 years of lunations). */
export function nextSupermoons(fromMs: number, count: number): MoonCalEvent[] {
  const out: MoonCalEvent[] = [];
  let q: MoonQuarter = SearchMoonQuarter(new Date(fromMs));
  for (let i = 0; i < 60 && out.length < count; i++) {
    if (q.quarter === 2) {
      const e = eventAt("fullMoon", q.time.date.getTime());
      if (e.supermoon) out.push(e);
    }
    q = NextMoonQuarter(q);
  }
  return out;
}
