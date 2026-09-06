# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`), a Wix headless Astro 5 app that projects a
photo, from its EXIF, as a camera frustum + image plane at its capture location on a stylized 3D
globe with real OSM buildings under a real ephemeris sky. Client-heavy; Wix is the thin backend.
Owner: Yevhen. Repo `headless-frame-the-world` — that name, and "FTW", are the repo only, never the
product; never rename the `ftw:*` keys or the `uFtw*`/`vFtw*`/`FTW_*` shader ids
(`test/brandFence.test.ts`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` →
the code (Serena → Grep → Read) → Wix MCP for platform APIs.
**One writer per fact:** session narrative lives in the `project/wip-*` leaves and in `DECISIONS.md`
§Per-phase digests; this root only indexes and states the current status.

## Status — 2026-09-06g
- **T77, the rendering-performance audit, is PARKED after slice 0** (T79, the below-camera raycast
  gate, is built and CLOSED). T77 resumes at **T80** — owner ruling pending: may a cheaper bloom
  change pixels at `high`? — then slice A shadows, then slice B seats.
- **MESH SUITE CLOSED 2026-09-05b** — MS0–MS8 shipped (gizmos, world-synced building overrides, user
  models); `MESH_SUITE_PLAN.md` §4a, the no-regression contract, stays binding.
- **BEST SPOT PARKED 2026-08-27** (owner 2026-09-01: sufficient as implemented) · **Phase 7, AI shot
  analysis, PARKED 2026-08-11** — out of every plan, no AI code in `src/`.
- **RELEASE GATE: prod is DARK** until the owner's GoDaddy nameserver fix → Wix www TLS → OAuth
  allowlist gains `plux.today` → `wix release`. T2 canaries and T50 ride it.
- Gates 2026-09-06g: vitest **2,463/2,463** (164 files) · `astro check` **0/0/9** · knip **0**.
- DECISIONS compaction **round 5** ran 2026-09-06g: verbatim 08-21→09-05 → `DECISIONS_ARCHIVE.md`
  §Moved 2026-09-06; digests in DECISIONS §Per-phase digests.
- The one debt registry: `.claude/skills/frame/references/tracked-backlog.md` (T1–T90).

## Next step — T77 resumes here (full brief: `NEXT_SESSION_PROMPT.md`)
1. **T80 bloom — measure first, whatever the ruling.** Time a half-resolution / fewer-mip / cheaper
   `UnrealBloomPass` against the `bloomOff` cells (`verify-perf-baseline --post-ab`), and pixel-diff
   the glow at three poses. Gate: FPV `gpu` ≤ 15 ms at `high`, bloom ON (25.1 ms today). If pixel
   changes at `high` are refused: ULTRA first, or park T80 and start slice A.
2. **Slice A, shadows**, gated by `verify-temporal-stability.mjs 9222 --shimmer`: churn p50 at the
   FPV eye 0.185 → ≤ 0.05 · control legs exactly 0 (ULTRA cascade included) · 4×/1× ≥ 3 · speckle ≤
   0.3.
3. **Slice B, seats** (`--reseat`): no 8.3 cm stall floor.
**Constraints:** no regression of behaviour, accuracy, calculations, plans, predictions or sky
features · `high` byte-identical · ULTRA off-state exact · `ENGINE_STATE_2026-09-02.md` §8 harness
list per slice · DNIPRO slice first (owner 2026-09-02c) · the audit is read-only.
**Instruments** in `scripts/`: `verify-perf-baseline.mjs`, `probe-below-camera.mjs`,
`verify-temporal-stability.mjs`, `probe-cpu-profile.mjs`, `t77-model-ramp.mjs`; DEV seams
`__debugFeed`, `__globe.seatSettle()`, `__globe.controls.belowCameraGate()`.
**Owner calls open:** T80 · T85 (`baseEarth` `raycast = () => {}`) · the rooftop-clearance lever.
**Phones:** `tools/devicefarm/README.md` + `MEASUREMENTS_2026-09-05.md` §11; first phone item is
**T83**, the iPhone 17 Pro `#f=` FPV page dying 40–60 s after load.

## Era index
One row per era, oldest first. `07-13-terrain-reseat` = `mem:project/wip-2026-07-13-terrain-reseat`;
braces expand, `*` = every leaf on that stem. Docs are under `.claude/claude-docs/`.
Digests: DECISIONS §Per-phase digests; verbatim: `DECISIONS_ARCHIVE.md` §Moved dividers — r3
2026-08-18 · r4 2026-08-22 · **r5 2026-09-06 = 08-21→09-05, OWNER BATCHES #4–#6 to MESH MS4–MS8**.

- **Phases 1–4 scaffold/globe/decode/projection/ephemeris (07-09→10)** · 07-10-{phase4-scrubber,
  prephase5-fixbatch,ui-fixes}
- **Phase 5 members/pins + 5.5 S1–S7 + pre-S7 refactor (07-10→12)** · `archive/PHASE_5_5_UX_BATCH`
  + `ARCHITECTURE_REVIEW` · 07-10-phase5-members-pins · 07-11-* · 07-12-readme-rewrite
- **Rendering passes + Dnipro enrichment 0–3 + illumination (07-12→14)** · 07-12-rendering-* ·
  07-13-* · `dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN` · `rendering/RENDERING_QUALITY_PASS`
- **OSM2World + R2 hosting + obstruction moat + seating/UI (07-14)** · 07-14-* ·
  `dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP`
- **Docs reorg + Phase 6/6.9 marketplace + St Albans (07-15→18)** · `archive/DEMO_CONTENT_SEED` ·
  07-{15,16,17,18}-*
- **View-prefs persistence + default flips (07-21)** · 07-21-viewprefs-uiux
- **Astro engine A–E + comet 10P (08-02→10)** · `archive/ASTRO_ENGINE_PLAN` · 08-{02,03,10}-*
- **AUDIT #1 + slices 0–7 + Phase 8a + planning core (08-13)** · `audits/audit-full-2026-08-13` ·
  08-13-{full-audit-1,planning-core-restructure,slice7-phase8a}
- **Mobile M0–M3 `/m` shell — planning-only, permanently (08-11→14)** · `MOBILE_PLAN` ·
  08-11-mobile-design · 08-13-m{1-mobile-planning,2-fpv-touch} · 08-14-mobile-m3*
- **Planning QoL 1–4 + FIND v2/v3 + sunsets-in-frame (08-14→15)** · `archive/PLANNING_QOL_PLAN` ·
  08-14-{qol*,find-*,night6-hover-floor} · 08-15-sunsets-in-frame
- **Owner UX batches ×5 + ×9 (08-15b/c)** · 08-15-{ux-batch,uxbatch2}
- **Guide G1 + polish (08-15d/e)** · `archive/GUIDE_PLAN` · 08-15-guide-g1
- **P7 meteors + UPLIFT U1–U8, COMPLETE (08-17→19)** · `UPLIFT_PLAN` (App. A = U7 terrain audit)
  · 08-17-* · 08-18-u*
- **AUDIT #2 + fix slices (08-18)** · `audits/audit-full-2026-08-18` · 08-18-audit2*
- **Owner UX #2/#3 + PLUX launch grooming (08-19→19d)** · 08-19-*
- **OWNER BATCHES #4–#6 + QA slices, riding the release gate (08-21→22b)** · `archive/UXBATCH4_PLAN`
  · 08-21-*
- **AUDIT #3 + owner micro-slice + F1–F10 (08-22a→22e)** · `audits/audit-batchseams-2026-08-22` ·
  08-22-{owner-microslice,audit3*}
- **GUIDE FINAL G-A…G-J + owner 3-slice + HQ map (08-22f→22i)** · `GUIDE_FINALIZATION_PLAN` ·
  08-22-{guide-final,owner-3slice} · 08-27-guide-bestspot-eclipses
- **ULTRA fidelity + eclipses + immersion breakers + dusk (08-22j/k, 08-27b/c)** · `ULTRA_PLAN`
  (AS BUILT block first) · `rendering/ULTRA_ARCHITECTURE` §13 · 08-22-{ultra-track,eclipses} ·
  08-27-{ultra-render-batch,dusk-taste-pass}
- **BEST SPOT heatmap S1→S7, then PARKED (08-23→08-27d)** — **start at `bestspot/README.md`**;
  `verify-bestspot.mjs` is **96/101 by design**, D8 red on clean master · 08-23-bestspot-heatmap ·
  08-24-bestspot-s3-s7 · 08-26-{bestspot-*,sweep-*,gate-star-floor} · 08-27-bestspot-park
- **FORMAL VERIFICATION, Lean 4 + Mathlib (08-24d)** · `formal/` · `FORMAL_VERIFICATION` ·
  08-24-formal-verification
- **BRAND: PLUX is the product (08-25)** — a leak had shipped in every exported `.ics`, now fenced
  by `test/brandFence.test.ts`. No leaf; DECISIONS 2026-08-25.
- **RENDERING CHARTER RC0–RC30, CLOSED (08-25b→08-26d)** · `rendering/RENDERING_CHARTER_2026-08-25`
  + `FPV_FIDELITY_AUDIT_2026-08-22` · 08-25-* ·
  08-26-{rendering-charter-groupE,group-d-rc13-rc17,rc16-rc21}
- **REGION #4 Chernobyl built → DELETED (08-26b→09-02e)** — owner 2026-09-02c: Dnipro first; bakes,
  geoid grid and 1,785 R2 objects gone · 08-26-chernobyl-region
- **DBG chip, 151 metrics + 3 actions (09-01)** · `DEBUG_HUD_PLAN` · 09-01-dbg-hud
- **MESH SUITE planned + MS0–MS3 (09-01b→09-02g)** · `MESH_SUITE_PLAN` (§4a = the binding
  no-regression contract) · 09-01-mesh-suite-plan · 09-02-mesh-suite-{ms0-ms1,ms2,ms3}
- **MESH SUITE MS4–MS8 + T77 lead-in (09-02h→09-05)** · `rendering/ENGINE_STATE_2026-09-02` +
  `WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05` · 09-03-* · 09-05-model-pitch-roll-ms8 ·
  09-02-{mesh-suite-ms{4,5,5b,6},t77-engine-state-report}
- **T77 RENDERING PERF — MEASURE → phones → slice 0 (09-05b→09-06f, HOT, verbatim in DECISIONS)** ·
  `rendering/` `T77_AUDIT_PLAN_2026-09-05` · `MEASUREMENTS_2026-09-05`
  (§0 verdict · §7 CPU · §11 phones · §12 slice order) · `T77_SLICE0_ORBIT_FRAME_2026-09-06` ·
  09-05-t77-{audit-plan,measure} · 09-06-t77-phone-baseline-slice0
- **Docs + memory hygiene sweep (09-06g, HOT)** · 09-06-docs-hygiene

## Graph index — every memory except the era leaves; names are under `.serena/memories/`
- top level: `mem:memory_maintenance` graph rules + caps · `mem:suggested_commands` commands ·
  `mem:task_completion` gate · `mem:tech_stack` deps · `mem:architecture/system-overview` engine
  + pipelines
- `decisions/` — `adr-000-locked-stack` 15 binding ADRs · `session_workflow` the persistence
  loop · `session-end-autoship` the ship hook + gates
- `patterns/` — `globe-rendering` the LEO globe · `photo-frustum` EXIF → frustum · `upload-flow`
  RAW worker · `members-pins` auth, quota, C6 tiers · `design-system` tokens · `sky-bodies-terrain`
  Phase-4 sky (ground half SUPERSEDED → ARCHITECTURE §7)
- `bugs/` — past defects, read before touching that area; all fixed but the last:
  `pin-arrival-reframe` · `fpv-walk-orbit` · `orbit-drag-after-fpv-edit` · `bldg-menu-right-release`
  · `comet-magnitude-model` · `gallery-thumbnail-stale` · `ground-checkerboard-flicker` **OPEN**
- `project/` non-leaf — `wix-platform` mechanics + TODO-VERIFY · `wix-site` URL/siteId/appId ·
  `dev_environment` · `audit2-2026-08-18-charter` ·
  `owner-orders-2026-08-14-qol-batch` · `wip-2026-09-06-docs-hygiene`
- The 126 `project/wip-*` leaves are the era archive, reached through the Era index.

## Source layout (verified 2026-09-06)
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable) · `scene/`
  35 attach-modules · `StylizedTiles.ts` orchestrator · `PhotoFrustum` · `Pins` · `flight` ·
  `explore` · `GlobeCanvas.tsx`. Design imports NEVER touch it (`conventions/globe-tuning.md`).
