# FORMAL VERIFICATION — what is machine-checked here, what is not, and what to reach for next

**Authored 2026-08-24d.** Owner question: *"could we leverage tools like Lean … maybe via local CLI
so we could run prove verify and formalize snippets … Other option could be Wolfram Mathematica …
Also any other ideas how to make complex future graphics and performance optimizations as well as
our custom and complex prediction and calculation algorithms more robust and verifiable?"*

Answer, in one line: **yes for Lean, and it paid for itself on day one by finding two real defects
in shipped code** — but not in the way the question implies, and the cheaper items further down
this page are worth more per hour.

---

## 0. The headline

Writing the BEST SPOT composition down as a Lean theorem **found two reachable defects that 1,902
tests, `astro check`, `knip` and a 100-check browser harness all missed.** Not because the proof
was clever, but because a theorem is not allowed to have unstated hypotheses. To prove

> `S ∈ [0,1]` and `S` is monotone in each preference term

you must write down `0 ≤ w` and `conf ≤ 1`. At which point the obvious question is *"is that
actually enforced?"* — and it was not:

| Defect | What was reachable | Why no test caught it |
|---|---|---|
| **`graze.conf.*` had no ceiling** | `sanitizeScoringPatch({graze:{conf:{terrain:5}}})` resolved verbatim, publishing `CellScore.f = 1.6` against its own documented range `0..1` | `clampResolved` bounded `conf.tree` and nothing else. Every test passed a *sane* profile, so the clamp's absence was invisible |
| **`weights.*` had no floor at 0** | `sanitizeScoringPatch({weights:{f:-1}})` resolved to a weight sum of **−0.30000000000000004**, making the score **non-monotone in its own term** — a better silhouette ranks *lower* | The composition normalises by `Σw`, which keeps `S ≤ 1`. Boundedness survives; monotonicity does not, and only boundedness was tested |

Both are reachable from a persisted `ftw:view-prefs:v1` blob, which is exactly what
`clampResolved`'s own docstring promises cannot happen: *"can be handed a raw, unsanitized patch and
still cannot return an unsafe or dishonest profile."* Both are fixed
(`BESTSPOT_SAFETY.confMax` / `.weightMin`) and pinned by regression tests that cite the theorem.

**The transferable lesson**, and it is the same shape as this feature's other one (*"every unit gate
was green while the field was a constant"*): **a test samples; a specification quantifies.** The
value of the proof was not the proof. It was being forced to state the hypothesis.

---

## 1. What is in `formal/`

A Lean 4 + Mathlib project. **25 theorems, 0 `sorry`, all resting on only Lean's three standard
axioms.**

```
lean-toolchain        leanprover/lean4:v4.33.1  (matches the installed elan toolchain exactly)
lakefile.toml         srcDir = "formal"; requires mathlib @ rev v4.33.1
lake-manifest.json
formal/Ftw.lean       root
formal/Ftw/Score.lean the per-cell composition
formal/Ftw/Hull.lean  the architectural keystone
formal/README.md      the mechanics: bootstrap, IDE setup, CLI workflow, traps
.lake/                GITIGNORED — ~7.4 GB of Mathlib checkout + prebuilt .olean + our build output
```

**The Lake workspace root is the REPO ROOT, not `formal/`** — IntelliJ's lean4ij plugin resolves
`<ideProjectRoot>/lean-toolchain` with no walk and has no override setting, so the config must sit
where the IDE is opened. `srcDir = "formal"` keeps the sources here. Consequence:
`cd formal && lake build` does not work; build from the repo root. Full reasoning in
`formal/README.md`.

### `Ftw/Hull.lean` — the keystone

`horizonSweep.ts:12-17` claims **"THE HULL IS INDEPENDENT OF EYE HEIGHT AND OF SCENE TIME."** It is
what makes the altitude slider and the time scrubber live (browser-measured: a 2→400 m lift drag
builds **zero** hulls). Until now it was pinned by a random-DSM brute-force diff and a five-lift
monotonicity spot-check — i.e. by sampling.

