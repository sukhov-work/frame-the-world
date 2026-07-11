# Convention — Naming

Follow existing Astro/TS ecosystem norms; when in doubt, match nearby code.

- **Files:** components `PascalCase.tsx`/`PascalCase.astro` (e.g. `GlobeCanvas.tsx`, `PhotoDetailPanel.tsx`);
  libs/utilities `camelCase.ts` (`geohash.ts`, `projection.ts`, `pinRecords.ts`).
- **Scene modules:** one visual concern → `components/globe/scene/<concern>.ts` exporting
  `attach<Concern>(scene, opts) → { …handles, update?, dispose() }` (e.g. `attachBaseEarth`). Camera
  controllers → `create<Name>(camera, {deps}) → handle` (e.g. `createFlight`, `createExplore`).
- **Zustand stores:** `use*Store`, one per concern — the real six are `useCameraStore`, `useUploadStore`,
  `usePinsStore`, `useSaveStore`, `useTimeStore`, `useMemberStore`. Imperative *seams* the globe consumes +
  low-cadence *mirrors* it writes (`_`-prefixed setters) — see `architecture-and-patterns.md § seam + mirror`.
- **DEV globals:** `window.__<name>Store` / `__globe` / `__composer` — deliberate browser-verify seams,
  typed via `declare global`. Do not prune.
- **EXIF / geo fields:** mirror the Data Collection schema exactly (`headingDeg`, `pitchDeg`, `rollDeg`,
  `focalMm`, `focal35`, `sensorWidthMm`, `lat`, `lon`, `alt`, `geohash`, `captureTime`, `tzOffset`,
  `isPublic`, `publicPrecision`, `forSale`, `price`). Keep unit suffixes (`Deg`, `Mm`) — they prevent bugs.
- **Endpoints:** `/api/<verb-noun>` kebab (`/api/upload-url`, `/api/photos`, `/api/analyze`, `/api/moderate`).
- **Wix collections:** `Photos`, `PublicPins`, `Listings` (PascalCase singular-concept).
- **Design tokens:** CSS custom props `--color-accent`, `--color-bg`, `--space-*`, `--type-*`; the GL bridge
  re-exports them as typed constants (`ACCENT`, `BG`, `GOLDEN_HOUR`).
- **Feature flags:** `flag<Feature>` (e.g. `flagRealisticMode`), off by default.
