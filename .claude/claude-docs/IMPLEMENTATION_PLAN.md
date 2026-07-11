# Frame the World — Implementation Plan (working)

The actionable 7-phase build. Distilled from `DEEP_RESEARCH.md` Handoff #2 (that doc is provenance).
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
real terrain). Details: DECISIONS 2026-07-10 · `mem:patterns/globe-rendering`.
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
Worker; HEIC feature-detect + `libheif-js` fallback; sensor DB + FOV computation; WASM assets in `public/wasm/`.
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

## Phase 5.5 — Pre-marketplace UX/quality batch  ☐ *(designed 2026-07-11 — canonical doc: `PHASE_5_5_UX_BATCH.md`; owner's 10 items ordered into 7 sessions; blocks Phase 6)*
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
- [ ] **S6 — FPV planning overlays:** sun/moon day-arc polylines (10-min sampling, hour ticks,
  past/future split) + ~20 main asterisms from d3-celestial asterisms.json (BSD-3).
- [ ] **S7 — Ground rework:** (a) dark uniform "vaporwave" drape <7 km (**CARTO dark_nolabels —
  owner-approved 2026-07-11**; textures opt-in; crossfade band tunable; per-mode shadow contrast),
  (b) Natural Earth city labels + country boundaries 100–2000 km tunable + street-name overlay,
  (c) building grow-on-zoom 2 km→600 m + Re:Earth Overture Ukraine-buildings trial (Mapbox rejected
  on ToS).
**Test:** per-session `npm test` + `astro check` + `wix build`; browser verify on wix dev
(`verify-shots/phase55-*`); S3 wix-cloud-verified with a member cookie.

## Phase 6 — Marketplace-light  ☐
**Scope:** list a photo as a digital product (`itemType.preset: DIGITAL` + `digitalFile` = full-res RAW); buy
flow; owner-mediated payout note; 30-day download-link messaging. *(Import marketplace screens.)*
**DoD:** list a RAW → another user buys → buyer gets 30-day download; owner sees the sale to pay out manually.
**Test:** end-to-end purchase in Wix test mode; confirm digital delivery.

## Phase 7 — AI analysis + polish  ☐
**Scope:** premium AI panel → Wix AI (Claude, e.g. Opus 4.6) with a **downsized JPEG** + desired-condition
prompt; moderation pass on public previews; perf polish (KTX2, OPFS cache, mobile half-size decode, View Transitions).
**DoD:** premium user gets tidy suggestion cards ("shift heading +12°, shoot 40 min earlier"); public pins pass moderation.
**Test:** AI call consumes ~1 credit + returns structured suggestions; non-premium is gated.

---

## TODO-VERIFY tracker (internal Wix access — each has a SAFE DEFAULT so the build never blocks)
| # | Question | Safe default until verified | Status |
|---|---|---|---|
| 1 | Exact per-file MB cap for RAW uploads to Wix Media | resumable path for all >10MB; downscale-before-upload for previews | ☐ |
| 2 | Can managed headless set COOP/COEP page headers? (WASM threads) | single-threaded SIMD decode | ☐ |
| 3 | Wix HTTP-endpoint execution-time + max request/response size | keep endpoints thin; all decode client-side | ☐ |
| 4 | Which Claude models are exposed by Wix AI + is vision enabled? | send JPEG; Opus 4.6 assumed; direct-Anthropic fallback ready | ☐ |
| 5 | Wix AI credit cost per vision call at realistic preview sizes | premium-gate; downsize aggressively | ☐ |
| 6 | Multi-party/marketplace payout on the Wix roadmap | owner-mediated manual payout (no split payments) | ☐ |
| 7 | `3d-tiles-renderer` bundle size (Bundlephobia was down) | `npm view 3d-tiles-renderer dist.unpackedSize` + analyze | ☐ |

## Empirical validation (before Phase 3)
- ☐ a6700 26MP ARW decode benchmark: desktop **and** a mid-range phone; record peak WASM heap.
- ☐ OSM building coverage check for Dnipro + 2 rural capture locations.
- ☐ One `astronomy-engine` sun-azimuth spot-check against an almanac.
