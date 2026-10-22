# wip 2026-10-22e — F4 textures (T170) + F5 alignment hooks (T172) + T186 + the RELEASE of the ten asks (IN PROGRESS)

Mode: implement · Tier: deep · Memory: serena. Owner order 2026-10-22c ("do F4 and F5 in the next session"), then a release so the
owner reads T174–T183 on the live site, then T186. One Fable session + 4 Opus research maps (three 0.185 array-texture source audit ·
the projector / material code map · the F5 pick path · KTX2 facts) + 2 Opus build agents (F5's pure half + store plumbing · the two
projector test files); the main session owned the scene files, the orchestrator, the probe, the harness.

## Boot (02:40 EEST)
- The 2026-10-22d work (57 files) was NOT shipped: the session-end hook ABORTED at 02:40:16 ("vitest FAILED") — a timing flake under
  the booting session's load; the baseline alone was 3,708 / 243 green in 26 s → shipped in the foreground hook as PR #150 (master
  8038f9d, package 1.36.37). Two stale remote ship branches were already gone.

## F4 — decided + built (the array route)
- Browser probe (the house Chrome, three 0.185, ANGLE Metal / M3 Pro; scratchpad `probe-f4-array-texture.mjs`): `DataArrayTexture(null,
  2048, 2048, 6)` with `source.dataReady = false` + `renderer.initTexture` = a storage-only allocation (0.6 ms, no GL error);
  `renderer.copyTextureToTexture(bitmapTex, arr, null, (0,0,layer))` uploads an ImageBitmap into a layer in ~24 ms incl. the WHOLE
  array's mip regeneration; `textureGrad(sampler2DArray, vec3(uv, layer), …)` samples every layer right (no flip for bitmaps — row 0 at
  v 0); `maxTextures` 16, `maxAniso` 16, `MAX_ARRAY_TEXTURE_LAYERS` 2048; a depth ARRAY target is unsupported (no layered depth
  attachment in three's WebGL backend) → K depth samplers stay.
- Built: `PHOTO_PROJECT.slots` 6 · `layerPx` 2048 (replaces `maxTexturePx`; every photo STRETCHED to the square layer — the uv is the
  photo's own frame, no loss of the long edge; 22.4 MB per layer, 134 MB at K 6 — the owner's desktop ruling) · `buildingMaterial`:
  `uFtwProjPhotoArr` (one `sampler2DArray`; `uFtwProjMap[K]` gone), `uFtwProjSlot[n].y` = the LAYER (written from `slot.layer` by the
  pack — the packed index is not the layer), the v-flip a constant · `photoProjector`: the lazy array, `SlotRec.layer` = the pool index
  (fixed), `textureReady`, `textureSize` = the DECODED dims, `snapshot().photoArray {layerPx, layers, bytesMB}`, `dispose` frees it;
  the bitmap closes in a `finally` after the copy. Texture units: 3 + 1 + K = 10 at K 6 (was 3 + 2K).
- KTX2: NO-GO for v1 stands (DECISIONS 2026-10-21: 5.5–7.6 s ETC1S / 12.5 s UASTC on the M3; ETC1S lands as 8-bpp BC7 on desktop —
  zero desktop gain) — revisit with F6 (ETC1S → ETC2 4 bpp on the phone) after a worker-threaded encode measurement.
- Traps: three's texture-cache KEY holds mips / filters / anisotropy — set them BEFORE the allocation, never change them (a change
  re-creates the GL texture and drops every layer); never set `needsUpdate` on the array after the allocation; a default parameter
  swallows an explicit `undefined` in a test fixture (pass `null`).

## F5 — built (the probe at save)
- `lib/globe/facadeTargets.ts` (pure): `rayGridDirections` 7 × 5 inset cell centres, `sampleFacadeTargets` (first-seen de-dup, the server's
  200 / 80-char / 8 KiB caps), `osmTargetId("way", 123) → "osm:w123"`, `enrichedTargetId` (osm over the override key), the pull registry
  `registerFacadeTargetProbe` / `probeFacadeTargets`. `lib/globe/buildingHit.ts` (pure, three-typed): `osmElementOfHit` — the vertex's
  `_batchid` (or `_feature_id_0`) through the tile root's `batchTable.getDataFromId` → the `3DTILES_batch_table_hierarchy.Building`
  `elementType` / `elementId` (PROBED on ion asset 96188: `getKeys()` is empty, the hierarchy holds everything; the tiles are b3dm).
- Scene: `enriched.featureOfHit(hit)` (the resolve `pickBuilding` shares — `resolveHit`), `buildings.osmIdOfHit(hit)` (delegates to the
  lib). Orchestrator: `castFacadeTarget` — a Raycaster on layers 30 + 31 over both tile groups, the nearest building per ray, an OSM
  twin inside the enriched bbox skipped (three ignores clipping planes), a non-pickable class occludes and yields null; registered
  under the projector only; DEV seam `__globe.facadeTargets()`.
- Store: `saveFacade` / `updateFacade` pull `probeFacadeTargets()`; the save body writes it (`[]` when null); the UPDATE body carries it
  only when NON-EMPTY (a re-save with the tiles not streamed in must not wipe a good set). MY CONTENT · TEXTURES shows `· N BLDG`.

## T186 — built
- `onPlaced` inside FPV: `requestFpvJump` to the apex (lat/lon of `geom.apex`, `eyeM` = apex − ground, heading / pitch from the
  frustum's forward in the ENU basis, `fovDeg` = the photo's H-FOV at the live aspect) instead of returning — the My spot idiom.

## Gates so far
- vitest focused: projector 53/53 · facadeTargets 16 · buildingHit 4 · fences / markers / residency green · verifyHarness 10/10.
- astro check 0 / 0 (before the last seam edit — re-run at the end).
- Browser: `verify-photo-projection-2026-10-18` **10/10** on the array route (PIXELS PASS, frame cost p95 16.7 = 16.7 ms, 0 GL noise).
  `verify-f4-f5-2026-10-22.mjs` (NEW: boot · placed · F4 array facts · F5 targets · T186 · teardown) — RUNNING.

## Still to do this session
`verify-facade-flow --skip-save` · `verify-owner-asks` · full vitest + astro · records (DECISIONS 2026-10-22e, backlog T170 / T172 / T186
BUILT, NEXT_SESSION_PROMPT, mem:core, the plan doc) · ship · `release:full` · `verify-facades-live` + `verify-live-deletes` · close the
house Chrome + stop wix dev.
