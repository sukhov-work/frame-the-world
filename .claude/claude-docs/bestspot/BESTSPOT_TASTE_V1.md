# BEST SPOT — TASTE & COVERAGE

> # ⚠ READ THE ADDENDA FIRST — THE BODY BELOW IS PARTLY MEASURED FALSE
>
> This document ACCRETED three passes, and **each addendum measured the one before it wrong.**
> Read front-to-back it will actively mislead you.
>
> **START AT § ADDENDUM 2026-08-26i (at the end). It is the only current diagnosis.**
> Then § ADDENDUM 2026-08-26h for the corridor measurement (the alignment locus *is* the shadow
> locus, pointing at `way/1202608487` to 0.23°) and its still-unfixed side finding that the PLANNER
> is missing the monument.
>
> **THE BODY'S CENTRAL CLAIM IS DEAD.** §5's ordering — *"A is the enabler: B and C cannot rescue a
> cell whose score is exactly zero, so nothing else matters until the moment becomes a dimension"* —
> was the premise of `SWEEP_MODE_MAP.md` and `SWEEP_MODE_SCHEDULE.md`, and it is **measured false**:
> his cell already had a contact at the shipped 4° window top, and opening the gate fully still
> leaves him 76th-percentile. The blocker is `access.soft.unknown = 0.45`. See `README.md` §1.
>
> **WHAT IN THE BODY IS STILL TRUE AND WORTH READING:**
> - **§2** — the proximate MECHANISM of the zero: `V ≤ 0.15` → `G(V) = 0` → `S = 0` exactly, and
>   `shortlist()` drops the cell at `if (!(scores[i] > 0)) continue` before ranking. `G` MULTIPLIES.
> - **§1.4** — **the shortlist is FAITHFUL to the field.** 89.8 % of cells scoring ≥ 90 % of the
>   field best sit within 25 m of a marker, 100 % within 60 m. **More markers, a wider disc or a
>   looser NMS would never have found his spot** — this is why "coverage" was the wrong diagnosis.
> - **§1.1 / §1.3** — the field is FLAT (best cell 0.400 against a window to 0.90; 46.9 % clipped to
>   `displayLo`) and the shortlist carries almost no information (eight rows span 5 %, six of eight
>   peak at the same minute).
> - **§3** — what the metric cannot see even at the right moment: **`F_gap` is the exact DUAL of an
>   apex shot** (a lone spire at `az*` gives `F_gap = 0` exactly), `F_graze` saturates, `P` says near
>   is bad, and there is **no landmark data anywhere** in the vocabulary.
> - The **ephemeris is sound** — the disc's `contactMs` agrees with `astronomy-engine` to 20 s.
>
> Full measured tables: **`MEASUREMENTS.md`** (§7 is this document's ablation ladder, transcribed
> because `verify-shots/` is gitignored).


**Design note, 2026-08-26f.** Written against the owner's QA report of the same day. Supersedes
nothing; `BESTSPOT_SPEC_V2.md` remains the shipped spec, and §1.1 of it is the objective this note
argues about. Nothing here is implemented — the recommendations are ordered, costed and gated on
one owner decision (§7).

Mode: design · tier: deep · evidence tier: **BROWSER-MEASURED** (`scripts/probe-bestspot-taste.mjs`,
raw numbers in `verify-shots/probe-bestspot-taste.json`) plus an independent ephemeris cross-check
in Node against `astronomy-engine`.

---

## 0. The report, and the answer in four lines

The owner opened a moonrise heatmap at `p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`,
saw no suggestion in the middle of Yavornytskoho avenue, and hand-picked
`f=48.451827,35.070311,2.4,126.8,2.6,38.0` — which gave him the shot he wanted: the full moon
resting on the apex of the Monument of Glory. He asked how to improve **taste** and **coverage**.

1. His cell was **not excluded and not crowded out. It scored exactly 0**, because the moon is not
   visible from it during the swept window — measured `V ≤ 0.15`, and `G(V) = smoothstep(0.15, 0.75, V)`
   is a multiplier.
2. The moon is not visible from it during the swept window because **the window ends 1.9° below his
   photograph**. The disc solves the moonrise *contact* at 15:57:36Z (moon alt −0.24°, az 116.7°).
   He shot at 16:44:43Z (alt **+5.90°**, az **125.4°**) — 47 minutes later, 8.7° further round.
3. So the instrument answered *"where can you watch the moon touch the horizon"* correctly. He asked
   *"where can I stand so the moon sits on that monument"*. Those are different questions and only
   one of them is implemented.
4. **"Coverage" is the wrong diagnosis for the marker spread.** The eight markers already sit on
   89.8 % of the cells scoring ≥90 % of the field's best, and one of them was **42 m** from his own
   pick. The shortlist is faithful to the field. The field is answering the wrong question.

---

## 1. What was measured

