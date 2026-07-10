/**
 * tuning.ts — every tunable of the globe instrument, in one place (convention:
 * `.claude/conventions/globe-tuning.md`).
 *
 * The scene modules under `scene/` contain STRUCTURE (geometry, shader plumbing, lifecycle);
 * this file contains every NUMBER an art pass may want to touch: grades, scale heights, altitude
 * gates, motion, external tile endpoints. Values marked "verified" are the browser-VERIFIED
 * 2026-07-10 look (Playwright at LEO / orbit / night / mid-fade / city) — retune freely, but
 * re-verify in the browser afterwards (`mem:patterns/globe-rendering`).
 *
 * Rules (the convention, short form):
 *  • Pure data only — no three.js imports, no colours. Colour ALWAYS flows through the GL token
 *    bridge `lib/theme/tokens.ts` (ADR D14); this file may not introduce colour literals.
 *  • Numbers used inside GLSL are injected at shader-build time via `glf()` (scene/glsl.ts) —
 *    changing them re-instantiates the material on next load; runtime-animated values stay uniforms.
 *  • Units in the name or the doc line. Metres unless stated otherwise.
 */

// Re-exported so globe code has ONE source for the ellipsoid (kept in lib/geo — pure, unit-tested,
// and guaranteed to match three's WGS84_ELLIPSOID, which the OSM building tiles extrude from).
export { WGS84_A, WGS84_B } from "../../lib/geo/projection";

export type Tuple3 = readonly [number, number, number];

/** Sun lighting. `direction` is only the FIRST-FRAME fallback — since the pre-Phase-4 ephemeris
 *  pass (2026-07-10) the real sun direction is computed from scene time (`lib/ephemeris`, ADR D6)
 *  and written per-sample into every consumer (earth shader, ground grade, atmosphere, sky bodies,
 *  GlobeCanvas DirectionalLight) by the orchestrator — one source, terminator always agrees. */
export const SUN = {
  /** Fallback direction TO the sun in ECEF before the first ephemeris sample (normalised at use). */
  direction: [5, 2, 4] as Tuple3,
  /** DirectionalLight intensity on the building tiles (verified 1.5; 2.2 clipped highlights). */
  keyIntensity: 1.5,
  /** HemisphereLight fill so night-side buildings never go pure black (AmbientLight(water) was ~0).
   *  (was 0.4; lowered when moonlight landed — the moon now carries part of the night fill). */
  hemiIntensity: 0.25,
} as const;

/** Ephemeris-driven sky bodies (pre-Phase-4). Positions are astronomically correct (astronomy-
 *  engine, JPL-Horizons-verified ≤0.0007°); both bodies render as camera-anchored impostors at a
 *  fraction of the DYNAMIC far plane with their TRUE apparent angular size, so they read correctly
 *  at any altitude and can never be far-plane-clipped. */
export const SKY = {
  /** NASA CGI Moon Kit LROC colour map (public domain; svs.gsfc.nasa.gov/4720; 1k is plenty for
   *  a ~0.5° disc). Map centre (lon 0) = the near side — the renderer aims it at Earth. */
  moonTexture: "/textures/moon-color.jpg",
  /** Re-sample the ephemeris when scene time moved this much (sun drifts 0.004°/s — 1 s ≪ 1 px). */
  sampleIntervalMs: 1_000,
  /** Impostor distance = camera.far × this (behind all terrain at 0.5? No — in front of the far
   *  plane, behind most geometry; depth-tested so the earth/buildings occlude correctly). */
  impostorFarFrac: 0.5,
  /** Sun halo plane radius = disc radius × this (room for the shader falloff; bloom adds the rest). */
  sunGlowExtent: 7,
  /** HDR multiplier on the sun core (>1 pushes it over BLOOM.threshold — the glow driver). */
  sunIntensity: 5,
  /** Halo gain inside the impostor shader (kept low — UnrealBloom carries the wide glow). */
  sunGlowGain: 0.5,
  /** Moon albedo multiplier (>1 pushes the lit limb into bloom; raised 2026-07-10 "moon brighter"). */
  moonBrightness: 1.8,
  /** Earthshine floor on the moon's dark side (0 = pitch black new moon). */
  moonEarthshine: 0.1,
  /** Horizon occlusion fade band (m). The impostors sit at a FAKE camera-anchored distance, so the
   *  depth buffer cannot occlude them against the planet (the limb is farther than the impostor) —
   *  each fragment instead tests its view ray against the ellipsoid analytically and fades out as
   *  the ray's closest-approach altitude drops through this band. ~the atmosphere line scale height
   *  reads as the body melting into the horizon haze rather than popping. */
  horizonFadeBandM: 40_000,
  /** Max DirectionalLight intensity of moonlight on buildings (scaled by illuminated fraction). */
  moonKeyIntensity: 0.3,
  /** Max moonlight term inside the earth/ground shaders (scaled by illuminated fraction). */
  moonSceneGlow: 0.35,
} as const;

