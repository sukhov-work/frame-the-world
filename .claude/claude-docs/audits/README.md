# audits/ — the whole-repo audit reports (index, 2026-09-06)

Each file is one `/frame` Audit run: read-only, parallel finder tracks, every candidate finding
re-verified against the cited code or doc before it was written down. They are historical records —
a finding's fix, if it shipped, is in `DECISIONS.md` under the session that followed. Newest first.
**Never edit a report in place**; a later audit supersedes an earlier one by saying so.

| Report | Date | Scope | Baseline it audited against |
|---|---|---|---|
| `audit-full-2026-09-11.md` | 2026-09-11 | **AUDIT #4** (the charter beside it, executed): the full breadth-first adversarial pass — Tracks E · A–D · F (UX, static + a main-agent live tier) · G (business/seed vs the LIVE site) · H1–H5 (the 2026-09-05b→09-10f replay) · I1/I2 (the 0.4.28 patch surface) · J (emergent) · K (backlog status). 6 MAJOR (the live-site graduation class + the library pin) · ~40 MINOR · 13 NIT; registry repaired (5 stale-OPEN rows closed); T136–T144 opened; the browser tier verified T131–T135 holding live | DECISIONS 2026-09-10f (master `1ab6ff4`, app 1.36.8) |
| `AUDIT4_CHARTER_2026-09-10.md` | 2026-09-10 | **CHARTER (not a report)** for audit #4: the full breadth-first ADVERSARIAL pass by a different AI model — Tracks E, A–D, and NEW F (UX) · G (business/product) · H (the recent-change replay since 2026-09-05) · I (the library-patch surface). Its report lands beside it. | DECISIONS 2026-09-10f (master `fc6b568`, app 1.36.8) |
| `audit-docs-hygiene-2026-09-06.md` | 2026-09-06 | Docs + memory hygiene sweep, owner-ordered, with a WRITE fence (claude-docs, memories, conventions, frame references, the guide content): Tracks D + E + the guide gap. DECISIONS compaction round 5, `mem:core` 94 → 12 KB, backlog repair, four bundle READMEs, two guide topics | DECISIONS 2026-09-06f; prior report `audit-batchseams-2026-08-22.md` |
| `audit-batchseams-2026-08-22.md` | 2026-08-22 | Audit #3, owner-scoped: batch seams #4–#7 + the QA slice + the 2026-08-22 micro-slice. Tracks A1 (radar/aim/MapWindow/chrome) · A2 (orchestrator/render/platform-lite/debris) · C (tests + harness) · D (docs/memory/conventions) · E (mechanical) | DECISIONS 2026-08-19 → 2026-08-22b; prior report `audit-full-2026-08-18.md` |
| `audit-full-2026-08-18.md` | 2026-08-18 | Audit #2, full: whole-project expansion-readiness before the UPLIFT ladder resumed. Tracks A (code/engine) · B (platform) · C (tests/math) · D (docs/memory) | `audit-full-2026-08-13.md` + DECISIONS 2026-08-13 |
| `audit-full-2026-08-13.md` | 2026-08-13 | Audit #1, the first full-repo audit: owner-ordered hygiene gate before Phase 8a / M1. Same four tracks | DECISIONS 2026-08-13 (planning-core restructure + M0) |

The audit engine itself — modes, track checklists, the finding format — lives in
`.claude/skills/frame/references/audit-mode.md` and `references/checklists/*.md`, not here.
