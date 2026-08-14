# Frame the World — Implementation Plan (working)

The actionable phased build — phases 1–7 distilled from `provenance/DEEP_RESEARCH.md` Handoff #2 (that
doc is provenance), plus **Phase 8, the planning-instrument ladder (desktop-first — owner 2026-08-13)**.
**Work in small, verified increments.** After each phase: `npx astro check` + `npm test` + build pass,
confirm the Definition-of-Done, stop for review. Never fabricate a Wix API signature — use Wix MCP/Skills.
Update the checkboxes and append a `DECISIONS.md` line as each phase lands.

**Working agreements:** globe stays `client:only` (never SSR WebGL) · prefer Wix JS SDK, `elevate()` only
where required, least-privilege · commit the sensor dataset + unit-test FOV/geohash math · feature-flag
"realistic mode" (unmodified Google tiles, off by default) · one Claude Design screen per import session.

---

## Phase 1 — Scaffold + deploy "hello globe"  ☑ DONE 2026-07-09 (browser-verified; `wix release` pending greenlight)
**Status (2026-07-09):** App scaffolded & merged; Cesium OSM Buildings globe live in browser over Dnipro;
ion token in `.env.local` (gitignored); `astro check` + `wix build` green. **`wix release` deferred pending
user greenlight.** → **Phase 2.**
**Amendment (2026-07-10, owner-directed globe overhaul — browser-VERIFIED):** the Phase-1 globe was rebuilt
to the seed's signature scene: LEO default POV + idle orbital drift; organic base (NASA Blue Marble July
graded into the palette + VIIRS night lights + relief); ray-based altitude-adaptive atmosphere; a SECOND
TilesRenderer draping palette-graded Esri World Imagery (z19) that dissolves in 2600→1400 km (progressive
detail, no hard switch); dark edge-stroked buildings sunk 90 m (terrain-clamp offset, Dnipro-specific until
real terrain — SUPERSEDED Phase 4: real Cesium World Terrain landed, the 90 m sink was removed). Details: DECISIONS 2026-07-10 · `mem:patterns/globe-rendering`.
**Scope:** scaffold Wix headless Astro into this repo (preserve the existing `.git` — scaffold to a temp
subdir, move files up, keep one repo); add `three` + `3d-tiles-renderer`; render Cesium OSM Buildings globe
with `GlobeControls` in a `client:only` island; deploy to Wix.
**DoD:** `wix dev` shows a rotating stylized globe locally; `wix release` deploys; buildings load at close
zoom over a test city (try **Dnipro**); ion token loads asset 96188.
**Test:** `astro check` + build pass; manual smoke on desktop Chrome.
**Setup gotchas:** `npm create @wix/new@latest headless -- --folder-name . --business-name "Frame the World"
--site-template`; `npm install --legacy-peer-deps`; `env pull --json` writes `WIX_CLIENT_ID`; put a Cesium
ion API token in env (not committed).

## Phase 2 — EXIF + decode pipeline  ☑ *(DONE 2026-07-10, browser-VERIFIED: exifr + libraw-wasm@1.0.5 pinned single-threaded + libheif-js in a disposable Worker; ARW 4.8 s → 3136×2084 texture, HEIC 0.4 s, embedded preview ~120 ms; mobile benchmark carried below; see `mem:patterns/upload-flow` + DECISIONS)*
**Scope:** upload dropzone; `exifr` metadata + embedded-JPEG instant preview; `libraw-wasm` full decode in a
Worker; HEIC feature-detect + `libheif-js` fallback; sensor DB + FOV computation. *(As built: WASM is emitted as hashed Vite build assets — no `public/wasm/`.)*
**DoD:** a Sony ARW and an iPhone HEIC both yield metadata + a decoded display texture; missing heading/pitch
flagged for manual entry.
**Test:** unit-test FOV math + geohash (**vitest**); integration-decode a sample ARW in headless Chromium.

