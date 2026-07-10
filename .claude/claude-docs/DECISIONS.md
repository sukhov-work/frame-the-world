# Frame the World — Decisions Log

One line per meaningful change: what was decided, files touched, and any number measured. **Append-only,
absolute-dated.** Verification status is explicit — local-tested, wix-VERIFIED (confirmed against the live
Wix platform), or UNVERIFIED. Supersede a past line with a newer dated line; never edit or delete old ones.
Durable design rulings also live as `mem:decisions/*`. Maintained per `mem:decisions/session_workflow`.

The founding architecture decisions (ADR-000, D1–D15) are backfilled below from `PROJECT_SEED.md §4` —
they are **binding** and were research-verified before this repo existed. New work extends this log.

---

- **2026-07-10 — Phase 5 SHIPPED: members + save pins + 10-pin quota + public pins on the globe (wix-cloud-VERIFIED in wix dev — the first Wix-load-bearing phase).**
  **SDK scout first** (3 parallel agents; signatures from installed .d.ts, never fabricated): data 1.0.486 / members 1.0.485 / media 1.0.264 /
  pricing-plans 1.0.346 / astro 2.63 — verified table in `mem:project/wip-2026-07-10-phase5-members-pins`. **Re-scopes locked by falsification:**
  (1) NO data hooks on headless CLI (`beforeInsert` is Velo-only; service-plugins = externalDatabase only) → quota enforced in the elevated
  `POST /api/photos` endpoint, matching ARCHITECTURE §6; unbypassable because BOTH collections are ADMIN-only-write — a member-session
  `items.insert('Photos')` is refused by the platform (verified WDE0027). (2) `extensions.dataCollections` does NOT provision from wix dev →
  collections created via REST (`scripts/provision-collections.mjs`, idempotent, = schema source of truth): **Photos** (26 fields, exact GPS,
  `ownerMemberId` explicit — elevated inserts run as APP identity so `_owner`/SITE_MEMBER_AUTHOR can't own) + **PublicPins** (read ANYONE;
  ONLY reduced-derived fields). (3) Hosted signup is reCAPTCHA-gated → test members via `OAuthStrategy.register/login` (NO captcha demanded) +
  manual `authorize?prompt=none&sessionToken=` hop → wixSession cookie (recipe in `mem:patterns/members-pins`). **Auth:** @wix/astro auto-routes
  (`/api/auth/login` 302 → hosted page); OAuth-app allowlist is PORT-EXACT (4321 only — dev on 4322 died "Invalid redirect URI") → PATCHed
  oauth-app/v1 allowlist with :4322. **C6 (BINDING) enforced structurally:** `lib/geo/precision.ts` tiers exact→p9 (opt-in) / **1km→p6 DEFAULT** /
  city→p4; server-side `publicPinRecord` is the only PublicPins writer, publishes the CELL CENTER (verified live: 48.4647/35.0462 →
  48.46344/35.04089, ~150 m; anonymity-set property unit-tested). **Save flow:** upload store now RETAINS the original `File`; TUS original
  (tus-js-client + finalize PUT; failure degrades to warning) → ≤1280px preview JPEG → thin endpoints (C1). **Verified live:** save → 200
  photoId+publicPinId+quota 1/10 with both media on Wix (static.wixstatic.com preview); saves #2–#10 → 200; **#11 → 402 QUOTA_EXCEEDED**;
  signed-out visitor sees the pin at reduced coords via client-side `hasSome('gh4')` query (read ANYONE, no endpoint — C1); accent marker
  (tokens.accent, distance-scaled InstancedMesh) renders at 2.7 km over Dnipro; synthetic click at its pixel picks + flies (flight.active true).
  **Bug found by live verify + fixed:** pins viewport query = THROTTLE not debounce — %12-frame reports reset the timer forever while
  needsRequery stayed true pre-first-query (organic queries never fired; only post-save refresh worked). Query tiers: ≥120 km global
  newest-1000 · <120 km gh4 cells · <3 km gh6 (span = alt·0.011°/km, >120 cells → global). Files: stores member/save/pins ·
  lib/geo/precision · lib/wix/pinRecords · lib/save/{pinBody,uploadMedia} · api/{upload-url,photos,ping} · globe/Pins.ts + StylizedTiles wiring
  (click gate: placing wins → pin pick) · MemberBadge + .pd-save UI (PUBLIC PIN + tier chips + exact-warning) · tuning.PINS ·
  provision script. Deps += @wix/{data,members,media,pricing-plans}, tus-js-client. **190 vitest (+41) · astro check 0 · wix build green ·
  shots verify-shots/phase5-01..06.** Carried/UNVERIFIED: paid-unlimited path (Pricing Plans app NOT installed; `hasActivePlan` catch→free —
  never unlimited); **PRE-RELEASE GATE: app-defined POST routes 403'd in production in an official-skill trial — /api/ping kept as the
  released-URL canary**; transient pick-miss for a few seconds after flight arrival (controls keep creeping the camera — cosmetic);
  test member frame-p5-tester@example.com stays on the site (1/10 used). Mechanics + traps: `mem:patterns/members-pins`.
