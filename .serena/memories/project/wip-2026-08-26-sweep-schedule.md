# WIP 2026-08-26h — THE SCHEDULE for sweep mode + parity refactor + browser + Lean + docs

Owner order: *"good schedule all remaining work, sweep mode and careful and full parity to default
mode refactor of solver core + verification in browser and formal verification and design docs
updates for next session."* Twin: DECISIONS §Recent **2026-08-26h**. Predecessor:
[[project/wip-2026-08-26-sweep-mode]] (slices 0-1 as built).

## THE ARTIFACTS — read in this order
1. `.claude/claude-docs/bestspot/SWEEP_MODE_SCHEDULE.md` — **7 sessions, ≈ 48.5 h**, each with
   Goal · Entry gate · Work items (files + hours) · Exit gate (exact commands + numbers) · Artifacts.
   **Its ORCHESTRATOR'S CORRECTIONS block overrides the body** — six MEASURED facts.
2. `.claude/claude-docs/bestspot/SWEEP_MODE_MAP.md` — the spec the schedule executes.
3. `.claude/claude-docs/bestspot/BESTSPOT_TASTE_V1.md` — why any of it exists.

## GATES
**vitest 2,134/2,134 (141 files)** · `astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.

## FIXED THIS SESSION — a real defect in the SAME DAY's slice 1
**`canopyUncredited` never left the solver** (5 refs, all in `bestSpotSolver.ts`, vs
`openSkyUncredited`'s 15 across solver+worker+feed+types). Slice 1's biggest behavioural change was
**unobservable in the browser** and its 2,025 newly-UNMAPPED cells unattributable. Now wired
solver → worker rung → feed honesty → DEV seam. **Schedule item 1.2 is DONE — drop it.**

## FOUR MEASURED FACTS THE READ-ONLY SCOPING COULD NOT HAVE
1. **`verify-bestspot.mjs` is 96/101 — measured, 4 runs, after slice 1. Slice 1 broke NOTHING.**
   The map's blast radius over-estimated; none of its three "MOVES" moved.
2. **THE D8 BLOCK IS RUN-TO-RUN VARIABLE, not merely stale** — hero rank-1 `S` **0.3161 → 0.3338**,
   failures **3 → 5**, across four consecutive runs (the disc solves from what has STREAMED).
   **A hill-climb on a noisy objective converges on noise** ⇒ Session 4.3 must quiesce on streaming
   and re-measure every candidate ≥2×. Very likely how the pin went stale originally. 2.5 h is
   optimistic.
3. **R-4 largely de-risked**: with ~9,570 canopy stamps in the critical path, `firstInkMs` **43.1 ms**
   (gate ≤120) and `refinedMs` **493.1 ms** (gate ≤1200). Rungs 6.7/23.3/89.2/352.4. **Do not
   pre-emptively memoise `collectCanopyInstances`.**
4. Dnipro `coverage` **1.000 → 0.929** — the withdrawal visible in the shipped harness.
**Correction the other way:** the schedule's §0 reads a dirty working tree as "not merged, the brief
is false". Wrong — this repo AUTO-SHIPS on SessionEnd. Its instruction (record goldens on the commit
whose parent is the landing) still stands; R-2 is real.

## THE THREE THINGS THAT DECIDE SUCCESS
1. **THE PARITY CONTRACT** (schedule §2): 13 surfaces, **EXACT everywhere — `toBeCloseTo` on none**,
   7 fixtures each with a non-vacuity assertion, incl. a **moonrise** one (the ASCENDING arm flips
   `accFLow`/`accFPrev`/`lowIdx` and nothing else exercises it). **The map's proposed host was WRONG:**
   `bestSpotComposition.test.ts` never imports `bestSpotSolver` — it tests `cellScore`, the reference
   the refactor may not touch. Host is `bestSpotSolver.test.ts:594-602`.
   **The two most valuable assertions cannot exist at T = 1** — every accumulator in `solveTerms` is
   allocated fresh per call, so a missing reset between instants is STRUCTURALLY INVISIBLE:
   **IDEMPOTENCE** (T=2 same instant twice ≡ T=1) and **ORDER INDEPENDENCE**. Write them BEFORE the
   loop. Argmax precision ruled up front: **the objective is the f32-round-tripped score.**
2. **R-1, THE RANK CEILING — the riskiest item, and it is not the refactor.** The owner shot at moon
   alt **+5.90° > `lCeilDeg` 5**, so **`L = 0` exactly** at his own instant (weight 0.30). Ceiling
   `0.15·V + 0.25·P + 0.30·F`; **if `F = 0` at his skyline he caps ≈0.40 = today's field best and
   STILL does not rank.** De-risk = **Session 2.1, 2 h, node, zero production code** (`topAltDeg` is
   already an `EventTrackOptions` field; `{...track, samples, windowLo, windowHi}` IS the T=2 shape).
   Node not browser: the claim is STRUCTURAL and node reads `fGraze`/`fGap` SEPARATELY, which
   `bestSpotField()` cannot (a byte clamped to `[displayLo, displayHi]`). Free arm: his rank at
   `lCeilDeg ∈ {5,8,12}`.
3. **WHY A WIDER TRACK IS NOT ENOUGH (the deviation's code-level justification, previously unstated):**
   `alt*` is **ALREADY** a per-cell argmin (`bestSpotSolver.ts:1226-1237`) but `V` and the four τ
   buckets accumulate over the whole `inWindow` span ⇒ **raising `topAltDeg` alone gives every cell a
   star AND averages V and dwell over 45 min — literally the average the owner forbade. The segment
   must move `winLo`/`winHi`.** Put it in slice 3a's docstring verbatim.
   Also: **`TRACK_TOP_ALT_DEG = 4` vs `lCeilDeg = 5` ⇒ no sample today can exceed the L ceiling** —
   the dead-`L` regime is CREATED by sweep mode.

## THE LEAN ANSWER: "almost nothing new, and that is correct" (~2.75 h)
FORMALIZE: `score_mem_Icc` (the 5-factor product the file's header writes out and never states —
`Mathlib…Pow.Real` is already imported and UNUSED) · `max3_mem_Icc` (4 lines) · `peakBound` (AFTER
the kernel exists) · `conf_nonneg_is_necessary` (3 lines) · the segment max as a **2-line corollary**
(do NOT build segment machinery).
**TEST-INSTEAD, explicitly:** the T=1 parity claim (`Finset.sup'_singleton`; the risk is allocation /
indexing / ULP, which the SHA-256 covers — **the ceremony to refuse**) and "the argmax reads only
rescore-or-heavier leaves" (needs a deep embedding = the `upperHull` mistake, 1-3 person-weeks; use a
1 h mechanical perturbation loop).
**THE HYPOTHESIS AUDIT FOUND THREE UNENFORCED BOUNDS — the real deliverable:**
 · **`0 ≤ conf` NOT enforced** (`clampResolved` is `Math.min` only) ⇒ `graze.conf.terrain: -1`
   persists and **INVERTS MONOTONICITY**; `f = max(...)` keeps boundedness, which is the exact shape
   that hid the weights defect for months.
 · **`0 ≤ accessSoftExponent` NOT enforced** (`clampLeaf` `default: return value` is FAIL-OPEN) ⇒ a
   negative exponent makes landcover a REWARD (`wetland` > `path`), hidden by the outer `clamp01`.
 · **`scaleRadii > 0` guard points the WRONG WAY** (`if (!(scaleRadii > 0)) return 1`) — re-creates
   the defect GRAZE replaced, in a function with **zero direct unit tests**, while the other
   e-folding scale one file away IS floored.
**Two Lean-gate traps newly recorded:** the audit regex `^theorem\s+` is anchored at column 0 so a
`lemma` / `private theorem` / indented decl is INVISIBLE and the `audited !== theorems.length` guard
cannot fire (**rule: `theorem`, never `lemma`, never indented**); and `npm run proofs -- --list`
exits BEFORE the audit, so a green `--list` is not a green gate.

## CUTS (argued, do not re-litigate)
Two-build browser `rg8` compare · DONE-CHECK-4 25→10 probes · a dedicated F_peak browser leg · the
pre-emptive canopy memo (now measured unnecessary) · a separate docs session.
DEFERRED with reasons: the OSM landmark layer · re-opening `P` (moves DEFAULT mode) · the flat-field
display pass (sweep changes the distribution it exists to fix). `peak.conf.terrain` is deliberately
NOT decided in a doc.

Related: [[project/wip-2026-08-26-sweep-mode]] · [[project/wip-2026-08-26-bestspot-taste]] ·
[[project/wip-2026-08-24-formal-verification]] · [[decisions/session_workflow]]
