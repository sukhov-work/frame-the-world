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

/** Golden-hour grade (Phase 4, ADR D6/D14). The signal is the SINE of the sun's elevation —
 *  per-fragment `dot(surfaceNormal, sunDir)` in the earth/ground/atmosphere shaders (so the warm
 *  band hugs the terminator and appears at the correct LOCAL times everywhere at once), and
 *  `dot(sunDir, focusUp)` on the CPU for the building key light. The band is a bell built from two
 *  smoothsteps over that sine; colour is tokens.goldenHour only (D14). Curve shape is shader-baked
 *  (glf) — retune needs a reload; strengths are baked too (they're look, not animation). */
export const GOLDEN = {
  /** Bell fade-in over sin(sun elevation): starts in civil twilight… (sin −8°) */
  fadeInLo: -0.139,
  /** …fully warm with the sun on the horizon. (sin −1°) */
  fadeInHi: -0.0175,
  /** Still fully warm at +7° elevation… (sin +7°) */
  fadeOutLo: 0.122,
  /** …gone by +16° — the classic "first/last hour" span. (sin +16°) */
  fadeOutHi: 0.276,
  /** Multiplier on tokens.goldenHour in the multiplicative cast (>1 compensates the luminance the
   *  warm multiply removes from G/B). */
  castGain: 1.15,
  /** Cast strength on the stylized base earth (orbit view). */
  earthStrength: 0.7,
  /** Cast strength on the graded imagery ground (city/mid view — where golden hour is felt). */
  groundStrength: 0.8,
  /** Warm mix on the atmosphere limb line where the sun grazes it. */
  atmStrength: 0.6,
  /** Building key light: lerp(white → goldenHour) by bell(focus sun elevation) × this. */
  keyStrength: 0.85,
} as const;

/** Time scrubber UI (panels/TimeScrubber). The rail spans a window centred on an anchor instant;
 *  dragging pins scene time via store/time.setTime — the ephemeris relights everything. */
