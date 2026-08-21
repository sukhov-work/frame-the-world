# wip 2026-08-21 — OWNER BATCH #4 (15 items, post-iPhone-17-Pro testing) — S1 SHIPPED 10/15

Plan doc: `.claude/claude-docs/UXBATCH4_PLAN.md` (tracks A–F, 3 sessions, per-item specs).
DECISIONS 2026-08-21. Gates: vitest 1,074/1,074 (+1 prefs) · astro 0 err/5 hints ·
`scripts/verify-uxbatch4.mjs` 23/23 PASS (raw-CDP, both shells; shots verify-shots/uxb4-01..11).

## S1 shipped (owner numbering)
- **#2** selection tint: global.css body user-select/touch-callout/tap-highlight none; form
  fields opt back in. Repo previously had ZERO -webkit-tap-highlight-color rules.
- **#3** 2D map gestures: tilt-into-3D door REMOVED (MOBILE2D.enter3dTiltDeg retired — ▲ 3D
  chip only door); two-finger parallel drag = ROTATE the chart. stepMobile2dLocks: tilt
  re-locks EVERY frame (kk=1 during touchRotate — same-frame kill), heading lock stands down
  during gesture + `mobile2dFreeHeading` latch keeps user heading until 2D re-entry/heading
  glide. Compass −69° after synthetic gesture, mapMode stayed 2d.
- **#4-zoom** MapWindow pinch continuous: fractional z, tiles at Math.round(z)+boost scaled
  2^(z−zDraw) (4 zDraw sites), PINCH_SENS 0.8 damp, wheel/chips round to integer, FPV-open
  z 17→18. Rotation gesture deferred to S2 (same draw() rewrite as radar twin).
- **#6** target ray: AIMCONES.rayLenK 6 (GL, emphasis-independent scale.y) + window-edge
  Math.hypot(w,h) on canvas twin + full-ray tap-promote reach. Sun/moon dials untouched (S2).
- **#7** vector ink: fillOpacity 0.25 · lineOpacity 0.55 · flatLineK 0.32 + NEW pref
  `vectorsVisible` (camera store) → desktop VEC chip + /m ▤ VECTOR (LAYERS). Gates only
  vectorFeatures `enabled` (StylizedTiles ~:3895); streetNames stay on.
- **#8** ⌖ FIND IN FRAME above UNFOLLOW both shells (.tp-findframe/.m-findframe; sky-menu
  mapping body:sun/moon→own chip else "target"; composite find.open && bodies[b] read;
  desktop closes PLAN first, /m keeps PLAN sheet).
- **#10** long-press ▲ 3D → requestFpvJump(map centre, current heading, lastFpvFovDeg ??
  FPV.tempFovDeg); session tracker subscribes fpvHud in SceneActions root; 500 ms/6 px +
  click-swallow.
- **#12** /m dock: PLAY + rate REMOVED (desktop scrubber untouched), strip TimeChip deleted
  (MobileShell), `.md-clock` time-only readout in dock (amber past/blue future).
- **#13** MapWindow desktop: usePanelDrag("map-window") + grip; −10% = min(57.6rem,84.6vw) ×
  min(72vh,43.2rem). **`.mw` overflow:hidden REMOVED** — it clipped the DragGrip tab (the
  documented inner-wrapper trap); corner clip moved to `.mw-canvas` border-radius (/m resets 0).
- **#14** Guide: usePanelResize("guide") + ResizeGrip + --win-w/--win-h (supersedes 15e
  "not resizable"). Guide SEARCH was already shipped 2026-08-19d (owner tested pre-ship build).
- Guide topics updated: mobile-map (rotate + long-press), mobile-layout (clock in dock),
  mobile-chips (+▤ VECTOR), mobile-gestures (6-step cap — structure test limits steps ≤6!).

## TRAPS (new, for the record)
- **Synthetic CDP two-finger gestures need ≤3 px steps**: EnvironmentControls classifies
  ROTATE-vs-ZOOM on the FIRST move past dragThreshold (2×dpr), and CDP delivers the two
  pointers in separate tasks — a 14 px step reads as a pinch mid-frame → ZOOM latched
  (state 3). 3 px × 50 moves → clean ROTATE (state 2).