- `src/components/` — `panels|ui` desktop chrome · `mobile` the `/m` shell · `controls` shared input
  instruments (a pure leaf: react + stores + `lib/**` + `globe/tuning`).
- `src/lib/` — 18 entries, all real: decode (libraw-wasm worker), geo, ephemeris, sky, globe,
  models, guide, pins, photo, export, market, save, wix, theme, format, api, textures, `prefs.ts`.
- `src/store/` 19 zustand stores · `src/pages/` `index.astro`, `m.astro`, `guide.astro`, layouts and
  11 thin `api/*` routes — no `src/backend/` · `public/` textures, data, guide shots · `test/` 164
  vitest files / 2,463 tests.

## Key invariants (violations = bugs)
- The globe is `client:only` — **never SSR WebGL** (C4). Decode runs in a **Web Worker**; free RAW
  buffers immediately. Astro **5** only.
- **Never fabricate a Wix API signature** — verify through Wix MCP. Endpoints stay thin, compute
  client-side (C1); backend admin calls need `elevate()`.
- Stylize tiles by material swap on `load-model`, **not** `BatchedTilesPlugin`
  (`scene/buildings.ts:32`); on ground tiles **chain** `onBeforeCompile` — TilesFadePlugin wrapped
  it.
- Globe and GL colour flow through `lib/theme/tokens.ts` (D14): colour maps sRGB, mask/elevation/
  normal data (`THREE.NoColorSpace`). Design imports write only under
  `src/components/panels|ui|controls/**` + `src/styles/**`.
- **C6 privacy:** a public pin never carries exact GPS — tiers exact / 1km / city, published at the
  geohash cell centre (`lib/geo/precision.ts`).
- Wix mechanics (no geo query → geohash `hasSome` + client refine; `elevate()`; TUS over 10 MB) are
  in `mem:project/wix-platform`. Marketplace + AI rules (C3 payout, JPEG-only vision) are in
  `PROJECT_SEED.md` §3 — no code today, Phase 7 parked.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) and §4 (ADR-000, D1–D15) are **binding**. `ARCHITECTURE.md` +
`IMPLEMENTATION_PLAN.md` are the execution source of truth, distilled from
`provenance/DEEP_RESEARCH.md`. Rules: `.claude/conventions/` (`wix-headless.md` = platform
mechanics). Workflow: the **`/frame`** skill.
