# Audit mode — whole-repo / whole-docs review (Frame the World)

WHEN: the owner orders a comprehensive review; a phase/era boundary closes (e.g. before a new
feature ladder rung); or a Review-type ask exceeds single-artifact scope. TIER: Deep by default;
Standard for a single-track re-run. Owner-supplied scope + quality gates are BINDING and override
the default track list. **The audit session is READ-ONLY on `src/`, `scripts/`, and docs: it
produces a report; fixes are separate sessions sliced from the report.** (Gall's law: no rewrite
proposal without a named strangler seam — the `enrichedVariant` `?enriched=` A/B seam is the
house precedent.)

TRACKS (independent → parallel review-agent launches; each gets ONE checklist):

  A  Code + engine invariants (GL/three/stores/workers)  → references/checklists/code.md
  B  Wix platform + backend + ops (C1/C6, media, release) → references/checklists/platform.md
  C  Tests + math integrity                               → references/checklists/tests.md
  D  Docs + memory + conventions consistency              → references/checklists/docs.md
  E  Mechanical hygiene (main agent, FIRST — tool output outranks model reasoning):
     `npm test` · `npx astro check` (triage the hints — currently a dated baseline, never
     an accumulating pile) · `npm audit` · dead-export/dep probes (`npx knip`, `npx depcheck`,
     `npx ts-prune`, `npx jscpd src/` — PROBE availability first; the registry may not serve
     them: classify the failure, degrade honestly, never silently skip) · `wix build` client
     bundle size vs the dated baseline — 33 MB as of 2026-08-13 (22 MB textures / 8 MB `_astro`
     JS / 3 MB enriched-sample; was ~24 MB 2026-07-14 pre milky-way-8k/FAQ/astro-catalogs —
     re-anchored by audit #1, finding D3) · unused `public/` assets (referenced-nowhere sweep).

WORKFLOW:

  0. Intent gate: load owner scope/gates; pick the baseline anchor (the previous audit's
     DECISIONS entry, or whole-repo on the first run). Name type=Audit + tier in one line.
  1. Run Track E. Classify every failure my-change / pre-existing / flaky(re-run ×2) / infra
     BEFORE reading any code. Gates state = the report's baseline block.
  2. **Re-mine first (Pesticide Paradox):** walk DECISIONS §Traps + entries since the baseline
     anchor for failure classes not yet in the checklists; append them (dated) before launching
     tracks. A checklist that never grows only catches last audit's bugs.
  3. Launch track agents (references/review-agent.md) with the shared context block, the track
     checklist, and the baseline anchor — one message, parallel.
  4. VERIFICATION PASS (main agent, mandatory): re-read the cited code/doc for every candidate
     finding; a finding that does not reproduce is DELETED, not downgraded. Zero-result
     validation on every absence claim: prove the grep/query CAN match.
  5. Falsification gate (SKILL.md evidence discipline + one refutation attempt per major
     finding) on the aggregate verdict.
  6. Emit the report per references/audit-report-template.md into
     `.claude/claude-docs/audits/audit-<scope>-<date>.md`. Every finding carries:
     severity · confidence · anchor (file:line or doc§) · the violated convention/ruling ·
     a specific fix (never "monitor closely") · verification tier
     (local-tested / browser-VERIFIED / wix-cloud-VERIFIED / UNVERIFIED).
  7. Backlog check: findings matching a row in references/tracked-backlog.md are reported as
     STATUS VERIFICATION against that row, never as discoveries.
  8. Phase-4 recording (memory + DECISIONS + NEXT_SESSION_PROMPT). The audit session's diff
     touches only the report + this skill's files — **a `src/` diff in an audit session is
     itself a Track-D FAIL.**

SEVERITY (project-calibrated):

  BLOCKER  C1–C6 violation (exact GPS on a public payload · SSR'd WebGL · server-side decode ·
           styled/derived Google tiles) · silently wrong load-bearing math (projection /
           ephemeris / FOV / geohash) · Photos↔PublicPins divergence or quota bypass ·
           secret/token exposure · DECISIONS append-only violation.
  MAJOR    engine invariant break (float32 camera-anchoring, ONE-shared-building-material,
           heightAt clamp, lazy contract, renderOrder-per-object) · missing/silent degrade path
           (a fallback that engages without a console.warn) · media/TUS or checkout contract
           break · per-frame perf regression class (store writes in the loop, unbounded
           frame-loop scans, un-tiered heavy work) · a golden gate (skyBudget, lazyContract)
           weakened or bypassed.
  MINOR    DRY/convention drift · tuning literals scattered outside tuning.ts · doc/config
           drift · dead code/exports · stale convention samples or pending-tags · duplicated
           helpers.
  NIT      naming, wording, formatting.

FALSE-POSITIVE RATCHET: if >20% of a run's findings are disproved in verification, tighten the
offending checklist items before the next run (dated edit). The ratchet cuts both ways — step 2
grows the checklists from the same evidence stream.

CADENCE (Parkinson guard — burst-triggered, no idle timers): Track D alone at every phase
boundary and after any ≥3-session ship burst; ALL tracks before each new ladder rung
(Phase-8 sub-phase or M-phase) and after any platform/engine migration; Track E's gates ride
every session's Phase-3 already.

LAWS: references/laws.md maps the laws of software engineering onto this machinery — which
checklist item encodes which law, and which laws are deliberately skipped here. Read it when
authoring new checklist items so the encoding stays deliberate.