- `.mw`/any DragGrip host must NOT be overflow:hidden (grip floats above the top edge).
- `__globe.controls` IS exposed in DEV — gesture state probes (`controls.state`,
  `pointerTracker.isPointerTouch()`) work from the page.
- guideContent structure test caps topic steps at 6.

## Owner addendum (2026-08-21, post-S1 — accepted into the plan)
1. **#15 not iOS-exclusive**: same excessive tile loading / no physical cache observed in
   desktop Chrome MOBILE VIEW (maybe desktop view — needs checks). S3 opens with a
   cache-enabled desktop-Chrome measurement (rule out DevTools disable-cache) before trusting
   the "iOS cache too small" ranking — if Chrome's disk cache also misses, look for
   request-level cache-busting / eviction churn outrunning any browser cache. SW mitigation
   stays valid either way.
2. **#9 radar += small `N` north marker** on the rim, ALL surfaces (GL/MapWindow/minimap) —
   the 2D map rotates everywhere now.
3. **NEW item 16**: street-name labels ×0.5 font — `STREETS.textPxTarget [15,13,11]` → halve
   + check the world-size floor branch (tuning.ts ~1449) that likely painted the giant
   riverfront label in the owner's screenshot. Quick win at S2 open.

## Remaining (owner items → sessions)
- **S2 (radar unify, design-first)**: #9 radar rework (target zone clipped at outer circle;
  sun/moon THIN non-overlapping concentric bands — sun inner sunGlow/past-grey, moon outer
  brighter moonDial; dials capped at own band; annular geometry is consumer-side only —
  azSector needs nothing) + focal cone EVERYWHERE (GL module NEW, MapWindow hardcoded-0.22
  replace, minimap; reach = tracking ray; distinct colour, near-zero fill) — needs a
  **planned-view state** (heading+focal outside FPV; FPV mirrors fpvHud) + #11 focal joystick
  (Joystick geometry-only, add onVector prop; setHeadingRate max 45°/s + setFovRate log-space
  max 0.9/s, expo γ2.2; minimap bottom-right, map bottom-left) + #4b MapWindow twist rotation
  (canvas bearing — do WITH the radar twin draw() rewrite).
- **S3 (network/stability + PiP)**: #15 request storm — scout PROBED all hosts: headers fine
  everywhere (ion/Esri/CARTO/workers.dev/openfreemap all public+max-age, binaries immutable);
  cause = LRU-eviction re-fetch (library relies on browser disk cache,
  TilesRendererBase.js:1786-94) vs iOS Safari's small pressure-pruned cache; Esri HTTP/1.1-only.
  Mitigations ranked: same-origin SW Cache-Storage tile cache (~300 MB LRU) > mobile demand
  shrink (GROUND.overlayResolution 512→256 mid/low; Esri depth cap z17 coarse-pointer; ground-
  LRU-only raise) > per-URL force-cache (immutable binaries ONLY — tileset/layer.json must
  revalidate) — Esri ToS note tuning.ts:699 before SW-caching their tiles. #5 iOS reload/heat —
  ZERO contextlost/pagehide handling today; mid tier = bloom + 2048 shadows + DPR 1.5 + up to
  3×256 MB LRU → jetsam; plan: contextlost restore, rAF+tiles pause on hide, iOS lean profile.
  #1 minimap PiP — /m MapWindow close button → punched-hole live GL view (canvas keeps
  rendering under the fullscreen window), AFTER S2's draw() rewrite.
- Real-device gesture feel + iOS behaviour = UNVERIFIED, rides T1 owner device pass.

## Scout facts worth keeping (evidence in session log 2026-08-21)
- The "2D map" = GL globe top-down (MOBILE2D lock); "expanded minimap" on /m = fullscreen
  MapWindow; the FPV mini-patch has NO zoom (fixed 200 m patch) — the owner's "crude steps"
  was MapWindow's integer-snap pinch.
- aimCones: unit-circle geometry, radius clamp(alt×0.35, 150, 12 000 m), holder emphasis
  compactK 0.55, dial = 6-vertex quad y∈[0,1]; canvas twin AIM_R_FRAC 0.3, FOV cone 0.22
  hardcoded (MapWindow.tsx:~368); minimap cone reach 0.42×patch.
- Tier pick: coarse-pointer caps phones at mid (iPhone 17 Pro = Pixel 6 = mid); DPR cap 1.5.
