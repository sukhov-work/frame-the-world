**ARCHIVED (2026-08-15)** — superseded by `mem:project/wip-2026-08-14-mobile-m3c` + DECISIONS 2026-08-14 lines.

# WIP 2026-08-14 night-5b — Mobile M3a (dock v2) + M3b (PlanSheet twins) [SHIPPED phone-viewport]

Twin: DECISIONS 2026-08-14 night-5b. Gates: **vitest 851/851 · astro 0 err/5 hints**; phone
402×874 browser-VERIFIED on /m (shots `verify-shots/mobile-m3a-01-dock-v2.jpeg`,
`mobile-m3b-01-plansheet.jpeg`, `mobile-m3b-02-find-section.jpeg`). REAL-DEVICE tier open (T1).
**M3c NOT started** — next: GHOSTS controls → mobile TARGET sheet · long-press sky-menu
trigger · hover-names tap-to-reveal variant.

## M3a — MobileTimeDock v2 (rewrite)
Old clamped ±12 h knob → the desktop TimeScrubber v2 conveyor at phone scale:
- Fixed centre cursor (accent live / warn pinned + pennant); drag slides timeline (left =
  forward). Conveyor math verified EXACT (−200 px → +6.43 h = predicted).
- Full `lightSegments` bands (desktop hues verbatim), compact sun/moon curves + target trace
  (strokes 4/2/1.4; frame emphasis rides the same azAltFrameMarker frameTest), REAL hour ticks
  + labels every SCRUB.hourLabelEvery, midnight full-strip.
- Outer-zone tap = next/prev almanac event (on-demand dayEvents+moonPhaseEvents fallback when
  the planFeed mirror is cold); dblclick middle = NOW; keyboard slider parity.
- Span memo 2× window keyed scene-HOUR + 0.05° eye. No store writes per frame; no recentring
  (window centred by construction). Rail 40 px = 2/28/10 (ts-rail 48/3/32/13 twin, lockstep
  comments both sides). dock.css rail internals rewritten (md-light/md-curves/md-ticks/
  md-cursor); md-twilight/md-knob/md-track deleted.
- SVG path builders (curvePath/tracePaths) = ACCEPTED two-shell duplication of TimeScrubber's.

## M3b — PlanSheet v2 (five self-computing twins, deck order)
- THIS FRAME (frameCrossings 36 h + nearestFrameCentre chip; FPV pose-key gated).
- TODAY (dayEvents+moonPhase chronology, light dots, R5 sun-at-moonrise; REPLACES the M1 raw
  chips section).
- **FIND IN FRAME — the sheet IS the store/find ghost WRITER on /m** (desktop FindPanel not
  mounted there; single-writer preserved per page). Mount → find.setOpen(true) (ghost
  projections draw on the mobile globe — scene/findGhosts is shared); unmount → setOpen(false)
  + _syncGhosts(null,[]). Two-stage memo copied (positions pose-free / hits pose-cheap),
  `active = poseKey !== null` gate (boot-flight-freeze lesson), colours findStandingColorIdx,
  illum in mirror. VERIFIED: 38 standings @60° FOV → 24 projected; row tap = setTime exact
  (wall-clock preserved) + camera UNMOVED + bodyTarget tracked; sheet close → ghosts 0.
- MOON (moonCalendar 8 rows + supermoon chip) · SPOT STARS (NPF, frame-auto cos δ).
- NEW chrome.css grammar: m-rows/m-row(__jump/__none/__glyph/__time/__kind/__meta)/m-dot--
  {day,golden,blue,nautical,astro,night}/m-sw/m-npf(__field/__big)/m-in — pp-day__row twins.
- MobileShell brand "Frame&nbsp;the&nbsp;World" → "Sidera" (night-4b sweep missed it — the
  `&nbsp;` entities defeat a plain grep; sweep lesson).

## Verify traps (NEW, load-bearing)
- **Unselected/background tab throttles setTimeout to ~1/min** — a 60 s poll loop hangs the
  evaluate 120 s+ (the rAF-suspension trap's TIMER sibling). Keep the verify tab
  window-selected for the WHOLE session; if an evaluate hangs, select the tab first.
- **/m `#f=` FPV hash entry engages only after tiles+terrain stream around the pin** —
  ~1–3 min on the mobile texture tier (desktop ~20 s). Poll `__globe.fpv().active` without a
  fixed budget; `tempFpv:true + active:false` = still streaming, NOT broken.
- PLAN tab open = plan.setOpen(true) AND (new) find.setOpen(true) — closing the sheet stands
  both down.

Related: [[project/wip-2026-08-14-find-accuracy-labels]] [[project/wip-2026-08-13-m2-fpv-touch]]
[[project/wip-2026-08-14-find-rework]]
