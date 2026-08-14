/**
 * Sunsets/sunrises IN FRAME (QoL-4 §3.5, owner order 2026-08-14) — the FIND grammar applied to
 * the sun EVENTS: "on which days does the sunset (or sunrise / the golden sun) happen inside MY
 * frame?" The missing primitive this file adds is an EVENT-TIME-ANCHORED day loop: ~2–4
 * root-finds per local day (the planner's own SearchRiseSet/SearchAltitude), then a cheap frame
 * test at each instant — never a fixed-step 365-day scan for a ~20-min/day event.
 *
 * REFRACTION CONVENTION (the §3.5 pairing — never mix the two):
 *   · event LABEL instants are REFRACTED — `SearchRiseSet` (34′ refraction + 16′ solar radius +
 *     eye-height dip), matching the ☀ SET chip and every almanac row;
 *   · the frame/skyline GEOMETRY test is AIRLESS — the house `horizontal()` contract
 *     (twilight.ts §doc). At the refracted set instant the airless sun centre sits at ≈ −0.83°,
 *     so this file deliberately has NO `altDeg > 0` floor (frameFinder's predicate would drop
 *     every sunrise/sunset it exists to report).
 * The frame test folds the solar DISC extent in (`angularRadiusRad` — "the limb touches the
 * frame" honesty; frameFinder's centre-only test is its documented gap #6).
 *
 * Two-face split (the frameFinder discipline): `sunEventDays` = the pose-FREE root-finds +
 * per-day annotations (memo on day/latlon/range — survives look-drags); `sunEventFrameHits` =
 * the pose-CHEAP frame filter (re-runs per pose key). `sunEventInFrame` composes both for
 * tests and one-shot callers. Pure — explicit epoch ms in, no Date.now(), no tuning imports
 * (`GoldenCurve` is a parameter, planner-style).
 */

import { Body, Observer, SearchAltitude, SearchRiseSet } from "astronomy-engine";
import {
  angularRadiusRad,
  bodyStatesAt,
  horizontal,
  KM_PER_AU,
  SUN_RADIUS_KM,
} from "./bodies";
import { localDayWindow } from "./dayArc";
import { goldenElevationsDeg } from "./planner";
import type { GoldenCurve } from "./golden";
import { lightPhaseAt, type LightPhase } from "./twilight";
import type { FramePose, ProfileFn } from "./frameFinder";
import { azAltFrameMarker } from "../geo/offscreen";

const DAY_MS = 86_400_000;
const DEG = 180 / Math.PI;
const wrap180 = (deg: number): number => ((deg + 540) % 360) - 180;

export type SunEventKind = "sunrise" | "sunset" | "goldenAm" | "goldenPm";

/** Tunable constants of the event-frame engine (lib-owned, the FIND_VIS discipline). */
export const SUNEVENT = {
  /** A rise/set row is CLEAR when the skyline at the event azimuth stays at or below this
   *  apparent elevation (deg) — the true horizon is visible there. Above it, a ridge/building
   *  swallows the sun before it reaches the horizon → BLOCKED. Scaled to the refracted-disc
   *  band (~0.5° = one solar diameter). */
  horizonClearMaxDeg: 0.5,
  /** Golden-band sweep cadence (min) — the sun crosses ~1.25°/step; any frame wider than a few
   *  degrees cannot slip between samples. */
  goldenStepMin: 5,
} as const;

/** One computed event on one local day — pose-free (frame-independent). */
export interface SunEventDay {
  kind: SunEventKind;
  /** Refracted label instant (rise/set) · band START (golden). */
  utcMs: number;
  /** Airless geometry at `utcMs` (rise/set) / at the band start (golden). */
  azDeg: number;
  altDeg: number;
  /** Solar disc angular RADIUS (deg) at the instant — the frame test's limb pad. */
  discRadDeg: number;
  /** Same-event azimuth walk vs the previous local day (deg/day, wrap-safe) — how fast the
   *  sunset slides along the skyline. Seeded from day −1 so the first row is real too. */
  azDriftDegPerDay: number;
  /** Golden kinds only: airless samples across the band at SUNEVENT.goldenStepMin. */
  samples?: { utcMs: number; azDeg: number; altDeg: number }[];
}

/** A day's event that lands inside the frame — the §3.5 row. */
export interface SunEventHit {
  kind: SunEventKind;
  /** Rise/set: the refracted label instant. Golden: the FIRST in-frame instant of the band. */
  utcMs: number;
  /** Airless geometry at `utcMs`. */
  azDeg: number;
  altDeg: number;
  /** Normalized frame coords of the event direction (offscreen.ts semantics). */
  fx: number;
  fy: number;
  /** Rise/set: is the true horizon visible at the event azimuth (profile ≤
   *  SUNEVENT.horizonClearMaxDeg)? Golden: the frameFinder centre-vs-profile idiom. */
  skyline: "clear" | "blocked" | "unknown";
  /** Photographic light phase at the instant (twilight.ts LIGHT_DEG — deliberately NOT the
   *  render GOLDEN bell; a goldenPmEnd row may honestly annotate as "blue"). */
  light: LightPhase;
  azDriftDegPerDay: number;
}

