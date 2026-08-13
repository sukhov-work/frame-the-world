# Contract strings — the Hyrum inventory (Frame the World)

Authored 2026-08-13 by the first full audit (backlog T23; checklists code.md item 12 + docs.md item 11).
**These are the app's implicit public contracts** — every observable grammar below has real consumers
(share links in the wild, saved localStorage blobs, verify scripts, baked R2 clients, Wix collection
rows). Changing one is a compatibility event: parsers stay tolerant BOTH ways (old links/blobs must not
throw; new emitters keep old readers alive where possible) and every change gets a dated DECISIONS line.
Later audits diff this file against the code (docs.md item 11); source anchors are given per row.

## 1. URL hash grammars (`src/lib/geo/urlPose.ts`)

| Form | Grammar | Notes |
|---|---|---|
| `#p=` | `#p=<lat 5dp>,<lon 5dp>,<camAltM>,<heading 1dp>,<tilt 1dp 0–88>` | orbit camera pose (formatPoseHash) |
| `#f=` | `#f=<lat 6dp>,<lon 6dp>,<eyeM 1dp>,<heading 1dp>,<pitch ±max 1dp>,<fov 1dp>` | FPV pose; **eyeM is GROUND-RELATIVE by design**; eye/pitch/fov clamped on parse |
| `&t=` | `&t=<utcMs, \d{1,15}>` | rides either form; LIVE time is never written |
| parse tolerance | leading `#` optional; trailing `&t=` tolerated by the pose parser; forms mutually exclusive | old links must never throw |
| `&sky=<targetId>` | **PLANNED (MOBILE_PLAN §4.4) — not in code yet** (audit-verified 2026-08-13) | add here when built |

Query-string contracts: `?enriched=` A/B seam (`src/lib/globe/enrichedVariant.ts` — absent→env URL ·
`off`→Cesium OSM · `<name>`→`…/enriched/<name>/tileset.json` segment swap · leading `/`→verbatim) ·
`?purchased=1` (post-checkout toast) · `?p=` (prod-login hash-fallback, backlog T3).

## 2. localStorage keys (all `ftw:*`; complete as of 2026-08-13)

| Key | Owner | Notes |
|---|---|---|
| `ftw:view-prefs:v1` | `src/lib/prefs.ts` | versioned blob; sanitizer READS legacy comet-era keys inside the blob (read-old-keys precedent, Phase C) — renames must keep that pattern |
| `ftw:simbad:v1` | `src/lib/sky/simbad.ts` | TTL cache (hits 30 d / misses 1 d) |
| `ftw:sbdb:v1` | `src/lib/sky/sbdb.ts` | TTL cache |
| `ftw:m-banner-dismissed` | `src/pages/index.astro` | new 2026-08-13 (M0) |

## 3. `window.__*` DEV seams (all DEV-gated; 14 as of 2026-08-13)

`__globe __renderer __composer __quality __cameraStore __timeStore __uploadStore __pinsStore
__memberStore __planStore __saveStore __marketStore __minimapStore __skyStore`

Verify scripts and the NEXT_SESSION_PROMPT recipe consume these — removing/renaming one silently breaks
the browser-verify tier. (NSP's list was 3 short at audit time — this file is the canonical set.)

## 4. Wix Data collection schemas (source of truth: `scripts/provision-collections.mjs`)

- **Photos** (ADMIN read/write; exact GPS lives ONLY here): `title ownerMemberId lat lon altitudeM
  headingDeg pitchDeg rollDeg focalLengthMm hFovDeg fovEstimated(B) geohash9 capturedAt(TEXT)
  cameraMake cameraModel lensModel textureWidth textureHeight fileName fileSizeBytes originalFileId
  previewFileId previewUrl isPublic(B) publicPrecision publicPinId productId productVariantId
  priceAmount currency`
- **PublicPins** (read ANYONE, write ADMIN; **never exact GPS — C6**): `title photoRef authorName
  latReduced lonReduced geohash gh4 gh6 precision previewUrl capturedAt altitudeM headingDeg pitchDeg
  rollDeg focalLengthMm hFovDeg textureWidth textureHeight cameraMake cameraModel lensModel productId
  productVariantId priceAmount currency`
- **SavedPlaces**: `title ownerMemberId lat lon eyeM headingDeg pitchDeg fovDeg timeMs` — one contract
  with the `#f=` grammar (same fields, same clamps).
- There is **no Listings collection** — listing fields ride Photos/PublicPins (ARCHITECTURE §5 corrected
  by the 2026-08-13 audit).
- Schema changes land in the provision script FIRST (platform.md item 13; `extensions.dataCollections`
  does not provision from wix dev).

## 5. R2 tileset layout

- Private bucket behind the `frame-the-world` Worker; key scheme `enriched/<version>/…/tileset.json`.
- Versions live as of 2026-08-13: `dnipro-real-3` · `dnipro-o2w-2` · `st-albans-o2w`.
- Client env: `PUBLIC_ENRICHED_TILES_URL` (R2 in build/release; dev serves local `bakes/` via the Vite
  middleware — dev NEVER hits R2).
- Sync contract: `tuning.ts ENRICHED.bbox` == `scripts/bake/cities/<city>.json` bbox (regen BOTH on
  change); `variantBboxes` for cross-city variants. Worker must stay CORS `*` + Range/206 correct.

## 6. Commerce linkage

- `catalogReference` REQUIRES `options.variantId` + the fixed Wix-Stores appId
  `215238eb-22a5-4c36-9e7b-e7c08025e04e` (never the TPA id) — productId alone = silently empty checkout
  (2026-07-16 trap).
- Product linkage fields on Photos/PublicPins: `productId productVariantId priceAmount currency`;
  SITE_CURRENCY stamped at create (EUR).

## 7. HTTP surface

- 26 routes as of 2026-08-13; the stable programmatic ones: `/api/photos` (GET/POST/PATCH/DELETE),
  `/api/places`, `/api/listings`, `/api/market` (public GET), `/api/upload-url`, `/api/sbdb`
  (param-allowlisted JPL relay), `/api/ping` (the release canary — never delete), `/api/dev-seed`
  (DEV-gated 404 in prod).
- Response shape note: `quota:{used,limit}` rides photos responses (limit currently always the free
  tier — audit finding B7).
