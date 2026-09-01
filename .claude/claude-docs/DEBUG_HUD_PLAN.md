# DEBUG HUD — the `DBG` chip + floating metrics window (2026-09-01)

Owner order (2026-09-01): a **desktop-only** `DBG` chip, **off by default**, opening a
**floating, resizable** window with deep real-time debug info across the rendering /
cartographic / geometric / terrain / astro / camera / planning pipelines — a professional
game-engine-grade debug surface: rich **filterable** metrics, embedded **graphs**, loading
indicators, quality/stall indicators, **baselines**, and a **technical info note on every
metric**. Full research ran before this design (five parallel tracks; findings cited in
DECISIONS 2026-09-01 and `mem:project/wip-2026-09-01-dbg-hud`).

Also recorded this session (owner): BEST SPOT is **sufficient as implemented** (UX/algorithm
improvements maybe later); the 2026-08-27 shadow work did **NOT** fully fix the issue —
continues in a later session.

## Architecture rulings

1. **ULT precedent, not DEV-gating.** The DEV `window.__*` seams are `import.meta.env.DEV`-only
   and statically eliminated in a release build, so the HUD does NOT read them. Like ULTRA, the
   feature is **runtime chip-gated and compiled in all builds**, with its own always-compiled
   feed. Off-state cost: one boolean check at each engine push site, zero allocation, zero
   collection. The window UI mounts only while the chip is on.
2. **The feed** — `src/lib/globe/debugFeed.ts` (pure TS, no three import; fence-legal for both
   `components/globe/**` and `components/panels/**` to import):
   - **Per-frame series** (pushed by the engine, pre-allocated `Float32Array` rings, no per-frame
     allocation): frame dt, orchestrator-update CPU ms, render-submit ms, GPU ms (timer query),
     draw calls, triangles.
   - **Providers** (registered closures returning a flat snapshot object; polled by the panel at
     its own cadence — never per frame): `canvas`, `tiles`, `ultra`, `terrain`, `buildings`,
     `vector`, `astro`, `camera` engine-side; store-shaped groups (`time`, `planning`, `workers`)
     read zustand directly panel-side (legal import direction).
   - **Actions** (on-demand heavy probes behind buttons, never polled): enriched `debugSeats()`,
     the `ultraLook()` terrain/aniso censuses.
   - Ring **stats** helpers (avg / p95 / 1 % low / jitter = p95−p50) are pure and unit-tested.
3. **Counter discipline** — every cumulative counter (gate draws/skips, PiP renders/blits,
   hitches, overlay rebuilds, terrain epoch…) is displayed as a **differenced rate**, computed
   panel-side from two samples. Never a single read (the RC11 9.8 %-off-a-single-sample bug).
4. **`renderer.info`** — read by nothing today (grep-verified). GlobeCanvas flips
   `info.autoReset = false` and calls `info.reset()` at **tick start**, so the per-frame numbers
   accumulate across shadow pass + composer + PiP pass, which is the truthful whole-frame count.
5. **GPU time** — `EXT_disjoint_timer_query_webgl2` ring (8 queries) bracketing the draw block;
   feature-detected, discarded on `GPU_DISJOINT_EXT`, shown as "—" where unsupported
   (Firefox/Safari/fingerprint-protected). `src/lib/globe/debugGpuTimer.ts`.