## Phase 3 — Projection + tweak UX  ☑ *(DONE 2026-07-10, browser-VERIFIED: frustum + image plane from EXIF at capture location; live slider re-projection 0.018 ms/update; 2.2 s bezier flight + reduced-motion cut; SET ON GLOBE click-to-place for missing GPS; Photo-Detail board import deferred — light PhotoDetailPanel shipped instead; see `mem:patterns/photo-frustum` + DECISIONS)*
**Scope:** build frustum from EXIF (GPS position, heading/pitch/roll, FOV); render image plane at frustum far
face; reactive zustand params; live re-projection on slider change; cinematic pin→detail camera flight (~2.2s
ease-in-out; reduced-motion cross-fade variant). *(Import the Photo-Detail screen from Claude Design here.)*
**DoD:** a photo appears as an oriented frustum at its location; moving focal/heading/pitch/position/time
updates the projection in real time; pin selection triggers the flight.
**Test:** projection matches a known reference (photo with real `GPSImgDirection`); reduced-motion path works.

## Phase 4 — Ephemeris sky  ☑ *(DONE 2026-07-10, browser-VERIFIED: sun/moon/terminator/shadows from scene time (pre-Phase-4 pass) + TimeScrubber rail (drag pins, NOW resumes, capturedAt seeds at placement longitude) + golden-hour bell tint via tokens.goldenHour (earth/ground/atmosphere/key light) + real BSC5 star catalog rotated by −GAST; planets not rendered (sun/moon/stars only); see `mem:patterns/sky-bodies-terrain` + DECISIONS)*
**Scope:** `astronomy-engine` sun/moon/planet positions from time+location; procedural sky + star field;
time scrubber drives lighting; golden-hour tint bound to `tokens.ts`.
**DoD:** dragging time moves sun/moon, changes lighting + star visibility; golden hour appears at correct times.
**Test:** spot-check sun azimuth/altitude against an almanac for a known date+location.

## Phase 5 — Members + quota + save/public pins  ☑ *(DONE 2026-07-10, wix-cloud-VERIFIED in wix dev: managed auth (@wix/astro routes + hosted login), Photos/PublicPins provisioned via REST (`scripts/provision-collections.mjs` — NO data hooks on headless CLI, quota lives in the elevated POST /api/photos, member-session writes platform-refused), save flow with TUS original + preview derivative, #11 → 402 QUOTA_EXCEEDED, C6 reduced-precision public pins (1km default, cell-center published), signed-out visitor sees accent pins via client-side hasSome query + click→fly; paid-unlimited path UNVERIFIED (Pricing Plans app not installed — degrades to free); see `mem:patterns/members-pins` + DECISIONS)*
**Scope:** auth (`@wix/astro` auto-auth); Data Collections (`Photos`, `PublicPins`); Media upload (resumable
>10MB, private originals + public previews); quota (Pricing Plans + `beforeInsert` hook: 10 free / unlimited
paid); public pins on shared globe via geohash viewport query; default reduced public-pin precision (C6).
*(Import gallery/auth/pricing screens.)*
**DoD:** free member saves ≤10, blocked on #11; paid unlimited; public pins render for all at reduced precision.
**Test:** quota hook rejects #11; viewport geohash query returns only in-view pins; no exact GPS on public pins.

## Phase 5.5 — Pre-marketplace UX/quality batch  ☑ *(DONE 2026-07-11, S1–S7 all shipped + browser-VERIFIED — canonical doc: `archive/PHASE_5_5_UX_BATCH.md`; owner's 10 items ordered into 7 sessions)*
**Scope + order (S1→S7; each = one verified increment, DoD in the design doc):**
- [x] **S1 — Location finder** (Photon autocomplete + Nominatim-on-Enter, OSM attribution, fly-to seam
  in store/camera + orchestrator) **+ day prev/next buttons** in TimeScrubber. *(S1 shipped 2026-07-11 — see DECISIONS)*
