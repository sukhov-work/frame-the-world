# Phase 5.5 — Pre-marketplace UX / quality batch (design, 2026-07-11)

**What this is:** the owner's 10 action items (behavior, UX, visual, core, bug-fix) that must land
BEFORE Phase 6 (marketplace), investigated against the codebase + external sources and ordered into
7 sessions (S1–S7). Canonical design doc for the batch; `IMPLEMENTATION_PLAN.md §Phase 5.5` is the
checklist twin, `NEXT_SESSION_PROMPT.md` carries the next session's brief. Evidence labels:
[CODE file:line] = read this session · [DOCS url] = cited external doc · [OPEN] = unresolved.
Research provenance: 4 parallel tracks (codebase map · geocoding · basemaps/buildings · astronomy),
2026-07-11.

## Build order (S1 first; each session = one verified increment)

| Session | Items | Theme | Why this order |
|---|---|---|---|
| **S1** | 1 + 9 | Location finder + day-step buttons | Self-contained, high value, no deps. **← implemented 2026-07-11** |
| **S2** | 3 + 13 + 14 | Flight fix + camera floor + arrival pose + FPV mode · compass + 2D/3D toggle · encoder-style rotate/zoom | Bug-fix core; every later fly-to inherits it; gates item 4. 13/14 live in the same store/panel/orchestrator cluster — split into S2b if heavy |
| **S3** | 5 + 10 + 12 | Pin lifecycle (edit/delete) + naming + placement-flow UX · upload CTA | One schema/endpoint batch (authorName, PATCH/DELETE); gates item 6 hues; 12 is a chrome rider |
| **S4** | 6 + 11 | Pin visual rework (stem/head/twinkle/hue/hover) + Explore ambient pin journey | Needs S3's author identity for hues; 11 needs S2's flight work + pins present |
| **S5** | 7 + 8 + 15 | Night-sky physics (moonlight, stars, Milky Way, hi-res city lights) + darker night sky | Independent; tuning-heavy, one subsystem; 15 folds into the same pass |
| **S6** | 4 | FPV sun/moon day-arcs + asterisms | Needs S2's FPV mode |
| **S7** | 2 | Ground rework: dark uniform mode · labels/boundaries · building grow + Ukraine buildings | Biggest + riskiest; split into 3 sub-batches (a/b/c below); independent of the rest |

---

## Item 1 — Location finder (S1) ✅ design settled

**Ask:** simplest possible FREE search — city / street / sight / zip — camera flies there.
**Current state:** no fly-to-lat/lon channel exists; the only flight primitive is
`flight.start({position, lookAt})` in ECEF metres [CODE flight.ts:17-30]; callers convert via
`geodeticToEcef` / `getCartographicToPosition`. `PINS.flyAltM 2600 / flyBackM 2400` are orphaned
tunables with no consumer [CODE tuning.ts:638-639].
**Decision — provider:** **Photon (photon.komoot.io)** for search-as-you-type: keyless, CORS `*`
(live-verified), autocomplete is its designed use; MUST pass camera lat/lon bias (unbiased
"eiffel tower" → Alberta, Canada — verified) and debounce ≥300 ms; langs only en/de/fr
[DOCS github.com/komoot/photon]. **Nominatim** only on explicit Enter (better global ranking, zips) —
its policy FORBIDS autocomplete, 1 req/s, results must be cached
[DOCS operations.osmfoundation.org/policies/nominatim/]. Both ODbL → "© OpenStreetMap contributors"
near results. Keyed fallback if Photon degrades: LocationIQ (5k/day, referrer-locked token). Code the
provider behind a tiny adapter so endpoints can swap without redesign.
**Mechanics:** new `panels/LocationFinder.tsx` (top-left, board idiom) + `store/camera.ts` gains a
`flyRequest {latDeg, lonDeg, altM} | null` seam (same pattern as targetTiltDeg); orchestrator consumes
it → geodetic→ECEF → `flight.start` with an arrival pose looking down at ~45–60°. Arrival altitude from
Photon `extent` bbox (span → alt), floor ≥ ~3 km: **flight is terrain-blind until S2** [CODE
flight.ts:124 — ellipsoid-only altitude blend], so keep arrivals generous; GlobeControls
`cameraRadius 8` self-corrects an underground END pose once tiles load, mid-path dips are S2's job.
Adopt/replace the orphaned PINS.fly* tunables into a new `SEARCH` tuning group.

