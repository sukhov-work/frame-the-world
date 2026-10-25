# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`): a Wix headless Astro 5 app that projects a photo, from its
EXIF, as a camera frustum at its capture location on a stylized 3D globe with real OSM buildings under a real
ephemeris sky. Client-heavy; Wix is the thin backend. Owner: Yevhen. Repo `headless-frame-the-world` — the repo
name only, never the product; never rename the `ftw:*` keys or the `uFtw*`/`FTW_*` shader ids (`brandFence.test`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` → the code (Serena →
Grep → Read) → Wix MCP for platform APIs. **One writer per fact:** session narrative lives in the `project/wip-*`
leaves and in `DECISIONS.md`; this root only indexes and states the current status (cap 12 KB — compact, never grow).

## Status — 2026-10-25 (`mem:project/wip-2026-10-25-mobile-interlude-radar-almanac`; the F5 era: `wip-2026-10-24-f5-pairs-ui-exit-view`)
**THE MOBILE INTERLUDE BUILT, gated (vitest 3,881 / 255 · astro 0/0/29), browser ALL PASS → the owner's T199 ruling ("consistent across all mobile
surfaces") built the same day → SHIPPED + RELEASED on the owner's order (DECISIONS 2026-10-25b + the release line):** (1) the FPV mini-map's radar wears the MAIN MAP's strokes — measured on glass the GL fan's line was ~2× the canvases'
(2.67 / 3.43 css px vs 1.68 / 1.41; the chart ≈ the mini-map): `lib/geo/radarBands.fanStrokeCssPx(viewH, mobile)` mirrors the fan's radius-fraction
quads at the chart's radius rule (2.94 line · 1.47 rim · 3.67 legs on 874 px), the painter's optional `strokeCssPx { line, rim }`, `MiniMap` AND
`MapWindow` hand it on /m (the mini-map ends its radar strokes SQUARE); desktop byte-identical; (2) the peek row's
ALMANAC — ☀ ☾ rise / set permanently beside the object's own pair (dropped when it IS one), U+FE0E text glyphs, the bearings stacked, the row
38.59 vs 38.56 px; the DAY's rise / set with +1 (10-25c) → RELEASED v1.36.48. **RECORDED 2026-10-25e: T200 the moon's perceived visibility** (the
owner's next-session ask — the realistic brightness / colour / contrast against the current sky, Rayleigh + airmass; read the row's READ-FIRST
list; the pure model + a verdict first, the phone budget the hard line). NEXT: the owner's live read → T200 → the ADR's §3.2–3.6 → T198 · T197 · T196.

## Status — 2026-10-24c (the F5 era)
**F5's PAIRS UI + SOLVED storage BUILT (T172's UI half) · the /m EXIT VIEW rides over the open map — gated (vitest 3,862 / 253 · astro 0/0/29),
browser 13/13 on dev → SHIPPED PR #158 `6c945f7` → RELEASED v1.36.45 (2026-10-24d): the SOLVED stamp proven live (leg 8b), the section seen on the
deployed panel; the edge THROTTLES a busy IP after a release (HTTP 429 on chunks + API — pause, one curl, a CDP probe; never a loop); the live
verifier's leg 9 FPV half meets a DATA-API 429 on the MINE read twice (T198 — the harness's tempo + the FPV boot's own reads; the orbit half green).** The FACADE PHOTO panel's ALIGN TO THE BUILDINGS: + PAIR →
the photo full-screen → a click → the same point on a building (orbit or FPV; `castFacadePoint`, `tryFacadePairClick` first on both tap paths) →
SOLVE from 4 pairs (6 releases the lens) = ONE journaled "solve"; the record `alignment = { pairs ≤ 24, origin (the apex at the FIRST pick, fixed),
solved? }` (`lib/geo/facadeAlign.ts`) rides SAVE / UPDATE; the SERVER stamps `poseSource: "SOLVED"` while the pose equals `solved.pose`
(`derivePoseSource`, POST + PATCH). Measured: exact pairs → 0 m / 0° / 0.0 px against the real frustum; ORBIT clicks carry 0.17–0.28 m of world
noise (→ 0.44 m / 0.2° solved), an FPV tap 0.03 m. Escape's ONE owner is the orchestrator. T197 holds the tails (a loupe · real-photo accuracy ·
lever 3 · the slope settle). NEXT: the owner's live read → the ADR's §3.2–3.6 → T197 · T196 · T166 · T165 · T167 · T164.

## Status — the recent eras (one line each; the leaves carry the numbers)
- **2026-10-24 T195 FIXED (the place pins' GROUND SEAT, not the billboard: a coarse-tile latch; `GroundSeat` + `refineGroundSeat`, a seat moves only
  to a STRICTLY DEEPER tile; `PLACEMARKS.liftM` 0.3) · the building-textures ADR FINAL · the guide chapter verified + re-shot · T193 / T194 →
  RELEASED v1.36.43 (2026-10-24b, PR #156)** (`wip-2026-10-24-t195-adr-guide-release`); T196 = the photo pins' same latent latch.
- **2026-10-23 the five asks T187–T191 + F6 BUILT → v1.36.42; the pure PnP solve** (`wip-2026-10-23-owner-asks-build-t187-t191-f6`):
  T187 the fade 2 → 3 km · T188 G / R / S + the chip rows · T189 pin-glyph places, click → FPV · **T190 textures PUBLIC** (proven live) ·
  T191 the /m LAYERS modal · F6 `PHOTO_PROJECT_LEAN` (K 2 · 1024² · 11.2 MB · the tap peek). 2026-10-23e: the drafts kept, T193 / T194 fixed, T195 recorded.
- **2026-10-22e F4 the photo ARRAY texture · F5 `targetFeatureIds` · T186 → v1.36.38** (`wip-2026-10-22-f4-f5-release`): one `sampler2DArray`,
  `slots` 6 · `layerPx` 2048 (134 MB at K 6); the 7 × 5 ray grid; the FPV jump to the apex; KTX2 NO-GO for v1.
- **2026-10-22d the owner's seven asks T174–T183** (`wip-2026-10-22-owner-asks-t174-t183`): the 21-float pose signature · residency by the
  PAINTED VOLUME + the fade · editing in FPV · the chip · camera-icon markers + hover card + EDIT / REMOVE · TEX · the split Upload · MENU · MY CONTENT.
- **2026-10-22 the desktop facade flow F1–F3 + K slots → v1.36.33** (`wip-2026-10-21-facade-flow-f1-f3`): the gizmo, `FacadePhotos` + `/api/facades`,
  the K-slot material. **T173: `wix dev` cannot elevate** → persistence is verified LIVE.
- **2026-10-18 the photo projection prototype** (`wip-2026-10-18-photo-projection-prototype`): ONE per-PASS matrix in VIEW space (T165).
- Older eras (10-14 AR yaw lock · 10-13 the sticky box + daylight + building colour · 10-10 the radar on glass · 09-30 the pin follows the
  walker · and before): the Era index below.

## Standing facts (2026-10-24)
- Gates: vitest **3,892 / 256 files** (2026-10-25c) · `astro check` **0/0/29** (the hints are the dated baseline). Three timing tests flake under load
  (`bestSpotSolver`, `bestSpotResidency`, `planFeed`) — re-run before believing; a session-end ship can abort on them (read the ship log's tail at boot).
- `package.json` **1.36.48**; live **v1.36.48** (2026-10-25d, PR #161 `2420d70` — the DAY's rise / set; v1.36.47 PR #160 the same evening — every /m
  radar surface at the fan's weights + the almanac; before them v1.36.45, 2026-10-24d, PR #158). `verify-facades-live.mjs` is 13 legs (8b = the SOLVED stamp). Release:
  `FTW_SHIP_DAEMON=1 npm run release:full -- -c "…"` (≤ 250 BYTES; `--skip-gates` only right after a ship's gates on the identical tree);
  `release.sh` uses the PINNED CLI (`node_modules/.bin/wix`). **`wix dev` on Node 24.10** (`~/.nvm/versions/node/v24.10.0/bin`), the CDP harnesses too.
  **`wix dev` cannot elevate (T173)** — persistence is proven only live (`verify-facades-live.mjs`, `verify-live-deletes.mjs`).
- **Ground seats (T195, 2026-10-24):** `ground.sampleAt(lat, lon)` answers `{ h, depth }`; a consumer that latches a height KEEPS the depth and
  refuses a shallower answer (`refineGroundSeat`); `heightAt` alone is the old first-answer latch. A street-level eye sees 4.7 km to the horizon.
- **The photo ARRAY (2026-10-22e, T170):** mips / filters / anisotropy are three's texture-cache KEY — set before the allocation, never after;
  never `needsUpdate` after the allocation; K per tier through `photoProjectFor(lean)`; both tilesets compile the same K (`customProgramCacheKey`).
- **The house Chrome's profile carries EXTENSIONS** (`factory is not a function` — harnesses filter `chrome-extension://`); `curl :9333/json/version`
  before a run; relaunch `verify-chrome.mjs --headless --port 9333 --profile /tmp/ftw-cdp` — `release.sh`'s step 7 leaves it DEAD (relaunch
  before the live DOM leg). Synthetic rows ride in-page fetch stubs. The ship hook's `log()` lines go to STDOUT in daemon mode.