- [x] **S2 — Flight & camera core:** terrain-aware flight path floor + tangent-aligned orientation
  (fixes underground/spin fly-ins), zoomMinAltM 120→~2 m, default pin arrival ~200 m/80° tilt,
  **FPV photographer mode** (camera at frustum apex, look-around + FOV zoom, opt-in/out).
  *Owner adds 2026-07-11:* **compass** (headingDeg needle, click → FLUID eased rotation to north) + **2D/3D toggle**
  (tilt 0↔55 via existing glide) + **encoder-style ROTATE/ZOOM** (spring-centred rate controls,
  deflection = speed; zoom keeps hard alt limits). *(S2 shipped 2026-07-11 incl. items 13+14 —
  no S2b needed; browser-VERIFIED via Playwright MCP; see DECISIONS)*
- [x] **S3 — Pin lifecycle + placement UX:** PATCH/DELETE /api/photos (owner-gated, elevated, C6
  re-derivation), custom pin name input (title), **authorName** on PublicPins (+provision+back-fill),
  placement selection marker, staged progress, auto-close on save, zoom-out + highlight new pin.
  *Owner add:* more salient (still subtle) **upload CTA** in the chrome. *Owner adds in-session:*
  dblclick-gesture memo above the camera controls + **"UPLOAD HERE"** in the temp-pin popup
  (location seed for GPS-less files). *(S3 shipped 2026-07-11 — wix-cloud-VERIFIED with a member
  cookie; see DECISIONS)*
- [x] **S4 — Pin visual rework:** stem + floating semi-transparent head (rim/core/shimmer, cross-flare
  at twinkle peaks), neighbor-staggered stem heights, per-user cool-family hues via instanceColor,
  hover enlarge/glow/details card. *Owner add:* **Explore ambient pin journey** (900 km / 50° tilt,
  slow nearest-neighbour cruise through pins, any interaction exits; EXPLORE tuning group).
  *(S4 shipped 2026-07-11 — browser-VERIFIED; same-day owner batch: taller stems, gh6 ring
  de-cluster, float32 flicker fix (camera-anchored pins + MV shaders), ADD-PHOTO pill retired,
  **Welcome landing page** w/ auto-Explore backdrop, time scrub centred + readout axis-aligned.
  See DECISIONS)*
- [x] **S5 — Night-sky physics:** K&S-1991 phase-scaled moonlight + moon-driven shadow rig at night,
  brighter stars/Milky Way (tuning), Black Marble 2016 gray 8k single-channel city lights.
  *Owner add:* **darker night sky** (lower night floors + root-cause the carried navy-floor mystery).
  *(S5 shipped 2026-07-11 — browser-VERIFIED via scripted CDP: quarter/full moonlight 10.3%, moon
  shadows live at the full-moon Dnipro night, 8k R8 lights, navy floor ROOT-CAUSED = composer
  clear-colour colour-space bug → scene.background fix + atmosphere Chapman obliquity. See DECISIONS)*
- [x] **S6 — FPV planning overlays:** sun/moon day-arc polylines (10-min sampling, hour ticks,
  past/future split) + ~20 main asterisms from d3-celestial asterisms.json (BSD-3).
  *(SHIPPED 2026-07-11, browser-VERIFIED — absorbed the owner FPV batch: HUD (focal/bearings/
  off-frame sun-moon chips), ALTITUDE+FOCAL ZOOM encoders, building distance/altitude opacity
  curve, brighter moon. See DECISIONS)*
- [x] **S7 — Ground rework:** (a) dark uniform "vaporwave" drape <7 km (**CARTO dark_nolabels —
  owner-approved 2026-07-11**; textures opt-in; crossfade band tunable; per-mode shadow contrast),
  (b) Natural Earth city labels + country boundaries 100–2000 km tunable + street-name overlay,
  (c) building grow-on-zoom 2 km→600 m + Re:Earth Overture Ukraine-buildings trial (Mapbox rejected
  on ToS). *(SHIPPED 2026-07-11, browser-VERIFIED + S5 night golden gate PASS; label window
  defaults 100–900 km — the DoD's "gone at LEO" beat the design's 2000 km top; Overture trial
  NEGATIVE: content tiles 500 server-side → flag stays OFF. Same-day owner rework: street
  names went VECTOR (OpenFreeMap MVT → rotated zoom-scaled DOM labels, reveal ~2.5 km — the
  raster overlay was blurry) and grow-on-zoom was REMOVED (unreliable). See DECISIONS)*
