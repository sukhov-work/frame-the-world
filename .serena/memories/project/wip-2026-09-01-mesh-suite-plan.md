# WIP 2026-09-01b — MESH SUITE roadmap (D1 gizmos · D2 world sync · D3 user models) — PLANNED

**Status: PLAN COMPLETE → MS0 DONE + MS1 BUILT 2026-09-02 (see `mem:project/wip-2026-09-02-mesh-suite-ms0-ms1`; MESH_SUITE_PLAN §6 is the MS1 as-built). Next: MS2.**
Canonical doc: `.claude/claude-docs/MESH_SUITE_PLAN.md` (findings + architecture + slice
ladder MS0–MS6 + owner questions). Owner order: end of the 2026-09-01 DBG session.

## The four research tracks (same session, parallel; confidences 88–92 %)

1. **U8 substrate**: key = `<variant>|<cellUri>|<featureId>` (contracts.md `osmId` claim +
   "LWW by updatedAt" are DOC DRIFT — LWW is structural via FNV-1a-128 `_id` + bulkSave).
   `sanitizeOverrides` silently drops unknown fields; neutrality rule is scalar-only (would
   wrongly delete a rotated row). D2 backend fully written+tested, dormant: provision never
   ran (both verbs 502); `unsyncedEntries`/`markSynced` tested, zero callers; boot-fetch
   injection = `enrichedBuildings.ts:892` — zero engine change. `_ftw_override` Uint8 attr
   can carry a multi-level tint ladder free.
2. **Mesh anatomy**: contiguous per-feature runs in non-indexed soup + edge CSR + pristine
   capture. `applyFeatureSeats` is INCREMENTAL — only safe because Y-translate/Y-scale
   commute → D1 needs lazy pristine-snapshot + ABSOLUTE recompose (identity rows keep the
   fast path). Local frame gizmo-perfect (+X east, +Y up, −Z north). Preview on a
   generalized ghost, commit on release. Landmines: ensureLocated one-shot (moved feature
   re-seats to OLD footprint; plausibility gate slams far moves onto the cell plane);
   bounds sphere-only (raycast checks BOX too → unpickable-but-visible); party-wall edge-CSR
   corner collisions (rebuild the run's EdgesGeometry solo); whole-buffer re-upload (use
   `addUpdateRange`, verified in 0.185); cx/cz must stay PRISTINE (checksum). Stock ion
   tiles NOT feature-addressable — enriched-only + user meshes. Trees: yaw/uniform-XZ/
   translate only (occlusion decodes the matrix structurally); deferred.
3. **Gizmo/formats**: three 0.185 TransformControls = r169+ class (`getHelper()`,
   `dragging-changed`→GlobeControls.enabled=false verbatim; minY/maxY clamps exist = the
   ground/sky rail). TRAP: GlobeControls raycasts the whole scene + Raycaster ignores
   `visible` → gizmo pickers need a dedicated camera LAYER. Proxy carries an ENU quaternion,
   space:'local' (world snap rounds absolute ECEF). GLB canonical; accept glb/gltf/obj/fbx,
   normalize client-side via GLTFExporter (maxTextureSize downscale free);
   **MeshoptSimplifier ships with embedded wasm → auto-decimate**; DRACO/KTX2 wasm follows
   the libraw hashed-asset pattern (NO public/wasm — architecture doc forbids).
   Caps proposed: 100k tris / 2048² ≤8 textures / ≤25 meshes / 15 MB raw / 8 MB GLB.
4. **Platform/storage**: UPLOAD HERE = temp-pin popup → `uploadAt` (pendingPlacement is
   no-GPS-only, one-shot). Fork seam = DropStep.onFiles + ACCEPT + new store phase; NO file
   validation exists anywhere today (models add the first server mime allowlist).
   **Storage = Option C**: Wix Media bytes (MODEL3D first-class) + `UserModels` Wix Data
   record (owner/quota/hide/readiness/moderation state) + R2 in reserve (Worker is 405-on-
   write, no auth primitive; presigned-PUT via Wix Secrets is the future shape).
   ★ Blocking unknowns for Wix MCP at MS0: Model3D.urlExpirationDate on PUBLIC files;
   wixstatic CORS+Range for model/gltf-binary; per-file size cap; GLB ingest/operationStatus
   (`onFileDescriptorFileReady` NEVER wired — readiness must live on the record).
   Governance: NO moderation/takedown/attribution today (dated accepted POC risk) — D3 makes
   it an owner decision (§4 of the plan). Re-bake silently drops shared world edits
   (checksum-drop) — surface to owner.

## Slice ladder
MS0 ratify+probes → MS1 transform substrate → MS2 gizmo UI → MS3 D2 activation (needs MS1
fields, not MS2) → MS4 D3 upload pipeline → MS5 D3 placement → MS6 management + world edit.
OUT: stock tiles, trees (post-MVP), KTX2 encode, R2 writes, moderation tooling.

## Owner rulings (2026-09-01c — same session, after the plan was presented)
- **D3 governance: FULLY OPEN POC** — no moderation now, "moderate later if needed". Subsumes
  the U8 vandalism-posture question.
- **Model quota: NO LIMITS.** Instead: a physical-DENSITY WARNING when too many models are
  present (metric designed at MS5) + a **new deck chip: all custom models on/off, ON by
  default** (BLD-chip recipe). Per-file technical caps (tris/textures/MB) stay as upload
  validation.
- Explained on request: the re-bake silent-drop mechanism (featureId is bake-sequential; the
  cx/cz/vc checksum deletes mismatched rows rather than misapplying them → a re-bake wipes
  world edits for renumbered buildings) · the osmId migration (sidecar-keyed stable ids;
  RECOMMENDED into MS3 pre-activation = zero data migration) · XZ-scale semantics
  (RECOMMENDED: sy replaces k in v2, legacy-read kept; XZ about centroid; overlap accepted).
  **BOTH RATIFIED (owner 2026-09-01d)**, with a BINDING no-regression contract
  (MESH_SUITE_PLAN §4a): legacy k-rows load/apply/sync identically · dual-key osmId+fingerprint
  (never a hard cutover; verify sidecar coverage per variant FIRST) · identity transforms
  reproduce the incremental writer exactly · all existing verify harnesses stay green
  (bldg-override/ultra/dusk/charter/eclipse/chernobyl/bestspot-ownerbatch + vitest + astro) ·
  no per-frame cost on unedited cells. Owner will re-auth MCPs + mcp-s CLI before next session.

## Platform docs probe (2026-09-01c — public dev.wix.com + support; docs-schema MCP needs SSO)
✅ MODEL3D is a documented public mediaType enum on the REST FileDescriptor. ✅ 3D formats
.gltf/.glb; only published size figure is 25 MB (File Share app article — soft signal; our
8 MB normalized cap is under it). ⚠️ Docs exhausted on: public-URL expiry (`urlExpirationDate`
documented only as "when relevant"), wixstatic CORS/Range for model/gltf-binary, the true
Media Manager 3D cap, the GLB operationStatus walk. **All four collapse into ONE empirical
MS0 probe**: mint kind:"model" URL → PUT ~100 KB GLB → poll descriptor to READY, print
media.model3d verbatim → curl -I with Origin+Range → re-curl later for expiry.
Resources: internal docs-schema MCP needs SSO re-login (https://mcp-s-connect.wewix.net/api/login);
Bilbo (wix-private code Q&A via mcp-s) available if the probe disagrees with docs.
