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
**Next step: Phase 5.5 S5 — night-sky physics (K&S moonlight · moon shadows · Black Marble 8k
gray · darker sky + navy-floor root cause)** (see `NEXT_SESSION_PROMPT.md`); then S6–S7;
Phase 6 marketplace after. S1–S4 not yet released to the live URL.
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
