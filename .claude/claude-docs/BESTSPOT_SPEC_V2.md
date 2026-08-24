# BEST SPOT — CONSOLIDATED IMPLEMENTATION SPEC
**Consolidated 2026-08-24 from four investigation agents (A latency/partial-data/kinds · B framing kernel · C tuning architecture · D visual).**
Supersedes `BESTSPOT_PLAN.md` §3.4 (framing), §5 (residency tiers, budget), §6 (render) and §10 (S3–S7) where they conflict. The AS-BUILT appendix stands; this document closes its open items 1 and 3.

Provenance convention: `(A)`/`(B)`/`(C)`/`(D)` = measured by that agent in a `/tmp` harness against the shipped modules. `verified` = I re-read the code this session. `UNVERIFIED` = stated, not measured.

> **RECONCILED 2026-08-24d AGAINST THE SHIPPED CODE (S3a→S7 landed).** This document was written as a
> forecast; the feature then shipped and was browser-verified, and where the two disagree **the code
> wins and this file has been corrected in place**. Classes of correction applied:
> **(1) the term buffer is 75 B/cell, not 59** (§2.1, §5.3, §7 S3c — the 59 B layout stored the notch
> as a finished product and froze five `gap.*` leaves the invalidation table files as `recompose`);
> **(2) measured costs replace forecasts** — COMPOSE, `scoreMask`, the fused pass, the latency ladder
> and the residency deltas are now browser- or vitest-measured numbers with the forecast kept beside
> them; **(3) the HONESTY SUBSYSTEM that did not exist at forecast time** — three refusal reasons, the
> built-density prior's floor and mechanism, and the `reachM` policy layer (§3.4, SHIPPED block);
> **(4) the epoch set is FOUR, plus `sourcesEpoch`**, not two (§3.4); **(5) the `BESTSPOT` tuning
> inventory is 60 keys, not 40** (§6.11), four of them honesty/safety rather than look; and
> **(6) §8's three open questions are ANSWERED and shipped** — that section is a ruling record now,
> not live design space.
> Everything not marked corrected still stands as originally measured.

---

# 1. THE FORMULA

## 1.1 The complete final formula

### Per-disc precompute (once, cell-independent)

```
track   = eventTrack(centre, kind, epochMs)        bestSpotTrack.ts
          → samples i = 0 … n−1, each carrying
              a_i    azimuth (deg, unwrapped — it can exceed 360 and it can decrease)
              α_i    APPARENT altitude of the body centre (deg) = airless + Refraction("normal")
              ρ_i    apparent disc RADIUS (deg): sun 0.2635–0.2636, moon 0.2468–0.2478 (A)
              w_i    quadrature weight |dt/da|·Δa · exp(−max(0,α_i)/altScaleDeg) · horizonCeiling
          → windowLo, windowHi   (the swept span outside these is SHOULDER, for C and GAP only)
          → M = worth ∈ [0,1]    = moonPhaseIntensity(phase) · twilightGate(sunAlt);  1 for sun

dipFloor = horizonDipDeg(eyeM + liftM, refractionK)   −0.03904° at 1.7 m · −1.339° at 2000 m
```

### Per-cell evidence, per swept sample i

`r_i = RayEvidence` from `sweepAzimuth`: ground horizon `Hg_i` (signed, apparent), `groundSrc_i`, `groundDistM_i`, floating bands `[lo_k, hi_k]` with `bandSrc_k` / `bandDistM_k`, `known_i`, `openSky_i`, and **`reachM_i` (NEW — §3)**.

### The six terms

```
── COVERAGE (honesty channel; a gate, not a preference) ─────────────────────────────
C  = Σ_all w_i · known_i / Σ_all w_i                    full swept span, shoulders included
IF C < minCoverage (0.5)  →  verdict = UNKNOWN, no ink, excluded from top-K.  STOP.

── V — is the body actually there? ──────────────────────────────────────────────────
f_i = discVisibleFraction(r_i, α_i, ρ_i, discColumns)   visible AREA fraction of the disc,
                                                        integrated over azimuth COLUMNS
V  = Σ_{i∈[windowLo,windowHi]} known_i·w_i·f_i / Σ_{i∈window} known_i·w_i
G(V) = smoothstep(vGateLo 0.15, vGateHi 0.75, V)        SOFT gate, never a step

── az*, alt* — the contact ─────────────────────────────────────────────────────────
az* = the sample with the LOWEST α_i among those with f_i ≥ halfDiscFrac (0.5)
alt* = α interpolated to where f crosses 0.5 on the low side     (direction-agnostic)

── L — CONTACT LOWNESS ─────────────────────────────────────────────────────────────
L  = 1 − smoothstep(dipFloor, lCeilDeg 5°, alt*)

── P — DEPTH of the thing it sets behind ───────────────────────────────────────────
P  = openSky(az*) ? 1 : depthOfDistM(D*, trustRadiusM)
depthOfDistM(D,T) = clamp01( ln(max(D,1e-6)/nearRef) / ln(max(T, nearRef·e)/nearRef) )
                    nearRef = 30 m, T = 3000 m                    verified bestSpotMetric.ts:174-177

── F — FRAMING = max(GRAZE, GAP).  THIS IS THE PART THAT CHANGES. ──────────────────

  ① CUT — is the disc being cut at sample i, and by how much?
     δ_i    = nearestEdgeDeltaDeg(r_i, α_i)             verified bestSpotMetric.ts:339
     cut_i  = max(  4·f_i·(1 − f_i)  ,  1 − clamp01(δ_i / ρ_i)  )
              ↑ AREA arm: 1 when exactly half-cut,      ↑ TANGENT arm: the shipped triangular
                0 when fully clear OR fully hidden;       kernel, kept as a floor so a THIN
                orientation-agnostic (fires on a           occluder (a 1.8 m deck slab at 1.5 km
                vertical tower flank AND on a              = 0.27ρ) is not lost: 0.1272 → 0.3435 (B)
                diagonal roofline)

  ② Q — is the thing being cut worth photographing?
     (e_i, s_i, D_i) = the edge NEAREST α_i on ray i, with ITS OWN tag and ITS OWN distance.
                       Candidates: (Hg_i, groundSrc_i, groundDistM_i)
                                 ∪ (lo_k, bandSrc_k, bandDistM_k) ∪ (hi_k, bandSrc_k, bandDistM_k)
     Relief(e) = smoothstep(reliefLoDeg 0.05, reliefHiDeg 0.40, e − dipFloor)
     Conf(s)   = conf[s]      terrain 1.00 · building 0.90 · deck 0.90 · tree 0.45 · none 0
     Depth(D)  = depthOfDistM(D, trustRadiusM)         the SHIPPED P kernel, per EDGE
     Q_i       = Relief(e_i) · Conf(s_i) · Depth(D_i)

  ③ τ — DWELL, measured in disc RADII of the body's own vertical travel
     Δα_i = |α_{i+1} − α_{i−1}| / 2                    central difference, clamped at the ends
     τ    = Σ_{i∈window, known_i=1}  cut_i · Q_i · Δα_i / ρ_i        dimensionless, ≥ 0

  ④ GRAZE
     F_graze = 1 − exp( −τ / grazeScaleRadii 1.75 )

  ⑤ GAP (notchAt kernel UNCHANGED — all eight PIN-2 tests stay verbatim)
     F_gap = notchAt(rays, starIdx, alt*, ρ*, notchOpts).f · min( Q(shoulderL), Q(shoulderR) )

  F = max(F_graze, F_gap)

── ACCESSIBILITY, WORTH, COMPOSITION ───────────────────────────────────────────────
A_hard ∈ {0,1}   A_soft ∈ [0.1,1]                       from the LandGrid ladder (§5)
S = A_hard · A_soft^accessSoftExponent(0.5) · M · G(V) · Σ_k w_k·T_k / Σ_k w_k
    where {T} = {V, L, P, F} and {w} = {0.15, 0.30, 0.25, 0.30}
    Composition is a REGISTRY over the keys of `weights`, not a hard-coded 4-term sum (§5).
```

### What the generalization buys, measured (B, 17 scenarios, real Dnipro 2026-08-24 sunset track)

| | shipped `F_sil` | GRAZE |
|---|---|---|
| grazing 8 km mountain ridge | **0.0000** (provenance gate: `isBuiltSrc(terrain) === false`, verified `bestSpotMetric.ts:162,400,404`) | **0.9912** (τ = 8.2855 ρ) |
| perpendicular 8 km ridge, same distance, same relief | 0.0000 | **0.4843** (τ = 1.1589 ρ) |
| low hills 0.25° @ 6 km | 0.0000 | 0.3953 |
| tree line 0.9° @ 300 m | 0.0000 | 0.1419 (48 % soft penalty vs a hard 0) |
| open sea horizon | 0.0000 | **0.0000** — relief 0, not provenance |
| bridge deck 6 m slab @ 1.5 km (hero) | 0.8294 | 0.4261 on the synthetic slab · **0.59720 on the real swept chain** |
| **F vs P independence**, 66-cell fixture | spread 0.0619, corr **0.9985** (r² 0.997) | spread **0.5401**, corr **0.6268** (r² 0.393) |
| **height response**, fixed 1500 m, 11 heights 0.05→2.9° | 0.795…0.847 = lattice noise | 0.014 → 0.383, then saturated |
| **lattice stability**, 0.25° vs 0.05° az step | mean \|Δ\| **20.3 %**, max **+67.9 %** | mean \|Δ\| **2.27 %**, max 9.6 % |

> **All seventeen rows are now MEASURED, not forecast** *(corrected 2026-08-24d against `test/lib/geo/bestSpotGolden.test.ts:30-50`, the table committed RED before the kernel existed)*. Sixteen of the seventeen landed within **0.013** of the forecast from an independently-written fixture, which is the strongest available evidence that §1.1's closed form and the shipped kernel are the same object. The forecasts above were 0.9897 · 0.4830 · 0.3958 · 0.1381 · 0.5408 · 0.6260; the city-skyline row moved 0.3540 → 0.3542.
>
> **Row 07 BRIDGE DECK is the one real miss, and it is a FIXTURE difference, not a kernel difference.** §1.1 named its hero "a 6 m slab @ 1.5 km" without publishing the band angles; the golden file's slab is `[0.31°, 0.38°]` (the PIN 3 geometry, 0.266 ρ thick) on a synthetic sky and scores **0.4261**. Run against the **REAL swept composition chain** — a 6 m slab at 1493 m, `bestSpotComposition.test.ts` — the same kernel measures **0.59720** against §7's forecast for that exact fixture of **0.5972**. Four decimals. The spec's hero number IS reproducible on the geometry the spec meant.

Ranking change the owner will see: a grazing mountain ridge moves from **rank 9 (below a blank wall and below empty sea)** to **rank 2**. A distant low-hill silhouette moves 7 → 3.

Composed on the real chain (`bestSpotComposition.test.ts` fixture): shipped `withDeck 0.88853 / bare 0.69606, margin 0.19247` → proposed `0.82219 / 0.69606, margin 0.12613` (B). `bare.f` is **exactly 0** because the flat-water horizon comes out at −0.0616° against dip −0.03904° ⇒ relief −0.0226° ⇒ `smoothstep` returns hard 0.

---

## 1.2 The same thing in plain English

**The question.** You point at a place. We ask: *if I stood on each square metre around here, how good would this sunset look?*