export const SCRUB = {
  /** Rail span (hours) — ±12 h covers a full terminator sweep + both golden hours. */
  windowHours: 24,
  /** Keyboard arrow step (minutes). */
  keyStepMin: 10,
  /** Releasing the knob in this outer fraction of the rail recentres the window on the pinned
   *  time — repeated edge drags walk multiple days without a date picker. */
  edgeRecenterFrac: 0.02,
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
  /** Shadow map resolution (4096² ≈ 0.78 m/texel over a 1.6 km half-extent — owner 2026-07-10
   *  "crisper"; was 2048²/2.5 km ≈ 2.4 m/texel). ~67 MB depth target — desktop-fine; drop to
   *  2048 if a mobile memory pass complains. */
  mapSize: 4096,
  /** Orthographic half-extent (m) around the view focus (tighter = more texels per metre). */
  boundsM: 1_600,
  /** Light sits this far (m) from the focus toward the sun. */
  lightDistM: 8_000,
  /** Shadow camera near/far margin (m) around the focus distance. */
  depthMarginM: 3_500,
  /** Depth bias (negative pulls surfaces toward the light — kill acne, keep contact). */
  bias: -2e-4,
  /** World-space normal offset (m) — the large-coordinate acne killer. */
  normalBias: 1.0,
  /** PCF blur radius (texels) — soft penumbra edge (3 → 2: crisper contact, still not aliased). */
  radius: 2,
  /** Sun must be at least this high over the focus (dot with up ≈ sin(elev)) — ~2°. */
  minSunElevSin: 0.03,
  /** Ground shadow overlay darkness (ShadowMaterial opacity — invisible where unshadowed).
   *  The graded ground is dark: below ~0.5 the darkening is imperceptible (verified with a
   *  red-mask debug pass 2026-07-10 — the mask itself was always correct; re-verified for the
   *  "crisper" pass: 4096² edges are clean, presence was the limiter → 0.55 → 0.75 + a cool
   *  tokens.water tint instead of pure black). */
  groundOpacity: 0.75,
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
  /** Screen-door fade starts here (imagery invisible above). History: 2.6e6/1.4e6 put full Esri
   *  imagery at LEO → patchwork; 1.6e6/650e3 halved it but the patches PERSISTED (owner screenshot
   *  #2, 2026-07-10) — they are regional mosaic seams and haze baked into Esri's low/mid-zoom
   *  source imagery itself, not a loading state. The Blue Marble base (which has no seams) now
   *  owns everything above ~750 km; Esri only dissolves in below, where its source zooms are
   *  detailed and consistent. */
  groundFadeTop: 750_000,
  /** …and completes here (imagery fully owns the ground below). Overlaps the base's resolution
   *  limit so the handoff is a dissolve, never a switch. */
  groundFadeBottom: 380_000,
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
  /** Keep the camera this far (m) above surfaces via adjustHeight (8 → 2.5 in Phase 5.5 S2:
   *  street level is the instrument's point — the orchestrator's terrain guard owns the
   *  underground case, this only cushions rooftop grazes). */
  cameraRadius: 2.5,
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
  /** Heading-slider easing time-constant (ms) — camera orbits the view focus about its local up,
   *  preserving the current tilt exactly (rigid rotation about the up axis). */
  headingEaseTauMs: 260,
  /** Zoom-slider easing time-constant (ms) — log-space exponential approach to the target
   *  altitude (the manual alternative to wheel/pinch zoom). */
  zoomEaseTauMs: 320,
  /** Zoom-slider altitude range (m) — log-mapped across the slider track. Floor lifted
   *  120 → 2 (Phase 5.5 S2): street level is the point of the instrument. The value is metres
   *  above the ELLIPSOID — over real terrain the glide stalls against cameraRadius/terrain and
   *  the orchestrator releases it (stall detection), so a sub-terrain floor is safe. */
  zoomMinAltM: 2,
  zoomMaxAltM: 12_000_000,
  /** Consecutive stalled frames (glide requested, altitude unchanged) before a zoom glide is
   *  released — the camera is resting on terrain/cameraRadius and will never "arrive". */
  zoomStallFrames: 6,
  /** 2D/3D quick toggle (Phase 5.5 S2): 3D restores this tilt; 2D glides to 0 (nadir). */
  toggle3dTiltDeg: 55,
  /** The toggle reads "2D" while the live tilt is under this (deg). */
  twoDMaxTiltDeg: 10,
  /** Encoder-style rate controls (Phase 5.5 S2 — spring-centred ROTATE/ZOOM): max rates at
   *  full deflection. Heading in deg/s (compass-clockwise positive)… */
  headingRateMaxDegPerS: 45,
  /** …zoom as a log-space rate (per s): altitude ×= exp(−rate·dt); 1.1 ≈ 3×/s at full stick. */
  zoomRateMaxPerS: 1.1,
  /** Expo response curve on stick deflection (rate = max·sign·|d|^gamma) — fine control near
   *  centre, speed at the ends. */
  rateExpoGamma: 2.2,
  /** Applied-rate low-pass (ms): eases rate changes in AND lets motion coast out on release. */
  rateEaseTauMs: 140,
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
  /** Terminator band over the SINE of solar elevation (smoothstep lo→hi). The old half-lambert
   *  wrap² spread day→night across the whole sphere ("dusk line very wide and unnatural" — owner
   *  2026-07-10); this narrows the transition to ~9.2°: lo ≈ sin(−6°) — dark by civil dusk;
   *  hi ≈ sin(+3.2°) — fully lit just after sunrise. */
  termBand: [-0.105, 0.055],
  /** Day-side shading floor: the lit hemisphere still grades from this at the terminator up to 1
   *  at the subsolar point — a flat day side would kill the sphere's dimensionality. */
  dayGradMin: 0.78,
  /** City-lights band over the same sine: fully on below sin(−6.9°), fading out by sunset. */
  lightsBand: [-0.12, -0.005],
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
  // --- Low-altitude sky regime (owner 2026-07-10: "day sky on close zooms … quite dark and
  //     ugly" + "realistic haze on horizon"). Below skyGoneAlt the same shell blends from the
  //     orbital limb model into a proper sky: light-blue day dome + bright horizon haze, warmed
  //     through the golden band at dawn/dusk, black at night (stars own it). --------------------
  /** Sky regime fully in at/below this camera altitude (m)… */
  skyFullAlt: 12_000,
  /** …blended out by this altitude (back to the pure orbital limb model). */
  skyGoneAlt: 120_000,
  /** Below this altitude the shell re-anchors to the CAMERA (radius = far × domeFarFrac): the
   *  earth-centred shell's visible hemisphere would be clipped by GlobeControls' tightly-fitted
   *  far plane at street level. The shader only uses the fragment DIRECTION, so swapping the
   *  geometry is seamless — skyGoneAlt < domeMaxAlt keeps both regimes identical at the swap. */
  domeMaxAlt: 350_000,
  domeFarFrac: 0.45,
  /** Zenith sky brightness (multiplies tokens.skyDay). */
  skyDayGain: 0.85,
  /** Horizon haze brightness (multiplies tokens.skyHorizon). Horizon total ≈ 1.05 — a whisker
   *  over BLOOM.threshold, so the haze picks up a soft glow without blowing out. */
  skyHorizonGain: 0.35,
  /** Haze falloff over sin(view elevation) above the horizon — smaller hugs the horizon tighter. */
  skyHazeFalloff: 0.1,
  /** Haze falloff BELOW the horizon (aerial perspective over distant terrain, decaying fast so
   *  near-ground rays stay clean — near geometry depth-occludes the dome anyway). */
  skyHazeBelow: 0.08,
  /** Day factor ramp over sin(sun elevation): night → full day across this band. */
  skyDawnLo: -0.12,
  skyDawnHi: 0.12,
  /** How strongly the golden band warms the horizon haze at dawn/dusk. */
  skyGoldStrength: 0.55,
  /** Zenith→horizon mix exponent over sin(view elevation) (lower = more zenith colour). */
  skyZenithPow: 0.55,
} as const;

