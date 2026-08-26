# WIP 2026-08-26g — SWEEP MODE approved + mapped; slices 0 + 1 SHIPPED (trees + a dead taste leaf)

Owner ruling on `BESTSPOT_TASTE_V1.md` §7: **A1 window sweep, as an ADDITIVE MODE** (default OFF,
current behaviour untouched, toggle at the top of the panel) + *"safely implement additional
proposals for this mode (F_peak…)"* + *"fix those defects"* + the TREE RULING. Twin: DECISIONS
§Recent **2026-08-26g**. Predecessor: [[project/wip-2026-08-26-bestspot-taste]] (the diagnosis).

## GATES
**vitest 2,134/2,134 (141 files, +15)** · `astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.
Tier LOCAL + BROWSER (re-baseline measured on the owner's disc).

## THE MAP IS THE SPEC — READ IT FIRST
`.claude/claude-docs/bestspot/SWEEP_MODE_MAP.md` — six-track parallel read + consolidator. Carries
the ruled contradictions, the decision map (N1-N15), the full slice plan, THE BYTE-IDENTICAL PROOF,
the blast radius, and five explicitly CUT items. Its header records status + the one deviation.

## SHIPPED — SLICE 0: two taste leaves were SILENTLY DEAD
`trackWeight.altScaleDeg` / `.horizonCeiling` are baked into `w_i` inside `eventTrack`
(`bestSpotTrack.ts:629-631, 950-957`) and `V` integrates against `w`. The resident track was cached
on `${kind}|${localDay}` with NO profile term, and both leaves were classed `reweigh` — answered by
`runApply` → `composeRung` from the resident TERM BUFFER (where `V` already carries the old weights)
and never rebuilding the track. **Inert until a day/kind boundary.**
FIX = BOTH halves; **neither works alone**: `trackHash` (NOT `scoringHash` — narrow on purpose) in a
new exported `trackKeyOf`, AND the class `reweigh` → `rescore`. Mutation-verified both ways; the
negative control (a recompose leaf must NOT move the key) stays green under both mutations.

## SHIPPED — SLICE 1: the trees
**1a `InstancedMesh.isMesh` is TRUE** ⇒ `flattenTin` flattened the shared UNIT PROTOTYPE at each
cell's `matrixWorld` (one ~1 m phantom "building" per cell) and missed every canopy.
**THE ORDER IS THE FIX, not just the branch:** `geom.boundingSphere` on an InstancedMesh is the
prototype's ~0.5 m ball at the cell root, so a branch placed AFTER the existing reject is a NO-OP at
exactly the discs that have trees. **The cull must be PER INSTANCE** — mutation-verified: the naive
placement fails precisely `THE PER-INSTANCE CULL` test. `heightProvenance.enriched` no longer counts
tree sets (read it DOWN as inflation removed).
**1b `addCanopy` had ZERO production callers.** Canopies now go to `canopyTop`/`canopyMask`,
**NEVER `solidMask`** — a canopy in the solid mask makes every tree-lined avenue INACCESSIBLE once
the sheet lifts to `access.aerialMinM` (5 m), a drone "inside" a tree. **The 6 m arm of that test is
the trap; the 1.7 m arm passes even when broken.** One shared `enuOfEcef` carries the DSM's pin-5
`(e²+n²)/2R` datum; the PARITY test subtracts it and demands equality, so dropping it goes RED.
**1c THE CANOPY WITHDRAWAL (owner's choice).** Withhold `known`, keep the weight ⇒ `C` falls through
`minCoverage` ⇒ UNMAPPED, never a low score. **Two-sided, both sides earned:**
 · upper — the disc's LOWER limb below the canopy top (else every park with a high view is erased);
 · lower — the body's UPPER limb above the eye's DIP, because **below the dip the body is set behind
   THE PLANET, not the tree**. Without it a 1.2 m hedge at 200 m measured `C = 0.412` (UNMAPPED) on
   an open view.
**Measured: the dip bound removes 84,899 → 39,078 withdrawals (54 % spurious) while `C` moves only
0.6163 → 0.6169** — `horizonCeiling` already zeroed those weights. So it changes the DIAGNOSIS, not
the verdict, and is therefore **pinned on the COUNTER** (`canopyUncredited`).

## THE RE-BASELINE, BROWSER-MEASURED on the owner's own disc
scored **25,578 → 23,796** · unknown **8,984 → 11,009 (+2,025 = 7.9 % of previously-scored)** ·
`unmappedFrac` **0.000 → 0.064** · INACCESSIBLE **5,839 → 5,596 (−243, the phantom prototypes)`.
`rMax` unmoved (85 → 84), argmax same neighbourhood ⇒ honesty, not re-ranking. **His hand-picked
cell is still r = 0, correctly: its problem was the MOMENT, never the trees.**

## NOT BUILT — slices 2, 3a/3b, 4 (mapped in full)
Scope call: a large unverified `bestSpotSolver` refactor is worse than nothing; 0+1 are
independently shippable. **One deviation already decided (map header):** slice 3a's per-segment
buffer (T × 96 B/cell ⇒ ~163 MB at 601², blowing `bestSpotSolver.test.ts:1271`'s 105,906,176 B
ceiling) is REPLACED by **T sequential solves against the resident DSM, per-cell running MAX, the
winning instant's terms merged into ONE buffer**. Same behaviour, today's memory, no buffer
refactor, OFF byte-identical (T = 1 IS today's call), hulls still amortise via the absolute
lattice's superset property. **Consequence: in SWEEP mode a scoring patch is `rescore`, never
`recompose`** — the losing instants' evidence is gone, so `composeScores` cannot re-run the argmax.

## TRAPS PAID THIS SESSION
- **A fixture that distorts geometry to register is a broken fixture.** Flooring the canopy radius
  at 6 m "so it always stamps a cell" turned a 1 mm tree into a 6 m blob and made the whole height
  argument meaningless. If it will not register, the GRID is too coarse.
- **A correct-looking guard that no test pins will be deleted silently.** The dip bound passed all
  three original tests when mutated away; it needed its own pin, on the quantity it actually moves.
- `bestSpotFeed.test.ts`'s `mountSync()` mounts bare `THREE.Group`s — which is exactly why nothing
  in 2,119 tests could ever have caught D1. New instanced-mesh cases live there.
- `CanopyWire.instanceMatrices` must be a COPY: `enrichedBuildings` writes `m13` into the live
  `instanceMatrix.array` every frame during the tree re-seat.

Related: [[project/wip-2026-08-26-bestspot-taste]] · [[project/wip-2026-08-26-bestspot-ownerbatch]] ·
[[project/wip-2026-08-24-bestspot-s3-s7]] · [[patterns/globe-rendering]] · [[decisions/session_workflow]]
