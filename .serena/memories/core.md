# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.

## Status
**Phase 1 DONE + globe OVERHAUL (2026-07-10, browser-VERIFIED via Playwright at LEO/orbit/night/mid/city).**
The globe is now the seed's signature scene: **default POV = spacecraft in LEO** (1,100 km oblique over
Dnipro, limb + halo in top quarter, ISS-pace idle drift w/ pause-on-interaction resume-8s), base earth =
**NASA Blue Marble July (organic geology) graded into the sage duotone** + **VIIRS night-side city lights**
+ normal relief, atmosphere = **ray-based exp-falloff limb glow** (near-hemisphere shell — the dynamic far
plane clips the far one), ground = **Esri World Imagery z19** palette-graded + sun-shaded + water-darkened,
screen-door-dissolving in 2600→1400 km so detail grows organically (no hard switch) under the OSM buildings.
Four owner fixes same day (browser-VERIFIED): buildings = dark `surface` slate + per-tile EdgesGeometry lit
strokes (design idiom); halo altitude-adaptive (`uOrbit`: outer orbit 1/10 width + bluer); `tiles.group` sunk
90 m (OSM buildings are Cesium-World-Terrain-clamped → floated above the ellipsoid drape; Dnipro-specific
interim); night floors 0.32/0.45.
Textures: `earth-color.jpg` (5400², July topo+bathy) + `earth-night.jpg` (VIIRS) — colour maps sRGB, data
maps NoColorSpace. New tokens `atmosphereDeep`/`cityLights`. Full mechanics + traps (far-plane clip, chained
onBeforeCompile, geodetic-vs-spherical altitude): **`mem:patterns/globe-rendering`**. `astro check` 0 ·
35 tests green. UNVERIFIED: Esri ToS for production, mobile memory, live-dive crossfade feel, `wix release` CORS.
**Design system imported (2026-07-10)** — chrome tokens + fonts in `tokens.css` + GL bridge
(`mem:patterns/design-system`). **UploadFlow UI SHIPPED (2026-07-10, browser-VERIFIED)** — board-05 overlay
(`panels/UploadFlow.tsx` + `ui/Slider.tsx` + `store/upload.ts` zustand ingest spine + `lib/decode/extract.ts`
STUB contract + `lib/format/readout.ts`), D4 provenance badges, double-click-reset sliders, derived H-FOV;
canvas push-back done (`Shipped - Upload Flow.dc.html`); 61 tests green; `mem:patterns/upload-flow`.
**Phase 2 decode SHIPPED (2026-07-10, browser-VERIFIED)** — exifr metadata (2 ms, TZ-naive dates) +
embedded-thumb instant preview + **libraw-wasm@1.0.5 EXACT-pinned** (1.1.2+ = pthreads/SAB = COOP/COEP —
unusable on unverified Wix hosting) in a disposable per-file Worker (halfSize decode 26 MP ≈ 4.8 s →
3136×2084 texture; worker terminated = memory freed) + libheif-js HEIC fallback. 76 tests · build green.
Mechanics + Vite traps: `mem:patterns/upload-flow`.
**Globe REFACTORED + Phase 3 SHIPPED (2026-07-10, browser-VERIFIED via Playwright on wix dev).**
Refactor: every tunable → `globe/tuning.ts` (documented groups); scene split into
`globe/scene/{baseEarth,graticule,atmosphere,stars,buildings,imageryGround}.ts` attach-modules +
`scene/glsl.ts` (`glf` GLSL-literal injection); StylizedTiles = ~230-line orchestrator; new
convention `.claude/conventions/globe-tuning.md`; WGS84 + SUN constants deduped. Phase 3:
`lib/geo/frustum.ts` (pure, 20 tests) + `ecefToGeodetic`/`rayEllipsoidIntersect` in projection.ts;
`globe/PhotoFrustum.ts` (apex-relative float32-safe geometry, vanilla zustand) + `globe/flight.ts`
(2.2 s bezier flight, reduced-motion cut) + click-to-place (crosshair + ray-pick); store placement
machine (review→placed | placing→placed) + `derivedFov` (ONE H-FOV derivation for UI + frustum);
`panels/PhotoDetailPanel.tsx` docked tweak panel (light board-04; full design import deferred).
Verified: fixture heading 214°/H-FOV 73.7° at Dnipro; re-projection 0.018 ms/update; ARW
click-to-place with decoded texture; Escape/placing; **104 vitest · astro check 0 · wix build
green**. Mechanics: `mem:patterns/photo-frustum`.
**Pre-Phase-4 sky+terrain SHIPPED (2026-07-10, browser-VERIFIED via Playwright).** Ephemeris
(astronomy-engine 2.1.19 EXACT, JPL-Horizons-tested ±0.05°) now drives EVERYTHING from scene time
(`store/time.ts` LIVE/PINNED + `panels/TimeReadout` HUD): real sun/moon ECEF directions →
terminator + building key light + atmosphere + moonlight (phase-scaled); sun + moon render as
camera-anchored true-angular-size impostors (`scene/sky.ts` — impostor dist MUST clamp ≥1.2·near);
soft bloom (EffectComposer HalfFloat+MSAA4 → UnrealBloom 0.4/0.5/0.9 → OutputPass; night floors
0.22/0.38); sun shadows at city zoom (PCF 2048², ortho follows view focus, buildings cast+receive,
terrain gets ShadowMaterial twins — shadow contrast, not the pipeline, is the usual "bug");
**real 3D terrain** = Cesium World Terrain (ion asset 1, QuantizedMeshPlugin via assetTypeHandler)
+ Esri via ImageOverlayPlugin — 90 m building sink REMOVED, `terrainHeightAt()` raycast + frustum
`resnap()` (EXIF altitude = absolute, clamped above ground; manual = above rendered ground).
Rule: browser screenshots → `verify-shots/` (git-ignored). 113 vitest · astro check 0.
Mechanics + traps: `mem:patterns/sky-bodies-terrain`.
**Owner UX pass SHIPPED (2026-07-10, browser-VERIFIED via scripted Chrome — Playwright MCP was
wedged):** gradual zoom verticality (zoomTiltKeep 0.35 counter-rotation) + banked/eased zoomDelta
+ altitude zoom braking + dampingFactor 0.28 inertia + POSE 38° depression (more horizon) + NEW
declination slider (`store/camera.ts` + `panels/CameraTiltPanel.tsx`); moon/sun per-fragment
analytic horizon-occlusion fade (was clipping through the planet) + moonBrightness 1.8; soft
adaptive tile loading (fadeRootTiles/700 ms/300 cap + loadProgress-gated reveal + adaptive
errorTarget 2↔12 + overlay retry). Camera mechanics: `mem:patterns/globe-rendering`; sky/loading:
`mem:patterns/sky-bodies-terrain`.
**Phase 4 remainder SHIPPED (2026-07-10, browser-VERIFIED via Playwright MCP):** TimeScrubber
±12 h rail (drag pins via `setTime`, NOW resumes, EXIF `capturedAt` seeds the pin as SOLAR time at
placement longitude — `lib/ephemeris/captureTime.ts`); golden-hour bell grade (tuning.GOLDEN, one
sin-elevation curve: earth/ground/atmosphere GLSL twins + key light lerp to tokens.goldenHour via
`lib/ephemeris/golden.ts`, focus ray hoisted out of the shadow gate); REAL BSC5 star field
(`public/data/bsc5.bin` 9,096×[x,y,z,vmag,bv] via `scripts/build-star-catalog.mjs`, star sphere
`rotation.z = −GAST`, `bodyStatesAt` returns `gastRad`). IMPLEMENTATION_PLAN §Phase 4 ☑ (planets
not rendered). Mechanics + traps: `mem:patterns/sky-bodies-terrain` §Phase-4 remainder.
**Pre-Phase-5 owner fix batch SHIPPED (2026-07-10, browser-VERIFIED via Playwright MCP):** narrow
~9° terminator (EARTH.termBand twins in baseEarth+ground; lightsBand replaces nightBand); ROTATE +
ZOOM global sliders (store/camera 3 target/mirror pairs; glides share ONE view-focus frame —
getPivotPoint returns null on horizon views, trap); high-alt Esri patchwork fixed (fade band →
1.6e6/650e3 + uFtwHiAlt desat harmonizer); projection arrival near-horizontal (FLIGHT 4.2/0.45) +
photo plane 70% opacity default + PLANE ALPHA slider (store/upload.planeOpacity); low-altitude
light-blue day sky + horizon haze in the atmosphere shader (camera-anchored dome below 350 km —
far-plane trap) + stars gated by sun elevation at low alt + 14k-point Milky Way at real galactic
coords as a star-sphere child (sub-pixel points render NOTHING — sizes ≥2 px). Tokens skyDay/
skyHorizon/milkyWay added. Mechanics: `mem:patterns/sky-bodies-terrain` §Pre-Phase-5 +
`mem:patterns/globe-rendering` §Manual sliders. **Owner batch #2 same day (browser-VERIFIED):**
multiday scrubber (date `<input>` in the rail; `withLocalDate`/`localDateStr` in store/time;
Dec-21 jump verified subsolar −23.44°); shadows 4096²/1600 m/radius 2/opacity 0.75 + tokens.water
tint (mask always crisp — CONTRAST is the dark-palette ceiling); Esri patchwork root cause =
mosaic seams baked in the low/mid-zoom SOURCE imagery → fade band 750e3/380e3 + errorFarAlt
750e3 (Blue Marble owns >750 km; default LEO spotless). 149 vitest · astro check 0 · wix build
green. Mechanics: `mem:patterns/sky-bodies-terrain` §Owner batch #2.
**Phase 5 SHIPPED (2026-07-10, wix-cloud-VERIFIED in wix dev — first Wix-load-bearing phase):** managed
member auth (@wix/astro auto-routes + hosted login; OAuth-app allowlist is PORT-EXACT — 4322 PATCHed in);
Photos (exact GPS, ADMIN-only, ownerMemberId explicit) + PublicPins (read ANYONE, reduced-only fields)
provisioned via REST `scripts/provision-collections.mjs` (CLI dataCollections extension does NOT provision
from wix dev — falsified); NO data hooks on headless → 10-pin quota enforced in elevated POST /api/photos
(unbypassable: member-session insert platform-refused WDE0027; #11 → 402 verified live); save flow = retained
original File → TUS upload (degrades to warning) → ≤1280px preview JPEG → thin endpoints (C1); C6 structural:
server-only publicPinRecord publishes the geohash CELL CENTER (1km/p6 DEFAULT, exact = opt-in, verified ~150 m
offset live); globe/Pins.ts accent InstancedMesh + viewport query (≥120km global / gh4 / gh6 <3km; THROTTLE
not debounce — %12-frame reports starve a debounce timer, real bug fixed) + click→fly (verified). 190 vitest ·
astro check 0 · wix build green. Test member frame-p5-tester@example.com (1/10). UNVERIFIED: paid-unlimited
(Pricing Plans app not installed → degrades to free) · production POST routes (403 trial report — /api/ping =
released-URL canary, PRE-RELEASE GATE). Mechanics + traps: `mem:patterns/members-pins`.
**Phase 5.5 DESIGNED + S1 SHIPPED (2026-07-11, browser-VERIFIED):** the 10-item pre-marketplace
UX batch is mapped into sessions S1–S7 in `.claude/claude-docs/PHASE_5_5_UX_BATCH.md` (canonical;
plan twin IMPLEMENTATION_PLAN §5.5; details `mem:project/wip-2026-07-11-phase5.5-ux-batch`).
S1 = LocationFinder (Photon autocomplete + Nominatim-on-Enter via `lib/geo/geocode.ts` adapter;
`store/camera.ts` flyRequest seam + focus mirrors; tuning.SEARCH; extent-sized arrivals, 3 km
terrain-safe floor) + TimeScrubber day ◀ ▶ steppers. 206 vitest · astro check 0 · wix build green.
**Phase 5.5 S2 SHIPPED (2026-07-11, browser-VERIFIED via Playwright MCP; absorbed owner items
13+14 — no S2b):** flight.ts rework — terrain path floor (`pathAltitude`, endpoints exact) +
path-tangent orientation (spin killed; smooth rate profile) + **`arrivalPose()` = the ONE arrival
derivation** (pins 200 m/80° verified 203.2 m/79.9°; search 52° now terrain-aware); street-level
camera (zoomMinAltM 2, cameraRadius 2.5, sticky-lastGroundM street-floor guard — verified resting
2.5 m above the Kyiv street); **FPV photographer mode** (`upload.viewMode`, camera EXACTLY at the
frustum apex at the photo's own FOV — NDC-verified; drag-look + wheel-FOV + Escape; gates S6);
CameraTiltPanel rework: compass (fluid north), 2D/3D toggle, encoder-style ROTATE/ZOOM rate
controls (`ui/Encoder.tsx`, headingRateDegPerS/zoomRatePerS seams). TRAPS (load-bearing): heightAt
returns NEGATIVE garbage on coarse tiles → clamp [0,9000] everywhere; an underground camera
UNLOADS the whole tileset (prevention only); terrain samples must come from the VIEW FOCUS (tiles
exist only in-frustum); GlobeControls.update() skips the near/far fit when disabled → FPV calls
adjustCamera manually. 221 vitest · astro check 0 · wix build green. Mechanics:
`mem:project/wip-2026-07-11-phase5.5-s2`.
**Phase 5.5 S3 SHIPPED (2026-07-11, wix-cloud-VERIFIED in wix dev with a member cookie):** pin
lifecycle — PATCH/DELETE /api/photos (owner-gated `items.get` check; `applyPinUpdate` keeps stored
media on null patch fields; C6 re-reduces edited locations to the NEW cell centre — live-verified;
isPublic toggle creates/removes the public row; DELETE frees a quota slot 2/10→1/10 live + media
best-effort `bulkDeleteFiles`); **authorName** denormalized on PublicPins (provision gained a
create-field diff pass; 5/5 live pins back-filled keyed on photoRef; `PublicPin.authorName` feeds
S4 hues); custom pin name (`save.title` + input); own-pin UPDATE/⌖ RE-PLACE/DELETE panel actions
(MY PINS passes `ownPhotoId`; armed two-step delete); placement flow completed (live ground marker
under the pointer while placing · PLACED→TUNED→SAVED stepper · save beat → auto-close → fly-out
3.8 km → pins-store `highlightId` → `Pins.setHighlight` 8 s pulse); upload CTA (nav accent chip +
one-time glow, "+ ADD PHOTO" pill for zero-pin/anon); owner adds: `.ct-stack` dblclick memo above
the camera controls + temp-pin popup **"↑ UPLOAD HERE"** (`upload.uploadAt` → `pendingPlacement`,
applied at ingest only when the file has no GPS; FROM PIN badge in review). 243 vitest ·
astro check 0 · wix build green. Mechanics: `mem:project/wip-2026-07-11-phase5.5-s3`.
**Phase 5.5 S4 SHIPPED (2026-07-11, browser-VERIFIED via Playwright MCP; absorbed a same-day
owner batch):** pin rework — `globe/Pins.ts` = THREE instanced draws (vertex-alpha stems ·
fresnel/shimmer shader heads · additive cross-flares at twinkle peaks only) with per-author
hues (`lib/pins/appearance.ts` hash → new pin tokens; `hueSalt "pin:"` keeps the 3 live
authors distinct) and gh6 de-clustering (height slots + 140 m ENU ring — C6-honest);
**instanced-ECEF PRECISION TRAP solved** (f32 large×large cancellation flickered at close
zoom → pins render camera-anchored: mesh.position = camera, camera-relative instances,
modelViewMatrix-ONLY shaders — reuse this for ANY future instanced ECEF layer); hover =
throttled head raycast → eased ×1.55 enlarge + `PinHoverCard` (title/author/date/thumb);
highlight-pulse seam kept. **Explore ambient journey** (`globe/explore.ts` + EXPLORE tuning +
`camera.exploreActive`): NN-ordered constant-ω great-circle legs at 900 km/50° (look-ahead
γ = asin((R+h)/R·sinα)−α, pure+tested), 6 s dwells w/ 0.12°/s pin orbit, <2-pin fallback that
re-begins when pins land; exits on ANY interaction/Escape/steering. **Welcome landing**
(`panels/Welcome.tsx`, owner mockup) replaced the hero: CTAs (UPLOAD/EXPLORE), chrome hidden
via `body.welcome-active`, Explore journey auto-armed as the backdrop, any globe click
dismisses; "+ ADD PHOTO" pill retired; time scrub centred + TimeReadout on its axis.
267 vitest · astro check 0 · wix build green. VERIFY-TRAP: occluded Chrome throttles rAF —
`page.bringToFront()` before timed Playwright runs. Mechanics:
`mem:project/wip-2026-07-11-phase5.5-s4`.
**Phase 5.5 S5 SHIPPED (2026-07-11, browser-VERIFIED via scripted headless-Chrome CDP —
`scripts/verify-s5-night.mjs` is the reusable harness):** night-sky physics — **K&S-1991
moonlight** (`lib/ephemeris/moonlight.ts` + `bodies.moonPhaseAngleDeg`; quarter = 10.3% of full
live-verified; SKY.moonKeyIntensity/moonSceneGlow = full-moon anchors) · **moon shadows** via
ONE-rig source switch (sun key impersonates the moon at tokens.moonlight × 0.3×ks when sun down
+ moon up + illum ≥ 0.85; moonLight stands down; ground twins setShadowStrength(0.55×ks)) ·
**Black Marble 8k** single-channel city lights (async R8 DataTexture upgrade in baseEarth,
uNightGamma 2.2, boot VIIRS fallback; TRAPS: flipY in the DATA — UNPACK_FLIP_Y ignores typed
arrays; no single-channel sRGB format exists) · stars/MW brighter + night floors 0.19/0.35 ·
**navy night sky ROOT-CAUSED**: the composer cleared its LINEAR HalfFloat buffer with the
sRGB-ENCODED clear colour (setClearColor converts to OUTPUT space when no RT is bound;
EffectComposer runs autoClear-off) → OutputPass re-encoded it into (8,26,45) navy on every empty
sky pixel; FIX = `scene.background` (per-target conversion) + atmosphere Chapman-obliquity factor
(zenith rays no longer glow like limb rays at 20–350 km; ATMOSPHERE.obliquityK). Night sky now
near-black (2,5.9,10.7). DEV add: `window.__composer`. 280 vitest · astro check 0 · wix build
green. Mechanics + debug traps (elementsFromPoint skips pointer-events:none · hidden tiles groups
kill the rAF tick → stale-frame measurements · stars re-show per frame): `mem:project/wip-2026-07-11-phase5.5-s5`.
**Phase 5.5 S6 SHIPPED (2026-07-11, browser-VERIFIED via Playwright MCP):** FPV planning
overlays — sun/moon **day-arcs** (`lib/ephemeris/dayArc.ts` pure solar-day sampling +
`scene/dayArcs.ts` camera-anchored at the sky-impostor distance so the discs sit ON their arcs;
alpha-blended NOT additive — additive vanishes against the day sky; past/future =
step(uNow01, aT01), no rebuild on scrub; renderOrder is per-OBJECT, never Group) + **26
asterisms** (baked d3-celestial, RA in DEGREES ÷15 at load, LineSegments child of the star
sphere) + the owner FPV batch: **left-side HUD** (`panels/FpvHud.tsx` + `camera.fpvHud` mirror —
focal-equiv via focalFromVerticalFov, bearings, off-frame ☀/☾ edge chips via
`lib/geo/offscreen.ts`) · **ALTITUDE/FOCAL ZOOM encoders** (photo FPV unlocked: ROTATE = look,
ALTITUDE = fpvLiftM vertical lift off the apex 0–400 m, FOCAL ZOOM = camera.fovRatePerS →
the wheel's fovTargetDeg) · **building opacity curve** (shared-material onBeforeCompile:
transparent ≤60 m → ghost 0.3 by 260 m; setGhostSolid altitude blend 40→180 m, depthWrite
re-engages >0.6) · moon brighter (SKY.moonBrightness 3.2/earthshine 0.12). Same-day follow-up:
**sky guides gated** — arcs/asterisms FPV-only, other modes get ☀/☾ direction chips, ONE
right-panel `☀☾` toggle (`camera.skyGuides` + `skyMarkers` mirror) enables/disables all of it.
304 vitest · astro check 0 · wix build green. Mechanics: `mem:project/wip-2026-07-11-phase5.5-s6`.
**Phase 5.5 S7 SHIPPED (2026-07-11, browser-VERIFIED via Playwright MCP + S5 night golden gate
PASS) — Phase 5.5 is COMPLETE (S1–S7).** Ground rework: (a) CARTO dark_nolabels drape crossfading
in below 7→5 km (ImageOverlayPlugin overlay.opacity is a LIVE uniform — crossfade = one eased
write, no re-composite; `uFtwDark` blends the Esri-specific colorimetry out of the grade; per-mode
shadow contrast; satellite = opt-in `camera.groundMode` + SAT chip); (b) Natural Earth boundaries
(one LineSegments, 9 km lift) + city labels (module-owned DOM pool, rank gate in log-altitude,
min-sep de-clutter) at 100–900 km (DoD "gone at LEO" beat the design's 2000 km top) + CARTO
dark_only_labels street names ≤5 km in dark mode (oblique big-text smear = accepted v1); (c)
building grow-on-zoom 2 km→600 m via per-tile inner-Group vertical scale about a LAZY min-bbox
ground anchor (`scene/growMatrix.ts` pure+tested; growMinK 0.004 — k=0 singular; ONE-shared-
material invariant intact; buildings now flat above 2 km in both modes); (d) Re:Earth Overture
trial NEGATIVE (tileset parses, every glb content tile 500s server-side) → `TILESETS.
overtureBuildings` ships OFF. SAME-DAY OWNER REWORK: street names went VECTOR — raster was
blurry/late/unscalable → `scene/streetNames.ts` (OpenFreeMap MVT, maxzoom 14, pbf@5 `PbfReader` +
@mapbox/vector-tile@3, 3×3 z14 ring around the focus, one DOM label per street name ROTATED along
its street, terrain-seated, reveal 2.5→2.1 km, type scales 9→19 px with zoom, STREETS tuning,
step 38, FPV-hidden); grow-on-zoom REMOVED (owner: unreliable — buildings full-height again,
growMatrix.ts deleted). New tuning groups DRAPE/LABELS (+BUILDINGS.grow*, TILESETS carto/
overture); bake script `scripts/build-ne-labels.mjs` → public/data/ne-{boundaries.bin,places.json};
step 37 `stepGeoLabels`. 337 vitest · astro check 0 · wix build green; shots phase55-49..56.
Mechanics + verify traps (welcome needs a REAL click — synthetic PointerEvents don't dismiss and
Explore eats flyRequests; golden-gate Chrome launch recipe): `mem:project/wip-2026-07-11-phase5.5-s7`.

**S7 owner-feedback batch SHIPPED (2026-07-11, browser-VERIFIED via Playwright MCP + S5 night
golden gate PASS — 356 vitest · astro check 0 · wix build green):** (1) street names v3 = GL
canvas-texture quads PINNED to the terrain in the street's tangent direction (v2 DOM @20 Hz
lagged/jumped structurally — deleted; world-metre type, hysteresis upright-flip, eased terrain
seat; TRAP: a stored basis vector aliased a module temp Vector3 → 1.1e9-scale matrices — entry
vectors must be fresh); (2) NEW shared `scene/vectorTiles.ts` (parse retains geometry, one fetch
feeds two layers) + `scene/vectorFeatures.ts` step 39 — roads as metre-width ribbons (class-tiered)
+ waterways + water/green fills on a lazy 6×6 terrain lattice, bridges lifted+bright, night-dimmed;
5 new vec* tokens; (3) ground grade: day/night/golden gates now read GEODETIC up (solar elevation,
not slope) + additive ambient (uFtwAmbDay/uFtwAmbNight) + non-albedo moon fill — black-pit ground
GONE day and night; DRAPE shadows softened 0.9→0.62; (4) low-alt haze: horizon anchor tinted
(whiteness 0.55), horizonGain 0.16, low-alt dim ramp — horizon budget < BLOOM.threshold enforced
by NEW `skyBudget.test.ts` guard; (5) tips system `styles/tips.css` (CSS-anchored ::after pills —
immune to the backdrop-filter fixed-position trap) + `ui/InfoDot.tsx`: 32 tips + 5 InfoDots across
all panels/nav. Mechanics + traps: `mem:project/wip-2026-07-11-s7-feedback-batch`.
**Feedback batch #2 SHIPPED (2026-07-12, browser-VERIFIED; 377 vitest · astro check 0 · wix build):**
river-tile flicker killed structurally (MVT buffer CLIPPED at parse — Sutherland–Hodgman rings +
Liang–Barsky lines; builds PERSIST past the ring w/ distance eviction; build only after TWO lattice
passes agree within 3 m — frustum-outside knots NaN-skip + mean-fill, the S2 in-frustum lesson) +
camera pose in the URL (`lib/geo/urlPose.ts` `#p=lat,lon,alt,heading,tilt`; step-23 replaceState
~1.6 s gated off welcome/Explore/FPV/flight; boot restores via arrivalPose; Welcome skips on hash —
share links + reload lands where you were). `mem:project/wip-2026-07-11-s7-feedback-batch` §batch-2.

**Next step: OWNER BATCH SHIPPED 2026-07-14 later (browser-VERIFIED; astro check 0/0 · vitest 513 (+7) · wix build): PER-BUILDING/PER-TREE terrain re-seat (the sunk/levitating fix — `_feature_id_0` vertex runs + tree instanceMatrix[13] lifted on the CPU by terrain@footprint − cell seat; edges co-mutated via exact-position CSR; nearest-cell-first budgeted sampling; TWO garbage-sample guards incl. an apply-time poisoned-pair collapse — browser-caught −134 m transient; planFeed auto-invalidate once per settled seat epoch; live deltas settle −17.0…+18.7 m over 12k features + 7.4k trees) + always-on copyable viewer coords (`camera.camGeo` mirror → FpvHud POSITION row, 6 dp Google-Earth paste shape, `formatLatLonPaste`) + ALL floating panels draggable (`ui/DragGrip.tsx`, `--drag-x/--drag-y` CSS-var transform compose, session-remembered, dbl-click reset) + FPV ALTITUDE inverted (+rate = ascend) + FPV mini-map (`MINIMAP.patchM` 200 tunable; vectorTiles now parses the `building` layer; `scene/minimapFeed.ts` step 40 reuses the shared MVT cache → `store/minimap.ts` → `panels/MiniMap.tsx` north-up canvas w/ heading wedge). NEXT: owner R2 hosting (credentials ready per owner) · dayArcs skyline fold · WS4-D subject shadow timeline · optional HLOD · Phase 6 marketplace (`mem:project/wip-2026-07-14-owner-batch-seating-ui`). PRIOR: PASS 3 MOAT + SLICE 5 SHIPPED 2026-07-14 (browser-VERIFIED; astro check 0/0 · vitest 506 (+33) · wix build): the LIGHT PLANNER — pure `lib/ephemeris/planner.ts` (rise/set w/ dip · golden windows DERIVED from tuning.GOLDEN via asin of smoothstep-band mid-sines · culminations · full/new moon · `skylineState` scan+bisect over alt(t)−profile(az(t))) + `lib/geo/horizonProfile.ts` (az-bin max-elevation, terrain march d²(1−k)/2R, per-bin honesty/coverage) + `lib/geo/occlusion.ts` (**NO-Raycaster silhouette sweeps** — building triangle edges subdivided by segment CLOSEST APPROACH; slice-3 trees as canopy spheres from the EXT_mesh_gpu_instancing TRS, sidestepping their raycast noop; OSM verts rejected in the bboxClipPrismEcef mask prism since fragment clipping doesn't stop CPU rays) + `scene/planFeed.ts` step 40 (time-sliced 3 bins+2 meshes/frame; anchor photo-apex>FPV-eye>focus; 3 km trust; store/plan mirrors) + PlanPanel (PLAN pill → BEHIND SKYLINE/CLEAR + CLEARS/HIDES + jump-to-time chips → timeStore.setTime). LIVE: sun clears the real Dnipro skyline +37 min after astronomical sunrise (02:29Z vs 01:52Z); crossing precision 0.42° @+90 s; park skyline canopy-driven (trees ARE occluders — Slice 5 DoD). BUG fixed live: zenith overflow (grazing canopy painted ALL bins >90° via the 1/cos az spread → clamp altTop≤89.9/azHalf≤180 + test). TRAPS: `cmd | head -N` SIGPIPE-kills background wix dev · `#p=` low-alt restore glide exits temp-FPV (grab first, then setTempPin+setTempFpv) · sampleProfile lerps bin CENTRES (march at (i+0.5)·binWidth). UNVERIFIED tails: photo-apex anchor in-browser · landmark-height validation · dayArcs skyline fold (seam: planFeed.profileSample()). NEXT: owner R2 hosting · dayArcs fold · WS4-D subject shadow timeline · optional HLOD · Phase 6 marketplace (`mem:project/wip-2026-07-14-pass3-obstruction-moat`). PRIOR: SLICE 3 TREES SHIPPED 2026-07-13 (browser-VERIFIED; astro check 0/0 · vitest 473 · wix build): ~24.7k deterministic trees (418 OSM points + tree_row sampling + seeded wood/park scatter, building/C6/bbox rejection, hash-seeded reproducible) baked as `EXT_mesh_gpu_instancing` nodes INSIDE the enriched cell glbs (~50 B/tree, 94 tiles · 34.05 MB total) — three 0.185 loads ONE InstancedMesh/cell (default extension, source-verified), inheriting streaming/LRU/per-cell re-seat; shared vecGreen flat-shaded night-dimmed shadow-casting material in enrichedBuildings.ts + TREES tuning group. TRAPS (source-verified): tile disposal never calls mesh.dispose() → instanceMatrix GL buffer leaks per LRU eviction (dispose-model now calls c.dispose(); LRU cycle verified clean) · InstancedMesh.raycast iterates every instance → raycast noop on tree meshes. Terrain decision RECORDED: keep CWT. Canopy rasters = README upgrade tier. NEXT: Slice 5 obstruction moat · owner R2 hosting · optional HLOD (`mem:project/wip-2026-07-13-dnipro-slice3-trees`). PRIOR: SLICE 0 BROWSER-VERIFIED + SLICE 1 REAL BAKE SHIPPED (2026-07-13; gates astro check 0 · vitest 442 · wix build; browser-VERIFIED in wix dev via Playwright): a reproducible Node DATA-DRIVEN baker `scripts/bake` (`npm run bake -- --city dnipro`) reconstructs real Dnipro buildings from OSM (footprints + inferred heights `levels×3m` + roof shapes flat/gable/pyramid + C6 military/critical-infra exclusion) → spatial-grid 3D-Tiles (per-cell glb, shared ENU frame, `_feature_id_0` per building) → masks & streams over Dnipro (3233 buildings/16 tiles/172k verts/4.83 MB, seated `group lift 101.3≈terrain 101.3` + masked + streaming, native-edge = seamless OSM extension). Owner picked the Node path over OSM2World/heavy-3dfier (Docker daemon down + public npm blocked here; both = documented upgrade tiers in `scripts/bake/README.md`). OWNER FEEDBACK 2026-07-13 (all browser-VERIFIED): bake EXPANDED to ~5.9×6.3 km / 46 tiles (both Dnipro banks) + FPV 500 mm max focal + arrow-key WALK + a BUILDINGS wireframe↔solid slider. OWNER #4 TERRAIN ELEVATION / PER-CELL RE-SEAT SHIPPED 2026-07-13 (browser-VERIFIED; astro check 0 · vitest 448 · wix build): each grid cell now offsets along its own geodetic up by (terrain@cell-centre − centre seat) — measured spread −20.6 m riverbank → +82.0 m hills over 102 m of real CWT relief, offsets match terrain within ~0.2 m; TRAP: TilesGroup.updateMatrixWorld skips children unless the GROUP matrix changed → per-cell writes call scene.updateMatrixWorld(true); baker pads region heights ±80 m (`mem:project/wip-2026-07-13-terrain-reseat`). SLICE 2 COMPLETE 2026-07-13 (browser-VERIFIED; astro check 0 · vitest 459 · wix build): (b) clip-hole — `bboxClipPrismEcef` 4-plane ECEF prism + clipIntersection/clipShadows on the shared OSM materials fixes the straddle-leak pixel-exactly (box core clean at 28 km; enriched instance carries no planes); (c) stylization reconciled — NEW `scene/buildingMaterial.ts` factory (R2 tone via `_feature_id_0`, F1 reveal, ghost, dormant R3) consumed by BOTH tilesets as SEPARATE instances (a shared one would clip the enriched set inside its own prism), enriched gains setNight, debugDistinctEdges=false; (e) FULL-CITY bake [35.00,48.42,35.10,48.50] grid 10 → 26,569 bldgs · 90 tiles · 1.17M verts · 32.8 MB, streams + LRU re-streams; (d) R2 tooling — pure-Node SigV4 `scripts/bake/upload-r2.mjs` + `lib/s3sign.mjs`, dry-run-verified; ACTUAL bucket/custom-domain/CORS = OWNER Cloudflare action (r2.dev has no CORS). TRAP: extracting module-level consts to a new module leaves the running dev server serving a stale HMR transform → runtime ReferenceError with a clean on-disk file — restart wix dev. KNOWN LIMIT: no HLOD → above ~20 km the bbox renders honestly EMPTY of buildings. NEXT — Slice 3 trees → owner R2 hosting → optional HLOD tier → Slice 5 feed the Pass-3 obstruction moat (`mem:project/wip-2026-07-13-dnipro-slice2`). PRIOR Slice-0 integration was CODE-COMPLETE (DEFAULT-OFF behind `PUBLIC_ENRICHED_TILES_URL`): masking OSM in-bbox (stop-traversal `calculateTileViewError` plugin) + a 3rd `TilesRenderer` (plain-URL + `GLTFExtensionsPlugin`) + R1 runtime clamp-to-CWT seating (CWT ellipsoidal vs GLO-30/EGM2008 orthometric, Dnipro undulation +20.42 m) — locally gated (astro check 0 · vitest 422 · wix build); NEXT = browser-verify the hand-baked sample (`node scripts/build-sample-dnipro-tiles.mjs` → `PUBLIC_ENRICHED_TILES_URL=/enriched-sample/dnipro/tileset.json` → `wix dev`) then the real OSM2World bake + R2 (`mem:project/wip-2026-07-13-dnipro-slice0-spike` + `DNIPRO_SLICE0_SPIKE.md`). ALSO 2026-07-13 — ILLUMINATION PASS code-complete + locally gated (astro check 0 · vitest 422 · wix build), BROWSER-UNVERIFIED: crisper shadows (DRAPE.shadowOpacity 0.62→0.80 is the key — the default dark-drape city view blends toward it) + richer sun/moon golden-hour GI (widened GOLDEN band + strengths + NEW keyBrighten/moonKeyStrength) + brighter dark-of-moon night. The cyberpunk WINDOW GRID I briefly added was REMOVED at owner request ("looks junky") — buildings carry NO night emissive; their identity = dark mass + lit edges + cast/received SHADOWS + golden/moon key. Owner's live ask = buildings casting NICE shadows on ground + each other (SHADOWS.normalBias 1.0→0.75 anchors them, radius→2). Illumination + shadows are now owner-VERIFIED ("working"): the "no shadows" bug was the frame GOVERNOR throttling the M3 Pro to tier `low` (which disables the shadow pass) — fixed by decoupling shadows from the governor (follow DEVICE tier) + flooring a strong device at `mid`; plus crisp shadows + sun/moon golden-hour GI (`mem:project/wip-2026-07-13-illumination-pass`). **NEXT INITIATIVE: the FULL Dnipro 3D enrichment implementation (Slices 1→5 of `DNIPRO_3D_ENRICHMENT_PLAN.md`) — the real bake (OSM2World / Overture+height-inference) → glb→3D-Tiles → self-host on R2 → mask & stream over Dnipro → trees → feed the Pass-3 obstruction moat. Slice-0 integration is code-complete + DEFAULT-OFF; handover rewritten in `NEXT_SESSION_PROMPT.md`.** Prior context: an offline BAKE of roof-shaped LOD2 buildings self-hosted on Cloudflare R2, masking Cesium OSM Buildings inside the Dnipro bbox (external research 2026-07-13 INCORPORATED → `.claude/claude-docs/DNIPRO_3D_ENRICHMENT_PLAN.md` + `mem:project/wip-2026-07-13-dnipro-enrichment-research`; reframes/retires R4 — bake-and-mask replaces buildings in-bbox, sidestepping the z-fight/cull blocker; extends D1/D13/C6/C1, all data $0). Recommended DEFAULTS (owner dismissed the fork Q): SLICE 0 de-risk spike FIRST (prove masking + R1 vertical-datum seating vs rendered Cesium World Terrain + R2/CORS + stylization reuse), then the full bake; hero splats deferred; the Pass 1/2 browser-verify + GTAO fold into the next browser session. FOLDED-IN prior headline: RENDERING PASS 2 (Dnipro identity) R2+R3 CODE-COMPLETE (2026-07-13) — per-building tonal
variation (R2) + restrained night window emissive (R3), both on the ONE shared building material's chained
onBeforeCompile (invariant intact, no new pass/tier knob — free fragment math degrading with the existing
bloom tiering); astro check 0/0 · vitest 416 (+8 buildingNight) · wix build; runtime shader-COMPILE + look
BROWSER-UNVERIFIED (owner: local gates only this pass — the whole rendering pass's browser loop is deferred).
R2's metadata gate RESOLVED: the b3dm batch id survives as `geometry.attributes._batchid`/`_feature_id_0`
(three GLTFLoader lowercases it, 3d-tiles-renderer never strips) AND the shader sums both + a per-tile seed
so it's correct either way + degrades to per-tile tone if absent. R4 (S3DB roof reconstruction) = DESIGN-AND-
DEFER (bespoke L-effort + Overpass bake + z-fight-vs-LOD1-prism blocker). Pass 1 (keystone + tiering +
fluidity + GTAO-wired-off) is ALSO code-complete + browser-UNVERIFIED. → browser-verify BOTH passes in
`wix dev` (Pass 2 FIRST: confirm the building shader LINKS over Dnipro — the #1 risk local gates can't catch),
tune/enable GTAO, THEN Pass 3 (obstruction/astro moat) / decide R4 build. Phase 6 marketplace DEFERRED behind
the rendering passes. See NEXT_SESSION_PROMPT.md; `mem:project/wip-2026-07-12-rendering-pass2-dnipro-identity`
(this session) + `wip-2026-07-12-rendering-pass1-tiling-fluidity` + `wip-2026-07-12-rendering-quality-pass`.** (2026-07-12: root README
rewritten for the internal Wix contest — canonical framing = Wix-headless stress test first, hobby
3D layer second, AI-agent-built stated openly; 5 shots committed in `docs/media/`; live URL omitted
until the next release — `mem:project/wip-2026-07-12-readme-rewrite`.) The pre-S7 refactor tier was COMPLETE before S7. B19 DONE 2026-07-11 (`StylizedTiles.update()` split into 36 named step-closures — provably behavior-identical; astro check 0 · 325 vitest · wix build · browser Flow-0 CLEAN · night-shadow golden gate PASS; `mem:project/wip-2026-07-11-b19-split`). Also this session: the high-altitude pin-jump-shift BUGFIX (`mem:bugs/pin-arrival-reframe`). The pre-S7 architecture-review
SAFE tier is DONE (2026-07-11, two sessions): session 1 = B1–B5/B7/B14/B18 (DECISIONS.md compacted 709→334 +
`DECISIONS_ARCHIVE.md`, conventions, dead code, format dedup); session 2 = the dedup follow-up B6/B8/B9/B10/
B11/B12/B13/B15/B26 + B14 index (shared geo/math → `lib/geo/{terrain,screen,heading}.ts`; param layer →
`lib/decode/params.ts` killing the lib→store edge; `lib/geo/coerce.ts` + `lib/pins/fields.ts CameraPoseOptics`;
`lib/api/http.ts`; typed `src/global.d.ts` seams; `GlobeControlsInternal`; `ORCH` tuning group; throttled
catch). Verified 323 vitest · astro check 0 · a 3-reviewer adversarial workflow → 0 findings. Remaining before
S7: **B19** — split `StylizedTiles.update()` into named step-fns (browser-verified; scaffolding now in place).
See `ARCHITECTURE_REVIEW.md` + `NEXT_SESSION_PROMPT.md` + `mem:project/wip-2026-07-11-pre-s7-refactor-s2`.
S7 landed 2026-07-11 (block above) — **Phase 6 marketplace is next. S1–S7 not yet released to the live URL.**
Live site: `frame-the-a173087b-yevhens.wix-site-host.com` (siteId `f597bcf5-bd38-4941-9dfe-e16d775743a3`,
appId `566ce8ce-d18c-4950-88ac-5d2c53311cd6`; see `mem:project/wix-site`).

## Source layout (globe+frustum+upload built; ephemeris/wix/backend still to come)
- `src/components/globe/` — client:only three.js scene. `tuning.ts` (ALL tunables, documented) ·
  `scene/*` attach-modules (baseEarth/graticule/atmosphere/stars/buildings/imageryGround + glsl) ·
  `StylizedTiles.ts` orchestrator · `PhotoFrustum.ts` + `flight.ts` (Phase 3) · GlobeCanvas. Sky,
  Pins TBD. Design imports NEVER touch. Convention: `.claude/conventions/globe-tuning.md`.
- `src/components/panels|ui/` — UploadFlow + PhotoDetailPanel + ui/Slider BUILT; time scrubber, AI TBD. Design imports allowed.
- `src/lib/{decode,geo,format,ephemeris,theme,wix}/` — decode REAL (extract/exif/worker/workerClient/convert + sensors; libraw-wasm@1.0.5 pinned); geo REAL (projection incl. ecefToGeodetic + rayEllipsoidIntersect, frustum, geohash); readout formatters; GL token bridge; ephemeris + SDK clients TBD.
- `src/store/` — zustand reactive EXIF params + placement machine (spine of real-time re-projection); `upload.ts` BUILT. `src/backend/` — thin HTTP endpoints (TBD).
- (no `public/wasm/` — Vite emits `libraw-*.wasm` as a hashed asset; libheif wasm is inlined). `public/textures/` — earth-color (July topo+bathy) + earth-night
  (VIIRS) + earth-topology (elevation) + earth-landmask + earth-normal. `test/` — vitest (FOV/geohash/projection).

## Key invariants (violations = bugs)
- Globe is `client:only` — **never SSR WebGL**. Decode runs in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- Stylize tiles via `load-model` material swap, **not** `BatchedTilesPlugin`. On ground-imagery tiles,
  **chain** onBeforeCompile (TilesFadePlugin already wrapped it). Astro **5** only (not 6).
- Globe/GL colour flows through `lib/theme/tokens.ts` (D14). Colour textures = sRGB; data textures =
  `NoColorSpace`. Fence design imports to panels/ui/styles.
- **C6 privacy:** never expose exact GPS on a public pin (reduced precision: exact/1km/city).
- No split payments → owner-mediated payout. Claude vision → JPEG only, never RAW. Wix Data → geohash, no geo query.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) + §4 (ADR D1–D15) are **binding**. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth (distilled from `DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:project/wix-site` — live URL + siteId/appId
- `mem:architecture/system-overview` — the engine + pipelines
- `mem:patterns/globe-rendering` — how the organic LEO globe is built (bands, atmosphere, ground grade, traps)
- `mem:patterns/sky-bodies-terrain` — ephemeris sun/moon, scene time, bloom, shadows, REAL terrain (current ground pipeline)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:memory_maintenance` — how to maintain this graph
