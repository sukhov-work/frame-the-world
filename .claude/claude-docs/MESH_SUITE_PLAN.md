# MESH SUITE — spatial edit gizmos · world-synced overrides · user-uploaded models

Owner order 2026-09-01 (end of the DBG session): build on U8 (the local building-height
override) in three directions —
**D1** a full Blender-style spatial suite per mesh (context menu → move / rotate / scale with a
rigged 3-axis gizmo about the mesh centre; everything reversible; modified AND original values
always visible; revert per-op and revert-all; the current extrude drag stays as-is) ·
**D2** server persistence of modifications (a Wix Data table, global for all users,
last-committer-wins, login required to sync, all meshes synced at once as override
instructions applied additively at chunk/mesh load; modified meshes highlighted more
distinctly than today with a subtle indication of original vs overridden params) ·
**D3** logged-in users add their OWN meshes to the map (auto ground-fit at the mesh centroid,
never pushable irreversibly underground or into the sky — a rail that also applies to D1;
reuse the D1 gizmo for final fit/orientation/size at upload; reuse UPLOAD HERE, split the
modal photo | 3D model; research FBX/GLB/OBJ; research storage/streaming Cloudflare vs Wix;
uploader sees + deletes/hides own uploads; every other logged-in user can re-edit any mesh's
params per D1).

This document is the roadmap + the light-investigation findings (four parallel research
tracks, 2026-09-01, confidences 88–92 %; full reports summarized here with file:line anchors).
Next session starts at **MS0** below.

---

## §1 What the research established (the load-bearing facts)

### The U8 substrate (confidence 92 %)

- Override key grammar is **`<variant>|<cellUri>|<featureId>`** (`bldgOverrides.ts:68-70`) —
  `contracts.md:35` saying `osmId` is DOC DRIFT (osmId is the planned re-bake-stable upgrade,
  provisioned-but-null). LWW is **structural** — deterministic FNV-1a-128 `_id` + `bulkSave`
  upsert (`overrideRecords.ts:45-64`); "LWW by updatedAt" in contracts.md:139 is drift too.
- `OverrideRow` = `{k, cx, cz, vc, hM, t, s?}`; `sanitizeOverrides` is a strict whitelist that
  **silently drops unknown fields** (`:106-107`) → D1 fields need an explicit schema extension
  (+ decide `:v2` vs per-field defaults). The **neutrality rule is scalar-only**
  (`|k−1|<0.005` → row deleted, `:146`) — a rotated-but-unscaled row would be wrongly deleted
  today; must become "identity across ALL components".
- **The dormant D2 backend is real and tested**: `/api/building-overrides` GET(public)/
  POST(member-gated 401) with bulkSave/bulkRemove, server-side clamps, variant-vs-region
  validation, memberId stamped but never emitted (C6). `unsyncedEntries`/`markSynced` exist,
  tested, **zero callers**. Boot-fetch injection point: `enrichedBuildings.ts:892`
  (`opts.overrides.forCell`) — a server-merged map needs **zero engine change**.
  Blocker: `node scripts/provision-collections.mjs` has never run → both verbs 502.
- Tint machinery: armed = scalar uniform `uFtwArmedId`; committed = a normalized-Uint8
  `_ftw_override` vertex attribute used as binary — it can carry a **multi-level ladder**
  (mine / local-unsynced / server-shared) with zero new attributes (`buildingMaterial.ts:288-294`).

### Mesh anatomy — the transform verdict (confidence 88 %)

- Cells are non-indexed triangle soup with **contiguous per-feature runs** (`_FEATURE_ID_0`);
  runs + edge-CSR + pristine capture (baseY/topY/cx/cz) are built at load
  (`enrichedBuildings.ts:800-888`). `applyFeatureSeats` (`:1138-1237`) is the ONE writer and
  is **incremental** — safe only because seat-Y-translate and Y-scale-about-base commute.
- **Local frame is gizmo-perfect**: glTF local **+X = east, +Y = geodetic up, −Z = north**
  (bake mapping ENU→(e,u,−n), `buildings.mjs:255-256`). Move = ±X/∓Z metres; rotate = about
  +Y through `(cx,cz)`; scale = about `(cx, liveBase, cz)`.
- **D1's core design**: on first non-identity transform, lazily snapshot the run's pristine
  position slice (+ edge verts via CSR) → per-frame **absolute recompose**
  `T(seat) · T(dE,0,−dN) · R_y(θ) · S(sx,sy,sz)` about the pivot; identity features keep the
  incremental fast path (no memory for the 99 % untouched). Preview lives on a
  **generalized ghost** (`showGhost` already rebases + inflates; extend to
  position/quaternion/scale — near-free), commit into arrays once on release.
