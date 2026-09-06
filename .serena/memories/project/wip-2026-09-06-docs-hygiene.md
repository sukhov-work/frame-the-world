# wip 2026-09-06g — docs + memory hygiene sweep (DONE)
Owner order 2026-09-06f, one session, `/frame` Audit with a write fence (claude-docs · memories · conventions · frame references · `src/lib/guide/guideContent.ts` + its tests). Report: `.claude/claude-docs/audits/audit-docs-hygiene-2026-09-06.md`. DECISIONS 2026-09-06g. Ten opus subagents (5 digest writers, D2a core, D2b leaves, D3 docs, D4 backlog + link probe, D5 guide); the main agent did the DECISIONS move, verification and the report.

## What changed (numbers)
- **DECISIONS compaction round 5 (T40):** verbatim 2026-08-21 → 2026-09-05 (through MESH SUITE MS8) → `DECISIONS_ARCHIVE.md` §Moved 2026-09-06, **md5 `4260321dc13ba45b11c3de0bb5c8856e`, 865 lines / 410,237 B** (two spans of the old file, lines 365–1185 + 1195–1238, because the append-marker sat between them). 12 era digests appended to §Per-phase digests. Marker re-seated under the §Recent heading (4th drift). DECISIONS 466,847 → 69,668 B; §Recent 437.0 → 27.0 KB. T77 era (2026-09-05b →) stays verbatim.
- **`mem:core`** 93,859 → 12,259 B: status, a 25-line T77 resume, 29 era rows (126/126 wip leaves reachable, machine-checked), graph index, source layout re-derived. A 67-fact orphan sweep found 0 facts without another home.
- **Leaves:** 16 over-cap `project/wip-*` compacted to ≤ 10,240 B (first line says `compacted 2026-09-06 from N B; verbatim history: …`); `patterns/sky-bodies-terrain` 19,337 → 15,338 B; 10 SUPERSEDED / NOTE blocks in always-offered memories (5 collections / 11 routes; `StylizedTiles.ts` 7,495 lines; `TERRAIN_SINK_M` gone; moon constants 0.5/2.9/0.12; the checkerboard bug's `age<1` suspect no longer exists). `memrefs.sh`: 221 `mem:` refs, 0 unresolved.
- **Backlog:** T59–T70 had shipped 2026-08-27 with 3 of 5 columns — Pointer + State reconstructed; 22 dated state edits; T88–T91 added (RC7 convergence, RC9 warm-restore, `readiness` stall, RC16 residual); T40 round-5 close; header T1–T91.
- **Docs:** `rendering/README.md` (entry point + T77 read order), `audits/README.md`, `archive/README.md`, `dnipro-enrichment/README.md` new; 5 dated banners in `rendering/`; ARCHITECTURE §7d/§7e + §5 note; plan "Tracks after Phase 8"; 13 stale pending-tags re-dated; `RENDERING_ARCHITECTURE.md` seam name fixed (`__globe.enrichedSeats()`, not `debugSeats`); BEST SPOT spec + plan banners; `architecture-and-patterns.md` rule-4 note; 4 real dangling refs fixed (`tech_stack:25`, comet leaf, track5, o2w prep).
- **Guide:** +2 topics `model-limits`, `edit-handles`; `trust-accuracy` false claim fixed (edits are browser-only only until SYNC); 12 chapters / 84 → 86 topics; 104 guide tests green. The brief's "126 topics" was wrong.
- Gates end: vitest 2,465/2,465 (164 files) · astro 0/0/9 · knip 0.

## Left for later (all in the report §Fix-session slicing)
`pluxGlobeControls.ts:50,115` docstrings name the wrong seam path (first T77 session) · `globe-tuning.md` §ULTRA lacks the 2026-08-27 tunables · `README.md` test count 1,902 → 2,465 + undated quota copies · `GUIDE_FINALIZATION_PLAN.md` banner · `scripts/bake/README.md:208` · the core cap (29 B of slack under 12 KB — raise to 16 KB or split the Era index; owner call).

## Traps met
- A move script's line-number asserts must be re-derived from the CURRENT file, not the brief (the header paragraph ended on line 23, not 22 — the assert saved the file).
- Sub-agents cannot always write a report file (one harness blocked it); ask for the report in the final message too.
- A stale tail nobody can describe is usually in the ARCHIVE under the compaction that moved it (RC16's residual was in 2026-08-26d).
- zsh: `--include=*.md` unquoted fails with "no matches found"; `${PIPESTATUS[0]}` is bash — use `$pipestatus[1]` or run the command alone for the exit code.
