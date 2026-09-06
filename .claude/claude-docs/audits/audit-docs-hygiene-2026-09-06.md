# Audit — docs + memory hygiene sweep — 2026-09-06 — baseline DECISIONS 2026-09-06f (audit-3 report `audit-batchseams-2026-08-22.md` for Track D)

Owner order (2026-09-06f): "a quick sweep over decisions log, memories and architecture and plan docs to dedupe, archive and optimize (use audit mode) and also go through the guide and see what is missing in terms of the features and add it, with no-slop applied to everything. Fit it in one session." Mode: `/frame` Audit, Deep on docs, Tracks D + E + the guide gap, under the `investigate-design-v3` review spine. Ten opus subagents ran in parallel (five era-digest writers, the memory-graph pair, the architecture-docs track, the backlog + link-probe track, the guide-gap track); the main agent did the DECISIONS move, the verification pass, and this report. Unlike a pure audit this session was AUTHORIZED TO WRITE inside a fence: `.claude/claude-docs/**`, `.serena/memories/**`, `.claude/conventions/**`, `.claude/skills/frame/references/**`, and one `src/` file, `src/lib/guide/guideContent.ts` (+ `test/lib/guide/**`). Nothing else under `src/`, `scripts/`, `test/` or `tools/` changed (`git status` at the end of the session is the proof).

## Verdict

The docs were structurally sound but three stores had outgrown their caps and one registry had a hole: DECISIONS §Recent was 437 KB against a 135 KB trigger, `mem:core` was 94 KB against 12 KB, and twelve backlog rows (T59–T70) had shipped without Pointer or State columns. All three are fixed; every fix is dated and the DECISIONS move is checksum-proven. The guide gap was small and real: two topics (model upload limits; editing handles and snapping) and one false claim (building edits described as browser-only although SYNC has shipped since 2026-09-02f). The tree is fit for T77 to resume at T80.

Scope line: nothing scheduled or drafted touches the permanently-out list (Phase-7 AI panel · Gaia-depth · telescope GOTO · tides/rainbow · Skyfire · upload/marketplace/pins on mobile). The two shipped features named GOTO (the TargetPanel aim pill; the MS7 MODELS-row camera GOTO) are disambiguated in `IMPLEMENTATION_PLAN.md`.

## Gates baseline

| gate | start of session | end of session |
|---|---|---|
| `npm test` (vitest) | 2,463/2,463 (164 files) | 2,465/2,465 (164 files; +2 guide golden rows) |
| `npx astro check` | 0 errors / 0 warnings / 9 hints (the dated baseline; the hints are unused-variable notes in `scripts/bake/spike-osm2world/02-inspect-glb.mjs`, `scene/buildings.ts:252`, `scene/enrichedBuildings.ts:561`) | 0 / 0 / 9 (unchanged) |
| `npx knip` | 0 issues | 0 issues, exit 0 |
| link probe (`linkcheck.py`, 2,364 references) | 104 unresolved, of which 4 real | 105 unresolved, 0 real (the 4 fixed; the rest are deliberate negations such as "there is no `public/wasm/`", gitignored transient files, Overpass QL, planned-but-never-built bestspot files, "moved from" notes quoting the old path, and frozen history in DECISIONS/ARCHIVE) |
| `npm audit` / `wix build` size | not run (docs session; no dependency or bundle change) | — |

Track E triage: no red at start or end. The link probe was proven able to fail (a fabricated markdown link, a fabricated `src/` path and a fabricated `mem:` reference were all reported before the real run).

## BEFORE → AFTER

