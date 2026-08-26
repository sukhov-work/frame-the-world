# BEST SPOT (aka THE HEATMAP) — PARKED 2026-08-27

**Everything BEST SPOT lives in this directory.** This file is the index, the park brief and the
resume ladder. If you are here because the owner reported a heatmap bug, or because he decided to
try the sweep idea again, **read §1–§4 first — they will save you a session.**

---

## 1. STATUS IN ONE PARAGRAPH

The feature is **built, shipped and browser-verified** — all seven slices S1→S7 (2026-08-23/24), plus
a taste/QA batch and two defect slices (2026-08-26e/g). Then a five-session investigation into *"why
does my own hand-picked photography spot score zero?"* ended by measuring that **the metric answers a
different question than the owner asked**, and that the blocker is not any of the three things three
successive plans set out to fix. **The effort is parked on ONE owner decision.** Nothing is broken;
nothing is half-migrated; the two mechanisms built last are shipped **inert** and byte-identical on
the shipped profile.

### THE ONE OPEN OWNER DECISION — nothing else can succeed before it

> **Should `access.soft.unknown` stop pricing IGNORANCE as BADNESS?**

The owner's cell is charged **`access.soft.unknown = 0.45`** — a 0.673× multiplier — because the
landcover raster has **no class** for where he stood. Not because it is a road: that was tested and
ruled out. With the visibility gate forced **fully open**:

```
S_max = A_soft^0.5 · M_eff = 0.673 × 0.512 = 0.345   <   0.378   (the shortlist's entry price)
```

…at a **perfect** preference of 1.0. So **no gate change, no window change and no new framing term
can put his spot in the top 8 while this rung stands.** It is the owner's call because it re-scores
every unclassified cell in every region.

| option | effect |
|---|---|
| **`1.0`** — ignorance is free | his cell 0.218 → 0.324, 76th → 87.5th percentile; every unmapped cell everywhere gets the same lift |
| `0.9` — matching `green` | most of the above, keeps a token nudge toward known-good ground |
| leave `0.45` | honest to today's behaviour, and the shortlist provably cannot reach his spot |
| make it a RENDER class, not a multiplier | the rule the rest of the engine already follows; largest change, cleanest principle |

**It contradicts a doctrine the engine enforces everywhere else** — `notchDepthDeg = −Infinity`
because *"ignorance is not depth"*; UNKNOWN is *"a RENDER CLASS, never a low score"*
(`BESTSPOT_SPEC_V2.md` §3.4); the 2026-08-26g canopy withdrawal made canopy-only occlusion UNMAPPED
rather than a low score. The soft ladder is the one place ignorance is priced as badness.

Measured cost of `1.0` on the real field: `MEASUREMENTS.md` §4, arm **E2**. Backlog row: **T59**.

---

## 2. SESSION LABELS COLLIDE — check this table before chasing a date

The date-letter labels do **not** agree across documents. "2026-08-26i" names two different sessions
depending on which file you opened.

| what happened | `DECISIONS.md` | `BESTSPOT_TASTE_V1.md` | Serena memory |
|---|---|---|---|
| taste + coverage diagnosis; his cell scores EXACTLY ZERO | **f** | body (§0–§7) | `wip-2026-08-26-bestspot-taste` |
| SWEEP approved as an additive mode; slices 0 + 1 shipped | **g** | — | `wip-2026-08-26-sweep-mode` |
| the seven-session schedule | **h** | — | `wip-2026-08-26-sweep-schedule` |
| R-1: the alignment locus **is** the shadow locus (the corridor) | **i** | ADDENDUM **2026-08-26h** | *(none)* |
| the gate refuted; the `unknown` ceiling found | **j** | ADDENDUM **2026-08-26i** | `wip-2026-08-26-gate-star-floor` |

**When in doubt, cite the CONTENT, not the letter.**

---

## 3. THE CURRENT DIAGNOSIS, IN FIVE MEASURED FACTS

All browser-measured on one disc (`#p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`, **MOONRISE**,
pick `48.451827,35.070311`). Full tables in **`MEASUREMENTS.md`**.

1. **His cell ALREADY had a contact** (`TERM_FLAG.hasStar`) at the shipped 4° window top. The window
   was never why it read zero.
2. **With the gate forced fully open he is still 76th-percentile** — `S = 0.2176` against a field
   best of 0.400. *The gate is what makes the cell **exactly zero**; it is **not** what keeps it out
   of the ranking.* Two different failures; only the first was ever diagnosed.
