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
`?purchased=1` (post-checkout toast) · `?p=` (prod-login hash-fallback, backlog T3) · `?d=` on
`index.astro` (desktop opt-out for the mobile-default entry — sets `ftw:prefer-desktop` and skips
the `/m` redirect; new 2026-08-15).

## 2. localStorage keys (all `ftw:*`; re-diffed 2026-08-22, audit #3 D7)

| Key | Owner | Notes |
|---|---|---|
| `ftw:view-prefs:v1` | `src/lib/prefs.ts` | versioned blob; sanitizer READS legacy comet-era keys inside the blob (read-old-keys precedent, Phase C) — renames must keep that pattern |
| `ftw:simbad:v1` | `src/lib/sky/simbad.ts` | TTL cache (hits 30 d / misses 1 d) |
| `ftw:sbdb:v1` | `src/lib/sky/sbdb.ts` | TTL cache |
| `ftw:m-banner-dismissed` | `src/pages/index.astro` | new 2026-08-13 (M0) |
| `ftw:prefer-desktop` | `src/pages/index.astro` | new 2026-08-15 (mobile-default entry) — sticky desktop opt-out; set by `?d=`, checked before the coarse-pointer `/m` redirect |
| `ftw:bldg-overrides:v1` | `src/lib/globe/…` → `scene/bldgEditLabel` + the U8 edit flow | new 2026-08-19 (U8 building-height override), missed by the 2026-08-15 sweep. Per-edit scale band 0.5×–3×, keyed `<variant>\|cell-<id>\|<osmId>`; a re-bake CHECKSUM invalidates the row rather than migrating it, so a stale key is dropped, never applied to the wrong building. The backend twin (`BuildingOverrides` + `/api/building-overrides`) is provisioned but DORMANT — this key is the live store |

## 3. `window.__*` DEV seams (all DEV-gated; **21 top-level** as of 2026-08-24)

`__globe __renderer __composer __quality __globeQuality __mapWindowView __overlayRebuilds
__cameraStore __timeStore __uploadStore __pinsStore __memberStore __planStore __saveStore
__marketStore __minimapStore __skyStore __findStore __placesStore __bldgEditStore __bestSpotStore`

