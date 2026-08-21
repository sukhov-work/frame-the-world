# wip 2026-08-21f — OWNER QA BATCH (7 items after device QA) — COMPLETE

DECISIONS 2026-08-21f. Gates: vitest 1,116/1,116 (+7) · astro 0 err/5 hints · regressions
uxbatch4 23/23 + s2 16/16 + s3 18/18 + uxb5 17/17 + uxb6 12/12 ALL PASS + NEW
`scripts/verify-uxbatch7.mjs` 22/22 (shots uxb7-01..06). Item 7 was a QUESTION (answered,
no code). NOTE: the owner's two comparison screenshots arrived as byte-identical placeholder
icons AGAIN (the batch-#5 corruption) — item 7 answered from pipeline code instead.

## What shipped (root causes)
1. **Radar follows the viewer in the expanded minimap (QA-1)** — two detach mechanisms:
   (a) MapWindow `aimAnchorNow` was tempPin-first (batch #6) → radar on the pin while
   cone/eye-dot rode camGeo. Now **FPV-live ⇒ camGeo first** (`(fpvHud ? camGeo : null) ??
   tempPin ?? camGeo ?? focus`); outside FPV batch-#6 pin-first stands. (b) placing a pin
   under a LIVE temp FPV re-posed per-frame with the OLD pin's ENU basis + stale
   fpvWalkOffset ⇒ eye landed |walkOffset| off the new pin. NEW `fpvPinKey` closure in
   StylizedTiles: pin change ⇒ re-seat basis at the new pin (current world-dir → heading
   carried, elevation → fpvPitch, fpvYaw 0) + `fpvWalkOffset.set(0,0,0)`. Verified: eye
   0.0 m from pin after place, map stays open. Plus **FPV follow** in MapWindow.draw —
   rubber-band recentre when the eye leaves `FPV_FOLLOW_FRAC 0.12` of min(w,h) (skipped
   while pointers active; supersedes batch-#5 "chart deliberately does not re-centre" FOR
   THE FPV-LIVE CASE). **Radar size unified**: NEW `AIMCONES.mapRadiusHK 0.5` — rBase =
   h × 0.5 (× mobileRadiusK on /m), the GL fan's fraction-of-height equivalent
   (radiusAltK/tan(POSE.fovDeg/2) ≈ 1.02 × half-height); replaces 0.3 × min(w,h) (≈3.7×
   too small on a phone). Draw + tap-promote hit test mirror (both sites edited).
2. **FPV entry preserves the focal cone (QA-2)** — entries ignored plannedView: (a)
   no-share temp entry (LOOK FROM HERE / placed point) built its basis from camera-forward
   which DEGENERATES TO NORTH at the /m 2D nadir, FOV hardcoded tempFovDeg 55. Now
   plannedView.headingDeg steers the basis (share-branch code shape) + FOV =
   clamp(verticalFovDeg(plan.hFovDeg, camera.aspect)) — `verticalFovDeg` (lib/decode/
   sensors) is the inverse of horizontalFovDeg, newly imported into the orchestrator.
   (b) SceneActions long-press ▲3D jump used cam.headingDeg (the 2D MAP-UP bearing, not a
   view) + lastFpvFovDeg. Now plan-first, old values fallback (plan re-seeds on FPV exit so
   "last focal" intent survives inside it). (c) desktop MapWindow viewFromHere hardcoded
   north/55° → plan-first too. Verified: entry heading 137.0 exact, fov 76.5 = expected.
3. **Radar occlusion gaps (QA-3)** — research VERDICT: gaps NEVER existed on any radar
   surface at any commit (7 git -S probes, U4 birth blobs, S2 diff — owner's regression
   suspicion refuted; the time-rail trace + horizon rise/set gaps are what they remembered).
   Implemented as a NEW capability: pure `fractureRunsBySkyline(runs, sampler)` in
   azSector.ts (sample stays when altDeg ≥ skyline(azDeg); <2-sample sub-runs dropped;
   null sampler ⇒ untouched). Fills + rim arcs fracture; rise/set spokes + direction lines
   stay whole. Feeds: GL fan gets `skylineBins` via ctx (orchestrator resolves
   store/plan.profileBins behind the anchor guard; ARRAY IDENTITY = rebuild key);
   MapWindow + MiniMap sample `usePlanStore` directly + `sampleBins`. NEW
   `AIMCONES.skylineGuardM 60` — bins only apply when the plan anchor (photo apex/FPV eye)
   sits within 60 m of the radar anchor (honesty rule; plan anchor kind ≠ "focus").
   MapWindow subscribes usePlanStore for repaint. Verified: profile ready at 13.9 m from
   eye, arcs visibly fracture (uxb7-06 vs -04). GL-fan visual = T1 rider (needs a placed
   photo anchor).
4. **Time scrubber on the expanded map (QA-4)** — NO new component: /m lifts the REAL dock
   (`body.m.mw-open .m-bottom {z-index:24}` + `.m-peek/.m-tabs {display:none}` — display
   not visibility so the dock sits flush; React mounts stay warm) + dock inherits the tab
   bar's safe-area padding; desktop raises the REAL TimeScrubber over the window
   (`body.mw-open .ts {z-index:43}` — .mw is 42; MapWindow sets body.mw-open on BOTH
   shells). Bottom `.mw-hint` RETIRED (desktop hint → `.mw-tophint` in the top row; /m
   long-press action is guide-documented); `.mw-credit` re-seated top-left under the top
   row (Esri ToS attribution kept), /m max-width clears the 32vw PiP.
5. **/m chips under controls (QA-5)** — `.fh-chip` and `.m-joy` were BOTH fixed z-10 in one
   stacking context; the chips island mounts LAST in m.astro ⇒ painted above + stole
   touches. `body.m .fh-chip {z-index:9}` (one rung under all z-10 chrome).
6. **Search (QA-6)** — placeholders: desktop `TYPE TO SEARCH — e.g. m31 · moon · orion ·
   ngc 7000` / earth twin; /m `Type to search — e.g. m31 · moon · orion`. iOS dark-screen:
   React `autoFocus` fired while the sheet was at translateY(100%) ⇒ Safari scrolled the
   LAYOUT viewport to the off-screen input (Android resizes the visual viewport only ⇒
   unaffected). Now a mount `useLayoutEffect` calls `focus({preventScroll:true})` in the
   same discrete-event commit (user activation carries ⇒ keyboard still opens) + pins
   `window.scrollTo(0,0)` via rAF + 550 ms timer + a visualViewport resize listener (the
   /m shell is 100dvh — layout scrollY must always be 0). REAL-iOS feel = UNVERIFIED (T1).
7. **Map-quality question (QA-7)** — answered (analysis): /m default 2D map = the GL globe
   pipeline (MOBILE2D latch), expanded minimap = MapWindow raw canvas. Same Esri tiles; gap
   = (1) `esriMaxLevelCoarse 17` vs MapWindow z19 (4× linear texel deficit — the dominant
   cause), (2) leanMobile DPR 1.25 vs MapWindow DPR 2 (1.6× linear), (3) the stylized
   ground grade (gain 0.60 · desat 0.52 · waterDarken 0.35 · ambient wash ⇒ ~0.5-0.64×
   luminance) — ALL deliberate batch-#4-S3 iOS-jetsam/heat levers except the grade.
   Zero-cost close-the-brightness-gap candidate: lerp gain→1/desat→0/waterDarken→1 by the
   existing `uFtwFlat2d` uniform (2D-map-only, no memory cost). z18 (~4× deep-level GETs)
   + flat2d-only DPR 1.5 = the middle option. Owner to rule.

## QA-7 a+b FOLLOW-UP (same session — owner: "try both, I judge perf on device")
- **(a) PHOTOGRAPHIC 2D chart** — new `GROUND.flat2dPhotoK 1` → `uFtwPhotoK` uniform; shader
  `photo = uFtwFlat2d × uFtwPhotoK × (1 − uFtwDark)` lerps OUT the whole stylized grade
  (shade→1, desat→0, gain→1, cast→neutral, waterDarken/golden/moonlit/ambient→off) on the
  flat chart only; dark-CARTO mode keeps its look; DESKTOP nadir flat-map rides the same
  latch (one-flat-treatment doctrine — taste-pass item). A/B verified headed Chrome:
  raw crisp imagery vs the old dim grade (shots qa7-08/-09).
- **(b) crispness** — `TILESETS.esriMaxLevelCoarse 17→18`; `QUALITY.leanMobile.dprCap2d 1.5`
  applied ONLY while `TilesHandle.mapFlat()` (GlobeCanvas tick flips + re-applies tier; FPV
  keeps 1.25); AND the required third lever: `GROUND.overlayResolution2dPx 512` — the level
  chooser derives source zoom from resolution/rangeWidth, so the 256 lean composite alone
  pinned the chart one level shallow even with the cap at 18. stepGroundUpdate is the ONE
  writer of the effective composite px (raise on chart, tier base off it). z18 fetches
  CDP-verified (35 tiles at 220 m).
- NEW DEV probe `window.__globeQuality` = {tier, dpr, flat2d, lean} (written in applyTier).
- `verify-qa7ab.mjs` NEW (6 checks: flat-DPR tier-consistency, z18 via CDP Network, photo
  uniforms, FPV heat-cap return); `verify-uxbatch4-s3.mjs` DPR check SUPERSEDED (2D chart
  now correctly 1.5; the 1.25 FPV cap is locked by qa7ab).

## REGRESSION REPORTED post-push (owner 2026-08-21g-end — scheduled as NEXT_SESSION §0C, CRITICAL)
QA-7b's overlayResolution2dPx per-frame writer flips the composite 512↔256 on EVERY
2D↔FPV/3D transition → fresh-instance overlay rebuild each flip → white chart + vector ink
for seconds (10 s+ on device), tile-load storm ("zero cache"), then a blurry stall (the
rebuilt overlay likely never re-refines without camera motion — UpdateOnChangePlugin not
kicked). Desktop reproduces below tier `high` (tier 256 vs flat 512). Fix direction:
STICKY resolution (never flip on mode changes) + refinement kick after rebuilds; instant
mitigation: GROUND.overlayResolution2dPx → 256. The "flips are rare / no-op guard suffices"
cost call in this session's QA-7b was WRONG — record as a lesson: setOverlayResolution is
never cheap; treat ANY per-frame writer that can change its value on a mode flip as a
rebuild loop.

## Traps (QA-7 follow-up — expensive ones)
- **Injected-GLSL uniform declaration**: adding a uniform to the imageryGround JS `uniforms`
  object is NOT enough — the fragment-header injection DECLARES each `uFtw*` explicitly;
  a missing declaration makes the new program fail compile while tiles keep rendering with
  the previous program → live uniform pokes silently no-op (cost ~40 min: gain/fade/photo
  all "inert" until `uniform float uFtwPhotoK;` was added to the header block).
- **Headless verify Chrome governs to tier `low`** (slow frames) — absolute DPR assertions
  are wrong there; assert tier-CONSISTENCY via __globeQuality instead (a real iPhone runs
  mid → 1.5 on the chart).
- `performance.getEntriesByType("resource")` overflows at 250 entries long before deep tile
  levels arrive — count tile fetches via CDP `Network.requestWillBeSent`.
- /tmp/ftw-cdp profile PERSISTS prefs (groundMode/vectors) across verify sessions — probe or
  reset before visual assertions.

## Files
tuning.ts (AIMCONES.mapRadiusHK, skylineGuardM) · lib/ephemeris/azSector.ts
(fractureRunsBySkyline) · scene/aimCones.ts (skylineBins ctx + rebuild key + fracture) ·
StylizedTiles.ts (fpvPinKey re-seat, plan-entry basis/FOV, skyline push, verticalFovDeg
import) · panels/MapWindow.tsx (anchor order, follow, mapRadiusHK ×2 sites, plan jump,
skylineNow + fracture + plan sub, hint/credit JSX) · panels/MiniMap.tsx (fracture + guard,
readonly RadarBody runs) · mobile/SceneActions.tsx (plan jump) · mobile/MobileSearch.tsx
(focus discipline + placeholder) · panels/LocationFinder.tsx (placeholder) ·
styles/fpv-hud.css (chip z 9) · styles/map-window.css (tophint/credit re-seat) ·
styles/mobile/fpv.css (mw-open dock lift) · styles/time-scrubber.css (mw-open z 43) ·
tests: azSector.test (+5 fracture), aimCones.test (+2 tunable invariants) · scripts:
verify-uxbatch7.mjs NEW (22 checks).

## Traps (new)
- **Headless verify Chrome EXHAUSTS WebGL contexts across suites** — each verify script
  opens tabs via /json/new and never closes them; after ~5 suites WebGLRenderer throws
  "BindToCurrentSequence failed" and every later boot check fails. RESTART verify-chrome
  between suites (or close targets). Bit this session: uxbatch4-s3/5/6 "failures" were all
  this.
- **Vite dep-optimizer 504 ("Outdated Optimize Dep") after adding a new import to the globe
  bundle** — wix dev serves 504s for every module and islands never hydrate; restart wix
  dev before browser verification whenever imports changed.
- plannedView is ALWAYS non-null after boot (batch #6 seed) — plan-first entry fallbacks
  are belt-and-braces, not the common path.
- MapWindow rBase now depends on canvas HEIGHT only — anyone comparing radar px across
  surfaces must measure in fractions of h (not min(w,h)).

## Open tails
- T1 real device: iOS search-focus feel (the fix is code-verified only), moon-silver alpha,
  gaps on GL fan with a placed photo, place-point relocation feel, map dock ergonomics.
- Owner ruling wanted: QA-7 knobs — free flat2d de-grade (brightness) vs z18/DPR-1.5
  (crispness at iOS memory cost) vs status quo.
- Next scheduled (unchanged, owner order 2026-08-21e): AUDIT PASS + docs/guide reconcile —
  now also covering THIS batch's seams (anchor order, mapRadiusHK, fracture feeds, dock
  lift, search focus).
