# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`): a Wix headless Astro 5 app that projects a photo, from its
EXIF, as a camera frustum at its capture location on a stylized 3D globe with real OSM buildings under a real
ephemeris sky. Client-heavy; Wix is the thin backend. Owner: Yevhen. Repo `headless-frame-the-world` — the repo
name only, never the product; never rename the `ftw:*` keys or the `uFtw*`/`FTW_*` shader ids (`brandFence.test`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` → the code (Serena →
Grep → Read) → Wix MCP for platform APIs. **One writer per fact:** session narrative lives in the `project/wip-*`
leaves and in `DECISIONS.md`; this root only indexes and states the current status (cap 12 KB — compact, never grow).

## Status — 2026-09-18 (`mem:project/wip-2026-09-18-mobile-fixes-signout`)
**THREE /m FIXES + THE SIGN-OUT ROOT CAUSE, LIVE as v1.36.14** (ship `b3270cd` = PR #127). `MOBILE2D.bootAltM` → 18,000 km (the
bare `/m` boots on the whole planet) · the FPV rail: ▤ PLACES is a 44 px icon cell between ◎ SAVE and ✕ EXIT VIEW (last, always),
fpv.css lifts the altitude column's seat 52 px via `body.m:has(.m-act--places)` · SIGN OUT: the live host's adapter
gives Astro an `http:` request URL, so `checkOrigin` 403s every form POST → `signOut()` → JSON `POST /api/signout` →
`location.assign(logoutUrl)`; RULE: no `<form method=post>` in this app. Harness `verify-mobile-fixes-2026-09-18.mjs`
ALL PASS in dev and LIVE (39; `FTW_APP_URL` = the live twin).

## Status — the recent eras (one line each; the leaves carry the numbers)
- **2026-09-17 AUDIT #4 triaged + fixed under the owner's filter** (`wip-2026-09-16-audit4-triage-fixes`): the exact
  `3d-tiles-renderer` pin + `libraryPin.test`, the LOOK-aware skyBudget twin, ghosts/target far-pinned, the journal forgets a
  deleted model, GLB retry, the RC9 seat bank LRU-bounded, SIGN OUT in the /m menu (the form that 2026-09-18 replaced), DECISIONS
  compaction r7, the GUIDE refreshed; public-exposure / load / multi-user DEFERRED (T138/T139/B2). NOT done by choice: the
  stars' far pin, J2, J3 (owner taste) · F3/F6 · T145 · the /m model-edit check.
- **2026-09-16 the mobile UX batch → v1.36.11 LIVE** (`wip-2026-09-16-mobile-uxbatch-menu-pinch-scale`): the
  finger-proportional pinch (`CONTROLS.pinchZoomGain` 0.75 — the one knob once the owner feels it), the peek
  rise/set + long-press aim, the PLUX logo menu + the HUD on the strip, scale bars; `release.sh` resolves Node ≥ 22.
- **2026-09-11 AUDIT #4** (`wip-2026-09-11-audit4`; report `audits/audit-full-2026-09-11.md`): 6 MAJOR · 37 MINOR ·
  13 NIT; T32/35/36/37/39 closed; T136–T144 opened.
- **2026-09-10 T123 fixed + the release gate lifted + the rendering interlude + the cache ruling**
  (`wip-2026-09-10-{t123-lever-a-detached-release,interlude-render-quirks}`): levers (a)+(d), farm alive 8 cycles;
  `www.plux.today` live; T131–T134; ULTRA 1400 / desktop 600 MB ground caches.
- **2026-09-06o → 09-09 the T77 lane** — the four era rows at the end of the Era index; DECISIONS §Per-phase
  digests has each; verbatim in the archive §Moved 2026-09-17.

## Standing facts (2026-09-18)
- Gates: vitest **3,153 / 212 files** · `astro check` **0/0/12** (the hints are the dated baseline) · knip **0**.
  Three timing tests flake under load (`bestSpotSolver`, `bestSpotResidency`, `planFeed`) — re-run before believing.
- `package.json` **1.36.15** (each ship bumps the patch); live **v1.36.14** (2026-09-18). Release: `npm run release:full -- -c "…"`.
- **No `<form method=post>` anywhere** (2026-09-18): the live adapter's request origin is `http:` → `checkOrigin` 403s every
  real form POST (dev never runs the check). Writes are JSON fetches; sign-out is `/api/signout` + a top-level navigation.
- **THE RESOURCE BUDGET** (owner 2026-09-06j, machine-checked): ONE house headless Chrome (:9333), ONE dev server
  (:4321), free memory ≥ 20 %; agents never launch Chrome / a dev server / the full vitest / `astro check`; browser
  suites run from the main session, queued on the one Chrome. **T98: the VPN is a precondition for every terrain
  gate** (ion 401 = ok, 403 = blocked). Close the house Chrome after the last suite; never touch the owner's :9222.
- `wix dev`: move `node_modules/.vite` aside on a restart (T14) and expect to restart TWICE (a lazily imported dep
  chunk 404s once); `Failed to fetch dynamically imported module` — `curl` the module first (500 = a real error).
  CDP harnesses: `~/.nvm/versions/node/v24.10.0/bin/node` (Node 20 lacks the global WebSocket).
- The debt registry: `.claude/skills/frame/references/tracked-backlog.md` (**T1–T145**, every row dated).
- PARKED by owner order: Phase 7 AI · BEST SPOT's algorithm (T59) · the registry's parked rows (T1 T29 T31 T42
  T46 T47 T50–T52 T56 T57 T113) · the public-exposure class (T138/T139) until public launch.

## Next step
The pre-audit main plan: the farm FEATURE legs (`tools/devicefarm/ios-baseline.mjs --legs`; the recipe is in
NEXT_SESSION_PROMPT) · the T77 lane (`applyFeatureSeats` 461 ms, the ephemeris in the hitches, the ~900 mesh-raycast
calls per frame) · T145 (`useLongPress`) · the /m model-edit check · three stale guide shots (`shell-m`, `fpv-m`,
`fpv-map`). Watch: the renderer's ~35 MB/cycle creep if the owner's iPhone dies past 8 cycles.

## Era index
One row per era, oldest first (`07-13-terrain-reseat` = `mem:project/wip-2026-07-13-terrain-reseat`; braces expand).
Digests: DECISIONS §Per-phase digests; verbatim: `DECISIONS_ARCHIVE.md` §Moved dividers r2 2026-08-15 · r3 08-18 ·
r4 08-22 · r5 09-06 · r6 09-07 · **r7 2026-09-17 = 09-06o → 09-10f**.
- Phases 1–4 scaffold/globe/decode/projection/ephemeris (07-09→10) · 07-10-*
- Phase 5 members/pins + 5.5 S1–S7 (07-10→12) · `archive/PHASE_5_5_UX_BATCH` · 07-11-* · 07-12-readme-rewrite
- Rendering passes + Dnipro enrichment 0–3 + illumination (07-12→14) · 07-12-rendering-* · 07-13-* · `dnipro-enrichment/`
- OSM2World + R2 + obstruction moat + seating/UI (07-14) · 07-14-*
- Docs reorg + Phase 6/6.9 marketplace + St Albans + view prefs (07-15→21) · 07-{15,16,17,18,21}-*
- Astro engine A–E + comet 10P (08-02→10) · `archive/ASTRO_ENGINE_PLAN` · 08-{02,03,10}-*
- AUDIT #1 + slices + Phase 8a + planning core (08-13) · `audits/audit-full-2026-08-13` · 08-13-*
- Mobile M0–M3 `/m` shell (08-11→14) · `MOBILE_PLAN` · 08-11-mobile-design · 08-13-m* · 08-14-mobile-m3*
- Planning QoL + FIND v2/v3 + sunsets-in-frame (08-14→15) · 08-14-* · 08-15-sunsets-in-frame
- Owner UX batches + guide G1 (08-15) · 08-15-{ux-batch,uxbatch2,guide-g1} · `archive/GUIDE_PLAN`
- P7 meteors + UPLIFT U1–U8 (08-17→19) · `UPLIFT_PLAN` · 08-17-* · 08-18-u*
- AUDIT #2 + fix slices (08-18) · `audits/audit-full-2026-08-18` · 08-18-audit2*
- Owner UX #2/#3 + PLUX launch grooming (08-19) · 08-19-*
- Owner batches #4–#6 + QA slices (08-21→22b) · `archive/UXBATCH4_PLAN` · 08-21-*
- AUDIT #3 + micro-slice + F1–F10 (08-22a→e) · `audits/audit-batchseams-2026-08-22` · 08-22-{owner-microslice,audit3*}
- GUIDE FINAL + owner 3-slice (08-22f→i) · `GUIDE_FINALIZATION_PLAN` · 08-22-{guide-final,owner-3slice} · 08-27-guide-bestspot-eclipses
- ULTRA + eclipses + dusk (08-22j/k, 08-27b/c) · `ULTRA_PLAN` · 08-22-{ultra-track,eclipses} · 08-27-{ultra-render-batch,dusk-taste-pass}
- BEST SPOT S1→S7, PARKED (08-23→27d) — start at `bestspot/README.md` · 08-23/24/26/27-bestspot-*
- Formal verification, Lean 4 (08-24d) · `FORMAL_VERIFICATION` · 08-24-*
- BRAND: PLUX (08-25) — `brandFence.test.ts`; DECISIONS 2026-08-25
- RENDERING CHARTER RC0–RC30 (08-25b→26d) · `rendering/RENDERING_CHARTER_2026-08-25` · 08-25-* · 08-26-*
- REGION #4 Chernobyl built → deleted (08-26b→09-02e) · 08-26-chernobyl-region
- DBG chip (09-01) · `DEBUG_HUD_PLAN` · 09-01-*
- MESH SUITE MS0–MS8 (09-01b→09-05) · `MESH_SUITE_PLAN` (§4a binding) · 09-01-mesh-suite-plan · 09-02-mesh-suite-* · 09-03-* · 09-05-model-pitch-roll-ms8
- T77 MEASURE → phones → slice 0 (09-05b→09-06f) · `rendering/T77_AUDIT_PLAN_2026-09-05` + `MEASUREMENTS_2026-09-05` · 09-05-t77-* · 09-06-t77-phone-baseline-slice0
- Docs hygiene + T77 resumed + six worktrees + E1/E2 + the five rulings (09-06g→n) · 09-06-docs-hygiene · 09-06-t77-* · 09-07-t77-e1-e2-t80h
- T77 tail: T100 (a) · phones · T83 · occlusion audit + rulings · T106 (09-06o→09-07f) · 09-07-{t100a-overlay-tail,t77-phones-lever10,t83-pagehide-occlusion-audit,occlusion-rulings-t106,t106-*}
- Two mobile features · lever 11 · app version · T118/T119 (09-07g→09-08) · 09-07-{mobile-bestspot-ar,lever11-vtile-worker} · 09-08-pixel-reads-version-t118
- Mobile UX batch · regressions + lever 8 · T126/T129/T130 (09-08b→09-09b) · 09-08-{mobile-uxbatch-heatmap-gestures,regressions-pixel-lever8} · 09-09-t126-t129-t130-lever8-pixel
- T123 fixed · release gate lifted · rendering interlude · cache ruling (09-10→10f) · 09-10-{t123-lever-a-detached-release,interlude-render-quirks}
- AUDIT #4 (09-11) · `audits/audit-full-2026-09-11` · `audit4-2026-09-10-charter` · 09-11-audit4
- Mobile UX batch → v1.36.11 (09-16) · 09-16-mobile-uxbatch-menu-pinch-scale
- AUDIT #4 triage + fixes + docs/guide refresh (09-17) · 09-16-audit4-triage-fixes
- Three /m fixes + sign-out root cause → v1.36.14 (09-18) · 09-18-mobile-fixes-signout

## Graph index — every memory except the era leaves
- top level: `memory_maintenance` (rules + caps) · `suggested_commands` · `task_completion` · `tech_stack` ·
  `architecture/system-overview`
- `decisions/` — `adr-000-locked-stack` · `session_workflow` the persistence loop · `session-end-autoship`
- `patterns/` — `globe-rendering` · `photo-frustum` · `upload-flow` · `members-pins` · `design-system` ·
  `sky-bodies-terrain` (ground half SUPERSEDED)
- `bugs/` — six fixed defects + `ground-checkerboard-flicker` **OPEN** (read before touching that area)
- `project/` non-leaf — `wix-platform` · `wix-site` · `dev_environment` · `audit{2-2026-08-18,4-2026-09-10}-charter` ·
  `owner-orders-2026-08-14-qol-batch` · `wip-2026-09-06-docs-hygiene`

## Source layout (2026-09-18)
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable; contract in
  `conventions/globe-tuning.md`) · `scene/` attach-modules · `StylizedTiles.ts` orchestrator · `GlobeCanvas.tsx`.
  Design imports NEVER touch it.
- `src/components/` — `panels|ui` desktop chrome · `mobile` the `/m` shell · `controls` shared input instruments
  (a pure leaf: react + stores + `lib/**` + `globe/tuning`; `test/components/mobileFence.test.ts`).
- `src/lib/` — decode, geo, ephemeris, sky, globe, models, edit (the journal), guide, pins, photo, export, market,
  save, wix, theme, format, api (`http.ts` server-only; `dataFetch.ts` client), textures, sensors, `prefs.ts` ·
  `src/store/` zustand · `src/pages/` `index.astro`, `m.astro`, `guide.astro` + 12 thin `api/*` routes (`signout.ts` is the newest) · `test/` 210 files.

## Key invariants (violations = bugs)
- The globe is `client:only` — never SSR WebGL (C4). Decode in a Web Worker. Astro 5 only. `3d-tiles-renderer`
  EXACT 0.4.28 (nine patched seams; `libraryPin.test.ts`).
- Never fabricate a Wix API signature — verify through Wix MCP. Endpoints thin (C1); admin calls `elevate()`.
- Stylize tiles by material swap on `load-model`; on ground tiles CHAIN `onBeforeCompile`. Colour flows through
  `lib/theme/tokens.ts` (D14); design imports write only under `panels|ui|controls` + `styles`.
- C6: a public pin never carries exact GPS (tiers exact / 1 km / city, `lib/geo/precision.ts`).
- Scene modules never read stores directly (`fences.test.ts`). A `let` that `sampleEphemeris` writes must be
  declared above its module-init call (the TDZ trap, DECISIONS §Traps).

## Authority
`PROJECT_SEED.md` §3 (C1–C6) and §4 (ADR-000, D1–D15) are binding. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth. Rules: `.claude/conventions/`. Workflow: the `/frame` skill.
