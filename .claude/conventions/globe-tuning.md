# Convention — Globe Tuning & Scene Modules

The globe (`src/components/globe/`) is the product's signature scene and it accretes visual detail
every phase. This contract keeps it tunable and stops `StylizedTiles.ts` from re-bloating.
Established 2026-07-10 with the tuning refactor; the layout below is the verified state.

## The two-file rule
- **Structure** (geometry, shader plumbing, event wiring, lifecycle) lives in a scene module.
- **Numbers** (grades, scale heights, altitude gates, motion timing, endpoints, asset ids) live in
  **`src/components/globe/tuning.ts`** — one exported group per scene concern (`EARTH`, `ATMOSPHERE`,
  `STARS`, `GATES`, `DRIFT`, `CONTROLS`, `TILESETS`, …).
- **No magic numbers in scene code.** If a reviewer could ask "why 0.45?", the value belongs in
  `tuning.ts` with a doc line. Structural constants (Rec.709 luma weights, bayer matrices, pole
  guards, `0.5`-style half-lambert algebra) stay inline — they are math, not taste.

## tuning.ts rules
- **Pure data.** No `three` import, no side effects. Vectors are `readonly [x, y, z]` tuples;
  THREE objects are constructed at the use site.
- **No colours.** Colour flows ONLY through the GL token bridge `lib/theme/tokens.ts` (ADR D14).
  A tuning entry may *name* which token a module uses, never define a colour literal.
- **Every entry documented**: what it does, unit (metres unless stated), and provenance — mark the
  browser-VERIFIED look's values so a retune knows what baseline it departs from.
- Ellipsoid constants come from `lib/geo/projection.ts` (re-exported by tuning.ts). Never redeclare
  `WGS84_*` — the 2026-07-10 refactor removed a drifted duplicate.
- **Sanctioned cross-layer import:** `lib/` and `store/` MAY import tunables from `components/globe/tuning.ts`
  (it is pure data + only re-exports `lib/geo` constants — no WebGL). This one edge is allowed so "must match"
  duplication dies; it is NOT a general licence for `lib/` to depend on `components/`.
- Cross-cutting values live here precisely so "must match" comments die: e.g. `SUN.direction` feeds
  the earth shader, the ground grade AND GlobeCanvas's DirectionalLight from one constant.

## GLSL tunables
Two mechanisms — pick by whether the value animates:
- **Runtime-animated / DEV-tweakable** → a uniform, default seeded from tuning
  (`uNightFloor: { value: EARTH.nightFloor }`). Exposed on `window.__globe` in DEV for live tuning.
- **Baked constants** (ramps, gains that never animate) → injected into the shader template via
  **`glf()`** from `scene/glsl.ts` (`smoothstep(${glf(EARTH.coastBand[0])}, …)`). `glf` formats a JS
  number as a GLSL float literal (`2` → `"2.0"` — GLSL ES rejects int-typed floats). Editing one
  re-instantiates the material on next page load; that's the intended tune loop.

## Scene-module idiom
One concern per file under `src/components/globe/scene/`:
```
attachX(scene, opts) → { <objects/uniforms the orchestrator gates>, update?(ctx), dispose() }
```
- The module owns its full lifecycle: creates its objects, adds them to the scene, and `dispose()`
  removes + frees everything it made (shared materials disposed exactly once, per-tile geometry on
  `dispose-model`).
- `update()` takes plain values (`alt`, `elapsedS`, …) computed ONCE per frame by the orchestrator
  (`StylizedTiles.ts`) — modules never re-derive altitude (geodetic `getPositionElevation` only;
  spherical `length()-a` is ~21 km off at mid-latitudes).
- The orchestrator owns: camera pose, GlobeControls, idle drift, per-frame gate evaluation, the
  try/catch around the frame, and `__globe` DEV introspection. New scene features (frustum, sky,
  pins) follow the same attach-module shape.
  **NOTE (updated 2026-08-18, audit-2 A6 — counts keep re-staling, so this note now carries
  NONE):** `StylizedTiles.ts` is the ONE sanctioned orchestrator, organized as named
  step-closures in a load-bearing ORDER (producer→consumer bands — the in-file ORDER header is
  the contract). Do not cite step/line counts here or in the file header; they drift within
  days. Any decomposition is backlog material via an audit slice (the named extraction ladder
  lives in the audit-2 report §Fitness), never a drive-by refactor.
- **Encoder controls** (ROTATE/ZOOM/FOCAL) are spring-centred RATE controls: deflection = speed, release
  springs to zero, one rAF low-pass per param through the SAME rotation/dolly path as the absolute glides.
  **FPV** = the camera pinned at the frustum apex at the photo's own FOV (`controls.enabled = false` →
  `controls.adjustCamera` must be called manually each frame or the near/far fit freezes).
- Decorations set `raycast = () => {}` so GlobeControls never picks them.

## Traps that keep resurfacing (violations = bugs)
- **TWO focal readouts, TWO sensor axes, ONE view — do NOT "fix" either one** *(T41, owner ruled
  ACCEPTED AS-IS 2026-08-22e; documented 2026-08-22g)*. The app prints the 35 mm-equivalent focal
  length in two places and they legitimately disagree, because they measure **different edges of
  the frame**:
  - `focalFromVerticalFov(vFov)` = `FULL_FRAME_HEIGHT_MM / 2 / tan(vFov/2)`, `FULL_FRAME_HEIGHT_MM = 24`
    (`src/lib/decode/sensors.ts:146`) — across the frame's **HEIGHT**. **Six consumers**:
    `FpvHud.tsx:105` · `FpvControls.tsx:124` · `CameraTiltPanel.tsx:250` · `SpotStarsCard.tsx:43` ·
    `PlanSheet.tsx:493` · `MyPins.tsx:190`.
  - `focalMmFromHFov(hFov)` = `18 / tan(hFov/2)` — the `18` is 36/2, the full-frame **WIDTH** half
    (`src/lib/geo/plannedView.ts:21-25`). **One consumer**: the AIM stick's mm footer,
    `Joystick.tsx:168`.

  **There is no second source of truth.** `Joystick.tsx:115-117` proves both derive from the SAME
  live vertical FOV inside FPV (`hFovNow = s.fpvHud ? horizontalFovDeg(s.fpvHud.fovDeg, s.fpvHud.aspect)
  : (s.plannedView?.hFovDeg ?? null)`). They **agree at 3:2** and diverge with aspect — a portrait
  phone (aspect ≈ 0.46) reads ≈23 MM and ≈75 MM for one view, both visible together in
  `public/guide/fpv-m.webp`.

  THE TRAP: a contributor "reconciles" the two, silently breaking the photographer's width-based
  number — or adds a **seventh consumer on the wrong axis**. Pick the axis the readout's own label
  implies, and never hard-code a literal MM pair anywhere (it is viewport-specific, so it becomes
  the next drift). Reader-facing twin: guide topic `fpv-focal-axes` ("Why two focal numbers").
