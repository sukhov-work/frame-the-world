# Contract strings — the Hyrum inventory (PLUX)

Authored 2026-08-13 by the first full audit (backlog T23; checklists code.md item 12 + docs.md item 11).
**These are the app's implicit public contracts** — every observable grammar below has real consumers
(share links in the wild, saved localStorage blobs, verify scripts, baked R2 clients, Wix collection
rows). Changing one is a compatibility event: parsers stay tolerant BOTH ways (old links/blobs must not
throw; new emitters keep old readers alive where possible) and every change gets a dated DECISIONS line.
Later audits diff this file against the code (docs.md item 11); source anchors are given per row.

## 1. URL hash grammars (`src/lib/geo/urlPose.ts`)

| Form | Grammar | Notes |
|---|---|---|
| `#p=` | `#p=<lat 5dp>,<lon 5dp>,<camAltM>,<heading 1dp>,<tilt 1dp 0–88>` | orbit camera pose (formatPoseHash) |
| `#f=` | `#f=<lat 6dp>,<lon 6dp>,<eyeM 1dp>,<heading 1dp>,<pitch ±max 1dp>,<fov 1dp>` | FPV pose; **eyeM is GROUND-RELATIVE by design**; eye/pitch/fov clamped on parse |
| `&t=` | `&t=<utcMs, \d{1,15}>` | rides either form; LIVE time is never written |
| parse tolerance | leading `#` optional; trailing `&t=` tolerated by the pose parser; forms mutually exclusive | old links must never throw |
| `&sky=<targetId>` | **PLANNED (MOBILE_PLAN §4.4) — not in code yet** (audit-verified 2026-08-13) | add here when built |

Query-string contracts: `?enriched=` A/B seam (`src/lib/globe/enrichedVariant.ts` — absent→env URL ·
`off`→Cesium OSM · `<name>`→`…/enriched/<name>/tileset.json` segment swap · leading `/`→verbatim) ·
`?purchased=1` (post-checkout toast) · `?p=` (prod-login hash-fallback, backlog T3) · `?d=` on
`index.astro` (desktop opt-out for the mobile-default entry — sets `ftw:prefer-desktop` and skips
the `/m` redirect; new 2026-08-15).

## 2. localStorage keys (all `ftw:*`; re-diffed 2026-08-22, audit #3 D7)