- **`hull_fold`** — finding F4, the curvature fold. The raw tangent and the folded form the code
  evaluates are equal for every sample, eye height and curvature. Read the statement and you can
  *see* that the eye `L` survives only inside `q_c`; that is the whole reason a lift change is a
  re-query and not a rebuild.
- **`below_chord_never_sets`** — **the eye-independence of the hull.** A sample lying on or below
  the chord joining two others is never the maximiser of the slope function, *for any eye height
  whatsoever*. Therefore the maximiser always lies on the upper convex hull, the hull is a function
  of the folded surface alone, and the eye may vary freely without invalidating it.
- **`setter_moves_outward`** — once the farther sample wins, it keeps winning as the eye rises. This
  is what licenses the `break` at `horizonSweep.ts:580` and the binary peak search at `:849`.
- **`slope_le_iff_cross`** — the division-free cross-multiplied comparison the code actually
  evaluates is equivalent to the slope comparison, given both lever arms positive.

> **The framing matters more than the proofs.** The obvious formalization — *define a computable
> `upperHull : List (ℝ × ℝ) → List (ℝ × ℝ)`, prove the monotone-chain algorithm correct* — is a
> **1–3 person-week** project, because Mathlib has no computational upper hull at all (its
> `convexHull` is the abstract closure operator on a set in a module). Proving the *slope facts the
> hull exists to exploit* took under an hour and is what the code actually depends on. **When a
> formalization looks like it costs weeks, you are usually formalizing the implementation instead of
> the claim.**

### `Ftw/Score.lean` — the composition

Mirrors `bestSpotMetric.ts:1168-1191`. `clamp01` (bounds, idempotence on `[0,1]`, monotonicity) ·
the preference blend (**bounded**, **monotone**, **invariant under a uniform rescale of the weight
vector** — the algebraic content of the one-scale-factor test at `bestSpotMetric.test.ts:1000`) ·
R7 `M_eff` (exactly 1 for sun kinds *for every floor*, never below the floor, monotone) · GRAZE
`1 − exp(−τ/s)` (in `[0,1)`, strictly monotone in τ, zero at zero) · the `cut` factor (both arms in
`[0,1]`, area arm peaking at exactly 1 at half-occultation) · `confBound`.

And the two **counterexample theorems** — `weights_nonneg_is_necessary` and
`confBound_is_necessary` — which are the defects above, stated as mathematics.

### The gate

```bash
npm run proofs          # ~4 s warm
npm run proofs -- --list
```

`scripts/verify-proofs.mjs`. **The build is not the gate**: a proof stubbed with `sorry` still
builds. The gate is three things — a source-level ban on `sorry` / `admit` / `native_decide`
(comment-stripped first, so prose mentions do not false-positive), the build, and an **axiom audit**
that enumerates every `theorem` in the sources and rejects any dependency outside `propext`,
`Classical.choice`, `Quot.sound`. Falsified by mutation on 2026-08-24d: injecting one `sorry` gives
`lake build` **PASS** and the audit **FAIL** — which is exactly why the audit exists.

Deliberately **not** wired into `npm test`: vitest must stay ~23 s and must not require a 7.4 GB
Mathlib tree. Run it when `formal/**` or the math it mirrors changes.

### Setup on a fresh machine

```bash
curl https://elan.lean-lang.org/elan-init.sh -sSf | sh   # elan is NOT on the non-login PATH
lake exe cache get && lake build                         # FROM THE REPO ROOT — see formal/README.md
                                                         # ~5 min, 8,690 prebuilt .olean, 7.4 GB
```
`lake exe cache get` is what makes this viable — building Mathlib from source is *about an hour* on
an M1 Max and is not feasible under 16 GB of RAM.

---

## 2. What Lean is NOT for here — the honest limits

- **There is no Lean → JS path worth using.** Lean's backends are C and LLVM; neither targets JS,
  and even `live.lean-lang.org` runs Lean server-side rather than in WASM. Anything proved in Lean
  is **hand-ported to TypeScript with no compiler-enforced link** — the proof can silently drift from
  the shipped code. Mitigation, used here: every theorem's docstring cites the `file:line` it
  mirrors, and every fix cites the theorem back. That is a convention, not a guarantee.