- **The radar on glass since 2026-10-10:** every stroke in screen CSS px through `radarStroke(mobile)`; **since 2026-10-25 BOTH /m canvases draw the
  GL fan's weights** (`fanStrokeCssPx`; the mini-map with square ends) — desktop keeps `strokePx`. **The house Chrome profile keeps a seeded
  member cookie** (T156) — signed-out suites before a signing-in one. A SkyTarget carries a method: harnesses import `bodyTarget` in-page.
- **The /m seats since 2026-09-25:** the tab row 27 px; `.m-actions` 9.6rem · `.m-joy` 10rem · `--m-altcol-bottom-base` 15.2rem.
- **User models since 2026-09-30:** the FPV world read is the EYE's 16 km square = 5 queries per cover change; "resident" = 3 km OR in view + big.
- **Every `/api` write goes through `lib/api/dataFetch.jsonWriteInit`**; **no `<form method=post>` anywhere** (the live origin check 403s it).
- **THE RESOURCE BUDGET** (owner 2026-09-06j): ONE house headless Chrome (:9333), ONE dev server (:4321), free memory ≥ 20 %; agents never launch
  Chrome / a dev server / the full vitest; browser suites queue on the one Chrome; close it after the last suite; never touch the owner's :9222.
  **T98: the VPN is a precondition for every terrain gate** (ion 401 = ok, 403 = blocked).