/** Camera-centred starfield. Scaled per-frame to sit beyond the farthest visible terrain (limb
 *  tangent distance — NOT nadir altitude) yet inside GlobeControls' dynamic far plane.
 *  Phase 4 (D6): positions come from the REAL Yale Bright Star Catalog (packed binary asset,
 *  `scripts/build-star-catalog.mjs`); the star sphere is rotated by −GAST about +Z each ephemeris
 *  sample so constellations sit correctly over the earth for the scene time. The procedural
 *  random field remains as the pre-load / fetch-failure fallback. */
export const STARS = {
  /** Packed catalog asset (Float32 records; see lib/ephemeris/stars.ts for the layout). */
  catalogUrl: "/data/bsc5.bin",
  /** FALLBACK-ONLY procedural star count (until the catalog loads, or if the fetch fails). */
  count: 5000,
  /** Catalog magnitude → point size: size = sizeBase + sizeSpread·10^(−0.4·(V − magRef)·sizeGamma),
   *  clamped to sizeMax. magRef ≈ the naked-eye median keeps most stars near sizeBase. */
  magRef: 2.0,
  /** Exponent softener on the flux law for SIZE (pure flux would make Sirius a golf ball). */
  sizeGamma: 0.35,
  sizeMax: 5.0,
  /** Catalog magnitude → brightness attribute (multiplies alpha): 10^(−0.4·(V − magRef)·brightGamma).
   *  Floor raised 0.18 → 0.3 → 0.55 across browser passes (phase4-04/05): a ~1.5 px point below
   *  ~0.5 alpha weight simply vanishes at DPR 1 — the mag-4+ tail (most of BSC5) went invisible.
   *  Brightness hierarchy still reads through SIZE; the floor keeps the sky populated. */
  brightGamma: 0.6,
  brightMin: 0.55,
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
  /** Night visibility at LOW altitude (owner 2026-07-10: "at night stars must be visible at low
   *  altitudes"): below the altitude fade band the stars now also fade in as the sun sets at the
   *  camera — in at sin(elev) = nightVisStartSin, fully on by nightVisFullSin (~ −8°, nautical
   *  dusk). Fade = max(altitude fade, night fade). */
  nightVisStartSin: -0.02,
  nightVisFullSin: -0.14,
} as const;

