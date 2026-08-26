# BEST SPOT — THE TRAP REGISTER

**Every trap below was paid for with real session time.** They are collected here because their only
previous home was `NEXT_SESSION_PROMPT.md` — which is **gitignored** (`.gitignore:3`), untracked, has
no git history, and is rewritten wholesale by the next unrelated session — or a single `wip-*` Serena
memory that `mem:core`'s index did not name.

Read this before touching BEST SPOT code, before writing a probe, and before believing a number.

---

## 1. THE ONE THAT COST A WHOLE SESSION

> ### `rg8.r` is CLAMPED to `[displayLo, displayHi] = [0.15, 0.90]`.
> ### **"The cell reads 0" is NOT the same claim as "the cell is vetoed."**

Every cell scoring below 0.15 is display byte **0** and is indistinguishable from an exact zero. The
2026-08-26h diagnosis read "the pick is byte 0" as "the gate is deleting it", built a fix for that,
and the 2026-08-26i measurement showed the gate was never the binding constraint — the cell was
merely *low*. Two different failures, one symptom.

**To read structure below the floor** you must remove the global multipliers
(`curves.accessSoftExponent: 0` + `worth.effectiveFloor: 1`). You **cannot** lower the window:
`displayLo`/`displayHi` live in `tuning.ts` `BESTSPOT`, not in the patchable scoring profile.

---

## 2. MEASUREMENT DISCIPLINE

- **A single ablation proves nothing without its control.** Only the **H6-vs-H8 PAIR** identified the
  gate (H6 carried *more* score-raising patches and still read 0; the only thing H8 removed was the
  gate). Only **D1** — roads-free moving the field best while leaving the pick byte-identical — ruled
  out the road classes. Only `{unknown: 1}` reproducing the whole-ladder-off value *exactly*
  identified the rung.
- **Read a FLAG, do not infer it.** The **STAR MAP** — `{vGateLo: 1, vGateHi: 1.05, vStarFloor: 1}` —
  makes `G = 1` exactly when `TERM_FLAG.hasStar` is set and 0 otherwise, so a cell renders non-zero
  **iff** the body reaches half-visibility somewhere in the window. That one patch answered in
  minutes what arithmetic had been arguing about for two sessions.
- **The field improves as tiles stream.** Two base runs 12 min apart measured `floorFrac` 0.699 then
  0.469. **Quote ONE self-consistent run.** Trust `pick.r` and the ranked rows across runs; do not
  trust `floorFrac`, `nonZero` or `cellsStrictlyBetter`. See `MEASUREMENTS.md` §6.
- **A probe that reads a field which does not exist FAILS OPEN** — prove the probe CAN match before
  believing a zero result.
- **Do not sample a cumulative-since-page-load counter once** (`__frameGate.draws/.skips`,
  `bestSpot().jobs`, `__pipCache.renders`). Poll and difference.
- **A counter that fuses two populations is worse than no counter** — `droppedOutside` sized a
  multi-hour re-bake that was never needed. Decompose before you believe a drop count.

---

## 3. DRIVING THE DISC FROM A PROBE

- **`__bestSpotStore` defaults to `kind: "sunset"`.** A probe that opens the disc without
  `setKind("moonrise")` measures a **different event** and a near-black field. It nearly sent the
  2026-08-26f diagnosis the wrong way. **Set the kind, then RE-ASSERT it after `setOpen`.**
- **`setHeatmapOn(true)` must come AFTER `setOpen(true)`** — `setOpen` forces the switch off in both
  directions, by design (owner item 4).
- **A verify script that only sets the temp pin proves nothing.** The disc solves from what has
  STREAMED, so it must `#p=` fly there **and** pin the time, then `armSession()` and wait ~9 s.
- **A full-canvas pointer sweep blows the 90 s CDP cap.** Project the target from its **live instance
  matrix** and dispatch ONE `pointermove`.
