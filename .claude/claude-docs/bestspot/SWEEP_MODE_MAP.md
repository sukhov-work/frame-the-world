# BEST SPOT — SWEEP MODE, F_peak AND THE TREE DEFECTS: THE IMPLEMENTATION MAP

> # ⚠ MOSTLY SUPERSEDED — read `README.md` and `BESTSPOT_TASTE_V1.md` § ADDENDUM 2026-08-26i FIRST
>
> **The premise of this map is measured FALSE.** It was written 2026-08-26g when the accepted
> diagnosis was *"his moment is outside the swept window, so search more moments"*. Two later
> measurements gutted it:
>
> - **ADDENDUM 2026-08-26h** cut the mode, the segment loop and the `TERM_BYTES_PER_CELL` refactor,
>   promoting F_peak to be *the* fix.
> - **ADDENDUM 2026-08-26i** then measured that his cell **already had a contact at the shipped 4°
>   top**, that the gate is **not** the binding constraint (open it fully and he is still
>   76th-percentile), and that `access.soft.unknown = 0.45` is a hard ceiling below the shortlist's
>   entry price.
>
> **WHAT SURVIVES, verbatim and still correct:**
> - **§4 SLICE 2 — F_peak, in full.** Files, kernel, the nine leaves, the `CLASS_OF` rows, the
>   `clampResolved` loop, the Lean twin, the twenty golden rows committed RED first, and the PIN-2
>   line that must break. **This is the doc's whole remaining value** — and F_peak is now a
>   PRECONDITION with a measured target (`F: 0.406 → ~1.0` buys +0.178 of preference).
> - **The five kernel traps inside slice 2**, especially `Number.isFinite(width)`: the notch's
>   `Infinity` collapses to 0, the peak's **inverts** (`slender = prom/∞ = 0` → `1 − smoothstep(5,8,0)
>   = 1`), i.e. a ridge scoring FULL credit. The naive dual is silently wrong exactly there.
> - **§1 C1** — store `peakApexDeg` + `peakDistM` RAW, apply relief/conf/depth in COMPOSE.
> - **§1 C4 / §3 N6** — the peak pass lives inside the `starIdx >= 0` guard but runs its **own**
>   argmax over `notchRays[0..K-1]`, never index `starIdx`.
> - **§3 N3 / N4** — a third arm of `max()`, not a fifth weight; `peak.conf.*` needs its own
>   `clampResolved` loop, `clampLeaf` cases and a Lean `peakBound` twin (`clampLeaf` is fail-OPEN).
> - **§1 C11 / §3 N15 / §7 item 6** — `peak.conf.tree = 0`, ceiling 0.2, **no distance gate**.
> - **§2 assumptions 3, 5 and 9**, and **§6's control-validated finding that NO golden statistic in
>   the repo is a function of tree geometry.**
> - **§7 items 8 and 11** — no third marker channel for time; `peak.spanDeg` ships FROZEN.
> - **Slices 0 and 1 as SHIPPED FACT** (they landed 2026-08-26g).
>
> **WHAT IS DEAD:** the whole premise and §7's ranking (which puts 3a/3b *above* F_peak) · the
> DEVIATION note · **slice 3a in its entirety** · slice 3b's mode/toggle/store flag · slice 4's quota
> · §5.A's sweep sizing (±90 min / +20°: measured 232 window samples, K = 244, ~615 MiB) · R3's
> "`Relief · Depth · conf` already discounts clutter" (refuted — a 40 m chimney at 500 m scores
> `Q = 0.550`, **above** the 20 m monument's 0.315; the discriminator is SLENDERNESS) · §4's
> "report only, not fixed" framing for the two tree defects (both shipped 2026-08-26g) · §1.1's field
> table (re-baselined: unknown 8,984 → 11,009, `unmappedFrac` 0.000 → 0.064) · §7 as an OPEN owner
> question (answered in `DECISIONS.md` 2026-08-26g) · the `bestSpotWorker.ts:834` /
> `bestSpotTrack.ts:319,323,626-627` line citations (drifted).
>
> **A note on `topAltDeg`:** the window's top DID ship, as a profile leaf (`trackWeight.topAltDeg`,
> default 4, inert) rather than as this map's `EventTrackOptions` field — a deliberate deviation from
> **C2**, valid only because slice 0's `trackHash` now covers the whole `trackWeight` group.


**Produced 2026-08-26g** by a six-track parallel read + a consolidator, against the diagnosis in
`BESTSPOT_TASTE_V1.md` and the owner's ruling that SWEEP is an ADDITIVE MODE (default OFF, the
current static behaviour unchanged) with trees as OCCLUSION and never as subject.

**STATUS — what has actually shipped against this map:**
- **SLICE 0 (the track sub-hash) — DONE, 2026-08-26g.** `trackHash` + `trackKeyOf`, `trackWeight.*`
  reclassified `reweigh` → `rescore`. Both halves mutation-verified.
- **SLICE 1 (D1 + D2 + the canopy withdrawal) — DONE, 2026-08-26g.** Includes the honesty
  withdrawal the owner chose (canopy-only occlusion ⇒ UNMAPPED, never a low score), which this map
  had recommended DEFERRING (§7 item 9) — the owner ruled otherwise, so it landed with slice 1 to
  keep the field re-baseline to ONE event instead of two.
- **SLICES 2, 3a, 3b, 4 — NOT STARTED.** See the deviation note below before following §4 verbatim.

**DEVIATION FROM §4, decided 2026-08-26g:** slice 3a's per-segment term buffer (T × 96 B/cell,
~163 MB at 601²) is REPLACED by *T sequential solves against the resident DSM, keeping a per-cell
running MAX and merging the winning instant's terms into ONE buffer*. Same user-visible behaviour,
same memory as today, no `TERM_BYTES_PER_CELL` refactor, and OFF is byte-identical by construction
(T = 1 is literally today's call). The hull cache still amortises across instants through the
absolute azimuth lattice's superset property (§1 C5), which is the only reason either shape is
affordable. The consequence is that in SWEEP mode a scoring patch is a `rescore`, never a
`recompose` — the losing instants' evidence is gone, so `composeScores` cannot re-run the argmax.
That is §4 slice 3a's own `BESTSPOT_HONESTY` rule, reached by a different road.

---

null
Repo root: `/Users/yevhens/Projects/wix-private/headless-frame-the-world`. All `file:line` below are repo-relative from there.

# 1. CONTRADICTIONS — ruled

**C1 — F_peak's term-buffer cost: 88 B (T3) vs 96 B (T4).**
T3 map 5: `+3 f32 + 1 u8 = 13 B`, fields `peakRiseDeg, peakWidthDeg, peakQBase, peakSrc`. T4 map 8: `+5 f32 + 1 u8 = 21 B`, fields `peakPromDeg, peakWidthDeg, peakApexDeg, peakDistM, peakLiftRadii, peakSrc`.
**Ruling: T4's 96 B. T3's `peakQBase` is refuted by T3's own §8.** I read the layout contract at `src/lib/geo/bestSpotSolver.ts:288-291`: *"STORE WHAT THE TASTE KNOB IS A FUNCTION OF, NEVER THE ANSWER."* `peakQBase = relief · depth` bakes `graze.reliefLoDeg/reliefHiDeg` and `peak.depthTrustRadiusM` into the buffer, so those leaves cannot be `recompose` — the exact half-honoured-recompose defect T3 itself documents for `graze.conf.*` in the notch shoulders (`bestSpotSolver.ts:1362` → `bestSpotMetric.ts:1284`). Store `peakApexDeg` + `peakDistM` raw; apply relief, conf and depth in COMPOSE. `TERM_BYTES_PER_CELL: 75 → 96`, and `test/lib/geo/bestSpotSolver.test.ts:1271`'s `< 101 MiB` pin still passes at 601² (34.7 MB).
Residual: ρ at the peak's winning sample. Only `rhoStar` is stored (`bestSpotSolver.ts:1357`, `samples[starIdx].rhoDeg`). If the peak's argmax sample ≠ `starIdx` the stored ρ is the wrong one. ρ moves <2% over a window, so reuse it and say so in the docstring. [ASSUMPTION — unmeasured.]

**C2 — where the window's parameters live: scoring profile (T3 map 11 `sweep.*` group) vs `EventTrackOptions` + job (T2 map 1/10).**
**Ruling: T2 wins, and the file says so itself.** `src/lib/geo/bestSpotTrack.ts:476-482`:

> *"The taste profile. Reaches exactly three things in this module: `trackWeight.altScaleDeg`, `trackWeight.horizonCeiling` and the whole `worth.*` group. **Everything else here is GEOMETRY (the lattice, the marches, the inversion grid) and stays an `EventTrackOptions` field, because changing it is a rebuild whatever the profile says.**"*

`topAltDeg` is already an `EventTrackOptions` field (`:441-442`). Segments and the lattice budget are its siblings. They ride the job, not `BESTSPOT_SCORING_V1`. This also dodges T1's F4 tax (the every-leaf-is-live walk) and T1's rec-13 hash-churn argument, both of which are correct.

**C3 — T3's §7 `trackWeight.*` defect: claimed by T3 alone, unverified by execution.**
**Ruling: CONFIRMED by reading, four links, all mine:**
- `src/lib/geo/bestSpotScoring.ts:512-513` — `"trackWeight.altScaleDeg": "reweigh"`, `"trackWeight.horizonCeiling": "reweigh"`.
- `src/components/globe/scene/bestSpotFeed.ts:770` — `if (cls === "repaint" || cls === "recompose" || cls === "reweigh")` → `client.apply(...)`.
- `src/lib/geo/bestSpotWorker.ts:1687` — `runApply` accepts anything `≤ reweigh`, then calls `composeRung` (`:1035-1081`), which **never rebuilds the track**.
- `src/lib/geo/bestSpotWorker.ts:1321` — `const trackKey = \`${job.kind}|${dayKeyOf(job.sceneMs, job.centreLonDeg)}\`` — **no profile term**. So even a full re-`solve` reuses `res.track`.
- Control grep: the only consumers of `trackWeightShape` / `horizonCeiling` / `altScaleDeg` outside the scoring module are inside `src/lib/geo/bestSpotTrack.ts` (`:952-957`, `:630`). Nothing recomputes `w` downstream.