`scripts/probe-bestspot-taste.mjs` reproduces the owner's disc (same pose, same instant, MOONRISE,
`▦ 3D DETAIL` on, 11 s of streaming before the first solve, quiesced on the finest rung), reads the
published field pack off the live GL sheet, and locates his hand-picked cell in it.

### 1.1 The field

| | |
|---|---|
| grid | 201² @ 3 m, radius 300 m, `sheetAltM` **1.7 m**, `suggestedLiftM` 10 |
| verdicts | 25,578 scored · 8,984 unknown · 5,839 inaccessible (of 40,401) |
| coverage / unmapped | 1.000 / 0.000 — evidence is complete, this is not an honesty failure |
| **best cell in the whole disc** | byte 85 → **S = 0.400**, against a display window that runs to 0.90 |
| **at the display floor** (`S ≤ displayLo` 0.15) | **11,985 / 25,578 = 46.9 %** |
| display-byte histogram (16 buckets) | `13778 · 8704 · 1558 · 993 · 533 · 12 · 0 …` |

**87.9 % of every scored cell lands in the bottom two sixteenths of the display window.** The map is
very nearly one colour, and that is not a rendering bug — it is the honest picture of a metric whose
best answer here is 0.400.

### 1.2 The owner's cell

| | |
|---|---|
| position | 82 m from the disc centre (E −51.6 m, N +64.2 m) — well inside |
| stand class | **`SCORED-reachable`** — no gate excluded it |
| display byte | **0** — tied with 11,984 other cells; 13,593 strictly better; percentile 0.469 |
| nearest shortlist marker | **42 m** (rank 4) |

### 1.3 The eight rows

| rank | S | contact | bearing | peak time vs contact | dist to his pick |
|---|---|---|---|---|---|
| 1 | 0.3989 | gap | 311° | −4.1 min | 155 m |
| 2 | 0.3940 | gap | 316° | −2.7 min | 111 m |
| 3 | 0.3908 | gap | 317° | −4.1 min | 86 m |
| 4 | 0.3835 | gap | 326° | −4.1 min | **42 m** |
| 5 | 0.3828 | open | 197° | −4.1 min | 335 m |
| 6 | 0.3818 | open | 140° | −4.1 min | 346 m |
| 7 | 0.3807 | open | 145° | −4.1 min | 312 m |
| 8 | 0.3796 | open | 37° | −4.1 min | 266 m |

Two things to notice. The whole shortlist spans **0.3796 → 0.3989 — a 5 % spread**, so the ranking
carries almost no information. And **six of the eight peak at the same minute**: the "eight places"
are eight viewpoints on one 90-second event.

### 1.4 Marker coverage — the owner's word, measured

| threshold | cells | within 25 m of a marker | within 60 m |
|---|---|---|---|
| ≥ 90 % of the field's best byte | 59 | **0.898** | 1.000 |
| ≥ 80 % of the field's best byte | 248 | 0.617 | 0.831 |

The shortlist is not losing the good field. Adding markers, widening the disc or loosening the 25 m
non-maximum suppression would not have produced his spot, because his spot is not in the good field.

---

## 2. Why his cell scored zero — the causal chain, each link measured

Each hypothesis was expressed as a live scoring patch through `__globe.bestSpotTuning` and the disc
re-measured. All eight ran against a profile reset to the shipped default first.

| # | hypothesis | patch | his cell's byte | verdict |
|---|---|---|---|---|
| base | — | shipped | **0** | — |
| H1 | the landcover ladder demotes the carriageway | `curves.accessSoftExponent: 0` (kills `A_soft` entirely) | **0** | **REFUTED** |
| H1b | …specifically as `majorRoad` (soft 0.15) | `access.soft.{majorRoad,road}: 1` | **0** | **REFUTED** |
| H2 | `L` refuses a contact above 5° | `curves.lCeilDeg: 30` | **0** | REFUTED |
| H3 | the track weight discards the sky | `trackWeight.altScaleDeg: 30` | **0** — field byte-identical to base | REFUTED |
| H4 | `P` penalises near foreground | `curves.depthTrustRadiusM: 200` | **0** (field best 0.400 → 0.456) | REFUTED *for his cell* |
| H5 | H2+H3+H4 together | — | **0** | REFUTED |
| H6 | H5 + both global multipliers removed | + `worth.effectiveFloor: 1` | **0** | REFUTED |
| **H7** | **the visibility gate vetoes it** | `gates.{vGateLo: 0, vGateHi: 0.05}` | 0 (field still compressed) | — |
| **H8** | H7 + headroom | + `accessSoftExponent: 0`, `effectiveFloor: 1` | **84** (field best 230) | **CONFIRMED** |
| **H9** | read `V` directly: `S ≡ V` | H8 + `weights {v:1, l:0, p:0, f:0}` | **0 ⇒ V ≤ 0.15** | **CONFIRMED** |

