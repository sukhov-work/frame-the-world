# wip 2026-09-10 — T123 levers (a) + (d): the detached tile caches released on the /m 2D drop; the composite canvases released at dispose

Mode: implement, Deep (`/frame` under investigate-design-v3, portable core). Status: **DONE 2026-09-10 — T123 FIXED TO THE
OWNER'S GATE** (DECISIONS 2026-09-10, MEASUREMENTS §31.1–31.8, backlog T123/T124/T130, NEXT_SESSION_PROMPT rewritten).
**Farm run 2 (a + d): `alive 8 cycles, flat (lru 97/97/94/97/97/97/97/97 tex 60/87/71/84/88/93/77/87 geo 92/135/131/164/167/171/153/166)`**
— page age 450 s at the end, dt p95 17 ms on every resting row (session `…/03d315b0-41c2-4c8c-a05b-4c50010a5bc8/00000`).
**T124 `--legs t124` with both levers in: `resident`** (altanka ready, seated 91.1 m, 11,826 tris at 5–90 s). Three farm
sessions (~18 + ~18 + ~11 device minutes). Gates at the end: vitest 3,061/202 · astro 0/0/12 · knip 0 · sweep
`post-2026-09-10b --compare post-2026-09-09` calls+tris identical to the session's first sweep on all 14 poses (11/14 vs
the golden = the ground-tile boot band; `detachedReleases` 0 on every desktop pose). Freshest golden `post-2026-09-10b`.
Files: NEW `src/lib/globe/detachedRelease.ts` · `src/lib/globe/compositeCanvasRelease.ts` · `scripts/probe-memory-dump.mjs` ·
`test/lib/globe/{detachedRelease,compositeCanvasRelease}.test.ts`; EDITED `tuning.ts` (`MOBILE2D.releaseDetachedTiles` /
`releaseDetachedGraceMs`, `GROUND.releaseCompositeCanvas`), `StylizedTiles.ts` (the gate step + the DBG rows),
`scene/{buildings,enrichedBuildings}.ts` (`cacheItems` / `releaseCache`), `scene/imageryGround.ts` (the overlay wrapper +
`compositeCanvasStats`), `lib/globe/debugCatalog.ts` (8 rows), `scripts/probe-fpv-cycle-leak.mjs` (cache counts + the drain
receipt + a process read; the 3 s `heatmap-off` rest), MEASUREMENTS §31.
Next: the farm FEATURE legs · the T77 lane · the watch item (the ~35 MB/cycle renderer creep, §31.6).
Owner ruling 2026-09-09b: build lever (a), A/B on the twin, re-run the farm stress leg (gate 8 cycles alive), (b)/(c) off
the shelf only if (a) alone does not hold. Browsers: no Pixel; the house headless :9333 + the farm iPhone 17 Pro; the
owner's :9222 Chrome untouched.

## Established
- Ship pipeline clean at boot (master `9fc4fe8`, no SHIP_ATTENTION). Gates: vitest 3,054/201 (3,061 with the (d) tests) ·
  astro 0/0/12 · knip 0.
- **Lever (a) BUILT** — `lib/globe/detachedRelease.ts` (`drainLruCache`: markAllUnused + all four caps → 0 for ONE synchronous
  `unloadUnusedContent()` + caps restored verbatim; `stepDetachedRelease`: once per detach period, after `graceMs`, only while
  the caches hold items, ≤ 3 per period) · `BuildingsHandle`/`EnrichedHandle.cacheItems()` + `releaseCache()` (refused while
  attached) · `stepMobileBuildingsGate` drains both under `isMobileShell` · `MOBILE2D.releaseDetachedTiles` true /
  `releaseDetachedGraceMs` 2500 (past FLIGHT.durationMs 2200 — the drain lands on the resting map) · DBG
  `buildings.detachedRelease*`. 11 unit tests against the REAL `LRUCache` (3d-tiles-renderer/core).
- **Twin A/B** (`probe-fpv-cycle-leak.mjs`, now with the cache counts + the drain receipt + a process read): fpv-out geometries
  BEFORE 404→592→648→774 (enr cache frozen 103–190 items / 83–97 MB) → AFTER 94→132→132→198, caches 0/0 on every rest; 8 cycles
  98→175 flat; 16 drains, 1,368 items / 737 MB, worst 9.6 ms, `left` 0 always.
- **Farm run 1 (a only)**: 7 complete cycles, killed in the 8th's fpv-out at page age ~413 s (`ActiveHard 2048 MB`, process age
  448 s) vs cycle 4 / 250 s before; tool verdict "CEILING: died with flat resources" (lru 0/97/0, geo 91→162 flat).
- **The plateau named** (`scripts/probe-memory-dump.mjs`, NEW — CDP memory-infra): after the first FPV the renderer holds ~1.2–1.4 GB
  with the app's caches at ~100 MB: `cc/image_memory` pinned at 500.0 MB (Chrome's GPU image-decode cache cap), canvas backing
  stores ~100–127 MB, malloc ~250, partition_alloc ~115–125. RSS creeps ~35 MB/cycle (JS heap ~10 of it).
- **Lever (b) VOID as framed**: the library already accounts textures at DECODED size (`MemoryUtils.getTextureByteLength`); the
  ground LRU's 97 MB is decoded bytes. **(c) moot at rest** after (a).
- **Lever (d) BUILT** — `lib/globe/compositeCanvasRelease.ts`: the overlay composites every ground tile into its own <canvas>
  (`RegionImageSource.fetchItem`) and `disposeItem` disposes only the GL texture; the wrapper (installed per overlay through
  `_init`) zeroes the canvas (`width = height = 0`) at dispose; fast-path bitmap clones skipped. ~450 composites per stress
  cycle on the twin (204 per FPV cycle released). `GROUND.releaseCompositeCanvas`, DBG `tiles.gnd.canvasReleased*`,
  `ground.compositeCanvasStats()`. 7 tests pin the library shapes. Sweep `post-2026-09-10b --compare post-2026-09-09`:
  calls+tris identical to this session's first sweep on all 14 poses (11/14 vs the golden; the 3 = ground-tile boot band).
- Traps this session: the second `wix dev` (with `--allowed-hosts`) was started WITHOUT `.vite` aside → the dep cache 404'd a
  chunk → "tiles disabled" (no island) on the twin — restart with `.vite` aside fixed it (the standing trap, now also on a
  same-session restart). The farm SNAP at `heatmap-off` reads 3 s after the disarm — the grace must stay < 3 s.

## Record targets
DECISIONS.md 2026-09-10 · MEASUREMENTS §31 (31.1–31.8) · backlog T123 row · `mem:core` status + this leaf · NEXT_SESSION_PROMPT.

See [[core]], [[wip-2026-09-09-t126-t129-t130-lever8-pixel]].
