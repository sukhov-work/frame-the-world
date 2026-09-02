# WIP 2026-09-02i — MESH SUITE MS5 (D3 placement: the world's user models) — BUILT

**Status: MS5 BUILT + browser-verified against the LIVE `UserModels` collection (cleanup proven).**
Mode: implement (design-first, investigate-design-v3 spine on `/frame`), tier Deep. Canonical:
`.claude/claude-docs/MESH_SUITE_PLAN.md` **§10 (MS5 as-built)** · §3 ladder (MS5 BUILT) · §5 recipe
(next = MS6). Prior: `mem:project/wip-2026-09-02-mesh-suite-ms4`, `…-ms3`, `…-ms2`, `…-ms0-ms1`,
`…-09-01-mesh-suite-plan`. Backlog T74 (advanced). DECISIONS 2026-09-02i.

## Session facts (boot)
- MS4 landed as PR #94 (`6d6c38f`) while this session's research ran — the `/clear` ship fired
  concurrently; read-only until "local checkout back on master" (the MS3 rule held).
- Four parallel research agents (platform/API · scene substrate · UI/stores · verify conventions),
  88–92 %; the crux facts re-read by hand before the design.

## The design that shipped (full text §10.1)
- **World read = a COVER query on a NEW denormalized `gh5` column** (`hasSome` is
  equality-on-a-set — the pins' gh4/gh6 precedent; a p9 hash cannot be prefix-queried).
  `GET /api/world-models?cells=` public + elevated (UserModels is ADMIN-everything), READY +
  un-hidden, `publicModel` strips `ownerMemberId` + every file id. `gh5` provisioned live by the
  script's incremental `create-field` path (25 fields). `planModelCover`: p5 cells of a 4 km
  half-side square around the ground focus, ≤ 16 nearest, null above 40 km; THROTTLED (600 ms),
  re-query on cover change or the 90 s re-poll; a superseded answer dropped.
- **`PATCH /api/models`** `{ id, lat, lon, rotDeg?, scale? }` owner-gated, the photos
  read-modify-write `items.update` shape; both cells re-derived; seats CLAMPED (identity → null).
- **No lift seat** [ASSUMPTION]: `groundFitOffset` re-bases the GLB (footprint centre on the
  origin, lowest point at y = 0); the terrain seat owns the height (`sampleGroundM` + `seatStep`,
  `resnap` re-asks while not REAL); the gizmo's MOVE hides the Y arrow (`attachBldgGizmo` grew
  `clamp` / `lift` options, defaults unchanged).
- **The rig IS the model**: `frame` (ECEF + ENU quaternion via `makeBasis(east, up, −north)`) →
  `anchor` (live move offset) → `body` (yaw + UNIFORM scale) → the GLB root. `rig(id)` is
  GhostRig-shaped (`cx 0, cz 0, liveBaseY 0, inflate 1`); a SECOND gizmo instance with
  `clampModelEdit` (uniform scale = the axis that moved most in log space — three's scale mode
  writes `scaleStart × offset` on the dragged axis only; band 0.5×/3× per edit, 0.1×..10×; the move
  ≤ 250 m per drag). A release folds the ENU offset into a NEW placement (`offsetGeodetic`,
  ellipsoid radii) and ONE PATCH carries `lat lon rotDeg scale`; the store swaps the row in at
  once (a patched row outranks the fetched copy for 15 s — the Wix Data read lag).
- **Residency = the density warning**: `planResidency` closest-first under `MODELS.maxResident`
  24 + `triBudget` 1.5 M with 3000/4000 m hysteresis; `skipped` (refused inside the load radius)
  → `densityWarning` → the MDL chip amber (+ count in the tip), the STORED card's HEAVY AREA hint,
  DBG `models.*`. Loads concurrency-capped (2); a failed fetch never retried; a late fetch for a
  released model disposed (gen counter). Zero per-frame cost with nothing resident.