**Test:** per-session `npm test` + `astro check` + `wix build`; browser verify on wix dev
(`verify-shots/phase55-*`); S3 wix-cloud-verified with a member cookie.

## Interlude (2026-07-12 → 07-14) — owner-directed initiatives shipped between 5.5 and 6  ☑
Unplanned-in-the-7-phase-build but all SHIPPED + verified (one `DECISIONS.md` line each; memories
`mem:project/wip-2026-07-12-*` → `wip-2026-07-14-*`). Ledger, in order:
- [x] **S7 feedback batches 1–2** — GL street names v3, vector road/water web (`scene/vectorTiles`/
  `vectorFeatures`), ground-grade fixes, tooltips layer, MVT clip-at-parse flicker fix, camera pose in the
  URL (`#p=`). *(2026-07-11/12)*
- [x] **README rewrite** for the internal Wix contest (live URL deliberately omitted until next release). *(2026-07-12)*
- [x] **Rendering quality Pass 1** — adaptive device tier + frame governor (`lib/globe/quality.ts`), tile-knob
  tiering, fluidity eases, GTAOPass wired default-OFF. Plan: `rendering/RENDERING_QUALITY_PASS.md`.
  *(2026-07-12; GTAO tune/enable + weak-box A/B still carried)*
- [x] **Rendering Pass 2 (Dnipro identity)** — per-building tonal variation + night window emissive on the
  ONE shared building material; R4 roof reconstruction design-and-deferred (superseded by the bake). *(2026-07-12/13)*
- [x] **Illumination + shadows pass** — crisp building shadows (governor decoupled: shadows follow the DEVICE
  tier), golden-hour GI, no night emissive (owner call). *(2026-07-13)*
- [x] **Dnipro 3D enrichment, Slices 0–3** — reproducible Node baker `scripts/bake/` (OSM footprints → C6
  exclusion → roof-shaped extrusion → gridded 3D-Tiles), mask + clip-prism over Cesium OSM, per-cell then
  **per-building/per-tree terrain seating**, ~161k instanced trees. Source of truth:
  `dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md`. *(2026-07-13/14; Slice 4 splats deferred; HLOD tail open)*
- [x] **Pass 3 + Slice 5 — the planner/obstruction moat** — `lib/ephemeris/planner.ts` +
  `lib/geo/{horizonProfile,occlusion}.ts` + PlanPanel ("will the sun clear that rooftop", jump-to-time). *(2026-07-14)*
- [x] **R2 hosting** — Cloudflare Worker over a private bucket (CORS/Range), `upload-r2.mjs`/`deploy-worker.mjs`;
  dev streams tiles locally (`bakes/` + Vite middleware), build/release use R2. *(2026-07-14)*
- [x] **OSM2World parallel variant** — `bake-osm2world.mjs` (exact MetricMapProjection inversion), 10 km
  extent both bakes, `BLD` A/B chip. Prep/verdicts: `dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP.md`.
  *(2026-07-14; owner visual verdict pending)*
- [x] **Owner UX batches** — draggable panels (DragGrip), time playback + precise time, shareable scene time
  (`&t=`) + FPV views (`#f=`), FPV mini-map, always-on viewer coords, solidity screen-door dissolve,
  clickable ☀/☾ chips, PLAN panel placement, zero h-scroll. *(2026-07-14)*

## Phase 6 — Marketplace-light  ☑ (code+wiring SHIPPED 2026-07-16; pay→deliver loop = owner's manual Wix step)
**As built (2026-07-16):** self-serve — a member lists their OWN, already-PUBLIC pin as a **Catalog V3 DIGITAL
product** (owner chose V1, but the site is V3 and hard-rejects V1 — see DECISIONS 2026-07-16); the retained
`originalFileId` IS the digital file. `POST /api/listings` (elevate → `productsV3.createProduct`), `DELETE`
unlist, `GET` owner-sales; client BUY = `@wix/ecom checkout.createCheckout` + `@wix/redirects` → hosted checkout.
**Verified:** V3 create + checkout resolution against the live gateway; member list→sales→unlist E2E in wix dev
(`scripts/verify-listing-member.mjs`). Gates vitest 587 · astro 0/0 · wix build Complete.
**Key trap:** the checkout `catalogReference` needs `options.variantId` (productId alone → empty checkout) and the
fixed Wix-Stores appId `215238eb-…` (NOT the TPA id). **Remaining (Wix-native, NOT code):** a real purchase →
owner marks the manual payment paid in the Wix dashboard → the preinstalled automation emails the 30-day link.
Memory: `mem:project/wip-2026-07-16-phase6-marketplace-research`.

