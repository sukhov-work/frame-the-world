# WIP 2026-08-27 — BEST SPOT PARKED, and the whole effort consolidated into one directory

Owner order: *"lets stop with that for now, consolidate your findings, update, merge if needed and
group everything best spot (aka heatmap) relevant in `.claude/claude-docs/bestspot`… make sure we can
easily continue if I will have more bugs or decide to proceed with sweep attempts."*

**ENTRY POINT FOR EVERYTHING BEST SPOT IS NOW `.claude/claude-docs/bestspot/README.md`.**
Predecessor: [[project/wip-2026-08-26-gate-star-floor]].

## GATES
vitest **2,144/2,144 (141 files)** · `astro check` 0 err / 0 warn / 6 hints · `npx knip` exit-0.
No `src/**` behaviour change — one docstring added, one script header banner. Tier LOCAL.

## WHAT THE BUNDLE IS
`.claude/claude-docs/bestspot/` — 8 files, was 2:
- **`README.md` (NEW)** — index · the ONE open owner decision · **the session-label collision table**
  · the diagnosis in five measured facts · the resume ladder · the code entry points + dev seams +
  scripts · known-red/known-wrong · what shipped inert · the memory trail.
- **`TRAPS.md` (NEW)** — every trap paid for in session time, **rescued out of gitignored
  `NEXT_SESSION_PROMPT.md`** and out of single `wip-*` memories `mem:core` never indexed.
- **`MEASUREMENTS.md` (NEW)** — every browser-measured number transcribed, **because
  `verify-shots/` is gitignored (`.gitignore:38`) and none of it can be re-derived offline.**
  Both probe sessions' full arm tables, the track-cost table, the worldwide window spans,
  the ceiling arithmetic, and a cross-run variance section.
- `BESTSPOT_SPEC_V2.md` · `BESTSPOT_PLAN.md` · `BESTSPOT_TASTE_V1.md` — **moved** from
  `claude-docs/` via `git mv`. **NOT renamed** — 76 bare-filename citations in `src/`+`test/` file
  headers cite them by name, and ~100 code citations point at `SPEC_V2 §x.y` anchors.
- `SWEEP_MODE_MAP.md` · `SWEEP_MODE_SCHEDULE.md` — **banners added**, not rewritten.

## THE DECISION THAT SHAPED IT: BANNER, DON'T MERGE
Merging the superseded docs would have destroyed the *narrative of how the diagnosis evolved* — which
is the most valuable thing in them, because each pass measured the previous one wrong. Instead each
doc got a **⚠ banner naming exactly what SURVIVES and what is DEAD, by section number**, verified by
a fan-out rather than repeated from memory:
- **`SWEEP_MODE_MAP.md`**: SLICE 2 (F_peak) survives **verbatim** with its five kernel traps, C1's
  buffer ruling, C4/N6's own-argmax, N3/N4, C11/N15, assumptions 3/5/9, §6's "no golden statistic is
  a function of tree geometry", §7 items 8+11. DEAD: the premise, §7's ranking, the DEVIATION note,
  slice 3a entire, 3b's mode/toggle, slice 4, §5.A's sizing, R3, §4's "report only" framing, §1.1's
  field table, §7-as-open-question, the drifted line citations.
- **`SWEEP_MODE_SCHEDULE.md`**: **§2 parity contract** (13 exact surfaces, `toBeCloseTo` banned,
  fixtures A–G), **§4 Lean decision + hypothesis audit** (its three unenforced-bound defects are
  **STILL LIVE IN THE TREE**), C-8's three script defects, C-1's hash host, C-3, C-4's memory pins,
  §5's browser traps, §6's D1–D4, §8 item 7. DEAD: the seven-session plan, §3's waves, §6's delta.
- **`BESTSPOT_TASTE_V1.md`**: read-order banner. **Its §5 ordering is measured FALSE** and was the
  premise of both sweep docs. Still true: §2's mechanism, **§1.4 (the shortlist IS faithful — 89.8 %
  within 25 m, so more markers would never have found his spot)**, §1.1/§1.3 (the field is flat),
  §3 (`F_gap` is the exact dual of an apex shot), the ephemeris agreeing to 20 s.

## THE FIVE GAPS A COMPLETENESS CRITIC FOUND, ALL CLOSED
1. **`mem:core` was the most misleading artifact in the repo** — said BEST SPOT FEATURE-COMPLETE with
   `verify-bestspot` **100 PASS / 0 FAIL** (actual **96/101**), indexed **none** of the five
   2026-08-26 memories or three of the docs, and pointed NEXT at a taste pass whose four named
   targets were **measured inert on the reported bug**. Rewritten: §Subsystems, §Prior state and the
   NEXT block now say PARKED, name the two false claims explicitly, and point at the bundle.
