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
  invariant is checklist item 23 (16 JS uniforms vs 16 header declarations in `imageryGround`;
  `buildingMaterial`'s `uFtwTileSeed` is a correct VERTEX-header declaration, not a miss).