## Item 9 — Day prev/next buttons (S1 rider)

`TimeScrubber` header already has the date input; buttons = `setTime(sceneTimeMs() ± 86_400_000)` +
`setAnchorMs` — the exact `onDateChange` pattern [CODE TimeScrubber.tsx:135-152, store/time.ts:71-77].
20-line change + styles.

## Item 3 — Flight fix · camera floor · arrival pose · FPV mode (S2)

**Bug root causes (mapped, not yet browser-reproduced):**
- *Underground fly-in:* `flight.ts` blends geocentric altitude against the bare ellipsoid — no
  terrain sampling, no path floor [CODE flight.ts:53-56,124]. Fix: path-altitude floor =
  max(ellipsoid blend, start/end alt envelope) + optional `terrainHeightAt` sample at arrival
  (tolerate coarse-LOD garbage — clamp only when it raises the path); re-aim on arrival.
- *Rotation during fly-in:* orientation is an independent `q0→q1` slerp decoupled from the
  great-circle path [CODE flight.ts:126] — long heading changes sweep the view. Fix: derive
  intermediate orientation from the path tangent + radial up (banked-turn style), blending into the
  final pose in the last ~25%.
**Camera floor:** the felt "~100 m limit" is `CONTROLS.zoomMinAltM 120` (slider log-map clamp)
[CODE tuning.ts:253, camera.ts:82-91]; library floors are `minDistance 10` + `cameraRadius 8`
[CODE EnvironmentControls.js:145,131]. Lift: zoomMinAltM → ~2 m; verify the felt wheel floor in
browser [OPEN — owner reports a hard 100 m stop; code says wheel should reach ~10–18 m].
**Default pin arrival:** re-tune to ~200 m ground height, ~80° tilt (FLIGHT.backFactor/liftFactor +
explicit alt/tilt targets instead of pure planeDist multiples) — one arrival-pose function shared by
pin flights and search flights.
**FPV / photographer mode (opt-in + out, per pin):** camera placed EXACTLY at the frustum apex with
the photo's heading/pitch/roll; controls become look-around: GlobeControls disabled while in FPV;
drag = heading/pitch offset around the apex, wheel = camera FOV zoom (not dolly); Escape / toggle
button exits back to the default behind-the-cone view. Entry/exit animated with the same flight
easing. Store: `upload.viewMode: 'orbit' | 'fpv'` + FPV pose derived from the frustum params
(apex + basis already computed in `lib/geo/frustum.ts` [CODE frustum.ts]).

## Item 4 — FPV sun/moon day-arcs + asterisms (S6, needs S2)

**Day arcs:** sample `horizontal(body, utcMs, lat, lon)` [CODE lib/ephemeris/bodies.ts] every 10 min
across the pin's local civil day → az/alt polyline on a camera-anchored sky dome; hour ticks;
rise/set endpoints emphasized; past-vs-future styling split at scene time; optional solstice envelope
band later (suncalc.org convention) [DOCS suncalc.org]. PhotoPills color grammar: sun warm/yellow,
moon cool/blue [DOCS photopills.com/user-guide]. Redraw on TimeScrubber date change (sampling is
trivial; 150 pts/body).
**Asterisms:** d3-celestial `asterisms.json` — 48 named asterisms as RA/Dec-degree MultiLineString
polylines (RA mapped ±180°), BSD-3, 17 KB [DOCS raw.githubusercontent.com/ofrohn/d3-celestial/master/
data/asterisms.json]; filter by `p` priority to ~20 famous ones; convert vertices to unit vectors →
LineSegments child of the star sphere (inherits −GAST + camera-follow [CODE scene/stars.ts:205]).
No HIP/HR mapping needed. Subtle: token-colored lines ~0.15 alpha, gated by the same night fade.

