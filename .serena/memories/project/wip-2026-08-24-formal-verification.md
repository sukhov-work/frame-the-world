# WIP 2026-08-24d — DOCS RECONCILED + a MACHINE-CHECKED MATH FLOOR (Lean 4 + Mathlib)

Owner order: orient from `NEXT_SESSION_PROMPT.md`; make `BESTSPOT_PLAN.md` + architecture +
memories + docs fully consistent after the heatmap ship; then evaluate **Lean** (already installed
locally), **Wolfram**, and anything else for making the prediction/graphics math robust and
verifiable. Twin: DECISIONS §Recent **2026-08-24d**.
Predecessors: [[project/wip-2026-08-24-bestspot-s3-s7]] · [[project/wip-2026-08-23-bestspot-heatmap]].

## GATES
**vitest 1,905/1,905 (130 files, +3)** · `astro check` 0 err / 0 warn / 5 hints · `npx knip` exit-0 ·
**NEW `npm run proofs` → 25 theorems / 0 `sorry` / axiom-audited → 25 PASS / 0 FAIL.**
Tier: **LOCAL.** No browser work — nothing rendered changed. Wix cloud still UNVERIFIED (T50).

## THE HEADLINE — the proof was not the point, the HYPOTHESES were
Writing the composition down as a Lean theorem found **two reachable defects** that 1,902 tests,
`astro check`, `knip` and a 100-check browser harness all passed. To state *"S ∈ [0,1] and S is
monotone in each preference term"* you must write down `0 ≤ w` and `conf ≤ 1` — and neither was
enforced. **Verified executably, not by inspection:**
- `sanitizeScoringPatch({graze:{conf:{terrain:5}}})` resolved **verbatim** → `CellScore.f = 1.6`
  against its own documented `0..1`. `clampResolved` bounded `conf.tree` and **nothing else**.
- `sanitizeScoringPatch({weights:{f:-1}})` resolved to a weight sum of **−0.30000000000000004** →
  the score is **non-monotone in its own term**: a cell with a better silhouette ranks LOWER.
  (Boundedness survives via the `Σw` normalisation, and only boundedness was ever tested.)

Both reachable from a persisted `ftw:view-prefs:v1` blob — exactly what `clampResolved`'s docstring
promises cannot happen. Every test passed a SANE profile, so the clamps' absence was invisible.
**Fixed:** `BESTSPOT_SAFETY.confMax 1` + `.weightMin 0`, applied in BOTH `clampResolved` and the
`clampLeaf` single-leaf path (the one `__globe.bestSpotTuning` reaches), pinned by two regression
tests that cite the theorem. **Zero movement in any shipped number**; every preset re-verified.

> **A test samples; a specification quantifies.** Same shape as this feature's other lesson
> (*"every unit gate was green while the field was a constant"*).

## `formal/` — Lean 4.33.1 + Mathlib `v4.33.1`
`lake exe cache get` → 8,690 prebuilt `.olean`, **7.4 GB, gitignored** (`/.lake/` at the REPO ROOT);
~5 min cold, **3.4 s warm**. `elan` is at `~/.elan/bin`, **NOT on the non-login PATH** — export it.

### THE LAYOUT IS UNUSUAL AND DELIBERATE — the Lake WORKSPACE ROOT is the REPO ROOT
`lakefile.toml` + `lean-toolchain` + `lake-manifest.json` live at the repo root with
`srcDir = "formal"`; `formal/` holds **sources only**. Mechanics + the IDE acceptance test:
**`formal/README.md`**.

**Why:** the owner's IntelliJ **lean4ij** plugin failed with *"Unable to locate lean toolchain …
Expected toolchain location: `<repoRoot>/lean-toolchain`"*. From the installed 0.2.8 bytecode: it
computes `Path.of(project.getBasePath(), "lean-toolchain")` with **no walk**, has **no**
project-root/toolchain setting (all 34 `Lean4Settings` fields are cosmetic), then runs
`lake serve -- <basePath>` with `cwd = basePath`.

**Two things that look like fixes and are NOT:**
- **A symlinked root `lean-toolchain` is a TRAP.** The existence check follows symlinks, so the
  balloon disappears — then Lake finds no config, falls back to plain `lean --server` with
  `LAKE_INVALID_CONFIG`, and every `import Mathlib.…` goes unresolved. Syntax colouring over a
  Mathlib-blind editor is **strictly worse than the honest error**.
- **`buildDir`/`packagesDir` pointing back into `formal/`** — tried, MEASURED WRONG. Lake honours
  `packagesDir` for `LEAN_PATH` but materializes dependencies at the hardcoded
  `<workspaceDir>/.lake/packages` regardless, leaving a **second real 601 MB git clone of Mathlib**.
  One location — the default `/.lake/` — is the only self-consistent layout, and the only one that
  bootstraps correctly on a fresh clone.