- **The third edit session** (the building session's twin, kept separate): `store/modelEdit`
  (MOVE/ROTATE/SCALE, no extrude; MOVE has no original), right-click / FPV dblclick / long-press
  (a model under the cursor comes FIRST; an un-armable one keeps the native menu), G/R/S, Escape
  rungs, tap-away, FPV exit + MDL-off disarm; arming a building disarms a model and vice versa.
  `panels/ModelEditChip.tsx` reuses the building chip's CSS (`data-kind="model"`, YOURS / SAVING… /
  SAVE FAILED badge, no SYNC — a PATCH per release); the label via `bldgEditLabel.pin()`; the
  hover note "MODEL · title · yours". **MS5 arms OWN models only** (MINE from the owner GET).
- **PLACE ON GLOBE** (orbit click-to-place; `placingNow()` is the ONE predicate the orchestrator's
  five placing gates read; the `.pd-hint` pill; Escape cancels) · **the MDL chip ON by default**
  (the BLD recipe) · DBG `models.*` group (`DebugPanel` SLOW_PROVIDERS + the catalog test's
  provider set) · guide `fpv-models` + the deck list ("Eleven toggles").
- Seams: `__modelEditStore` · `__userModelsStore` · `__globe.userModels()` · `__globe.modelGizmo()`
  (+ `modelPx(id)`, `pickAt(x,y)`, `hoverId`). `contracts.md §3` = 27 top-level (it had
  under-counted `__pipCache` + `__frameGate`).

## Files
NEW `lib/models/modelPlacement.ts` · `lib/wix/modelRecords.ts` · NEW `pages/api/world-models.ts` ·
`pages/api/models.ts` (PATCH) · `lib/save/uploadMedia.ts` · `scripts/provision-collections.mjs` ·
NEW `store/userModels.ts` · NEW `store/modelEdit.ts` · `store/camera.ts` · `lib/prefs.ts` ·
`store/modelUpload.ts` (`addMine`) · NEW `scene/userModels.ts` · `scene/bldgGizmo.ts` ·
`scene/bldgEditLabel.ts` · `StylizedTiles.ts` · `tuning.ts` (`MODELS`) · NEW `panels/ModelEditChip.tsx` ·
`panels/CameraTiltPanel.tsx` · `panels/ModelUploadStep.tsx` · `panels/UploadFlow.tsx` ·
`panels/DebugPanel.tsx` · `styles/camera-tilt.css` · `lib/globe/debugCatalog.ts` ·
`lib/guide/guideContent.ts` · `global.d.ts` · `pages/index.astro` · docs: plan §10 + §3 + §5 ·
`contracts.md` §3/§4/§7 · `wix-headless.md` §9 · `globe-tuning.md` (MS5 family) · ARCHITECTURE routes ·
tracked-backlog T74 · tests NEW `modelPlacement` 15 · `modelRecords` +6 · NEW `store/{userModels 8,
modelEdit 4}` · NEW `components/globe/userModels` 4 · NEW `modelEditChip` 6 · `prefs` +1 ·
NEW `scripts/verify-usermodels.mjs` (10 legs).