**H6 vs H8 is the discriminator.** H6 carried *more* score-raising patches than H8 and still read 0;
the only thing H8 removed was the gate. And H9 measures the quantity directly rather than inferring
it: with `S ≡ V`, his cell's byte is 0, so **`V ≤ 0.15`** — the moon's disc is visible from where he
stood for at most 15 % of the weighted moonrise window. `smoothstep(0.15, 0.75, V)` is **exactly 0**
below `vGateLo`, so `S = 0` exactly, `composeScores` writes 0
(`bestSpotSolver.ts:1721-1729`), and `shortlist` drops the cell before ranking at
`if (!(scores[i] > 0)) continue` (`bestSpotWorker.ts:834`).

Nothing here is a bug. Every link behaved as designed.

### 2.1 The upstream cause: the window ends below his photograph

`eventTrack` sweeps from airless `TRACK_TOP_ALT_DEG = 4°` down to `alt(t0) − 3ρ`
(`bestSpotTrack.ts:319, 323, 605, 626-627`). Independent cross-check with `astronomy-engine` at his
own coordinates:

| instant | what it is | moon alt | moon az | sun alt |
|---|---|---|---|---|
| 15:57:36Z | the disc's `contactMs` | −0.24° | 116.73° | +5.16° |
| 15:57:56Z | true moonrise (independent) | — | — | — |
| **16:44:43Z** | **the owner's photograph** | **+5.90°** | **125.43°** | −1.94° |

The engine's contact and the independent moonrise agree to **20 seconds** — the ephemeris half of
this instrument is sound. But his moment sits **1.9° above the top of the swept window** and 8.7°
further round the horizon. It is not a low-weighted sample. **It is not a sample.**

That is also why H3 changed nothing: flattening `exp(−max(0,α)/altScaleDeg)` re-weights samples
inside the window, and his moment has none to re-weight.

Two more consequences of anchoring on the geometric contact, both visible in the same run:

- **The light was wrong at the anchor.** At 15:57:36Z the sun is **+5.16°** — broad daylight. The
  twilight gate is near its floor, so `M_eff` cuts the entire field. At his own moment the sun is
  −1.94°, inside the `worth` plateau (`[−6°, +0.5°]`, `bestSpotScoring.ts:417-421`) — the moon is
  worth several times more. **The instrument solved the worst-lit minute of the event.**
- **The scrubber and the disc disagreed silently.** The UI clock read 19:44 local; the disc was a
  statement about 18:57 local. Nothing on screen said so.

---

## 3. Even at the right moment, the metric cannot see his composition

The moment is the reason his cell scored zero *here*. It is not the whole taste gap. `S`'s four
preference terms (`bestSpotMetric.ts:1162-1191`, weights `{v 0.15, l 0.30, p 0.25, f 0.30}`) contain
no notion of a **subject** — a thing you deliberately point the body at.

- **`F_gap` is the exact dual of what he wanted.** `notchAt` scores *sky framed between two masses*.
  It excludes everything within ±ρ of `az*` from both the floor and the two shoulders
  (`bestSpotMetric.ts:766, 786, 791`), and `depth = min(sL, sR) − floor` (`:799`) kills anything with
  one flank. **A lone spire at `az*` can neither be a shoulder nor lower the floor ⇒ `F_gap = 0`
  exactly.** There is no term anywhere scoring *mass surrounded by sky*.
- **`F_graze` is linear in the occluder's angular width and then saturates.**
  `τ ≈ c̄·q̄·conf·(W/ρ)·k` and `F = 1 − exp(−τ/1.75)`. A 4° ridge reaches τ ≈ 13 → **F = 0.9995**;
  a 0.3–1.0° spire apex reaches **F ≈ 0.51–0.85**. The spire is not zeroed — it is *out-saturated*,
  and the ridge wins over a broad region of cells while the spire alignment is a knife-edge corridor
  that the 25 m NMS then collapses to one row.
- **`P` says near is bad.** `P = ln(D/30)/ln(3000/30)`. A 20 m monument at 150 m scores **0.35**;
  a 3 km ridge scores **1.00**. For a landmark composition, near is the entire point — near is what
  fills the frame. Measured: shrinking `depthTrustRadiusM` to 200 m lifted the field's best from
  0.400 to 0.456 and reordered the shortlist (H4).
- **`L` can actively penalise an apex shot.** `alt*` is the *lowest* altitude at which the disc is
  ≥50 % visible. If the body sets behind a mass and stays behind it, `alt*` climbs and
  `L = 1 − smoothstep(dipFloor, 5°, alt*)` collapses — 0 at and above 5°.
- **There is no landmark data in the pipeline at all.** The complete occluder vocabulary is
  `OccluderSrc = "none" | "terrain" | "building" | "tree" | "deck"` (`bestSpotTypes.ts:160`) plus an
  altitude, a distance and a `known` bit. No id, no name, no OSM tag, no prominence. Control-validated
  greps over `src/lib/geo/` + `src/components/globe/` return zero for `monument · obelisk · spire ·
  prominence · landmark(scoring) · osmId · featureId(in bestSpot*)`, against live controls
  (`graze` 174 · `notch` 166 · `OccluderSrc` 27).

