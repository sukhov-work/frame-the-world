# WIP 2026-09-02 — MESH SUITE MS0 (probes + doc drifts) DONE → MS1 (transform substrate) BUILT

**Status: MS0 DONE · MS1 BUILT + verified (unit + 2 browser harnesses; the §4a-4 sweep receipt is
in DECISIONS 2026-09-02).** Mode: implement (investigate-design-v3 spine) on `/frame`. Tier Deep.
Canonical: `.claude/claude-docs/MESH_SUITE_PLAN.md` — §1 platform bullet (probe results), §3 ladder,
**§6 = the MS1 as-built**. Prior: `mem:project/wip-2026-09-01-mesh-suite-plan`. Backlog T74.

## MS0 — what the ONE empirical probe established (`scripts/probe-model3d.mjs`, live site, CLI token)
- `POST /site-media/v1/files/generate-upload-url` (`mimeType: model/gltf-binary`, `private:false`)
  → PUT → the PUT response ALREADY carries the descriptor: `mediaType MODEL3D`,
  `mimeType model/gltf-binary`, `operationStatus READY` (118 KB GLB; get-file-by-id agreed on the
  first poll, 485 ms). A 256² PNG preview thumbnail is generated for free.
- **NO `urlExpirationDate` anywhere** on a public MODEL3D descriptor; URL =
  `https://static.wixstatic.com/3d/<id>.glb`, `Cache-Control: public, max-age=15552000, immutable`.
  Re-curled at 23.8 min: unchanged.
- wixstatic serves it loader-ready: `Content-Type model/gltf-binary`, `Access-Control-Allow-Origin: *`
  (with Origin plux.today AND localhost:4321), `Accept-Ranges: bytes`, `Range: bytes=0-1023` → 206.
  → **No R2 needed for serving** (Option C stands; R2 stays reserve).
- **PRIVATE 3D is REFUSED**: `private:true` + `model/gltf-binary` → 400 (HTML page), deterministic
  ×3 (request ids 1788296476.8309367376941413 / 1788296477.3859500443411418); comparators the same
  minute: private JPEG 200, public GLB 200, public `model/gltf+json` 200. → D3 "hide"/"delete" are
  RECORD-level (`UserModels.hidden`; delete = bulkDeleteFiles + record); hidden bytes stay
  fetchable by URL (say so in MS6 copy). Not probed: the true per-file 3D cap (moot under 8 MB).
- Probe artefact left in the Media Manager for the expiry leg:
  `plux-probe-public-2026-09-01T21-00-30-609Z.glb` = `166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb`.
  Report: `verify-shots/probe-model3d-2026-09-01T21-00-30-609Z.json` (git-ignored).
- REST paths came from the installed SDK build (`auto_sdk_media_files/build/cjs/index.js`:
  `/v1/files/generate-upload-url`, `/v1/files/get-file-by-id`), never memory.
- §4a-2 sidecar census (`bakes/enriched/*/cell-*.meta.json`): schema 2 on 100 % of cells, `osm`
  on 100 % of features for dnipro (127,890) · dnipro-o2w (133,437) · st-albans-o2w (26,187) ·
  chernobyl (1,212) · chernobyl-o2w (1,707). NO osm id shared across cells; 5 ids appear twice
  INSIDE one dnipro-o2w cell — all PowerTower+HighVoltagePowerTower pairs (not pickable).
  featureId unique per variant. → MS3 dual key: `variant|osm` unique for every pickable building.
- Doc drifts fixed in `conventions/contracts.md`: §2 key grammar (`featureId`, not osmId), §7 LWW
  (structural `_id` upsert, not `updatedAt`), + BuildingOverrides added to §4.

## MS1 — the design that shipped (full text: MESH_SUITE_PLAN §6)
- **Two paths in `applyFeatureSeats`.** `f.axf === null` ⇒ the U8 incremental writer verbatim
  (untouched buildings + height-only edits; one null check per frame). A spatial component
  (`SpatialXf {sx,sz,rotDeg,tE,tN,tU}`) ⇒ lazy PRISTINE snapshot (fill run + its edge-CSR bucket)
  by INVERTING the incremental state (`pristineFromIncremental`: y0 = baseY + (y−baseY−dyM)/sy;
  a plain copy at load-model) → absolute recompose each changed frame
  `p = pivot + R_y(rot)·S·(p0−pivot) + (tE, dyM+tU, −tN)`, pivot (cx, baseY, cz). Identity
  spatial ≡ the incremental invariant (unit-pinned) → RESET settles at identity → snapshot dropped
  → back on the fast path with no seam.