/** Soft bloom post (GlobeCanvas composer): sun/moon/city-lights glow; earth catches it very
 *  slightly. Threshold sits just under 1.0 so only HDR/near-white pixels bloom (the scene is dark). */
export const BLOOM = {
  strength: 0.4,
  radius: 0.5,
  threshold: 0.9,
  /** MSAA samples on the composer's HalfFloat target (the default 0 would alias building edges). */
  msaaSamples: 4,
} as const;

/** Real-time sun shadows (city scale). One tight orthographic shadow camera follows the view
 *  focus; enabled only near the ground AND while the sun is up there (a below-horizon sun would
 *  project garbage). World coords are ~6.4e6 m → float32 quantises at ~0.5 m: normalBias absorbs
 *  the acne (three docs: normalBias is world-units, made for exactly this). */
export const SHADOWS = {
  /** Shadows render only below this camera altitude (nothing to see from orbit; big perf win). */
  maxAltM: 30_000,
  /** Shadow map resolution (2048² ≈ 1.2 m/texel over a 2.5 km half-extent). */
  mapSize: 2048,
  /** Orthographic half-extent (m) around the view focus. */
  boundsM: 2_500,
  /** Light sits this far (m) from the focus toward the sun. */
  lightDistM: 8_000,
  /** Shadow camera near/far margin (m) around the focus distance. */
  depthMarginM: 3_500,
  /** Depth bias (negative pulls surfaces toward the light — kill acne, keep contact). */
  bias: -2e-4,
  /** World-space normal offset (m) — the large-coordinate acne killer. */
  normalBias: 1.0,
  /** PCF blur radius (texels) — soft penumbra edge. */
  radius: 3,
  /** Sun must be at least this high over the focus (dot with up ≈ sin(elev)) — ~2°. */
  minSunElevSin: 0.03,
  /** Ground shadow overlay darkness (ShadowMaterial opacity — invisible where unshadowed).
   *  The graded ground is dark: below ~0.5 the darkening is imperceptible (verified with a
   *  red-mask debug pass 2026-07-10 — the mask itself was always correct). */
  groundOpacity: 0.55,
} as const;

/** Renderer-level knobs (GlobeCanvas). */
export const RENDERER = {
  /** DPR cap — 2 keeps 4K/mobile fill-rate sane; raise only after a mobile memory pass. */
  maxPixelRatio: 2,
  /** NeutralToneMapping exposure (ACES/AgX rejected — they desaturate the cyan accent). */
  toneMappingExposure: 1.0,
} as const;

/** Default "spacecraft in LEO" pose (PROJECT_SEED §2) — camera SW of Dnipro aimed past it toward
 *  the NE horizon so the limb + halo read prominently. Geodetic degrees / metres.
 *  2026-07-10 owner pass: target pushed further NE (~38° depression vs the old ~47°) so the camera
 *  starts MORE tilted — the horizon band sits lower in frame and more of the curve is visible. */
export const POSE = {
  /** Perspective FOV (deg). 38 = the cinematic long-lens look the framing was verified at. */
  fovDeg: 38,
  /** Camera near plane (m) — GlobeControls re-fits both planes every frame after init. */
  near: 1,
  /** Camera far plane (m) at init. */
  far: 1e9,
  cam: { latDeg: 46.0, lonDeg: 31.3, altM: 1_100_000 },
  target: { latDeg: 57.3, lonDeg: 46.9, altM: 0 },
} as const;

/** Altitude gates (m above the WGS84 ellipsoid — ALWAYS via `getPositionElevation`; spherical
 *  `length()-a` is up to ~21 km off at mid-latitudes and mis-times these). */
