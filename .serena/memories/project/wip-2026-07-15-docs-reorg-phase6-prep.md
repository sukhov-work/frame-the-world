# WIP 2026-07-15 — claude-docs reorg + Phase 6 runway (DONE)

Mode: implement/Standard via `/frame` + investigate-design-v3. Docs/ops only — no runtime code
changed (comment-line path updates only). Gates re-run clean: **astro check 0 err/0 warn ·
vitest 548/548**. Confidence: high (mechanical moves + grep-verified references + green gates).

## What changed
1. **claude-docs layout** (git mv, content byte-identical). Root keeps ONLY:
   `ARCHITECTURE.md · DECISIONS.md · DECISIONS_ARCHIVE.md · IMPLEMENTATION_PLAN.md ·
   NEXT_SESSION_PROMPT.md · PROJECT_SEED.md`. Subfolders:
   - `provenance/` — DEEP_RESEARCH.md · CLAUDE_DESIGN_MEMO.md
   - `dnipro-enrichment/` — DNIPRO_3D_ENRICHMENT_{PLAN,RESEARCH_PROMPT,RESEARCH_RESULTS}.md ·
     DNIPRO_SLICE0_SPIKE.md · OSM2WORLD_EXPERIMENT_PREP.md
   - `rendering/` — RENDERING_QUALITY_PASS.md
   - `archive/` — PHASE_5_5_UX_BATCH.md · ARCHITECTURE_REVIEW.md · B19_HANDOFF.md (all complete)
2. **References updated repo-wide** (37 files): both `claude-docs/X` path-qualified and bare
   doc-name forms, across src/scripts/test code comments, `scripts/bake/README.md`, README.md,
   `.claude/CLAUDE.md`, `.claude/conventions/*`, `src/styles/tokens.css`, and `.serena/memories/*`.
   **EXCEPTION by policy: DECISIONS.md Recent-sessions verbatim text + DECISIONS_ARCHIVE.md were NOT
   edited (append-only invariant)** — old lines may carry pre-move paths; the 2026-07-15 DECISIONS
   line holds the authoritative old→new map.
3. **NEXT_SESSION_PROMPT.md rewritten** (was ~460 lines of stacked shipped handovers → a Phase-6
   brief): Phase 6 scope/DoD/pre-reads, open questions (catalog v3-vs-v1 via Wix MCP; whether
   checkout needs site-installed apps), carried tails (BLD-chip owner A/B, HLOD, dayArcs fold,
   WS4-D shadow timeline, GTAO/weak-box, release gate /api/ping → wix release → README URL,
   mobile/sub-M3 passes, watch items), docs map, dev pointers.
4. **ARCHITECTURE.md refreshed** to as-built 2026-07-15: §2 additions (CWT terrain, enriched R2
   tileset + mask + per-building seating, vector web, quality tiers), §4 planner, §5 authorName +
   C6 cell-centre, §7 full module lists + `scripts/bake/`, §9 risk register.
5. **IMPLEMENTATION_PLAN.md refreshed**: Phase 5.5 ☑; NEW "Interlude 2026-07-12→14" ledger
   (S7 feedback, README, rendering passes 1–3, illumination, Dnipro slices 0–3+5, R2 hosting,
   OSM2World variant, owner UX batches — one line + memory pointer each); Phase 6 marked NEXT;
   empirical-validation statuses trued up (phone decode benchmark still carried).

## Where things stand
Phases 1–5.5 + interlude ALL shipped/verified. **NEXT = Phase 6 marketplace-light** — read
IMPLEMENTATION_PLAN §Phase 6 + NEXT_SESSION_PROMPT.md. Live URL still serves Phase 5 (release
gate carried). wix dev NOT running.

## Gotchas from this session
- Bare doc-name references ("DNIPRO_SLICE0_SPIKE.md §Recipe") existed alongside path-qualified
  ones — a rename must rewrite BOTH forms, ordered path-first so the bare pass (negative
  lookbehind on `/`) doesn't double-prefix.
- Workstream labels without `.md` (e.g. "RENDERING_QUALITY_PASS WS1" in tuning.ts) are labels,
  not paths — deliberately untouched.
