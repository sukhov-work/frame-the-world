# WIP 2026-07-11 — Pre-S7 refactor SESSION 2 (safe local-verified tier finished)

**Mode:** implement (governed), Deep tier (investigate-design-v3 under /frame). Ultracode session.
**Mission:** finish the pre-S7 safe/local-verified backlog from `archive/ARCHITECTURE_REVIEW.md` (session 1 shipped
B1–B5/B7/B14/B18). This session shipped **B6, B8, B9, B10, B11, B12, B13, B14(index), B15, B26** — everything
except **B19** (the browser-verified orchestrator `update()` split, still pre-S7) and **B20–B25** (S7-folded).

## Verified
`npm test` **323** passing (314→323: +9 new lib tests) · `npx astro check` **0 errors** · net **−68 LOC**
(261 ins / 329 del across 17 files) + 8 new lib modules + 3 test files. Adversarial verification: a 3-reviewer
Workflow (const-value fidelity · extraction equivalence · layering/completeness), each with real git-diff
investigation → **0 findings**. NOT browser-run (no runtime paths changed — pure extraction/rename/constant-promotion).

## What shipped (each = extraction + rewire, behavior-preserving)
- **B6 shared geo/math → lib** (all pure, tested):
  - `lib/geo/terrain.ts` `clampGroundM(h)=min(max(h,0),9000)` + `MAX_TERRAIN_M=9000` — replaced the 7
    inline `Math.min(Math.max(x,0),9_000)` sites in StylizedTiles (the S2 negative-heightAt discipline).
    NAMING NOTE: file is `terrain.ts` not the review's tentative `ellipsoid.ts` (it's a terrain-height clamp).
  - `lib/geo/screen.ts` `clientToNdc`/`ndcToClient` — replaced 6 inline NDC↔client px formulas (y-flip + round).
  - `lib/geo/heading.ts` `wrapHeadingDeg`/`headingDeltaDeg` **MOVED OUT of store/camera** (importers:
    StylizedTiles, PhotoDetailPanel, CameraTiltPanel → lib now; heading tests → `test/lib/geo/heading.test.ts`).
  - `sensors.ts` gained `focalFromHorizontalFov(hFov)=18/tan(hFov·π/360)` (twin of focalFromVerticalFov) →
    consumed by `store/upload.openSavedPin` (was inline `18/Math.tan(((hFov·π)/180)/2)`).
- **B8 lib→store layering** — the ONLY violation was `lib/save/pinBody.ts` importing derivedFov/AdjustableParams/
  Placement from `store/upload`. Moved the whole pure param layer → `lib/decode/params.ts` (Placement,
  AdjustableParams, AdjustableKey, ParamSource, exifBaselineParams, missingParamKeys, paramSource, isDirty,
  derivedFov, D4_KEYS). `store/upload.ts` re-exports the surface for back-compat (panels/tests untouched);
  pinBody imports from `lib/decode/params`. `grep store/ src/lib` now = comments only (no import).
- **B9 single-source shapes:**
  - `lib/geo/coerce.ts` `numOrNull`/`strOrNull` — replaced the local dups in `lib/wix/pinRecords.ts` +
    `store/pins.ts pinFromItem`. (pinRecords' RANGE-checked `num(v,min,max)`/`str(v,maxLen)` stay — untrusted input.)
  - `lib/pins/fields.ts` `CameraPoseOptics` (11 nullable pose/optics fields) — `extends` by SavePinBody +
    PhotoListItem (pinRecords), PublicPin (pins), and `SavedPinView extends Partial<CameraPoseOptics>` (upload).
    Type-only; astro-check-validated field-set identity (reviewer confirmed no field dropped/added).
  - `store/pins` bad-data precision fallback `"1km"` → `DEFAULT_PRECISION_TIER`.
- **B10 `lib/api/http.ts`** `json()` + `requireMember({full?})` — killed the 3 duplicated `json` helpers +
  the getCurrentMember try/catch in api/{photos,upload-url,ping}. POST/PATCH use `{full:true}` (need
  profile.nickname/loginEmail for authorName); GET/DELETE/upload-url id-only. Server-only (pulls @wix/members).
- **B11 typed DEV seams** — `src/global.d.ts` `declare global { interface Window }` for all 8 `__*` seams
  (__globe/__renderer/__composer=unknown; the 5 stores typed). Replaced every `(window as any)`/`(window as
  unknown as {...})` in GlobeCanvas/StylizedTiles/pins/save/upload with plain `window.__X =`.
- **B12 `GlobeControlsInternal`** interface (zoomDelta/up/getUpDirection/_applyRotation) — `const zc =
  controls as unknown as GlobeControlsInternal` replaces `controls as any`; tiles.ellipsoid cast typed too.
  **requestJson portion DECLINED** — uploadMedia's requestJson has no true 2nd consumer (geocode's error
  contract differs; forcing it would be a lossy abstraction). Falsification-gate call, noted.
