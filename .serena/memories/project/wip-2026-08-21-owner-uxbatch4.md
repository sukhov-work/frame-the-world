# wip 2026-08-21 — OWNER BATCH #4 (18 items post-addendum-#2) — COMPLETE (S1+S2+S3 SHIPPED) (compacted 2026-09-06 from 12,284 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

Plan: `.claude/claude-docs/archive/UXBATCH4_PLAN.md` *(archived; path corrected 2026-09-06)*. DECISIONS 2026-08-21 / -21b / -21c. Gates after S3:
vitest 1,101/1,101 · astro 0 err / 5 hints · `verify-uxbatch4{,-s2,-s3}.mjs` 23/23 + 15/15 + 18/18.

## S1 shipped (see DECISIONS 2026-08-21 + plan §S1 — summary)
#2 selection tint killed · #3 2D two-finger ROTATE + tilt-door removed (`mobile2dFreeHeading`)
· #4-zoom MapWindow continuous pinch (PINCH_SENS 0.8, FPV z18) · #6 target ray far (rayLenK 6
/ canvas edge) · #7 vector ink halved + `vectorsVisible` pref + VEC/▤ VECTOR · #8 find-in-frame
above UNFOLLOW both shells · #10 long-press ▲ 3D → FPV jump · #12 /m time-only dock clock ·
#13 MapWindow drag/−10% (DragGrip clip trap) · #14 Guide resizable.

## S2 shipped (2026-08-21b — radar unify + focal cone everywhere + joystick + twist + item 16)
- **Item 16**: `STREETS.textPxTarget` [15,13,11]→[8,7,6] AND `textHeightM` [22,15,11]→[11,7.5,5.5].
  The giant riverfront label WAS the world-size floor branch — on-screen size =
  `max(world-size-px, pxTarget)` — so halving only `pxTarget` would have changed nothing.
- **#9 radar bands**: `AIMCONES.bandSun [0.3,0.38]` · `bandMoon [0.42,0.5]` · `bandTarget [0.55,1]`
  (unit-radius [inner,outer]) — ONE model consumed by the GL fan (`scene/aimCones.ts`, `bandFor()`
  exported and tested), the MapWindow canvas twin and the new minimap radar. `compactK`/`lineLenK`
  RETIRED; emphasis now gates FILL alpha only, because bands cannot overlap by construction. An `N`
  marker sits at rim az 0 on all three surfaces (the minimap keeps DOM `.mm-n` — it never rotates).
- **Planned-view state**: camera store `plannedView {headingDeg, hFovDeg}` (+ `plannedRates`) —
  hFov stored HORIZONTAL, which kills the aspect question; session-only. Seeds are LWW from photo
  placement, the #10 jump, FPV exit (both hud-null branches seed from the dying hud) and the
  joystick's first touch. `lib/geo/plannedView.ts` is the CANONICAL home (stickRate expo /
  integratePlanned / plannedAtRest / horizontalFovDeg; minimapFeed re-exports); the orchestrator's
  `stepPlannedView` does no store churn at rest.
- **Focal cone everywhere**: NEW token `--color-focal-cone` #E08FC6 orchid-rose (tokens.css +
  the tokens.ts bridge — timeFuture/pinIce/cometTail sit too close to the radar's future-blue and
  lavender means places). FOCALCONE tunables: fillAlpha 0.05, edgeAlpha 0.55, minHFovDeg 3 /
  maxHFovDeg 120, rate ceilings 45°/s + 0.9/s. GL = NEW `scene/focalCone.ts` (unit ENU wedge,
  rebuilt only on hFov Δ > 0.1°, hidden in FPV). MapWindow prefers fpvHud (live, at the eye) over
  plannedView (at the radar anchor); MiniMap's cone is re-inked focalCone.