/** Procedural Milky Way band (owner 2026-07-10: "very subtle milkyway at realistic space
 *  coords"). Points scattered about the REAL galactic plane (IAU J2000 pole/centre —
 *  `lib/ephemeris/stars.ts galacticToEquatorial`), rendered as a child of the BSC5 star sphere so
 *  the −GAST sidereal rotation places the band correctly over the earth for the scene time.
 *  Density/brightness bulge toward the galactic centre (Sagittarius). Kept FAINT — it reads as a
 *  texture of the night sky, not a feature. */
export const MILKYWAY = {
  count: 14_000,
  /** Peak point alpha (≪ STARS.alpha — subtlety is the spec; live-tuned 2026-07-10). */
  alpha: 0.25,
  /** Point sizes (px, pre-DPR): sizeBase + rand²·sizeSpread. Below ~1 px a point often covers
   *  no pixel centre at DPR 1 and simply vanishes (verified live — the 0.6 px first cut rendered
   *  NOTHING); ~2-4.5 px + low alpha reads as the intended soft veil. */
  sizeBase: 2.2,
  sizeSpread: 2.2,
  /** Gaussian half-thickness of the band across galactic latitude (deg). */
  sigmaBDeg: 8.5,
  /** Fraction of points drawn from a 2.5× wider gaussian (soft halo, no hard band edge). */
  haloFrac: 0.2,
  /** Brightness bulge toward the galactic centre: weight = base + (1−base)·exp(−½(l/σ)²). */
  bulgeSigmaLDeg: 55,
  baseWeight: 0.35,
  /** Twinkle amplitude on the band (near-static — it's diffuse light, not point stars). */
  twinkleAmp: 0.05,
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
  /** High-altitude harmonizer: as the camera climbs through the fade band the grade desaturates
   *  toward this value, so mixed Esri source zooms (washed low-zoom mosaic vs crisp agricultural
   *  texture) converge in tone instead of reading as patches. 1 − altFade drives it. */
  hiAltDesat: 0.88,
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
  /** Matches the fade band top — the imagery is never visible above it, so the coarse end of the
   *  error ramp should land there (finer tiles inside the band = more consistent Esri zooms). */
  errorFarAlt: 750_000,
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
  /** Image-plane opacity DEFAULT (~30% transparent — owner 2026-07-10: superimpose the photo on
   *  the real landscape while tuning). Live-adjustable per photo via the PLANE ALPHA slider
   *  (PhotoDetailPanel → store/upload.planeOpacity); this is the value it resets to. */
  planeOpacity: 0.7,
} as const;

/** Cinematic flight to a placed photo / searched place (design board motion spec: desktop
 *  2200 ms, cubic-bezier(.65, 0, .35, 1); reduced-motion = instant cut). Phase 5.5 S2: terrain
 *  path floor + path-following orientation + the shared explicit arrival pose (the old
 *  planeDist·backFactor/liftFactor multiples are gone — `flight.arrivalPose` is the one source). */
export const FLIGHT = {
  durationMs: 2200,
  /** Bezier control points (x1, y1, x2, y2) — the design system's master easing. */
  easing: [0.65, 0, 0.35, 1] as const,
  /** Mid-flight altitude bump = min(arc·groundDistance, max) — short hops rise a little, long
   *  hauls get a proper ballistic arc (matters for Phase-5 pin→pin jumps). */
  arcBumpFactor: 0.35,
  arcBumpMaxM: 2_500_000,
  /** Path floor clearance (m) over the rendered terrain sampled at the flight's endpoints —
   *  the mid-path may never dip closer to that terrain (the blend itself is ellipsoid-only). */
  floorClearM: 250,
  /** Fraction of the path over which the floor ramps in/out so the endpoint poses stay exact. */
  floorRampFrac: 0.2,
  /** Orientation blends OUT of the start pose across this leading fraction (0.15 → 0.3
   *  browser-tuned 2026-07-11: the tighter window swung the view at ~330°/s aligning to the
   *  track from a rotated LEO pose; 0.3 spreads the alignment over the slow bezier head). */
  orientInFrac: 0.3,
  /** …and INTO the final pose across this trailing fraction (design: "last ~25%"). */
  orientOutFrac: 0.25,
  /** Look-ahead (eased-progress units) for the path-tangent frame. */
  lookAheadE: 0.03,
  /** Path-following orientation ramps in across this ground-distance band (m): short hops keep
   *  the plain q0→q1 slerp (their orientation change IS the point), long hauls follow the path. */
  pathFollowLoM: 100_000,
  pathFollowHiM: 600_000,
  /** Default pin/photo arrival: camera this high above the rendered ground… */
  arrivalAltAboveGroundM: 200,
  /** …at this tilt (deg from nadir; ~80° = near-horizontal, the photo superimposed on its
   *  landscape) looking at the image-plane centre. */
  arrivalTiltDeg: 80,
} as const;

