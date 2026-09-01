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
- **Platform unknowns — PARTIALLY RESOLVED by a docs probe (2026-09-01c, public dev.wix.com
  + support articles):** ✅ `MODEL3D` is a documented public `mediaType` enum value on the
  REST FileDescriptor; ✅ supported 3D formats are **.gltf/.glb**; the only published size
  figure is **25 MB** (from the File Share app article — the main Media Manager article lists
  no 3D row, so treat 25 MB as a soft signal; our 8 MB normalized cap is comfortably under
  either way). ⚠️ STILL UNKNOWN, docs exhausted (`urlExpirationDate` is documented only as
  "when relevant" with no conditions): (1) whether a PUBLIC MODEL3D URL actually expires;
  (2) wixstatic CORS + **Range** for `model/gltf-binary`; (3) the real Media Manager 3D
  per-file cap; (4) the GLB `operationStatus` walk (`onFileDescriptorFileReady` has NEVER
  been wired — the record needs a readiness state regardless).
  **→ These four are now ONE empirical probe, the decisive MS0 instrument (15 min, wix dev +
  signed-in member or site-token REST): mint `kind:"model"` upload URL → PUT a ~100 KB GLB →
  poll the descriptor to READY and print `media.model3d` verbatim (incl. urlExpirationDate) →
  `curl -I` the URL with `Origin:` and `Range:` headers → record CORS/Accept-Ranges/
  Content-Type → re-curl later for expiry.** Wix Data per-item byte cap + pagination-past-
  1000 remain docs questions (internal docs-schema MCP needs an SSO re-login:
  https://mcp-s-connect.wewix.net/api/login ; Bilbo — the wix-private code-answering MCP —
  is available for "what does wixstatic actually serve" if the probe ever disagrees with docs).
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
| **MS0 — ratify + probes** | Governance + quota RULED (see §4). Left: ratify §2 + the two §4 recommendations (osmId-into-MS3, XZ semantics); run the ONE empirical media probe (§1 — GLB upload → descriptor → headers → expiry); fix the two doc drifts (contracts.md key grammar + LWW). Small. | — |
| **MS1 — transform substrate** | Pristine-snapshot + absolute recompose in `applyFeatureSeats`; `addUpdateRange`; sphere+box bounds; re-locate after move; edge-rebuild-on-transform; `OverrideRow` v2 + sanitize + multi-component neutrality; rails; pure-math unit tests (the scene-test twin rule). | MS0 |
| **MS2 — gizmo UI** | Building context menu (armed building → MOVE/ROTATE/SCALE/EXTRUDE/RESET); TransformControls proxy (ENU quaternion, local space, layer isolation, dragging↔GlobeControls, minY/maxY rails); generalized ghost preview; extended label (per-op current + original, revert per-op / revert all); extrude unchanged; `verify-meshedit.mjs` harness. | MS1 |
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
   per-feature `osm` presence rate) for EVERY live bake — dnipro, dnipro-o2w, st-albans-o2w,
   chernobyl(+o2w) — before keying anything by osmId; features without an osm id keep the
   fingerprint key as fallback (dual-key read, never a hard cutover).
3. **Seat/re-seat pipeline**: the absolute-recompose path must reproduce the incremental
   writer's results exactly for identity transforms (the 99 % untouched fast path stays);
   seat epoch/quiet-frames semantics unchanged; the plausibility gate and poisoned-pair
   collapse behave identically for unedited features.
4. **Astro/planning/FPV consumers**: planFeed/occlusion sweeps, skyline profiles, FPV picks
   and `buildingTopWorld` anchors read the SAME arrays — the existing regression harnesses
   are the gate and ALL must stay green: `verify-bldg-override` · `verify-ultra` 28/28 ·
   `verify-ultra-dusk` 21/21 · `verify-rendering-charter` 85/85 · `verify-eclipse` 37/0 ·
   `verify-chernobyl` 8/8 · `verify-bestspot-ownerbatch` 45/45 · full vitest · astro check.
5. **Rendering**: no per-frame cost on unedited cells (one boolean/early-continue), no
   whole-buffer uploads outside an active drag (`addUpdateRange`), shadow/edge/tint
   behaviour unchanged for untouched buildings — spot-check with the DBG window's frame
   brackets before/after.

## §5 Session-start recipe (MS0/MS1)

1. Read this file, then `mem:project/wip-2026-09-01-mesh-suite-plan` (research digests) and
   the four full agent reports referenced there if needed.
2. MS0: AskUserQuestion the §4 items · Wix MCP the §1 platform unknowns · fix the two doc
   drifts · then `/frame` design-first into MS1.
3. The DBG window (2026-09-01) is the instrument for all of this — seat deferrals/rejections,
   cell counts, frame costs are live in it; open it before profiling anything.
