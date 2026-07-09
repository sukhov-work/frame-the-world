# Convention — Naming

Follow existing Astro/TS ecosystem norms; when in doubt, match nearby code.

- **Files:** components `PascalCase.astro` / `PascalCase.tsx` (e.g. `GlobeCanvas.tsx`, `ExifTweakPanel.tsx`);
  libs/utilities `kebab-case.ts` or `camelCase.ts` matching folder style (`geohash.ts`, `sun-moon-stars.ts`).
- **Zustand stores:** `useExifStore`, `useSceneStore` — `use*` prefix, one store per concern.
- **EXIF / geo fields:** mirror the Data Collection schema exactly (`headingDeg`, `pitchDeg`, `rollDeg`,
  `focalMm`, `focal35`, `sensorWidthMm`, `lat`, `lon`, `alt`, `geohash`, `captureTime`, `tzOffset`,
  `isPublic`, `publicPrecision`, `forSale`, `price`). Keep unit suffixes (`Deg`, `Mm`) — they prevent bugs.
- **Endpoints:** `/api/<verb-noun>` kebab (`/api/upload-url`, `/api/photos`, `/api/analyze`, `/api/moderate`).
- **Wix collections:** `Photos`, `PublicPins`, `Listings` (PascalCase singular-concept).
- **Design tokens:** CSS custom props `--color-accent`, `--color-bg`, `--space-*`, `--type-*`; the GL bridge
  re-exports them as typed constants (`ACCENT`, `BG`, `GOLDEN_HOUR`).
- **Feature flags:** `flag<Feature>` (e.g. `flagRealisticMode`), off by default.