- **#11 AimJoystick**: `Joystick` parameterized (raw unit-disc `onVector`) and moved to the NEW
  SHARED TIER `src/components/controls/Joystick.tsx` — the mobile fence forbids panels↔mobile, so
  instruments whose FEEL must not fork live in `controls/` (rule 3 of `mobileFence.test.ts`:
  controls may import ONLY react + store + lib + globe/tuning + styles). In FPV it writes real
  `setHeadingRate`/`setFovRate`; outside it seeds and writes `setPlannedRates`.
- **#4b MapWindow twist**: `view.rot` (rad, north-up 0, reset per open) plus ONE rotation-aware
  transform (`xformNow()` fwd/inv) replacing four duplicated zDraw stacks; tiles blit under
  `ctx.rotate` with a half-diagonal AABB range (+1 px overdraw seam guard at rot ≠ 0, texel-snap
  kept at rot = 0); tap-promote de-rotates via `inv`; pinch composes twist (undamped 1:1) with the
  midpoint pan.
- **S1 BUG found+fixed**: long-press trailing click RETARGETS after the pressed chip unmounts
  (tempFpv flips chrome within a frame) → click landed on member-gated SAVE VIEW → LOGIN page
  navigation mid-jump (browser-caught: www.plux.today/__auth/loginv2, read as a white "crash").
  Fix: one-shot document-level capture click swallow, 900ms fuse — SceneActions.jumpHere +
  MapWindow.viewFromHere. **TRAP: element-level click-swallows die with the element.**

## Side quest (owner ask): rendering-pipeline optimization audit + cache measurement
- The static audit found U5 closest-first, U6 foveation and the mobile tier ALL in-place-wired
  with zero drift. Two facts worth keeping: `GROUND.overlayResolution` is a CONSTRUCTION-TIME
  ImageOverlayPlugin arg with no tier branch and no re-set path (so the S3 shrink to 256 needs a
  plugin rebuild); and there were zero `webglcontextlost`/`pagehide` handlers, with the one
  `visibilitychange` listener only re-acquiring the wake lock.
- **Cache measurement REFUTED request-level cache-busting** (`scripts/measure-tile-cache.mjs`, cache
  ENABLED): a desktop reload served 1,173 tile URLs `fromDiskCache` against 64 from the network at
  ~0.0 MB (metadata revalidations); the mobile view 711 vs 58, same shape; ZERO in-session
  re-fetches over a 6-pan wander. The owner's desktop observation was a DevTools disable-cache
  artifact. The iOS-small-cache ranking STANDS, so the SW mitigation stays iOS-directed. Gap: the
  mobile-view WANDER gesture never registered on the emulated tab — an on-device re-measure rides T1.

## TRAPS (cumulative this batch)
- Synthetic CDP two-finger gestures on the LIBRARY canvas need ≤3px steps (ROTATE/ZOOM latch);
  MapWindow's own canvas needs no such care (twist+pinch compose continuously).
- `.mw`/any DragGrip host must NOT be overflow:hidden (clip belongs on the canvas child).
- guideContent structure test caps topic steps at 6.
- Stale-9222 Chrome (owner alias, no occlusion flags): pkill -f Playwright_Chrome_data +
  scripts/verify-chrome.mjs. ALSO: a long-lived `wix dev` predating new module files serves
  504 "Outdated Optimize Dep" → BLACK canvas — restart wix dev after adding modules.
- Element-level click-swallow dies when the element unmounts mid-gesture (S2 login-nav bug).
- vitest expectation must respect the clamp (hFov test: 60·e^0.9 > 120 clamps).

## Owner addendum #2 (2026-08-21b, post-S2) — both items SHIPPED in S3 below
17 = radar band body tint (future part takes the BODY colour, past stays grey; target keeps
grey/blue). 18 = a TargetPanel GOTO button before SHOW, sharing the SkyGotoChips aim helper rather
than duplicating it.

## S3 SHIPPED (2026-08-21c — BATCH #4 CLOSED 18/18; DECISIONS 2026-08-21c)
- **17**: `bandFutureInk()` exported from `aimCones.ts` (sun→sunGlow / moon→moonDial /
  target→timeFuture); `makeSectorMaterial(futureHex)` sets per-body `uFuture` at creation. The
  minimap reads the tokens bridge — there is deliberately NO `--color-moon-dial` CSS var.
