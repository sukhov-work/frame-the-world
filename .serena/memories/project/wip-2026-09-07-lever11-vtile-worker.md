# wip 2026-09-07j — LEVER 11 (the vector-tile parse off the main thread) + T115 (the tree locate, resumable) — DONE on the desktop; THE PIXEL READS ARE OWED

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-07i/j: proceed with
`NEXT_SESSION_PROMPT.md` (the T77 lane), no regression in quality / features / performance on either shell.
Records: DECISIONS 2026-09-07j · MEASUREMENTS §26 · backlog T77 + T115 · this leaf · `NEXT_SESSION_PROMPT.md`.

## Boot
- PR #113 had landed (master `0a3042b` ≡ ship tip `feb5ae3` by tree) but the checkout was on the ship
  branch → re-seated, branch deleted. VPN on (ion 401, egress FI), house Chrome :9333 up, `wix dev`
  restarted PLAIN with `.vite` aside. **No phone on adb.** Baseline vitest 2,917/186 · astro 0/0/12 (the
  12th hint = `ultraEmisK` unused in `buildings.ts:286` / `enrichedBuildings.ts:727`, pre-existing).

## Lever 11 — the wire IS the design (MEASUREMENTS §26.1)
- Measured first (node, the fixture + 25 real z14 tiles around the descent arrival, fetched from
  OpenFreeMap build `20260830_080001_pt`): parse 60.8 ms Σ · `structuredClone` of the nested `ParsedVtile`
  60.6 ms Σ (= no gain; the cost IS the ~100k tiny `[lon,lat]` arrays) · the flat wire's `unpackVtile`
  3.1 ms Σ (heaviest tile 0.54 ms desktop ≈ 2 ms Pixel → one-shot seat, not sliced).
- Files: `lib/geo/vtileWire.ts` (pack/unpack + the message types + `handleParseRequest(msg, parse, post)`
  — the parser INJECTED so the module never value-imports `scene/vectorTiles.ts`) ·
  `lib/geo/vtileParseWorker.ts` (shell only; `/// <reference lib="webworker" />` first line) ·
  `lib/geo/vtileParseClient.ts` (`createVtileParseClient(handlers, parseVectorTile, { spawn? })`; lazy
  spawn; buffer NOT transferred; crash → re-issue in-flight inline + inline for the session; `stats()`) ·
  `scene/vectorTiles.ts` (`attachVectorTiles` hands the fetched buffer to the client; `parseStats()`) ·
  DBG rows `vector.mvt.worker` (−1 = crashed) / `mvt.inline` (warn > 0) / `mvt.seatMaxMs` (warn > 4) /
  `mvt.workerMaxMs` · `scripts/probe-vtile-worker.mjs` (+ `--inline` negative control).
- Fences (`fences.test` +3): the parse worker's tuning edges = {`scene/vectorTiles.ts`}; webworker lib
  first; no SAB / dynamic import; NO main-thread `from ".../vtileParseWorker"` (a `src/` walk — on a page
  `self` is `window`, the shell would install `window.onmessage`); `vectorTiles.ts` passes the parser.
- Desktop descent A/B (stash idiom): vector tiles in hitch frames **169 → 0.8 ms**, app in hitches 230 →
  140, hitch main thread 1,645 → 1,565. Sweep `post-2026-09-07j` vs `post-2026-09-07h`: draw-count 13/13
  with calls AND tris identical, `vector.*` rows identical per pose; pixels the boot-to-boot band.

## T115 — `locateTrees` (MEASUREMENTS §26.3)
- `lib/globe/treeLocate.ts` `locateTreeInstances(instanceMatrix, worldElements, from, to, latDeg, lonDeg)`
  — three's `applyMatrix4` in its operation order (w divide kept) + `ecefToGeodetic`; `TREE_LOCATE_CHUNK`
  256; `treeLocate.test.ts` pins bit-identity vs three + chunk-split exactness.