- **`Page.bringToFront` before anything rAF-driven** — the verify Chrome runs without occlusion flags.
- **`Page.navigate` to a hash-only-different URL does not reload** — bounce through `about:blank`.
- **`JSON.stringify(<async IIFE>)` stringifies the PROMISE** — returns `{}` and never fails.
- **The DEV seam is `__globe.enrichedSeats()`.** There is no `__globe.debugSeats`, and no
  `__globe.scene` — reach the scene by walking `__globe.tiles.group.parent` up.

---

## 4. THE HARNESS ITSELF

> ### `finishVerify` calls `process.exit`, so a bare `finally` around it **SWALLOWS THE THROW**.

A failed probe prints nothing but a cleanup line and exits with a meaningless code. Cost two full
runs on 2026-08-26j before it was spotted. **Print first, exit second:**

```js
} catch (e) {
  console.error(`\nPROBE FAILED: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await finishVerify(exitCode);
}
```

**Still live in the tree:** `scripts/probe-bestspot-taste.mjs` and `scripts/probe-bestspot-r1.mjs`
both `await finishVerify(PORT)` inside a `finally` — so they exit `9222 % 256 = 6`, which is not a
status, **and** they hide their own failures. `scripts/probe-bestspot-gate.mjs` is the corrected
pattern; copy that one.

Also:
- **Node 20 has NO global `WebSocket`.** Every CDP harness needs node ≥ 21:
  `export PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH"`. The repo default is v20.19.2 and the
  failure is a `ReferenceError` on line 1 of the attach.
- **`test/verifyHarness.test.ts` (C11) fences every new `scripts/verify-*.mjs`**: `trackTarget` the
  moment `/json/new` returns, exit through `finishVerify`, never a bare `process.exit`. **The
  `probe-` prefix is the documented escape** for a research instrument with no PASS/FAIL contract.
- **`verify-bestspot.mjs` has no send() timeout** (`:76-81`) and once hung a run for 50 minutes. Copy
  `verify-bestspot-ownerbatch.mjs`'s `send()` with its 90 s timeout (`:104-113`).
- **Two latent crashes in `verify-bestspot.mjs`** — `:916` (`heroRanked[0]`) and `:945` (`ranked[0]`)
  are unguarded after an `ok()` that only *records*. An empty shortlist throws `TypeError` →
  `finishVerify(1)`, aborting at ~check 66 of 101 and **silently skipping the last four sites**.

---

## 5. THE DEV SERVER

> ### The **504-Outdated-Optimize-Dep** trap fires on a plain `wix dev` restart after editing `lib/geo`.

**Symptom:** every panel logs *"Failed to fetch dynamically imported module"*, `useState` reads null
(two React copies), and `window.__globe` **never appears** — so a probe reports "the globe island /
dev seams never came up" and you go looking for a bug in your own code.

**Remedy, and the ORDER is the whole trick:**
1. stop the server;
2. `mv node_modules/.vite/deps` aside;
3. restart `wix dev`;
4. **warm once in a REAL BROWSER** — `curl` does *not* populate `optimizeDeps`;
5. then measure.

- **RESTART `wix dev`** after adding imports to the globe bundle.
- Declare orchestrator state **ABOVE the ephemeris seam** in `StylizedTiles.ts` — below it you get a
  TDZ and a **silent fallback**, not an error. `stepBestSpotFeed` is at `StylizedTiles.ts:5362`.
- Backticks inside injected-GLSL template literals terminate them (17 phantom TS errors).
- Eased uniforms: assert **after** the snap (≥ 6.2 τ), or a correct ease reads as a bug.

---

## 6. CODE-LEVEL FENCES THAT FAIL SILENTLY

- **`test/components/globe/fences.test.ts` only inspects lines matching `/^\s*(allowed|enabled):/`**
  inside `stepBestSpotFeed`. **A new gate term belongs ON one of those lines or it is unfenced — and
  nothing says so.**
