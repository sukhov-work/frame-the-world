# mem:project/audit4-2026-09-10-charter — AUDIT #4, the full breadth-first ADVERSARIAL pass by a DIFFERENT AI model

**Owner order 2026-09-10f** ("a full audit and review of the code base, the rendering pipeline and all our recent changes using another AI model to avoid any biases … technical, architectural, UX, business and other emergent defects"), enriched by the last author with the owner's leave (2026-09-10g).

**The charter (read it whole, first):** `.claude/claude-docs/audits/AUDIT4_CHARTER_2026-09-10.md`. Self-contained for a model with no memory of this repo.

## The shape in one screen
- **Stance:** every recent ruling, fix and measurement is wrong until reproduced; one refutation attempt per major finding; zero-result validation on every "clean".
- **Breadth first, then depth** on what breadth flagged + the RECENT-CHANGE surface (DECISIONS 2026-09-05b → 2026-09-10f).
- **Tracks:** E hygiene FIRST (main agent) · A code/engine · B Wix platform/ops · C tests/math · D docs/memory · **F UX** (both shells, driven live) · **G business/product** (the seed C1–C6/D1–D15 vs the code, the live site, attribution/ToS) · **H the recent-change adversarial replay** (T77 lane, mesh suite, mobile batch, T123 levers, the 2026-09-10e/f interlude — the named lever interactions) · **I the library-patch surface** (nine reaches into `3d-tiles-renderer@0.4.28` internals; what a bump breaks silently; the one fence).
- **Read-only** on `src/`, `scripts/`, `public/`, docs; the resource budget; the VPN; no `src/` edit while a harness runs; close the house Chrome after.
- **Deliverable:** `audits/audit-full-2026-09-1x.md` per `audit-report-template.md`; findings re-verified at their anchor; backlog T1–T135 VERIFIED never re-discovered; checklist amendments; an ordered fix-session slicing. Fixes are separate sessions.
- **Baseline anchor:** DECISIONS 2026-09-10f, master `fc6b568`, app 1.36.8.

## Hot spots the last author named against themself
`scene/imageryGround.ts` (the densest seam, five monkey-patches) · `StylizedTiles.ts` 8.8 k lines / ~55 steps per frame + the TDZ trap · the six-tunable night grade + its hand-mirrored JS twin · the T77 cost model changed repeatedly with no consolidated re-measure after the interlude (12 parse slots, the split guard, the FIFO bands) · the sweep's settle-cap counts are cache state · the ship hook's own commit format + mirror force-sync · the house Chrome hang after ~100 probe boots.

Related: `mem:project/audit2-2026-08-18-charter` (the shape of #2) · `mem:project/wip-2026-09-10-interlude-render-quirks` (what #4 replays first) · `mem:decisions/session_workflow`.
