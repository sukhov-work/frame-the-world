# Track D — Docs + memory + conventions consistency

Format: one assertion per item, then `— check:` and `— anchor:`. Authored 2026-08-13; re-mine
DECISIONS since the baseline anchor at every audit start and append dated items. Track D also
owns audit purity: a `src/` diff in an audit session is itself a Track-D FAIL.

TOC: 1 append-only ledger · 2 doc-sync completeness · 3 convention samples · 4 volatile counts ·
5 stale pending-tags · 6 memory graph · 7 plan checkboxes · 8 scope guard · 9 dateline integrity ·
10 cross-references · 11 contract inventory · 12 backlog registry

1. DECISIONS.md append-only integrity: git history shows no edits to old lines; supersessions
   are new dated lines; the 2026-07-11 compaction remains the only sanctioned move.
   — check: `git log -p -- .claude/claude-docs/DECISIONS.md` spot-check since baseline — old
   lines untouched.
   — anchor: DECISIONS header contract.
2. Doc-sync completeness: every DECISIONS ruling since the baseline anchor has its canonical
   twin (ARCHITECTURE § / IMPLEMENTATION_PLAN phase note / MOBILE_PLAN annotation / conventions
   sample / memory) — a ruling living only in DECISIONS is invisible to future Phase-0 reads.
   — check: walk DECISIONS entries since baseline → name each twin or flag.
   — anchor: mem:decisions/session_workflow; the 2026-08-11 mem:core gap precedent (a whole
   session's ruling missed the graph root — caught 2026-08-13).
3. Convention samples match as-built code: every code sample in `.claude/conventions/*` compiles
   against the real symbol it illustrates (a stale sample actively misleads the next session).
   — check: read each convention's samples changed-adjacent since baseline against the code.
   — anchor: conventions/ dir; globe-tuning.md contract.
4. Volatile counts live ONCE: test counts, quota numbers, route counts, tileset sizes, catalog
   entry counts have one canonical home (DECISIONS newest line or the owning doc §); every other
   mention references it or dates its copy ("704 as of 2026-08-13") — never a bare restated
   number.
   — check: grep the current volatile numbers (test count, quota, entry counts) across
   claude-docs/ + README; >1 undated bare copy = finding.
   — anchor: epistemic anti-drift rule (imported 2026-08-13); this item IS its first encoding.
5. Stale pending-tags swept: `grep -rn "UNVERIFIED\|PARKED\|pending\|DESIGNED\|TODO-VERIFY"
   .claude/claude-docs/` — every hit whose subject has since shipped/released/resolved gets a
   dated resolution note (stale tags survive because nothing forces their re-read).
   — check: run the grep; classify each hit current/stale.
   — anchor: epistemic 08-09 sweep lesson (imported 2026-08-13); TODO-VERIFY tracker rows.
6. Memory graph health: `mem:core` Status/Next-step matches the newest DECISIONS line; every
   session since baseline has its `mem:project/wip-*` twin; `[[links]]`/`mem:` references
   resolve; superseded memories carry supersession notes (never silent edits of history).
   — check: read mem:core head vs DECISIONS; list memories vs session dates; spot-resolve links.
   — anchor: mem:memory_maintenance; the 2026-08-11 gap precedent.
7. Plan state matches reality: IMPLEMENTATION_PLAN checkboxes/⛔/☑ marks and MOBILE_PLAN phase
   statuses reflect what actually shipped (incl. partial states named honestly, e.g. "built,
   exit gate open").
   — check: walk phase marks against DECISIONS ship lines.
   — anchor: /frame Phase-4 step 3.
8. Scope guard (Zawinski): nothing scheduled or drafted violates the permanently-out list
   (Phase-7 AI panel · Gaia-depth · GOTO · tides/rainbow · Skyfire · upload/marketplace/pins on
   mobile); the audit Verdict carries a one-line scope-creep statement.
   — check: grep plans/docs for out-list terms scheduled as work; read new plan additions.
   — anchor: MOBILE_PLAN §7 owner rulings; IMPLEMENTATION_PLAN Phase-8 out-list.
9. Dateline integrity: dated doc rows match git commit reality; discovered mislabels get
   in-place dated correction notes, never silent edits.
   — check: spot-check the newest dated rows against `git log` dates.
   — anchor: DECISIONS append-only contract.
10. Cross-references resolve: paths moved by reorgs (the 2026-07-15 docs reorg pattern) leave no
    dangling references in docs, memories, skills, or conventions; the skill's external
    references (investigate-design-v3 path, epistemic imports) note their machine-locality.
    — check: grep claude-docs/ + skills/ + conventions/ for `.claude/` paths → each resolves.
    — anchor: 2026-07-15 docs-reorg (37-file reference update precedent).
11. Contract-strings inventory exists and is current (Hyrum): one doc home enumerating the
    app's implicit public contracts — URL hash grammars (#p=/#f=/&t=/&sky=), localStorage keys
    (ftw:*), DEV seams, Wix collection schemas, R2 tileset layout+versions, listing/product
    linkage fields. **First audit authors `conventions/contracts.md`; later audits diff it.**
    — check: the doc exists; diff its rows against the code's actual grammars/keys.
    — anchor: laws.md (Hyrum); Track A item 12.
12. Backlog registry integrity: `references/tracked-backlog.md` is the ONE debt list — dated
    rows, each with a tracker/plan pointer; NEXT_SESSION_PROMPT carried-tails mirror it (the
    prompt file is gitignored — the registry is the durable copy); no forked second list.
    — check: diff the registry against NEXT_SESSION_PROMPT tails + DECISIONS open items.
    — anchor: references/audit-mode.md step 7; laws.md (Technical Debt).
