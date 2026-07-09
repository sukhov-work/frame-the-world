# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.

## Status
**Bootstrapped, pre-implementation (2026-07-09).** Operating environment + design docs + `/frame` skill in
place; **no app code yet**. Next step is **IMPLEMENTATION_PLAN Phase 1 — scaffold + deploy "hello globe"**
(`npm create @wix/new` → three.js + 3d-tiles-renderer globe in a client:only island). See `NEXT_SESSION_PROMPT.md`.

## Source layout (target, post-Phase-1 — nothing built yet)
- `src/components/globe/` — client:only three.js scene (GlobeCanvas, StylizedTiles, Frustum, Sky, Pins). Design imports NEVER touch.
- `src/components/panels|ui/` — EXIF panel, time scrubber, upload, AI. Design imports allowed.
- `src/lib/{decode,geo,ephemeris,theme,wix}/` — worker decode, projection, geohash, GL token bridge, SDK clients.
- `src/store/` — zustand reactive EXIF params (spine of real-time re-projection). `src/backend/` — thin HTTP endpoints.
- `public/wasm/` — libraw/libheif assets. `test/` — vitest (FOV/geohash/projection).

## Key invariants (violations = bugs)
- Globe is `client:only` — **never SSR WebGL**. Decode runs in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- Stylize tiles via `load-model` material swap, **not** `BatchedTilesPlugin`. Astro **5** only (not 6).
- **C6 privacy:** never expose exact GPS on a public pin (reduced precision: exact/1km/city).
- No split payments → owner-mediated payout. Claude vision → JPEG only, never RAW. Wix Data → geohash, no geo query.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) + §4 (ADR D1–D15) are **binding**. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth (distilled from `DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:architecture/system-overview` — the engine + pipelines
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:memory_maintenance` — how to maintain this graph