- **Five landmines, all named**: (1) `ensureLocated` is one-shot → a MOVED feature re-seats to
  its OLD footprint forever (must re-locate, and the plausibility gate `cellGateM` would slam
  a far-moved building onto the cell plane); (2) bounds: `growBoundsFor` touches only the
  SPHERE — `Mesh.raycast` also early-outs on `boundingBox` → a moved building can become
  unpickable while still visible; (3) edge-CSR **party-wall corner collisions** (first-run-
  wins) → a metre-scale move stretches shared edge strokes; mitigation = rebuild that run's
  EdgesGeometry solo on transform; (4) `needsUpdate` re-uploads the WHOLE cell buffer — use
  `addUpdateRange` (verified in three 0.185) for 60 fps drags; (5) keep `cx/cz` PRISTINE
  (they are the re-bake checksum) — carry offsets separately; live pivot = `(cx+tx, cz+tz)`
  must be threaded through `buildingTopWorld` and the ghost.
- `flatShading:true` → no normal attribute to fix visually; still rotate normals (the dormant
  R3 wall gate reads them).
- **Stock Cesium ion tiles: NOT feature-addressable** (no stable id, LOD duplication,
  indexed/Draco geometry, no re-apply hook) — **scope D1/D2 as enriched-only + user meshes**;
  stock-tile editing is a separate future project.
- **Trees**: feasible for translate + yaw + uniform-XZ scale by writing the full instance
  matrix (today only m13 is written); blocked for tilt/shear (`occlusion.ts:174-186` decodes
  the matrix structurally); no pick path (raycast deliberately noop'd). Defer trees to a
  post-MVP slice.
- Standalone user mesh transform is trivial (one Object3D); the work is upload/persist/seat.
  Seating precedents: `tempPinPoint` sticky-ground + `seatStep` ease; `sampleGroundM` +
  `resnap()` latch; `clampGroundM` [0, 9000]; the `PhotoFrustum` float32 rule (vertices
  anchor-relative, ECEF magnitude in `object.position`); `pickGround()` is the ready-made
  ground-plane drag primitive.

### Gizmo + formats (confidence 90 %)

- Installed three@0.185 `TransformControls` is the r169+ class: `getHelper()` added to the
  scene, `attach(proxy)`, modes translate/rotate/scale, per-axis show/hide, snaps, min/max
  translation clamps (v0.185 has them — the ground/sky rail can use `minY/maxY` directly),
  `'dragging-changed'` → `GlobeControls.enabled = false` works verbatim (EnvironmentControls'
  enabled-setter cleanly resets in-flight drags).
- **Trap:** GlobeControls raycasts the WHOLE scene and three's Raycaster ignores `visible` →
  the gizmo's invisible pickers WILL catch globe drags. Fix: dedicated camera **layer** for
  the helper subtree + the gizmo's raycaster; globe stays on layer 0.
- Proxy must carry an **ENU quaternion** and use `space:'local'` (world = raw ECEF axes,
  meaningless); world-space snapping rounds absolute ECEF — snap local only. Gizmo overlay
  renders depth-free at `renderOrder Infinity`; bloom may glow it (acceptable or move to an
  overlay pass).
- **Formats: GLB canonical.** Accept `.glb/.gltf/.obj(+.mtl)/.fbx`, normalize client-side to
  GLB via `GLTFExporter` (`binary:true, maxTextureSize:2048` — free texture downscale);
  never store FBX/OBJ. **`MeshoptSimplifier` ships in this three install with EMBEDDED wasm**
  → auto-decimate over-budget uploads instead of rejecting. DRACO/KTX2 decode need wasm
  assets — follow the repo's libraw precedent (hashed Vite assets; the architecture doc says
  there is NO `public/wasm/` — do not introduce one casually).
- Suggested caps (judgment, to ratify): ≤100k tris · ≤2048² and ≤8 textures · ≤25 meshes/
  materials · ≤15 MB raw / ≤8 MB normalized GLB · no animations/skinning in v1.

### Platform + storage (confidence 88 %)

- **UPLOAD HERE** = the temp-pin popup → `uploadAt(lat,lon)` seeds `pendingPlacement`
  (applied only when the file has no GPS). The photo|model fork's seam: `DropStep.onFiles` +
  `ACCEPT` + a new store phase branch; `ReviewStep`/`PhotoDetailPanel` are EXIF-shaped.
  **No real file-type validation exists anywhere** (accept attr only; drag-drop bypasses) —
  models introduce the repo's first server-side mime allowlist (in `/api/upload-url`).
- Auth: `requireMember()` → 401 verbatim; elevated writes run as the APP → ownership is an
  explicit `ownerMemberId` stamped server-side; quota precedent = the photos 402 wall
  (count-then-plan-check; "UI-only enforcement is a bug"); the owner's cap discriminator is
  **media weight** → user models get a quota wall.
- **Storage verdict: Option C.** Wix Media (MODEL3D is first-class; TUS path shipped) holds
  the bytes; a new `UserModels` collection is the source of truth (owner, fileId, url,
  placement, transform, hidden, readiness, moderation state); **R2 in reserve** — the Worker
  is strictly read-only/anonymous (405 on write; no auth primitive; presigned-PUT via Wix
  Secrets is the future shape if needed). Content-hashed keys would sidestep R2's immutable-
  cache purge issue. Serving via R2 is better on every measured axis (CORS *, Range/206,
  correct model mime) but is new auth surface — wrong FIRST step, right eventual home.
