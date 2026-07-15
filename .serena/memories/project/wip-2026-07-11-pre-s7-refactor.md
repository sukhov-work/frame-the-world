# WIP 2026-07-11 — Pre-S7 architecture review + careful refactor

**Mode:** design+review, Deep tier (investigate-design-v3 under /frame). Ultracode session.
**Mission (owner):** BEFORE Phase 5.5 S7, reflective architecture review + VERY careful refactor to
clean up/organize the codebase, update conventions, compact DECISIONS.md (without losing context/traps),
make code readable/maintainable for humans AND Claude agents.

## Method + artifacts
7-track parallel review workflow → consolidated risk-classified 26-item backlog (B1–B26).
Canonical deliverable: `.claude/claude-docs/archive/ARCHITECTURE_REVIEW.md` (health read + backlog table +
risk classes + decisions + ledger). Green baseline held throughout: 304→314 vitest · astro check 0.

## Owner decisions
- Q1 scope = **Full local-verified tier** (B1–B18 + B26), NOT the moderate splits (B16/B17 = the option
  the owner declined → deferred).
- Q2 = **B19 pre-S7 readability pass now** (split StylizedTiles' 917-line update() → named steps,
  browser-verified). B20–B22 fold into S7.

## DONE + VERIFIED this session (314 vitest · astro check 0)
- **B1** DECISIONS.md compacted 709→333 (ADRs hoisted, durable **Traps & Gotchas** section, per-phase
  digests; old 2026-07-09/10 logs moved BYTE-IDENTICAL → `DECISIONS_ARCHIVE.md`; append-only preserved;
  35 entries + 15 ADRs conserved, integrity-checked via awk split + grep counts).
- **B2** doc-drift fixed: `.claude/CLAUDE.md` (lint gate + Tailwind), `ARCHITECTURE.md` (§2 90m sink, §6
  endpoint tags + ping, §7 component list), `IMPLEMENTATION_PLAN.md` (90m + public/wasm + TODO#2),
  `wix-headless.md` (public/wasm, quota-hook→endpoint D8, COOP/COEP), `wasm-modules.d.ts` TODO,
  `skills/frame/SKILL.md` lint.
- **B3** 4 conventions codified: architecture-and-patterns.md (repo-layout regenerated, seam+mirror,
  DEV-seam registry), globe-tuning.md (~200-line reframe, ECEF-anchoring + shared-material traps,
  encoder/FPV idiom, sanctioned tuning cross-layer import), naming-conventions.md (real stores +
  scene-attach), testing-standards.md (browser-verify 3-tier harness + trap catalog).
- **B4** deleted `components/Welcome.astro` + `assets/{astro,wix,background}.svg`. **KEPT `api/ping.ts`**
  (GATE CATCH: it's the pre-release POST-403 canary — refreshed its stale header).
- **B5** deleted dead `frustumPose`/`FrustumPose` (+ its test). KEPT `altMToSlider`/`neighbourGeohashes`
  (tested inverse/adjacency utils) + `extract.ts` exports (B18 needs them — B5↔B18 conflict caught).
- **B7** format dedup: `formatAltM`/`formatEyeM`/`cardinal`/`formatSigned` → `lib/format/readout.ts` (+
  tests); rewired `CameraTiltPanel.tsx` + `FpvHud.tsx`.
- **B14** deleted dead `TERRAIN` tuning const + fixed stale buildings.ts comment.
- **B18** added `test/lib/decode/extract.test.ts` (fileExtension/isRawFile/isHeicFile/isBrowserDisplayable).

## REMAINING (next session, all scoped in archive/ARCHITECTURE_REVIEW.md)
- **Safe local-verified follow-up:** B6 (shared geo/math helpers incl. `clampGroundM` + TERRAIN.maxPlausibleGroundM=9000,
  projectOntoTangent/horizontalApproach, ndc↔client, focalFromHorizontalFov, move wrapHeadingDeg to lib),
  B8 (lib→store layering: derivedFov→sensors, param types→lib), B9 (coerce.ts + CameraPoseOptics + PRECISION_TIERS),
  B10 (lib/api/http.ts json+requireMember), B11 (typed window seams), B12 (GlobeControlsInternal + generic
  requestJson), B13 (~20 orchestrator magic numbers → tuning), B15 (save-flow guardBusy+toApiError), B26
  (throttle per-frame catch). B14 section-index still todo.
- **B19 (owner ask, browser-verified):** split `StylizedTiles.ts` update() (650–1567) into named step-fns
  over an explicit frame-context, EXACT per-frame order preserved (map in ARCHITECTURE_REVIEW / the
  orchestrator track). Adopt B6 helpers + B13 constants + B12 type + B26 here (one browser pass). This is
  the delicate one — do it unhurried with wix dev browser verify; do NOT rush at session tail.
- **S7-deferred (browser/shader/precision):** B16 upload.ts split, B17 panel splits, B20 controller
  extraction, B21 terminator/golden GLSL dedup, B22 tiles typing, B23 textureUpgrade, B24 impostorDistance,
  B25 orphaned-PublicPins hardening.

## Traps / notes for the executor
- Baseline = `npm test` (fast ~1s) + `npx astro check`. No lint script. Verify after each item.
- StylizedTiles update() ordering is a load-bearing implicit contract (comments encode it) — any B19
  extraction MUST preserve statement order + closure access; browser-verify (globe render + camera/FPV/glides).
- `DECISIONS.md § Traps & Gotchas` is now the durable crown-jewels list (GL/Wix/verification).

## Related
[[core]] · `archive/ARCHITECTURE_REVIEW.md` · NEXT_SESSION_PROMPT.md · [[patterns/globe-rendering]] ·
[[patterns/sky-bodies-terrain]] · [[decisions/session_workflow]]