| Key | Owner | Notes |
|---|---|---|
| `ftw:view-prefs:v1` | `src/lib/prefs.ts` | versioned blob; sanitizer READS legacy comet-era keys inside the blob (read-old-keys precedent, Phase C) — renames must keep that pattern |
| `ftw:simbad:v1` | `src/lib/sky/simbad.ts` | TTL cache (hits 30 d / misses 1 d) |
| `ftw:sbdb:v1` | `src/lib/sky/sbdb.ts` | TTL cache |
| `ftw:m-banner-dismissed` | `src/pages/index.astro` | new 2026-08-13 (M0) |
| `ftw:prefer-desktop` | `src/pages/index.astro` | new 2026-08-15 (mobile-default entry) — sticky desktop opt-out; set by `?d=`, checked before the coarse-pointer `/m` redirect |
| `ftw:bldg-overrides:v1` | `src/lib/globe/…` → `scene/bldgEditLabel` + the U8 edit flow | new 2026-08-19 (U8 building-height override), missed by the 2026-08-15 sweep. Rails since MS5b (2026-09-02l): PER-EDIT about the COMMITTED transform — move ≤ 100 m per drag, every scale axis 0.1×–10× per drag, compounding with no absolute cap — under a LOOSE sanity rail on read / SYNC / commit (\|t\| ≤ 5 000 m · scale 0.001–1 000 · lift 0–25 m; a persisted row outside THAT is dropped; it was the absolute 60 m / 0.1×–10× rail plus a 0.5×–3× per-edit band — loosening is a compatibility event, every old row is inside the new rail), keyed **`<variant>\|<cellUri>\|<featureId>`** (`src/lib/globe/bldgOverrides.ts` `overrideKey`/`parseOverrideKey`; `cellUri` = the baked content basename `cell-<x>-<y>.glb`, `featureId` = the bake-sequential `_FEATURE_ID_0` — NOT an OSM id; this row said `osmId` from 2026-08-22 to 2026-09-02 and that was doc drift). A re-bake CHECKSUM (`cx/cz/vc`) invalidates the row rather than migrating it, so a stale key is dropped, never applied to the wrong building; the RC17 sidecars carry the OSM id (`osm`, 100 % coverage on every live bake as of 2026-09-02) and the MESH SUITE MS3 slice adopts it as the re-bake-stable RECOVERY key (dual-key, never a hard cutover — `MESH_SUITE_PLAN.md` §4a). Row shape is versioned (v2 = `sy/sx/sz/tE/tN/rotDeg`, legacy `k` read as `sy`, MS1 2026-09-02). **MS3 (2026-09-02f):** two more optional fields — `o` = the building's OSM element id (the re-bake-stable recovery key; `/^[nwr]\d{1,16}$/`, a malformed one drops the field, never the row) and `d: 1` = a TOMBSTONE (a pending REMOVAL of a world-shared edit: identity transform, kept although neutral, masks the shared row locally, rides the next SYNC as a `removes` entry, deleted once it lands). `s` (synced-at) is now stamped by a real SYNC. This key holds MINE only (dirty edits, pending resets, synced copies); the WORLD's rows are fetched from `/api/building-overrides` at boot and held in memory (`lib/globe/bldgSync.ts`), never persisted. The backend twin is LIVE (provisioned 2026-09-02f) |

## 3. `window.__*` DEV seams (all DEV-gated; **27 top-level** as of 2026-09-02i — the MESH SUITE MS5 count re-enumerated `src/global.d.ts`: `__pipCache` and `__frameGate` had been declared there since RC19/RC21 without joining this list, and `__modelEditStore` + `__userModelsStore` joined now)

`__globe __renderer __composer __quality __globeQuality __mapWindowView __overlayRebuilds
__pipCache __frameGate __cameraStore __timeStore __uploadStore __pinsStore __memberStore
__planStore __saveStore __marketStore __minimapStore __skyStore __findStore __placesStore
__bldgEditStore __bldgSyncStore __bestSpotStore __modelUploadStore __modelEditStore
__userModelsStore`