/** Public pins on the shared globe (Phase 5). Markers are accent-colored instanced spheres
 *  scaled with camera distance (≈ constant screen size); the viewport query tier maps camera
 *  altitude → geohash precision (Wix Data has NO geo query — D7 hasSome over cell prefixes).
 *  Colors come from lib/theme/tokens (accent/accent600) — never from here. */
export const PINS = {
  /** Marker centre height above the local ground (m) — clears rooftops without floating. */
  liftM: 40,
  /** Fallback ground height (m, above ellipsoid) before terrain tiles answer heightAt. */
  fallbackGroundM: 120,
  /** Marker world radius = camera distance × this (angular-constant size)… */
  angularSize: 0.008,
  /** …clamped so pins neither vanish at street level nor balloon in orbit. */
  minSizeM: 6,
  maxSizeM: 45_000,
  /** Marker fill opacity (accent reads as a signal; bloom picks up the rest). */
  opacity: 0.92,
  /** Instanced-mesh capacity — also the query page cap. */
  maxRender: 1000,
  /** Above this altitude the query drops geo filtering and fetches the newest pins globally
   *  (a LEO view sees a whole hemisphere — cell cover would need thousands of hasSome values). */
  queryGlobalAltM: 120_000,
  /** Below this altitude the cell query upgrades gh4 → gh6 (street-level precision). */
  queryFineAltM: 3_000,
  /** Viewport half-span (deg) ≈ altitude(km) × this — the geohash cover window. */
  spanDegPerKm: 0.011,
  spanMinDeg: 0.03,
  spanMaxDeg: 50,
  /** Re-query when the focus moved >25% of the span, alt changed >30%, or the tier flipped. */
  requeryMoveFrac: 0.25,
  requeryAltFrac: 0.3,
  /** Debounce between viewport reports and the actual Wix Data query (ms). */
  queryDebounceMs: 450,
  /** Pin resnap cadence (frames) — re-ask the terrain for ground height under nearby pins. */
  resnapEveryFrames: 120,
  /** Post-save pulse-highlight (Phase 5.5 S3): the freshly saved pin breathes for this long
   *  so the fly-out has a landing beacon. Scale swings ±pulseAmp around the normal size. */
  highlightMs: 8_000,
  highlightPulseAmp: 0.45,
  highlightPeriodMs: 1_100,
  /** Post-save fly-out altitude (m above ground) — far enough that the pin reads in context. */
  savedFlyOutAltM: 3_800,
} as const;

/** Click-to-place live marker (Phase 5.5 S3): while the store is `placing`, an accent dot
 *  hugs the rendered ground under the pointer so the drop point is visible before the click
 *  (the crosshair cursor alone hid exactly the pixel that mattered). */
export const PLACING = {
  /** Marker world radius = camera distance × this… */
  markerAngular: 0.005,
  /** …clamped (m). */
  markerMinM: 1.2,
  markerMaxM: 15_000,
  /** Dimmer than a real pin — it is a preview, not a commitment. */
  markerOpacity: 0.55,
  /** Ground re-pick cadence (frames) while the pointer rests — picking raycasts the tile set. */
  repickEveryFrames: 2,
} as const;

