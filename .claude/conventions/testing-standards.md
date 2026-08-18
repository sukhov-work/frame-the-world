# Convention — Testing Standards

## Framework
- **vitest** (Vite-native, fits Astro) for unit tests. Name `*.test.ts`. Run `npm test`.
- Real `test/` map (as built 2026-08-18, 89 files): `test/lib/**` (twins of every `src/lib`
  module — the bulk) · `test/components/globe/**` (pure-twin tests of scene-module islands —
  see the twin rule below) · `test/store/**` (store logic) · `test/bake/**` (bake pipeline) ·
  `test/styles/**` (CSS contract fences, e.g. pinchHardening) · plus static fences that grep
  source files as fixtures. It does NOT mirror only `src/lib` — that claim staled 2026-08-13.

## What MUST be unit-tested (from the plan)
- **FOV math** (`lib/decode/sensors.ts`): `hFOV = 2·atan(sensorWidth / (2·focal))`; the
  `FocalLengthIn35mmFormat` shortcut (`2·atan(36/(2·focal35))`); sensor-DB lookup + fallback ordering.
- **Geohash** (`lib/geo/geohash.ts`): encode/decode round-trip; covering-prefix computation for a viewport bbox.
- **Projection** (`lib/geo/projection.ts`): EXIF → frustum transform against a known reference (e.g. an iPhone
  photo with a real `GPSImgDirection`); terrain-snap when altitude is junk.
- **Ephemeris** (`lib/ephemeris/*`): spot-check sun azimuth/altitude for a known date+location against an almanac.

## Integration / manual
- **RAW decode**: integration-decode a sample ARW in **headless Chromium** (CI-style, as `libraw-wasm` does).
  Keep sample RAWs out of git (`.gitignore` covers `test/fixtures/**/*.arw|dng|…`); store externally or via LFS.
- **Globe / cinematic flight / reduced-motion**: browser tier on desktop Chrome — see the twin
  rule below for what IS unit-testable first.
- **Wix flows** (quota rejection, viewport geohash query, digital purchase): verify in `wix dev` /
  Wix test mode; assert an elevated `POST /api/photos` returns **402 at the quota wall
  (100 free / 1000 premium)** — the endpoint-enforced wall superseded the `beforeInsert` hook
  2026-07-10 (numbers 2026-07-17).

## Discipline
- Commit the **sensor-size dataset** and unit-test the FOV/geohash math (they're the load-bearing math).
- Never delete a failing test and replace it with a comment. Fix the cause.
- `npx astro check` (types) must be clean before "done" (see `mem:task_completion`). **There is no lint
  script** in this repo — `npm test` + `astro check` are the only automated gates.
- Mark browser/Wix-cloud-only claims **UNVERIFIED** until actually run there — a passing unit test ≠ a
  working globe (see `mem:project/dev_environment`).

## The scene-test twin rule (codified 2026-08-18, audit-2 C1 — was folklore since U4/U5)
A `scene/*` module's **pure islands** (math, eased seats, selection/priority logic, format
helpers) are **exported and unit-tested** — or extracted to `lib/` when shared. The **attach/GL
structure** (geometry buffers, materials, render order, per-frame wiring) stays **browser tier**.
House examples: `azSector`/`loadPriority`/`hoverNames` (extracted to lib), `easeSeatM`/
`horizonFade`/`pointDirs`/`streetPresence` (exported from the scene module, tested in
`test/components/globe/`). A new scene module with zero testable exports should make you
suspicious — find the island.

## Browser / Wix-cloud verification harness
Launch via **`scripts/verify-chrome.mjs`** (audit-2 F2 — port-ownership check + the 3 occlusion
flags + CDP attach info); recipe + traps one-pager: `conventions/verify.md`. Three driver tiers,
in order (each was needed this project when the prior wedged):
1. **Playwright MCP** — drive `wix dev` on desktop Chrome; screenshots → `verify-shots/` (git-ignored, NEVER repo root).
2. **Chrome-extension bridge** — when Playwright MCP is wedged.
3. **Scripted CDP** — `scripts/verify-*.mjs` (raw-WebSocket harness, no deps; Node ≥22 for
   global WebSocket) for timed pose/pixel assertions.

Load-bearing verification traps (full list → `DECISIONS.md § Traps & Gotchas / Verification` + `conventions/verify.md`):
- **Check who owns the debug port FIRST** (`lsof -nP -iTCP:9222 -sTCP:LISTEN`): a stale verify
  Chrome without the occlusion flags silently keeps the port; the fresh flagged launch fails to
  bind and the client attaches to the buried stale window where rAF is frozen (~20 min lost in
  U5). `verify-chrome.mjs` automates the check.
- Occluded Chrome throttles rAF to ~1 frame/several-s → `page.bringToFront()` before any timed
  check; the occlusion flags do NOT cover tab-backgrounding.
- Hidden tiles groups crash the rAF tick → the canvas shows the last good frame; guard with a
  `renderer.info.render.frame` advance check before trusting a "hidden" measurement.
- `document.elementsFromPoint` skips `pointer-events:none` nodes; synthetic dblclicks need a preceding down/up pair.
- DEV seams for scripts: the canonical inventory (top-level globals + sub-seams) is
  **`contracts.md §3`** — never trust a prose copy.
- Re-mint the member token before verifying member flows (a stale member cookie is silently swapped for a visitor cookie).
