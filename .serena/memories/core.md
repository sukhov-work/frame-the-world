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

## Status — 2026-09-07b
- **2026-09-07b (`mem:project/wip-2026-09-07-t77-phones-lever10`):** **T83 CLASSIFIED** — a jetsam kill at
  WebContent's 2,048 MB per-process cap (four Device Farm syslogs, the same line; always the SECOND `#f=`
  load in one process; one FPV page is ~½ GB and flat on the desktop twin `probe-memory-footprint.mjs`;
  the GPU-side memory of a destroyed page lingers ~470 MB per load) → lever named, not built: release on
  `pagehide`. **The Pixel re-measured WITH terrain** (the owner caught the first run reading a bare sphere
  — T98 on the phone lane; §11's Pixel city/everest/`/m` rows VOID; `verify-perf-baseline --device` now asks
  ion from the phone and FAILs a terrain-less cell): orbit/city/everest at the 60 Hz cap (gate off 6–8 fps),
  fpv 42 fps GPU-bound. **Lever 10 CLOSED, not built** — `probe-cpu-profile --leg descent` (exact frame
  markers): glTF parse 0.7 % (desktop) / 1.4 % (Pixel) of the hitch frames' main thread. **T107 FIXED** —
  `controls.getPivotPoint` ran every frame in `stepMobile2dLocks` (87 % of `/m`: the iPhone's 26 ms, the
  Pixel's 58) and `stepTiltGlide` (27–33 ms per arrival frame): Pixel `/m` 16 → 60 fps, descent hitches
  86 → 64. **T106 OPENED** — the Pixel's descent hitch is the enriched cell's `load-model` work (2.26 s +
  0.8 s mask runs in 57 hitch frames). vitest 2,767/176 · astro 0/0/11 · knip 0. Backlog T1–T107.
  **DECISIONS §Recent is 137 KB → compaction round 6 FIRST next session.**
- **2026-09-07a (`mem:project/wip-2026-09-07-t100a-overlay-tail`):** **T100 CLOSED under ruling (a)** —
  the ground overlay's OWN extinction tail (`duskLight.overlayReleaseK`, `max()`-ed with `directK`
  on the chip's cascade reach; `ULTRA.overlayReleaseStartSin` +0.2°, `overlayReleasePow` 0.9) and
  ruling (b)'s slid field band SUPERSEDED back to the disc (`shadowReleaseStartSin` at its
  identity): §17.2's four arms showed the ShadowMaterial's per-cascade mask product
  (`opacity × (1 − (1 − field)³)`) zeroes the overlay wherever the field is 0, so no field band
  could reach the −0.5° rung. Ladder `--ultra 1` **19/19, T66 4.23 → 1.48** (series 67.4 68.4 68.6
  70.1 71.5 73.0), `--ultra 0` 19/19 byte-identical, charter 84/85, ultra 30/30, sweep 13/14 (T103).
  **T105** (the ladder's positionals wrote shots into `./--ladder`) fixed. Session n's ship had
  ABORTED (load-flaky `bestSpotHonesty` timeouts, now 60 s) — both sessions ship together.
  **The iPhone RE-MEASURED on Device Farm (§19):** orbit / city / everest 9–13 fps → 60 / 50 / 60
  at `mid`, 3–4 ms CPU (T79 reached the phone); `/m` 26 ms CPU of its own; **T83 REPRODUCED**
  (the ramp's first step kills the `#f=` page; T80's −245 MB did not move it) — the console
  session `…/ed840495-…/00000` decides kill vs hang; the Pixel was not attached (owed). **The
  streaming columns (§20)** in the descent leg: all 22 hitches are parse-phase with `frame.cpu`
  5–11 ms → the time is outside the orchestrator; `probe-cpu-profile` over the leg decides
  lever 10. vitest 2,761/175 · astro 0/0/10 · knip 0. Backlog T1–T105.
- **2026-09-06n (`mem:project/wip-2026-09-06-t77-five-rulings`):** the five rulings executed. T80 CLOSED
  + T104 (`dt−gpu` column; the T77 gate on dt p50 ≤ 15, MET 14.2) · **T101 DONE** (per-cell
  `deepPending`: arrival rejections +39,629 → +2) · **T92 DONE** (fill fades on live tilt 50→70°) ·
  **T93 RE-CLASSIFIED** (far TERRAIN hazed dark by the directional in-scatter lobe — not the earth)
  **and fixed** (`ULTRA.limbStartM/limbEndM` 40/120 km in the shared aerial fn; band 84–89 → 149–153)
  · **T100 built as ruled, gate NOT met** (T66 4.94 → 4.23; A/B 4.67/3.82; the rise is the OVERLAY
  retiring with directShareK — owner call, `NEXT_SESSION_PROMPT.md` §OWNER CALL). vitest 2,748/175
  · astro 0/0/9 · knip 0. Backlog T1–T104.
- **2026-09-06l (`mem:project/wip-2026-09-07-t77-e1-e2-t80h`):** E1 + E2 run → lever 2 and A1 CLOSED
  (with E3, slice A is complete). **T80-h SHIPPED — `BLOOM.path` "fused"** (`ScaledBloomPass.deferBlend`
  + `scene/fusedOutput.ts`; the brief's "blur at full res" premise was false, the lever removed the two
  full-res draws): fpv `high` DPR 2 **frame time 19.2 (pre-T80g) → 14.2 ms**, ULTRA 21.0 → 15.9; pixels
  ≤ Δ2 on 0.13–0.79 %, none > 3. T99 closed. **T104: `frame.gpu` over-counts pass-heavy chains** (a
  6-pass drop read −6.6 ms gpu, 0.0 dt) — read the T77 GPU gates on dt p50. Gates: vitest 2,716/2,716
  (173) · astro 0/0/9 · knip 0 · charter 84/85 (T100) · uxbatch4 16/16 · sweep 11/14 self-check (T103 +
  two freeze gaps). Backlog T1–T104. **OWNER RULINGS 2026-09-06m — all five recommended options
  accepted:** T80 (a) close as a frame-time lever + T104 re-state the gates on dt · T100 (b) band
  start ~+0.2° · T101 (a) per-cell `deepPending` · T92 (a) fade the cone's fill, keep the rays ·
  T93 (a) tint the limb to the haze. Execution order + gates: `NEXT_SESSION_PROMPT.md` §OWNER RULINGS.
- **THE RESOURCE BUDGET (owner order 2026-09-06j, standing):** session j ran six worktrees × (`wix dev`
  + headless Chrome + agent) on the 36 GB M3 and FROZE THE MACHINE (120 GB swap; another research
  session died too). Now machine-checked: ONE house headless Chrome, ONE dev server, free ≥ 20 %
  (`scripts/verify-chrome.mjs` exit 3 · `ensureBrowser()` throws · `scripts/resource-watchdog.mjs`);
  agents NEVER launch Chrome / a dev server / the full vitest / `astro check`; worktrees = edit
  isolation only. `conventions/verify.md` §THE RESOURCE BUDGET · `mem:project/dev_environment`.
- **T77 six slices INTEGRATED on master 2026-09-06k** (`mem:project/wip-2026-09-06-t77-six-worktrees`):
  BASE (T96 `ULTRA.baseTakesLook` + `lookOn()`, ruling 3, T66) · C-1 (5a/5b/5d/5e + deep resample,
  `lib/globe/seatQuiet.ts`) · T80-g (`scene/resolvedComposer.ts`, rt1 demoted −195 MB) · A-rest
  (5-lever `shadowRig()` seam, `--arms`) · T94 (`lib/globe/frameFreeze.ts`, sweep `--freeze`) · 4 sheet
  probes. Unit gates **2,692/2,692 (172 files)** · astro 0/0/9 · knip 0. Browser gates RAN (k2,
  once the owner's Proton VPN routed around a Cesium 403 that blocks the Dnipro ISP address — T98;
  **the VPN is a precondition for every terrain gate**, `mem:project/dev_environment` §NETWORK): ladders 18/18 off · 17/18 on (T100 release
  band) · charter re-pointed · ultra 30/30 · base `fpv.u0` churn 0.184 → **0.0000** · `frame.cpu` at
  the FPV eye **4.4 → 0.7 ms** · T80-g **−2.7 ms** GPU (22.5 → 19.8; gate ≤ 15 unmet → T80-h the
  blur) · T94 **14/14 byte-identical** · E3 CLOSES lever 12 · T92 = focal cone fill · T93 = base
  earth limb. Tails: T100 (band), T101 (arrival rejections +39,629), T102 (fly after thaw).
- Trap: after any large landing restart `wix dev` with `node_modules/.vite` moved aside — every
  island 504s otherwise. Backlog now T1–T99.
- **T77 RESUMED and four slices landed in one session** (2026-09-06h, `mem:project/wip-2026-09-06-t77-resume-harness-sunset`):
  T80 measured (a half-res bloom recovers 1.6 of 13 ms — moot; the cost is the full-res blend into
  the MSAA buffer), slice A A0–A3 (demand-driven cascade 0, ULTRA-on / base-identity; the shimmer
  reframed: the light FRAME rotates, not the box), slice B (the 8.3 cm stall gone, dt eases,
  per-tile memo, collapses 4,277 → 0), the sunset release fixed ULTRA-only (×5.22 → ×1.16).
  **Every harness now draws poses from the owner's catalogue `scripts/lib/poses.mjs`** and
  `verify-visual-sweep.mjs` makes contact sheets — the standing order for all sessions.
  Owner rulings 2026-09-06i ALL YES: T96 (the base rig takes the ULTRA light/shadow model), T66
  (flatten the rises through 0°), the A2 cadence. Next session = six worktrees (BASE · C-1 · T80-g ·
  A-rest · T94 · sheet defects), `NEXT_SESSION_PROMPT.md`. MEASUREMENTS §14.
- **MESH SUITE CLOSED 2026-09-05b** — MS0–MS8 shipped (gizmos, world-synced building overrides, user
  models); `MESH_SUITE_PLAN.md` §4a, the no-regression contract, stays binding.
- **BEST SPOT PARKED 2026-08-27** (owner 2026-09-01: sufficient as implemented) · **Phase 7, AI shot
  analysis, PARKED 2026-08-11** — out of every plan, no AI code in `src/`.
- **RELEASE GATE: prod is DARK** until the owner's GoDaddy nameserver fix → Wix www TLS → OAuth
  allowlist gains `plux.today` → `wix release`. T2 canaries and T50 ride it.
- Gates 2026-09-06h: vitest **2,584/2,584** (167 files) · `astro check` **0/0/9** · knip **0**.
- DECISIONS compaction **round 5** ran 2026-09-06g: verbatim 08-21→09-05 → `DECISIONS_ARCHIVE.md`
  §Moved 2026-09-06; digests in DECISIONS §Per-phase digests.
- The one debt registry: `.claude/skills/frame/references/tracked-backlog.md` (T1–T105).

## Next step — T77 after the phone/descent profiles (full brief: `NEXT_SESSION_PROMPT.md`)
1. **DECISIONS compaction round 6 FIRST** (§Recent 137 KB > 135). Then boot: VPN on the Mac AND the
   phone (the Pixel fetches ion over its own network), ion curl, `--budget`, ONE Chrome, `wix dev`
   with `.vite` aside, the pre sweep; the ship hook fires on `/clear` — wait for it.
2. Nothing is blocking. Next in order: **T83's lever — the `pagehide` release** (dispose the
   renderer, unload the three LRU caches, drop the 8k images; measure with
   `probe-memory-footprint --sequence fpv,m,fpv`, then ONE farm session `--poses fpv,fpv --ramp 0`) ·
   **T106** (the enriched cell's `load-model` work on phones: bake or slice; `probe-cpu-profile --leg
   descent --device`) · the iPhone's `/m` after T107 (one farm session) · `compileAsync` (two compile
   frames at the descent's start).
3. (Superseded 2026-09-07a — the streaming measurement's first read is §20.) The streaming measurement (descent-leg per-frame CSV) that gates levers 9–11; then the phones
   — RE-MEASURE first (T79/T80 never read on a phone; §11's orbit poses were 9–13 fps CPU-bound),
   then T83, then slice D (14–16, NOT STARTED). Standing table: `NEXT_SESSION_PROMPT.md` §Where T77
   stands. Tails: T93's FPV wedge, T102, T103.
**Constraints:** no regression of behaviour, accuracy, calculations, plans, predictions or sky
features · `high` byte-identical · ULTRA off-state exact · `ENGINE_STATE_2026-09-02.md` §8 harness
list per slice · DNIPRO slice first (owner 2026-09-02c) · the audit is read-only.
**Instruments** in `scripts/`: `lib/poses.mjs` + `verify-visual-sweep.mjs` (the catalogue + sheets),
`verify-perf-baseline.mjs`, `verify-temporal-stability.mjs` (`--rig`, `--step`), `verify-ultra-dusk.mjs --ladder`,
`probe-seat-loop.mjs`, `probe-shadow-rig.mjs`; DEV seams `__debugFeed`, `__globe.seatSettle()`,
`__globe.shadowRig()`, `__globe.enrichedCellSeats()`, `__quality.bloomScale()`.
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
- **Docs + memory hygiene sweep (09-06g)** · 09-06-docs-hygiene
- **T77 RESUMED: catalogue + sweep, T80, slices A/B, the sunset fix (09-06h, HOT)** ·
  `rendering/SUNSET_LIGHTPATH_2026-09-06` · MEASUREMENTS §14 · 09-06-t77-resume-harness-sunset
- **T77 six worktrees: the crash, the retrace, the gates (09-06j/k/k2)** · MEASUREMENTS §15 ·
  09-06-t77-six-worktrees
- **T77 E1/E2 closed + T80-h fused bloom + T104 GPU-timer finding (09-06l, HOT)** · MEASUREMENTS §16 ·
  `mem:project/wip-2026-09-07-t77-e1-e2-t80h`
- **T77 the five rulings executed: T80/T104, T101, T92 done; T93 re-classified + fixed; T100 built, gate
  unmet → owner call (09-06n, HOT)** · MEASUREMENTS §17 · `mem:project/wip-2026-09-06-t77-five-rulings`
- **T100 CLOSED (a): the overlay's own extinction tail; the (b) band superseded; T105 (09-07a, HOT)** ·
  MEASUREMENTS §18 · `mem:project/wip-2026-09-07-t100a-overlay-tail`

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