| store | before | after | cap / rule |
|---|---|---|---|
| `DECISIONS.md` | 466,847 B; §Recent 437.0 KB / 895 lines | 69,668 B after the move (74,865 B once this session's own entry was appended); §Recent 27.0 KB (the T77 era, 15 entries, verbatim) + 12 new era digests | compaction trigger ~135 KB |
| `DECISIONS_ARCHIVE.md` | 500,079 B | 910,965 B (+ divider §Moved 2026-09-06 + the 410,237-B block) | receives the move |
| `mem:core` | 93,859 B | 12,259 B | ≤ 12,288 B |
| `patterns/sky-bodies-terrain` | 19,337 B | 15,338 B | ≤ 15,360 B |
| `project/wip-*` leaves over 10 KB | 17 (16 non-T77 + 1 T77) | 0 non-T77 leaves over cap (16 compacted, e.g. owner-3slice 16,033 → 10,226; chernobyl-region 12,479 → 7,284 with a region-deleted banner); the one T77 leaf over cap (13,083 B) is exempt by the brief | ≤ 10,240 B each; T77 leaves exempt |
| `tracked-backlog.md` | 98,072 B, T1–T87, 12 rows with 3 of 5 columns | 108,859 B, T1–T91, 91/91 rows with 5 columns | the ONE debt registry |
| `rendering/` bundle | 12 files, no entry point | 13 files: `README.md` (4,789 B) + 5 dated status banners | every bundle owns its entry point |
| `ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` | 33,220 / 28,586 B; no MESH / T77 / DBG / phone-harness content | 38,824 / 33,095 B; dated addenda §7d/§7e and "Tracks after Phase 8" | plan state = reality |
| `src/lib/guide/guideContent.ts` | 83,158 B; 12 chapters / 84 topics | 86,053 B; 12 chapters / 86 topics | lint: body ≤ 5 sentences, ≤ 6 steps; brand fence |

## Findings

Severity per `audit-mode.md`. Tier: local-tested = verified by a command or a grep in this session; UNVERIFIED = stated by an agent and not re-checked. Rows marked FIXED were changed this session; the rest are queued.

| ID | Track | Severity | Conf | Anchor | Finding | Specific fix | Violated ruling | Tier |
|---|---|---|---|---|---|---|---|---|
| D1-1 | D | MAJOR | 100 | `DECISIONS.md` §Recent (pre-move) | §Recent held 437 KB / 895 lines, 3× past the trigger; the append-marker had drifted below 14 entries for the fourth time | Round 5 executed: lines 365–1185 + 1195–1238 of the old file moved byte-identical to the archive (md5 `4260321dc13ba45b11c3de0bb5c8856e`, 865 lines / 410,237 B); marker re-seated under the heading; 12 digests appended. FIXED | T40; `memory_maintenance` compaction policy | local-tested (git diff: every removed dated line is in the archive block; 63 headings out, 0 in) |
| D2-1 | D | MAJOR | 100 | `mem:core` (old) | 93,859 B against a 12,288 B cap; three narrative blocks duplicated the wip leaves and DECISIONS; the Era index stopped at the T77 row so ~60 leaves were unreachable from the root | Rewritten to 12,260 B: Status, a 25-line T77 resume, 29 era rows (all 126 leaves reachable, machine-checked), the graph index, source layout re-derived from the tree. A 67-fact orphan sweep found 0 facts without another home. FIXED | `memory_maintenance` caps + graph-health policy | local-tested |
| D4-1 | D | MAJOR | 100 | `tracked-backlog.md` T59–T70 | Twelve rows shipped 2026-08-27 with 3 cells in a 5-column table: no Pointer, no State, for ten days | Columns reconstructed from the plan docs and code anchors, each dated "Columns added 2026-09-06". FIXED | checklist 12 (registry integrity) | local-tested (parser: 90/90 rows × 5 cells) |
| D5-1 | D | MAJOR | 100 | `guideContent.ts` topic `trust-accuracy` | Said building height edits "apply only in your browser"; false since MS3 shipped SYNC (2026-09-02f) and contradicted by `fpv-height` two chapters earlier | Rewritten: "in your browser alone until you press SYNC". FIXED | checklist 13 (guide copy is part of the feature) | local-tested (guide + brand tests 104/104) |
| D5-2 | D | MINOR | 100 | `guideContent.ts` | No topic covered the model upload caps and refusals (15 MB source, 8 MB packed, 2048→1024→512 texture ladder, 100k triangles auto-simplified; refused: > 25 meshes, > 8 textures, rigged/morphing, DRACO/KTX2) nor the G/R/S/E handle keys, ⇧ snap (1 m / 15° / 0.1×) and the lift caps (building 25 m, model 50 m) | Topics `model-limits` and `edit-handles` added; every number grepped from `modelCaps.ts`, `tuning.ts:2323`, `bldgOverrides.ts:93`, `modelPlacement.ts:67`, `StylizedTiles.ts:2755`. Two golden search rows added. FIXED | owner order (the guide gap) | local-tested |
| D3-1 | D | MAJOR | 99 | `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE.md` (pre-edit) | Neither doc named the MESH SUITE, `UserModels`/`BuildingOverrides`, the DBG window, T77 slice 0 or the phone harnesses; a Phase-0 read missed the last six tracks | Dated addenda: ARCHITECTURE §7d/§7e + §5 data-model note; plan "Tracks after Phase 8" with DECISIONS-verified states. FIXED | checklist 2, 7 | local-tested |
| D3-2 | D | MINOR | 95 | `rendering/RENDERING_ARCHITECTURE.md:300,367` | Named a DEV seam `__globe.debugSeats()` that never existed on `window.__globe`; the seam is `__globe.enrichedSeats()` (`StylizedTiles.ts:3390`) | Corrected in place with a dated note. FIXED | checklist 11 (contract inventory) | local-tested |
| D3-3 | D | MINOR | 90 | `bestspot/BESTSPOT_SPEC_V2.md` (lines ~158, 578/587, 629/668, 855, 1134), `BESTSPOT_PLAN.md:766,826` | Neither doc carried a banner for the 2026-08-26/27 sessions; four claims read the old way (colour = identity; `trackWeight.*` = reweigh; `verify-bestspot` 100 PASS; the tree rule and leaf counts) | Dated "read `README.md` first" banners on both. FIXED | one writer per fact | local-tested |
| D3-4 | D | MINOR | 90 | `.claude/conventions/architecture-and-patterns.md:96` | Said the mobile fence has "three rules"; rule 4 (no `autoFocus`/`.focus()` in `components/mobile/**`) has existed since 2026-08-22e (`mobileFence.test.ts:117`) | Dated correction appended. FIXED | checklist 3 | local-tested |
| D4-2 | D | MINOR | 100 | `NEXT_SESSION_PROMPT.md:37` (2026-09-06f version) | Claimed the guide had "126 topics"; the file holds 12 chapters / 86 topics (98 index nodes) | Brief rewritten this session with the measured count. FIXED | checklist 4 (volatile counts) | local-tested |
| D4-3 | D | MINOR | 90 | `tech_stack.md:25` · `wip-2026-08-02-comet-10p-tracer.md:60` · `engine-state-tracks-2026-09-02/track5-numbers.md:31` · `OSM2WORLD_EXPERIMENT_PREP.md:323` | Four real dangling references in live docs (a `public/wasm/` that never existed; `scene/comet.ts` never committed; a memory shorthand; a `public/enriched/` path moved to `bakes/` on 2026-08-13) | All four corrected with dated notes. FIXED | checklist 10 | local-tested |
| D2-2 | D | MINOR | 95 | `patterns/sky-bodies-terrain.md`, `patterns/globe-rendering.md`, other always-offered memories | Stale code facts (overlay resolution 256 vs 512 today; the pre-charter shadow gate and ortho box; `EARTH.termBand` as the whole twilight truth; a header claiming the shadow mechanics "remain accurate") | Ten SUPERSEDED / NOTE blocks added in place (never a deletion): system-overview (5 collections with field counts 30/26/17/29/9, 11 routes, three tile renderers + `PluxGlobeControls`), members-pins (field counts), globe-rendering (`StylizedTiles.ts` is 7,495 lines; `TERRAIN_SINK_M` gone; `zoomMinAltM` 2), sky-bodies-terrain (moon constants 0.5/2.9/0.12; view-fitted shadow box; angular horizon fade; `dayK`/`dayGradMin` are ULTRA-OFF truths; compacted 19,337 → 15,338 B), photo-frustum (terrain snap shipped 2026-07-10), design-system (drift is 0.066°/s; `controls/**` in the allow-list), ground-checkerboard-flicker (the `age<1` suspect no longer exists; live dither sites listed). FIXED | `memory_maintenance` (SUPERSEDED header, never a silent deletion) | local-static (grep/Read against `src/`; no runtime) |
| D3-5 | D | MINOR | 92 | `IMPLEMENTATION_PLAN.md:15,17,137`; `MOBILE_PLAN.md:86`; `UPLIFT_PLAN.md` §1.5; `MESH_SUITE_PLAN.md` §11; `FORMAL_VERIFICATION.md` §5; `DNIPRO_3D_ENRICHMENT_PLAN.md:45`; `T77_AUDIT_PLAN:152`; `bestspot/README.md` | 13 stale pending-tags (of 153 hits, 73 are historical record and 43 research-confidence tags) | Each given a dated resolution after checking the DECISIONS snapshot or the code. FIXED | checklist 5 | local-tested |
| D3-6 | A | MINOR | 85 | `src/components/globe/scene/pluxGlobeControls.ts:50,115` | Two docstrings name `__globe.belowCameraGate(false)`; the real seam is `__globe.controls.belowCameraGate(enabled?)` (`contracts.md:68`); a harness copying the docstring gets a TypeError | One-line docstring fix in the first T77 session (outside this session's fence) | checklist 11 | grep-verified |
| D3-7 | D | MINOR | 90 | `.claude/conventions/globe-tuning.md` §ULTRA | Names none of the 2026-08-27 dusk/ULTRA tunables (`keyExtinctCurve`, `skyLevelCurve`, `afterglowCurve`, `GOLDEN.keyBrighten`, `ULTRA.cascades`) | Extend §ULTRA in the next docs slice; recorded in T40's still-open sub-item | checklist 3 | UNVERIFIED (E3 grep) |
| D4-4 | D | MINOR | 100 | `README.md:57,99,180,209` | Public README: test count 1,902 / 130 files (head is 2,463 / 164, dated 2026-08-24) and two undated copies of the pin quota | Outside this session's write set; refresh in the next session that touches the README | checklist 4 | local-tested |
| D4-5 | D | NIT | 100 | `NEXT_SESSION_PROMPT.md` (2026-09-06f) "RC16 residual straddler duplicate" | Carried as an open tail but described nowhere else (not in T54, not in the archive) | Found in the 2026-08-26d entry (archive): row T91 added with the numbers | checklist 12 | local-tested |
| D4-6 | D | NIT | 100 | `scripts/bake/README.md:208` | Says the local Chernobyl bakes were deleted; 135.8 MB is still on disk (the owner removes them by hand) | `scripts/` is read-only this session; a dated note in the next bake session | checklist 9 | UNVERIFIED (E2 report) |
| D2-3 | D | NIT | 100 | `mem:memory_maintenance` §Graph-health | The 12 KB core cap leaves 28 bytes of slack for 29 era rows; the next era cannot be added without trimming | Raise the core cap to 16 KB or move the Era index into its own memory — owner/maintainer call, not taken here | policy | local-tested |

## Verified clean

- DECISIONS append-only: `git diff -U0` on DECISIONS shows 878 removed lines; 867 are the moved block (every one present verbatim in the archive's §Moved 2026-09-06 block), 7 are the marker (re-seated, present in the additions) and 4 the old sentinel (replaced). No dated line was edited.
- `mem:` references: every `mem:` reference in the new `core.md` resolves (probe proven to fail on `mem:nope/x`); the memory-wide probe `memrefs.sh` (proven to fail on a fake reference; it also caught a POSIX bracket bug in itself first) reports 221 references, 0 unresolved.
- Conventions `globe-tuning.md` + `contracts.md` (D3): 26 + 38 cited paths resolve; 271 + 72 backticked identifiers exist in the code (three are `node_modules` symbols or prose placeholders, hand-checked); the 28-seam `window.__globe` count re-verified against `src/global.d.ts`; `#p=`/`#f=`/`&t=` grammars and the four newest DEV seams are already in `contracts.md`.
- Plan checkboxes (checklist 7): no box needed ticking; the two open Phase-8 boxes are honestly open (P8 conjunctions; ambience beyond the local eclipse half).
- Scope guard (checklist 8): clean, see Verdict.
- Guide tests: `npx vitest run test/lib/guide test/brandFence.test.ts test/components/guideParity.test.ts test/pages/guideAstroShape.test.ts` → 6 files, 104 tests, all passed. The alias fence caught one real regression on the first run (an orphaned `trust-accuracy:"model"` alias), fixed by retargeting it.
- Delegated affordances (checklist 13): 2 hits; `featureTransform.ts:35` matches the guide; `bldgOverrides.ts:89` delegated the building lift to the guide, which had no such text — now covered by `edit-handles`.
- Volatile counts (checklist 4) inside `.claude/claude-docs/`: per-slice `vitest N/N` receipts are ship records, not restated counts; the one wrong count (126 topics) was in the brief and is fixed.
- Audit purity: `git status` — no diff under `src/` except `src/lib/guide/guideContent.ts`; none under `scripts/`, `tools/`; `test/` only `test/lib/guide/guideSearchGolden.test.ts`.

## Pre-existing / out-of-scope

- `verify-pin-reframe` RED (T76, environment-shaped) and the iPhone FPV death (T83) are T77 items, untouched.
- `provenance/` has no README (its two files are indexed by name in `CLAUDE.md`); left deliberately.
- `GUIDE_FINALIZATION_PLAN.md` carries two live open items (SURF-12 prerender under the Wix adapter UNVERIFIED; the BANNED-regex question) and 2026-08-22 counts (67 topics / 46,380 B) that read as present tense — a dated banner is the fix; not applied, the plan is a closed-era doc.
- `README.md` (repo root) was outside the write set; see D4-4.

## Backlog status changes

- T40: compaction sub-item CLOSED with the round-5 line (md5, 865 lines / 410,237 B); still open: `globe-tuning.md` currency (now including the 2026-08-27 ULTRA tunables) and the guide re-shoots.
- T59–T70: Pointer + State columns reconstructed (dated). T77: PARKED 2026-09-06f with the resume point. T78: CLOSED made explicit. T80: OPEN, blocked on the owner's ruling. T56/T57: superseded by T75 (Chernobyl deleted). T1, T29, T31, T42, T46, T47, T50, T51, T52: PARKED notes added. T2: durable pointer named.
- New rows: T88 (RC7 look-cone convergence 50.3 % vs the 0.9 bar), T89 (RC9 warm-restore leg browser-unverified), T90 (`readiness` never advances after POST). Header re-stated: T1–T91, 12 CLOSED, 13 settled, 66 OPEN of which 18 PARKED. T91 (the RC16 residual straddler duplicate) was added by the main agent once the 2026-08-26d archive entry supplied its description.
- T87 (this sweep): the "130 leaves" figure is 126; corrected in the brief.

## Fitness scorecard

| promise | proxy | value |
|---|---|---|
| geo-accuracy | projection / ephemeris / geodesy vitest | 2,463/2,463 green (unchanged this session) |
| beauty | dated shots | unmeasured this session (docs only) |
| perf | T77 receipt 2026-09-06e | orbit dt 18.1 ms, cpu 1.2 at high on the M3 Pro; phones 9–13 fps at orbit before T79 (T79 unmeasured on a phone) |
| privacy C6 | probes | unmeasured this session; no code change |
| docs currency | stale-tag count in `.claude/claude-docs/` outside DECISIONS / the brief / reports | 153 hits → 18 live status tags, 13 re-dated, 5 still true and left (Esri ToS, Phase 7 ×2, P8+M4, the stalled-boot cause) |
| memory graph | root size · leaf reachability · over-cap leaves | 12,260 B · 126/126 · 0 over-cap leaves outside the T77 exemption |

## Proposed convention / checklist amendments

- `checklists/docs.md` item 12 (registry integrity): add "every row has all 5 cells" as a machine check — the T59–T70 hole survived two audits because the check read states, not shape. (Pesticide-Paradox harvest, dated 2026-09-06.)
- `checklists/docs.md` item 4: a topic/leaf/test COUNT quoted in a brief must be measured in the same session, not carried forward ("126 topics" was never true).
- `memory_maintenance`: decide the core cap (12 → 16 KB) or split the Era index before the next era lands (D2-3).
- `audit-mode.md` Track E: the link probe (`linkcheck.py`, stdlib, proven to fail) is worth keeping under `scripts/` in a later slice so every audit runs the same one.

## Fix-session slicing

1. **S — first T77 session, five minutes:** the two `pluxGlobeControls.ts` docstrings (D3-6). Gate: `astro check`.
2. **S — next docs slice:** `globe-tuning.md` §ULTRA + the 2026-08-27 tunables (D3-7); `README.md` counts + quota pointers (D4-4); a dated banner on `GUIDE_FINALIZATION_PLAN.md`; `scripts/bake/README.md:208` (D4-6). Gate: link probe + `npm test`.
3. **S — owner call:** the core cap (D2-3) — 16 KB, or an `era-index` memory.
4. **M — later:** the guide re-shoots (T40's last open sub-item) and `media` shots for the two new topics (`shoot-guide.mjs` + `warm-prod-assets.mjs`).