export interface SunEventObserver {
  latDeg: number;
  lonDeg: number;
  groundAltM: number;
  eyeAboveGroundM: number;
}

/** The golden band's [start, end] instants for one local day, per kind. */
function goldenBand(
  obs: Observer,
  dayStart: Date,
  kind: "goldenAm" | "goldenPm",
  loDeg: number,
  hiDeg: number,
): [number, number] | null {
  // AM climbs lo→hi (dir +1), PM falls hi→lo (dir −1) — the planner's edge convention.
  const dir = kind === "goldenAm" ? 1 : -1;
  const first = kind === "goldenAm" ? loDeg : hiDeg;
  const second = kind === "goldenAm" ? hiDeg : loDeg;
  const a = SearchAltitude(Body.Sun, obs, dir, dayStart, 1, first)?.date.getTime() ?? null;
  if (a === null) return null;
  const b = SearchAltitude(Body.Sun, obs, dir, new Date(a), 1, second)?.date.getTime() ?? null;
  if (b === null) return null;
  return [a, b];
}

/**
 * Pose-FREE face: the per-local-day event instants + airless annotations + drift.
 * Cost: ≤ 2 root-finds per kind per day (1 y × 4 kinds ≈ 2–3 k finds — memo-friendly).
 * `golden` is required when a golden kind is requested (the curve lives in tuning — the lib
 * never imports it; planner-style parameter).
 */
export function sunEventDays(
  observer: SunEventObserver,
  fromMs: number,
  days: number,
  kinds: readonly SunEventKind[],
  golden?: GoldenCurve,
): SunEventDay[] {
  const nDays = Math.min(366, Math.max(1, Math.round(days)));
  const wantsGolden = kinds.includes("goldenAm") || kinds.includes("goldenPm");
  if (wantsGolden && !golden)
    throw new TypeError("sunEventDays: golden kinds need the GoldenCurve parameter");
  const band = wantsGolden ? goldenElevationsDeg(golden!) : null;
  const obs = new Observer(
    observer.latDeg,
    observer.lonDeg,
    Math.max(-400, observer.groundAltM + observer.eyeAboveGroundM),
  );
  const la = observer.latDeg;
  const lo = observer.lonDeg;

  /** The event instant(s) for the local day starting at `dayStartMs`; null = event absent
   *  (polar day/night, band never entered). */
  const instantOf = (kind: SunEventKind, dayStartMs: number): [number, number] | null => {
    const start = new Date(dayStartMs);
    if (kind === "sunrise" || kind === "sunset") {
      const ms =
        SearchRiseSet(
          Body.Sun,
          obs,
          kind === "sunrise" ? 1 : -1,
          start,
          1,
          observer.eyeAboveGroundM,
        )?.date.getTime() ?? null;
      return ms === null ? null : [ms, ms];
    }
    return goldenBand(obs, start, kind, band!.loDeg, band!.hiDeg);
  };

  const out: SunEventDay[] = [];
  const prevAz = new Map<SunEventKind, number>();
  // Day −1 seeds the drift so the first reported day carries a real number.
  for (let i = -1; i < nDays; i++) {
    const day = localDayWindow(fromMs + i * DAY_MS, lo);
    for (const kind of kinds) {
      const span = instantOf(kind, day.startMs);
      if (!span) {
        prevAz.delete(kind);
        continue;
      }
      const [startMs, endMs] = span;
      const p = horizontal("sun", startMs, la, lo);
      const drift = prevAz.has(kind) ? wrap180(p.azDeg - prevAz.get(kind)!) : 0;
      prevAz.set(kind, p.azDeg);
      if (i < 0) continue; // seed day — drift bank only
      const d: SunEventDay = {
        kind,
        utcMs: startMs,
        azDeg: p.azDeg,
        altDeg: p.altDeg,
        discRadDeg: angularRadiusRad(SUN_RADIUS_KM, bodyStatesAt(startMs).sunDistanceAu * KM_PER_AU) * DEG,
        azDriftDegPerDay: drift,
      };
      if (kind === "goldenAm" || kind === "goldenPm") {
        const stepMs = SUNEVENT.goldenStepMin * 60_000;
        const samples: { utcMs: number; azDeg: number; altDeg: number }[] = [];
        for (let t = startMs; t <= endMs; t += stepMs) {
          const s = horizontal("sun", t, la, lo);
          samples.push({ utcMs: t, azDeg: s.azDeg, altDeg: s.altDeg });
        }
        d.samples = samples;
      }
      out.push(d);
    }
  }
  return out.sort((a, b) => a.utcMs - b.utcMs);
}

