# WIP 2026-07-13 — Dnipro enrichment Slice 2 REST (clip-hole · stylization · full-city · R2 tooling) — DONE

**Mode:** implement (Standard), `/frame` + investigate-design-v3. **Gates: astro check 0/0 · vitest 459
(+11) · wix build Complete · browser-VERIFIED in `wix dev` via Playwright MCP.** Shots:
`verify-shots/slice2-04..08` (full-city overview · west-edge east view · NW boundary OSM-vs-enriched ·
28 km clip-hole · 11 km full-city daylight).

## What shipped

### (b) Clipping-plane hole — the straddle-leak fix (pixel-exact)
- Pure `bboxClipPrismEcef(bbox)` in `lib/globe/enrichedMask.ts`: 4 ECEF planes, signed distance
  NEGATIVE inside the box for all 4. E/W walls = EXACT constant-longitude planes through the Earth
  axis (normal = ∓east, constant 0). N/S walls = tangent planes to the constant-lat cone at the
  centre longitude — ~2 m corner error over the 7.4 km box (unit-gated < 3 m), EXACT along altitude
  (north ⊥ up). +6 tests (inside/outside/far/antipode/unit-normals/corner-error).
- `buildings.ts`: planes → BOTH shared OSM materials (fill + edge) with `clipIntersection=true`
  (three discards ONLY where ALL 4 are negative = the box interior) + `clipShadows=true` (clipped
  buildings must not cast phantom shadows into the hole) + `renderer.localClippingEnabled=true`;
  ALL gated on `maskBbox` → no enrichment = byte-identical. Planes are STATIC (world == ECEF; the
  OSM tiles group is never translated).
- The stop-traversal centre mask STAYS — it's the bandwidth/LRU win; the clip planes only catch the
  coarse ancestors it structurally can't.
- Live-verified: OSM fill {planes:4, intersection:true, shadows:true} + edge {4, true}; enriched
  material 0 planes; box core CLEAN of OSM at 28 km; dense OSM just outside the NW corner survives.

### (c) Stylization reconcile — ONE construction, TWO instances
- NEW `scene/buildingMaterial.ts` = `createBuildingMaterials({edgeColor?, edgeOpacity?})` → the whole
  former buildings.ts material block: fill (surface/land, flatShading, polygonOffset) + edge
  (landHi) + chained onBeforeCompile (R2 tone keyed `_batchid + _feature_id_0 + uFtwTileSeed`,
  dormant R3 night emissive, F1 bayer fade-discard, FPV ghost distance curve) + the persistent
  uniform holders.
- `buildings.ts` consumes it behavior-identically (destructures the same uniform names).
- `enrichedBuildings.ts` swaps its plain MeshStandardMaterial for its OWN instance. **Separate
  instances are REQUIRED, not an accident: the clip prism lives on the OSM instance and the enriched
  set is INSIDE the prism — literal sharing would clip it away.** Enriched adds per-tile
  birth+seed onBeforeRender writes, `uNowMs` advance in update(), and a NEW `setNight(sunElevSin, up)`
  mirroring BuildingsHandle; `StylizedTiles` fans the ONE ephemeris sample to both. setSolidity
  (FPV slider) kept as-is — opacity multiplies through diffuseColor.a with uGhostK=0, no conflict.
- `ENRICHED.debugDistinctEdges=false` (edge accent → landHi). Baker feature ids are GLOBAL across
  the bake (bake.mjs `featureId++` across cells) → true per-building tone.
- Live: enriched attrs = [position, normal, _feature_id_0]; injected shader live (uFtwTileSeed in
  onBeforeCompile source); boundary reads as one city.

### (e) Full-city bake
- `cities/dnipro.json`: bbox [35.00,48.42,35.10,48.50] (~7.4×8.9 km), grid 7→10 (cell ~0.74×0.89 km
  — also shrinks the ±10 m within-cell relief limit), tilesetVersion dnipro-real-2; `ENRICHED.bbox`
  synced. Fresh Overpass fetch worked.