export const GATES = {
  /** Imagery TilesRenderer updates below this — above it the stylized base owns the ground. */
  groundActiveAlt: 3_000_000,
  /** Screen-door fade starts here (imagery invisible above)… */
  groundFadeTop: 2_600_000,
  /** …and completes here (imagery fully owns the ground below). Overlaps the base's resolution
   *  limit so the handoff is a dissolve, never a switch. */
  groundFadeBottom: 1_400_000,
  /** Graticule + atmosphere hidden below (no wire cage / shell overdraw at street level). */
  decorMinAlt: 150_000,
  /** Stars fully gone below this… */
  starFadeBottom: 250_000,
  /** …fading in across this span (fully visible at LEO, gone before street level). */
  starFadeSpan: 450_000,
} as const;

/** Idle orbital drift — the "slightly rotating by default" seed motion (design-board spec). */
export const DRIFT = {
  /** Only drift while genuinely "in orbit". */
  minAlt: 400_000,
  /** Pause on pointer/wheel/touch; resume this many ms after the last interaction. */
  resumeMs: 8_000,
  /** Deg/frame about ECEF +Z. 0.0011 ≈ 0.066°/s @60fps — real ISS angular pace (verified feel). */
  degPerFrame: 0.0011,
} as const;

/** GlobeControls feel (2026-07-10 owner pass: gradual verticality, eased zoom, longer inertia). */
export const CONTROLS = {
  /** Inertia decay time-constant (s-ish; library: 2^(-dt/factor)). Raised 0.15 → 0.28 for a
   *  longer, more premium coast after a globe fling. */
  dampingFactor: 0.28,
  /** Max tilt (rad) — π/2 allows pitching to the true horizon. */
  maxAltitudeRad: Math.PI / 2,
  /** Keep the camera this far (m) above surfaces via adjustHeight. */
  cameraRadius: 8,
  /** Trackpad-pinch zoom rate (library default 1 is painfully slow; verified 5). */
  zoomSpeed: 5,
  /** GlobeControls pitches the camera toward nadir while zooming in (it rotates the camera around
   *  the zoom point as the local up changes — EnvironmentControls._setFrame, applied at FULL
   *  strength on zoom-in). This keeps only this fraction of that auto-verticalization per zoom
   *  step: 1 = library behaviour (snaps overhead), 0 = camera keeps its oblique tilt entirely.
   *  The orchestrator counter-rotates after controls.update() — no library fork. */
  zoomTiltKeep: 0.35,
  /** Temporal zoom easing (ms). The library consumes the whole wheel delta in ONE frame; the
   *  orchestrator instead banks deltas and releases exp(-dt/tau) per frame — gradual, eased
   *  camera movement instead of stepping. 0 disables. */
  zoomSmoothTauMs: 160,
  /** Altitude-scaled zoom braking: at/below `zoomSlowAltM` the effective zoomSpeed shrinks to
   *  `zoomSlowFrac × zoomSpeed`, ramping smoothly back to full above it. The library step is
   *  already ∝ distance-to-surface; this adds the extra "ease in and slow close to ground". */
  zoomSlowAltM: 30_000,
  zoomSlowFrac: 0.35,
  /** Declination-slider easing time-constant (ms) — how fast the camera glides to a slider-set
   *  tilt (0° = straight down, 90° = horizon). */
  tiltEaseTauMs: 240,
  /** Slider range (deg). Max stays inside GlobeControls' maxAltitude clamp (π/2) minus a hair
   *  so the per-frame clamp never fights the eased approach. */
  tiltMinDeg: 0,
  tiltMaxDeg: 88,
} as const;

/** Phase-1 test city (Dnipro, UA). The old `buildingSinkM` float workaround was REMOVED
 *  2026-07-10: the ground now renders Cesium World Terrain — the same terrain the OSM buildings
 *  are clamped to — so bases seat without a hack. */
export const TERRAIN = {
  cityLatDeg: 48.4647,
  cityLonDeg: 35.0462,
} as const;

/** External tile sources. ToS: Esri World Imagery is hackathon-standard but UNVERIFIED for
 *  production; attribution for Esri + OSM lives in the DOM (src/pages/index.astro). */