The Monument of Glory is in the DSM only by luck of one tag: `way/1202608487` carries
`building=yes` + `height=20` alongside `historic=memorial`, and the bake filter is
`way["building"]` (`scripts/bake/lib/overpass.mjs:32-33`). The `historic=memorial` + `memorial=stele`
ways 4 km away in the same city carry no `building` tag and are **invisible to PLUX entirely** —
absent from the bake, from the OpenMapTiles `building` layer, from the DSM and from the LandGrid.

---

## 4. Two defects found on the way (report only — not part of this design)

Both were found independently by two research passes and are cited, not fixed.

1. **`flattenTin` ignores `InstancedMesh.instanceMatrix`** (`scene/bestSpotFeed.ts:289-306`). It tests
   only `mesh.isMesh`, which `InstancedMesh` also satisfies — the sibling file says so in a comment
   (`scene/enrichedBuildings.ts:691-693`). The baked trees are `EXT_mesh_gpu_instancing`, so BEST SPOT
   flattens **one unit-size prototype tree at each InstancedMesh's own `matrixWorld`**, tagged
   `SRC_BUILDING`, and misses every real canopy. `scene/planFeed.ts:238-248` branches on
   `isInstancedMesh` and calls `sweepTreeInstances` — the correct branch exists 30 lines away in a
   sibling feed. *Magnitude UNVERIFIED — the code path is proven, the size of the phantom solid is not.*
2. **`addCanopy` and `stampSolid` are dead in the shipped path.** Nothing in `src/**` calls
   `addCanopy` (`localDsm.ts:635`); the only DSM builder is `buildDsm` (`bestSpotWorker.ts:724-755`),
   which tags every solid `SRC_BUILDING` unconditionally. So `graze.conf.tree = 0.45`, `SRC_TREE` and
   `noteOf(SRC_TREE)` are all unreachable, and `SPEC_V2 §1.2`'s "terrain, every building, bridge decks,
   trees" is not what ships. **On a tree-lined avenue the model sees open sky.** This is a C2 honesty
   gap, and it cuts *toward* optimism, so it cannot be what suppressed the owner's cell.

---

## 5. The four proposals

Ordered by measured impact per unit of work. **A is the enabler: B and C cannot rescue a cell whose
score is exactly zero, so nothing else matters until the moment is right.**

### A. THE MOMENT BECOMES A DIMENSION OF THE SEARCH *(recommended first)*

Today the disc is a statement about one instant, chosen by geometry. Make it a statement about a
**photographic window**, and report per spot *when* it is good.

- Sweep `T` instants across a window that reaches well above the horizon (e.g. body altitude −3° →
  +20°, or ±90 min around the contact). Score every cell at every instant; keep the **best instant
  and its value**, not the average. An average is what makes a 90-second alignment disappear.
- **The architecture was built for this.** The load-bearing invariant is already
  *"the per-ray upper convex hull is independent of BOTH eye height AND scene time"*
  (`BESTSPOT_PLAN` §2) — measured at **0 hull builds** for a within-day scrub. A second instant costs
  a max-angle query + a score pass (108 ms + 100 ms at 1 m/601², much less at 3 m), never a hull.
- The wire already carries `leadMs` per row (`bestSpotWorker.ts:913-926`). It becomes the headline:
  *"best at 19:44 — 47 min after moonrise"* instead of a hidden −4.1 min that is the same on six rows.
- **Would-it-fire, checked against the captured bad case:** at 16:44:43Z the moon is at alt 5.90°,
  az 125.43°, and the owner's own photograph proves it is unobstructed from his cell ⇒ `V = 1` there
  ⇒ the gate opens ⇒ the cell scores. **The fix fires on the exact case that motivated it.**
- **False-positive risk:** a cell blocked at the horizon but open at 15° would now be offered for
  "moonrise". Mitigation is copy, not maths — the row states its time and its altitude, so it reads
  as *"moon over the rooftops at 19:44"*, which is a true and useful sentence.
- Cost driver is `T`. Start at `T = 5–9` over the window and measure; the refinement debounce and the
  six residency tiers already exist to absorb it.

### B. A SUBJECT TERM — `F_peak`, the missing dual of `notchAt`

`F = max(F_graze, F_gap)` scores *riding an edge* and *threading a gap*. Add the third:
**standing the body on an isolated mass.**

- **B1 — geometric, no new data (recommended).** At the winning instant, measure the **local
  prominence** of the skyline at the body's azimuth: how far `Hg(az*)` stands above
  `min Hg` over `az* ± Δ` on *both* sides. A lone spire scores high, a ridge scores ~0, a wall
  scores ~0. That is `notchAt` with the sign inverted, walking the **same `Hg` ray array the notch
  already walks** (`bestSpotMetric.ts:758-830`) — so it is cheap, it is recompose-class if its parts
  join the term buffer, and it reuses a kernel that is already pinned by eight tests.
