# wip 2026-09-07c — compaction r6 · T83 FIXED (the lean tile-cache caps, farm A/B) · the iPhone `/m` · the VISIBILITY / OCCLUSION AUDIT (T108/T109 fixed, T110–T114 open) — DONE

Mode: implement + research/review lane (`/frame` under investigate-design-v3, Deep). Owner order 2026-09-07c:
proceed with the brief (no Android; the iPhone farm allowed) + the adjacent audit: "radar (minimap + 3D),
the scrubber's visibility graphs, the heat map and every other seeing mechanism must account for ALL
meshes (terrain, buildings, customized buildings, user meshes) in every mode, desktop and mobile".
Records: DECISIONS 2026-09-07c · MEASUREMENTS §22 · `audits/audit-occlusion-2026-09-07.md` · backlog T83
FIXED, T108–T114 added · NEXT_SESSION_PROMPT refreshed.

## Compaction round 6
DECISIONS lines 498–531 (2026-09-06n → 2026-09-05b; 34 lines / 80,273 B, md5 2137d0be57d10eccd791b4738c52e411)
→ ARCHIVE §Moved 2026-09-07; three opus digests (T77 MEASURE+phones+slice 0 · hygiene+resume · six
worktrees+rulings); the 09-06o → 09-07b tail stays verbatim. 140.7 → 74 KB.

## T83 — re-shaped, then FIXED
- `ios-baseline.mjs --soak-no-reboot` (soak the fpv page ALREADY UP; bail on the FIRST stall — a dead page
  costs 120 s per Appium call). First run: ONE page reloaded at page age 129 s (contaminated by my own
  `src/` edits — HMR reaches the phone through the tunnel — but the clean A/B below agrees).
- Desktop twin `probe-memory-footprint.mjs --look --phone` (new `--look` = the farm's touch drag every 4 s):
  661 → 1,540 MB in 83 s tracking the caches (107 → 335 MB; geometry 96 → 292, ArrayBuffers 173 → 639);
  ~3.9 MB footprint per cached tile-MB; `mid` caps 256/256/320 rest at 624 MB of tiles. A STATIC page
  never fills them (why §21.1 read 510 MB flat).
- LEVER: `QUALITY.leanMobile.{lruBytesMB 48, enrichedLruBytesMB 128, groundLruBytesMB 112}` via
  `lruCapBytesForLean(capBytes, lean, leanCapMB)` (`lib/globe/quality.ts`; min on every tier incl. high's
  null; lean=false → argument untouched); `StylizedTiles` opt `lean` from `deviceCaps.coarsePointer`.
  Twin: caches rest 8.6/84/96 from ~35 s, geometry 163 MB, footprint 1.0–1.18 GB plateau.
- ALSO `RENDERER.releaseOnPageHide`: GlobeCanvas's cleanup is a named idempotent `teardown()`, run on
  `pagehide` + `renderer.forceContextLoss()`; bfcache `pageshow` → reload. (LRUCache 0.4.28 has no
  `unloadAll`; `TilesRenderer.dispose()` is the release.)
- FARM A/B (iPhone 17 Pro, clean): caps ON `--poses m,fpv --ramp 0 --soak-min 4 --soak-no-reboot` —
  `/m` dt 17/17 cpu **2 ms** (was 26; T107 on the iPhone) · `#f=` as the SECOND load alive · soak alive at
  page age **269 s**, caches 8.6/84/97. Caps OFF (temp 100,000): 124/187 MB at 92 s, dead before 115 s.
  Watch: dt p50 18 → 26 over 4 min of look-around (hitches ~1/s, T106's family); the flip bank on phones
  unmeasured.

## The occlusion audit (three opus finders + verification)
- ONE pipeline feeds every radar/scrubber/plan/FIND/TARGET surface: `scene/planFeed.ts` → `store/plan
  .profileBins` (120 bins = 3°, terrain marched 60 m → 30 km via `ground.heightAt`, mesh EDGES ≤ 3 km,
  trees as canopies); desktop and `/m` identical. BEST SPOT has its own DSM. No T77 regression (nothing
  under `src/lib/geo/**` touched since 09-04; 693/693 focused tests).
- FIXED T108: user models occluded nothing → `userModels.occluderRoot()` + `occluderEpoch()`; planFeed's
  `collectMeshes` visits it (no mask rejection; instanced meshes in a GLB skipped), bestSpotFeed flattens it
  into SOLID outside the provenance count; both watch `modelsEpoch`.
- FIXED T109: planFeed never re-swept a tile that landed after the sweep (its only invalidation was the
  enriched re-seat epoch) → `PlanFeedCtx` carries `terrainEpoch · builtEpoch · modelsEpoch`, re-sweep of the
  SAME anchor after `PLAN.streamQuietFrames` 90 quiet frames; and the CARRY POLICY — `shown` (the last
  complete profile) stays published through a rebuild within `PLAN.carryProfileDistM` 60 m
  (= `AIMCONES.skylineGuardM`, test-locked ≤), null beyond. `debug().carried/epochs`.
- OPEN: T110 3° bins under a long lens (fine mesh-only bins recommended) · T111 HUD chips / day arcs /
  showers / eclipse rows geometric-only (`profileSample()` has one caller, a null check) · T112 six raw
  consumers skip `skylineBinsFor` · T113 BEST SPOT mask asymmetry + dead `addFloatingSolid` · T114
  heightMemo region-less tiles.
- Tests: `test/components/globe/planFeed.test.ts` NEW (9) · bestSpotFeed +2 · userModels +1 · quality +3;
  fusedBloom/resolvedComposer source pins re-pointed at `const teardown = () => {`.

## Gates: vitest 2,782/2,782 (177) · astro 0/0/11 · knip 0 · pre sweep 12/14 · post sweep: DECISIONS.
## Traps learned
- A `src/` edit during a farm run is a second document on the phone (HMR through the tunnel).
- The farm syslog clock is Pacific; "Memory usage info dump" lines = WebKit memory pressure; all Safari
  children terminate together at `deleteSession` — not a kill.
- `placeRig` takes a `FeatureTransform` (sx/sy/sz/tE/tN/tU), not model seats.
