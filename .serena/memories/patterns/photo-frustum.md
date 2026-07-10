# mem:patterns/photo-frustum — placed photo = frustum + image plane (Phase 3, shipped 2026-07-10)

Browser-VERIFIED (Playwright on wix dev): GPS fixture → PLACE → 2.2 s flight → frustum at Dnipro
48.4647/35.0462 heading 214° H-FOV 73.7°; ARW (no GPS) → SET ON GLOBE → click-to-place → decoded
texture on the plane; live re-projection **0.018 ms/update** (budget 16 ms); reduced-motion = cut.

## The pipeline (store → math → scene)
- **Store machine** (`store/upload.ts`): `review → placed` (GPS) | `review → placing → placed`
  (no GPS; "SET ON GLOBE" → globe click). `placement {latDeg,lonDeg}` is GPS-seeded at ingest and
  set by `setPlacement` — position is NOT a slider param. `textureWidth/Height` carried from decode
  (fallback: EXIF dims) → frustum aspect. `derivedFov(exif, params)` is the ONE H-FOV derivation
  shared by the review readout, the detail panel AND the rendered frustum (focal35 shortcut only
  while focal untouched). DEV: `window.__uploadStore`.
- **Pure math** (`lib/geo/frustum.ts` — three-free, 20 tests): `frustumGeometry(lat, lon, alt,
  heading, pitch, roll, hFov, vFov, planeDist)` → apex + far-face corners [TL,TR,BR,BL] via ENU
  basis; roll = Rodrigues about forward (EXIF clockwise → rotate basis by −roll); nadir-degenerate
  horizontal reference guarded via north. `lib/geo/projection.ts` gained `ecefToGeodetic` (Bowring
  seed + 2 fixed-point iterations — one-step Bowring is ~6e-8° off at LEO altitude) and
  `rayEllipsoidIntersect` (scaled-space sphere; near root; null on miss).
- **Scene** (`components/globe/PhotoFrustum.ts`, attach-module idiom): LineSegments (8 accent
  edges) + textured plane (2 tris). **Group sits at the apex; vertices are apex-relative** —
  full float32 precision at ECEF magnitudes (same strategy as the tiles). zustand VANILLA
  subscribe (globe ≠ React); rebuild on phase/placement/params/preview/texture-dims change;
  `onPlaced` callback → orchestrator starts the flight. Photo texture: SRGBColorSpace +
  `toneMapped: false` (the photo keeps its own colours). uv TL(0,1) TR(1,1) BR(1,0) BL(0,0).
- **Flight** (`components/globe/flight.ts`): slerp the geocentric DIRECTION (quaternion from
  setFromUnitVectors) + blend geocentric altitude + ballistic bump `min(0.35·groundDist, 2500 km)
  · sin(πe)`; orientation = quaternion slerp to a lookAt-derived end pose; cubic-bezier(.65,0,.35,1)
  via a 6-step Newton solver; **endpoints exact** (final frame snaps). Reduced motion = instant
  `finalPose`. Runs AFTER `controls.update()` (the drift pattern); an active flight sets
  `lastInteract` each frame so idle drift stays paused through + 8 s after; pointerdown cancels.
  View pose: apex − forward·(planeDist·2.8) + up·(planeDist·1.1), lookAt plane centre (FLIGHT.*).
- **Click-to-place** (orchestrator): pointerup with <6 px travel while phase="placing" → NDC →
  `unproject(camera)` ray → `rayEllipsoidIntersect` → `ecefToGeodetic` → `setPlacement`. Cursor
  crosshair via store subscribe. Escape in placing → `backToReview`.
- **UI**: UploadFlow button = "PLACE ON GLOBE" (has GPS) / "SET ON GLOBE" (missing). While placed
  and overlay closed → `panels/PhotoDetailPanel.tsx` (docked right, board-04 Slider reuse,
  `styles/photo-detail.css`); placing → `PlacementHint` pill. Full 04-board Claude-Design import
  DEFERRED until the detail chrome grows.

## Semantics + gotchas
- **Altitude slider = metres above the RENDERED ground (the ellipsoid)**, seeded from EXIF
  `gpsAltitudeM` when present. GPS altitude is sea-level-ish → a 96 m EXIF value floats the frustum
  above the streets (fixture does this). Missing altitude → FRUSTUM.eyeHeightM (1.7 m). Proper
  terrain-snap arrives with real terrain (QuantizedMeshPlugin, later phase) — D4 says snap.
- Heading/pitch default to 0 when missing (the D4 nudge fills them via sliders).
- All presentational numbers live in `tuning.ts` `FRUSTUM` (planeDist 120 m, eyeHeight 1.7,
  lineOpacity .85, fallbackAspect 1.5) + `FLIGHT` (2200 ms, easing, back 2.8, lift 1.1, arc bump).
- DEV introspection: `__globe.frustum.current()` (geometry) + `__globe.flight.active()`.
- UNVERIFIED: portrait-aspect photos (math handles it; not eyeballed); flights between antipodal
  points (slerp is fine, bump maxes); frustum at extreme pitch −90 near ground.

Related: [[patterns/globe-rendering]] [[patterns/upload-flow]] [[decisions/adr-000-locked-stack]]