- **26,996 footprints → C6 excluded 72 (53 substations/1 plant/5 generators/13 transformers) →
  26,569 buildings · 90 tiles · 1,169,172 verts · 32.82 MB · maxH 167 m.**
- Live: all 90 cells stream; verified LRU evict + re-stream (90 → 42 → 0@28 km → 90@11 km); group
  lift 98.06 m ≈ terrain@centre; per-cell reseat machinery untouched (90 cells registered).

### (d) R2 tooling (hosting = OWNER-GATED, verification_blocked)
- NEW `scripts/bake/upload-r2.mjs` + `scripts/bake/lib/s3sign.mjs`: pure-Node AWS SigV4 PUTs to the
  S3-compatible R2 endpoint (path-style, region "auto"; 3 signed headers; real payload hashes; no
  SDK/wrangler — npm blocked here). Env R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/
  R2_BUCKET (+R2_PREFIX). `--dry-run` verified: 92 files · 31.32 MB. +5 tests (`test/bake/s3sign.test.ts`).
- REMAINING OWNER ACTION: create bucket → custom domain (r2.dev = NO CORS) → CORS policy
  (`dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md` §Recipe) → run the uploader → point `PUBLIC_ENRICHED_TILES_URL` at
  `https://<domain>/enriched/dnipro/tileset.json`. Recipe: `scripts/bake/README.md` §Hosting.

## Traps (load-bearing)
- **Stale HMR after extracting module-level consts to a new module:** the RUNNING dev server kept
  serving an old transform of `buildings.ts` → runtime `ReferenceError: FTW_BAYER_GLSL is not
  defined` from onBeforeCompile EVERY FRAME (185 errors), while the on-disk file was clean.
  RESTART `wix dev` (the known Vite optimize-dep desync; client reload can't clear it). Check the
  stack's `?t=` timestamp vs your edit time to spot it fast.
- three clip semantics: `clipIntersection=true` discards where ALL planes are negative — build the
  prism so INSIDE is all-negative. `-0 !== +0` under vitest `toBe` (Object.is) — the negated east
  z-component.
- `window.__globe` seams: OSM tiles = `__globe.tiles` (NOT `.buildings`); enriched = `__globe.enriched`.
  `requestFly` ignores headingDeg → follow with `setTargetHeading/Tilt`. Scene time via
  `__timeStore.getState().setTime(ms)` / `goLive()` — a reload resets it, so steer the camera via
  `__cameraStore`, not URL hops, when time is pinned.

## Known limits / next
- **No HLOD:** above ~20 km the enriched set SSE-culls to nothing and the box renders EMPTY of
  buildings (OSM in-box is now correctly clipped) — honest trade; add a coarse-LOD tier if the
  high-altitude look matters. At ≤12 km all 90 cells render.
- Sub-M3 laptop + phone FPS benchmark (<150 MB resident DoD) still open — no such device here.
- Slice 3 (trees) → Slice 5 (feed Pass-3 obstruction moat) are the plan's next slices.

## Files
`scene/buildingMaterial.ts` (NEW factory) · `scene/buildings.ts` (consume + clip prism) ·
`scene/enrichedBuildings.ts` (factory instance + setNight) · `StylizedTiles.ts` (setNight fan-out) ·
`tuning.ts` (bbox + debugDistinctEdges=false) · `lib/globe/enrichedMask.ts` (`bboxClipPrismEcef` +
`planeDistance`) · `scripts/bake/cities/dnipro.json` · `scripts/bake/upload-r2.mjs` (NEW) ·
`scripts/bake/lib/s3sign.mjs` (NEW) · `scripts/bake/README.md` · `test/lib/globe/enrichedMask.test.ts`
(+6) · `test/bake/s3sign.test.ts` (NEW +5).

Related: [[project/wip-2026-07-13-terrain-reseat]] [[project/wip-2026-07-13-dnipro-slice1-bake]]
[[project/wip-2026-07-13-dnipro-slice0-spike]] [[patterns/globe-rendering]]
