# WIP 2026-08-24d — DOCS RECONCILED + a MACHINE-CHECKED MATH FLOOR (Lean 4 + Mathlib) (compacted 2026-09-06 from 13,277 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

Owner order: reconcile the BEST SPOT docs after the heatmap ship, then evaluate Lean, Wolfram and
anything else for making the prediction and graphics math verifiable.
Predecessors: `mem:project/wip-2026-08-24-bestspot-s3-s7` · `mem:project/wip-2026-08-23-bestspot-heatmap`.

## GATES
**vitest 1,905/1,905 (130 files)** · `astro check` 0 err / 5 hints · `npx knip` exit-0 · NEW
`npm run proofs` → **25 theorems / 0 `sorry` / axiom-audited → 25 PASS**. Tier LOCAL (nothing
rendered changed); Wix cloud still UNVERIFIED (T50).

## THE HEADLINE — the proof was not the point, the HYPOTHESES were
Writing the composition down as a Lean theorem found **two reachable defects** that 1,902 tests,
`astro check`, `knip` and a 100-check browser harness all passed. To state *"S ∈ [0,1] and S is
monotone in each preference term"* you must write down `0 ≤ w` and `conf ≤ 1`, and neither was
enforced. Verified executably:
- `sanitizeScoringPatch({graze:{conf:{terrain:5}}})` resolved verbatim → `CellScore.f = 1.6` against
  its own documented `0..1`. `clampResolved` bounded `conf.tree` and **nothing else**.
- `sanitizeScoringPatch({weights:{f:-1}})` resolved to a weight sum of −0.3, making the score
  **non-monotone in its own term**: a cell with a better silhouette ranks LOWER. Boundedness
  survives via the `Σw` normalisation, and only boundedness was ever tested.

Both are reachable from a persisted `ftw:view-prefs:v1` blob — exactly what `clampResolved`'s
docstring promises cannot happen. Every test passed a SANE profile, so the missing clamps were
invisible. **Fixed:** `BESTSPOT_SAFETY.confMax 1` + `.weightMin 0` in BOTH `clampResolved` and the
`clampLeaf` single-leaf path, pinned by two regression tests that cite the theorem. Zero movement in
any shipped number.

> **A test samples; a specification quantifies.** Same shape as this feature's other lesson
> (*"every unit gate was green while the field was a constant"*).

## `formal/` — Lean 4.33.1 + Mathlib `v4.33.1`
`lake exe cache get` → 8,690 prebuilt `.olean`, **7.4 GB, gitignored** (`/.lake/` at the REPO ROOT);
~5 min cold, 3.4 s warm. `elan` is at `~/.elan/bin`, NOT on the non-login PATH.

### THE LAYOUT IS UNUSUAL AND DELIBERATE — the Lake WORKSPACE ROOT is the REPO ROOT
`lakefile.toml` + `lean-toolchain` + `lake-manifest.json` live at the repo root with
`srcDir = "formal"`; `formal/` holds sources only. Mechanics: **`formal/README.md`**.