/** FPV photographer mode (Phase 5.5 S2): the camera sits EXACTLY at the placed photo's frustum
 *  apex with the photo's heading/pitch/roll; GlobeControls are disabled — drag looks around,
 *  wheel zooms the camera FOV (not a dolly), Escape / the panel button exits. Gates S6 (sun/moon
 *  day-arcs are drawn for this viewpoint). */
export const FPV = {
  /** Look-around sensitivity (deg per px) at the DEFAULT scene FOV — scaled down as the FOV
   *  narrows so a zoomed-in look stays controllable. */
  lookDegPerPx: 0.12,
  /** Camera-FOV zoom range (deg, vertical). Entry FOV = the photo's own vertical FOV. */
  minFovDeg: 8,
  maxFovDeg: 80,
  /** Wheel deltaY → FOV multiplier exponent: fov ×= exp(deltaY · this). */
  wheelFovFactor: 0.0012,
  /** FOV ease time-constant (ms) — entry/exit FOV changes glide instead of snapping. */
  fovEaseTauMs: 180,
  /** Pitch offset clamp (deg) around the photo's own pitch — never flip over the poles. */
  pitchClampDeg: 80,
  /** Building ghosting while in ANY FPV: buildings inside the view would otherwise swallow the
   *  camera — fade the shared fill/edge materials so the view is never lost inside a mesh. */
  buildingGhostOpacity: 0.2,
  buildingGhostEdgeOpacity: 0.12,
  /** Camera FOV (deg) for the temporary-pin "look around" FPV (no photo to inherit from;
   *  wider than the cinematic POSE 38° — it's a street-level look, not a framing). */
  tempFovDeg: 55,
  /** Temp-FPV eye elevation ceiling (m above the pin's ground): the ZOOM encoder raises/lowers
   *  the viewpoint STRICTLY vertically in this mode; floor = FRUSTUM.eyeHeightM. */
  tempEyeMaxM: 400,
} as const;

/** Temporary virtual pin (Phase 5.5 S2 follow-up): double-click the ground drops it, it becomes
 *  the rotate/zoom pivot, and FPV can be entered on it just to look around. Cleared by a single
 *  click elsewhere / Escape. Accent marker, angular-constant size like the public pins. */
export const TEMPPIN = {
  /** Marker world radius = camera distance × this… */
  markerAngular: 0.006,
  /** …clamped (m). */
  markerMinM: 1.5,
  markerMaxM: 20_000,
  markerOpacity: 0.9,
} as const;

/** Location finder (Phase 5.5 S1) — free geocoding behind a swap-friendly adapter
 *  (lib/geo/geocode). Providers: Photon (komoot) for search-as-you-type (keyless, CORS *,
 *  fair-use — MUST debounce and pass a camera-position bias or POI ranking is garbage) and
 *  Nominatim on explicit Enter only (its usage policy FORBIDS autocomplete; ≤1 req/s; results
 *  cached). Both are ODbL — the results dropdown carries "© OpenStreetMap contributors". */
export const SEARCH = {
  photonUrl: "https://photon.komoot.io/api/",
  nominatimUrl: "https://nominatim.openstreetmap.org/search",
  /** Keystroke → Photon request debounce (ms). Fair-use floor ~300 ms; still feels live. */
  debounceMs: 320,
  /** Results requested and rendered. */
  limit: 6,
  /** Autocomplete only fires at this query length (shorter = noise + wasted requests). */
  minQueryLen: 3,
  /** Fly-to arrival tilt (deg from nadir) — oblique enough that the landscape reads. */
  arrivalTiltDeg: 52,
  /** Arrival altitude = result extent span (m) × this… */
  extentAltFactor: 1.1,
  /** …clamped. Floor keeps arrivals terrain-safe: the flight path is TERRAIN-BLIND until the
   *  S2 flight fix (ellipsoid-only altitude blend), so never arrive hugging the ground. Cap
   *  keeps whole-country hits below orbit. */
  altMinM: 3_000,
  altMaxM: 1_200_000,
  /** Arrival altitude when the result has no extent (addresses, small POIs). */
  altDefaultM: 4_000,
} as const;
