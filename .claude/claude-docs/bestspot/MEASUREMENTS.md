# BEST SPOT — THE MEASURED RECORD

**This file exists because `verify-shots/` is GITIGNORED** (`.gitignore:38`). Every number below
came from a browser probe against a live `wix dev` + streamed Dnipro bake, cost tens of minutes of
wall-clock each, and **cannot be re-derived offline** — no node test can produce them, because the
disc solves from geometry that has STREAMED. When this machine is wiped, the JSON is gone. The
numbers are not.

Raw (this box only): `verify-shots/probe-bestspot-taste.json` ·
`verify-shots/probe-bestspot-gate{,-decompose,-unknown}.json` · `verify-shots/probe-bestspot-r1.json`.

---

## 0. THE CASE — one disc, one instant, one cell, used by every probe

| | |
|---|---|
| Disc URL | `#p=48.45125,35.07101,477,135.1,38.0&t=1787762683150` |
| Kind | **MOONRISE** (the store defaults to `sunset` — a probe that forgets this measures a different event and a near-black field) |
| Scene instant | 2026-08-26T16:44:43Z — the owner's own frame |
| Disc contact | 2026-08-26T15:57:36.678Z, i.e. **47 min before his shot** |
| Owner's pick | `48.451827,35.070311`, 82 m from disc centre |
| His frame | moon alt **+5.90°**, az 125.43°, sun −1.94° |
| At the contact | moon alt −0.24°, az 116.73°, sun **+5.16°** (broad daylight → `worth` near its floor) |
| Field geometry | `n = 201`, `cellM = 3`, `radiusM = 300`, `sheetAltM = 1.7`, `displayLo/Hi = 0.15 / 0.90` |
| Verdict split | scored 23,798 · unknown 11,007 · blocked 5,596 · total 40,401 |

**The Monument of Glory** (`way/1202608487`, `building=yes` + `height=20` beside
`historic=memorial`) bears **125.7° at 87.1 m** from his cell. The moon at his own frame is at az
**125.47°** — a **0.23°** difference, less than half the moon's own diameter.

---

## 1. READING THE TABLES — three traps that make numbers lie

1. **`rg8.r` is CLAMPED to `[displayLo, displayHi]` = [0.15, 0.90].** Every cell scoring below 0.15
   is byte **0** and is *indistinguishable from an exact zero*. **"The pick reads 0" is NOT the same
   claim as "the pick is vetoed"** — conflating those two cost an entire session. To read structure
   below the floor you must remove the global multipliers (`curves.accessSoftExponent: 0` +
   `worth.effectiveFloor: 1`); you cannot lower the window, because `displayLo/Hi` live in
   `tuning.ts` `BESTSPOT`, not in the patchable profile.
2. **The field improves as tiles stream.** Two base runs 12 min apart measured `floorFrac` 0.699 and
   0.469. **Quote ONE self-consistent run; never compare across passes.** The tables below are
   grouped by pass for exactly this reason, and §6 quantifies the drift.
3. **A single ablation proves nothing without its control.** Every decisive claim here rests on a
   PAIR — see §3 and §4.

`S ≥ ...` columns are the de-quantised display byte, `deq(r) = 0.15 + (r/255)·0.75`, so they are a
LOWER bound on `S` to within one byte (0.0029).

---

## 2. PASS 1 — the change set, and its refutation (2026-08-26i, `probe-bestspot-gate.mjs`)

The **STAR MAP** arm is the instrument that made this pass decisive:
`{vGateLo: 1, vGateHi: 1.05, vStarFloor: 1}` makes `G = 1` **exactly when `TERM_FLAG.hasStar` is
set** and `0` otherwise — a direct read of the flag, not an inference from a score.