## Item 5 — Pin edit + delete (S3, Wix-load-bearing)

No PATCH/DELETE exists; api/photos.ts is GET+POST only [CODE api/photos.ts:44-119]. Add to the same
file: `PATCH /api/photos` {photoId, patch} and `DELETE /api/photos?id=` — elevated, owner-gated
(`getCurrentMember().id === row.ownerMemberId`), thin (C1). PATCH re-derives the PublicPins row via
the existing server-only `publicPinRecord` (C6 stays structural — location edits re-reduce to cell
center); isPublic toggle creates/removes the PublicPins row; DELETE removes Photos + PublicPins
(+ media files best-effort). Client: edit = `openSavedPin` → the existing tweak panel + a re-place
action (placement machine already supports `placing` [CODE store/upload.ts:288-305]) → SAVE becomes
UPDATE when `viewingPinId` is set (today the SAVE section is hidden — replace with UPDATE/DELETE
actions [CODE PhotoDetailPanel.tsx:191-248]); MyPins rows gain delete. After either: `pins.refresh()`.
DoD: wix-cloud-verified update incl. location + delete; quota count reflects deletion (#10→#9 frees a
slot).

## Item 10 — Author name · custom pin name · placement-flow completion (S3)

**Author name:** PublicPins has NO member-identity field [CODE lib/wix/pinRecords.ts:187-214].
Add `authorName` (display string, denormalized at save/update from nickname → email user-part →
"Member" — the existing `memberLabel()` logic [CODE store/member.ts:69-74]); provision-script field +
back-fill of existing pins (key on photoRef — the dataItems[0] back-fill bug is on record). C6 note:
a display name is not location data; owner explicitly wants it. Optional later: per-member alias.
**Custom pin name:** `title` already exists on both records [CODE pinRecords.ts:92,191] — add a name
input to the save section (default = file name) + show on pin details.
**Placement-flow completion (all client):** (a) while `placing`, drop a live accent marker at the
clicked point (today only a crosshair cursor + hint pill), (b) staged progress in the panel
(placed ✓ → tuned → saved ✓), (c) on save success: auto-close the panel after a short "PINNED ✓"
beat (today it stays open forever [CODE PhotoDetailPanel.tsx:232-235]), fly out to ~3–5 km, and
pulse-highlight the new pin (pins store already refreshes post-save [CODE store/save.ts:133-137]).

## Item 6 — Pin style rework (S4, needs S3's author identity)

Current: single InstancedMesh, shared accent MeshBasicMaterial, no hover, no per-pin color
[CODE Pins.ts:37-44]. Rework:
- **Geometry:** two instanced draws — thin stems (cylinder, gradient fade to base via vertex alpha)
  + floating heads slightly above; heads = custom ShaderMaterial: semi-transparent core, fine bright
  rim (fresnel), slow shimmer (per-instance phase from hash), cross-flare sprite only at twinkle
  peaks (calm; no aggressive pulsing).
- **Stagger:** deterministic per-pin stem height = base + hash(id) spread; neighbor-aware de-leveling
  within a gh6 cell so adjacent pins never sit at one height.
- **Per-user hue:** `instanceColor` from hash(authorName/authorId) into a restrained cool family —
  teal-weighted, ice blue, mint, lavender, rare warm — palette lives in tokens (D14: tokens name
  colors; tuning names tokens). Legend chip on the save UI + pin swatch note.
- **Hover:** throttled pointermove raycast (picking pipeline exists for click [CODE
  StylizedTiles.ts:220-245]); hovered pin scales up + glows + small HTML card (title, authorName,
  date) — previewUrl card is the existing carried follow-up.
Constraint: keep `boundingSphere = null` discipline on every instance change [CODE Pins.ts:83-87].

## Item 7 — Milky Way / stars / physical moonlight (S5)

- **Stars/Milky Way brighter (stylish, astronomically correct):** tuning bumps only — STARS.brightMin
  0.55→~0.65, alpha 0.8→~0.9; MILKYWAY alpha 0.25→~0.35, sizeBase up [CODE tuning.ts:428-490];
  eyeball against the "almost there" current look.