- **Platform unknowns — RESOLVED EMPIRICALLY (2026-09-02, `scripts/probe-model3d.mjs` against
  the live site with a site-scoped CLI token; report `verify-shots/probe-model3d-2026-09-01T21-00-30-609Z.json`,
  git-ignored):** a ~118 KB procedurally written GLB was minted (`POST
  /site-media/v1/files/generate-upload-url`, `mimeType: model/gltf-binary`, `private: false`),
  PUT, and read back — the four answers, with bytes:
  1. **Ingest is SYNCHRONOUS for a small GLB**: the PUT response itself carried the descriptor
     with `mediaType: "MODEL3D"`, `mimeType: "model/gltf-binary"`, `operationStatus: "READY"`,
     and `get-file-by-id` agreed on the first poll (485 ms). A 256×256 PNG preview thumbnail is
     generated for free (`additionalProperties.model3d.preview.status: READY`) — the "my
     uploads" list gets its thumbnail without rendering anything.
  2. **No expiry on a PUBLIC MODEL3D URL**: the descriptor has NO `urlExpirationDate` at any
     level; the URL is a plain `https://static.wixstatic.com/3d/<id>.glb` served with
     `Cache-Control: public, max-age=15552000, immutable` (180 days). The `--recheck` leg of the
     probe re-curls the same URL later in the session for the age check.
  3. **wixstatic serves GLB exactly as a three loader needs**: `Content-Type:
     model/gltf-binary`, `Access-Control-Allow-Origin: *` (with `Origin: https://www.plux.today`
     AND `http://localhost:4321`), `Accept-Ranges: bytes`, and `Range: bytes=0-1023` → **206**
     with a correct `Content-Range` — streaming/partial fetches work; no R2 needed for serving.
  4. **PRIVATE 3D files are NOT supported**: `generate-upload-url` with `private: true` and
     `mimeType: model/gltf-binary` returns **400** (an HTML "400 Error: Bad Request" page) —
     deterministic across three attempts, with and without `sizeInBytes`, request ids
     `1788296476.8309367376941413` / `1788296477.3859500443411418`; the comparators in the same
     minute were `private: true` + `image/jpeg` → 200, `private: false` + `model/gltf-binary` →
     200, `model/gltf+json` public → 200. **Consequence for D3**: "hide" and "delete" are
     RECORD-level (`UserModels.hidden`, and delete = `bulkDeleteFiles` + record delete); the
     bytes of a hidden model stay world-fetchable by anyone holding the URL (accepted under the
     open-POC ruling — say so in the UI copy at MS6).
  Not probed, deliberately: the true Media Manager 3D per-file cap (our 8 MB normalized cap sits
  under every published figure, and a 30 MB probe would burn the owner's media quota). The
  probe file `plux-probe-public-2026-09-01T21-00-30-609Z.glb`
  (id `166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb`) is left in the Media Manager for the
  expiry re-check — the owner may delete it afterwards. Wix Data per-item byte cap +
  pagination-past-1000 remain docs questions for MS3.
- **Governance (C6) — owner decision required before D3 ships**: there is NO moderation
  (accepted POC risk, dated), NO takedown surface, NO public attribution (memberId stripped
  by design). "Globally visible user meshes, last-committer-wins, no attribution, no
  moderation" is a decision, not an implementation detail. Also open from U8: vandalism
  posture + display-label field. Also: a re-bake **silently discards the world's shared
  edits** (checksum-drop is safe but lossy) — surface it.

---

## §2 Architecture decisions (proposed — ratify at MS0)

1. **Scope building edits to ENRICHED features + user meshes.** Stock ion tiles are out
   (structural, §1). Trees deferred to post-MVP (yaw/uniform only when taken).
2. **Transform model**: per-feature `{tE, tN, rotDeg, sx, sy, sz, k}` (k stays the legacy
   height scale for back-compat; sy composes with it or replaces it — decide at design).
   Pristine-snapshot + absolute recompose; ghost-preview/commit-on-release; identity rows
   deleted (new multi-component neutrality rule).
3. **Rails** (apply to D1 drags AND D3 placement): base never below `clampGroundM(terrain)`;
   lift ceiling (reuse the U8 `liftMinM/liftMaxM` idiom); translate radius capped to stay
   inside the origin cell's padded region (cross-cell moves refused — §1 landmine 5); per-axis
   scale bands per `clampEditK`; gizmo `minY/maxY` clamps enforce the ground/sky rail live.
4. **Persistence**: extend `OverrideRow`+wire+collection **together** (the five-place rule:
   sanitize, OverrideSyncEntry, parseSyncEntry, overrideRecord/publicOverride, provision
   schema). New `UserModels` collection for D3 (ADMIN-all, photos posture). Server re-clamps,
   never rejects (the shipped posture).
5. **Merge policy (D2)**: server wins on boot; local wins after an in-session edit; SYNC
   pushes `unsyncedEntries` and stamps `markSynced`; fetch-before-push on the SYNC action to
   honour last-committer-wins. (Exact policy is a design task — this is the starting point.)
6. **Highlight ladder**: `_ftw_override` byte levels — 0 none · A server-shared · B mine/
   local-unsynced (distinct, subtle); hover/armed shows original vs current values via the
   extended `bldgEditLabel` rows.
7. **D3 storage**: Option C (Wix Media bytes + UserModels record + R2 reserve). GLB
   canonical; normalize client-side; caps + auto-decimate per §1.
8. **User-mesh scene module**: new `scene/userModels.ts` attach-module (registry keyed by
   record id; anchor-relative geometry, ECEF in `position`; `sampleGroundM`+`seatStep`+
   `resnap` seating at the model centroid; picks via its own raycast list; part of the
   shadow pass; respects BLD toggle? — design call).

## §3 The slice ladder (next sessions)

| Slice | Scope | Depends on |
|---|---|---|
| **MS0 — ratify + probes** | **DONE 2026-09-02.** Rulings ratified (§4, 2026-09-01c/d); the ONE empirical media probe ran (§1 — all four unknowns answered, private 3D refused); the two contracts.md drifts fixed (+ a third: BuildingOverrides was missing from §4); the §4a-2 sidecar census ran (§6.1: 100 % coverage on all five live variants). | — |
| **MS1 — transform substrate** | **BUILT 2026-09-02 (§6).** Pristine-snapshot + absolute recompose in `applyFeatureSeats`; `addUpdateRange`; sphere+box bounds; re-locate after move; per-SEGMENT edge attribution (the party-wall fix, in place of a rebuild); `OverrideRow` v2 + sanitize + multi-component neutrality; rails; pure-math unit tests (the scene-test twin rule); generalized ghost; `setTransform`/`featureState` engine API + DEV seam; browser leg `verify-meshedit.mjs`. | MS0 |
| **MS2 — gizmo UI** | **BUILT 2026-09-02 (§7).** Building context menu (right-click / long-press → MOVE / ROTATE / SCALE / EXTRUDE / REVERT ALL / DONE) + the chip's op strip + G/R/S/E keys; TransformControls on the ghost RIG (anchor + body under the cell mesh, `space: local` = ENU, pointers FED by the FPV gesture table — no DOM listeners, no camera layer needed: GlobeControls is off throughout FPV), `minY/maxY` = the lift rail, per-edit scale band on every axis; ghost-body preview while dragging, commit on release through `commitBldgTransform`; the chip shows every op's current vs original with a per-op ↺ + RESET ALL, the pinned label grows an op line; EXTRUDE = the U8 drag verbatim and the default op on arm; Escape cancels a live drag; `verify-meshedit.mjs` legs 7–14. | MS1 |
| **MS3 — D2 activation** | Run provisioning; boot fetch + merge; SYNC affordance + login gate + 402/401 UX; markSynced; tint ladder + subtle original-params indication; re-bake-loss note in UI copy; extend wire/collection with MS1 fields; harness leg. | MS1 (fields), not MS2 |
| **MS4 — D3 upload pipeline** | Modal fork photo\|model; loaders + normalize-to-GLB + validation + auto-decimate; readiness state; `UserModels` collection + endpoints (quota wall); `/api/upload-url` kind:"model" + first mime allowlist. | MS0 answers |
| **MS5 — D3 placement** | `scene/userModels.ts`; centroid ground-fit + resnap; MS2 gizmo reused for final fit at upload; clamps; LOD/culling/shadow flags; load-with-tiles streaming; **the MDL deck chip (all custom models on/off, ON by default — BLD-chip recipe)**; **the physical-density warning** (owner 2026-09-01c: no quota — warn instead; design the metric: resident models / on-screen user-model tris / per-cell count). | MS2 + MS4 |
| **MS6 — D3 management + world edit** | My-uploads list (delete/hide); other users edit user-mesh transforms per D1 (overrides ON user meshes — same record machinery); perf polish; full harness. | MS5 + MS3 |

Deliberately OUT: stock-tile editing (separate project) · trees (post-MVP) · KTX2 encode ·
R2 write path (reserve) · moderation tooling (owner decision first).

## §4 Owner rulings + remaining questions (updated 2026-09-01c)

**RULED (owner, 2026-09-01c):**
1. **Governance for D3: FULLY OPEN POC.** No moderation layer now — "we will be able to
   moderate it later if needed." Same posture as pins at release. Do not overcomplicate.
2. **Model quota: NO LIMITS for now.** Instead: (a) a **physical-density warning** when too
   many models are present in an area (design the metric at MS5 — candidates: models resident
   in the streaming radius, total user-model tris on screen, per-cell count); (b) a **new
   deck chip toggling ALL custom models on/off, ON by default** (the BLD-chip recipe: default-
   on pref, plain sanitize clause, hand-added `.is-on` CSS line, engine-side gate).
   Per-model technical caps (100k tris / 2048² / 8 MB GLB) stay as UPLOAD validation —
   they are per-file health, not a quota.

3. **osmId migration: RATIFIED (owner 2026-09-01d)** — folded into MS3 *before* activation
   (the server table is empty until provisioning runs → zero data migration; world edits
   re-bake-proof from day one). The U8 vandalism-posture question is subsumed by ruling 1;
   the display-label field stays optional-later.
4. **XZ-scale semantics: RATIFIED (owner 2026-09-01d)** — new `sy` replaces legacy `k` in
   the v2 record (legacy rows still read), XZ scale about the centroid, uniform-XZ default
   gesture with per-axis available; neighbour overlap accepted.

## §4a THE NO-REGRESSION CONTRACT (owner 2026-09-01d — BINDING for MS1 and MS3)

The osmId migration and the XZ/3-axis scale must support **everything that already exists,
worldwide and feature-wise**, and introduce **no regression** into rendering, re-seating,
the custom OSM building pipelines, or any existing astro/planning/FPV functionality.
Concretely, each slice's done-gate includes:

1. **Legacy data compat**: every existing `ftw:bldg-overrides:v1` row (scalar `k`) loads,
   applies, displays and syncs identically under the v2 record — a legacy-read test is part
   of MS1's unit tier, and the U8 drag/extrude UX is byte-identical when only height is edited.
2. **All variants, worldwide**: verify schema-2 `cell-*.meta.json` sidecar coverage (and
   per-feature `osm` presence rate) for EVERY live bake — dnipro, dnipro-o2w, st-albans-o2w
   (chernobyl(+o2w) counted at the time; the region was DELETED 2026-09-02e) — before keying
   anything by osmId; features without an osm id keep the
   fingerprint key as fallback (dual-key read, never a hard cutover).
3. **Seat/re-seat pipeline**: the absolute-recompose path must reproduce the incremental
   writer's results exactly for identity transforms (the 99 % untouched fast path stays);
   seat epoch/quiet-frames semantics unchanged; the plausibility gate and poisoned-pair
   collapse behave identically for unedited features.
4. **Astro/planning/FPV consumers**: planFeed/occlusion sweeps, skyline profiles, FPV picks
   and `buildingTopWorld` anchors read the SAME arrays — the existing regression harnesses
   are the gate and ALL must stay green: `verify-bldg-override` · `verify-ultra` 28/28 ·
   `verify-ultra-dusk` 21/21 · `verify-rendering-charter` 85/85 · `verify-eclipse` 37/0 ·
   ~~`verify-chernobyl` 8/8~~ (DROPPED from every roster by owner ruling 2026-09-02c — the
   Chernobyl slice has no verification or support; Dnipro is the priority in every feature) ·
   `verify-bestspot-ownerbatch` 45/45 · full vitest · astro check.
5. **Rendering**: no per-frame cost on unedited cells (one boolean/early-continue), no
   whole-buffer uploads outside an active drag (`addUpdateRange`), shadow/edge/tint
   behaviour unchanged for untouched buildings — spot-check with the DBG window's frame
   brackets before/after.

## §5 Session-start recipe (MS3 onward)

1. Read this file (§6 = the MS1 as-built, §7 = the MS2 as-built), then
   `mem:project/wip-2026-09-02-mesh-suite-ms2`, `mem:project/wip-2026-09-02-mesh-suite-ms0-ms1`
   and `mem:project/wip-2026-09-01-mesh-suite-plan` (research digests).
2. MS3 = the D2 activation on the §6 fields (it needs MS1, not MS2): provisioning, boot fetch +
   merge, SYNC + login gate, markSynced, the tint ladder, the osmId dual key (§4a-2 census: 100 %
   coverage on every live variant). The wire/collection grow by the v2 row's spatial fields.
3. The DBG window (2026-09-01) is the instrument for all of this — seat deferrals/rejections,
   cell counts, frame costs are live in it; open it before profiling anything.

---

## §6 MS1 AS BUILT — the transform substrate (2026-09-02)

### §6.1 The §4a-2 census (run BEFORE keying anything by osmId)

`bakes/enriched/*/cell-*.meta.json`, every live variant (the same files R2 serves):

| variant | cells | sidecars (schema 2) | features | with `osm` | notes |
|---|---|---|---|---|---|
| dnipro | 386 | 386 | 127,890 | 100 % | src default/levels/class/height |
| dnipro-o2w | 389 | 389 | 133,437 | 100 % | **5 osm ids appear TWICE inside one cell** — all `PowerTower` + `HighVoltagePowerTower` pairs (n1782058413 · n3266155632 · n3197676042 · n6923575054 · n6923575053): OSM2World emits two features for one power-tower node. None is a `Building*` class, so none is pickable. |
| st-albans-o2w | 36 | 36 | 26,187 | 100 % | |
| chernobyl | 72 | 72 | 1,212 | 100 % | region DELETED 2026-09-02e (owner ruling) |
| chernobyl-o2w | 74 | 74 | 1,707 | 100 % | region DELETED 2026-09-02e (owner ruling) |

No osm id is shared ACROSS cells in any variant (the RC16 straddler residual is geometry, not
identity); `featureId` is unique per variant (bake-sequential, 0..N−1). **Consequence for MS3's
dual key:** `variant|osm` is unique for every pickable building today; the fingerprint
(`cx/cz/vc`) stays the tie-breaker and the fallback, never a hard cutover (§4a-2).

### §6.2 The model — what a row means

`OverrideRow` v2 (`lib/globe/bldgOverrides.ts`): `{ sy, sx?, sz?, rotDeg?, tE?, tN?, tU?, cx,
cz, vc, hM, t, s? }`. `sy` is the U8 height scale renamed (legacy `k` is READ as `sy` by
`sanitizeRow`, never migrated in place — the read-old-keys precedent; a legacy row sanitizes to
a byte-identical v2 row minus the rename, unit-pinned). Spatial components are OPTIONAL and
absent = identity, so a height-only edit persists exactly as U8 did. Semantics
(`lib/globe/featureTransform.ts`): local +X east, +Y up, −Z north; `tE/tN` metres; `rotDeg` in
three's `makeRotationY` sense (CCW from above); `tU` a lift ≥ 0 above the seated base — the
owner's "never underground" rule is structural, ground contact stays owned by the terrain seat.
Rails are CONTRACT constants there (`XF_RAILS`: scale band 0.1–10 on every axis, `TRANSLATE_MAX_M`
60 — the tile-level culling volume is not grown by a move — `LIFT_MAX_M` 25); a persisted row
outside them is dropped on read, the `k` precedent. **Neutrality is judged across ALL
components** (`isNeutralRow`) — the scalar rule that would have deleted a rotated-but-unscaled
row is gone. `transformFields` writes only non-identity components (sub-threshold gizmo noise
never lands); `rowTransform` resolves a row to the full `FeatureTransform`.

### §6.3 The two paths in `applyFeatureSeats` (the §4a-3/5 contract)

- **Fast path (unchanged, byte-identical):** a feature with `axf === null` runs the incremental
  writer exactly as U8 shipped — seat `+= dy`, Y-scale about the live base. This is every
  untouched building and every height-only edit; the only new per-frame cost is one null check.
- **Absolute path:** a feature carrying a spatial target gets a PRISTINE snapshot of its run
  (fill + its edge-CSR bucket) on first use — `pristineFromIncremental` INVERTS the incremental
  state (`y0 = baseY + (y − baseY − dyM)/sy`, X/Z untouched; a plain copy at load-model), so no
  second copy of the cell buffer ever exists. Each frame anything changes (seat dy, height ease,
  spatial ease) the run is recomposed from the snapshot: `p = pivot + R_y(rot)·S·(p0 − pivot) +
  (tE, dyM + tU, −tN)`, pivot = (cx, baseY, cz). For identity components this is EXACTLY the
  incremental invariant (`featureTransform.test.ts`), which is what makes RESET seamless: the
  spatial ease settles at identity → the snapshot is dropped → the run is back on the fast path
  with the array already holding the fast path's numbers. Every component eases with
  `overrideEaseK` and snaps its tail (rotation the short way round).
- **Poisoned-pair collapse, plausibility gate, seat epoch / quiet frames:** untouched — the
  spatial branch consumes the SAME `dy` the seat step produced.

### §6.4 The five landmines, as closed

1. **Re-locate after move** — `locateFeature`: a feature with a target translation samples
   terrain at `(cx + tE, baseY, cz − tN)` (the pristine centroid offset by where it is GOING,
   never the mid-ease array); on a changed translation its seat is nulled and it is re-queued
   at the head of the RC7 drain. Unedited features keep the exact array-centroid read.
2. **Bounds** — `growBoundsFor` grows by `boundsGrowthM` (translation + lift + XZ growth +
   height growth, monotone) and grows the bounding BOX alongside the sphere when one exists
   (`Mesh.raycast` early-outs on the box, three 0.185 `Mesh.js:260`). Per-feature `rXZ` is
   captured in the same load pass as the centroid (min/max extents, no second sweep).
3. **Party-wall edge CSR** — attributed per SEGMENT instead of rebuilt: `EdgesGeometry` emits
   two vertices per segment and shares nothing, so `mapSegmentsToRuns` gives a segment to the
   run owning BOTH its ends (the fully shared post goes to the lowest run). Applies to every
   cell (cm-scale on a re-seat, the only correct answer under a move); unit-pinned on a
   two-prism party wall.
4. **Whole-buffer upload** — `part.touchedRuns` collects the runs written this frame; at most
   `ENRICHED.editUpdateRangeMaxRuns` (8) → `addUpdateRange` per run (fill: the run's slice;
   edges: the run's `[min, max]` stroke span, captured at load); more → `clearUpdateRanges`
   and the whole-buffer upload a settling cell always had. three merges + clears the ranges
   after each upload (`WebGLAttributes.js:147`).
5. **Pristine `cx/cz`** — never written; the live pivot is derived (`xfPivotLocal`,
   `buildingTopWorld(…, xf)`), and the ghost is the pristine run rebased about the pivot with
   the transform carried on the Object3D (`placeGhost`: position / `rotation.y` / scale — the
   MS2 preview is `setGhostXf`, zero geometry rewrites).

### §6.5 Engine API + wiring

`EnrichedBuildingsHandle`: `setTransform(cellUri, featureId, t)` (the ONE entry point —
load re-apply, `setHeightScale`, the DEV seam and the MS2 gizmo all land in
`applyTransformTarget`) · `featureState(cellUri, featureId) → { target, applied, cx, cz, vc,
bakedHeightM } | null` · `setGhostXf(xf)` · `buildingTopWorld(…, xf?)` · `BuildingPick.current`
· `debugSeats().spatial`. `opts.overrides.forCell` rows now carry `xf: FeatureTransform`.
Orchestrator (`StylizedTiles.ts`): `commitBldgTransform(cellUri, featureId, t, fallback?)` —
engine target first, then the row read BACK from `featureState` (post-clamp, so storage never
disagrees with the mesh; the armed pick's capture is the fallback when the cell was
LRU-evicted mid-edit); `commitBldgHeight` is now a height-only call into it. DEV seams
`__globe.enrichedState()` / `__globe.enrichedSetTransform()` (contracts.md §3);
`__bldgEditStore.armed.cellUri` added so a harness can address the armed building.

### §6.6 Verification receipt

See DECISIONS 2026-09-02 for the numbers: unit tier (`featureTransform.test.ts` 21,
`bldgOverrides.test.ts` +4 v2 cases, `enrichedMask.test.ts` +3 party-wall cases, full vitest,
`astro check`, knip) · browser tier (`verify-bldg-override.mjs` byte-identical U8 UX,
`verify-meshedit.mjs` the MS1 leg, plus the §4a-4 harness list).

### §6.7 Left for MS2 (deliberately)

The context menu + `TransformControls` proxy (ENU quaternion, `space:'local'`, camera-layer
isolation, `dragging-changed` → controls off, `minY/maxY` = the lift rail) · the generalized
label (per-op current vs original, revert per-op / revert all) · a compass-heading readout
(negate `rotDeg` at the UI) · the tile-level culling caveat behind `TRANSLATE_MAX_M`
(owner may raise it; the fix would grow the tile bounding volume, not the mesh bounds).

---

## §7 MS2 AS BUILT — the gizmo UI (2026-09-02)

### §7.1 Design decisions (recorded as [ASSUMPTION]s where the owner has not ruled; surface, not re-open)

1. **The proxy IS the ghost rig.** MS1's ghost already carried the live transform as Object3D
   writes; MS2 splits it into an `anchor` (a `Group` under the cell mesh — the bake-local ENU
   frame, +X east / +Y up / −Z north — carrying the translation) and its child `body` (the ghost
   mesh: yaw + scale, X/Z inflated by `overrideGhostInflate`). **MOVE attaches
   `TransformControls` to the anchor** (arrows that never turn with the building — Blender's
   global-space feel), **ROTATE and SCALE to the body** (the Y ring / the boxes follow the
   building's own frame, which is the frame the recompose applies S and R in). Every drag is a
   plain Object3D edit; `rigToTransform` (featureTransform.ts) is the exact inverse of the
   engine's `placeGhost` (`transformToRig` pins the pair), `clampGizmoEdit` (bldgOverrides.ts)
   rails it — the rails AND the U8 per-edit 0.5×/3× band on every scale axis — and the clamped
   value is written BACK to the rig so a handle stops at the rail. Yaw is read from the
   quaternion (`2·atan2(qy, qw)`), never Euler `.y` (wrong past ±90°).
2. **No DOM listeners on the controls; the orchestrator FEEDS them.** three 0.185's
   `TransformControls` exposes `pointerHover/Down/Move/Up({x, y, button})`; constructed without a
   domElement it registers nothing, so the FPV handlers that already arbitrate the look-drag, the
   pinch and the U8 claimed height drag arbitrate the gizmo too — ONE gesture table, and the /m
   touch shell gets the gizmo for free. `space: "local"` (three's "world" is raw ECEF); the rig's
   world quaternion already carries the ENU basis through the cell mesh's matrixWorld.
3. **No camera layer.** The research trap (GlobeControls raycasts the whole scene; three's
   `Raycaster` ignores `visible`, so the invisible pickers would catch globe drags) is real but
   moot: a building can only be armed INSIDE FPV, where `controls.enabled` is already false. The
   visible gizmo/helper meshes get a no-op `raycast` anyway; the pickers keep theirs (the
   controls hit-test exactly those). Bloom may glow the helper on the ULTRA tier — accepted.
4. **EXTRUDE is the default op on arm and the U8 drag verbatim** (§4a-1: height-only editing is
   byte-identical — `verify-bldg-override.mjs` re-run unchanged). In a spatial op an OFF-handle
   drag is a plain look-around (the handles are explicit; the screen is no longer the gesture)
   and a tap still disarms; a handle press claims the pointer, the ghost body shows for the
   drag, release COMMITS through `commitBldgTransform` (engine first, row read back post-clamp).
5. **Entry points:** right-click a building (desktop) / long-press it (glass) → arms it (another
   building re-targets) and opens the context menu at the press point (the `.skymenu` cut:
   floats up-right so a finger's release lands outside it); the chip's op strip; Blender's
   **G / R / S** (+ **E** for extrude) while armed — **S shadows walk-back for the armed
   session** (the chip hint says so) [ASSUMPTION — owner may prefer 1/2/3/4]. **Shift = snap**
   (1 m / 15° / 0.1×, `ENRICHED.gizmoSnap*`). Escape rungs: menu → cancel a live drag (rig back
   where it began, nothing commits) → disarm → (the FPV unwind, unchanged).
6. **"Modified AND original values always visible; revert per-op and revert-all":** the chip
   grows one row per op (current · original · ↺ when that op is edited) + RESET ALL; the pinned
   label adds an op line (metres E/N/↑, the COMPASS-sense yaw = −rotDeg, the XZ scales) above
   the two U8 height lines. Per-op ownership: MOVE = tE/tN/tU · ROTATE = rotDeg · SCALE = sx/sz ·
   EXTRUDE = sy (`opIsEdited` / `revertOp`, store/bldgEdit.ts).
7. **The lift rail is structural twice:** `minY/maxY` on the anchor (parent space = the cell's
   bake-local frame, floor = the seated base, ceiling = `LIFT_MAX_M`) stops the drag itself, and
   `clampGizmoEdit` catches the centre-handle free move.
8. **Ghost body visible only while dragging** (U8's "preview appears on the first move" feel);
   the gizmo helper alone marks a spatial op between drags. The rig is re-placed from the
   committed target every frame between drags (it rides the easing seat), is re-created when
   an LRU-evicted cell streams back (the ghost dies with its cell — engine rule), and the gizmo
   lets go of it BEFORE `hideGhost` on disarm.

Taste calls surfaced, not decided: `TRANSLATE_MAX_M` 60 (the tile-level culling volume is not
grown by a move — the owner may raise it; the fix would grow the tile bounding volume) · the
fully shared party-wall post follows the lower run under a move (the neighbour loses that one
stroke) · the rotate ring is seen nearly edge-on from a street-level eye (still hittable: the
torus has thickness; a higher eye or a wider FOV opens it) · G/R/S vs numeric keys.

### §7.2 Files

`scene/bldgGizmo.ts` (new — the controls on the rig; DEV `handleScreenPx` / `originPx` reach
`TransformControls._gizmo`, version-pinned to three 0.185) · `scene/enrichedBuildings.ts` (the
rig: `showGhost(…, bodyVisible)`, `setGhostTransform`, `setGhostBodyVisible`, `ghostRig()`; the
ghost now seeds from the TARGET) · `scene/bldgEditLabel.ts` (op line) · `StylizedTiles.ts`
(op state, `applyBldgOp` / `finishGizmoDrag` / `revertBldg`, pointer routing in the FPV
handlers, the contextmenu + long-press entry, G/R/S/E, Escape rungs, `stepBldgEdit`, DEV
`__globe.bldgGizmo()`) · `store/bldgEdit.ts` (ops, `committed`/`live` on the mirror,
`revertRequest` / `menu` / `disarmRequest` one-shots, `opIsEdited` / `revertOp`) ·
`panels/BuildingEditChip.tsx` + `styles/building-edit.css` (the op strip, the rows, the menu;
the island wraps a pure `BuildingEditChipView`) · `lib/globe/featureTransform.ts`
(`yawDegFromQuaternion`, `rigToTransform` / `transformToRig`) · `lib/globe/bldgOverrides.ts`
(`clampGizmoEdit`) · `tuning.ts` (`ENRICHED.gizmoSize` 0.8, `gizmoSnapM/Deg/Scale`) · tests:
`featureTransform.test.ts` (+5), `bldgOverrides.test.ts` (+5), `test/store/bldgEdit.test.ts`
(new, 9), `test/components/buildingEditChip.test.ts` (new, 6) · `scripts/verify-meshedit.mjs`
legs 7–14.

### §7.3 Verification receipt

See DECISIONS 2026-09-02d for the numbers (unit tier · `verify-meshedit.mjs` 14 legs ·
`verify-bldg-override.mjs` byte-identical re-run · the §4a-4 sweep).

### §7.4 Left for MS3+ (deliberately)

The SYNC of spatial rows (MS3 grows the wire/collection by the v2 fields) · user meshes reuse
this gizmo at MS5 (attach to the model's own Object3D — no rig needed) · a numeric-entry field
per op (type a heading) · trees.