| arm | patch | rMax | field best `S` | nonZero | floorFrac | **pick `r`** | pick `S ≥` | better | pct |
|---|---|---|---|---|---|---|---|---|---|
| base | — | 84 | 0.3971 | 11,795 | 0.498 | **0** | ≤0.15 | 11,795 | 0.498 |
| star-map top=4 | `gates:{1,1.05,1}` | 84 | 0.3971 | 15,100 | 0.358 | **20** | 0.2088 | 8,086 | 0.656 |
| star-map top=10 | + `topAltDeg:10` | 88 | 0.4088 | 15,611 | 0.337 | **23** | 0.2176 | 6,153 | 0.739 |
| star-map top=14 | + `topAltDeg:14` | 92 | 0.4206 | 15,672 | 0.335 | **23** | 0.2176 | 6,251 | 0.735 |
| top=10 only | `topAltDeg:10` | 85 | 0.4000 | 9,323 | 0.608 | **0** | ≤0.15 | 9,323 | 0.608 |
| floor=0.35 only | `vStarFloor:0.35` | 84 | 0.3971 | 8,607 | 0.637 | **0** | ≤0.15 | 8,607 | 0.637 |
| top=10 + floor=0.35 | both | 85 | 0.4000 | 9,323 | 0.608 | **0** | ≤0.15 | 9,323 | 0.608 |
| top=10 + floor=0.50 | both | 85 | 0.4000 | 9,517 | 0.600 | **0** | ≤0.15 | 9,517 | 0.600 |
| top=14 + floor=0.35 | both | 85 | 0.4000 | 9,475 | 0.602 | **0** | ≤0.15 | 9,475 | 0.602 |
| `S ≡ V` at top=10 | see below | 255 | 0.9000 | 16,146 | 0.321 | **42** | **V = 0.2735** | 13,780 | 0.421 |

`S ≡ V` patch: `{gates:{vGateLo:0,vGateHi:0.05,vStarFloor:0}, curves:{accessSoftExponent:0},
worth:{effectiveFloor:1}, weights:{v:1,l:0,p:0,f:0}}`.

**What this pass established:**

- **`hasStar` was ALREADY TRUE at the shipped 4° top** (r = 20). The window was never the reason the
  cell read zero. Raising the top to 10° adds ~4 % and 14° adds nothing further.
- What the raise *does* buy is `V`: **≤ 0.15 → 0.2735** (`S ≡ V` at top 4 read byte 0 in the
  2026-08-26f pass; at top 10 it reads 42). Real, and far too small to matter.
- **Every combination of the two new leaves left the pick at display byte 0** and the eight
  shortlist rows unchanged to the fourth decimal. Ranks 1–3 stay `0.4009 / 0.396 / 0.3942` at
  148 / 111 / 86 m from the pick across all of them.

---

## 3. PASS 2 — where the ceiling actually goes (`PROBE_ARMS=decompose`)

`S = A_hard · A_soft^0.5 · M_eff · G · preference`. With `G` forced to 1 by the star map, the
factors are peeled one at a time. **Every row is the same run**, so these are comparable.

| arm | added patch | field best | **pick `S ≥`** | pct | what it isolates |
|---|---|---|---|---|---|
| D0 | star-map, top=10 | 0.4000 | **0.2176** | 0.761 | the control |
| D1 | `access.soft.{majorRoad:1, road:1}` | 0.4412 | **0.2176 — UNMOVED** | 0.734 | **he is NOT on a road.** The field best moved, so the patch fired |
| D2 | `curves.accessSoftExponent: 0` | 0.4412 | **0.3235** | 0.832 | ⇒ his `A_soft^0.5` = **0.2176/0.3235 = 0.673** |
| D3 | + `worth.effectiveFloor: 1` | 0.8824 | **0.6324** | 0.833 | ⇒ `M_eff` = 0.3235/0.6324 = **0.512** (daylight, field-wide) |

**D1 is the load-bearing negative control.** It moved the field's best cell from 0.400 to 0.441 —
proving the patch reached the engine — while leaving the pick byte-identical. That is what rules out
the road classes, and no amount of arithmetic could have.

### His four terms, read directly

Each with the whole preference weight on one term (`accessSoftExponent: 0`, `worth.effectiveFloor:
1`, star-map gate), so `S` **is** that term:

| arm | term | **pick** | pct | better | field best |
|---|---|---|---|---|---|
| D4 | `F` | **0.4059** | 0.848 | 3,608 | 0.9498 |
| D5 | **`L`** | **≥ 0.90** | **1.0000** | **0** | 1.0 |
| D6 | `P` | **0.6765** | 0.861 | 3,310 | 1.0 |
| (pass 1) | `V` | 0.2735 | 0.421 | 13,780 | 1.0 |

> **`L` at percentile 1.0000 with ZERO cells strictly better: his cell is the single best in the
> entire field on contact lowness.** 11,503 cells tie at the display ceiling, so it is a saturated
> tie rather than a lone peak — which is itself the finding: either the metric already agrees with
> him more than anyone assumed, or `L` saturates too easily. Unresolved.

