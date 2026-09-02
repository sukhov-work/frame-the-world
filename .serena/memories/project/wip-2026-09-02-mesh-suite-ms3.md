# WIP 2026-09-02f — MESH SUITE MS3 (D2 activation: world-shared building edits) — BUILT

**Status: MS3 BUILT + browser-verified against the LIVE collection.** Mode: implement
(design-first, investigate-design-v3 spine on `/frame`), tier Deep. Canonical:
`.claude/claude-docs/MESH_SUITE_PLAN.md` **§8 (MS3 as-built)** · §3 ladder (MS3 row BUILT) · §5
recipe (next = MS4). Prior: `mem:project/wip-2026-09-02-mesh-suite-ms2`, `…-ms0-ms1`,
`…-09-01-mesh-suite-plan`. Backlog T74 (state updated). DECISIONS 2026-09-02f.

## Session facts (boot)
- The MS2 tree was NOT on origin/master when the session started: the session-end hook fired on
  `/clear` and ran concurrently (PR #92 landed 02:48, local master → 878e782, tree clean). Never
  edit while a ship run sits between "shipping branch=" and "local checkout back on master".
- Wix Data [DOCS dev.wix.com + installed SDK d.ts]: query `limit()` default 50 / **max 1000**,
  paging `next()/hasNext()` or `skip()`; bulk ops **1000 items per call**; item cap **500 KB**.
  A result's `next()` runs outside `auth.elevate` → page an ADMIN collection with `skip()`.
- **Wix Data honours a client-supplied `_id` on `bulkSave`** (inspected live: the row's `_id`
  equals the FNV hash) — LWW-by-`_id` is real. **Reads lag writes by ~1 s**: a GET right after a
  landed push does not list the row and a remove of it counts 0 → `SYNC_READ_LAG_GRACE_MS`
  (15 s) in `reconcileShared`, and every harness world-read polls.

## The design that shipped (full text §8)
- **Identity**: server `_id` = hash(`variant|osm|<osmId>`) when the row has an OSM id (100 % of
  pickable buildings on every live bake), else the legacy fingerprint hash — dual key. Local rows
  gained `o` (OSM id, written at every commit) and the engine's `applyCellOverrides` runs three
  passes: fingerprint-keyed rows (checksum miss drops only a row WITHOUT `o`) → the OSM RECOVERY
  sweep (`byOsm` for every unclaimed feature; re-keys via `onRecovered` with fresh facts) → any
  edited feature no row covers eases back to identity. Load-time only; nothing per frame.
- **Merge policy** (`lib/globe/bldgSync.ts`): LOCAL map = MINE (dirty, pending resets, synced
  copies); WORLD rows = in-memory `SharedMap` (fetched at boot + before every push; never
  persisted). Local pending wins; shared wins over my synced copy on a COMPLETE fetch (absent →
  deleted, past the read-lag grace); a RESET of a shared building is a TOMBSTONE (`d: 1`: identity,
  kept though neutral, masks by key AND by OSM id, becomes `removes` on SYNC keyed the way the
  server knows the row, dies when it lands). `finishSync` stamps only unchanged rows (`t` equal).
- **Wire**: `OverrideSyncEntry` += `osmId` + optional `sx sz rotDeg tE tN tU` (server `clampXf`
  onto `XF_RAILS`, identity omitted via `transformFields`); `OverrideRemoveKey` carries `osmId`;
  `PublicOverride` += `osmId`, spatial, `bakedHeightM`, `updatedAt` (`_updatedDate`); GET pages
  by `skip()` ×`GET_MAX_PAGES` (10) and returns `complete`. Provisioned 2026-09-02f: `+
  BuildingOverrides created (17 fields)` (six spatial NUMBER fields added first → born v2).
- **UI**: `syncButtonState` machine (SYNC n · SIGN IN TO SYNC n · SYNCING… · ✓ SYNCED n / ✓ IN
  SYNC (4 s) · SYNC FAILED · RETRY n) in the chip foot, the menu (`data-act="sync"`) and a
  standalone `.bldg-sync-pill` while nothing is armed; origin badge `.bec-origin[data-origin]`
  (SHARED / UNSYNCED / SYNCED); hover note "EDITED · shared · 22.5 m · was 15.0 m" on the label
  layer (`ENRICHED.hoverPickMs` 120). Tint ladder: byte 255 mine (`overrideTintCommittedK` 0.16 →
  0.24), 128 shared (`overrideTintSharedK` 0.13), read as two thresholds in the fragment.
- Stores: NEW `store/bldgSync.ts` (`world/shared/complete/dirty/syncing/result` + `requestSync`
  one-shot, seam `__bldgSyncStore`); `BldgEditArmed.origin`. DEV: `__globe.bldgSync.{fetch,sync,
  shared,local}()`, `enrichedState(...).osm/.tint`, `enrichedSeats().shared`.

## Files
`lib/globe/bldgOverrides.ts` · NEW `lib/globe/bldgSync.ts` · `lib/wix/overrideRecords.ts` ·
`pages/api/building-overrides.ts` · `scripts/provision-collections.mjs` · NEW `store/bldgSync.ts` ·
`store/bldgEdit.ts` · `global.d.ts` · `scene/enrichedBuildings.ts` · `scene/buildingMaterial.ts` ·
`scene/bldgEditLabel.ts` · `StylizedTiles.ts` · `panels/BuildingEditChip.tsx` +
`styles/building-edit.css` · `tuning.ts` · guide `fpv-height` · tests: `bldgOverrides` +5, NEW
`bldgSync` (13), `overrideRecords` (rewritten, 9), NEW `store/bldgSync` (3), `bldgEdit` fixture,
`buildingEditChip` +4 · `scripts/verify-meshedit.mjs` legs 15–18 (+ the member-session recipe).

## Verification receipt
- Unit: vitest **2,311/2,311 (153 files)** at the first full run (baseline 2,284/151); guide
  tests 69/69 after the copy edit; `astro check` **0 err / 0 warn / 8 hints**; knip exit 0.
- Live endpoint through `wix dev`: GET → `{"overrides":[],"complete":true}`, missing variant 400,
  anonymous POST 401.
- Browser (headless Chrome :9333, fresh profile, Dnipro-o2w FPV pose): **`verify-meshedit.mjs`
  18/18** — the MS1 six, the MS2 eight, and MS3: (15) a server-seeded row applies for an
  anonymous visitor (rotDeg 40 / sy 1.5, tint SHARED, `enrichedSeats().shared` 1, hover
  "EDITED · shared · 22.5 m · was 15.0 m", no pill) · (16) local edit wins (tint MINE, dirty 1,
  pill SIGN IN TO SYNC 1) and a RESET leaves a tombstone that masks the world row across a
  reload · (17) member SYNC: tombstone → `removed 1` (server GET agrees) → edit → `upserted 1`
  (heightScale 1.3, osmId w82966753), local row stamped synced · (18) anonymous: world sy 1.3
  (SHARED) → local sy 1.6 wins (MINE), pill SIGN IN; cleanup removed the row (world clean).
  Shots `verify-shots/meshedit-07-shared-applied.jpeg`, `meshedit-08-synced.jpeg`.
- §4a-4 sweep (one fresh Chrome per suite; DECISIONS 2026-09-02g): `verify-bldg-override` PASS
  (U8 byte-identical) · `verify-debughud` ALL PASS · `verify-eclipse` PASS ·
  `verify-bestspot-ownerbatch` 45/45 · `verify-rendering-charter` 85/85 (228 s) ·
  `verify-ultra-dusk` ALL PASS (225 s) · `verify-ultra` 28/28 on its THIRD run on the same warm
  profile (runs 1–2 = the cold-imagery-cache confound, same shape as 2026-09-02d).
- Final gates on the finished tree: vitest **2,312/2,312 (153 files)** · astro 0/0/8 · knip 0 ·
  the live collection holds 0 rows.

## Traps (new)
- **`astro check` re-optimizes Vite's dep cache under a running `wix dev`** → every
  `.vite/deps/*` module 504s and the globe never boots. Same recipe as a new globe import: stop
  `wix dev`, move `.vite/deps` aside, restart. A plain `kill` of the listener may not take —
  `kill -9` the `npm exec wix dev` / `astro dev` pids by number (never `pkill -f` a pattern
  your own command line contains).
- **Wix Data read-after-write lag (~1 s)**: poll world reads; the removal of a row inserted
  within ~1 s counts 0 — retry; the app keeps a 15 s grace before judging a synced row gone.
- **A `finally` that throws masks the leg that failed** — record and fail after the block.
- **A SYNC click is consumed next frame**: clear `result` before clicking, or a wait reads the
  previous outcome.
- **The pill shows the outcome for 4 s** (`SYNC_RESULT_MS`) before hiding — assert `done`, then
  wait.

## Taste calls surfaced (not decided)
The standalone pill vs a deck chip · a 4 s "✓ SYNCED" during which a new edit cannot be pushed ·
no author label on shared edits (memberId never emitted; would need a denormalized display
name — a C6-shaped call) · no pristine-footprint ghost for every edited building · a re-keyed
"mine" row is not marked dirty (the server's locator stays stale until the next edit; the OSM
key makes that harmless).

## Next
MS4 = the D3 upload pipeline (modal fork photo|model; loaders + normalize-to-GLB + validation +
auto-decimate; readiness; `UserModels` collection + endpoints; `/api/upload-url` kind:"model" +
the first mime allowlist) on the MS0 answers. MS6 reuses this exact sync machinery for user-mesh
transforms.