- `wix dev`: move `node_modules/.vite` aside on a restart (T14), expect to restart TWICE; never edit a served `src/` module while a harness runs.
- The debt registry: `.claude/skills/frame/references/tracked-backlog.md` (**T1–T200**, every row dated).
- **Never write a per-draw uniform from `mesh.onBeforeRender`** (T165). Scene modules never read stores (`fences.test.ts`).
- PARKED by owner order: Phase 7 AI · BEST SPOT's algorithm (T59) · the registry's parked rows (T1 T29 T31 T42 T46 T47 T50–T52 T56 T57 T113) ·
  the public-exposure class (T138/T139) until public launch — the textures carve-out (T190) excepted.

## Next step
**The release of 2026-10-24c if it has not run (DECISIONS tells) → the owner's live read of the PAIRS flow + the /m EXIT VIEW over the map → the
ADR's remaining questions (§3.2–3.6: T192 · a real-phone budget · T184 / T185 · KTX2 · a takedown path) → T197 (the loupe first) · T196 · T166 ·
T165 · T167 · T164.** Open tails: the lift 0.3 m, the cursor race, the /m LOOK at the apex, the lean numbers are emulated, real-photo accuracy (T197b).

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
- The /m UX pass after the iPhone 17 Pro test (09-25) · 09-25-mobile-ux-pass
- ALIGN out · the pin follows the walker · user models: the far law + the eye-centred cover (09-30) · 09-30-align-minimap-pin-mesh-culling
- The owner's device feedback: the radar on glass · FIND THIS ONE · the keyboard lift (10-10) · 10-10-mobile-fixes-radar-find-keyboard
- The sticky box · the daylight pass · building colour triage + rung 1 (10-13) · 10-13-collision-lighting-building-colour
- The AR calibration drag yaw-only by default (10-14) · 10-14-ar-calibration-yaw-lock
- The photo projection prototype (10-18) · 10-18-photo-projection-prototype
- The full desktop facade flow F1–F3 + K slots → v1.36.33 (10-21/22) · 10-21-facade-flow-f1-f3
- The owner's seven asks T174–T183 built; F4 / F5 deferred (10-22d) · 10-22-owner-asks-t174-t183
- F4 the photo ARRAY · F5 `targetFeatureIds` · T186 → v1.36.38 (10-22e) · 10-22-f4-f5-release
- The owner's live read → five asks T187–T191 (T190 PUBLIC) + F6 ordered (10-22g) · 10-22-owner-asks-t187-t191
- The five asks + F6 BUILT → v1.36.42; the pure PnP solve; the drafts; T193 / T194 (10-23) · 10-23-owner-asks-build-t187-t191-f6
- T195 the pins' ground seat refines · the building-textures ADR FINAL · the guide chapter verified + re-shot · the release (10-24) · 10-24-t195-adr-guide-release
- F5's PAIRS UI + the SOLVED stamp · the /m EXIT VIEW over the map → v1.36.45 (10-24c/d) · 10-24-f5-pairs-ui-exit-view
- The mobile interlude: every /m radar surface wears the fan's strokes · the peek row's almanac → released (10-25) · 10-25-mobile-interlude-radar-almanac