- **`test/store/bestSpot.test.ts:36-62`'s `DEFAULTS()` is PARTIAL** and `:69` does a partial
  `setState(DEFAULTS())`. A new store flag with no `setOpen` forcing **leaks across every test in
  that file**.
- **A path with no `CLASS_OF` entry is `"rebuild"`** — fail-safe by design, so a new leaf is SLOW
  rather than WRONG. But `clampLeaf`'s `default: return value` is **fail-OPEN**: a new leaf with no
  clamp case has no bounds at all, and a hostile persisted blob reaches the kernel.
- **The every-field-is-live walk cannot reach a leaf that lives above `cellScore`.** `cellScore` is
  handed its samples, so `trackWeight.topAltDeg` is structurally unreachable there and is
  allowlisted in `EXPECT_INERT_ON_FIXTURE` **with a compensating pin in `bestSpotTrack.test.ts`**.
  If you add another track-shaping leaf, it needs the same pair or it ships untested.
- **`endsWith(".glb")` no longer matches a cell URL** — every content uri carries `?v=`. Use
  `/\.glb(\?|$)/`; stable identity is `cellUriOf()`.
- **`bake.mjs --out` writes INSIDE the repo** (REPO_ROOT-relative), so `--out /tmp/x` makes `./tmp/x`.

---

## 7. THE TRACK AND ITS WINDOW  *(paid on 2026-08-26j)*

- **A SAMPLE-COUNT budget is not a SPAN budget.** Sized at 68 lattice points it becomes 3.35° at the
  0.05° lattice and **silently truncates the shipped window** — `bestSpotGolden`'s τ-invariance check
  went red at 11.89 % against its 10 % bar.
- **A budget sized for Dnipro deletes every high-latitude sunrise.** The shipped worldwide maximum is
  **45.5° at Tromsø (K = 176)**; Dnipro is 16.0°. **The culmination runaway and the wide polar sweep
  are the same physics** — a shallow track — so a backstop against one must not re-decide the other.
  A 17° cap took `bestSpotTrack.test.ts`'s **PIN c** red.
- **A window budget must drag the SHOULDERS in with it.** They are `±shoulderSpan` past the window
  *edge*; anchored on the un-budgeted march they run to the old top and **K stays unbounded** —
  54.5° measured where 23° was asserted.
- **Truncate from the end decided by `uTop` vs `uBottom`, NEVER by `upSign` or the hemisphere.** In
  the south a rising body's unwrapped azimuth *decreases*, so a hemisphere-blind truncation deletes
  the contact instead of the sky above it.
- **The budget must run BEFORE `maxSamples`**, which decimates *uniformly* — a thinned window is no
  longer a subset of the absolute lattice, so **every hull misses** and the cache the whole cost
  model rests on stops existing.
- **`alt*` is ALREADY a per-cell argmin** over the track, while `V` and the four τ buckets average
  over the whole `inWindow` span. So raising the window's top gives `alt*` a better contact **and**
  dilutes `V` at the same time.

---

## 8. RECORD-KEEPING

- **`verify-shots/` is GITIGNORED** (`.gitignore:38`). Every browser-measured number lives only on
  the machine that measured it. **Transcribe anything load-bearing into `MEASUREMENTS.md`** — that
  file exists for exactly this reason.
- **`NEXT_SESSION_PROMPT.md` is GITIGNORED** (`.gitignore:3`) and has no history. Anything durable
  written only there is **already lost**. This file is its BEST SPOT half, rescued.
- **`DECISIONS.md` is append-only and carries multi-KB single lines** — read it PAGED (offset/limit)
  or grep it; a naive full Read truncates before §Recent sessions.
- **Date-letter session labels COLLIDE across documents.** `README.md` §2 carries the disambiguation
  table — check it before chasing "the 2026-08-26i finding", which names two different sessions
  depending on which document you opened.
