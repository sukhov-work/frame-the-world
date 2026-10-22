# mem:patterns/building-textures — a saved photo projected onto the buildings at runtime (F1–F6, live v1.36.42, 2026-10-23)

Design record: `.claude/claude-docs/rendering/ADR_BUILDING_TEXTURES_2026-10-23.md` (FINAL). Tunables: `conventions/globe-tuning.md`
§PHOTO_PROJECT. Wire: `conventions/contracts.md` (FacadePhotos, `/api/facades`). Textures are PUBLIC (T190); pins stay C6.

## The pattern
- **Persist the pose, never a bake.** Row = `lat lon apexAltM headingDeg pitchDeg rollDeg hFovDeg` + `displayUrl` (2048 JPEG q 0.82)
  + `thumbUrl` (512). The server copies URLs off descriptors it verified; a client never names a URL (`lib/wix/facadeRecords.ts`).
- **One material, K compiled slots.** `createBuildingMaterials({ photoSlots: K })` + `customProgramCacheKey = () => \`ftwProjK${K}\``
  (three keys a program on `onBeforeCompile.toString()`, blind to closures). K unrolled blocks, literal bound, no `continue`/`break`.
- **View-space matrix per PASS:** `uFtwProjFromView = bias·P·V_photo × camera.matrixWorld` (float64 CPU) applied to `-vViewPosition`,
  written in `fillMat.onBeforeRender` keyed on `renderer.info.render.frame` (`scene/buildingMaterial.ts` 275-318).
- **One photo array:** `DataArrayTexture(null, layerPx, layerPx, K)`, `source.dataReady = false` → storage only; per photo:
  decode → `createImageBitmap` stretch to the square layer → `renderer.copyTextureToTexture(src, arr, null, (0,0,layer))` (~24 ms)
  → `bmp.close()` (`scene/photoProjector.ts` 454-527). Depth = K separate R8 + depth targets at the apex, ≤ 1 render per frame.
- **Residency by the painted volume** (`lib/globe/facadeResidency.ts`): distance from the camera to the cone apex→range (0 inside),
  view-cone test on its sphere, fade over the last third of `slotRangeM` 3,000, keep margins both ways; plan every 12 frames.
- **Tiers:** `photoProjectFor(lean)` once at attach (`tuning.ts` 3759): desktop K 6 + draft slot 0, 2048 px, 134 MB; lean (/m or
  coarse pointer) K 2 draftless, 1024 px, 11.2 MB, view-only; the tap peek only on `isMobileShell` (`StylizedTiles.ts` 1890-1915).
- **Save walk** (`store/facadeSave.ts`): original TUS private (failure = warning) → derivatives client-side → display PUT (required)
  → thumb PUT (degrades) → 7 × 5 ray-grid `targetFeatureIds` → POST; re-POST on 409 `FILE_NOT_READY` 6 × 1.5 s (T194).

## Traps
- three's texture-cache KEY includes mips / filters / anisotropy: set before allocation, never after (a change drops every layer);
  never `needsUpdate` the array after allocation.
- A non-ShaderMaterial uploads uniforms only on a material / program / camera switch: never write a per-draw uniform (T165).
- Never project `vFtwWPos` (float32 ECEF swims ~0.5 m: 4.2e-3 vs 3.2e-7 uv).
- ImageBitmaps ignore `flipY`: the shader flips v; null the samplers when off (a closed bitmap re-uploads as "detached").
- `scene.overrideMaterial` drops the OSM clip prism; bracket `shadowMap.autoUpdate` around the depth render (A2-2) and restore
  the render target.
- The pose signature is 21 floats (apex, forward, up, 4 corners): SCALE moves only the corners (T174).
- No layered depth attachment in three's WebGL backend: depth stays K `sampler2D`s (units 3 + 1 + K).
- `lib/geo/pnp.ts` frames are `[right, DOWN, forward]`; `frustumGeometry`'s `[right, up, forward]` is left-handed (mirror pose).
- `wix dev` cannot elevate (T173): persistence is proven only live (`verify-facades-live.mjs`, 12/12 on v1.36.42).
- Not measured: a real phone (PLAN:106-107), the desktop shader cost (vsync-capped), real-photo PnP accuracy. `REMOVED` is never
  set by code; the only takedown is a dashboard edit.

Related: [[patterns/photo-frustum]] [[patterns/globe-rendering]] `mem:project/wip-2026-10-22-f4-f5-release`
`mem:project/wip-2026-10-23-owner-asks-build-t187-t191-f6`
