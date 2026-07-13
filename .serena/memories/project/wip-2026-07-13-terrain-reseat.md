# WIP 2026-07-13 — Terrain elevation / PER-CELL re-seat (Slice 2 head, owner #4) — DONE

**Mode:** implement (Standard), `/frame` + investigate-design-v3. **Gates: astro check 0/0 · vitest 448
(+6) · wix build Complete · browser-VERIFIED in `wix dev` via Playwright MCP.** Shots:
`verify-shots/slice2-01..03` (overview · night slope · daylight slope).

## What shipped
Owner #4 ("all buildings basically at water level"): the enriched tileset was lifted by ONE
`terrainHeightAt` sample at the bbox centre → a flat plane over the ~5.9×6.3 km bake. Now each grid
cell (a separate leaf tile; all 46 share ONE ENU→ECEF root transform) ADDITIONALLY offsets its scene
along ITS OWN geodetic up by `(terrain@cell-centre − centre seat)`:
- **Register** on `load-model` from the tile's raw `boundingVolume.region` (`regionCenterDeg` — new
  pure helper in `lib/globe/enrichedMask.ts`); record `{scene, latDeg, lonDeg, up, basePos, seatM,
  appliedM}`; swap-pop off the list on `dispose-model` (LRU-evicted cells re-register cleanly — the
  library re-decomposes the transform each load).
- **Sample** round-robin `ENRICHED.reseatSamplesPerFrame` (6) cells/frame — bounds the raycast cost
  (46 cells sweep ≈8 frames); sticky-last-good + `clampGroundM` (the S2 null/negative discipline);
  gated on `reseatToTerrain && reseatPerCell` AND a real bbox-centre sample (unsampled cells sit on
  the centre plane = exactly the old behavior — graceful degrade).
- **Apply** `scene.position = basePos + up·seatStep(applied, seat−centreSeat, reseatEaseK 0.12)`;
  first sample SNAPS (cell is still streaming in), refinements EASE; skip writes when settled <1 cm.

## Measured (browser, 41 loaded cells)
Per-cell offsets == terrain deltas within ~0.2 m. Spread **−20.6 m (riverbank) → +82.0 m (SW hills)**
— 102 m of relief that was previously one plane. Group lift 98.64 m == terrain@bbox-centre. **CWT
renders real elevation over Dnipro** (probe: riverbank 75.6 / centre 98.6 / SW hills 175.2 /
left-bank 82.1 m) — the "flat ground" was purely the buildings' single-plane seat. Frame-of-ref open
question RESOLVED empirically: offsets are applied in the GROUP frame along the cell's geodetic up
(identical construction to the verified whole-group lift; no glb-local axis assumptions needed).

## Traps (load-bearing)
- **`TilesGroup.updateMatrixWorld` recurses into children ONLY when the group's own matrix changed**
  (3d-tiles-renderer 0.4.28 `TilesGroup.js`) → every per-cell `scene.position` write must call
  `scene.updateMatrixWorld(true)` itself. The library does the same on visibility flips
  (`TilesRenderer.js:972`).
- **Per-cell content shifts against its STATIC region bounding volume** → the baker now pads region
  heights ±80 m (`RESEAT_PAD_M` in `bake.mjs`) so the culler never clips a lifted cell. Re-baked:
  identical 46 tiles · 731k verts · 20.51 MB (only tileset.json regions changed).
- **A hash-only `#p=` URL change does NOT re-boot the pose** (restored at boot only) — force a full
  reload via an `about:blank` hop when driving poses in Playwright verification.
- `load-model` payload = `{scene, tile, url}`; the raw tileset JSON survives preprocessing, so
  `tile.boundingVolume.region` is directly readable (verified live — 41/41 cells registered).

## Files
`src/components/globe/scene/enrichedBuildings.ts` (cell registry + sample/ease/apply + docstring) ·
`src/lib/globe/enrichedMask.ts` (`regionCenterDeg` + `seatStep`, pure) · `src/components/globe/tuning.ts`
(ENRICHED.reseatPerCell / reseatSamplesPerFrame / reseatEaseK) · `scripts/bake/bake.mjs` (RESEAT_PAD_M
region pad) · `test/lib/globe/enrichedMask.test.ts` (+6: region centre round-trip, seatStep snap/ease/
converge/fixed-point).

## Known limit / next
Within-cell relief (~±10 m on steep ~0.9 km cells) remains — upgrade = finer grid
(`cities/dnipro.json` grid 7→10+, re-bake; sampling already round-robin-bounded) or per-building
seating. NEXT (Slice 2 rest): clipping-plane hole (ECEF 4-plane prism — confirmed straddle-leak) ·
stylization reconcile via `_feature_id_0` + flip `ENRICHED.debugDistinctEdges=false` · R2
custom-domain host · full-city bbox. wix dev is RUNNING.

Related: [[project/wip-2026-07-13-dnipro-slice1-bake]] [[project/wip-2026-07-13-dnipro-slice0-spike]]
[[patterns/globe-rendering]] [[patterns/sky-bodies-terrain]]