2. **`verify-bestspot.mjs` carried no known-red banner** — a resumer reads 96/101 as their own
   regression. Header now states the D8 cause, "do not loosen the thresholds", the noisy-objective
   warning, the never-re-derive-against-the-planner rule, and the two latent `[0]` crashes.
3. **The open owner question lived only in uncommitted + gitignored files.** Now `README.md` §1, a
   docstring at the constant in `bestSpotScoring.ts`, and backlog **T59**.
4. **`tracked-backlog.md` T49 was actively wrong** — re-scoped: its four named targets were measured
   inert, the leaf count is 55 not 54, and "every one is a recompose" is false (zero `reweigh` leaves
   remain; `topAltDeg` is `resweep`). Added **T59** (owner call) **T60** (F_peak) **T61** (D8 +
   crashes) **T62** (planner missing the monument) **T63** (`L` saturates) **T64** (three unenforced
   bounds).
5. **Traps that would die with the next session** — `NEXT_SESSION_PROMPT.md` is gitignored with **no
   git history**. Four traps existed nowhere else (shoulders must follow the budgeted edge;
   `finishVerify` swallows the throw; the 504 remedy's *curl-does-not-warm* step; orchestrator state
   above the ephemeris seam), plus three only in `wip-2026-08-26-bestspot-ownerbatch`. All in
   `TRAPS.md` now.

## THE REFERENCE MOVE — 19 path-qualified breaks, all handled
Bare-filename citations (76) survive a move; path-qualified ones do not. Rewritten: 7 in
`src/**`+`src/styles/**`, 1 in `BESTSPOT_PLAN.md`, 3 doc-delta rows in `SWEEP_MODE_SCHEDULE.md`,
1 in `NEXT_SESSION_PROMPT.md`, and **6 Serena memories via `edit_memory`, never a filesystem sed**.
**Deliberately NOT rewritten, and each says why in place:**
- **`DECISIONS.md`:409 and :533** — append-only history; it never edits the past.
- **`SWEEP_MODE_SCHEDULE.md`:105/108** — a **verbatim `git status --short` transcript** from
  2026-08-26g. Rewriting it would falsify evidence. Annotated with a `# NOTE 2026-08-27` block so
  nobody "fixes" it later.
Also updated the two index surfaces that are bare (so a path sweep misses them) but point a reader
at the wrong directory: `.claude/CLAUDE.md` §Knowledge search order (now names the per-subsystem
bundles) and `ARCHITECTURE.md` §7c.

**Pre-existing and NOT fixed (out of scope, flag for a docs audit):** seven other `.claude/claude-docs/*.md`
paths in live docs are stale from EARLIER moves — `B19_HANDOFF`, `DEMO_CONTENT_SEED`,
`PHASE_5_5_UX_BATCH`, `UXBATCH4_PLAN`, `DNIPRO_SLICE0_SPIKE` (→ `archive/`),
`RENDERING_QUALITY_PASS` (→ `rendering/`), `OSM2WORLD_EXPERIMENT_PREP` (→ `dnipro-enrichment/`).
`.claude/skills/frame/references/checklists/docs.md:60` is the machine check that catches these.

## TRAP FOUND WHILE DOING IT
**Serena `edit_memory` takes `memory_name` (not `memory_file_name`), `needle`/`repl`, and
`mode: "literal" | "regex"`** — `"regex_replace"` is rejected. Multiple hits need
`allow_multiple_occurrences: true`. And the memory body must be matched EXACTLY as stored, so read it
first rather than trusting an earlier read that predates another edit.

## METHOD
An 8-agent workflow: 5 doc mappers (one per document, each returning structure / stillLive /
supersededOrDead / citedAnchors, every claim citing a section), a shipped-state auditor, an
exhaustive reference auditor with zero-result validation, and a completeness critic prompted with
*"what will a resumer be unable to find, or be actively misled by?"* — the critic is what found gaps
1–5. 942k subagent tokens, 195 tool calls, ~36 min.

Related: [[project/wip-2026-08-26-gate-star-floor]] · [[project/wip-2026-08-26-bestspot-taste]] ·
[[project/wip-2026-08-26-sweep-mode]] · [[project/wip-2026-08-26-sweep-schedule]] ·
[[project/wip-2026-08-26-bestspot-ownerbatch]] · [[project/wip-2026-08-24-bestspot-s3-s7]] ·
[[project/wip-2026-08-23-bestspot-heatmap]] · [[decisions/session_workflow]]