export const TILESETS = {
  /** Cesium OSM Buildings (buildings-only worldwide 3D tiles). */
  ionAssetId: "96188",
  /** Cesium World Terrain (quantized-mesh; the SAME terrain OSM Buildings are clamped to —
   *  rendering it seats building bases without the old 90 m sink hack). */
  terrainAssetId: "1",
  /** b3dm meshes are Draco-compressed; decoder fetched from Google's CDN. */
  dracoDecoderPath: "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  /** Esri World Imagery XYZ endpoint ({z}/{y}/{x} order!). */
  esriImageryUrl:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  /** Esri refines to ~z19 (sub-metre in cities). */
  esriMaxLevel: 19,
} as const;

/** Base ellipsoid — the orbit instrument (NASA Blue Marble graded into the palette + VIIRS night
 *  lights + normal relief). Colour maps are sRGB; mask/elevation/normal are DATA (NoColorSpace —
 *  an sRGB tag on data decode-darkens it; that was the original near-black bug). */
export const EARTH = {
  textures: {
    /** land=white, ocean=black mask (data). */
    landMask: "/textures/earth-landmask.png",
    /** grayscale elevation (data). */
    elevation: "/textures/earth-topology.png",
    /** tangent-space relief normals (data). */
    normal: "/textures/earth-normal.jpg",
    /** NASA Blue Marble JULY topo+bathy 5400² (sRGB; record 73751 — December has a snow blanket). */
    color: "/textures/earth-color.jpg",
    /** NASA VIIRS city lights 3600² (sRGB; record 79765). */
    night: "/textures/earth-night.jpg",
  },
  /** Sphere tessellation (384² segments ≈ smooth limb at LEO). */
  segments: 384,
  /** Base sits at WGS84×this (~1.9 km under) so the imagery ground (at exact WGS84) always renders
   *  in front — no base/imagery z-fight. Sub-pixel from orbit; hidden by imagery at zoom. */
  shrink: 0.9997,
  /** polygonOffset (factor=units) keeping buildings above the base before imagery loads. */
  polygonOffset: 1,
  // --- uniform defaults (runtime-tunable via __globe.earthUniforms in DEV) --------------------
  /** Dark-side floor — just enough to navigate; city lights + moonlight carry the rest.
   *  (was 0.32; dropped 2026-07-10 "night side more pronounced" owner pass). */
  nightFloor: 0.22,
  /** Normal-map strength: 0 = flat, 1 = full 3D relief. */
  relief: 0.75,
  /** 0 = pure palette duotone, 1 = pure (graded) NASA colour (verified 0.58 — geology reads,
   *  tone stays stylized per C2). */
  organic: 0.58,
  /** Chroma kept from the NASA colour before the palette mix (0 = grayscale). */
  sat: 0.5,
  /** Darkens the NASA colour into the instrument's tonal range. */
  gain: 0.55,
  // --- shader-baked constants (glf-injected; changing needs a reload) ------------------------
  /** Coastline anti-alias band over the land mask (smoothstep lo/hi). */
  coastBand: [0.35, 0.65],
  /** Elevation ramp land→landHi (smoothstep lo/hi over 0..1 elevation). */
  landRamp: [0.02, 0.14],
  /** Elevation ramp →peak. */
  peakRamp: [0.22, 0.58],
  /** Night-side band over the half-lambert wrap term: lights fade in as wrap crosses lo→hi. */
  nightBand: [0.3, 0.52],
  /** VIIRS emissive boost — li²·this (the square kills haze, keeps real cities). */
  cityLightGain: 2.1,
  /** Day-side limb scattering: rim = (1-N·V)^pow · gain — melts the disc into the halo. */
  rimPow: 3.0,
  rimGain: 0.12,
} as const;

/** Lat/lon graticule decoration. */
export const GRATICULE = {
  /** Grid step (deg). */
  stepDeg: 15,
  /** Segments per line — 128 keeps parallels round at the limb. */
  segmentsPerLine: 128,
  lineOpacity: 0.14,
  /** Lift above the base surface (scale multiplier; 1.0015 ≈ 10 km — clears the relief). */
  lift: 1.0015,
  /** Near-hemisphere discard threshold on dot(normal, toCam) — auto-vanishes when inside. */
  nearCutoff: 0.05,
} as const;

/** Ray-based limb glow (NOT fresnel — a fresnel rim peaks at the SHELL silhouette, which from LEO
 *  detaches from the limb as a floating band). Per-fragment closest-approach altitude of the view
 *  ray drives exp(-h/H) falloff: pinned to the limb at ANY camera altitude. */
