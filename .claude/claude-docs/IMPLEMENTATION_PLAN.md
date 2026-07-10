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

## Phase 5 — Members + quota + save/public pins  ☐
**Scope:** auth (`@wix/astro` auto-auth); Data Collections (`Photos`, `PublicPins`); Media upload (resumable
>10MB, private originals + public previews); quota (Pricing Plans + `beforeInsert` hook: 10 free / unlimited
paid); public pins on shared globe via geohash viewport query; default reduced public-pin precision (C6).
*(Import gallery/auth/pricing screens.)*
**DoD:** free member saves ≤10, blocked on #11; paid unlimited; public pins render for all at reduced precision.
**Test:** quota hook rejects #11; viewport geohash query returns only in-view pins; no exact GPS on public pins.

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
