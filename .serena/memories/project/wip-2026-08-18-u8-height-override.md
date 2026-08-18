# WIP 2026-08-18→19 — U8 per-building height override SHIPPED (2026-08-19)

The UPLIFT ladder's last slice (owner point 10 + same-day additions: solid-original +
semi-transparent ghost juxtaposition during the drag, mesh-pinned dual-height indicator,
0.5×/3× per-edit band, both shells, backend PREPARED for the batch-sync phase). Full as-built
record: DECISIONS 2026-08-19 (top entry). Mode: investigate-design-v3 implement/Deep + /frame;
4 research tracks (engine 92% · gesture/HUD 92% · bake identity 92% · Wix backend 90%).
Gates 1,048/1,048 (+21) · astro 0 err/5 hints · browser-verified both shells.

## The design that shipped (rulings)
1. **Override = height SCALE about the LIVE base, folded INTO `applyFeatureSeats`** — the ONE
   writer of the position arrays. Scale-about-live-base COMMUTES with the seat's incremental
   `+= dy` translation (a later dy shifts base and spans together) → seats and overrides can
   never fight; poisoned-pair collapse passes through intact. Edge CSR gets the identical
   formula; `wrote=true` bumps the seat epoch → skyline/occlusion re-profile free.
2. **Key** `variant|cellUri|featureId` (cellUri = `tile.content.uri` basename — env-invariant
   dev/R2) + pristine X/Z-centroid checksum (0.5 m grid, ±1.5 m tolerance) + vert count;
   tilesetVersion deliberately EXCLUDED (checksum is the finer instrument). Storage
   `ftw:bldg-overrides:v1` (lib/globe/bldgOverrides.ts, cap 200 oldest-t trim — NOT the prefs
   blob: sanitizeViewPrefs would destroy unknown keys). Rows carry `s` (syncedAt) →
   `unsyncedEntries`/`markSynced` pre-wired for the sync phase.
3. **Pristine capture at load-model** (baseY/topY/centroid BEFORE any seat write — Y mutates
   afterward); LRU reloads re-apply via opts.overrides (checksum miss → onInvalid → row
   dropped). Pick: non-indexed `face.a` = direct vertex index (three-source-verified) →
   `runIndexOfVertex` binary search (added to enrichedMask + tests); 2.5 m baked-height floor
   skips o2w fences/lamps (no runtime class signal until the meta sidecar is consumed).
4. **Ghost** = run geometry REBASED to base-at-local-0 (spans ÷ appliedK) → the whole drag is
   `ghost.scale.y = liveK`, zero per-frame rewrites; MeshBasicMaterial accent, opacity 0.45
   (0.32 vanished against bright sky — browser-tuned), depthTest OFF ("on top" in grow AND
   shrink), XZ inflate 1.015 (no coincident-face shimmer). Parented to part.mesh (seats free).
5. **Tint**: armed = raw `_feature_id_0` varying vs `uFtwArmedId` uniform (**vFtwBId is
   tile-seed-polluted — never compare it**); committed = lazy `_ftw_override` Uint8-normalized
   attr (three zero-fills absent attributes — the `_batchid` precedent; OSM instance untouched).
6. **Gestures**: desktop FPV dblclick was a FREE SLOT (dropTempPinAt FPV-inert) → arms; glass
   double-tap detector in the FPV tap path (ORCH.doubleTapMs 320 / 32 px slop — the browser
   never synthesizes dblclick from canvas touches); drag = CLAIMED-pointer branch BEFORE the
   look math (the pinch precedent; yaw browser-proven pinned); Esc after skyMenu / before FPV
   unwind; tap-away, FPV-exit, BLD-off all disarm; second fingers IGNORED while armed.
7. **Chrome**: store/bldgEdit (deadband armed mirror ≥0.05 m + RESET one-shot, flyRequest
   idiom) · scene/bldgEditLabel.ts (geoLabels pooled-DOM, per-frame projection — "45.0 m /
   was 15.0 m") · panels/BuildingEditChip ONE island both shells (SkyContextMenu precedent) +
   styles/building-edit.css (desktop bottom 11rem — scrubber overlap browser-caught; /m 10rem
   compact, hints dropped) · stepBldgEdit in the scenery band (roster updated).
8. **Baker osmId carry**: overpass.mjs `w<id>` / `r<id>#<ring>` (multi-outer disambiguated);
   BOTH bakers emit `cell-*.meta.json` sidecars (o2w reads its own `extras.osmId`). NEVER in
   `_FEATURE_ID_0` — float32 exact only to 2^24, way ids ~10^9. BAKED_ASSETS §1 updated.
9. **Backend prep** (dormant until the sync phase): lib/wix/overrideRecords.ts — LWW ONE row
   per building, `_id` = FNV-1a-128(`variant|cell|featureId`) (bulkSave upserts by _id,
   d.ts:363-verified; bulkRemove :391; 1000 cap :347), server re-clamps to the shared band,
   variant validated vs the regions registry, NO coordinates in rows, memberId never public
   (C6) · /api/building-overrides (GET public per-variant · POST member batch) ·
   BuildingOverrides entry in provision-collections.mjs (ADMIN-all; NOT yet provisioned —
   `node scripts/provision-collections.mjs` starts the phase).

## TRAPS (cost real time this session)
- **TilesGroup no-recurse strikes again**: a ghost child's position/scale writes are NEVER
  composed unless you call ITS `updateMatrixWorld(true)` — on show AND every scale write.
  Symptom: ghost invisible while the pinned label (part.mesh.matrixWorld math) was correct.
- Ghost opacity 0.32 → invisible against bright sky at distance (JPEG floor); 0.45 reads.
- Chip position: desktop bottom-center collides with the TimeScrubber (→ 11rem); /m slot
  between the FPV strip and EXIT VIEW is ~1 chip tall (→ 10rem, hints/range dropped).
- A REUSED verify profile keeps localStorage — the previous run's override re-applies at boot
  (correct behavior!) and breaks "fresh arm" asserts; clear the key first (script does).
- vitest env is node: localStorage tests need the prefs.test.ts fakeStorage + stubGlobal idiom.

## Verification (repeatable)
`scripts/verify-bldg-override.mjs` (raw-CDP; Node 20 `--experimental-websocket`): clean-slate
→ dblclick grid-scan arms → claimed drag (ghost, yaw pinned, live 45.0 m = exactly the 3×
clamp) → commit (row `dnipro-o2w|cell-9-10.glb|61106` scale 3.00 + mesh overridden=1) → RESET
(row deleted, mesh restored) → Esc keeps FPV → reload re-applies with NO gesture → /m
double-tap + touch drag commits. Shots verify-shots/u8-01..06.

## Open tails
Production canary (U8 + terrain + o2w-default) rides the next `wix release` · T1 device pass
now judges the glass gesture feel (double-tap 320 ms / drag gain) · taste knobs in
tuning.ENRICHED.override* · sync phase = provision + SYNC button + boot fetch slot (NEXT
SESSION doc §2 has the activation ladder + open owner calls: vandalism posture, label field).

Related: [[project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule]] (ground truth + registry)
· UPLIFT_PLAN §2/U8 (as-built note) + §5 · DECISIONS 2026-08-19 · BAKED_ASSETS §1 (sidecars).
