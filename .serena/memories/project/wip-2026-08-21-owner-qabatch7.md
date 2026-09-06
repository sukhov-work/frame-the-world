# wip 2026-08-21f — OWNER QA BATCH (7 items after device QA) — COMPLETE (compacted 2026-09-06 from 12,173 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

DECISIONS 2026-08-21f. Gates: vitest 1,116/1,116 (+7) · astro 0 err / 5 hints · five regression
suites ALL PASS + NEW `scripts/verify-uxbatch7.mjs` 22/22 (shots uxb7-01..06). Item 7 was a
question, answered from pipeline code (the owner's comparison screenshots again arrived as
byte-identical placeholder icons — the batch-#5 corruption).

## What shipped (root causes)
1. **Radar follows the viewer in the expanded minimap (QA-1)** — two detach mechanisms. (a)
   MapWindow `aimAnchorNow` was tempPin-first (batch #6), so the radar sat on the pin while the
   cone and eye dot rode camGeo; now **FPV-live ⇒ camGeo first**
   (`(fpvHud ? camGeo : null) ?? tempPin ?? camGeo ?? focus`), pin-first outside FPV. (b) Placing a
   pin under a LIVE temp FPV re-posed per frame with the OLD pin's ENU basis and a stale
   `fpvWalkOffset`, so the eye landed |walkOffset| off the new pin. A NEW `fpvPinKey` closure in
   StylizedTiles re-seats the basis at the new pin (heading carried, elevation → fpvPitch, fpvYaw 0)
   and zeroes `fpvWalkOffset`. Plus **FPV follow** in `MapWindow.draw` — a rubber-band recentre when
   the eye leaves `FPV_FOLLOW_FRAC 0.12` of min(w,h), skipped while pointers are active (this
   supersedes batch #5's "the chart deliberately does not re-centre" for the FPV-live case).
   **Radar size unified**: NEW `AIMCONES.mapRadiusHK 0.5` — rBase = h × 0.5 (× mobileRadiusK on /m),
   the GL fan's fraction-of-height equivalent; the old 0.3 × min(w,h) was ~3.7× too small on a phone.
2. **FPV entry preserves the focal cone (QA-2)** — three entries ignored `plannedView`. (a) The
   no-share temp entry built its basis from camera-forward, which DEGENERATES TO NORTH at the /m 2D
   nadir, with FOV hardcoded to `tempFovDeg 55`; now `plannedView.headingDeg` steers the basis and
   FOV = `clamp(verticalFovDeg(plan.hFovDeg, camera.aspect))` (`verticalFovDeg` in
   `lib/decode/sensors` is the inverse of `horizontalFovDeg`). (b) The SceneActions long-press ▲3D
   jump used `cam.headingDeg` (the 2D MAP-UP bearing, not a view); now plan-first with the old
   values as fallback. (c) Desktop `MapWindow.viewFromHere` hardcoded north/55° — plan-first too.
3. **Radar occlusion gaps (QA-3)** — REFUTED as a regression: the gaps never existed on any radar
   surface at any commit (7 `git -S` probes, U4 birth blobs, S2 diff). Shipped as a NEW capability
   instead: pure `fractureRunsBySkyline(runs, sampler)` in `azSector.ts` (a sample stays when
   `altDeg ≥ skyline(azDeg)`; sub-runs under 2 samples are dropped; a null sampler leaves runs
   untouched). Fills and rim arcs fracture; rise/set spokes and direction lines stay whole. The GL
   fan gets `skylineBins` via ctx (ARRAY IDENTITY is the rebuild key); MapWindow and MiniMap sample
   `usePlanStore` directly. NEW `AIMCONES.skylineGuardM 60` — bins apply only when the plan anchor
   sits within 60 m of the radar anchor (the honesty rule).
4. **Time scrubber on the expanded map (QA-4)** — NO new component. /m lifts the REAL dock
   (`body.m.mw-open .m-bottom {z-index:24}` + `.m-peek/.m-tabs {display:none}` — `display`, not
   `visibility`, so the dock sits flush while React mounts stay warm); desktop raises the REAL
   TimeScrubber over the window (`body.mw-open .ts {z-index:43}`; `.mw` is 42). The bottom
   `.mw-hint` is retired and `.mw-credit` re-seated top-left under the top row.
5. **/m chips under controls (QA-5)** — `.fh-chip` and `.m-joy` were BOTH fixed z-10 in one
   stacking context; the chips island mounts LAST in m.astro ⇒ painted above + stole
   touches. `body.m .fh-chip {z-index:9}` (one rung under all z-10 chrome).
6. **Search (QA-6)** — new placeholders on both shells, plus the iOS dark-screen fix: React
   `autoFocus` fired while the sheet was at `translateY(100%)`, so Safari scrolled the LAYOUT
   viewport to the off-screen input (Android resizes only the visual viewport, hence unaffected). A
   mount `useLayoutEffect` now calls `focus({preventScroll:true})` in the same discrete-event commit
   (user activation carries, so the keyboard still opens) and pins `window.scrollTo(0,0)` via rAF +
   a 550 ms timer + a visualViewport resize listener — the /m shell is 100dvh, so layout scrollY
   must always be 0. REAL-iOS feel = UNVERIFIED (T1).
7. **Map-quality question (QA-7)** — answered by analysis: the /m default 2D map is the GL globe
   pipeline (MOBILE2D latch) and the expanded minimap is MapWindow's raw canvas. Same Esri tiles;
   the gap is (1) `esriMaxLevelCoarse 17` vs MapWindow z19 (a 4× linear texel deficit — dominant),
   (2) leanMobile DPR 1.25 vs MapWindow DPR 2 (1.6× linear), and (3) the stylized ground grade
   (gain 0.60 · desat 0.52 · waterDarken 0.35 ⇒ ~0.5–0.64× luminance). All are deliberate
   batch-#4-S3 iOS jetsam/heat levers except the grade.

## QA-7 a+b FOLLOW-UP (same session — owner: "try both, I judge perf on device")
- **(a) PHOTOGRAPHIC 2D chart** — new `GROUND.flat2dPhotoK 1` → `uFtwPhotoK`; the shader
  `photo = uFtwFlat2d × uFtwPhotoK × (1 − uFtwDark)` lerps OUT the whole stylized grade on the flat
  chart only. Dark-CARTO mode keeps its look; the desktop nadir flat map rides the same latch.
- **(b) crispness** — `TILESETS.esriMaxLevelCoarse 17→18`; `QUALITY.leanMobile.dprCap2d 1.5` applied
  ONLY while `TilesHandle.mapFlat()` (FPV keeps 1.25); plus the required third lever,
  `GROUND.overlayResolution2dPx 512` — the level chooser derives source zoom from
  resolution/rangeWidth, so the 256 lean composite alone pinned the chart one level shallow even
  with the cap at 18. `stepGroundUpdate` is the ONE writer of the effective composite px.
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
`tuning.ts` (AIMCONES.mapRadiusHK, skylineGuardM) · `lib/ephemeris/azSector.ts`
(fractureRunsBySkyline) · `scene/aimCones.ts` · `StylizedTiles.ts` (fpvPinKey re-seat, plan-entry
basis/FOV, skyline push) · `panels/MapWindow.tsx` · `panels/MiniMap.tsx` ·
`mobile/{SceneActions,MobileSearch}.tsx` · `panels/LocationFinder.tsx` ·
`styles/{fpv-hud,map-window,time-scrubber}.css` · `styles/mobile/fpv.css` · tests
`azSector` (+5) / `aimCones` (+2) · NEW `scripts/verify-uxbatch7.mjs` (22 checks).

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
- T1 real device: iOS search-focus feel (code-verified only), moon-silver alpha, gaps on the GL fan
  with a placed photo, place-point relocation feel, map dock ergonomics.
- **RESOLVED (2026-09-06 note):** the QA-7 ruling landed — the flat 2D chart is photographic
  (`GROUND.flat2dPhotoK 1`), and audit #3 (2026-08-22c/d/e) covered this batch's seams.
