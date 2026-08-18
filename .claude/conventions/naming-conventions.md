# Convention — Naming

Follow existing Astro/TS ecosystem norms; when in doubt, match nearby code.

- **Files:** components `PascalCase.tsx`/`PascalCase.astro` (e.g. `GlobeCanvas.tsx`, `PhotoDetailPanel.tsx`);
  libs/utilities `camelCase.ts` (`geohash.ts`, `projection.ts`, `pinRecords.ts`).
- **Scene modules:** one visual concern → `components/globe/scene/<concern>.ts` exporting
  `attach<Concern>(scene, opts) → { …handles, update?, dispose() }` (e.g. `attachBaseEarth`). Camera
  controllers → `create<Name>(camera, {deps}) → handle` (e.g. `createFlight`, `createExplore`).
- **Zustand stores:** `use*Store`, one per concern — as built (2026-08-18) `src/store/` holds 12
  files / 11 stores: `camera`, `upload`, `pins`, `save`, `time`, `member`, `plan`, `sky`, `find`,
  `market`, `minimap` (+ `skyAim.ts`, a helper module, not a store). Imperative *seams* the globe
  consumes + low-cadence *mirrors* it writes (`_`-prefixed setters) — see
  `architecture-and-patterns.md § seam + mirror`.
- **DEV globals:** `window.__<name>Store` / `__globe` / `__composer` — deliberate browser-verify seams,
  typed via `declare global`. Do not prune.
- **EXIF / geo fields:** mirror the Data Collection schema exactly — the schema lives in
  `scripts/provision-collections.mjs` and is inventoried in `contracts.md §4` (samples, as built
  2026-08-18: `headingDeg`, `pitchDeg`, `rollDeg`, `focalLengthMm`, `hFovDeg`, `lat`, `lon`,
  `altitudeM`, `geohash9`, `capturedAt`, `isPublic`, `publicPrecision`, `priceAmount`,
  `currency`). Keep unit suffixes (`Deg`, `Mm`, `M`) — they prevent bugs.
- **Endpoints:** `/api/<verb-noun>` kebab (`/api/upload-url`, `/api/photos`, `/api/places` — the
  8-route inventory is `contracts.md §7`).
- **Wix collections:** `Photos`, `PublicPins`, `SavedPlaces` (PascalCase singular-concept; there
  is NO `Listings` collection — listing state rides Photos/PublicPins product fields).
- **Design tokens:** CSS custom props `--color-accent`, `--color-bg`, `--space-*`, `--type-*`; the GL bridge
  re-exports them as typed constants (`ACCENT`, `BG`, `GOLDEN_HOUR`).
- **Feature flags:** `flag<Feature>` (e.g. `flagRealisticMode`), off by default.