Both `trackWeight.*` leaves are silently dropped until the next day or kind change. This is a **shipped bug**, it is not caused by this feature, and it is the exact failure mode any track-shaping profile leaf inherits. It goes in slice 0.

**C4 — where F_peak anchors.** T3 map 7 puts `peakAt` "on the same `notchRays` scratch" inside the notch block; T4 Trap 1 says anchoring at `starIdx` makes F_peak identically zero on the geometry it exists for.
**Ruling: both half-right, and the code decides the shape.** `src/lib/geo/bestSpotSolver.ts:1342-1365`: the ribbon refill **and** `notchAt(notchRays, starIdx, ...)` both live inside `if (starIdx >= 0)`. So the peak pass must live in that guard (it needs the refilled scratch, and refilling twice costs a second `c*K*3` walk), but it must run **its own argmax over `notchRays[0..K-1]`**, never read index `starIdx`. T4's kernel, T3's placement.

**C5 — "a second instant costs a max-angle query, never a hull"** (`BESTSPOT_TASTE_V1.md:227-228`, relied on implicitly by T3 and T4) vs T2's refutation.
**Ruling: T2. The doc sentence is false.** The hull cache key is `cached.azDeg === az && cached.ground === dsm.ground` (`src/lib/geo/bestSpotSolver.ts:1187-1196`) — an exact azimuth match. `az(t)` is invertible over the window, so two instants are two azimuths, always. What saves the design is T2's *superset* property of the absolute lattice (`bestSpotTrack.ts:797-829`, turned on unconditionally at `bestSpotWorker.ts:1339`), not time-invariance. **Consequence nobody else stated: a fixed altitude top is unbounded in K** — T2 measured the owner's own moonrise culminating at 19.70°, so `top = 20` yields 232 window samples, K = 244, ~615 MiB of hulls. The cap must be a **lattice-sample budget**, truncated from the new end only.

**C6 — per-segment term buffer: T2 requires it (map 4/5), T3 Trap 5 says it blows the ULTRA pin.**
**Ruling: both correct; the missing decision is that SWEEP and ULTRA are mutually exclusive.** At 96 B/cell × T=5 + shared, 601² lands at ~163 MB against `test/lib/geo/bestSpotSolver.test.ts:1271`'s 105,906,176 B ceiling. Neither track made this a decision node. Gate it in the store the same way ULTRA is already gated by `st.radiusM <= BESTSPOT.ultraMaxRadiusM` (`src/components/globe/scene/bestSpotFeed.ts:543`).

**C7 — the per-row time wire field: T6 `bestAtMs` REQUIRED (breaks the key pin, "worth taking"), T2 `bestMs`, T4 silent.**
**Ruling: `bestAtMs`, OPTIONAL — absent in OFF mode.** I read the pin at `test/lib/geo/bestSpotHonesty.test.ts:617-634`: `Object.keys(r).sort()` against a literal 14-name list. Making the field required destroys the single best OFF-mode identity assertion available in node. Making it optional-and-absent converts that test into the proof (deliverable 5). T6's own reasoning for `bestAltDeg?` applies verbatim to both.

