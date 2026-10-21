# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`): a Wix headless Astro 5 app that projects a photo, from its
EXIF, as a camera frustum at its capture location on a stylized 3D globe with real OSM buildings under a real
ephemeris sky. Client-heavy; Wix is the thin backend. Owner: Yevhen. Repo `headless-frame-the-world` — the repo
name only, never the product; never rename the `ftw:*` keys or the `uFtw*`/`FTW_*` shader ids (`brandFence.test`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` → the code (Serena →
Grep → Read) → Wix MCP for platform APIs. **One writer per fact:** session narrative lives in the `project/wip-*`
leaves and in `DECISIONS.md`; this root only indexes and states the current status (cap 12 KB — compact, never grow).

## Status — 2026-10-22 (`mem:project/wip-2026-10-21-facade-flow-f1-f3`)
**THE FULL DESKTOP FACADE FLOW — F1 the gizmo · F2 persist · F3 residency + T171 K slots: BUILT, GATED (vitest 3,626 / 236 · astro 0/0),
F1 BROWSER-VERIFIED on dev (9/9), the K-slot material 10/10 on the 2026-10-18 harness; RELEASED v1.36.33 (ship `ab4a87b`, behind
`?facade=1`) and the persistence half PROVEN LIVE — `verify-facades-live.mjs` 11/11 incl. the deployed UI re-opening a saved row
(DECISIONS 2026-10-22 release records). Not proven live: the residency's pixels (no seams on the prod build) — the owner's read.** The gizmo (`scene/facadeGizmo.ts` + `lib/globe/facadePose.ts`: rotDeg = −heading, gains 0.5 by re-placing the
rig, every scale box = the H-FOV OVERRIDE `facadePhoto.hFovDeg`, capture-phase listeners on the canvas's parent + `guardRaycast`), the persist
pair (`FacadePhotos` 36 fields LIVE · `/api/facades` · upload-url kind `facade` · `store/facadeSave.ts` · MY FACADES in the overlay), the
residency (`store/facades.ts` + `lib/globe/facadeResidency.ts` + `scene/facadeMarkers.ts`; the orchestrator feeds K−1 saved slots to the
projector's pool, draft first). **T173: `wix dev` cannot elevate (WDE0027 on every ADMIN collection — the app's client-credentials token has
no permissions; live is fine) — persistence harnesses run on the LIVE site until the owner fixes the OAuth app.** Next: the owner's read of
the gizmo feel + the live save flow → F4 textures (T170) → F5 alignment (T172) → the mobile twin.

## Status — 2026-10-18 (`mem:project/wip-2026-10-18-photo-projection-prototype`)
**THE PHOTO PROJECTION PROTOTYPE (the photo flow (b)) — BUILT, GATED, BROWSER-VERIFIED; desktop-only behind `?facade=1`; NOT released (DECISIONS 2026-10-18). Owner 2026-10-21: "looks promising" → the full desktop flow is PLANNED (`rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md`, T169–T172; DECISIONS 2026-10-21). Rulings: release HOLDS until save + edit/remove (F2); desktop may spend 100+ MB of GPU on live photos, mobile/iPhone must not degrade (the projector stays behind `hqAllowed`).**
A facade photo (`store/facadePhoto` — the technical twin of the upload store, never a pin) is projected onto both building tilesets' shared fill
material from its pose with occlusion from a depth map rendered at the pose (`scene/photoProjector.ts`; the `uFtwProj*` block in
`buildingMaterial.ts`; `PHOTO_PROJECT`). **The decisive finding:** three uploads a non-ShaderMaterial's uniforms only on a material/program/
camera switch — a per-mesh `onBeforeRender` write reaches the first mesh of a run only (T165; the triage's per-draw matrix is impossible) →
the shipped route is ONE per-PASS matrix VIEW space → photo clip (`bias·P·V × camera.matrixWorld`, float64, in `fillMat.onBeforeRender`) on
`-vViewPosition`: zero new varyings, 3.2e-7 vs 4.2e-3 uv float32 error (machine-checked). UI: `panels/FacadePhotoFlow.tsx` (the `.uf.ff`
overlay + the `.pd.ff-panel` panel: heading/pitch/roll/focal/altitude, the N/S/E/W nudge, PROJECT · STRENGTH · OWN LIGHT · PLANE).
Harness `verify-photo-projection-2026-10-18` **10/10** (the pattern paints with the right orientation; a 2 m nudge → 1.999 m; frame cost p95
16.7 vs 16.7 ms; the pin flow untouched). Found + recorded: the instant-cut landing lifted to ~23 km by `adjustHeight` on a coarse tile
(pre-existing on pins — T166; the facade flow got `stepFacadeArrival`). Rulings: the building shade + day/night and the yaw lock are OK.

## Status — the recent eras (one line each; the leaves carry the numbers)
- **2026-10-14 AR CALIBRATION: the drag yaw-only by default · ↕ PITCH frees both axes → v1.36.30 LIVE, farm-verified on the iPhone 17 Pro**
  (`wip-2026-10-14-ar-calibration-yaw-lock`): `gateAimDelta`, `camera.arCalAxes` reset per visit, the fourth cell at the top of the verdict
  column; `verify-ar-calibration` 74/74; the farm arms AR with a NATIVE tap (a WebDriver click is no user activation); the owner's read: fine.
- **2026-10-13 THE STICKY BOX · THE DAYLIGHT PASS · BUILDING COLOUR rung 1 → v1.36.28 LIVE, farm-verified**
  (`wip-2026-10-13-collision-lighting-building-colour`): `lib/globe/fpvClearance.ts` v2 (the 0.5 × 0.3 × 2 m box, walls block the walk, no
  bounce), the lighting ledger 36 % near-black → 0 % (sky-lit shadows, the day fill `tokens.buildingDay`), `BUILDINGS.hueVariation` 0.22;
  the triage `rendering/BUILDING_COLOUR_TRIAGE_2026-10-13.md` (T158 rung 2 · T159 rung 3 await the owner; T157 BUILT 2026-10-18).
- **2026-10-10 THE OWNER'S DEVICE FEEDBACK → v1.36.26 LIVE, farm-verified on the iPhone 17 Pro** (`wip-2026-10-10-mobile-fixes-radar-find-keyboard`):
  the radar on glass (`radarStroke` in screen CSS px; the mini-map store = the glass), FIND THIS ONE + the range chips (`find.soloBody`),
  the keyboard lift (`mobile/Sheet` rides `bottom: <visualViewport inset>`, POLLED through focus — iOS 26 sends no resize); the farm
  tests the LIVE site (`--prod`, T155).
- **2026-09-30 ALIGN out · the pin follows the walker + the re-centre target · user models: the far law + the eye-centred cover →
  v1.36.23 LIVE** (`wip-2026-09-30-align-minimap-pin-mesh-culling`): `lib/globe/pinFollow`, `MODELS.fpvFetchRadiusM` 16 km,
  `planResidency` + `apparentFrac` + `inViewCone`; open: the pin follow with the map closed? the far thresholds on the phones (T153)?
- Older eras (AR calibration 2026-09-19, the sign-out root cause 2026-09-18, AUDIT #4 triage 2026-09-17 and before): the Era index below.

## Standing facts (2026-09-30)
- Gates: vitest **3,424 / 227 files** · `astro check` **0/0/27** (the hints are the dated baseline) · knip: only the four
  pre-existing `normalizeModel` exports.
  Three timing tests flake under load (`bestSpotSolver`, `bestSpotResidency`, `planFeed`) — re-run before believing.
- `package.json` **1.36.33** (each ship bumps the patch); live **v1.36.33** (2026-10-22, ship `ab4a87b` — the facade flow F1–F3 behind `?facade=1`; before it v1.36.30, 2026-10-14, `e5edaac` PR #143). The release comment is capped at 250 BYTES. Release: `FTW_SHIP_DAEMON=1 npm run release:full -- -c "…"` (~5 min; background it); `release.sh` + the provisioner use the PINNED CLI (`node_modules/.bin/wix` — `npx @wix/cli@latest` refuses Node < 24.18 since 2026-10-22). **`wix dev` cannot elevate (T173, WDE0027 on every ADMIN collection)** — persistence is proven only on the live site (`verify-facades-live.mjs`, `verify-live-deletes.mjs`).
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
- The debt registry: `.claude/skills/frame/references/tracked-backlog.md` (**T1–T168**, every row dated).
- **Never write a per-draw uniform from `mesh.onBeforeRender`** (2026-10-18, T165): three uploads a non-ShaderMaterial's uniforms per
  material switch, not per draw. Per-PASS values go through `material.onBeforeRender`; per-mesh values are vertex attributes.
- PARKED by owner order: Phase 7 AI · BEST SPOT's algorithm (T59) · the registry's parked rows (T1 T29 T31 T42
  T46 T47 T50–T52 T56 T57 T113) · the public-exposure class (T138/T139) until public launch.

## Next step
**The owner tested v1.36.33 (2026-10-22b) → seven asks, T174–T182, BEFORE F4 / F5:** T174 the SCALE gizmo leaves the projection stale
(`poseChanged` never sees the corners — a bug) → T177 the residency must follow where I LOOK (the painted volume, a distance fade, no hard
clip) → T176 editing in FPV → T175 quick op buttons by UNDO / DROP → T178 camera-icon markers + an edit / remove menu → T182 the TEX toggle
(ON by default; the mobile half meets the `hqAllowed` ruling — the owner's F6 call) → T181 the split Upload dropzone (`?facade` retired) →
T180 the collapsed `Menu` button + My spot into the camera controls → T179 MY PINS → MY CONTENT with a textures tab, bigger window. Then
**T173 (owner): the dev OAuth permissions**, F4 textures (T170), F5 alignment (T172), the mobile twin, T166 · T165 · T167 · T164.
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