3. **The ceiling is `access.soft.unknown = 0.45`** (§1). `{unknown: 1}` alone reproduces the
   whole-ladder-off value **exactly**.
4. **His four terms:** `V` 0.2735 · **`L` ≥ 0.90 at percentile 1.0000 — zero cells better, the single
   best in the entire field on contact lowness** · `P` 0.6765 · `F` 0.4059 (his weakest). The blend
   closes to 0.602 vs 0.6324 measured, so **the model is not lying about him**: it ranks him
   83rd-percentile on preference, then multiplies by 0.673 for not knowing what he stands on.
5. **`F_peak` has a measured target.** `F: 0.406 → ~1.0` buys `0.30 × 0.594 = 0.178` of preference →
   **0.810**, within **2 %** of rank 4 — the first arithmetic in the whole investigation that reaches
   his photograph.

---

## 4. IF YOU ARE RESUMING — do it in this order

1. **Get the owner's answer on `access.soft.unknown` (§1).** It is one number and it gates everything
   downstream. Everything else is wasted effort until it lands.
2. **Build `F_peak`** — `SWEEP_MODE_MAP.md` **slice 2 is unaffected and still correct**: the kernel,
   the nine leaves, the `CLASS_OF` rows, the `clampResolved` loop, the Lean twin, the twenty golden
   rows committed RED first, and the five kernel traps (especially `Number.isFinite(width)`, where
   the naive dual of the notch **inverts** and a ridge scores full credit).
3. **Only then** tune `gates.vStarFloor` + `trackWeight.topAltDeg` together. Both are built, tested
   and inert. Cost of a raise is measured in `MEASUREMENTS.md` §8 (top 4° → K = 41 shipped;
   10° → 76; 25° → 268).
4. **`L = 1.0000` at his cell deserves its own look.** 11,503 cells tie at the ceiling — either the
   metric already agrees with him more than anyone assumed, or `L` saturates too easily.

**Before writing any code or any probe, read `TRAPS.md`.** It is the register of everything that has
already cost session time, rescued out of a gitignored file that will not survive.

---

## 5. THE DOCUMENTS

| file | what it is | status |
|---|---|---|
| **`README.md`** | this — index, park brief, resume ladder | **live** |
| **`TRAPS.md`** | every trap paid for in real session time; rescued from gitignored `NEXT_SESSION_PROMPT.md` and from single `wip-*` memories | **live** |
| **`MEASUREMENTS.md`** | every browser-measured number, transcribed because **`verify-shots/` is gitignored** and cannot be re-derived offline | **live** |
| **`BESTSPOT_SPEC_V2.md`** | the canonical spec — the closed-form score, the six residency tiers, the honesty subsystem, the 55-leaf tuning architecture, the visual contract. **~100 code citations point at its `§x.y` anchors — never renumber them.** | **canonical, partly superseded** |
| **`BESTSPOT_PLAN.md`** | the original plan. **Read its `AS BUILT` appendix BEFORE the body.** SPEC_V2 supersedes its §3.4 / §5 / §6 / §10 | **canonical, partly superseded** |
| **`BESTSPOT_TASTE_V1.md`** | the investigation record: a 2026-08-26f body plus two addenda, **each of which measured the previous one wrong** | **read the addenda first** |
| **`SWEEP_MODE_MAP.md`** | the sweep-mode implementation map | **mostly superseded — see its banner** |
| **`SWEEP_MODE_SCHEDULE.md`** | the seven-session execution plan for sweep mode | **mostly superseded — see its banner** |