- `enrichedBuildings.ts`: `TreeSet.locCursor/located`; `ensureLocated` = features only; `locateTrees(cell)`
  chunks under the LATER of `sampleDeadlineMs` (reseat) and `treeLocateDeadlineMs` (= first chunk of the
  frame + `ENRICHED.treeLocateBudgetMs` 0.5); the first chunk of a frame always runs
  (`treeLocateChunkedThisFrame` reset in `update()` beside `sampleT0`). `sampleTrees` calls it first and
  all three tree loops skip `!t.located`. Ledger `treeLocate{Calls,Chunks,Instances,Ms,MaxMs,Pending}`
  on `enrichedLoad()` + `debugCounts()`; DBG `buildings.treeLocateMaxMs` (warn > 4) / `treeLocatePending`.
- Trap found: sharing only the reseat deadline crawled at 1 chunk/frame (113 sets unlocated after a
  desktop descent) → the own 0.5 ms budget. Tree-SEATING throughput identical to HEAD (36.8k vs 36.5k
  sampled at 19 s at the cityscape) — the locate rides the drain's visit schedule as the one-shot did.

## Traps learned
- "Parse in a worker and post the result" is worthless when the result is nested small arrays — measure
  the transport before building it; a flat typed-array wire + rehydrate is 20× cheaper on the receive side.
- A worker module that installs `self.onmessage` at evaluation must NEVER be value-imported on a page
  (`self === window`). Put the shared handler in a pure module; the worker file is shell-only.
- Structured clone preserves `undefined`-valued keys; `toStrictEqual` checks them but NOT key order —
  pin order explicitly when the contract is "identical".
- A resumable step that shares a deadline with a budget someone else spends first makes NO progress
  beyond its "first chunk always" — give it its own budget.
- A pixel diff of 30–56 % across boots can be a 0.08° tilt residual or a water fill's refresh state; the
  draw-count gate + the per-pose DBG rows are what say "same objects, same data".

## The tails (all four moved) + housekeeping
- **T114 CLOSED**: `terrain.memo.regionless` 0 on all 14 sweep poses (Dnipro + Everest); the "ESRI placeholder
  path" is the IMAGERY RC5 fallback, not a terrain-tile source (the terrain tileset is CWT everywhere).
- **T102 ISOLATED**: `/json/new` ACTIVATES the new tab → the composer target (lazily opened at the first pose's
  self-check) backgrounds the pose tab → `document.hidden`, rAF throttled, `requestFly` never starts. Bare probe:
  a second target alone reproduces it; `Page.bringToFront` cures it. Harness fix: `getComposer()` fronts the pose
  tab back, the leg runner fronts before `REC_START`, `--no-leg-reboot` added (drives the thawed page, arrives).
- **T103 FIXED (harness)**: `Animation.enable` + `Animation.setPlaybackRate(0)` under the clock pin, 1 at thaw
  (`pauseAnimations`, `freeze.cssAnimations`); `legacy-m` self-check 2/2 = 0 px. No product code.
- **T93 FPV half NOT REPRODUCED** on the j tree: `probe-horizonband` (far ladder ×1…×8 monotonic; the ×1 base
  frame clean; no wedge at any of the 8 headings) + `probe-groundfade` (`uFtwFade` settled 1.0000 at the zoom
  sweep and everest-orbit-73). A watch.
- The two August remote ship branches deleted on origin after a functional containment check (every file on
  master; `stickyOverlayPx` in 4 master files); backups `refs/backups/ship-20260814-003854` /
  `ship-20260822-002057`; the `private` mirror still carries copies. `ship-20260907-195230` was already gone.

## Owed / next
- The Pixel reads: `probe-cpu-profile --leg descent --device` (vector tiles → ~0 in the hitch frames;
  `treeLocateMaxMs` < the frame budget; `mvt.seatMaxMs` ≤ ~2) + `probe-load-phase2 --device`, thermal ≤ 1,
  unlocked, adb re-wired. If the Pixel's seat reads > ~4 ms: slice the seat (a cursor over the wire's feature
  list), never the wire.
- The owner calls in ONE batch (see `NEXT_SESSION_PROMPT.md` item 2; `ENRICHED.treeLocateBudgetMs` 0.5 joins it).

Related: [[project/wip-2026-09-07-t106-pixel-read]] [[project/wip-2026-09-07-mobile-bestspot-ar]]
