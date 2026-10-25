## What this is
Serena memory-graph root for **PLUX** (`plux.today`): a Wix headless Astro 5 app that projects a photo, from its
EXIF, as a camera frustum at its capture location on a stylized 3D globe with real OSM buildings under a real
ephemeris sky. Client-heavy; Wix is the thin backend. Owner: Yevhen. Repo `headless-frame-the-world` — the repo name only, never the product; never rename the `ftw:*` keys or the `uFtw*`/`FTW_*` shader ids.
**Search order:** this graph → `.claude/claude-docs/` → `.claude/conventions/` → the code → Wix MCP. **One writer per fact:** narrative lives in
the `project/wip-*` leaves and `DECISIONS.md`; this root only indexes and states the status (cap 12 KB — compact, never grow).

## Status — 2026-10-25f (`mem:project/wip-2026-10-25-t200-moon-visibility`)
**T200 THE MOON'S PERCEIVED VISIBILITY BUILT (rungs 1 + 2; no new shader pass), gated (vitest 3,942 / 259 · astro 0 errors), 60 / 60 on glass vs the
baseline on the iPhone + Pixel + desktop twins → shipped (PR #164) + RELEASED v1.36.51, proven live by the house Chrome AND the Device Farm iPhone (DECISIONS 2026-10-25g).**
(1) the pure model `lib/ephemeris/moonVisibility.ts` (K&S · Kasten–Young · Schaefer extinction → the tint · the sky ladder · contrast = L_lit·T / L_sky ·
Crumey · Danjon) → `{ verdict, label, reason, … }`; (2) the verdict on the TODAY rows (±40 min), the MOON section's `☾ NOW · …` line, the tracked moon's
badge, the /m peek's ☾ `data-vis` — both shells; (3) the disc: `uMoonAir` / `uMoonTint` by the moon's OWN altitude (exactly 1 / white ≥ 12° and from orbit;
floor 0.45; `solarChroma` ≤ 8°, floored [1, .42, .16]) and `uDaySky` = the earthshine-vs-dome share (`moonDaySkyK`; additive-only to the bit by day).
Measured: the 8.4° dusk full moon 184,183,177 → 149,138,115, the sun +1° dark-limb hole −16 → −1, the 21° night disc byte-identical. NEXT: the owner's
live read on the real phone → the T200 tails → the ADR's §3.2–3.6 → T198 · T197 · T196.

## Status — the recent eras (one line each; the leaves carry the numbers)
- 10-25→10-25d THE MOBILE INTERLUDE → v1.36.48 (`wip-2026-10-25-mobile-interlude-radar-almanac`): every /m radar surface at the fan's strokes · the peek row's ☀ ☾ almanac · the DAY's rise / set (+1).
- 10-24c/d F5's PAIRS UI + the SOLVED stamp · the /m EXIT VIEW → v1.36.45 (`wip-2026-10-24-f5-pairs-ui-exit-view`); T197 = the tails; T198 = the live verifier's DATA-API 429; the edge throttles a busy IP after a release.
- 10-24 T195 the pins' GROUND SEAT (`refineGroundSeat`) · the textures ADR FINAL · the guide chapter → v1.36.43 (`wip-2026-10-24-t195-adr-guide-release`); T196 = the photo pins' same latch.
- 10-23 T187–T191 + F6 → v1.36.42; the pure PnP solve; **T190 textures PUBLIC** (`wip-2026-10-23-owner-asks-build-t187-t191-f6`).
- 10-22 F1–F5 the facade flow (`wip-2026-10-21-facade-flow-f1-f3` · `wip-2026-10-22-owner-asks-t174-t183` · `wip-2026-10-22-f4-f5-release`): the photo ARRAY texture, K slots; **T173 `wix dev` cannot elevate** → persistence verified LIVE; 10-18 the projection prototype (one per-PASS matrix in VIEW space, T165).

## Standing facts (2026-10-25f)
- Gates: vitest **3,942 / 259 files** · `astro check` **0 errors** (753 files; the hints are the dated baseline). Three timing tests flake under load (`bestSpotSolver`, `bestSpotResidency`, `planFeed`).
- `package.json` **1.36.53**; live **v1.36.53** (2026-10-26b, PR #166 `c01eea8` — T201 the TEX toggle hides the facade icons; T200 = v1.36.51, PR #164). Release:
  `FTW_SHIP_DAEMON=1 npm run release:full -- -c "…"` (≤ 250 BYTES; `--skip-gates` only right after a ship's gates on the identical tree); `release.sh`
  uses the PINNED CLI (`node_modules/.bin/wix`). **`wix dev` on Node 24.10** (`~/.nvm/versions/node/v24.10.0/bin`), the CDP harnesses too.
  **`wix dev` cannot elevate (T173)** — persistence is proven only live (`verify-facades-live.mjs`, `verify-live-deletes.mjs`).
- **The moon (2026-10-25f):** `scene/sky.ts` carries the CPU twins `moonDiscArms` · `moonAirTerms` · `moonNightShare` · `moonDaySkyK`; `uBrightness` is
  overwritten every frame by `setHoverGlow` (a new uniform, never a fold); the dome draws BEFORE the moon (renderOrder 0 vs 12); the fence counts exactly
  two depth pins in `sky.ts`; `moonVisibilityAt` is per minute, never per frame. The FPV seam's `fpv().yawDeg` is NOT a compass heading.
- **Ground seats (T195):** `ground.sampleAt(lat, lon)` answers `{ h, depth }`; a consumer that latches a height KEEPS the depth and refuses a shallower
  answer (`refineGroundSeat`).
- **The photo ARRAY (T170):** mips / filters / anisotropy are three's texture-cache KEY (set before the allocation; never `needsUpdate` after); K per tier
  through `photoProjectFor(lean)`.
- **The house Chrome's profile carries EXTENSIONS** (harnesses filter `chrome-extension://`) AND THE LAST TRACKED BODY; relaunch `verify-chrome.mjs
  --headless --port 9333 --profile /tmp/ftw-cdp --kill-stale` (`release.sh` step 7 kills it). **Never edit a served `src/` module while a harness runs.**
- **Every `/api` write goes through `lib/api/dataFetch.jsonWriteInit`**; **no `<form method=post>` anywhere** (the live origin check 403s it).
- **THE RESOURCE BUDGET** (owner 2026-09-06j): ONE house headless Chrome (:9333), ONE dev server (:4321), free memory ≥ 20 %; agents never launch Chrome /
  a dev server / the full vitest; browser suites queue on the one Chrome; close it after the last suite; never touch the owner's :9222.
  **T98: the VPN is a precondition for every terrain gate.** The Device Farm: `tools/devicefarm/` (`AWS_PROFILE=plux`,
  the iPhone 17 Pro; `--prod` reads the live site; ~8–10 device minutes a session; detached).
- The debt registry: `.claude/skills/frame/references/tracked-backlog.md` (T1–T200).
- Never a per-draw uniform from `mesh.onBeforeRender` (T165); scene modules never read stores (`fences.test.ts`).
- PARKED by owner order: Phase 7 AI · BEST SPOT's algorithm (T59) · the registry's parked rows (T1 T29 T31 T42 T46 T47 T50–T52 T56 T57 T113) ·
  the public-exposure class (T138/T139) until launch — the textures carve-out (T190) excepted.

## Next step
**The owner's live read of the moon on the real phone (the 2026-10-25 dusk moonrise from their street: PLAN → MOON · NOW, the tracked moon's badge, the
peek's ☾) → the T200 tails as ruled (the chroma's reach · the ±40 min sample · the crescent-in-afterglow residual) → the ADR's remaining questions
(§3.2–3.6) → T198 (the harness's RETRY) · T197 (the loupe first) · T196 · T166 · T165 · T167 · T164.** Open tails: the lift 0.3 m, the /m LOOK at the apex.

## Era index
One leaf per era: `mem:project/wip-<date>-<slug>` (braces expand). Digests: DECISIONS §Per-phase digests; verbatim: `DECISIONS_ARCHIVE.md`
(§Moved dividers r2 2026-08-15 · r3 08-18 · r4 08-22 · r5 09-06 · r6 09-07 · r7 2026-09-17 = 09-06o → 09-10f).
- 2026-07: phases 1–5.5 (07-10-* · 07-11-* · 07-12-readme-rewrite) · rendering + Dnipro enrichment + illumination (07-12-rendering-* · 07-13-*,
  `dnipro-enrichment/`) · OSM2World + R2 + obstruction + seating (07-14-*) · docs reorg, Phase 6/6.9 marketplace, St Albans, view prefs (07-{15,16,17,18,21}-*).
- 2026-08-02→10: the astro engine A–E + comet 10P (08-{02,03,10}-*, `archive/ASTRO_ENGINE_PLAN`).
- 2026-08-11→15: mobile M0–M3 (08-11-mobile-design · 08-13-m* · 08-14-mobile-m3*, `MOBILE_PLAN`) · AUDIT #1 + slices (08-13-*, `audits/audit-full-2026-08-13`)
  · planning QoL, FIND v2/v3, sunsets-in-frame, UX batches, guide G1 (08-14-* · 08-15-*).
- 2026-08-17→19: P7 meteors + UPLIFT U1–U8 (08-17-* · 08-18-u*, `UPLIFT_PLAN`) · AUDIT #2 (08-18-audit2*) · owner UX #2/#3 + PLUX grooming (08-19-*).
- 2026-08-21→27: owner batches #4–#6 + QA (08-21-*) · AUDIT #3 + micro-slice (08-22-{owner-microslice,audit3*}) · GUIDE FINAL + owner 3-slice
  (08-22-{guide-final,owner-3slice} · 08-27-guide-bestspot-eclipses) · ULTRA + eclipses + dusk (08-22-{ultra-track,eclipses} · 08-27-{ultra-render-batch,dusk-taste-pass})
  · BEST SPOT S1→S7 PARKED (08-23/24/26/27-bestspot-*, `bestspot/README.md`) · formal verification (08-24-*) · BRAND PLUX (08-25) · RENDERING CHARTER
  RC0–RC30 (08-25-* · 08-26-*) · Chernobyl region built → deleted (08-26-chernobyl-region).
- 2026-09-01→10: DBG chip (09-01-*) · MESH SUITE MS0–MS8 (09-01-mesh-suite-plan · 09-02-mesh-suite-* · 09-03-* · 09-05-model-pitch-roll-ms8) · T77 MEASURE
  → phones → slices (09-05-t77-* · 09-06-t77-* · 09-07-t77-*) · docs hygiene (09-06-docs-hygiene) · T83 / occlusion / T106 (09-07-*) · mobile features, lever 11,
  app version (09-07-{mobile-bestspot-ar,lever11-vtile-worker} · 09-08-*) · regressions + lever 8 (09-09-*) · T123 + the render interlude (09-10-*).
- 2026-09-11→30: AUDIT #4 + triage (09-11-audit4 · 09-16-audit4-triage-fixes) · mobile UX → v1.36.11 (09-16-mobile-uxbatch-menu-pinch-scale) · sign-out root
  cause (09-18-*) · AR calibration + the box (09-19-*) · the AR small-screen pass (09-22-*) · the /m UX pass (09-25-*) · ALIGN out, the pin follows the walker (09-30-*).
- 2026-10: the radar on glass + FIND THIS ONE (10-10-*) · the sticky box + daylight + building colour (10-13-*) · AR yaw lock (10-14-*) · the photo projection
  prototype (10-18-*) · the facade flow F1–F6 + T174–T191 (10-21-* · 10-22-* · 10-23-*) · T195 + the ADR + the guide (10-24-*) · F5's pairs UI (10-24-f5-*) ·
  the mobile interlude (10-25-mobile-interlude-radar-almanac) · T200 the moon's visibility (10-25-t200-moon-visibility).

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
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable; `conventions/globe-tuning.md`) · `scene/` attach-modules ·
  `StylizedTiles.ts` orchestrator · `GlobeCanvas.tsx`. Design imports NEVER touch it. `src/components/` — `panels|ui` desktop · `mobile` the `/m` shell ·
  `controls` shared instruments (a pure leaf; `mobileFence.test.ts`). `src/lib/` — decode, geo, ephemeris, sky (lazy catalogs), globe, models, edit, guide,
  pins, photo, export, market, save, wix, theme, format, api, textures, sensors, `prefs.ts` · `src/store/` zustand · `src/pages/` + thin `api/*` routes · `test/`.

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
