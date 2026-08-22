# AUDIT #3 FIX SLICES F1–F10 — ALL SHIPPED (2026-08-22d)

Report the slices came from: `.claude/claude-docs/audits/audit-batchseams-2026-08-22.md`.
Registry: T32/T35/T36/T37/T38/T39/T40 all CLOSED; **NEW T41 + T42**.
Gates at wrap: **vitest 1,217/1,217 (107 files)** · `astro check` 0 err / 5 hints ·
**`npx knip` exit-0 clean** · all seven regression suites + the NEW `verify-audit3.mjs` PASS.

## What a future session must NOT relearn

### The audit's own finding bit the HARNESS, live
`verify-qaslice-cab.mjs` hand-transcribed the chart's anchor ladder to check where ◉ centres —
the exact C8 anti-pattern the same audit flagged for `chartWalkAzRad`. The moment F4 hoisted
the ladder and dropped the bare-`camGeo` NADIR rung, the copy went stale and the check **failed
by 81.8 m against an app that was correct**. Fix was NOT to re-transcribe: the chart now
PUBLISHES its resolved anchor (`__mapWindowView.anchorLatDeg/anchorLonDeg`) and the script
READS it. **RULE: a verify script never re-derives a shipped decision — it reads the result.**

### The T32 test found a second throw site inspection had missed
Clamping the Observer height alone was not enough. `SearchRiseSet(..., metersAboveGround)`
builds a SECOND observer at `observer.height − metersAboveGround` and runs THAT through
`Atmosphere()` — so a clamped 10 km observer against an un-clamped 6,000 km eye threw
`Invalid elevation: -5990000`. `planElevationsM()` is the ONE writer of both now, with
`obsM − eyeM` in band by construction. Only writing the test surfaced it.

### The audit's literal one-liner would have been a regression
A1-4's stated fix was `entry.img.onerror = () => { console.warn(...); cache.delete(url); }`.
`draw()` runs at ~20 Hz while FPV is live, so an unguarded eviction turns ONE 404 into a
20 req/s storm. Shipped shape: `failedAtMs` + a `TILE_RETRY_MS` 30 s cooldown + a warn capped
at 8. **Read an audit's "specific fix" as a direction, not a patch.**

### Two "kept deliberately" decisions, dated (A2-4/A1-12)
`setPlannedView(null)` has no call site, so three branches are unreachable in the shipped
config. They are KEPT as documented ENGINE-ABSENT GUARDS, not deleted, because two real states
still reach them: a build without `PUBLIC_CESIUM_ION_TOKEN` never attaches the orchestrator
(the chrome still mounts), and a `#f=` boot straight into FPV defers the boot seed to the first
exit. Sites: `StylizedTiles.ts` FPV-entry basis fallback · `Joystick.tsx` first-touch seed ·
`SceneActions.tsx` `lastFpvFovDeg`.

## The shape of each slice (files that matter)

- **F1** `lib/ephemeris/planner.ts` (`planElevationsM`, T32) · `panels/MapWindow.tsx` (tile
  `onerror` + cooldown) · `scene/aimCones.ts` (`if (moved) groundM = NaN` — the other three
  rebuild triggers move no anchor, and re-seating there pops the radar to ellipsoid 0 if
  terrain answers null) · `tuning.ts` (emphasis gates the FILL WASH ONLY) · `GlobeCanvas.tsx` +
  `global.d.ts` (`__globeQuality` registered, de-cast, **live getters**, `flat2d`→`leanFlat2d`
  + a new honest `mapFlat`).
- **F2** `lib/geo/plannedView.clampPlannedView` applied once at `store/camera.setPlannedView`.
- **F3** `scene/focalCone.ts` (fixed-size Float32Arrays + `needsUpdate`) · NEW
  `lib/theme/cssInk.ts` (memoised token cache, with a real `invalidateCssInk` seam) ·
  `GlobeCanvas.tsx` PiP `shadowMap.autoUpdate` bracket.
- **F4** NEW `lib/geo/aimAnchor.ts` — FPV eye → placed photo → temp pin → view focus.
- **F5** NEW `lib/geo/radarBands.ts` · `scene/tangentOverlay.ts` · `panels/radarCanvas.ts` ·
  `slippy.chartTransform/rotFwd/rotInv`.
- **F6** NEW `scripts/verify-cdp-cleanup.mjs` (wired into ALL 20 verify scripts) · NEW
  `test/styles/_css.ts` · `horizonProfile.skylineBinsFor` + `PLAN.minCoverageForGaps` (A1-16).
- **F10** NEW `components/mobile/useSheetInputFocus.ts` + `mobileFence` rule 4.

## Harness facts worth keeping

- `trackTarget` + `finishVerify` close CDP targets over plain HTTP (`/json/close/<id>`) and
  from the `uncaughtException`/`unhandledRejection` handlers — the only `finally` a
  top-level-await module has. `fail()` helpers THROW `VerifyFailure` rather than
  `process.exit`: an `await finishVerify()` there would let the script run past its own failure
  (every call site is `if (x) fail(...)` with no await).
- **`Page.navigate` to a URL differing only in its HASH does not reload**, and `/m` re-mirrors
  the camera into `location.hash` ~1.6 s after boot — bounce through `about:blank` first. This
  is what broke the guide-shot script's second (warm) pass.
- Source fences must strip comments before probing: the docblocks deliberately NAME
  `autoFocus`, `AIMCONES.band*` and `getComputedStyle`, and a fence that fires on prose just
  gets the prose reworded.

## Measured numbers

- Camera NADIR vs view FOCUS on a tilted desktop orbit: **4,341 m** — the size of the F4 bug.
- focalCone BufferGeometry uuids identical across a 79.6°→90.0° sweep (T38 realloc gone).
- `plannedView` clamp at the store seam: 0.4 / 1.27 / 122.4 / 5000 / −3 → all inside [3, 120].
- jscpd 35 clones / 1.14 % → **33 / 1.06 %**.
- vitest 1,196 → **1,217**; astro-check files 369 → 384.

## Open, and why

- **T41 (NEW, owner ruling wanted)**: the FPV HUD prints the focal from the VERTICAL fov
  (24 mm frame height) while the AIM stick prints it from the HORIZONTAL fov (36 mm width).
  Both correct, they agree at 3:2 — but a portrait phone shows **23 MM and 75 MM for the same
  view**, side by side, in `public/guide/fpv-m.webp`. Not touched unilaterally.
- **T42 (NEW)**: 8 of 12 guide shots still date from 2026-08-15. NEW reproducible
  `scripts/shoot-guide.mjs` makes each one a recipe; crops are owner taste.
- **T38's ms cost is still UNMEASURED** — the device half rides T1.
- Two honest SKIPs in `verify-audit3.mjs`, recorded rather than passed blind: the placed-photo
  anchor rung (needs a real upload) and the SAVE VIEW focus check (member-gated chip).

Related: [[project/wip-2026-08-22-audit3]] · [[project/wip-2026-08-22-owner-microslice]] ·
[[decisions/session-end-autoship]]