> **`BESTSPOT_TASTE_V1.md` is dangerous read front-to-back.** Its §5 ordering (*"A is the enabler; B
> and C cannot rescue a cell whose score is exactly zero, so nothing else matters until the moment
> becomes a dimension"*) was the premise of two subsequent plans and is **measured false**. Start at
> **§ ADDENDUM 2026-08-26i**, which is the only current diagnosis.

**What survives in the two sweep docs** (do not re-derive these — they were re-verified 2026-08-27):

- `SWEEP_MODE_MAP.md`: **slice 2 (F_peak) verbatim**, its five kernel traps, the C1 buffer ruling
  (store `peakApexDeg`/`peakDistM` **raw**, apply relief/conf/depth in COMPOSE), C4/N6 (the peak
  argmax is its **own**, over `notchRays`, inside the `starIdx >= 0` guard), N3/N4 (a third arm of
  `max()`, not a fifth weight; `peak.conf.*` needs its own clamps and a Lean twin), C11/N15
  (`peak.conf.tree = 0`, no distance gate), assumptions 3/5/9, and §6's control-validated finding
  that **no golden statistic in the repo is a function of tree geometry**.
- `SWEEP_MODE_SCHEDULE.md`: the **parity contract (§2)** — 13 exact surfaces, `toBeCloseTo` banned on
  all of them, seven fixtures A–G — the **Lean decision (§4)** and its **hypothesis audit**, whose
  three unenforced-bound defects are **still live in the tree**; C-8's three script defects; C-1's
  ruling on the hash host; the browser trap list.

---

## 6. THE CODE — where to start reading

Five files, in this order:

1. **`src/components/globe/scene/bestSpotFeed.ts`** (lines 1–68) — the shortest complete statement of
   the architecture: six residency tiers with measured costs, the 4-rung ladder, the debounce, the
   `scoringHash` drop rule. Then `:836-882` for the tier-key + invalidation dispatch.
2. **`src/lib/geo/bestSpotScoring.ts`** — the whole tunable surface and the invalidation contract in
   one file with **zero runtime imports** (it rides the job; a module read in the long-lived worker
   latches at spawn and is invisibly stale). `BESTSPOT_SCORING_V1` at `:411`; the three untunable
   blocks PHYSICS/SAFETY/HONESTY; `CLASS_TABLE` at `:515`. **If you are here to change a number, this
   is the only file you need.**
3. **`src/lib/geo/bestSpotSolver.ts`** (header, then `solveTerms` and `composeScores`) — the one
   constraint the design rests on: the fused pass writes a **75-byte-per-cell TERM VECTOR and never
   writes `S`**, which is what makes a recompose ~1,260× cheaper than the cheapest re-solve, and
   therefore what made every measurement in `MEASUREMENTS.md` possible at all.
4. **`MEASUREMENTS.md`** §0 and §1 — the reproduction case and the three traps that make numbers lie.
5. **`src/lib/geo/bestSpotMetric.ts`** — the pure scoring kernel, and the reference `cellScore` that
   the fused pass is diffed against.

Also: `src/lib/geo/bestSpotWorker.ts` (the long-lived worker + `shortlist`), `bestSpotTrack.ts` (the
event track and its window), `src/store/bestSpot.ts`, `src/components/panels/BestSpotPanel.tsx`.

### Dev seams (all `import.meta.env.DEV` only)

```js
__globe.bestSpot()                       // timings, jobs, hash, ladderRung, contactMs
__globe.bestSpotField()                  // the RG8 field pack — the thing every probe reads
__globe.bestSpotSheet()                  // the GL sheet's own debug
__globe.bestSpotTuning(patch|preset|null)   // live scoring patch; null resets. THE measurement seam
__globe.bestSpotTuning.export()          // paste-ready TS: the persisted patch + resolved profile
__globe.bestSpotTuning.ab(a, b)          // rank delta + Spearman rho + top-10 survival
__bestSpotStore                          // the store (defaults to kind:"sunset" — see TRAPS §3)
__globe.plan()                           // the INDEPENDENT second opinion — but see §7 below
```

### Scripts

| script | what | run |
|---|---|---|
| `scripts/verify-bestspot.mjs` | the headline harness, 101 checks | `wix dev` + `node scripts/verify-chrome.mjs`, then `node scripts/verify-bestspot.mjs` |
| `scripts/verify-bestspot-ownerbatch.mjs` | the 2026-08-26 owner QA batch, 45/45 | same, `node ≥ 21` |
| `scripts/probe-bestspot-gate.mjs` | **the provenance of both inert leaves**; three arm sets via `PROBE_ARMS=<decompose\|unknown>` | `PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH" node scripts/probe-bestspot-gate.mjs` |
| `scripts/probe-bestspot-taste.mjs` | the origin of `BESTSPOT_TASTE_V1.md`, 10 ablation arms | same |
| `scripts/probe-bestspot-r1.mjs` | the window arithmetic — **but its skyline source is unsound, see §7** | same |

**All CDP harnesses need node ≥ 21** (Node 20 has no global `WebSocket`). `probe-` is the documented
escape from `test/verifyHarness.test.ts`'s C11 fence for an instrument with no PASS/FAIL contract.

---

## 7. KNOWN-RED AND KNOWN-WRONG — do not mistake these for your own regressions

- **`scripts/verify-bestspot.mjs` is 96/101, BY DESIGN.** The **D8 cross-model block** (3–5 checks at
  `:922-925, :976-980, :986-989, :990-994`) was **confirmed red on clean master** by stashing the
  whole batch. The 2026-08-24 fixture (hero rank-1 `S` 0.065, skyline 40.31°) was recorded *before*
  RC16's straddler recovery and RC17's pick-height removal moved the building geometry; the disc is
  now **better** than the fixture assumes (measured 0.3159 / 0.97°), so the *preconditions* fail. It
  is also **run-to-run variable** (hero `S` 0.3161 → 0.3338 over four runs).
  **Do not fix it by loosening thresholds** — re-derive the pin by hill-climbing for a cell the
  *current* geometry genuinely walls in, re-measuring each candidate ≥ 2× after quiescing.
- **`__globe.plan()` is MISSING THE MONUMENT.** At the owner's cell its 120-bin profile reads the
  skyline as **0.09°** where a 20 m mass stands **87 m away at 125.7°**. The disc is right and the
  planner is wrong. **Never re-derive D8 against the planner alone**, and treat
  `probe-bestspot-r1.mjs` (which is built on that profile) as unsound for this cell — keep it for the
  window arithmetic only. A separate, unfixed defect.
- **Two latent crashes in `verify-bestspot.mjs`** at `:916` and `:945` (unguarded `[0]` after an
  `ok()` that only records) — an empty shortlist aborts the run at ~check 66 of 101 and silently
  skips the last four sites.
- **Three unenforced-bound defects** found by the Lean hypothesis audit are still live in the tree
  (`SWEEP_MODE_SCHEDULE.md` §4): `conf` has a ceiling and no floor, so `graze.conf.terrain: -1`
  persists verbatim and inverts monotonicity; `curves.accessSoftExponent` has no clamp at all.

---

## 8. WHAT SHIPPED LAST, AND WHY IT IS INERT

Both landed 2026-08-26j **byte-identical on the shipped profile** — they exist because they had to
exist before they could be measured, and the measurement said do not turn them on yet.

- **`gates.vStarFloor`** (default **0**) — `G = max(G(V), vStarFloor)` when `TERM_FLAG.hasStar`.
  Inert *twice over*: `hasStar` defaults `false` at the kernel **and** the leaf ships at 0.
  `CLASS_OF` `recompose`, proven on the **fused** path, and proven to move **starred cells only,
  zero starless** — the honesty claim the floor rests on.
- **`trackWeight.topAltDeg`** (default **4**) — the window's top, in the **profile** rather than on
  the job. A deliberate deviation from `SWEEP_MODE_MAP.md` C2, valid only because slice 0's
  `trackHash` now covers the whole `trackWeight` group and rebuilds the track. `CLASS_OF`
  **`resweep`**. `opts.topAltDeg` still wins, so geometry tests need no profile.
- **`TRACK_WINDOW_MAX_SPAN_DEG = 48`** + `EventTrackOptions.windowMaxSpanDeg` — truncated from the
  NEW end, decided from `uTop` vs `uBottom` (never `upSign`). **The superset property is pinned for
  the first time** — `set(track(top=4).azDeg) ⊆ set(track(top=10).azDeg)` on the absolute lattice,
  with a negative control — and the whole hull-cache cost model rests on it.

**Gates at the park:** vitest **2,144/2,144** (141 files) · `astro check` 0 err / 0 warn / 6 hints ·
`npx knip` exit-0 · `verify-bestspot` **96/101 by design** · `verify-bestspot-ownerbatch` 45/45.

---

## 9. THE MEMORY TRAIL

`mem:core` §Subsystems points here. The seven session memories, oldest first:

`wip-2026-08-23-bestspot-heatmap` (design + pure-lib floor) · `wip-2026-08-24-bestspot-s3-s7`
(worker → GL sheet → panel → residency → honesty) · `wip-2026-08-24-formal-verification` (the Lean
twin) · `wip-2026-08-26-bestspot-ownerbatch` (QA batch; **three browser traps live only here**) ·
`wip-2026-08-26-bestspot-taste` (the zero) · `wip-2026-08-26-sweep-mode` (the map) ·
`wip-2026-08-26-sweep-schedule` (the schedule) · `wip-2026-08-26-gate-star-floor` (the refutation).

Backlog rows: **T49** (re-scoped 2026-08-27 — its original target list was measured inert), **T59**
(the owner call), **T60–T63**. See `.claude/skills/frame/references/tracked-backlog.md`.