/** Disc-padded frame test: any part of the solar limb inside the frustum. fx/fy are
 *  normalized per-axis, so the angular radius maps to DIFFERENT pads per axis. */
function limbInFrame(
  azDeg: number,
  altDeg: number,
  discRadDeg: number,
  pose: FramePose,
): { inFrame: boolean; fx: number; fy: number } {
  const m = azAltFrameMarker(azDeg, altDeg, pose);
  // frameMarker zeroes fx/fy behind the camera; a dead-centre front direction sets inFrame.
  const front = m.inFrame || m.fx !== 0 || m.fy !== 0;
  const tanHalfV = Math.tan((pose.fovDeg / 2) / DEG);
  const pad = Math.tan(discRadDeg / DEG);
  const padY = pad / tanHalfV;
  const padX = pad / (tanHalfV * pose.aspect);
  return {
    inFrame: front && Math.abs(m.fx) <= 1 + padX && Math.abs(m.fy) <= 1 + padY,
    fx: m.fx,
    fy: m.fy,
  };
}

/**
 * Pose-CHEAP face: filter the pose-free day list down to the events that land inside THIS
 * frame. Golden kinds report the FIRST in-frame instant of their band (the sun walks ~1.25°
 * per sample). `profileFn` = apparent skyline elevation at an azimuth (frameFinder seam).
 */
export function sunEventFrameHits(
  eventDays: readonly SunEventDay[],
  pose: FramePose,
  profileFn: ProfileFn | null = null,
): SunEventHit[] {
  const out: SunEventHit[] = [];
  for (const d of eventDays) {
    if (d.kind === "goldenAm" || d.kind === "goldenPm") {
      const hitSample = (d.samples ?? []).find(
        (s) => limbInFrame(s.azDeg, s.altDeg, d.discRadDeg, pose).inFrame,
      );
      if (!hitSample) continue;
      const f = limbInFrame(hitSample.azDeg, hitSample.altDeg, d.discRadDeg, pose);
      out.push({
        kind: d.kind,
        utcMs: hitSample.utcMs,
        azDeg: hitSample.azDeg,
        altDeg: hitSample.altDeg,
        fx: f.fx,
        fy: f.fy,
        // Above-horizon sun: the frameFinder centre-vs-profile idiom.
        skyline: !profileFn
          ? "unknown"
          : hitSample.altDeg > profileFn(hitSample.azDeg)
            ? "clear"
            : "blocked",
        light: lightPhaseAt(hitSample.utcMs, pose.latDeg, pose.lonDeg),
        azDriftDegPerDay: d.azDriftDegPerDay,
      });
      continue;
    }
    const f = limbInFrame(d.azDeg, d.altDeg, d.discRadDeg, pose);
    if (!f.inFrame) continue;
    out.push({
      kind: d.kind,
      utcMs: d.utcMs,
      azDeg: d.azDeg,
      altDeg: d.altDeg,
      fx: f.fx,
      fy: f.fy,
      // Horizon event: CLEAR means the true horizon itself is visible at that azimuth — the
      // airless centre is below 0 BY CONVENTION here, so centre-vs-profile would always
      // read "blocked" and is the wrong question.
      skyline: !profileFn
        ? "unknown"
        : profileFn(d.azDeg) <= SUNEVENT.horizonClearMaxDeg
          ? "clear"
          : "blocked",
      light: lightPhaseAt(d.utcMs, pose.latDeg, pose.lonDeg),
      azDriftDegPerDay: d.azDriftDegPerDay,
    });
  }
  return out.sort((a, b) => a.utcMs - b.utcMs);
}

/** One-call face (tests / one-shot callers) — §3.5's `sunEventInFrame`. UI panels should use
 *  the two faces directly so look-drags never re-run the root-finds. */
export function sunEventInFrame(
  pose: FramePose,
  fromMs: number,
  days: number,
  opts: {
    events: readonly SunEventKind[];
    profileFn?: ProfileFn | null;
    golden?: GoldenCurve;
    groundAltM?: number;
    eyeAboveGroundM?: number;
  },
): SunEventHit[] {
  const eventDays = sunEventDays(
    {
      latDeg: pose.latDeg,
      lonDeg: pose.lonDeg,
      groundAltM: opts.groundAltM ?? 0,
      eyeAboveGroundM: opts.eyeAboveGroundM ?? 1.6,
    },
    fromMs,
    days,
    opts.events,
    opts.golden,
  );
  return sunEventFrameHits(eventDays, pose, opts.profileFn ?? null);
}
