# wip 2026-08-17b — UPLIFT U1 SHIPPED: /m 2D-first navigation + pinch hardening

## What shipped (owner points 1 + 5; DECISIONS 2026-08-17b-u1-2d-mobile)
- **`camera.mapMode` "2d"|"3d"** (store/camera): default "3d", NOT persisted (owner: /m always
  boots the 2D map); desktop never writes it → all U1 seams desktop-inert; survives
  clearAllTargets (a mode is a place, not a glide).
- **`setActive(on)` on BOTH building handles** (buildings.ts + enrichedBuildings.ts):
  scene-graph REMOVE + frozen update(). Why removal not `visible=false`: **three's Raycaster
  does NOT check `visible`** — hidden-but-loaded mass would still catch GlobeControls'
  whole-scene pivot raycast. LRU stays warm → instant re-attach.
- **Orchestrator (StylizedTiles.ts)**: `isMobileShell` = server-rendered `body.m` class
  (race-free vs island mount order). Boot: no-hash → EXACT nadir north-up over
  MOBILE2D.bootLat/Lon @1.1 Mm (constructed directly — `arrivalPose` clamps tilt ≥5°);
  `#p=` tilt≥10° → 3D (respect oblique shares); nadir `#p=` → 2D (the /m mirror writes
  tilt≈0 hashes; reload must not flip to 3D); `#f=` → FPV, exit lands 2D.
  New steps: `stepMobileBuildingsGate` (want = fpvActive || mapMode==="3d", before
  stepBuildingsUpdate; per-frame call is free — handle identity guards) and
  `stepMobile2dLocks` (after stepHeadingGlide: tilt→nadir + heading→north,
  τ=MOBILE2D.lockEaseTauMs; defers to targetTilt/Heading glides — one writer per axis).
- **Heading at nadir is DEGENERATE from forward** (printed 180.5° on a north-up chart):
  `mapUpHeadingDeg` = compass bearing of camera SCREEN-UP projected on the horizon — used by
  the locks AND the pose mirror/`#p=` hash while mobile-2D.
- **Two-finger tilt = the library's own touch-ROTATE state** (EnvironmentControls.js:562-585
  parallel-vs-pinch classifier; state constants not re-exported — shim reads `zc.state===2` +
  `pointerTracker.isPointerTouch()`). While live: tilt lock stands down, heading lock keeps
  running (pure-tilt feel); crossing MOBILE2D.enter3dTiltDeg=15° flips to 3D MID-gesture.
  Verified synthetic (dispatched PointerEvents work on the library's listeners): tilt
  0.06→80°, heading pinned 0; pinch classified ZOOM (1100 km→25 km, tilt 0.03°).
- **Idle drift OFF in mobile-2D** — it slid the chart ~3° lon in the first pass; a map holds
  still.
- **FPV exit on /m**: setMapMode("2d") + `mapArrivalPose` (approach = −north ⇒ heading 0,
  tilt 0 request → 5° clamp → locks settle; alt MOBILE2D.exitAltAboveGroundM=600 — measured
  602 m, heading 359.87°). Skips beginFraming (would re-fly the OBLIQUE photo arrival).
- **/m chrome (SceneActions)**: `▼ 2D MAP / ▲ 3D VIEW` chip (mode write + the existing
  tilt/heading glides — CONTROLS.toggle3dTiltDeg up, 0/0 down); ▦ 3D DETAIL hidden in 2D
  (dead reload chip; hook-order safe — mapMode hook before the early return).
- **Pinch hardening (point 5)**: MobileLayout viewport `maximum-scale=1, user-scalable=no` +
  inline `gesturestart` preventDefault (iOS ≥10 ignores user-scalable; gesture events are
  Safari-proprietary, pointer events unaffected). `touch-action` closed on the audited leak
  list: desktop `.globe-canvas` none (touch laptops) · `.m-bottom` · `.m-actions` · `.m-scrim`
  · `.mm` · `.skymenu` · `.m-status a/button` none · `.m-sheet__body` pan-y. Desktop + /guide
  layouts stay zoomable (a11y). **`test/styles/pinchHardening.test.ts`** pins layout + leak
  list file-by-file (declarations are silently droppable).
- DEV seam: `window.__globe.map2d()` → {isMobileShell, mode, buildingsAttached (group
  membership, not a flag), enrichedAttached}.

## Verification
Gates vitest **922/922** (+14: 3 store mapMode + 11 pinch lint) · astro 0 err/5 hints.
Browser (wix dev + Playwright, 402×874): 2D boot (mode/detach/tilt 0.03°/heading 0/hash
`#p=…,0.0,0.0`, no drift over 6 s) · chip round-trip 2D↔3D (attach/detach, tilt 47.8° on the
55° request — released early, cosmetic) · synthetic two-finger tilt + pinch-zoom · FPV
entry/exit (602 m nadir north-up landing) · desktop inert (mode 3d, buildings attached, free
camera) · console = pre-existing noise only. Shots `verify-shots/u1-01..04`.
**UNVERIFIED (real device = the U1 exit gate, OPEN):** actual page-pinch suppression on
iPhone 17 Pro/Pixel 6 Pro; gesture feel (enter3dTiltDeg/lockEaseTauMs); attach-hitch on 2D→3D.

## Open tails
- Real-device pass (exit gate) — rides the next owner session / T1.
- Taste: 3D chip glide lands ~48° not 55 (tilt glide early-release, pre-existing arithmetic);
  2D boot altitude/point (MOBILE2D.bootLatDeg/LonDeg/bootAltM); exit alt 600 m.
- U2 next (FPV stability — instrument first; UPLIFT_PLAN §2/U2).

Related: [[project/wip-2026-08-17-p7-meteors-uplift-plan]] · UPLIFT_PLAN.md §2/U1 + §5 log.
