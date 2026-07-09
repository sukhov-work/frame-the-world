# Convention — Testing Standards

## Framework
- **vitest** (Vite-native, fits Astro) for unit tests. Install in Phase 2: `npm i -D vitest --legacy-peer-deps`.
- Tests live under `test/` mirroring `src/lib/**`. Name `*.test.ts`. Run `npm test` (wire `"test": "vitest run"`).

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
- **Globe / cinematic flight / reduced-motion**: manual smoke on desktop Chrome (WebGL is not unit-testable).
- **Wix flows** (quota #11 rejection, viewport geohash query, digital purchase): verify in `wix dev` / Wix
  test mode; assert the `beforeInsert` hook actually rejects insert #11 for a free member.

## Discipline
- Commit the **sensor-size dataset** and unit-test the FOV/geohash math (they're the load-bearing math).
- Never delete a failing test and replace it with a comment. Fix the cause.
- `npx astro check` (types) + `npm run lint` must be clean before "done" (see `mem:task_completion`).
- Mark browser/Wix-cloud-only claims **UNVERIFIED** until actually run there — a passing unit test ≠ a
  working globe (see `mem:project/dev_environment`).