export const ATMOSPHERE = {
  /** Shell radius as a base-scale multiplier — high enough for the haze to decay inside it.
   *  NOTE: only ONE hemisphere is drawn per frame (near when outside, far when inside) because
   *  GlobeControls' dynamic far plane clips the other — see scene/atmosphere.ts. */
  shellScale: 1.1,
  segments: 96,
  /** Master glow gain (verified 0.55; design canvas: halo restraint IS the look, ≈5% alpha). */
  intensity: 0.55,
  /** Teal line scale height (m) — thin, hugs the horizon. */
  lineScaleHeightM: 60_000,
  /** Blue haze scale height (m) — the soft outer falloff. */
  hazeScaleHeightM: 240_000,
  /** uOrbit ramps 0→1 across [start, start+span] altitude: LEO keeps the thick horizon haze,
   *  outer orbit thins the halo (owner 2026-07-10: "distinct but elegant and subtle"). */
  orbitStartAlt: 2_500_000,
  orbitSpanAlt: 6_500_000,
  /** At full orbit both scale heights shrink to this fraction (1/10 width). */
  orbitWidthShrink: 0.1,
  /** Line colour = mix(atmosphere, atmosphereDeep, base + byOrbit·uOrbit) — bluer as we pull away. */
  lineBlueBase: 0.2,
  lineBlueByOrbit: 0.5,
  /** Limb composite weights: line·this + haze·that. */
  lineGain: 0.8,
  hazeGain: 0.3,
  /** Rays that strike the planet get this faint blue air-wash instead of the limb line. */
  groundWashGain: 0.045,
  /** Night-side glow floor (sun-modulation lower bound). */
  sunFloor: 0.25,
  /** Ground-hit detection band around Re (m below / above) for the wash blend. */
  groundBandBelowM: 60_000,
  groundBandAboveM: 10_000,
} as const;

/** Camera-centred starfield. Scaled per-frame to sit beyond the farthest visible terrain (limb
 *  tangent distance — NOT nadir altitude) yet inside GlobeControls' dynamic far plane. */
export const STARS = {
  count: 5000,
  /** Point size = rand²·sizeSpread + sizeBase (px, pre-DPR) — a few bright, many faint. */
  sizeBase: 0.8,
  sizeSpread: 2.0,
  /** Twinkle: brightness = base + amp·sin(speed·t + phase). Subtle — it's an instrument. */
  twinkleBase: 0.7,
  twinkleAmp: 0.3,
  twinkleSpeed: 1.5,
  /** Peak star alpha. */
  alpha: 0.8,
  /** Sphere radius = limbDistance·this (just beyond the farthest terrain)… */
  limbMargin: 1.05,
  /** …clamped to camera.far·this (inside the dynamic far plane, or it gets culled). */
  farClamp: 0.9,
} as const;

/** OSM building style — design idiom "dark mass, lit edges" (canvas ftw-scene). Colours: fill =
 *  tokens.surface, emissive = tokens.land, edges = tokens.landHi (see scene/buildings.ts). */
export const BUILDINGS = {
  roughness: 0.85,
  /** Faint sage emissive stops the night side going pure black. */
  emissiveIntensity: 0.1,
  /** Push faces back a hair so their OWN edge lines win the depth tie (lines ignore polygonOffset)
   *  while staying under the ground's offset (1) so bases keep beating the imagery. */
  polygonOffset: 0.5,
  /** Hard-crease threshold (deg) for EdgesGeometry strokes. */
  edgeAngleDeg: 30,
  edgeOpacity: 0.4,
} as const;

/** Imagery-ground palette grade (chained onBeforeCompile over each Esri tile material) — pulls the
 *  satellite imagery into the instrument's tonal range + the SAME sun shading as the base so the
 *  terminator is continuous across LODs. Runtime-tunable via __globe.groundUniforms in DEV. */