**Step one — where will the sun be.** We compute the sun's path for that evening: about 68 minutes of it, from 4° up to 3.5° below the flat horizon. We chop that path into about 40 steps. At each step we know the sun's compass direction, its height above the horizon, and how big it looks (about half a degree wide — a bit less than your little fingernail at arm's length).

**Step two — what's in the way.** We build a height map of everything within 700 metres: the terrain, every building, bridge decks, trees. Then, for each of those 40 compass directions, we work out the skyline you'd see looking that way from every cell in the disc. This is the trick that makes the whole thing possible: the skyline calculation is done once per direction for the whole map, not once per person.

**Step three — five questions per cell.** For every square, we ask five things and give each a score from 0 to 1.

1. **Can you see it at all?** We track how much of the sun's disc is visible at each of the 40 steps and average it. If a wall blocks the sun for most of the descent, this is near 0, and near 0 kills the cell — you can't photograph what you can't see.
2. **Does it get low?** A sun that disappears behind a rooftop at 8° up is not a sunset. A sun that touches the actual horizon is. We measure the height at which the sun is finally half-covered, and score it high if that height is near zero.
3. **How far away is the thing it disappears behind?** A ridge 8 km away is a landscape. A fence 4 metres away is a fence. Distance is scored on a log scale, because doubling the distance matters the same amount whether you go from 100 m to 200 m or from 1 km to 2 km.
4. **Is it framed by something?** This is the part we redesigned. It has two halves:
   - **GRAZE** — how *long* the sun rides the edge of something real. Not "does the sun touch an edge" (almost everything touches an edge), but "for how much of its travel is it being cut by an edge". A sun sliding down along a ridge that runs almost parallel to its path is grazing for a long time — that's the picture people fly to Iceland for. A sun that crosses a ridge at right angles is cut for two seconds. Same ridge, same distance, same height. The old formula scored both **exactly zero** (it only counted buildings) and even when it did fire it scored a wall and a bridge identically. The new one scores them **0.99 and 0.48**.
   - **GAP** — the sun or moon appearing in a slot between two tall things. Unchanged.
   - We take whichever is bigger.
5. **Can you actually stand there?** Not in the river, not inside a building, not on a railway. And a soft preference: a footpath beats a motorway verge beats an unknown patch of ground.

**Step four — put them together.** Questions 2, 3 and 4 are *tastes* — they trade off. A clean 30 km horizon with nothing in front of it and a bridge silhouette are both correct answers, so those three get **added** with weights (30 % lowness, 25 % distance, 30 % framing, 15 % visibility). Questions 1 and 5, plus "is this moon even worth going out for", are **gates** — they get **multiplied**, because no amount of good framing fixes standing in the Dnipro.

**Three things it refuses to do.**
- If we haven't looked at more than half of the sun's path from a cell (missing map data), the cell is marked **UNMAPPED** and gets **no colour at all**. It is never given a low score, because a cold colour reads as "bad spot", and that would be a claim about geometry nobody looked at.
- It never invents a silhouette out of a tree. Trees still count — Dnipro's trees are 93 % computer-generated scatter, so a tree edge is worth 45 % of what a building edge is worth. It is a discount, not a ban.
- It never treats a flat empty horizon as a frame. An empty sea horizon scores **exactly zero** on framing, because there is no edge standing above the horizon to ride.

**One sentence:** *a cell scores well when the body is visible, gets low, disappears behind something far away, and spends a long time sliding along the edge of that thing — and when you can legally and physically stand there.*

---

# 2. THE PIPELINE — click to pixels

## 2.1 The stages, with measured milliseconds

All timings: **Apple M3 Pro, node v20.19.2, single thread, warm** (A). Real OpenFreeMap z14 data: 9 tiles / 1,063 KB / 558 building features / 12,599 rings / 120,195 ring vertices. Terrain TIN and canopies are synthetic (392 tris, 800 canopies at Dnipro's measured densities) — stages 7a and 7c are therefore approximations; everything else is on real data.

**K = number of swept azimuths = 40** (Dnipro sunset, measured; 28 window + 12 shoulder). Cost is linear in K.

Configurations: **(a) 3 m cell / 300 m radius** (the R3 default) · **(b) 3 m / 500 m** · **(c) 1 m / 300 m** (ULTRA).
DSM/hull/sweep grid = `oddSpanCells(radius + 400 m collar, cellM)` (verified `localDsm.ts:203`) = **469² / 601² / 1401²**. Scored disc = **31,417 / 87,253 / 282,697** cells = 14.3 % / 24.2 % / 14.4 % of the grid.

| # | Stage | file | (a) ms | (b) ms | (c) ms | tier |
|---|---|---|---|---|---|---|
| 1 | toggle click → store write → centre via `aimAnchorFor()` | `lib/geo/aimAnchor.ts:56` | <1 UNVERIFIED | | | — |
| 2 | worker spawn (first toggle only) | `bestSpotWorker.ts` | 5–30 UNVERIFIED | | | — |
| 3 | `eventTrack()` | `bestSpotTrack.ts` | **2.44** | 2.44 | 2.44 | T0.5 |
| 4 | MVT fetch, 9 tiles parallel, **COLD** | `vectorTiles.ts` | **69–537** (Dnipro 537 · Kyiv 259 · Lviv 69) | | | T0 |
| 5 | `parseVectorTile` × 9, warm | `vectorTiles.ts:397` | **21.97** (1 tile 3.18) | 21.97 | 21.97 | T0 |
| 6 | `buildLandGrid()` | `landcoverRaster.ts` | **20.17** | 22.32 | 58.60 | T0 |
| 7 | `createLocalDsm` total | `localDsm.ts` | **16.04** | 19.92 | 61.78 | T0 |
| 7a | ↳ `rasterizeTinGround` | | 2.99 | 4.75 | 24.70 | |
| 7b | ↳ `stampSolid` × 12,599 rings | | 11.62 | 13.01 | 26.64 | |
| 7c | ↳ `addCanopy` × 800 | | 0.23 | 0.27 | 0.38 | |
| 7d | ↳ `sealDsm` | | 1.21 | 1.89 | 10.05 | |
| 8 | `buildHulls` × K | `horizonSweep.ts` | **144.4** (3.61/az) | 199.3 | 985.0 | T0.5 |
| 9 | `sweepAzimuth` × K, **as shipped** | | 409.1 (10.23/az) | 620.1 | 3,706.3 | T1 |
| 9′ | `sweepAzimuth` × K, **masked to the disc** | | **166.0** (4.15/az) | 333.6 | 1,496.8 | T1 |
| 10 | score, **shipped object API** | `bestSpotMetric.ts:654` | 651.3 (20.7 µs/cell) | 1,411.1 | 4,661.5 | T1 |
| 10′ | score, **fused-arithmetic floor + GRAZE** | | **176.8** + ~7 (B) | 488.7 | 1,583.5 | T1 |
| 11 | COMPOSE term buffer → S → RG8 pack | | **~2.5** measured (0.272 forecast) | | | T2 |
| 12 | `postMessage` transfer (79 / 219 / 705 KB) | | free UNVERIFIED | | | — |
| 13 | full-surface `texSubImage2D` + LUT upload | | **<0.1** | <0.1 | <0.5 | T3 |
| 14 | draw (sheet+contours 1 call, plumb, markers) | | ~0 | | | T3 |

Memory: hulls **2.53 MB/az → 101 MB at K=40** (a) · 4.15 → **166 MB** (b) · 22.50 → **900 MB** (c). DSM 5.2 / 8.6 / 46.8 MB. Term buffer **75 B/cell = 3.03 / 8.42 / 27.1 MB** *(corrected 2026-08-24d against the shipped code — `bestSpotSolver.ts:247` `TERM_BYTES_PER_CELL = 75`; the 59 B forecast is superseded, see §5.3)*.

> **Row 11 is the forecast, not the measurement.** COMPOSE measures **~2.5 ms at 201²** (`bestSpotSolver.test.ts:872,898-911`, pinned `< 5` reference-ms), not 0.272 ms: the modelled ~15 multiply-adds/cell missed one `exp`, one `sqrt`, two `smoothstep`s and — the dominant term — the 3 MB of term buffer streamed across fourteen typed arrays. A hand-inlined loop with every kernel call flattened runs 1.97 ms, so the gap is memory bandwidth, not call overhead. **The architectural claim survives untouched** (see §2.2).

> **The plan's §5 budget (T0 ≈ 105 ms, T1 ≈ 90 ms) is off by 2× and 12×.** Correct it.
>
> **`horizonSweep.ts:254-257`'s memory ledger (0.49 MB/az at 201²/3 m) undercounts by 5.4× — it forgot the 400 m collar** (verified: the docstring quotes the 201² disc grid, the real grid is 469²). At 1 m the hulls are 900 MB and **cannot be resident**, so ULTRA must stream azimuths and re-pays `buildHulls` on every lift change (T1 at (c) becomes 9,353 ms).

## 2.2 The residency ladder — SIX tiers, not three

The plan's §5 three-tier table is wrong in one specific way: **the hulls are eye- and time-free, but the SET OF AZIMUTHS is a function of the day**, so a day-scrub invalidates them anyway.

Measured (A, Dnipro sunset, 0.25° lattice): same day +3 h → `eventTrack` returns a **byte-identical** track (it frames on `localDayWindow`, `bestSpotTrack.ts:213`). **+1 day → `setAzDeg` moves −0.534°, exact azimuth matches = 0/40.** +30 days → −17.04°, the two 12.6° spans are **disjoint**. Corroborated independently by C: annual sunset envelope [224.1°, 312.2°] = 88.1° → 353 hulls = 171 MB @ 3 m / 1.53 GB @ 1 m, so an all-azimuth resident hull set is impossible.

**Fix: snap the track's azimuth lattice to an ABSOLUTE 0.25° grid** (`Math.round(u/azStep)*azStep` at `bestSpotTrack.ts:652-666`, behind an option so existing pins keep their spacing) and key a hull cache on the snapped azimuth. Then +1 day shares **36 of 39** azimuths instead of 0/40 *(corrected 2026-08-24d against the shipped code — forecast 37/39, measured 36/39 at `bestSpotSolver.test.ts:1127-1137`; the `≥ 35` pin still passes)*.

| tier | invalidated by | what re-runs | cost (a), achievable |
|---|---|---|---|
| **T0** | centre, radius | tiles + land grid + DSM (rows 5–7) | **58 ms** warm · +69–537 cold |
| **T0.5** | **DAY or KIND** | track + hulls + sweep + score (3,8,9′,10′) | **490 ms** |
| **T1** | lift, eye height | sweep + score (9′,10′), hulls resident | **343 ms** |
| **T1′** | scene time **within the same local day** | nothing | **0 ms** — assert this |
| **T2** | a scoring-profile patch (most knobs) | COMPOSE from the resident term buffer | **~2.5 ms** measured |
| **T3** | a render/look tunable | LUT rebuild + one uniform | **<0.1 ms** |

**RECOMPOSE is > 200× cheaper than the cheapest re-solve** (2.5 vs 550 ms of sweep + score) and it fits inside one 16.7 ms frame with 6× to spare, so every taste knob is genuinely live. *(Corrected 2026-08-24d against the shipped code: the forecast said 0.272 ms and 1,260×; measured is ~2.5 ms and >200×, `bestSpotSolver.test.ts:872,898-911`. The ratio moved by 6×; **the conclusion did not move at all**, which is what §5 turns into a property.)*

## 2.3 What the user actually waits for — the progressive ladder

**First, the fact that drives the whole design.** 3,000 sampled cells, dense central Dnipro, R = 300 m, 3 m, real buildings, sunset 2026-08-24 (A):

| lift | UNKNOWN | A_hard = 0 | S > 0 | S > 0.25 | S > 0.5 | max S | median S |
|---|---|---|---|---|---|---|---|
| **1.7 m (pedestrian)** | 0.0 % | 33.4 % | **2.3 %** | 0.2 % | **0.0 %** | **0.381** | 0.000 |
| **56.7 m (lifted)** | 0.0 % | 0.0 % | 100 % | 100 % | 100 % | 0.844 | 0.629 |

**At pedestrian height in a real city the disc is 97.7 % black and its maximum is 0.381** — below the plan's own ~0.5 legibility floor. That is physically correct (a 20 m building at 100 m subtends 10.4°; the sun lives in 0–6°) and it *is the product*: the value is the 2.3 % and the top-K, not a smooth field. It also means there is very little ink to wait for — which is why there is no spinner.

**The ladder, measured** (A; tiles parsed once, land grid built once at 3 m and reused across rungs):

| rung | cell | grid | disc cells | node FORECAST, rung ms | **BROWSER, as built** |
|---|---|---|---|---|---|
| prep | — | — | — | track 2.4 + parse 22.0 + land 20.2 = **44.6** | — |
| **R0** | 24 m | 61² | 491 | **10.6** (⇒ 55 ms first ink) | **6.7 ms** |
| R1 | 12 m | 119² | 1,963 | 41.0 (⇒ 96 ms) | **23 ms** |
| R2 | 6 m | 235² | 7,854 | 172.1 (⇒ 268 ms) | **90 ms** |
| R3 | 3 m | 469² | 31,416 | 679.7 (⇒ 948 ms) | **356 ms** |
| R3′ | 3 m + disc mask (§7 S3c) | | | 462.3 (⇒ 731 ms refined) | (the mask is in the 356) |

**Wall clock the user experiences.** *(Corrected 2026-08-24d: the left column above was a node forecast; the right column and these numbers are the BROWSER MEASUREMENT of the shipped worker.)*
- **Warm tiles, MEASURED IN A BROWSER: first ink 45.4 ms · fully refined 523.8 ms.** Both beat the forecast (55 ms / 731–948 ms). The shipped gate is `scripts/verify-bestspot.mjs:338-343` — `firstInkMs > 0 && ≤ 120` and `refinedMs > 0 && ≤ 1200` — and both pass with 2.6× and 2.3× of headroom.
- **Cold tiles:** click → ~260 ms of nothing (median network across Dnipro/Kyiv/Lviv) → ink at **~320 ms** → refined at **1.0–1.2 s**. *(Forecast; the browser run was warm.)*
- **Time scrub within a day:** 0 ms, measured — zero hull builds. **Day step:** 490 ms (T0.5, forecast). **Altitude drag:** zero hull builds across a 2 → 400 m drag, measured; the drag adds **1.1 ms** to the idle frame against a `< 12 ms` pin, because the coarse rung stays off the main thread.
- **A taste-pass slider:** ~2.5 ms — genuinely live, one frame with room to spare.
- Mid-tier phone: ×5–10 ⇒ 6.3–12.7 s. **UNVERIFIED** (no mobile device profiled); moot in v1 because the feature is desktop-fenced.

**Does the coarse rung tell the truth?** Measured at 55 m lift, 489 probes on a common lattice (A):

| pair | Spearman ρ | top-20 overlap | max \|ΔS\| |
|---|---|---|---|
| 12 m vs 3 m | 0.767 | **10/20** | 0.209 |
| 6 m vs 3 m | 0.910 | 15/20 | 0.185 |
| 1 m vs 3 m (1,957 probes) | **0.969** | 16/20 | 0.229 (mean 0.0054) |

Mean S is identical to 4 dp at every tier. ⇒ **the coarse FIELD is honest; the coarse TOP-K is not.** Show the sheet from R0; **grey the top-K list until R3 lands.**

**No spinner. Three states instead:** (1) a `READING THE MAP` chip only while MVT fetches are outstanding — the only leg longer than a frame and the only one that can fail; (2) the R0 sheet as its own progress indicator with a determinate `24 m → 3 m` pip; (3) the top-K list disabled and labelled `RANKING…` until R3. The only justified spinner is the explicit 1 m shortlist re-solve (§8 Q3).

**The worker is mandatory, not an optimisation:** even R0 (10.6 ms) plus prep (44.6 ms) exceeds a 16.7 ms frame, and R3 is 41 dropped frames.

**S6's `coarse-solve p95 < 33 ms` pin is NOT met at 12 m** (83 ms as built, 54 ms fused) and **IS met at 24 m (21 ms)**. Re-pin to 24 m. *(Corrected 2026-08-24d: browser-measured, the 24 m coarse rung costs **35–49 ms**, not 21 — `scripts/verify-bestspot.mjs:723`. It therefore **must not land on the main thread**, and the pin that actually holds is the one the shipped script asserts: **the drag adds < 12 ms to the idle frame**, measured **1.1 ms**. A wall-clock rung budget was the wrong pin; the frame-cost delta is the right one.)*

**1 m buys ρ = 0.969 and changes 4 of the top 20, for 6.7× the wall clock** (3,369 vs 501 ms on the same probe set). ULTRA is a shortlist tool, not a field tool. **Forbid ULTRA above 300 m radius**: 1 m @ 500 m is 1001² = 1,002,001 cells and costs ~12.2 s (extrapolated by cell count, UNVERIFIED as a run).

---

# 3. PARTIAL DATA

## 3.1 The headline: missing data does not read as "unknown". It reads as THE BEST SPOT ON THE MAP.

Measured (A), identical scene, identical track, centre cell, 1.7 m eye, a real 30 m ridge 500 m up-sun:

| scene | C | V | L | P | F | **S** | openSky rays | median Hg |
|---|---|---|---|---|---|---|---|---|
| ridge at 500 m, DSM out to 700 m (**truth**) | 1.000 | 0.087 | 0.242 | 0.602 | 0 | **0.0000** | 0/40 | +3.389° |
| same ridge, **DSM truncated at 350 m** | 1.000 | 0.994 | 1.000 | 1.000 | 0 | **0.6633** | **40/40** | −0.269° |
| genuinely open plain out to 700 m | 1.000 | 0.981 | 1.000 | 1.000 | 0 | 0.6613 | 40/40 | −0.137° |

**The truncated disc is indistinguishable from an open plain (0.6633 vs 0.6613), reports coverage 1.000, and claims open sky on all 40 rays.** Same shape at the rim: a cell 290 m up-sun scores **0.0467 with the 400 m collar and 0.6619 without it** — a 14× silent error, which is the measured justification for the collar existing.

**Root cause, precisely.** `known` is set by `sweepAzimuth` when the hull yields **any** forward vertex (verified `horizonSweep.ts:765`) — it means "the ray found ≥ 1 sample", not "the ray was swept to the trust radius". `C` inherits that. `openSky` is `code === SRC_TERRAIN && alt <= dipDeg + tol` (verified `horizonSweep.ts:774`) and **never asks how far the evidence reached**. There is no ray-reach channel anywhere in the contract. The FAR zone that §5 says answers the rest **does not exist**, so today every disc lies at its own rim.

## 3.2 Case by case

**(1) Terrain tiles not loaded over part of the disc.** `rasterizeTinGround` leaves uncovered cells at `ground = NaN`, `groundKnown = 0` (`localDsm.ts:297-299,462`); `sealDsm` propagates `SRC_NONE`; `sweepAzimuth`'s no-ground branch writes `NaN / Infinity / −1 / SRC_NONE / known=0 / openSky=0 / bandN=0` (verified `horizonSweep.ts:776-783`). Measured with the west half NaN'd, sunset az 287.6° straight into the hole:
- cell **inside** the hole → `unknown`, C = 0.000, 0/40 known. **Honest.**
- centre cell, rays run into the hole → `unknown`, C = 0.000. **Honest.**
- cell 200 m **east**, rays cross 200 m of known ground first → `scored`, **C = 1.000**, evidence truncated at 200 m. **Silent lie.**
- The hole makes the sweep *cheaper* (6.53 vs 10.23 ms/az). A hole never errors — it just answers.

**(2) MVT tiles missing or failed.** `vectorTiles.ts:611,627` — a non-ok response or a rejection sets `cache.set(key, "failed")`, and `ensureTile` returns early on `cache.has(key)` (`:607`), so **"failed" is permanent for the process**. FIFO eviction at `VECTOR.tileCacheMax = 56` drops the oldest parsed tile. `buildLandGrid` with **zero** sources costs 0.03 ms and returns every cell `unknown` (code 0), `soft 0.45`, **`hard = 1`** (verified `landcoverRaster.ts:182`) ⇒ **the water mask disappears and the solver will rank a cell in the middle of the Dnipro.** Measured class shares on a real 3 m/700 m grid: water 1.2 %, building 29.8 %, deck 1.29 %, **unknown 43.5 %** — an all-unknown grid is only 2.3× the normal unknown rate and will not stand out.

**(3) No enriched bake / no OSM buildings (most of the world).** Measured 3×3 z14 rings:

| site | bytes | building features | water | green | lines | areas |
|---|---|---|---|---|---|---|
| Dnipro centre | 1,063 KB | **558** | 18 | 960 | 1,065 | 359 |
| rural UA (33.15, 48.90) | **15 KB** | **1** | 7 | 2 | 26 | 23 |
| Everest | 29 KB | **0** | 0 | 13 | 7 | 11 |

Terrain-only disc, real track, 1.7 m eye: **`scored`, C = 1.000, V = 1.000, L = 1.000, P = 1.000, F = 0, openSky 40/40, S = 0.470** — uniform, warm, confident. With `green` landcover instead of `unknown`, **0.661**. §11's "single most dangerous failure mode" is confirmed and quantified: the number is **0.47–0.66, not 0.70**, and the disc reports 100 % coverage while doing it. S7's built-density prior is the fix and its input is free: buildings per km² straight off the parsed tiles (558/21 vs 1/21 vs 0).

**(4) Far-zone `marchTerrainBin` still building.** `planFeed.ts:282` marches `PLAN.terrainBinsPerFrame = 3` bins/frame over `PLAN.azBins = 120` ⇒ **40 frames ≈ 0.67 s** at 60 fps, interleaved with mesh sweeps so `ready` lands later. Each bin marches 60 → 30,000 m at growth 1.35 = 21 samples ⇒ 2,520 raycasts at 18–58 µs = **45–146 ms** of raycasting. `marchTerrainBin` calls `raiseBin` only when `sampled > 0` (`horizonProfile.ts:170-197`), so an unsampled bin stays `known = 0` — **that channel is honest**. But `heightAt` raycasts `tiles.group.children` and terrain tiles exist **only in-frustum**, so the far profile's coverage is a function of where the CAMERA looks. And §7 forbids lending `plan.profileBins` to this disc (the temp pin is not a plan anchor), so BEST SPOT must run its **own** 40-frame far march at the disc centre, on the main thread.

## 3.3 Does the disc refine as tiles stream in? **No. It is one-shot.**

Nothing in the shipped libs is incremental: `rasterizeTinGround` is a single call, `buildHulls` throws on an unsealed DSM (`horizonSweep.ts:298`), there is no version/epoch on the DSM or the grid, and nothing listens for tile arrival.

**It should refine, and every precedent is in-repo:**
- `minimapFeed.ts:160-161` — `if (builtVersion !== opts.vtiles.version() || walked > MINIMAP.rebuildDistM) { … rebuild … }`. A monotone integer compared per frame. Copy this.
- `streetNames.ts:362` — same idiom.
- `planFeed.invalidate()` (`planFeed.ts:454`) called from `StylizedTiles.ts:4721-4725` **only after enriched writes have been quiet for `PLAN.reseatQuietFrames = 90` frames**. That is the debounce shape.
- Terrain streaming has **no version counter** today — only three `tiles.addEventListener("load-model", …)` listeners (`imageryGround.ts:594`, `buildings.ts:237`, `enrichedBuildings.ts:444`) to hang a 3-line counter on.

## 3.4 What S3 must build for refinement (six items)

1. **`terrainEpoch`** — a counter bumped by a new `load-model` listener; **`vectorVersion`** — `vtiles.version()` (exists). `bestSpotFeed` holds `builtTerrainEpoch` / `builtVectorVersion`.

   > **TWO EPOCHS WAS THE BUG. THE SHIPPED SET IS FOUR, PLUS A FIFTH ON A DIFFERENT AXIS** *(corrected 2026-08-24d against `bestSpotFeed.ts:685-693`)*. Compared per frame, all monotone integers, never a deep compare: **`terrainEpoch`** · **`vectorVersion`** (`vtiles.version()`) · **`seatEpoch`** (`seatState().epoch`) · **`builtEpoch`** — bumped by BOTH building tilesets' `load-model`/`dispose-model`. **`builtEpoch` is why the first browser run painted a constant field**: a disc solved before the buildings streamed never re-solved, and no epoch was watching them, so every cell saw the same open horizon and all 31,417 scored cells came back at score byte 187. It also makes the `"no-built-geometry"` refusal self-healing rather than sticky (~1.5 s after the tiles land).
   >
   > Separately and on a different axis: **`sourcesEpoch`** (`bestSpotFeed.ts:452,722`, `bestSpotWorker.ts:213`) is the **T1 hull-cache key** — this document names no such channel. It is the S6 fix: `solveRung` called `buildDsm` unconditionally and the hull cache is keyed on `dsm.ground` IDENTITY, so a fresh-but-identical DSM invalidated every hull and a 2 → 400 m lift drag paid 39 hull builds against a pinned 0. Keying T1 on `${sourcesEpoch}|${tiles.length}` — an epoch that moves only when something actually STREAMED — takes it to zero.
2. On change → mark T0 stale → **debounce `BESTSPOT.rebuildQuietFrames = 90`** (mirror `PLAN.reseatQuietFrames`, ≈1.5 s) → re-solve. Without the debounce, a streaming burst triggers a 680 ms solve every frame.
3. **Re-climb the ladder from R0**, do not restart at R3.
4. **Rebuild the DSM, never accumulate it.** `rasterizeTinGround` merges by **MAX** for order-independence (`localDsm.ts:462`, docstring `:394-396`) — correct for a fixed tile set, but it means **a refined (lower) LOD can never bring the ground back down**. Terrain refinement therefore requires a fresh `createLocalDsm` (16 ms — cheap; the 144 ms hull rebuild is the real cost).
5. **Add `reachM`** — the along-ray distance of the last KNOWN slot — to `RaySweepOut` / `RayEvidence`, and **gate `openSky` on it** (`openSky` requires `reachM ≥ min(trustRadiusM, gridReach)`). Publish per-cell `minReachM` on `CellScore`. Without it, refinement will silently *lower* scores as data arrives and the owner will read that as a regression. This channel also makes the collar's value provable (0.0467 with vs 0.6619 without).
6. **Add a tile-coverage count.** The disc footprint needs ≤ 4 z14 tiles (z14 at 48.46° is 1,621.6 m; the 1,800 m box at (b) is inside `ensureRing(pin, 1)`'s guaranteed 1,622 m). Below a floor of parsed tiles, **refuse** — render the whole disc UNMAPPED — rather than paint an all-`unknown` grid with `hard = 1` everywhere.

### SHIPPED — the honesty subsystem is bigger than the six items above *(added 2026-08-24d against the shipped code)*

**(a) THERE ARE THREE REFUSAL REASONS, NOT ONE.** This document documents only the tile count. `bestSpotWorker.ts:338` types all three, and each is a genuinely different failure:

| reason | fires when | why it is not the others |
|---|---|---|
| **`"no-landcover"`** | the `LandGrid` has **zero painted cells** (`bestSpotSolver.ts:690-700`) | **Zero painted is a FETCH FAILURE, not a rural site.** `vectorTiles` caches a failed fetch as permanently `"failed"`; `buildLandGrid` with zero sources costs 0.03 ms and returns every cell `unknown` — which carries **`hard = 1`** (`landcoverRaster.ts:182`), so the water mask disappears and the top-K will rank a cell in the middle of the Dnipro. A genuinely rural disc is NOT this case: Everest's 3×3 z14 ring still paints 13 green features and rural UA paints 7 water + 26 lines. Only a fetch failure paints nothing at all. |
| **`"no-tiles"`** | parsed z14 tiles < `BESTSPOT.minTilesForSolve` | item 6 above — the absolute floor on the tiles the disc actually OVERLAPS, not a coverage test. |
| **`"no-built-geometry"`** | a disc with **DENSE parsed MVT and ZERO building meshes** (`bestSpotWorker.ts:1362-1383`) | The sibling of item 6 that item 6 missed. Withholding open-sky credit (the prior, (b) below) is the right answer where the horizon is set by SKY — and it is **not enough over a city with real relief**, because every ray hits terrain, credit is never withheld, and the disc still paints warm, uniform and confident. **Measured at the owner's hero pin: 54.74 buildings/km² in the parsed tiles, zero meshes flattened, all 31,417 cells at score byte 187** (S ≈ 0.6991) with a top-8 spread of 0.4 %. That is §11's "single most dangerous failure mode" verbatim, and no ray bookkeeping fixes it, because **the missing evidence is the obstruction MASS ITSELF.** |

All three render the whole disc UNMAPPED and never throw: UNKNOWN is a render class the surface already knows how to draw, and a thrown solve is a blank screen with no explanation. `"no-built-geometry"` **self-heals** via `builtEpoch` ~1.5 s after the building tiles land, and stays refused with `▦ 3D DETAIL` off — the honest answer to "solve a city I have switched the city off in". Panel copy, `BestSpotPanel.tsx:180`: `⚠ NO BUILDING GEOMETRY REACHED THIS DISC — TURN ▦ 3D DETAIL ON, OR WAIT FOR TILES`.

**(b) THE BUILT-DENSITY PRIOR HAS A DERIVED FLOOR AND IT IS NOT A SCORE PENALTY.** §3.2 case 3 names the fix but not its number or its mechanism.

- **Floor `BESTSPOT.builtDensityFloorPerKm2 = 1`** (`tuning.ts:3020-3045`), derived as the **GEOMETRIC MEAN of the only two non-zero populations anyone measured**: √(26.6 × 0.048) = **1.13**, rounded down to 1.0. That is 26.6× of headroom under the surveyed population (Dnipro centre, 558 buildings over ≈21 km²) and 21× over the unsurveyed one (rural UA, 1) — as far from both as the data allows. `parseTile` does `if (!layer) continue`, so "tile fetched, zero buildings" is byte-identical to "OSM never surveyed here"; density is the ONLY signal available and it is free off tiles the disc already parsed.
- **MECHANISM — it is the COVERAGE channel, not a multiplier** (`bestSpotSolver.ts:670-686`). UNKNOWN is a render class and never a low score, so **the prior may not multiply `S` down — it has to withdraw the CLAIM.** `openSky` is exactly the claim that needs building data ("nothing stands between you and the horizon"); with no survey behind it that sentence is not a measurement, so the ray is **not credited as evidence**: `known` is withheld, `C` falls, and the cell lands in the UNKNOWN render class through machinery that already exists (`:1094-1101`).
- **THE ASYMMETRY IS THE WHOLE POINT.** A ray whose horizon is set by **REAL RELIEF is untouched**. That is why Everest and a flat rural pin come back differently **from one rule**: Everest's rays are not `openSky` (a measured ridge sets them), so the disc still scores, terrain-only, with real relief — while the flat rural pin goes UNKNOWN. Measured rural: 1,225,263 ray visits withheld, fraction of cells with `S > 0.6` = **0.0000** (pre-fix: a uniform 0.470–0.661).

**(c) `reachM` NEEDED A POLICY LAYER ON TOP OF THE CHANNEL.** Item 5 ships the channel and the `openSky` gate; they take the §3.1 truncation fixture from 0.6633 to 0.5530. **`BESTSPOT.refuseBelowReachM = 400`** (`tuning.ts:3047-3070`) is the policy — *how far must a cell have looked before its answer is worth painting* — and it withdraws the claim entirely: the same centre cell goes **0.5530 → 0.0000**, `verdict: unknown`, `unmappedFrac` 0.000 → 0.723.

**THE CEILING IS `collarM`, AND THAT IS A GEOMETRIC FACT, NOT TASTE.** On a fully-mapped disc a RIM cell has exactly the collar's worth of evidence up-sun and no more, so any threshold above the collar refuses the rim of a disc with nothing wrong with it. Calibrated on a fully-mapped 300 m disc (31,417 scored cells):

| `refuseBelowReachM` | 200 | 380 | **400** | 420 | 500 |
|---|---|---|---|---|---|
| cells refused | 0 | 0 | **0** | 175 | 3,027 |

It is the SAME NUMBER as `collarM` and must stay so — a taste pass that moved the collar and not this would start refusing the rim of a perfectly good disc. `as const` cannot self-reference, so **the equality is held by a test** (`bestSpotHonesty.test.ts`, *"the ceiling IS the collar"*), which is also the only form that can FAIL when someone edits one of them.

---

# 4. ALL FOUR KINDS — **YES, one code path.** Five branch points, all in one file.

`grep -n "kind\|Body\.\|worth"` over the five shipped libs (A): `horizonSweep.ts` → **0 hits**. `localDsm.ts` → 0 (one comment). `landcoverRaster.ts` → only `f.kind`, the MVT *feature* kind, unrelated. `bestSpotMetric.ts` → **one hit, line 791: `clamp01(track.worth)`** (verified). Every branch lives in `bestSpotTrack.ts`:

| # | site | what it does |
|---|---|---|
| 1 | `bestSpotTrack.ts:215`, `:500` | `kindBody(kind)` → `Body.Sun` vs `Body.Moon` |
| 2 | `bestSpotTrack.ts:217` | `isRiseKind(kind)` → `SearchRiseSet` direction `+1 / −1` |
| 3 | `bestSpotTrack.ts:522-523` | `upSign` / `downSign` — which way in TIME the two window marches walk |
| 4 | `bestSpotTrack.ts:404-409` `rhoDegAt` | sun radius / AU distance vs moon radius / km distance |
| 5 | `bestSpotTrack.ts:167-171` `worthAt` | sun → exactly `1`; moon → `moonPhaseIntensity(α) · twilightGate(sunAlt)` |

(plus `moonWorth`'s default parameter `kind = "moonrise"` at `:185`.)

**Explicitly NOT branches — verified by measurement (A):**

| the plan asked about | truth |
|---|---|
| azimuth sweep direction | **Data, not kind.** Decided by `gridU[n−1] > gridU[0]` + a reverse (`bestSpotTrack.ts:599-603`). All four Dnipro kinds emit azimuth-ascending samples. Sydney sunrise AND sunset are azimuth-ascending but **reverse-chronological**. No hemisphere branch exists. |
| `az*` min vs max | **Direction-agnostic.** `cellScore` takes the LOWEST `altAppDeg` with `f ≥ 0.5` (verified `bestSpotMetric.ts:730`); `descending` (`:699`) is derived from the samples and only picks the interpolation neighbour. |
| the window | Identical shape for all four: airless +4° top, `alt(t0) − 3ρ` bottom, ±3° shoulders, 0.25°/0.5° lattice. Measured altApp spans: sunrise −3.48 → +6.77 · sunset +6.79 → −3.50 · moonrise −3.16 → +5.82 · moonset +5.64 → −3.01. |
| disc radius | Not a branch — a **per-sample** `rhoDeg`. Sun 0.2635–0.2636°, moon 0.2468–0.2478° (6 % smaller ≈ 0.6 % of an azimuth step). |
| missing moonrise days | Not a branch. `eventInstantMs` returns `null` when `SearchRiseSet` finds nothing in the half-open local-day window (`bestSpotTrack.ts:222-225`). Pinned at `bestSpotTrack.test.ts:153` as 366 sunrises vs 353 moonrises; measured **2 NULL days in 60 consecutive moonrises**. |
| the metric | Reads `track.worth` and nothing else. `bestSpotTrack.test.ts:367` already loops all four `KINDS` through one assertion pair. |
| GRAZE | τ is within **2.1 %** across all four kinds on identical geometry; rise vs set differ by **0.03 %** (B). |

**The two things that ARE different in practice, neither a code branch:**

1. **K, and therefore cost.** sunrise 40 · sunset 40 · **moonrise 48 · moonset 52** ⇒ a moonset disc costs **30 % more** than a sunset one (measured end-to-end sweep at (a): 544 / 588 / 798 / 810 ms). **Latitude matters more:** Tromsø sunrise K = **85 = 2.1×**.
2. **`worth` blanks the moon map most nights.** 30 consecutive days at Dnipro: moonrise `worth` **min 0.0003, median 0.0290, max 0.8639**, 29/30 days with a track. On 2026-08-24: moonrise 0.0938, moonset 0.0770; both sun kinds exactly 1.0000. Because `M` multiplies (verified `bestSpotMetric.ts:791`), the best possible moon cell on a **median** night scores `0.029 × 0.7 ≈ 0.020` — **25× below the plan's own legibility floor.** The moon map is effectively black **~26 nights in 30**. → §8 Q1.

**One test to add:** the four-kinds table above, pinned at 4 dp, plus τ within 10 % across Dnipro/Tromsø/Sydney × 4 dates (measured spread 6.5 %) and across the 0.25°/0.05° lattices (measured 0.8 %).

---

# 5. THE TUNING LAYER (owner requirement vii — hard architectural requirement)

## 5.1 The audit: 30 scoring numbers are reachable today, 37 are not

The unreachable ones include **every gate edge, the whole accessibility ladder, the moon-worth curve, and the `A_soft` exponent** — four of the seven things a taste pass touches first (C).

Reachable (30): `CellScoreOptions` `{eyeM, liftM, refractionK, trustRadiusM, minCoverage, discColumns}` (`bestSpotMetric.ts:597-627`) · `NotchOptions` ×4 (`:420-436`) · `BestSpotWeights` ×4 (verified `bestSpotTypes.ts:267-280`) · `EventTrackOptions` ×8 (`bestSpotTrack.ts:334-351`) · `SweepOptions` ×2 · `BuildHullsOptions` ×3 · `TinRasterOptions` ×2 · `SealOptions` ×1.

Unreachable (37), all module-scope reads — every one verified this session:

| Constant | file:line | value | why unreachable |
|---|---|---|---|
| `V_GATE_LO` / `V_GATE_HI` | `bestSpotMetric.ts:97,98` | 0.15 / 0.75 | read inside `visibilityGate(v)` at `:214` — no parameter |
| `L_CEIL_DEG` | `:102` | 5° | **half-wired**: `contactLowness(…, ceilDeg = L_CEIL_DEG)` at `:207` IS a parameter, but `cellScore` calls it with **two** arguments. The parameter exists and is dead. |
| `DEPTH_NEAR_REF_M` | `:106` | 30 m | read inside `depthOfDistM` at `:175-176` |
| `NOTCH_CLEARANCE_RADII` | `:110` | 1 | read at `:571` — **the one `NOTCH_*` const that missed `NotchOptions`** |
| `HALF_DISC` | `:126` | 0.5 | read at `:730`, `:749`, `:750` |
| `A_soft` exponent | `:790` | 0.5 | **not even a named constant** — an inlined `Math.sqrt(...)` |
| `WORTH_*` ×5 | `bestSpotTrack.ts:123,124,131,132,137` | +0.5° / −6° / +6° / −12° / 0.25 | module-private, no `EventTrackOptions` twin |
| `TRACK_MIN_WEIGHT_FRACTION` | `bestSpotTrack.ts:260` | 1e-3 | read at `:313,:315` |
| `AERIAL_MIN_M` | `bestSpotTypes.ts:229` | 5 m | read at `landcoverRaster.ts:376` |
| `GROUND` ladder, 11 rows × (hard, soft) | `landcoverRaster.ts:182-194` | see §5.5 | module const **and baked into `LandGrid.softQ` at paint time** (`:250`, `:530`) |
| `DEMOTE_K` | `landcoverRaster.ts:166` | 0.7 | same |

Plus 8 taxonomy sets (`MAJOR_ROAD_CLASSES:197`, `PATH_CLASSES:204`, `DECK_LINE_CLASSES:207`, `ACCESS_DENIED:210`, `BLOCKED_LANDUSE:214`, `PITCH_LANDUSE:224`, `GREEN_SUBSET:574`, `rail → blocked` at `:612`) — taste-adjacent but not numbers.

## 5.2 The profile object

**Home: a new pure lib `src/lib/geo/bestSpotScoring.ts`** — three-free, store-free, **zero imports**, so vitest reproduces it from nothing and the worker imports it with no `components/` edge. `tuning.ts` re-exports it (`export { BESTSPOT_SCORING_V1 } from "../../lib/geo/bestSpotScoring"`) — the `WGS84_A/B` precedent at `tuning.ts:28`, blessed by `globe-tuning.md:25-27`.

> **Why the value lives in `lib/`, not in `tuning.ts`.** All 52 tuning groups are `as const`. `as const` on a nested profile makes every leaf a literal type — fine for a `readonly` interface, hostile to a `DeepPartial` merge and to a `Record<LandClass, …>` ladder. And `bestSpotMetric.ts:592-596` already states why the kernel refuses a tuning import: *"§10 S1 is a pure-lib slice, and the whole kernel must be reproducible from a test fixture."* Value in `lib/`, discoverability doc-line in `tuning.ts`.

```ts
export const BESTSPOT_SCORING_VERSION = 1;

export interface BestSpotScoring {
  readonly version: number;

  /** Registry. cellScore iterates THESE KEYS — adding a term is one field + weight 0. */
  readonly weights: Readonly<Record<"v" | "l" | "p" | "f", number>>;   // .15 .30 .25 .30

  readonly gates: {
    readonly vGateLo: number;        // 0.15
    readonly vGateHi: number;        // 0.75   clamped >= vGateLo + 0.05
    readonly halfDiscFrac: number;   // 0.50
    readonly minCoverage: number;    // 0.50   HONESTY: effective = max(0.5, patch)   <- was missing
  };

  readonly curves: {
    readonly lCeilDeg: number;            // 5
    readonly depthNearRefM: number;       // 30
    readonly depthTrustRadiusM: number;   // 3000
    readonly accessSoftExponent: number;  // 0.5   (the inlined Math.sqrt at :790)
  };

  /** THE FRAMING GROUP — Agent B's GRAZE. Replaces the old `framing.silRequiresOcculting`,
   *  which the area arm subsumes. */
  readonly graze: {
    readonly reliefLoDeg: number;       // 0.05
    readonly reliefHiDeg: number;       // 0.40   (~1.5 rho)
    readonly scaleRadii: number;        // 1.75
    readonly areaArm: boolean;          // true
    readonly tangentArm: boolean;       // true
    readonly tangentHalfWidthRadii: number;  // 1
    readonly conf: Readonly<Record<OccluderSrc, number>>;
        // terrain 1.00 · building 0.90 · deck 0.90 · tree 0.45 · none 0
  };

  readonly gap: {
    readonly shoulderSpanDeg: number;   // 3
    readonly salienceFloorDeg: number;  // 0.1
    readonly maxDepthDeg: number;       // 3
    readonly maxWidthDeg: number;       // 2
    readonly clearanceRadii: number;    // 1   ← today unreachable (:571)
    readonly shoulderQuality: "min" | "mean" | "off";  // "min"
  };

  readonly trackWeight: {
    readonly altScaleDeg: number;       // 2.5
    readonly horizonCeiling: boolean;   // true — the AS-BUILT fix, as a KILL SWITCH not a number
  };

  readonly worth: {
    readonly plateauHiDeg: number;      // +0.5
    readonly plateauLoDeg: number;      // -6
    readonly rampHiDeg: number;         // +6
    readonly rampLoDeg: number;         // -12
    readonly floor: number;             // 0.25   the TWILIGHT-GATE floor, inside bestSpotTrack
    readonly effectiveFloor: number;    // 0.35   owner ruling R7, the COMPOSITION floor   <- was missing
    readonly mode: "multiply" | "badge";        // see §8 Q1
    readonly phaseCurve: "ks1991" | "illumFrac" | "off";  // DEV-only A/B, see §5.5
  };

  readonly access: {
    readonly aerialMinM: number;        // 5   clamped >= 2
    readonly demoteK: number;           // 0.7
    readonly soft: Readonly<Record<LandClass, number>>;   // 11 rows — SOFT ONLY
  };

  readonly quadrature: { readonly discColumns: number };  // 8
}

export type BestSpotScoringPatch = DeepPartial<BestSpotScoring>;
export function resolveScoring(patch?: BestSpotScoringPatch | null): BestSpotScoring;  // frozen, complete
export function sanitizeScoringPatch(raw: unknown, opts: { dev?: boolean } = {}): BestSpotScoringPatch;
export function scoringHash(s: BestSpotScoring): string;   // FNV-1a over canonical JSON, toPrecision(12)
export function scoringDiff(s: BestSpotScoring): { path: string; from: unknown; to: unknown }[];
export function scoringInvalidation(prev, next): InvalidationClass;
export function scoringLeafPaths(): string[];              // every leaf, for the EVERY-FIELD-IS-LIVE walk
export const BESTSPOT_SCORING_VERSION = 1;                 // bumped only when a MEANING changes
export const INVALIDATION_RANK: Readonly<Record<InvalidationClass, number>>;  // the order IS the contract
export const CLASS_OF: Readonly<Record<string, InvalidationClass>>;           // §5.4's table, frozen
export const BESTSPOT_PRESETS: Record<string, BestSpotScoringPatch>;
export const BESTSPOT_PHYSICS, BESTSPOT_SAFETY, BESTSPOT_HONESTY;  // separate — no key path from a patch
```

*(Corrected 2026-08-24d against `bestSpotScoring.ts`.)* **`sanitizeScoringPatch` takes a second argument, and that is what makes the DEV-seam / persisted-sanitizer split expressible at all** (`:650-653`, applied at `:696-704`): with `{ dev: true }` the console seam ACCEPTS `worth.phaseCurve: "illumFrac"` so the owner can see the difference in a session; without it the persisted sanitizer REFUSES it with a warning and — deliberately not a throw — keeps the rest of the saved tune. Four exports this section omitted are now listed: `INVALIDATION_RANK` (`:80`), `scoringLeafPaths` (`:753`), `CLASS_OF` (`:522`), `BESTSPOT_SCORING_VERSION` (`:63`).

> **TWO FLOORS ARE NAMED `floor` AND THEY ARE DIFFERENT NUMBERS** (`bestSpotScoring.ts:40-53`) — conflating them is the obvious mistake and the doc comment exists to stop it.
> · **`worth.floor` (0.25)** is the **TWILIGHT-GATE** floor: the value `twilightGate(sunAlt)` ramps down to when a moon event happens far outside the photographic twilight band. It shapes `worth` ITSELF, **inside `bestSpotTrack`**, and it is a shipped number (`WORTH_GATE_FLOOR`).
> · **`worth.effectiveFloor` (0.35)** is owner ruling **R7** and it shapes how the finished `worth` ENTERS THE PER-CELL PRODUCT: `M_eff = effectiveFloor + (1 − effectiveFloor)·worth`.
> Raising `worth.floor` compresses the honest signal (§8 Q1 option (b), which the owner did NOT pick); raising `worth.effectiveFloor` compresses only the RENDERED dynamic range and leaves the ranking **inside** a night untouched.

**Merge rules.** Objects deep-merge; **`Record` maps replace key-by-key** (a partial ladder patches only the classes it names). Unknown keys are dropped silently (`sanitizeViewPrefs`, `prefs.ts:77-121`). `resolveScoring` returns a frozen, fully-populated profile; there is no partially-resolved state.

**Signature migration.** `CellScoreOptions` keeps only the SITUATION (`eyeM`, `liftM`, `refractionK`) and gains `scoring: BestSpotScoring`. `trustRadiusM` / `minCoverage` / `discColumns` / `notch` / `weights` move into the profile. `BESTSPOT_METRIC_DEFAULTS` stays exported as `{ eyeM: 1.7, liftM: 0, refractionK: 0.13, scoring: BESTSPOT_SCORING_V1 }`.
**Measured breakage: exactly one test line** — `bestSpotMetric.test.ts:844` (verified: `weights: { v: 0.3, l: 0.6, p: 0.5, f: 0.6 }`). Every `{ ...BESTSPOT_METRIC_DEFAULTS, eyeM, liftM }` spread (6 sites in `bestSpotTrack.test.ts`, 1 in `bestSpotComposition.test.ts:157`) keeps working.

## 5.3 The term buffer — the load-bearing change

**The fused pass must write a per-cell TERM VECTOR, not `S`.** A separate trivial COMPOSE pass produces `S` and the RG8 texture. **Do not let the solver ship a fused pass that writes `S` directly — retrofitting the term buffer afterwards is exactly the "substantial architecture rework" the owner ruled out.**

Layout, **75 B/cell — 18 × f32 + 3 × u8** *(corrected 2026-08-24d against the shipped code, `bestSpotSolver.ts:236-247` `TERM_BYTES_PER_CELL = 75`; the 59 B layout below it is superseded)*:

| bytes | fields |
|---|---|
| 16 | `tauTerrain, tauBuilding, tauDeck, tauTree` (f32) — already relief- and depth-weighted, with the per-source CONFIDENCE deliberately NOT applied |
| 24 | `notchFloorDeg, notchDepthDeg, notchWidthDeg, rhoStar, notchQL, notchQR` (f32) — the GAP's raw GEOMETRY plus its two shoulder qualities, **uncombined** |
| 24 | `v, l, p, c, altStar, dStar` (f32) |
| 4 | `grazeDistM` (f32) — distance of the max-contributing edge, for the panel copy |
| 4 | `minReachM` (f32) — the honesty channel (§3.4 item 5) |
| 3 | `srcStar, cls, flags` (u8) — `cls` is the `LAND_CODE` byte so `accessAt` is recomputable |

**WHY 75 AND NOT 59: THE INVALIDATION TABLE WAS RIGHT AND THE BUFFER WAS THE LIE.** The 59 B layout stored the notch as a **finished product** (`notchRaw`, `notchQ`), which FROZE `gap.salienceFloorDeg / maxDepthDeg / maxWidthDeg / clearanceRadii / shoulderQuality` at solve time — while §5.4's `CLASS_OF` files all five as **recompose**. Paying 16 B/cell for the notch GEOMETRY and splitting `notchQ` into `notchQL`/`notchQR` makes all five true. The same discipline explains the τ block: confidence is withheld so `graze.conf.*` and `graze.scaleRadii` stay a recompose instead of a 177 ms rescore. The buffer stores numbers WITHHELD, shoulders UNCOMBINED, `altStar` rather than `L`, and `cls`+`flags` rather than a resolved `soft` — every one of those is a leaf the table promises is cheap.

**3.03 MB @ 201² · 8.42 MB @ 335² · 27.1 MB @ 601²** (was 2.38 / 6.62 / 21.3). Noise against 101 MB of hulls. §5's own 12 accumulators already cost 48 B/cell — this is **+27 B/cell, not a new memory tier**, and it is the difference between a documented contract and a lie in a table.

Compose was modelled at ~15 multiply-adds/cell ⇒ 0.272 ms at 201²; **MEASURED, it is ~2.5 ms at 201²**, pinned `< 5` reference-ms (`bestSpotSolver.test.ts:872,898-911`). The model missed one `exp`, one `sqrt`, two `smoothstep`s and the 3 MB streamed across fourteen typed arrays — a hand-inlined flattening buys only 1.3× (1.97 ms), so the cost is bandwidth, not kernel calls, and paying it back would cost the one-implementation-two-callers property the file is built on. **The architectural claim is untouched: > 200× cheaper than the cheapest re-solve, inside one frame.**

Optional upgrade (UNVERIFIED, arithmetic only): bucket τ by 4 distance decades (<100 / 100–500 / 500–1500 / >1500 m) → 16 f32 = 64 B for the τ block, total ~104 B/cell = 4.2 MB @ 201². That moves `curves.depthNearRefM` / `depthTrustRadiusM` from RESCORE to RECOMPOSE. Not recommended for v1: rescore is 177 ms, which is fine on slider *release*.

Two cheap conversions that move whole GROUPS into the recompose class — **do them in the same slice or they will never be done**:
- **(a)** `LandGrid` carries `cls: Uint8Array` + `flags: Uint8Array` (bit0 demoted, bit1 accessDenied) and resolves `soft` at READ time from the profile. Kills `softQ`'s baking (`landcoverRaster.ts:250,:530`). Same byte count. **Re-raster (2.2–31 ms) → recompose.**
- **(b)** `EventTrack` gains `sunAltAtT0Deg` + `moonPhaseAngleDeg` so the whole worth curve is recomputable without touching the ephemeris. **+2 numbers per disc. Rebuild → recompose.**

## 5.4 The invalidation-class table — table-driven, and the table IS the contract

```ts
type InvalidationClass = "repaint" | "recompose" | "reweigh" | "rescore" | "resweep" | "rebuild";
const CLASS_OF: Record<string /* leaf path */, InvalidationClass> = { … };
```

The diff walker looks up each changed leaf path and returns the **strongest** class. **A path with no entry defaults to `"rebuild"`** — fail-safe: a new field is slow, never wrong. A test asserts every leaf of `BESTSPOT_SCORING_V1` has an entry.

*(Costs corrected 2026-08-24d: every `0.272` below is measured at **~2.5 ms**. The CLASSES are unchanged — the shipped `CLASS_TABLE` at `bestSpotScoring.ts:450-520` agrees with this table row for row.)*

| profile path | class | cost @ 3 m/300 m |
|---|---|---|
| `weights.*` | **recompose** | **~2.5 ms** |
| `gates.vGateLo` / `vGateHi` | recompose | ~2.5 |
| `curves.lCeilDeg`, `curves.accessSoftExponent` | recompose | ~2.5 |
| `graze.scaleRadii`, `graze.conf.*` | recompose | ~2.5 (τ is stored split by source, confidence withheld) |
| `gap.salienceFloorDeg` / `maxDepthDeg` / `maxWidthDeg` / `clearanceRadii` / `shoulderQuality` | recompose | ~2.5 — **only because the buffer stores the notch GEOMETRY, §5.3** |
| `access.soft.*`, `access.demoteK`, `access.aerialMinM` | recompose **after §5.3(a)** | ~2.5 (else re-raster 2.2–31) |
| `worth.*` incl. `worth.floor` **and `worth.effectiveFloor`** | recompose **after §5.3(b)** | ~2.5 (else rebuild) |
| honesty `gates.minCoverage` (clamped ≥ 0.5) | recompose | ~2.5 |
| `render.*` (ramp id, alpha curves, contour interval, rim) | **repaint** | **<0.1 ms** |
| `trackWeight.altScaleDeg`, `trackWeight.horizonCeiling` | **reweigh** | **4.27 ms** (+1.62 MB per-(cell,ray) `f` byte cache; ON at cellM ≥ 3, OFF at 1 m) |
| `curves.depthNearRefM` / `depthTrustRadiusM` | **rescore** (P is recompose, but GRAZE's Depth is baked into τ) | **177 ms** |
| `graze.reliefLoDeg` / `reliefHiDeg` / `areaArm` / `tangentArm` | rescore | 177 ms |
| `quadrature.discColumns`, `gates.halfDiscFrac`, `gap.shoulderSpanDeg` | rescore | 177 ms |
| scene time (within day) | — | **0 ms** |
| **lift `liftM`, eye `eyeM`** | **resweep (T1)** | **343 ms** |
| **day, kind** | **rebuild (T0.5)** | **490 ms** |
| radius, cellM, centre, `refractionK`, `earthRadiusM`, `includeCanopy`, `azStepDeg`, `topAltDeg`, … | **rebuild (T0)** | **548 ms** warm |

**Every taste knob is recompose, reweigh or repaint. The rescore rows are 177 ms — acceptable on slider release, not during a drag. Nothing needs an architecture change to re-taste.**

## 5.5 The non-tunable block — three groups, three different reasons

These have **no key path from the patch**; the deep-merge literally cannot reach them.

**`BESTSPOT_PHYSICS` — tuning them makes the answer WRONG, not different.**
`refractionK 0.13` (folded into **three** places that must agree: the hull's `drop = (1−k)/2R` at `horizonSweep.ts:302`, the dip anchor in `L` at `bestSpotMetric.ts:775`, and the track's dip at `bestSpotTrack.ts:506` — and it is also `PLAN.refractionK`, `tuning.ts:2784`, used by the shipped planner; forking it recreates "two conventions that look alike", this repo's most expensive recurring bug class). `earthRadiusM R_MEAN_M`. The astronomical `Refraction("normal", …)` (skipping it is the measured **0.6243° = 2.37-solar-radii** F2 blocker). `SOFT_Q 200` (verified `landcoverRaster.ts:160` — chosen so every ladder rung and its ×0.7 demote is exactly representable). `SRC_*`, `LAND_CODE` (wire codes crossing `postMessage`). `oddSpanCells` parity (verified `localDsm.ts:203`; the named bug class — 23 of 30 canonical specs were EVEN, offsetting the centre by `cellM/2`). Paint order `green→landuse→water→road→path→deck→building` (`landcoverRaster.ts:18-23`: *"Reorder these and the feature sends its user into the river"*). `EDGE_SLACK 1e-3`, `BARY_EPS 1e-9`, the `1e-9` ascent eps, the `1e-6` log clamp, the cosAlt floor `0.05`.

**`BESTSPOT_SAFETY` — tuning them sends a person somewhere dangerous.**
- **`GROUND[*].hard` — all 11 bits** (verified `landcoverRaster.ts:182-194`): `water 0 · building 0 · blocked 0 · rest 1`. Flipping `water.hard` makes the top-K tell a photographer to stand in a river. `blocked` covers military/industrial/railway — **C6-relevant**. The **soft** values ARE tunable; only the bits are locked.
- **`access.aerialMinM` floor ≥ 2 m.** Below ~2 m the R1 drone rules apply to a standing person, water stops masking, and the map sends you into the Dnipro. Clamped, not banned.
- **`graze.conf.tree` is clamped ≤ 0.6.** Raising a tree to a building's confidence lets framing fire on fiction: 151,046 of Dnipro's 161,823 canopies are seeded scatter, only 628 surveyed (plan §8). *(Note: this REPLACES the old hard `isBuiltSrc` gate — `isBuiltSrc` stays exported and unchanged, because it is still the right predicate for the panel's "BEHIND A BRIDGE" copy.)*
- **`worth.phaseCurve: "illumFrac"` is DEV-only** — accepted by the DEV seam so the owner can see the difference, **refused by the persisted sanitizer** with a console warning. It reintroduces "a quarter moon is 50 %" when Krisciunas–Schaefer says ~9 %.

**`BESTSPOT_HONESTY` — asymmetric clamps: may become MORE honest, never less.**
- `minCoverage`: `effective = max(0.5, patch)`. Raising it is legitimate taste (more UNKNOWN ink); lowering it is a lie. (verified `bestSpotMetric.ts:757` — *"UNKNOWN is a render class, NEVER a low score"*.)
- `trackWeight.minWeightFraction`: `effective = max(1e-3, patch)`; not exposed at all.
- `gates.vGateHi − vGateLo ≥ 0.05`: `smoothstep` degenerates to a hard step when `edge1 ≤ edge0` **without throwing**, so this must be an active clamp, not a comment. A hard `V` gate would delete every silhouette shot.
- `openSkyTolDeg`, `nearClipM`: evidence-quality thresholds inside the sweep. Stay `SweepOptions`, out of the profile.

## 5.6 The hot-swap seam

```js
__globe.bestSpot()                                        // { scoring, hash, diff, verdictCounts, lastClass, timings }
__globe.bestSpotSheet()                                   // the LIVE material + textures + per-child renderOrder
__globe.bestSpotField()                                   // the PUBLISHED RG8 pack, by reference — never a recompute
__globe.bestSpotTuning({ weights: { p: 0.40, f: 0.15 } }) // deep-merge -> resolve -> persist -> re-score
__globe.bestSpotTuning("depth-forward")                   // a named preset
__globe.bestSpotTuning(null)                              // reset to shipped default, clear the patch
__globe.bestSpotTuning.export()                           // paste-ready TS: the patch AND the full profile
__globe.bestSpotTuning.ab(A, B)                           // rank delta + Spearman rho + top-10 survival
```

**THE TWO READ PROBES ARE NOT CONVENIENCES, AND WHY MATTERS** *(added 2026-08-24d — `StylizedTiles.ts:2170` and `:2181`)*. **`window.__globe` exposes no `scene`**, so without them nothing under `scripts/**` can reach the sheet at all — which is exactly how **seven of S4's "read the LIVE material" done-checks came to live only in vitest, asserting against the constructor arguments that built the material rather than the shipped state** (the `__globe.ultraLook` lesson, again). `bestSpotSheet()` answers them against the real objects; `bestSpotField()` hands out the same pack the GL sheet uploads, by reference, because S7's done-check is a claim about the score DISTRIBUTION and a verify script that recomputed `S` in page would be measuring its own arithmetic.

Flow: `sanitizeScoringPatch` (clamps §5.5, drops unknown keys, warns on refused) → `resolveScoring(merge(current, patch))` → `store.setScoring(next)` (bumps `scoringEpoch`) → `saveViewPref("bestSpotTuning", patch)` → `stepBestSpotFeed` (FEEDS-LAST band, immediately after `stepPlanFeed`) sees the epoch change → `cls = scoringInvalidation(prev, next)` → `worker.postMessage({ type: "apply", jobId, epoch, scoring: next, from: cls })` → the worker runs ONLY the stages at/below `cls` over its resident state `{ parsedTiles, LandGrid, LocalDsm, RayHulls[K], sweepEvidence, termBuffer }` → result posts back with `scoringHash`.

**The wire carries FOUR job types, not three** — `solve` · `apply` · **`refine`** (`BestSpotRefineJob`, `bestSpotWorker.ts:284` — R8's user-triggered 1 m obstruction re-solve of one shortlist row) · `cancel`.

**`scoringHash` is echoed on every result and asserted against the store's current hash before the texture upload.** A mismatch means a stale job landed after a newer patch — drop it. That one integer is what stops "the picture disagrees with the numbers".

**The profile rides the JOB, never a module read.** The worker is long-lived (a new pattern here — the shipped one is single-shot, `workerClient.ts:45,78-80`), so a module-scope read latches at spawn and is invisibly stale forever. **54 leaves** structured-cloned is microseconds against a 490 ms rebuild.

**WORKER LIFECYCLE AND CANCELLATION** *(added 2026-08-24d — `bestSpotWorkerClient.ts:30-34`, `:164`)*. Spawn **lazily on the first job**, then **keep it alive**: a toggle that closes and re-opens the window would otherwise re-pay the whole T0 tier for nothing, and the worker already drops its geometry itself when the centre key changes (`residentKeyOf`), so the memory is released without the thread being torn down. **`terminate()` is reserved for `dispose()`** — the globe going away.

> **CANCELLATION IS COOPERATIVE, NOT `terminate()`.** A `postMessage` cannot interrupt a running 680 ms rung — only `terminate()` can, and that throws away the resident state the next job needs. So `cancel(jobId)` **marks** the job and the worker checks **between rungs** (`bestSpotWorker.ts:506`, `:1281`, `:1391`), backstopped by the `scoringHash` echo for anything that slips out anyway. Worst case is one extra rung of latency (10–680 ms depending on where it was). The alternative — terminate and respawn on every pin drag — turns a 45 ms first ink into a 300 ms one. The cancelled set is PRUNED (`CANCEL_MEMORY = 64`): `jobId` is monotone and a live altitude drag cancels one job per frame, so an unbounded set would grow by 60 integers a second.

**Fence it.** `test/components/globe/fences.test.ts` gains: `bestSpotWorker.ts` and `bestSpotSolver.ts` contain no `components/globe/tuning` import. Ribbon widths (`VECTOR.roadWidthM`, `waterwayWidthM`) ride on the job instead.

`.ab(A, B)` earns its 20 lines: two recomposes = **~5 ms**, and it answers the question the owner actually has ("did the *ranking* change?") rather than the one the console answers ("did the number change?").

## 5.7 Persistence, presets, migration

**One key, the existing grain.** Add one field to `ViewPrefs` (`prefs.ts:15-74`): `bestSpotTuning?: BestSpotScoringPatch`, and one line to `sanitizeViewPrefs` (`:77`):
```ts
if (typeof r.bestSpotTuning === "object" && r.bestSpotTuning !== null)
  out.bestSpotTuning = sanitizeScoringPatch(r.bestSpotTuning);
```
`ftw:view-prefs:v1` stays one blob shared by both shells. **The PATCH is persisted, never the resolved profile** — so a future change to a shipped default propagates to fields the owner never touched.

**Presets:** `"default"` (empty) · `"depth-forward"` (`weights {p:0.40, f:0.15}`) · `"framing-forward"` (`weights {p:0.15, f:0.45}`). Stored as the *resolved patch*, so a preset that later changes does not retroactively move a saved tune.

**Four no-breaking-change rules.** (1) A removed field is **dropped, not fatal** — `sanitizeScoringPatch` copies only keys it knows (the `enrichedVariant` retirement precedent, `prefs.ts:28-32`). (2) A renamed field gets a **read-only alias for one version** (the `skyTargetVisible ← cometVisible` precedent, `prefs.ts:97-100`). (3) A field whose **MEANING** changes bumps `BESTSPOT_SCORING_VERSION`; `resolveScoring` runs `MIGRATIONS[from]` up the ladder; a version with no migration has its affected **group** dropped and the rest kept. Never throw, never reinterpret. (4) A field whose **DEFAULT** changes is not breaking — but **a non-empty persisted patch MUST announce itself** in the DEV console at boot AND in the panel status line (`SCORING: custom (4 fields) · 3f9a2c17` vs `SCORING: default`). Without that, the next taste pass runs against numbers the owner forgot he set.

## 5.8 The test that makes requirement (vii) enforceable

**EVERY FIELD IS LIVE.** For every leaf path of `BESTSPOT_SCORING_V1` — **54 of them as shipped**, and `CLASS_TABLE` (`bestSpotScoring.ts:450-520`) carries exactly 54 matching entries — perturb it (×1.3, flip a boolean, step an enum) on a fixed composition fixture and assert `cellScore` moves by > 1e-12. Any leaf that does not move the score is (a) dead, (b) still read from module scope, or (c) needs a richer fixture. Maintain an `EXPECT_INERT_ON_FIXTURE` allowlist with a written reason per entry.

**This test cannot pass vacuously**, and it goes red the day someone re-inlines a constant — which is how all 37 unreachable numbers got there. Pair it with: every leaf has a `CLASS_OF` entry · `scoringInvalidation` returns what the table says · sanitize/resolve round-trip · a v0 patch with a removed field and an unknown field still resolves.

## 5.9 The taste-pass workflow

```js
__globe.bestSpotTuning({ weights: { p: 0.40, f: 0.15 } })
// -> SCORING v1  hash 3f9a2c17 · 2 fields differ from default
// -> class=recompose · 31,417 cells re-scored in 2.5 ms · hulls 40 (unchanged)
// -> top-K: 7 of 10 survive · Spearman rho 0.91 · new #1 moved 34 m NE
```
Map updates next frame. Reload keeps it. `.export()` produces the diff for the next session. Shipping a tune is pasting the changed leaves into `BESTSPOT_SCORING_V1` — a no-op for the tuner, which is correct.

**UI: console for 50 of the 54 leaves, plus ONE 4-slider weights strip** behind a DEV-gated `TUNE` chip **in `panels/BestSpotPanel.tsx` — not in `components/controls/**`** (that is the third SHARED tier, enforced by `mobileFence.test.ts` rule 3; a DEV-only tuning control there would need a fence exception for a control that must never reach `/m`). Panels are not shared-tier, so the strip costs one file and zero fence edits.

---

# 6. THE VISUAL SPEC

## 6.0 The plan's §6 contrast analysis was computed against the wrong backdrop, in the wrong colour space. Both are now measured.

Agent D booted the real app headless (CDP → Chrome 148 + SwiftShader) at Dnipro `#p=48.46470,35.04620,600,0,0`, 1512×982, and sampled the real framebuffer.

**(a) The sheet does not composite over `--color-bg #05070b`.** That is deep space. `src/store/camera.ts:319` — `groundMode: stored.groundMode ?? "satellite"` — so the **default desktop basemap is graded Esri imagery** (confirmed live: `__globe.groundUniforms().uFtwDark.value === 0`).

| backdrop | screen RGB p50 | screen relLum p10 / **p50** / p90 / p98 |
|---|---|---|
| plan's assumed `#05070b` | (5,7,11) | — / **0.0021** / — / — |
| DARK CARTO drape | (51,59,66) | 0.0382 / **0.0423** / 0.0613 / — |
| **SATELLITE (the DEFAULT)** | (89,91,74) | 0.0091 / **0.1010** / 0.3213 / 0.5334 |
| `/m` 2D photographic chart | (85,95,64) | 0.0120 / **0.1049** / 0.3137 / 0.5249 |

**The default basemap median is 48× brighter than the plan assumed.**

**(b) Blending is LINEAR, not sRGB.** `GlobeCanvas.tsx:277-283` builds a `HalfFloatType` render target + `EffectComposer` + `OutputPass`. In `three.module.js:7585`, binding a non-XR render target sets `outputColorSpace = workingColorSpace` (linear), so every material's `<colorspace_fragment>` is an identity; `:7549-7557` sets `NoToneMapping`. Scene ink is written LINEAR, blended LINEAR, then `OutputPass` applies `NeutralToneMapping` + sRGB encode **once**.

**(c) The plan's alpha curve fails, measured.** Inferno + `a(s) = min(0.25, 0.04 + 0.58 s²)`:
- Inferno's mid stop `#BC3754` has almost exactly the median satellite pixel's luminance ⇒ **s ≈ 0.5 is invisible (1.05:1)**.
- Over the brightest ~10 % of ground (plazas, concrete, sand — exactly where an open-horizon spot lives) **nothing on the whole scale exceeds 1.40:1**.
- `0.04 + 0.58 s² = 0.25` at **s = 0.6017**, so alpha is FLAT above 0.60 — and the AS-BUILT hero scores are 0.696 / 0.889 / 0.695. **The entire population sits where the curve has stopped moving.**

## 6.1 The ramp — INFERNO, 11 stops, tokens only

| t | token | GL bridge | hex | OKLab L |
|---|---|---|---|---|
|0.0|`--color-heat-0`|`heat0`|`#000004`|0.0482|
|0.1|`--color-heat-1`|`heat1`|`#160B39`|0.2006|
|0.2|`--color-heat-2`|`heat2`|`#420A68`|0.3068|
|0.3|`--color-heat-3`|`heat3`|`#6A176E`|0.3839|
|0.4|`--color-heat-4`|`heat4`|`#932667`|0.4618|
|0.5|`--color-heat-5`|`heat5`|`#BC3754`|0.5416|
|0.6|`--color-heat-6`|`heat6`|`#DD513A`|0.6201|
|0.7|`--color-heat-7`|`heat7`|`#F37819`|0.7038|
|0.8|`--color-heat-8`|`heat8`|`#FCA50A`|0.7893|
|0.9|`--color-heat-9`|`heat9`|`#F6D746`|0.8808|
|1.0|`--color-heat-10`|`heat10`|`#FCFFA4`|0.9777|

Monotone in OKLab L over all 11 stops. Min adjacent ΔL = 0.0779 (0.3→0.4), max 0.1524 (0.0→0.1). Test: `okL(heat[i+1]) > okL(heat[i])` for all i. **Verified: `src/styles/tokens.css` has zero `heat` tokens today** — 22 new tokens (11 + 11 alt) plus a `lib/theme/tokens.ts` regeneration.

**TURBO behind an A/B chip only** (`--color-heat-alt-0…10`), the SHIPPED stops *(regenerated 2026-08-24d from Google's canonical 256-entry `turbo_srgb_floats` table and verified against `src/styles/tokens.css:113-123` — **all 8 interior stops differ from the from-memory list this section carried**; the endpoints `#30123B` / `#7A0403` were right)*:

`#30123B #455ACD #3E9BFE #19D6CC #46F884 #A3FD3C #E1DD37 #FEA531 #F05B12 #C42503 #7A0403`

OKLab L rises to **0.9036 at t = 0.5** (chartreuse, `#A3FD3C`) and collapses to 0.3662 at t = 1.0 — **five descending pairs**. So Turbo's lightness peak sits at the MIDDLE of the scale, not near the top: **the brightest thing on a Turbo map is a mediocre spot and the best spot goes dark red.** Working-band discrimination 0.071 / 0.022 vs Inferno's 0.166 / 0.095 — a **2.3–4.3× loss**. The chip ships with the tip: `TURBO — RAINBOW A/B. NOT MONOTONE: THE BEST SPOTS GO DARK RED.` The conclusion never depended on the stops, and `test/lib/theme/heatPalette.test.ts` now asserts the non-monotonicity so the two ramps can never be silently swapped. *(The forecast said a peak at t = 0.6 / s = 0.65 with four drops; corrected above. INFERNO's 11 stops match `tokens.css:88-98` exactly and stand as written.)*

Assembly: `src/lib/theme/heatPalette.ts` (the `findPalette.ts:19-31` precedent) exporting `HEAT_INFERNO`, `HEAT_TURBO` and `buildHeatLut(stops): Uint8Array(256*3)`. **`tuning.ts` names ramps by id (`"inferno" | "turbo"`), never by colour.**

## 6.2 The alpha curve — a VEIL / INK SPLIT, one boolean

**Mechanism, no new machinery.** `material.premultipliedAlpha = true` + `NormalBlending` sets `glBlendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, …)` (`three.module.js:10286-10291`). A **raw `ShaderMaterial` that does not `#include <premultiplied_alpha_fragment>`** writes `gl_FragColor` exactly as authored (`three.module.js:465` is the only place three multiplies). So:

```glsl
gl_FragColor = vec4( ink * aInk, aVeil );        // aInk != aVeil, deliberately
// => out = ink*aInk + ground*(1 - aVeil)
```

**Colour strength and map suppression become two independent knobs.** This is the single most important architectural move in the visual layer for requirement (vii), and retrofitting it means rewriting the alpha model, the legend and every tuned constant.

```
t        = clamp01( (s - displayLo) / (displayHi - displayLo) )   // 0.15 -> 0.90
aInk(s)  = inkMin + (inkMax - inkMin) * pow(t, inkGamma)          // 0.02 -> 0.34, gamma 1.4
aVeil(s) = veilMax - (veilMax - veilMin) * t                      // 0.30 -> 0.12, linear
```

Measured through the real pipeline over the real basemap (contrast : ΔOKLab-L):

| s | aInk | aVeil | DARK p50 | SAT p10 | SAT p50 | SAT p90 | SAT p98 |
|---|---|---|---|---|---|---|---|
|0.15|0.020|0.300|1.27 −.065|1.06 −.029|1.39 −.077|1.41 −.087|1.42 −.098|
|0.45|0.109|0.228|1.10 −.021|1.00 +.011|1.18 −.035|1.25 −.056|1.26 −.065|
|0.65|0.201|0.180|1.47 +.101|1.87 +.197|1.22 +.052|1.02 −.002|1.08 −.020|
|0.85|0.311|0.132|3.47 +.297|4.65 +.401|2.46 +.218|1.52 +.114|1.28 +.075|
|0.95|0.340|0.120|**4.37** +.356|**5.99** +.464|**3.03** +.273|**1.76** +.157|**1.42** +.108|

**Working-band discrimination (|ΔOKL@0.85 − ΔOKL@0.65|): 0.196 / 0.204 / 0.166 / 0.117 / 0.095 — 2.1–2.5× the plan's curve on every backdrop.**
**Map visibility (1 − aVeil): 70 % at the worst cell, 88 % at the best cell** (the plan's flat 0.25 gives 75 % everywhere) — strictly better exactly where the owner said it matters. Stays under the `VECTOR.fillOpacity 0.25` house ceiling except at the worst cells, never above 0.30.

**The neutral crossover** (where the sheet stops darkening and starts glowing) lands at s ≈ 0.49 (dark drape) / 0.55 (SAT median) / 0.65 (SAT bright). Below it the sheet reads as a dim veil ("not here"), above it as warm light ("here"). Tunable by `displayLo`.

**Bloom guard.** `BLOOM.threshold = 0.9`; the crossing is at ground scene-linear L = 0.7645 and **0.64 %** of satellite ground pixels exceed it. The top of the ramp will faintly bloom on specular roofs — acceptable, but it needs a named line in `tuning.ts` beside `inkMax`, because raising `inkMax` past ~0.40 turns it into a smear.

## 6.3 Contours — the boundary carries the reading

`FOCALCONE.fillAlpha = 0.05` vs `edgeAlpha = 0.70` (`tuning.ts:2520,2526`) is the house rule, and §6.0 proves why it must apply: the fill cannot carry a quantitative reading over photographic imagery.

`contourStep = 0.10` on **ABSOLUTE** score → isolines at 0.20…0.90. **Majors at `[0.60, 0.80]`** (2× core width, +0.15 core alpha) — both are `BESTSPOT` arrays.

```glsl
float isoPx(float v, float step) {                 // distance to nearest isoline, IN PIXELS
  float q = v / step;
  return abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-6);
}
float band(float px, float wPx) { return 1.0 - smoothstep(wPx*0.5 - 0.5, wPx*0.5 + 0.5, px); }
```
`coreWidthPx 1.4` (majors 2.4) · `haloWidthPx 3.8` (majors 4.8). Halo = `tokens.bg #05070B` α 0.65; core = `tokens.textPrimary #E8ECF2` α 0.95, drawn over the halo in the same fragment.

| backdrop | halo vs ground | **ink vs halo** | ink vs ground |
|---|---|---|---|
| DARK p50 | 1.59:1 | **13.79:1** | 8.67:1 |
| SAT p50 | 2.13:1 | **11.28:1** | 5.30:1 |
| SAT p98 | 2.75:1 | **3.81:1** | 1.38:1 |

This reproduces the shipped `streetNames` figure (plan §6 quotes 11.23:1; this recipe measures 11.28:1) and shows the mechanism: over bright ground ink-vs-ground collapses to 1.38:1 but **ink-vs-halo holds at 3.81:1**. The halo is what keeps the line legible — the same reason `streetNames` draws twice.

**Density dropout (mandatory).** At a building flank the score jumps ~0.55 over ~3 cells → 5 isolines inside ~15 px. Without this the flanks read as moiré:
```glsl
float dens    = fwidth(score) / contourStep;                     // isolines per pixel
float legible = 1.0 - smoothstep(densFadeLo 0.35, densFadeHi 0.70, dens);
```

**Tilt and zoom are free:** width is in *pixels* via `fwidth`, so the line is 1.4 px at 200 m and at 3 km; at oblique the far half thins automatically. **WebGL1 caveat:** if any WebGL1 path survives, the material needs `extensions: { derivatives: true }` (the app's context version was not checked — UNVERIFIED).

## 6.4 The score texture — ONE RG8, LinearFilter, ordinal `.g`

**`fwidth` on a `NearestFilter` sample is 0 inside a texel and huge at edges → blocky isolines. The score texture MUST be `LinearFilter`.** Therefore:
- ONE `RG8` `DataTexture`, `LinearFilter`, `ClampToEdgeWrapping`, `colorSpace = NoColorSpace`, **full-surface `texSubImage2D` only** (three 0.185 hard-codes `componentStride = 4`, `three.module.js:11804`, so ranged uploads on RG8 silently scramble rows).
- `.r` = score remapped to `[displayLo, displayHi]`.
- `.g` = an **ORDINAL standability axis**, 4 levels `0 / 0.333 / 0.667 / 1.0` = `UNKNOWN / INACCESSIBLE (A_hard=0) / SCORED-not-groundReachable / SCORED-reachable`. Ordinal so linear interpolation can only land *between two adjacent classes* — which is exactly §8's *"class boundaries carry a 1–2 cell uncertainty ribbon. Draw it."* Thresholds 0.1667 / 0.5 / 0.8333 with `fwidth` AA.
- **This closes AS-BUILT open item 3** (`LandClass` has no AERIAL member): **AERIAL is a property of the SHEET, not of a cell.** The whole sheet is at one altitude, so `sheetAltM ≥ AERIAL_MIN_M (5)` (verified `bestSpotTypes.ts:229`) switches the legend and panel header to DRONE RULES; the only per-cell aerial fact is `groundReachable`, which is level 0.667.
- Known artefact, accepted: `.r` bleeds one texel across a class boundary. Where `.g` says UNKNOWN, `aInk = aVeil = 0`, so the bleed is invisible except in the transition texel.

**Allocation.** Grid sizes from the shipped `oddSpanCells` (verified `localDsm.ts:203`) — **plan §6 is wrong twice**: it says the largest grid is at the SMALLEST radius; 201² = 40,401 **<** 335² = 112,225.

| radius | @6 m | @3 m | @1 m |
|---|---|---|---|
|300 m|101²|**201²** (79 KB)|**601²** (705 KB)|
|500 m|167²|**335²** (219 KB)|1001² (1.91 MB) — **forbidden, ~12.2 s**|

**Ruling: forbid ULTRA above 300 m radius; allocate once at 601².** (D proposed 1001² on byte grounds; A measured that configuration at ~12.2 s of compute, so it must not be reachable at all. 601² covers both 3 m @ 500 m = 335² and 1 m @ 300 m = 601².)

## 6.5 Rim falloff (owner R4)

```glsl
float rim = 1.0 - smoothstep(1.0 - rimFrac, 1.0, r / radiusM);   // rimFrac = 0.10
```
Multiplies **`aInk`, `aVeil` and the contour layer alpha by the same factor.**
- **0.10, not 0.08.** At the natural altitude for a 300 m disc (~900 m, where 600 m spans 951 px against a 982 px viewport) `worldPerPx = 0.6312 m/px`, so 0.10 × 300 m = **47.5 px** of dissolve. 0.08 gives 38 px, which at 400–500 m radius and higher altitudes drops under ~25 px and reads as a hard edge again. 0.10 holds ≥ 30 px across the whole radius × altitude ladder.
- `smoothstep`, not linear — a linear ramp leaves a C1 kink that reads as a faint ring, the exact artefact R4 exists to kill.
- **Contours use the SAME factor.** A stroke that outlives its fill reads as a UI ring rather than data.
- **No rim outline circle at all.** The falloff IS the boundary; the disc edge is a compute-budget artefact, not a finding. The radius is printed in the panel.
- `discard` at `rim < 0.004` (the `makeFlatOverlayMaterial` `uAlpha < 0.003` idiom, `tangentOverlay.ts:42`).

## 6.6 The UNKNOWN class — 36.1 % of a dense city box, so it is most of what the eye sees

Contract (verified `bestSpotTypes.ts:238`, `bestSpotMetric.ts:757`): *UNKNOWN is NEVER rendered as a low score.*

**Render: `aInk = 0`, `aVeil = 0` — the map is drawn completely untouched.** Not dimmed, not tinted. Untouched is the only honest rendering of "we did not look".

**Boundary: a two-tone dotted stroke.** A single-colour dash provably fails — measured:

| ink | DARK p50 | SAT p10 | SAT p50 | SAT p90 | SAT p98 |
|---|---|---|---|---|---|
|`textSecondary #9AA4B2` α .9|3.76|5.78|2.35|**1.01**|1.47|
|`border #232935` α .9|1.57|**1.04**|2.52|5.33|6.72|

They fail on *complementary* backdrops — which is why the halo pair works everywhere: **dash core `tokens.textSecondary` α 0.90, halo `tokens.bg` α 0.65**, 1.4 px / 3.8 px, period 9 px, duty 0.45, phase from arc length along the boundary so the dashes do not crawl. Derive the boundary from the interpolated `.g` channel at the 0.1667 threshold with `fwidth` AA — free, no edge-detect taps.

**Third state, INACCESSIBLE** (`A_hard = 0`): `aInk = 0`, `aVeil = veilMax (0.30)` — a plain dim, no hue. Legend `CAN'T STAND HERE`. Neither UNKNOWN nor INACCESSIBLE may ever wear a ramp colour.

## 6.7 The plumb line + altitude chip (owner R4) — with the nadir degeneracy solved

Three objects on one `makeTangentGroup(scene)` root (`tangentOverlay.ts:51`), seated with `seatTangentGroup(group, lat, lon, groundM, 1)` — unit geometry, planetary magnitude in the matrix; `matrixAutoUpdate = false`; `raycast = () => {}`; `frustumCulled = false`; `renderOrder` set **per object** (a Group's renderOrder does not propagate — `aimCones.ts:191`).

1. **VERTICAL LINE** — a camera-facing quad `(0,0,0) → (0,0,sheetAltM)` in ENU, half-width `worldPerPx × 1.5` px (constant 3 px on screen, the `streetNames.ts:64` recipe). Ink `tokens.accent #38E1D0` α 0.85 with a `tokens.bg` α 0.65 halo edge — measured over a hot sheet cell, bare accent-vs-sheet is only **1.08–1.67:1**, the bg halo is **3.27–3.82:1 and stable across every backdrop**. The halo is what makes it read.
2. **GROUND TICK** — a 4-arm reticle at the base, arm length `worldPerPx × 9` px, same ink+halo. This is what survives at nadir.
3. **SCALE SPOKE (new — the nadir fix)** — a horizontal segment in the tangent plane from the base, of length **exactly `sheetAltM` in ground metres**, bearing = the event's contact azimuth `EventTrack.setAzDeg`. A literal scale bar: *the sheet is this high, and this is what that height looks like laid flat on the map you are reading.*

**The nadir proof.** With θ = camera tilt from nadir (`urlPose` clamps 0…88, 0 = nadir), screen-projected length per metre of `sheetAltM`: vertical line `sin θ`; ground spoke at relative bearing Δ, `sqrt(cos²θ·cos²Δ + sin²Δ) ≥ cos θ`. ⇒ **`max(vertical, spoke) ≥ max(sin θ, cos θ) ≥ 1/√2 = 0.707` at EVERY tilt and every relative azimuth.** At the app's near-nadir default (tilt 5°) the vertical is `sin 5° = 0.087` — for a 3 m sheet at 900 m altitude that is **0.4 px, invisible** — while the spoke is `cos 5° = 0.996` → **4.8 px**. Falsifiable unit test: `projectedLen(tilt, dAz) >= 0.70 * sheetAltM` over a 0…88 × 0…360 sweep.

**The altitude chip** — a billboarded `CanvasTexture`, the `aimCones.ts:215-246` N-marker recipe verbatim: canvas 128×64, `ctx.font = "600 40px " + uiFont` (`--font-ui` resolved at attach — canvas cannot parse `var()`), `shadowColor = tokens.bg`, `shadowBlur = 40*0.22`, **`fillText` twice**, `fillStyle = tokens.textPrimary`, `colorSpace = SRGBColorSpace`, `anisotropy = min(8, maxAniso)`, `MeshBasicMaterial { transparent, depthWrite:false, depthTest:false, side: DoubleSide }`. Text `12 m` / `1.7 m`, plus `▲ DRONE` beneath in `tokens.warn` when `sheetAltM ≥ 5` — **the only place R1's drone semantics become visible in the scene**.

**Sizing:** NOT the `PLACEMARKS.angularSize 0.006` clamp (it gives 5.4 m ≈ 8.6 px radius at 900 m — too small for two lines). Use `streetNames.labelScaleFor`: cap height = `worldPerPx × chipCapPx (13)`, clamped `[1.2 m, 400 m]` → constant 13 px at every zoom.
**Placement, tilt-aware:** top of the vertical line when `sin θ > 0.35`, otherwise pinned just outboard of the ground tick along the spoke's screen direction by `worldPerPx × 16` px, with one `lerp` on `smoothstep(0.30, 0.40, sin θ)` so it slides rather than jumps.
**FPV: none of this renders** — owner R2.

## 6.8 Top-K markers

- **K = 8** (`BESTSPOT.topK`). The panel window is `--win-w 17.25rem` with `max-height: max(11.9rem, min(27.9rem, 100vh − 39.8rem))` (`plan-panel.css:35`); 8 rows × ~26 px plus chips plus legend fits without `.pp-scroll` reaching for a bar on 1080p. *(UNVERIFIED against a rendered panel.)*
- **Non-maximum suppression at `topKMinSepM = 25 m`** so the eight are eight *places*, not eight cells of one plateau.
- **Anatomy:** the `placeMarkers.ts:66-76` ring+core billboard verbatim (`ring = smoothstep(0.98,0.90,r)*smoothstep(0.68,0.78,r)`, `core = 1 - smoothstep(0.22,0.32,r)`), but **`depthTest: true`** (the sheet is depth-tested; a depth-free marker would shine through buildings the sheet respects) plus a `tokens.bg` α 0.65 outer halo ring.
- **Colour = IDENTITY, not score.** `tokens.accent` for all eight, with the **rank digit 1–8** in the core from a shared 8-glyph atlas. The score is already encoded by the sheet under the marker; colouring by score says it twice and loses the row↔marker binding.
- **Row binding:** each panel row carries a `.fnd-sw` swatch (7×7, `find-panel.css:57-64`) filled with **that cell's heat colour** — the FIND ghost↔row contract.
- **Hover:** row hover sets `store/bestSpot.hoverKey`; the marker ring eases 0.85 → 1.0 over `AIMCONES.emphTauMs (180 ms)` and radius ×1.35, and a **1-cell accent outline** is stamped on the sheet via one extra uniform `uHoverCell vec2` — **no re-upload**. Reverse direction from the GL pick sets `.fnd-row--hot` (`find-panel.css:84-87`). S5's done-check already names `__globe.bestSpot().sceneHoverKey`.
- Clicking a row **drops the temp pin at that cell** through the shipped `aimAnchorFor()` / tempPin path.

## 6.9 The panel (S5) — the third `planfind` segment, `bsp-*` reusing `pp-*`

Toggle: a third `.pft-seg` in `PlanFindToggle.tsx`, label `◎ BEST SPOT`, tip `WHERE TO STAND FOR THIS SUNRISE / SUNSET / MOONRISE / MOONSET.` Mutual exclusion at click time exactly as `pick()` does.
Window: `.bsp-root` / `.bsp` / `.bsp-scroll` are **geometry twins** of `.pp-root` / `.pp` / `.pp-scroll` — same `left 1.6rem`, `top 3.4rem`, `z-index 31`, `--drag-x/--drag-y`, `--win-w 17.25rem`, same `max-height` formula, same `planfind` drag/resize session key (the `find-panel.css:8-45` precedent).
**Reused classes:** `.pp-head .pp-title .pp-anchor .pp-x .pp-section .pp-chips .pp-chip .pp-chip--on .pp-chip__kind .pp-chip--sun .pp-chip--moon .pp-status .pp-day__row .pp-day__jump .pp-day__dot .pp-day__time .pp-day__kind .pp-day__meta .pp-mw__bar .fnd-sw .fnd-row--hot .uf-slider*`.
**New classes (5):** `.bsp-legend .bsp-legend__ramp .bsp-legend__tick .bsp-legend__cls .bsp-ab`.

```
┌──────────────────────────────────────────┐ .bsp (17.25rem)
│ BEST SPOT              48.4647, 35.0462 ✕│ .pp-head > .pp-title / .pp-anchor / .pp-x
├──────────────────────────────────────────┤ .bsp-scroll
│ ◎ HEATMAP  ON            READING THE MAP │ .pp-chip--on  + the network chip (§2.3)
│                                          │
│ EVENT                                    │ .pp-section
│ (☀ SUNRISE)(☀ SUNSET*)(☾ M.RISE)(☾ M.SET)│ .pp-chips > .pp-chip--sun / --moon
│   ☾ THIS MOON IS WORTH 0.09              │ .pp-status  ← the M badge, see §8 Q1
│                                          │
│ RADIUS                                   │ .pp-section
│ (100)(200)(300*)(400)(500) m             │ .pp-chips  (1 m ULTRA disabled above 300)
│                                          │
│ SHEET ALTITUDE            1.7 m          │ .uf-slider__head
│ ▁▁▁●▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁      │ 1.7 … 400 m, log; dbl-click → 1.7 m
│                                          │
│ ─────────────────────────────────────    │
│ SCORE                          [INFERNO] │ .bsp-legend / .bsp-ab (A/B → TURBO)
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      │ .bsp-legend__ramp  (11 stops)
│ .15    .40    .60    .80    .90          │ .bsp-legend__tick  (.60 .80 bold = majors)
│ ░ UNMAPPED — NOT SCORED                  │ .bsp-legend__cls   (dotted swatch)
│ ▒ CAN'T STAND HERE                       │ .bsp-legend__cls   (dim swatch)
│                                          │
│ 36% UNMAPPED · COVERAGE 0.71             │ .pp-status
│ OBSTRUCTION AT 3 m (1 m AT THE SHORTLIST)│ .pp-status   ← §8 UI copy, verbatim
│ OVER TERRAIN AT ~150 m                   │ .pp-status
│ A VERTICAL EDGE RESOLVES TO ~HALF A DISC │ .pp-status   ← the 0.25° azStep honesty line
│ EVIDENCE REACHES 700 m — BEYOND THAT,    │ .pp-status   ← the NEW reachM line (§3.4)
│   UNKNOWN                                │
│                                          │
│ BEST SPOTS   RANKING…         8 OF 31,417│ .pp-section  (greyed until the 3 m rung, §2.3)
│ ■1 0.89 ▓▓▓▓▓▓▓▓░  62 m NE  GRAZE · 3m20s│ .fnd-sw + .pp-day__jump / __time / __kind
│                             ON A BRIDGE  │   absolute score AND relative bar (§3.5)
│                             1.5 km AWAY  │
│ ■2 0.86 ▓▓▓▓▓▓▓▓░ 141 m  E  OPEN HORIZON │
│ ■3 0.81 ▓▓▓▓▓▓▓░░ 208 m SE  GAP          │
│ …                                        │
│ ■8 0.66 ▓▓▓▓▓░░░░ 287 m  S  GRAZE ·      │
│                             TREE LINE    │   + "(modelled height)" footnote
│                                          │
│ ⚠ RURAL — TERRAIN ONLY, NO SURVEYED      │ .pp-status, color: var(--color-warn)  (S7)
│   BUILDINGS HERE                         │
│ ⚠ NO RISE/SET SOLUTION AT THIS LATITUDE  │ .pp-status  (eventTrack === null; AS-BUILT
│   ON THIS DATE                           │   measured null across the TROPICS, not the poles)
└──────────────────────────────────────────┘
```
**The lift slider's rail starts at `eyeM` (1.7 m), not at the 0.5 m this mock drew** *(corrected 2026-08-24d against `BestSpotPanel.tsx:492-499`, reason at `:400-403`)*: `min = BESTSPOT.eyeM`, `max = 400`, log, double-click → 1.7 m. The store carries `eyeM` (the pedestrian eye) and `liftM` (metres ABOVE it), so the number a person reads off the slider is their sum — and **`liftMinM 0.5` is the LOG slider's own domain floor (a log scale has no zero), not a place anybody can stand.** Drawing the rail from 0.5 m offered half a metre of altitude that means nothing.

**Every row prints the ABSOLUTE score beside the relative bar** — §3.5's display-normalisation rule, non-negotiable.
**Controls live in `src/components/controls/**` from day one.** `mobileFence.test.ts:77-93` allows only `react` · `store/` · `lib/` · `styles/` · `globe/tuning` — so `ui/Slider` is **unreachable**, and `controls/InstrumentSlider.tsx` must re-implement the `.uf-slider` grammar (rail 2 px, accent fill, 12 px knob, `ew-resize`, dbl-click reset, `role="slider"` + arrows/Home/End) importing only class names. `controls/ChipRow.tsx` serves both the event and radius rows.

## 6.10 The three GL surfaces

**renderOrder — correcting plan §6.** The shipped stack: Pins 0 · vector fills 1 · vector ribbons 2 (`vectorFeatures.ts:362-363`) · streetNames + placeMarkers 3 · **depth-free planning band 9** (`OVERLAY_RENDER_ORDER`, `tangentOverlay.ts:18`: aimCones, focalCone, dayArcs) · findGhosts/skyTrail 10 · sky 11-12. Putting a **depth-TESTED** sheet at 9 drops it into the depth-free band, where the transparent sort orders by camera distance against `depthTest:false` siblings — **non-deterministic flicker against the radar.**
⇒ **Sheet + contours: `renderOrder 4`** (one material, one draw call). **Plumb line + top-K markers: 5.** Both below 9 so the radar and focal cone read over the sheet, as they must — they are the instrument, the sheet is the terrain reading. `polygonOffsetFactor/Units = -4/-4` (the `vectorFeatures` ribbon value −3 plus one). `depthTest: true`, `depthWrite: false`.

**Presence band, radius-derived:** `fullAltM = 8 × radiusM`, `topAltM = 14 × radiusM` through `presenceForAlt` (`tangentOverlay.ts:63`) + `easeFade(…, 250 ms)`. For R = 300 m: full ≤ 2400 m, gone ≥ 4200 m — where a 3 m cell measures **1.02 px**, so the sheet vanishes exactly at the resolution limit rather than lying at 0.5 px. **AND-ed with `!isMobileShell && !coarsePointerShell` AT THE READ** (the `StylizedTiles.ts:729` `hqAllowed` idiom).

**(A) 3D orbit / oblique.** The sheet conforms to terrain (**`CONFORM_N = 65` ⇒ 65×65 SAMPLES = 64×64 quads**, from the same DSM, rewritten in place — the `focalCone` allocate-once lesson; *corrected 2026-08-24d against `bestSpotSolver.ts:393` — this section said "64×64 verts", which is the quad count, and a lattice off by one row is the same parity bug class as `oddSpanCells`*) and is depth-tested, so **buildings occlude it** — a cell inside a footprint is hidden by the building, which is the truthful rendering of `A_hard = 0`. Vertical line at full projected length above tilt 45°; the density dropout thins the far half automatically. *(UNVERIFIED: the oblique capture returned percentile statistics byte-identical to the nadir dark-drape capture, so oblique backdrop luminance is unmeasured. The dark drape is near-uniform, so it is unlikely to differ much; oblique SATELLITE is genuinely unmeasured.)*

**(B) Desktop nadir / flat map.** Natural altitude for R = 300 m is ~900 m (disc = 951 px against a 982 px viewport). One 3 m cell = **4.75 px**, one 1 m ULTRA cell = **1.58 px** — both resolvable, so the tier ladder is honest at the altitude the user plans from. `mapFlat` is where `streetNames`/`vectorFeatures` drop `depthTest` (`streetNames.ts:351-354`, `vectorFeatures.ts:391-392`) — **the sheet does NOT follow them.** It stays depth-tested: it is a ground reading, not map ink, and drawing through buildings would paint scores onto roofs the solver excluded. The plumb line degenerates and the **scale spoke + ground tick + chip carry it** (§6.7 proof). The photographic 2D chart (`GROUND.flat2dPhotoK = 1`) is the brightest backdrop measured — this is the surface the veil/ink split exists for.

**(C) `/m` 2D.** Until S8 the sheet does not render on `/m` at all. When it does: the `/m` PiP re-renders the scene, so the sheet is a second full-viewport transparent pass — cap it at `contourStep 0.20` (half the isolines), `topK 4`, and no plumb-line chip (the mobile HUD owns that corner).

**FPV (all three shells): nothing renders** — owner R2. The exception, if ever un-parked, needs the named `tuning.ts` docstring line plan §9 demands.

## 6.11 The `BESTSPOT` tuning block (pure data, zero colour literals)

*(Regenerated 2026-08-24d from the shipped block, `tuning.ts:2840-3088`. **This section listed 40 keys; the block has 60.** The 20 it never named are the whole SITUATION half of the feature — geometry, tiers, the ladder's inputs, and four honesty/safety numbers — which is exactly the half a "pure data, zero colour literals" heading invites a reader to skip.)*

```
LOOK — the ramp and the sheet
rampId "inferno" | rampAltId "turbo"
displayLo 0.15 · displayHi 0.90          <- THE knob that absorbs any scoring-function change
inkMin 0.02 · inkMax 0.34 · inkGamma 1.4
veilMin 0.12 · veilMax 0.30              <- independent of ink
bloomHeadroomNote  <- named line: raising inkMax past ~0.40 smears (BLOOM.threshold 0.9)

LOOK — contours, classes, markers, presence
contourStep 0.10 · contourMajors [0.60, 0.80]
coreWidthPx 1.4 · haloWidthPx 3.8 · majorWidthK 1.7
haloAlpha 0.65 · coreAlpha 0.95 · majorAlphaBoost 0.15
dashCoreAlpha                            <- NEW: the UNKNOWN boundary's dash core (§6.6's halo pair)
densFadeLo 0.35 · densFadeHi 0.70
rimFrac 0.10
unknownDashPx 9 · unknownDuty 0.45
topK 8 · topKMinSepM 25 · hoverEaseTauMs 180 · hoverRadiusK 1.35
chipCapPx 13 · plumbHalfWidthPx 1.5 · tickArmPx 9
renderOrder 4 · markerRenderOrder 5 · polygonOffset [-4, -4]
fullAltK 8 · topAltK 14 · fadeTauMs 250

ENGINE — the ladder, the mirror, persistence
rebuildQuietFrames 90 · ladderCellsM [24, 12, 6, 3] · dragCellM 24 · ultraMaxRadiusM 300
mirrorEveryFrames                        <- NEW: the store mirror's write throttle (S6: < 1 in 8)
persistDebounceMs                        <- NEW
shortlistCandidates 256                  <- NEW: R8's 1 m accessibility shortlist size

GEOMETRY — the disc, the eye, the tiers
radiiM · defaultRadiusM · defaultLiftM 0 · eyeM 1.7          <- ALL NEW
liftMinM 0.5 · liftMaxM 400                                  <- NEW; liftMinM is the LOG DOMAIN floor
ultraCellM 1 · defaultCellM 3 · midCellM 6                   <- NEW
emptyFieldFrac 0.05 · liftProbesM [10,20,40,80] · liftProbeCellM 24   <- NEW: R6's COMPUTED lift chip

★ HONESTY / SAFETY — these four are not look, and a taste pass must not treat them as look
collarM 400                    <- the DSM collar. 0.0467 with it vs 0.6619 without: a 14× silent lie
refuseBelowReachM 400          <- MUST EQUAL collarM (held by a test, not by an expression)
minTilesForSolve 1             <- below it the disc REFUSES rather than painting hard=1 everywhere
builtDensityFloorPerKm2 1      <- sqrt(26.6 x 0.048); withholds open-sky CREDIT, never multiplies S
```

**The four starred keys are the ones to fence off.** `collarM` and `refuseBelowReachM` must move together or the rim of a perfectly good disc starts refusing; `minTilesForSolve` and `builtDensityFloorPerKm2` are the two thresholds standing between the feature and §11's "single most dangerous failure mode". Each carries its derivation in a docstring at the key, because none of them is a number anybody can re-guess from the rendered result.

---

# 7. THE SLICE PLAN FOR NEXT SESSION

Dependency-ordered. Every done-check can FAIL. Process rule from the AS-BUILT appendix: **commit red tests before handing them to a fix pass.**

---

### **S3a — THE SCORING PROFILE** (pure lib; zero behaviour change)
**Files:** new `src/lib/geo/bestSpotScoring.ts` · `bestSpotMetric.ts` · `bestSpotTrack.ts` · `landcoverRaster.ts` · `bestSpotTypes.ts` · `tuning.ts` (doc line + re-export) · new `test/lib/geo/bestSpotScoring.test.ts`.

Build: the `BestSpotScoring` interface + `BESTSPOT_SCORING_V1` with all values **verbatim** from §5.1 (a pure refactor) · `resolveScoring` / `sanitizeScoringPatch` (with the §5.5 clamps) / `scoringHash` / `scoringDiff` / `BESTSPOT_PRESETS` / `CLASS_OF` + `scoringInvalidation` · separate `BESTSPOT_PHYSICS` / `_SAFETY` / `_HONESTY` exports with **no key path from a patch**. Thread it: replace the 7 module-scope reads in `bestSpotMetric.ts` (`:214`, `:571`, `:730`, `:749`, `:750`, `:776`, `:790`) and the 6 in `bestSpotTrack.ts` (`:149-155`, `:313-315`). Plus the two conversions of §5.3: `LandGrid` carries `cls` + `flags` and resolves `soft` at read; `EventTrack` gains `sunAltAtT0Deg` + `moonPhaseAngleDeg`.

**DONE-CHECK (each can fail):** (1) **EVERY FIELD IS LIVE** — perturb every leaf, `cellScore` moves by > 1e-12, with an `EXPECT_INERT_ON_FIXTURE` allowlist carrying a written reason per entry. (2) Every leaf has a `CLASS_OF` entry. (3) `scoringInvalidation` returns exactly what §5.4 says for every path. (4) Clamps: `vGateHi ≥ vGateLo + 0.05`, `minCoverage ≥ 0.5`, `aerialMinM ≥ 2`, `conf.tree ≤ 0.6`, `phaseCurve:"illumFrac"` refused by the persisted sanitizer and accepted by the DEV seam. (5) Round-trip `resolveScoring(sanitizeScoringPatch(JSON.parse(JSON.stringify(patch))))`. (6) A v0 patch with a removed field and an unknown field still resolves. (7) `BESTSPOT_SCORING_V1` agrees with the `PLAN.*` mirrors (the `bestSpotMetric.test.ts:945` idiom). (8) `npx knip` exit-0 (the `tuning.ts` re-export must be consumed — **UNVERIFIED**).

**SHIPPED TESTS THAT CHANGE: exactly one line.** `test/lib/geo/bestSpotMetric.test.ts:844` — `weights: { v: 0.3, l: 0.6, p: 0.5, f: 0.6 }` moves inside `scoring`. Verified: every other override in the 6 test files spreads `BESTSPOT_METRIC_DEFAULTS` with only `eyeM` / `liftM`, which keeps working.

---

### **S3b — GRAZE: the generalized framing kernel** (pure lib; behaviour change)
**Files:** `bestSpotMetric.ts` · `bestSpotTypes.ts` · new `test/lib/geo/bestSpotGolden.test.ts` · 4 shipped test files.
Depends on S3a (the `graze` profile group is its home).

Build: replace `silTangency` with **`grazeSample(ev, altApp, rho, dipFloor, scoring) → { cut, q, src, distM }`** for ONE sample; `cellScore` accumulates `τ += cut·q·|Δα|/ρ` in the loop it already runs at `:714-734` (the `f` it needs is computed one line above at `:720`). Keep `isBuiltSrc` (`:162`) and `nearestEdgeDeltaDeg` (`:339`) **exported and unchanged** — `nearestEdgeDeltaDeg` becomes the kernel's inner loop and `isBuiltSrc` is still the right predicate for the panel's "BEHIND A BRIDGE" copy. Weight the notch **without touching `notchAt`**: extend `NotchResult` with `shoulderLIdx` / `shoulderRIdx` (additive) and apply `min(Q(sL), Q(sR))` in `cellScore` at `:781`. **Registry composition** at `:787` — iterate the keys of `weights`. Publish `fGraze`, `fGap`, `grazeRadii` (τ), `grazeSrc`, `grazeDistM` on `CellScore` — **plus three this list omitted** *(corrected 2026-08-24d against `bestSpotTypes.ts`)*:
- **`grazeTau: GrazeTauSplit`** (`:316`) — τ **before confidence, split four ways by provenance**. This is not a diagnostic: it is precisely what MAKES `graze.conf.*` and `graze.scaleRadii` a recompose instead of a 177 ms rescore. Store the sum and the class table becomes a lie.
- **`minReachM`** (`:347`) — the honesty RANGE, `min` and not `mean` over the swept span, for the same reason `notchAt` takes `min(sL, sR)`: one blind direction invalidates the answer, and the sun only sets in one of them. Published on the UNKNOWN branch too — *"we looked 40 m"* is exactly what the panel must say about a cell it is refusing to score.
- **`grazeStepRadii`** (`:332`) — **an honesty channel this document describes nowhere.** It is `max over the summed window of Δα_i/ρ_i`: how coarsely the dwell integral was sampled. Above `GRAZE_STEP_TRUST_RADII = 2` (one disc DIAMETER, the width of a cut event) the body can **step over an entire cut between two samples**, so τ is not resolvable and the framing term is **UNKNOWN — a render class, never a low score and never a saturated high one**. At Quito's equinox the sun sets vertically, the azimuth reparameterisation collapses to 8 samples spanning 88° of altitude, and this reads **109**. It is to FRAMING what `c` is to the sweep, and it is what turns done-check (4) below from a wish into a mechanism. Hoist `depthOfDistM`'s constant `Math.log(trustRadiusM/30)` out of the call (verified `:175` recomputes it every call; 18.3 → 9.7 ns, ≈22 ms/solve, free) — and hoist the per-edge depths **out of** the 8-column disc loop: one `log` per cell-azimuth, not eight.

**DONE-CHECK:** (1) `bestSpotGolden.test.ts` pins the 17-scenario table (§1.1) to 4 dp against `scoringVersion "v1"`; **commit it RED first.** (2) The three headline separations: grazing vs perpendicular ridge **0.9912 vs 0.4843** *(measured; forecast 0.9897 / 0.4830)*; F/P spread **> 0.3** and `corr(F,P) < 0.8` (measured **0.5401 / 0.6268**, r² 0.393); F responds to height on the fixed-1500 m sweep. (3) Invariance: τ within 10 % across Dnipro/Tromsø/Sydney × 4 dates (measured spread 6.5 %) and within 10 % across the 0.25°/0.05° lattices (measured 0.8 %). (4) A degenerate track (Quito 2026-03-21, 8 samples, altitude step > ρ) reports **UNKNOWN-framing, not F = 0**.

**SHIPPED TESTS THAT CHANGE — 8 assertions, all verified to exist at these lines:**

| file:line | assertion today | what happens | why |
|---|---|---|---|
| `bestSpotMetric.test.ts:371-386` | `silTangency` "TRIANGULAR … gated on a BUILT setter"; `terrain → 0`, `tree → 0` | **rewrite** | that IS the gate the owner asked to remove. Re-express as the two-arm `cut` + relief/conf/depth `Q`. |
| `bestSpotMetric.test.ts:972-1007` | `F/P` spread `< 0.065`, min ratio `> 0.93` | **INVERT** | the describe is explicitly "NOT A FIX, A BASELINE". New spread **0.5401**, corr **0.6268**, min ratio **0.0179** *(measured; forecast 0.5408 / 0.6260 / 0.0171)*. Assert spread > 0.3 and corr < 0.8; move 0.0619/0.9985 into the docstring as the recorded before. |
| `bestSpotMetric.test.ts:1010-1035` | `expect(wallF).toBeCloseTo(deckF, 15)` | **flip to `deckF > wallF`** | this is the defect being fixed (0.4158 vs 0.3962). |
| `bestSpotMetric.test.ts:617` | `expect(a.score - b.score).toBeCloseTo(0.0299, 3)` | **new literal 0.0357** | the `> 0.025` guard on `:616` **survives**; only the pinned number moves. |
| `bestSpotMetric.test.ts:855-868` | `expect(bridge.f).toBeGreaterThan(0.8)` | **repair the fixture, then `> 0.4`** | verified defect: `bands: [[0.31,0.38]]` with **no `bandSrc`/`bandDistM`**, and the `ray()` helper at `:162` (`if (o.src !== undefined && o.groundSrc === undefined) merged.groundSrc = o.src`) silently retags the GROUND edge as `"deck"`. Same fixture defect LENS B found in PIN 3. Repaired → F = 0.4158. |
| `bestSpotComposition.test.ts:212` | `expect(withDeck.f).toBeGreaterThan(0.8)` | **relax to `> 0.5`** | 0.5972 at scale 1.75. Prefer relaxing over dropping the scale to 1.00 — discrimination is the point. |
| `horizonSweep.test.ts:886-896` | `silTangency(ev, underside, RHO, p) ≈ p` ×2 | **will not compile** — re-express against `grazeSample` or fold into the composed pin below it | signature and semantics change. |
| `horizonSweep.test.ts:989` and `:1004` | `withDeck.f > 0.8`; `silTangency(mid, bands[0][0], RHO, 0, 3000) ≈ depthOfDistM(1492)` | **same two reasons** | |

**SHIPPED TESTS THAT MUST NOT CHANGE** (each verified to still pass under the new kernel, B): `bestSpotMetric.test.ts:389` (unsampled ray ⇒ 0) · `:852` `expect(clean.f).toBe(0)` — **exactly 0**, `smoothstep(0.05,0.40,0)` is hard 0 · `bestSpotComposition.test.ts:213` `expect(bare.f).toBe(0)` — exactly 0 on the real chain (relief −0.02256°) · `horizonSweep.test.ts:1012` "the water under the bridge is NOT a silhouette" — **survives for a better reason: relief, not provenance** · `bestSpotMetric.test.ts:616, 620-625` (PIN 3 margin, `a.p ≈ b.p`, `a.v > b.v + 0.15`, `alt*` ordering, `srcStar`) · `:825-838` (`G(V)` soft gate: 0.1933 vs 0.6935, was 0.2308) · `:283-332` (band union, `isBuiltSrc`, `nearestEdgeDeltaDeg` ×3) · **all 8 PIN-2 `notchAt` tests**, PIN 1, PIN 4, PIN 5, `bestSpotComposition.test.ts:230-296` · `bestSpotTrack.test.ts`, `localDsm.test.ts`, `landcoverRaster.test.ts` (zero contact).

**Cost:** GRAZE was measured at **15.6 ns per cell-azimuth** with `f` shared from `V` (B) = +3.7 % of the shipped `cellScore` path (418 ns/cell-az) and +11 % of the fused floor (140 ns/cell-az). It also **removes** `silTangency`, measured at **64 ns/cell-az** (A). Net effect **UNVERIFIED** — both were measured in isolation, not against each other.

---

### **S3c — SOLVER KERNEL: mask, reach, fused pass, term buffer** (pure lib)
**Files:** `horizonSweep.ts` · new `src/lib/geo/bestSpotSolver.ts` · tests.

1. **`sweepAzimuth(dsm, hulls, az, lift, out, { scoreMask })`** — one optional `Uint8Array`; skip the per-cell binary peak search and band assembly where the mask is 0. **Measured 1.80–1.91× standalone at 3 m/300 m** *(2.20× was the forecast; corrected 2026-08-24d against `bestSpotSolver.test.ts:334-358`)*. **The cheapest single lever in the feature and a ~10-line change to a shipped, tested function.**

   > **The shipped pin is `≥ 1.7×` WITH THE TWO ARMS INTERLEAVED, and the interleaving is the whole fix.** A ratio is self-normalising only when both arms meet the SAME contention. Timed once each in sequence inside the 12-way-parallel runner, the same speedup reported **1.58×** — the unmasked arm ran while the box was quiet and the masked arm ran while three other workers woke up. The threshold never moved; what changed is that each round now pays for both arms back to back and the MEDIAN of the per-round ratios carries the claim.
2. **`reachM`** on `RaySweepOut` / `RayEvidence` — the along-ray distance of the last KNOWN slot — and **gate `openSky` on it** (verified today's `openSky` at `horizonSweep.ts:774` never asks how far the evidence reached).
3. **The fused score pass**, written against the four exported kernels so it stays diffable, emitting the **75 B/cell TERM BUFFER of §5.3 — never `S`** *(corrected 2026-08-24d: 59 B froze five `gap.*` leaves the class table calls recompose)*. Plus the trivial COMPOSE pass.
4. **Absolute azimuth-lattice snapping** behind an option (`bestSpotTrack.ts:652-666`) + a hull cache keyed on the snapped azimuth.

**DONE-CHECK:** (1) `sweepAzimuth` with a full mask is **byte-identical** to the unmasked call; with a disc mask it is ≥ 1.7× faster on a 469² grid. (2) The DSM-truncation pin: with the DSM truncated at 350 m, the cell reports `minReachM ≈ 350` and `openSky = 0` on all 40 rays — **today it reports openSky 40/40 and S = 0.6633 against the truth's 0.0000.** (3) The collar pin: a rim cell 290 m up-sun scores 0.0467 with the collar and 0.6619 without. (4) The fused pass reproduces `cellScore` to 1e-9 on the composition fixture, and its measured cost at 469²/K=40 is within **450 reference-ms for `scoreMs` and 700 reference-ms for sweep+score** (`bestSpotSolver.test.ts:687-745`). *(Corrected 2026-08-24d: this said ≤ 250 ms. **250 ms was the INLINED floor** — §2.1 row 10′. The shipped pass is deliberately the middle case, because §7 itself requires it "written against the four exported kernels so it stays diffable", so it pays a real `RayEvidence` shape and a real `discVisibleFraction` call per cell-azimuth and lands **1.7× above the inlined floor and 2.1× below the object API**. Closing that 1.7× means inlining the kernels — a trade against diffability, recorded rather than silently taken.)* (5) COMPOSE from the term buffer reproduces `S` to 1e-12 and measures **~2.5 ms** at 201², pinned `< 5` reference-ms *(the `< 1 ms` here came from the 0.272 ms model and is not achievable for this arithmetic — see §5.3)*. (6) With absolute snapping, a **+1-day** track shares ≥ 35 of 39 azimuths (**measured 36/39**); without it, 0/40.

> **A WALL-CLOCK BUDGET INSIDE VITEST IS A CLAIM ABOUT THE RUNNER, NOT ABOUT THE CODE** *(added 2026-08-24d)*. Three of these pins went red under load with **zero regression behind them** — a 3 m solve measuring 646 ms standalone and 1,335–1,522 ms in a 12-way-parallel suite. **Every wall-clock budget in this slice is expressed in REFERENCE-MACHINE milliseconds via `test/lib/geo/_perf.ts`**, calibrated **per iteration** (a single up-front calibration was measured reporting `k = 1.04` while the solves it normalised ran 1,335 ms), with a calibration workload of **32 M iterations ≈ 27 ms** — anything shorter fits inside one scheduler quantum and reports exactly 1.00 under any load. Budgets unmoved; all five pins falsified by mutation.

---

### **S3d — WORKER + STORE + FEED + LADDER + REFINEMENT** (the plan's S3)
**Files:** `lib/geo/bestSpotWorker.ts` · `scene/bestSpotFeed.ts` · `store/bestSpot.ts` · `tuning.ts` (`BESTSPOT` block) · `StylizedTiles.ts` · `prefs.ts` · `fences.test.ts` · `scripts/verify-bestspot.mjs`.

Build: the long-lived module worker (transferable ArrayBuffers only, no SharedArrayBuffer) · the **six residency tiers** of §2.2 · the **progressive ladder** 24 → 12 → 6 → 3 m with the land grid and ring projections built ONCE and shared · **24 m for coarse-during-drag** · the **refinement machinery** of §3.4 (**four epochs** — `terrainEpoch` + `vtiles.version()` + `seatEpoch` + **`builtEpoch`** — + 90-frame debounce + re-climb from R0 + fresh DSM, plus `sourcesEpoch` as the T1 hull-cache key) · **all three refusals** (`"no-landcover"` · `"no-tiles"` · `"no-built-geometry"`) · the hot-swap seam and persistence of §5.6/§5.7 · `stepBestSpotFeed` in the FEEDS-LAST band immediately after `stepPlanFeed`.

**DONE-CHECK:** the plan's S3 cross-model check stands (seat FPV at the top-ranked non-deck cell via the shipped tempPin+tempFpv path, wait for `planFeed`'s own profile — raycasts + `sweepMeshEdges`, machinery this feature does NOT share — and assert `isBlocked(...) === false`; the lowest-ranked accessible cell asserts `true`). **Plus:** (1) first ink ≤ 120 ms warm, fully refined ≤ 1,200 ms warm — **shipped as `scripts/verify-bestspot.mjs:338-343` and BROWSER-measured at 45.4 ms / 523.8 ms**, so both pass with 2.6× and 2.3× of headroom *(the forecast was 55 / 731–948 ms; the browser beat it)*. (2) A pin mid-reservoir returns 0 candidates and every cell `A_hard = 0`. (3) **A disc with fewer than the floor of parsed z14 tiles renders entirely UNMAPPED — it does NOT paint a `hard = 1` grid** (verified `landcoverRaster.ts:182`: zero sources → every cell `unknown, soft 0.45, hard 1`). **Two more refusals ship beside it and each needs its own case:** a disc with ZERO painted landcover cells (`"no-landcover"` — a fetch failure, not a rural site) and a disc with **dense parsed MVT and zero building meshes** (`"no-built-geometry"` — the case that painted the owner's hero pin warm and uniform at score byte 187 while every unit gate was green; it must also SELF-HEAL via `builtEpoch` once the tiles land). (4) `scoringHash` mismatch drops the job — inject a stale result and assert no upload. (5) A streaming burst of 20 `load-model` events triggers **exactly one** re-solve. (6) fences: `bestSpotFeed → store/bestSpot` added to the sanctioned store-bridge map; `bestSpotWorker.ts` / `bestSpotSolver.ts` contain no `components/globe/tuning` import; every BEST SPOT engine read AND-ed with `!isMobileShell && !coarsePointerShell`, the gate named in exactly ONE engine file. (7) Measure the worker bundle — `planElevationsM` drags comet/targets/showers into the chunk (AS-BUILT open item 8). **ANSWERED: 126 KiB / 50.6 KiB gzipped, `astronomy-engine` roughly half of it, and no `three`.** The `three`-free property is the one that was actually at risk and it held; the remaining open question is not the size but the **cold cache on Wix's CDN**, which is untested because prod is still dark (backlog T50).

---

### **S4 — GL SHEET** (the visual spec, §6)
Land the two structural corrections **first**, because they change the material's shape rather than its constants: **(i)** `premultipliedAlpha = true` + a fragment writing `vec4(ink*aInk, aVeil)` with two independent alphas; **(ii)** ONE RG8 `LinearFilter` texture with `.g` as the 4-level ordinal standability axis.
Then: heat tokens (11 + 11) into `tokens.css` → regenerate `lib/theme/tokens.ts` → `lib/theme/heatPalette.ts` → `scene/bestSpotSheet.ts` at **renderOrder 4** → plumb line + spoke + tick + chip → top-K markers at 5.

**DONE-CHECK (read the LIVE material and scene graph — the `__globe.ultraLook` lesson):** `depthTest === true` (fails if `makeFlatOverlayMaterial` is reused) · `material.premultipliedAlpha === true` · score texture `colorSpace === NoColorSpace` **and `minFilter/magFilter === LinearFilter`** (a `NearestFilter` regression makes `fwidth` blocky and is otherwise invisible) · LUT `colorSpace === SRGBColorSpace` · **max sampled `aVeil` ≤ 0.30 AND min `(1 − aVeil)` ≥ 0.70** · `okL(stop[i+1]) > okL(stop[i])` for all 10 Inferno pairs · `renderOrder === 4` on **every child individually** · texture allocated at 601² · **zero colour literals in the `BESTSPOT` block** · `projectedLen(tilt, dAz) ≥ 0.70 × sheetAltM` over a 0…88 × 0…360 sweep. Shots `verify-shots/bestspot-01-nadir.jpeg` / `-02-oblique.jpeg` proving the map reads through, UNKNOWN is visually distinct, and the plumb line + chip are legible from directly above.

---

### **S5 — DESKTOP PANEL** (§6.9). Plan's S5 done-check stands, plus: the DEV-gated 4-slider `TUNE` weights strip lives in `panels/BestSpotPanel.tsx`, **never in `controls/**`**; `SCORING: default | custom (N fields) · <hash>` appears in the status line whenever a persisted patch is non-empty.

### **S6 — LIVE SCRUB + LIVE LIFT.** **Re-pin, because the shipped pin cannot pass:** *"`hullBuilds` is EXACTLY 0 for a within-day scene-time scrub and for a 2 → 400 m lift drag, and grows by at most `ceil(Δaz/azStep)` for a day step (measured ≤ 2 of 39 with absolute lattice snapping, 40 of 40 without it)."* Both zeros are **browser-measured as built**.

**A radius change does NOT "increment exactly once"** *(corrected 2026-08-24d)*. It rebuilds **K hulls PER LADDER RUNG**, and the ladder is four rungs `[24, 12, 6, 3]`, so the shipped engine measures **+156 across the climb** (`scripts/verify-bestspot.mjs:231`); a second frame at the same radius costs **0**. The +1 forecast confused "the tier fires once" with "the tier costs one hull". Note that this row is also the positive control for the two zeros above, and that reading it correctly required fixing the WAIT and not the engine: `waitRefined` returned on `refinedMs > 0 && !solving`, neither of which carries any solve identity, so the checkpoints straddled a phase boundary and reported `+8` for a scrub that must build zero and `+0` for a radius change that must build K. With `quiesce()` in its place and the engine untouched, the same two rows read **+0** and **+156**.

Plus: **the coarse rung measures 35–49 ms, not 21** (`verify-bestspot.mjs:723`) — so it **must stay off the main thread**, and the pin that holds is **`drag adds < 12 ms to the idle frame`, measured 1.1 ms**, not a wall-clock rung budget. · full-solve p95 < 1,000 ms · mirror < 1 write per 8 frames · published grid ArrayBuffer identity stable across a no-op scrub · FRAME_PROBE median < 35 ms for the whole drag.

### **S7 — HONESTY LAYER.** Built-density prior (buildings/km² off the parsed tiles: 558/21 vs 1/21 vs 0 — free) · provenance badges · the `reachM` panel line · the 1 m shortlist re-solve (§8 Q3). Plan's S7 done-check stands, with the measured target corrected: **a rural pin's pre-fix uniform score is 0.470–0.661, not 0.70.**

### **S8 / S9** — deferred as in the plan.

---

**Also correct in `BESTSPOT_PLAN.md` while in there:** §5's three-tier table and its 105/90 ms budget · §5's "the fused pass emits S" (it emits the term buffer) · §6's texture parenthetical (max is 601² under the ULTRA≤300 m rule; 500 m @ 3 m is 335², not 334², and it beats 201² by 2.8×) · §6's `renderOrder 9` → 4 · §6's entire alpha/contrast paragraph (computed over `#05070b` in sRGB; wrong on both counts) · `horizonSweep.ts:254-257`'s memory ledger (forgets the collar, 5.4× low) · AS-BUILT open item 1 (closed by S3b) and open item 3 (closed by S4's ordinal `.g`).

---

# 8. ANSWERED 2026-08-24 — all three were ruled, built and measured

> **This section used to read "OPEN QUESTIONS FOR THE OWNER" and it no longer is one.** All three
> were ruled, the rulings shipped, and each now has a leaf you can point at. It is left in place as
> the RECORD — the measurements are the reason each ruling was made — but a reader arriving here
> should not re-litigate any of it. The ruling and its shipped anchor lead each question; the
> original analysis follows underneath, unchanged.

| | question | **RULING** | shipped leaf | measured result |
|---|---|---|---|---|
| **Q1** | moon multiplier vs badge | **R7 — keep the multiply, RAISE THE FLOOR** (neither (a) nor (c) as recommended) | `worth.mode: "multiply"` (`bestSpotScoring.ts:399`) + `worth.effectiveFloor: 0.35` through `effectiveWorth` (`bestSpotMetric.ts:1327`) | `M_eff = 0.35 + 0.65·M`. The median moon night goes **0.020 → 0.256**; a full moon 0.864 → 0.911. **Exactly 1 for every sun kind** (`0.35 + 0.65·1` is 1 in IEEE doubles, asserted rather than assumed), so **no sun number moved**. The badge survives as a one-line A/B via `mode: "badge"`. |
| **Q2** | open at 1.7 m? | **R6 — YES, open at eye level, and offer the way out in one tap** | `defaultLiftM: 0` at `eyeM: 1.7` (`tuning.ts:3000-3006`) + the lift-suggestion chip (`BestSpotPanel.tsx:507-517`) | The 97.7 %-black disc is physically correct and the eight markers ARE the product, so the default stands. When the engine has found a lift that clears `emptyFieldFrac`, the chip reads `NOTHING CLEARS THE SKYLINE AT EYE LEVEL — TRY N m`. **The number is COMPUTED** — the lowest of `liftProbesM [10,20,40,80]` at 24 m that clears the floor, ~21 ms each — **never a constant.** |
| **Q3** | 1 m accessibility, or 1 m obstruction too? | **R8 — BOTH, on different triggers** (the split the question proposed) | `shortlistCandidates: 256` at `ultraCellM` every solve; obstruction behind `refineSpot(key)` (`store/bestSpot.ts:263`) | 1 m accessibility on **every** solve at +52–59 ms, invisible. 1 m obstruction only on the user-triggered `REFINE THIS SPOT` — **measured 1,504 ms**, `obstructionRefined: true`, and the one place in the feature a spinner is justified. |

---

### Q1 — The moon map is black ~26 nights in 30. Keep `M` as a multiplier, or move it to a badge?
**RULED: R7 — keep the multiply, raise the floor.** `worth.effectiveFloor 0.35`. The analysis below is why.

Measured (A), 30 consecutive days at Dnipro: moonrise `worth` **min 0.0003, median 0.0290, max 0.8639**. Because `M` multiplies (verified `bestSpotMetric.ts:791`), the best possible moon cell on a **median** night scores `0.029 × 0.7 ≈ 0.020` — **25× below the sheet's own legibility floor**. On 2026-08-24: moonrise 0.0938, moonset 0.0770. The plan calls that "honest and legible"; measured, it reads as "the moon feature is broken".

Three options, all cheap to build, but they are **different shapes** and picking one after S3d means changing the composition:
- **(a) keep `M` in the product** — the moon map is genuinely dark most of the month;
- **(b) raise `worth.floor` from 0.25** — compresses the honest signal;
- **(c) take `M` out of the per-cell product and render it as a DAY-QUALITY BADGE beside the disc** (`☾ THIS MOON IS WORTH 0.09`) — the field then ranks *where to stand for this moonrise* and the badge says *whether this moonrise is worth going out for*. The panel line is already drafted in §6.9.

Recommendation: **(c)**, with `worth.mode: "multiply" | "badge"` in the profile so it is a one-line A/B. This is the single largest taste lever in the metric.

**The owner ruled otherwise, and the ruling is better than the recommendation** *(R7, 2026-08-24)*: **keep `M` in the product and raise a SECOND floor** — `worth.effectiveFloor 0.35`, applied as `M_eff = 0.35 + 0.65·M` at composition time and **not** to `worth` itself. That preserves what (c) would have thrown away (a bad night still ranks below a good one, everywhere, in one number) and fixes what (a) got wrong (a bad night now **DIMS rather than VANISHES**: median 0.020 → 0.256). Option (b) — raising `worth.floor` — is the mistake the two-floors note in §5.2 exists to prevent: it compresses the honest signal *inside* the twilight gate. `mode: "badge"` still ships as the one-line A/B.

### Q2 — Does BEST SPOT open at 1.7 m (a 97.7 %-black disc) or at a default lift?
**RULED: R6 — open at 1.7 m, plus a COMPUTED lift-suggestion chip.**

Measured (A), central Dnipro, R = 300 m, 3 m, real buildings:
- **1.7 m:** 97.7 % of the disc scores exactly 0, 33.4 % is `A_hard = 0`, maximum **0.381**, median 0.000.
- **56.7 m:** 100 % of the disc scores above 0.5, maximum 0.844, median 0.629.

**The altitude slider is not a refinement — it is the difference between an empty map and a full one.** Physically the 1.7 m answer is correct (a 20 m building at 100 m subtends 10.4°; the sun lives in 0–6°) and the 2.3 % *is* the product. But the first thing the owner sees on first toggle is either "8 warm markers on a black disc" or "a full warm field at drone height".

This changes what gets built: the default `sheetAltM`, whether the panel leads with the slider, and whether the R0 rung is worth showing at 1.7 m at all (there is almost no ink to progressively reveal). It also decides whether `displayLo/displayHi` (0.15/0.90) are right — at 1.7 m the whole live population is in [0, 0.381].

### Q3 — R3 says the shortlist is ALWAYS 1 m. Does that mean 1 m ACCESSIBILITY, or 1 m OBSTRUCTION too?
**RULED: R8 — 1 m accessibility on every solve (`shortlistCandidates 256`), 1 m obstruction behind `REFINE THIS SPOT` (measured 1,504 ms).** ULTRA above 300 m radius is forbidden, as recommended.

Measured (A):
- 1 m **accessibility-only** re-solve of the top ~256 candidates: **52–59 ms.** This is what tells you "stand on the footpath, not in the hedge" — the resolution the landcover data actually supports (§8: MVT coordinates are sub-metre but polylines are generalised at 5–20 m, so class boundaries carry a 1–2 cell ribbon).
- 1 m **obstruction** re-solve: the `queryRay` calls are 6.58 ms, but they need a **1 m hull, which costs 985 ms** (and 900 MB resident at K = 40, so it must stream).
- The value of the extra second: 1 m vs 3 m gives **Spearman ρ = 0.969, mean |ΔS| 0.0054**, and changes **4 of the top 20**.

So: **1 m accessibility on every solve (+59 ms, invisible), and 1 m obstruction only as a user-triggered `REFINE THIS SPOT` action (~1.0–1.6 s, the one place a spinner is justified)?** Or must the shortlist's obstruction be 1 m automatically, paying ~1 s on every solve? *(Related and recommended regardless: forbid ULTRA above a 300 m radius — 1 m @ 500 m is 1,002,001 cells at ~12.2 s, UNVERIFIED as a run but extrapolated by cell count from measured 1 m @ 300 m figures.)*

---

## UNVERIFIED — carried forward from all four agents

- ~~**Nothing in BEST SPOT has been in a browser.**~~ — **RESOLVED 2026-08-24d.** The feature shipped and was browser-verified (`scripts/verify-bestspot.mjs`, 100 PASS / 0 FAIL, reproduced twice; shots `verify-shots/bestspot-01…08`). The forecasts held or were beaten (first ink 45.4 vs 55 ms, refined 523.8 vs 731–948 ms), **and the browser found what no node harness could**: nine defects invisible to vitest, headlined by a disc that scored every one of 31,417 cells at the same byte because no building geometry ever reached the worker's DSM — with every unit gate green. **Still UNVERIFIED: Wix cloud** (prod is dark behind the nameserver gate; backlog T50).
- **Worker spawn cost** (module instantiation + first-message latency) was not measured; typically 5–30 ms, excluded from every wall-clock figure.
- **The `force-cache` claim** that the worker's second MVT fetch is served from the browser disk cache is unverified — node's fetch has no HTTP cache, so all "warm network = 0 ms" rows were measured from a `/tmp` file.
- **Mid-tier-phone ×5–10** is taken from the plan's framing, not measured. Moot under the desktop fence.
- **The terrain TIN (392 tris) and 800 canopies in the latency harness are synthetic.** `rasterizeTinGround` and `addCanopy` timings are approximations; a real streamed multi-LOD tileset may hand the rasterizer many more triangles that miss the disc. Every other stage ran on real OpenFreeMap z14 data.
- **The 1 m @ 500 m ULTRA cost (~12.2 s)** is extrapolated by cell count, not run.
- **The far-zone fusion does not exist**, so the 0.67 s / 40-frame figure is derived from `PLAN.terrainBinsPerFrame=3` over `PLAN.azBins=120` plus a 21-sample march, not timed. Consequence for GRAZE: **`Depth(e)` is only as good as `RayEvidence.*DistM`, so a real 8 km ridge will report the collar distance (~700 m ⇒ Depth 0.68) until the FAR distance field lands** — under-crediting exactly the case owner feedback (i) asked for.
- **The 8 km / 6 km / 2.5 km ridge scenarios in §1.1's table are SYNTHETIC `RayEvidence`**, not swept from a real DSM (no producer can emit those distances today). Their Depth values (0.96–1.00) are a forecast of what the solver will emit, not a measurement of what it does emit.
- **GRAZE was never run against a real dense-Dnipro DSM** — only against flat water with one deck (the composition fixture) and against synthetic skylines. The 13,383-building-ring case is unmeasured.
- **The 15.6 ns/cell-azimuth GRAZE cost** was measured in a standalone loop with `f` supplied from a precomputed array; it approximates the fused loop but is not the fused loop, and it is not the net cost against the `silTangency` it replaces.
- ~~**The 59 B/cell term buffer and the ~0.6 ms compose** are arithmetic~~ — **RESOLVED 2026-08-24d, and the caveat was right to be there.** The buffer shipped at **75 B/cell** (the 59 B layout froze five `gap.*` leaves the class table calls recompose) and COMPOSE measures **~2.5 ms at 201²**, not 0.272. The cost model was faithful to the arithmetic it modelled and wrong about the machine: it counted ~15 multiply-adds and missed one `exp`, one `sqrt`, two `smoothstep`s and 3 MB of streamed buffer. **Both corrections leave the architectural claim exactly where it was** — recompose is > 200× cheaper than a re-solve and fits in one frame.
- **`CONF` (terrain 1.0 / building 0.9 / deck 0.9 / tree 0.45)** and **`RELIEF_HI_DEG 0.40`** are judgements calibrated to plan §8's provenance statistics, not swept and not calibrated to any photographic outcome. `GRAZE_SCALE_RADII` **was** swept (6 values, §1.1). These are the primary taste-pass targets.
- **`sanitizeScoringPatch`'s exact clamp ranges** (notch `maxWidthDeg ≥ 0.7` so the width denominator stays positive at max lunar ρ, `discColumns 1..64`, `lCeilDeg 0.5..30`) are proposed, not derived from a sweep — pin them in the endpoint tests rather than trusting them here.
- **The forecast red/green status of the 8 changing assertions** was computed by reproducing each fixture in a scratch harness, not by running `npm test` against a modified `bestSpotMetric.ts`. Two of them (`horizonSweep.test.ts:886-896`, `:1004`) call a signature the proposal removes, so their status is "will not compile", which no harness can confirm. *(I did verify all 8 line references and the fixture defect at `:855-868` by reading the files this session.)*
- **All D captures ran under headless Chrome with SwiftShader.** Rasterisation is spec-conformant so pixel values should match a GPU, but MSAA/bloom paths were not compared against a real GPU frame. **The oblique backdrop is unmeasured** (the oblique capture returned statistics byte-identical to the nadir dark-drape capture).
- ~~**The 8 interior TURBO stops** were reproduced from memory~~ — **RESOLVED 2026-08-24d.** Regenerated from Google's canonical 256-entry table into `tokens.css:113-123`; all 8 differ, the endpoints matched, and the lightness peak relocates to t = 0.5. §6.1 now carries the shipped hexes.
- **`displayLo/displayHi = 0.15/0.90`** come from the AS-BUILT hero numbers, not from a solved disc — see §8 Q2. They are exactly the two numbers a taste pass will move first.
- **`topK = 8`** is derived from the `.pp` window's `max-height` formula, not from a rendered panel.
- **`fwidth` availability:** the app's WebGL context version was not checked.
- **Hull residency at 101 MB** is a byte count from `hullBytes`, not an observed browser heap; whether a tab tolerates it alongside three.js, the tile cache and the enriched bake is untested.
- **Score-distribution figures (97.7 % zero at 1.7 m)** depend on the MVT `render_height` building model with a 12 m default plus 800 synthetic 10 m canopies. Direction and order of magnitude are robust; the exact percentages are not.
- **The annual azimuth envelope [224.1°, 312.2°]** was sampled every 5 days for `sunset` only; moonrise/moonset envelopes are wider and were not measured.
- **The two-scale shortlist idea** (a 1 m near patch spliced onto the 3 m hull beyond ~150 m) is the only route to a genuinely cheap 1 m obstruction re-solve; it is not supported by the shipped grid-global sweep API and its cost is unmeasured.