- **Re-open `P` at the same time.** `P` currently encodes "farther is better" as physics. It is a
  *taste*. Either split it (`P_open` for empty-horizon shots, `P_subject` where a near mass is the
  point) or expose `depthTrustRadiusM` as a first-class preset — H4 shows a 200 m trust radius is a
  materially different and defensible instrument.
- **B2 — semantic, later.** Carry a landmark layer into the evidence (`historic=memorial|monument`,
  `man_made=obelisk|tower|chimney|water_tower`, `tourism=viewpoint`, `building=church|cathedral`,
  plus `name` presence and height-above-neighbours). Two payoffs: the ~60 untagged memorial nodes in
  the central Dnipro bbox stop being invisible, and the panel can finally say **"moon on the Monument
  of Glory, 19:44"** — which is the sentence that makes the feature feel like it has taste.
  This is a bake-filter + MVT-parse + evidence-tag change; it is the largest item here.

### C. DIVERSITY BY COMPOSITION, NOT BY POSITION *(cheapest item on the list)*

The shortlist's only diversity mechanism is 25 m spatial NMS. Everything needed for real diversity is
**already computed and already on the wire** — `contact ∈ {graze, gap, open}`, `bearingDeg`,
`leadMs` — and all three are computed *inside the push loop, after selection*
(`bestSpotWorker.ts:913-935`). They are outputs that have never been inputs.

Quota the eight: at most 3 per `contact` kind, at most 3 per 30° bearing bucket, at most 3 per
10-minute `leadMs` bucket, remaining slots filled by score. Cost: a few lines in `shortlist()`, zero
solve cost.

**Honest scope:** this would *not* have found the owner's spot — a quota cannot rescue a zero. It
fixes the other thing this run exposed: eight rows spanning 5 % of score, six of them peaking in the
same minute.

### D. MAKE A FLAT FIELD READABLE

46.9 % of scored cells are clipped to `displayLo`, and 87.9 % live in the bottom two sixteenths of the
window. The map cannot show where the *relatively* better ground is.

The owner already ratified the shape of the fix for the markers on 2026-08-26e: **hue carries
field-relative quality, vividness carries the absolute reading** (`shortlistQuality` + `HEAT_SPOTS`).
Apply the same split to the sheet — hue from a field-relative rank, ink/veil from the absolute score —
and §3.5's rule ("an all-bad disc must read as all-bad") still holds, because the absolute channel is
untouched. This is consistent with a decision he has already made, not a new one.

---

## 6. Risk register

| # | risk | P×I | mitigation |
|---|---|---|---|
| R1 | A wins on latency but the window sweep multiplies the score pass by `T` | med × med | Measure `T = 5` first. The hull is time-invariant and *measured* at 0 rebuilds per scrub; only the query+score pass scales. Ship behind the existing rung ladder, coarse rungs first |
| R2 | "Best at +47 min" reads as the tool ignoring the event the user asked for | med × high | The row states its own time and the body's altitude; the disc keeps naming the event. Copy, reviewed with the owner before the maths lands |
| R3 | `F_peak` fires on chimneys and lamp posts | high × low | It is a preference term inside a normalised sum, never a gate; and `Q`'s `Relief · Depth · conf` already discounts small near clutter |
| R4 | Re-opening `P` changes every existing score, invalidating the taste the owner has built up | med × med | `depthTrustRadiusM` is already a live tunable in the recompose class — ship as a **preset**, not a default change, and A/B it |
| R5 | C's quotas trade away score for variety and the top row gets worse | low × med | Rank 1 is never quota-displaced; quotas apply from rank 2 down |
| R6 | The tree defects (§4) mean any re-tune is calibrated against a model that thinks a tree-lined avenue is open sky | **high × high** | **Fix §4.1 before any taste re-calibration.** It is a one-branch change with a correct sibling to copy |

**BLOCKER:** none. §4.1 is a sequencing constraint on B, not on A.

---

## 7. The one decision only the owner can make

**What should the disc be anchored to?**

| option | means | consequence |
|---|---|---|
| **A1 — window sweep** *(recommended)* | keep naming the event, but search ±90 min / up to ~20° altitude and report each spot's own best minute | finds his shot; "moonrise" starts sometimes meaning "45 min after moonrise" |
| A2 — follow the scrubber | the disc solves for whatever instant the clock shows | maximum control, no surprises; loses "find me the moment", and every scrub is a re-solve |
| A3 — keep the contact anchor, widen only the window's top | smallest change | fixes daylight-moonrise cases; still one instant, still one answer |

Recommendation: **A1**, because it is the only one that answers *"when and where"*, which is the
question a photographer actually has — and because his own hand-picked frame is the proof that the
answer is not at the contact.