- **Moonlight physical:** drive the existing moon DirectionalLight [CODE scene/sky.ts:162-167] with
  Krisciunas & Schaefer 1991: `I(α) ∝ 10^(−0.4(0.026·α + 4e-9·α⁴))`, α = phase angle from
  astronomy-engine `Illumination()` — quarter moon ≈ 9% of full (NOT 50%); opposition surge near
  full [DOCS besjournals…14299 restating K&S]. Calibrate I_full ≈ current night key feel; honest
  physics: moon:sun ≈ 1:400,000 — "physically accurate" = correct RELATIVE phase scaling + night
  exposure boost, never absolute lux.
- **Moon shadows when full:** reuse the ONE shadow rig — when sun is below `minSunElevSin` and moon
  is up with illumination ≥ ~0.85, drive the rig from the moon direction at K&S-scaled opacity
  (SHADOWS gate currently sun-only [CODE StylizedTiles.ts:523-538]). No second rig.
- Also brighter moon disc at night: SKY.moonBrightness 1.8 → tune up with the horizon-fade intact.

## Item 8 — Hi-res night city lights (S5)

Current: 3600×1800 sRGB JPEG sampled as uNight [CODE scene/baseEarth.ts:30-47; sips-verified].
Upgrade: NASA Black Marble 2016 **grayscale** 13500×6750 (2.9 MB JPEG, public-domain-class, URL
HEAD-verified: eoimages.gsfc.nasa.gov/images/imagerecords/144000/144897/BlackMarble_2016_3km_gray.jpg)
→ ship an **8192×4096** downscale as default (mobile MAX_TEXTURE_SIZE floor is 8192), optionally the
13.5k when `MAX_TEXTURE_SIZE ≥ 16384`. Grayscale = single-channel: decode to a RedFormat DataTexture
(~34 MB GPU vs ~134 MB RGBA) — shader change `li = texture2D(uNight, vUv).r` (drop the dot-product
luma [CODE baseEarth.ts:133-134]). Credit "NASA Earth Observatory (Suomi NPP VIIRS)". Memory budget
flagged — mobile pass still pending globally.

## Item 2 — Ground rework (S7: a=dark mode · b=labels · c=buildings)

**(a) Dark uniform "vaporwave" ground <7 km, textures opt-in:**
- Swap surface: imagery URL is defined ONCE [CODE tuning.ts:276-277]; overlays array takes another
  `XYZTilesOverlay` [CODE imageryGround.ts:105-115]. Source decision: **CARTO `dark_nolabels`**
  raster (live-verified served keyless; label-free variant is exactly what terrain-draping wants) —
  BUT license per LICENSE.md is enterprise/grants-only while tiles remain the keyless ecosystem
  default [DOCS github.com/CartoDB/basemap-styles LICENSE.md] → Esri-class POC risk, **ACCEPTED by
  owner 2026-07-11** — CARTO dark_nolabels is the locked S7a source (© OSM © CARTO attribution);
  fallbacks stay documented: Stadia alidade_smooth_dark (free non-commercial, domain auth, labels
  baked) or MapTiler raster (100k req/mo, logo).
- Mode machine: below ~7 km (tunable) the dark drape owns the ground with UNIFORM lighting (bypass
  the Esri-tuned grade — water detection/desat/hiAlt harmonizer are Esri-colorimetry-specific
  [CODE imageryGround.ts grade + tuning.GROUND]); crossfade band dark↔Esri at 5–7 km (new GATES
  entries, same screen-door idiom); above stays the current geo view. Satellite texture becomes
  opt-in (UI toggle; GROUND mode in a store).
- Terrain elevations + buildings + shadows unchanged (drape rides the same quantized-mesh tiles).
- Sharper shadows: mapSize is already 4096²/0.78 m-per-texel; the honest ceiling is CONTRAST on the
  dark grade (twice-learned lesson) — the dark uniform mode can carry a brighter ground albedo /
  dedicated shadow opacity so "sharper with nice blur" finally reads; radius + groundOpacity knobs
  exposed per mode.
- Street outlines/names "distinct ~5 km": outlines come baked in the dark raster by z14–16; names —
  see (b).
