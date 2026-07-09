# mem:project/dev_environment
Where this runs and what CAN'T be trusted from a local test. (Referred by `mem:core`, `mem:task_completion`.)

## Machines
- **This Mac** = author / test / git / `wix dev`. Node v22.14, nvm, Wix-scoped npm registry, Wix CLI authed. Source of truth.
- **"Prod" = Wix managed cloud** — reached via `npx @wix/cli@latest release` (NOT SSH; there is no prod box, no `deploy/` scripts).
  The site + business are provisioned by `npm create @wix/new` onto the owner's Wix account.

## What CAN be verified locally
- Unit math (vitest): FOV, geohash, projection, ephemeris. `astro check` types. Lint. Component logic.

## What CANNOT be verified by a local unit test (mark UNVERIFIED until run in the right place)
- **Browser-only** (verify in `wix dev` on desktop Chrome + a real device): globe render + OSM buildings load,
  `load-model` stylization, cinematic camera flight, `libraw-wasm`/HEIC decode correctness + timing, peak WASM
  heap, WebGPU-vs-WebGL2 fallback, mobile memory pressure, OPFS/tile caching, View Transitions.
- **Wix-cloud-only** (verify in `wix dev` / Wix test mode / after `release`): resumable upload of a 25–80MB RAW,
  `onFileDescriptorFileReady` timing, quota `beforeInsert` rejecting insert #11, geohash viewport query results,
  digital purchase + 30-day download delivery, Wix AI credit cost + which Claude/vision models are exposed, and
  whether COOP/COEP page headers are settable (WASM threads). These are the TODO-VERIFY items — each has a safe default.

## Empirical benchmarks owed before Phase 3
a6700 26MP ARW decode ms + heap (desktop + mid phone); Dnipro + 2 rural OSM building coverage; one sun-azimuth almanac spot-check.
