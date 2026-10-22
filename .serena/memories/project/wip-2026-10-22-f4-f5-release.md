# wip 2026-10-22e — F4 textures (T170) + F5 alignment hooks (T172) + T186 → v1.36.38 LIVE with the ten owner asks (DONE)

Mode: implement · Tier: deep · Memory: serena. Owner order 2026-10-22c ("do F4 and F5 in the next session"), then a release so the
owner reads T174–T183 on the live site, then T186. One Fable session + 4 Opus research maps (the three 0.185 array-texture source audit ·
the projector / material code map · the F5 pick path · the KTX2 facts) + 2 Opus build agents on exclusive file sets (F5's pure half + the
store plumbing · the two projector test files); the main session owned the scene files, the orchestrator, the browser probe, the new
harness, the ship and the release. Record: DECISIONS 2026-10-22e (the build) + 2026-10-22f (the release) · NEXT_SESSION_PROMPT · backlog
T170 / T172 / T186 BUILT · `conventions/globe-tuning.md` §PHOTO_PROJECT · the plan §3 / §4 status notes · `mem:core`.

## Boot (02:40 EEST)
- The 2026-10-22d work (57 files) was NOT shipped: the session-end hook ABORTED at 02:40:16 ("vitest FAILED") — a timing flake under
  the booting session's load; the baseline alone was 3,708 / 243 green in 26 s → shipped in the foreground hook as PR #150 (8038f9d).

## F4 — the array route (file → the law)
- Browser probe first (scratchpad `probe-f4-array-texture.mjs`, the house Chrome, three 0.185, ANGLE Metal / M3 Pro): `DataArrayTexture(null,
  2048, 2048, 6)` + `source.dataReady = false` + `renderer.initTexture` = a storage-only allocation (0.6 ms, GL error 0);
  `renderer.copyTextureToTexture(bitmapTex, arr, null, (0,0,layer))` uploads an ImageBitmap into a layer in ~24 ms incl. the WHOLE array's
  mip regeneration; `textureGrad(sampler2DArray, vec3(uv, layer))` samples right (no flip for bitmaps); `maxTextures` 16 · `maxAniso` 16 ·
  `MAX_ARRAY_TEXTURE_LAYERS` 2048; a depth ARRAY target is unsupported in three's WebGL backend → K depth samplers stay.
- `tuning.ts`: `PHOTO_PROJECT.slots` 6 · `layerPx` 2048 (replaces `maxTexturePx`; every photo STRETCHED to the square layer by one
  non-uniform `createImageBitmap` resize (~43 ms off-thread) — the uv is the photo's own frame, no long edge lost, no sub-rectangle;
  22.4 MB per layer, 134 MB at K 6 — the desktop ruling; F6 sets 1024). Units 3 + 1 + K = 10 at K 6 (was 3 + 2K, ceiling 6).
- `scene/buildingMaterial.ts`: `uFtwProjPhotoArr: { value: DataArrayTexture | null }` (ONE `highp sampler2DArray`; `uFtwProjMap[K]` gone),
  `PhotoProjectorSlot.layer` (−1 = none; replaces `map`), `PhotoProjectorFeed.photos`; the pack: `s.on && s.layer >= 0 && s.depth`, copies
  `slot` then writes `uFtwProjSlot[n].y = s.layer` (the packed index is NOT the layer), binds the array while ≥ 1 slot is live else null;
  GLSL `vec2 ftwSampleUv = vec2(ftwUv.x, 1.0 - ftwUv.y); textureGrad(uFtwProjPhotoArr, vec3(ftwSampleUv, ftwS.y), …)`.
- `scene/photoProjector.ts`: `ensurePhotoArray()` lazily on the first load (sRGB, mips, trilinear, clamp, anisotropy — set BEFORE the
  allocation; `initTexture`); `SlotRec.layer` = the pool index (fixed; `setPriority` reorders the feed only), `textureReady`, `textureSize`
  = the DECODED dims; `loadTexture` = decode → stretch → `copyTextureToTexture` in a try / `bmp.close()` in finally → `feed.layer`;
  `dropTexture` only clears the flags (the layer is overwritten on reuse); `snapshot().photoArray { layerPx, layers, bytesMB }` + `slots[].layer`;
  `dispose()` frees the array. `flipV` is vestigial (the 2026-10-18 harness reads it).
- KTX2 NO-GO for v1 stands (DECISIONS 2026-10-21: 5.5–7.6 s ETC1S / 12.5 s UASTC on the M3; ETC1S lands as 8-bpp BC7 on desktop — zero
  desktop gain) — revisit with F6 after a worker-threaded encode measurement.