**(b) City/country labels 100–2000 km (tunable) + street names:**
- Natural Earth (public domain): `ne_50m_admin_0_boundary_lines_land` (~940 KB) as softly glowing
  polylines + `ne_50m_populated_places_simple` (~1 MB, scalerank-ranked) as screen-space labels
  culled by altitude; organic type from the design system; all thresholds in a LABELS tuning group.
  Upgrade path: 10m places (6.2 MB, ~7300 cities) lazy below ~300 km [DOCS naturalearthdata.com].
- Street NAMES at ~5 km: v1 = CARTO `dark_only_labels` as a second draped overlay (near-nadir OK,
  oblique text distorts); v2 (if ugly) = MVT label pipeline from OpenFreeMap PBF (keyless,
  live-verified) — names → billboards, ~1–2 wk honest effort. Start v1. [OPEN — quality call after v1]
**(c) Building grow-on-zoom + Ukraine coverage:**
- Grow effect: buildings load early but extrude from the ground as the user descends 2 km → 600 m
  (and reverse). Constraint: ONE shared styleMat can't animate per-tile [CODE buildings.ts:43-56];
  needs per-tile material clones or (better) a per-tile Object3D scale about the tile's local-up
  ground anchor — b3dm tile-origin anchor placement [OPEN — inspect e.scene at runtime]. Tie scale
  to camera altitude (tunable band), not load time, so it's deterministic.
- Ukraine buildings: **Mapbox rejected** — custom renderers allowed but per-request billed, caching/
  export forbidden (§1.9), heights mostly OSM levels×3 m anyway [DOCS Mapbox Product Terms 2026-06-17
  §1.6/§1.9/§2.8.3/§3.56]. **Trial instead: Re:Earth Buildings** — hosted Overture (OSM + Microsoft
  ML + Google) 3D Tiles 1.1, `https://buildings.reearth.land/tileset.json` (endpoint 200-verified),
  ODbL, MIT code, no SLA → feature-flagged alternate buildings source; needs MeshoptDecoder;
  UNVERIFIED in-renderer until trialed. Fallback: keep Cesium OSM Buildings (coverage = OSM);
  last resort: self-host an Overture Ukraine extract (~days, bounded).

## Items 11–15 — owner additions (2026-07-11)

### Item 11 — "Explore" ambient pin journey (S4)
The Explore nav button becomes a meditative auto-cruise: camera settles to ~900 km altitude,
~50° tilt, and glides slowly from public pin to public pin — no goal, fluid motion. Design:
order the loaded pins nearest-neighbour (avoid zigzag); each leg = slow constant-angular-velocity
great-circle glide (think DRIFT pacing × a few, NOT the 2.2 s flight easing — legs of ~20–40 s),
tilt/altitude held; any pointer/wheel interaction exits (the noteInteract pattern) and NEVER
fights the user. Fewer than 2 pins in view → graceful fallback to the existing idle drift at the
Explore pose. New `EXPLORE` tuning group (altM 900_000, tiltDeg 50, angular speed, dwellMs at each
pin). Reuses S2's shared arrival-pose/flight machinery; store seam `camera.exploreActive` or an
orchestrator mode flag. Respect reduced-motion (skip the mode or cut speed further).

### Item 12 — more salient upload CTA (S3, chrome rider)
The nav "Upload" link is easy to miss. Keep the instrument restraint (accent = the only glow, D14):
accent-outlined chip treatment for the Upload nav item + a one-time subtle attention cue on first
load (e.g. single slow glow ease-in, no pulsing loops), possibly a compact "+ ADD PHOTO" pill when
the globe is empty of the member's own pins. Design-import fence applies (panels/ui/styles only).

### Item 13 — compass + 2D/3D quick toggle (S2, rider)
Small compass rose docked by the camera sliders (CameraTiltPanel cluster): needle driven by the
existing `headingDeg` live mirror [CODE store/camera.ts]; **click → FLUID rotation to north**
(owner-specified 2026-07-11): `setTargetHeading(0)` rides the existing heading glide — a rigid
rotation about the view-focus up with exponential ease (CONTROLS.headingEaseTauMs), shortest arc,
tilt preserved exactly; never a snap. Beside it a 2D/3D toggle: 2D = `setTargetTilt(0)`
(nadir), 3D = `setTargetTilt(55)` — both ride the existing tilt glide; label states follow the
live mirror (2D when tilt < ~10°). Pure UI + existing seams; new tunable CONTROLS.toggle3dTiltDeg 55.