**C8 — the panel's vertical budget: 619 px above row #1 (T1 F7) vs 504 px (T6).**
**Ruling: OPEN, and neither number may justify a layout.** Both are computed from `src/styles/bestspot-panel.css` with an estimated mono line-height; the delta is almost entirely T1 costing 8 `.pp-status` lines at ~25.5 px vs T6 at 13.5 px. The **direction** is agreed and is what matters: row #1 is already below the fold at the default width. The one action both support is T1 rec. 6 — the toggle joins the existing `.pp-chips` row at `src/components/panels/BestSpotPanel.tsx:611` at 0 px. T6's five-status-line collapse (−98 px) is a separate taste pass and is out of this feature's scope.

**C9 — the word "sweep".** T1 F3 says it collides; T2/T3/T4/T5/T6 all use it.
**Ruling: split the word.** `resweep` is a shipped `InvalidationClass` at `src/lib/geo/bestSpotScoring.ts:76,85` meaning *re-run the azimuth sweep, 343 ms*, and `bestSpotTrack.ts` uses "sweep" for azimuth in 6 places. Keep **SWEEP as the user-facing label** (the owner's word). Inside `src/lib/geo/**` the identifiers are `windowTopAltDeg`, `windowSegments`, `windowMaxSamples`. The store flag is `sweepMode` (UI band, no collision). This is a correctness decision, not taste: `sweepMaxWindowSamples` next to `resweep` will be misread.

**C10 — D1's true shape.** T5 F2 alone: the `geom.boundingSphere` reject already deletes the whole tree set at the owner's disc, so a bare `isInstancedMesh` branch is a no-op there.
**Ruling: T5.** `src/components/globe/scene/bestSpotFeed.ts:293-297` culls on `geom.boundingSphere` transformed by `mesh.matrixWorld`; for an `InstancedMesh` that geometry is the **shared unit prototype**, so the sphere is a ~0.5 m ball at the cell root. `src/components/globe/scene/enrichedBuildings.ts:691-693` documents the hazard in words — *"Trees FIRST — InstancedMesh passes `isMesh` too"* — 30 lines from the code that forgot it. The cull **must become per-instance**, and `src/components/globe/scene/planFeed.ts:233-237` has the identical reject bug ahead of its correct `isInstancedMesh` branch.

**C11 — tree framing policy.** T4: `peak.conf.tree = 0`, ceiling `0.2`, no distance gate (refuted with numbers). T5: additionally split `tauTree` into near/far at `graze.treeNearM = 250` (+4 B/cell, plus a matching change at `bestSpotMetric.ts:1284`).
**Ruling: T4. T5's near/far split is cut from the first pass.** It costs a buffer field, a GAP-shoulder change and a golden-row move to express *"if not viewed from afar"*, which `Depth(D)` already expresses per edge, and T4's own measurements show a distance gate tuned to kill mid-range trees also kills the 1.5 km spire.

---

# 2. SILENT ASSUMPTIONS — where it breaks

1. **T3 and T4 design tree-flavoured leaves that are unreachable.** `peak.conf.tree`, `noteOf(SRC_TREE)`, `contactOf`'s tree path — all dead until D2 lands. Confirmed: grep for `addCanopy|includeCanopy` across `src/ test/ scripts/` returns hits only inside `src/lib/geo/localDsm.ts` and `test/lib/geo/localDsm.test.ts`; `buildDsm` (`src/lib/geo/bestSpotWorker.ts:741-753`) writes `solidSrc[c] = SRC_BUILDING` unconditionally. T4 flags it in Gaps; T3 does not. **Ordering consequence: trees before peak.**
2. **`cellScore` has to grow two things at once, and nobody designed the interaction.** T3/T4 both require `cellScore` to grow an `F_peak` arm (it is the reference the fused pass is diffed against, `bestSpotSolver.ts:56-62`, pinned at `test/lib/geo/bestSpotSolver.test.ts:643-665`). T2 leaves open whether `cellScore` grows a segment argument. It cannot dodge both. Decide in slice 3a: **`cellScore` stays segment-free and the diff pin runs at T=1 only**; the argmax is proven separately.
3. **T4's F2 undermines today's `L` and `P`, not just sweep mode's.** If `az*`/`alt*` really land on the far horizon whenever the subject is narrower than the swept span, then `L` and `P` already describe a different object than `F` does — in shipped code, sweep or no sweep. T2's whole "redefine `L` above 5°" argument assumes `alt*` is the contact. This is the deepest unreconciled item and it is [DERIVED], never measured against the shipped TS.
4. **T1's single-boolean mode is insufficient.** T1 rec. 8 appends `|W` to the T0.5 key. T2 needs four job fields. With only `|W`, a change to the top altitude or segment count reuses the old track — the C3 defect verbatim. **The T0.5 key must carry the numbers**, not a flag.
5. **`contactOf`'s union widens to four and T6's quota was sized for three.** T6's `kindCap: 3` was chosen because 3×3 = 9 ≥ 8; with `peak` it becomes 3×4 = 12 and the kind axis stops binding. T6 Trap 9 and T4 map 12 each saw half.
6. **T5's honesty withdrawal (canopy-only rays don't increment `accWKnown`) moves `C`, hence `minCoverage`, hence the shortlist candidate set** (`src/lib/geo/bestSpotWorker.ts:834`, `if (terms.c[i] < minCoverage) continue`). Every browser census number moves. No other track budgeted for it. It is a separate, later slice.
7. **T6's quota runs the O(window) `leadMs` inversion per *examined* candidate**, not per row (`bestSpotWorker.ts:913-926`). T6 caught it and memoises; if T2's per-segment `starIdx` does not land first, that memo is the only thing between the quota and a hot loop.
8. **Persistence of the toggle is assumed by T1 and ignored by everyone else.** `heatmapOn` deliberately does not persist and is force-cleared in both directions (`src/store/bestSpot.ts:446`, confirmed); `bestSpotTuning` does persist. T1 Trap 2 is right that persist-and-reset-on-open are mutually exclusive. Owner call.
9. **T1 F8 is real and will bite silently.** `test/store/bestSpot.test.ts:36-62`'s `DEFAULTS()` omits `heatmapOn` and `:69` does a **partial** `setState(DEFAULTS())`. Confirmed by reading both. A new flag with no `setOpen` forcing leaks across every test in that file.

---

# 3. THE DECISION MAP