Verify scripts and the NEXT_SESSION_PROMPT recipe consume these — removing/renaming one silently breaks
the browser-verify tier. (NSP's list was 3 short at audit time — this file is the canonical set.)

**The registry is `src/global.d.ts`** — every seam's TYPE belongs there, not in a `declare
global` next to its owner and never behind an `as unknown as` cast. Both drifts were live at
audit #3: `__globeQuality` shipped through the exact cast the registry exists to replace (A2-5)
and `__memberStore` was declared locally in `store/member.ts`, which is why this section
under-counted by five. Both are seated now.

The five added since the 2026-08-15 count:

| Seam | Owner | Purpose |
|---|---|---|
| `__globeQuality` | `GlobeCanvas.tsx` | `{ tier, dpr, leanFlat2d, mapFlat, lean }` — **live getters**, so a reader never sees a value frozen at the last governor step. `leanFlat2d` is the coarse-pointer-only DPR latch (false on desktop by construction); `mapFlat` is the engine's real flat-chart latch on every shell |
| `__mapWindowView` | `panels/MapWindow.tsx` | the expanded chart's live centre / twist / zoom + the **resolved aim anchor**. The anchor exists so a verify script READS the ladder's result instead of transcribing it (audit #3 C8/T36 — a transcribed copy failed by 81.8 m against a correct app) |
| `__overlayRebuilds` | `scene/imageryGround.ts` | imagery-composite fresh-instance rebuild count. THE assert for the QA-7b storm — Esri GET counts cannot isolate it. Invariant: ≤ 1 post-boot per rung |
| `__placesStore` | `store/places.ts` | MY PLACES rows + the on-map toggle |
| `__bldgEditStore` | `store/bldgEdit.ts` | U8 building-height edit state |

New sub-seam (dated 2026-08-22): **`__globe.aim()`** — the radar seam's resolved state: the
shared anchor (`anchorLatDeg`/`anchorLonDeg`), `skylineClaimed` + the `coverage`/`minCoverage`
behind it (A1-16), the focal cone's BufferGeometry ids (stable across an hFov sweep proves the
T38 per-frame realloc is gone) and `shadowAutoUpdate`.

New sub-seam (dated 2026-08-22k): **`__globe.eclipse()`** — the LIVE solar + lunar eclipse state,
read out of the engine and never re-derived by a script. That is the point of it: the whole defect
class this feature exists to fix is a geometry that disagrees with the pixels, so a verify that
recomputed the ephemeris could go green while the screen showed nothing. It reports the classified
phase/coverage/magnitude, the TOPOCENTRIC separation and both angular radii (the separation is the
load-bearing number — geocentric would be 1.006° where the truth is 0.062°), the `eclipseK`
daylight scalar as every consumer sees it, the sun fragment's own `uMoonOff`/`uMoonR` in sun-disc
radii, and the lunar umbra/penumbra radii in moon radii.

**Sub-seams** (dated 2026-08-18, audit-2 D6 — verify-recipe-consumed callables under the
top-level globals; same removal/rename rule):

| Sub-seam | Owner (file:line) | Consumer / purpose |
|---|---|---|
| `__globe.fpv()` | `StylizedTiles.ts:1571` | FPV state (yaw/pitch/fov/eye/lift) — FPV verify passes |
| `__globe.plan()` | `StylizedTiles.ts:1584` | planFeed debug snapshot — planner verify |
| `__globe.tempPin()` / `__globe.explore()` / `__globe.bodies()` / `__globe.enrichedSeats()` | `StylizedTiles.ts:1585/1590/1557/1547` | pin seat, explore journey, ephemeris dirs, enriched re-seat coverage |
| `__globe.map2d()` | `StylizedTiles.ts:1596` | U1/U3 2D-mode rendered truth (buildings group membership, not a flag) |
| `__globe.u2()` | `StylizedTiles.ts:1605` | U2 FPV-stability discriminators (zoom bank, eased grounds, LRU, jump ring) |
| `__globe.u5()` / `__globe.u5Mark()` | `StylizedTiles.ts:1633/1674` | U5 loading state (flags/aim/queues/latency) + time-to-first window |
| `__globe.eclipse()` | `StylizedTiles.ts` (`window.__globe` block) | solar + lunar eclipse state + every light scalar it drives — `verify-eclipse.mjs` (37 checks) |
| `__quality.governor.emaMs()` / `.hitchCount()` | `lib/globe/quality.ts:151–153` (exposed via `GlobeCanvas.tsx:348`) | frame-time EMA + hitch counter — U2/U5 soak gates |
| `__quality.ao` | `GlobeCanvas.tsx:257` | GTAO look tuning in wix dev |
| `__globe.bestSpot()` | `StylizedTiles.ts:2161` | `bestSpotFeed.debug()` — solve state, the four streaming epochs, residency tier |
| `__globe.bestSpotSheet()` | `StylizedTiles.ts:2170` | the **LIVE** material/texture read-back. Added 2026-08-24 because `__globe` exposes no `scene`, so all seven S4 done-checks had been asserting constructor ARGUMENTS in vitest, never the shipped material |
| `__globe.bestSpotField()` | `StylizedTiles.ts:2181` | the published RG8 score field itself — **the seam that caught `rMin === rMax === 187`** (one distinct value across 31,417 cells while 1,860 unit tests passed). Read the DISTRIBUTION, never a flag |
| `__globe.bestSpotTuning` | `StylizedTiles.ts:2064`, exposed `:2187` | callable + `.export()` + `.ab()` — the 54-leaf scoring-patch console (SPEC_V2 §5.6); a weights patch costs exactly ONE job and is `recompose` |
| `__globe.enrichedState(cellUri, featureId)` / `__globe.enrichedSetTransform(cellUri, featureId, t)` | `StylizedTiles.ts` (`window.__globe` block, MESH SUITE MS1 2026-09-02) | read one building's edit TARGET + APPLIED transform + checksum facts; DRIVE a full transform (`{sy,sx,sz,rotDeg,tE,tN,tU}`) through the SAME commit path as a drag release (engine target + persisted `ftw:bldg-overrides:v1` row). `__bldgEditStore.armed` now also carries `cellUri`, so a harness can address the armed building. Consumer: `verify-meshedit.mjs` |
| `__bldgSyncStore` · `__globe.bldgSync.{fetch,sync,shared,local}()` | `store/bldgSync.ts` · `StylizedTiles.ts` (`window.__globe` block, MESH SUITE MS3 2026-09-02f) | the world-sync counters (`world` fetch phase · `shared` · `complete` · `dirty` · `syncing` · the last push's `result`) + `requestSync()` (the one-shot the chip / pill / menu fire); `__globe.bldgSync.fetch()` / `.sync()` force the world fetch / the member push without the UI, `.shared()` / `.local()` dump the two maps. `enrichedState(...)` grew `osm` + `tint` (0 none · 1 world-shared · 2 mine), `enrichedSeats()` grew `shared`. Consumer: `verify-meshedit.mjs` legs 15–18 |
| `__modelEditStore` · `__userModelsStore` · `__globe.userModels()` · `__globe.modelGizmo()` | `store/modelEdit.ts` · `store/userModels.ts` · `StylizedTiles.ts` (`window.__globe` block, MESH SUITE MS5 2026-09-02i) | the armed USER MODEL mirror (`armed.{id,title,mine,lat,lon,sizeM,dragging,overridden,op,committed,live,saving,saveError}` + the `setOp` / `requestRevert` / `requestReset` / `requestDisarm` / `closeMenu` requests) · the world store (`world` / `worldPhase` / `cover` / `complete` · `mine` / `minePhase` · `placing` + `beginPlacing()` / `cancelPlacing()` / `setPlacement()` · `density`) · `__globe.userModels()` = the scene module's residency + per-model seat/rig state (`{ world, resident, loading, skipped, tris, failed, visible, warn, armedId, models[] }`) · `__globe.modelGizmo()` = the MODEL gizmo instance's live state (`armed, op, attached, dragging, axis, live, saving, saveError`) + `handlePx(name)` / `originPx()` / **`modelPx(id)`** (client px of a resident model's mid-height point — the harness right-clicks it). Consumer: `verify-usermodels.mjs` |
| `__globe.bldgGizmo()` | `StylizedTiles.ts` (`window.__globe` block, MESH SUITE MS2 2026-09-02) | the gizmo's live state — `{ op, attached, dragging, axis, live, rig: { liveBaseY, bodyVisible } \| null, handlePx(name), originPx() }`; `handlePx` projects a TransformControls picker (`X` / `Y` / `Z` / `XZ` / `XYZ` …; the rotate ring's centre-line) to client px so `verify-meshedit.mjs` legs 7–14 drive the gizmo with REAL CDP pointer events through the FPV gesture table (it only READS; no seam writes the gizmo); `debug(clientX?, clientY?)` dumps the controls' drag internals + a drag-plane probe at a point (the seam that caught the plane's silenced raycast, 2026-09-02). `enrichedState(...)` grew `seated` (the RC7 first sample has landed — the rig, hence the handles, can jump by the cell's relief before it). `__bldgEditStore` grew `op` / `setOp` / `revertRequest` / `menu` / `disarmRequest` + `armed.{op, committed, live}` |

## 4. Wix Data collection schemas (source of truth: `scripts/provision-collections.mjs`)

- **Photos** (ADMIN read/write; exact GPS lives ONLY here): `title ownerMemberId lat lon altitudeM
  headingDeg pitchDeg rollDeg focalLengthMm hFovDeg fovEstimated(B) geohash9 capturedAt(TEXT)
  cameraMake cameraModel lensModel textureWidth textureHeight fileName fileSizeBytes originalFileId
  previewFileId previewUrl isPublic(B) publicPrecision publicPinId productId productVariantId
  priceAmount currency`
- **PublicPins** (read ANYONE, write ADMIN; **never exact GPS — C6**): `title photoRef authorName
  latReduced lonReduced geohash gh4 gh6 precision previewUrl capturedAt altitudeM headingDeg pitchDeg
  rollDeg focalLengthMm hFovDeg textureWidth textureHeight cameraMake cameraModel lensModel productId
  productVariantId priceAmount currency`
- **SavedPlaces**: `title ownerMemberId lat lon eyeM headingDeg pitchDeg fovDeg timeMs` — one contract
  with the `#f=` grammar (same fields, same clamps).
- **BuildingOverrides** (ADMIN everything; the elevated `/api/building-overrides` is the only
  reader/writer; **PROVISIONED 2026-09-02f, 17 fields** — MESH SUITE MS3): `variant cell
  featureId osmId heightScale sx sz rotDeg tE tN tU cx cz vc bakedHeightM region memberId` —
  the six spatial NUMBER fields are the v2 row's components (null = identity; the server
  re-clamps onto `XF_RAILS` — the loose sanity rail since MS5b 2026-09-02l — and omits identity components); `_id` is the deterministic override
  hash (§7 — OSM-keyed when `osmId` is set). `cx/cz` are BAKE-LOCAL checksum metres, never
  geographic (C6); `memberId` is stamped server-side and never emitted by the public GET.