**Why:** the owner's IntelliJ **lean4ij** plugin computes `Path.of(project.getBasePath(),
"lean-toolchain")` with **no walk** and has no project-root setting, so the toolchain files must sit
at the repo root.

**Two things that look like fixes and are NOT:**
- **A symlinked root `lean-toolchain` is a TRAP.** The existence check follows symlinks, so the
  error balloon disappears — then Lake finds no config, falls back to plain `lean --server`, and
  every `import Mathlib.…` goes unresolved. Syntax colouring over a Mathlib-blind editor is strictly
  worse than the honest error.
- **`buildDir`/`packagesDir` pointing back into `formal/`** — tried, MEASURED WRONG. Lake honours
  `packagesDir` for `LEAN_PATH` but materializes dependencies at `<workspaceDir>/.lake/packages`
  regardless, leaving a second real 601 MB clone of Mathlib.

**`/.lake/` was gitignored BEFORE the first root-level `lake` command ran** — `session-end-ship.sh`
does `git add -A`, and one build materializes gigabytes in seconds.
**Accepted cost:** `cd formal && lake build` does not work (Lake does not search parent
directories) — build from the repo root. Zero-config alternatives if lean4ij misbehaves: VS Code or
Cursor with `leanprover.lean4` (it walks UP from the opened file), or open `formal/` as its own
project.

### Working without an IDE (verified)
`lake env lean F.lean` type-checks one file; `trace_state` prints hypotheses and goal, `by skip`
reports `unsolved goals`, `exact?` searches Mathlib.

- **`Ftw/Hull.lean` — the architectural keystone.** `hull_fold` (F4's curvature fold — the identity
  that leaves the eye `L` in exactly ONE scalar `q_c`, which is *why* a lift change is a re-query) ·
  **`below_chord_never_sets`** (a sample on or below the chord joining two others is never the
  maximiser **at any eye height whatsoever**, so the setter is always a hull vertex and the hull is
  eye-independent — the theorem behind `hullBuilds === 0`) · `setter_moves_outward` (licenses the
  `break` in `horizonSweep.ts` and the binary peak search) · `slope_le_iff_cross`.
- **`Ftw/Score.lean`** — `clamp01` · the preference blend (bounded, monotone, and **invariant under a
  uniform rescale of the weight vector**) · R7 `M_eff` (exactly 1 for sun kinds at every floor) ·
  GRAZE `1−exp(−τ/s)` (in `[0,1)`, strictly monotone, 0 at 0 — the property `F_sil` lacked) · plus
  the two **counterexample theorems** that are the defects above, stated as mathematics.

**THE FRAMING WAS THE ENTIRE COST DIFFERENCE.** Formalizing the IMPLEMENTATION — a computable
`upperHull` with the monotone chain proved correct — is 1–3 person-WEEKS, because Mathlib has no
computational upper hull at all. Formalizing the CLAIM the code depends on took under an hour.
**When a formalization looks like weeks, you are usually formalizing the implementation, not the claim.**

## The gate — and why the BUILD is not it
`scripts/verify-proofs.mjs` (`npm run proofs`). **A proof stubbed with `sorry` still builds.** So the
gate is: a source-level ban on `sorry`/`admit`/`native_decide` (comment-stripped first, or prose
false-positives) → build → an **axiom audit** of every `theorem` against
`[propext, Classical.choice, Quot.sound]`. **Falsified by mutation:** one injected `sorry` makes
`lake build` PASS and the audit FAIL. NOT wired into `npm test` — vitest stays 22 s and must not
require 7.4 GB of Mathlib.

## The new script tripped a REAL fence, and the fence was right
`test/verifyHarness.test.ts` (audit-3 C11) requires every `scripts/verify-*.mjs` to import the CDP
cleanup helper. `verify-proofs.mjs` drives no browser, so it sits outside C11's scope. **The repair
was not to loosen the rule but to make the exclusion PROVABLE**: `NON_CDP` is now guarded by a test
asserting each member is CDP-free, with a positive control. **The obvious marker `/json/new` DOES
NOT WORK** — both pre-existing exemptions NAME that endpoint without calling it. The separating
marker is whether the script SPEAKS the protocol.

## DOCS reconciled — the findings worth keeping
- **`BESTSPOT_PLAN.md`** stopped dead at S1/S2. It gained an `AS BUILT — S3a→S7` appendix plus
  in-place corrections to every NORMATIVE claim before it: `F_sil` was never shipped (`silTangency`
  has ZERO call sites) and is superseded by GRAZE; the composition is the weight-NORMALISED registry
  form with `M_eff`; `BESTSPOT.fillAlphaMax` was a phantom; the score texture is 601².
- **`BESTSPOT_SPEC_V2.md`** took 22 corrections. Headline: **the term buffer is 75 B/cell, not 59** —
  the 59 B layout stored the notch as a finished product, which would have FROZEN five `gap.*` leaves
  that `CLASS_OF` files as `recompose`, so *implementing the spec would have made the shipped
  invalidation table a lie*. Also: all 8 interior Turbo hexes had been reproduced from memory, and
  all 8 were wrong.
- `ARCHITECTURE.md` §7c + five §7 repairs · `contracts.md` 20 → 21 seams · `globe-tuning.md` gained a
  §BESTSPOT family (it had named ZERO of the 54-leaf profile — a repeat of audit-3 D5's finding).
- **NEW `.claude/claude-docs/FORMAL_VERIFICATION.md`** — read it before touching `formal/`.

## Wolfram — evaluated, NOT adopted (not installed on this box)
The free Wolfram Engine for Developers is alive in 2026, and a `.wls` → JSON → vitest **fixture**
loop is squarely inside its licence (the app never calls Wolfram, only uses fixtures it produced).
Keep it local and human-invoked — activation is per-machine, so it must never become a CI dependency.
An official MCP server exists (`WolframResearch/AgentTools`, MIT). It beats Lean at `Interval[]`
outward rounding, `FindInstance` and `NMinimize`; it loses because there is no re-verifiable
certificate, and `Reduce`'s completeness does not extend to transcendentals.

## NEXT — the ladder (backlog T53), in order
1. **`fast-check`** (`@fast-check/vitest@0.4.1` peer-deps `vitest ^4.1.0`, an exact match here) →
   then the fused-pass metamorphic relation, which reproduces or kills T52/S2.
2. **T52/S9 and S1** — a pin that cannot fail, and a hull cache key that works only by the
   coincidence that `azStepDeg 0.25` is dyadic.
3. **JPL Horizons fixtures.** Already run live: the sun over Dnipro agrees to 0.5″ in azimuth, and
   altitude looked 1.5′ off until `APPARENT='REFRACTED'` — **the trap is the ORACLE'S DEFAULT**.
4. `robust-predicates` on the monotone stack (**the port uses a DOWNWARD y-axis**) ·
   `glslangValidator` as a lint gate.
5. **Stryker SCOPED** to `bestSpotMetric` + `horizonSweep` — pin `9.6.1` (v10 needs Node ≥22). Its
   job is finding out whether the golden tables DISCRIMINATE.
**Say no to** interval arithmetic in JS (no `fesetround`, and WASM has no rounding-mode instruction)
and to Gappa/Why3/Frama-C/Flocq/Daisy (all need the kernel rewritten in another language).
**Do not touch `test/lib/geo/_perf.ts`** — it is better than the published guidance.

## Traps
- `elan` is not on the non-login PATH: `export PATH="$HOME/.elan/bin:$PATH"`.
- **`lake build` must run from the REPO ROOT**, never `formal/`.
- Mathlib's lakefile pin is `rev = "v4.33.1"`, **not** `version =` (a semver range, which errors).
- A multi-line `by nlinarith [...]` inside parentheses breaks Lean's bracket parse — hoist it to a `have`.
- DECISIONS §Recent crossed its ~140 KB trigger here; **compaction round 5 ran on 2026-09-06** (T40).

Related: `mem:project/wip-2026-08-24-bestspot-s3-s7` · `mem:decisions/session_workflow` ·
`mem:patterns/globe-rendering` · `mem:project/dev_environment`