- **Chain, never assign, `onBeforeCompile`** on imagery-tile materials — TilesFadePlugin already
  wrapped it (`const prev = mat.onBeforeCompile; mat.onBeforeCompile = (s, r) => { prev?.(s, r); mine(s); }`).
- Colour textures = `SRGBColorSpace`; data textures (mask/elevation/normal) = `NoColorSpace`
  (an sRGB tag on data decode-darkens it — the original near-black-globe bug).
- **OSM buildings share ONE `MeshStandardMaterial`** — never swap per-tile; per-frame effects (ghosting,
  distance/altitude falloff) are O(1) global-uniform writes through a chained `onBeforeCompile`. A per-tile
  material write breaks the invariant and tanks the frame.
- **ECEF float32 cancellation** — large-coordinate instanced meshes (pins) + the frustum render
  **camera-anchored**: `mesh.position = camera.position`, camera-relative instance translations,
  `modelViewMatrix`-only shaders. TRAP: any world-space anchor read (`hoverAnchor`) must add `mesh.position` back.
- Anything camera-relative must respect GlobeControls' **dynamic far plane** (it once hid both the
  starfield and the atmosphere's far hemisphere).
- Keep `tuning.ts` import-safe for non-globe code (GlobeCanvas, tests): pure TS module, no WebGL.
- **Pan on the raw `focusHit`, never the deadband copy** (U4 owner round, 2026-08-18h): the
  camera/pan math consumes the LIVE per-frame focus hit; the deadband-quantized copy exists only
  to gate ephemeris rebuilds. Wiring pan to the quantized copy makes centring visibly sticky.
- **3d-tiles-renderer 0.4.28 internals** (installed-source facts — re-verify on ANY version
  bump, they are undocumented): download comparator = sort-then-POP (return 1 ⇒ runs FIRST);
  tile fields live at `tile.traversal.*` / `tile.internal.*` (the old `__dunder` fields are
  GONE); a custom `priorityCallback` must stay total on non-tile items; `loadAncestors=false`
  must always pair with an explicit comparator. Crib: `mem:project/wip-2026-08-18-u5-loading`.