**The blend closes against the measurement**, which is what says the model is not lying about him:

```
0.15·0.2735 + 0.30·0.90 + 0.25·0.6765 + 0.30·0.4059 = 0.602   vs   0.6324 measured (D3)
```

(the gap is byte quantisation — every term is read at ≥ its de-quantised floor). **He ranks
83rd-percentile on preference, and is then multiplied by 0.673 for standing on ground the raster
cannot classify.**

---

## 4. PASS 3 — naming the rung (`PROBE_ARMS=unknown`)

`accessSoftGain` is `soft^0.5` at the shipped exponent, so `soft = 0.673² = 0.453`. Exactly one rung
in the eleven-row ladder sits there: **`access.soft.unknown = 0.45`**. Tested rather than asserted:

| arm | patch | field best | **pick `S ≥`** | pct | nearest marker |
|---|---|---|---|---|---|
| E0 | star-map, top=10 (control) | 0.4000 | **0.2176** | 0.759 | 42 m |
| E1 | + `access.soft.unknown: 1` | 0.4412 | **0.3235** | **0.875** | 52 m |
| E2 | **SHIPPED** + `unknown: 1` | 0.4118 | **0** | 0.614 | 39 m |

> **E1 reproduces D2's whole-ladder-off value EXACTLY — 0.2176 → 0.3235 — while every other class
> stays penalised.** One rung, the entire handicap. A wrong guess could not pass this test.

**E2 prices the change on the real field**: `unknown: 1` on the otherwise-shipped profile moves the
field best 0.400 → 0.4118, reshuffles the shortlist (rank 1 becomes an `open` contact at 292 m where
it was a `gap` at 155 m), and brings a marker to 39 m from his pick. It does **not** by itself lift
him above the display floor.

---

## 5. THE CEILING — the arithmetic that reorders the whole effort

From two measured factors, `A_soft^0.5 = 0.673` and `M_eff = 0.512`, at a **perfect** preference of
1.0 and with the gate forced fully open:

```
S_max = 0.673 × 0.512 = 0.345    <    0.378   (the shortlist's entry price, rank 8 = 0.3778–0.3801)
```

> **No gate change, no window change and no new framing term can put his cell in the top 8 while
> `access.soft.unknown` charges it 0.45.** This is not an opinion about the design; it is two
> measured multipliers and an inequality.

**With `unknown: 1` the ceiling becomes `0.512 · preference`:**

| | preference | ⇒ `S` |
|---|---|---|
| measured today | 0.6324 | 0.324 |
| rank 4 in the same arm (E1) | 0.825 | 0.4223 |
| with `F_peak` taking `F` 0.406 → ~1.0 | 0.6324 + 0.30·0.594 = **0.810** | **0.415** |

`F_peak` is worth **+0.178 of preference**, landing within **2 %** of rank 4 — the first arithmetic
in this entire investigation that reaches his photograph.

---

## 6. CROSS-RUN VARIANCE — how much to trust a third decimal

The same nominal arm, measured in different passes minutes apart:

| quantity | pass 1 | pass 2 (D0) | pass 3 (E0) | spread |
|---|---|---|---|---|
| star-map top=10, pick `r` | 23 | 23 | 23 | **0** |
| …cells strictly better | 6,153 | 5,705 | 5,749 | **7 %** |
| …percentile | 0.739 | 0.761 | 0.759 | 0.022 |
| `unknown` (unmapped cells) | 11,288 | 10,973 | 10,973 | 3 % |
| base `floorFrac` (2026-08-26f vs i) | 0.640 | — | 0.498 | **22 %** |

**The pick's own byte is stable to 0; the field's census is not.** Trust `pick.r` and the ranked
`rows` across runs; do not trust `floorFrac`, `nonZero` or `cellsStrictlyBetter` across runs.
`verify-bestspot`'s D8 block is red partly for this reason — hero `S` measured 0.3161 → 0.3338 over
four consecutive runs.

---

## 7. THE 2026-08-26f ABLATION LADDER — what was refuted before the gate was found

Same disc, ten live profiles, all at the shipped 4° window. **Every one reads pick `r = 0`** except
H8. This is the run that identified the gate, and the H6-vs-H8 PAIR is why.