**`/.lake/` was gitignored BEFORE the first root-level `lake` command ran** — `session-end-ship.sh`
does `git add -A` and one build materializes gigabytes in seconds.

**Verified with the three calls the LSP actually makes:** `lake build --no-build` → *All targets
up-to-date (2011 jobs)* · `lake setup-file formal/Ftw/Hull.lean` → `Ftw.Hull` / package `ftw` /
**1992 importArts** · `printf '' | lake serve -- $PWD` → only *Cannot read LSP request: Stream was
closed*, i.e. **no** config-fallback.

**Accepted cost:** `cd formal && lake build` does not work (Lake does not search parent
directories) — build from the repo root. Reversible by moving three text files back.
**Zero-config alternatives** if lean4ij misbehaves: VS Code / Cursor with `leanprover.lean4` (it
walks UP from the opened file), or open `formal/` as its own project.

### Working without an IDE (verified)
`lake env lean F.lean` type-checks one file; inside it `trace_state` prints hypotheses + goal, an
unfinished `by skip` reports `unsolved goals` **and prints the goal**, `exact?` searches Mathlib and
prints `Try this: exact …`, `#check @Ftw.thm` prints a full statement.

- **`Ftw/Hull.lean` — the architectural keystone.** `hull_fold` (F4's curvature fold: the identity
  that leaves the eye `L` in exactly ONE scalar `q_c`, which is *why* a lift change is a re-query) ·
  **`below_chord_never_sets`** (a sample on/below the chord joining two others is never the
  maximiser **at any eye height whatsoever** ⇒ the setter is always a hull vertex ⇒ the hull is
  eye-independent — the theorem behind `hullBuilds === 0`) · `setter_moves_outward` (licenses the
  `break` at `horizonSweep.ts:580` + the binary peak search `:849`) · `slope_le_iff_cross`.
- **`Ftw/Score.lean`** — `clamp01` · the preference blend (bounded, monotone, **invariant under a
  uniform rescale of the weight vector** — the algebraic content of a test that pins ONE scale
  factor) · R7 `M_eff` (exactly 1 for sun kinds **for every floor**) · GRAZE `1−exp(−τ/s)` (in
  `[0,1)`, strictly monotone, 0 at 0 — the property `F_sil` lacked) · `cut` · the two
  **counterexample theorems** that are the defects above, stated as mathematics.

**THE FRAMING WAS THE ENTIRE COST DIFFERENCE.** Formalizing the IMPLEMENTATION — define a
computable `upperHull`, prove the monotone chain correct — is **1–3 person-WEEKS**, because Mathlib
has no computational upper hull at all (its `convexHull` is the abstract closure operator on a set
in a module). Formalizing the CLAIM the code depends on took **under an hour**.
**When a formalization looks like weeks, you are usually formalizing the implementation, not the claim.**

## The gate — and why the BUILD is not it
`scripts/verify-proofs.mjs` (`npm run proofs`). A proof stubbed with `sorry` **still builds**. So:
source-level ban on `sorry`/`admit`/`native_decide` (comment-stripped first, or prose false-positives)
→ build → **axiom audit** of every `theorem` against `[propext, Classical.choice, Quot.sound]`.
**Falsified by mutation:** one injected `sorry` ⇒ `lake build` **PASS**, audit **FAIL**.
NOT wired into `npm test` — vitest stays 22 s and must not require 7.4 GB of Mathlib.

## The new script tripped a REAL fence, and the fence was right
`test/verifyHarness.test.ts` (audit-3 C11) requires every `scripts/verify-*.mjs` to import the CDP
cleanup helper and avoid bare `process.exit`. `verify-proofs.mjs` drives no browser ⇒ outside C11's
scope. **The repair was not to loosen the rule but to make the exclusion PROVABLE**: `NON_CDP` is
now guarded by a test asserting each member is CDP-free, with a positive control.
**The obvious marker `/json/new` DOES NOT WORK** — both pre-existing exemptions NAME that endpoint
without calling it (`verify-chrome.mjs:132` prints the curl recipe as help text; the cleanup helper
quotes it in its docblock and only calls `/json/close`). The separating marker is whether the script
SPEAKS the protocol: measured `verify-bestspot` 7 · cleanup 7 · `verify-chrome` 1 · `verify-proofs`
**0**. Falsified by smuggling a real CDP script into the list.

## DOCS reconciled
- **`BESTSPOT_PLAN.md`** — its record stopped **dead at S1/S2**. Gained an `AS BUILT — S3a→S7`
  appendix + in-place corrections to every NORMATIVE claim a reader hits before it: `F_sil` (never
  shipped — `silTangency` has **zero call sites**) superseded by GRAZE · the composition corrected
  to the weight-NORMALISED registry form with `M_eff` · `renderOrder 9 → 4` · the phantom
  `BESTSPOT.fillAlphaMax` (zero hits in `src/`) → the veil/ink split · the score-texture
  parenthetical that said *"compute it, do not assume"* while asserting 201² > 335² **backwards**
  (shipped is **601²**) · three residency tiers marked superseded by six · `worthFloor →
  worth.effectiveFloor` · open items 1/2/3/6/7/8 CLOSED in place with anchors (4 and 5 stay open).