- **`GlobeControls` feeds RADIANS into a degrees-expecting radius function — upstream, latent,
  and not ours to patch locally** (audit #25, RC29 2026-08-25). `Ellipsoid.js:361` emits an
  angle in radians; `:523` reads it as degrees, so the effective radius the dynamic far plane is
  fitted from comes out **169.4 m (0.094 %) short at Dnipro**. It stays latent only because
  `MIN_ELEVATION = 2550` already overshoots the true FPV horizon by ~39×, which swamps the
  error. **Do not take `camera.far` over locally to fix it**: eight modules scale their impostor
  anchors off `camera.far` (sun, moon, sky target, trail, ghosts, find rings, stars, atmosphere),
  and a private far plane forks that contract silently. The disposition is this line plus an
  upstream issue. Re-check on any version bump — if `MIN_ELEVATION` ever drops, this stops being
  latent.
- **LoadRegionPlugin (U6, 0.4.28 installed-source facts)**: regions are evaluated in the
  tiles-GROUP frame with NO matrixWorld fold-in — convert world poses through
  `group.matrixWorldInverse` (identity for buildings/ground; the enriched group carries its seat
  lift). A region `errorTarget` is GEOMETRIC-ERROR METRES (refine until
  `tile.geometricError ≤ it`), distance-independent — NOT screen-space. Regions only TIGHTEN
  (max-merge with camera error), so periphery softening must ride the BASE `errorTarget`
  (`quality.peripheryErrorTarget`). A stock `RayRegion` ray is INFINITE — it pierces the globe
  and force-loads the exit side; always range-cap (`scene/tileFoveation.RangedRayRegion`).
  Empty regions == plugin-off; never set `region.mask` (it suppresses everything OUTSIDE).
  Mutate `region.ray/.sphere` in place (constructors CLONE their geometry argument).
- **ImageOverlayPlugin 'tile-visibility-change' is unguarded upstream** (0.4.28,
  ImageOverlayPlugin.js:230 reads `tileInfo.get(tile).range` where every other consumer checks
  `.has` first): a tile disposed mid-fade TypeErrors on fade-complete — U6 region flips hit it
  reliably. `imageryGround.ts` swaps in a guarded listener twin; re-verify/remove on any
  version bump (T33).
- **Absolute-ECEF placement is sanctioned ONLY at far-shell distance** (ghost impostors: angular
  error ≪ 1 px at shell range). Copy that pattern to GROUND scale and you recreate the float32
  cancellation trap above — anything near the surface stays camera-anchored/local-frame.

## The batch-#4 → #7 tunable families (added 2026-08-22, audit #3 D5)

The 2026-08-21 owner batches, the QA batch and the QA slice landed a whole planning-instrument
vocabulary that this doc named NONE of (20 identifiers, 0 hits — positive control: it does name
`EARTH.nightFloor` and friends, so the probe worked). Search-order step 3 lands here, so the
names have to be findable from here.

**`AIMCONES` — the radar, one geometry model on THREE surfaces** (the GL fan
`scene/aimCones`, the expanded chart `panels/MapWindow`, the FPV mini-map `panels/MiniMap`;
the band mapping itself lives in `lib/geo/radarBands` since audit #3 A1-7):
- `bandMoon` / `bandSun` / `bandTarget` — concentric annular `[inner, outer]` unit-radius
  fractions, MOON innermost. Non-overlapping BY CONSTRUCTION, which is what retired the
  pre-S2 compact/emphasis radius scaling.
- `bandMoonMobile` / `bandSunMobile` / `bandTargetMobile` — the same stack ~20 % closer in on
  `/m` (owner batch #5 item 2). Same widths, same order.
- `mobileRadiusK` — whole-radar shrink on `/m`. Applied to the GL fan AND the chart twin; the
  mini-map is NOT scaled (its card is already CSS-shrunk).
- `mapRadiusHK` — the chart radar's radius as a fraction of canvas HEIGHT. Fraction-of-height
  is the GL fan's own rule; the pre-QA `0.3 × min(w,h)` read ≈3.7× too small on a phone.
- `skylineGuardM` — how far a radar may sit from the eye the horizon profile was SWEPT at
  before it must stop claiming that profile's gaps. Honesty rule, not a perf knob.
- `northOffsetK` / `northSizeK` — the `N` rim marker's seat (just past the OUTERMOST band) and
  glyph size. Every surface rotates now, so every surface carries its own north.
- `fillAlphaRest` — the ALWAYS-ON band wash. A band must never rest at zero (owner batch #5
  item 1: the strips read as empty); emphasis breathes it up to `fillAlpha`.
- `emphTauMs` — the emphasis ease. It gates the **FILL WASH ONLY** — the rim rides
  `rimAlpha × overlayA` with no `emphEased` term (corrected by audit #3 A2-6).
- `rayLenK` — the TARGET body's tracking ray, which runs far past the rim; sun/moon dials cap
  EXACTLY at their own band's outer radius.

**`FOCALCONE` — the planned-shot wedge** (`scene/focalCone` + both canvas twins):
- `minHFovDeg` / `maxHFovDeg` — the planned view's RANGE CONTRACT, enforced once at
  `store/camera.setPlannedView` (audit #3 A2-3: four of seven writers used to bypass it).
- `fillAlpha` / `edgeAlpha` / `edgeHalfWidthK` — near-zero fill, the boundary carries the
  reading. `edgeHalfWidthK` is in RAY-EXTENDED units (radar radius × `AIMCONES.rayLenK`), so
  the number is ~6× smaller than the radar's own `lineHalfWidthK` for a comparable width.
- `headingRateMaxDegPerS` / `hFovRateMaxPerS` — the aim joystick's rate ceilings (the desktop
  encoder twins, so the stick is one knob across shells).
- `fadeTauMs` — whole-cone fade, the AIMCONES fade idiom.

**`GROUND` / `TILESETS` — the flat 2D chart** (QA-7 a+b):
- `overlayResolutionPx` (per tier) and `overlayResolution2dPx` — the imagery COMPOSITE size.
  `stepGroundUpdate` is the ONE writer of the effective value (see the trap below).
- `esriMaxLevelCoarse` — the deepest Esri level a coarse-pointer device may fetch. The
  ImageOverlay level chooser derives source zoom from resolution/rangeWidth, so raising this
  ALONE pins the chart a level shallow: it needs the 512 composite AND the DPR cap together.
- `flat2dPhotoK` → `uFtwPhotoK` — how far the stylized ground grade lerps OUT on the flat
  chart. 1 = raw Esri colorimetry (the "photographic chart" ruling); 0 = the old stylized look.
- ground LRU floors (`groundLruBytesMB`, per-tier) — see T34: the cache rests at exactly
  `minBytesSize` and re-fetches on every 2D↔FPV flip.

**`QUALITY.leanMobile` — the coarse-pointer profile**: `dprCap` (heat), `dprCap2d` (relaxed
only while the flat chart is up — the chart has bloom/GTAO/shadow twins off already, so the
budget goes to crispness), `bloom`, shadow size. Desktop is untouched by design.

**`PLAN.minCoverageForGaps`** (audit #3 A1-16) — the evidence floor below which NO radar
surface claims skyline gaps. `profileCoverage` reached the store and both PLAN panels and was
consulted by no radar: a 15 %-covered profile fractured its bands like a complete one.

## Two traps this doc was missing (audit #3 D5)

- **The sticky overlay-px rule has exactly ONE writer.** `stepGroundUpdate` is the only caller
  of `ground.setOverlayResolution`, and the effective composite px may only RATCHET UP
  (`lib/globe/quality.stickyOverlayPx`, a `Math.max` — monotone by construction). A second
  writer, or any path that LOWERS it on a mode flip or a governor demote, reintroduces the
  CRITICAL QA-7b regression: a composite-rebuild storm on every 2D↔FPV flip (white chart for
  10 s+, a load storm, a blurry stall). Raw Esri GET counts CANNOT isolate it — assert
  `window.__overlayRebuilds`.
- **An injected-GLSL uniform MUST be declared in the fragment HEADER.** Adding an entry to
  `shader.uniforms` is not enough: without `uniform float uFtwFoo;` in the injected header the
  new program fails to compile, tiles keep rendering the PREVIOUS program, and every live poke
  at the uniform silently no-ops. It cost ~40 minutes once, and the sweep that proves the
  invariant is checklist item 23: **every entry in the JS `shader.uniforms` object has a matching
  declaration in the injected fragment header** (`buildingMaterial`'s `uFtwTileSeed` is a correct
  VERTEX-header declaration, not a miss). Stated as the invariant rather than as a COUNT on
  purpose — the literal pair re-stales every time a uniform is added, and it did: `imageryGround`
  gained `uFtwEclipse` on 2026-08-22k. Re-measure, do not trust a number written here.

## The `ULTRA` family (added 2026-08-22j — T44 + T45, the desktop fidelity track)

`tuning.ULTRA` is the LOOK half of the `ULT` chip; `QUALITY.ultraDesktop` is the TILE half. Both
hang off the ONE gate (`hqAllowed` in `StylizedTiles`, plus its boot twin `lib/globe/ultraBoot.ts`).
**With the chip off not one value in either block is read** — every shader term is
`mix(legacy, ultra, 0.0)` and every eased uniform SNAPS to 0 under an epsilon, so "off" is exact
rather than asymptotic. `scripts/verify-ultra.mjs` asserts that in the browser.

| Group | Keys | Note |
|---|---|---|
| texture | `photo3dK` `photoTauMs` `anisotropy` | `photo3dK` drives the SAME `photo` term as the chart's `GROUND.flat2dPhotoK`, on its own uniform. **Never route ULTRA through `uFtwFlat2d`** — that also forces `dayK`, which is a C2 breach in 3D. |
| light | `dayCurve` `exposureCurve` `hemiCurve` `hazeCurve` `tintStopsDeg` | Anchor tables in sun ELEVATION (deg), evaluated by `lib/globe/lightBands.ts`. Author HIGH→LOW, monotone. Knots are the almanac's thresholds (`lib/ephemeris/twilight.ts`) and a test asserts that. |
| haze | `hazeDistM` `hazeMaxK` `hazeFullAltM` `hazeGoneAltM` `hazeSunPow` `hazeSunGain` `hazeTauMs` `hazeDarkK` | One shared `FTW_AERIAL_GLSL` (scene/glsl.ts) compiled into ground AND buildings — that sharing is what keeps them from diverging. |
| shadow | `shadowMapSize` `shadowRadius` `shadowBiasM` `shadowNormalBias` | `shadowMapSize` is BOOT-only. `shadowRadius`/`shadowNormalBias` are live uniforms, edge-applied. |
| terrain | `terrainCast` `terrainCastMaxAltM` `terrainDepthOffset` `boundsAltK` `maxBoundsM` `lightDistM` `depthMarginM` | The wide ortho + long light distance exist so a mountain fits the shadow camera at all. |

### Five three.js facts these knobs encode (all source-verified against `node_modules/three` 0.185)

1. **`PCFSoftShadowMap` is dead code.** `WebGLShadowMap.js:99-104` intercepts it, warns
   "deprecated", and rewrites `this.type = PCFShadowMap`; there is no `SHADOWMAP_TYPE_PCF_SOFT`
   define. The soft-shadow lever in r185 is **`shadow.radius`** on a 5-tap Vogel disk rotated per
   pixel by interleaved gradient noise (~20 effective hardware-PCF taps for 5 fetches). It is a
   live uniform, and a large radius degrades to NOISE, not banding — so it is safe to push.
2. **`shadow.bias` is a FRACTION of the shadow camera's near→far range, not a length.** It is added
   to `shadowCoord.z` after the divide, and an ortho shadow matrix maps to [0,1] linearly in view
   depth. `SHADOWS.bias` −2e-4 over a 7,000 m range is −1.4 m; over ULTRA's ~96 km it would be
   −19 m. Author it in METRES (`ULTRA.shadowBiasM`) and derive. **Changing `depthMarginM` silently
   rescales any raw bias constant.**
3. **`castShadow` on a single-sided sheet needs `material.shadowSide = FrontSide`.**
   `getDepthMaterial` sets `side = shadowSide ?? invert[material.side]`, and the inversion culls a
   ground sheet completely. **It fails silently** — no error, no warning, no shadows.
4. **`shadow.mapSize` is LATCHED.** three reallocates the depth target only when `shadow.map` is
   null or the TYPE changed, so a runtime `mapSize.set()` does nothing. Size the rig at BOOT. three
   also silently clamps `mapSize` down past `maxTextureSize` — clamp at the call site or tuning and
   the live rig disagree.
5. **A directional shadow target costs 2× a depth-only reading**: default `RenderTarget` options
   give it an RGBA8 COLOUR attachment (written by `MeshDepthMaterial`, sampled by nothing) plus a
   D24 depth texture. 4096² ≈ 128 MiB; **8192² ≈ 512 MiB**.

### Two more traps from this track

- **Backticks inside an injected-GLSL template literal terminate it.** A `` `uniformName` `` in a
  comment inside `gradeGround`/`onBeforeCompile` produced 17 phantom TS parse errors far from the
  cause. Prose only inside those templates. (Companion to the existing injected-GLSL-header trap:
  a uniform in `shader.uniforms` but NOT declared in the header is a SILENT compile failure.)
- **`anisotropy` is part of three's GL texture cache key.** Changing it on a live texture forces a
  full re-upload per texture, so the drape composites are stamped at CREATION only (by wrapping
  `TiledRegionImageSource.prototype.fetchItem`, the unique choke point for both creation paths).
  Documented consequence: **fly a little for the full effect**. The value must be DETERMINISTIC —
  clones share their `.source`, and three keys GL textures by (source, cacheKey), so a varying
  anisotropy fragments that sharing and multiplies GPU memory instead of saving it.

## The vertical-datum asymmetry — EXIF vs the bake (audit #26, RC29 2026-08-25)

**Two halves of this app read altitude in two different datums, and only one of them is
corrected.** Say so out loud rather than discovering it a third time:

- **The BAKE is corrected.** GLO-30 heights are ORTHOMETRIC (EGM2008), the terrain the renderer
  draws is ELLIPSOIDAL, and `ellipsoidal = orthometric + N`. `scripts/bake/terrain/geoid.mjs`
  carries checked-in EGM2008 sample grids — one per baked region — precisely so the bake's
  verification step converts between them without asking the terrainer what it did.
- **EXIF is NOT corrected, deliberately.** A camera's `GPSAltitude` may be orthometric or
  ellipsoidal depending on the device, regardless of what `GPSAltitudeRef` claims, and D4
  (`PROJECT_SEED.md` §4) already declares EXIF vertical GPS untrustworthy. The sanctioned
  mitigation is the `Math.max(sliderAlt, terrainH + 1.7)` clamp on the frustum apex and the
  photo-FPV eye (`PhotoFrustum.ts:135-138`, `StylizedTiles.ts:2432`) — the blast radius is those
  two consumers and nothing else.
- **DO NOT ADD A RUNTIME GEOID.** D4 is binding, the correction (tens of metres at most) is
  smaller than the vertical GPS noise D4 refuses to trust, and it would cost a ~1 MB grid in the
  client bundle to make an untrustworthy number differently untrustworthy.

**The trap that pays for this line:** `geoid.mjs` used to CLAMP an out-of-range lookup to the
nearest grid corner. The Everest probe (27.99 N, 86.93 E) was answered with Dnipro's 36 E / 48 N
corner — **+20.025 m where the truth is −28.341 m, a 48 m error that read as a plausible
number** — and the bake, which was correct, was chased as "terrain 39 m too low". It now throws,
because an out-of-range geoid lookup has no defensible answer. Any sampled-grid reference in this
repo inherits that rule: **loud beats plausible.**

## The `ECLIPSE` family (added 2026-08-22k — solar + lunar eclipses)

`tuning.ECLIPSE` is the LOOK half; the PHYSICS is `lib/ephemeris/eclipse.ts` (pure, three-free,
almanac-tested). Nothing in this block can move the eclipse — only how it reads. Unlike `ULTRA`
this is **not chip-gated**: an eclipse is physics, not a fidelity lever, so it runs for everyone.

| Group | Keys | Note |
|---|---|---|
| Daylight | `daylightGamma` 0.8 · `daylightFloor` 0.04 · `tauMs` 220 | gamma < 1 encodes LIMB DARKENING — the last sliver hidden is the sun's bright centre, so light holds through the partial phases and collapses at the end, which is how an eclipse is actually experienced. The floor is not zero: the umbral spot is ~100 km across and the sky above it is still lit for hundreds of km around |
| Solar disc | `limbSoftFrac` 0.012 · `haloAtTotality` 0.06 | the lunar limb is knife-sharp (no atmosphere), so `limbSoftFrac` is pure anti-aliasing — ~1 px at the tightest reachable zoom (`FPV.minFovDeg` 2.75) |
| Corona | `coronaOnCoverage` [0.985, 1] · `coronaGain` 1.15 · `coronaInnerFalloff` 0.34 · `coronaOuterPow` 2.6 · `coronaOuterGain` 0.42 · `coronaPetalAmp` 0.22 · `coronaWhiteMix` 0.72 · `chromoWidth` 0.018 · `chromoGain` 0.55 | the ramp is what keeps the corona strictly inside TOTALITY — the corona is ~1e-6 of the disc, so one surviving sliver of photosphere drowns it, and this also keeps it out of every ANNULAR eclipse where the ring never leaves. `coronaGain` sits just over `BLOOM.threshold` 0.9 so bloom carries the streamers, but it must still read where bloom is OFF (tier `low`, coarse pointer, flat map) |
| Lunar umbra | `umbraLight` 0.055 · `umbraEdgeLift` 1.9 · `penumbraDim` 0.32 · `shadowSoftFrac` 0.09 | **`umbraLight` is a deliberate, named fudge**: the honest number is ~1e-4 of a full moon (10–12 magnitudes down), which renders invisible, while the real eclipsed moon is famously easy to SEE because the eye adapts. C2 is satisfied by applying that adaptation ONCE, in one place with its reasoning, instead of smearing it through the shader. `umbraEdgeLift` is physical, not taste: the outer umbra is lit by a wider arc of refracting atmosphere, so the limb nearest the shadow edge is markedly brighter and warmer — it is what makes the disc read as an eclipse rather than a red filter |

Colours are TOKENS, never literals here (D14): `tokens.eclipseUmbra` (Danjon L=2 copper-red) and
`tokens.eclipseChromo` (the chromosphere hairline). Two `STARS` keys join the family —
`eclipseRevealStart` 0.9 / `eclipseRevealMax` 0.75 — and they live in `STARS` because the reveal
reuses that module's own night curve rather than inventing a second one.

**Traps.** The star reveal MUST be folded in BEFORE `stars.update`'s `fade > 0.01` hard return, or
it is unreachable at any daytime sun elevation. `uEclipse` on the atmosphere applies only inside
the low-altitude sky branch, and the ground's `uFtwEclipse` arrives ALTITUDE-GATED from the
orchestrator — from orbit the umbra is a ~100 km spot, not a hemisphere (backlog T46). And the
whole family must be a provable no-op when nothing is happening: `eclipseK` snaps to exactly 1
(browser-asserted), so every downstream multiply is identity.


## The `BESTSPOT` family (added 2026-08-24 — the observability heatmap)

**This family is SPLIT ACROSS TWO FILES, which is a deliberate contract, not drift.**
`tuning.BESTSPOT` is the LOOK + LADDER half (construction-time and render-time, edited in the
repo). `BESTSPOT_SCORING_V1`, re-exported from `tuning.ts:36` but *owned* by
`lib/geo/bestSpotScoring.ts`, is the PHYSICS half — **54 leaves, patchable at RUNTIME** through
`__globe.bestSpotTuning(patch)` and persisted into `ftw:view-prefs:v1` under `bestSpotTuning`.
The split exists because the scoring half must survive a taste pass without a rebuild: every
leaf carries a `CLASS_OF` entry saying whether changing it is a `recompose` (0.3–3 ms, one job),
a `rescore`, a `resweep` or a full `rebuild`. Measured: reweigh 4.27 ms · rescore 177 ms ·
resweep 343 ms · rebuild 490–548 ms.

| Group | Keys | Note |
|---|---|---|
| Heat ramp | `rampId` "inferno" · `rampAltId` "turbo" · `displayLo` 0.15 / `displayHi` 0.9 | ramps are NAMES resolved by the token bridge, never colour literals (D14) — an owner A/B must not be able to introduce one. **`displayLo`/`displayHi` are THE knob**: score → t is `smoothstep(displayLo, displayHi, S)`, so a metric revision that moves the whole distribution is absorbed here and nothing else in the look has to move. `displayLo` doubles as R6's "clears the floor" test |
| Ink | `inkMin` 0.02 · `inkMax` 0.34 · `inkGamma` 1.4 · `bloomHeadroomNote` | `inkMin` is deliberately **not 0**: a scored-but-bad cell must still read as SCORED — that is the whole UNKNOWN-vs-low-score distinction. **The trap is named in the block itself**: `inkMax` past ~0.40 pushes the hottest cells over `BLOOM.threshold` 0.9 and the sheet SMEARS into the buildings instead of reading as a ground layer. Taste `displayHi` first; `inkMax` is the last resort |
| Veil | `veilMin` 0.12 · `veilMax` 0.3 | the dark scrim that keeps the wash legible over the brightest measured backdrop (the flat 2D photographic chart at `GROUND.flat2dPhotoK = 1`). **Independent of ink by design** — the veil answers "can I see the wash", the ink answers "how good is this cell"; tying them makes a dark disc invisible on the chart |
| Contours | `contourStep` 0.1 · `contourMajors` [0.6, 0.8] · `coreWidthPx` 1.4 / `haloWidthPx` 3.8 / `majorWidthK` 1.7 · `coreAlpha` 0.95 / `haloAlpha` 0.65 / `majorAlphaBoost` 0.15 · `dashCoreAlpha` 0.9 · `unknownDashPx` 9 / `unknownDuty` 0.45 | widths are in SCREEN px off the screen-space score gradient (`fwidth`), so lines stay 1 px at every zoom. **`dashCoreAlpha` is a separate knob from `coreAlpha` on purpose**: an iso-score contour is a MEASUREMENT and wants to be the crispest line on the surface, while the UNMAPPED boundary says "nobody looked past here" and must read softer than the data it borders — a hard 0.95 dash is a claim about the boundary's exact position, which is the one thing UNKNOWN is not making |
| Markers + plumb | `topK` 8 · `topKMinSepM` 25 · `hoverRadiusK` 1.35 / `hoverEaseTauMs` 180 · `chipCapPx` 13 · `plumbHalfWidthPx` 1.5 · `tickArmPx` 9 | the altitude chip hangs off a **screen-space** test (`(plumbPx − chipCapPx) / chipCapPx`), not a metre threshold — at nadir a 400 m sheet projects to zero pixels and a 1.7 m sheet at a grazing tilt projects to plenty, so any metre constant is wrong at one end. Two proposed knobs (`chipMinM`, `chipTiltLerp`) were **ratified as derivations rather than promoted** for exactly that reason |
| Render seat | **`renderOrder` 4** · `markerRenderOrder` 5 · `polygonOffset` [-4, -4] · `fullAltK` 8 / `topAltK` 14 / `fadeTauMs` 250 · `rimFrac` 0.1 · `densFadeLo/Hi` 0.35/0.7 | see the renderOrder-ladder trap below — 4 is **not** 9 |
| Ladder + residency | `ladderCellsM` [24, 12, 6, 3] · `defaultCellM` 3 · `midCellM` 6 · `dragCellM` 24 · `ultraCellM` 1 · `ultraMaxRadiusM` 300 · `rebuildQuietFrames` 90 · `mirrorEveryFrames` (borrowed from `PLAN`) | 1 m is reserved for ULTRA and capped to a 300 m radius. `rebuildQuietFrames` is the refinement debounce: the fine rung only runs after 90 quiet frames, which is what keeps a radius drag at +1.1 ms on the idle frame |
| Disc geometry | `radiiM` [100…500] · `defaultRadiusM` 300 · `eyeM` 1.7 · `defaultLiftM` 0 · `liftMinM` 0.5 / `liftMaxM` 400 · `collarM` 400 | `eyeM` 1.7 is the pedestrian eye; above 5 m the panel switches to DRONE semantics (owner ruling). `collarM` is the evidence collar beyond the disc rim |
| Honesty gates | `emptyFieldFrac` 0.05 · `liftProbesM` [10, 20, 40, 80] / `liftProbeCellM` 24 · `minTilesForSolve` 1 · **`builtDensityFloorPerKm2` 1** · **`refuseBelowReachM` 400** | these decide when the feature REFUSES or withholds credit rather than painting. The built-density floor is `√(26.6 × 0.048)` — the geometric mean of the two measured extremes — and it is an **evidence gate, never a score penalty**: it withholds open-sky credit instead of subtracting from the score. Calibration for `refuseBelowReachM`: 0 cells refused on a fully-mapped disc, 175 at 420 m, 3,027 at 500 m |
| Scoring (runtime, `bestSpotScoring.ts`) | `weights` {v 0.15, l 0.30, p 0.25, f 0.30} · `gates` · `curves` · `graze` · `gap` · `trackWeight` · `worth` · `access` · `quadrature.discColumns` 8 | 54 leaves. **No key path from a patch reaches the PHYSICS/SAFETY/HONESTY blocks** — `sanitizeScoringPatch` makes that structural, so a hostile or stale persisted blob cannot disable a safety gate (`prefs.ts:88`, `:147`) |

**The unswept judgements** (backlog T49, the taste-pass targets): `graze.conf` (terrain 1.00 ·
building 0.90 · deck 0.90 · tree 0.45, tree clamped ≤ 0.6) · `graze.reliefHiDeg` 0.40 ·
`displayLo/displayHi` · `worth.effectiveFloor` 0.35. These came from the AS-BUILT hero numbers,
not from a solved disc.

### Four traps from this track

- **The `renderOrder` ladder is a CONTRACT, and 4 is not 9.** The bands in use: **3** ground
  decals (`streetNames`, `placeMarkers`) · **4 / 5 the BEST SPOT sheet + its markers**, which are
  `depthTest: true` / `depthWrite: false` · **9** the depth-free radar ink (`aimCones`) · **10**
  depth-free sky overlays (`dayArcs`, `skyTrail`, `findGhosts`, `skyGhosts`) · **11 / 12** the sun
  and moon discs · **20** enriched decorations. A **depth-tested** surface dropped into the
  depth-free 9/10 band sorts by draw order instead of by depth and paints over the very buildings
  it is supposed to sit under. And `renderOrder` is set **per OBJECT** — a `Group`'s does not
  propagate to its children.
- **A worker entry is a new Vite optimize-dep root.** Adding
  `new Worker(new URL("./x.ts", import.meta.url), { type: "module" })` makes `wix dev` serve
  `504 Outdated Optimize Dep` for **every** module, not just the new one — no island mounts and
  the page looks merely blank. Restart `wix dev` before any browser work after adding one; if a
  restart is not enough, move `node_modules/.vite` aside (T14).
- **`postMessage` transfer lists DETACH, and vitest cannot see it.** A typed array handed out **by
  reference** from long-lived resident state must be `.slice()`d before it enters a transfer list:
  the first post detaches the worker's own copy and every later post throws `An ArrayBuffer is
  detached and could not be cloned`. jsdom/node `postMessage` has **no transfer semantics**, so
  this whole defect class is structurally invisible to the unit tier and belongs in the browser
  gate. It shipped once, froze the on-screen `scoringHash`, and killed `.ab()`.
- **Read the DISTRIBUTION of a published field, never a flag.** `__globe.bestSpotField()` exists
  because the feature's most dangerous failure is a warm, confident, *uniform* disc — and it
  happened, at `rMin === rMax === 187` across 31,417 cells, with 1,860 unit tests green. A
  verify check that asserts "the field exists" or "solving === false" would have passed. Assert a
  SPREAD.

## The MESH SUITE MS1 family (added 2026-09-02 — the spatial-edit substrate)

`ENRICHED.editUpdateRangeMaxRuns` (8) is the ONLY new taste knob: when a frame's seat/edit
writes touch at most this many runs of a cell, the GPU upload covers just their byte ranges
(`BufferAttribute.addUpdateRange`; three 0.185 merges the ranges, uploads them, then CLEARS
the list — so a frame that touches more runs falls back to the whole-buffer upload it always
had, and the next frame starts clean). The rails of an edit are CONTRACT, not taste, and live
in `lib/globe/bldgOverrides.ts`. Since MS5b (2026-09-02l) they come in two layers: the GESTURE
rails are PER EDIT about the committed transform (`EDIT_MOVE_MAX_M` 100 m per drag,
`EDIT_MIN_K/MAX_K` 0.1×/10× per drag on every scale axis — edits compound, no absolute cap),
and the SANITY rail (`SCALE_MIN_K/MAX_K` 0.001/1000, `TRANSLATE_MAX_M` 5000, `LIFT_MAX_M` 25 —
the lift stays absolute) is what a persisted row is checked against: outside it the row is
DROPPED on read (the `k` precedent), so loosening that rail is a compatibility event and
tightening it silently sheds rows. (Before MS5b: absolute 60 m / 0.1×–10× + a 0.5×/3× band.)

Three facts the substrate encodes (source-verified 2026-09-02):
- **Rotation sense is three's.** `rotDeg` follows `Matrix4.makeRotationY` — positive turns +X
  (east) toward −Z (north): counter-clockwise seen from above. A compass heading is the
  NEGATIVE of it; convert at the UI, never in the row.
- **The absolute recompose IS the incremental writer for identity.** `recomposeVerts` with
  identity spatial components is exactly `y = baseY + dyM + (y0 − baseY)·sy`, X/Z untouched —
  `featureTransform.test.ts` pins it, and it is what lets a RESET building drop back to the
  fast path with no seam. Untouched buildings never leave that path: one null check per frame.
- **Edge strokes are attributed per SEGMENT.** `EdgesGeometry` emits two vertices per segment
  and shares nothing; the load-time key map is first-wins per POSITION, so a party-wall corner
  claimed by building A used to drag B's stroke endpoint along. `mapSegmentsToRuns` gives a
  segment to the run owning BOTH its ends (a fully shared post still goes to the lowest run).
  Applies to every cell, edited or not — a cm-scale difference on party walls during a
  re-seat, and the only correct answer under a move.

## The MESH SUITE MS2 family (added 2026-09-02 — the gizmo UI)

`ENRICHED.gizmoSize` (0.8, three's `TransformControls.size`) and the Shift-held snaps
`gizmoSnapM` 1 / `gizmoSnapDeg` 15 / `gizmoSnapScale` 0.1 are the ONLY new taste knobs. The
rails stay CONTRACT in `lib/globe/bldgOverrides.ts`; `clampGizmoEdit` there rails the drag PER
EDIT about the committed transform (MS5b: the move offset ≤ 100 m, every scale axis 0.1×–10×
about the value it STARTED the drag at — ten drags go ten times further than one; only the
loose sanity rail caps the compound).

Three facts the gizmo encodes (source-verified against three 0.185 `TransformControls.js`):
- **The controls take fed pointers.** `pointerHover/Down/Move/Up({x, y, button})` are public and
  take NDC; constructed with no domElement they register nothing, so the orchestrator's FPV
  handlers own the gesture (one table for look-drag, pinch, U8 claim, gizmo). `pointerMove`
  early-returns unless `button === -1`, `pointerDown/Up` unless `button === 0`.
- **`minY/maxY` clamp in PARENT space.** The anchor's parent is the cell mesh, so the lift rail
  is stated in bake-local metres: floor = the seated base, ceiling = base + `LIFT_MAX_M`.
- **Hiding X and Z hides the screen-space E ring too** (three shows `E` only with all three
  axes on); `showXYZE = false` removes the trackball. Invisible handles are not hit-testable
  (`intersectObjectWithRay` checks the child's `visible`), so a hidden axis cannot be dragged.
- **Do not call `tc.dispose()` with no domElement** — its `disconnect()` dereferences null;
  `getHelper().dispose()` frees the geometries and materials.
- **`_gizmo` is an underscore field.** The harness accessor `handleScreenPx` reads
  `_gizmo.picker[mode]` (a torus for the rotate ring — take the on-screen extreme vertex, not
  the bounding-sphere centre, which is the ring's hole). A three bump re-verifies it.

## The MESH SUITE MS3 family (added 2026-09-02f — world-shared edits)

Two knobs: **`ENRICHED.overrideTintSharedK`** (0.13) is the WORLD-SHARED level of the
`_ftw_override` byte ladder (byte 128) — `overrideTintCommittedK` (byte 255, MINE) was raised
0.16 → 0.24 on the owner's "highlighted more distinctly than today"; the armed run keeps
`overrideTintK`. The fragment reads the ladder as two thresholds (0.25 / 0.75 of the normalized
byte), never as a multiplier, so nothing interpolates onto a third level — a run's vertices all
carry one byte. **`ENRICHED.hoverPickMs`** (120) throttles the hover pick that anchors the
"EDITED · shared · 34.3 m · was 24.5 m" note over an edited building nobody has armed (mouse/pen
only, never during a look-drag; a resting pointer costs nothing).

Not knobs (contract, `lib/wix/overrideRecords.ts`): `SYNC_MAX` 1000 (the platform bulk cap AND
the query page size), `GET_MAX_PAGES` 10 (10k rows before the GET answers `complete: false`, on
which the client never deletes). The merge policy is code, not tuning (`lib/globe/bldgSync.ts`).

Traps the slice recorded:
- **`astro check` re-optimizes Vite's dep cache under a running `wix dev`** ("Re-optimizing
  dependencies because vite config has changed") — every `node_modules/.vite/deps/*` module then
  answers `504 Outdated Optimize Dep` and the globe never boots. Same recipe as a new
  globe-bundle import: stop `wix dev`, move `.vite/deps` aside, restart. Run `astro check`
  before the dev server, or restart after it.
- **A result's `next()` runs outside `auth.elevate`** — page an ADMIN-read collection with
  `skip()` so every page is its own elevated call.
- **The collection is the production world even from `wix dev`** — a harness that writes a row
  removes it in `finally` and proves the world clean.

## The MESH SUITE MS5 family (added 2026-09-02i — user models in the world)

`MODELS` is a new group (`scene/userModels.ts` + `store/userModels.ts`). The RAILS of an edit are
CONTRACT and live in `lib/models/modelPlacement.ts` (`MODEL_SCALE_MIN/MAX` = the building scale
SANITY rail — the 0.1×–10× band is per edit about the committed scale since MS5b, compounding;
`MODEL_MOVE_MAX_M` 250 per drag; **MS7 (2026-09-03) `MODEL_LIFT_MAX_M` 50** — the lift's absolute
rail both ways — and **`MODEL_LIFT_KEEP` { frac 0.25, minM 0.5 }**, the "never fully into the
texture" rule: `liftFloorM(scaled height)` keeps that much of the model above its terrain seat on
EVERY path (live drag, commit, server PATCH, every read) — **MS8 (2026-09-05) made it TILT-AWARE**:
`tiltedExtent(size, scale, pitch, roll)` → `liftFloorFor({ topM, extentM })` = `min(keep, span) −
top`, upright the MS7 number to the bit, on its side half the depth may sink, FLIPPED the model is
HELD UP a quarter of its span; `MODEL_COVER_PRECISION` 5 — the `gh5`
column); these are
the taste + budget knobs: the world-read cover (`fetchRadiusM` 4000 · `fetchMaxAltM` 40 000 ·
`maxCells` 16 · `queryThrottleMs` 600 · `repollMs` 90 000 · `readLagGraceMs` 15 000), residency
(`loadRadiusM` 3000 / `unloadRadiusM` 4000 hysteresis · `maxResident` 24 · **`triBudget`
1 500 000** · `densityWarnTris` 1 000 000 · `maxConcurrentLoads` 2 · `residencyEveryFrames` 12),
seating (`resnapEveryFrames` 60 · `seatEaseK` 0.18 · `seatSnapM` 0.005 · `xfEaseK` 0.2 ·
`fallbackGroundM` 120), the armed highlight (`armedEmissive` 0.22 — the accent TOKEN at the use
site), and the mirrors (`densityMirrorEveryFrames` 30 · `hoverPickMs` 120).

Three facts the module encodes (source-verified 2026-09-02i):
- **`hasSome` is equality-on-a-set.** The world read cannot prefix-match a p9 hash; a placement
  writes a denormalized p5 cell beside `geohash9` (the pins' gh4/gh6 precedent), and the cover is
  the ≤ 16 nearest p5 cells of a square around the ground focus.
- **The rig IS the model.** `frame` (ECEF + the ENU quaternion from `Matrix4.makeBasis(east,
  up, −north)`) → `anchor` (the live move offset) → `body` (yaw + uniform scale) → the GLB root
  re-based by `groundFitOffset`. The MS2 gizmo attaches to `anchor`/`body` through a
  GhostRig-shaped `{ cx: 0, cz: 0, liveBaseY: 0, inflate: 1 }`; three's scale mode writes
  `scaleStart × offset` on the dragged axis only, so `uniformScaleFrom` takes the axis that moved
  most in log space. `attachBldgGizmo` grew `clamp` / `lift` options for it (defaults unchanged)
  and, at MS7, **`liftRail(start)`** — MOVE's Y-arrow rail in metres about the seated base; the
  building default is `[0, LIFT_MAX_M]` (byte-identical), the model instance hands
  `[liftFloorM(height × start.sx), MODEL_LIFT_MAX_M]`. The model's anchor Y IS the stored lift
  (`liveBaseY` 0 → `tU = anchor.y`); the lift eases like the other seats (`xfEaseK`).
- **MS8 (2026-09-05) — the tilt.** `attachBldgGizmo` grew **`tilt`** (default false): ROTATE shows
  the X (pitch) and Z (roll) rings too, turns the screen-space E ring off by name (`showE` — three
  shows it whenever all three axes are on) and decomposes the body's FULL quaternion into the
  canonical YXZ triple (`eulerFromQuaternion`, `lib/models/modelPlacement.ts`) as `raw.rotDeg /
  pitchDeg / rollDeg` — the pure-Y `yawDegFromQuaternion` read is wrong for a tilted body.
  `FeatureTransform.pitchDeg? / rollDeg?` are OPTIONAL and USER-MODELS ONLY; the building instance
  never sets them and its ROTATE is byte-identical (the Y ring alone — pinned by `verify-meshedit`).
  The scene composes ONE quaternion (`quaternionFromTilt`, three's `Euler` "YXZ") and eases a row
  change as a SLERP (`appliedQ.slerp(targetQ, xfEaseK)`, snap under 0.02°) — a foreign 180° roll
  turns the short way, never through a tumble of Euler components. The label anchors at the tilted
  box's highest point. DEV seam `__globe.modelGizmo().ringPx(name, n)` lists points along a ring —
  three rings overlap on screen, so a harness HOVER-searches for `axis === "X"` before it presses.
- **The budget is the density warning.** `planResidency` walks closest-first; what it refuses
  inside the load radius is `skipped`, and `densityWarning(skipped, tris, warnTris)` is the MDL
  chip's amber and the DBG `models.skipped` warn.

MS6 (2026-09-02m) added ONE `MODELS` knob — **`chainShader`** (true): every loaded GLB material is
chained onto `patchModelShader` (the ULTRA `ftwAerial` haze after `<opaque_fragment>` + the FPV
BUILDINGS-slider screen-door dissolve at `<color_fragment>`, holder uniforms `uFtw*` bound by
reference; `setUltraHaze` / `setSolidity` on the handle, pushed beside the building sets). The
ORBIT hover of a user model rides the pins' cadence
(`PINS.hoverEveryFrames`) and the FPV hover keeps `hoverPickMs`; the "stand beside it" pose is
CONTRACT (`STANDPOINT` in `lib/models/modelPlacement.ts`: eye 1.7 m, FOV 60, 3 × the longest scaled
extent inside 6..120 m; MS7: the distance is at least 3 × |lift| and the aim rides the lift). `pickModelAt` lost its FPV gate (the MDL gate stays) — in orbit a click on a
model stands beside it in FPV, a dblclick never drops a temp pin under it, and the arming gate is
the MEMBER PHASE (any signed-in member; `mine` is the YOURS / SHARED badge).

Traps the slice recorded:
- **The scene fence**: `scene/userModels.ts` reads NO store — the orchestrator pushes `world`
  and the MDL gate down, and the residency counts come back up through `_syncDensity`.
- **A row that leaves the world must end its session** (MS6): `setModels` drops `armedId` when a
  row vanishes (hidden / deleted from the list, the cover moved on) while the orchestrator's
  `modelArmed` persists — `stepUserModels` disarms when `userModels.info(id)` is null.
- **The pointer cursor is shared** (sky · pins · gizmo grab · the MS6 orbit model hover): set it
  only when it is empty, hand it back only when you set it.
- **A late GLB fetch for a released model** must be disposed, not attached — the entry's `gen`
  counter is bumped on every unload.
- **Disposing a loaded GLB** walks geometries, materials AND their texture maps; three's loaders
  allocate all three.