- **UserModels** (ADMIN everything; the elevated `/api/models` (owner) and `/api/world-models`
  (public) are the only readers, `/api/models` the only writer; **PROVISIONED 2026-09-02h, 24
  fields + `gh5` added 2026-09-02i = 25** — MESH SUITE MS4/MS5, D3): `title ownerMemberId fileId
  url thumbnailFileId thumbnailUrl fileName sourceFormat rawBytes glbBytes tris meshes textures
  decimatedFromTris bboxX bboxY bboxZ readiness hidden lat lon geohash9 gh5 rotDeg scale` — ONE
  row per uploaded model; **`gh5`** (MS5) is the denormalized p5 cell of the placement the public
  world read matches by `hasSome` (equality-on-a-set — the pins' gh4/gh6 precedent; a p9 hash
  cannot be prefix-queried), re-derived beside `geohash9` on every placement write;
  the BYTES are a PUBLIC Wix Media MODEL3D file (the platform refuses private 3D — MS0), so
  `hidden`/delete are record-level. `url`/`thumbnailUrl`/`glbBytes` are copied SERVER-side from
  the descriptor `/api/models` fetched itself (the allowlist is structural); `readiness` mirrors
  the descriptor's `operationStatus` (READY | PENDING | FAILED). `lat/lon/geohash9` = the member's
  CHOSEN placement of a world-visible object (the UPLOAD HERE seed at MS4; MS5 places), never a
  capture GPS — C6-clean; `rotDeg`/`scale` are the MS5/MS6 transform seats (null = identity).