Two smaller questions, both with a recommended default already applied above:
- Should a **near** subject be a virtue (§5.B, `P` split)? Recommended: yes, as a preset first.
- Should the shortlist trade score for variety (§5.C quotas)? Recommended: yes, from rank 2 down.

---

## Appendix — reproduction

```
wix dev
node scripts/verify-chrome.mjs           # or attach to the persistent :9222
PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH" node scripts/probe-bestspot-taste.mjs
```

Writes `verify-shots/probe-bestspot-taste.json` (all ten profiles) and
`verify-shots/probe-taste-01-disc.jpeg`. The probe is deliberately **not** named `verify-*`: it has
no PASS/FAIL contract, so `test/verifyHarness.test.ts` does not fence it.

**Known variance:** two runs of the base profile 12 minutes apart measured `floorFrac` 0.699 then
0.469 and `rMax` 84 then 85 — the field genuinely improves as tiles stream. Every number in §1 is
from the **second, fully-streamed run**, which is the same run as H7–H9, so the comparisons are
internally consistent. Do not mix the two.

**Tier:** LOCAL + BROWSER. Wix cloud UNVERIFIED (prod is dark behind the nameserver gate).

---

# ADDENDUM 2026-08-26h — THE ALIGNMENT LOCUS *IS* THE SHADOW LOCUS

**This supersedes §0's framing.** The diagnosis above was right that his cell scores exactly zero and
right about the mechanism (`V ≤ 0.15` → `G(V) = 0`). It was **incomplete about the cause**, and the
correction changes what should be built.

## What was measured

Ordered as they were taken, because the second contradicted the first and the third settled it.

1. **The planner disagreed with the disc.** `__globe.plan().binAltDeg` at his exact cell reports the
   skyline toward the moon as **0.09–0.14°** — flat — giving `V = 0.9021` and `G(V) = 1.0` under the
   **shipped** window (`scripts/probe-bestspot-r1.mjs`). The disc reports `V ≤ 0.15`. Both cannot be
   right, and **his photograph is the arbiter**: the moon is in the frame.
2. **The disc's zero is not a bad cell and not a region — it is a CORRIDOR.** Dumping `S ≡ V` over a
   21×21 patch (63 m) centred on his pick shows a narrow diagonal band of `V ≈ 0` running NW–SE
   straight through it, with `V` rising monotonically on both sides:
   ```
   2223333333444321.....      '.' = V <= 0.15      the band is ~5-8 cells
   1122222333333344432..      1..4 = rising V      (15-24 m) wide and runs
   11.111111112222333333                           NW-SE through the pick
   11........11111112221
   1111..........1111112   <- his cell sits in the middle of it
   1111111...........111
   22222211111111.......
   ```
3. **The corridor points at the monument, to a quarter of a degree.** The Monument of Glory
   (`way/1202608487`) bears **125.7°** from his cell at **87.1 m**. The moon at his own frame is at
   az **125.47°** — a **0.23°** difference, less than half the moon's own diameter. The band's width
   is what the monument's angular width sweeps over the window's 8° of azimuth.

## What it means

**He did not pick a spot the algorithm merely overlooked. He picked the one cell the algorithm most
confidently rejects — and it rejects it FOR THE EXACT REASON HE CHOSE IT.**

From that cell the moon spends the low part of its rise behind the monument. `V` measures "can you
see the body", so it collapses; `G(V)` is a **multiplier**, so the cell is zeroed *before any framing
term is allowed to speak*. The 0.30-weighted `F` — the only term that could ever say "and what it
passes behind is a monument" — never runs.

> **The set of cells from which the body passes behind a landmark is exactly the set of cells the
> metric scores zero.** The alignment locus is the shadow locus. The information the feature needs is
> not missing — the solver already knows the body is blocked, at which azimuths, by what
> (`groundSrc`), at what distance, and when it clears. It is thrown away by a gate.

That also explains the planner's disagreement in a way worth recording: at 120 bins (3°/bin) it reads
**0.09°** where a 20 m mass stands 87 m away at 125.7°. The disc is right and **the planner is missing
the monument** — a separate defect, and the reason `verify-bestspot`'s D8 cross-model block should
never be re-derived against the planner alone.

## What this changes about the plan

**It removes the need for most of it.** The scheduled work was a new mode with a per-cell argmax over
window segments and a solver-core refactor. Against this finding that is the wrong shape:

| The old reading | What was measured |
|---|---|
| His moment is outside the swept window, so search more moments | True, but secondary — **the primary defect is a gate vetoing the cell before framing is evaluated** |
| Needs a per-cell argmax over T segments | Not implied. One track, one solve, is enough |
| Needs `TERM_BYTES_PER_CELL` restructuring | Not implied at all |
| F_peak is an "additional proposal" | **F_peak IS the fix.** The dual of `notchAt` is exactly the term that reads a shadow as a subject |

