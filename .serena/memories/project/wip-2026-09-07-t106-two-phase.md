# wip 2026-09-07e — T106 FIXED: the two-phase `load-model` handler (slice b) · the flip bank under the phone caps · the pushed ship — DONE

Gates: vitest 2,845/180 (+16) · astro 0/0/11 · knip 0 · pre/post sweeps 13/14 (T103). Post-sweep compare diffs
classified as the BOOT-TO-BOOT noise floor with an old-code pair (`post2-2026-09-07d` vs `pre-2026-09-07e`, both
`44743d3`: cityscape 3.98 % vs 4.15 % at Δ>24 — the vector water overlay + per-tile tone seeds in load order;
descent 0.07 vs 0.17 %); tri/call counts identical per pose. MEASUREMENTS §24.3.
Flip bank (§24.4): `/m` phone twin, cold cycle 566 → FPV / 670 → 2D requests (the FPV set alone fills the 112 MB
cap), warm cycle 172 / 177 (the bank's floor 96 MB — `minHeadroomBytes` binds); RC20's "falls but does not
vanish" holds; the lever is cap-vs-jetsam — owner call, nothing built.

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-07e: proceed with
`NEXT_SESSION_PROMPT.md`; the Android device NOT available (the Pixel read of T106 is still owed — the
desktop phone twin `--lean` = touch + 402×714@3 + 4 cores + 4× CPU throttle is the instrument).
Records: DECISIONS 2026-09-07e · MEASUREMENTS §24 · backlog T106 FIXED · this leaf.

## Boot
- The 13:06 ship hook's push failed on a transient SSH outage (`ssh: connect to host github.com port 22`);
  commit `2d55a33` sat on `claude/ship-20260907-130645`, a clean child of `d375d39`. Pushed by hand at 13:08 →
  PR #110 automerged (`44743d3`, tree-identical to `2d55a33`), checkout re-seated on master, mirror synced,
  branch deleted. Logged in the ship log. Lesson: the hook has no retry — a network blip at `/clear` strands
  the ship; the next boot must push it (the branch is master + 1, so a plain `git push -u origin <branch>`).
- VPN FI, ion 401, house Chrome :9333 up, `wix dev` restarted with `.vite` aside. Pre sweep
  `pre-2026-09-07e` 13/14 self-checks (legacy-m = T103, known).

## T106 slice (b) — what was built
- `lib/globe/loadQueue.ts` (NEW, pure, `test/lib/globe/loadQueue.test.ts` 6 tests): units with `key`
  (the tile scene), `priority()` (lookBiasedDistance), `step(deadline) → done`; `drain(budgetMs)` runs ≥ 1
  step always, then gates on the deadline; picks the LOWEST priority per pick; a mid-flight unit is STICKY
  (one builder's tables live at a time); `cancel(key)` on `dispose-model`; `clear()` on dispose; stats.
- `lib/globe/fastEdges.ts`: `createFastEdgesBuilder(positions, index, angle)` — the SAME algorithm as a
  state machine (stage 0 keying by vertex chunks, 1 triangle walk by chunks, 2 tail emission); `step(deadline,
  checkEvery=256)` always completes one chunk; `buildFastEdges` = the builder stepped once with a huge chunk.
  Test: one item per step ≡ one-shot ≡ three's `EdgesGeometry` on every fixture (+6 tests).
- `lib/globe/enrichedMask.ts`: `createSegmentRunAttributor` — `segmentRunsFromSources` as a state machine
  (keying vertices / claiming runs / attributing segments), same answers; one-shot = stepped once (+4 tests).
- `scene/edgesGeometry.ts`: `createEdgesBuilder(geometry, angle)` (the three fallback runs whole on step 1).
- `scene/enrichedBuildings.ts`: `load-model` = PHASE 1 only (cell record, material swap, F1 fill birth, trees,
  `loadQueue.push(makeMeshLoadUnit(e.scene, cell, c))`). `makeMeshLoadUnit` phases: 0 edges (resumable; the
  `LineSegments` added on completion with its OWN `frameNow()` birth) · 1 attribution (resumable) · 2 CSR +
  edge spans + bounds pad (atomic) · 3 feature fingerprints (resumable by run, check every 1,024 verts) · 4
  the part object + `locateFeature` for every feature IF `cell.located` (resumable by 256) · 5 registration
  (atomic: RC9 banked seats, `cell.parts.push`, `partByMesh.set`, `applyCellOverrides`, `touchCell`; finishes
  a locate left over the 4/5 frame boundary — `ensureLocated` is one-shot per cell and walks only registered
  parts, so a late part must locate itself). `update()` drains after the T94 freeze check and before the seat
  passes. `dispose-model` cancels first. `opts.loadBudgetMs` from the orchestrator (`lean ?
  ENRICHED.loadBudgetMsLean : loadBudgetMs`); `setLoadBudgetMs` live.
- `tuning.ts` `ENRICHED.loadBudgetMs` 6 · `loadBudgetMsLean` 3. Seams: `__globe.enrichedLoad()` (ledger:
  `handlerMaxMs` = phase 1, `edgesMaxMs`/`maskMaxMs`/`registerMaxMs` per unit step, `deferredMaxMs` per drain,
  `pending`, `unitsDone`, `unitsCancelled`, `budgetMs`) · `__globe.enrichedLoadBudget(ms)` · DBG rows
  `buildings.loadPending` / `buildings.loadMaxMs` (via `debugCounts`).
- Instrument: `scripts/probe-load-phase2.mjs [--lean] [--budget ms] [--label]` — the descent leg with a rAF
  recorder, queue samples every 250 ms, then the ledger + `enrichedBench(50)` + `enrichedSeats()`.
  `--budget 1e6` = the one-frame shape (the A/B's B).

## Numbers (MEASUREMENTS §24.1/24.2)
- Worst drain: desktop 30.3 (one frame) → **8.5 ms** (budget 6); twin 85.9 → **8.0 ms** (budget 3). Phase-1
  handler 0.4 / 0.8 ms. Identity `enrichedBench(50)` mismatch 0/0 every run. >33 ms frames on the descent
  20 → 10 (desktop); twin p95 71.6 → 50.8 — the rest of the tail is the streaming's other work (§20).
- Intermediate cuts that named the next atomic cost: attribution atomic → twin 18.0; the locate atomic →
  15.2 (13.7 ms of `ecefToGeodetic` × ~2,000 for a cell located while waiting); both resumable → 8.0.
- The cost: the twin's whole-city landing drains over ~4.4 s (52 units, 853 ms of work at 3 ms/frame);
  desktop ~1 s behind the last tile. Unregistered cells sit on the cell plane without edges, nearest first.
  Owner taste knob: `loadBudgetMsLean` (4 ms ≈ 3 s).

## Traps learned
- A cell located while its unit waits: `ensureLocated` never re-runs → the late part MUST locate its own
  features (phase 4), and the frame boundary before registration can still flip `located` → the safety net
  in phase 5. Footprints at lat/lon 0 would sample the Gulf of Guinea.
- "Atomic per part" is not enough on a 4× phone: the attribution (18 ms) and the locate (13.7 ms) each had to
  become resumable; measure per-phase max, not just the drain max.
- The `--budget 1e6` seam is the honest B: several `load-model` events also landed in one frame before.

## Flip bank (brief item 3) — `scripts/probe-flip-bank.mjs` (NEW): `/m` phone twin, 2 × 2D→FPV→2D, Esri GETs
per leg + `u2().lru.ground` at every stage. Result: see DECISIONS 2026-09-07e / MEASUREMENTS §24.4.
