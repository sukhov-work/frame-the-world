# audits/ — the whole-repo audit reports (index, 2026-09-06)

Each file is one `/frame` Audit run: read-only, parallel finder tracks, every candidate finding
re-verified against the cited code or doc before it was written down. They are historical records —
a finding's fix, if it shipped, is in `DECISIONS.md` under the session that followed. Newest first.
**Never edit a report in place**; a later audit supersedes an earlier one by saying so.

| Report | Date | Scope | Baseline it audited against |
|---|---|---|---|
| `audit-docs-hygiene-2026-09-06.md` | 2026-09-06 | Docs + memory hygiene sweep, owner-ordered, with a WRITE fence (claude-docs, memories, conventions, frame references, the guide content): Tracks D + E + the guide gap. DECISIONS compaction round 5, `mem:core` 94 → 12 KB, backlog repair, four bundle READMEs, two guide topics | DECISIONS 2026-09-06f; prior report `audit-batchseams-2026-08-22.md` |
| `audit-batchseams-2026-08-22.md` | 2026-08-22 | Audit #3, owner-scoped: batch seams #4–#7 + the QA slice + the 2026-08-22 micro-slice. Tracks A1 (radar/aim/MapWindow/chrome) · A2 (orchestrator/render/platform-lite/debris) · C (tests + harness) · D (docs/memory/conventions) · E (mechanical) | DECISIONS 2026-08-19 → 2026-08-22b; prior report `audit-full-2026-08-18.md` |
| `audit-full-2026-08-18.md` | 2026-08-18 | Audit #2, full: whole-project expansion-readiness before the UPLIFT ladder resumed. Tracks A (code/engine) · B (platform) · C (tests/math) · D (docs/memory) | `audit-full-2026-08-13.md` + DECISIONS 2026-08-13 |
| `audit-full-2026-08-13.md` | 2026-08-13 | Audit #1, the first full-repo audit: owner-ordered hygiene gate before Phase 8a / M1. Same four tracks | DECISIONS 2026-08-13 (planning-core restructure + M0) |

The audit engine itself — modes, track checklists, the finding format — lives in
`.claude/skills/frame/references/audit-mode.md` and `references/checklists/*.md`, not here.