- **18**: the chip aim handler EXTRACTED to `store/skyAim.gotoSkyBody(kind)` (skyMarkers mirror
  first, live `targetAzAlt` fallback at `camGeo ?? focus` so SHOW-off works; below-horizon →
  `nextRiseAzimuth` at the horizon; pure twin `gotoAimSolution` in the test). SkyGotoChips
  delegates; the TargetPanel GOTO pill sits BEFORE SHOW and is not gated on `visible`.
- **#5**: GlobeCanvas `contextlost`/`restored` handlers (preventDefault + GL re-init; the app half
  is a ctxLost render gate plus a composer realloc on restore), and the tick skips hidden pages
  re-seating the governor clock. StylizedTiles' `visibilitychange`/`pagehide`/`pageshow` freeze ALL
  NINE tile queues (3 renderers × download/parse/processNode via `PriorityQueue.autoUpdate`,
  orthogonal to tier maxJobs) with a `scheduleJobRun` re-kick. NEW `QUALITY.leanMobile`
  {dprCap 1.25, bloom false, shadowMapSize 1024} = coarse-pointer renderer OVERRIDES on top of the
  governed tier; `high` stays test-locked byte-identical.
- **#15a**: NEW `public/sw.js` — iOS-ONLY registration in both layouts (iPhone/iPod/iPad UA, or
  Macintosh UA + maxTouchPoints > 1 = iPadOS; dev-gated on localhost). Cache-first Cache-Storage over
  Esri/CARTO/assets.ion/openfreemap/*.workers.dev, FIFO 6,000 entries ≈300 MB + 7-day TTL; NEVER
  tileset.json, layer.json, /planet or api.cesium.com. Esri ToS posture: a performance cache, never
  an offline extract. Policy fenced by `test/swTileCache.test.ts`.
- **#15b**: per-tier `overlayResolutionPx` 512/256/256 — the REAL network lever, because
  `calculateLevel` picks the Esri source z from resolution (≈4× fewer GETs at 256). The
  `setOverlayResolution` REBUILD path sets `plugin.resolution` and builds FRESH overlay instances
  via delete→add; **re-adding the SAME instance NESTS the download-queue fetch wrapper** — that is
  the trap. `esriMaxLevelCoarse 17` (desktop stays z19); ground-only `groundLruBytesMB` 320 mid /
  192 low.
- **#15c**: force-cache per URL — Esri/CARTO `overlay.fetchOptions` (kills the ~60 revalidations
  per reload), terrainPatch `.terrain`, the `FTW_ENRICHED_FORCE_CACHE` `.glb` claimer (−500 slot;
  tileset.json declines), openfreemap `.pbf`.
- **#1**: NEW `.mw-pip` — a transparent 200 px button top-right of the /m fullscreen map. `draw()`
  clearRects the canvas under its exact DOM box (CSS owns placement) and `body.m .mw`'s background
  is DROPPED, so the cleared pixels reach the GL FPV view — a true live PiP. Tap →
  `setMapWindowOpen(false)`.
- UNVERIFIED → T1 + first release: `/sw.js` served by Wix hosting (Content-Type unprobed — the one
  #15a risk), real-iOS jetsam and heat, the Esri z17/256 look, the governor-flip rebuild flash.

## S3 traps (fresh)
- Dev bundle RENAMES three pass classes (`_UnrealBloomPass`) — CDP probes match
  constructor.name by SUBSTRING.
- Hash-only Page.navigate does NOT reload — #p= poses apply at LOAD; about:blank first.
- Bloom off on the city chart pose is BY DESIGN (mapFlat gate, 120km) — assert at a LEO pose.
- wix dev left RUNNING on :4321 (2026-08-21c) — restart it if the next session adds modules.

Real-device gesture feel (twist damp? aim joystick feel, radar band radii taste, NEW: lean
heat + SW effect + PiP feel + body-tint taste) rides T1 owner pass.
