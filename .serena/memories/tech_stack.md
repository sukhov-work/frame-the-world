# mem:tech_stack — Frame the World

## Runtime / tooling
- Node **v22.14.0** (need ≥20.11), npm 10.9.2, nvm-managed. Wix-scoped npm registry configured. Wix CLI authed.
- Package manager: **npm with `--legacy-peer-deps`** — pnpm fails against the `@wix/cli` template. Lockfile: package-lock.json.
- Test: **vitest** (Vite-native). Types: `astro check` / tsc. Lint: **none** (no lint script; eslint/prettier were never wired) — `astro check` + vitest are the quality gates.
- Wix CLI resolved via `npx @wix/cli@latest` (project-local after scaffold; auto-fetch ~3–5s first call).

## Pinned stack (versions from DEEP_RESEARCH, July 2026) — verify latest at install
| Layer | Package | Version | License |
|---|---|---|---|
| Framework | Astro (Wix-managed headless) | **5** (NOT 6) | MIT |
| Wix | `@wix/astro` `@wix/sdk` `@wix/data` `@wix/members` `@wix/media` `@wix/pricing-plans` `@wix/ecom` `@wix/essentials` | current | — |
| 3D | `three` | r17x (WebGPU via `three/webgpu`) | MIT |
| Tiles | `3d-tiles-renderer` | ^0.4 (0.4.27) | Apache-2.0 |
| Buildings | Cesium OSM Buildings (ion asset **96188**) | quarterly | OSM/ODbL + ion ToS |
| RAW decode | `libraw-wasm` (Worker) | current | LGPL/CDDL |
| HEIC | `libheif-js` (dynamic import) | ^1.19 | LGPL-3.0 |
| Metadata | `exifr` | ^7 (lite/mini in browser) | MIT |
| Ephemeris | `astronomy-engine` | ^2 (2.1.19) | MIT |
| State | `zustand` | ^5 | MIT |
| Map fallback | `maplibre-gl` (optional) | ^5 | BSD-3 |

## Codegen / peculiarities
- WASM assets (libraw/libheif) live under `public/wasm/` (CDN-cached). Decode in a Web Worker (OffscreenCanvas, transferable ArrayBuffer).
- WASM **threads** need COOP/COEP cross-origin isolation → UNVERIFIED on managed headless → ship single-threaded SIMD.
- WebGL2 primary; WebGPU is a two-line progressive enhancement (`import * as THREE from 'three/webgpu'`, auto WebGL2 fallback).
- Cesium ion **Community** (free, non-commercial) for PoC; needs an ion API token in env (not committed).
