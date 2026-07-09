# Convention — Architecture & Patterns

Canonical architecture: `.claude/claude-docs/ARCHITECTURE.md` (distilled) + `DEEP_RESEARCH.md` (provenance).
This file is the day-to-day *how we structure code* contract.

## The load split (C1)
The **client** does metadata extraction, RAW decode, projection math, ephemeris, and all rendering.
**Wix** is a thin backend: auth, Data Collections, Media, Pricing Plans, eCommerce, AI proxy — reached
through a handful of HTTP endpoints. If you find yourself doing heavy compute on an endpoint, stop — it
belongs on the client.

## Repo layout (target, post-Phase-1)
```
src/
  pages/             # Astro pages: index, explore, gallery, upload, listing/[id], pricing, settings
  components/
    globe/           # client:only — GlobeCanvas, StylizedTiles, Frustum, Sky, Pins  ← design imports NEVER touch
    panels/          # ExifTweakPanel, TimeScrubber, UploadFlow, AiPanel  ← design imports allowed here
    ui/              # shared primitives  ← design imports allowed here
  lib/               # ← design imports NEVER touch
    decode/          # worker.ts (libraw-wasm), heic.ts, exif.ts (exifr), sensors.ts (sensor DB + FOV)
    geo/             # geohash.ts, projection.ts (EXIF → frustum), ecef.ts
    ephemeris/       # sun-moon-stars.ts (astronomy-engine)
    theme/           # tokens.ts (GL bridge — regenerated from src/styles/tokens.css after design import)
    wix/             # sdk clients, quota.ts, media.ts, ai.ts
  store/             # zustand stores (reactive EXIF params)
  styles/            # tokens.css (design source of truth) + Tailwind
  backend/           # HTTP endpoints, data-collection + service-plugin extensions
public/wasm/         # libraw + libheif wasm assets (CDN-cached)
test/                # vitest unit tests (FOV, geohash, projection) + fixtures
```

## Core patterns
- **Reactive projection.** EXIF params (focal, heading, pitch, position, time) live in a **zustand** store.
  The three.js scene subscribes and re-projects each frame — no server round-trip. This is the emotional
  core of the product; keep the path pure and client-side.
- **Web Worker decode.** `exifr` embedded-JPEG preview (<100ms target) on the main thread → `libraw-wasm`
  full demosaic in a Worker → transfer the display `ArrayBuffer` back zero-copy. Free RAW buffers
  immediately (26MP ≈ 80–104MB, 60MP ≈ 180–240MB heap). Mobile: half-size decode, one concurrent decode.
- **Tiles stylization** via the `3d-tiles-renderer` `load-model` event (traverse + swap materials),
  `dispose-model` for cleanup. **Never** combine with `BatchedTilesPlugin` (incompatible with per-mesh override).
- **Globe precision** via re-centering the tiles group near origin (ReorientationPlugin / CESIUM_RTC) +
  `GlobeControls` dynamic near/far. No float64 three.js fork.
- **Projection v1** = textured plane at the frustum far face (robust, occlusion-safe). Projective texturing
  is a v2 stretch.
- **One ephemeris source.** `astronomy-engine` drives sun/moon/planet positions AND scene lighting AND star
  visibility from one time+observer input.
- **Design/GL bridge.** DOM chrome and the WebGL scene read the **same tokens**: `src/styles/tokens.css`
  (source of truth) → `src/lib/theme/tokens.ts` (GL bridge: accent→pin emissive/frustum, background→fog/space,
  golden-hour→sky grade). Regenerate the bridge after any token change. **Fence the globe** — see CLAUDE.md.

## Feature flags
Add a flag for the optional **"realistic mode"** (Google Photorealistic 3D Tiles, UNMODIFIED, mandatory
attribution) — off by default (C5). Never restyle Google tiles.