**DECIDED**
- **N1 Window params live in `EventTrackOptions` + the job, not the profile.** — `bestSpotTrack.ts:476-482`. *requires* N2. *conflicts* T3 map 11.
- **N2 The T0.5 key gains a track sub-hash covering `trackWeight.*` + the window numbers.** — `bestSpotWorker.ts:1321`, `bestSpotFeed.ts:753`. *enables* N1, N7. *fixes* C3.
- **N3 F_peak is a third arm of `max()`, not a fifth weight.** — `formal/Ftw/Score.lean:52` is literally 4-ary; `bestSpotSolver.ts:1697` is `const f = fGraze > fGap ? fGraze : fGap`. `max` of three members of [0,1] discharges `htf0/htf1` with a one-line lemma. *requires* N4.
- **N4 `peak.conf.*` needs its own `clampResolved` loop + `clampLeaf` cases + a Lean `peakBound` twin.** — `bestSpotScoring.ts:644-651` clamps `graze.conf` and nothing else; `clampLeaf`'s `default: return value` is fail-OPEN. Without it `confBound_is_necessary` reappears from a persisted blob with no test red.
- **N5 F_peak stores raw geometry, no baked `Q`.** — C1.
- **N6 The peak argmax is its own, over `notchRays`, inside the `starIdx >= 0` guard.** — C4.
- **N7 The window cap is a lattice-sample budget, truncated from the new end.** — C5.
- **N8 SWEEP × ULTRA is refused.** — C6.
- **N9 `bestAtMs` is optional and absent when OFF.** — C7.
- **N10 The toggle is a `<button aria-pressed>` in the existing `.pp-chips` row.** — `BestSpotPanel.tsx:619-634` is the template; `bestspot-panel.css:158` sets `.bsp span.pp-chip { cursor: default }` precisely so a readout is not a button.
- **N11 D1's cull is per-instance.** — C10.
- **N12 Canopies go to their own DSM layer via `addCanopy`, never `stampSolid`.** — `localDsm.ts:602-612` + `landcoverRaster.accessAt`: a canopy in `solidMask` turns every tree-lined avenue INACCESSIBLE the moment lift ≥ `access.aerialMinM` (5 m).
- **N13 Shortlist quotas ride the job, not the profile.** — T3 and T6 independently; `topK`/`topKMinSepM` already do (`bestSpotWorker.ts:219-220`).
- **N14 Identifiers say `window*` in `lib/geo/**`; the label says SWEEP.** — C9.
- **N15 T5's `tauTree` near/far split is cut.** — C11.

**OPEN (owner)**
- **O1 Does the SWEEP toggle persist?** *conflicts* N10's `setOpen` reset. See deliverable 8.
- **O2 `peak.conf.terrain`** — T4 proposes 1.0 mirroring graze; Dnipro terrain posts at ~145 m effective and cannot resolve an isolated summit's width, so 0.6 may be righter. Unmeasured.
- **O3 The honesty withdrawal for canopy-dominated discs** (T5). Without it a Dnipro park becomes a black disc with eight missing markers; with it, it becomes UNKNOWN. Both are big product moves. See deliverable 8.
- **O4 `alt*` on an isolated subject** (assumption 3). Not an owner question — a measurement, and it must be taken before slice 2 is tuned.

---

# 4. THE RESOLUTION ORDER — the deliverable

Every slice: `npm test` + `npx astro check` + `npx knip` green before the next starts. Slices 0–2 do not touch sweep mode at all; slices 3–5 are additive behind the flag.

---

### SLICE 0 — the track sub-hash (a defect fix, no feature)
**Files.** `src/lib/geo/bestSpotWorker.ts:1321` · `src/components/globe/scene/bestSpotFeed.ts:753`.
**Change.** Introduce `trackHashOf(scoring)` covering exactly `trackWeight.altScaleDeg` + `trackWeight.horizonCeiling`, and fold it into both keys:
```ts
const trackKey = `${job.kind}|${dayKeyOf(job.sceneMs, job.centreLonDeg)}|${trackHashOf(job.scoring)}`;
```
Also: `runApply` must **refuse** a `reweigh` whose track sub-hash differs from the resident track's, and post a re-solve request instead — otherwise the class table stays a lie in the other direction.
**Proves it.** A new case in `test/lib/geo/bestSpotResidency.test.ts` beside the four-tier `hullBuilds` contract (`:239-332`): perturb `trackWeight.altScaleDeg`, assert `res.track` is a *different object* and that at least one `w` moved. Negative control: perturb `weights.v` and assert the track is the **same** object.
**Green gate.** Whole suite. `test/lib/geo/bestSpotScoring.test.ts:1191-1250` (the `eventTrack` × profile cross-checks) may move — that file is the one that documents what these leaves are supposed to do.
**Why first.** Every subsequent slice puts something track-shaped behind this key. Landing it later means shipping a mode that silently does nothing.

---