export const GROUND = {
  /** Dark-side floor — slightly above the base's: close-zoom ground must stay navigable.
   *  (was 0.45; dropped 2026-07-10 "night side more pronounced" owner pass). */
  nightFloor: 0.38,
  /** Pull satellite chroma toward the instrument (0 = untouched, 1 = grayscale). */
  desat: 0.52,
  /** Sit the imagery in the dark scene's tonal range. */
  gain: 0.56,
  /** Cool slate cast, per-channel multiplier (palette direction). */
  cast: [0.92, 0.99, 1.06] as Tuple3,
  /** Water detection: smoothstep(0, this, blue − max(red, green)) — blue-dominant = water. */
  waterThreshold: 0.12,
  /** Water pixels darken to this fraction (Esri's bright seas → near-black palette ocean). */
  waterDarken: 0.35,
  /** Screen-door bayer offset (px) vs TilesFadePlugin's grid so the two dithers don't collide. */
  bayerOffsetPx: 2.0,
  /** Imagery sits behind building footprints (bases win ties). */
  polygonOffset: 1,
  /** ImageOverlayPlugin per-tile composite texture resolution (px). 256 = plugin default;
   *  raise if grazing-angle imagery reads soft (memory: ~res²·4 B per tile per overlay). */
  overlayResolution: 256,
  // --- soft adaptive loading (2026-07-10 owner pass: no patchy pop-in on page open) -----------
  /** TilesFadePlugin per-tile dissolve duration (ms). Library default 250 reads as popping;
   *  700 lets refinement breathe. */
  fadeDurationMs: 700,
  /** TilesFadePlugin fade-out budget before it snaps all fades on a moving camera. The idle
   *  drift moves the camera every frame, so the library default (50) snapped constantly. */
  maxFadeOutTiles: 300,
  /** Adaptive screen-space error target (px): coarse at orbit → fine near the ground, lerped
   *  across [errorNearAlt, errorFarAlt]. QuantizedMeshPlugin pins errorTarget=2 at init, which
   *  forces DEEP refinement even at LEO — the long patchy first load. Coarser orbit tiles reach
   *  full coverage far sooner; diving refines them progressively (per-tile fades cover it). */
  errorTargetNear: 2,
  errorTargetFar: 12,
  errorNearAlt: 60_000,
  errorFarAlt: 1_200_000,
  /** Initial-reveal ease time-constant (ms): uFtwFade low-passes toward its altitude target ×
   *  load-readiness, so the layer dissolves in only once tiles actually exist (page open shows
   *  the clean stylized base, then terrain grows out of it — never a patchwork). */
  revealTauMs: 600,
  /** Until the first tiles-load-end, readiness = loadProgress × this cap (never fully in while
   *  the initial wave is still downloading). */
  revealProgressCap: 0.85,
  /** Failed Esri overlay fetches leave permanently blank tiles unless retried — debounce (ms)
   *  for calling resetFailedOverlays() after a load-error burst. */
  overlayRetryMs: 8_000,
} as const;

/** Placed-photo frustum + image plane (Phase 3, ADR D5 v1: textured plane at the far face).
 *  Colours: edge lines = tokens.accent (the reserved signal colour); the plane is the photo. */
export const FRUSTUM = {
  /** Apex → image-plane distance (m). Purely presentational in v1 — how big the placed photo
   *  reads against the buildings. */
  planeDistM: 120,
  /** Camera height above the rendered ground (m) when EXIF altitude is missing — standing eye
   *  height. D4: GPS altitude is junk → terrain-snap; our ground IS the ellipsoid until real
   *  terrain lands, so the altitude slider means "height above the rendered ground". */
  eyeHeightM: 1.7,
  /** Frustum edge-line opacity (accent — keep restrained, it's a signal not a decoration). */
  lineOpacity: 0.85,
  /** Aspect fallback when neither a decoded texture nor EXIF dimensions exist (classic 3:2). */
  fallbackAspect: 1.5,
} as const;

/** Cinematic flight to a placed photo (design board motion spec: desktop 2200 ms,
 *  cubic-bezier(.65, 0, .35, 1); reduced-motion = instant cut). */
export const FLIGHT = {
  durationMs: 2200,
  /** Bezier control points (x1, y1, x2, y2) — the design system's master easing. */
  easing: [0.65, 0, 0.35, 1] as const,
  /** Viewing pose: camera sits planeDist·backFactor behind the apex along −forward… */
  backFactor: 2.8,
  /** …lifted planeDist·liftFactor along local up, looking at the image-plane centre. */
  liftFactor: 1.1,
  /** Mid-flight altitude bump = min(arc·groundDistance, max) — short hops rise a little, long
   *  hauls get a proper ballistic arc (matters for Phase-5 pin→pin jumps). */
  arcBumpFactor: 0.35,
  arcBumpMaxM: 2_500_000,
} as const;