## Phase 6.9 — Marketplace + access batch  ☑ (SHIPPED 2026-07-17, browser-VERIFIED)
**As built:** quota **100 free / 1000 premium** (two-tier wall in `POST /api/photos`; D8 numbers superseded
by the 2026-07-17 owner ruling) · `SITE_CURRENCY="EUR"` stamped at listing create + symbol-prefixed
`formatPrice` ("€7.50" badges) · **SALES tab** in MY PINS (first `GET /api/listings` consumer) ·
`PinHoverCard` price chip · **MARKETPLACE nav button + browse panel** over new public `GET /api/market`
(C6-reduced PublicPins rows; row click = the globe-pin-click `openSavedPin` path) · UPGRADE affordances
(nav chip + quota-error button) → `lib/wix/planUpgrade.ts` paid-plans redirect (typings-verified) ·
click-time sign-in returnTo carrying the `#p=` pose hash · `?purchased=1` thank-you toast · UNLIST arm.
**Verified:** `scripts/verify-phase69.mjs` (member API + scripted-Chrome tiers) — gates vitest 593/593 ·
astro 0/0 · wix build Complete. **Owner tail:** install the **Pricing Plans app** + one public plan
(site lacks it — `APP_NOT_INSTALLED`) *(correction 2026-08-13, audit D11: the install COMPLETED
2026-07-17 same-day — DECISIONS "UPGRADE FLOW LIVE-VERIFIED", plan `5874dba8-…`; backlog T4
corrected)*; the manual purchase→paid→email loop is still the Phase-6 DoD step.
Memory: `mem:project/wip-2026-07-17-phase69-marketplace-batch`.

## Phase 7 — AI analysis + polish  ⛔ PARKED (owner ruling 2026-08-11: out of scope for ALL plans)
> The active tracks are **Phase 8 below** (the Stellarium/PhotoPills planning-feature ladder —
> CORE scope, **desktop-first, then mobile**; owner re-ruling 2026-08-13) and **`MOBILE_PLAN.md`
> M0–M2** (mobile infrastructure; M3–M6 are the *mobile surfaces* of Phase 8). This phase is kept
> verbatim below for history only; nothing schedules it.

**Scope:** premium AI panel → Wix AI (Claude, e.g. Opus 4.6) with a **downsized JPEG** + desired-condition
prompt; moderation pass on public previews; perf polish (KTX2, OPFS cache, mobile half-size decode, View Transitions).
**DoD:** premium user gets tidy suggestion cards ("shift heading +12°, shoot 40 min earlier"); public pins pass moderation.
**Test:** AI call consumes ~1 credit + returns structured suggestions; non-premium is gated.

## Phase 8 — Planning instrument, core ladder (desktop-first; owner re-ruling 2026-08-13)

**The PhotoPills/Stellarium feature ladder (`MOBILE_PLAN.md` §5 P1–P10 + the scheduled backlog) is
CORE product scope, not mobile scope.** Owner ruling 2026-08-13 (supersedes the 2026-08-11
scheduling of these features inside mobile-only phases M3–M6): every planning feature — current and
future planning-app additions alike — ships **desktop-first, then mobile**. `MOBILE_PLAN.md` M0–M2
remain the mobile-infrastructure track; its M3–M6 are re-scoped to the *mobile surfaces* of the
sub-phases below. Feature sketches, effort sizes, and evidence live in `MOBILE_PLAN.md` §5 (still
the design source); THIS section owns the schedule.