### Item 14 — encoder-style rotate/zoom controls (S2)
Rework ROTATE and ZOOM sliders from absolute-position to **spring-centred rate controls** (virtual
encoder): knob rests centre; deflection = velocity in that direction (expo response curve for fine
control near centre); release → knob springs back and motion eases out. Store seam changes from
absolute targets to rates: `headingRateDegPerS` / `zoomRatePerS` (null when released) applied
per-frame by the orchestrator through the SAME code paths as today's glides (rigid rotation about
the focus up; log-space dolly) — heading wraps freely (infinite dial), zoom clamps hard at
CONTROLS.zoomMinAltM/zoomMaxAltM. Numeric readouts keep showing the live mirrors (degrees still
encoded correctly). TILT slider stays absolute (unchanged). New tunables: max rates + expo gamma +
spring-back τ. The absolute `targetHeadingDeg`/`targetZoomAltM` seams STAY (compass, 2D/3D, FPV,
and tests use them) — the panel just stops being their main producer.

### Item 15 — slightly darker night sky (S5, rider)
Fold into the S5 night pass: lower the night floors a touch (EARTH.uNightFloor 0.22 /
GROUND 0.38 → tune down [CODE tuning.ts]) and/or the atmosphere's night output — AND finally
identify the carried "night-sky navy floor" mystery (the sky above the horizon at night reads
navy rather than near-black; suspect list: atmosphere dome night term, bloom lift, skyK blend
floor). Fixing that root cause IS most of this item. Eyeball against S5's brighter stars/Milky
Way — the point of a darker sky is more contrast for them.

## Cross-cutting decisions (append-only)

- 2026-07-11 · Build order S1–S7 as tabled above — bug-fix core early, schema batch before pin
  visuals, ground rework last. Evidence: dependency seams in the per-item notes.
- 2026-07-11 · Geocoding = Photon autocomplete + Nominatim-on-Enter behind an adapter; no keys, OSM
  attribution. Evidence: policy pages + live CORS probes.
- 2026-07-11 · Night lights = Black Marble 2016 gray 8k single-channel default. Moonlight = K&S 1991
  phase curve on the existing rig; moon shadows via rig-source switch, no second shadow map.
- 2026-07-11 · Asterisms = d3-celestial asterisms.json (BSD-3, coordinate polylines, no ID mapping).
- 2026-07-11 · Ukraine buildings: Mapbox ruled out (ToS economics); Re:Earth Overture endpoint is the
  trial candidate. [OPEN: in-renderer trial]
- 2026-07-11 · Dark ground source = CARTO dark_nolabels pending owner license-risk acceptance
  (Esri-class POC risk); Stadia/MapTiler are one-line fallbacks. [OPEN: owner call]
- 2026-07-11 (later) · **CARTO dark_nolabels APPROVED by owner** ("absolutely ok") — S7a source
  locked; keep © OSM © CARTO attribution; Stadia/MapTiler remain documented fallbacks.
- 2026-07-11 (later) · Owner added items 11–15 (Explore pin journey · salient upload CTA ·
  compass + 2D/3D toggle · encoder-style rotate/zoom · darker night sky) — folded into S2/S3/S4/S5
  as sectioned above; no new sessions, S2 may split into S2b if the control rework runs long.

## Session-checklist twin

See `IMPLEMENTATION_PLAN.md §Phase 5.5`. Verification discipline per session: `npm test` +
`npx astro check` + `wix build` green; browser claims verified via wix dev + Playwright MCP,
screenshots → `verify-shots/phase55-*`; Wix-cloud claims (S3) verified in wix dev with a real member
cookie. Records: DECISIONS.md line + memory update per session (`mem:decisions/session_workflow`).