**The minimal change set, in dependency order:**

1. **The `V` gate must not veto an alignment.** `G(V)` multiplies, so a shadowed cell dies before `F`
   is read. This is the single structural blocker and nothing else matters until it moves.
2. **The window's top must reach the clearing moment** — a track *parameter* (`topAltDeg` is already
   an `EventTrackOptions` field), not a mode, not a segment loop.
3. **`F_peak`** to reward the alignment once the gate lets the cell live.

**UNVERIFIED and it is the next measurement:** whether 1 + 2 + 3 actually lift his cell into the
shortlist, and what they cost every other cell. The gate exists for a reason — it is what stops a
cell that genuinely cannot see the event from ranking — so softening it needs its own falsification
pass, not an assumption.

---

# ADDENDUM 2026-08-26i — THE GATE WAS NEVER THE BINDING CONSTRAINT, AND IGNORANCE IS COSTING HIM 33 %

**This is the falsification pass § ADDENDUM 2026-08-26h asked for, and it REFUTES the change set
that addendum proposed.** Both mechanisms it named were built (inert by default) purely so they
could be measured; the measurement says they cannot do the job, and it names what can.

Instruments: `scripts/probe-bestspot-gate.mjs`, three passes, raw numbers in
`verify-shots/probe-bestspot-gate{,-decompose,-unknown}.json`. Same disc, same instant, same pick as
2026-08-26f: `p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`, **MOONRISE**, pick
`48.451827,35.070311`.

## 1. HIS CELL ALREADY HAD A CONTACT. The window was never the reason it read zero.

The decisive arm is the **STAR MAP** — `{vGateLo: 1, vGateHi: 1.05, vStarFloor: 1}` makes `G = 1`
exactly when `TERM_FLAG.hasStar` is set and `0` otherwise, so a cell renders non-zero **iff** the
body reaches half-visibility somewhere in the window. It is a direct read of the flag, not an
inference from a score.

| window top | pick reads | ⇒ |
|---|---|---|
| **4° (shipped)** | **r = 20, S ≥ 0.209** | **the cell ALREADY has a star today** |
| 10° | r = 23, S ≥ 0.218 | the raise adds ~4 % |
| 14° | r = 23, S ≥ 0.218 | and then stops adding |

So 2026-08-26h's dependency story is half wrong. `hasStar` was already true; what the window raise
buys is `V`, measured directly by `S ≡ V`: **0.15 → 0.2735** going from top 4° to 10°. Real, and far
too small to matter, because —

## 2. WITH THE GATE FORCED FULLY OPEN HE IS STILL AT THE 76th PERCENTILE

`S = 0.2176` against a field best of `0.400`, with **5,749 cells strictly better**. Every arm that
combined the two new leaves — `top ∈ {4,10,14} × vStarFloor ∈ {0.35, 0.50}` — left the pick at
**display byte 0** and the eight shortlist rows **unchanged to the fourth decimal**.

> **The gate is what makes his cell EXACTLY ZERO. It is not what keeps it out of the ranking.**
> Those are two different failures and only the first one was diagnosed. No value of `vStarFloor`
> can fix the second, because `G ≤ 1` and `G · 0.2176 < 0.378`, the shortlist's entry price.

## 3. WHERE THE 0.2176 GOES — and the finding no prior doc contains

`S = A_hard · A_soft^0.5 · M · G · preference`. With `G = 1` forced, peeling the factors off one at
a time:

| arm | pick | what it isolates |
|---|---|---|
| star-map | 0.2176 | — |
| + `majorRoad/road: 1` | **0.2176 (unmoved)** | he is NOT on a road. Field best moved 0.400 → 0.441, so the patch fired |
| + whole soft ladder off | 0.3235 | ⇒ his `A_soft^0.5` = **0.673** |
| + `worth.effectiveFloor: 1` | 0.6324 | ⇒ `M_eff` = **0.512** (the daylight haircut, field-wide) |

`accessSoftGain` is `soft^0.5`, so `soft = 0.673² = 0.453`. Exactly one rung sits there:

> ### `access.soft.unknown = 0.45`. **His cell is charged a third of its score because the landcover
> raster does not know what it is.**

Confirmed by the sharpest available test rather than left as arithmetic: `{unknown: 1}` **alone**
reproduces the whole-ladder-off value **exactly** — 0.2176 → 0.3235 — while every other class stays
penalised, and it moves him from the 76th to the 87.5th percentile.

**This contradicts a rule the codebase enforces everywhere else.** `notchDepthDeg = −Infinity`
because *"ignorance is not depth"*; UNKNOWN is *"a RENDER CLASS, never a low score"*; the
2026-08-26g canopy withdrawal made canopy-only occlusion UNMAPPED rather than a low score. The soft
ladder is the one place ignorance is priced as badness, and it is doing so on the cell the owner
hand-picked. **It is an owner call, not ours** — it re-scores every unclassified cell in every
region — but it is now a measured number rather than a suspicion.

