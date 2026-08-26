# WIP 2026-08-26i — THE GATE FIX, BUILT AND THEN REFUTED BY ITS OWN MEASUREMENT

Executed `NEXT_SESSION_PROMPT.md`'s minimal change set (1 gate · 2 window · 3 F_peak) and ran the
falsification pass it demanded. **Both mechanisms shipped INERT; the measurement says they cannot do
the job and names what can.** Doc: `.claude/claude-docs/bestspot/BESTSPOT_TASTE_V1.md` § ADDENDUM 2026-08-26i.
Predecessors: [[project/wip-2026-08-26-bestspot-taste]] · [[project/wip-2026-08-26-sweep-mode]].

## GATES
**vitest 2,144/2,144 (141 files)** (+10) · `astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.
Tier LOCAL + BROWSER. Probe: `scripts/probe-bestspot-gate.mjs` (NEW, `probe-` prefix so C11 does not
fence it), three arm sets via `PROBE_ARMS=<decompose|unknown>`. Raw:
`verify-shots/probe-bestspot-gate{,-decompose,-unknown}.json`.

## THE HEADLINE — THE GATE MAKES HIS CELL ZERO; IT IS NOT WHAT KEEPS IT OUT OF THE RANKING
Two different failures, only the first was ever diagnosed. **With `G` forced fully open his cell
still reads `S = 0.2176` against a field best of 0.400, 5,749 cells strictly better, 76th
percentile.** Every arm of `top ∈ {4,10,14} × vStarFloor ∈ {0.35,0.50}` left the pick at display
byte 0 and the eight shortlist rows unchanged to 4 dp. `G ≤ 1` and `G·0.2176 < 0.378` (the entry
price), so **no value of `vStarFloor` can work.**

**And `hasStar` was ALREADY TRUE at the shipped 4° top** — refuting 2026-08-26h's dependency story.
The STAR MAP arm (`{vGateLo:1, vGateHi:1.05, vStarFloor:1}` ⇒ `G = 1` iff `TERM_FLAG.hasStar`, a
direct read of the flag) lights his cell at top 4 (r=20), 10 (r=23) and 14 (r=23). What the raise
actually buys is `V`: **0.15 → 0.2735** — real, and far too small.

## THE FINDING NO PRIOR DOC CONTAINS — `access.soft.unknown = 0.45`
Peeling `S = A_hard · A_soft^0.5 · M · G · preference` with `G = 1`:
star-map 0.2176 · `+majorRoad/road:1` **0.2176 UNMOVED** (field best 0.400→0.441, so the patch
fired — he is NOT on a road) · `+ladder off` 0.3235 ⇒ **`A_soft^0.5` = 0.673** · `+worth floor 1`
0.6324 ⇒ `M_eff` = 0.512 (daylight, field-wide). `soft = 0.673² = 0.453` ⇒ exactly one rung.
**Confirmed sharply, not left as arithmetic: `{unknown: 1}` ALONE reproduces the whole-ladder-off
value EXACTLY (0.2176→0.3235)** while every other class stays penalised; 76th → 87.5th percentile.

> **His cell is charged a third of its score because the landcover raster does not know what it is.**

This contradicts a rule the codebase enforces everywhere else (`notchDepthDeg = −Infinity` because
"ignorance is not depth"; UNKNOWN is "a RENDER CLASS, never a low score"; the 2026-08-26g canopy
withdrawal). **OWNER CALL** — it re-scores every unclassified cell in every region.

## THE CEILING — the number that decides the design
`S_max = A_soft^0.5 · M_eff = 0.673 × 0.512 = **0.345** < 0.378` **at a PERFECT preference of 1.0.**
No gate change, no window change and no framing term can reach the top 8 while `unknown` charges
0.45. With `unknown:1` the ceiling is `0.512 · preference`; he measures 0.6324 → 0.324 vs rank 4 at
0.4223 in the same arm; `F_peak` at `F: 0.406 → ~1.0` adds `0.30·0.594 = 0.178` → **0.810**, within
2 % of rank 4. First arithmetic in the whole investigation that reaches his photograph.

## HIS FOUR TERMS, READ DIRECTLY (whole weight on one term, ladder off, worth 1, gate open)
`V` 0.2735 (pct 0.42) · **`L` ≥0.90 — pct 1.0000, ZERO cells better, BEST IN THE FIELD** ·
`P` 0.6765 (0.86) · `F` 0.4059 (0.85, his weakest — the term F_peak exists to move).
Blend closes: `0.15·0.2735 + 0.30·0.90 + 0.25·0.6765 + 0.30·0.4059 = 0.602` vs 0.6324 measured
(byte quantisation). **The model ranks him 83rd-percentile on preference, then multiplies by 0.673.**

## WHAT SHIPPED (both byte-identical on the shipped profile)
- **`gates.vStarFloor`** (default **0**), `bestSpotMetric.visibilityGate(v, gates, hasStar)` →
  `max(G(V), vStarFloor)` when starred. Inert TWICE: `hasStar` defaults false at the kernel AND the
  leaf ships 0. `CLASS_OF` `recompose`, proven on the FUSED path (`bestSpotSolver.test.ts`) and
  proven to move **starred cells only, zero starless** — the honesty claim the floor rests on.
  `cellScore` passes `starRay !== null`, the same `starIdx >= 0` the solver sets the flag from.
- **`trackWeight.topAltDeg`** (default **4**), in the PROFILE not the job — a deliberate deviation
  from `SWEEP_MODE_MAP.md` C2, valid only because slice 0's `trackHash` covers the whole
  `trackWeight` group and rebuilds the track. `CLASS_OF` **`resweep`** (heavier than its two
  siblings: it decides WHICH samples exist). `opts.topAltDeg` still wins, so geometry tests need no
  profile.
- **`TRACK_WINDOW_MAX_SPAN_DEG = 48`** + `EventTrackOptions.windowMaxSpanDeg`, truncated from the
  NEW end (decided from `uTop` vs `uBottom`, NEVER `upSign`/hemisphere), applied to the azimuth
  bounds so the shoulders follow the budgeted edge in.

## FOUR TRAPS PAID, ALL EXPENSIVE
1. **A sample-count budget is not a span budget.** Sized at 68 lattice points it becomes 3.35° at the
   0.05° lattice and silently truncates the SHIPPED window — `bestSpotGolden`'s τ-invariance check
   went red at 11.89 % vs its 10 % bar. It must be a SPAN.
2. **Sized for Dnipro's 16° it deletes every high-latitude sunrise.** Measured shipped maxima over
   2026: Dnipro 16.0° · Sydney 10.5° · Reykjavík 40.5° · **Tromsø 45.5° (K=176)** · Quito/Singapore
   6.1°. The culmination runaway and the wide polar sweep are THE SAME PHYSICS, so a backstop
   against one must not re-decide the other. Took PIN c red.
3. **The shoulders must follow the budgeted edge in.** Anchored on the unbudgeted march they ran to
   the old top and K stayed unbounded — 54.5° measured where 23° was asserted.
4. **`finishVerify` calls `process.exit`, so a bare `finally` around it SWALLOWS the throw.** The
   probe reported nothing but a cleanup line for two runs. Print first, exit second. (Also: the
   shipped probes pass `PORT` as the exit code — `9222 % 256 = 6`.)

## COST OF A RAISE, MEASURED (Dnipro moonrise, K = track samples)
top 4° → **41** (shipped) · 6° → 52 · 8° → 63 · **10° → 76** · 12° → 90 · 16° → 121 · 20° → 162 ·
25° → 268 (march clamps at culmination; 30° buys nothing more).

## NEXT SESSION, IN ORDER
1. **`access.soft.unknown` in front of the OWNER.** The hard ceiling, one number, a product decision
   about every unclassified cell in every region. Nothing else can succeed while it stands.
2. **`F_peak`** — `SWEEP_MODE_MAP.md` slice 2 unaffected, twenty golden rows still apply. Now a
   PRECONDITION with a measured target (`F: 0.406 → ~1.0`, +0.178 preference).
3. **Only then** tune `vStarFloor` + `topAltDeg` together — built, gated, inert.
4. **`L = 1.0000` at his cell, best in the field**, deserves its own look: either the metric already
   agrees with him more than anyone assumed, or `L` saturates too easily.

Related: [[project/wip-2026-08-26-bestspot-taste]] · [[project/wip-2026-08-26-sweep-mode]] ·
[[project/wip-2026-08-26-sweep-schedule]] · [[project/wip-2026-08-24-bestspot-s3-s7]] ·
[[decisions/session_workflow]]
