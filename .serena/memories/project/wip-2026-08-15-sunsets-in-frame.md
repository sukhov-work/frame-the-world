# WIP 2026-08-15 — §3.5 SUNSETS-IN-FRAME [SHIPPED desktop + /m, browser-verified]

Twin: DECISIONS 2026-08-15. Gates: **vitest 866/866 (+10) · astro 0 err/5 hints**; shots
`verify-shots/sunsets-01-desktop-panel-jump.jpeg` (payoff: post-jump dimmed sun disc AT the
skyline in-frame) · `sunsets-02/03-mobile`. Spec: PLANNING_QOL_PLAN §3.5; surface placement
per the owner de-burying order (INSIDE FindPanel, superseding the spec's PLAN-card location).

## NEW lib `src/lib/ephemeris/sunEventFrame.ts` (+ test/lib/ephemeris/sunEventFrame.test.ts, 10)
- Event-anchored day loop: per `localDayWindow(fromMs + i·DAY, lon)` (DST-free, the mwSeason
  precedent — NOT store/time.sameLocalTimeInstants, that's a store import + browser-TZ),
  ≤2 root-finds/kind/day: `SearchRiseSet(Body.Sun, obs, ±1, start, 1, eyeAboveGroundM)` ·
  golden band = `SearchAltitude` at `goldenElevationsDeg(curve)` edges (AM lo→hi dir +1, PM
  hi→lo dir −1, second find anchored at the first).
- **Refraction pairing (pinned in tests):** refracted LABELS + AIRLESS geometry; NO altDeg>0
  floor — frameFinder's predicate (frameFinder.ts:402) kills every sunset (airless centre
  ≈ −0.83° at the refracted instant). Test pins `altDeg < 0` while in-frame.
- **Disc-extent frame test** (first in repo — every prior frame test is centre-only): pads
  per axis `padY = tan(r)/tanHalfV`, `padX = padY/aspect`; front-detection off FrameMarker =
  `m.inFrame || m.fx !== 0 || m.fy !== 0` (frameMarker zeroes fx/fy behind camera; dead-centre
  front sets inFrame). discRadDeg per day from `angularRadiusRad(SUN_RADIUS_KM,
  bodyStatesAt(t).sunDistanceAu·KM_PER_AU)` — pose-free, stored on SunEventDay.
- **Skyline verdict split by kind:** rise/set asks "is the TRUE horizon visible at that az"
  (`profileFn(az) ≤ SUNEVENT.horizonClearMaxDeg .5°`) — centre-vs-profile would read every
  sea-horizon sunset "blocked"; golden = centre-vs-profile verbatim (sun well above horizon).
- Golden kinds carry band `samples` at `SUNEVENT.goldenStepMin 5` (pose-free); hits = FIRST
  in-frame sample → ±2 min day-to-day wobble is the CADENCE, not drift (browser-observed).
- Az drift °/day per kind, seeded from day −1 (first row real); wrap180 local.
- Faces: `sunEventDays(observer, fromMs, days, kinds, golden?)` pose-FREE ·
  `sunEventFrameHits(days, pose, profileFn?)` pose-cheap · `sunEventInFrame` one-call
  compose (the frameFinder three-face discipline). `GoldenCurve` = parameter, never a tuning
  import. Golden kinds without curve → TypeError (tested).
- `light` annotation = `lightPhaseAt` (photographic −4/+6 band) — DELIBERATELY disagrees with
  the render-bell band near golden edges (twilight.ts:120 doc; both docs pinned).

## Desktop — FindPanel SUNSETS section
State `sunEventsOn {set:true, rise:false, gold:false}`; stage-1 memo keyed
`[active, dayKey, latKey, lonKey, rangeDays, sunEventsOn]` — **dayKey = floor(baseMs/DAY),
NEVER minuteKey** (sunsets don't depend on the scrub hour; the standings scan does); stage-2
`sunEventFrameHits` on `[eventDays, poseKey, bins]`. Shares the panel's RANGES chips. Rows:
light dot · date · hh:mm · SET/RISE/G·AM/G·PM · CLEAR/✕/— · ±°/d + `.pp-ics`
(`icsForSunEvent`). `NEXT · <date> <time> <kind>` headline (.fnd-ctx). Jump = setTime +
bodyTarget("sun") + visible, camera unmoved. observer ground 0 / eye 1.6 (house default).
SUNSET_MAX_ROWS 21. GOLDEN imported from globe/tuning (panel-side, legal).

## Mobile — PlanSheet `SunsetSection` (sibling AFTER FindSection)
Same two memos + usePoseKey gate; m-row grammar, no ics (sheet-lean rule), SUNSET_MAX_ROWS 12,
SET/RISE/GOLD + FIND_RANGES chips. Composition: FrameSection → TodaySection → FindSection →
**SunsetSection** → MoonSection → SpotSection.

## Verified numbers (Dnipro pin 48.449313,35.102246, west heading 297, fov 40)
- Desktop 68°×40° frame /6M: 54 SET hits, Aug 7:56p→7:43p, drift −0.5°/d; jump →
  2026-08-16T16:52:43Z = the row's 7:52p exactly; HUD sun 292° W · −0.9° ON the skyline.
- ✕ verdicts honest: measured skyline 13.9° @ 293° (street pin, buildings).
- /m 22°-wide frame: 11 SET events; GOLD on → 33 (G·PM ~7:30p rows).

## Deliberately NOT in this slice
- No ghost projection for event rows (store/find `_syncGhosts` is single-writer per shell —
  a second writer clobbers; merging into the FindPanel ghost effect = future work if wanted).
- Sunset CORRIDOR arc-pair on the skyline = spec V2 stretch (T8's natural vehicle, open).

Related: [[project/wip-2026-08-14-find-rework]] [[project/wip-2026-08-14-find-accuracy-labels]]
[[project/wip-2026-08-14-night6-hover-floor]]
