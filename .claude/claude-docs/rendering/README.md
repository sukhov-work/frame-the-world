# rendering/ — the bundle entry point (2026-09-06)

Three things live here. **The rendering architecture as built** — how a frame is made, what ULTRA
turns on, which knobs exist (`RENDERING_ARCHITECTURE.md`, `ULTRA_ARCHITECTURE.md`). **The rendering
charter** — the 2026-08-25 execution ladder that produced most of that architecture, now closed
(`RENDERING_CHARTER_2026-08-25.md` and the FPV audit it consolidated). **The T77 performance audit**
— the open track as of 2026-09-06: the engine-state report, the independent web survey, the
reconciled lever plan, the measured baseline (desktop + two phones), and the slice files
(`T77_*`, `MEASUREMENTS_*`, `ENGINE_STATE_*`, `WEB_RESEARCH_*`, `IPHONE_BASELINE_CHECKLIST_*`).
Nothing here is binding on scope; `PROJECT_SEED.md` §3/§4 still is.

| File | Date | What it is | Status |
|---|---|---|---|
| `RENDERING_ARCHITECTURE.md` | 2026-08-26 | As-built rendering reference: frame journey, then per-module knobs and seams | CURRENT — the durable reference |
| `ULTRA_ARCHITECTURE.md` | 2026-08-22j, §13–§14 appended 2026-08-27 | ULTRA as built: nine levers, the gate, the off-state contract | CURRENT — the durable ULTRA reference |
| `ENGINE_STATE_2026-09-02.md` | 2026-09-02 | The whole engine as-is: system map, subsystem cards, gaps, the §8 non-regression contract | CURRENT — T77's as-is baseline |
| `engine-state-tracks-2026-09-02/` | 2026-09-02 | Six verbatim research-track reports behind ENGINE_STATE (own README) | CURRENT — evidence chain only |
| `WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05.md` | 2026-09-05 | Independent survey of the state of the art: 24 ranked levers, Rq-1..17, a do-not-do list | CURRENT — T77's outside view |
| `T77_AUDIT_PLAN_2026-09-05.md` | 2026-09-05, pointer 2026-09-06f | The reconciled T77 lever ledger and measurement protocol | CURRENT — but its §1/§4 ranking is superseded by `MEASUREMENTS_2026-09-05.md` §12 |
| `MEASUREMENTS_2026-09-05.md` | 2026-09-05, §11 rewritten 2026-09-06 | The measured baseline: desktop matrix, shadow/bloom cost, CPU profile, both phones, slice order | CURRENT — the numbers T77 argues from |
| `T77_SLICE0_ORBIT_FRAME_2026-09-06.md` | 2026-09-06 | Slice 0 / T79 as built: the below-camera raycast gate, its exactness argument, the receipt | CURRENT — slice 0's T79 half; T80 bloom not in it |
| `IPHONE_BASELINE_CHECKLIST_2026-09-05.md` | 2026-09-05, §B0 2026-09-06 | The phone measurement recipe (§A prep, §B the 35-minute pass, §D/§D2 the farm and adb harnesses) | DONE for §A/§B — results in `MEASUREMENTS_2026-09-05.md` §11; §C gates and §E unknowns still open; the operational harness doc is `tools/devicefarm/README.md` |
| `WEB_RESEARCH_PROMPT_2026-09-02.md` | 2026-09-02 | The self-contained prompt handed to web Claude for the survey | DONE — the result is `WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05.md` |
| `RENDERING_CHARTER_2026-08-25.md` | 2026-08-25 | The execution charter: reconciled audit state, four owner bugs, the RC ladder, the do-not-do list | DONE — closed 2026-08-26d (DECISIONS); the as-built is `RENDERING_ARCHITECTURE.md`; §4 owner A/B queue and §6 do-not-do still stand |
| `FPV_FIDELITY_AUDIT_2026-08-22.md` | 2026-08-22 | Read-only FPV far-field research: 43 of 58 gaps survived refutation, nothing implemented | PARTLY SUPERSEDED — gap statuses and line anchors by `RENDERING_CHARTER_2026-08-25.md` §1, the §2 "what we already do" tables by `RENDERING_ARCHITECTURE.md`; its §4 refuted list is still the do-not-re-discover reference |
| `RENDERING_QUALITY_PASS.md` | 2026-07-12 | The first rendering design investigation (adaptive quality keystone + four workstreams) | SUPERSEDED by `RENDERING_ARCHITECTURE.md` (as built) and `RENDERING_CHARTER_2026-08-25.md` (execution); kept as provenance |

## Read order for a T77 session

1. `T77_AUDIT_PLAN_2026-09-05.md` — the dated pointer block at the very top says which step and
   slice are done, what is blocked on an owner call, and the resume recipe. Read that block before
   the plan body.
2. `MEASUREMENTS_2026-09-05.md` §0 (the nine readings) and §12 (the slice order, which supersedes
   the plan's §1/§4 ranking).
3. The slice files for whatever already shipped — as of 2026-09-06 that is
   `T77_SLICE0_ORBIT_FRAME_2026-09-06.md` (T79, the below-camera gate).
4. `ENGINE_STATE_2026-09-02.md` §8 — the non-regression contract and the harness list every slice
   re-runs in full.

Then the outside view (`WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05.md`) for a lever's sources, and
`RENDERING_ARCHITECTURE.md` / `ULTRA_ARCHITECTURE.md` for the module you are about to touch.
Tunable names and their contract live in `.claude/conventions/globe-tuning.md`; the DEV seams in
`.claude/conventions/contracts.md` §3.
