# mem:patterns/globe-rendering — stylized Earth on 3d-tiles-renderer

How the Phase-1 globe is built (`src/components/globe/StylizedTiles.ts` + `GlobeCanvas.tsx`). Hard-won from
the 2026-07-09 "near-black globe" fix (see DECISIONS). All colour flows through `lib/theme/tokens.ts` (D14).

## The base "Earth" is the whole instrument from orbit
Cesium OSM Buildings (ion 96188) is **buildings-only, no terrain/imagery**, and only refines at city zoom.
From orbit the user sees ONLY the base ellipsoid → its material quality IS the first impression. Build it right.

## Refining ground map at city zoom (2026-07-10)
The 2048² base texture is featureless at city scale, so close zoom needs a SECOND, self-refining ground globe.
- `const ground = new TilesRenderer(); ground.registerPlugin(new TilesFadePlugin()); ground.registerPlugin(new UpdateOnChangePlugin()); ground.registerPlugin(new GeneratedSurfacePlugin({ overlay, shape:'ellipsoid', applyOverlayTexture:true }))`. Overlay = `new XYZTilesOverlay({ url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" })` (dark vector map — user's pick; Esri World Imagery XYZ or ion Bing asset 2 are the satellite alternatives).
- **`GeneratedSurfacePlugin` has NO `.d.ts` in 0.4.28** (runtime-present via `three/plugins` index.js) → import with `// @ts-expect-error`. `XYZTilesOverlay`/`TilesFadePlugin`/`UpdateOnChangePlugin` ARE typed. Do NOT use `XYZTilesPlugin`/`EllipsoidProjectionTilesPlugin` (deprecated, warn on construct).
- Reveal by altitude: `ground.group.visible = alt < 300_000; if (visible) ground.update();` — keeps orbit stylized + halves tile traffic. `TilesFadePlugin` fades each tile in as it loads (the gradual-clarity reveal).
- **Layering** (front→back): buildings > imagery ground (WGS84) > stylized base. Shrink base to WGS84×0.9997 so imagery sits in front (no base/imagery z-fight); give the imagery meshes `polygonOffset` on `load-model` so building footprints (also height 0) win. Buildings extrude from WGS84 → they land on the imagery with no manual alignment (same ECEF frame).
- **Buildings must contrast** the ground: `styleMat` = `tokens.peak` (lighter slate) + `flatShading` + `emissive tokens.land ×0.15` + `DoubleSide`. Same-slate-as-ground = invisible buildings.
- **Attribution is ToS-mandatory**: render `© OpenStreetMap © CARTO` in the DOM (`index.astro`), not the globe.
- Real 3D terrain (Cesium World Terrain asset 1 + QuantizedMeshPlugin) is a LATER phase — OSM buildings are authored on the ellipsoid, so terrain floats/sinks them (needs TileFlatteningPlugin). Imagery-on-ellipsoid has zero alignment problem.

## Normal-mapped terrain relief (2026-07-10)
`public/textures/earth-normal.jpg` (three.js earth_normal_2048, 329 KB, load as `NoColorSpace`) drives lit 3D
relief on the base ShaderMaterial. Build a tangent frame from the ECEF outward normal `N`: `up = abs(N.z)<0.99
? (0,0,1) : (1,0,0)` (pole guard), `T = normalize(cross(up,N))`, `B = cross(N,T)`; `nT = tex.xyz*2-1; nT.xy
*= uRelief * land` (relief only on land); `Np = normalize(T*nT.x + B*nT.y + N*nT.z)`; then half-lambert
`wrap = dot(Np, sunDir)*0.5+0.5`. This is the single biggest "terrain reads as 3D" win for the orbit-mid band.

## Land/ocean must be MIXED, not a multiplied elevation map
- `public/textures/earth-topology.png` is a grayscale **elevation** map: 66.5% of pixels are exactly #000
  (ocean AND flat lowland), mean 0.059. Using it as an albedo `map` multiplied by a slate colour = `slate ×
  ~0 = near-black`. This was THE bug.
- Fix: ship a **land/ocean mask** and MIX two token colours. We derived it from the same asset:
  `magick public/textures/earth-topology.png -threshold 0 public/textures/earth-landmask.png` (land=white,
  43 KB, land frac 33.5%; continent interiors are SOLID — verify with interior crops, not bbox means).
- Base is a **`THREE.ShaderMaterial`** (not MeshStandard+map, not MeshBasic): samples `uLandMask` (land/ocean,
  `smoothstep(0.35,0.65,mask)` for AA coast) + `uElevation` (relief: `mix(land,landHi,..)` then `mix(..,peak,..)`),
  half-lambert `uSunDir` shading, `uNightFloor≈0.5` so continents stay readable on the dark side (a nav map
  must never hide half itself). End the fragment with `#include <tonemapping_fragment>` then `#include <colorspace_fragment>`.
- **Data textures MUST be `THREE.NoColorSpace`** (mask + elevation). The old `SRGBColorSpace` tag made three
  sRGB-decode the data and darken midtones — a compounding bug. Feed colour uniforms as `new THREE.Color(token)`
  (linear); the colorspace include re-encodes.

## Decorations
- **Graticule = real lat/lon `LineSegments`**, NOT a `SphereGeometry` wireframe (that draws triangulation
  diagonals). LineSegments ignore `material.side`, so "FrontSide culls when inside" is false — use a
  **hemisphere-discard shader** (`if (dot(normal, toCam) < 0.05) discard;`) to vanish when the camera dives in.
- **Atmosphere = fresnel limb glow** (`pow(1-dot(view,n), power)`, BackSide, AdditiveBlending, alpha=1, colour
  in rgb), NOT a uniform-opacity back-side sphere (that paints a flat disc). Token `atmosphere` (cyan-teal;
  swap to Rayleigh blue `#4A93D4` to free the accent for signal).
- **Starfield is frustum-clipped by GlobeControls' dynamic far plane** (~2.04e7 at orbit). A fixed celestial
  sphere at infinity never renders. Fix: build stars on a UNIT sphere, then each frame `stars.position.copy(
  camera.position); stars.scale.setScalar(1.05 * altitude)` so they sit just behind Earth's near surface but
  inside far. Round soft additive points (`gl_PointCoord` mask) + screen-space `gl_PointSize`.
- **Altitude-gate** (`alt = camera.position.length() - WGS84_A > 150 km`): hide graticule + atmosphere + stars
  at city zoom (no wire cage, no shell overdraw, no stars bleeding over the ground). `raycast = () => {}` on
  every decoration so GlobeControls' scene raycast only picks real ground/buildings.

## Grounding + controls (3d-tiles-renderer 0.4.28)
- Base ellipsoid at **exact WGS84** (`scale(WGS84_A, WGS84_B, WGS84_A)`, no 0.9995 shrink — that put it 3.2 km
  UNDER the surface, floating the buildings). Win the depth tie with `material.polygonOffset=true` (factor/units 1).
  `SphereGeometry(1, 384, 384)` → facet dip ~213 m.
- `new GlobeControls(scene, camera, domElement)` (ctor IS `(scene, camera, domElement, tilesRenderer)`), then
  `controls.setEllipsoid(tiles.ellipsoid, tiles.group)`. GlobeControls **rewrites camera near/far every frame**,
  so `camera.near=1/far=1e9` are just outer bounds — no `logarithmicDepthBuffer` needed. `enableDamping=true`,
  `maxAltitude=π/2`, `cameraRadius=8`. `zoomSpeed=5` is fine for a gradual trackpad pinch (only overshoots on
  large synthetic wheel bursts).
- `load-model`: swap each mesh to ONE shared `styleMat` and **dispose the original GLTF material** on swap
  (else per-tile leak). Do NOT add a `dispose-model` that touches the shared material (it blanks all tiles).

## Renderer (GlobeCanvas)
`renderer.outputColorSpace = SRGBColorSpace` (explicit); `renderer.toneMapping = NeutralToneMapping` (ACES/AgX
desaturate the cyan accent + additive rim). The earth ShaderMaterial is self-lit (`uSunDir` + night floor);
scene lights (`DirectionalLight 1.5` at `(5,2,4)` matching `SUN_DIR`, `HemisphereLight` fill) exist to light
the OSM building tiles — keep them non-zero or night-side buildings render pure black.

## Verifying with Playwright
`wix dev` → localhost:4321. `wix dev`'s background wrapper reports "completed" immediately (nohup detaches) —
the server keeps running. Confirm building loads via `browser_network_requests` filter `96188|b3dm` (200 OK
`.b3dm` = tiles refining). Discrete wheel bursts overshoot at zoomSpeed 5; use spaced small deltas to control
zoom. Related: [[architecture/system-overview]] [[decisions/adr-000-locked-stack]].