**Build rule (every feature):** pure lib + vitest first (`lib/ephemeris/*` / `lib/geo/*` — shared,
shell-agnostic, literature test vectors) → store mirror if stateful → **desktop surface** (panels;
the design-import fence applies) → mobile surface in the twin M-phase. A feature's mobile surface
never precedes its desktop surface.
**Desktop-freeze amendment (2026-08-13):** the 2026-08-11 "desktop is FROZEN" ruling now reads —
shipped exploration-UI design/behavior stays frozen; **additive** planning-feature surfaces (new
panels/cards/rail decorations) are allowed. Zero regression of shipped features and perf is a
per-sub-phase gate.

- [x] **8a — Darkness & the galaxy ✅ SHIPPED 2026-08-13 (desktop)** *(mobile twins: M1 rides P1;
  M3 rides P2/P3 — now unblocked)* — P1 twilight bands (civil −6°/nautical −12°/astro −18°,
  `lib/ephemeris/twilight.ts`) on the desktop TimeScrubber rail · P2 MW band + Galactic Centre as
  a first-class SkyTarget (fixed provider → reticle/trail/chips/skyline verdict inherited) · P3 MW
  season calendar + darkness score (`targetWindows(GC)` ∩ sun<−18° ∩ moon interference via
  `moonlight.ts`, one convention in `lib/ephemeris/mwSeason.ts`) in PlanPanel. Gates vitest
  733/733 · astro 0/0/6 · wix build 26 routes; surfaces browser-verified (verify-shots/phase8a-*);
  T25 closed in the same pass. DECISIONS 2026-08-13 Phase-8a line.
> **Re-ruled 2026-08-14 (owner, supersedes the 8b–8e ordering below-history):** after the
> PhotoPills user-guide DEEP review (feature-level; adoption record + specs in
> **`PLANNING_QOL_PLAN.md`** — the spec source for every rung below), the ladder is re-prioritized
> **sun/moon/MW-first**; astro/DSO work only after mobile is fully solved AND the QoL pass is done.

- [x] **8-QoL-1 — Scrubber v2 + instant wins ✅ SHIPPED 2026-08-14 (desktop COMPLETE — the
  §3.1.D trace + playhead cursor landed same day, late line; remaining tail = the dock's
  mobile v2 only)** *(mobile twin: M3a)* — full light bands
  (day/golden/blue/nautical/astro/night, ONE golden source with chips+grade) · **infinite
  conveyor drag** (12 h centre-cursor window, real browser-local hour labels) · sun/moon
  elevation curves ON the rail · event-step tap zones · tracked-target visibility trace in
  current-frame context (partially lands T8) · **my-location→FPV button on BOTH shells** ·
  **Space = FPV hold-accelerated ascend**. Spec: PLANNING_QOL_PLAN §3.1/§3.3/§3.4.
- [x] **8-QoL-2 — This-frame + daily surface ✅ SHIPPED 2026-08-14 (desktop, browser-verified;
  owner batch rode along: GHOSTS temporal chain of the tracked body, sun/moon as first-class
  searchable/trackable targets, right-click sky context menu, WASD+Shift/Space descend, the
  daytime moon dark-disc fix, HUD/minimap 210px width match, compact FPV deck)** *(mobile twin:
  M3b)* — FPV **shoot-this-frame suggestions** (`frameFinder`: sun/moon/target frame crossings,
  skyline-aware, light-tagged; the frame IS the query) · single-target "when nearest frame
  centre" (P4 seed) · TODAY daily panel (cross-body midnight→midnight chronology, light glyphs,
  sun-el-at-moonrise) · next-phase/new-moon jump chips · ICS calendar export (client Blob).
  Spec: PLANNING_QOL_PLAN §3.2 + §1.1 R5/R7/R15.