Verify scripts and the NEXT_SESSION_PROMPT recipe consume these — removing/renaming one silently breaks
the browser-verify tier. (NSP's list was 3 short at audit time — this file is the canonical set.)

**The registry is `src/global.d.ts`** — every seam's TYPE belongs there, not in a `declare
global` next to its owner and never behind an `as unknown as` cast. Both drifts were live at
audit #3: `__globeQuality` shipped through the exact cast the registry exists to replace (A2-5)
and `__memberStore` was declared locally in `store/member.ts`, which is why this section
under-counted by five. Both are seated now.

The five added since the 2026-08-15 count:

| Seam | Owner | Purpose |
|---|---|---|
| `__globeQuality` | `GlobeCanvas.tsx` | `{ tier, dpr, leanFlat2d, mapFlat, lean }` — **live getters**, so a reader never sees a value frozen at the last governor step. `leanFlat2d` is the coarse-pointer-only DPR latch (false on desktop by construction); `mapFlat` is the engine's real flat-chart latch on every shell |
| `__mapWindowView` | `panels/MapWindow.tsx` | the expanded chart's live centre / twist / zoom + the **resolved aim anchor**. The anchor exists so a verify script READS the ladder's result instead of transcribing it (audit #3 C8/T36 — a transcribed copy failed by 81.8 m against a correct app) |
| `__overlayRebuilds` | `scene/imageryGround.ts` | imagery-composite fresh-instance rebuild count. THE assert for the QA-7b storm — Esri GET counts cannot isolate it. Invariant: ≤ 1 post-boot per rung |
| `__placesStore` | `store/places.ts` | MY PLACES rows + the on-map toggle |
| `__bldgEditStore` | `store/bldgEdit.ts` | U8 building-height edit state |

New sub-seam (dated 2026-08-22): **`__globe.aim()`** — the radar seam's resolved state: the
shared anchor (`anchorLatDeg`/`anchorLonDeg`), `skylineClaimed` + the `coverage`/`minCoverage`
behind it (A1-16), the focal cone's BufferGeometry ids (stable across an hFov sweep proves the
T38 per-frame realloc is gone) and `shadowAutoUpdate`.

New sub-seam (dated 2026-08-22k): **`__globe.eclipse()`** — the LIVE solar + lunar eclipse state,
read out of the engine and never re-derived by a script. That is the point of it: the whole defect
class this feature exists to fix is a geometry that disagrees with the pixels, so a verify that
recomputed the ephemeris could go green while the screen showed nothing. It reports the classified
phase/coverage/magnitude, the TOPOCENTRIC separation and both angular radii (the separation is the
load-bearing number — geocentric would be 1.006° where the truth is 0.062°), the `eclipseK`
daylight scalar as every consumer sees it, the sun fragment's own `uMoonOff`/`uMoonR` in sun-disc
radii, and the lunar umbra/penumbra radii in moon radii.

**Sub-seams** (dated 2026-08-18, audit-2 D6 — verify-recipe-consumed callables under the
top-level globals; same removal/rename rule):

| Sub-seam | Owner (file:line) | Consumer / purpose |
|---|---|---|
| `__globe.fpv()` | `StylizedTiles.ts:1571` | FPV state (yaw/pitch/fov/eye/lift) — FPV verify passes |
| `__globe.plan()` | `StylizedTiles.ts:1584` | planFeed debug snapshot — planner verify |
| `__globe.tempPin()` / `__globe.explore()` / `__globe.bodies()` / `__globe.enrichedSeats()` | `StylizedTiles.ts:1585/1590/1557/1547` | pin seat, explore journey, ephemeris dirs, enriched re-seat coverage |
| `__globe.map2d()` | `StylizedTiles.ts:1596` | U1/U3 2D-mode rendered truth (buildings group membership, not a flag) |
| `__globe.u2()` | `StylizedTiles.ts:1605` | U2 FPV-stability discriminators (zoom bank, eased grounds, LRU, jump ring) |
| `__globe.u5()` / `__globe.u5Mark()` | `StylizedTiles.ts:1633/1674` | U5 loading state (flags/aim/queues/latency) + time-to-first window |
| `__globe.eclipse()` | `StylizedTiles.ts` (`window.__globe` block) | solar + lunar eclipse state + every light scalar it drives — `verify-eclipse.mjs` (37 checks) |
| `__quality.governor.emaMs()` / `.hitchCount()` | `lib/globe/quality.ts:151–153` (exposed via `GlobeCanvas.tsx:348`) | frame-time EMA + hitch counter — U2/U5 soak gates |
| `__quality.ao` | `GlobeCanvas.tsx:257` | GTAO look tuning in wix dev |
| `__globe.bestSpot()` | `StylizedTiles.ts:2161` | `bestSpotFeed.debug()` — solve state, the four streaming epochs, residency tier |
| `__globe.bestSpotSheet()` | `StylizedTiles.ts:2170` | the **LIVE** material/texture read-back. Added 2026-08-24 because `__globe` exposes no `scene`, so all seven S4 done-checks had been asserting constructor ARGUMENTS in vitest, never the shipped material |
| `__globe.bestSpotField()` | `StylizedTiles.ts:2181` | the published RG8 score field itself — **the seam that caught `rMin === rMax === 187`** (one distinct value across 31,417 cells while 1,860 unit tests passed). Read the DISTRIBUTION, never a flag |
| `__globe.bestSpotTuning` | `StylizedTiles.ts:2064`, exposed `:2187` | callable + `.export()` + `.ab()` — the 54-leaf scoring-patch console (SPEC_V2 §5.6); a weights patch costs exactly ONE job and is `recompose` |

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

- **9 API routes** under `src/pages/api/` as of 2026-08-22 (audit #3 D7 re-count; the
  2026-08-13 "26 routes" figure was the whole `wix build` route table): `/api/photos`
  (GET/POST/PATCH/DELETE), `/api/places`, `/api/listings`, `/api/market` (public GET),
  `/api/upload-url`, `/api/sbdb` (param-allowlisted JPL relay), `/api/ping` (the release canary
  — never delete), `/api/dev-seed` (DEV-gated 404 in prod), and **`/api/building-overrides`**
  (U8, new 2026-08-19): the batch-sync twin of the `ftw:bldg-overrides:v1` local store —
  PROVISIONED BUT DORMANT (the collection provision script has not been run), LWW by
  `updatedAt`, admin-elevated. It is a route on disk and in the build's route table, so it
  counts here; it is not yet a live contract.
- **`public/sw.js` — a same-origin STATIC asset, not a route, but a contract all the same**
  (re-homed here 2026-08-22 from `UXBATCH4_PLAN.md` before it was archived — audit #3 D7/D8).
  iOS-ONLY registration (coarse-pointer + Apple UA), dev-gated (never registers on localhost),
  a 7-day-TTL PERFORMANCE cache for Esri / Cesium ion / workers.dev / OpenFreeMap GETs. Its
  scope is `/`, so the filename and location are the contract — moving it silently narrows the
  scope and orphans every installed worker. Policy (what it may cache, the TTL, the iOS gate)
  is fenced by `test/swTileCache.test.ts`. ToS posture is an ACCEPTED, dated risk (T17; A2-10
  asks to extend that row's host list with Cesium ion, whose content this now caches).
  Unprobed in production: the `Content-Type` Wix hosting serves for `/sw.js` (release rider).
- Response shape note: `quota:{used,limit}` rides photos responses (limit currently always the free
  tier — audit finding B7).
- **Place quota DELETED (owner 2026-08-15c):** the `/api/places` POST 402 gate (old 50-cap) is
  GONE — no per-member SavedPlaces cap; the GET page (`PLACE_PAGE = 1000`,
  `src/lib/wix/placeRecords.ts`) is the only listing bound. A 402 from `/api/places` is no longer
  a contract.