## Graph index — every memory except the era leaves
- top level: `memory_maintenance` (rules + caps) · `suggested_commands` · `task_completion` · `tech_stack` ·
  `architecture/system-overview`
- `decisions/` — `adr-000-locked-stack` · `session_workflow` the persistence loop · `session-end-autoship`
- `patterns/` — `globe-rendering` · `photo-frustum` · `upload-flow` · `members-pins` · `design-system` ·
  `sky-bodies-terrain` (ground half SUPERSEDED) · **`building-textures`** (the facade projection pipeline, 2026-10-24)
- `bugs/` — six fixed defects + `ground-checkerboard-flicker` **OPEN** (read before touching that area)
- `project/` non-leaf — `wix-platform` · `wix-site` · `dev_environment` · `audit{2-2026-08-18,4-2026-09-10}-charter` ·
  `owner-orders-2026-08-14-qol-batch` · `wip-2026-09-06-docs-hygiene`

## Source layout (2026-09-19)
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable; contract in
  `conventions/globe-tuning.md`) · `scene/` attach-modules · `StylizedTiles.ts` orchestrator · `GlobeCanvas.tsx`.
  Design imports NEVER touch it.
- `src/components/` — `panels|ui` desktop chrome · `mobile` the `/m` shell · `controls` shared input instruments
  (a pure leaf: react + stores + `lib/**` + `globe/tuning`; `test/components/mobileFence.test.ts`).
- `src/lib/` — decode, geo (+ `terrain.ts` seats, `pnp.ts`), ephemeris, sky, globe, models, edit (the journal), guide, pins, photo,
  export, market, save, wix, theme, format, api (`http.ts` server-only; `dataFetch.ts` client), textures, sensors, `prefs.ts` ·
  `src/store/` zustand · `src/pages/` `index.astro`, `m.astro`, `guide.astro` + the thin `api/*` routes · `test/` ~252 files.

## Key invariants (violations = bugs)
- The globe is `client:only` — never SSR WebGL (C4). Decode in a Web Worker. Astro 5 only. `3d-tiles-renderer`
  EXACT 0.4.28 (nine patched seams; `libraryPin.test.ts`).
- Never fabricate a Wix API signature — verify through Wix MCP. Endpoints thin (C1); admin calls `elevate()`.
- Stylize tiles by material swap on `load-model`; on ground tiles CHAIN `onBeforeCompile`. Colour flows through
  `lib/theme/tokens.ts` (D14); design imports write only under `panels|ui|controls` + `styles`.
- C6: a public pin never carries exact GPS (tiers exact / 1 km / city, `lib/geo/precision.ts`); textures are the ruled exception (T190).
- Scene modules never read stores directly (`fences.test.ts`). A `let` that `sampleEphemeris` writes must be
  declared above its module-init call (the TDZ trap, DECISIONS §Traps).

## Authority
`PROJECT_SEED.md` §3 (C1–C6) and §4 (ADR-000, D1–D15) are binding. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth. Rules: `.claude/conventions/`. Workflow: the `/frame` skill.