- **`BESTSPOT_SPEC_V2.md`** — 22 corrections / 27 edits. Headline: **the term buffer is 75 B/cell,
  not 59** — the 59 B layout stored the notch as a finished product, which would have FROZEN five
  `gap.*` leaves that `CLASS_OF` files as `recompose`, so *implementing the spec would have made the
  shipped invalidation table a lie*. Also COMPOSE 0.272 → ~2.5 ms (conclusion survives: still >200×
  cheaper than the cheapest re-solve) · 54 leaves · the browser ladder beside the forecast · THREE
  refusals · FOUR streaming epochs · the built-density prior as an evidence gate · the regenerated
  **60**-key tuning inventory · the shipped Turbo hexes (all 8 interior stops had been reproduced
  from memory and all 8 were wrong) · §8's "open questions" → ANSWERED with rulings.
- **`ARCHITECTURE.md`** §7c + five §7 repairs (the `14 stores` claim was factually wrong) ·
  **`contracts.md`** 20 → **21** seams + four sub-seams · **`globe-tuning.md`** a §BESTSPOT family
  (it named ZERO of the 54-leaf profile or the 60-key block — a **repeat of audit-3 D5's exact
  finding**) + four traps · **README** 1,373/113 → 1,905/130 · **`mem:core`** §Next step rewritten
  (**it still said "NEXT: S3" and "LOCAL ONLY — nothing has been in a browser yet"** about a shipped,
  browser-verified feature — the highest-severity stale line in the graph root) + six era rows.
- **NEW `.claude/claude-docs/FORMAL_VERIFICATION.md`** — the canonical answer to the owner's
  question. Read it before touching `formal/`.

## Wolfram — evaluated, NOT adopted (not installed on this box)
Free **Wolfram Engine for Developers** is alive in 2026 and a `.wls` → JSON → vitest **fixture** loop
is squarely inside its licence (the app never calls Wolfram; only fixtures it produced). Keep it
local + human-invoked — activation is per-machine, so it must never become a CI dependency.
`brew install --cask wolfram-engine`. **An official MCP server exists**: `WolframResearch/AgentTools`
(MIT). Beats Lean at `Interval[]` outward rounding, `FindInstance`, `NMinimize`; loses because there
is no re-verifiable certificate, and `Reduce`'s completeness **does not extend to transcendentals**.

## NEXT — the ladder (backlog T53), in order
1. **`fast-check`** (30 min; `@fast-check/vitest@0.4.1` peer-deps `vitest ^4.1.0`, repo is `^4.1.9` —
   exact match) → then **the fused-pass metamorphic relation**, which reproduces or kills **T52/S2**.
2. **T52/S9 and S1** — a pin that cannot fail, and a hull cache key that works only by the
   coincidence that `azStepDeg 0.25` is dyadic.
3. **JPL Horizons fixtures.** Already run live: sun over Dnipro agrees to **0.5″** in azimuth;
   altitude looked 1.5′ off until `APPARENT='REFRACTED'` — **the trap is the ORACLE'S DEFAULT**, and
   with it both coordinates are sub-arcsecond.
4. `robust-predicates` on the monotone stack (**the port uses a DOWNWARD y-axis**) ·
   `glslangValidator` as a lint gate (`sky.ts` 619 lines is untested as a program).
5. **Stryker SCOPED** to `bestSpotMetric` + `horizonSweep` — **pin `9.6.1`, Node here is v20.19.2 and
   v10 needs ≥22**. Its job is finding out whether the golden tables DISCRIMINATE.
**Say no to** interval arithmetic in JS (no `fesetround`; WASM has no rounding-mode instruction) and
to Gappa/Why3/Frama-C/Flocq/Daisy (all need the kernel rewritten in another language).
**Do not touch `test/lib/geo/_perf.ts`** — it is better than the published guidance.

## Traps
- `elan` is not on the non-login PATH: `export PATH="$HOME/.elan/bin:$PATH"`.
- **`lake build` must run from the REPO ROOT**, never `formal/` — see the layout section above.
- Mathlib's lakefile pin is `rev = "v4.33.1"`, **not** `version =` (that parses as a semver range and errors).
- A multi-line `by nlinarith [...]` inside parentheses breaks Lean's bracket parse — hoist it to a `have`.
- **DECISIONS §Recent is 146.7 KB against its own ~140 KB trigger — compaction round 5 is DUE** (T40).

Related: [[project/wip-2026-08-24-bestspot-s3-s7]] · [[decisions/session_workflow]] ·
[[patterns/globe-rendering]] · [[project/dev_environment]]