- [x] **8-QoL-3 — Find + moon/exposure toolkit** ✅ desktop 2026-08-14 night-3 *(mobile twin:
  M3c open)* — P4 **Find** FULL (FindCard: az(±3°)/el(±0.5°) over 1W/1M/6M/1Y, **skyline-filtered
  rows** — the category-first bet; DATE/LIGHT sort; engine `frameFinder.azElHits` per-day azimuth
  root-find ~1 ms/day) · P6 MoonCalCard (quarters + perigee/apogee via SearchMoonQuarter/
  SearchLunarApsis, supermoon ★ ≤ 360 Mm, disc-arcmin rows, NEXT SUPERMOON chip) · P5
  SpotStarsCard NPF (`lib/photo/npf` — declination FREE from the frustum via maxCosDecInFrame;
  simplified + 500 ghosts) · R9 size→distance (lib/geo/sizeDistance + TargetPanel SIZE→DIST row).
  Spec: PLANNING_QOL_PLAN §1.1 R8/R9/R10/R14.
- [ ] **8-events** *(mobile twin: M4; AFTER the QoL pass + its mobile twins)* — P7 meteor showers
  (bake IAU MDC, avoid GPL showers.json; radiant = tracked target; ZHR×sin(h), moon-scored peaks;
  + rail intensity trace) · P8 conjunctions/oppositions finder · P9 lunar eclipses (shadow-cone
  from the existing sun/moon; local visibility = the horizon test).
- [ ] **8-tools/ambience** *(mobile twins: M5/M6)* — P10 sensor-frame/mosaic overlay on DSO
  targets (explicitly slid behind the QoL pass) · star-trail simulator (FPV-composed
  per-direction preview) · long-exposure/ND + timelapse calculators · What's-Up-Tonight ranking ·
  light-pollution drape + Bortle at the pin · ISS/satellite passes (SGP4 + cached `/api/tle`
  proxy) · web-push event alerts (headless has NO cron — external scheduler or on-open recompute,
  decide at build) · **solar-eclipse umbra path on the globe** (the flagship visual).

**DoD per sub-phase:** lib math unit-tested against literature vectors · desktop surface
browser-verified · gates green (`npm test` + `astro check` + `wix build`) · shipped features and
perf regression-free (frozen chrome untouched) · only then does the mobile twin unblock.
**Permanently out (owner 2026-08-11, unchanged):** Gaia-depth catalogs · GOTO · tides/rainbow ·
Skyfire · the Phase-7 AI panel.

---

## TODO-VERIFY tracker (internal Wix access — each has a SAFE DEFAULT so the build never blocks)
| # | Question | Safe default until verified | Status |
|---|---|---|---|
| 1 | Exact per-file MB cap for RAW uploads to Wix Media | resumable path for all >10MB; downscale-before-upload for previews | ☐ |
| 2 | Can managed headless set COOP/COEP page headers? (WASM threads) | single-threaded SIMD decode | ✅ moot (single-threaded shipped Phase 2–5; threads never needed) |
| 3 | Wix HTTP-endpoint execution-time + max request/response size | keep endpoints thin; all decode client-side | ☐ |
| 4 | Which Claude models are exposed by Wix AI + is vision enabled? | send JPEG; Opus 4.6 assumed; direct-Anthropic fallback ready | ☐ |
| 5 | Wix AI credit cost per vision call at realistic preview sizes | premium-gate; downsize aggressively | ☐ |
| 6 | Multi-party/marketplace payout on the Wix roadmap | owner-mediated manual payout (no split payments) | ✅ Phase 6: no split payments; owner marks paid + pays out in the Wix dashboard (Catalog V3 digital products) |
| 7 | `3d-tiles-renderer` bundle size (Bundlephobia was down) | `npm view 3d-tiles-renderer dist.unpackedSize` + analyze | ☐ |

## Empirical validation (was "before Phase 3"; status 2026-07-15)
- ◐ a6700 26MP ARW decode benchmark: desktop DONE (halfSize ≈ 4.8 s → 3136×2084 texture, Phase 2);
  **mid-range phone + peak WASM heap still carried.**
- ☑ OSM building coverage for Dnipro — superseded by the enriched bake (127k buildings, 20×20 km);
  rural coverage remains whatever Cesium OSM has.
- ☑ `astronomy-engine` spot-check — JPL-Horizons-tested ±0.05° (pre-Phase-4 pass); Dec-21 subsolar
  −23.44° verified in-scene.