6. **Cost fences honoured**: no astronomy-engine call on a per-frame path (astro provider polls
   at ≤1 Hz and reuses the engine's own sampled vectors); `debugSeats()`/terrain/aniso walks are
   actions; `heightAt()` is never sampled by the HUD (it would corrupt its own memo stats);
   provider snapshots allocate only at poll cadence (≤4 Hz).
7. **New one-line engine seams** (research-named, closure-private before): orchestrator
   `updateErrCount`, sun elevation at focus (`sinSunFocus` → deg — the single input to every
   ULTRA band curve), `ultraLookSettled`, gate scene-quiet age, `ctxLost`, enriched null-terrain
   **deferred** counter (beside `rejected` — the number that would have diagnosed the RC7
   convergence stall), GLO-30 patch-tiles-served counter, planFeed build progress
   (`terrainBin`/`azBins` + scan age), street-label census, MVT cache census.
8. **UI** — `src/components/panels/DebugPanel.tsx` + `src/styles/debug-panel.css`:
   - Chip: `DbgChip` beside `UltraChip` inside the existing `hqExperimentsAllowed` fragment
     (CameraTiltPanel); class `ct-mode ct-dbg tip`; **hand-added** `.ct-dbg.is-on` in
     warn-amber (the twice-shipped missing-lit-state trap); ALL-CAPS `data-tip`, `tip-pos=left`.
   - Pref: `debugHud` inside `ftw:view-prefs:v1` (plain sanitize clause, NO `rearmed` term,
     `?? false` — the ULT recipe verbatim). Store field + setter in `store/camera.ts`.
   - Window: Guide-template geometry (`guide.css:31-49` grammar), own drag/resize key `"dbg"`,
     z-index **42**, scroll on an inner wrapper (the DragGrip clip trap), fixed satellites as
     siblings. Filter input + collapsible groups + per-metric InfoDot notes.
   - Update loop: React renders **structure** only (filter/collapse changes); values and
     sparkline canvases update **imperatively** via refs at ~10 Hz — a per-frame globe read
     never triggers a React re-render (house store discipline).
   - Sparklines: per-row `<canvas>`, all redrawn in one pass per UI tick, integer device pixels,
     reading straight off the rings (no intermediate arrays). Per-row canvases chosen over the
     researched single-canvas approach because rows are filterable/collapsible (dynamic layout);
     the compositing cost at ~30 × 160×28 px @ 10 Hz is well under budget.
9. **Groups** (the metric taxonomy): FRAME · RENDERER · QUALITY · SHADOWS/ULTRA · TILES ·
   IMAGERY · TERRAIN · BUILDINGS · VECTOR+LABELS · CAMERA · TIME · ASTRO · PLANNING · WORKERS ·
   SYSTEM. The full metric catalog with per-metric technical notes lives in
   `src/lib/globe/debugCatalog.ts` (pure data, unit-tested: unique ids, non-empty notes).
10. **Tunables** — `tuning.DEBUGHUD` (ring capacity, poll cadences, UI tick, spark geometry),
    per the two-file rule.

## What the HUD deliberately does NOT do

- No engine behaviour changes: collection is observation-only, so the ULTRA `OWNERS` fence is
  not implicated (`fences.test.ts` §ULTRA applies to engine reads of the flag; `debugHud` gates
  a panel and collection hooks, never a look/tile lever).
- No writes to any tile/quality lever from the panel (`setOverlayResolution` is never cheap).
- No `/m` surface, ever — same posture as ULT: the pref travels in the shared blob, the fence is
  the desktop predicate at both the chip and the collection sites.

## Verification plan

- vitest: `test/lib/globe/debugFeed.test.ts` (rings, wrap, stats, active gating, providers,
  counter differencing) · `test/lib/globe/debugCatalog.test.ts` (catalog integrity) ·
  `test/lib/prefs.test.ts` gains the `debugHud` clause case.
- `npx astro check` clean.
- Browser (verify-chrome): chip renders and lights; window opens/drags/resizes; FRAME numbers
  move; tiles queues respond to a fly; off-state = chip off → no HUD provider polling (feed
  inactive); ULT interplay (both chips coexist in the fragment).

## AS BUILT (2026-09-01 — shipped this session)

**Files.** New: `lib/globe/debugFeed.ts` (rings/providers/actions/rate-tracker, pure) ·
`lib/globe/debugGpuTimer.ts` (EXT_disjoint_timer_query ring) · `lib/globe/debugCatalog.ts`
(**151 metrics + 3 actions** — the harness's 154-row count is exactly this — every one with a
technical note; 7-test integrity fence) ·
`panels/DebugPanel.tsx` + `styles/debug-panel.css` · `scripts/verify-debughud.mjs` (17-check
CDP harness, fence-conformant) · `test/lib/globe/debug{Feed,Catalog}.test.ts` (20 tests).
Edited: `tuning.ts` (+`DEBUGHUD`) · `GlobeCanvas.tsx` (dt/cpu/draw/gpu/calls/tris pushes,
`info.autoReset=false` + per-rAF reset, `canvas`+`system` providers) · `StylizedTiles.ts`
(census extraction shared DEV↔actions; `tiles/ultra/astro/camera/terrain/buildings/vector/
planning` providers + 3 actions; dispose wiring) · scene seams: `imageryGround.overlayRebuilds()`
(non-DEV twin) · `enrichedBuildings.debugCounts()` + the NEW `deferred`/`rejected` running
counters (the RC7-stall number now exists) · `terrainPatch.terrainPatchStats()` ·
`planFeed.debug()` build progress + scan age · `streetNames.census()` · `prefs.ts`/`camera.ts`
`debugHud` (ULT recipe verbatim) · `CameraTiltPanel` DbgChip + `camera-tilt.css` `.ct-dbg`
lit rule (the hand-list) · `index.astro` mount · guide `move-deck` "Nine→Ten toggles" + DBG
list line + `move-ultra` no-longer-"last" (goldens survived, 97/97).

**Verification receipt.** vitest **2,231/2,231** (148 files; +21 new) · `astro check` 0 err /
0 warn / 8 hints · `npx knip` exit-0 · **`verify-debughud.mjs` 17/17 ALL PASS** (headless
:9333, shots `verify-shots/debughud-01..04`): chip renders/lights/persists, panel mounts,
FPS header + frame-Δt live and MOVING, gnd-visible + sun-elevation engine truth, filter
154→19 rows, terrain-census action runs, chip-off unmounts + persists false. GPU timer
measured real values (7.3 ms) in the harness shots. rAF with HUD open: median 33.4 ms in the
headless tier-low instance (report-only; owner's HW unaffected at a glance — judge on device).

**Traps hit and encoded in the harness:**
- The WELCOME overlay covers the chrome — the first harness run shipped a screenshot of the
  landing while every DOM assertion passed underneath (the rendered-truth-vs-DOM trap, again).
  The harness now dismisses Welcome first and shoots after the rings fill.
- `Runtime.evaluate` returns the PROMISE without `awaitPromise: true` (the stringify-an-async
  trap's CDP twin) — the perf probe read `undefined` until fixed.
- `store/bestSpot` is VALUE-import-fenced to its seam owners (`fences.test.ts`) — the panel may
  not import it; worker flags ride the engine's `planning` provider instead.

**Open tails (not blocking):** T73 — imagery z-histogram is min/max only (a full per-level
histogram costs one more reach loop); geoLabels stays uninstrumented (the one label layer
without a census); an `/m`-negative harness leg (assert no chip/panel on the mobile shell)
would complete the fence proof browser-side.