- **B13 ~20 magic numbers → tuning** — new **ORCH** group (maxFrameDtMs 100 · clickDragPx 6 ·
  groundGuardMaxAltM 50000 · mirrorEveryFrames 12 · tilt/heading/zoom mirror deadbands · screenMoveMinPx 2 ·
  errorLogThrottleMs 2000) + additions to CONTROLS (glide-arrival epsilons + rate deadbands), FPV
  (fovArriveDeg · anchorGroundEveryFrames · vertEncoderBaseM 8 · tempLookAheadM 50), FRUSTUM (resnapEveryFrames
  120), TEMPPIN (screenSyncEveryFrames 6 · onScreenMargin 1.02), SUN (keyLightFarM 1e7). Pure math-degeneracy
  guards (1e-6/1e-9…) intentionally LEFT inline (not tunables).
- **B14** tuning.ts section-banner index at top (30 groups in file order, incl. ORCH).
- **B15** save.ts `BUSY_PHASES`/`isBusy` (unified guard; slightly STRICTER for update/delete — also blocks
  during a concurrent save's upload-* = correct invariant) + `toApiError(e, fallback)` (3 catch blocks).
- **B26** update() catch = log-once-then-throttle (`updateErrCount` + `lastUpdateErrLogMs` closure state,
  ORCH.errorLogThrottleMs) — no more 60 fps console flood on a persistent error.

## STILL PENDING (next session, from archive/ARCHITECTURE_REVIEW.md)
- **B19 (owner's explicit pre-S7 ask, browser-verified) — NOT DONE, but FULLY SCOPED.** Split StylizedTiles
  `update()` (~920 lines) into named step-fns over an explicit FrameContext, EXACT per-frame order preserved.
  The B6/B12/B13/B26 scaffolding it needs is now IN PLACE. **Execution playbook prepared this session:**
  `.claude/claude-docs/archive/B19_HANDOFF.md` — a 36-step ordered map (line ranges + purpose + signature), a concrete
  `FrameContext` TS type + the closure-state-that-stays list, **13 load-bearing traps with guards** (the crown
  jewels: `++frameCount`@L1419 splits cadence gates into pre/post groups · `camNow`(L750) vs `camStore`(L991)
  dual getState() snapshots with store-mutations between · `controls.adjustCamera` must run EVERY fpvActive
  frame OUTSIDE the `!flight.active()` guard · `_focus`/`_focusUp`/`alt` frozen-for-frame · the exact
  `updateMatrixWorld` flush sites incl. idle-drift's deliberate omission · 3 fresh `performance.now()` calls ·
  `lastInteract` 12-writer shared mutable), a mechanical migration recipe (extract as same-scope closures FIRST
  → thread FrameContext LAST → astro check+npm test after each), and a 14-flow browser verification checklist
  with DEV seams. Built from a 5-agent (4 analysts + synthesizer) workflow. **Delicate; do unhurried, browser-verify.**
- **B20–B25 fold into S7** (browser/shader/precision).

## Related
[[core]] · [[project/wip-2026-07-11-pre-s7-refactor]] (session 1) · `archive/ARCHITECTURE_REVIEW.md` ·
NEXT_SESSION_PROMPT.md · [[patterns/globe-rendering]] · [[decisions/session_workflow]]
