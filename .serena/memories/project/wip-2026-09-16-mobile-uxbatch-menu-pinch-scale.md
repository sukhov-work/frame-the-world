# wip 2026-09-16 — THE MOBILE UX BATCH: the PLUX menu · the finger-proportional pinch · rise/set + long-press aim · scale bars — DONE

Mode: implement (`/frame`), four owner asks, all `/m` only. Records: DECISIONS 2026-09-16 · `conventions/globe-tuning.md`
(the pinch family) · `NEXT_SESSION_PROMPT.md` · `mem:core`. Gates: vitest 3,117 + the new files · astro 0/0/12 · knip 0 ·
`verify-uxbatch-2026-09-16.mjs` 31/31 on the house Chrome (`verify-shots/uxbatch-2026-09-16/`).

## 1 · THE PINCH (ask 1) — `lib/globe/pinchZoom.ts` · `CONTROLS.pinchZoomGain` 0.75 · `StylizedTiles.stepZoomBrakeAndEase`
- The owner's "multiplier" was real, twice over. (a) `3d-tiles-renderer@0.4.28`'s touch pinch is a PIXEL delta:
  `zoomDelta += dist − previousDist` per pointermove, `_updateZoom` moves by `zoomDelta · dist · zoomSpeed · 0.0025` —
  1.25 %/px of the camera→ground distance at zoomSpeed 5 whatever the fingers' separation (120 → 220 px ≈ 2.9× on the
  2D map vs 1.83× finger-glued; a narrow start runs away). (b) `PointerTracker.previousPositions` move ONCE per frame
  (`updateFrame()` at the end of `update()`), so k touch events per frame count the spread ~(k+1)/2 times — a 120 Hz
  phone at 60 fps pinches ~1.5× faster per px than a 60 Hz one.
- Fix: pre-update on a touch-ZOOM frame (`zc.state === 3 && isPointerTouch()`), read the tracker's TWO distances
  (`getTouchPointerDistance` / `getPreviousTouchPointerDistance`), `logStep = gain · ln(dNow/dPrev)`, hand the library
  `(1 − e^{−logStep}) / (zoomSpeed · 0.0025)` so its multiply equals `(dPrev/dNow)^gain` at the frame's braked speed;
  zero the library's own sum. Frame factors compose → the gesture lands at `(d0/d1)^gain`.
- TRAP (twin-caught, 0.72 for an expected 0.59): NEVER route the pinch through the wheel's eased bank — `_updateZoom`
  early-returns and zeroes `zoomDelta` once `getLatestPoint` is null, i.e. the moment the last finger lifts (touch has
  no hover) — the eased tail is DROPPED. Direct, same frame. Second twin read (through the library's per-event sum):
  gain 1.02 for 0.75 — that is finding (b). Final twin: 0.624 for 0.595 (the ~4 px·DPR classification loss).
- The MapWindow chart's pinch reads the SAME exponent (was a local `PINCH_SENS 0.8`); the wheel keeps `zoomSpeed`;
  the FPV lens pinch (ratio-exact already) is untouched; the near-ground brake no longer applies to a touch pinch.
- Source pins: `test/lib/globe/pinchZoom.test.ts` (the accumulate line, the 0.0025, `updateFrame`, `const ZOOM = 3`).

## 2 · THE PEEK (ask 2) — `mobile/TargetPeek.tsx` · `lib/ephemeris/riseSet.ts` · `store/skyAim.aimAtSkyBody`
- `nextRiseSet(target, fromMs, lat, lon)`: sun/moon → the planner's own `SearchRiseSet` through `planElevationsM`
  (one sunrise per app); everything else → the first crossings of the REFRACTED horizon (`HORIZON_ALT_DEG` −34′) of
  `targetAzAlt`, 10-min scan + 16 bisections; null = none in 48 h (circumpolar / never-up → em dash).
- Rendered as two stacked clocks `↑ 05:42` / `↓ 19:43` (`.m-peek__rs`, browser-local `localTimeStr`) left of the
  bearings; memo (target · 0.01° · 10-min bucket), re-solved the moment a shown instant passes.
- LONG PRESS on the NAME → `aimAtSkyBody("target")`: FPV = `gotoSkyBody` (the look glides; below the horizon → the
  rise azimuth), map = the PLANNED view's heading turns to the body (the 2D north lock would fight a heading glide).
  Arms only when the press STARTS on `.m-peek__name`; the rest of the row stays tap-to-open.
- HARDENING the TabBar twin lacks: the press is judged on RELEASE by `e.timeStamp` deltas as well as by the timer —
  a stalled FPV main thread (T77 cell landings) never gives a timer its 500 ms between a touchStart and a touchEnd
  that arrive together. TabBar / MapModeChip still timer-only (a tail).

## 3 · THE PLUX MENU + the top row (ask 3) — `MobileShell.tsx` · `MobileAccount.tsx menuItem` · `mobile.css` · `fpv.css`
- The wordmark is a `<button aria-haspopup="menu">` with a muted `▾` hint; `.m-menu` (fixed under the strip, z 10)
  holds SIGN IN / member · GUIDE · DESKTOP as `.m-chip.m-menu__item[role=menuitem]` rows with hints; `.m-menu-scrim`
  (z 9) closes; Escape closes. The DESKTOP anchor keeps `href="/?d=1"` + the click-time hash (harnesses updated:
  `verify-guide.mjs`, `verify-uxbatch5.mjs` open the menu first).
- The FPV HUD pill moved ONTO the strip's right (`.m-fpvhud` top 0.48rem, right 0.9rem; font 0.58/keys 0.46, gap 8 —
  the first cut at 0.62 was 302 px wide and overlapped the 81 px wordmark; keys hidden ≤ 22.5rem). The minimap card
  rose 5.6rem → 2.9rem (`body.m .mm`).

## 4 · THE SCALE BARS (ask 4) — `lib/format/scaleBar.ts` · `mobile/ScaleBar.tsx` · `MapWindow.tsx` · `camera.mapScaleMPerPx`
- ONE rounding rule (the largest 1/2/5×10ⁿ under a 110 px budget) for both surfaces. The 2D map: the orchestrator
  mirrors `|camera − focus| · 2·tan(vFov/2) / viewportH` at the pose cadence (1 % deadband, null past the limb);
  `ScaleBar` sits in `.m-status__right` only in `mapMode === "2d" && !fpvOn`. The chart: `metersPerTilePx(lat, z)` at
  the live continuous z inside `draw()`, published only when the rung/width moves (`.mw-scale`, under the pills, /m only).

## Traps paid for
- CDP: a `Page.navigate` after a touch sequence leaves headless Chrome delivering synthesized CLICKS but NO pointer
  events on the next document (the row saw `click` alone, the chart canvas nothing) — an emulation artefact; the
  harness attaches a FRESH target per page. A pinch finger landing on the AIM joystick (x ≤ 126, y 435–545, z 24 over
  the chart) is silently eaten — seat harness pinches clear of it. The chart opens at its MAX zoom in FPV: only a
  pinch OUT can move it.
- Never edit a served `src/` module while the harness runs (HMR). `wix dev` restarted with `.vite` aside, as always.

Related: [[project/wip-2026-09-08-mobile-uxbatch-heatmap-gestures]] [[project/wip-2026-09-11-audit4]]
