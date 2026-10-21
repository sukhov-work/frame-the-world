# wip 2026-10-18 — THE PHOTO PROJECTION PROTOTYPE (the photo flow (b), triage §4, T157) — BUILT + GATED + BROWSER-VERIFIED (DECISIONS 2026-10-18)

Mode: implement, Deep (`/frame` under investigate-design-v3; four Opus research agents at boot — the photo flow, the building
material + tile frames, three.js plumbing, conventions/fences/harness — then a store+UI agent, a unit-test agent and a harness agent in
parallel with the scene core written in the main session). Owner order: a careful desktop-only prototype of
`rendering/BUILDING_COLOUR_TRIAGE_2026-10-13.md` §4 (a street photo projected onto the 3D buildings), the existing upload flow reused
through a SEPARATE store (technical photos, never pins), zero regression to any other flow, no performance cost without a justified
trade-off, no mobile twin yet. Also ruled: the building-colour shade + day/night transitions and the AR yaw lock's feel are fine.

## The decisive finding — per-draw uniforms do not upload (and the route that does)
`node_modules/three/src/renderers/WebGLRenderer.js:2522-2541` + `:2707`: `WebGLUniforms.upload(materialUniforms)` runs only under
`refreshMaterial` (a `state.useProgram` switch, `material.id !== _currentMaterialId`, or a camera change); `_currentMaterialId` resets
at every `render()` (`:1792`) and on a render-target switch (`:3055`). The opaque list sorts by material id, so every mesh of ONE shared
material draws back to back and only the FIRST mesh's `onBeforeRender` write reaches the GPU per pass. Consequences: (a) the triage's
"per-draw RTC-safe projector matrix" is impossible through uniforms; (b) the existing per-tile `uFillBirthMs` / `uFtwTileSeed` /
`uEdgeBirthMs` writes (F1 reveal, R2 seed) carry the same latent limit — T165, unverified in a browser, not touched.
**The route:** `uFtwProjFromView = bias·P·V_photo × camera.matrixWorld` (float64, per PASS, written in `fillMat.onBeforeRender` keyed on
`renderer.info.render.frame` + the camera — `material.onBeforeRender` runs before `setProgram`, so the pass's first draw uploads it),
applied in the fragment to `-vViewPosition` (three's own float64-built camera-relative position) → ZERO new varyings, the vertex
shader untouched, no ECEF swim. `test/components/globe/photoProjector.test.ts` emulates float32 after every op: view-space route
**3.2e-7 uv** vs world-space **4.2e-3** (ratio > 10× asserted; measured 13,000×).

## What was built (src/)
- `store/facadePhoto.ts` — `useFacadePhotoStore`: `idle → decoding → review → placing|placed`; its OWN `trickleTimer`/`activeAbort`/
  `loadSeq`; `ingest` seeds params + placement from EXIF (no temp-pin side effect, never imports `store/camera`); `rollDeg` (the roll
  nudge, outside `AdjustableParams`); `nudgePlacement(northM, eastM)` (1° lat = 111,320 m, lon ÷ cos lat); `projection {enabled,
  strength, ownLight}` clamped; `setPlaneOpacity`; `clear()` resets projection to the defaults. DEV `window.__facadeStore`.
  22 tests `test/store/facadePhoto.test.ts` (incl. source fences: no `store/upload` / `mobile/` / `method="post"` / `autoFocus` in the
  component; `index.astro` mounts it, `m.astro` does not).
- `panels/FacadePhotoFlow.tsx` + `styles/facade-photo.css` — ONE island inside `<nav>` (after Upload): the nav link `[data-open-facade]`
  renders ONLY with `?facade` in the URL (the delegation always binds — harnesses); the overlay root `.uf.ff` (input `.ff input[type=file]`,
  photo-only, no model fork) and the docked panel `.pd.ff-panel` (`usePanelDrag("facade-photo")`) render through `createPortal` to body
  (the nav is `position: fixed; z-index 10`). Panel: HEADING (encoder, the PhotoDetailPanel rAF rate loop) · PITCH ±45 · ROLL ±30 ·
  FOCAL 8–400 (+ the derived H-FOV) · ALTITUDE 0–60 · NUDGE N/S/E/W with 0.5/1/5 m chips + the live lat/lon · PROJECT ON BUILDINGS
  (aria-pressed) · STRENGTH · OWN LIGHT ("0 = lit by the scene · 100 = the photo's own colours") · PLANE (0 hides the preview plane) ·
  RESET TO EXIF · ← REVIEW / START OVER / ✕ CLOSE. Escape acts only on this store.
- `scene/photoProjector.ts` — `attachPhotoProjector(scene, {renderer, osmClipPlanes})` → `{feed, setSource, update(geom, nowMs),
  markDepthDirty, snapshot, dispose}`. The photo: `fetch(blob)` → `createImageBitmap(blob, {imageOrientation:"from-image"})` (fallback
  without the option) → a second bitmap resized to `maxTexturePx` 2048 on the long edge → `THREE.Texture` SRGB + mips + anisotropy 8;
  `flipV` 1 (an ImageBitmap's row 0 is v 0 — three skips UNPACK_FLIP_Y for bitmaps). The camera: `projectorOptics(geom)` derives
  vFov/aspect/planeDist from the far-face CORNERS of the same `frustumGeometry` the wireframe draws (round-trips `verticalFovDeg` to
  1e-6); `projectorMatrix` = bias·P·V (float64). The depth map: `WebGLRenderTarget(px, px/aspect, {RedFormat, UnsignedByte, depthTexture:
  DepthTexture(UnsignedIntType)})` — pass 1 the enriched layer 31 through a plain `MeshDepthMaterial(DoubleSide)`, pass 2 the OSM layer
  30 through one carrying the OSM clip prism (`clipIntersection`) so the bbox hole stays a hole; `shadowMap.autoUpdate=false` + `autoClear`
  + `scene.background` + the previous target all restored (the A2-2 bracket). Re-rendered when the pose changes (a 9-float compare),
  on `markDepthDirty` (the tilesets' `load-model`/`dispose-model`), else every `depthRefreshMs` 500.
- `scene/buildingMaterial.ts` — `PhotoProjectorFeed` + eight `uFtwProj*` holders + `setPhotoProjector(feed)` on the set; the per-pass
  sync (OFF → `uFtwProjOn` 0 AND the two samplers nulled — a disposed bitmap left bound re-uploads as "source data detached"); the GLSL
  block at `<normal_fragment_maps>` (after the flat `normal`, before `lights_physical_fragment` copies diffuseColor): `ftwC = M·(-vViewPosition)`,
  in-frustum masks (no branches — `textureLod` for the depth, `textureGrad` with derivatives taken in uniform flow for the photo), edge
  feather 0.03, facing `abs(dot(normal, normalize(apexV − pV)))` smoothstep 0.12→0.32, the METRIC depth compare (`ftwProjLinDepth`,
  bias 0.35 m × (1 + 4·(1−facing)) + 0.0004·range), the 600 m range fade (last 20 %), the LIT half `diffuseColor = mix(…, photo,
  K·(1−ownLight))`; the OWN-LIGHT half at `<opaque_fragment>` between the T125 floor and `ftwAerial`: `gl_FragColor = mix(…, ftwProjRgb,
  K·ownLight)`. Byte-identical when off (`ftwProjK` 0.0 → `mix(x, 0, 0)`).
- `scene/buildings.ts` + `enrichedBuildings.ts` — `setPhotoProjector(feed)`, `c.layers.enable(PHOTO_PROJECT.depthLayerOsm|Enriched)` at
  load-model, `clipPlanes()` on the OSM handle (the prism hoisted to a module `let`).
- `PhotoFrustum.ts` — `opts.source?: FrustumSource` (`{getState, subscribe}` over `FrustumSourceState` = the upload store's field names +
  `rollDeg?`); the default `useUploadStore` path byte-identical; `rollDeg: s.rollDeg ?? s.exif.rollDeg ?? 0`; the subscription compares
  `rollDeg` too.
- `StylizedTiles.ts` — `facadeFrustum` (source the facade store; `onPlaced` stands the explore journey + slider targets down, cuts to
  `frameArrivalPose(geom, placement)` — the pose fn now takes the placement, default the upload store's — and arms the corrector);
  `photoProjector` under `hqAllowed` only (null on /m + coarse pointers); `pushFacadeSource` on phase/previewUrl/projection change;
  tile events → `markDepthDirty`; `stepPhotoProjector` (the facade resnap on the FRUSTUM cadence + `update`) and `stepFacadeArrival`
  (the pin re-framing's twin: resnap every frame while armed, settle 12 frames, re-cut on a > 10 m look drift OR the camera > 3× the
  arrival altitude off the pose; disarmed by a grab/FPV/explore/targets/6.5 s/3 re-cuts) in the frustum band after FrustumResnapAndTick;
  click-to-place after the pin's branch; `placingNow` + the crosshair; `__globe.facadeFrustum` + `__globe.photoProjector()`; dispose.
- `tuning.ts` `PHOTO_PROJECT`: nearM 1 · farM 3000 · depthMapPx 1024 · depthBiasM 0.35 · depthBiasPerM 0.0004 · facingLo/Hi 0.12/0.32 ·
  edgeFeather 0.03 · rangeM 600 · rangeFadeFrac 0.2 · maxTexturePx 2048 · anisotropy 8 · depthRefreshMs 500 · depthLayerOsm 30 ·
  depthLayerEnriched 31 · strength 1 · ownLight 0.6 · gain 1.

## Verification
- vitest **3,424 / 227** (+56) · `astro check` **0 / 0 / 27 hints** · fences green (no store import in `scene/photoProjector.ts`;
  `buildingMaterial.test` pins the block: eight declared = eight bound uniforms, the anchor order, `textureLod`/`textureGrad`,
  `-vViewPosition` and never `vFtwWPos` inside the block, the own-light line between the floor and the haze, the vertex shader free of
  `uFtwProj`, the per-pass sync keyed on frame+camera).
- `scripts/verify-photo-projection-2026-10-18.mjs` **10/10** on the house Chrome (`?facade=1#p=48.4647,35.0462,1500,25,55&t=…` — the
  `legacy-fpv-eye` street pose, daylight pinned): boot + the desktop gate · the nav link + `.uf.ff` · the fixture → REVIEW (heading 25,
  GPS exact, 1600×1200) · place → apex 87.6 m above the ellipsoid, 0.000 m off; snapshot on / tex 1600×1200 / depth **1024×768** /
  vFov **54.88°** / aspect 1.333 · PIXELS at a close pose: ON vs OFF **+3,804 saturated px, 10,389 px changed**, the ON/ON control
  0.31 mean · ownLight 1 vs 0: 12,166 px changed · a 2 m N nudge → apex **1.999 m**, depthRenders +1 · frame cost **p95 16.7 vs 16.7 ms**
  · the pin flow untouched (upload idle, pin frustum null, no `.uf:not(.ff)`), `clear()` tears down · console clean (0 errors, 0 GL).
  Shots `verify-shots/photo-projection/` (`close-on.png`: the grid's cell 24 legible on a tower; `orient-0{1,2}-alt25-*.jpeg`: blue/yellow
  low, red/green high — the orientation is right).
- The fixture: `test/fixtures/facade-pattern.jpg` (147 KB, committed) from `scripts/fixtures/make-facade-pattern.py` + the exiftool line in
  its docstring (GPS 48.4647/35.0462, heading 25, 26 mm eq, `ExifImageWidth/Height` 1600/1200 — WITHOUT those tags a native JPEG has no
  `textureWidth` and the frustum falls back to aspect 1.5 → T167).

## Defects met on the way (both fixed; the third recorded)
1. GL warnings after `clear()` (`texSubImage2D: The source data has been detached` · `glTexStorage2D` non-positive · `generateMipmap`):
   the disposed photo's closed ImageBitmap stayed bound in `uFtwProjMap` → the OFF branch nulls both samplers now.
2. **The 23 km lift.** Frame trace after `place()`: 957 km → the cut lands at 204 m → the NEXT frame 23,354 m, stable;
   `controls.adjustHeight=false` keeps 204 m → GlobeControls' height raycast against a coarse ground tile. The PIN flow has the same lift
   (traced: 204 → 23,355 → 228 m at frame 60 — rescued by its arrival re-framing ONLY because the look point drifted > 10 m when the
   terrain refined) → T166. The facade flow's `stepFacadeArrival` adds the "lifted" trigger; measured 204 → 228 → 273 m.
3. The welcome's EXPLORE journey keeps the camera at cruise through a pin placement's cut (pre-existing); the facade `onPlaced` stands it
   down (`setExplore(false)` + `clearAllTargets()`), the same hand-off `noteInteract` performs for a grab.

## Traps (new)
- A `smoothFlights(true)` sweep from orbit never moved the camera in the probe (the cut path did) — untraced; the cut + corrector is the
  shipped path. · `createImageBitmap(blob)` applies EXIF orientation only with `imageOrientation: "from-image"`; the frustum's aspect
  still comes from the EXIF dims (unrotated) — a portrait phone frame squashes (T167). · The harness thresholds: a whole-frame mean is the
  wrong instrument for a facade-sized signal — count saturated-pixel gain + changed px and keep an ON/ON control. · `?facade` is read
  once at mount; `data-open-facade` always binds.

## Open for the owner
The look: own-light 0.6 by default (0 = sun/shadow-lit paint, 1 = the photo's own colours) · the 600 m range · a real street photo of
his own through `?facade=1` (never committed — C6) · FPV at the apex for alignment (T168) · the mobile twin (by order, later).
Backlog: T157 BUILT (prototype) · T165 the per-draw uniform limit · T166 the instant-cut lift · T167 orientation/dims · T168 the tails.

## 2026-10-21 — the owner's read: "looks promising" → the FULL DESKTOP FLOW ordered (plan only, DECISIONS 2026-10-21)
`rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md` — F1 the gizmo (move / rotate / SCALE = H-FOV, under the mesh gain; sliders stay) ·
F2 persist (`FacadePhotos`: pose + params + Media ids + `targetFeatureIds` + `alignment`; private by default) · F3 residency (K slots for the
nearest in-view photos, markers for the rest) · F4 textures (a 2048-px display JPEG made client-side + a thumb + the original; live
RGBA8+mips 12.6 MB per slot; levers: `sampler2DArray` (UNVERIFIED on 0.185), KTX2/Basis (encoder speed UNVERIFIED), crop-to-building) ·
F5 alignment hooks (per-building association at save, uv↔corner pairs, PnP later; photogrammetry inputs only) · F6 the mobile twin last.
Backlog T169–T172. Owner: hundreds, maybe thousands per city; not huge, not blurry; "I didn't like editing frustum position".
**Answered 2026-10-21:** release HOLDS until SAVE + edit/remove (F2) — dev-only behind the flag till then; desktop may spend 100+ MB of GPU
(sharpness wins); MOBILE / the iPhone must not degrade — the projector stays behind `hqAllowed` until a farm-measured tier (K=1–2, a
1024-px live texture from the 2048 stored derivative, KTX2 if viable, depth re-renders on pose change only).
**Scope order:** the next big session = research, then F1 + F2 + F3 together, shipped + tested, subagents per slice (owner 2026-10-21).
