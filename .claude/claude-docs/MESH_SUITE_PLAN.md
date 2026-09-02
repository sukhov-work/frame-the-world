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
     uploads" list gets its thumbnail without rendering anything. **FALSIFIED 2026-09-02h (MS4):
     the descriptor's thumbnail URL (`static.wixstatic.com/media/<hash>.png`) answers 403
     text/plain — plain, browser-UA, referer and the `/v1/fill/` transform alike — a day after
     the upload, while `preview.status` still says READY (the probe never fetched it). MS4
     uploads its OWN rendered card thumbnail as a public IMAGE beside the GLB (§9.1-11).**
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
| **MS3 — D2 activation** | **BUILT 2026-09-02f (§8).** `BuildingOverrides` PROVISIONED on the live site (17 fields); the wire + collection carry the v2 row's spatial fields (server re-clamps, identity omitted) + the **OSM-keyed `_id`** (dual key — fingerprint fallback, never a cutover); boot fetch (paged GET, `complete` flag) + the MERGE POLICY (local pending wins · shared wins over my synced copy · a RESET of a shared edit is a TOMBSTONE); SYNC affordance in the chip foot, the context menu and a standalone PILL, sign-in gated (401 → SIGN IN); the `_ftw_override` byte LADDER (mine 255 / shared 128) + an origin badge + a hover note ("EDITED · shared · was …"); the OSM recovery sweep at load-model; `reapplyOverrides()`; `verify-meshedit.mjs` legs 15–18 against the LIVE collection. | MS1 (fields), not MS2 |
| **MS4 — D3 upload pipeline** | **BUILT 2026-09-02h (§9).** The dropzone forks on the file type (`classifyDrop`; the photo path byte-identical); a SEPARATE `store/modelUpload` walks load → inspect → audit → decimate → pack → thumbnail → review → upload → stored through ONE lazy import of `lib/models/normalizeModel` (GLTF/OBJ+MTL/FBX loaders, MeshoptSimplifier decimation + compaction, GLTFExporter on a 2048→1024→512 texture ladder, a disposable-renderer thumbnail); the caps are contract constants (`MODEL_CAPS`, pure audit); source units are a review-time choice; `/api/upload-url` kind:"model" = the first server-side mime allowlist (one entry); **`UserModels` PROVISIONED (24 fields)** + `/api/models` GET/POST/DELETE with the descriptor fetched server-side as the structural allowlist; our own thumbnail uploaded as a public image (the platform's is a permanent 403); NO quota; `verify-modelupload.mjs` 8 legs against the live collection. | MS0 answers |
| **MS5 — D3 placement** | **BUILT 2026-09-02i (§10).** The public world read (`GET /api/world-models?cells=` — `hasSome` on a NEW denormalized `gh5` column, the pins' precedent; READY + un-hidden; `ownerMemberId` stripped) + the owner `PATCH /api/models` (placement + the two seats, clamped, the photos read-modify-write shape); `store/userModels` (the cover-driven THROTTLED world read mirrored from the pins' focus, MINE, click-to-place, the residency mirror) + `store/modelEdit` (the bldgEdit twin); `scene/userModels.ts` (frame → anchor → body → the ground-fitted GLB; closest-first residency under a TRIANGLE BUDGET with radius hysteresis; the eased terrain seat; own pick; shadows); the MS2 gizmo instance reused on the model's own rig (uniform scale, no lift, the move folds into a new placement); the FPV session (right-click / dblclick / long-press, G/R/S, Escape rungs, `ModelEditChip`); PLACE ON GLOBE (orbit click-to-place); **the MDL chip ON by default** (camera store + pref + `.ct-mdl.is-on` + the engine gate) carrying **the physical-density warning** (skipped-by-budget nearby / heavy resident load); the DBG `models.*` group; a guide topic; `verify-usermodels.mjs` 10 legs against the LIVE collection. | MS2 + MS4 |
| **MS5b — owner tuning batch** (ordered 2026-09-02j after testing MS5; **runs BEFORE MS6**) | (1) real-world DIMENSIONS in metres on the SCALE rows — current and original footprint (buildings: `w × d m`, the height row already does it; models: `w × d × h m`); (2) the RAILS become PER-EDIT and RELATIVE, the extrude editing model: move ≤ **100 m per edit** (was 60 m absolute), scale 0.1×–10× per edit about the COMMITTED value, no absolute cap — repeated edits compound; per-op / all revert stays; (3) the context menu closes the moment the right button is RELEASED (stays only under a right-drag) — a right-button press claims the FPV pointer and its tap-release disarms; (4) orbit drag goes slow / barely moves after an FPV edit — the detached gizmo's invisible 100 km drag PLANE stays in the scene at the edited building and GlobeControls' first-hit pivot raycast lands on it; see §11. **BUILT 2026-09-02l — §11.5 is the as-built.** | MS5 |
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

## §4a THE NO-REGRESSION CONTRACT (owner 2026-09-01d — BINDING for MS1 and MS3; MS3 receipt in §8.5)

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
2. MS3 (the D2 activation) is BUILT — §8 is the as-built; `mem:project/wip-2026-09-02-mesh-suite-ms3`
   the digest. **MS4 (the D3 upload pipeline) is BUILT — §9 is the as-built;
   `mem:project/wip-2026-09-02-mesh-suite-ms4` the digest. MS5 (D3 placement) is BUILT — §10 is
   the as-built; `mem:project/wip-2026-09-02-mesh-suite-ms5` the digest. MS5b (the owner's four
   fixes/tunings) is BUILT — §11.5 is the as-built; `mem:project/wip-2026-09-02-mesh-suite-ms5b`
   the digest.** Next: **MS6** (the
   my-uploads list on `GET /api/models` — thumbnails are ours; hide / delete / title edits; other
   members editing user-mesh transforms through the MS3 sync machinery; a lift seat if the owner
   wants one — a provisioned field) on the §10 record.
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


---

## §8 MS3 AS BUILT — the D2 activation: world-shared building edits (2026-09-02f)

The dormant U8 backend is live. A signed-in member pushes every pending building edit to ONE
world-shared Wix Data collection; every visitor's globe fetches its variant's rows at boot and
applies them at cell load; the last person to sync a building wins. Rows are keyed by the
building's OSM id, so they survive a re-bake. The ladder row in §3 is the summary; this is the
design, recorded as decisions ([ASSUMPTION] where the owner has not ruled — surface, not re-open).

### §8.1 The platform facts the design rests on (docs + the installed SDK, not memory)

- Wix Data `query.limit()` default 50, **max 1000** [dev.wix.com wix-data-query/limit];
  pages by `next()/hasNext()` or `skip()`; bulk operations **1000 items per call**; item size
  cap **500 KB** [`@wix/wix-data-items-sdk …items.universal.d.ts`] (the error-codes page says
  512 KB — a row here is ~300 B either way). The public GET pages by `skip()` — each page its
  own `auth.elevate` call (a result's `next()` would run outside the elevation) — up to
  `GET_MAX_PAGES` (10 × 1000) and answers `complete: false` past that, which the client treats
  as "never delete on absence".
- `scripts/provision-collections.mjs` RAN 2026-09-02f: `+ BuildingOverrides created (17 fields)`
  — the six spatial NUMBER fields (`sx sz rotDeg tE tN tU`) were added to the schema first, so
  the collection was born v2 (zero data migration — the §4 ruling's premise held).
- `checkOrigin` is inert in dev and JSON `fetch` writes are exempt in the build (wix-headless
  §12b) — the SYNC POST is a same-origin JSON fetch carrying the `wixSession` cookie.

### §8.2 Identity: the OSM-keyed `_id` (the §4a-2 dual key, as shipped)

`overrideId(variant, cell, featureId, osmId)` hashes `variant|osm|<osmId>` when the row carries
an OSM id, else the legacy `variant|cell|featureId` fingerprint (a cell uri is never the literal
`osm`, so the namespaces cannot collide). The census (§6.1) gives 100 % of pickable buildings an
OSM id on every live bake, so every row the world will see is OSM-keyed from day one; the
fingerprint (`cell`, `featureId`, `cx`, `cz`, `vc`) stays IN the row as the locator + checksum.
Client side, the local row grammar (`ftw:bldg-overrides:v1`) grew `o` (the OSM id, written at
every commit from the pick / `featureState.osm`) and the engine's load-model apply became THREE
passes (`applyCellOverrides`): (1) the rows keyed to the cell by fingerprint — a checksum miss on
a row WITHOUT an OSM id drops it (the U8 rule), a row WITH one is left to (2) the RECOVERY sweep,
which asks `byOsm` for every feature the fingerprint pass left unclaimed, so a row whose
bake-sequential key died in a re-bake finds its building by OSM id and is RE-KEYED with fresh
facts (`onRecovered`; first feature wins when a bake gives one id to several runs — the
dnipro-o2w power-tower pairs, none pickable); (3) a feature still carrying an edit no row covers
any more eases back to the original. Cost: one `Map.get` per feature per cell LOAD — nothing per
frame (§4a-5).

### §8.3 The merge policy (the §2-5 starting point, decided)

Two maps. The LOCAL map (`ftw:bldg-overrides:v1`) holds MINE: dirty edits, pending resets and
synced copies of what I pushed. The WORLD's rows (`SharedMap`, `lib/globe/bldgSync.ts`) live in
memory only — fetched at boot and before every push, never persisted (a stale persisted world
would show deleted rows). The effective row for a building is `local ?? shared`, with three rules:

1. **LOCAL PENDING WINS.** A dirty row is my edit in flight: it applies here, masks the world's
   row, and rides the next SYNC — where LWW on the server means mine lands last. Nothing a
   member did is ever replaced by a fetch.
2. **SHARED WINS OVER MY SYNCED COPY.** A synced local row is only a cache of what I pushed; on
   a COMPLETE fetch the server's version replaces it (someone may have re-edited since) and a
   synced row the server no longer has is deleted (someone reset it). A partial fetch never
   deletes. The cache is what keeps my pushed edits visible offline / on a 502.
3. **A RESET of a building the world knows is a TOMBSTONE** (`d: 1` in the local row grammar —
   identity transform, kept by `sanitizeRow` although neutral; masks the shared row by key AND by
   OSM id so a re-baked twin cannot come back through the sweep; becomes a `removes` entry on
   SYNC, keyed the way the SERVER knows the row; dies once the removal lands). Without it the
   shared row would simply re-apply at the next load and RESET would look broken. A reset of a
   purely local edit stays a plain delete. [ASSUMPTION: a tombstone is dirty and counts toward
   the SYNC number — "1 pending" after a reset of a shared building is truthful.]

Fetch-before-push keeps the reconciliation honest; a failed fetch does not block the push (LWW
makes an un-reconciled push safe, merely opinionated). `finishSync` stamps a pushed row synced
ONLY if it is still the row that was sent (`t` unchanged — an edit made while the request was in
flight stays dirty). `OverrideIndex` (per cell + by OSM id) is rebuilt lazily after any change.

### §8.4 The affordances (owner: "login required to sync, all meshes synced at once")

- **SYNC** lives in three places, one state machine (`syncButtonState`, unit-tested): the chip
  foot while a building is armed, the context menu (`⇅ SYNC n`), and a standalone PILL in the
  chip's slot while NOTHING is armed but edits are pending — so pending edits are never hidden
  behind "arm a building first" [ASSUMPTION: the pill; the owner may prefer a deck chip]. States:
  `⇅ SYNC n` · `SIGN IN TO SYNC n` (anonymous, or a 401 — the button is the login round-trip via
  `loginUrl(returnHereUrl())`; the rows wait in storage) · `SYNCING…` · `✓ SYNCED n` / `✓ IN SYNC`
  (4 s) · `SYNC FAILED · RETRY n` (5xx / network / a 400 contract drift). 402 does not exist here
  (no quota on overrides — the owner's no-limits ruling applies).
- **The tint ladder**: `_ftw_override` is now a byte LADDER — 255 mine (`overrideTintCommittedK`
  raised 0.16 → 0.24 per "highlighted more distinctly than today"), 128 world-shared
  (`overrideTintSharedK` 0.13, new), 0 original — read in the fragment as two thresholds (a run's
  vertices all carry one byte, nothing interpolates onto a third level). The armed run keeps its
  stronger `overrideTintK`.
- **"A subtle indication of original vs overridden params"**: an ORIGIN badge on the chip's op
  strip (SHARED · UNSYNCED · SYNCED, each with a one-line title) and the menu head, plus a HOVER
  NOTE over an edited building nobody has armed — "EDITED · shared · 34.3 m · was 24.5 m" on the
  mesh-pinned label layer, fed by one throttled pick (`ENRICHED.hoverPickMs` 120, mouse/pen only,
  never during a look-drag). [ASSUMPTION: no pristine-footprint ghost for every edited building —
  a taste option for later.]
- **The re-bake note** is the SYNC button's title (one sentence: most edits survive a re-bake
  through the OSM key; one whose building changed shape can still be dropped) and the guide's
  `fpv-height` topic.
- Fails OPEN everywhere: a fetch that never lands (502 before provisioning, offline) leaves the
  world invisible and the user's own rows applying; `world: "error"` is observable in
  `__bldgSyncStore`.

### §8.5 Files + verification receipt

`lib/globe/bldgOverrides.ts` (`o`/`d`, `isOsmId`, `isTombstone`, `tombstoneOverride`,
`finishSync`) · NEW `lib/globe/bldgSync.ts` (the policy: `sharedRowFromPublic`, `reconcileShared`,
`OverrideIndex`, `syncPayload`, `applySyncResult`, `originOf`, `dirtyCount`) ·
`lib/wix/overrideRecords.ts` (v2 wire, `overrideId(…, osmId)`, `clampXf` server-side,
`OverrideRemoveKey`, `publicOverride` + `updatedAt`, `GET_MAX_PAGES`) ·
`pages/api/building-overrides.ts` (paged GET + `complete`) · `scripts/provision-collections.mjs`
(six spatial fields; RAN) · NEW `store/bldgSync.ts` (+ `__bldgSyncStore` in `global.d.ts`) ·
`store/bldgEdit.ts` (`origin`) · `scene/enrichedBuildings.ts` (`ov` level, the ladder,
`applyCellOverrides`, `reapplyOverrides`, `featureState.osm/tint`, `debugSeats().shared`,
`setTransform(…, origin)`) · `scene/buildingMaterial.ts` (the two-threshold ladder) ·
`scene/bldgEditLabel.ts` (`hover`) · `StylizedTiles.ts` (the seam with `byOsm`/`onRecovered`,
`bldgFetchShared`, `bldgSyncNow` + the login gate, tombstones in `commitBldgTransform`, the hover
pick, the SYNC one-shot in `stepBldgEdit`, DEV `__globe.bldgSync`) · `panels/BuildingEditChip.tsx`
+ `styles/building-edit.css` (SYNC button/pill/menu item, origin badge) · `tuning.ts`
(`overrideTintSharedK`, `hoverPickMs`) · guide `fpv-height` · tests: `bldgOverrides` +5,
NEW `bldgSync` (12), `overrideRecords` (rewritten, 9), NEW `store/bldgSync` (3), `bldgEdit`
fixture, `buildingEditChip` +4 · `scripts/verify-meshedit.mjs` legs 15–18.

Receipt: DECISIONS 2026-09-02f (unit tier · the live endpoint probes · `verify-meshedit` 18 legs
against the LIVE collection with cleanup) + 2026-09-02g (the §4a-4 sweep: bldg-override PASS ·
debughud · eclipse · bestspot-ownerbatch 45/45 · rendering-charter 85/85 · ultra-dusk · ultra
28/28 on its third warm run; final gates vitest 2,312/2,312 · astro 0/0/8 · knip 0).

### §8.6 Left for MS4+ (deliberately)

The DBG window has no sync metrics yet (`__bldgSyncStore` is the seam; a `edit.*` group is a
T73-class tail) · an `updatedAt`/"edited by" display (memberId is never emitted — a display label
would need a denormalized author field, a C6-shaped decision) · a per-user "my edits" list ·
the MS6 reuse of this exact machinery for user-mesh transforms.

---

## §9 MS4 AS BUILT — the D3 upload pipeline (2026-09-02h)

**Mode:** implement (design-first, investigate-design-v3 spine on `/frame`), tier Deep — three
surfaces (a client pipeline on three, a store + panel, a collection + two endpoints) and a browser
harness. Everything below was measured in this session; nothing is remembered.

### §9.1 The design decisions (recorded; [ASSUMPTION]s are the owner's to re-open)

1. **The fork lives in the dropzone, not in a second modal.** `DropStep.onFiles` → `classifyDrop`
   (pure, `lib/models/modelCaps.ts`): a drop that carries ANY model file (`.glb .gltf .obj .fbx`)
   is a model drop — every other file rides along as a companion resolved by basename (a `.bin`
   buffer, an `.mtl`, textures); extra model files are named + ignored. A drop with no model
   file keeps the photo path byte-identical (`files[0]`, exactly as before). `ACCEPT` grew the
   model extensions + `.bin,.mtl`; the input is `multiple`; the chips gained `GLB · GLTF · OBJ ·
   FBX`; the title reads "Drop a RAW, an image — or a 3D model".
2. **A SEPARATE store, `store/modelUpload.ts`** — not new phases in `useUploadStore`: 17 modules
   read the photo store and 15 sites branch on its `phase` to drive the frustum, the placing hint
   and the detail panel (counted 2026-09-02). The two share the overlay (`open`) and the UPLOAD
   HERE seed (`pendingPlacement`, consumed at review exactly as a GPS-less photo's ingest does —
   temp pin retired). Phase machine: `idle → loading → inspecting → decimating? → packing → review
   → uploading → stored`, `error` = a named refusal back on the dropzone (the dropzone shows
   "Could not take that model — …" beside the photo notice). Binary state (the loaded scene, the
   packed GLB) lives in MODULE scope, never in zustand.
3. **The pipeline runs on the MAIN thread through ONE lazy import** (`lib/models/normalizeModel.ts`;
   the store's `ModelPipeline` seam is injectable — unit tests drive a fake). [ASSUMPTION]:
   FBXLoader resolves textures through `TextureLoader` → `<img>`, which a Worker lacks; inputs are
   ≤ 15 MB and every step but the exporter's texture re-encode is tens of ms (measured §9.4). The
   C1 Worker rule is about RAW demosaic.
4. **GLB canonical, normalized client-side.** GLTFLoader (+ the embedded-wasm `MeshoptDecoder` for
   EXT_meshopt_compression) · OBJLoader (+ MTLLoader when an `.mtl` companion is present) ·
   FBXLoader → `GLTFExporter.parseAsync(root, { binary, maxTextureSize, onlyVisible })`. DRACO /
   KTX2 need decoder wasm the app does not ship → refused with `UNSUPPORTED_COMPRESSION` copy (the
   architecture doc forbids a casual `public/wasm/`; MS-later if ever).
5. **The caps are CONTRACT constants** (`MODEL_CAPS`: 100k tris · 2048² · 8 textures · 25 meshes ·
   15 MiB raw · 8 MiB GLB) and the verdict is pure (`auditModelStats`): triangles over budget are
   DECIMATED (proportional per-mesh plan, `decimationPlan`; MeshoptSimplifier with `LockBorder`
   over the error rungs 1 % → 5 % → 25 % → 100 %, then attribute COMPACTION so orphan vertices do
   not bust the byte cap; multi-material / drawRange meshes are locked — if the locked ones alone
   bust the cap the refusal is `TOO_MANY_TRIS`); oversize textures are DOWNSCALED by the exporter
   on a **2048 → 1024 → 512 ladder** until the GLB fits (an untextured model is judged on the first
   rung); animations are DROPPED (warning); skinned / morph-target meshes, > 25 meshes, > 8
   textures, an empty scene, > 15 MiB source and a GLB still > 8 MiB at 512² are REFUSED with
   member-facing copy (`violationMessage`). The raw-size gate runs BEFORE a byte is parsed.
6. **Source units are a review-time choice** with a heuristic guess (`suggestUnit`: raw longest
   extent ≤ 600 → m · ≤ 60 000 → cm · else mm; glTF is metres by spec but OBJ/FBX carry whatever
   the tool used). The unit is BAKED into the root node's scale at export; a change re-packs.
   [ASSUMPTION] the thresholds.
7. **Storage = Option C as ratified**: the bytes are a PUBLIC Wix Media MODEL3D (private 3D is
   refused — MS0), plain PUT (≤ 8 MiB sits under the TUS threshold) against a **kind:"model" mint**
   — the repo's FIRST server-side mime allowlist, with exactly ONE entry (`model/gltf-binary`), a
   sanitized `.glb` name and the byte cap (400 `UNSUPPORTED_MODEL`), filed under `/plux/models`
   (the `filePath` mint option — verified live: the descriptor's `parentFolderId` ≠ `media-root`).
   The **`UserModels` record (23 fields, ADMIN everything, PROVISIONED 2026-09-02h)** is the source
   of truth; `/api/models` is its ONLY writer and the allowlist is STRUCTURAL there: POST fetches
   the descriptor itself (`files.getFileDescriptor`, elevated) and refuses anything but a public,
   GLB-typed, size-capped MODEL3D with a static URL (`verifyModelDescriptor` — codes `NOT_A_MODEL
   | WRONG_MIME | PRIVATE_FILE | TOO_LARGE | NO_URL | INGEST_FAILED`); `url`, `thumbnailUrl` and the
   byte count are copied from THAT descriptor, never from the client. `readiness` mirrors
   `operationStatus` (READY on the PUT itself for these sizes). A re-POST of the same fileId answers
   the existing row (`existing: true`); another member's fileId → 409. DELETE removes the row then
   the media best-effort (`mediaDeleted` in the answer). GET = the owner's list (MS6's surface).
   No quota anywhere (owner 2026-09-01c).
8. **The record is born complete**: placement (`lat lon geohash9` — the UPLOAD HERE seed at MS4;
   MS5 places; C6-clean: a chosen placement of a world-visible object, never a capture GPS) and the
   transform seats (`rotDeg scale`, null = identity) are provisioned now, so MS5/MS6 need no schema
   change.
9. **Sign-in gating** is UI + structural: the CHECK card's primary action is `UPLOAD MODEL` for a
   member, a `SIGN IN TO UPLOAD` login link (`loginUrl(returnHereUrl())`) for a visitor (with the
   honest hint that signing in reloads the page — the packed model is module state); the
   endpoint's 401 is the gate that cannot be bypassed (the seam's `upload()` while anonymous lands
   back in `review` with `SIGNED_OUT` and the packed model intact).
10. **The card says what the platform makes true**: "STORED MODELS ARE PUBLIC — ANYONE EXPLORING THE
    GLOBE WILL SEE THEM ONCE PLACED" and, after storing, "PUBLIC BY URL — HIDING OR DELETING IT LATER
    REMOVES IT FROM THE WORLD, NOT FROM THE LINK" (the MS0 consequence, surfaced as promised).
11. **A card thumbnail is painted by a DISPOSABLE WebGLRenderer on an OffscreenCanvas** (three-quarter
    view, hemisphere + key light, transparent PNG; context released before it resolves) — the
    member's only confirmation that the loader read the right thing (a wrong up-axis FBX shows at
    once). The platform's own 256² preview replaces it on the STORED card.

### §9.2 Verification receipt (fresh, 2026-09-02h)
- Unit: NEW `modelCaps` 18 · NEW `modelRecords` 18 · NEW `store/modelUpload` 19 (a fake pipeline
  drives the phase machine, the caps, the texture ladder, the seed hand-off, the upload wire incl.
  the thumbnail leg) · full vitest **2,367/2,367 (156 files)** (baseline 2,312/153) · `astro check` 0 err / 0 warn /
  8 hints · knip 0.
- Browser (`scripts/verify-modelupload.mjs`, headless Chrome :9333 fresh profile, `wix dev`, the
  Dnipro FPV pose): **8/8 legs PASS** — (1) a 6,240-tri procedural GLB → CHECK card in **1.7 s**
  (loader chunk fetch included): exact tris, 1 mesh, 0 textures, metres, 178 KB packed, a blob
  thumbnail, the header lit at 2 CHECK; (2) a 159,200-tri textured sphere → **DECIMATED to exactly
  100,000 in 0.8 s**, texture kept, 2.7 MB packed; (3) an OBJ+MTL 3,000-unit cube → 12 tris, unit
  GUESSED cm (30 m), the M chip re-packs to 3,000 m; (4) a 16 MiB file → `RAW_TOO_LARGE` before any
  parse, notice shown, zero `/api` requests; (5) anonymous → the `SIGN IN TO UPLOAD` login link and
  `upload()` → 401 `SIGNED_OUT` with the packed model intact; (6) member: the allowlist 400s
  image/jpeg, a `.gltf` name and an over-cap size, a valid mint answers a sanitized name
  (`Дніпро kiosk (v2).glb` → `kiosk-v2.glb`), a bogus fileId → 404; (7) member upload of the dense
  textured sphere with an UPLOAD HERE seed → **STORED in 11.2 s** (a 2.8 MB PUT + the thumbnail
  PUT + the record): `readiness READY`, `https://static.wixstatic.com/3d/<id>.glb`, listed by GET
  with the facts + the seed (48.4647, 35.0462) + bbox 12 m; the served GLB answers 200
  `model/gltf-binary` ACAO `*`, generator `THREE.GLTFExporter r185`, 1 image, 0 animations,
  **POSITION 50,999 vertices (source 80,601) — compaction proven on the stored bytes**; our
  thumbnail serves `image/png` after 270 ms while the platform's answers 403; a re-POST answers
  the existing row; the descriptor sits in the `/plux/models` folder (`parentFolderId`
  `f204ebecab51489e92ea8e9af543ae9d`); (8) cleanup: DELETE → `{ deleted, mediaDeleted: true }`, GET
  no longer lists it — the world and the Media Manager left as found. Shots
  `verify-shots/modelupload-01..03`.
- Regression smoke on the shared surfaces: `verify-bldg-override` PASS (the U8/FPV path). The
  photo-path harness `verify-pin-reframe.mjs` is RED — **identically on bare master** (stash
  comparator: `terrain heightAt(pin) = −2047`, `loaded=false`, the correction never needed) → a
  PRE-EXISTING, environment-shaped red logged as **T76**, not MS4's. The engine-facing §4a-4 sweep
  was not re-run: MS4 touches no scene module (fenced by construction — `panels/`, `store/`,
  `lib/models`, `lib/wix`, `pages/api` only).

### §9.3 Files
NEW `lib/models/modelCaps.ts` (pure contract) · NEW `lib/models/normalizeModel.ts` (three, browser
tier) · NEW `lib/models/three-examples.d.ts` (MeshoptSimplifier types transcribed from the installed
source) · NEW `lib/wix/modelRecords.ts` (body parser · mint gate · descriptor verdict · record ·
list row) · NEW `pages/api/models.ts` (GET/POST/DELETE) · `pages/api/upload-url.ts` (kind:"model") ·
`lib/save/uploadMedia.ts` (`uploadModelGlb` · `postModelRecord`) · NEW `store/modelUpload.ts` ·
NEW `panels/ModelUploadStep.tsx` · `panels/UploadFlow.tsx` (the fork) · `styles/upload-flow.css` ·
`global.d.ts` (`__modelUploadStore`) · `scripts/provision-collections.mjs` (`UserModels`) ·
`conventions/contracts.md` §3/§4/§7 · `conventions/wix-headless.md` §9 · tests: NEW
`test/lib/models/modelCaps.test.ts` (18) · NEW `test/lib/wix/modelRecords.test.ts` (17) · NEW
`test/store/modelUpload.test.ts` (19) · NEW `scripts/verify-modelupload.mjs` (8 legs, member recipe,
cleanup in `finally`).

### §9.4 Left for MS5+ (deliberately)
The world read (visitors streaming placed models — a geohash-prefix `hasSome` on `geohash9`, the
pins precedent) · `scene/userModels.ts` + placement + the MDL chip + the density warning (MS5) ·
the my-uploads list on `GET /api/models`, hide/delete/title edits, transforms on user meshes through
the MS3 sync machinery (MS6) · a Worker for the loaders (only if a real file proves the main-thread
assumption wrong) · DRACO/KTX2 decode (needs shipped wasm) · a guide chapter (when the feature is
visible in the world).


---

## §10 MS5 AS BUILT — D3 placement: the world's user models (2026-09-02i)

**Mode:** implement (design-first, investigate-design-v3 spine on `/frame`), tier Deep — a public
endpoint + an owner PATCH, two stores, a scene module, the orchestrator's third edit session, a
chip, and a browser harness against the LIVE collection. Everything below was measured in this
session; nothing is remembered. Research: four parallel tracks (platform/API · scene substrate ·
UI/stores · verify conventions), confidences 88–92 %, every claim `file:line`-cited.

### §10.1 The design decisions (recorded; [ASSUMPTION]s are the owner's to re-open)

1. **The world read is a COVER query on a denormalized `gh5` column.** `hasSome` is
   equality-on-a-set (the pins' `gh4`/`gh6` precedent — `test/store/pins.test.ts` pins the
   exact cell length); a p9 hash cannot be prefix-queried, and `startsWith` + `or` chains are
   unexercised on this platform. So `UserModels` grew ONE column (`gh5`, provisioned live
   2026-09-02i by the incremental `create-field` path of `provision-collections.mjs` — 25 fields
   now), written by `modelRecord` at POST and `applyModelPlacement` at PATCH. The client plans
   the cover from the same ground focus the pins query rides (`planModelCover`: the p5 cells
   — ≈ 4.9 km squares — of a 4 km half-side square, ≤ 16 nearest; `null` above 40 km where a
   model is sub-pixel) and re-queries only when the cover changed or the 90 s idle re-poll is
   due — THROTTLED, not debounced (the pins lesson). One page (`MODEL_WORLD_PAGE` 200);
   `complete: false` says a cell holds more (a POC world).
2. **The public row is C6-clean by construction.** `publicModel` emits `id title url
   thumbnailUrl tris glbBytes bbox lat lon rotDeg scale updatedAt` — never `ownerMemberId`,
   never a file id; READY + un-hidden re-checked in the mapper even though the query filters
   them (`.eq("readiness","READY").ne("hidden", true)`). The placement is the member's CHOSEN
   spot for a world-visible object (§9.1-8), not a capture GPS. "Mine" is therefore resolved
   from the OWNER list (`GET /api/models` once the member session is known) and intersected
   client-side — the world never learns who placed what.
3. **`PATCH /api/models` is the ONE placement writer** — `{ id, lat, lon, rotDeg?, scale? }`,
   owner-gated (`ownedModel`, 404 otherwise), the photos read-modify-write shape
   (`items.update` replaces the whole item, so the stored row rides along); both geohash
   columns re-derived; the seats CLAMPED onto the rails (never rejected — the overrides
   precedent) and stored as `null` when identity (the record convention). Answers the owner's
   list row (now carrying `rotDeg`/`scale`) so the client swaps it in without a second GET.
4. **No lift seat.** A model always stands on the rendered terrain at its footprint centre:
   `groundFitOffset` re-bases the GLB so its bounds centre sits on the origin and its lowest
   point at y = 0 (the owner's "auto ground-fit at the mesh centroid"), the terrain seat owns
   the height (`sampleGroundM` + `seatStep` — a LOD refine slides, never teleports; a seat not
   yet REAL re-asks at `MODELS.resnapEveryFrames`), and the gizmo's MOVE hides the Y arrow
   (`attachBldgGizmo` grew `lift: false`; `minY = maxY = 0` as the belt to that brace). The
   owner's "never pushable irreversibly underground or into the sky" is thus structural: an
   edit cannot change a model's height above ground at all. [ASSUMPTION 2026-09-02i: a lift
   seat is MS6-if-ever — it needs a provisioned field.]
5. **The rig IS the model** (§7.4 as promised). `scene/userModels.ts` builds `frame` (ECEF
   position at the seated ground point; quaternion = the local ENU basis via
   `Matrix4.makeBasis(east, up, −north)` — +X east, +Y up, −Z north, the glTF convention the
   baker maps enriched cells into) → `anchor` (the LIVE move offset in ENU metres, 0 at rest)
   → `body` (yaw + UNIFORM scale) → the re-based GLB root. `rig(id)` hands the MS2 gizmo a
   GhostRig-shaped `{ anchor, body, cx: 0, cz: 0, liveBaseY: 0, inflate: 1 }`, so
   `rigToTransform` reads a drag back with no ghost and no recompose (unit-pinned round trip).
   The orchestrator runs a SECOND `attachBldgGizmo` instance with the model clamp
   (`clampModelEdit`: the per-axis read-back collapses to ONE uniform factor — the axis that
   moved most in log space, since three's scale mode writes `scaleStart × offset` on the
   dragged axis only — railed by the building band `clampEditK` 0.5×/3× per edit, 0.1×..10×
   absolute; the yaw wrapped; the move shortened to `MODEL_MOVE_MAX_M` 250 with its direction
   kept; the lift dropped). Precision: vertices stay model-local, the ECEF cancellation happens
   in the CPU's float64 model-view product (the frustum/pins idiom).
6. **A move commits as a NEW PLACEMENT, never a stored offset.** On release the clamped ENU
   offset folds into lat/lon on the WGS-84 ellipsoid (`offsetGeodetic`: meridional radius for
   north, prime-vertical × cos φ for east — unit-pinned to the centimetre at Dnipro), the
   frame re-seats there, the anchor returns to zero, the seats snap, and ONE PATCH carries
   `lat lon rotDeg scale`. The store swaps the answered row into `mine` and `world` at once
   (optimistic); a row this browser patched outranks the fetched copy for
   `MODELS.readLagGraceMs` 15 s — Wix Data reads lag writes by ~1 s (browser-measured 2026-09-02f).
7. **Residency is closest-first under a TRIANGLE BUDGET** (`planResidency`: `loadRadiusM`
   3000 / `unloadRadiusM` 4000 hysteresis, `maxResident` 24, `triBudget` 1.5 M — ≈ 15
   max-size uploads; deterministic, ties by id). What the budget or the cap refuses INSIDE the
   load radius is `skipped`, and `densityWarning(skipped, residentTris, warnTris 1 M)` IS the
   owner's physical-density warning (2026-09-01c: no quota — warn): the MDL chip turns
   warn-amber with the count in its tip, the STORED card's hint says HEAVY AREA, the DBG
   `models.*` group carries the numbers (`skipped` warnAbove 0, `tris` against the budget).
   GLB fetches are concurrency-capped (2); a failed fetch is a FAILED entry, never retried
   until its row changes; a fetch landing after its model was released is disposed (a gen
   counter). Zero per-frame cost with nothing resident (`update` early-returns) — §4a-5.
8. **Materials.** A GLB keeps its own PBR materials — the scene's lights, shadows
   (`castShadow`/`receiveShadow` on every mesh) and tone mapping apply; the enriched
   `uFtw*` haze / FPV dissolve / tint injections do NOT [ASSUMPTION: chaining `onBeforeCompile`
   for the aerial haze is a taste call for the owner]. The armed model gets an emissive lift in
   the accent token (`MODELS.armedEmissive`), restored on disarm. Disposal walks geometries,
   materials and their texture maps (the loaders leak otherwise).
9. **The third edit session is the building session's twin, kept separate** so U8/MS2/MS3
   stay byte-identical: `store/modelEdit` (armed mirror at deadband cadence, `op` /
   `revertRequest` / `menu` / `disarmRequest` one-shots), three ops (MOVE the placement ·
   ROTATE · SCALE — no EXTRUDE; MOVE has no "original", so its row shows the coordinates and
   RESET ALL restores the upload's yaw 0 / scale 1), the same entry points (right-click ·
   FPV dblclick · glass long-press — a model under the cursor comes FIRST, it stands in front
   of the building it was placed beside; an un-armable one keeps the native menu), G/R/S,
   the Escape rungs (menu → cancel drag → disarm), tap-away, FPV exit and MDL-off disarm.
   Arming a building disarms a model and vice versa. `panels/ModelEditChip.tsx` reuses the
   building chip's CSS (`.bldg-edit-chip` / `.bec-*` / `.bldg-menu`) with a `data-kind="model"`
   root, a YOURS / SAVING… / SAVE FAILED badge instead of the origin badge, and no SYNC (a
   PATCH saves on every release). Desktop-only mount (index.astro): models have no /m entry.
   The label reuses `bldgEditLabel` through a new generic `pin()` (the `update()` strings stay
   byte-identical); an un-armed model under the pointer shows "MODEL · title · yours".
10. **Placement is an ORBIT click; the fit is FPV** — two modes by construction (the photo
    `placing` idiom: FPV owns its pointer). The STORED card's primary action became PLACE ON
    GLOBE / MOVE IT ON THE GLOBE (`beginModelPlacement`: the overlay closes, FPV yields to
    orbit, the crosshair + ground marker take over through `placingNow()` — the ONE predicate
    the orchestrator's five placing gates now read), the `.pd-hint` pill says CLICK THE GLOBE
    TO PLACE “TITLE”, Escape cancels (the model keeps its spot), the click PATCHes. An
    UPLOAD HERE seed still stands the model up at once (the upload flow's `addMine` puts the
    optimistic row in the world before the read lag).
11. **MS5 arms OWN models only.** MS6 opens editing to every member through the MS3 sync
    machinery (the owner's D3 "every other logged-in user can re-edit any mesh").
12. **The MDL chip follows the BLD recipe exactly**: `camera.modelsVisible` (default ON,
    `saveViewPref`), a plain sanitize clause (no re-arm join), the hand-added `.ct-mdl.is-on`
    line (+ `.is-warn`), the engine gate in `stepUserModels` (`shellOn && cam.modelsVisible`
    → `setVisible`, which releases every resident model and ends an armed session), the
    guide's deck list (now "Eleven toggles"). Streaming cadence: the world focus is mirrored at
    `ORCH.mirrorEveryFrames` beside the pins call; residency re-plans every 12 frames.

### §10.2 Verification receipt (fresh, 2026-09-02i)
- Unit: NEW `modelPlacement` 15 · `modelRecords` +6 (MS5 placement + the public shape: the
  owner/file-id strip, both cells, the PATCH parser's clamps) · NEW `store/modelEdit` 4 · NEW
  `store/userModels` 8 (the throttled cover read with fake timers, a superseded answer dropped,
  MINE incl. the 401 → anonymous, click-to-place → PATCH, the read-lag grace) · NEW
  `scene/userModels` 4 (headless three: the ENU frame + ground-fit, the eased seat, the pick,
  the rig round-trip, seats/rebase/armed, residency + budget + the MDL gate, a late fetch
  dropped) · NEW `modelEditChip` 6 · `prefs` +1 · `debugCatalog` (the `models` provider) ·
  guide (new topic + the deck line) · full vitest **2,411/2,411 (161 files)** (baseline
  2,367/156) · `astro check` 0 err / 0 warn / 9 hints · knip 0 · `verifyHarness` fences the new
  script.
- Browser (`scripts/verify-usermodels.mjs`, headless Chrome :9333 fresh profile, `wix dev`, the
  Dnipro FPV pose, the LIVE `UserModels` collection with cleanup): see the DECISIONS 2026-09-02i
  line for the leg-by-leg numbers.

### §10.3 Files
NEW `lib/models/modelPlacement.ts` (the contract: rails, `clampModelEdit`, `offsetGeodetic`,
`groundFitOffset`, `planModelCover`, `planResidency`, `densityWarning`) · `lib/wix/modelRecords.ts`
(`gh5`, `parsePlacementBody`, `applyModelPlacement`, `parseWorldCells`, `PublicModel` +
`publicModel`, the list row's seats) · NEW `pages/api/world-models.ts` · `pages/api/models.ts`
(PATCH) · `lib/save/uploadMedia.ts` (`patchModelPlacement`, `fetchMyModels`, `fetchWorldModels`) ·
`scripts/provision-collections.mjs` (`gh5`) · NEW `store/userModels.ts` · NEW `store/modelEdit.ts` ·
`store/camera.ts` + `lib/prefs.ts` (`modelsVisible`) · `store/modelUpload.ts` (`addMine`) · NEW
`scene/userModels.ts` · `scene/bldgGizmo.ts` (`clamp` / `lift` options) · `scene/bldgEditLabel.ts`
(`pin()`) · `StylizedTiles.ts` (attach + subscriptions, `placingNow`, the model session, the
pointer/key/Escape/menu twins, `stepUserModels`, the `models` DBG provider, the
`__globe.userModels()` / `__globe.modelGizmo()` seams) · `tuning.ts` (`MODELS`) · NEW
`panels/ModelEditChip.tsx` · `panels/CameraTiltPanel.tsx` (`ModelsChip`) ·
`panels/ModelUploadStep.tsx` (`beginModelPlacement`, `ModelPlacementHint`, the STORED card) ·
`panels/UploadFlow.tsx` · `panels/DebugPanel.tsx` · `styles/camera-tilt.css` · `lib/globe/debugCatalog.ts`
· `lib/guide/guideContent.ts` (`fpv-models`) · `global.d.ts` (`__modelEditStore`, `__userModelsStore`)
· `pages/index.astro` · tests NEW `test/lib/models/modelPlacement.test.ts` · `test/lib/wix/modelRecords.test.ts`
· NEW `test/store/{userModels,modelEdit}.test.ts` · NEW `test/components/globe/userModels.test.ts` ·
NEW `test/components/modelEditChip.test.ts` · `test/lib/prefs.test.ts` · `test/lib/globe/debugCatalog.test.ts`
· NEW `scripts/verify-usermodels.mjs` (10 legs, member recipe, cleanup in `finally`).

### §10.4 Left for MS6+ (deliberately)
The my-uploads list on `GET /api/models` (thumbnails are ours) with hide / delete / title edits ·
every member editing user-mesh transforms (the MS3 sync machinery, LWW) · a lift seat (a
provisioned field) · haze/dissolve chaining on foreign materials · an orbit-mode pick/hover for
models (today: FPV only) · a per-model LOD (the upload cap is the LOD today) · a Worker for the
loaders (only if a real file proves the main-thread assumption wrong).


---

## §11 MS5b — the owner's observations after testing MS5 (ordered 2026-09-02j; build BEFORE MS6)

Verbatim intent, then what each item means in code. "Rest is working fine."

### §11.1 Real-world size on the SCALE rows
> "When scaling meshes, add real world size (dimensions) in meters (current and original values,
> you already do that for height anyway), so it is easier to understand scale properly."

- **Buildings**: the SCALE row prints `w × d m` for the CURRENT footprint and `was w × d m` for the
  mapped one (the EXTRUDE row's `24.5 m (+2.0) · was 15.0 m` precedent). The engine captures
  `minX/maxX/minZ/maxZ` per run at load (`enrichedBuildings.ts` ~1149–1182) but keeps only
  `rXZ` — keep two more floats per feature (`dx`, `dz`, bake-local metres; the pristine extents,
  unaffected by the incremental writer) and surface them on `BuildingPick` / `featureState` →
  `bldgArmed` → `BldgEditArmed` (`footprintM: [dx, dz]`); current = `dx·sx × dz·sz`. Keep the
  `1.20 × 1.00` factors as the secondary readout (or the label's op line) — the metres are the
  headline. The pinned label's scale op line gets the same metres.
- **Models**: the SCALE row prints `w × d × h m` (the loaded bounds × the uniform scale; the record's
  `bbox` before residency) and `was …` the upload's size; `ModelEditArmed` grows `sizeM3: [w, d, h]`
  (today only `sizeM` = max(w, d)). The menu head and the pinned label use the same triple.
- Tests: `opReadout` / `modelOpReadout` fixtures; the chip tests assert the metres.

### §11.2 Per-edit, RELATIVE rails (the extrude editing model), move raised to 100 m
> "apply same editing model that we have for extruding: keep current limits (60 m for move (make
> it 100 btw)) and 10x for scale) but once they are applied, you can edit new model size and now
> limits apply to `new` dimensions / positions, so they stop being absolute, after testing I found
> them quite limiting. Still of course I can revert each individual param to origin, or all of
> them — this is good feature."

- Today (`lib/globe/bldgOverrides.ts` `XF_RAILS` + `clampXf`): `|(tE, tN)| ≤ 60 m` ABSOLUTE from the
  pristine centroid, scale 0.1×..10× ABSOLUTE, lift 0..25 m; `clampGizmoEdit` adds the per-edit
  0.5×/3× scale band about the drag's start. The owner's rule: **each edit is bounded relative to
  the COMMITTED state, and the bounds compound** — move ≤ **100 m per edit** from where the
  building stands now; scale 0.1×..10× per edit about the committed scale (no absolute cap; the
  per-edit 0.5×/3× band goes — 10× IS the per-edit band now); lift unchanged (not mentioned —
  [ASSUMPTION] keep 0..25 m absolute; ask). Extrude: the owner names it as the model to copy —
  today it also carries the absolute 0.1×..10× rail on top of the 0.5×/3× band; [ASSUMPTION]
  make its band 0.1×..10× per edit and drop the absolute cap too, so all four ops share ONE rule
  (confirm with the owner: "extrude too?").
- Mechanics: `clampGizmoEdit(raw, start)` already re-anchors on `start` (the committed transform)
  → replace `clampXf`'s absolute translate radius by `|Δ(tE, tN)| ≤ 100 m` relative to `start`, and
  the absolute scale band by `start·[0.1, 10]`. `clampXf` (the READ sanitizer + the server's
  re-clamp on SYNC) needs a LOOSE sanity rail instead of the old absolute one, or garbage gets in:
  [proposal] `|t| ≤ 5 000 m`, scale 0.001..1 000, lift 0..25 — a persisted row outside THAT is
  dropped (the `k` precedent); loosening is a compatibility event (a DECISIONS line + contracts §2).
  The server (`overrideRecords.ts`) clamps onto the same loose rail. Rows written under the old
  rails stay valid (they are inside the loose one).
- The engine caveat stays true and must be stated to the owner: a building moved far from its
  cell's REGION bounding volume can be culled with its cell at the view edge (the tile-level
  volume is not grown by a move — `growBoundsFor` grows only the mesh bounds). With compounding
  moves this is reachable; the fix is to grow the cell's tile bounding volume by the same pad, or
  to accept the pop and say so in the guide. Decide at the slice.
- Models (`lib/models/modelPlacement.ts`): `MODEL_MOVE_MAX_M` 250 is already per drag (a move
  folds into a new placement — inherently relative); raise nothing unless the owner asks. Scale:
  the per-edit band today = `clampEditK` 0.5×/3× about the committed scale + the absolute
  0.1×..10× → make it 0.1×..10× per edit about the committed scale, no absolute cap (the same
  loose sanity rail on read + PATCH). The chip copy and the guide (`fpv-height`, `fpv-models`)
  say "between a tenth and ten times its current size, repeated edits compound".
- Tests: `featureTransform` / `bldgOverrides` / `modelPlacement` rails; `verify-meshedit` leg
  "rails: |t| 60 m" (the harness asserts the OLD numbers — rewrite to the per-edit rule: two
  consecutive 100 m moves land at ~200 m).

### §11.3 The context menu closes on right-button RELEASE (bug)
> "Context menu on a mesh looks fine, has all options and appears correctly on right click, but
> it is flaky, often unexpectedly disappears immediately after I release right mouse button and
> stays on screen ONLY when I hold right mouse and drag camera around — fix this bug."

- **Diagnosis (code-read 2026-09-02j, browser-UNVERIFIED — verify first with REAL right-button
  events):** the FPV pointer table has NO button guard — `grep "e\.button" StylizedTiles.ts` is
  empty. On macOS Chrome `contextmenu` fires on the right button's mousedown, so the sequence is
  `pointerdown(right)` → `onFpvPointerDown` claims `fpvDragId` and samples `bldgMenuDismiss =
  (menu !== null)` = **false** (the menu is not open yet) → `contextmenu` → the menu opens →
  `pointerup(right)` → `onFpvPointerEnd`'s TAP path (no travel, `pointerup`) → `if (bldgArmed) {
  if (bldgMenuDismiss) … ; disarmBuilding(); return; }` → the disarm resets the store, which nulls
  `menu` → the menu vanishes on release. Hold-and-drag travels past `ORCH.clickDragPx`, so the
  release is not a tap and the menu survives — exactly the owner's observation. The model session
  (MS5) mirrors the same path and has the same bug. The harnesses never caught it because they
  open the menu with a synthetic `contextmenu` MouseEvent and no pointer pair.
- **Fix:** a right-button press never enters the FPV gesture table — `if (e.button === 2) return;`
  at the top of `onFpvPointerDown` (and the orbit `notePointerDown`/`onPointerUp` twins if they
  gate on presses), so `fpvDragId` stays unclaimed and the release has no tap path; the
  `contextmenu` handler alone opens the menu. Consequence: a right-drag no longer looks around
  (it never should have). Keep the `bldgMenuDismiss` / `modelMenuDismiss` logic for a LEFT press
  that closes the menu (that path is right). Pin it: `verify-meshedit` and `verify-usermodels`
  open the menu with a REAL CDP right-button press + release (`Input.dispatchMouseEvent`
  `button: "right"`, `mousePressed` then `mouseReleased`) and assert the menu is still open 300 ms
  after the release; then a left tap away closes it.

### §11.4 Orbit drag goes slow / barely moves after an FPV edit session (bug)
> "check why after some editing of meshes in FPV when I move back to 3D map dragging around it
> becomes too slow and sometimes it just doesn't (or barely) drags around, nothing hangs but
> something breaks with drag sensitivity."

- **Diagnosis (code-read 2026-09-02j against the installed sources; browser-UNVERIFIED — verify
  first):** `TransformControls` keeps a DRAG PLANE — `TransformControlsPlane`, a
  `PlaneGeometry(100000, 100000)` mesh (three 0.185 `TransformControls.js:1915`) — as a child of
  the helper that MS2 adds to the scene at boot and never removes; MS2 deliberately left the
  plane's `raycast` intact (a no-op silenced every drag, browser-caught 2026-09-02) while the
  visible gizmo meshes got the no-op. The plane follows the attached object: after ANY FPV edit
  it sits at that building's ECEF position on the surface (before an edit it sits at the Earth's
  centre, where the terrain wins). `GlobeControls` (`3d-tiles-renderer` `EnvironmentControls.js:475/848`)
  finds its drag PIVOT and its camera-height point with `raycaster.intersectObject(scene)[0]`,
  `firstHitOnly = true` — three's Raycaster does NOT skip invisible objects, so from most orbit
  angles the 100 km invisible plane at the edited building is the FIRST hit, ahead of the terrain.
  The pivot lands on the plane at a wrong depth (or the height guard reads a wrong ground) and
  the drag math scales off it — slow, erratic, "barely drags", never a hang. MS2 judged the
  research trap moot ("arming happens inside FPV where the controls are off") — true for the
  pickers WHILE armed, wrong for the plane AFTER the session. MS5's second gizmo instance (the
  model rig) doubles the exposure.
- **Confirm in one probe:** in orbit after an FPV edit, `window.__globe.controls.pivotPoint` after a
  press vs the terrain height at that point; or `helper.traverse(o => o.raycast = () => {})`
  from the console — if the drag recovers at once, this is it.
- **Fix:** take the helper OUT of the scene whenever nothing is attached — `scene.remove(helper)`
  on `setTarget(null, …)` / disarm and `scene.add(helper)` on attach (both gizmo instances) — or,
  equivalently, swap the plane's `raycast` to a no-op while detached and restore it on attach. The
  first is simpler and also stops the detached gizmo from drawing anything. Alternative kept in
  reserve: a dedicated camera LAYER for the helper that GlobeControls' raycaster mask excludes
  (`tc.getRaycaster().layers` must then include it). Pin it: `verify-meshedit` + `verify-usermodels`
  grow an ORBIT leg after the FPV edit — a fixed-length drag must move the focus (`__cameraStore`
  focus / heading delta) by the same amount as a baseline drag before any edit (±10 %), and
  `controls.pivotPoint` after a press must sit on the terrain (height within a metre of
  `terrainHeightAt`), not on a plane.


### §11.5 MS5b AS BUILT (2026-09-02l) — all four items, browser-verified

**§11.1 metres.** The engine keeps the pristine footprint extents beside `rXZ` at load
(`FeatureSeat.dx/dz`, bake-local metres, captured before any writer touches the array and never
mutated) and surfaces them as `BuildingPick.footprintM` / `featureState().footprintM` →
`bldgArmed.footprintM` → `BldgEditArmed.footprintM` → the chip's `opReadout` / `opOriginal` (the
SCALE row: `24.0 × 12.0 m (1.20 × 1.00)` · `was 20.0 × 12.0 m`) and the pinned label's op line
(`⤢ 24.0 × 12.0 m · 1.20 × 1.00`); the factors stay as the secondary readout. Models: the scene
keeps `Entry.sizeM3 = [w, d, h]` (X, Z, Y extents at scale 1 — from the loaded bounds, before
residency from the record's `bbox [x, y, z]`), `UserModelInfo.sizeM3` → `ModelEditArmed.sizeM3` →
`modelOpReadout` / `modelOpOriginal` (`4.50 × 7.50 × 4.50 m (1.50×)` · `was 3.00 × 5.00 × 3.00 m`),
the menu head (the triple × the committed scale) and the label (`⤢ … m · 1.50×`, the orig line
`↳ 1.50× · … m`). ONE formatter, `formatMetres` / `formatDims` in `lib/format/readout.ts` (2 dp
under 10 m, 1 dp under 100 m, whole metres above — the upload step's FOOTPRINT precedent; the
upload step now imports it). `sizeM` stays for the harness. Nothing persists: display only.

**§11.2 rails — two layers.** The GESTURE rails are PER EDIT about the COMMITTED transform (the
`start` a drag re-anchors on): `EDIT_MOVE_MAX_M` **100** (new; `clampGizmoEdit` shortens the drag's
OFFSET from `start`, direction kept), `EDIT_MIN_K` / `EDIT_MAX_K` **0.1 / 10** (was 0.5 / 3) on every
scale axis — the footprint X/Z, the EXTRUDE height (`dragScaleK` → `clampEditK`) and a model's
uniform scale (`clampModelEdit`) share the ONE rule [ASSUMPTION: extrude too — the owner named it as
the model]; edits COMPOUND, there is no absolute cap; a non-finite read-back means "unchanged" (the
start), never a jump. The SANITY rail is the contract a persisted row is checked against —
`SCALE_MIN_K` / `SCALE_MAX_K` **0.001 / 1000** (was 0.1 / 10), `TRANSLATE_MAX_M` **5000** (was 60),
`LIFT_MAX_M` **25** unchanged and still absolute [ASSUMPTION: the owner's underground/sky rule;
ask] — applied by `sanitizeRow` (drop on read), `parseSyncEntry` (the server's SYNC re-clamp),
`applyTransformTarget` (the engine's commit), `sanitizeModelTransform` (the model read) and
`parsePlacementBody` (the PATCH). `MODEL_MOVE_MAX_M` 250 per drag unchanged. The DEV seam
`enrichedSetTransform` IS the commit path and therefore sees only the sanity rail — relative
semantics are a property of the gesture, proved with real drags (harness leg 8c). Compatibility:
every row written under the old rails lies inside the new sanity rail; the loosening is recorded in
`contracts.md` §2 / §7 and `globe-tuning.md`. **The tile-volume caveat is ACCEPTED, not fixed**:
`growBoundsFor` pads the mesh bounds only, the cell's tile volume is not grown, so a building
carried far from its cell can pop with the cell at the view edge — the guide (`fpv-height`) says so.

**§11.3 the right-button release.** Diagnosis CONFIRMED in the browser: on macOS Chrome the
`contextmenu` fires on the press, so the menu was open before the release — and the release's tap
path disarmed. `onFpvPointerDown` now returns for `e.button === 2` after closing any open edit menu
(the press invariant; `onSkyContextMenu` re-opens it where the click lands): the right button never
claims `fpvDragId`, so the release has no tap path and a right-drag no longer looks around. The
orbit twin `onPointerUp` ignores a right release too — a right-click is no longer a CLICK in orbit
(no pin open, no placing drop, no empty-map clear; a behaviour change stated to the owner). Belt
to the braces: opening an edit menu while a primary press is live CONSUMES the press
(`menuConsumesPress` → the M3c `longPressFired` rule), so a Ctrl+click reported as button 0 cannot
disarm either; the flag is now read ONCE per release whichever branch ends the gesture (a gizmo or
height release used to leave it set for the next release to swallow). Harness legs 7 / 14 (buildings)
and 3 / 8 (models) open the menu with a REAL CDP right-button press + release and assert it is still
open 300 ms after the release, then that a left tap closes it and keeps the session armed.

**§11.4 the parked drag plane.** Mechanism CONFIRMED against the installed sources (three 0.185.0 ·
3d-tiles-renderer 0.4.28): `detach()` only flips `_root.visible`; the plane keeps the last
`worldPosition`; `Raycaster` ignores `visible`; `EnvironmentControls._raycast` takes
`intersectObject(scene)[0]`. Fix: the helper is a scene child ONLY while something is attached —
`setTarget` adds it on attach (and refreshes its matrices for a same-frame hover/press) and removes
it on detach, in the ONE `attachBldgGizmo` both instances share; `inScene` on the handle and both DEV
seams; `helperRoot()` (DEV) lets a harness re-add it for one raycast as a POSITIVE CONTROL. Harness
leg 14b (buildings) / 6b (models): an in-page FPV exit (`setTempFpv(false)` — never a reload, which
would discard a parked helper and hide the bug), a fixed 220 px ground drag, the focus delta against
a baseline drag taken before any session (±25 %), GlobeControls' own raycaster's first hit under the
press pixel is not a gizmo object, `inScene` false for both gizmos, and the control sees the helper
once it is re-added.

**Harness rule promoted:** `verify-meshedit` now measures every world-level counter (`spatial`,
`overridden`) RELATIVE to what boot found (`worldBaseline`, after the world fetch settles) — the
collection is the production world and carried five members' rows at boot on 2026-09-02l; an
absolute "0 after RESET" read them as a regression (the leg-17 lesson, now everywhere).

**Receipt:** see DECISIONS 2026-09-02l (vitest · astro · knip · the three harness runs and their numbers).

**Open with the owner (not decided here):** lift stays 0–25 m absolute? · extrude shares the
0.1×–10× per-edit rule (assumed)? · the sanity numbers (5 km · 0.001–1000×) — a world-shared
1000× building or model is a moderation matter, not a rail · a right-click is no longer a click in
orbit · the tile-volume pop is accepted, not fixed.

---

## §12 Scale limits of user models — the owner's question (2026-09-02k) and the levers for the post-MS6 audit

Owner: "what are current practical limits for added models (e.g. people will keep adding meshes
with 2–10k polygons), when will the scene explode, what we can do about it? After this feature
we will have a thorough architectural and performance audit and revamp." Estimates below are
code-derived; every measured number is marked, everything else is an order-of-magnitude estimate
for the audit to replace with DBG readings (`models.*`, `frame.calls`, `frame.tris`, `mem.*`).

### §12.1 What bounds the client TODAY (as built)
- **Per file (MS4 caps):** 100k tris · ≤ 8 MiB GLB · ≤ 8 textures at ≤ 2048² · ≤ 25 meshes.
- **Per area (MS5 residency):** at most **24 resident** models within 3 km (hysteresis 4 km),
  under **1.5 M resident triangles**, nearest first; the rest are `skipped` (the density warning).
  At 2–10k tris per model the triangle budget never binds — **the count cap of 24 binds first**
  (24 × 10k = 240k tris, a fraction of the enriched city). Fetches: ≤ 2 in flight.
- **Per cover (the world read):** ONE page of **200 rows** (oldest first) for the ≤ 16 p5 cells
  around the focus. Past 200 placed models inside a ~8 km square the NEWEST placements are not
  even offered to the residency plan — a FUNCTIONAL cliff that arrives before any performance
  cliff in a popular city.
- **Worldwide:** unbounded (no quota, owner 2026-09-01c); the collection grows freely
  (500 KB per item, 1 000 per query page are the platform caps; the plan's item allowance is an
  [OPEN] platform question).

### §12.2 Where it "explodes" (the real cliffs, in order of arrival)
1. **Texture memory, not polygons.** A 2048² RGBA texture is ≈ 21 MB in VRAM with mips; 24 resident
   models × 4 textures ≈ 2 GB → WebGL context loss on ordinary laptops, far earlier on phones
   (~1 GB total). At 1024² ≈ 5 MB each → 0.5 GB — survivable on desktop, marginal on mobile.
   2–10k-poly models are geometry-cheap (≈ 0.1–0.5 MB each); their textures are the load.
2. **Draw calls + the shadow pass.** Each model mesh is one draw (no batching, no instancing: every
   GLB keeps its own materials), and every caster is drawn AGAIN per shadow map (the sun map, plus
   one per active ULTRA cascade). 24 models × 1–25 meshes = 24–600 main draws, doubled or tripled
   by shadows; three's per-draw CPU overhead (~10–30 µs) makes 600 extra draws ≈ 6–18 ms — a
   halved frame rate on integrated GPUs. The `maxMeshes` 25 cap is generous for a 2–10k model
   (typically 1–5 meshes).
3. **Main-thread hitches on arrival.** `GLTFLoader.parseAsync` + the GPU texture uploads run on the
   main thread: 20–200 ms per model (a 2048² upload alone is tens of ms). Flying into a dense area
   streams up to 24 models → a stutter burst spread over a few seconds (the concurrency cap
   bounds overlap, not the total).
4. **Bandwidth.** First visit to a dense area: up to 24 × 8 MiB = 192 MB; typical 2–10k models with
   1–2 textures are 0.5–3 MB → 12–72 MB. wixstatic serves immutable 180-day cache, so a re-visit is
   free.
5. **The 200-row page** (§12.1) — invisible newest models in a popular cell.
6. **Wrong "nearest 24" under the page cap:** the page is by creation date, the plan by distance —
   with > 200 rows in the cover the 24 chosen are the nearest of the OLDEST 200, not of all.

### §12.3 Levers, by payoff (the audit's shopping list)
- **Textures first:** default the export ladder to 1024² (2048² only when the byte budget and a
  size heuristic justify it); record `textureBytes` on the row at upload and make residency
  plan by **VRAM bytes** as well as tris and count; GPU-compressed **KTX2/Basis** (4–8× less VRAM,
  no decode hitch — needs the transcoder wasm the DRACO/KTX2 decision deferred).
- **A GLB cache + instancing:** cache parsed GLBs by URL for the session; N placements of the
  same asset become ONE geometry/material set (`InstancedMesh` per material) → the common
  "people place the same lamp 40 times" case costs one model.
- **Merge per material at load** (`BufferGeometryUtils.mergeGeometries`) → 1 draw per material;
  cap materials at upload.
- **Shadows on a leash:** cast only within ~300 m and above a size threshold; drop user models
  from the far cascades (layers).
- **LOD + impostors:** the meshopt simplifier already runs at upload — emit 2–3 LOD rungs; beyond
  ~1 km swap to a billboard impostor rendered from the model's own thumbnail (already painted).
- **Screen-space priority:** order residency by projected size (bbox / distance), not distance
  alone — a 100 m statue at 2 km outranks a 1 m cup at 100 m; the tiles' error-target idiom.
- **Tier-aware budgets:** the quality governor's tier (low / mid / high, ULTRA pin) scales
  `maxResident` / `triBudget` / the VRAM budget (e.g. 8 / 300k on low, 48 / 3 M on ULTRA).
- **Off-thread arrival:** parse GLBs in a Worker (geometry buffers transfer; textures via
  `ImageBitmap`), attach at most one model per frame.
- **The world read:** smaller cells (p6) with a bigger page (the platform max 1 000) and newest
  first, or several pages; longer term a per-cell aggregate the upload card reads ("this block
  already holds N models") — the density warning at UPLOAD time, not only at view time.
- **Governance (owner's call):** the warning stays the policy; a soft per-member cap or a
  per-cell cap are the levers if a city fills.
