# BEST SPOT — THE SCHEDULE (sweep mode · solver-core parity refactor · browser · Lean · docs)

**Produced 2026-08-26g** by four independent scoping passes + a reconciler, against
`bestspot/SWEEP_MODE_MAP.md` (the spec) and `BESTSPOT_TASTE_V1.md` (the diagnosis).
**Seven sessions, ≈ 48.5 h.**

---

## ORCHESTRATOR'S CORRECTIONS — read these before §0, they are MEASURED and the schedule is not

The reconciler was read-only and says so honestly in §9 (*"I ran no gates… No browser run, by
anyone"*). Four of its open items were measured in the session that produced it. Where these
disagree with the body below, **these win.**

**1. §0 is WRONG about the landing, and its conclusion is still right.** It reads
`git status --short` as *"slices 0 and 1 are NOT merged… the brief is false"*. It is not: this repo
auto-ships on SessionEnd (`.claude/CLAUDE.md` — a detached hook commits EVERYTHING on a
`claude/ship-*` branch with `#pr #skipreview #automerge`, self-heals squash divergence and
fast-forwards the checkout). An uncommitted working tree mid-session is the NORMAL state here, not a
defect. **But §0's actual instruction survives intact and should be followed:** record the parity
goldens on the commit whose parent is the slice-0+1 landing, never on a working tree. R-2 is real.

**2. `verify-bestspot.mjs` is 96/101 — MEASURED after slice 1, not quoted.** Four runs against the
live dev server. **Slice 1 broke nothing**; the map's blast-radius prediction over-estimated, and
§5's three "MOVES" did not move. Re-baselining (Session 4.1-4.2) is therefore cheaper than budgeted.

**3. THE D8 BLOCK IS NOT MERELY STALE — IT IS RUN-TO-RUN VARIABLE, AND THIS CHANGES 4.3's DESIGN.**
Across four consecutive runs the hero rank-1 `S` read **0.3161 → 0.3338** and the failure count moved
**3 → 5**. The disc solves from what has STREAMED, so a hill-climb that optimises a noisy objective
will converge on noise. **Session 4.3 must quiesce on streaming and re-measure each candidate at
least twice before accepting it**, or the re-derived pin is flaky forever — which is how it got
stale the first time. Budget accordingly; 2.5 h is optimistic.

**4. R-4 IS LARGELY DE-RISKED ALREADY — MEASURED.** The same run, WITH ~9,570 canopy stamps in the
critical path: **`firstInkMs` 43.1 ms against a ≤ 120 gate; `refinedMs` 493.1 ms against ≤ 1,200**;
rungs 6.7 / 23.3 / 89.2 / 352.4 ms. The canopy pass did not blow the latency budget. The `drag −
idle` arm is still unmeasured. **Lower R-4's probability from 0.35 and do NOT pre-emptively memoise**
(which is also §8 item 4's advice, now with a number behind it).

**5. C-5 IS FIXED.** `canopyUncredited` was wired solver → worker → feed → DEV seam in the session
that produced this schedule. Session 1.2 is DONE; drop it (0.75 h).

**6. One more measured datum for §5:** the Dnipro disc's `coverage` moved **1.000 → 0.929** under
the canopy withdrawal, and every relational assertion around it held. That is the withdrawal
working, visible, in the shipped harness.

---

# THE SCHEDULE — BEST SPOT SWEEP MODE, SOLVER-CORE PARITY REFACTOR, VERIFICATION AND DOCS
### Consolidated from four independent scoping passes · 2026-08-26 · every ruling carries my own `file:line`

---

## 0. THE ONE THING THAT INVALIDATES THE BRIEF

**Slices 0 and 1 are NOT merged. They are uncommitted working-tree changes, and so is the map itself.**

```
$ git status --short
 M .claude/claude-docs/DECISIONS.md          M src/lib/geo/bestSpotSolver.ts
 M src/components/globe/scene/bestSpotFeed.ts  M src/lib/geo/bestSpotWorker.ts
 M src/lib/geo/bestSpotScoring.ts             M src/lib/geo/localDsm.ts
 M src/lib/geo/occlusion.ts                  (+ 5 modified test files)
?? .claude/claude-docs/BESTSPOT_TASTE_V1.md
?? .claude/claude-docs/bestspot/            ← THE MAP IS UNTRACKED
?? scripts/probe-bestspot-taste.mjs
$ git log --oneline -1                → ebf11b7  (the owner QA batch)
$ git show HEAD:src/lib/geo/bestSpotSolver.ts | grep -c canopyUncredited  → 0
$ git show HEAD:src/lib/geo/bestSpotWorker.ts | grep -c trackKeyOf        → 0
```

The brief's "DONE and merged already" is false. Every schedule below is written against this. Session 1's first act is landing them, and the parity baseline is recorded **on the commit whose parent is that landing** — not before, not on the working tree.

---

## 1. CONTRADICTIONS AND SILENT ASSUMPTIONS BETWEEN THE TRACKS — RULED

### C-1 · Where the byte-identical hash lives. Parity wins; the map is wrong.
`SWEEP_MODE_MAP.md:236` names `test/lib/geo/bestSpotComposition.test.ts:160-219` as the host of "a SHA-256 over the raw bytes of the returned `Float64Array` of scores."

**My evidence.** That file's import block (`test/lib/geo/bestSpotComposition.test.ts:41-59`) pulls `bestSpotTrack`, `bestSpotMetric`, `bestSpotTypes`, `localDsm`, `horizonSweep` — and **not `bestSpotSolver`**. Its hero at `:203-247` is `cellScore(sweepCentre(track,true).rays, track, ACCESS, OPTS)`, twice, returning `CellScore` objects; the assertions are `withDeck.score > bare.score`, `withDeck.f > 0.5`, `bare.f === 0`. There is no score array, no term buffer, no `composeScores` anywhere in the file.

**RULING.** Hashing that file would pin `cellScore` — the *reference the refactor may not touch* — and would prove nothing about `solveTerms`/`composeScores`, which is the entire moving surface. The host is `test/lib/geo/bestSpotSolver.test.ts:594-602` (DONE-CHECK 4's describe scope: `discGeometry(120,3)`, real `sunsetTrack()`, real `scene()` + ridge, `solveTerms` at `:601`, `composeScores` at `:602`). Everything the hash needs is already computed there and only 5 probe cells are read off it today. **`SWEEP_MODE_MAP.md:236` is superseded and must be corrected in Session 1.**

### C-2 · "F and L are structurally dead above 5°." Half-true, not new, and the half that IS true is exact.
Docs track presents this as the finding that reorders the whole plan (slice 2 before 3b). Browser and parity tracks assume the map's order (3a → 3b → 2).

**My evidence, term by term.**
- **L: exactly zero, confirmed.** `contactLowness = 1 - smoothstep(dipFloorDeg, ceilDeg, altStarDeg)` (`src/lib/geo/bestSpotMetric.ts:281-287`), the solver's own copy at `src/lib/geo/bestSpotSolver.ts:1372`, and `lCeilDeg: 5` at `src/lib/geo/bestSpotScoring.ts:386`. At `alt* ≥ 5°`, `L = 0` identically. Weight `l: 0.3` (`bestSpotScoring.ts:376`).
- **F_graze: NOT dead above 5°.** The tangent arm is `1 − clamp01(bestDelta / (ρ · tangentHalfWidthRadii))` (`bestSpotMetric.ts:605-611`, `tangentHalfWidthRadii: 1` at `bestSpotScoring.ts:398`) and the area arm is `4f(1−f)`. Both are zero when the body is far from an edge — *at any altitude*. A cell walled by a 30 m block at 150 m has a skyline at 11.3°; that cell's F_graze fires at 11.3°, not at 4°. The claim is "dead above **that cell's** rooftops", which is a much weaker statement.
- **F_gap: same.** `notchAt` sets `widthDeg = Infinity` only when the sub-`alt*` run reaches the swept span's end (`bestSpotMetric.ts:824-827`); two masses still above `alt*` keep it finite, and `notchFFromParts` (`:876`) then produces a live term.
- **And the map already carries this**: `SWEEP_MODE_MAP.md:284` — *"T2 proved `F_gap` is structurally dead above the rooftops so sweep mode has no framing term up there without it."*

**The decisive fresh fact neither the docs track nor the map states.** `TRACK_TOP_ALT_DEG = 4` (`src/lib/geo/bestSpotTrack.ts:319`) against `lCeilDeg = 5`. **No sample in today's track can ever exceed the L ceiling.** The entire dead-L regime is *created by sweep mode*, not present today. That makes the question genuinely unmeasured — and cheap to measure.

**RULING.** Keep the map's ship order (3a → 3b → 2). Insert a **2 h node probe as a hard gate at the top of Session 2** (§7 risk register, R-1). If the probe shows the owner's cell capping at ≈0.40 with F = 0, swap slice 2 ahead of slice 3b and pay the reorder then; the probe costs 2 h either way and buying the reorder blind costs a session.

### C-3 · Why segments are needed — nobody stated it at code level, and it is the strongest argument in the pile.
All four tracks treat "each cell keeps its BEST instant, never an average" as an owner preference.

**My evidence.** It is already half-implemented. `src/lib/geo/bestSpotSolver.ts:1226-1237`: `if (f >= halfDisc && s.altAppDeg < accStarAlt[c]) { accStarAlt[c] = …; accStarIdx[c] = j; … }` — **`alt*` is already a per-cell argmin over the track**: the lowest altitude at which that cell sees at least half the disc. A cell walled to 8° already gets `alt* ≈ 8°` if the track reaches there. But `V` and the four τ buckets accumulate over the whole `inWindow` span (`:1179-1200`, gated by `const inWindow = j >= winLo && j <= winHi` at `:1092`).

**RULING.** Simply raising `topAltDeg` would give every cell a star **and** average its V and dwell across a 45-minute window — literally the average the owner forbade. **The segment boundary must move `winLo`/`winHi`, not just `topAltDeg`.** This is the code-level justification for the whole deviation and it belongs in slice 3a's docstring verbatim. It also settles the docs track's D12: the truncation direction question is about `winLo/winHi`, and the sign comes from `upSign` (`bestSpotTrack.ts:660`).

### C-4 · The memory ceiling. Both tracks quoted the wrong pin, and the right one goes RED in slice 2.
Parity cites `bestSpotSolver.test.ts:1271/1272`; docs cites `:1273`; the map's C1 says a 96 B/cell F_peak buffer *"still passes the `< 101 MiB` pin at 601² (34.7 MB)."*

**My evidence.** There are **two** pins:
```
test/lib/geo/bestSpotSolver.test.ts:1269  expect(createTermBuffer(601).buffer.byteLength / 1e6).toBeCloseTo(27.09, 2);
test/lib/geo/bestSpotSolver.test.ts:1273  expect(createTermBuffer(601).buffer.byteLength).toBeLessThan(101 * 1048576);
```
601² × 96 B = 34,675,296 B = **34.68 MB**. `:1273` passes. **`:1269` fails.** The map checked the loose pin and missed the exact one.

**RULING.** If slice 2 ever moves `TERM_BYTES_PER_CELL` (`src/lib/geo/bestSpotSolver.ts:248`, currently 75), `:1269` must be re-pinned in the same commit, mutation-verified, with a comment naming the byte layout that moved it. **No track budgeted this and it would read as a parity failure.** Note the deviation *avoids* the same trap for slice 3a — which is precisely why the deviation is right.

### C-5 · `canopyUncredited` never leaves the solver. Browser is right; it blocks the re-baseline.
```
$ grep -rn canopyUncredited src/ | wc -l   → 5   (all in src/lib/geo/bestSpotSolver.ts)
$ grep -rn openSkyUncredited src/ | wc -l  → 15  (solver + worker + feed + types)
```
**RULING.** Slice 1's single biggest behavioural change is unobservable in the browser, so the 2,025 in-disc cells that flipped to UNMAPPED cannot be attributed. This is a 3-line wire fix and it must land **in Session 1, before any browser re-baseline**, or every later browser number is uninterpretable.

### C-6 · `CLASS_TABLE` is 53 rows, and sweep mode breaks the table's premise.
```
$ node -e '…count CLASS_TABLE rows…'  → rows: 53   { recompose: 41, rescore: 12 }
```
Docs D7 is right (53, not 54) and there is **no `reweigh` class left at all** — slice 0 removed the last two (`bestSpotScoring.ts:519-520`). The test pins only `>= 50` (`test/lib/geo/bestSpotScoring.test.ts:555`).

**The unnamed consequence.** The deviation makes every scoring patch a `rescore` in SWEEP mode. `CLASS_TABLE` is a **static** table — 41 of its 53 rows say `recompose`, and in sweep mode the recompose path does not exist (the losing instants' evidence is gone). **`classOf` must either take the mode, or the feed must coerce `recompose → rescore` when `sweepMode` is on.** No track named this. It is a slice-3b design decision, sized in Session 3, and it is exactly the kind of half-honoured-recompose defect the repo has already shipped twice.

### C-7 · Node version. Docs is right; parity's provenance guard must not be a hard assert.
`node -v` → **v20.19.2**. `verify-bestspot.mjs:21` uses `--experimental-websocket`; the CDP harnesses need ≥ 21. `astronomy-engine` is exact-pinned `"2.1.19"` (`package.json:36`). **RULING.** The parity goldens are recorded under node 20 and the provenance line says so, but the environment check ships as a `console.log`, never an `expect` — a hard `expect(process.version…)` would make the suite red on a machine where nothing is wrong.

### C-8 · Two scripts crash rather than fail, and one always exits 254.
```
scripts/verify-bestspot.mjs:916   const heroBest = heroRanked[0];
scripts/verify-bestspot.mjs:945   const openBest  = ranked[0];
scripts/probe-bestspot-taste.mjs:340   await finishVerify(PORT);
test/verifyHarness.test.ts:43-44  readdirSync(scriptsDir).filter(f => f.startsWith("verify-") && …)
```
All three confirmed. The harness fences `verify-*` only, so the `probe-` exit-code bug is structurally uncatchable. `finishVerify(PORT)` coerces the port to an exit code. **RULING.** All three fixed in Session 1 (0.75 h total). Slice 1 makes the empty-shortlist path reachable — `gates.minCoverage: 0.5` at `bestSpotScoring.ts:382` — so `[0]` on an empty array is a live `TypeError` that aborts the run at check ~66 of 101.

### C-9 · Parity's `toBeCloseTo` ruling stands, unqualified.
The repo idiom is exact: f32-term-by-term at `bestSpotSolver.test.ts:650-661`, whole-buffer byte compares at `:333` and `:1468`. **RULING.** Every parity surface is exact. The two existing tolerances are correct *for their claim* (they cross the f32 quantisation boundary) and must not be copied.

### C-10 · Silent assumption shared by all four tracks: that the OFF-mode wire key set already excludes `bestAtMs`. It does.
`test/lib/geo/bestSpotHonesty.test.ts:617-634` asserts `Object.keys(r).sort()` against a 14-name literal — `aerial, bearingDeg, contact, distM, gridCellM, groundReachable, key, latDeg, leadMs, lonDeg, note, obstructionRefined, rank, score`. No `bestAtMs`. **RULING.** C7's "optional and absent in OFF" is already machine-checked by a shipped test on **every** row. It costs zero to keep and it is the strongest OFF-wire assertion available in node. Do not rewrite it.

### C-11 · The `conf` floor defect. Lean track is right; I reproduce it by reading.
```
src/lib/geo/bestSpotScoring.ts:655-657   conf[k] = Math.min(BESTSPOT_SAFETY.confMax, conf[k]);   ← no Math.max
src/lib/geo/bestSpotScoring.ts:662-664   weights[k] = Math.max(BESTSPOT_SAFETY.weightMin, …);    ← has one
src/lib/geo/bestSpotScoring.ts:769-775   clampLeaf conf cases: all Math.min only
```
Ceiling enforced in both places, floor in neither, while the structurally identical `weights` group gets its floor in both. **RULING.** Real, and it is `weights_nonneg_is_necessary` re-created in a second group. It is 8 lines of TypeScript. It rides Session 1 with the other fences, not a Lean session.

---

## 2. THE PARITY CONTRACT

This is the owner's central ask. It gets one file, one docblock, and this exact wording.

> ### THE PARITY CONTRACT — copy this into `test/lib/geo/bestSpotParity.test.ts`'s docblock
>
> **CLAIM.** For a user who never turns SWEEP MODE on, the BEST SPOT instrument produces
> **bit-identical output** after the sweep work as before it. "Output" means, exhaustively:
>
> | # | Surface | Assertion | Precision |
> |---|---|---|---|
> | 1 | the composed score field | `sha256(new Uint8Array(scores.buffer))` === committed hex | byte |
> | 2 | the term buffer | `sha256(new Uint8Array(terms.buffer))` on a **freshly allocated** buffer | byte |
> | 3 | each of the 21 term fields | 21 separate `sha256` literals (`TERM_F32_FIELDS` + `TERM_U8_FIELDS`) | byte |
> | 4 | the RG8 pack | `sha256(field.rg8)` | byte |
> | 5 | `conformM` + `centreGroundM` | `sha256` over the f32 lattice + an exact `centreGroundM` literal | byte / f64 |
> | 6 | ~12 named probe cells | `expect(scores[c]).toBe(<17-digit f64 decimal>)` | exact f64 |
> | 7 | the fused pass vs `cellScore` | ~10 cells, `toBe(Math.fround(ref.X))` term by term — **differential, no golden** | f32 exact |
> | 8 | the scalar block | exact literals for `coverage`, `unmappedFrac`, `minReachM`, `refusedShortReach`, `openSkyUncredited`, `canopyUncredited`, `hullBuilds`, `peakHullBytes`, `scratchBytes`, and the four `censusOf` counts | exact |
> | 9 | the wire key set | `test/lib/geo/bestSpotHonesty.test.ts:617-634`, 14 names, every row, **unchanged** | exact |
> | 10 | the shortlist values | `sha256(JSON.stringify(spots))` | byte |
> | 11 | the T0.5 tier key | `feed.debug().keys.t05` === the pre-change string, character for character, + a positive control that ON moves it | exact |
> | 12 | the default profile hash | `expect(job.scoringHash).toBe(scoringHash(BESTSPOT_SCORING_V1))` | exact |
> | 13 | the memory ceilings | `bestSpotSolver.test.ts:1269` (27.09 MB) **and** `:1273` (< 101 MiB) | exact |
>
> **EXPLICITLY NOT IN THE CONTRACT.** `SolveResult.timings` and everything derived from
> `performance.now()`. Wall clock is a rubber ruler under the 12-way runner; use `test/lib/geo/_perf.ts`.
>
> **PRECISION IS EXACT EVERYWHERE. `toBeCloseTo` is not acceptable on any surface above.**
> Both sides are the same code path at the same precision, so a tolerance would hide the only
> class of bug this file exists to catch. (Surface 7's f32 rounding is a *different* claim and
> is stated with `Math.fround`, not a tolerance.)
>
> **THE FIXTURE MATRIX — seven solves, one per branch the refactor touches:**
> **A** the DONE-CHECK-4 scene (baseline) · **B** `canyon` (F_gap fires) · **C** `truncateM` +
> `refuseBelowReachM: 400` (UNKNOWN + `refusedShortReach`) · **D** `mode:"stream"`,
> `discGeometry(30,1)` (ULTRA; `peakHullBytes`, `scratchBytes`) · **E** `builtEvidence:false`
> (`openSkyUncredited`) · **F** a canopy scene (`canopyUncredited` — slice 1's new path) ·
> **G** a **moonrise** track (the ASCENDING arm: `descending` at `bestSpotSolver.ts:1008` flips
> `accFLow`/`accFPrev` at `:1210/:1221/:1231` and `lowIdx` at `:1323`; nothing else in the plan
> exercises it and SWEEP's per-instant argmax runs straight through it).
> Each fixture carries a **non-vacuity assertion** (B: >100 cells with notch depth; E:
> `openSkyUncredited > 0`; F: `canopyUncredited > 0`; G: `samples[0].altAppDeg < samples[K-1].altAppDeg`).
>
> **TWO ASSERTIONS THE T=1 CONTRACT CANNOT MAKE, AND THEY ARE THE MOST VALUABLE IN THE FILE.**
> Every accumulator in `solveTerms` (`bestSpotSolver.ts:985-1007` — `accWSum`…`accMinReach`, with
> `Infinity`/`NaN`/`-1` sentinels) plus `ribbon`, `ringFilledFor`, `visitToken` and `memoN` is
> allocated **fresh per call** today. A missing reset between instants is **structurally invisible
> at T = 1**. So:
> - **IDEMPOTENCE.** `solve(T=2)` with the same instant twice is byte-identical to `solve(T=1)`.
> - **ORDER INDEPENDENCE.** `solve(T=2)` with the two instants reversed is byte-identical.
>
> **THE ARGMAX PRECISION DECISION, made before the loop is written.** The running MAX compares f64
> candidate scores; the merged terms are stored f32 (`TERM_BYTES_PER_CELL = 75`,
> `bestSpotSolver.ts:248`). Therefore `composeScores(merged)` will not exactly equal
> `max_g composeScores(solve_g)` — the f32 round trip can reorder two near-tied instants.
> **Ruled: the argmax objective is the f32-round-tripped score**, so that the winner the buffer
> reports is the winner the panel prints. Pinned by a T=2 near-tie fixture. Left undecided it lands
> in slice 3b as an unexplained 1e-8 discrepancy that reads as a parity failure.
>
> **NaN.** No NaN currently reaches the term buffer (`altStar`'s branches are guarded at
> `bestSpotSolver.ts:1326-1332`, `:1212-1216`). A NaN written into an f32 view has an
> engine-chosen payload and would make surfaces 2/3 non-deterministic. Assert
> `expect([...terms.v].some(Number.isNaN)).toBe(false)` per fixture.
>
> **PROVENANCE — this line moves only for the two legitimate reasons below.**
> ```
> BASELINE TAKEN <sha> · node v20.19.2 · astronomy-engine 2.1.19 · vitest 4.1.9
> ```
> Determinism holds for a fixed (node major, astronomy-engine) pair. There is no `Math.random` in
> `src/lib/geo/**`; the only clock reader is `nowMs()` at `bestSpotSolver.ts:1520-1522`, consumed
> solely by `timings`; `localDayWindow` is `round(lon/15)` integer arithmetic (`src/lib/ephemeris/dayArc.ts:60-68`)
> so `TZ=` cannot move the track; `composeScores` walks `Object.keys(scoring.weights)` (`:1693`),
> insertion-ordered by spec. The residual is transcendental ULP: V8's `sin/cos/atan2/exp/pow` are
> not correctly-rounded and this repo pins no node (`engines`, `.nvmrc`, CI: all absent).
>
> **IF THIS FILE GOES RED, THE ANSWER IS A BISECT, NOT A RE-RECORD.** Re-recording is legitimate for
> exactly two reasons — a node major upgrade or an `astronomy-engine` bump — and both must move the
> provenance line in the same commit. Three structural guards make a lazy re-record visible:
> surface 7 has no golden to regenerate; surface 6's seventeen-digit decimals are legible in a diff
> where a hex blob is not; and `expect(GOLDEN.probes.length).toBe(12)` makes *deleting* a failing
> probe as red as changing it. PRs here carry `#skipreview #automerge` — CODEOWNERS is not a gate,
> so the guard has to be in the file.

**How it is machine-checked, in one command:**
```
npx vitest run test/lib/geo/bestSpotParity.test.ts test/lib/geo/bestSpotSolver.test.ts \
              test/lib/geo/bestSpotHonesty.test.ts test/lib/geo/bestSpotResidency.test.ts \
              test/components/globe/bestSpotFeed.test.ts
```
and, once per slice, the full `npm test` + `npx astro check` + `npx knip`.

---

## 3. THE SCHEDULE — **TWO SESSIONS, PARALLELISED** (revised 2026-08-26h on owner order)

> **Why this replaced seven.** The seven-session version below (kept as Appendix A, unchanged) sized
> the work correctly and packaged it wrongly: it counted *human* sessions and assumed serial
> execution. The work items are all still here — **nothing was cut to reach two** except the quota
> slice, which is explicitly deferred. What changed is that the dependency graph was read properly.
>
> **THERE ARE ONLY THREE REAL SERIAL GATES IN THE ENTIRE PLAN:**
> - **G1 — the parity goldens are recorded on frozen code.** Nothing that edits
>   `src/lib/geo/bestSpotSolver.ts` may run before this, or the baseline is worthless.
> - **G2 — slice 3a (the segment loop) is merged.** 3b builds directly on it.
> - **G3 — the mode exists and runs.** Browser verification cannot precede it.
>
> Everything else fans out. **The file-conflict graph clusters in exactly three places** —
> `bestSpotSolver.ts` (3a ∥ F_peak plumbing), `bestSpotScoring.ts` + `bestSpotMetric.ts` (clamps ∥
> F_peak kernel), `bestSpotWorker.ts` + `bestSpotFeed.ts` (3b ∥ quotas) — and the stream assignment
> below is built to keep each cluster inside ONE stream.
>
> **THE MEASUREMENT THAT MAKES THE FAN-OUT LEGAL** (taken 2026-08-26h): the three unenforced-bound
> clamps are **inert on the shipped default** — `graze.conf` is `{0, 1, 0.9, 0.45, 0.9}` (all ≥ 0),
> `accessSoftExponent` is 0.5 (≥ 0), `graze.scaleRadii` is 1.75 (> 0). **They cannot move the parity
> goldens**, so they are free to land in any wave on either side of G1. Had any default been out of
> range, the clamps would have had to precede G1 and the whole of Wave 1 would have collapsed into
> the critical path.

---

### SESSION 1 — FREEZE · FAN OUT · LAND THE LOOP

**Goal.** The parity contract exists and is recorded; every independent workstream is done; the
segment loop is merged and proven byte-identical.

**Entry gate.** `npm test` green · `astro check` 0/0/6 · `knip` exit-0 · `.claude/SHIP_ATTENTION.md`
absent or resolved.

#### WAVE 0 — the freeze (SERIAL, ~1.5 h, nothing else may run)
Lift the module-private builders (`scene`, `solveInput`, `composeCtx`, `greenLand` —
`bestSpotSolver.test.ts:139-255`) into `test/lib/geo/fixtures/`; write
`test/lib/geo/bestSpotParity.test.ts` with all **13 surfaces** and a `RECORD` mode; record fixture
**A** only. **Commit. This is G1.** Fixtures B-G are additive coverage and belong in Wave 1 — they do
not gate anything, and holding the freeze open for six more scenes is what turned this into a
session of its own last time.

#### WAVE 1 — the fan-out (PARALLEL, 5 streams, worktree-isolated where they touch `src/`)

| # | Stream | Files (disjoint by construction) | h |
|---|---|---|---|
| **S1** | Parity fixtures **B-G** + their non-vacuity assertions. **G (moonrise) is the one that matters** — the ASCENDING arm flips `accFLow`/`accFPrev` (`bestSpotSolver.ts:1210/1221/1231`) and `lowIdx` (`:1323`), and nothing else in the plan exercises it | `test/lib/geo/bestSpotParity.test.ts`, `test/lib/geo/fixtures/` | 2.0 |
| **S2** | **The three clamps, THEN the F_peak kernel** — sequential *within* the stream because they share two files. Clamps: `conf` floor, `accessSoftExponent` floor, `scaleRadii` floor (the guard currently points the wrong way). Then `peakAt` + `peakFFromParts` + its own argmax over `notchRays`, with the twenty golden rows **committed RED first** | `bestSpotScoring.ts`, `bestSpotMetric.ts`, `test/lib/geo/bestSpotPeak.test.ts` | **5.0 — the critical path of this wave** |
| **S3** | The three script defects (two unguarded `[0]` that abort the run at check ~66 of 101; `probe`'s always-wrong exit) + the `probe-bestspot-d8-pin.mjs` skeleton | `scripts/**` | 1.0 |
| **S4** | **THE PLATEAU PROBE (R-1) — the GO/NO-GO.** Zero production code. Plus the free arm: the owner's rank at `lCeilDeg ∈ {5, 8, 12}` | `test/lib/geo/bestSpotPlateau.test.ts` (new) | 2.0 |
| **S5** | Lean: `score_mem_Icc` + `conf_nonneg_is_necessary` + the hostile-leaf sweep over `scoringLeafPaths()` | `formal/Ftw/Score.lean`, `test/lib/geo/bestSpotScoring.test.ts` | 2.0 |

**Wave 1 wall-clock ≈ 5 h (S2), not 12 h.** Merge order: S3 → S5 → S1 → S4 → S2 (least-conflicting
first). Re-run the parity file after every merge; **S2's clamps must leave all 13 surfaces
unchanged** — that is the measurement above, asserted rather than assumed.

#### WAVE 2 — the loop (SERIAL, ~3 h) — **G2**
Slice 3a: `segLo`/`segHi` + a one-iteration loop with a running max + per-segment `M_eff` **inside**
the argmax + `leadMs` from `track.samples[starIdx].utcMs`. The docstring carries C-3 verbatim:
*`alt*` is already a per-cell argmin, but `V` and the four τ buckets average over the whole window,
so raising `topAltDeg` alone yields exactly the average the owner forbade.*
**IDEMPOTENCE and ORDER-INDEPENDENCE are written BEFORE the loop**, not after — every accumulator in
`solveTerms` is allocated fresh per call, so a missing reset is structurally invisible at T = 1.

#### WAVE 3 — the tail (PARALLEL, 2 streams, ~1.5 h)
**S6** F_peak's solver plumbing + `contactOf` gains `"peak"` (four `Record`s move; **the fourth is
`scripts/verify-bestspot.mjs:947`, which is JavaScript and TypeScript will not catch it**) ·
**S7** Lean `max3_mem_Icc` + `peakBound` (written now that the kernel exists) + the superset pin.

**Exit gate — exact.**
```
sha256 × 13 surfaces × 7 fixtures        recorded, and unchanged since Wave 0 except where ruled
T=2 idempotence / order-independence     byte-identical
bestSpotSolver.test.ts:1269 (27.09 MB) and :1273 (< 101 MiB)   both green
17 golden rows in bestSpotGolden.test.ts bit-identical
npm test / npx astro check / npx knip    green
npm run proofs                            at its new count
```
**Artifacts.** `bestSpotParity.test.ts` + fixtures · the plateau histograms (the GO/NO-GO) ·
F_peak gated OFF · the three clamps · DECISIONS 2026-08-26i.

---

### SESSION 2 — WIRE · PROVE · DOCUMENT

**Goal.** The mode exists, OFF is proven byte-identical in the browser as well as in node, and the
docs carry real numbers.

**Entry gate.** Session 1's exit. **Environment, non-negotiable:**
`export PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH"` (node 20 has no global `WebSocket`) ·
restart `wix dev` (new imports in the globe bundle ⇒ `504 Outdated Optimize Dep` on every island) ·
restart Chrome between scripts (WebGL contexts exhaust after ~5 suites).

#### WAVE 0 — the mode (SERIAL, ~5 h) — **G3**
Slice 3b, and it stays one coherent change across six files because splitting it costs more in merge
than it saves: `window*` options with truncation from the **new** end (direction from `upSign`)
applied **before** the uniform decimation · four **required** job fields · the T0.5 key carrying the
numbers · the `CLASS_OF` mode decision (41 of 53 rows say `recompose` and that path does not exist in
sweep mode) · the `withSweep(scoring)` hash-echo hole · store `sweepMode` + `DEFAULTS()` ·
the panel toggle as a second `<button className="pp-chip" aria-pressed>` in the existing chips row
(0 px cost) + one ON-only status line · refuse SWEEP × ULTRA.

#### WAVE 1 — parallel (3 streams, ~2.5 h wall-clock)
**S8** `scripts/verify-bestspot-sweep.mjs`, groups A-F (~40 checks), authored against the seams 3b
just shipped · **S9** the docs delta: `SPEC_V2 §9` skeleton, the `RECONCILED` block, `ARCHITECTURE`,
`globe-tuning`, `FORMAL_VERIFICATION` · **S10** *(first to be cut if time is short)* the shortlist
quotas + the per-row time swap.

#### WAVE 2 — the browser (SEMI-PARALLEL, ~3.5 h — **the real long pole**)
**Two Chrome instances on different ports.** Port 9222: `verify-bestspot.mjs` re-baseline (three
runs, not one) then the D8 re-derivation. Port 9333: `verify-bestspot-sweep.mjs`.
**The D8 hill-climb does NOT parallelise** — it is a sequential search, and per the corrections block
its objective is **run-to-run variable**, so every candidate needs ≥2 quiesced measurements.
Budget it as the long pole and start it first.

#### WAVE 3 — close (SERIAL, ~1 h)
`SPEC_V2 §9` finalised with the measured numbers (**written last, after the browser run** — a spec
section written earlier is another forecast, and this repo has a documented allergy to exactly that)
· `DECISIONS` · `NEXT_SESSION_PROMPT` · Serena memories · `.claude/.ship-title`.

**Exit gate — exact.**
```
ALL 13 PARITY SURFACES, MODE OFF        unchanged
scripts/verify-bestspot.mjs             101/101   (D8 re-derived, thresholds NEVER loosened)
scripts/verify-bestspot-sweep.mjs       all pass; B1 PASS (not INCONCLUSIVE); B5 zero violations
scripts/verify-bestspot-ownerbatch.mjs  45/45 unchanged   ← the second-strongest OFF-parity signal
feed.debug().keys.t05                   OFF: character-for-character; ON: moves (positive control)
firstInkMs ≤ 120 · refinedMs ≤ 1200 · drag.median − idle.median < 12 ms
npm test / astro check / knip / npm run proofs
```

---

### What this costs, honestly

| | 7-session plan | 2-session plan |
|---|---|---|
| total work | ≈ 48.5 h | ≈ 44 h (quotas deferred) |
| **wall-clock critical path** | ≈ 48.5 h | **≈ 21 h** |
| serial gates | 7 session boundaries | **3** (G1, G2, G3) |
| merge risk | none (serial) | **3 file clusters, mitigated by stream assignment** |

**The three things that do NOT compress, and why:**
1. **G1.** Fan out before the goldens are frozen and the parity contract — the owner's central ask —
   is decorative. Non-negotiable.
2. **The solver spine 3a → 3b.** Same file, same contract, and 3b consumes 3a's shape. Parallelising
   these two buys a merge conflict in the one file that must not have one.
3. **The browser.** Wall-clock bound: streaming waits, ~15 min per full run, and a D8 re-derivation
   whose objective was *measured* non-deterministic. Two Chrome instances help; the hill-climb does
   not parallelise at all.

**The strongest argument FOR compressing** is R-1. The plateau probe is a GO/NO-GO that could make
F_peak a precondition rather than a nicety. In the serial plan that discovery lands in Session 2 and
invalidates Sessions 3-5's ordering. **Here, F_peak is being built in the same wave, so the reorder
costs nothing** — the parallel structure absorbs the exact risk the serial one was most exposed to.

---

## 4. THE LEAN DECISION

The rule: formalize only when **(1) ALGEBRAIC** — no IEEE-754, no DEM raster, no ephemeris · **(2) LOAD-BEARING** · **(3) currently pinned ONLY by examples** · **(4) expressible in EXACT arithmetic**. Formalize the CLAIM, never the IMPLEMENTATION. The payoff is the hypotheses.

| Candidate | (1) alg | (2) load | (3) examples-only | (4) exact | **VERDICT** | h |
|---|---|---|---|---|---|---|
| **`score_mem_Icc`** — the 5-factor product `S = A_hard·A_soft^e·M·G(V)·pref ∈ [0,1]`, the theorem `formal/Ftw/Score.lean:7`'s own header writes out and never states | ✔ | ✔ | ✔ | ✔ | **FORMALIZE.** `Mathlib.Analysis.SpecialFunctions.Pow.Real` is already imported at `Score.lean:18` and **currently unused** — the file was built for this. **This theorem is the reason the other defects were found.** | 1.5 |
| **`max3_mem_Icc`** — `F = max(F_graze, F_gap, F_peak) ∈ [0,1]` | ✔ | ✔ (`CellScore.f` documented `0..1`, `bestSpotTypes.ts:307`) | ✔ (new code) | ✔ | **FORMALIZE**, 4 lines. It discharges `preference_mem_Icc`'s `htf0/htf1` for the new arm, which is the only reason it matters. Rides Session 5. | 0.25 |
| **`peakBound`** — `F_peak ∈ [0,1]` given its parameter bounds | ✔ | ✔ | ✔ | ✔ | **FORMALIZE**, but write it **after `peakFFromParts` exists**, not before — its hypothesis list is [DERIVED] from a design doc today. Rides Session 5. | 0.5 |
| **`conf_nonneg_is_necessary`** — a counterexample beside `confBound_is_necessary` (`Score.lean:218`) | ✔ | ✔ | ✔ | ✔ | **FORMALIZE**, 3 lines, `by norm_num`. Rides Session 1 with C-11's clamp. | 0.25 |
| **`S_best = max over segments ∈ [0,1]`, monotone** | ✔ | ✔ | ✔ | ✔ | **FORMALIZE as a two-line corollary of `score_mem_Icc`** (`Finset.sup'_mem_Icc` / `Finset.sup'_mono`). Do **not** build segment machinery — `max` over a finite family adds one `simp`. Earns its place through its hypothesis: the objective must be evaluated identically for every segment, which forces the check that per-segment `M_eff` is *inside* the argmax (Session 2.2). | 0.25 |
| **The T=1 parity claim** | ✔ trivially | the claim yes, the Lean statement no | ✘ — it is pinned by an exact SHA-256 | **✘** — the claim is about f64 **bytes** and buffer indexing | **TEST-INSTEAD.** `max` over a singleton is `Finset.sup'_singleton`; stating it proves nothing, because the risk is allocation, indexing and ULP drift, which `FORMAL_VERIFICATION.md:139-143` rules out of scope. §2 is strictly stronger. **This is the ceremony to refuse.** | 0 |
| **"The argmax objective reads only `rescore`-or-heavier leaves"** | **✘** — a statement about which *variables a function reads*, over a lookup **table** | ✔ | ✔ | n/a | **TEST-INSTEAD.** Lean needs a deep embedding of the objective — the `upperHull` mistake (`FORMAL_VERIFICATION.md:85-89`), 1-3 person-weeks. The right instrument is mechanical: **for every `CLASS_OF` path classified `recompose`, perturb it and assert `winner[]` is bit-identical.** Runs in node, ~1 h, Session 2. | 0 |

**Lean total: ~2.75 h.** Plainly: **almost nothing new gets formalized, and that is the correct answer.** The value on this track is ~2.5 h of TypeScript clamps that the theorems' *hypotheses* forced into the open.

### The hypothesis audit — every hypothesis, checked against the shipped sanitizer

| Hypothesis (theorem) | Enforced? | Where | Verdict |
|---|---|---|---|
| `0 ≤ conf` (`confBound`, `Score.lean:208-211`) | **NO** | `bestSpotScoring.ts:655-657` is `Math.min` only; `:769-775` likewise | **DEFECT — Session 1.5.** `graze.conf.terrain: -1` persists verbatim and inverts monotonicity: more grazing → lower score. `f = Math.max(fGraze, fGap)` keeps `f ≥ 0`, so boundedness survives and only monotonicity dies — the exact reason the weights defect hid for months. |
| `conf ≤ 1` (`confBound`) | YES | `bestSpotScoring.ts:656`, `:769-775` | OK |
| `0 ≤ w` (`preference_mem_Icc`) | YES | `bestSpotScoring.ts:662-664` | OK — the only sanitizer-side enforcement in the file |
| `0 < Σw` (`preference_mem_Icc`) | YES, at the kernel | `bestSpotMetric.ts:1184`, `bestSpotSolver.ts:1722` | OK |
| `0 ≤ e` (`score_mem_Icc`, the `A_soft^e` factor) | **NO** | `curves.accessSoftExponent` has no `clampLeaf` case; `default: return value` (`bestSpotScoring.ts:787-788`) is fail-OPEN | **DEFECT.** A negative exponent turns landcover into a **reward** — `wetland` (soft 0.1) outranks `path` (soft 1.0) — and the outer `clamp01` (`bestSpotMetric.ts:1185`) hides it completely. 1 h, Session 5 or a spare hour in Session 1. |
| `scaleRadii > 0` (`grazeFromTau_mem`, `_strictMono`) | **NO** | guard at `bestSpotMetric.ts:644` `if (!(scaleRadii > 0)) return 1` — the wrong direction | **DEFECT, and the best hour-for-hour item on the whole track.** It re-creates the exact kernel defect GRAZE replaced (`Score.lean:150-152`: *"it hit 1 for ANY built skyline the body's centre crossed… measured r² 0.997"*). The precedent is one file away: the *other* e-folding scale, `trackWeight.altScaleDeg`, is floored `Math.max(1e-6, …)` at `bestSpotTrack.ts:628-631`. Two e-folding scales, one clamped, one not. **`grazeFromTau` has zero direct unit tests.** 0.5 h. |
| `0 ≤ floor ≤ 1` (`effectiveWorth_mem`) | YES, at the kernel | `clamp01` at `bestSpotMetric.ts:1329` | OK (though `worth.effectiveFloor` *resolves* to 5) |
| `0 ≤ f ≤ 1` (`cut_mem`) | YES | `clamp01(discFrac)`, `bestSpotMetric.ts:602` | OK |
| `0 ≤ peak.conf ≤ 1` (`peakBound`) | **NOTHING** | the group does not exist | **Must land WITH slice 2** (Session 5.3), including its own `clampResolved` loop — `clampLeaf`'s `default` is fail-open, so without one `confBound_is_necessary` reappears from a persisted blob with no test red. |

**One generalizing test worth more than any theorem here (2 h, Session 5 or 7).** A hostile-leaf sweep over `scoringLeafPaths()`: for every numeric leaf, assert `resolveScoring(leaf := -1)` and `(leaf := 1e6)` land inside a declared range **or** the path is in a `NO_CLAMP_BY_DESIGN: Record<path, reason>` allowlist, asserted **set-equal** (the `EXPECT_INERT_ON_FIXTURE` idiom, `bestSpotScoring.test.ts:471`/`:671`). It would have caught all three defects above *and* both 2026-08-24d defects, and it covers slice 2's new `peak.*` leaves for free the moment they exist.

**Traps, all confirmed:** `export PATH="$HOME/.elan/bin:$PATH"` first (the script does it itself at `scripts/verify-proofs.mjs:64`, so `npm run proofs` is immune; a bare shell is not) · `lake build` PASSES with a `sorry`, so the axiom audit is the gate · a multi-line `by nlinarith [...]` inside parens breaks the bracket parse · Mathlib is pinned by `rev`, not `version` · build from the repo root, not `cd formal`. **Two more:** the audit's theorem regex is `^theorem\s+`, **anchored at column 0** (`verify-proofs.mjs:108`) — a `lemma`, a `private theorem` or an indented declaration is invisible to the audit and the `audited !== theorems.length` guard at `:150` cannot fire. **Rule for Sessions 1 and 5: `theorem`, never `lemma`, never indented.** And `npm run proofs -- --list` exits at `:117`, *before* the audit — a green `--list` is not a green gate.

---

## 5. THE BROWSER PLAN

### What is red NOW (before anything in this schedule)
- **4 checks, D8 cross-model, red on clean master** — `verify-bestspot.mjs:922-925` (`heroBest.score ≤ DISPLAY_LO`: measured 0.3159 vs 0.15), `:976-980` (`vOpen < 0.5·vHero`), `:986-989` (`vHero.skylineAltDeg > 5`: measured 0.97°), `:990-994` (spread > 10°). RC16/RC17 moved the building geometry after the fixture was recorded. Carried, **not attributable to this work**, re-derived in Session 4.3, **never loosened**.
- **2 latent crashes**: `:916` and `:945` unguarded `[0]`. `ok()` only *records* a failure; execution continues, so an empty shortlist throws a `TypeError` → `uncaughtException` → `finishVerify(1)` and the run aborts at check ~66 of 101, silently skipping the last four sites. Slice 1 makes an empty shortlist reachable.
- **1 always-wrong exit**: `probe-bestspot-taste.mjs:340`.

### What gets RE-DERIVED (Session 4)
Three **MOVES** (absolute numbers in the message, not thresholds): `:400-403` `heightProvenance.enriched` (the feed now counts building meshes only — a *correction*, and if a doc does not say so the next audit reads it as a regression) · `:531-534` both `rMean`s (`rMean` is over `g ≠ 0`, so withdrawing canopy cells *raises* `hDnipro.rMean`; the recorded delta is 158.4 against a threshold of 32, so this survives) · `:1108-1111` rural `hotFrac` (re-read, do not re-pin — recorded 0.0000 against a 0.05 ceiling).

Three **MIGHT-FLIP on measurement**, all unmeasured in both directions: `:344-347` `firstInkMs ≤ 120` (`buildDsm` grew ~9,570 `addCanopy` stamps inside the T1 critical path) · `:449-458` `topSpread > 0.1` (two independent compressive pressures) · `:727-731` `drag.median − idle.median < 12 ms` (ten `setLiftM` steps → ten `postSolve` → ten main-thread `collectCanopyInstances` passes, ~600 KB of `instanceMatrix` copying each, inside the 3 s probe window — **not on any track's list but the browser's**).

One **latent slice-2 landmine**: `:947` `openBest.contact === "open"` is a JavaScript `Record` over the `contact` union. TypeScript catches the three TS ones; it will not catch this. Comment it in Session 5.4.

### What gets WRITTEN
**Session 1** — the three fixes above (1.3, 1.4).
**Session 4** — `scripts/probe-bestspot-d8-pin.mjs` (a `probe-` prefix: `test/verifyHarness.test.ts:43-44` fences `verify-*` only, and `probe-` is the documented escape for non-PASS/FAIL scripts) and `scripts/verify-bestspot-sweep.mjs`, groups A-F:

- **A — the toggle arms and disarms.** OFF on fresh boot; `setOpen(true)` does-or-does-not reset it (assert whichever, explicitly); ON while `heatmapOn === false` posts **zero** jobs, with `setHeatmapOn(true)` as the live-counter positive control; ON while armed posts **exactly one** and moves `keys.t05`; OFF moves it back character-for-character; `keys.sources` does **not** move across either toggle; SWEEP × ULTRA refused.
- **B — OFF is byte-identical. THE HEADLINE.** Three quiesced reads in **ONE session, no reload** (the field genuinely improves as tiles stream): A → `setSweepMode(true)` → B → `setSweepMode(false)` → C. **B1** `hashC === hashA`. **B2 the validity guard, not optional:** `sourcesEpoch_A === sourcesEpoch_C` and `keys.t1_A === keys.t1_C`; if either moved, B1 is **INCONCLUSIVE, not PASS** — report and retry once. Without this it fails open in the one way it can. **B3** `hashB !== hashA`. **B4** `keys.t05_C === keys.t05_A`. **B5 the monotonicity invariant:** stash `rg8_A` in-page and require, for every `i` with `g_A[i] ≠ 0`, that `g_B[i] ≠ 0` **and** `r_B[i] ≥ r_A[i]` — because the contact instant is a member of the window by construction, `S_ON = max_t S ≥ S(t0) = S_OFF` exactly, and byte quantisation is monotone. Zero violations is the pass. This fails if the merge writes the losing segment's terms, if the running MAX is an average, or if the truncation dropped `t0`.
  Digest expression — three traps at once (async IIFE because `Runtime.evaluate` compiles an ExpressionStatement; `.slice()` because `rg8` may be a view; `JSON.stringify` **inside** the IIFE because stringifying a promise returns `{}`):
  ```js
  (async () => {
    const f = window.__globe.bestSpotField();
    if (!f) return JSON.stringify({ error: "no field pack" });
    const d = await crypto.subtle.digest("SHA-256", f.rg8.slice().buffer);
    const hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2,"0")).join("");
    const dbg = window.__globe.bestSpot();
    return JSON.stringify({ hex, n: f.n, bytes: f.rg8.length, keys: dbg.keys, jobs: dbg.jobs });
  })()
  ```
- **C — the owner's case lands.** `setKind("moonrise")` **before** `setOpen(true)` and **re-asserted after**, `setHeatmapOn(true)` last (the store defaults to `kind: "sunset"` and `setOpen` force-clears `heatmapOn`). Pose `#p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`; locate `48.451827,35.070311` with `probe-bestspot-taste.mjs:195-200`'s `cellOf` verbatim so the two instruments are commensurable. **OFF control first** — reproduce byte 0 / percentile 0.469 / nearest marker 42 m; if that does not reproduce, everything after it is uninterpretable, **stop and say so**. Then: his cell `.r > 0`; his cell **ranked** (`topK.some(r => dist(r,PICK) < 25)`, the NMS radius); `window.hiMs >= Date.parse("…T16:44:43Z")`; the winning instant's `M_eff` beats the contact's (sun −1.94° inside the `worth` plateau vs +5.16° broad daylight).
- **D — the per-row time is honest.** OFF: `topK.every(r => !("bestAtMs" in r))`. ON: finite and inside `[loMs, hiMs]`; `new Set(rows.map(r => Math.round(r.bestAtMs/60000))).size >= 3`; one cross-model row (scrub to `topK[0].bestAtMs`, `planVerdictAt`, require `moon.altDeg > moon.skylineAltDeg`, with the same cell at `contactMs − 30 min` as the negative control); `.pp-day__meta` contains a `~HH:MM` token and **not** `+3m20s`.
- **E — latency.** OFF warm `firstInkMs ≤ 120` / `refinedMs ≤ 1200`, driven identically to `:328-338`. ON: `refinedMs ≤ 1200` with `window.K`, `window.samples` and `hullBuilds` reported beside it. **This is the row that decides whether `windowMaxSamples` ships at 68 or lower** — the map's own words: *"All of T2's latency numbers above K = 40 are linear projections, not measurements."*
- **F — F_peak on/off, four checks only** (Session 5): shipped `enabled: false` and the virgin `diff` carries no `peak.*` path; `bestSpotTuning({peak:{enabled:true}})` → `lastClass === "rescore"`, never `recompose`; `cellsWithPeakF > 0` on a spire disc and 0 off; `bestSpotTuning(null)` returns the field to `hashA`.

### Traps for the new script, all confirmed
Copy **ownerbatch's** `send()` with its 90 s timeout (`:104-113`) — `verify-bestspot.mjs:76-81` has none, and its own header records that an unbounded one once hung a run for 50 minutes · `Page.bringToFront` after `Page.enable` and before every `FRAME_PROBE` (occlusion flags exist only on the *managed* launch, `verify-chrome.mjs:41-43`; `verify-bestspot.mjs` brings to front only inside `shot()` at `:107` and works today only because `:647` happens to precede `:707`) · difference the cumulative counters (`jobs/drops/hullBuilds/frames/mirrorWrites`, `bestSpotFeed.ts:197-229`) · a probe reading a missing field FAILS OPEN — B2 is the instance that matters · hash-only `Page.navigate` does not reload · `/tmp/ftw-cdp` persists prefs, so `sweepMode` must be SET as a precondition exactly as `buildings3d` is · **the `error: "no field pack"` sentinel must not be compared with `===` against an expected string** or the `: "absent"`-shaped acceptance probe at `test/verifyHarness.test.ts:158-161` fires.

---

## 6. THE DOC DELTA

| Session | File | Action |
|---|---|---|
| **1** | `.claude/claude-docs/bestspot/SWEEP_MODE_MAP.md` | **EDIT** — `:236` corrected per C-1 (the hash host is `bestSpotSolver.test.ts:594-602`, not `bestSpotComposition.test.ts`); `:289` the CUT list still says defer the canopy withdrawal its own header says shipped — **five CUT items are now four**; §4 slice 3a's file/line list still describes the per-segment term buffer the header deletes, so a reader following §4 verbatim rebuilds the thing that was ruled out; add C-4's note that the 96 B layout breaks `:1269`, not `:1273`. |
| **1** | `.claude/claude-docs/DECISIONS.md` | **APPEND** 2026-08-26h — the landing, the wire fix, the `conf` floor, the parity contract. Never edits history. |
| **7** | `.claude/claude-docs/BESTSPOT_SPEC_V2.md` | **EDIT IN PLACE + a `RECONCILED 2026-08-26n` block + a new `§9 SWEEP MODE`.** **No SPEC_V3** — a V-bump supersedes named sections when default behaviour is re-derived (`:3`), and sweep re-derives nothing: it is byte-identical OFF and that identity is fenced by a committed SHA-256, so a V3 would have to restate §1-§6 unchanged in order to be a spec. The repo already edits specs in place with a dated reconcile block (`:8-22`). Thirteen corrections: **D1** §1.2 step two (trees became real, and the mechanism — canopies fold into `canopyTop`/`canopyMask` and **never** `solidMask`, because a canopy written as solid makes every tree-lined avenue INACCESSIBLE at `access.aerialMinM`) · **D2** §1.2 bullet 2 is wrong in three ways (the 45 % tree discount was unreachable; 93 % is superseded by 118/161,823 = 0.073 %; it is now partly a **ban**) · **D3** §1.1's `C` block gains the third withdrawal producer with its two-sided bound and the `canopyUncredited` counter · **D4** §2.1 row 7c measured a design that had not shipped — re-measure or label UNMEASURED-AT-REAL-COUNTS · **D5** §5.4 `trackWeight.*` is `rescore`, and record that both leaves were **silently inert** and neither half of the fix works alone · **D6** §2.2 T0.5 is DAY-or-KIND-**or-the-track-sub-hash** · **D7** the "54 leaves" claim — **verify then pin, do not edit the number**: my count is 53 (41 recompose, 12 rescore, zero `reweigh`) and the test pins only `>= 50` (`bestSpotScoring.test.ts:555`) · **D8** §3.1/§3.4 gain the 26g re-baseline · **D9** §3.4(b) gains its companion asymmetry · **D10** §6.11 gains the canopy wire budget · **D11** the `F = max(…)` header goes 3-ary · **D12** §4 gains the sixth data-driven decision (window truncation from `upSign`, never the hemisphere) · **D13** §7's heading re-heads as a ruling record. |
| **7** | `.claude/claude-docs/BESTSPOT_PLAN.md` | **EDIT** — record the `heightProvenance.enriched` correction (it quietly corrects a user-visible number); state **both** tree-provenance statistics with their definitions (151,046/161,823 "seeded scatter" vs 118/161,823 "integral heights") or the `graze.conf.tree` clamp cites the weaker one forever. |
| **7** | `.claude/claude-docs/BESTSPOT_TASTE_V1.md` | **EDIT, one line, load-bearing** — `:227-228` *"A second instant costs a max-angle query + a score pass… never a hull"* is **false**: the hull cache key is an exact azimuth match (`bestSpotSolver.ts:1187-1196`). Replace with the superset property. This is the doc a future session would read to justify the cost model. Otherwise it stays as the diagnosis. |
| **7** | `.claude/claude-docs/ARCHITECTURE.md` §7c | **EDIT** — charter list gains the map + taste doc; `:313-318`'s "keystone" is true but **incomplete** (the hull is time-invariant, but the *set of azimuths is a function of the day*, so affordability rests on the absolute-lattice superset property — this under-statement is what produced the false cost claim above); `:322` becomes conditional (**in SWEEP mode a scoring patch is a `rescore`, never a `recompose`**); the honesty layer gains its fourth mechanism; `bestSpot` gains `sweepMode`; and say **explicitly** that the module list is unchanged, so the next reader does not hunt for a `bestSpotSweep.ts`. |
| **7** | `.claude/claude-docs/IMPLEMENTATION_PLAN.md` | **CREATE a section** — **BEST SPOT is absent from all 309 lines** of the document `.claude/CLAUDE.md` names as the source of truth on *execution*. ~20 lines, `8-bestspot`, matching the `8-QoL-*` shape. Biggest structural gap in the docs. |
| **7** | `.claude/conventions/globe-tuning.md` | **EDIT** — the leaf count; the scoring-groups row gains `peak`; **window params ride the job and are NOT patchable through `__globe.bestSpotTuning`**; the unswept-judgements list gains `peak.conf.*` and records that `graze.conf.tree = 0.45` was a listed taste target *while being dead code*; **a fifth trap, the best of the batch:** *`InstancedMesh.isMesh` is true, and a bounding-sphere reject placed before the instanced branch is a no-op at exactly the discs that have trees, because `geom.boundingSphere` is the shared unit **prototype's** — a ~0.5 m ball at the cell root. The cull has to be per instance.* Generic to every scene feed that flattens geometry, so it belongs in a conventions file. |
| **7** | `src/components/globe/tuning.ts` | **EDIT** — a named line saying the canopy withdrawal's two bounds are **deliberately not tunable** (they are the body's geometry, derived not chosen); and the `windowMaxSamples` docstring carrying its derivation with the measured number from Session 4. |
| **7** | `.claude/claude-docs/FORMAL_VERIFICATION.md` | **EDIT** — §0's two-row defect table becomes five; the theorem count; §5's S1/S2 CONFIRMED or **DELETED** (per the file's own rule, a finding that does not reproduce is deleted, not downgraded); the hypothesis-audit rows from §4. |
| **7** | `.claude/CLAUDE.md` | **EDIT, one clause** — the Knowledge search order §2 names `.claude/claude-docs/` but not the per-feature subdirectories that now exist (`bestspot/`, `rendering/`, `audits/`, …). Without it the map is findable only by luck. |

**The map stays where it is and becomes provenance** the moment §9 lands — the way `provenance/DEEP_RESEARCH.md` sits behind ARCHITECTURE. It is 307 lines of ruled contradictions and rejected alternatives; that is provenance by nature, and merging it would drown §9. Its header gains one line saying so.

---

## 7. RISK REGISTER

| # | Risk | P | Impact | Mitigation |
|---|---|---|---|---|
| **R-1** | **The RANK CEILING.** The owner shot at moon alt **+5.90°** (`BESTSPOT_TASTE_V1.md:26,134`), which is **above `lCeilDeg = 5`** — so `L = 0` **exactly** at his own instant (`bestSpotMetric.ts:283-287`, `bestSpotScoring.ts:386`, weight `l: 0.3`). His cell's ceiling under sweep is `0.15·V + 0.25·P + 0.30·F ≤ 0.70`, against a field whose current best is **0.400** (`BESTSPOT_TASTE_V1.md:49`). If `F` fires at his skyline he ranks #1; if `F = 0` there he caps at **0.40 — a tie with today's field best, and he still does not rank.** | **0.4** | **Very high** — the mode ships and the owner's own photograph still is not found | **Session 2.1, 2 h, zero production code.** Read the *rank* of his cell under `max(S_low, S_high)`, not the histogram. Three outcomes: `f = 0` everywhere high ⇒ slice 2 becomes a precondition and C-2's reorder fires; the max histogram collapses (>60 % within 10 % of the plateau) ⇒ the argmax objective needs a term nobody has designed, which is a design session learned for 2 h instead of after 26 h of building; it does not collapse ⇒ proceed as scheduled. |
| **R-2** | Goldens recorded on an unlanded tree, then the ship rebases or the owner amends slice 1 ⇒ every literal is silently wrong-but-green until something moves | 0.3 | High — the whole harness becomes decorative | Session 1 sequences landing **before** recording, and the provenance line carries the parent SHA. This is why 1.1 precedes 1.6. |
| **R-3** | `windowMaxSamples ≈ 68` is a **linear projection**; real `refinedMs` at K = 80 could be 2.5 s | 0.4 | Medium — a product change discovered late | Session 4 group E reports `K`, `samples` and `hullBuilds` **beside** `refinedMs` so the budget can be re-sized rather than merely failed. Truncation is from the new end only, so lowering the cap is a one-number change. |
| **R-4** | `firstInkMs > 120` because `buildDsm` grew ~9,570 `addCanopy` stamps, or drag cost > 12 ms from main-thread `collectCanopyInstances` | 0.35 | Medium — slice-1 rework landing after slice 1 shipped | **Measure first, do not pre-emptively memoise.** If red: memo `collectCanopyInstances` behind `sourcesEpoch` (the canopy set is a function of the geometry sources, not of the lift — the same argument that makes `hullBuilds = 0` reachable). 1.5 h, and it must not land in the same diff as a scoring change. |
| **R-5** | The missing-reset class between instants — structurally invisible at T = 1 | 0.3 | High — a silent wrong answer in the mode itself | §2's idempotence + order-independence tests, **written before the loop** (Session 2.3). |
| **R-6** | Dnipro no longer contains a cell that is both **building**-walled and low-scoring post-slice-1 ⇒ D8 is un-re-derivable there | 0.2 | Medium — blows Session 4.3's 2.5 h | The right bank is dense masonry, so unlikely. Fallback: re-state D8 against the mid-reservoir precedent or move the pin to a different city. **Do not move the DNIPRO census pin — it is load-bearing for ~24 checks.** |
| **R-7** | `sourcesEpoch` moves on every sweep toggle ⇒ browser B1 is never conclusive | 0.2 | Medium | Session 3.2 makes it an exit gate in node before Session 4 ever runs. Fallback: the OFF-parity claim rests entirely on the node SHA-256, which is stronger anyway. |
| **R-8** | A node major upgrade breaks the hash with no bug behind it | 0.15 | Low, if the layers exist | Surface 7 (differential, no golden) stays green; surface 6's decimals name how far it moved. Converts "the hash broke" into "the hash broke by 1 ULP on `p`". |
| **R-9** | `contactOf` gains `"peak"` and `verify-bestspot.mjs:947`'s JavaScript `Record` silently loses a case | 0.25 | Low — one browser check reads wrong | A comment at `:947` naming it, written in Session 5.4. Nothing in the gates catches this; the only defence is remembering. |
| **R-10** | Doc drift: Session 1 edits the map, Sessions 2-6 each want small amendments | 0.5 | Low | Session 1 writes the *corrections*, Session 7 writes the *additions*; nothing in between edits `SPEC_V2 §1-§6`. |

**The single riskiest item is R-1**, and the cheapest de-risking experiment is **Session 2.1 — 2 h, in node, zero production code**. Node rather than the browser because the claim is **structural** (does a term evaluate to exactly 0), not calibrational, so a synthetic skyline is a legitimate instrument — and node lets you read `fGraze` and `fGap` **separately**, which `__globe.bestSpotField()` structurally cannot: it publishes a packed byte, and `rg8.r` is clamped to `[displayLo, displayHi]` so everything below 0.15 is byte 0.

**One cheap alternative R-1 mitigation that no track named, and it deserves a probe arm.** `curves.lCeilDeg` is an **existing** leaf, class `recompose` (`bestSpotScoring.ts:487`), clamped to `[0.5, 30]` at `:668`. Measure the owner's cell rank at `lCeilDeg ∈ {5, 8, 12}` inside Session 2.1 at ~15 min marginal cost. If raising it to 8 puts him at rank 1, that is a zero-code answer to the framing-term problem. **Caveat, stated honestly:** `lCeilDeg` is a scoring leaf, so it moves DEFAULT mode too and it is inside the parity hash — it would have to be sweep-mode-scoped, which reintroduces the mode-scoped-profile problem that Session 3.4 exists to solve. Measure it anyway; the number is worth having before slice 2 is scoped.

---

## 8. WHAT I WOULD CUT

Ranked by confidence that cutting is right. The owner's ask survives all of these; four sessions of scope do not.

1. **CUT the two-build browser `rg8` byte compare.** Two tracks independently reached this and the map itself calls it *"a one-time landing check, not a regression test"* (`:246`). It needs two builds and a bespoke harness for a claim the node SHA-256 makes more cheaply, more precisely and with a bisect. **Saves ~1 h and a fragile artifact.**
2. **CUT the DONE-CHECK-4 widening from 25 probes to 10.** The parity track's own sizing flags the runtime risk (each probe rebuilds K ≈ 40 hulls; 5 fit inside ~10 s of the 23.4 s three-file run). Ten probes across ridge / off-ridge / rim / unknown give the same differential coverage; the 21 per-field digests are the real localiser. **Saves ~1 h and a runner-budget risk.**
3. **CUT the dedicated F_peak browser leg beyond group F's four checks.** F_peak ships gated OFF with twenty golden rows in node, and `bestSpotScoring.test.ts:650-675`'s inertness walk already proves OFF costs nothing on every `npm test`. A browser leg on a disabled feature proves only that the toggle is inert. **Saves ~2 h.**
4. **CUT the pre-emptive canopy memo (R-4).** `MESH_BUDGET = 512` already caps the TIN side; the cost may be 2 ms, in which case the memo is 1.5 h spent on a number that was never a problem — and it would land inside the same diff as a scoring change, exactly the coupling the map's §7 argues against. **Measure, then decide. Saves 1.5 h in the likely case.**
5. **CUT the docs track's Session G as a separate session.** Its four items fold into Session 7 at the same total hours; a seventh session boundary buys nothing and adds a re-seat.
6. **KEEP the map's four remaining CUT items cut**, and do not re-litigate them: `tauTree` near/far (`Depth(D)` already prices distance per edge) · the five-status-line collapse (orthogonal; a layout regression and a scoring regression in one diff is how both get missed) · a third marker channel for time (`heatPalette.ts:56-83` assigns exactly two channels to two facts and says the pairing is load-bearing) · `peak.spanDeg` as a tunable (no calibration behind it, and freezing it removes one leaf from the every-field-is-live walk).
7. **DEFER the OSM landmark layer (B2).** Bake filter + MVT parse + evidence tag + a new `OccluderSrc` member — larger than every slice here combined. Backlog it with the one measured fact that justifies it: the `historic=memorial` steles 4 km from the owner are invisible end to end because the bake filter is `way["building"]`.
8. **DEFER re-opening `P` / `depthTrustRadiusM` (TASTE H4, field best 0.400 → 0.456).** It moves the **default** mode, which this entire design is fenced against. T49, after sweep's numbers exist.
9. **DEFER "make a flat field readable" (TASTE §5.D) to Session 7.** Sweep will *change the distribution* that section exists to fix; tuning the display normalisation before Session 4 measures it is tuning against a distribution that is about to move.
10. **DO NOT decide O2 (`peak.conf.terrain` 1.0 vs 0.6) in a design session.** Ship 1.0 mirroring `graze`, mark it unswept, hand it to T49. Deciding an unmeasured number in a doc is how the 37 unreachable constants got there.

**What I would NOT cut, despite it looking like scope.** The three latent script bugs (Session 1.3/1.4) — they are 45 minutes and without them Session 4 spends an hour diagnosing an abort. The `canopyUncredited` wire (1.2) — without it the browser re-baseline is uninterpretable and Session 4 is partly wasted. And the plateau probe (2.1) — it is the only item in the plan that can prevent 26 h of building the wrong thing.

---

## 9. GAPS — WHAT I COULD NOT VERIFY

- **I ran no gates.** `npm test`, `npx astro check`, `npx knip`, `npm run proofs` — the 2,134/2,134 and 25/25 figures are the brief's and the tracks', not mine. I ran only targeted `grep`/`sed`/`node` reads.
- **No browser run, by anyone.** All four tracks were read-only and so was I. Every MIGHT-FLIP in §5 — `firstInkMs`, `refinedMs`, `drag − idle`, `topSpread` — is **unmeasured in both directions**. I cannot say whether they are already red. The 96/101 carry-in figure is quoted, not observed.
- **I did not compute a candidate parity hash.** The determinism argument is a code-reading conclusion; the first real evidence is the record run in Session 1.
- **I did not re-run the `sorry` mutation** on the Lean gate, nor the full `npm run proofs` (step 3 writes `.lake/audit-generated.lean`). The three-layer gate claim rests on `verify-proofs.mjs:5-13` and the 2026-08-24d record. **Re-falsify it once during Session 5** — it is 3 minutes and it is the gate's own gate.
- **R-1's arithmetic is exact; its conclusion is not.** `L = 0` at 5.90° is certain (`lCeilDeg = 5`, weight 0.30). Whether `F_graze`/`F_gap` fire at the owner's cell at that altitude depends on his real skyline, which only Session 2.1 or a browser run can answer. I deliberately framed R-1 as a *rank* ceiling rather than a flat-field claim because the rank statement is the one the arithmetic supports.
- **I did not verify the 2,025-cell reconciliation** (40,401 − 31,417 = 8,984 corners; scored −1,782, INACCESSIBLE −243, sum 2,025; 2,025/31,417 = 0.0645 → `unmappedFrac 0.064`). The arithmetic is the browser track's and it reconciles to the digit, but it assumes all four re-baseline numbers came from the **same quiesced run**. If they were taken across runs, the streaming-drift trap makes it coincidental.
- **F_peak's parameter list is [DERIVED]** from the map, not from shipped code. `peakBound`'s statement moves if slice 2's kernel lands with a different factorisation — hence "write it after `peakFFromParts` exists".
- **I did not open `scripts/verify-bestspot.mjs` at every range the damage list cites.** I verified `:916`, `:945`, `:450`, `:564` by grep and the file's length; the per-check SURVIVES/MOVES classifications are the browser track's readings, which I did not independently re-derive.
- **The `curves.accessSoftExponent` and `graze.scaleRadii` defects** I confirmed structurally (no `clampLeaf` case; the `!(scaleRadii > 0) return 1` guard at `bestSpotMetric.ts:644`) but did **not** execute the sanitizer to confirm the values persist. The lean track did, executably, and I have no reason to doubt it.
- **Wix cloud remains UNVERIFIED** for this whole feature (prod dark behind the nameserver gate). Nothing in this plan changes that, and nothing in this plan should wait for it.

---

## Confidence: 84%

High on the rulings — every one of C-1 through C-11 rests on a command I ran or a line I read in this session, and four of them (the unlanded tree, the wrong hash host, the 27.09 MB pin, the 53-row `CLASS_TABLE`) contradict something at least one track asserted. High on the parity contract and the Lean decision, where the repo's own doctrine is explicit and the alternative instruments already exist. Medium on the session boundaries — Sessions 3 and 5 are the two most likely to spill, and Session 4's cost is a function of how many of the 101 checks the canopy re-baseline actually moved, which nobody has measured. Lowest on R-1's probability, which is the one number in this document that a 2 h experiment turns from a guess into a fact — which is precisely why it is scheduled first.

---

# APPENDIX A — THE SUPERSEDED SEVEN-SESSION PACKAGING (2026-08-26g)

Kept verbatim because its **work items, hour estimates and per-item justifications are the content**
that §3 repackages — nothing there was wrong except the assumption of serial execution. Read it when
you want the reasoning behind an estimate; execute §3.

## A.1 The original schedule

Seven sessions, **≈ 48.5 h**. Hours are derived from surface area I measured (call-site counts, file lengths, the 23.4 s / 87-test runtime of the three solver suites, the ~15 min wall clock of a four-site `verify-bestspot` run), not from a burn-down. Every session is executable by someone who has read only `SWEEP_MODE_MAP.md` and this document.

---

### SESSION 1 — LAND, WIRE, FENCE, FREEZE (6.5 h)

**Goal.** Slices 0+1 on `origin/master`; the three latent crashes fixed; `canopyUncredited` observable; the parity contract recorded on the commit whose parent is the landing.

**Entry gate.** `.claude/SHIP_ATTENTION.md` absent or resolved · `npm test` green on the working tree · `npx astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.

| # | Work | Files | h | Why that number |
|---|---|---|---|---|
| 1.1 | Land slices 0+1 (incl. the untracked map, taste doc, probe, memories) | the 12 modified + 4 untracked | 0.5 | The session-end hook does it; the 0.5 h is verifying tree-identity afterwards and re-seating. |
| 1.2 | `canopyUncredited` → wire | `bestSpotSolver.ts:1449` → `bestSpotWorker.ts` (rung type ~`:1213`, `:1294`, `:1556`) → `bestSpotFeed.ts` honesty block (~`:238-244`, `:1015`) | 0.75 | The type is restated at four points; `openSkyUncredited` has 15 hits to mirror. Trivial code, 45 min of finding all four. |
| 1.3 | Guard `verify-bestspot.mjs:916/945`; change the note filter from `!== "ON A BRIDGE"` to `note === null \|\| !note.startsWith("TREE LINE")` at `:914/:943` | `scripts/verify-bestspot.mjs` | 0.5 | 10 lines + mutation-verify (raise `gates.minCoverage` via `bestSpotTuning` to empty the shortlist, confirm the run reaches Pacific instead of aborting). |
| 1.4 | `probe-bestspot-taste.mjs:340` `finishVerify(PORT)` → `finishVerify(0)` + a failure summary | `scripts/probe-bestspot-taste.mjs` | 0.25 | One line; the summary is the other 15 min. |
| 1.5 | The `conf` floor: `BESTSPOT_SAFETY.confMin = 0` in `clampResolved:655-657` **and** the five `clampLeaf` cases `:769-775`; correct the `confMax` docstring at `:319-331` | `bestSpotScoring.ts` + `test/lib/geo/bestSpotScoring.test.ts` (third `it` in the SAFETY describe at `:1327`) | 1.0 | 8 lines of source; the hour is three mutation surfaces (resolve, sanitize, kernel monotonicity) plus the docstring, which currently claims the ceiling was the whole fix. |
| 1.6 | Build `test/lib/geo/bestSpotParity.test.ts`: 7 fixtures, all 13 surfaces, `RECORD` mode | new file + lift the private builders (`scene`, `solveInput`, `composeCtx`, `greenLand` — `bestSpotSolver.test.ts:139-255`) into `test/lib/geo/fixtures/` | 2.5 | Builders exist but are module-private; fixtures F (canopy) and G (moonrise) are new scenes needing non-vacuity checks. `knip.json` already lists `test/**/*.test.{ts,tsx}` as an entry, so no knip exposure. |
| 1.7 | Widen DONE-CHECK 4 (`bestSpotSolver.test.ts:645-664`) from 5 to **10** probes | same | 0.5 | Cut from the parity track's 25 — see §8. 10 covers ridge / off-ridge / rim / unknown and stays inside the runner's budget. |
| 1.8 | Record goldens; mutation-verify 3× (an f32 term write, a scalar, a flag bit) confirming the **per-field** digest names the right field | | 0.5 | A localiser that does not localise is not worth its 21 lines. |

**Exit gate — exact.**
```
npm test                     → 2,134 + ~14 new, 0 failures
npx astro check              → 0 errors, 0 warnings, 6 hints
npx knip                     → exit 0
npx vitest run test/lib/geo/bestSpotParity.test.ts   → green, goldens recorded, provenance line filled
git log --oneline -1         → the parity commit; its parent is the slice-0+1 landing
grep -rn canopyUncredited src/ | wc -l  → ≥ 8   (was 5)
```
**Artifacts.** `test/lib/geo/bestSpotParity.test.ts` + `test/lib/geo/fixtures/`; `DECISIONS.md` 2026-08-26h; the corrected `SWEEP_MODE_MAP.md:236` (C-1) and `:289` (the CUT list still says defer the canopy withdrawal that shipped).

---

### SESSION 2 — THE PLATEAU PROBE, THEN SLICE 3a (7.5 h)

**Goal.** Learn whether sweep can actually move the owner's cell *before* building it; then land the pure refactor with an exact identity proof.

**Entry gate.** Session 1's exit + the goldens committed. **This session's item 2.1 is a GO/NO-GO on the ship order.**

| # | Work | Files | h | Why |
|---|---|---|---|---|
| 2.1 | **THE PLATEAU PROBE.** Zero production code. `topAltDeg` is an existing `EventTrackOptions` field (`bestSpotTrack.ts:442`) and `EventTrack` is a plain object, so `{...track, samples: hi, windowLo, windowHi}` **is** the T=2 shape by hand. Build a synthetic block-city DSM (the ring builder at `bestSpotSolver.test.ts:1743` is the idiom) + re-run on the owner's real geometry via the golden fixtures. Report per cell `l, p, f, fGraze, fGap, score` **per segment**, and the histogram of `max(S_low, S_high)` vs `S_low`. | new `test/lib/geo/bestSpotPlateau.test.ts` (a probe, deleted or kept as a golden afterwards) | 2.0 | 1 h to build, 1 h to read. The single cheapest experiment in the plan. |
| 2.2 | Slice 3a: `segLo`/`segHi` + a one-iteration loop with a running max + per-segment `M_eff` **inside** the argmax + `leadMs` from `track.samples[starIdx].utcMs` (exact, O(1), replacing the O(window) inversion at `bestSpotWorker.ts:913-926`) | `bestSpotSolver.ts` | 2.0 | Much smaller than `SWEEP_MODE_MAP.md §4` implies, because the deviation deletes the term-buffer split. The docstring must carry C-3's justification verbatim. |
| 2.3 | IDEMPOTENCE + ORDER-INDEPENDENCE at T=2, byte-identical; the near-tie fixture pinning the f32 argmax objective | `bestSpotParity.test.ts` | 1.5 | These are the only tests that can kill the missing-reset class, and they must be written **before** the loop, not after. |
| 2.4 | Resolve `FORMAL_VERIFICATION.md §5` **S2** (fused pass ≠ `cellScore` at `azStepDeg: 0.125`) | `bestSpotSolver.ts`, `FORMAL_VERIFICATION.md` | 1.0 | Cheapest now — 3a already has the loop open, and if the ring truly cannot hold `j+2` the fix rides the same diff. Per the file's own rule: a finding that does not reproduce is **deleted, not downgraded**. |
| 2.5 | The **superset pin**: `set(track(top=4).azDeg) ⊆ set(track(top=10).azDeg)` under `snapAzLattice: true`, with the `false` negative control | `test/lib/geo/bestSpotTrack.test.ts` | 0.5 | A property of *today's* code, pinnable before any sweep exists. The whole cost model rests on it (the hull cache key is an exact azimuth match, `bestSpotSolver.ts:1187-1196`). |
| 2.6 | Mutation-verify 3a: revert each sub-change → the hash goes red | | 0.5 | |

**Exit gate — exact.**
```
sha256(scores) == the Session-1 literal              (all 7 fixtures)
21 per-field digests × 7 fixtures                    unchanged
12 exact f64 probe literals                          unchanged
T=2 idempotence / order-independence                 byte-identical
bestSpotSolver.test.ts:1269 → toBeCloseTo(27.09, 2)  still green
bestSpotSolver.test.ts:1273 → < 101 MiB              still green
bestSpotResidency.test.ts six hullBuilds rows + the 3*K negative control  unchanged
the recompose-leaf loop at bestSpotSolver.test.ts:1044-1063 / :1093-1106  still green
npm test / astro check / knip
```
**Artifacts.** The plateau histograms (they are the GO/NO-GO for the C-2 reorder and they are the evidence base for Session 7's §9). S2 CONFIRMED or DELETED in `FORMAL_VERIFICATION.md §5`.

---

### SESSION 3 — SLICE 3b: THE WINDOW, THE TOGGLE, T > 1 (8 h)

**Goal.** The owner's mode exists and is byte-identical when OFF.

**Entry gate.** Session 2's exit; 2.1's histograms read; the ship order confirmed or swapped.

| # | Work | Files | h | Why |
|---|---|---|---|---|
| 3.1 | `window*` options; truncation from the **new** end, direction from `upSign` (`bestSpotTrack.ts:660`), applied **before** the uniform `maxSamples` decimation at `:847-863` | `bestSpotTrack.ts` | 2.0 | Decimating first thins uniformly and destroys the superset property (2.5's pin catches it). |
| 3.2 | Four **required** job fields + the T0.5 key carrying the numbers; `sourcesEpoch` must not move | `bestSpotWorker.ts`, `bestSpotFeed.ts:841` | 1.0 | Required, not optional: the job literal at `test/lib/geo/bestSpotResidency.test.ts:114-155` is positional-free and complete, so a required field turns it red at `astro check`. That is how the wire is stopped from drifting. |
| 3.3 | **The `CLASS_OF` mode decision (C-6).** Either `classOf(path, mode)` or a feed-side `recompose → rescore` coercion when `sweepMode` is on | `bestSpotScoring.ts:487-520`, `bestSpotFeed.ts` | 1.0 | 41 of 53 rows say `recompose` and that path does not exist in sweep mode. Unnamed by every track. |
| 3.4 | **The peak-in-sweep / hash-echo hole.** A pure `withSweep(scoring)` applied at job-post, with the mode folded into the hash input | `bestSpotScoring.ts`, `bestSpotFeed.ts` | 1.0 | `scoringHash` is echoed on the pack and compared against the store's hash before the texture upload; a feed-side profile transform makes every sweep result read as stale and get dropped. No doc closes this. |
| 3.5 | Store `sweepMode` + `DEFAULTS()` + the `setOpen` decision, asserted explicitly either way | `src/store/bestSpot.ts:446,454` | 0.5 | `test/store/bestSpot.test.ts:69` does a **partial** `setState(DEFAULTS())`; a flag with no decision leaks across every test in that file. |
| 3.6 | Panel toggle + one ON-only honesty status line | `BestSpotPanel.tsx:611-635` (verbatim template), `bestspot-panel.css` | 1.0 | A second `<button className="pp-chip" aria-pressed>` in the existing chips row — 0 px cost. ON-only keeps the OFF layout unchanged to the pixel. `data-tone="warn"`, no colour literal (the D14 fence at `test/components/bestSpotPanel.test.ts:751-780`). |
| 3.7 | Refuse SWEEP × ULTRA | `bestSpotFeed.ts:543` shape | 0.25 | |
| 3.8 | Tests: `sweepOn === K′ − K` / `sweepOff === 0` residency row with its negative control; the OFF `t05` pin + positive control; `bestSpotFeed.test.ts` `beforeEach` gains `sweepMode: false` | 4 test files | 1.25 | |

**Exit gate — exact.**
```
ALL 13 PARITY SURFACES, MODE OFF                     unchanged
feed.debug().keys.t05  === `sunset|${localDayWindow(NOON, LON).startMs}`   character for character
                       and the ON positive control moves it
job.scoringHash        === scoringHash(BESTSPOT_SCORING_V1)   for a user who never enabled the mode
keys.sources / sourcesEpoch                          unmoved across both toggles
bestSpotHonesty.test.ts:617-634  14 names, every row  unchanged (bestAtMs optional-and-absent)
npm test / astro check / knip
```
**Artifacts.** The three new browser seams, specified and shipped as part of this slice, **not** as verification work: `__globe.bestSpot().window = {on, topAltDeg, segments, maxSamples, K, samples, t0Ms, loMs, hiMs}`; `__globe.bestSpot().honesty.canopyUncredited` (already wired in 1.2); `__globe.bestSpot().peak = {enabled, cellsWithPeakF}` (stub until Session 5).

---

### SESSION 4 — BROWSER (7.5 h)

**Goal.** `verify-bestspot` back to 101/101 with the mode OFF; a new sweep harness green; the owner's cell measured.

**Entry gate.** Session 3's exit. **Environment, non-negotiable:** `export PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH"` (node 20 has no global `WebSocket`); restart `wix dev` (slice 3b adds imports to the globe bundle → `504 Outdated Optimize Dep` on every module); restart Chrome between scripts (WebGL contexts exhaust after ~5 suites).

| # | Work | h | Why |
|---|---|---|---|
| 4.1 | Re-baseline `verify-bestspot.mjs`, mode OFF; triage against the damage list (§5) | 1.5 | Three runs, not one — `armSession`'s 9 s stream wait plus tile-streaming non-determinism means a moved number must be re-run before it is believed (two base runs 12 min apart measured `floorFrac` 0.699 → 0.469). |
| 4.2 | Re-pin the three MOVES: `:400-403` (`heightProvenance.enriched` in the message), `:531-534` (both `rMean`s), `:1108-1111` (re-read, do not re-pin) | 0.75 | Message-string edits + a house-style justification comment each; needs 4.1's numbers first. |
| 4.3 | **D8 re-derivation.** `scripts/probe-bestspot-d8-pin.mjs` — a greedy 8-neighbour hill-climb (step 60 m, 4 iterations, `setTempPin` + `settleNewSolve` + `quiesce`, never re-`goto`). Objective: **minimise `topK[0].score` subject to** `topK.length ≥ 2`, `store.unmappedFrac < 0.10`, `heightProvenance.enriched + osm > 0`, and `!topK[0].note?.startsWith("TREE LINE")`. One `planVerdictAt` confirmation requiring `skylineAltDeg > 5`. | 2.5 | The `unmappedFrac`/`note` constraints are slice 1's doing: a tree wall no longer produces a low score, it produces UNMAPPED (`bestSpotSolver.ts:1143-1152` → below `minCoverage` → dropped at `bestSpotWorker.ts:834`), so the old objective converges on a **park**, where the D8 hero row would be a statement about nothing. Expect 2-3 passes; the first converging on a canopy disc is the *expected* outcome, not a failure. **Thresholds `≤ displayLo`, `> 5°`, `> 10°` spread, `< 0.5` ratio are NOT touched.** |
| 4.4 | `scripts/verify-bestspot-sweep.mjs`, groups A-F (~40 checks) | 2.0 | Sized against `verify-bestspot-ownerbatch.mjs` (499 lines, 45 checks). Copy **ownerbatch's** `send()` with its 90 s timeout (`:104-113`), **not** `verify-bestspot.mjs:76-81`, which has none. `Page.bringToFront` after `Page.enable` and again before every `FRAME_PROBE`. |
| 4.5 | Bring it up and iterate | 0.75 | A ~40-check CDP script has never gone green first run here. |

**Exit gate — exact.**
```
scripts/verify-bestspot.mjs            101/101   (D8 re-derived, never loosened)
scripts/verify-bestspot-sweep.mjs      all pass; B1 PASS (not INCONCLUSIVE); B5 zero violations
scripts/verify-bestspot-ownerbatch.mjs 45/45     unchanged  ← the second-strongest OFF-parity signal
firstInkMs ≤ 120 · refinedMs ≤ 1200 · drag.median − idle.median < 12 ms · dragFrames.n > 30
window.K, window.samples, hullBuilds reported beside refinedMs so the budget can be re-SIZED, not merely failed
```
**Artifacts.** Shots in `verify-shots/` (never the repo root). The measured `windowMaxSamples`. `scripts/probe-bestspot-d8-pin.mjs` + a fixture comment recording *why* the old pin died (RC16/RC17 moved the geometry after it was recorded), so the next audit does not re-derive it.

---

### SESSION 5 — SLICE 2: F_peak, GATED OFF (8 h)

**Entry gate.** Session 4's exit. **Calibration happens in DEFAULT mode, in this session** — a `peak.*` patch is a ~2.5 ms `recompose` today and a ~177 ms `rescore` once sweep exists (C-6). A 70× slower taste loop for the slice the map itself calls *"most likely to need a second tuning pass"* (`SWEEP_MODE_MAP.md:284`).

| # | Work | h |
|---|---|---|
| 5.1 | Twenty golden rows, **committed RED** (house rule, `test/lib/geo/bestSpotGolden.test.ts:13-15`) | 1.5 |
| 5.2 | `peakAt` + `peakFFromParts` + its own argmax over `notchRays`, inside the `starIdx >= 0` guard. Every comparison **and every sentinel** inverted from `notchAt`; the `Number.isFinite(width)` guard (the one place the naive dual silently inverts — `slender = prom/∞ = 0` scores a **ridge** at full credit); the NaN early return mirroring `notchAt`; **slenderness, not `Q`**, as the discriminator | 2.5 |
| 5.3 | The `peak` scoring group + **its own `clampResolved` loop** + `clampLeaf` cases + `peakConfTreeMax > 0` | 1.5 |
| 5.4 | Solver plumbing; `contactOf` gains `"peak"` — four `Record`s over that union move, and **the fourth is `scripts/verify-bestspot.mjs:947`, which is JavaScript.** Leave a comment there naming it | 1.0 |
| 5.5 | Lean `max3_mem_Icc` + `peakBound` (see §4) | 0.75 |
| 5.6 | Calibration on the owner's disc via `__globe.bestSpotTuning({peak:{enabled:true}})` + `.ab()` | 0.75 |

**Exit gate — exact.**
```
17 golden rows in bestSpotGolden.test.ts        bit-identical
ALL 13 PARITY SURFACES, peak.enabled: false     unchanged
bestSpotMetric.test.ts:623-645  expect(r.f).toBe(Math.max(r.fGraze, r.fGap))  → 3-way (the ONE PIN-2 line that breaks)
EXPECT_INERT_ON_FIXTURE set-equality at bestSpotScoring.test.ts:671           gains no entries
expect(unreachable).toEqual([]) at :670                                       green (requires peakConfTreeMax > 0)
npm run proofs                                  27/27
IF TERM_BYTES_PER_CELL MOVED 75 → 96:
  bestSpotSolver.test.ts:1249  toBe(75)             → re-pinned, mutation-verified
  bestSpotSolver.test.ts:1269  toBeCloseTo(27.09,2) → re-pinned to 34.68, mutation-verified   ← C-4
  bestSpotSolver.test.ts:1273  < 101 MiB            → still green (34.68 MB)
```

---

### SESSION 6 — SLICE 4: QUOTAS + THE PER-ROW TIME (5 h)

**Entry gate.** Session 3 (`bestAtMs` exists only in sweep). Independent of 5; can be swapped with it.

Select-then-emit (pass A greedy-with-caps, pass B unconstrained fill), then **rank by score, never selection order** — the row prints its absolute score beside its rank (`BestSpotPanel.tsx:418-419`) and a list disagreeing with its own numbers reads as a bug (1.5 h). `chosen.length === 0` short-circuits every cap so **rank 1 is never quota-displaced** (0.25 h). `sectorCap = 4`, not 3 — four rows land in the 315-360 sector on the owner's own run and a cap of 3 drops the row 42 m from his hand-pick (0.25 h). Mirror `contactMs` into the store — it reaches the feed but is consumed only by the DEV probe (`bestSpotFeed.ts:919`) (0.5 h). `bestAtMs?` into the mirror signature (`bestSpotFeed.ts:801-816`), which today keys on `score` alone, so a re-solve that moved only the *times* would not re-mirror (0.5 h). Row line 1 **swaps** `+3m20s` for `~19:44`, does not append — `.pp-day__meta` is `overflow:hidden; text-overflow:ellipsis` and has silently dropped a qualifier once already (0.5 h). Quantize the `useTimeStore` selector to the minute or the panel re-renders eight rows per scrub frame (0.25 h). Tests: the nine existing positional `shortlist(...)` call sites become the OFF regression fence, and `test/components/bestSpotPanel.test.ts:234,239` is **index-addressed** into `bestSpotStatusLines` — rewrite as a substring `.find()` **before** touching that array (1.25 h).

**Exit gate.** Parity surfaces 9 + 10 unchanged with the mode OFF (`bestAtMs` optional and absent) · `test/components/globe/bestSpotSheet.test.ts:546-609` unchanged (no third marker channel) · a browser check that `new Set(rows.map(r => Math.round(r.bestAtMs/60000))).size >= 3` — `BESTSPOT_TASTE_V1.md:66-81` measured **six of eight rows at the same minute**, which is the defect this slice exists to close.

---

### SESSION 7 — DOCS, LEAN CLOSE-OUT, §9 (6 h)

**Entry gate.** Session 6 (or 5, whichever lands last). §9 is written **last, after the browser measurement** — a spec section written earlier is another forecast, and this repo has a documented allergy: *every unit gate was green while the field was a constant.*

| # | Work | h |
|---|---|---|
| 7.1 | `BESTSPOT_SPEC_V2.md` §9 SWEEP MODE, with real numbers from Sessions 2.1 and 4 | 2.0 |
| 7.2 | The `RECONCILED 2026-08-26n` block + D1-D13 (see §6) | 1.5 |
| 7.3 | `ARCHITECTURE.md` §7c A1-A6 · `IMPLEMENTATION_PLAN.md` I1 · `globe-tuning.md` G1-G5 · `tuning.ts` U1/U2 · `.claude/CLAUDE.md` C1 | 1.5 |
| 7.4 | `FORMAL_VERIFICATION.md` §0/§1/§5; `npm run proofs` final count; the hypothesis-audit rows | 0.5 |
| 7.5 | `DECISIONS.md` + `NEXT_SESSION_PROMPT.md` + Serena memories | 0.5 |

**Exit gate.** Every prose number in §9 traceable to a run · `npm run proofs` at its new count · all three gates green · `.claude/.ship-title` written.

---