- **The proofs are over ℝ, and the code runs in float64.** Lean 4.33.0 (2026-08-10) added
  `Float.Model` with genuine logical content for arithmetic and `sqrt` — but **`Float.Model.sin`
  does not exist**. For an ephemeris codebase that is `atan2`/`sin`/`cos` all the way down, the
  float64 gap stays open precisely where it would matter most. Claims like *"`0.35 + 0.65·1` is
  exactly 1 in IEEE doubles"* are therefore vitest's job, not Lean's, and are marked as such.
- **Do not formalize anything touching the DEM raster, the ephemeris, or a measured constant.** The
  golden tables and the browser harness are the right instruments for those, and they are good ones.

**Rule of thumb for what belongs in `formal/`:** it is an algebraic claim, it is load-bearing, it is
currently pinned only by examples, and it is expressible in exact arithmetic. All four, or leave it out.

---

## 3. Wolfram — evaluated, not adopted

**Not installed on this machine** (no `wolframscript`, no app). It would be legal and useful, but it
is item 8 on the ladder, not item 1.

- **Free Wolfram Engine for Developers** is alive in 2026 and covers this use case: the licence
  permits development, demos and testing, and forbids *"running the Free Engine in a production
  software application"*. **A `.wls` script that emits high-precision JSON fixtures for vitest is
  squarely inside it** — the shipped app never calls Wolfram, only fixtures it produced. Keep it a
  local, human-invoked step; activation is per-machine, so it must never become a CI dependency.
  `brew install --cask wolfram-engine` (15.0.0), then `wolframscript -activate`. Runs headless and
  offline once activated.
- **There IS an official MCP server as of 2026** — `WolframResearch/AgentTools` (MIT, last pushed
  2026-08-24) plus Wolfram's own "Local MCP", which explicitly lists the free Engine as a qualifying
  kernel. No official JS/TS binding exists (the `wstp` npm package does **not** exist); shell out to
  `wolframscript`.
- **Where it beats Lean:** exact/arbitrary-precision evaluation as an oracle · `FullSimplify` ·
  **`Interval[]` with automatic outward rounding through every built-in function** — the one thing
  JavaScript structurally cannot do (§4) · `FindInstance` for counterexample hunting · `NMinimize`
  for worst-case error over a domain.
- **Where it loses:** no machine-checked artifact — you trust a closed-source CAS with no
  re-verifiable certificate. And `Reduce`'s completeness guarantee **does not extend to
  transcendental conditions**, so on a trig-saturated ephemeris expect it to punt; `FindInstance` and
  `NMinimize` are the reliable fallbacks.

**Verdict: complementary, not competing.** Lean answers *"is this always true"*; Wolfram answers
*"what is the true value, and where is the worst case"*. Reach for it when a closed form needs an
oracle or a formula needs a worst-case error bound — not before.

---

## 4. The ladder — ranked by value / (setup + maintenance)

Measured against this repo: 130 test files, 1,902 tests, ~23 s wall, ~35.8 k lines of `src`.

### Pays for itself inside a week