- There is **no Listings collection** — listing fields ride Photos/PublicPins (ARCHITECTURE §5 corrected
  by the 2026-08-13 audit).
- Schema changes land in the provision script FIRST (platform.md item 13; `extensions.dataCollections`
  does not provision from wix dev).

## 5. R2 tileset layout

- Private bucket behind the `frame-the-world` Worker; key scheme `enriched/<version>/…/tileset.json`.
- Versions live as of 2026-08-13: `dnipro-real-3` · `dnipro-o2w-2` · `st-albans-o2w`.
- Client env: `PUBLIC_ENRICHED_TILES_URL` (R2 in build/release; dev serves local `bakes/` via the Vite
  middleware — dev NEVER hits R2).
- Sync contract: `tuning.ts ENRICHED.bbox` == `scripts/bake/cities/<city>.json` bbox (regen BOTH on
  change); `variantBboxes` for cross-city variants. Worker must stay CORS `*` + Range/206 correct.

## 6. Commerce linkage

- `catalogReference` REQUIRES `options.variantId` + the fixed Wix-Stores appId
  `215238eb-22a5-4c36-9e7b-e7c08025e04e` (never the TPA id) — productId alone = silently empty checkout
  (2026-07-16 trap).
- Product linkage fields on Photos/PublicPins: `productId productVariantId priceAmount currency`;
  SITE_CURRENCY stamped at create (EUR).