## Verification receipt (fresh)
- Unit: vitest **2,411/2,411 (161 files)** (baseline 2,367/156) · `astro check` 0/0/9 · knip 0.
- Browser (`verify-usermodels.mjs`, headless Chrome :9333 fresh profile, `wix dev`, Dnipro FPV
  pose, the LIVE collection): **10/10** — a 12-tri 3×5×3 m box → STORED READY + MINE at once ·
  public row clean (no owner/file id) + resident + a REAL seat (19.55 m — the rendered terrain's
  coarse answer on a fresh profile, T76's shape) · right-click armed (chip + menu, screenshot) ·
  ROTATE 85.1° via the ring, PATCH landed · SCALE 3.000× uniform (the band's max) · MOVE 0.79 m as
  a new placement, anchor zero · reload re-applied everything · anonymous cannot arm · MDL off/on
  + pref · orbit click-to-place 1,669 m, seats kept · DELETE + media, world clean.
- `verify-bldg-override` PASS (U8 byte-identical). `verify-meshedit` **18/18** on the fourth run:
  run 1 RED at its reload leg on a platform **504 Gateway Timeout** (the wix dev log, 16:03:36);
  runs 2–3 RED at leg 17 because a member's REAL synced edit (`cell-11-10.glb` 68475, synced
  15:04 today — before the session) sat beside the seed and the leg asserted an EMPTY world →
  the assertion is now RELATIVE (`shared === before − 1`); the stray row is someone's edit and
  stays. The wider §4a-4 sweep (ultra/dusk/charter/eclipse/bestspot) NOT re-run this session.

## Traps (new)
- **The `#f=` boot FPV rides a temp pin, and the upload's review step retires the temp pin** →
  FPV ends when a model reaches review; a harness re-enters FPV for the edit legs.
- `verify-chrome.mjs --kill-stale` only kills an owner with the SAME profile dir — a different dir
  reads as FOREIGN; a raw `kill` is a permission prompt.
- The rendered terrain on a fresh headless profile can answer a coarse height (19.5 m at the
  Dnipro pose) that `sampleGroundM` calls REAL — assert the contract (finite, clamped), not a
  surveyed number.
- Scene fence: `scene/*.ts` may not value-import stores — push down, mirror up.
- A `Record<string, unknown>` parameter refuses an interface without an index signature — spread.

## Taste calls surfaced (not decided)
No lift seat · the 4 km cover / 40 km ceiling · `triBudget` 1.5 M / `maxResident` 24 / 1 M amber ·
own models only · foreign materials get no `uFtw*` injections · 250 m per-drag move cap · placing
is orbit-only.

## Owner observations after testing (2026-09-02j) — the MS5b batch, ordered BEFORE MS6 (plan §11)
"Rest is working fine." Three items: (1) metres on the SCALE rows — current vs original
dimensions (buildings `w × d m`, keep `dx/dz` per feature beside `rXZ`; models `w × d × h m`);
(2) per-edit RELATIVE rails, the extrude editing model — move ≤ 100 m per edit (was 60 absolute),
scale 0.1×–10× per edit about the committed value, no absolute caps, edits compound, revert stays;
a loose sanity rail on read/sync; the tile-volume culling caveat to decide; ask about lift + the
extrude cap; (3) BUG: the context menu closes on right-button RELEASE — no `e.button` guard, the
right press claims `fpvDragId`, the tap-release disarms (`mem:bugs/bldg-menu-right-release`);
fix with an early return for `e.button === 2` and REAL right-button harness legs; (4) BUG: an
ORBIT drag goes slow / barely moves after an FPV edit — the detached gizmo's invisible 100 km
drag PLANE stays in the scene at the edited building and GlobeControls' first-hit pivot raycast
lands on it (`mem:bugs/orbit-drag-after-fpv-edit`); fix by removing the helper from the scene
while nothing is attached (both gizmo instances) + an orbit-drag harness leg.

## Scale limits (owner question 2026-09-02k → plan §12; the post-MS6 audit T77 inherits it)
Bounds today: per file 100k tris / 8 MiB / 8 tex ≤ 2048² / 25 meshes; per area 24 resident under
1.5 M tris within 3 km (the COUNT cap binds for 2–10k-poly models); per cover ONE page of 200
rows oldest-first (a functional cliff: > 200 placements in ~8 km → the newest invisible).
Cliffs in order: texture VRAM (2048² ≈ 21 MB; 24 × 4 ≈ 2 GB → context loss) → draw calls × the
shadow pass (no batching/instancing) → main-thread arrival hitches → bandwidth. Levers: 1024²
default + `textureBytes` on the row + VRAM-aware residency + KTX2; a GLB cache + instancing per
URL; per-material merge; shadows on a leash; LOD rungs + thumbnail impostors; screen-space
priority; tier-aware budgets; off-thread parse; p6 cover with a 1 000-row newest-first page and
an upload-time per-cell density warning.

## Next
MS5b (above) FIRST, then MS6 = the my-uploads list, then the owner's ARCHITECTURE + PERFORMANCE
audit and revamp (T77). MS6 = the my-uploads list (thumbnails are ours; the list row now carries `rotDeg`/`scale`) with
hide / delete / title, every member editing user meshes (the MS3 sync machinery or an open PATCH
with LWW), a lift seat if wanted (a provisioned field), haze chaining on foreign materials, an
orbit hover/pick, `verify-usermodels` growing the MS6 legs.