| | What | Setup | Why here |
|---|---|---|---|
| **1** | **`fast-check` + `@fast-check/vitest`** | 30 min | `@fast-check/vitest@0.4.1` peer-deps `vitest ^4.1.0`; the repo is on `^4.1.9` — **exact match, no gymnastics**. 1,902 tests assert on 1,902 *named points*; this searches the space between them. The magnet cases here are the 0°/360° azimuth seam, degenerate/collinear hulls, empty DSM rays, and **`horizonSweep`'s use of NaN as its in-band unknown marker**. Failures print a `{seed, path, endOnFailure}` object you paste straight back for deterministic replay |
| **2** | **Differential vs JPL Horizons**, cached as JSON fixtures | 1–2 h | `astronomy-engine` is the *primary* implementation, so it cannot be its own oracle. Horizons can. **Already run live this session**, sun over Dnipro: azimuth agreed to **0.5″**; altitude was off by 1.5′ — which turned out to be the *oracle's default*, since Horizons returns airless coordinates unless you pass `APPARENT='REFRACTED'`. With it: **sub-arcsecond in both coordinates.** That trap is now documented before it costs a session. Fetch once, commit fixtures, never call the API from a test |
| **3** | **Metamorphic properties** (rides on #1) | 2 h | No library needed — an MR is a fast-check property that derives the transformed input inside the predicate. **The one to write first:** the fused `solveTerms` pass vs `cellScore` over *randomly generated* DSMs rather than 5 hand-picked probes. That is exactly the "semantics-preserving optimization" risk class, and §5's suspected-false S2 is a live candidate. Others: raising every DSM cell by `k` is monotone in visibility; rotating DSM + heading by θ rotates the output by θ (catches handedness/axis-order); star positions repeat on the **sidereal** day (23h56m04.09s — using the solar day here is a classic bug) |
| **4** | **`robust-predicates`** | 1 h | Shewchuk's adaptive exact predicates. "Is C above the line from V to B" in the `(distance-along-ray, height)` plane **is** `orient2d` — precisely the turn test inside `horizonSweep`'s monotone stack. Sign-flip errors there corrupt topology: non-convex "convex" hulls, inconsistent occlusion. **Gotcha:** this port uses a downward y-axis, so verify empirically which sign means "above" in a z-up frame |
| **5** | **`glslangValidator` as a lint gate** | 20 min | `brew install glslang`. The shaders are template strings with injected constants and `test/components/globe/glsl.test.ts` only covers float-literal *formatting* — `sky.ts` (619 lines) and `atmosphere.ts` (231) are untested as programs. A test that assembles each shader and pipes it through the validator catches the `glf` bug class at whole-shader level |

### Worth a day, once

| | What | Why here |
|---|---|---|
| **6** | **Stryker, SCOPED to `bestSpotMetric.ts` + `horizonSweep.ts`** | Its real job is auditing whether `bestSpotGolden.test.ts` is *sensitive*, not merely green — a golden proves output is fixed, never that it discriminates. Estimated ~5–20 min cold, 1–2 min incremental for those two files; **hours** unscoped, so scope it. **Version blocker:** Node here is v20.19.2 and `@stryker-mutator/vitest-runner@10` requires Node ≥22 — pin **9.6.1** |
| **7** | **Reference-image diffing** (`pixelmatch` + the existing CDP harness) | ~80 % of the rig already exists: `scripts/verify-chrome.mjs` owns the port check and the occlusion flags, and `sharp` is already a devDependency. **macOS is the easy platform** — headless Chromium uses the real GPU (SwiftShader isn't supported there, so there is no software-rasterizer fallback to fight). A nonzero `maxDiffPixelRatio` is mandatory for a WebGL canvas |
| **8** | **Wolfram Engine fixtures** | §3 |
| **9** | **`decimal.js` as a 50-digit oracle** | Narrow but real: accumulated float64 error in a long series/trig chain |
| **10** | **Herbie** on one or two hot expressions | `brew install --cask racket && raco pkg install --auto herbie`, or the zero-install web demo. Rewrites an ill-conditioned expression for accuracy. **A scalpel, not a pipeline** — input is FPCore S-expressions and there is no JS→FPCore importer, so every round-trip is manual |

### Say no

- **Interval arithmetic in JS/WASM.** Not a library-quality problem: **JS has no `fesetround` and
  WebAssembly has no FP-rounding-mode instruction at all.** Even rigorous Rust (`inari`) loses its
  guarantee crossing to WASM. If true outward-rounded intervals are ever needed, that is an argument
  for the Wolfram sidecar, not for an npm package. Pragmatic substitutes that do work: exact sign
  predicates (#4), and dual-precision sensitivity — run the kernel in float64 and again through
  `Math.fround`, treat **sign flips** as an instability alarm.
- **Gappa · Why3 · Frama-C · Flocq · Daisy.** All require rewriting the kernel in C, WhyML, Rocq or
  Scala. Frama-C is C-only (its WP "Real Model" is documented as *unsound* w.r.t. IEEE anyway). For
  a solo developer on a TypeScript browser app the ratio is not close.

### Already solved — do not touch

**`test/lib/geo/_perf.ts`.** It independently derived the calibration-workload technique *and* found
the failure mode the literature does not write down: a sub-15 ms calibration spin **fits inside one
scheduler quantum** and reports exactly `k = 1.00` under a load average of 110 while the code it
normalises runs 2.78× slow. The published guidance (MIT, *Robust benchmarking in noisy
environments*) says use ratios; it does not say the ruler must be long enough to be preempted. Note
also that **Apple Silicon has no Turbo Boost to disable** — that advice is Intel-only, and there is
no supported way to pin M-series frequency. Where a deterministic proxy exists (ray-step counts,
`renderer.info` draw calls, `orient2d` call counts), prefer it to wall clock entirely.

---

## 5. Open — suspected-false invariants, NOT yet verified

The specification pass raised nine candidate defects beyond the two confirmed in §0. **Two were
confirmed executably and fixed; the rest are code-reading arguments and must be reproduced before
they are believed** — a finding that does not reproduce is deleted, not downgraded.

| # | Claim | Status |
|---|---|---|
| **S2** | The fused pass is **not** identical to `cellScore` at a finer azimuth lattice. `solveTerms` sweeps azimuth `i` then scores `i−1`, so only ONE azimuth of lookahead is ever filled. At the shipped 0.25° step the outermost column midpoint is ~0.95 lattice steps out, so ±1 suffices. At `azStepDeg: 0.125` — documented as "the desktop-high option" and asserted reachable — it becomes ~1.90 steps, and the ring cannot hold `j+2` | **UNVERIFIED, highest priority.** Reproduce by running `solveTerms` vs `cellScore` on a `{azStepDeg: 0.125}` track. This is exactly what MR #3 above would have caught |
| **S1** | Hull cache keys use two *different* equivalence relations — `snapAz` rounds to 1e-4°, the acceptance test is bit-exact `===`. They coincide today only because `azStepDeg 0.25` is dyadic; a non-dyadic step breaks it, silently falling through to a rebuild that nothing reports | **UNVERIFIED.** No test asserts `hullBuilds < K` after a *day* step; the "36 of 39" figure is measured with `toFixed(9)`, never through the solver |
| **S6** | `composeScores` computes `wDotT * (1/wTotal)` while `cellScore` computes `wDotT / wTotal`. These are **not** bit-identical in IEEE, though both docstrings say "bit-identical" | **Likely true as stated**, but the claim being made is about *key iteration order*, which is fine. Reword the prose; the 1e-12 tolerance is correct |
| **S8** | `refractionK` and `earthRadiusM` are folded into the hull but are **not in its cache key** | **Latent** — `refractionK` is not a profile leaf today. Still a missing key |
| **S9** | `bestSpotSolver.test.ts:1677` promises "the values must be identical, not merely close" and asserts only `0 ≤ want ≤ 1` — a pin that cannot fail | **Verify and repair.** Same class as audit #3's five unfalsifiable checks |
| **S5** | `grazeStepRadii` genuinely differs between the two paths (per-cell vs per-solve) — intentional, but `CellScore.grazeStepRadii`'s docstring describes the other one | **Doc fix** |
| S3, S4 | see §0 | **CONFIRMED + FIXED + pinned** |

Also unpinned and worth a property: `bestSpotTrack.ts:388-390` asserts *"`f(a) ≤ this` is a
geometric identity"* — the entire justification for the horizon-ceiling weight having no free scale
— and **has no test at all**.

---

## 6. Recommended order

1. **`fast-check`** (30 min) → then **MR #3 on the fused pass**, which reproduces or kills **S2**.
2. **S9 and S1** — a pin that cannot fail and a cache key that works by coincidence.
3. **JPL Horizons fixtures** — the ephemeris oracle gap, with the refraction trap already mapped.
4. **`robust-predicates`** on the monotone stack; **`glslangValidator`** as a lint gate.
5. **Stryker scoped**, to find out whether the golden tables discriminate.
6. Everything else only if a specific question demands it.

Keep `formal/` small. Its value is not coverage — it is that **every theorem in it forced a
hypothesis into the open**, and two of those hypotheses turned out to be false in shipped code.
