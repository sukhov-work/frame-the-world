# WIP 2026-08-26f — BEST SPOT taste + coverage [DESIGN ONLY, nothing implemented]

Owner order, still mid-QA of the heatmap: *"no suggested spots in the middle of the avenue, although
here is my hand picked spot… how do we improve taste and coverage."* Explicitly general, not about
the moon or that location. Twin: DECISIONS §Recent **2026-08-26f**. Doc:
`.claude/claude-docs/bestspot/BESTSPOT_TASTE_V1.md`. Predecessors:
[[project/wip-2026-08-26-bestspot-ownerbatch]] · [[project/wip-2026-08-24-bestspot-s3-s7]].

## GATES
**vitest 2,119/2,119 (141 files)** · `astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.
Tier LOCAL + BROWSER. **No `src/**` change** — this session produced a design, a probe and a record.
Probe: `scripts/probe-bestspot-taste.mjs` (NEW; deliberately NOT `verify-*` so C11 does not fence it).
Raw numbers: `verify-shots/probe-bestspot-taste.json` (10 profiles).

## THE HEADLINE — HIS CELL SCORED **EXACTLY ZERO**, AND NOT FOR ANY REASON ANYONE GUESSED
Disc reproduced verbatim (`p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`, **MOONRISE** — the
store defaults to `sunset`, and a first run on the wrong kind measured a near-black disc and nearly
sent the diagnosis the wrong way). His pick `48.451827,35.070311` is 82 m from centre, reads
**`SCORED-reachable`** (no gate excluded it), display byte **0**, tied with 11,984 cells, 13,593
strictly better, percentile 0.469. **Neither excluded nor crowded out — scored, and scored zero.**

Ten live profiles through `__globe.bestSpotTuning` separate why. **REFUTED:** `accessSoftExponent: 0`
(kills the whole `A_soft` ladder) → still 0; `access.soft.{majorRoad,road}: 1` → still 0;
`lCeilDeg: 30` → 0; `altScaleDeg: 30` → **field byte-IDENTICAL to base**; `depthTrustRadiusM: 200` →
0 (field best 0.400→0.456); all three → 0; all three + both global multipliers removed → 0.
**CONFIRMED:** `gates.{vGateLo:0, vGateHi:0.05}` moves him **0 → 84** (field best 230), and the direct
read `S ≡ V` (`weights {v:1,l:0,p:0,f:0}` + gate off + headroom) measures **`V ≤ 0.15`**.
`G(V)=smoothstep(0.15,0.75,V)` is exactly 0 below `vGateLo` ⇒ `S = 0` ⇒ dropped at
`!(scores[i] > 0)` (`bestSpotWorker.ts:834`).
**H6-vs-H8 is the discriminator: H6 carried MORE score-raising patches than H8 and still read 0;
the only thing H8 removed was the gate.**

## THE UPSTREAM CAUSE IS THE MOMENT — AND THE ENGINE IS HONEST
`eventTrack` sweeps airless `TRACK_TOP_ALT_DEG = 4°` → `alt(t0) − 3ρ`
(`bestSpotTrack.ts:319,323,626-627`). Independent `astronomy-engine` check at his coordinates:
disc `contactMs` **15:57:36Z** vs true moonrise **15:57:56Z** — **agree to 20 s**, so the ephemeris
half is sound. At the contact: moon alt **−0.24°** / az **116.73°**, sun **+5.16°** (broad daylight,
`worth` near its floor — the whole field haircut). His photograph: **16:44:43Z**, moon alt **+5.90°**
/ az **125.43°**, sun −1.94°. **47 min later, 8.7° further round, 1.9° ABOVE THE TOP OF THE WINDOW.**
His moment is not a low-weighted sample — it is not a sample. That is exactly why `altScaleDeg`
changed nothing: re-weighting cannot reach samples that do not exist.
Also: the scrubber read 19:44 local while the disc was a statement about 18:57 local, silently.

## "COVERAGE" WAS THE WRONG DIAGNOSIS — REFRAMED ON EVIDENCE
The eight markers sit on **89.8 %** of cells scoring ≥90 % of the field's best (100 % within 60 m),
and **one was 42 m from his own pick**. The shortlist is faithful; the FIELD answers the wrong
question. More markers / bigger disc / looser NMS would not have found it.
What the run DOES expose: the eight span **0.3796→0.3989 (5 %)** and **six of eight peak at the same
minute** (`leadMs` −4.1). And the field is barely readable — best cell **S = 0.400** against a window
to 0.90, **46.9 %** clipped to `displayLo`, **87.9 %** in the bottom two sixteenths.

## WHAT THE METRIC CANNOT SEE EVEN AT THE RIGHT MOMENT
- **`F_gap` is the exact DUAL of an apex shot.** `notchAt` scores sky BETWEEN two masses; ±ρ around
  `az*` is excluded from floor AND both shoulders (`bestSpotMetric.ts:766,786,791`) and
  `depth = min(sL,sR) − floor` ⇒ **a lone spire at `az*` gives `F_gap = 0` exactly**. Nothing scores
  mass surrounded by sky.
- **`F_graze` is linear in angular width then saturates** (`τ ≈ c̄·q̄·conf·(W/ρ)·k`): 4° ridge
  **0.9995**, 0.3–1.0° spire apex **0.51–0.85** — out-saturated, not zeroed; and the ridge wins over a
  BROAD region while the spire is a knife-edge corridor the 25 m NMS collapses to one row.
- **`P` says near is bad**: 20 m monument @150 m = **0.35** vs 3 km ridge **1.00**.
- **No landmark data anywhere.** Whole vocabulary = `OccluderSrc none|terrain|building|tree|deck` +
  alt + dist + `known`. The Monument of Glory reaches the DSM only by luck of one tag
  (`way/1202608487`: `building=yes` + `height=20` beside `historic=memorial`; bake filter is
  `way["building"]`). `historic=memorial` steles 4 km away have no `building` tag ⇒ invisible
  end-to-end.

## TWO DEFECTS FOUND ON THE WAY — REPORTED, NOT FIXED
1. **`flattenTin` ignores `InstancedMesh.instanceMatrix`** (`scene/bestSpotFeed.ts:289-306`) — tests
   only `mesh.isMesh`, which `InstancedMesh` satisfies (`scene/enrichedBuildings.ts:691-693` says so
   in a comment). So BEST SPOT flattens ONE unit-size prototype tree at each InstancedMesh's own
   `matrixWorld`, tagged `SRC_BUILDING`, and misses every real canopy. `scene/planFeed.ts:238-248`
   does it right, 30 lines away in a sibling feed. **Magnitude UNVERIFIED.**
2. **`addCanopy` / `stampSolid` are DEAD in the shipped path** — nothing in `src/**` calls
   `addCanopy`; `buildDsm` tags every solid `SRC_BUILDING` unconditionally ⇒ `graze.conf.tree = 0.45`,
   `SRC_TREE`, `noteOf(SRC_TREE)` unreachable. `SPEC_V2 §1.2`'s "terrain, every building, bridge
   decks, trees" is NOT what ships. **On a tree-lined avenue the model sees open sky.**
Both cut TOWARD optimism, so neither suppressed his cell — but **fix #1 BEFORE any taste
re-calibration**, or the re-tune is calibrated against a model that thinks an avenue is open.

## THE FOUR PROPOSALS, RESOLUTION ORDER (A enables; B and C cannot rescue a zero)
- **A · the MOMENT becomes a dimension.** Sweep `T` instants over a photographic window reaching well
  above the horizon; keep the **BEST** instant per cell, never the average (an average is what makes a
  90-second alignment vanish); promote `leadMs` to the headline. **The architecture was built for it**
  — the per-ray upper convex hull is time-invariant, measured at **0 hull builds** per within-day
  scrub, so instant #2 costs a max-angle query + a score pass, never a hull.
  **Would-it-fire on the captured bad case: his own photograph proves the moon is unobstructed at
  16:44:43Z ⇒ V = 1 ⇒ the gate opens ⇒ the cell scores.**
- **B · `F_peak`, the missing dual of `notchAt`** — local skyline prominence at the body's azimuth,
  walking the SAME `Hg` array the notch already walks. Plus re-open `P` (split `P_open`/`P_subject`,
  or ship `depthTrustRadiusM` as a PRESET — 200 m lifted field best 0.400→0.456 and reordered).
  B2 later: an OSM landmark layer so the panel can say *"moon on the Monument of Glory, 19:44"*.
- **C · diversity by COMPOSITION, not position** (cheapest): `contact`, `bearingDeg`, `leadMs` are all
  computed INSIDE the push loop AFTER selection (`bestSpotWorker.ts:913-935`) — outputs that have
  never been inputs. Quota from rank 2 down. **Honest scope: C would NOT have found his spot.**
- **D · make a flat field readable** by extending the 2026-08-26e marker rule the owner already
  ratified (hue field-relative, vividness absolute) to the SHEET — §3.5 survives untouched.

## THE ONE OWNER DECISION (doc §7)
What is the disc anchored to: **A1 window sweep (recommended)** · A2 follow the scrubber · A3 keep the
contact, widen only the window's top. A1 is the only one answering *when AND where*.

## TRAPS PAID THIS SESSION
- **`__bestSpotStore` defaults to `kind: "sunset"`.** A probe that opens the disc without
  `setKind("moonrise")` measures a DIFFERENT event and a near-black field — it nearly sent the whole
  diagnosis the wrong way. Set the kind, then re-assert it after `setOpen`.
- **`rg8.r` is CLAMPED to `[displayLo, displayHi]`**, so any cell below 0.15 is byte 0 and
  indistinguishable from an exact zero. To read structure below the floor you must remove the global
  multipliers (`curves.accessSoftExponent: 0` + `worth.effectiveFloor: 1`), not lower the window —
  `displayLo/Hi` live in `tuning.ts` `BESTSPOT`, NOT in the patchable scoring profile.
- **A single ablation proves nothing without its control.** The pick reads 0 under every profile;
  only the H6-vs-H8 PAIR (more patches, gate on → 0 · fewer patches, gate off → 84) identifies the
  gate, and only `S ≡ V` MEASURES the quantity instead of inferring it.
- **The field improves as tiles stream**: two base runs 12 min apart measured `floorFrac` 0.699 then
  0.469, `rMax` 84 then 85. Quote ONE self-consistent run; never mix them.
- Node 20 has no global `WebSocket` — CDP probes need `~/.nvm/versions/node/v24.10.0/bin` on PATH.

Related: [[project/wip-2026-08-26-bestspot-ownerbatch]] · [[project/wip-2026-08-24-bestspot-s3-s7]] ·
[[project/wip-2026-08-23-bestspot-heatmap]] · [[patterns/globe-rendering]] ·
[[decisions/session_workflow]]