## F5 — the probe at save
- `lib/globe/facadeTargets.ts` (pure): `rayGridDirections` (7 × 5 inset cell centres), `sampleFacadeTargets` (first-seen de-dup; the caps
  200 / 80 chars / 8 KiB), `osmTargetId("way", 123) → "osm:w123"`, `enrichedTargetId` (osm over `overrideKey`), `registerFacadeTargetProbe`
  / `probeFacadeTargets` (last wins; a throwing probe → null). `lib/globe/buildingHit.ts` (pure, three-typed): `osmElementOfHit` — `_batchid`
  (or `_feature_id_0`) `.getX(face.a)` → the tile root's `batchTable.getDataFromId` → `3DTILES_batch_table_hierarchy.Building`
  `elementType` / `elementId` (PROBED on ion asset 96188: the tiles are b3dm, `getKeys()` is EMPTY, the hierarchy holds everything; a flat
  row works too).
- Scene: `enriched.featureOfHit(hit)` (the resolve `pickBuilding` shares — `resolveHit`; `pickable` = the RC17 class fence),
  `buildings.osmIdOfHit(hit)` (delegates to the lib). Orchestrator: `castFacadeTarget` — a Raycaster on layers 30 + 31 over both tile
  groups, the nearest building per ray, an OSM twin inside `enrichedBbox` skipped (three ignores clipping planes), a non-pickable class
  occludes and yields null; `registerFacadeTargetProbe` under the projector only (`unregisterFacadeTargets` at dispose); DEV seam
  `__globe.facadeTargets()` (null while nothing is placed).
- Store: `saveFacade` / `updateFacade` pull `probeFacadeTargets()`; `buildSaveFacadeBody` writes `targetFeatureIds` (`[]` when null);
  `buildUpdateFacadeBody` includes it only when NON-EMPTY (a re-save before the tiles stream in must not wipe a good set). MY CONTENT ·
  TEXTURES `facadeRowSub` appends `· N BLDG`.

## T186
- `onPlaced` inside FPV: `requestFpvJump({ lat/lon of geom.apex, eyeM = apex altM − clampGroundM(ground.heightAt), headingDeg / pitchDeg from
  geom.forward in the ENU basis, fovDeg = verticalFovDeg(horizontalFovDeg(optics.vFovDeg, optics.aspect), camera.aspect) })` — for a saved row
  AND a fresh upload placed while walking (one rule; the owner may want only the former).

## The numbers
- vitest 3,741 / 245 (+33) · astro 0/0 · `verify-photo-projection` 10/10 (PIXELS PASS, p95 16.7 = 16.7 ms) · NEW `verify-f4-f5-2026-10-22`
  6/6 (array 2048² × 6 = 134.2 MB, the draft in layer 0, decoded 1600×1200 kept · 4 buildings `osm:w…` at the fixture pose · T186 12 m →
  0.01 m, 0.17° off forward, fov 46.8 = the want) · `verify-owner-asks` 10/10 · `verify-facade-flow` the ten dev-runnable legs.
- Released v1.36.38 (`release:full --skip-gates`, 242-byte comment): `verify-facades-live` 11/11 incl. the deployed-UI leg (MENU → MY
  CONTENT → TEXTURES → OPEN → the panel, 5.3 s) · `verify-live-deletes` 17/17 · the live `StylizedTiles.DZfVPrEI.js` carries
  `uFtwProjPhotoArr`, `sampler2DArray`, `3DTILES_batch_table_hierarchy`, `copyTextureToTexture`; `tuning.*.js` carries `layerPx`.

## Traps (new)
- three's texture-cache KEY holds mips / filters / anisotropy — set them BEFORE the allocation, never change them (a change re-creates the
  GL texture and silently drops every layer); never set `needsUpdate` on the array after the allocation; a layer upload regenerates the
  WHOLE array's mips (~24 ms).
- A JS default parameter swallows an explicit `undefined` in a test fixture — pass `null`.
- The facade-flow harness's skip is the ENV `FTW_FF_SKIP_SAVE=1` (not a flag); its boot bar pins capacity 6; the owner-asks hover bar
  floors the marker base at `markerMinM` 0.5 (the retired 3 m made it fail).
- `verify-facades-live` does NOT launch the house Chrome — bring it up first or leg 9 is SKIPPED.
- The session-end ship can abort on the timing flakes while the next session boots — read the ship log's tail at boot.

## Open / next
The owner's live read of v1.36.38 (taste points in NEXT_SESSION_PROMPT, incl. K 6 / 134 MB, `· N BLDG`, the FPV jump on a fresh upload) →
T184 / T185 → F6 the mobile twin → F5's next rungs (the uv rectangle → crop-to-building, the alignment pairs + PnP) → T166 · T165 · T167 · T164.
Related: `mem:project/wip-2026-10-22-owner-asks-t174-t183` · `mem:project/wip-2026-10-21-facade-flow-f1-f3` · `mem:core`.