| arm | patch | rMax | pick `r` | verdict |
|---|---|---|---|---|
| base | — | 84 | 0 | |
| H1 soft-off | `accessSoftExponent:0` | 89 | 0 | REFUTED |
| H1b roads-free | `soft.{majorRoad,road}:1` | 86 | 0 | REFUTED |
| H2 lCeil 30 | `lCeilDeg:30` | 84 | 0 | REFUTED |
| H3 altScale 30 | `altScaleDeg:30` | 85 | 0 | REFUTED — **field byte-IDENTICAL to base** |
| H4 trust 200 | `depthTrustRadiusM:200` | 104 | 0 | REFUTED (but field best 0.400 → 0.456) |
| H5 combo | H2+H3+H4 | 104 | 0 | REFUTED |
| **H6 combo+headroom** | H5 + multipliers off | 255 | **0** | **more score-raising patches, gate ON** |
| H7 vGate off | `{vGateLo:0, vGateHi:0.05}` | 84 | 0 | |
| **H8 vGate off+headroom** | H7 + multipliers off | 230 | **84** | **fewer patches, gate OFF** |
| H9 `S ≡ V` | see §2 | 255 | 0 | ⇒ **`V ≤ 0.15`** at top = 4 |

> **H6 vs H8 is the discriminator.** H6 carried *more* score-raising patches than H8 and still read
> 0; the only thing H8 removed was the gate. One arm alone would have proved nothing.

**H3 is the other lesson**: `altScaleDeg: 30` produced a **byte-identical field**. Re-weighting
cannot reach samples that do not exist — which is what pointed at the window's top in the first
place, and what §2 later measured as worth only 0.12 of `V`.

---

## 8. TRACK COST — what raising the window's top actually costs

Node, deterministic, reproducible without a browser (`eventTrack` + `resolveScoring`, Dnipro
moonrise, `snapAzLattice: true`, budget disabled). **K = total track samples**, which sets hull
memory and ladder latency.

| `topAltDeg` | sweep° | **K** | max alt° | window minutes |
|---|---|---|---|---|
| **4 (shipped)** | 13.0 | **41** | 6.28 | 71 |
| 6 | 15.5 | 52 | 7.95 | 84 |
| 8 | 18.5 | 63 | 9.85 | 99 |
| **10** | 21.5 | **76** | 11.63 | 114 |
| 12 | 25.0 | 90 | 13.55 | 131 |
| 16 | 33.0 | 121 | 17.31 | 168 |
| 20 | 43.0 | 162 | 20.83 | 211 |
| 25 | 68.3 | 268 | 24.39 | 312 |
| 30 | 68.3 | 268 | 24.39 | 312 |

**25° and 30° are identical** — the march has clamped at culmination. That is the unbounded-in-K
pathology `TRACK_WINDOW_MAX_SPAN_DEG` exists to backstop.

### Shipped window spans WORLDWIDE — why the budget is 48° and not 17°

Same method, six sites × four kinds × every fifth day of 2026, on the **shipped** 4° top:

| site | max sweep | K at that max |
|---|---|---|
| Dnipro | 16.0° | 53 |
| Sydney | 10.5° | 32 |
| Reykjavík | 40.5° | 156 |
| **Tromsø** | **45.5°** | **176** |
| Quito | 6.1° | 14 |
| Singapore | 6.1° | 14 |

> **A budget sized for Dnipro's ladder (17°, i.e. 68 lattice points) silently deletes every
> high-latitude sunrise** and took `bestSpotTrack.test.ts`'s PIN c red. The culmination runaway and
> the wide polar sweep are **the same physics** — a shallow track — so a backstop against one must
> not re-decide the other. 48° clears the measured worst case with margin.

---

## 9. THE PLANNER DISAGREES WITH THE DISC — a separate, unfixed defect

`__globe.plan().binAltDeg` at the owner's exact cell reports the skyline toward the moon as
**0.09–0.14°** — flat — where a 20 m mass stands 87 m away at 125.7°. At 120 bins (3°/bin) **the
planner is missing the monument**. His photograph is the arbiter: the moon is in the frame, and the
disc's model is the one that reproduces it.

**Consequence:** `scripts/verify-bestspot.mjs`'s D8 cross-model block must **never** be re-derived
against the planner alone. Recorded in `verify-shots/probe-bestspot-r1.json`; the probe that
produced it (`scripts/probe-bestspot-r1.mjs`) is built on the planner profile and is therefore
**unsound for this cell** — keep it for the window arithmetic, not for the skyline.
