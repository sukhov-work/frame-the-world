# AUDIT #2 charter — whole-project expansion-readiness (owner order 2026-08-18j)

**Status: DONE 2026-08-18k — ran as chartered; report `audits/audit-full-2026-08-18.md`, log [[project/wip-2026-08-18-audit2]]; 8 fix slices queued. The UPLIFT ladder is PARKED until this
audit/refactor/improve intermediate phase ends** (durable parked-state twin: UPLIFT_PLAN
status block + DECISIONS 2026-08-18j; resume order U6 foveation → U7 terrain → U8 heights →
P8/P9 → M4; T1 real-device gate unchanged).

## Owner intent (binding scope)
Verify readiness for further expansion on FOUR dimensions — documentation, organization,
architecture, code quality. NOT refactoring for refactoring's sake: only evidence-supported
optimize/change/prune. Also: which conventions/tips/caveats/gotchas to add or update; which
memories to refactor; which session hooks + guardrails would help (skill, docs, CLAUDE.md).

## How
/frame AUDIT mode, tier Deep, READ-ONLY on src/+docs (report → sliced fix sessions).
Machinery: skills/frame/references/audit-mode.md + checklists + review-agent +
audit-report-template + tracked-backlog (T1–T27: VERIFY rows, never re-discover).
Baseline anchor: audits/audit-full-2026-08-13.md (31 DECISIONS entries since).
Workflow step 2 re-mine — fold the fresh traps into checklists FIRST: panel-mirror-never-seat ·
focus-lock-overrides-_focus · stale-9222-Chrome · 0.4.28 traversal/internal fields +
return-1-runs-first comparator · evaluate-post-load.

## Owner dimensions → tracks
1. **Code growth (A):** StylizedTiles 3,833 lines / 41 step-closures — extraction seams (FPV,
   zoom bank, anchor rules, quality fan-out, DEV seams)? U5's lru/caps/probe idiom ×3 tile
   modules — extract vs Gall's-law restraint (named strangler seam required). 13 stores.
   tuning 2,287 by design — verify roster convention.
2. **Docs (D):** DECISIONS compaction round 3 due (660 lines, 31/5 days) · ARCHITECTURE §7
   STALE (2026-08-15, pre-U1..U5) · era-closed plans → archive? (MOBILE/PLANNING_QOL) ·
   conventions promotions from traps · contracts.md §3 currency (u5 seams new).
3. **Memories (D):** 100 total, 75 project/ wip-* — recall-path audit (what does a fresh
   session actually read?), per-era consolidation policy, stale patterns/bugs entries.
4. **Harness (NEW F):** hooks/scripts/guardrails proposals — 9222-checking CDP launcher ·
   verify-recipe as script (recipe currently lives ONLY in the gitignored prompt!) · boot
   checks · lint guards (touch-action precedent) · CLAUDE.md/skill staleness. Propose only.
5. **Mechanical (E, first):** gates · astro-hints triage (baseline 5) · bundle vs 33 MB ·
   knip/depcheck/ts-prune/jscpd (probe availability) · npm audit · unused public/.
6. **Platform+tests (B, C):** standard checklists; C6 sweep; re-affirm or revisit the
   "scene modules untested by design" ruling EXPLICITLY.

## Seed inventory (2026-08-18)
src 43,810 lines · top: StylizedTiles 3,833, tuning 2,287, comets 991, guideContent 833,
enrichedBuildings 740, targets 702, PhotoDetailPanel 686 · tests 86 files/989 · docs:
DECISIONS 660 + ARCHIVE 747, UPLIFT 426, MOBILE 337, QOL 329, IMPL 293, ARCH 170 ·
conventions 7 files/553 · memories 100 (75 project/) · bundle baseline 33 MB (2026-08-13).

Deliverable: audits/audit-full-2026-08-18.md + sliced fix/improve plan.

Related: [[project/wip-2026-08-13-full-audit-1]] (audit #1) · [[core]] ·
[[project/wip-2026-08-18-u5-loading]] · [[project/wip-2026-08-18-u4-aim-cones]].
