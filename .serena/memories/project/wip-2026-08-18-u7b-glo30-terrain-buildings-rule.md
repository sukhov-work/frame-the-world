# WIP 2026-08-18 — U7b GLO-30 terrain patch SHIPPED + best-variant buildings rule (2026-08-18p)

Owner approved Appendix A #1 and pulled the bake ahead of U8; same order changed the buildings
policy (best variant by default; BLD/3D DETAIL = plain on/off; no user variant choice; terrain
has NO user control at all). Full record: DECISIONS 2026-08-18p. Mode: investigate-design-v3
implement/Deep + /frame; 4 research agents (terrain runtime 92% · bake/toggles 93% · installed
0.4.28 QMP source 90% · GLO-30/mago externals 93%).

## The design that shipped (rulings)
1. **Single-renderer composite** — new `scene/terrainPatch.ts`: wrap the QuantizedMeshPlugin
   instance's `createChild(level,x,y,available)` (available = ranges ARRAY, pass through
   untouched; wrap BEFORE registerPlugin inside the ion assetTypeHandler) and override
   `tile.content = {uri}` for serve-set tiles; a `fetchData` plugin at priority −500 claims
   patch URLs with plain fetch (QMP −1000 only claims its quantized_tile_split virtuals; ion 0
   never sees ours → Bearer never reaches R2; ion preprocessURL appends ?v= to EVERYTHING —
   harmless, the Worker keys on pathname). expandChildren counts forced content as REAL
   children → the quadtree descends past CWT's L13 over UA; out-of-set siblings stay
   virtual-clipped from the shared parent (the library's own seam machinery) + skirts
   (default = geometricError). Missing tile → dead leaf, parent renders, NO retry. heightAt /
   imagery drape / grade / fade / foveation / seat easing all untouched by construction.
   CWT layer.json maxzoom=19 ⇒ tiling.maxLevel already deep enough — NO generateLevels touch.
2. **Serve-set rule, pure + twinned**: `lib/geo/terrainTiles.ts` ⇄ `scripts/bake/terrain/tiling.mjs`
   (node can't import TS), pinned by test/lib/geo/terrainTiles.test.ts parity. z≤extentMaxDepth →
   FULLY INSIDE extentBbox; extentMaxDepth<z≤maxDepth → intersect cityBbox; else never.
3. **Rim blend POST-BAKE** (blend.mjs): verts within blendKm=3 of the extent edge pulled onto
   the DECODED CWT surface (w=smoothstep(d/blendKm): pure CWT at the edge). Splice rewrites
   ONLY the h-stream + header min/max (qmesh.mjs spliceHeights — u/v/indices/edges/extensions
   byte-identical; the renderer re-derives its culling region from header min/max at parse).
   Blend is a pure fn of (lon,lat,h) ⇒ parents/children/virtuals converge — pyramid consistent.
4. **Datum**: mago `--geoid EGM2008` (built-in 2.5′ grid) → ellipsoidal = CWT datum; geoid.mjs
   (bilinear 3×5 GeoidEval grid, N Dnipro ≈ 20.42 m) is the VERIFICATION twin only.
5. **Registry** `lib/globe/regions.ts` (bundled pure data; zero fetch): dnipro
   [variants "dnipro-o2w","dnipro"; terrain {path dnipro, extent [34,48,36,49], extentMaxDepth
   13, city = enriched bbox, maxDepth 13}] + st-albans ["st-albans-o2w"]. Replaces tuning
   ENRICHED.bbox/variantBboxes. `resolveEnrichedSelection(envUrl, search, bootLat?, bootLon?)`
   → {url,bbox,variant,regionId} in ONE call; boot-point region wins the default; `?enriched=`
   = dev seam (off/name/verbatim). BLD + ▦ 3D DETAIL → store/pref `buildings3d` (default on),
   folded into `stepMobileBuildingsGate` (now BOTH shells; desktop pref-ON byte-identical);
   `enrichedVariant` pref retired. Chips LIVE (setActive path) — reload mechanic gone.
6. Env: `PUBLIC_TERRAIN_TILES_URL` (prod: worker /terrain base; dev: /terrain middleware in
   astro.config — serveBakes factory now serves both /enriched and /terrain). Unset = pure CWT.

## Bake pipeline (scripts/bake/terrain/ — `npm run bake:terrain -- --city dnipro`)
fetch GLO-30 COGs anonymous (copernicus-dem-30m eu-central-1; WBM aux cached, 140 KB/tile) →
stage DEM-only dir (WBM must NEVER reach mago) → mago jar 1.14.2 (228 MB, sha256-pinned,
cached .cache/mago) → blend → prune deep outside city → layer.json post (attribution +
serve-set⊆availability assert; rewrite available[deep] to city range) → probe verify (decode
real tiles vs COG+geoidN + CWT rim) → patch-info.json + regions.ts snippet. Total run ~90 s
warm. Upload: `upload-r2.mjs --city dnipro --terrain` (recursive walk mode, prefix
terrain/<city>; s3sign contentTypeFor +.terrain → application/vnd.quantized-mesh). 7,329
files · 10.97 MB; Worker unchanged (path-agnostic).

## Measured (probe receipts)
- Bake: city-centre L13 9787/6301 = 188 verts (CWT was 4!), Δ 0.2 m vs COG+N; extent-mid
  Δ −0.7 m; rim continuity Δ −0.5 m vs CWT; blended 19,045 verts / 535 rim tiles.
- Browser (refined-state gated): city heightAt 120.4 (CWT) → 85.9 m; river transect min
  88–94 (CWT) → 68.9 m (GLO-30 band [60,84]; U7's +33 m river error GONE); 66 tiles/0 fail;
  o2w tileset streamed with NO param; BLD scene 33→31→33 live; /m twin flips; 34.0°E seam
  clean in daylight. Shots verify-shots/u7b-01..04. Gates 1,027/1,027 · astro 0 err/5 hints.

## TRAPS (cost real time this session)
- **geotiff.js writeArrayBuffer geo-tags are INVISIBLE to mago** (Java/GDAL side) — run-1
  mosaic landed at (−180, 90): NEVER rewrite DEM rasters in Node for mago; feed original COGs
  and do custom height work POST-BAKE on the .terrain tiles (splice idiom).
- **mago silently CLAMPS -max to its resolution heuristic** (30 m → 13; asked 14, got 13, no
  warning). The bake now warns + patch-info carries the real max; regions.ts must match.
- **mago layer.json available[] x-offsets looked broken in run-1** — artifact of the broken
  georef, NOT a mago convention. With correct COGs the ranges are plain global TMS.
- **Verify-too-early vacuous pass**: heightAt's raw down-ray hits whatever coarse ancestor
  exists (Raycaster ignores `visible`; coarse CWT reads tens of metres or NEGATIVE — the
  terrain.ts clamp discipline exists for this). verify-terrain-patch.mjs v2 gates on deep-tile
  URLs (L12/13) + 3 s-stable city sample in [60,220] before asserting. Node 20 needs
  `--experimental-websocket` for the raw-CDP scripts (verify.md says Node ≥22).
- Hash-only Page.navigate does NOT reload (app reads #p= at boot) — hop via about:blank.
- WBM aux tifs cached NEXT TO the DEMs — stage a DEM-only dir for mago or it ingests masks
  as elevation.

## Extras (Task-6 memo)
Horizon profiles / planFeed / occlusion upgrade AUTOMATICALLY (they march rendered heightAt).
WBM water masks cached for future river flattening; HEM (height error), hillshade/slope/
contours derivable from the same cached COGs at bake time. All deferred — the patch itself is
the planning uplift. WorldDEM Neo call: judge GLO-30 in-scene first (Appendix A #2 open).

## Open tails
Production canary rides the next `wix release` (R2 terrain serving curl-proven; CORS same
Worker as enriched). Owner taste pass on the patch in-scene (T1 device pass now also judges
terrain). U8 per-building height override NEXT (its "ground zero" reference is now real).
Cross-region mid-session enriched attach (fly Dnipro→St Albans without reload) = named tail.

Related: [[project/wip-2026-08-18-u6-foveation]] (U7 audit) · UPLIFT_PLAN §2/U7 + Appendix A ·
[[project/wip-2026-07-14-r2-hosting-osm2world-prep]] (R2/Worker) · DECISIONS 2026-08-18p ·
**`BAKED_ASSETS.md`** (2026-08-18q, owner ask — the canonical domain doc: rulings + regions
contract + pipeline + ops + GLO-30 aux layers; read it BEFORE re-deriving any of this).