### SLICE 1 — D1 + D2, the trees (this re-baselines the DEFAULT field)
**Files.** `src/lib/geo/occlusion.ts:150-152` (export `CANOPY_CENTER_Y`, `CANOPY_HALF_Y`, `UNIT_CANOPY_R`) · `src/components/globe/scene/bestSpotFeed.ts:280-307, 522-544, 568` · `src/lib/geo/bestSpotWorker.ts:136-143, 724-756, 1120, ~1769` · `src/components/globe/scene/planFeed.ts:233-241`.
**Change.** T5's map, verbatim, with two amendments:
- The `isInstancedMesh` branch goes **before** the `geom.boundingSphere` reject, and the cull is per-instance:
```ts
const inst = mesh as THREE.InstancedMesh;
if (inst.isInstancedMesh) { if (canopies) collectCanopyInstances(inst, centreEcef, radiusM, canopies); return; }
```
- `instanceMatrix.array` is **`.slice()`d**, never transferred live: `src/components/globe/scene/enrichedBuildings.ts` writes `m13` into it every frame during the tree re-seat, and three renders from it.
- `buildDsm` grows a fifth param `canopies = []`, folds them with `addCanopy` between the built fold and the seal, and the seal becomes explicit `sealDsm(dsm, { includeCanopy: true })`. **A canopy pass placed after the seal throws loudly; one placed before a `{includeCanopy:false}` seal fails silently.**
- `planFeed.ts` gets the same per-instance cull, or the two feeds disagree about which trees exist.
**Preserve.** `MESH_BUDGET = 512` still guards `out`; canopies get their own budget. `heightProvenance.enriched` (`bestSpotFeed.ts:531-533`) stops counting tree sets — this **quietly corrects a user-visible number**; say so in the commit or the next audit reads it as a regression.
**Proves it.** Five new tests, none of which exist:
1. An `InstancedMesh` in `enrichedGroup` yields **zero** `TinMeshWire` and **N** canopy instances; a plain `Mesh` yields one wire and zero canopies (the positive control).
2. **The per-instance cull:** an `InstancedMesh` whose `matrixWorld` is 1,833 m from the disc centre but whose instances reach it still yields canopies. *A naive `isInstancedMesh` fix fails this test — it is the whole point.*
3. `buildDsm` with a canopy wire ⇒ `surfaceSrc === SRC_TREE`, `solidMask === 0`, and `insideSolidInterior(dsm, c, 1.7) === false` **and** `insideSolidInterior(dsm, c, 6) === false`. The 6 m arm is the trap.
4. Round-trip parity: one instance through the new converter and the same instance through `sweepTreeInstances` put the canopy top at the same elevation to 1e-6 — `localDsm.ts:631-633` currently claims "agree by construction" with nothing enforcing it.
5. `heightProvenance.enriched` does not count tree sets.
**Green gate.** Whole suite, plus a **browser re-baseline**: `scripts/verify-bestspot.mjs` at Dnipro. Its assertions are mostly relational (texel classes === census counts, `:479-488`) so they survive, but `:1096-1111` (rural `S > 0.6` fraction) and the timing gates must be re-read, and the disc's absolute D1 top-8 note line (`:449-453`) will move.
**Why here.** Everything tree-flavoured downstream (N4's `peak.conf.tree`, `noteOf(SRC_TREE)`, `contactOf`) is dead code until this lands, and re-baselining the field twice is worse than once.

---

### SLICE 2 — F_peak, shipped OFF
**Files.** `src/lib/geo/bestSpotMetric.ts` (new `peakAt` + `peakFFromParts` + `peakOf` argmax, after `notchFFromParts` at `:878`; `cellScore`'s `const f = Math.max(fGraze, fGap)` at `:1162` becomes a three-way max; publish `fPeak` on `CellScore`) · `src/lib/geo/bestSpotScoring.ts` (the `peak` group after `gap` at `:181`; ten `CLASS_OF` rows; `clampResolved` `peak.conf` loop after `:651`; `clampLeaf` cases; `BESTSPOT_SAFETY.peakConfTreeMax`) · `src/lib/geo/bestSpotSolver.ts:247, 336-356, 1342-1365, 1367-1380, 1688-1697` · `formal/Ftw/Score.lean`.
**Change.** T4's kernel with T3's discipline:
- The dual inverts every comparison **and every sentinel**: `apex = max Hg` over `|Δaz| ≤ ρ`; `sag = min Hg` over `[±ρ, ±span]`; `prom = apex − max(sagL, sagR)` (*max*, because a mass with sky on only one side is the corner of a wall); `width` = the component of `{Hg > col}` around `apexIdx`, using the linear crossing interpolation at `bestSpotMetric.ts:805-811` verbatim.
- **`Number.isFinite(width)` is an explicit guard.** The notch's `Infinity` collapses to 0 through `clamp01((maxWidth − ∞)/…)`; the peak's does the opposite — `slender = prom/∞ = 0` → `1 − smoothstep(5, 8, 0) = 1`, i.e. a ridge scoring full credit. This is the one place the naive dual silently inverts.
- **`Math.max(a,b,c)` and NaN:** `apex − col` is NaN when both are `−Infinity`. `notchAt`'s guard is `if (star.known !== 1) return empty` (`:756`); the peak needs the identical early return.
- **Discriminator is SLENDERNESS (`prom/width`), not `Q`.** T4 measured it: a 40 m chimney at 500 m scores `Q = 0.550`, **higher** than the 20 m monument at 150 m (`Q = 0.315`). `BESTSPOT_TASTE_V1.md:296`'s claim that `Relief · Depth · conf` already discounts clutter is refuted.
- **Buffer: 96 B/cell** (C1). Sentinels on the UNKNOWN branch mirror `bestSpotSolver.ts:1308-1313`: `peakPromDeg = −Infinity`, `peakWidthDeg = Infinity`, rest 0.
- `peak.enabled: false` shipped; **filed `rescore` in `CLASS_OF`**, never `recompose` — the buffer's peak fields only exist if the solve ran the argmax, so a `recompose` on the first toggle paints garbage.
- `peak.conf.tree = 0`, `BESTSPOT_SAFETY.peakConfTreeMax = 0.2`. The ceiling must be **> 0** or `perturbationsFor` (`test/lib/geo/bestSpotScoring.test.ts:538-548`) has no honoured candidate and `expect(unreachable).toEqual([])` at `:669` goes red.
- `contactOf` (`bestSpotWorker.ts:764-769`) gains `"peak"` **before** the `starOpenSky` branch. Four `Record`s over that union move; the fourth (`scripts/verify-bestspot.mjs:947`) is JavaScript and TypeScript will not catch it.
- Lean: add `max3_mem_Icc` + a `peakBound` twin of `confBound` (`Score.lean:208-218`). `preference` keeps its 4-ary signature.
**Proves it.** T4's twenty golden rows as a new `test/lib/geo/bestSpotPeak.test.ts`, **committed RED first** (the house rule at `bestSpotGolden.test.ts:13`). The load-bearing ones: **P12** (the chimney with `Q` above the monument's, killed by slenderness alone — R3's refutation), **P17** (the distant chimney, a *deliberately asserted* false positive; anyone who "fixes" it by lowering `slenderMax` takes the spire with it), **P18** (inertness), **P19** (the shipped 4° window is *not* a gate — F_peak fires at 0.4015 inside it, so `peak.enabled` is mandatory).
Extend `test/lib/geo/bestSpotScoring.test.ts:650-675` with a `spireSkyline` probe evaluated under `{...resolved, peak: {...resolved.peak, enabled: true}}`, or nine new leaves land in `EXPECT_INERT_ON_FIXTURE`.
**Green gate.** All 17 rows of `test/lib/geo/bestSpotGolden.test.ts:331-466` bit-identical. `test/lib/geo/bestSpotMetric.test.ts:623-645`'s `expect(r.f).toBe(Math.max(r.fGraze, r.fGap))` becomes a three-way max — the one PIN-2 line that breaks. `npm run proofs`.

---

### SLICE 3a — the per-segment buffer at T = 1 (a pure refactor)
**Files.** `src/lib/geo/bestSpotSolver.ts:247, 298-386, 977-997, 1069-1182, 1243-1382, 1567-1594, 1607-1732` · `src/lib/geo/bestSpotTrack.ts:994-1004` · `src/lib/geo/bestSpotTypes.ts:114-152`.
**Change.** T2's map 3-9, executed with `T = 1` throughout and nothing else moving:
- `EventTrack` gains optional `segLo`/`segHi`/`sunAltAtSegDeg`; at T = 1 they are `[windowLo]`/`[windowHi]`/`[sunAltAtT0Deg]`.
- Split the term buffer into per-segment (16 f32 + peak's 5 + `starIdx` u16 + 2 u8) and shared (`c`, `minReachM`, `cls`, `flags`). `TERM_BYTES_PER_CELL` becomes a function of T; **at T = 1 it must allocate and index exactly today's byte count** so `termBufferView` is a no-op change.
- `composeScores` grows the argmax loop and a `winner: Uint16Array`; at T = 1 it is `max` over one element.
- `M_eff` becomes per-segment via `sunAltAtSegDeg[g]`; `worthFromParts` stays pure and ephemeris-free so all six `worth.*` leaves stay `recompose`.
- **The argmax objective may read only leaves whose `CLASS_OF` is `rescore` or heavier.** Write it into `BESTSPOT_HONESTY` as a documented rule. Without it, every `recompose` leaf can move *which* instant wins, `composeScores` cannot re-run the argmax (the losing evidence is gone), and `CLASS_OF` becomes a lie for `weights.*`, all four `gates.*`, all five `gap.*`, `graze.conf.*`, `worth.*` and thirteen `access.*` — **with nothing going red**, because every existing recompose test asserts only `movedBy(patch) > 0` (`test/lib/geo/bestSpotSolver.test.ts:1060`).
- `cellScore` stays segment-free; the f32-exact diff pin (`test/lib/geo/bestSpotSolver.test.ts:643-665`) runs at T = 1 only. Say so in the docstring.
- `leadMs`: replace the O(window) nearest-altitude inversion (`bestSpotWorker.ts:913-926`) with `track.samples[starIdx_g].utcMs − track.t0Ms`. Exact and O(1).
**Proves it.** THE BYTE-IDENTICAL PROOF (deliverable 5), plus a re-run of the recompose-leaf perturbation loop at `test/lib/geo/bestSpotSolver.test.ts:1080-1103` — the test that kills an argmax-in-solve implementation.
**Green gate.** The full golden table, the composition hero (`test/lib/geo/bestSpotComposition.test.ts:189-219`, `f = 0.59720`, `S = 0.82219`, margin `0.12613`) unchanged to the digit, and the `hullBuilds` contract at `test/lib/geo/bestSpotResidency.test.ts:239-332` unchanged in all six rows.

---

### SLICE 3b — the window, the toggle, T > 1
**Files.** `src/lib/geo/bestSpotTrack.ts:434-483, 797-846` · `src/lib/geo/bestSpotWorker.ts:165-235, 1321-1340` · `src/components/globe/scene/bestSpotFeed.ts:513-598, 753` · `src/store/bestSpot.ts:169-170, 446-449` · `src/components/panels/BestSpotPanel.tsx:528, 634, 649` · `src/components/globe/tuning.ts` (`BESTSPOT.window*`).
**Change.**
- Three new `EventTrackOptions` GEOMETRY fields: `windowTopAltDeg`, `windowSegments`, `windowMaxSamples`. Truncate the window from the **new** end (low-k for a SET, high-k for a RISE, decided from `upSign` at `bestSpotTrack.ts:660`, never from the hemisphere) **before** the `maxSamples` decimation at `:847-863`, which thins *uniformly* and would destroy the superset property.
- Four job fields, **required not optional** — `test/lib/geo/bestSpotResidency.test.ts:107-149` builds a full literal and a required field turns it red at `astro check` time, which is how a wire is stopped from drifting.
- The T0.5 key carries the numbers, not a flag (assumption 4). OFF must produce the pre-change string character for character.
- `sourcesEpoch` must **not** move (`bestSpotFeed.ts:759`) — that identity is what makes a toggle cost `(K′ − K)` hull builds rather than K per rung.
- Store: `sweepMode: boolean` in the *UI-written, engine-read* band, **out of `BestSpotFeedKeys`** (`src/store/bestSpot.ts:118-145`) so `_syncBestSpot` structurally cannot write it. **Add `sweepMode: false` to `DEFAULTS()` in `test/store/bestSpot.test.ts:36-62`** — F8's leak.
- Panel: a second `<button className="pp-chip" aria-pressed>` in the `.pp-chips` row at `BestSpotPanel.tsx:611`, label ≤ ~10 chars with parameters in `.pp-chip__kind` (T1 Trap 5: the row wraps at 244 px). Plus **one** honesty status line rendered *only* when ON, so the OFF layout is unchanged to the pixel: `data-tone="warn"`, no colour literal (`test/components/bestSpotPanel.test.ts:751-780` is the D14 fence).
- **Sizing: `windowMaxSamples ≈ 68` (K ≤ 80, ladder ≈ 950 ms against the `refinedMs ≤ 1200` gate at `scripts/verify-bestspot.mjs:349`), `windowSegments = 5`.** All of T2's latency numbers above K = 40 are linear projections, not measurements — the first browser run is the real gate.
- Refuse SWEEP × ULTRA in the store (N8).
**Proves it.** A `sweepOn === K′ − K` / `sweepOff === 0` fifth row in `test/lib/geo/bestSpotResidency.test.ts`, with the negative control at `:290-304` as the proof it means anything. And **the superset pin nothing currently asserts**: `set(track(top=4).azDeg) ⊆ set(track(top=10).azDeg)` — the entire cost model rests on it.
**Green gate.** `test/lib/geo/bestSpotTrack.test.ts:273-293` (`spanMin < 90`) must keep its OFF case verbatim and gain a sweep case. `test/components/globe/bestSpotFeed.test.ts:117-129`'s `beforeEach` gains `sweepMode: false`. Browser: `refinedMs` re-measured.

---

### SLICE 4 — the shortlist quota and the per-row time
**Files.** `src/lib/geo/bestSpotWorker.ts:288-321, 813-945, 1035-1046, 1426, 1573, 1703` · `src/components/globe/scene/bestSpotFeed.ts:586-594, 615-618, 780-783, 801-816, 842-866` · `src/store/bestSpot.ts:48-90, 118-145` · `src/components/panels/BestSpotPanel.tsx:225-252, 330-346, 417-425, 430-465`.
**Change.** T6's select-then-emit rewrite: greedy-with-caps (pass A) then unconstrained fill (pass B), then **rank by score, never by selection order** (the row prints its absolute score beside its rank at `:418-419` — a list that disagrees with its own numbers reads as a bug). `chosen.length === 0` short-circuits every cap, so **rank 1 is never quota-displaced**.
- Mirror `contactMs` into the store — it exists on the rung (`bestSpotWorker.ts:373-383, 1462`) and reaches the feed but is consumed only by the DEV probe (`bestSpotFeed.ts:919`). That one missing mirror is both halves of the diagnosis.
- `bestAtMs?: number` — optional, written only in sweep mode (C7). Add it to the mirror signature at `bestSpotFeed.ts:801-816`, which today keys on `score` alone: a re-solve that moved only the *times* would not re-mirror.
- Row line 1 **swaps** `+3m20s` for `~19:44` (both 6 chars) — it does not append. `.pp-day__kind`/`.pp-day__meta` are `overflow:hidden; text-overflow:ellipsis` (`plan-panel.css:292-310`), and `bestspot-panel.css:302-305` records that this exact failure already silently dropped a resolution qualifier once.
- `spotWhyLines(spot, kind)` — kind **required**, not defaulted: a default lets a caller print `AFTER SUNSET` for a moonrise.
- `useTimeStore` selector must be quantized (`Math.floor(t.timeMs / 60_000)`) or the panel re-renders eight rows every scrub frame.
- Three job-post sites, not one. Missing `rankUnder` at `bestSpotFeed.ts:611-618` makes the owner's own `.ab()` tool measure an instrument the screen never shows.
- **`kindCap` re-sized for a four-valued `contact`** (assumption 5). **`sectorCap = 4`, not 3** — on the owner's own run four rows land in the 315-360 sector and a cap of 3 drops rank 4, the row 42 m from his hand-pick.
**Proves it.** The nine existing positional `shortlist(...)` call sites (`test/lib/geo/bestSpotWorker.test.ts:206-237`, `test/lib/geo/bestSpotHonesty.test.ts:463,472,495,503,521,611`) become the OFF regression fence: assert a quota'd call on a single-bucket fixture returns an array **identical** to the `diversity: null` call. `test/components/bestSpotPanel.test.ts:234,239` is **index-addressed** into `bestSpotStatusLines` — rewrite as substring `.find()` before touching that array.
**Green gate.** `test/components/globe/bestSpotSheet.test.ts:546-609` unchanged — the "no third marker channel" recommendation is what keeps it green.

---

### SLICE 5 — cut or defer. See deliverable 7.

---

# 5. THE BYTE-IDENTICAL PROOF

**The single strongest machine-checkable assertion, and it lives in node, not a browser:**

> In `test/lib/geo/bestSpotComposition.test.ts` (the whole-chain hero at `:160-219` — real `eventTrack` → real DSM + deck → `composeScores`), with `sweepMode` OFF, `peak.enabled: false` and `T = 1`, a SHA-256 over the raw bytes of the returned `Float64Array` of scores equals a committed hex literal.

One line, exact (not `toBeCloseTo`), covers V, L, P, F, all four gates, `M_eff`, the access tables and the whole term-buffer round trip in one number, and it fails on a single-ULP drift anywhere in slices 2-4. Commit the literal at the end of slice 1 (after the tree re-baseline, before F_peak exists) and never touch it again.

Three supporting assertions, each guarding a seam the hash cannot see:

- **The wire's exact key set** — `test/lib/geo/bestSpotHonesty.test.ts:617-634`, `Object.keys(r).sort()` against the 14-name literal. Keeping `bestAtMs`/`bestAltDeg` **optional and absent in OFF mode** turns this existing test into the proof that the OFF wire is unchanged. This is why C7 was ruled the way it was.
- **The tier key is the pre-change string, character for character** — `expect(feed.debug().keys.t05).toBe(\`sunset|${localDayWindow(NOON, LON).startMs}\`)` in `test/components/globe/bestSpotFeed.test.ts`, with a positive control that turning the mode ON does move it.
- **The shipped default's hash is still the shipped default** — `expect(job.scoringHash).toBe(scoringHash(BESTSPOT_SCORING_V1))`. Note the direction: because the mode is a job field by design, a hash *compare* proves nothing; the assertion that carries weight is that the hash has **not** moved for a user who never enabled the mode.

The `rg8` byte-compare is stronger still but is browser-only (`window.__globe.bestSpotField().rg8`, `StylizedTiles.ts:2442`) and needs two builds. It is a one-time landing check in `scripts/verify-bestspot-ownerbatch.mjs`, not a regression test.

---

# 6. BLAST RADIUS OF THE DEFECT FIXES

D1 and D2 change the default field for every user. What moves:

**Unit tests — small, and this is the surprise.**
- `test/lib/geo/bestSpotWorker.test.ts:118-183` — three `buildDsm` cases, positional; a fifth param defaulted to `[]` keeps them green, but the block needs a fourth case (canopy ⇒ `SRC_TREE`, never `solidMask`).
- `test/lib/geo/localDsm.test.ts:588-618, 641` — the only existing exercise of `addCanopy`/`sealDsm({includeCanopy})`. Green, must be extended.
- `test/components/globe/bestSpotFeed.test.ts:104-110` — `mountSync()` mounts bare `THREE.Group`s and `enrichedGroup: null`. **This is why no existing test could have caught D1.** All five new tests go here.
- `test/lib/geo/occlusion.test.ts:102-160` — must still pass byte-for-byte once the three constants are exported.
- `test/components/globe/fences.test.ts:388-408` — the worker's static import graph must still equal the tuning allow-list. `occlusion.ts` pulls in `lib/globe/enrichedMask` + `lib/geo/horizonProfile`; neither reaches `components/globe/tuning`. **Verify, do not assume.**
- `test/components/bestSpotPanel.test.ts:247,251,257` — `provenanceLine` strings. Green (the unit test feeds the store directly), **which is exactly why it never caught the `enriched` inflation**. Add a case.

**Golden numbers — none.** Control-validated: the only committed geo fixture is `test/lib/geo/fixtures/ofm-z14-9787-5662-dnipro-central-bridge.pbf` (MVT landcover, tree-free), and every `"tree"` reference in `test/lib/geo/bestSpotGolden.test.ts` / `bestSpotMetric.test.ts` / `bestSpotSolver.test.ts` is a **synthetic** `groundSrc: "tree"` ray constructed in the test, not derived from a bake. **No golden field statistic in the repo is a function of tree geometry.** Case 15 (`grazingRidge("tree", 8000)`, `f = 0.8812`) stays put under the C11 ruling (no near/far split).

**Browser verify — this is where the cost is.**
- `scripts/verify-bestspot.mjs` — the relational assertions (`:479-488`, texel classes === census counts) survive by construction. The absolute D1 top-8 note (`:449-453`) moves. `:552-553` (`gridCellM === 1`) is safe. `:914-921, 943-952` (`note !== "ON A BRIDGE"`, `openBest.contact === "open"`) can flip once canopies clear `starOpenSky`. `:1096-1111` (rural `S > 0.6` fraction) — rural sites carry the fewest trees, so lowest risk, but re-read it.
- Timing gates `firstInkMs ≤ 120` / `refinedMs ≤ 1200` (`:345-350`): unchanged in K, but the DSM gains a canopy pass. Measure.
- `scripts/verify-bestspot-ownerbatch.mjs:190-215` and `scripts/probe-bestspot-taste.mjs:298-306` re-run against a changed field.
- `test/verifyHarness.test.ts:57-80` (C11) fires on any **new** `scripts/verify-*.mjs`. The `probe-` prefix is the documented way out (`DECISIONS.md:351`).

**Product-level, and it is not a bug:** the densest 300 m disc in the Dnipro bake goes from *"open sky, scores fine"* to **100 % blocked at every altitude to 10°**, on 9,570 canopies of which ~6 have a surveyed height. T5's own histogram: **only 118 of 161,823 tree heights (0.073 %) are integral**, i.e. could have come from an OSM tag — 99.93 % are a uniform random draw over a class range. Shipping occlusion without a policy for that turns every park in Dnipro into a black disc with eight missing markers. That is O3.

---

# 7. WHAT I WOULD CUT

Ranked by owner value ÷ risk.

**Ship in the first pass**
1. **Slice 0, the track sub-hash.** Two shipped taste leaves are dead; the fix is ~10 lines and it is a precondition for everything track-shaped. Highest ratio in the whole scope.
2. **Slice 1, D1 + D2.** Correctness, the owner's own ruling, and it unblocks four other tracks' designs. Risk is real (field re-baseline, browser re-verify) but it is one-time and it only gets more expensive later.
3. **Slice 3a, the T=1 per-segment refactor.** Pure refactor with an exact identity proof. It is the whole engineering cost of sweep mode paid where it can be checked.
4. **Slice 3b, the window + the toggle.** The feature the owner asked for.
5. **Slice 2, F_peak.** High value (it is the missing dual, and T2 proved `F_gap` is structurally dead above the rooftops so sweep mode has *no* framing term up there without it) but it is the largest new surface: nine leaves, a new kernel, a Lean twin, twenty golden rows, and every number in T4 is [DERIVED] from a JS replica rather than measured. It ships, but it ships gated OFF and it is the slice most likely to need a second tuning pass.

**Do NOT ship in the first pass**
6. **T5's `tauTree` near/far split** (`graze.treeNearM`, +4 B/cell, a matching change in `bestSpotMetric.ts:1284`). Cut. `Depth(D)` already prices distance per edge, and T4's measurements show no distance cut separates the mid-range tree from the 1.5 km spire. `peak.conf.tree = 0` expresses the ruling in one number.
7. **T6's five-status-line collapse (−98 px).** Genuinely good, genuinely justified by an existing owner precedent (`.bsp-legend__cap`), and completely orthogonal to this feature. It is a taste pass. Doing it inside a mode-addition commit means a layout regression and a scoring regression land in the same diff. Separate PR.
8. **A third marker channel for time.** T6 argued against it and the argument holds: `heatPalette.ts:56-83` assigns exactly two channels to two facts and says the pairing is load-bearing; radius, opacity and the core glyph are all already carrying claims. Time belongs on the instrument that owns time — the `◷ 19:44` action on the selected row, which costs the other seven rows nothing.
9. **T5's honesty withdrawal (canopy-only rays don't count as evidence).** Correct in principle, and the argument from `openSkyUncredited` (`bestSpotSolver.ts:1099-1102`) is strong. But it moves `C`, hence `minCoverage`, hence the candidate set, hence every browser census number — a second field re-baseline in the same release. Land slice 1 first, **measure** what fraction of a real Dnipro disc actually crosses the threshold, then decide. That is O3.
10. **Persisting the SWEEP toggle.** `heatmapOn` deliberately does not persist. Session-only is one line, ships with slice 3b, and can be upgraded later; persisting first means a `prefs.ts` field, a sanitiser case, a migration clause and a `setOpen` decision that cannot be undone without stranding blobs. That is O1.
11. **`peak.spanDeg` as a tunable.** It is `rescore` (177 ms), it decides which rays are scanned, and it has no calibration behind it. Ship it as a frozen constant in the first pass and promote it to a leaf only when a taste session asks for it — that also removes one of the nine leaves from the every-field-is-live walk.

---

# 8. OPEN QUESTIONS FOR THE OWNER

**Q1 — Does SWEEP persist across sessions, or reset every time the panel opens?**
`heatmapOn` deliberately does not persist and is force-cleared in both directions (`src/store/bestSpot.ts:446`); `bestSpotTuning` does persist and announces itself. Persist-and-reset-on-open are mutually exclusive — `setOpen` runs before the flag is ever readable.
**Recommended default: session-only, cleared in `setOpen` exactly like `heatmapOn`.** SWEEP changes what the disc *means* ("SUNSET" can mean 40 minutes after it), and a mode that silently rewrites the instrument's claim on next boot is the kind of quiet lie this whole feature exists to close. Upgradeable later; not downgradeable.

**Q2 — When a 300 m disc's horizon is dominated by modelled canopy, should it read BLOCKED or UNKNOWN?**
Slice 1 makes trees occlude honestly. Measured consequence: the densest disc in the Dnipro bake goes 100 % blocked at every altitude to 10°, driven by 9,570 canopies of which 99.93 % have a randomly drawn height. Blocked says "we know this is a bad spot"; unknown says "we cannot model this place".
**Recommended default: UNKNOWN, via the existing `C` machinery** — a ray whose headline occluder is a canopy and nothing else increments the weight sum but not the *known* sum, so the cell falls below `gates.minCoverage = 0.5` and renders through the path that already exists. Never a low score, never a cold colour. But this is a visible product change to every park in every region, so it is yours. **Defer it to its own slice either way** (deliverable 7 item 9).

**Q3 — How far above the horizon may the window reach, given that beyond ~+12° at Dnipro it costs the `refinedMs ≤ 1200` budget?**
`BESTSPOT_TASTE_V1.md` suggests "±90 min / up to ~20°". At the owner's own moonrise, +20° clamps at culmination (19.70°) and yields 232 window samples, K = 244, ~615 MiB of hulls — roughly 2.9 s per ladder. A fixed altitude top is unbounded in K.
**Recommended default: express the cap as a lattice-sample budget of ~68 window samples (K ≤ 80), which lands at ≈ +12° at Dnipro sunset and ≈ +9-10° at his moonrise — both comfortably above the +5.90° frame from his own photograph, and both inside the twilight plateau where `M_eff` measures 1.0000.** Ship that, measure the first browser run, and raise it only if the measurement allows.