- **2026-07-10 — Owner batch #2 SHIPPED: multiday date-jump scrubber + crisper building shadows + Esri patchwork KILLED at altitude (browser-VERIFIED via Playwright MCP on wix dev).**
  **Multiday scrubber:** rail stays the ±12 h fine control; a native `<input type="date">` in the header (`.ts-date`, dark color-scheme)
  jumps the window to ANY calendar date preserving the LOCAL time-of-day — pure helpers `localDateStr`/`withLocalDate` in `store/time.ts`
  (+4 tests; malformed input → null so a cleared field never scrubs). Astronomy verified in-browser: pick 2026-12-21 → subsolar latitude
  −23.44° (Tropic of Capricorn ✓), moon 21%→91%, Ukraine dark at 16:00 with December city lights. offsetLabel minute-carry bug fixed
  ("+3936 h 60 m" → "+164 d 2 h" style). **Shadows:** SHADOWS.mapSize 2048→4096 · boundsM 2500→1600 (2.4→0.78 m/texel) · radius 3→2 ·
  groundOpacity 0.55→0.75 + ShadowMaterial tinted tokens.water (cool sky-lit shadow reads on the dark grade where pure black melts).
  Red-mask re-check: mask was pixel-crisp all along — presence (contrast over the dark palette) was the limiter, now recorded as the
  design ceiling. **Patchwork (owner screenshot #2 — persistent, so NOT loading):** the blobs are regional mosaic seams/haze baked in
  Esri's low/mid-zoom source imagery. GATES fade band 1.6e6/650e3 → **750e3/380e3** + GROUND.errorFarAlt 1.2e6→750e3: Blue Marble owns
  everything above ~750 km (default LEO 1100 km = ZERO Esri, verified spotless), Esri dissolves in only where its source zooms are
  detailed/consistent (517 km mid-band verified coherent). Files: `tuning.ts` (SHADOWS/GATES/GROUND), `scene/imageryGround.ts`,
  `store/time.ts`, `panels/TimeScrubber.tsx`, `styles/time-scrubber.css`, `test/store/time.test.ts`. **149 vitest (+4) · astro check 0 ·
  wix build green** (shots verify-shots/prephase5b-01..10). Carried: shadow contrast is palette-limited (dark graded ground) — knobs
  groundOpacity/mapSize; date picker uses the BROWSER timezone for day boundaries (v1 choice, same as the local-clock readout).
- **2026-07-10 — Pre-Phase-5 owner fix batch SHIPPED: narrow terminator + camera rotate/zoom sliders + high-alt patchwork fix + horizontal projection arrival + transparent photo plane + low-altitude day sky/haze + night stars at street level + real-coords Milky Way (browser-VERIFIED via Playwright MCP on wix dev).**
  **Terminator** (was half-lambert `wrap²` = dusk smeared across the whole sphere): day/night now switches across `EARTH.termBand`
  [sin −6°, sin +3.2°] (~9.2° ≈ the real twilight zone) in BOTH baseEarth + ground grade (twins — keep in sync); day side keeps a
  `dayGradMin 0.78 → 1` subsolar gradient for dimensionality; city lights + moon night term ride the same sine (`EARTH.lightsBand`
  replaces nightBand). **Patchwork at altitude** (owner screenshot = mixed Esri source zooms, washed vs textured): GATES fade band
  2.6e6/1.4e6 → **1.6e6/650e3** (Blue Marble owns high orbit; at 1100 km LEO uFtwFade ≈ 0.53 dither instead of full imagery) + new
  `uFtwHiAlt = 1 − altFade` drives desat → `GROUND.hiAltDesat 0.88` so mixed zooms converge in tone. **Sliders** (`store/camera.ts` +
  `panels/CameraTiltPanel.tsx` now 3 sliders): ROTATE = compass heading glide (rigid rotation about the view-focus up — tilt preserved
  EXACTLY; verified 47°→119.4° with tilt frozen 51.21°) + ZOOM = log-mapped altitude glide (dolly along camera→focus; verified 1100 km→8 km,
  right = zoom in); pure helpers `wrapHeadingDeg/headingDeltaDeg/sliderToAltM/altMToSlider` unit-tested. TRAPS fixed: glide + mirror MUST
  share one frame (view-focus up — pivot-frame vs camera-frame heading disagreed by 25°); `controls.getPivotPoint` returns NULL on horizon
  views leaving the out-arg STALE — the tilt glide orbited garbage and flew 8→128 km; both glides now fall back to the per-frame focus.
  **Projection pose:** FLIGHT backFactor 2.8→4.2, liftFactor 1.1→0.45 (~5° depression — landscape reads behind the photo); plane =
  `transparent, FRUSTUM.planeOpacity 0.7` default + live `store/upload.planeOpacity` + PLANE ALPHA slider in PhotoDetailPanel (verified 0.3
  reaches the material). **Low-altitude sky** (tokens skyDay #7FB8E8 / skyHorizon #D8E6F2): atmosphere shader gets a sky regime —
  `skyK` blends in below 120 km → light-blue zenith + horizon haze `exp(−sinEl/0.1)` (aerial perspective over distant terrain), golden-warmed
  at dawn/dusk, black at night; below `ATMOSPHERE.domeMaxAlt 350 km` the SAME mesh re-anchors to the camera at 0.45·far (the earth-centred
  shell's far hemisphere is past the tight dynamic far plane at street level — shader shades by ray DIRECTION only, so the swap is invisible);
  atmosphere no longer gated by decorMinAlt (graticule still is). Verified: light-blue sky + white haze band at 5.4 km AND at 106 m street level.
  **Stars at night:** `stars.update` takes sunDir; fade = max(altitude fade, night fade over sin(sun elev) −0.02→−0.14) — stars at any altitude
  after dusk (verified at 5.7 km, sun −10°). **Milky Way (D6-adjacent):** `lib/ephemeris/stars.ts galacticToEquatorial` (IAU J2000 NGP RA
  192.859°/Dec 27.128°, GC RA 266.405°/Dec −28.936°, Gram-Schmidt basis; unit-tested vs both anchors) + `milkyWayField` (14k points, gaussian
  σb 8.5° + 20% halo, Sagittarius bulge rejection-sampled) rendered as a CHILD of the star sphere (inherits −GAST + camera-follow); shared
  star material factory. TRAP (same as brightMin): 0.6–1.7 px points at DPR 1 render NOTHING — sub-pixel points often cover no pixel centre;
  live-tuned to sizeBase/spread 2.2 + alpha 0.25 = subtle veil. Files: `tuning.ts` (termBand/lightsBand/hiAltDesat/sky*/dome*/nightVis*/
  MILKYWAY/planeOpacity/heading+zoom CONTROLS/FLIGHT/GATES), `scene/{baseEarth,imageryGround,atmosphere,stars}.ts`, `StylizedTiles.ts`,
  `PhotoFrustum.ts`, `store/{camera,upload}.ts`, `panels/{CameraTiltPanel,PhotoDetailPanel}.tsx`, `styles/{tokens,camera-tilt}.css`,
  `lib/theme/tokens.ts`, `lib/ephemeris/stars.ts`, tests `test/store/camera.test.ts` + galactic/milky-way suites. **145 vitest (+11) ·
  astro check 0 · wix build green · browser-VERIFIED** (shots verify-shots/prephase5-01..11). Carried: residual band-zone patch contrast
  settles as tiles refine (taste knob hiAltDesat); zoom-slider direction (right = in) owner taste-check; slate quad seen once at 8 km
  (failed Esri overlay pre-retry — watch); night-sky navy floor source unidentified (looks good, cosmetic).
- **2026-07-10 — Phase 4 remainder SHIPPED: time-scrubber UI + golden-hour grade + real BSC5 star catalog (browser-VERIFIED via Playwright MCP on wix dev).**
  **Scrubber:** `panels/TimeScrubber.tsx` + `styles/time-scrubber.css` — bottom-centre rail (fluid middle band: `left:32rem; right:16rem;
  margin-inline:auto` so it never overlaps the hero or the readout column) spanning ±12 h (SCRUB.windowHours) around an anchor; drag →
  `useTimeStore.setTime` (UI-drag-verified: −4 h pin moved sunDir by the expected 60° chord 0.936); NOW chip + double-click + Backspace →
  `goLive`; release at a rail end recentres the window (multi-day walks); keyboard slider (± SCRUB.keyStepMin). Window math = pure exports in
  `store/time.ts` (`timeToFraction`/`fractionToTime`, upload.ts precedent). TRAPS: drag flag must be a REF (React state doesn't flip between
  same-tick pointer events — synthetic drags scrub nothing) and `setPointerCapture` needs try/catch (throws on synthetic pointerIds).
  **capturedAt seeding:** placing a photo pins the scene to `lib/ephemeris/captureTime.ts capturedAtToUtcMs` — the TZ-naive EXIF stamp read as
  SOLAR time at the placement longitude (offset = round(lon/15) h; documented v1 choice, ≤1 h off civil DST vs up-to-12 h for plain UTC).
  Browser-verified exact: 18:42:17 @ lon 35.05 → 16:42:17Z pin + rail recentred (knob 50%). **Golden hour (D6/D14):** per-fragment bell over
  sin(sun elevation) = dot(N, sunDir) — tuning.GOLDEN (fade −8°→−1°, hold →+7°, gone +16°) — tints baseEarth + ground grade (`×
  mix(1, goldenHour·1.15, bell·strength)`) and the atmosphere limb line (2·sun−1 in the shader IS the same sine); building key light lerps
  white→tokens.goldenHour by `goldenFactor` (lib/ephemeris/golden.ts, the JS twin) × bell(sunDir·focusUp) — focus ray HOISTED out of the shadow
  gate (computed every frame, falls back to sub-camera up past the limb). Verified: sunset pin = warm band hugging the dusk terminator +
  city-scale key light #ffc790 at 18:42 solar; high sun + night stay cold (no false fire). **BSC5 stars (D6):** `scripts/build-star-catalog.mjs`
  bakes brettonw/YaleBrightStarCatalog bsc5.json (MIT; SIMBAD-cross-checked Sirius/Polaris) → `public/data/bsc5.bin` LE float32 [x,y,z,vmag,bv]
  ×9,096 (177.7 KB; BV_SENTINEL 9.99 on the 310 B-V gaps); `lib/ephemeris/stars.ts` = parse + raDec→unit + Pogson size/alpha maps (softened;
  STARS.magRef/sizeGamma/brightGamma); `scene/stars.ts` fetches async (procedural field = pre-load/offline fallback), swaps geometry, and sets
  `points.rotation.z = −GAST` per ephemeris sample (`bodyStatesAt` now returns `gastRad`; almanac test 280.46° @ J2000, star-at-GAST→lon-0
  round-trip test). Browser: 9,096 loaded, rotation ≡ −GAST (1e-9), GAST 102.107° hand-checked for 11:34Z Jul 10. STARS.brightMin 0.18→0.55
  across two shots — a ~1.5 px point below ~0.5 alpha weight is invisible at DPR 1 (phase4-04/05/06). Files: `tuning.ts` (GOLDEN/SCRUB/STARS
  groups), `scene/{baseEarth,imageryGround,atmosphere,stars}.ts`, `StylizedTiles.ts`, `store/time.ts`, `lib/ephemeris/{bodies,captureTime,golden,
  stars}.ts`, `panels/TimeScrubber.tsx`, `styles/time-scrubber.css`, `pages/index.astro`, `scripts/build-star-catalog.mjs`, `public/data/bsc5.bin`.
  **134 vitest (+21) · astro check 0 · wix build green · browser-VERIFIED** (shots verify-shots/phase4-01..07; Playwright MCP healthy again).
  UNVERIFIED/carried: placeholder (texture-less) image plane blooms to white at point-blank (clamp below BLOOM.threshold later); star
  brightMin/golden strengths = owner taste-tune; planets (Phase-4 scope mentions them) not rendered — sun/moon/stars only.
- **2026-07-10 — Owner UX pass SHIPPED: camera feel (gradual verticality + eased zoom + inertia + tilt slider) + moon occlusion/brightness + soft adaptive tile loading (browser-VERIFIED via scripted Chrome on wix dev).**
  **Camera** (root cause from GlobeControls **0.4.28 source**): "snaps vertical on zoom-in" = `EnvironmentControls._setFrame`
  rotating the camera around the zoom point at FULL strength while zooming in (the library's edge-damping is forced OFF on
  zoom-in) + the whole wheel delta consumed in ONE frame (the class has no zoom inertia at all). Fixed in the ORCHESTRATOR —
  no library fork: (1) bank `zoomDelta`, release `exp(-dt/τ)` per frame (CONTROLS.zoomSmoothTauMs 160); (2) counter-rotate
  the unwanted fraction of the up-frame swing around `getPivotPoint()` after `controls.update()` — CONTROLS.zoomTiltKeep
  **0.35** (1 = library snap, 0 = tilt never auto-changes), zoom-IN only (zoom-out keeps `_tiltTowardsCenter`); (3) zoomSpeed
  altitude-braked ×0.35 below 30 km (zoomSlow*); (4) dampingFactor 0.15→**0.28** — fling coast measured **10.6°/6.2°/2.1°**
  over 0.3/0.5/0.8 s windows. POSE.target (53.2,41.3)→(57.3,46.9) ≈ 47°→**38° depression** — more horizon at open (pitch 51°,
  zoom trace 51→60° across a 1100 km→1.7 km dive, no vertical snap). **NEW declination slider**: `store/camera.ts` (live
  `tiltDeg` mirror ≤5 Hz + `targetTiltDeg` request) + `panels/CameraTiltPanel.tsx` + `styles/camera-tilt.css` (docked above
  TimeReadout); orchestrator glides via `controls._applyRotation(0, (pitch−target)·k, pivot)` — **source-verified sign:
  +y pitches toward nadir; angle 0 = nadir, π/2 = horizon; clamps internal**; glide cleared on arrival/globe-grab. Verified
  20°→19.9°, 70°→69.8°. **Moon/sun horizon occlusion:** impostors sit at a FAKE camera-anchored distance (0.5·far) so the
  depth buffer cannot occlude them against the planet (the limb is usually FARTHER than the impostor) — that was "moon
  clipping through earth". Fix (`scene/sky.ts`): per-fragment analytic ray-vs-earth closest-approach fade in BOTH impostor
  shaders (same math as the atmosphere; `tc<=0 → visible` guards the street-level zenith case), SKY.horizonFadeBandM 40 km;
  moon material transparent (alpha = fade, `discard` <0.004 so a hidden disc writes no depth over the stars);
  moonBrightness 1.25→**1.8**, earthshine 0.08→0.1. Verified at three pinned scene-times found by scrubbing the clock:
  h=+614 km bright disc · h=+18 km melting into the horizon haze · h=−1469 km **no disc** (uifix-07/08/09). **Soft loading**
  (3d-tiles-renderer 0.4.28 — every knob was at library default): page open at 1100 km sits BELOW the fade band → uFtwFade
  snapped to 1 on frame 1 over ZERO loaded tiles; root tiles were fade-EXEMPT (fadeRootTiles=false); TilesFadePlugin
  SNAP-completes all fades when >50 fade-outs while the camera moves >0.1 u/frame — the idle drift moves ~140 m/frame so it
  snapped constantly; failed Esri overlay fetches were never retried (permanent blank tiles). Fixes
  (`scene/imageryGround.ts` + GROUND tunables): TilesFadePlugin{fadeRootTiles:true, fadeDuration **700**, maximumFadeOutTiles
  **300**}; reveal = altFade × readiness, low-passed τ 600 ms — readiness = `tiles.loadProgress`×0.85 until the first
  `tiles-load-end` then 1, gated on `tiles-load-start` (loadProgress reads 1 before any request!); **adaptive errorTarget
  2↔12** lerped across 60 km↔1200 km alt (QuantizedMeshPlugin pins 2 at init = the long patchy window at LEO; measured 11.1
  at open); UpdateOnChangePlugin.needsUpdate forced until initial load ends (reduced-motion stall); `resetFailedOverlays()`
  debounced 8 s on load-error. Verified: 1 s clean stylized base → 3 s single soft dissolve → settled by ~6 s, no patch
  mosaics (uifix-01..04). Files: `globe/{tuning,StylizedTiles}.ts`, `globe/scene/{sky,imageryGround}.ts`, `store/camera.ts`
  (new), `panels/CameraTiltPanel.tsx` (new), `styles/camera-tilt.css` (new), `pages/index.astro`. **113 vitest · astro
  check 0 · wix build green · browser-VERIFIED** (shots verify-shots/uifix-01..09; the Playwright MCP was wedged — used
  scratchpad `playwright-core` + system Chrome instead). UNVERIFIED/carried: buildings still hard-pop (shared styleMat
  can't ride TilesFadePlugin — needs per-tile materials), zoomTiltKeep/fade-duration owner taste-tune, telephoto
  grazing-angle LOD seams (visible in uifix-09), repo has no lint script (skill text says `npm run lint`).
- **2026-07-10 — Pre-Phase-4 SHIPPED: ephemeris sun+moon + real 3D terrain + bloom + sun shadows + scene clock (browser-VERIFIED via Playwright on wix dev).**
  Owner pass before Phase 4: "sun and moon in correct space positions… truthful source of light… night more
  pronounced… moon emits light… soft bloom… physical shadows… 3D terrain… sleek current time… screenshots folder."
  **Ephemeris (D6):** `astronomy-engine@2.1.19` EXACT-pinned; `lib/ephemeris/bodies.ts` (pure) —
  `bodyStatesAt(utcMs)` → sun/moon ECEF dirs + distances + phase/illumination via GeoVector/GeoMoon →
  `Rotation_EQJ_EQD` → −GAST rotation (sign verified 3 ways; **JPL Horizons agreement ≤0.0007°**, tests assert
  ±0.05° — 10× tighter than the plan's gate; TRAP: `MakeTime(number)`=J2000 days, always wrap in `new Date`).
  **+9 vitest (113 total)** incl. solstice subsolar-latitude check. **Scene time:** `store/time.ts` (LIVE follows
  wall clock without 60 fps store writes; `setTime` pins — the Phase-4 scrubber seam) + `panels/TimeReadout.tsx`
  bottom-right mono HUD (local clock · LIVE/PINNED · date · UTC · moon glyph+% — live-verified ticking + PINNED
  amber on scrub). **Orchestrator** samples ephemeris at 1 Hz of scene time and pushes ONE sun/moon state into
  earth/ground/atmosphere shaders, GlobeCanvas key light, moonlight and sky bodies (browser check: subsolar
  22.2N/43.1E at 09:12Z ✓; night Americas at 3 AM local with blooming VIIRS lights ✓). **Sky bodies**
  (`scene/sky.ts`): camera-anchored impostors at TRUE angular size; **impostor distance must clamp ≥1.2·near**
  (GlobeControls fits near to ~13,000 km when looking away from earth — unclamped bodies near-plane-clip; found
  live); sun = limb-darkened HDR disc (bloom carries the glow), moon = NASA CGI Moon Kit LROC 1k on a sphere
  phase-lit in-shader by the real sun dir (22% waning crescent verified telephoto) + earthshine; moonlight =
  DirectionalLight × illumination + matching night term in earth/ground grades (moonSceneGlow). **Bloom:**
  EffectComposer w/ HalfFloat+**samples:4** RT (default 0 aliases edge lines) → UnrealBloom (0.4/0.5/0.9) →
  OutputPass (tonemap+sRGB move there; renderer settings untouched); night floors 0.22/0.38 (was 0.32/0.45),
  hemi 0.4→0.25. CAVEAT: frustum photo `toneMapped:false` is a no-op under the composer (Neutral ≈ identity <0.8).
  **Terrain:** imageryGround REWRITTEN — Cesium World Terrain (ion asset **1**) via QuantizedMeshPlugin
  registered inside `CesiumIonAuthPlugin.assetTypeHandler` (**never up-front** — priority −1000 fetches
  layer.json before the endpoint resolves) + ImageOverlayPlugin/XYZTilesOverlay (Esri z19, 256² per-tile
  composites) + unlit-swap plugin (priority −100: Standard→per-tile Basic keeps the stylized self-lit look) +
  TilesFade/UpdateOnChange; grade re-anchored map_fragment→**alphamap_fragment** (after overlay composite) and
  half-lambert now shades off the REAL surface normal (mountains read — Matterhorn/Alps verified); **90 m
  building sink REMOVED** (OSM Buildings clamp to CWT = the terrain now rendered; Dnipro bases verified seated;
  `terrainHeightAt` raycast reads 93.8 m fine-LOD ≈ the old hand-tuned 90 — but −453 m at coarse LOD, consumers
  must tolerate refinement). **Shadows:** PCF 2048² (PCFSoft deprecated r185), ortho ±2.5 km follows the
  camera-forward→ellipsoid focus, gated alt<30 km AND sun-up-at-focus; normalBias 1.0 world-m absorbs
  float32@6.4e6 acne; buildings cast+receive; terrain receives via per-tile ShadowMaterial twins (alpha-0 when
  unshadowed, altitude-gated). **Debug lesson:** the shadow pipeline worked from the first frame — black@0.35
  over the near-black graded ground is imperceptible; proven by an opaque getShadowMask() viz + red mask overlay
  (verify-shots/prephase4-14/16); groundOpacity → 0.55. **Frustum altitude semantics fixed** (regression found
  live: fixture floated 96 m over terrain): EXIF-provenance altitude = ABSOLUTE height clamped ≥ terrain+eye;
  MANUAL/MISSING = above rendered ground; + `resnap()` re-seats every ~2 s as tiles refine (apex 96 m ell ≈
  2.2 m above terrain verified). **Rule:** all browser-verification screenshots → `verify-shots/` (git-ignored;
  .claude/CLAUDE.md). Tokens += sunCore/sunGlow/moonlight (css+bridge). Attribution += Cesium ion. THIRD_PARTY +=
  astronomy-engine (MIT) + Moon Kit (NASA PD) + CWT. Files: `lib/ephemeris/bodies.ts`, `store/time.ts`,
  `components/globe/{tuning,StylizedTiles,GlobeCanvas,PhotoFrustum}.{ts,tsx}`, `components/globe/scene/{sky,imageryGround,buildings,baseEarth}.ts`,
  `components/panels/TimeReadout.tsx`, `styles/{time-readout.css,tokens.css}`, `lib/theme/tokens.ts`,
  `pages/index.astro`, `.gitignore`, `.claude/CLAUDE.md`, `THIRD_PARTY.md`, `public/textures/moon-color.jpg`,
  tests `test/lib/ephemeris/bodies.test.ts`. **113 vitest · astro check 0 · browser-VERIFIED** (shots
  verify-shots/prephase4-01..18). UNVERIFIED: moonlight visual isolated (22% moon), terrain street-level
  memory/perf, overlay sharpness at grazing angles (knob GROUND.overlayResolution), `wix release` bundle.
  Mechanics: `mem:patterns/sky-bodies-terrain`.
- **2026-07-10 — Phase 3 SHIPPED: frustum + projection + PLACE ON GLOBE + cinematic flight (browser-VERIFIED via Playwright on wix dev).**
  A placed photo now renders as an accent-lined **camera frustum + image plane** at its capture location and
  re-projects **live** from the sliders. **Math** (pure, three-free): `lib/geo/frustum.ts` `frustumGeometry`
  (ENU basis → far-face corners; EXIF roll via Rodrigues about forward; nadir-degenerate guard) +
  `projection.ts` gains `ecefToGeodetic` (Bowring seed + 2 fixed-point iterations — one-step is ~6e-8° off at
  LEO altitude, matters for flight poses) and `rayEllipsoidIntersect` (scaled-space sphere, near root) —
  **+28 vitest (104 total)** incl. the fixture reference (Dnipro 48.4647/35.0462, heading 214°, H-FOV 73.7°).
  **Store** (`store/upload.ts`): placement machine `review→placed` (GPS) | `review→placing→placed` (no GPS →
  "SET ON GLOBE" → globe click); `placement` is GPS-seeded, NOT a slider param; `textureWidth/Height` carried
  for aspect; **`derivedFov`** extracted as the ONE H-FOV derivation shared by review readout, detail panel and
  the rendered frustum (they can never disagree); DEV `window.__uploadStore`. **Scene**: `globe/PhotoFrustum.ts`
  (attach-module; group at apex + apex-relative vertices = float32-safe at ECEF scale; zustand VANILLA subscribe;
  photo texture sRGB + `toneMapped:false`) + `globe/flight.ts` (geocentric-direction slerp + altitude blend +
  ballistic bump `min(0.35·groundDist, 2500 km)·sin(πe)`; cubic-bezier(.65,0,.35,1) Newton solver; endpoints
  exact; runs after `controls.update()` like the drift; flight counts as interaction → drift paused through +
  8 s after; pointerdown cancels; **reduced-motion = instant cut**) + click-to-place in the orchestrator
  (pointerup <6 px travel → NDC unproject → ray-ellipsoid → `setPlacement`; crosshair cursor; Escape →
  backToReview). **UI**: PLACE/SET ON GLOBE button live (label by GPS presence); `panels/PhotoDetailPanel.tsx`
  + `styles/photo-detail.css` — docked tweak panel while placed (board-04 Slider reuse; full 04-board Claude
  Design import DEFERRED); PlacementHint pill while placing. **Semantics**: altitude slider = metres above the
  rendered (ellipsoid) ground; EXIF gpsAltitude seeds it so sea-level values float (fixture's 96 m does) until
  real terrain lands (D4 terrain-snap carried); missing heading/pitch default 0. Tunables in `tuning.ts`
  FRUSTUM (planeDist 120 m, eyeHeight 1.7 m) + FLIGHT (2200 ms, back 2.8×, lift 1.1×). Files:
  `lib/geo/{frustum,projection}.ts`, `store/upload.ts`, `components/globe/{PhotoFrustum,flight,StylizedTiles,tuning}.ts`,
  `components/panels/{UploadFlow,PhotoDetailPanel}.tsx`, `styles/photo-detail.css`, tests
  `test/lib/geo/frustum.test.ts` + `test/store/upload.test.ts`. **104 vitest · astro check 0 · wix build green ·
  browser-VERIFIED**: GPS JPEG → PLACE → 2.2 s flight lands at 228 m framing the frustum (heading 214°, H-FOV
  73.7° exact); heading slider → MANUAL badge + visible swing (re-projection measured **0.018 ms/update**);
  ARW (no GPS) → SET ON GLOBE → crosshair → street click → decoded texture placed at 48.4630/35.0457; Escape
  exits placing; reduced-motion emulation cuts 1100 km→228 m in one frame; console clean (frog beacon only).
  Screenshots `phase3-0{1..4}-*.jpeg` at repo root (owner: commit-or-delete). UNVERIFIED: portrait aspect
  visual, antipodal flights, mobile. Mechanics: `mem:patterns/photo-frustum`.
- **2026-07-10 — Globe refactor: tuning.ts (every tunable, documented) + scene/* modules + globe-tuning convention (browser-VERIFIED smoke at LEO + orbit/night).**
  StylizedTiles.ts had grown to a 783-line single function with magic numbers inline — refactored ahead of
  Phase 3 (owner ask: "extract all hardcoded settings/apis/magic constants with documentation, tunable later").
  (a) **`globe/tuning.ts`** — every number an art pass may touch, grouped per concern (SUN · RENDERER · POSE ·
  GATES · DRIFT · CONTROLS · TERRAIN · TILESETS · EARTH · GRATICULE · ATMOSPHERE · STARS · BUILDINGS · GROUND,
  later + FRUSTUM/FLIGHT), each entry doc'd with meaning/unit/range + verified-baseline provenance; pure TS,
  no three, NO colour literals (colour stays in `lib/theme/tokens.ts`, D14); `WGS84_A/B` re-exported from
  `lib/geo/projection` — killed a drifted duplicate (6356752.3 vs .314245); `SUN.direction` now feeds the
  earth shader + ground grade + GlobeCanvas DirectionalLight from ONE constant (the "must match" comment trap
  is gone). (b) **`globe/scene/{baseEarth,graticule,atmosphere,stars,buildings,imageryGround}.ts`** — one
  concern per module, idiom `attachX(scene, opts) → { objects/uniforms, update?(plain values), dispose() }`;
  orchestrator computes alt/dist once per frame; modules own their full lifecycle. (c) **`scene/glsl.ts`**:
  `glf()` formats JS numbers as GLSL float literals (GLSL ES rejects `float x = 2`) so tuning constants bake
  into shader templates; runtime-animated values stay uniforms seeded from tuning (`__globe.*Uniforms` still
  live-tweakable). (d) `StylizedTiles.ts` → ~230-line orchestrator (pose, controls, drift, gates, DEV
  introspection, try/catch frame). (e) New convention **`.claude/conventions/globe-tuning.md`** (two-file rule,
  tuning purity, glf pattern, module idiom, recurring traps) + pointer in `.claude/CLAUDE.md`. Files:
  `components/globe/{tuning,StylizedTiles}.ts`, `components/globe/scene/*` (7 new), `GlobeCanvas.tsx`,
  `.claude/conventions/globe-tuning.md`, `.claude/CLAUDE.md`. Behaviour-identical: `astro check` 0 · 76 tests
  green · **browser smoke**: LEO default pixel-familiar (alt exactly 1100 km, uFtwFade 1, 131 Esri + 7 b3dm
  tiles), orbit night side shows VIIRS lights (glf-injected shader paths exercised). Screenshots
  `refactor-smoke-{leo,orbit}.jpeg` at repo root.
- **2026-07-10 — Phase 2 decode SHIPPED: exifr + libraw-wasm@1.0.5 (pinned) + libheif-js in a disposable Worker (browser-VERIFIED via Playwright on wix dev).**
  The stub is gone — `extractMetadata` is the real pipeline. **Key discovery:** libraw-wasm 1.1.2+ are ALL
  pthread builds (`WebAssembly.Memory({shared:true})`, spawns `em-pthread` workers; their own integration
  test serves COOP/COEP) → hard-require cross-origin isolation, UNVERIFIED on Wix hosting (TODO-VERIFY #2)
  and would force CORP onto Esri/ion/font subresources. **Pinned 1.0.5 — the last single-threaded build**
  (probed empirically in Node: no worker.js, runs on the calling thread; metadata HAS width/height +
  camera_make/model but NO GPS — exifr owns metadata; imageData → {width,height,colors,bits,data}) →
  imported inside OUR module worker (`lib/decode/worker.ts` + `workerClient.ts`), which resolves
  TODO-VERIFY #2's decode half permanently (threads stay an optional future upgrade). 1.0.5 fetches
  `libraw.wasm` as a runtime sibling URL (not Vite's static `new URL` pattern) → the worker patches
  `self.fetch` to redirect that one request to the `?url`-imported asset; `optimizeDeps.exclude
  ["libraw-wasm"]` + `include ["libheif-js/…bundle.mjs"]` (else Vite's mid-session dep discovery on first
  worker spawn RELOADS the page — hit it live) + `worker.format "es"` in astro.config. **Decode settings**
  `{useCameraWb, halfSize, outputBps:8}` — halfSize skips demosaic (26 MP: 4.2 s total in Node vs 11.1 s
  full-AHD; browser 4.8 s) → 3136×2084 display texture via OffscreenCanvas → JPEG blob q0.92 (main-thread
  pixel fallback kept). Worker is TERMINATED after each decode — emscripten heap never shrinks (Node RSS
  337→814 MB across 3 decodes in one process) so disposable workers ARE the memory strategy. **exifr**
  (`exif.ts`): `reviveValues:false` keeps EXIF dates as TZ-naive strings (a revived Date shifts the wall
  clock by machine TZ — caught live: fixture reads 00:01:20, Date-serialized showed 21:01Z); rationals
  stay numeric, signed `latitude/longitude` still computed; `GPSAltitudeRef` arrives as byte-wrapper
  `{0:0}` (handled). ARW/NEF/DNG = TIFF-based → full metadata (2 ms on 31 MB); CR3/RAF → {} → D4 manual
  path. **HEIC**: native probe (`createImageBitmap` on the actual file, Safari) → else libheif-js wasm
  bundle in the same worker (0.4 s fixture). **Store**: real stage boundaries (wasm/unpack/demosaic/encode
  — libraw-wasm has NO intra-stage progress) + trickle easing; AbortController + seq guard (mid-decode
  re-drop cleanly supersedes — browser-verified); `stub` field REMOVED; new `loadError`/`decodeError`
  (decode failure keeps metadata + embedded preview + warn badge). **Fixtures**: `example-sony.arw` 31 MB
  ILME-FX30 (libraw-wasm's own, gitignored, README regen instructions) + generated `gps-heading.jpg`
  (committed, 2.5 KB, exiftool: GPS Dnipro + GPSImgDirection 214 + focal35 24) + `.heic` twin (sips,
  gitignored). Sensor DB += ILCE-7RM4 35.7 / ILME-FX30 23.3 / iPhone 15 Pro (+Max) 9.8; 7RM5 corrected
  35.9→35.7. Files: `lib/decode/{exif,worker,workerClient,convert,extract,wasm-modules.d.ts,sensors}.ts`,
  `store/upload.ts`, `panels/UploadFlow.tsx` (decoding-step thumb, decode-error badge), `upload-flow.css`,
  `astro.config.mjs`, `THIRD_PARTY.md`, tests `test/lib/decode/{exif,convert}.test.ts` (real fixtures,
  skip-if-missing). **76 vitest green (was 61) · astro check 0 · wix build green** (worker chunk +
  `libraw-*.wasm` asset + code-split libheif in dist). **browser-VERIFIED**: ARW → embedded preview
  ~120 ms → review 4.8 s w/ decoded 3136×2084 blob, full FX30 EXIF, 3× MISSING—ADD, H-FOV 45.4° (exact
  for focal35 43); HEIC via libheif 0.4 s w/ GPS 48.4647N + heading 214 EXIF-badged, pitch-only flag;
  JPEG native 0.1 s; slider ArrowRight→MANUAL+dot, dblclick→EXIF; Escape/reopen retention; globe island
  untouched; console clean (only pre-existing frog beacon). Screenshots decode-0{1,2}-*.png. UNVERIFIED:
  mobile decode ms/heap on a real device (26 MP halfSize ≈ 30 MB RGBA + wasm heap — DoD bench carried);
  Safari native-HEIC branch; `wix release` asset serving. Mechanics: `mem:patterns/upload-flow`.
- **2026-07-10 — UploadFlow UI shipped (board 05 + board-04 sliders) + zustand ingest spine + canvas push-back (browser-VERIFIED; decode STUBBED).**
  Owner priority 1 executed: full-screen upload overlay (`src/components/panels/UploadFlow.tsx`, opened by
  `[data-open-upload]` nav link / closed by Escape + ← GLOBE pill) with drop step (dropzone, format chips,
  simulated decode progress, privacy line) → review step (preview slot, metadata grid w/ EXIF badges, D4
  fields flagged **MISSING — ADD** in warn, notice row, disabled PLACE-ON-GLOBE til Phase 3, START OVER).
  **Store** `src/store/upload.ts` (zustand@5.0.14): immutable EXIF baseline + adjustable
  focal/heading/pitch/altitude params; provenance `exif|manual|missing` drives badges; double-click slider =
  reset to EXIF (or back to unset when the file never had it); RESET TO EXIF + changed-dot. **Slider**
  `src/components/ui/Slider.tsx` (board-04 idiom, pointer-capture + keyboard). **Decode contract**
  `src/lib/decode/extract.ts` — STUB (canned α7R IV / iPhone EXIF, `stub:true` + visible "DECODE STUBBED"
  badge; real object-URL preview for JPEG/PNG); Phase 2 swaps only `extractMetadata`'s body. **Derived H-FOV**
  readout wires `computeHorizontalFov` live (focal35 shortcut only while focal untouched). Formatters in
  `src/lib/format/readout.ts`. Files: + `src/styles/upload-flow.css`, `src/pages/index.astro` (island + nav),
  tests `test/store/upload.test.ts` + `test/lib/format/readout.test.ts`. **61 vitest green** (was 35) ·
  `astro check` 0 (no lint script exists in this scaffold). **browser-VERIFIED** (Playwright, wix dev): fake
  ARW → 3× D4 flags + H-FOV 54.4°; slider set→MANUAL/dot, dbl-click→missing, reset-all; real JPEG → native
  preview + heading 214° EXIF + pitch-only flag + H-FOV 73.7°; Escape/reopen state retention; globe island
  unaffected (only pre-existing console noise). **Canvas push-back DONE** (the deferred design step-4):
  `Shipped - Upload Flow.dc.html` (3 frames incl. divergence notes: adjust panel merged into review, ALTITUDE
  = 3rd D4 flag, SAVE DRAFT → START OVER) written to design project fb0d7afa + render-verified. Screenshots
  uploadflow-0{1..4}.png at repo root. UNVERIFIED: mobile layout on a real device; fonts under wix release.
  Mechanics: `mem:patterns/upload-flow`.
- **2026-07-10 — Globe fixes ×4: design-idiom buildings · adaptive halo · terrain-float sink · darker night (browser-VERIFIED).**
  Owner follow-ups after the overhaul. (1) **Buildings → design idiom** (canvas ftw-scene: dark mass, lighter
  stroked edges): styleMat now `tokens.surface` dark slate + roughness 0.85 + emissive land×0.10, plus per-tile
  **`EdgesGeometry(geometry, 30°)` LineSegments** in shared `edgeMat` (`tokens.landHi` @ 0.4, raycast-disabled);
  styleMat gets polygonOffset 0.5/0.5 so its own edge lines win the depth tie while bases still beat the ground's
  1/1; `dispose-model` disposes per-tile edge geometry only (shared materials disposed once). Edge-perf on dense
  metros UNVERIFIED (Dnipro fine). (2) **Orbit halo 1/10 width + bluer**: new `uOrbit` uniform (0 at ≤2,500 km →
  1 at ≥9,000 km) scales both scale heights by `mix(1, 0.1, uOrbit)` and shifts the line colour
  `mix(atmosphere, atmosphereDeep, 0.2 + 0.5·uOrbit)` — outer orbit gets a thin elegant blue rim, LEO keeps the
  thick horizon haze. (3) **Building float fixed**: Cesium OSM Buildings are clamped to Cesium World Terrain, so
  bases sat ~60–150 m above our ellipsoid-draped imagery — `tiles.group` sunk 90 m along the Dnipro up-normal
  (`TERRAIN_SINK_M`, city-specific Phase-1 interim until real terrain; street-level check shows planted, not
  buried). (4) **Night darker**: base `uNightFloor` 0.42→0.32, ground `uFtwNightFloor` 0.5→0.45 — city lights now
  pop against a moodier dark side. Files: `src/components/globe/StylizedTiles.ts`. `astro check` 0 · 35 tests
  green · **browser-VERIFIED** (Playwright): 1,400 m + 350 m Dnipro obliques (dark edged buildings planted on
  streets), 15,000 km orbit (thin blue halo; darker Americas night w/ brighter-reading VIIRS lights), LEO default
  unchanged (uOrbit=0).
- **2026-07-10 — Globe overhaul: organic LEO instrument (browser-VERIFIED via Playwright at LEO/orbit/night/mid/city).**
  Owner: "earth looks junky… ugly zoom into texture then a black vector switch… default should feel like flying a
  spacecraft in LEO… halo crude… night side needs geographically correct lights… geological features visible."
  Re-read the FULL design canvas (all 1238 lines + `globe-scene.js`) — key concepts beyond colors: halo peaks at
  ~5% alpha (restraint IS the look), oblique off-center framing, idle drift 0.035°/frame pause-on-interaction
  resume-8s, "terrain resolves" during descent. PROJECT_SEED §2 confirmed the complaints are the founding spec
  ("cinematic low-earth-orbit angle… NOT messy half-baked semi-realistic textures"). Rebuilt `StylizedTiles.ts`:
  (a) **base earth = NASA Blue Marble July topo+bathy 5400²** (`earth-color.jpg`, public domain, record 73751)
  mixed 58% organic over the sage duotone ramp (deserts/ice/bathymetry READ, stylized tone kept) + **VIIRS night
  lights 3600²** (`earth-night.jpg`) as warm `cityLights` emissive on the dark side (li² contrast, land-masked);
  colour maps are `SRGBColorSpace` (real imagery), data maps stay `NoColorSpace`; hash dither kills banding.
  (b) **atmosphere = ray-based exponential falloff** (`exp(-h/H)` off the view ray's closest-approach altitude;
  H=60 km teal line + 240 km Rayleigh-blue haze + faint air-wash on ground-hitting rays) — a fresnel rim peaks at
  the SHELL silhouette which detaches from the limb at LEO (the "crude halo"); CRITICAL: render the shell's NEAR
  hemisphere (DoubleSide + gl_FrontFacing + uInside) because GlobeControls' dynamic far plane (3.9e6 m at LEO)
  clips the far hemisphere (same trap that once hid the starfield — glow was invisible even at intensity 3).
  (c) **default POV = LEO spacecraft**: cam (46.0N, 31.3E, 1100 km) → target (53.2N, 41.3E, 0) via
  `getCartographicToPosition`, up = radial (limb + halo in top quarter), + **idle orbital drift** at ISS pace
  (0.0011°/frame about ECEF +Z, pause on pointer/wheel/touch, resume after 8 s, off for reduceMotion, gated
  >400 km). (d) **ground = Esri World Imagery z19** (swapped from Carto dark_all) via XYZTilesOverlay; each tile's
  MeshBasicMaterial gets a CHAINED onBeforeCompile (never assign — TilesFadePlugin already wrapped it): palette
  grade (desat 0.52 · gain 0.56 · cool cast) + SAME half-lambert sun shading as the base (continuous terminator) +
  blue-dominance water darkening ×0.35 (Esri's bright seas stay near-black per palette) + **global screen-door
  bayer dissolve** `uFtwFade` 0→1 over 2600→1400 km (active <3000 km) — detail grows organically out of the
  stylized earth, NO switch. (e) **stars sized by limb tangent distance** `sqrt(alt·(2R+alt))` not 1.05·alt
  (oblique POV put star specks IN FRONT of far terrain), clamped ≤0.9·camera.far; fade 250–700 km. (f) altitude
  gates now use `WGS84_ELLIPSOID.getPositionElevation` (spherical `length()-a` is ~21 km off at mid-lat).
  (g) tokens: +`atmosphereDeep #4A93D4`, +`cityLights #FFC36E` (tokens.css + regenerated bridge); attribution
  swapped to `© Esri · Maxar · Earthstar Geographics · © OpenStreetMap contributors` (index.astro). Files:
  `src/components/globe/StylizedTiles.ts`, `src/styles/tokens.css`, `src/lib/theme/tokens.ts`,
  `src/pages/index.astro`, `public/textures/earth-color.jpg` (+2.5 MB), `public/textures/earth-night.jpg`
  (+0.8 MB). `astro check` 0 · 35 tests green · **browser-VERIFIED**: LEO default reads as ISS-photo instrument;
  orbit hero (July geology, dark seas, crisp halo, stars); night side shows real city lights (Mexico City/Texas/
  California); 4 km + 2.2 km Dnipro oblique = thousands of grounded sage buildings over graded streets, near-black
  river; b3dm + Esri tiles 200 OK. **UNVERIFIED:** drift pause/resume via real pointer events; crossfade feel
  during a continuous live dive (checked at static altitudes; 50% bayer pattern visible at 1:1 mid-band); Esri
  tile ToS for production (hackathon-standard endpoint — revisit before `wix release`); mobile memory (2
  TilesRenderers + 5400² textures); CORS under `wix release`. Old uncommitted sage-palette retune kept as the
  duotone skeleton under the organic layer.
- **2026-07-10 — Claude Design round-trip CONFIRMED + token reconciliation imported (local-VERIFIED).**
  Post-restart, `/design consent` granted and `mcp__claude-design__list_projects` now returns "Frame the World"
  (`fb0d7afa-…`) — the killswitch fix is proven end-to-end (this was the reason for the restart). Read the design
  project: `Frame the World.dc.html` (1234 lines, canvas mode) + `globe-scene.js`/`image-slot.js`/`support.js`.
  Board "00 · DESIGN SYSTEM" defines: dark space-neutral base, one luminous cyan-teal accent, **Space Grotesk (UI)
  + IBM Plex Mono (readouts)**, 4px spacing base, motion (micro 180ms · panels 400ms · flight desktop 2200ms /
  mobile 1600ms · easing cubic(.65,0,.35,1) · idle drift 0.035°/frame, pause-on-interaction, resume after 8s),
  pin/quota/control states. Screen boards: 01 Landing, 02 Explore (pin hover), 03 Pin→Detail cinematic zoom,
  04 Photo Detail (live EXIF sliders, double-click resets to EXIF). Reconciled into `src/styles/tokens.css`:
  ADDED chrome tokens `--color-bg-raise #0B0F14`, `--color-surface-2 #1A1F27`, `--color-accent-600 #2FD1C4`,
  `--color-danger #E8756A`, `--color-warn #E8A268`; switched `--font-ui`→Space Grotesk, `--font-mono`→IBM Plex Mono;
  loaded both via Google Fonts `<link>` in `Layout.astro` (exact family/weights from the canvas). Regenerated the GL
  bridge `src/lib/theme/tokens.ts` (added `accent600`). **DIVERGENCE (deliberate, D14 fence):** the design board's
  `globe/land #7A8E84` + `globe/water #0A1118` were NOT adopted — the globe palette is browser-VERIFIED (`land
  #38495B`/`water #0F2233` + land-hi/peak/atmosphere/graticule/star, which the board doesn't even list), and design
  imports never own `globe/**`; kept the verified render values, flagged the swatch mismatch for a future call.
  Canvas push-back (step 4) DEFERRED until an actual panel/screen is implemented (snapshot-after-build semantics).
  Files: `src/styles/tokens.css`, `src/lib/theme/tokens.ts`, `src/layouts/Layout.astro`. `astro check` 0 errors +
  `npm test` 35 green. **UNVERIFIED:** font render + chrome-token appearance in the browser (no panel consumes the
  new tokens yet); Google-Fonts CDN reachability under `wix release` (swappable to self-hosted @fontsource if blocked).
- **2026-07-10 — Claude Design MCP unblocked: removed the nonessential-traffic killswitch (config-VERIFIED; round-trip pending restart).**
  Prior sessions couldn't reach the "Frame the World" design project (`fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c`) —
  MCP tools loaded but every call errored "hasn't granted this — run /design consent", and `/design consent`
  itself silently no-op'd; user reported "/design-login non-existent". Root cause (found by grepping the v2.1.205
  CLI binary + `~/.claude.json` + `~/.claude/settings.json`): it was NEVER a consent/login bug — the entire Claude
  Design Projects surface (`list_projects`/`read_file`/`write_files`) and `/design-sync` are HARD-GATED off by
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (binary string: "Projects is unavailable while nonessential network
  traffic is restricted"; the consent POST to `/v1/design/consent` is itself classed nonessential → blocked, so
  consent can't even be recorded). That flag was set in the `env` block of GLOBAL `~/.claude/settings.json`. Fix:
  removed the flag (user chose full removal over granular DISABLE_TELEMETRY/ERROR_REPORTING/AUTOUPDATER/BUG_COMMAND).
  JSON re-validated. **REQUIRES a full Claude Code quit+relaunch** (env read only at process start — this session
  still carries the flag). Post-restart: run `/design consent` (real cmds `/design consent|login|revoke`; the web
  app's hyphenated `/design-login` is not a CLI command), then MCP round-trip works. Files: `~/.claude/settings.json`
  (global, one line removed). Memory: `mem:project/dev_environment` (new "Claude Design MCP" section). Design
  round-trip + token reconciliation to the design space still **UNVERIFIED** until restart + consent + first import.
- **2026-07-10 — Globe detail pass: refining dark-map ground + normal-mapped terrain (browser-VERIFIED).**
  User: "upon zoom it looks like a mess, no details, no buildings — should be a proper map that gains clarity
  gradually; subtler atmosphere; more detailed terrain; more stars." Root cause (reproduced via Playwright):
  the 2048² base texture is featureless at city scale and asset 96188 is buildings-ONLY, so close zoom = flat
  blank ground + sparse same-colour buildings. Fix (research workflow, 3 agents; the `sources` agent failed
  schema + one glitched, but the `terrain` agent's R1–R7 + my own package verification covered it): (a) a
  SECOND `TilesRenderer` with **`GeneratedSurfacePlugin({shape:'ellipsoid',applyOverlayTexture:true})`** +
  `XYZTilesOverlay` (Carto `dark_all` {z}/{x}/{y}, user chose "dark vector map") + `TilesFadePlugin` +
  `UpdateOnChangePlugin` — a self-refining dark map draped on WGS84, revealed only below 300 km altitude so
  orbit stays stylized + cheap; Carto tiles LOD + fade in as you descend = "clarity gradually". (b)
  `GeneratedSurfacePlugin` ships WITHOUT a `.d.ts` in 0.4.28 (runtime-present via plugins index.js) → imported
  with `@ts-expect-error`. (c) base shrunk to WGS84×0.9997 so the imagery (at exact WGS84) sits in front (no
  z-fight); imagery meshes get `polygonOffset` on `load-model` so building footprints win. (d) building
  `styleMat` → `tokens.peak` + `flatShading` + `emissive tokens.land ×0.15` + `DoubleSide` so buildings POP
  over the dark map (they were the same slate as blank ground = invisible). (e) **normal-mapped relief**:
  added `public/textures/earth-normal.jpg` (2048², 329 KB) + a tangent-frame half-lambert in the base shader
  (`uRelief 0.75`, land-masked, pole-guarded) → orbit terrain now reads as lit 3D (Alps/Caucasus/Himalaya/
  Andes). (f) atmosphere subtler (`uIntensity 0.9→0.5`, `uPower 3.0→3.6`). (g) stars 2500→5000 + altitude
  fade 2000→800 km (fixes bleed over the near surface). (h) map attribution `© OpenStreetMap © CARTO` added
  to `index.astro` (Carto/OSM ToS). Files: `src/components/globe/StylizedTiles.ts`, `src/pages/index.astro`,
  `public/textures/earth-normal.jpg`. `astro check` 0 errors + **browser-VERIFIED** (Playwright): orbit relief
  + subtle rim + dense stars; city = dark Carto map with real Dnipro-area labels/roads + OSM buildings reading
  as light extrusions, no float/z-fight. **UNVERIFIED:** crossfade smoothness on a fast dive, mobile tile
  memory (2 TilesRenderers), CORS on `wix release`. **Claude Design MCP consent still not granted** (project
  "Frame the World" `fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c` exists but unreadable) → tokens NOT yet reconciled
  to the design space; run `/design consent` so it actually lands. zoomSpeed=5 kept (fine for a gradual pinch).
- **2026-07-09 — Phase 2 started: math core + vitest (local-tested, 35 green).** Built the load-bearing,
  fully-local-verifiable half of Phase 2 ahead of the WASM/browser parts: `src/lib/decode/sensors.ts`
  (FOV = `2·atan(sensorW/(2·focal))`; D4 fallback order `FocalLengthIn35mmFormat` → curated Make+Model
  sensor-width DB → flagged APS-C default; `estimated` flag drives the nudge UI), `src/lib/geo/geohash.ts`
  (base-32 encode/decode + adjacency + `geohashesForViewport` prefix set for the D7 `hasSome` query),
  `src/lib/geo/projection.ts` (WGS84 `geodeticToEcef` matching three's `WGS84_ELLIPSOID`, ENU basis,
  heading/pitch→`cameraForward`, `frustumPose`; three-free so it unit-tests fast). Added `vitest@^4` +
  `test`/`test:watch` scripts. Tests: `test/lib/**` — canonical geohash vectors (`ezs42`, `u4pruydqqvj`),
  exact ECEF axis points (equator→+X@a, pole→+Z@b), FOV textbook values, all fallbacks. `npm test` → **35
  passed**; `astro check` 0 errors. **Remaining Phase 2 (browser/WASM, next session):** `exifr` metadata +
  embedded-JPEG preview, `libraw-wasm` Worker decode, HEIC detect + `libheif-js` fallback, `UploadFlow`
  panel + zustand store — all need real RAW/HEIC fixtures + a browser to verify. Files: `src/lib/decode/sensors.ts`,
  `src/lib/geo/geohash.ts`, `src/lib/geo/projection.ts`, `test/lib/**`, `package.json`.
- **2026-07-09 — Phase 1 globe polish, take 2 (browser-VERIFIED via Playwright).** The prior "Phase 1 closed"
  globe rendered **near-black** — root cause found empirically (5-agent research workflow, 327k tok): the
  base used `earth-topology.png` (a grayscale **elevation** map — 66.5% of pixels exactly #000, mean 0.059)
  as an albedo **multiplier** against slate `landHi`, so `slate × ~0 = ~0`; only high peaks + Antarctica
  survived. Also: the graticule was a sphere **wireframe** (drew triangulation diagonals, not a grid),
  the atmosphere a flat back-side disc, the starfield **frustum-clipped** by GlobeControls' dynamic far
  plane (~2.04e7 at orbit) so it never rendered, and the base ellipsoid at `0.9995R` sat **3,189 m under**
  the WGS84 surface the OSM buildings extrude from. Fixes (all in `StylizedTiles.ts` + `GlobeCanvas.tsx`):
  (a) shipped a derived land/ocean mask `public/textures/earth-landmask.png` (`magick -threshold 0`, 43 KB,
  land 33.5% — interiors verified solid: C.Australia/Sahara/Siberia = 1.0; the texture-agent's "53% holes"
  was a bbox-includes-ocean artifact); (b) replaced the multiply material with a **ShaderMaterial** that
  `mix()`es water→land→landHi→peak from mask+elevation with half-lambert shading + `uNightFloor=0.5` (map
  readable on the dark side); both data textures now `NoColorSpace` (the `SRGBColorSpace` tag was itself a
  decode-darkening bug); (c) real lat/lon `LineSegments` graticule + hemisphere-discard shader (vanishes when
  inside); (d) fresnel limb-glow atmosphere (cyan-teal per brief); (e) camera-following, scaled starfield
  (`radius=1.05·alt`, centred on camera) so it stays inside the far plane; (f) `NeutralToneMapping` + explicit
  `outputColorSpace` (ACES/AgX rejected — desaturate the accent); (g) `HemisphereLight` fill + key 2.2→1.5 so
  night-side building tiles aren't black; (h) base at **exact WGS84** + `polygonOffset` + 384 segs; buildings
  now sit on the surface; (i) `setEllipsoid(tiles.ellipsoid, tiles.group)`, `enableDamping`, `maxAltitude=π/2`,
  `cameraRadius=8`, `zoomSpeed=5` (kept — fine for a gradual pinch); (j) dispose original tile materials on
  swap; raycast-disabled decorations; **150 km altitude gate** hides graticule/atmosphere/stars at city zoom.
  New GL tokens (css + bridge, ADR D14): `peak #7C8EA0`, `atmosphere #38E1D0` (swappable to Rayleigh blue
  `#4A93D4`), `graticule #2A3E4E`, `star #DDE6F2`; retuned `water #0F2233`, `land #38495B`, `landHi #4E6072`.
  Files: `src/components/globe/StylizedTiles.ts`, `src/components/globe/GlobeCanvas.tsx`,
  `src/styles/tokens.css`, `src/lib/theme/tokens.ts`, `public/textures/earth-landmask.png`. `astro check` 0
  errors + **browser-VERIFIED** (Playwright): orbit hero reads (continents geo-correct over Dnipro, cyan rim,
  stars, graticule); decorations gate off at low alt; OSM `.b3dm` tiles 200 OK refining to L4 over Dnipro.
  **UNVERIFIED:** the close-up oblique cityscape aesthetic (buildings load + are grounded by construction, but
  no polished street-level shot was captured). Claude Design MCP was unreachable (no consent) → palette is
  expert-judged, not from an approved design source. `wix release` still deferred → **Phase 2 (EXIF + decode) next.**
- **2026-07-09 — Phase 1 closed (browser-verified).** Rewrote `StylizedTiles.ts` end-to-end: (a) migrated
  to non-deprecated APIs — `CesiumIonAuthPlugin` from `3d-tiles-renderer/core/plugins`, `GlobeControls`
  with `setEllipsoid(WGS84_ELLIPSOID, scene)` (no `tilesRenderer` in the ctor); (b) fixed the
  "empty-from-orbit vanish" (asset 96188 is buildings-only) by adding a stylized ECEF-scale base
  ellipsoid textured with a self-hosted grayscale world topology for navigation cues
  (`public/textures/earth-topology.png`, 378 KB); (c) accent-tinted back-side atmosphere rim, ECEF
  star-field, firmer lat/lon graticule (opacity 0.15); (d) camera framed above Dnipro at 15,000 km via
  `WGS84_ELLIPSOID.getCartographicToPosition`, `up = +Z`, `near/far = 1/1e9`; (e) `zoomSpeed = 5` so
  trackpad pinch is usable; (f) `try/catch` around `controls.update() + tiles.update()` so a single
  bad frame can't freeze the canvas. Files: `src/components/globe/StylizedTiles.ts`,
  `public/textures/earth-topology.png`. astro check 0 errors + wix build green + **browser-VERIFIED**
  by the user. `wix release` deferred pending greenlight → **Phase 2 (EXIF + decode) is next.**
- **2026-07-09 — Phase 1: scaffolded the Wix headless Astro app + "hello globe" island.** `npm create @wix/new` provisioned a live site (`frame-the-a173087b-yevhens.wix-site-host.com`, siteId `f597bcf5-bd38-4941-9dfe-e16d775743a3`, appId `566ce8ce-…`); merged the scaffold into the existing repo (one `.git`, bootstrap layer intact). Added `three@0.185.0` + `3d-tiles-renderer@0.4.28`. Built `GlobeCanvas.tsx` (client:only procedural stylized globe — always renders) + `StylizedTiles.ts` (Cesium OSM Buildings ion 96188 + GlobeControls, **ion-token-gated via dynamic import**) + GL token bridge (`lib/theme/tokens.ts`, seeded palette) + `styles/{tokens,global}.css` + landing overlay. Files: `src/components/globe/**`, `src/lib/theme/tokens.ts`, `src/styles/**`, `src/pages/index.astro`, `src/layouts/Layout.astro`, `astro.config`/`tsconfig` deps. **local-tested:** `npx astro check` 0 errors + `wix build` green. **UNVERIFIED:** actual globe render + OSM buildings (browser-only; buildings need a Cesium ion token in `.env.local` → `PUBLIC_CESIUM_ION_TOKEN`). Not yet `wix release`d (blank site still live).
- **2026-07-09 — Bootstrapped the Claude operating environment.** Laid down `.claude/` (CLAUDE.md,
  conventions incl. the distilled `wix-headless.md`, hooks, `/frame` skill), `.serena/memories/` graph,
  the persistence loop (DECISIONS + NEXT_SESSION), and repo-native `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`.
  Ingested `PROJECT_SEED.md`, `DEEP_RESEARCH.md`, `CLAUDE_DESIGN_MEMO.md` verbatim. Files: `.claude/**`,
  `.serena/**`, `README.md`, `.gitignore`. App **not** scaffolded yet (Phase 1 next). local-tested (hooks `bash -n`).

### ADR-000 backfill (from PROJECT_SEED §4 — research-VERIFIED unless noted)
- **D1 — Globe engine:** three.js + `3d-tiles-renderer@^0.4` + Cesium OSM Buildings (ion 96188) + `GlobeControls`.
  Only combo giving real global 3D buildings + geo-accuracy + unrestricted per-tile material override + custom
  cinematic camera. VERIFIED.
- **D2 — Precision:** re-center tiles group near origin (ReorientationPlugin / CESIUM_RTC) + GlobeControls
  dynamic near/far. Solves float32 jitter without a float64 fork. VERIFIED.
- **D3 — Decode:** `exifr` embedded-JPEG preview → `libraw-wasm` Worker demosaic; single-threaded SIMD default;
  HEIC Safari-native detect + `libheif-js` fallback. VERIFIED (pipeline), UNVERIFIED (threads / COOP-COEP).
- **D4 — Orientation UX:** nudge-to-align is core; `FOV = 2·atan(sensorWidth/(2·focal))` + sensor DB +
  `FocalLengthIn35mmFormat` fallback. ILCs rarely write heading; GPS 3–15m, altitude junk → terrain-snap. VERIFIED.
- **D5 — Projection:** textured plane at frustum far face (v1); projective texturing (v2 stretch). VERIFIED.
- **D6 — Ephemeris:** `astronomy-engine` 2.1.19 (±1 arcmin) + procedural sky + Yale BSC5 stars, one source
  drives sliders + lighting. VERIFIED.
- **D7 — Data:** Wix Data Collections + geohash-prefix `hasSome` + client refine; denormalized `PublicPins`.
  VERIFIED (no geo ops), INFERRED (pattern).
- **D8 — Quota:** Pricing Plans check + `beforeInsert` hook rejecting insert #11 for free members (server-side). INFERRED.
- **D9 — Media:** originals private, derived previews public; resumable TUS upload for >10MB; 30-day download
  links. VERIFIED.
- **D10 — AI:** runtime Claude via Wix AI APIs (~1 credit/call; Opus 4.6 shown); vision gets downsized JPEG;
  premium-gated; doubles as the moderation pass. VERIFIED.
- **D11 — Scheduling:** none in v1; if needed, external cron → token-secured HTTP endpoint. VERIFIED.
- **D12 — Rendering:** WebGL2 primary, WebGPU progressive via `three/webgpu`. VERIFIED.
- **D13 — Cesium ion:** Community (free) for PoC; Commercial ($149/mo) at first sale / >$50K entity; manual
  attribution in UI. VERIFIED (terms), INFERRED (burn rate).
- **D14 — Design workflow:** Claude Design as token/motion factory → tokens.css (source of truth) → GL bridge
  `tokens.ts`; fence the globe; skip Claude Design's Wix connector (we scaffold via CLI for island/worker
  control). VERIFIED (workflow), UNVERIFIED (connector details).
- **D15 — Working title:** "Frame the World". ASSUMPTION (provisional).
