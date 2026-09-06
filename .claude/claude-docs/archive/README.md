# archive/ — closed-era plans, kept for provenance (index, 2026-09-06)

Nothing here is a live plan. Each file was the working document of a track that has since shipped,
been superseded, or been ruled out; they stay because their design rationale and as-built specs are
still the best account of *why* something is shaped the way it is. If a file here and a current doc
disagree, the current doc wins. Grouped by what they were, newest era first.

**Planning / UX batch plans (all shipped)**
- `UXBATCH4_PLAN.md` — 2026-08-21, owner batch #4, 15 mobile-heavy items after his first real-device
  pass. Shipped complete (18/18) across S1–S3, DECISIONS 2026-08-21/21b/21c; archived 2026-08-22.
  Read it for the radar bands, the focal cone and the aim joystick.
- `PLANNING_QOL_PLAN.md` — 2026-08-14, the PhotoPills deep review that became the sun/moon/Milky-Way
  QoL pass. QoL-1 → QoL-4 all shipped; it is the SPEC source for `IMPLEMENTATION_PLAN.md` Phase 8's
  QoL rungs. Archived 2026-08-18.
- `GUIDE_PLAN.md` — 2026-08-15, the in-app user guide. G1 + G2 shipped both shells the same day;
  G3 folded into backlog T28. Archived 2026-08-18.
- `PHASE_5_5_UX_BATCH.md` — 2026-07-11, the owner's 10 pre-marketplace items ordered into S1–S7.
  Canonical design doc for Phase 5.5; `IMPLEMENTATION_PLAN.md` Phase 5.5 is its checklist twin.
- `DEMO_CONTENT_SEED.md` — 2026-07-17, the 12 public-domain "impossible nature" seed pins and the
  licensing bar they had to clear.

**Dnipro enrichment provenance** (the live plan is `../dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md`)
- `DNIPRO_3D_ENRICHMENT_RESEARCH_PROMPT.md` — 2026-07-13, the self-contained brief handed to a web
  research agent.
- `DNIPRO_3D_ENRICHMENT_RESEARCH_RESULTS.md` — 2026-07-13, that agent's cited decision report; it is
  where the "bake LOD2 from OSM footprints, self-host on R2" answer comes from.
- `DNIPRO_SLICE0_SPIKE.md` — 2026-07-13, the de-risk spike's verdict and receipt for the analysis and
  integration half of slice 0.

**Engine / architecture provenance**
- `ASTRO_ENGINE_PLAN.md` — 2026-08-03, the plan that generalised the one-off 10P/Tempel-2 tracer
  into "search and track any object in the sky". What it planned is built: the SkyTarget provider
  registry (`../ARCHITECTURE.md` §4) and the `skyTarget` / `skyTrail` / `skyNames` scene modules (§7).
- `B19_HANDOFF.md` — 2026-07-11, the orchestrator `update()` split into 36 named step closures.
  Done and provably behaviour-identical; the per-frame step list it created is still how
  `StylizedTiles.ts` is organised.
- `ARCHITECTURE_REVIEW.md` — 2026-07-11, the pre-S7 architecture review and refactor ledger: the
  reflective pass the owner ordered before the Phase 5.5 ground rework, covering codebase cleanup,
  the conventions, and the first DECISIONS compaction.
