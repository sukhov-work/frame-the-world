# WIP 2026-09-02n — T77 LEAD-IN: the ENGINE STATE report + the WEB-RESEARCH prompt — DONE (read-only)

**Status: DONE.** Mode research (investigate-design-v3 spine on `/frame`), tier Deep, READ-ONLY on `src/`
(no code changed, no gates run; the 09-02m gates stand). Owner order (2026-09-02n): before the T77
architecture + performance audit, (1) a deep report on everything built/optimized in the engine, rendering
and pipelines with limits across desktop/mobile × regular/ULTRA; (2) a self-contained prompt for an
independent web research pass the owner runs on web Claude. Binding rule: no optimization may degrade
behaviour, cartographic/3D accuracy, calculations, plans, predictions or sky features; better graphics at
today's desktop frame rate is fine if mobile (iPhone 17 priority) gets faster.

## Deliverables
- `.claude/claude-docs/rendering/ENGINE_STATE_2026-09-02.md` (~8.2k words) — §0 verdict · §1 system map ·
  §2 eight subsystem cards (tiles/LOD · imagery/vector · lighting/sky/ULTRA · shadows · terrain/seats ·
  precision · buildings/models/bake · mobile) · §3 mode matrix · §4 measured ledger + never-measured ·
  §5 merged refuted ledger (36 rows) · §6 gap analysis by the owner's topics with Rq-1..17 · §7 traps ·
  §8 non-regression contract (harness table) · §9 DBG readings available · §10 seams found · §11
  recommended audit order · §12 falsification record. Confidence 84 %.
- `.claude/claude-docs/rendering/WEB_RESEARCH_PROMPT_2026-09-02.md` (~3.1k words) — system description,
  binding constraints, do-not-re-propose table, Rq-1..17, deliverable format. The web answer should be
  saved as `rendering/WEB_RESEARCH_REPORT_<date>.md`.
- Track outputs (cited, ~15k words) kept verbatim in `rendering/engine-state-tracks-2026-09-02/track{1..6}-*.md` (+ README).

## Method
Six parallel general-purpose agents (frame pipeline/renderer/post/quality 87 % · tiles/LOD/culling/imagery/
vector 82 % · lighting/shadows/sky/ULTRA/dusk/eclipse 86 % · terrain/seats/precision/buildings/models/bake
82 % · numbers/history/refuted/verification 82 % · mobile 78 %), each with the output contract
(mechanisms · tunables · measured vs estimated · limits · refuted · backlog · gaps · confidence).
Consolidation: seams cross-checked; crux claims grep-verified (`three-mesh-bvh`, `BatchedMesh`,
`compileAsync`, WebGPU, worker parse absent; no `N draw calls` on record anywhere).

## The verdict (what the audit must know)
1. No draw-call / triangle / GPU-ms reading exists for any pose on any hardware (DBG rows exist since
   09-01; nothing recorded). Governor sees CPU rAF dt only (`quality.ts:446`).
2. Shadows: ortho box re-centred every frame, NO texel snapping (`shadowFit.ts:60-79`; `LightShadow.js` has
   no quantisation; only the extent is quantised in 128 m steps); base profile has no cascade + hard cut at
   5 km; ULTRA cascades multiplied with no dispatch/blend band; lit materials receive cascade 0 only; base
   bias is a fraction of a moving depth range. The owner's 08-27 "cropped, sliced, hollow" names these.
3. Reseat: CPU raycast per footprint; memo dropped city-wide on EVERY terrain tile arrival
   (`imageryGround.ts:907-911`; 406 epochs/leg); off-cone refresh ≈41 s at 60 Hz (39,302 footprints at
   16/frame, ESTIMATED), trees ≈100 s; eases per-frame with no dt term; RC7 bar unmet (50.3 %).
4. Mobile: `(pointer: coarse)` is the only phone signal; zero real-device numbers; governor blind to
   heat/memory; 512² composites latched at boot on /m; shadow pass to 30 km on phones.
5. Verified absences: worker tile parse, HLOD/impostors, occlusion culling, `three-mesh-bvh`, `BatchedMesh`,
   model instancing/GLB cache, compressed textures, post-AA, `compileAsync`, VRAM accounting, WebGPU.

## Seams found (recorded in report §10)
RENDERING_ARCHITECTURE §2.6 "skirt is not built" was stale (RC13 shipped 08-26c) — CORRECTED this session
with a dated note · RC14 never built / never closed while T54 says no RC open · 536 MB vs 512 MiB (units) ·
2k Milky Way VRAM 8 vs 2 MB (neither measured) · T45 closed while shadows reopened 09-01 with no row ·
`TRANSLATE_MAX_M` 60 (plan §6) vs 5 km shipped · "1 concurrent decode on mobile" not in code.

## Recommended audit order (report §11; owner to confirm)
MEASURE first (DBG at Dnipro FPV / ULTRA city / Everest / /m chart × 0/6/24 models via `/api/dev-seed
kind:"model"` × ULTRA × shadows × tiers via `__quality.force`; then iPhone 17 Pro via Safari remote
inspector) → shadow-stability slice → seat-pipeline slice → streaming/workers slice → mobile slice; each
a separate session, read-only audit report first, fixes sliced, report §8 harness list re-run.

## Session facts / traps
- The MS6 ship (PR #97) was in flight at boot; tracked files untouched until it landed (23:06).
- `grep --include=*.ts` under zsh needs the glob QUOTED (`--include='*.ts'`), else "no matches found".
- ugrep rejects `.{0,N}` context patterns as too complex on this box — use `-o` with short literals.
- Serena `read_memory` of `core` (82 KB) overflows the tool limit — it lands in a tool-results file; read
  sections by line range with python.

Related: `mem:project/wip-2026-09-02-mesh-suite-ms6` (prior) · `mem:project/wip-2026-08-25-rendering-charter`
· `mem:project/wip-2026-08-22-ultra-track` · `mem:patterns/globe-rendering` · `mem:patterns/sky-bodies-terrain`.