## 4. HIS FOUR TERMS, MEASURED — and `L` is the surprise

Each read directly with the whole preference weight on one term (ladder off, worth 1, gate open):

| term | pick | percentile | note |
|---|---|---|---|
| `V` | 0.2735 | 0.42 | at top = 10 |
| **`L`** | **≥ 0.90** | **1.0000 — ZERO cells better** | **his cell is the best in the entire field on contact lowness** |
| `P` | 0.6765 | 0.86 | |
| `F` | 0.4059 | 0.85 | his weakest term, and the one F_peak exists to move |

The blend closes against the measurement: `0.15·0.2735 + 0.30·0.90 + 0.25·0.6765 + 0.30·0.4059
= 0.602` versus 0.6324 measured (the gap is byte quantisation — every term is read at ≥ its
dequantised floor). **The model is not lying about him. It ranks him 83rd-percentile on preference
and then multiplies that by 0.673 for not knowing what he is standing on.**

## 5. THE CEILING, and it is the number that decides the design

Even at a **perfect** preference of 1.0 with the gate fully open:

```
S_max = A_soft^0.5 · M_eff = 0.673 × 0.512 = 0.345   <   0.378  (shortlist entry price)
```

**So no gate change, no window change and no framing term can put his cell in the top 8 while
`unknown` charges it 0.45.** That is a hard, arithmetic ceiling from two measured factors, and it
is why this pass reorders the work.

With `unknown: 1` the ceiling becomes `0.512 × preference`; he measures 0.6324 → **0.324**, and
rank 4 in that same arm is **0.4223**. Closing that needs preference ≈ 0.825. `F_peak` taking `F`
from 0.406 to ~1.0 adds `0.30 × 0.594 = 0.178` → **0.810**. Within 2 % of rank 4 — which is the
first arithmetic in this whole investigation that reaches his photograph.

## 6. WHAT SHIPPED THIS SESSION, AND WHY IT IS INERT

Both mechanisms, tested and **byte-identical on the shipped profile**, because they had to exist
before they could be measured and the measurement says do not turn them on yet:

- **`gates.vStarFloor`** (default **0**) — `G = max(G(V), vStarFloor)` when `TERM_FLAG.hasStar`.
  Inert twice over: `hasStar` defaults `false` at the kernel, and the leaf ships at 0. `recompose`,
  proven on the FUSED path — and proven to move **starred cells only**, zero starless cells, which
  is the honesty claim the floor rests on.
- **`trackWeight.topAltDeg`** (default **4**) — the window's top, in the profile rather than on the
  job (a deliberate deviation from `SWEEP_MODE_MAP.md` C2, now that slice 0's `trackHash` covers the
  whole `trackWeight` group and rebuilds the track). Class `resweep`. Bounded by
  `TRACK_WINDOW_MAX_SPAN_DEG = 48`, truncated from the NEW end so the contact always survives, and
  the window stays a **superset** of the shipped one on the absolute lattice — pinned for the first
  time, since the whole hull-cache cost model rests on it.

Cost of a raise, measured at Dnipro moonrise: top 4° → K = 41 · 8° → 63 · **10° → 76** · 12° → 90 ·
20° → 162 · 25° → 268 (the march clamps at culmination; 30° buys nothing).

**Two traps paid, both worth carrying forward.** The budget was first written as a SAMPLE count and
silently truncated the shipped window at any refined lattice (`bestSpotGolden`'s 0.05° τ-invariance
check went red); it is a SPAN. And sized for Dnipro's 16° it deleted every high-latitude sunrise —
the shipped worldwide maximum is **45.5° at Tromsø, K = 176** — because the culmination runaway and
the wide polar sweep are *the same physics*. Both are now pinned.

## 7. THE ORDER THE NEXT SESSION SHOULD WORK IN

1. **Put `access.soft.unknown` in front of the owner.** It is the hard ceiling, it is one number,
   and it is a product decision about every unclassified cell in every region. Nothing else can
   succeed while it stands.
2. **`F_peak`** — `SWEEP_MODE_MAP.md` slice 2 is unaffected and its twenty golden rows still apply.
   It is now a PRECONDITION with a measured target: `F: 0.406 → ~1.0`, worth +0.178 of preference.
3. **Then, and only then, tune `vStarFloor` and `topAltDeg` together.** They are built, gated and
   inert; turning them on before 1 and 2 moves nothing but the field's zero-set.
4. **`L = 1.0000` at his cell, best in the field, is worth its own look.** Either the metric already
   agrees with him more than anyone assumed, or `L` saturates too easily.

**Tier:** LOCAL (vitest + `astro check` + `knip`) + BROWSER (three probe passes, `wix dev` +
CDP Chrome). Wix cloud UNVERIFIED (prod is dark behind the nameserver gate).
