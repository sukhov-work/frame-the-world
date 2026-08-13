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

// ── Sections (in file order) ─────────────────────────────────────────────────────────────────
//   SUN · SKY · GOLDEN · SCRUB · BLOOM · SHADOWS · RENDERER · POSE · GATES · DRIFT · CONTROLS ·
//   TILESETS · EARTH · GRATICULE · ATMOSPHERE · STARS · MILKYWAY · BUILDINGS · ENRICHED · GROUND · DRAPE ·
//   LABELS · STREETS · VECTOR · MINIMAP · FRUSTUM · FLIGHT · PINS · EXPLORE · PLACING · FPV · DAYARC ·
//   ASTERISMS · TEMPPIN · SEARCH · PLAN · ORCH
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Re-exported so globe code has ONE source for the ellipsoid (kept in lib/geo — pure, unit-tested,
// and guaranteed to match three's WGS84_ELLIPSOID, which the OSM building tiles extrude from).
export { WGS84_A, WGS84_B } from "../../lib/geo/projection";
// Type-only (erased at build) — keeps the "no runtime deps / no colour" rule while typing ENRICHED.bbox.
import type { GeoBbox } from "../../lib/globe/enrichedMask";

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
   *  (0.4 → 0.25 when moonlight landed, but moon terms are phase-gated by moonKs (~0.05 near new
   *  moon) → dark-of-moon nights lost the fill; 0.25 → 0.32 2026-07-13 to restore it). */
  hemiIntensity: 0.32,
  /** Distance (m) the directional key light sits from the origin in DIRECTION-ONLY mode (sun up
   *  but no city-scale shadows) — far enough to read as parallel sun rays. */
  keyLightFarM: 1e7,
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
  /** Moon albedo multiplier (>1 pushes the lit limb into bloom; raised 2026-07-10 "moon
   *  brighter", again for the S5 night pass, again S6 (owner: "brighter, organically") — the
   *  gain rides the existing albedo·(N·sun)^0.8 curve so maria contrast and the phase shape
   *  survive; the lit limb pushes further over BLOOM.threshold, so the extra brightness reads
   *  as glow, not clipping. Horizon-fade keeps the disc melting cleanly. */
  moonBrightness: 3.2,
  /** Earthshine floor on the moon's dark side (0 = pitch black new moon; nudged 0.1 → 0.12
   *  S6 with the brightness raise — a faintly fuller dark limb reads "brighter" organically). */
  moonEarthshine: 0.12,
  /** Horizon occlusion — ANGULAR fade against the TRUE ellipsoid horizon (owner 2026-07-15;
   *  supersedes the closest-approach `horizonFadeBandM` 40 km metric band). The old band
   *  collapsed at street level: the test sphere used the EQUATORIAL radius (the real surface at
   *  48°N sits ~11.9 km below it) and every ray at/below geocentric-horizontal pinned to fade 0
   *  while the `tc<=0` guard pinned everything above to 1 — a razor cut at 0° elevation, well
   *  above the true horizon (dip −0.31° at ~95 m eye). Now the CPU computes the horizon
   *  elevation sine (with dip, float64, ellipsoid-scaled space) per frame and fragments fade
   *  across an angular band above it. Street width ≈ a soft sunset slice (~15% of the solar
   *  disc); orbit width reproduces the old ~0.6° melt into the limb haze at LEO. */
  horizonFadeStreetDeg: 0.08,
  horizonFadeOrbitDeg: 0.6,
  /** Band-width blend altitudes (m): ≤ Lo → street width, ≥ Hi → orbit width (smoothstep). */
  horizonFadeAltLoM: 50_000,
  horizonFadeAltHiM: 600_000,
  /** FULL-MOON DirectionalLight intensity of moonlight on buildings. S5: scaled by the
   *  K&S-1991 phase curve (`lib/ephemeris/moonlight.ts` — quarter ≈ 9% of full, NOT the
   *  linear illuminated fraction), so this number is the full-moon calibration anchor. */
  moonKeyIntensity: 0.3,
  /** FULL-MOON moonlight term inside the earth/ground shaders (same K&S phase scaling).
   *  (0.35 → 0.5 2026-07-13 illumination pass — richer stylized full-moon night; albedo-scaled so
   *  black stays black; watch vs BLOOM.threshold.) */
  moonSceneGlow: 0.5,
} as const;

/** Generic sky-target tracer (ASTRO ENGINE phase C split, 2026-08-03 — was baked into COMET):
 *  the marker / night-gate / impostor / trail params EVERY tracked target uses, whatever its
 *  kind. `scene/skyTarget.ts` + `scene/skyTrail.ts` read this; the comet-specific coma/tail
 *  look stays in COMET below.
 *
 *  HONESTY NOTE: most tracked bodies would be a sub-pixel nothing at true angular size. The
 *  marker is an INSTRUMENT OVERLAY (the day-arc / asterism grammar), not a photometric body,
 *  drawn at stylized angular size along the astronomically exact direction. Everything else —
 *  where it is, when it rises, how bright it really is — stays true. */
export const SKY_TARGET = {
  /** Point-body core angular radius (deg) — the stylized overlay size for planets / stars /
   *  asteroids (the coma's little sibling). */
  pointCoreDeg: 0.12,
  /** Highlight reticle (house marker spec). Owner 2026-08-03: "crude and obscures the view —
   *  much thinner, subtler." A finder mark's job is to say WHERE, not to draw attention to
   *  itself: the ring is a hairline (0.035 → 0.012 of its radius ≈ 1 px at a 38° FOV on a
   *  1600 px canvas), opened OUT to 1.5° so it frames the body instead of crowding it, dimmed
   *  to 0.45, and BROKEN into four arcs with the gaps on the axes — an open bracket reads as a
   *  marker while leaving the sky visible through it. `reticleGapFrac` = fraction of each
   *  quadrant the gap eats. */
  reticleRadDeg: 1.5,
  reticleWidthFrac: 0.012,
  reticleIntensity: 0.45,
  reticleGapFrac: 0.34,
  /** Tick length as a fraction of the ring radius (short outward strokes at the gaps). */
  reticleTickFrac: 0.18,
  /** Impostor distance = camera.far × this (the sun/moon rule — clamped into [near·1.2, far·0.95]).
   *  NOTE (browser pass 2026-08-02): a low tracer that "won't render" at street level is almost
   *  always the REAL SKYLINE occluding it — buildings and trees write depth in the opaque pass and
   *  the impostor is depth-tested against them, which is the honest planner behaviour, not a bug.
   *  Proven with a solid-red debug fragment shader: the quad was there, sliced by a rooftop. The
   *  camera-anchored sky dome is ADDITIVE (it can never paint over the tracer), so do NOT reach
   *  for renderOrder when this happens — raise the eye or wait for the body to climb. */
  impostorFarFrac: 0.5,
  /** Night gate over sin(sun elevation) at the camera — the star-field's grammar, one band wider
   *  (a faint body at civil twilight is already lost, so the tracer fades before the stars do). */
  nightVisStartSin: 0.02,
  nightVisFullSin: -0.12,
  /** Daylight/twilight floor for the HIGHLIGHT reticle only — the body render honours the night
   *  gate with no floor, so the tracer stays findable when the sky is lit but the body is not.
   *  UNVERIFIED in a shot and not shot-tunable at the 10P site: its 2026 apparition sits near
   *  opposition (elongation ~164°), so from Dnipro it is never both above the local skyline AND
   *  in a lit sky. Reasoned value: an ADDITIVE teal ring at ~1/3 presence reads over twilight
   *  and honestly loses to a full daylight sky (where the panel's ALT/AZ readout is the tool). */
  highlightDayFloor: 0.35,
  /** TRAIL rebuild deadband on the anchor (deg) — a celestial az/alt path shifts ~1:1 with
   *  observer latitude, so 0.05° ≈ 0.05° of arc error: invisible against a 1.5° ring, and it
   *  keeps an orbit pan from rebuilding the ~170-sample arc every frame. */
  trailRebuildMinDeg: 0.05,
  /** Marker click slack — the hit test accepts clicks inside ring radius × this (a hairline
   *  ring is a thin literal target; the disc it frames is the intended one). */
  clickSlack: 1.25,
  /** Planet-disc treatment (phase D): floor on the rendered disc's angular RADIUS (deg). True
   *  angular size wins when larger (a long-focal FPV zoom grows Venus honestly); below it the
   *  disc is floored to stay readable — the PHASE (terminator shape/orientation vs the real
   *  sun) is exact either way, the SIZE is overlay grammar like the point treatment. 0.4° ≈ a
   *  moon-scale disc; Saturn's ring (2.27 disc radii) then spans 0.9°, inside the 1.5° ring. */
  planetDiscMinDeg: 0.4,
  /** Saturn ring-band additive gain relative to the disc (taste — the disc's phase is the
   *  treatment's star; the band should read as jewellery, not a searchlight). */
  ringGain: 0.55,
} as const;

/** Comet-LOOK params (temporal addition 2026-08-02, `lib/ephemeris/comet.ts`) — ONLY the coma +
 *  anti-sunward tail treatment. Everything generic (marker, night gate, impostor distance)
 *  lives in SKY_TARGET above (phase C split). */
export const COMET = {
  /** Coma disc angular radius (deg). Browser pass 2026-08-02: 0.32° at comaIntensity 1.5 sat
   *  over BLOOM.threshold (0.9) and UnrealBloom smeared it into a ~2° green ball that swallowed
   *  the tail — a fake "great comet" for a mag-12.8 object. Half the disc, gain just under the
   *  bloom threshold: a crisp head with a soft rim, and the tail reads. */
  comaAngRadDeg: 0.16,
  /** Coma sprite half-extent in coma radii (room for the shader falloff + a little bloom). */
  comaGlowExtent: 4,
  /** Additive gain on the coma core (kept ≲ BLOOM.threshold — the halo carries the glow). */
  comaIntensity: 0.85,
  /** Anti-sunward tail: length and base half-width (deg of sky). */
  tailLenDeg: 3.4,
  tailWidthDeg: 0.5,
  /** Tail gain; the shader tapers it to nothing over its length. */
  tailIntensity: 0.75,
} as const;

/** Golden-hour grade (Phase 4, ADR D6/D14). The signal is the SINE of the sun's elevation —
 *  per-fragment `dot(surfaceNormal, sunDir)` in the earth/ground/atmosphere shaders (so the warm
 *  band hugs the terminator and appears at the correct LOCAL times everywhere at once), and
 *  `dot(sunDir, focusUp)` on the CPU for the building key light. The band is a bell built from two
 *  smoothsteps over that sine; colour is tokens.goldenHour only (D14). Curve shape is shader-baked
 *  (glf) — retune needs a reload; strengths are baked too (they're look, not animation). */
