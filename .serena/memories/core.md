# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.

## Status
**Phase 1 DONE + globe polish take-2 (2026-07-09, browser-VERIFIED via Playwright).** Cesium OSM Buildings
globe live in `wix dev` over Dnipro (ion asset 96188). The first "closed" pass rendered near-black; it was
diagnosed + rebuilt (5-agent research workflow) into a real "premium instrument" backdrop: a **mask-driven
land/ocean ShaderMaterial** base (continents read + are geo-correct — `public/textures/earth-landmask.png`
derived from the topology by threshold-0; peaks brighter via the elevation channel; `uNightFloor` keeps the
dark side readable), a **fresnel cyan-teal atmosphere** rim, a **camera-following star-field** (fixed the
far-plane clipping that hid it), a **real lat/lon LineSegments graticule** (hemisphere-discard so it vanishes
inside), the base at **exact WGS84 + polygonOffset** so OSM buildings sit on the ground (was floating 3.2 km),
`NeutralToneMapping`, a **150 km altitude gate** that hides orbit-only decoration at city zoom, and
`zoomSpeed = 5`. Data textures are `NoColorSpace` (the sRGB tag was a bug). New GL tokens (peak/atmosphere/
graticule/star; retuned water/land/landHi). `three@0.185.0` + `3d-tiles-renderer@0.4.28`; `astro check` 0
errors. Full mechanics + gotchas in **`mem:patterns/globe-rendering`**. Live site:
`frame-the-a173087b-yevhens.wix-site-host.com` (siteId `f597bcf5-bd38-4941-9dfe-e16d775743a3`,
appId `566ce8ce-d18c-4950-88ac-5d2c53311cd6`; see `mem:project/wix-site`).
**Design system imported (2026-07-10)** — Claude Design round-trip confirmed; chrome tokens + Space Grotesk/
IBM Plex Mono reconciled into `tokens.css` + GL bridge (`mem:patterns/design-system`). **Next step (owner-set
order): (1) globe retune** — reconcile the design's sage-grey land / near-black water swatches against the
browser-verified cartographic palette, finding the realism↔usability↔design boundary (owner-authorized globe
change; Playwright-verify); **(2) UploadFlow UI** against design board 04 + zustand; **(3) Phase 2 decode**
(`exifr` + `libraw-wasm` Worker + HEIC — needs fixtures + browser, do last). See `NEXT_SESSION_PROMPT.md`.
`wix release` still pending user greenlight. UNVERIFIED: close-up oblique cityscape aesthetic (buildings load + are grounded
by construction, but no street-level shot captured).

## Source layout (target — globe + tokens built; decode/geo/ephemeris/wix/store/backend still to come)
- `src/components/globe/` — client:only three.js scene (GlobeCanvas, StylizedTiles built; Frustum, Sky, Pins TBD). Design imports NEVER touch.
- `src/components/panels|ui/` — EXIF panel, time scrubber, upload, AI. Design imports allowed.
- `src/lib/{decode,geo,ephemeris,theme,wix}/` — worker decode, projection, geohash, GL token bridge (built), SDK clients.
- `src/store/` — zustand reactive EXIF params (spine of real-time re-projection). `src/backend/` — thin HTTP endpoints.
- `public/wasm/` — libraw/libheif assets. `public/textures/` — earth-topology (elevation) + earth-landmask. `test/` — vitest (FOV/geohash/projection).

## Key invariants (violations = bugs)
- Globe is `client:only` — **never SSR WebGL**. Decode runs in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- Stylize tiles via `load-model` material swap, **not** `BatchedTilesPlugin`. Astro **5** only (not 6).
- Globe/GL colour flows through `lib/theme/tokens.ts` (D14). Data textures = `NoColorSpace`. Fence design imports to panels/ui/styles.
- **C6 privacy:** never expose exact GPS on a public pin (reduced precision: exact/1km/city).
- No split payments → owner-mediated payout. Claude vision → JPEG only, never RAW. Wix Data → geohash, no geo query.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) + §4 (ADR D1–D15) are **binding**. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth (distilled from `DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:project/wix-site` — live URL + siteId/appId
- `mem:architecture/system-overview` — the engine + pipelines
- `mem:patterns/globe-rendering` — how the stylized globe is built (land/ocean shader, decorations, grounding, gotchas)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:memory_maintenance` — how to maintain this graph