- **Frame**: +X east, +Y up, −Z north; `rotDeg` = three's makeRotationY sense (CCW from above; a
  compass heading is the NEGATIVE — convert at the UI). `tU` lift ≥ 0 (ground contact stays with
  the terrain seat — the owner's "never underground" rule is structural).
- **Rails = CONTRACT constants** in `lib/globe/bldgOverrides.ts` (`XF_RAILS`: scale 0.1–10 per axis,
  `TRANSLATE_MAX_M` 60, `LIFT_MAX_M` 25); rows outside are DROPPED on read (the `k` precedent).
  Only new taste knob: `ENRICHED.editUpdateRangeMaxRuns` 8.
- **Row v2**: `{sy, sx?, sz?, rotDeg?, tE?, tN?, tU?, cx, cz, vc, hM, t, s?}`; legacy `k` READ as
  `sy` (`sanitizeRow`), never migrated; `transformFields` omits identity components (a
  height-only edit persists exactly as U8 did); **neutrality across ALL components** (`isNeutralRow`).
- **Landmines closed**: re-locate after move (`locateFeature`: pristine centroid + TARGET
  translation; seat nulled + re-queued at the RC7 drain head) · bounds grow by `boundsGrowthM`
  incl. the bounding BOX (Mesh.raycast early-outs on it) · party-wall edge CSR attributed per
  SEGMENT (`mapSegmentsToRuns` — EdgesGeometry emits 2 verts/segment, shares nothing; applies to
  every cell, cm-scale on a re-seat) · `addUpdateRange` per touched run when ≤ 8 runs moved
  (three merges + clears after upload) · `cx/cz` never written (live pivot derived).
- **Engine API**: `setTransform` (the ONE entry point → `applyTransformTarget`), `featureState`
  (target/applied + cx/cz/vc/bakedHeightM), `setGhostXf`, `buildingTopWorld(…, xf?)`,
  `BuildingPick.current`, `debugSeats().spatial`. Ghost = pristine run rebased about the pivot;
  the transform rides the Object3D (`placeGhost`). Orchestrator: `commitBldgTransform` (engine
  first, row read BACK post-clamp; armed capture as the LRU-evicted fallback);
  `commitBldgHeight` is a height-only call into it. DEV seams `__globe.enrichedState()` /
  `__globe.enrichedSetTransform()` (contracts.md §3); `__bldgEditStore.armed.cellUri`.

## Verification receipt (fresh, this session)
- Unit: `featureTransform.test.ts` 21 · `bldgOverrides.test.ts` +4 v2 cases · `enrichedMask.test.ts`
  +3 party-wall cases · full vitest **2,259/2,259 (149 files)** (baseline 2,231) · `astro check`
  0 err / 0 warn / 8 hints · knip exit 0.
- Browser (headless :9333, fresh scratchpad profile, wix dev): **`verify-meshedit.mjs` 6/6 legs
  PASS** (arm+cellUri · seam edit exact target + v2 row + re-queued sample + settled ease +
  spatial 1 · rails 60 m/25 m with row agreeing · RESET → fast path · reload re-apply · legacy
  {k:2} → sy 2 on the fast path) — shots `verify-shots/meshedit-01..03` (01 shows the rotated
  building intersecting its neighbour: overlap accepted by ruling) · **`verify-bldg-override.mjs`
  PASS byte-identical** (live 45.0 m = the 3× clamp, row scale 3.00, RESET, Esc, reload, /m twin).
- §4a-4 sweep (one fresh headless Chrome per suite): **rendering-charter 85/85 · ultra-dusk ALL
  PASS · eclipse PASS · bestspot-ownerbatch 45/45 · debughud ALL PASS**. Two reds, both resolved
  by comparator: **`verify-ultra` §1b** red twice on COLD profiles (aniso.max 1, half the tiles
  streamed) → baseline green on a WARM profile → my tree on that same warm profile **28/28** ⇒
  cold-cache timing, not MS1. **`verify-chernobyl`** red with identical numbers (heights −557 m at
  the ChNPP pose) on my tree AND on bare master `2d38658` (stash comparator) ⇒ PRE-EXISTING
  regression, logged **T75** (suspects PR #88 terrainSkirt/imageryGround, PR #90 counters).
- Final gates on the finished tree: vitest 2,259/2,259 · astro 0/0/8 · knip 0.

## Traps (new)
- A regex `\bk: ` across a test file also rewrote `(k: string)` arrow params in the fakeStorage
  helper — three silent astro errors + storage-backed tests failing. Scope such sweeps.
- `x === -0` triggers an esbuild warning ("also matches 0"); `x === 0 ? 0 : x` folds −0 the same.
- The verify harness needs `awaitPromise:true` only for promise probes; all MS1 probes are sync,
  and the "same tick" read (`before`/`after` unseated in ONE evaluate) is what makes the
  re-queue assertion deterministic against the next rAF.

## OWNER RULING at session close (2026-09-02c)
**Chernobyl: drop ALL verification and support** ("a curious test, nothing special") — T75 closed
as DROPPED, no bisect; `verify-chernobyl.mjs` leaves every harness roster (small slice at MS2
start); region/bakes/R2 removal only after a one-line owner confirmation (user-visible content).
**Dnipro is the highest priority in ANY feature** — design, verify, taste-pass against Dnipro
(dnipro-o2w default) first, always.

## Where things stand / next
MS2 = the gizmo UI (TransformControls proxy, context menu, generalized label, revert per-op) on
the §6 seams. Owner-visible caveats: `TRANSLATE_MAX_M` 60 (tile-level culling volume not grown);
the fully shared party-wall post follows the lower run under a move.
