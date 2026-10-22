# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`): a Wix headless Astro 5 app that projects a photo, from its
EXIF, as a camera frustum at its capture location on a stylized 3D globe with real OSM buildings under a real
ephemeris sky. Client-heavy; Wix is the thin backend. Owner: Yevhen. Repo `headless-frame-the-world` — the repo
name only, never the product; never rename the `ftw:*` keys or the `uFtw*`/`FTW_*` shader ids (`brandFence.test`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` → the code (Serena →
Grep → Read) → Wix MCP for platform APIs. **One writer per fact:** session narrative lives in the `project/wip-*`
leaves and in `DECISIONS.md`; this root only indexes and states the current status (cap 12 KB — compact, never grow).

## Status — 2026-10-23 (`mem:project/wip-2026-10-23-owner-asks-build-t187-t191-f6`)
**THE FIVE ASKS + F6 BUILT, gated, browser-verified on dev (desktop + an emulated iPhone) and RELEASED — v1.36.42 LIVE (2026-10-23b);
T190 proven live (leg 7b); PR #155 (the ship) did NOT auto-merge in 45 min with every check green — resolve at boot.** T187 the fade 2 → 3 km (`slotRangeM` 3,000 · `slotFadeFrac` 1/3) ·
T188 the G / R / S hotkeys + the chip's per-op rows (value · was the EXIF pose · ↺ journaled) — THE LIVE FINDING: the chip was ALREADY rendered
on plux.today after MY CONTENT → OPEN, orbit + FPV (the probe had hit the root's `pointer-events: none`) · T189 the saved places = pin-glyph
billboards (hover × 1.4; a click → the clock then the FPV jump at the saved viewpoint; the /m MY LOC icon cell; the map window's re-centre glyph)
· **T190 textures PUBLIC** (GET `?cells=` elevated, no member, no owner filter; MINE / writes gated; the store keeps the world across a sign-out;
proven live by `verify-facades-live.mjs` legs 7b + 9's signed-out pass after the release) · T191 the /m LAYERS modal grid · **F6 VIEW-ONLY:**
`PHOTO_PROJECT_LEAN` (K 2 draftless · 1024² = 11.2 MB · 512-px depth · 2 s cadence · 3 km cover · ×2 markers) via `photoProjectFor(lean)`;
the projector + markers on every tier, the editing surface `hqAllowed`, a tap → `store/facades.peek` → `mobile/FacadePeek` (◎ LOOK); measured
on the emulated phone: frame cost ON p95 9.2 ms vs OFF 9.3. NEXT: F5's remainders (the pure PnP solve `lib/geo/pnp.ts` is in; the pairs UI +
SOLVED storage next) → T184 / T185 · T166 · T165 · T167 · T164.

## Status — the recent eras (one line each; the leaves carry the numbers)
- **2026-10-22g the owner's live read of v1.36.38 → five asks T187–T191 + the F6 order, recorded** (`wip-2026-10-22-owner-asks-t187-t191`):
  the owner's verbatim words + the 10-22h rulings (the fade tail, the place click → FPV).
- **2026-10-22e F4 the photo ARRAY texture · F5 `targetFeatureIds` · T186 → v1.36.38** (`wip-2026-10-22-f4-f5-release`): `slots` 6 ·
  `layerPx` 2048 (every photo stretched to the square layer; 134 MB at K 6) · one `sampler2DArray` `uFtwProjPhotoArr`, `uFtwProjSlot.y`
  = the layer, units 3 + 1 + K · `lib/globe/facadeTargets.ts` + `buildingHit.ts` (the 7 × 5 ray grid, `osm:w<id>` from the b3dm
  batch-table hierarchy; UPDATE writes only a non-empty set) · the FPV jump to the apex · gates 3,741 / 245, four browser suites ·
  released `--skip-gates` right after the ship's gates; live verifiers 11/11 + 17/17 · KTX2 NO-GO for v1 stands.
- **2026-10-22d THE OWNER'S SEVEN ASKS after v1.36.33 — T174–T183** (`wip-2026-10-22-owner-asks-t174-t183`): T174 the SCALE bug
  (`poseSignatureChanged`, 21 floats) · T177 the residency by the PAINTED VOLUME + a per-frame fade (`slotRangeM` 2,000 · `slotFadeFrac`
  0.35 · `slotKeepMarginDeg` 12) · T176 editing in FPV · T175 `FacadeEditChip` · T178/T183 camera-icon markers + hover card + EDIT/REMOVE
  menu · T182 the TEX chip (/m inert) · T181 the split Upload dropzone (`?facade` retired) · T180 the MENU pill, MY SPOT in the camera
  controls · T179 MY CONTENT + the TEXTURES tab. Tails T184 · T185 (owner calls).
- **2026-10-22 THE FULL DESKTOP FACADE FLOW F1 gizmo · F2 persist · F3 residency + T171 K slots → v1.36.33 LIVE behind `?facade=1`**
  (`wip-2026-10-21-facade-flow-f1-f3`): `scene/facadeGizmo.ts` (rotDeg = −heading, gains 0.5 by re-placing the rig, SCALE = the H-FOV
  override, capture-phase listeners + `guardRaycast`), `FacadePhotos` (36 fields) + `/api/facades` + `store/facadeSave.ts`, the K-slot
  material (4 unrolled blocks) + the projector pool; `verify-facades-live.mjs` 11/11 on the live site. **T173: `wix dev` cannot elevate**
  (WDE0027 on every ADMIN collection — the app's client-credentials token has no permissions; live is fine) → persistence is verified LIVE.
- **2026-10-18 THE PHOTO PROJECTION PROTOTYPE (the photo flow (b))** (`wip-2026-10-18-photo-projection-prototype`): a facade photo projected
  onto both building sets' fill material with a depth map rendered at the pose; THE decisive finding = three uploads a non-ShaderMaterial's
  uniforms only on a material / program / camera switch (T165) → ONE per-PASS matrix VIEW space → photo clip on `-vViewPosition` (3.2e-7 uv).
- Older eras (2026-10-14 AR yaw lock → v1.36.30 · 10-13 the sticky box + daylight + building colour rung 1 (T158 / T159 await the
  owner) · 10-10 the radar on glass · 09-30 the pin follows the walker + user-model residency · and before): the Era index below.

## Standing facts (2026-10-23)
- Gates: vitest **3,796 / 250 files** (2026-10-23) · `astro check` **0/0/29** (the hints are the dated baseline) · knip: only the four pre-existing `normalizeModel` exports (re-check after 2026-10-23).
  Three timing tests flake under load (`bestSpotSolver`, `bestSpotResidency`, `planFeed`) — re-run before believing; **a session-end
  ship can abort on them while the next session boots** (2026-10-22e) — read the ship log's tail at boot, ship in the foreground if the
  baseline alone is green (`FTW_SHIP_DAEMON=1 bash .claude/hooks/session-end-ship.sh`).
- `package.json` **1.36.42** (each ship bumps the patch); live **v1.36.42** (2026-10-23b, ship `0bcb7ed` on PR #155 — the five asks + F6;
  before it v1.36.38, 2026-10-22e, `bb7da92` PR #151). The release comment is capped at 250 BYTES. Release: `FTW_SHIP_DAEMON=1 npm run release:full -- -c "…"` (~5 min; background it; `--skip-gates` only right after a ship's gates on the identical tree); `release.sh` + the provisioner use the PINNED CLI (`node_modules/.bin/wix` — `npx @wix/cli@latest` refuses Node < 24.18 since 2026-10-22). **`wix dev` cannot elevate (T173, WDE0027 on every ADMIN collection)** — persistence is proven only on the live site (`verify-facades-live.mjs`, `verify-live-deletes.mjs`).
- **The photo ARRAY (2026-10-22e, T170):** mips / filters / anisotropy are three's texture-cache KEY — set before the allocation, never
  changed after (a change re-creates the GL texture and drops every layer); never `needsUpdate` on the array after the allocation; a
  layer upload regenerates the whole array's mips (~24 ms); `PHOTO_PROJECT.slots` / `layerPx` are read ONCE at attach — PER TIER since F6
  (`photoProjectFor(lean)`; both tilesets compile the same K; `customProgramCacheKey` names K; `draftSlot: false` on the view-only tier).
- **The house Chrome's profile carries EXTENSIONS** (2026-10-23): they throw `factory is not a function` into every page — harnesses drop
  `chrome-extension://` origins (verify.md (b0)); the cleanup can leave the Chrome DEAD — `curl :9333/json/version` before the next run.
  Synthetic rows (places, facades) ride in-page fetch stubs — the stores wipe a poked row on dev's 401.
- **The radar on glass since 2026-10-10:** every stroke in screen CSS px through `radarStroke(mobile)`; a harness that measures it reads the canvas's own pixels along the gap ring (`verify-mobile-fixes-2026-10-10`). **The house Chrome profile keeps a seeded member cookie across harnesses** (T156) — run the signed-out suites before a signing-in one. A SkyTarget carries a method: harnesses import `bodyTarget` in-page from the dev server, never inject JSON.
- **The /m seats since 2026-09-25:** the tab row is 27 px; `.m-actions` 9.6rem · `.m-joy` 10rem · `--m-altcol-bottom-base` 15.2rem —
  a test or harness pinning 10.8 / 11.2 / 16.4rem is stale. `pinchHardening.test` reads the FIRST occurrence of an audited
  selector in a CSS file (a comment above the rule breaks it).
- **User models since 2026-09-30:** the FPV world read is the EYE's 16 km square = 5 `/api/world-models` queries per cover change;
  "resident" = the 3 km radius OR in view + big enough (a harness counting models fulfils the world itself — T154).
- **Every `/api` write goes through `lib/api/dataFetch.jsonWriteInit`** (2026-09-19): a body-less DELETE carries no content
  type and the live origin check 403s it (`jsonWrites.test.ts` fences it; dev never runs the check).
- **No `<form method=post>` anywhere** (2026-09-18): the live adapter's request origin is `http:` → `checkOrigin` 403s every
  real form POST (dev never runs the check). Writes are JSON fetches; sign-out is `/api/signout` + a top-level navigation.
- **THE RESOURCE BUDGET** (owner 2026-09-06j, machine-checked): ONE house headless Chrome (:9333), ONE dev server
  (:4321), free memory ≥ 20 %; agents never launch Chrome / a dev server / the full vitest / `astro check`; browser
  suites run from the main session, queued on the one Chrome. **T98: the VPN is a precondition for every terrain
  gate** (ion 401 = ok, 403 = blocked). Close the house Chrome after the last suite; never touch the owner's :9222.
- `wix dev`: move `node_modules/.vite` aside on a restart (T14) and expect to restart TWICE (a lazily imported dep
  chunk 404s once); `Failed to fetch dynamically imported module` — `curl` the module first (500 = a real error).
  CDP harnesses: `~/.nvm/versions/node/v24.10.0/bin/node` (Node 20 lacks the global WebSocket).
- The debt registry: `.claude/skills/frame/references/tracked-backlog.md` (**T1–T195**, every row dated).
- **Never write a per-draw uniform from `mesh.onBeforeRender`** (2026-10-18, T165): three uploads a non-ShaderMaterial's uniforms per
  material switch, not per draw. Per-PASS values go through `material.onBeforeRender`; per-mesh values are vertex attributes.
- PARKED by owner order: Phase 7 AI · BEST SPOT's algorithm (T59) · the registry's parked rows (T1 T29 T31 T42
  T46 T47 T50–T52 T56 T57 T113) · the public-exposure class (T138/T139) until public launch.

## Next step
**T195 FIRST — the saved-place pins drift / float as the camera moves (orbit + FPV; the owner's live find on v1.36.42) — then finish the
DRAFT ADR `rendering/ADR_BUILDING_TEXTURES_2026-10-23.md` (the evidence is in; the prose + the no-slop pass are owed), then finish the
DRAFT guide chapter BUILDING TEXTURES (verify against the live UI, re-shoot three screenshots, `verify-guide`), then release T193 (the
public copy) · T194 (the 409 retry) · T195, then F5's pairs UI + SOLVED storage on `lib/geo/pnp.ts`.** PR #155 (the ship) awaits the
owner's approval — the codebot's P0 is the T190 ruling. Open tails: the pointer cursor race (recorded), the /m LOOK lands AT the apex, the
lean numbers are an EMULATED read, T192 pagination, T184 / T185.
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
- AR calibration + CAM + gyro-led ladder · the box · delete + white-ground root causes (09-19) · 09-19-ar-calibration-box-meshbugs
- The AR small-screen pass · roll out · the AR guides · instant transitions · the carried pose · the mesh clearance (09-22) · 09-22-ar-ui-rework-fpv-quirks
- The /m UX pass after the iPhone 17 Pro test: ALIGN left, CONFIRM low, see-through sticks, the one-line tab bar, seats −1.2rem (09-25) · 09-25-mobile-ux-pass
- ALIGN out · the pin follows the walker + the re-centre target · user models: the far law + the eye-centred cover (09-30) · 09-30-align-minimap-pin-mesh-culling
- The owner's device feedback: the radar on glass · FIND THIS ONE + the range row · the keyboard lift (10-10) · 10-10-mobile-fixes-radar-find-keyboard
- The sticky box (no bounce) · the daylight pass · building colour triage + rung 1 (10-13) · 10-13-collision-lighting-building-colour
- The AR calibration drag yaw-only by default · ↕ PITCH frees both axes (10-14) · 10-14-ar-calibration-yaw-lock
- The photo projection prototype — the photo flow (b), desktop-only behind `?facade=1` (10-18) · 10-18-photo-projection-prototype
- The full desktop facade flow F1–F3 + K slots → v1.36.33 (10-21/22) · 10-21-facade-flow-f1-f3
- The owner's seven asks T174–T183 built + dev-verified; F4 / F5 deferred (10-22d) · 10-22-owner-asks-t174-t183
- F4 the photo ARRAY texture · F5 the alignment hook (`targetFeatureIds`) · T186 FPV-at-the-apex → v1.36.38 (10-22e) · 10-22-f4-f5-release
- The owner's live read of v1.36.38 → five asks T187–T191 (T190 textures PUBLIC — a ruling) + F6 VIEW-ONLY ordered; nothing built (10-22g) · 10-22-owner-asks-t187-t191
- The five asks T187–T191 + F6 the view-only mobile twin BUILT + dev-verified (desktop + an emulated iPhone) → v1.36.42; the pure PnP solve for F5 (10-23) · 10-23-owner-asks-build-t187-t191-f6

## Graph index — every memory except the era leaves
- top level: `memory_maintenance` (rules + caps) · `suggested_commands` · `task_completion` · `tech_stack` ·
  `architecture/system-overview`
- `decisions/` — `adr-000-locked-stack` · `session_workflow` the persistence loop · `session-end-autoship`
- `patterns/` — `globe-rendering` · `photo-frustum` · `upload-flow` · `members-pins` · `design-system` ·
  `sky-bodies-terrain` (ground half SUPERSEDED)
- `bugs/` — six fixed defects + `ground-checkerboard-flicker` **OPEN** (read before touching that area)
- `project/` non-leaf — `wix-platform` · `wix-site` · `dev_environment` · `audit{2-2026-08-18,4-2026-09-10}-charter` ·
  `owner-orders-2026-08-14-qol-batch` · `wip-2026-09-06-docs-hygiene`

## Source layout (2026-09-19)
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable; contract in
  `conventions/globe-tuning.md`) · `scene/` attach-modules · `StylizedTiles.ts` orchestrator · `GlobeCanvas.tsx`.
  Design imports NEVER touch it.
- `src/components/` — `panels|ui` desktop chrome · `mobile` the `/m` shell · `controls` shared input instruments
  (a pure leaf: react + stores + `lib/**` + `globe/tuning`; `test/components/mobileFence.test.ts`).
- `src/lib/` — decode, geo, ephemeris, sky (+ `screenProject`), globe (+ `fpvClearance`, `smoothFlightsBoot`), models, edit
  (the journal), guide, pins, photo, export, market, save, wix, theme, format, api (`http.ts` server-only; `dataFetch.ts`
  client), textures, sensors, `prefs.ts` ·
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
