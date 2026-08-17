# wip 2026-08-18 — UPLIFT U2 SHIPPED: FPV stability (the point-6 re-render/jerk bug)

## What shipped (owner point 6; DECISIONS 2026-08-18-u2-fpv-stability; ran via investigate-design-v3 implement mode)
All 8 UPLIFT_PLAN §1.3 mechanisms fixed, instrumented, and soak-proven:
- **A9 LRU floor (the "full re-render" root)**: mid/low caps 256/160 MB sat UNDER the library's
  untouched `minBytesSize` 0.3 GiB → inverted eviction band; AND `TilesRendererBase.js:1789`
  DISCARDS a freshly parsed tile when `isFull()` → parse→discard→re-download loop. Fix: pure
  `lruFloorBytesForCap(cap)` = cap×0.75 (the library's own 0.3/0.4 ratio; null→null) beside
  every maxBytesSize write; each module captures BOTH library defaults, `high` restores both.
  Soak pairs: mid 192/256 · low 120/160 · high 307/410 MB.
- **A9 governor gate**: GlobeCanvas parks tier changes in `pendingTier` while
  `tilesHandle.fpvActive()`; lands first non-FPV frame; DEV `force()` immediate + clears it.
  `applyTier` skips renderer+composer realloc when effective DPR unchanged.
  UNVERIFIED tail: the natural-governor deferral (M3 Pro never governs down; force bypasses
  the gate by design) — weak-device run rides T1.
- **A2 zoom bank**: `resetState()` never clears `zoomDelta`; disabled `update()` never consumes;
  stepZoomBrakeAndEase SLOSHES the bank pendingZoom↔zc.zoomDelta so it is CONSERVED across any
  FPV session and discharged at exit. Fix: `zeroZoomBank()` at entry (both kinds) + exit.
  Soak: {0,0} at every boundary; exit-alt drift 0.00 m/2 s. (/m tilt gesture never disables
  controls — no bank path there.)
- **A1 entry-frame gate**: `fpvEntryPending()` (store wantKind + fpvJumpRequest) gates
  `stepControlsUpdate` — the transitions step runs AFTER controls.update, so the entry frame
  could discharge bank/drag before the entry code zeroed it.
- **A4 eased temp-pin ground**: `tempPinPoint()` re-samples heightAt per frame → LOD refine
  teleported the temp-FPV eye. Fix: eased applied ground (`seatStep`, `TEMPPIN.groundEaseK`
  0.12; first REAL sample snaps — `tempPinSampled` flag; frame-STAMPED — the fn runs ×4/frame).
  Measured: old double-teleport (0→28.9→76.4 m) is now a ~3 s glide, steps = (raw−applied)×0.12
  exactly, zero after settle.
- **A5 eased enriched group seat**: the group lift was the one unsmoothed layer. `seatAppliedM`
  rides seatStep; per-cell targets reference the APPLIED seat → sampled cells stay exactly on
  their own terrain mid-slide (sum invariant), unsampled cells glide.
- **A4-photo**: cadence `frustum.resnap()` (a snap rebuild) skipped while photo-FPV; frameCount
  still ticks (cadence-split contract).
- **A8 noteInteract guard**: in FPV only `lastInteract` updates — wheel/pointer no longer
  cancel the ENTRY flight (browser-real teleport pre-fix). Exit fly-out still cancels on grab
  (fpvActive false there). Soak: 6-tick wheel burst at entry-flight t+400 ms → flight survived
  (530 m mid-arc → landed 78 m).
- **A7**: `lastGroundM = null` at FPV exit (street-floor guard freezes it during FPV; stale
  high ground clamped the fly-out upward).
- **A11**: window-resize listener refreshes `setResolutionFromRenderer` on all three tile
  renderers (was one-shot → stale SSE denominator after resize/orientation); stars gain
  `setDpr` (uDpr captured once), refreshed on tier change via applyQualityTier.

## Instrumentation (DEV)
`__globe.u2()`: zoomBank, tempPinGround raw+applied, lastGroundM, enriched seatState epoch,
per-renderer LRU min/max, `jumps` 50-ring of single-frame eye moves >0.5 m (walk-attributed —
full-deflection sprint is ~1.15 m/frame ≈ 66 m/s BY DESIGN, so only walk:false counts as a
teleport) + `jumpsTotal` monotonic. `__quality.pendingTier` + `tierLog`.

## Verification
Gates vitest **926/926** (+4 lruFloor) · astro 0 err/5 hints. Browser (wix dev + Playwright,
desktop 1440×900 + phone 402×874): zero non-walk jumps through 4 s analog walk + 20-step
look-drag + ±6 h scrub + high→mid→low→high flap on both shells · bank {0,0} at all boundaries ·
exit fly-out 278 m drift-free · entry flight survives wheel · /m FPV exit lands 2D nadir 679 m
(U1 contract intact) · orbit wheel zoom unaffected (280→362→294 m) · console = pre-existing
noise only. Shots `verify-shots/u2-01..04`.
**UNVERIFIED:** natural governor deferral (needs a device that actually governs down) ·
real-device feel — both ride T1.

## TRAP (cost a full soak restart)
Headful CDP Chrome that gets OCCLUDED → `visibilityState: hidden` → rAF stops COMPLETELY (not
throttled): stores update, probes answer, and every "zero new events" assert passes VACUOUSLY —
the engine looked "stuck in FPV" (store exit flag flipped, no frame ever ran the transition).
Recipe: launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
--disable-background-timer-throttling` AND embed an rAF-tick counter in every probe result.
`/json/activate/<id>` raises the tab but does NOT un-occlude a covered window.

## Open tails
- U3 next (fullscreen map + minimap view cone — UPLIFT_PLAN §2/U3).
- T1 real-device: U1 gestures + U2 governor-on-weak-device + pinch suppression.
- Taste: settle glide is visible ~3 s on cold-load FPV entry (honest streaming correction;
  alternative = hold the flight until terrain settles — owner call if it reads odd).

Related: [[project/wip-2026-08-17-u1-2d-mobile]] · [[project/wip-2026-08-17-p7-meteors-uplift-plan]] ·
UPLIFT_PLAN.md §2/U2 + §5 log · [[bugs/fpv-walk-orbit]] (the OTHER, already-fixed FPV bug).