## 7. HTTP surface

- **11 API routes** under `src/pages/api/` as of 2026-09-02i (audit #3 D7 re-count gave 9 on
  2026-08-22; the 2026-08-13 "26 routes" figure was the whole `wix build` route table).
  **`/api/world-models`** (MESH SUITE MS5, 2026-09-02i): the PUBLIC world read of user models —
  `GET ?cells=<gh5,…>` (1..16 distinct p5 base-32 cells, lower-cased; 400 `BAD_REQUEST` otherwise)
  answers `{ models: PublicModel[], complete }` — `hasSome("gh5", cells)` ∧ `readiness === "READY"`
  ∧ `hidden ≠ true`, one page of 200 oldest-first, `complete: false` when a cell holds more; a
  `PublicModel` is `{ id, title, url, thumbnailUrl, tris, glbBytes, bbox, lat, lon, rotDeg, scale,
  updatedAt }` and NEVER carries `ownerMemberId` or a file id (C6). And **`PATCH /api/models`**
  (MS5): `{ id, lat, lon, rotDeg?, scale? }` (member-only 401 `SIGNED_OUT`; 400 names the field;
  404 `NOT_FOUND` "no such model of yours") re-derives `geohash9` + `gh5`, CLAMPS the seats onto
  the sanity rail (0.001×..1000× since MS5b 2026-09-02l — the 0.1×–10× band is per EDIT about the
  committed scale, client-side; yaw wrapped; identity stored as null), replaces the whole row and answers
  `{ model: ModelListItem }` (the list row now carries `rotDeg`/`scale`); 502 `UPDATE_FAILED`.
  Placement `lat/lon` on the wire is the member's CHOSEN spot of a world-visible object.
  `/api/photos` (GET/POST/PATCH/DELETE), `/api/places`, `/api/listings`, `/api/market` (public
  GET), `/api/upload-url`, `/api/sbdb` (param-allowlisted JPL relay), `/api/ping` (the release
  canary — never delete), `/api/dev-seed` (DEV-gated 404 in prod), **`/api/models`** (MESH SUITE
  MS4, 2026-09-02h — member-only GET own list · POST `{ fileId, title, fileName, sourceFormat,
  rawBytes, glbBytes, tris, meshes, textures, decimatedFromTris, bbox, lat, lon }` → `{ modelId,
  url, thumbnailUrl, readiness }` after the server fetches the Media descriptor and refuses
  anything but a public `model/gltf-binary` MODEL3D under the byte cap (400 with the verdict
  code `NOT_A_MODEL | WRONG_MIME | PRIVATE_FILE | TOO_LARGE | NO_URL | INGEST_FAILED`; 404
  `FILE_NOT_FOUND`; a re-POST of the same fileId answers the existing row with `existing: true`,
  another member's fileId 409 `ALREADY_REGISTERED`) · DELETE `?id=` → `{ deleted, mediaDeleted }`
  — record first, media best-effort), and **`/api/building-overrides`**
  (U8, new 2026-08-19; **LIVE since MESH SUITE MS3, 2026-09-02f**): the world-shared twin of the
  `ftw:bldg-overrides:v1` local store, admin-elevated. **GET `?variant=`** (public) pages by
  `skip()` at 1000 per page up to 10 pages and answers `{ overrides: PublicOverride[], complete }`
  — `complete: false` means the world is larger than the page cap and the client must not treat
  "absent" as "removed"; a `PublicOverride` is `{ variant, cell, featureId, osmId, heightScale,
  sx?, sz?, rotDeg?, tE?, tN?, tU?, cx, cz, vc, bakedHeightM, updatedAt? }` and NEVER carries
  `memberId` (C6). **POST** `{ upserts: OverrideSyncEntry[], removes: OverrideRemoveKey[] }`
  (member-only → 401 `SIGNED_OUT`; 400 names the offending index; ≤ 1000 each — the platform bulk
  cap) answers `{ inserted, updated, removed }`. **Last-committer-wins is STRUCTURAL, not
  timestamp-compared** (doc drift 2026-08-22 → 2026-09-02 said "LWW by `updatedAt`"): one row per
  building whose `_id` is the deterministic FNV-1a-128 hash of **`variant|osm|<osmId>` when the
  row carries an OSM id (every pickable building on every live bake does — MESH_SUITE_PLAN §6.1),
  else the legacy `variant|cell|featureId` fingerprint** (`src/lib/wix/overrideRecords.ts`
  `overrideId` — the §4a-2 dual key, never a hard cutover), and `items.bulkSave` upserts by `_id`
  replacing the WHOLE item — the last sync to land wins, no field is compared. A `removes` entry
  carries the same identity (its `osmId` is the one the SERVER knows the row by).
- **`public/sw.js` — a same-origin STATIC asset, not a route, but a contract all the same**
  (re-homed here 2026-08-22 from `UXBATCH4_PLAN.md` before it was archived — audit #3 D7/D8).
  iOS-ONLY registration (coarse-pointer + Apple UA), dev-gated (never registers on localhost),
  a 7-day-TTL PERFORMANCE cache for Esri / Cesium ion / workers.dev / OpenFreeMap GETs. Its
  scope is `/`, so the filename and location are the contract — moving it silently narrows the
  scope and orphans every installed worker. Policy (what it may cache, the TTL, the iOS gate)
  is fenced by `test/swTileCache.test.ts`. ToS posture is an ACCEPTED, dated risk (T17; A2-10
  asks to extend that row's host list with Cesium ion, whose content this now caches).
  Unprobed in production: the `Content-Type` Wix hosting serves for `/sw.js` (release rider).
- **`/api/upload-url` kind `"model"`** (MS4): the repo's FIRST server-side mime allowlist — ONE
  entry, `model/gltf-binary` (the client normalizes glb/gltf/obj/fbx to GLB), a `.glb` name
  (sanitized: basename, `[A-Za-z0-9._-]`, ≤ 200), size 1..8 MiB, else 400 `UNSUPPORTED_MODEL`;
  mints a PUBLIC plain-PUT URL filed under `/plux/models` and answers `{ kind, uploadUrl,
  fileName }`. The 401 message is now "sign in to upload" for every kind.
- Response shape note: `quota:{used,limit}` rides photos responses (limit currently always the free
  tier — audit finding B7).
- **Place quota DELETED (owner 2026-08-15c):** the `/api/places` POST 402 gate (old 50-cap) is
  GONE — no per-member SavedPlaces cap; the GET page (`PLACE_PAGE = 1000`,
  `src/lib/wix/placeRecords.ts`) is the only listing bound. A 402 from `/api/places` is no longer
  a contract.