export const GOLDEN = {
  // 2026-07-13 illumination pass: band WIDENED (~5° longer past both sunrise AND sunset — the bell is
  // a pure function of sin(sun elevation), so it stays perfectly symmetric) + all strengths raised so
  // golden reads as a slow warm dusk SWEEP + apparent GI, not a thin terminator hue-shift.
  /** Bell fade-in over sin(sun elevation): starts deeper in twilight now… (sin −12°) */
  fadeInLo: -0.21,
  /** …fully warm with the sun on the horizon. (sin −1°) */
  fadeInHi: -0.0175,
  /** Still fully warm at +10° elevation… (sin +10°) */
  fadeOutLo: 0.17,
  /** …gone by +21° — a longer, lingering golden span. (sin +21°) */
  fadeOutHi: 0.36,
  /** Multiplier on tokens.goldenHour in the multiplicative cast (>1 compensates the luminance the
   *  warm multiply removes from G/B — this is what turns golden from a colour FILTER into apparent
   *  glow/GI). (1.15 → 1.3 2026-07-13.) */
  castGain: 1.3,
  /** Cast strength on the stylized base earth (orbit view). (0.7 → 0.9.) */
  earthStrength: 0.9,
  /** Cast strength on the graded imagery ground (city/mid view — where golden hour is felt). (0.8 → 1.0.) */
  groundStrength: 1.0,
  /** Warm mix on the atmosphere limb line where the sun grazes it. (0.6 → 0.8.) */
  atmStrength: 0.8,
  /** Building key light: lerp(white → goldenHour) by bell(focus sun elevation) × this. (0.85 → 1.0.) */
  keyStrength: 1.0,
  /** Building key light: at golden hour, ALSO brighten the key intensity by bell × this (a warm
   *  rim-lit swell, not just a hue shift — the biggest visible building-dusk win). 0 = pure hue shift. */
  keyBrighten: 0.35,
  /** Moon "golden hour": when the moon is the night key (moon-shadow mode) and grazes the horizon,
   *  lerp its cool key colour toward goldenHour by bell(moon elevation) × this — a warm swell at
   *  moonrise/moonset mirroring the sun's dusk. 0 = no moon warming. */
  moonKeyStrength: 0.4,
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
  /** Fast-forward presets (scene-seconds per real second) for the PLAY control (owner
   *  2026-07-14) — 1 min/s · 10 min/s · 1 h/s. Real speed (×1) is always offered first. */
  playRates: [60, 600, 3600],
  /** UI tick (ms) while playback runs — drives the knob/labels only; the SCENE advances
   *  continuously via sceneTimeMs() (store/time playback derivation), never in steps. */
  playTickMs: 150,
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

/** Ambient occlusion (RENDERING_QUALITY_PASS R1 — the highest-ROI aesthetic move: turns the flat
 *  gray building slabs into massing with depth). `GTAOPass` is built into three 0.185
 *  (three/addons/postprocessing/GTAOPass.js — NO new dep), inserted after RenderPass, before bloom.
 *  DEFAULT OFF (`enabled: false`): the look (radius / intensity / tint at city scale) genuinely
 *  needs a rendered frame to tune, and it alters the browser-VERIFIED M3/high hero view — so it
 *  ships fully WIRED but dark. To enable + tune: set `enabled: true`, reload, then A/B via
 *  `window.__quality.ao` (the live GTAOPass — `.blendIntensity`, `.updateGtaoMaterial({radius,…})`).
 *  When on it is STILL tier-gated (high only — an extra full-scene GBuffer render) AND altitude-
 *  gated (city/street only — the self-lit earth at orbit has no use for screen-space AO). */
export const AO = {
  /** Master switch. false = the GTAOPass is never constructed (zero VRAM/cost on every machine);
   *  true = created at init, then gated by tier + altitude each frame. */
  enabled: false,
  /** Active only below this camera altitude (m) — buildings read as massing at city/street scale. */
  maxAltM: 12_000,
  /** Occlusion radius (WORLD/view metres — `screenSpaceRadius` stays false so AO is a fixed
   *  physical size, not a zoom-varying pixel count). ~building-contact scale; TUNE in-browser. */
  radiusM: 10,
  /** AO contrast power (`ao = pow(ao, scale)` in the shader) — >1 deepens the creases. */
  scale: 1.0,
  /** Composite strength (`blendIntensity`) — how strongly AO multiplies into the scene. Kept
   *  conservative so the first enabled frame is subtle, not a smear. */
  intensity: 0.6,
  /** GBuffer sample count (shader define SAMPLES) — 16 is the three default; lower is cheaper. */
  samples: 16,
  /** Crude skylight tint: occluded pixels lerp toward tokens.skyHorizon (a monkey-patch of the
   *  GTAOBlendShader — three ships no AO-colour setter; the composite multiply can only DARKEN
   *  toward it). 0 = neutral gray AO. Kept low — a hint of cool sky in the creases. */
  horizonTint: 0.35,
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
  /** Orthographic half-extent (m) around the view focus — the MINIMUM (street level, crisp). The rig
   *  is ALTITUDE-ADAPTIVE (StylizedTiles.stepKeyLightAndShadow): the shadow map widens with camera
   *  altitude so an oblique city view's whole visible ground gets shadows, not just a central 1.6 km
   *  patch (2026-07-13: "not a single cast shadow" from a mid-city zoom was this — buildings sat
   *  OUTSIDE the fixed patch). Trades texels/metre when wide (a cinematic call). */
  boundsM: 1_600,
  /** Shadow ortho half-extent grows this many metres per metre of camera altitude, clamped
   *  [boundsM, maxBoundsM]. ~0.6 → at 4 km alt ≈ 2.4 km half-extent (covers a city view); street
   *  level clamps to the crisp boundsM. Browser-tune against the visible extent. */
  boundsAltK: 0.6,
  /** Cap on the adaptive half-extent (m) — beyond this the shadow map is too coarse to read. */
  maxBoundsM: 5_000,
  /** Light sits this far (m) from the focus toward the sun. */
  lightDistM: 8_000,
  /** Shadow camera near/far margin (m) around the focus distance. */
  depthMarginM: 3_500,
  /** Depth bias (negative pulls surfaces toward the light — kill acne, keep contact). */
  bias: -2e-4,
  /** World-space normal offset (m) — the large-coordinate acne killer. (1.0 → 0.75 2026-07-13: a big
   *  offset PETER-PANS building shadows off their bases → they read "floating"; 0.75 m still covers the
   *  ~0.5 m float32@6.4e6 acne while anchoring the shadow to the wall base. Browser-revert to 1.0 if
   *  acne returns — it's the one shadow value with an acne/contact tradeoff.) */
  normalBias: 0.75,
  /** PCF blur radius (texels) — soft penumbra edge (3 → 2 verified 2026-07-10: crisp contact, natural
   *  soft edge; NOT stair-stepped). */
  radius: 2,
  /** Sun must be at least this high over the focus (dot with up ≈ sin(elev)) to cast — MUST stay > 0
   *  (a below-horizon sun projects garbage). 0.03 (~1.7°) → 0.008 (~0.46°) 2026-07-13: shadows now
   *  persist through the GOLDEN/dusk hour (long raking shadows are the whole point at that time),
   *  down to nearly the horizon, instead of cutting off ~1.7° up. */
  minSunElevSin: 0.008,
  /** Ground shadow overlay darkness (ShadowMaterial opacity — invisible where unshadowed).
   *  The graded ground is dark: below ~0.5 the darkening is imperceptible (verified with a
   *  red-mask debug pass 2026-07-10 — the mask itself was always correct; re-verified for the
   *  "crisper" pass: 4096² edges are clean, presence was the limiter → 0.55 → 0.75 + a cool
   *  tokens.water tint instead of pure black). */
  groundOpacity: 0.75,
  // --- Moon shadows (Phase 5.5 S5, §Item 7): ONE rig, source switch — when the sun is below
  //     minSunElevSin and a bright-enough moon is up, the same shadow light is driven from the
  //     moon direction (impersonating the moon key: tokens.moonlight colour, K&S intensity). ---
  /** Moon shadows engage at/above this illuminated fraction (0.85 → 0.6 2026-07-13: moon shadows now
   *  appear across far more of the lunar month; the ×moonKs in the rig fades them in smoothly). */
  moonMinIllum: 0.6,
  /** Ground shadow opacity under a FULL moon (× the K&S phase intensity per frame) — kept BELOW the
   *  sun's 0.80 so moonlit shadows read as presence, not contrast. (0.55 → 0.62 2026-07-13.) */
  moonGroundOpacity: 0.62,
} as const;

/** Renderer-level knobs (GlobeCanvas). */
export const RENDERER = {
  /** DPR cap — 2 keeps 4K/mobile fill-rate sane; raise only after a mobile memory pass.
   *  NOTE: this is now the `high`-tier value; the live cap is QUALITY.tiers[tier].dprCap. */
  maxPixelRatio: 2,
  /** NeutralToneMapping exposure (ACES/AgX rejected — they desaturate the cyan accent). */
  toneMappingExposure: 1.0,
} as const;

/** Adaptive rendering quality (rendering/RENDERING_QUALITY_PASS.md WS1 — the keystone). A device tier is
 *  picked at startup (`lib/globe/quality.detectDeviceTier`) and a runtime governor
 *  (`makeGovernor`) steps it up/down from smoothed frame time; GlobeCanvas applies the renderer
 *  levers (DPR / bloom / shadows) each change.
 *
 *  HARD INVARIANT: `tiers.high` MUST equal the pre-pass constants — `RENDERER.maxPixelRatio` (2),
 *  `SHADOWS.mapSize` (4096), `GROUND.errorTargetNear` (2), the library's 0.4 GB LRU default,
 *  `VECTOR.latticeBudgetPerFrame` (8), `STREETS.maxVisible` (40), and the buildings' library-default
 *  16 SSE — so a capable machine renders byte-identical to before and only weaker hardware degrades.
 *  `test/lib/globe/quality.test.ts` locks this against the live constants. */
export const QUALITY = {
  /** Frame governor: asymmetric (quick to shed, slow to re-add), hysteresis + cooldown = no thrash.
   *  On strong hardware the EMA never crosses budgetMs, so the governor is a no-op and the tier
   *  stays at the device class. Budgets in ms of frame time (22 ≈ 45 fps, 13 ≈ 77 fps). */
  governor: {
    budgetMs: 35,
    restoreMs: 13,
    emaAlpha: 0.1, // ~10-frame smoothing
    downFrames: 100, // ~0.75 s of sustained slowness before dropping a tier
    upFrames: 240, // ~4 s of headroom before restoring (deliberately reluctant)
    cooldownMs: 2500, // min gap between changes — a DPR change reallocates render targets
  },
  tiers: {
    high: {
      dprCap: 2,
      bloom: true,
      shadowsEnabled: true,
      shadowMapSize: 4096,
      lruBytesMB: 400,
      groundErrorNear: 2,
      buildingErrorTarget: 16,
      vectorLatticeBudget: 8,
      maxStreetNames: 40,
    },
    mid: {
      dprCap: 1.5,
      bloom: true,
      shadowsEnabled: true,
      shadowMapSize: 2048,
      lruBytesMB: 256,
      groundErrorNear: 3,
      buildingErrorTarget: 24,
      vectorLatticeBudget: 5,
      maxStreetNames: 28,
    },
    low: {
      dprCap: 1.25,
      bloom: false,
      shadowsEnabled: false,
      shadowMapSize: 1024,
      lruBytesMB: 160,
      groundErrorNear: 5,
      buildingErrorTarget: 40,
      vectorLatticeBudget: 3,
      maxStreetNames: 16,
    },
  },
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
  /** Deg/SECOND about ECEF +Z (RENDERING_QUALITY_PASS F5 — was degPerFrame 0.0011, frame-rate
   *  DEPENDENT: at 120 Hz the globe drifted 2× as fast, at 30 Hz half. 0.066°/s == 0.0011°/frame
   *  @60fps — byte-identical feel on the 60 Hz baseline, correct pace on any refresh rate. Real
   *  ISS angular pace (verified feel). Applied via lib/globe/drift.driftRadiansForDt(dtMs). */
  degPerSec: 0.066,
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
  /** …photo PITCH encoder (PhotoDetailPanel, owner 2026-07-11): half the heading rate — the
   *  range is ±90° vs 0–360°, so the full-stick sweep time stays comparable. */
  pitchRateMaxDegPerS: 25,
  /** …zoom as a log-space rate (per s): altitude ×= exp(−rate·dt); 1.1 ≈ 3×/s at full stick. */
  zoomRateMaxPerS: 1.1,
  /** Expo response curve on stick deflection (rate = max·sign·|d|^gamma) — fine control near
   *  centre, speed at the ends. */
  rateExpoGamma: 2.2,
  /** Applied-rate low-pass (ms): eases rate changes in AND lets motion coast out on release. */
  rateEaseTauMs: 140,
  // --- Glide arrival epsilons + rate deadbands (B13 — were inline in the orchestrator loop) ---
  /** Tilt glide has arrived when |pitch − target| drops under this (rad). */
  tiltArriveRad: 8e-4,
  /** Heading glide has arrived when the signed arc to target drops under this (deg). */
  headingArriveDeg: 0.08,
  /** Zoom glide has arrived when |log(target/alt)| drops under this. */
  zoomArriveLog: 0.005,
  /** Altitude change (m) below which a zoom glide counts as "stalled" (resting on terrain). */
  zoomStallAltEpsM: 0.05,
  /** Applied heading rate below this (deg/s) reads as centred — no rotation this frame. */
  headingRateDeadbandDegPerS: 0.01,
  /** Applied zoom / FOV log-rate below this reads as centred — no motion this frame. */
  rateDeadbandLog: 1e-3,
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
  /** CARTO dark_nolabels raster (Phase 5.5 S7a, owner-approved 2026-07-11) — the dark uniform
   *  drape below DRAPE.fadeTopAltM. Keyless + CORS * (live-verified); standard {z}/{x}/{y}.
   *  (The dark_only_labels street-name raster was TRIED and dropped same day — draped raster
   *  text is blurry and cannot scale with zoom; street names are now vector, see STREETS.) */
  cartoDarkUrl: "https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png",
  /** CARTO rasters serve real content through z20 (probe-verified NYC + Dnipro 2026-07-11). */
  cartoMaxLevel: 20,
  /** Re:Earth Buildings — hosted Overture (OSM + Microsoft ML + Google) 3D Tiles 1.1, ODbL
   *  (S7d trial; needs meshopt — see scene/buildings.ts). Coverage where OSM is sparse (UA). */
  overtureTilesetUrl: "https://buildings.reearth.land/tileset.json",
  /** Feature flag (S7d): swap the buildings source Cesium OSM → Re:Earth Overture. Default OFF.
   *  TRIALED 2026-07-11: tileset.json + wiring OK (meshopt registered), but every glb content
   *  tile (/v5-add/{z}/{x}/{y}.glb) returned HTTP 500 over Dnipro — the no-SLA risk realized.
   *  Keep OFF until the service recovers; fallback = Cesium OSM; last resort = self-host an
   *  Overture Ukraine extract (PHASE_5_5_UX_BATCH §Item 2c). */
  overtureBuildings: false,
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
    /** NASA Blue Marble JULY topo+bathy 5400² (sRGB; record 73751 — December has a snow blanket).
     *  BOOT texture — the 8k below swaps in async. */
    color: "/textures/earth-color.jpg",
    /** 8192×4096 downscale of the SAME BMNG July at 21600×10800 (owner 2026-07-11: continental
     *  imagery read blocky next to the crisp 8k night lights). Async upgrade, boot stays. */
    color8k: "/textures/earth-color-8k.jpg",
    /** 8k land/water mask DERIVED from color8k itself (headless-canvas classifier: BMNG bathy
     *  blue-dominance + near-black-lake rule + ice/gray guards) — registration-PERFECT with the
     *  rendered coastlines, unlike any external mask. land=white/ocean=black like the boot mask;
     *  single-channel → R8 DataTexture at runtime. The old 2048² mask (~20 km/texel) was the
     *  blocky-coast artifact at mid zoom. */
    landMask8k: "/textures/earth-landmask-8k.png",
    /** NASA VIIRS city lights 3600² (sRGB; record 79765) — the BOOT texture only: it paints
     *  the first frames while the 8k Black Marble below fetches (same idiom as the BSC5 star
     *  catalog's procedural fallback), and stays if the fetch/GPU-size check fails. */
    night: "/textures/earth-night.jpg",
    /** NASA Black Marble 2016 grayscale 8192×4096 (S5 §Item 8; downscaled from the 13500×6750
     *  BlackMarble_2016_3km_gray source, eoimages.gsfc.nasa.gov record 144897). Decoded
     *  client-side into a SINGLE-CHANNEL RedFormat DataTexture (~34 MB GPU vs ~134 RGBA);
     *  gamma-encoded gray → shader linearizes via uNightGamma. Skipped when the GPU's
     *  MAX_TEXTURE_SIZE is under 8192 (the mobile floor per the design research). */
    night8k: "/textures/earth-night-8k.jpg",
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
   *  (0.32 → 0.22 2026-07-10; → 0.19 S5; → 0.23 2026-07-13 — lift dark-of-moon orbit nights without
   *  washing the terminator/VIIRS). */
  nightFloor: 0.23,
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
  /** Linearization exponent for the RAW 8k Black Marble gray (uNightGamma after the swap —
   *  no single-channel sRGB texture format exists, so the shader does the decode; the boot
   *  sRGB texture runs at 1.0 because the GPU already decoded it). */
  night8kGamma: 2.2,
  /** Day-side limb scattering: rim = (1-N·V)^pow · gain — melts the disc into the halo. */
  rimPow: 3.0,
  rimGain: 0.12,
  /** Day/orbit grade ramp (2026-07-17 orbital-grade pass, poster parity): from orbit the disc
   *  grades richer — more NASA colour + chroma, slightly deeper tone; at low altitude the
   *  imagery ground owns the frame and the base grade returns. uOrbitGrade = smoothstep(altLo,
   *  altHi, camera alt) mixes uOrganic/uSat/uGain toward the *Orbit twins (all six live on
   *  __globe.earthUniforms in DEV — retune freely). */
  orbitGrade: {
    altLo: 500_000,
    altHi: 2_000_000,
    organic: 0.72,
    sat: 0.62,
    gain: 0.5,
  },
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
  /** Opacity fade band (m) — RENDERING_QUALITY_PASS F7: the wire cage used to HARD-toggle
   *  `visible` at GATES.decorMinAlt (150 km) on the dive to the city (a visible pop). It now
   *  ramps opacity across [fadeBottomAltM, fadeTopAltM]: full above the top, gone at/below the
   *  bottom (which stays at decorMinAlt so nothing shows below it). */
  fadeTopAltM: 250_000,
  fadeBottomAltM: 150_000,
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
  /** uOrbit ramps 0→1 across [start, start+span] altitude: outer orbit thins the halo (owner
   *  2026-07-10: "distinct but elegant and subtle"). 2026-07-17 orbital-grade pass: the old
   *  2.5e6 start NEVER engaged at the default LEO (1.1e6) — the halo read thick vs the poster.
   *  Start now sits just above the low-altitude sky regime (domeMaxAlt) so the thinning is
   *  already ~20% in at LEO and fully thin by ~4,000 km. */
  orbitStartAlt: 400_000,
  orbitSpanAlt: 3_600_000,
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
  /** Night-side glow floor (sun-modulation lower bound) — the night LIMB keeps this fraction
   *  of the day glow ("just enough to navigate"). NOTE: before the S5 obliquity fix this floor
   *  also painted the whole up-looking sky navy at 20–350 km; it is now horizon-only. */
  sunFloor: 0.25,
  /** Chapman-style path-length obliquity (S5 §Item 15 — THE navy-night-sky root cause): the
   *  glow model weighted every ray by density at its closest approach ONLY. For up-looking
   *  rays that point is the CAMERA, so a zenith ray (≈H of air) rendered as bright as a
   *  grazing horizon ray (≈√(π·Re·H/2) ≈ 25–35× more air) — at 20–350 km altitude the entire
   *  night sky glowed a uniform navy at intensity·sunFloor. Each scale height now dims by
   *  sinLimit/max(sin elev, sinLimit), sinLimit = √(2H/(π·Re)) (zenith ≈ ×0.08 line / ×0.15
   *  haze; horizon and limb-passing rays unchanged). 1 = physical, 0 = legacy dome. */
  obliquityK: 1,
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
  /** Horizon haze brightness (multiplies the haze colour). S7 feedback: with the old 0.35 the
   *  horizon total ran ~1.2 — past BLOOM.threshold, so bloom spread the near-white band across
   *  the frame at strong tilt ("white mess"). The whole horizon budget now stays UNDER the bloom
   *  threshold — see the unit-tested horizon-budget guard (test/…/skyBudget.test.ts). */
  skyHorizonGain: 0.2,
  /** Zenith ramp's horizon anchor: 0 = pure skyDay (blue) at the horizon, 1 = pure skyHorizon
   *  (near-white). Sub-1 keeps the horizon tinted, not white — the S7 white-out fix. */
  skyHorizonWhiteness: 0.55,
  /** Haze colour pulls this far toward skyDay (bluer haze — aerial perspective, not fog). */
  skyHazeBlue: 0.35,
  /** Very-low-altitude haze dim: haze × mix(hazeLowAltK, 1, smoothstep(lo, hi, camAlt)) — at
   *  street/drone heights the air column is thin, and the owner wants the horizon READABLE. */
  hazeLowAltK: 0.45,
  hazeLowAltLo: 300,
  hazeLowAltHi: 6_000,
  /** Haze falloff over sin(view elevation) above the horizon — smaller hugs the horizon tighter. */
  skyHazeFalloff: 0.075,
  /** Haze falloff BELOW the horizon (aerial perspective over distant terrain, decaying fast so
   *  near-ground rays stay clean — near geometry depth-occludes the dome anyway). */
  skyHazeBelow: 0.08,
  /** C1 crest softening (elevation-sine units) where the two haze exponentials meet at the
   *  horizon (owner 2026-07-15): the raw kink + the zenith ramp's infinite slope at 0⁺ read as
   *  a hard full-width seam at 250–300 mm focal lengths. ~0.01 ≈ 0.6° of gentle rounding; the
   *  crest value stays exactly 1, so the skyBudget guard is unaffected. */
  skyHazeSoft: 0.01,
  /** Day factor ramp over sin(sun elevation): night → full day across this band. */
  skyDawnLo: -0.12,
  skyDawnHi: 0.12,
  /** How strongly the golden band warms the horizon haze at dawn/dusk. (0.55 → 0.72 2026-07-13:
   *  recovers the dusk-sky glow — it lost >half its budget when skyHorizonGain was cut 0.35→0.16 for
   *  the bloom white-out fix; NOT in the skyBudget guard, which checks the no-golden daytime horizon.) */
  skyGoldStrength: 0.72,
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
  /** Exponent softener on the flux law for SIZE (pure flux would make Sirius a golf ball).
   *  (0.35 → 0.42 + sizeMax 5 → 6.5, owner 2026-07-15 MW pass: steeper hierarchy so the
   *  first-magnitude stars PUNCH THROUGH the Milky Way haze; the mag-4+ tail barely moves.) */
  sizeGamma: 0.42,
  sizeMax: 6.5,
  /** Catalog magnitude → brightness attribute (multiplies alpha): 10^(−0.4·(V − magRef)·brightGamma).
   *  Floor raised 0.18 → 0.3 → 0.55 across browser passes (phase4-04/05): a ~1.5 px point below
   *  ~0.5 alpha weight simply vanishes at DPR 1 — the mag-4+ tail (most of BSC5) went invisible.
   *  Brightness hierarchy still reads through SIZE; the floor keeps the sky populated. */
  brightGamma: 0.6,
  /** (0.55 → 0.65 S5 night pass: richer faint-star field against the fixed near-black sky.) */
  brightMin: 0.65,
  /** Point size = rand²·sizeSpread + sizeBase (px, pre-DPR) — a few bright, many faint. */
  sizeBase: 0.8,
  sizeSpread: 2.0,
  /** Twinkle: brightness = base + amp·sin(speed·t + phase). Subtle — it's an instrument. */
  twinkleBase: 0.7,
  twinkleAmp: 0.3,
  twinkleSpeed: 1.5,
  /** B−V colour tint amount (phase D, 2026-08-10): 0 = every star wears the flat token colour
   *  (pre-phase-D look), 1 = full catalog colour (`bvToRgb` — Ballesteros temperature +
   *  blackbody sRGB). 0.6 keeps the stylized sky while Betelgeuse reads orange next to a blue
   *  Rigel — the classic Orion contrast is the acceptance test. */
  bvTintAmount: 0.6,
  /** Peak star alpha (0.8 → 0.9 S5 — brighter stars are half the point of the darker sky). */
  alpha: 0.9,
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
  /** Orbit-tier DAY fade (2026-07-17 orbital-grade pass): "space always has stars" put the full
   *  Milky Way over a daylit Earth — photographically wrong (an exposure that holds a sunlit
   *  planet kills the sky, poster parity). Over sin(sun elevation at the camera) the star field
   *  dims from full (at/below dayDimStartSin — terminator under the camera) to its floor by
   *  dayDimFullSin. Bright stars keep a floor (space stays alive); the Milky Way haze goes
   *  entirely. Night-side + low-altitude behaviour unchanged (dayK = 0 whenever the sun is
   *  down at the camera). */
  dayDimStartSin: 0.0,
  dayDimFullSin: 0.35,
  dayDimFloor: 0.25,
  mwDayFloor: 0.0,
} as const;

/** Milky Way (owner 2026-07-10 "very subtle" → owner 2026-07-15 "pronounced and realistic").
 *  TWO layers on the BSC5 star sphere (both inherit the −GAST sidereal rotation, so the band
 *  sits correctly over the earth for the scene time):
 *   • HAZE — NASA/GSFC SVS "Deep Star Maps 2020" Milky-Way-only layer (svs.gsfc.nasa.gov/4851;
 *     Gaia DR2 star counts with the bright Hipparcos/Tycho stars REMOVED, so no BSC5 point is
 *     drawn twice): real dust lanes / Great Rift / Sagittarius bulge / per-pixel colour, J2000
 *     equatorial plate carrée (RA 0h centred, RA increasing LEFT — sky convention). Baked
 *     linear→sRGB + dither offline (scripts note in scene/stars.ts); sampled per-fragment
 *     dir→RA/Dec (no geometry-UV seam/pole pinch; mips off so the RA wrap has no derivative
 *     artifact). Landmark-verified: photometric bulge px (3064,1351) vs Sgr A* projection
 *     (3113,1354) and LMC px (1140,1815) vs (1128,1817) on the 4k grid.
 *   • POINTS — the original procedural gaussian field, retuned DOWN to a sparkle layer riding
 *     on top of the haze (alpha 0.35 → 0.14). */
export const MILKYWAY = {
  /** All-sky haze texture (public/, 8192×4096 JPEG — upgraded from 4k, owner 2026-07-15;
   *  credit: NASA/GSFC SVS · ESA/Gaia/DPAC — see index.astro attribution). */
  hazeTexture: "/textures/milkyway-2020.jpg",
  /** Mobile texture tier (MOBILE_PLAN M0): 2048×1024 bake of the same map for coarse-pointer
   *  devices (~2 MB VRAM vs ~134 MB, mips off). NOT a naive downscale — SVS maps are
   *  flux-per-pixel and the flux hides in sub-texel star speckle (DECISIONS 2026-07-15), so the
   *  bake resizes in LINEAR light (area-integrating the speckle) and verifies patch means:
   *  `node scripts/build-milkyway-2k.mjs`. */
  hazeTexture2k: "/textures/milkyway-2020-2k.jpg",
  /** Haze brightness multiplier on the additive sphere (1 = the baked map as-is;
   *  1.0 → 0.8 owner 2026-07-15 "a little bit subtler"). */
  hazeGain: 0.8,
  /** Atmospheric extinction on the DIFFUSE layers (owner 2026-07-15 "embed into the sky more
   *  naturally"): near the horizon the band dims through the thick air column — haze/sparkle
   *  fade from extinctionFloor at the true horizon to full by extinctionBandDeg above it.
   *  Real BSC5 stars are exempt (they carry the punch). Effect is atmosphere-bound: it fades
   *  out with camera altitude across extAltLoM → extAltHiM (no extinction from orbit). */
  extinctionBandDeg: 16,
  extinctionFloor: 0.22,
  extAltLoM: 20_000,
  extAltHiM: 150_000,
  /** Narrow-FOV attenuation of the DIFFUSE layers (haze + procedural sparkle — never the real
   *  BSC5 stars): fovK = floor + (1−floor)·smoothstep(lo, hi, camera vFOV°). At 250–300 mm the
   *  4k map magnifies ~15× (unresolved star speckle → soft blobs) and a long lens + normal
   *  exposure would not show the diffuse glow this strongly anyway (verified on
   *  prephase6-b2/c2 shots, 2026-07-15). */
  narrowFovLoDeg: 8,
  narrowFovHiDeg: 35,
  narrowFovFloor: 0.22,
  count: 14_000,
  /** Peak point alpha — sparkle layer over the texture haze (0.35 → 0.14, 2026-07-15). */
  alpha: 0.14,
  /** Point sizes (px, pre-DPR): sizeBase + rand²·sizeSpread. Below ~1 px a point often covers
   *  no pixel centre at DPR 1 and simply vanishes (verified live — the 0.6 px first cut rendered
   *  NOTHING); ~2.6-5 px + low alpha reads as the intended soft veil (sizeBase up S5). */
  sizeBase: 2.6,
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
  /** Galactic-equator guide (Phase 8a P2) — shown only while the GALACTIC CENTRE is tracked.
   *  Segment length along galactic longitude (deg); 3° ≈ smooth at any focal length. */
  bandStepDeg: 3,
  /** Half-width of the guide ribbon (deg of galactic latitude) — the ±edge small-circles.
   *  Spec range ±10–15°; 12° brackets the visual band (σb 8.5° above). */
  bandEdgeDeg: 12,
  /** Guide alphas (× the stars' own fade): equator line / edge lines. Guide semantics — no
   *  fovK/day dimming like the diffuse layers; additive line colour = tokens.milkyWay, so the
   *  peak stays far under BLOOM.threshold 0.9 (UNVERIFIED visually until the P2 browser pass). */
  bandAlpha: 0.5,
  bandEdgeAlpha: 0.2,
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
  /** Per-tile screen-door reveal duration (ms) — RENDERING_QUALITY_PASS F1, the #1 street-level
   *  pop. attachBuildings registers NO TilesFadePlugin (its per-material WeakMap fights the ONE
   *  shared-material invariant — last-tile-wins + constant global recompiles), so each b3dm used
   *  to SNAP to full on load-model. Instead each tile stamps a birth time and the SHARED material's
   *  chained onBeforeCompile screen-door-`discard`s against a bayer threshold over its age — opaque,
   *  O(1)/draw, one compiled program, reusing the imageryGround dither idiom. ~600 ms reads as an
   *  intentional stipple assemble (already the site's look), not a pop. */
  fadeInMs: 600,
  // --- Pass 2 (Dnipro identity, RENDERING_QUALITY_PASS WS3) — both ride the ONE shared fill
  //     material via its chained onBeforeCompile: R2 tints the fill by a stable hash of the b3dm
  //     batch id (`_batchid`/`_feature_id_0`) + a per-tile seed; R3 adds a warm night emissive
  //     gated by a SECOND decorrelated hash. Free fragment math (no extra pass, no per-tile
  //     material), so they need no tier knob — they degrade with the existing bloom tiering. ------
  /** R2 — per-building tonal variation (±fraction on the fill albedo). 0 = the pre-Pass-2 uniform
   *  slab (the no-op comparator); 0.12 ≈ subtle massing that survives the dark palette. When the
   *  live tiles carry no readable batch id the id defaults to 0 in-shader → variation degrades to
   *  PER-TILE tone (still better than one flat material, never an error). */
  toneVariation: 0.12,
  /** R3 — night-facade emissive (tokens.cityLights). **DEFAULT OFF (0).** A flat per-wall glow reads
   *  as "painted yellow" (owner rejected 0.6 then 0.4) and a procedural window GRID read "junky"
   *  (owner 2026-07-13 — removed). Buildings carry NO night emissive by design: their identity is the
   *  dark mass + lit edges + cast/received SHADOWS + the golden/moon key light. The wall-gate/hash
   *  plumbing stays wired (gain 0 = no-op) so a future look could reuse it; keep at 0. */
  nightWindowGain: 0,
  /** R3 wall-gate hash thresholds (unused while gain 0; kept so the plumbing compiles). */
  nightWindowLitLo: 0.7,
  nightWindowLitHi: 0.95,
} as const;

/** Dnipro 3D enrichment (Slice 0 de-risk spike) — a SECOND buildings tileset (self-hosted 3D Tiles),
 *  masking Cesium OSM Buildings inside `bbox` and streamed in their place. ENTIRELY DEFAULT-OFF: the
 *  orchestrator attaches nothing unless `import.meta.env.PUBLIC_ENRICHED_TILES_URL` is set, so with no
 *  URL the globe is byte-identical to before. Plan: `.claude/claude-docs/dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md`
 *  + `dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md`; module: scene/enrichedBuildings.ts; mask: scene/buildings.ts. */
export const ENRICHED = {
  /** Enrichment/mask bbox (deg, west/south/east/north). This is BOTH the OSM-buildings mask extent
   *  AND the enriched-tileset extent — they MUST match (the enriched bake REPLACES OSM here; a mismatch
   *  overlaps or gaps them). GREATER Dnipro ~20×20 km (~10 km radius from the centre, owner ask
   *  2026-07-14) — matches scripts/bake/cities/dnipro.json `bbox` (grid 20 keeps ~1 km cells). Regen
   *  BOTH bakes on change: `npm run bake -- --city dnipro` AND
   *  `node scripts/bake/bake-osm2world.mjs --city dnipro-o2w` (the variant extends the same config).
   *  (Prior extents: full-city {35.0,48.42,35.1,48.5}, greater-centre {35.005,48.435,35.085,48.492},
   *  Slice-0 sample {35.038,48.457,35.053,48.467}.) */
  bbox: { west: 34.915, south: 48.37, east: 35.185, north: 48.55 } satisfies GeoBbox,
  /** Mask/seat extents for `?enriched=` variants baked over a DIFFERENT box than `bbox` (cross-city
   *  experiments; key = the variant name = cities/<name>.json, value = that config's bbox verbatim).
   *  Resolved once at boot by lib/globe/enrichedVariant.ts `resolveEnrichedBbox`; any variant NOT
   *  listed (dnipro-o2w — same box) and the no-param default fall back to `bbox` above, so the
   *  default path stays byte-identical. St Albans, UK ~6×6 km (owner experiment 2026-07-18). */
  variantBboxes: {
    "st-albans": { west: -0.3692, south: 51.7244, east: -0.2821, north: 51.7787 } satisfies GeoBbox,
    "st-albans-o2w": { west: -0.3692, south: 51.7244, east: -0.2821, north: 51.7787 } satisfies GeoBbox,
  },
  /** R1 SEATING STRATEGY (research-verified 2026-07-13): Cesium World Terrain renders WGS84-ELLIPSOIDAL
   *  heights; open DEMs (GLO-30 = EGM2008 orthometric, N≈+20.42 m over Dnipro) do NOT. So we DON'T trust
   *  baked absolute Z — we clamp the tileset to the RENDERED CWT at runtime: sample terrainHeightAt at
   *  the bbox centre and lift the whole group by that (matches how Cesium OSM Buildings seat, and kills
   *  both the ~20 m datum error AND the inter-DEM residual). The sample tileset is baked at ellipsoid
   *  h=0 precisely so this re-seat is what puts it on the ground. Set false only for a tileset already
   *  baked to CWT-consistent ellipsoidal Z (then only seatOffsetM applies). */
  reseatToTerrain: true,
  /** PER-CELL re-seat (Slice 2, owner #4 "buildings sit at water level"): the single bbox-centre
   *  lift seats a 6 km bake on ONE flat plane — the riverbank drop isn't followed. Each grid cell
   *  is a separate leaf tile, so on top of the group lift every loaded cell is offset along its
   *  own geodetic up by (terrainHeightAt(cell centre) − centre seat). Requires `reseatToTerrain`
   *  (meaningless for an absolute-Z bake). Cells keep the plain centre seat until their first
   *  terrain sample lands (sticky thereafter — same null/garbage discipline as the group seat). */
  reseatPerCell: true,
  /** Terrain samples (down-ray raycasts) per frame, round-robin across the LOADED cells — bounds
   *  the per-frame raycast cost (46 cells sweep in ~8 frames at 6). */
  reseatSamplesPerFrame: 6,
  /** Per-frame exponential ease toward a cell's refreshed seat delta (first sample SNAPS — the
   *  cell is still streaming in). 0.12 ≈ settles ~0.5 s at 60 Hz; keeps terrain-LOD refinements
   *  from popping buildings mid-view. */
  reseatEaseK: 0.12,
  /** PER-BUILDING re-seat (owner 2026-07-14: "buildings sunk/levitating"): the per-cell plane
   *  still leaves within-cell relief error (±10 m on steep ~0.9 km cells) — so each building
   *  (one contiguous `_feature_id_0` vertex run) and each tree instance ADDITIONALLY lifts by
   *  (terrain@its-own-footprint − cell seat), written INTO the position attribute / instance
   *  matrix on the CPU so the occlusion sweeps, shadows and picks stay consistent. Requires
   *  `reseatPerCell`. */
  reseatPerFeature: true,
  /** Terrain samples (down-ray raycasts) per frame for BUILDING footprints, spent nearest-cell
   *  first (the cells you stand in seat within ~1 s; the horizon catches up over ~20 s). */
  reseatFeatureSamplesPerFrame: 16,
  /** Terrain samples per frame for TREE instances (cheaper visually — trees tolerate a coarser
   *  sweep; same nearest-cell priority). */
  reseatTreeSamplesPerFrame: 10,
  /** Re-sort the per-feature sampling priority (cells by camera distance) every N frames. */
  reseatPriorityEveryFrames: 30,
  /** Plausibility bound (m) on a footprint sample vs its CELL seat — within-cell relief is
   *  ±~20 m at grid 10, so a bigger deviation is a coarse-LOD/streaming garbage raycast
   *  (browser-caught: a −134 m first sample snapped a building underground for seconds).
   *  Rejected samples keep the sticky last-good / the cell plane. */
  reseatFeatureMaxDeltaM: 45,
  /** One-time bounding-volume pad (m) on cell fill/edge geometry so raycast picks and the
   *  planner's trust-radius cull stay valid after per-feature verts shift by up to ~±15 m. */
  reseatBoundsPadM: 40,
  /** Manual vertical nudge (m, along the bbox-centre geodetic up) ON TOP of the terrain re-seat —
   *  the browser tuning knob for any residual float/sink. 0 until browser-verified over Dnipro. */
  seatOffsetM: 0,
  /** Screen-space error target (px) for the enriched renderer (library default 16). Lower = sharper. */
  errorTarget: 16,
  /** Hard-crease threshold (deg) for the enriched building edge strokes (mirrors BUILDINGS.edgeAngleDeg). */
  edgeAngleDeg: 30,
  edgeOpacity: 0.5,
  /** Visual A/B seam: tint the enriched edges to the ACCENT token so they're obviously
   *  distinguishable from the dark OSM mass during browser verification (confirms the mask + the new
   *  set at a glance). OFF since Slice 2 — the enriched set renders the SHARED building look
   *  (scene/buildingMaterial.ts: R2 tone via `_feature_id_0`, F1 reveal, landHi edges); flip back
   *  to true only to re-verify the mask/bake boundary. */
  debugDistinctEdges: false,
} as const;

/** Slice 3 — instanced trees riding the enriched tileset (baked as EXT_mesh_gpu_instancing nodes in
 *  the per-cell glbs → three's GLTFLoader builds ONE InstancedMesh per cell; streaming, LRU and the
 *  per-cell terrain re-seat are inherited from ENRICHED). Canopy colour = `tokens.vecGreen` (the
 *  vector-web vegetation family); the material lives in scene/enrichedBuildings.ts. */
export const TREES = {
  /** Trees cast sun/moon shadows (one extra instanced draw into the shadow map per loaded cell).
   *  Canopy shadows carry the golden-hour look; flip off if a weak tier ever chokes on the pass. */
  castShadow: true,
  /** Night albedo dim: at full night the canopy renders at (1 − nightDim) of its day colour —
   *  mirrors the vector web's night dimming so vegetation never glows against the dark ground. */
  nightDim: 0.55,
  /** FPV BUILDINGS-slider floor for trees: at slider 0 (see-through wireframe buildings) trees drop
   *  to this opacity so they stop occluding the framed subject; at 1 they are solid again. */
  fpvMinOpacity: 0.15,
} as const;

/** Imagery-ground palette grade (chained onBeforeCompile over each Esri tile material) — pulls the
 *  satellite imagery into the instrument's tonal range + the SAME sun shading as the base so the
 *  terminator is continuous across LODs. Runtime-tunable via __globe.groundUniforms in DEV. */
export const GROUND = {
  /** Dark-side floor — slightly above the base's: close-zoom ground must stay navigable.
   *  (0.45 → 0.38 2026-07-10; → 0.35 S5; → 0.40 2026-07-13 illumination pass — lifts the night-ground
   *  ceiling so moon terms can actually raise it; watch VIIRS city lights don't wash out). */
  nightFloor: 0.4,
  /** Pull satellite chroma toward the instrument (0 = untouched, 1 = grayscale). */
  desat: 0.52,
  /** Sit the imagery in the dark scene's tonal range. (0.56 → 0.60 2026-07-13: a brighter satellite
   *  grade so shadow + golden multiplies read as a larger delta — the SAT-mode twin of DRAPE.gain.) */
  gain: 0.6,
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
  /** Ambient sky fill (S7 feedback: "ground jarringly black") — a small ADDITIVE term in the
   *  grade so dark source pixels can never multiply to pitch black. Day side adds
   *  ambientDayK × tokens.skyHorizon (cool skylight); night side adds
   *  ambientNightK × tokens.moonlight plus the moon fill below. Scaled down by uFtwHiAlt so the
   *  orbital fade band stays tonally continuous with the self-lit base. */
  ambientDayK: 0.1,
  /** (0.012 → 0.02 2026-07-13: the moon terms are phase-gated, so dark-of-moon nights leaned on this
   *  flat floor — raise it so a new-moon night isn't pitch black, without washing the terminator.) */
  ambientNightK: 0.02,
  /** Moon fill that does NOT multiply by albedo (the old moonlit term is graded×moon — black
   *  stays black): fill = moonFillK × moonGlow × max(moonDir·up, 0) on the night side. */
  moonFillK: 0.7,
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

/** Dark uniform "vaporwave" drape (Phase 5.5 S7a, §Item 2a — owner-approved CARTO dark_nolabels).
 *  Below a tunable altitude band the dark raster owns the ground with UNIFORM lighting: the
 *  Esri-colorimetry grade (water detection / desat / hiAlt harmonizer) blends OUT and a flat
 *  shade with its own gain/cast blends IN. The crossfade rides the CARTO overlay's live opacity
 *  uniform + the uFtwDark shader blend — same screen-door-free dissolve idiom as the glides.
 *  Satellite texture becomes OPT-IN (camera.groundMode === 'satellite' pins the Esri look). */
export const DRAPE = {
  /** Crossfade band (m): pure Esri at/above the top… */
  fadeTopAltM: 7_000,
  /** …pure dark drape at/below the bottom. */
  fadeBottomAltM: 5_000,
  /** Crossfade ease time-constant (ms) — mode/altitude changes dissolve, never snap. */
  easeTauMs: 350,
  /** Albedo lift on the CARTO raster (screen-designed dark → the instrument's tonal range;
   *  >1 also gives the shadow overlay contrast headroom — the twice-learned lesson: CONTRAST,
   *  not map size, is the dark-palette shadow ceiling). (1.3 → 1.6 2026-07-13 illumination pass: a
   *  brighter default day-ground so the shadow multiply AND the golden multiply read as a larger
   *  delta — the "brighter day-ground grade" the crisp-shadow ask needs. Watch it doesn't bloom.) */
  gain: 1.6,
  /** Faint cool cast (per-channel multiplier) so the drape sits in the palette family. */
  cast: [0.97, 1.0, 1.05] as Tuple3,
  /** FLAT day-side shade — uniform look, no slope grade (terrain relief stays geometry-only). */
  dayShade: 1.0,
  /** Night floor on the drape (brighter than GROUND.nightFloor — the raster is already dark).
   *  0.45 → 0.52 S7 feedback ("uniform illumination" — night ground was reading pitch black). */
  nightFloor: 0.52,
  /** Dedicated ground-shadow opacity in dark mode (sun); blended vs SHADOWS.groundOpacity by the
   *  dark fraction — THIS is the value the DEFAULT dark-drape city view settles toward, so it is what
   *  "crisp shadows" actually depends on. 0.9 → 0.62 (S7 "jarringly black ground") → 0.80 2026-07-13:
   *  restore shadow presence now that the brighter DRAPE.gain + additive ambient floors keep the
   *  UNSHADOWED ground from reading black (crisper WITHOUT the old black-pit). */
  shadowOpacity: 0.8,
  /** …and under a full moon (× the K&S phase intensity, vs SHADOWS.moonGroundOpacity). Kept below the
   *  sun's 0.80 so night reads as presence, not contrast. (0.5 → 0.62 2026-07-13.) */
  moonShadowOpacity: 0.62,
} as const;

/** Geo labels + boundaries (Phase 5.5 S7b, §Item 2b). Natural Earth 50m public-domain data baked
 *  by scripts/build-ne-labels.mjs into public/data: country boundary polylines (GL, softly glowing
 *  graticule-family lines on the ellipsoid) + populated-place labels (screen-anchored DOM layer,
 *  scalerank-culled by altitude). Street names are the separate GL layer (STREETS). All altitude
 *  gates in metres above the ellipsoid. */
export const LABELS = {
  /** Baked assets. */
  boundariesUrl: "/data/ne-boundaries.bin",
  placesUrl: "/data/ne-places.json",
  /** City labels + boundaries live inside this altitude window. The design range read
   *  "100–2000 km", but the DoD says gone at LEO — and the default LEO pose is 1,100 km, so
   *  the top sits below it (also keeps the 900 km Explore cruise label-free; retune freely). */
  minAltM: 100_000,
  maxAltM: 900_000,
  /** …fading in/out across this span at each edge (opacity ramp, never a pop). */
  fadeSpanM: 150_000,
  /** Boundary polyline opacity at full presence (graticule-family restraint). */
  boundaryOpacity: 0.28,
  /** Boundary lines lift this far (m) above the ellipsoid so terrain never z-eats them. */
  boundaryLiftM: 9_000,
  /** Label layer sync cadence (frames). 1 = every frame (S7 feedback: any DOM throttle reads as
   *  labels lagging the 60 Hz mesh — ≤28 direct style writes per frame are cheap). */
  syncEveryFrames: 1,
  /** Visible label budget (best scalerank first) — a screen of type is a map, not an instrument. */
  maxVisible: 28,
  /** Screen-space min separation (px) between labels — accepted in rank order, so a megacity
   *  shades out the towns around it instead of colliding with them. */
  minSepPx: 76,
  /** Scalerank gate: at maxAltM only ranks ≤ rankAtMax show; by rankFullAltM every rank shows
   *  (linear in log-altitude between them). NE scaleranks: 0–1 megacities … 8+ towns. */
  rankAtMax: 2,
  rankFullAltM: 220_000,
  /** Screen-edge margin (NDC) — labels cull just past the frame so pans don't pop them. */
  ndcMargin: 1.05,
} as const;

/** Vector street names (S7 feedback batch, v3 — GL). The v2 DOM labels were repositioned at
 *  ~20 Hz against a 60 Hz mesh and re-selected in screen space every sync — the owner read that
 *  as "laggy, jumping around". v3 pins each name ON the ground mesh: a canvas-textured quad
 *  lying in the terrain's tangent plane, rotated along its street (scene/streetNames.ts) —
 *  rendered by the same composer frame as the terrain, so it CANNOT lag. Type size is now WORLD
 *  metres (paint on the road): it scales with zoom optically, like the buildings do.
 *  Names show in both ground modes; hidden in FPV (photo view stays clean). */
export const STREETS = {
  /** TileJSON entry — resolved ONCE at attach for the current versioned tile template (the
   *  dated path segment rotates with OpenFreeMap's builds; never hardcode it). */
  tileJsonUrl: "https://tiles.openfreemap.org/planet",
  /** Fetch zoom — the schema's maxzoom (deeper tiles do not exist; z14 ≈ 2.4 km at 48°N). */
  tileZ: 14,
  /** Neighborhood ring around the focus tile (1 = 3×3 ≈ 7 km — covers the visible street web). */
  ring: 1,
  /** Names fade in below this camera altitude (owner: appear at ~2–2.5 km)… */
  topAltM: 2_500,
  /** …fully present at/below this one; they stay to street level. */
  fullAltM: 2_100,
  /** Visible label budget + WORLD-space min separation (m) between anchors — priority order
   *  wins (the v2 screen-space declutter reshuffled labels on every sync — the "jump"). */
  maxVisible: 40,
  minSepM: 130,
  /** Painted text cap height (m) by class tier: [majors ≤ rank 2, mid ≤ rank 4, the rest].
   *  World-sized text reads like road paint: distant names small, street-level names large. */
  textHeightM: [22, 15, 11],
  /** Label quads float this far above the sampled terrain (z-fight clearance vs the drape). */
  liftM: 2.2,
  /** Canvas raster cap height (px) — one texture per name, mipmapped; 44 px stays crisp
   *  across the whole 2.5 km→street window without troika/SDF machinery. */
  canvasPx: 44,
  /** Re-sample the rendered terrain under each label every N frames (tiles refine under it);
   *  re-seat eases (never snaps) when the sample moves ≥ reseatEpsM. */
  reseatEveryFrames: 240,
  reseatEpsM: 2.5,
  /** Upright-flip hysteresis (dot of text-up vs camera tangent) — labels flip to stay readable
   *  when the camera crosses the street axis, with a dead band so they never flicker. */
  flipHysteresis: 0.08,
  /** Per-frame opacity lerp toward the target (RENDERING_QUALITY_PASS F3): a selected label fades
   *  IN from 0 and a de-selected one fades OUT to 0 before it is dropped, instead of snapping on
   *  the selection cadence (the v2 pop). 0.15 ≈ the terrain-reseat ease → ~0.25 s at 60 Hz. */
  labelFadeLerp: 0.15,
  /** Selection re-runs at this cadence (frames) OR on a tile-cache change — selection is
   *  bookkeeping only; the quads themselves are glued to the mesh every frame by the GPU. */
  selectEveryFrames: 20,
  /** Class priority for de-clutter (OpenMapTiles transportation classes, majors first). */
  classPriority: ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "path"],
} as const;

/** Vector feature web (S7 feedback batch) — roads / rivers / water / green drawn as GL geometry
 *  from the SAME OpenFreeMap z14 tiles the street names parse (scene/vectorTiles.ts fetches
 *  once, both layers consume). Ribbons are real widths in metres seated on the rendered terrain
 *  (a bilinear height lattice per tile), so streets vs rivers vs bridges finally read at close
 *  zoom over the dark drape. Colours: tokens.vec* (map ink, not signal). */
export const VECTOR = {
  /** The web fades in below this camera altitude… */
  topAltM: 15_000,
  /** …and is fully present at/below this one. */
  fullAltM: 8_000,
  /** Focus ring: near ring below ringFarAltM, wider ring above it (higher camera sees more). */
  ringNear: 1,
  ringFar: 2,
  ringFarAltM: 4_000,
  /** Parsed-tile cache budget (shared with street names — a parsed tile is ~100 KB). Kept
   *  above maxBuilds so a built tile's source data usually survives for its refresh rebuild. */
  tileCacheMax: 56,
  /** Built-tile budget. Builds PERSIST when they leave the focus ring (S7 feedback #2: dropping
   *  them on ring exit popped river tiles in and out on every pan/focus wobble) — eviction is
   *  by distance from the focus, only past this cap, never inside the active ring. */
  maxBuilds: 48,
  /** Every N frames ONE built tile re-samples its height lattice against the (refining)
   *  terrain; it rebuilds only when the lattice moved ≥ refreshEpsM — otherwise a fill built
   *  over coarse LOD ends up UNDER the refined terrain and its patches flicker out. The same
   *  eps gates the PRE-build verification pass (two consecutive lattices must agree). */
  refreshEveryFrames: 240,
  refreshEpsM: 3,
  /** Road ribbon width (m) by OpenMapTiles class — presence in this map is ALSO the render
   *  filter (transit/aerialway/construction classes stay out of the web). */
  roadWidthM: {
    motorway: 22,
    trunk: 20,
    primary: 16,
    secondary: 12,
    tertiary: 10,
    minor: 7,
    service: 4.5,
    pier: 5,
    raceway: 8,
    busway: 7,
    path: 2,
    track: 2.5,
    rail: 2.5,
    transit: 0, // present-but-zero: parsed for completeness, never built
  } as Record<string, number>,
  /** Waterway line width (m) by class. */
  waterwayWidthM: { river: 12, stream: 4, canal: 8, drain: 2, ditch: 2 } as Record<string, number>,
  /** Fills sit lowest, ribbons above them, bridges highest (m above the sampled terrain).
   *  Water rides HIGHER than green: the 6×6 lattice can't track riverbank slopes between
   *  knots, and a low water fill dips under the refined terrain (part of the flicker). */
  liftFillM: 0.6,
  liftWaterM: 3.5,
  liftRoadM: 1.5,
  bridgeLiftM: 6,
  /** Layer opacities (× presence × night dim). Fills stay translucent — the drape's own
   *  colorimetry shows through; ribbons are the readable ink. */
  fillOpacity: 0.5,
  lineOpacity: 0.85,
  /** Night dim: map ink is unlit, so it would glow at night — dim toward this floor as the sun
   *  sets (smoothstep over sin(sun elevation) at the view focus, twin of EARTH.lightsBand). */
  nightDim: 0.45,
  /** Terrain height lattice per tile (N×N heightAt samples, bilinear between) + the per-frame
   *  sampling budget shared across tiles (raycasts — keep small). */
  latticeN: 6,
  latticeBudgetPerFrame: 8,
  /** Tile geometry builds per frame (a build is a few ms — never burst the frame budget). */
  buildBudgetPerFrame: 1,
} as const;

/** FPV mini-map (owner 2026-07-14): a small square 2D vector patch — roads/water/green/building
 *  footprints from the SAME shared MVT source as the street web — always centred on the walked
 *  viewer, shown ONLY in FPV. The globe-side feed (scene/minimapFeed.ts) projects features into
 *  local metres around a slow-moving origin and mirrors them into store/minimap; the panel
 *  (panels/MiniMap.tsx) just draws a canvas. */
export const MINIMAP = {
  /** Ground patch the map shows, edge to edge (m) — THE owner tunable ("maybe 200×200 m"). */
  patchM: 200,
  /** MVT fetch ring around the viewer (1 → 3×3 z14 tiles — the same tiles the street web uses,
   *  so entering FPV usually costs zero new network). */
  ring: 1,
  /** Rebuild the feature payload when the viewer walks this far from the last build origin (m).
   *  Features carry ~1.5× patchM margin, so the map never shows a hole before the rebuild. */
  rebuildDistM: 60,
  /** Clip half-width of the feature payload around the origin (× patchM) — the walk margin. */
  clipK: 1.6,
  /** Pose mirror cadence (frames) — rides the FPV HUD cadence class (~20 Hz at 60 fps). */
  poseEveryFrames: 3,
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
  /** Re-seat the placed photo on the terrain every N frames as tiles refine (a raycast). */
  resnapEveryFrames: 120,
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
  // --- Arrival re-framing (bug fix 2026-07-11): a photo selected from HIGH altitude / oblique
  //     tilt places its frustum on terrain the tiles have not loaded yet (terrainH≈0), so the
  //     onPlaced flight commits a lookAt below the real ground. As tiles refine, frustum.resnap()
  //     lifts the frustum but the flight target stayed low → the photo lands SHIFTED (grows with
  //     the selection altitude/tilt; nil at city scale where terrain is already loaded). While
  //     framing a fresh selection the orchestrator resnaps every frame and, once the frustum
  //     SETTLES, re-flies a short glide onto the LIVE arrival pose — the live-terrain correctness
  //     FPV/focus-lock already have. Disarmed by any user action so it never fights direct control.
  /** Duration (ms) of the corrective re-frame glide (short — not the full cinematic arrival). */
  reframeDurationMs: 800,
  /** Only correct when the live plane-centre has drifted from the committed target by > this (m). */
  reframeMinMoveM: 10,
  /** The live plane-centre counts as "still" for the settle detector when it moved < this (m)
   *  between frames (below the frustum's own 0.5 m resnap threshold rounding). */
  reframeSettleEpsM: 1,
  /** …and must stay still for this many consecutive frames (terrain done refining) before the
   *  single corrective glide commits — avoids chasing each quantized-mesh LOD step. */
  reframeSettleFrames: 12,
  /** Hard cap on corrective re-frames per selection (bounds any residual LOD thrash). */
  reframeMaxCount: 3,
  /** Give up framing this long (ms) after the selection regardless (2.2 s flight + terrain settle). */
  reframeDeadlineMs: 6500,
} as const;

/** Public pins on the shared globe (Phase 5; look reworked Phase 5.5 S4 §Item 6). Each pin is
 *  a thin STEM (vertex-alpha fade to the base) + a floating shader HEAD (semi-transparent core,
 *  fresnel rim, per-instance shimmer) + an additive cross-FLARE that appears only at twinkle
 *  peaks — three instanced draws, sizes derived from ONE angular-constant head radius so the
 *  pin keeps its shape at any zoom. The viewport query tier maps camera altitude → geohash
 *  precision (Wix Data has NO geo query — D7 hasSome over cell prefixes).
 *  Colors come from lib/theme/tokens (pin palette) — never from here. */
export const PINS = {
  /** Stem-base height above the local ground (m) — just clears the drape, buildings may
   *  occlude the stem naturally (the head floats above). */
  liftM: 1,
  /** Fallback ground height (m, above ellipsoid) before terrain tiles answer heightAt. */
  fallbackGroundM: 120,
  /** Head world radius = camera distance × this (angular-constant size)… */
  angularSize: 0.008,
  /** …clamped so pins neither vanish at street level nor balloon in orbit. */
  minSizeM: 6,
  maxSizeM: 45_000,
  // --- S4 pin anatomy (all × the head radius `size` unless marked in metres) -----------------
  /** Stem height = size × (this + stemSpreadFactor × stagger01)… (raised 2.4/1.8 → 3.6/2.8,
   *  owner 2026-07-11: "make pin stems higher"). */
  stemBaseFactor: 3.6,
  /** …stagger01 from lib/pins/appearance clusterLayout (gh6 neighbor de-leveling). */
  stemSpreadFactor: 2.8,
  /** Stem world-height clamp (m): the floor keeps heads over typical rooftops at street zoom;
   *  the cap tucks stems under the clamped head from orbit — the LEO dot look is preserved. */
  stemMinM: 30,
  stemMaxM: 3_600,
  /** Adaptive de-clustering (owner 2026-07-11 — no skew/lean; replaces the scatter cuts).
   *  Every gate is camera→cluster DISTANCE (≈ zoom altitude when looking at the pins):
   *  FAR (≥ singleDist) a cluster renders as ONE marker — hover names the member count,
   *  click DIVES to differentiation range instead of opening a pin; MID members spread on a
   *  min-separation ring (screen-constant; the world radius shrinks as you zoom) and blend
   *  toward their TRUE coordinates once real separation suffices; NEAR (≤ mergeDist) the
   *  ring folds onto the truthful coordinates — the stem-height stagger keeps identical-spot
   *  pins selectable. A SELECTED pin always eases to its truth. */
  clusterSingleDistM: 300_000,
  clusterSpreadFullDistM: 250_000,
  /** Min separation between spread heads (× head radius; 2 = one full head diameter). */
  clusterSepFrac: 2.4,
  /** The ring folds back to truthful coordinates across this distance band. */
  clusterMergeStartDistM: 2_000,
  clusterMergeDistM: 1_000,
  /** Clicking a COLLAPSED cluster flies to this arrival altitude (m) instead of opening. */
  clusterDiveAltM: 60_000,
  /** Selected-pin ease toward its true location (ms). */
  selectEaseTauMs: 350,
  /** Stem radius = size × this (a thin needle). */
  stemWidthFrac: 0.07,
  /** Stem alpha at the TOP (fades to 0 at the base — vertex gradient). */
  stemTopAlpha: 0.55,
  /** The head floats this × size above the stem top. */
  headGapFrac: 0.35,
  /** Head core alpha at REST (more transparent by default — owner 2026-07-11)… */
  headCoreAlpha: 0.22,
  /** …rising to this while hovered (the old default — hover "solidifies" the pin). */
  headCoreAlphaHover: 0.38,
  /** Hover brighten: head colour × (1 + this × hover) on top of the alpha rise. */
  hoverBrighten: 0.45,
  /** Fresnel rim: pow(1 − |N·V|, pow) × gain (the fine bright edge; bloom picks it up). */
  headRimPow: 2.6,
  headRimGain: 1.6,
  /** Per-instance shimmer: brightness swings ±amp around 1 at ~speed rad/s, phase + rate from
   *  hash(id) — a slow breathing glint, never a blink (calm is the spec). */
  shimmerAmp: 0.28,
  shimmerSpeed: 1.1,
  /** Cross-flare gates on the shimmer peak: visible only above this fraction of the swing… */
  flareThreshold: 0.86,
  /** …drawn additively at size × this, with this overall alpha gain. */
  flareSizeFactor: 3.6,
  flareGain: 0.8,
  /** Hover (pointer over the head): the head + flare enlarge to × this IN PLACE — the stem
   *  and the head's CENTRE never move (an early cut scaled the whole pin, which raised the
   *  head out from under the cursor → hover dropped → it fell back → oscillation)… */
  hoverScale: 1.55,
  /** …with this ease time-constant (ms), and the pick raycast runs every N frames. */
  hoverEaseTauMs: 130,
  hoverEveryFrames: 4,
  /** Per-author hue palette (D14: tuning names TOKENS; colours live in lib/theme/tokens).
   *  hash(hueSalt + authorName) picks by weight — teal-heavy, warm rare; the salt is the
   *  palette seed, tuned so the launch authors read distinct (see appearance.test.ts). */
  hueTokens: ["pinTeal", "pinIce", "pinMint", "pinLavender", "pinWarm"],
  hueWeights: [3.5, 2, 2, 2, 0.5],
  hueSalt: "pin:",
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

/** Explore ambient pin journey (Phase 5.5 S4, §Item 11): the Explore nav item becomes a
 *  meditative auto-cruise — glide public pin → public pin (nearest-neighbour order) at
 *  constant angular velocity with a dwell at each, easing toward ~900 km / ~50° tilt. The
 *  journey starts CRUISING from the current pose — no entry flight, no lunge at the first pin
 *  (owner 2026-07-11: the welcome backdrop must open already gliding). ANY pointer / wheel /
 *  Escape / encoder input exits and never fights the user; <2 loaded pins falls back to the
 *  idle drift until pins land (globe/explore.ts owns the motion). */
export const EXPLORE = {
  /** Cruise altitude (m above the ellipsoid). */
  altM: 900_000,
  /** Cruise tilt (deg from nadir) — oblique enough that the landscape reads. */
  tiltDeg: 50,
  /** Target leg duration (s): angular speed = leg arc / this, clamped below. */
  legTargetS: 14,
  /** Angular-speed clamp (deg/s): floor keeps micro-legs from crawling; cap keeps far legs
   *  ambient (ISS drift is 0.066°/s). Band doubled 2026-07-11 — owner: cruise 2× faster. */
  omegaMinDegPerS: 0.12,
  omegaMaxDegPerS: 1.1,
  /** Smooth speed ramp over this fraction of the leg at each end (no jerk at start/stop)… */
  edgeRampFrac: 0.18,
  /** …with this floor so the eased ends still make progress (a pure ramp never finishes). */
  edgeRampFloor: 0.12,
  /** Dwell at each pin (ms) before the next leg begins. */
  dwellMs: 6_000,
  /** Slow orbit around the pin while dwelling (deg/s about the pin's up axis) — the journey
   *  never freezes, even when every loaded pin shares one city (rest poses coincide). */
  dwellOrbitDegPerS: 0.12,
  /** Altitude low-pass toward altM while cruising (ms) — legs absorb entry-altitude error. */
  altEaseTauMs: 2_600,
  /** Look-point low-pass (ms) — blends the arbitrary starting pose into the first leg and
   *  smooths the heading change at every dwell→leg handover (no snap, no entry flight). */
  poseEaseTauMs: 1_200,
  /** Ceiling on that low-pass, in deg/s of view-ray tilt/heading change (what the eye
   *  sees): a large entry error (~120° of heading when the default pose faces away from
   *  the first leg) pans around slowly at constant tilt — never whips, never dips to nadir. */
  lookMaxRateDegPerS: 12,
  /** Legs shorter than this arc (deg) count as arrived (colocated pins → dwell only). */
  minLegDeg: 0.05,
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
  /** Camera-FOV zoom range (deg, vertical). Entry FOV = the photo's own vertical FOV. minFovDeg is
   *  the max ZOOM-IN: 2.75° ≈ a 500 mm full-frame lens (focalFromVerticalFov(2.75) = 12/tan(1.375°) ≈ 500). */
  minFovDeg: 2.75,
  maxFovDeg: 80,
  /** Wheel deltaY → FOV multiplier exponent: fov ×= exp(deltaY · this). */
  wheelFovFactor: 0.0012,
  /** FOV ease time-constant (ms) — entry/exit FOV changes glide instead of snapping. */
  fovEaseTauMs: 180,
  /** Pitch offset clamp (deg) around the photo's own pitch — never flip over the poles. */
  pitchClampDeg: 80,
  /** Building ghosting while in ANY FPV: buildings inside the view would otherwise swallow the
   *  camera — fade the shared fill/edge materials so the view is never lost inside a mesh.
   *  S6 (owner): base fill 0.2 → 0.3 ("a little more opaque, still transparent") and the fill
   *  gains a per-fragment CAMERA-DISTANCE falloff — fully transparent up close, easing to this
   *  opacity by buildingGhostFarM (see scene/buildings.ts; the shared-material invariant holds:
   *  distance-from-camera is global, so it lives in uniforms, not per-tile state). */
  buildingGhostOpacity: 0.3,
  buildingGhostEdgeOpacity: 0.18,
  /** Distance falloff band (m from the camera): fill alpha is 0 inside nearM, full ghost
   *  opacity beyond farM — the street around the viewpoint stays readable, the skyline keeps
   *  its mass. */
  buildingGhostNearM: 60,
  buildingGhostFarM: 260,
  /** Eye height above the local ground (m) across which the ghost blends back to FULL opacity
   *  (owner: "with added altitude can gain full opaqueness") — once the viewpoint rises over
   *  the rooftops there is nothing to see through any more. */
  buildingSolidLoM: 40,
  buildingSolidHiM: 180,
  /** Camera FOV (deg) for the temporary-pin "look around" FPV (no photo to inherit from;
   *  wider than the cinematic POSE 38° — it's a street-level look, not a framing). */
  tempFovDeg: 55,
  /** Temp-FPV eye elevation ceiling (m above the pin's ground): the ALTITUDE encoder (the
   *  ZOOM encoder's FPV identity) raises/lowers the viewpoint STRICTLY vertically in this
   *  mode; floor = FRUSTUM.eyeHeightM. Photo FPV uses the same ceiling for its vertical LIFT
   *  off the frustum apex (lift 0 = the photographer's exact eye, the entry state). */
  tempEyeMaxM: 400,
  /** FOCAL ZOOM encoder (S6): log-space FOV rate at full deflection (per s) — the panel twin
   *  of the wheel zoom; fov ×= exp(∓rate·dt), same 8–80° clamp. 0.9 ≈ ×2.5 focal per second. */
  fovRateMaxPerS: 0.9,
  /** FPV HUD sync cadence (frames) — bearings/markers mirror at ~20 Hz; smooth enough for the
   *  edge chips to track a drag-look, far below any store-churn concern. */
  hudSyncEveryFrames: 3,
  /** Sun/moon edge markers hide when the body sits below this altitude at the anchor (deg) —
   *  −6° keeps a about-to-rise / just-set body plannable through civil twilight. */
  bodyMarkerMinAltDeg: -6,
  /** Sky-look glide time constant (ms) — clicking an off-frame ☀/☾ edge chip eases the FPV
   *  look toward the body (owner 2026-07-14); ~1 s to settle, never a snap. */
  skyLookEaseTauMs: 320,
  /** Shared `#f=` FPV link boot framing (owner 2026-07-14): the camera boots this high above
   *  the shared viewer point (m), looking along the shared bearing, so the right street tiles
   *  stream while the temp-FPV entry flight descends onto the exact eye. */
  shareBootAltM: 260,
  /** Tilt (deg from nadir) of that pre-entry boot framing. */
  shareBootTiltDeg: 55,
  // --- Per-frame loop constants (B13 — were inline in the orchestrator FPV paths) --------------
  /** The FOV glide has arrived (and snaps) when |fov − target| drops under this (deg). */
  fovArriveDeg: 0.01,
  /** Photo-FPV anchor ground re-sample cadence (frames) as terrain refines under the pin. */
  anchorGroundEveryFrames: 30,
  /** Proportional-speed floor base (m) for the vertical ALTITUDE encoder — a pure exponential
   *  from a 1.7 m eye barely gets airborne, so the step scales with max(height, this). */
  vertEncoderBaseM: 8,
  /** Temp-pin FPV entry looks at a point this far (m) ahead along the horizontal facing. */
  tempLookAheadM: 50,
  /** FPV WALK (owner): ground-plane speed (m/s) while an arrow key is held — you walk where you
   *  look (◀▶ strafe). Accumulates a world-space displacement off the anchor; resets on FPV entry. */
  walkSpeedMps: 22,
  /** Walk sprint multiplier while Shift is held with the arrows (owner 2026-08-11). */
  walkFastMult: 3,
  /** Walk precision-creep multiplier while Option (mac) / Alt is held with the arrows. */
  walkSlowMult: 0.5,
} as const;

/** FPV sun/moon day-arc overlays (Phase 5.5 S6, §Item 4) — az/alt polylines of each body's
 *  path across the scene-local solar day at the FPV anchor (lib/ephemeris/dayArc), drawn
 *  camera-anchored at the sky-impostor distance so the discs sit exactly ON their arcs.
 *  Occlusion is ANALYTIC (per-vertex altitude fade through the horizon band — same reasoning
 *  as the impostors' closest-approach fade; the arc's own az/alt IS the horizon test at the
 *  anchor), never the depth buffer. Colours: sun = tokens.sunGlow, moon = tokens.moonlight,
 *  per D14 — this file names no colour. */
export const DAYARC = {
  /** Ephemeris sampling step across the day (min) — 10 min ≈ 145 pts, sub-pixel kinks. */
  stepMin: 10,
  /** Hour-tick cadence (h). */
  tickEveryH: 1,
  /** Tick half-length (deg of sky) — drawn along the local vertical through the arc point. */
  tickHalfDeg: 0.45,
  /** Line alpha ahead of scene time (the plannable half of the day)… */
  alphaFuture: 0.6,
  /** …and behind it (already happened — kept readable but clearly secondary). */
  alphaPast: 0.22,
  /** Ticks render slightly brighter than the line so the hours read as instrument marks. */
  tickAlphaGain: 1.25,
  /** Per-vertex horizon melt over the point's altitude (deg): gone by lo, full above hi —
   *  the arc dives visibly through rise/set instead of being cut at the horizon line. */
  horizonFadeLoDeg: -6,
  horizonFadeHiDeg: -1,
  /** Whole-overlay fade ease (ms) on FPV enter/exit. */
  fadeTauMs: 250,
} as const;

/** Night-sky asterism figures (Phase 5.5 S6, §Item 4) — ~20 famous d3-celestial figures as a
 *  LineSegments CHILD of the BSC5 star sphere (inherits −GAST + camera-follow + scale + the
 *  stars' own altitude/night fade gating). Subtle by design: the figures annotate the stars,
 *  never wash them. Colour = tokens.star. */
export const ASTERISMS = {
  /** Baked asset (scripts/build-asterisms.mjs; RA stored in DEGREES — loader converts). */
  url: "/data/asterisms.json",
  /** Peak line alpha (× the star fade) — a faint constellation tracery. */
  alpha: 0.15,
  /** Full 88-figure asset (phase B, scripts/build-constellations.mjs) — fetched only when a
   *  constellation is first TRACKED; the ambient tracery above keeps the curated 26. */
  figuresUrl: "/data/constellation-lines.json",
  /** Tracked-constellation figure alpha (× the star fade) — an accent highlight, clearly above
   *  the ambient tracery yet still an overlay, not a poster. */
  highlightAlpha: 0.55,
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
  /** Screen-position mirror cadence (frames) for the "look from here" popup. */
  screenSyncEveryFrames: 6,
  /** NDC on-screen margin — the popup shows while |ndc| < this (a hair past the edge). */
  onScreenMargin: 1.02,
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
  /** SKY long-tail lookup debounce (ms) — SIMBAD is a courtesy service (>10 req/s = a 1-min
   *  ban) and /api/sbdb relays to JPL; both fire only after the local index came up empty AND
   *  the user paused this long. */
  skyLongTailDebounceMs: 600,
} as const;

/** Pass 3 — astro/obstruction planner (RENDERING_QUALITY_PASS WS4 + Dnipro Slice 5). The horizon
 *  profile is built ONCE per anchor (photo apex / FPV eye) from terrain + streamed buildings +
 *  instanced trees, then every "is the sun/moon blocked" question is an O(1) lookup — the build
 *  is time-sliced so no frame pays for the whole sweep. */
export const PLAN = {
  /** Azimuth bins in the horizon profile (3° at 120 — a building subtending less than a bin at
   *  the trust edge is ~150 m wide, comfortably sub-skyline). */
  azBins: 120,
  /** Terrain march: first/last sample distance (m) and geometric step growth per sample. */
  terrainMinM: 60,
  terrainMaxM: 30_000,
  terrainGrowth: 1.35,
  /** Geometry trust radius (m) — the WS4 streamed-LOD caveat: beyond this, buildings/trees may
   *  simply not be loaded, so the profile only claims terrain knowledge there. 2–4 km per plan. */
  trustRadiusM: 3_000,
  /** Standard terrestrial refraction coefficient k (surveyor's 0.13) — folds into the curvature
   *  drop (1−k)/2R and the ECEF sweep lift k/2R. */
  refractionK: 0.13,
  /** Build slicing: terrain bins marched per frame · meshes edge-swept per frame. Both bound the
   *  per-frame cost of a profile build (~1–4 ms each on M3); raise to build faster. */
  terrainBinsPerFrame: 3,
  meshesPerFrame: 2,
  /** FPV eye drift (m) that invalidates the cached profile (arrow-key walking rebuilds). */
  rebuildDistM: 25,
  /** Default eye height above ground (m) when the anchor has no better answer (focus chips). */
  eyeHeightM: 2,
  /** Skyline crossing scan: how far ahead (days) and the coarse step (min) — crossings shorter
   *  than the step can be skipped (bisection refines to ±0.5 s after bracketing). */
  scanHorizonDays: 1.2,
  scanStepMin: 12,
  /** Re-scan throttles: scene-time drift that staleness the crossings (ms) · min REAL time
   *  between scans (ms) — a scrubber drag re-scans ~1×/s, not per pointermove. */
  scanStaleMs: 5 * 60_000,
  scanThrottleMs: 900,
  /** Store mirror cadence (frames) for the cheap per-instant blocked flags. */
  mirrorEveryFrames: 12,
  /** Per-building re-seat → profile consistency: after the enriched seating writes go QUIET for
   *  this many frames (settled, no easing), a ready profile built over the old geometry is
   *  invalidated ONCE and rebuilt — the skyline verdict must match what's rendered. */
  reseatQuietFrames: 90,
} as const;

/** Orchestrator per-frame loop constants (StylizedTiles.update) — cadences, mirror deadbands and
 *  guards that were inline magic numbers before the pre-S7 refactor (B13). Grouped here so the hot
 *  loop reads as intent; the delicate per-frame ORDER still lives in StylizedTiles.ts. */
export const ORCH = {
  /** Per-frame dt is clamped to this (ms) so a tab-switch stall can't teleport the camera. */
  maxFrameDtMs: 100,
  /** Pointer travel (px) above which a press is a drag, not a click / double-click. */
  clickDragPx: 6,
  /** The low-altitude terrain guard runs only below this camera altitude (m). */
  groundGuardMaxAltM: 50_000,
  /** Live-pose → store mirror cadence (frames) for the panel readouts (never 60 fps). */
  mirrorEveryFrames: 12,
  /** URL-hash pose mirror cadence (frames; a MULTIPLE of mirrorEveryFrames — it rides the same
   *  block). ~1.6 s between replaceState writes: Safari rate-limits history calls, and the
   *  address bar only needs the SETTLED pose (S7 feedback #2 — shareable/reload-safe URLs). */
  urlPoseEveryFrames: 96,
  /** Mirror deadbands — only sync when the live value moved at least this much. */
  tiltMirrorMinDeg: 0.25,
  headingMirrorMinDeg: 0.5,
  zoomMirrorMinFrac: 0.005,
  /** Projected-screen mirrors (hover card, temp-pin popup) re-sync past this move (px). */
  screenMoveMinPx: 2,
  /** Per-frame update() error log throttle (ms): log the first, then at most once per window
   *  with a rolling count — a persistent error must not flood the console at 60 fps (B26). */
  errorLogThrottleMs: 2_000,
} as const;
