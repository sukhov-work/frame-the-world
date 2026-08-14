<p align="center">
  <img src="docs/media/welcome.jpeg" alt="Frame the World — see your photographs where the world took them" width="920">
</p>

# Frame the World

> **App working title: Sidera** (2026-08-14). The product now leads with **planning,
> photography and exploration** — stand anywhere, scrub time, frame the sky, find the day your
> shot lines up. Uploading photos remains as a side path. "Frame the World" stays the repo /
> technical name; the sections below describe the full stack including the upload pipeline.

Upload a photograph — a RAW file straight from the camera — and see it *where the world took it*:
projected as a true camera frustum at its capture coordinates, on a stylized 3D globe with real
terrain, real OSM buildings, and a real sky computed for the moment the shutter fired. Scrub time,
watch the sun and moon move, stand where the photographer stood, and see the shot you *could* have
taken.

**But the pretty globe is not why this repo exists.**

## Why this project exists

This project is a **stress test of the Wix Headless ecosystem**. The thesis: if Wix-managed
headless (Astro 5 + the Wix SDK) can be the backend of *this* — a workload no website platform was
ever designed for — it can be the backend of anything.

So the workload was chosen to be deliberately hostile:

- **26–60 MP camera RAW decode in the browser** (WASM, Web Workers) — not a JPEG gallery
- **a 60 fps three.js globe** streaming real 3D tiles, terrain, imagery, and vector data
- **arcminute-accurate astronomy** driving lighting, shadows, and a 9,000-star sky in real time
- **members, server-enforced quotas, privacy-tiered geodata, a big-file media pipeline, and a
  digital marketplace** — built entirely on Wix primitives, no other backend anywhere

Everything photographic, orbital, and astronomical in here is the owner's side hobby — chosen to
make the test genuinely fun, personally challenging, and a probe of a second frontier:
**the limits of AI coding agents**. Every line of code, test, and document in this repository was
written by Claude Code agents, end to end, in **four days** (2026-07-09 → 2026-07-12, 17 commits).
The full agent operating harness is committed in [`.claude/`](.claude/CLAUDE.md) — it is part of
the deliverable.

## The app in 90 seconds

| | |
|---|---|
| <img src="docs/media/globe-leo.jpeg" alt="Default view: low Earth orbit" width="440"> | <img src="docs/media/photo-fpv.jpeg" alt="FPV camera view — standing inside the photo" width="440"> |
| **A living globe.** Default POV is a spacecraft in low Earth orbit: NASA Blue Marble graded into a duotone, VIIRS city lights on the night side, a ray-traced atmosphere limb, and a real terminator. Descend and Cesium World Terrain, OSM buildings, and Esri imagery dissolve in organically. | **Stand inside your photo.** The EXIF-derived frustum places the camera at its true position, heading, and field of view. FPV mode puts your eye at the apex with a photographer's HUD: focal equivalent, bearings, sun/moon day-arcs, and off-frame body chips. |
| <img src="docs/media/city-night-vector.jpeg" alt="Night city with vector streets, roads and water" width="440"> | <img src="docs/media/pins-community.jpeg" alt="Community pins with hover cards" width="440"> |
| **A real night, computed.** `astronomy-engine` drives everything from scene time: golden-hour grading, moon-phase-scaled moonlight (Krisciunas–Schaefer photometry), moon shadows, 9,096 Yale BSC5 stars (as baked 2026-07-10), the Milky Way, 26 asterisms — plus vector streets, roads, and water pinned to real terrain. | **A community layer on Wix Data.** Members save pins (100 free / 1,000 premium, quota enforced server-side), publish them at reduced precision, and explore other photographers' frames — hover cards, per-author hues, an ambient Explore autopilot, and shareable URL camera poses. |

More: live EXIF what-if re-projection (focal / heading / pitch / altitude sliders), ±12 h + multi-day
time scrubbing, location search, street-level camera (2 m above the pavement), click-anywhere
photo placement, HEIC/JPEG support with instant embedded-thumbnail preview.

## The Wix integration surface

Every backend capability in the app is a Wix primitive. What a judge should look at:

| Wix capability | How this app uses it | Status |
|---|---|---|
| **Managed auth** (`@wix/astro`) | Hosted login/signup, auto-injected auth routes, `wixSession` cookie; ambient member identity flows into every `@wix/*` SDK call, server and client — zero custom auth code | Shipped · verified live |
| **Data Collections** (`@wix/data`) | `Photos` (private, ADMIN-only writes, exact GPS lives only here) + `PublicPins` (world-readable, reduced-precision only); provisioned idempotently via REST — [`scripts/provision-collections.mjs`](scripts/provision-collections.mjs) | Shipped · verified live |
| **Elevated endpoints** (`@wix/essentials`) | Thin Astro API routes (`/api/photos`, `/api/upload-url`): validate → `elevate()` → SDK → return. The pin quota (100 free / 1,000 premium) is a count-and-reject inside the elevated insert — structurally unbypassable | Shipped · over-quota pin → 402 verified live |
| **Media Manager** (`@wix/media`) | 25–80 MB RAW originals via TUS resumable upload (private) + generated ≤1280 px public previews on the wixstatic CDN | Shipped · verified live |
| **Geo queries without geo support** | Wix Data has no geospatial operator → geohash tiers (`gh4`/`gh6`) + `hasSome` prefix queries + client refine drive the live pin viewport at every zoom | Shipped · verified live |
| **Pricing Plans** (`@wix/pricing-plans`) | Gates the 1,000-pin premium tier above the free 100 | Shipped · app installed, premium plan live (2026-07-17) |
| **eCommerce digital products** (`@wix/ecom`) | Sell the full-res RAW as a `DIGITAL` line item; 30-day download links; owner-mediated payout (platform has no split payments) | Phase 6 — next up |
| **Wix AI proxy** | Premium Claude shot-analysis + moderation gate on public pins (JPEG previews — vision doesn't take RAW) | Planned |
| **Wix CLI** | `wix dev` / `build` / `release` as the entire dev-to-prod pipeline; site-scoped tokens for REST provisioning; `env pull` for secrets | Daily driver |

## What the build proved — and falsified — about the platform

The distilled, reusable playbook lives in
[`.claude/conventions/wix-headless.md`](.claude/conventions/wix-headless.md); every item below was
hit for real during the build.

**Proven (verified on the platform, not assumed):**

1. **A heavyweight WASM + WebGL client runs fine on Wix hosting.** 26 MP RAW decode plus a
   tile-streaming globe, no special headers — the COOP/COEP cross-origin-isolation question was
   sidestepped entirely by pinning single-threaded `libraw-wasm@1.0.5` in a disposable Worker.
2. **Members with zero custom auth code.** `@wix/astro` middleware makes identity ambient; the app
   never touches a token.
3. **Unbypassable server-side quotas on headless.** ADMIN-only collection + elevated
   count-and-reject endpoint; a direct member-session insert is refused by the platform itself
   (`WDE0027`), so there is no client path around the check.
4. **Privacy by structure, not policy.** The server is the *only* writer of the public collection
   and publishes geohash **cell centers** (1 km default, ~150 m offset verified live) — exact GPS
   never exists in world-readable data. This matters: the owner builds from Dnipro, Ukraine, in
   wartime; leaking precise capture coordinates is not a theoretical risk here.
5. **Big-file media pipeline works.** TUS resumable uploads for camera RAW, async file-ready
   events, private originals + public previews.
6. **Released runtime parity.** POST routes and elevated Data writes work identically on the
   released URL — a circulating claim that they 403 in production was tested and falsified.

**Falsified / platform edges (each cost real debugging, now encoded as conventions):**

1. The CLI `dataCollections` extension does **not** provision collections from `wix dev` →
   provisioning moved to an idempotent REST script.
2. There are **no Wix Data hooks** on headless → the `beforeInsert` quota design was replaced by
   the elevated-endpoint pattern above.
3. The OAuth app redirect allowlist is **port-exact** — `wix dev` falling back from :4321 to :4322
   silently breaks hosted login until the OAuth app is PATCHed.
4. **pnpm cannot install** the `@wix/cli` template → `npm install --legacy-peer-deps`.
5. Astro is pinned to **5** (6 unsupported); the globe island must be `client:only` — SSR-ing
   WebGL is a crash, not a slowdown.
6. No cron on headless, no split payments, 30-day non-shortenable download links — all three
   shaped the marketplace design (owner-mediated payouts, buyer messaging).

## Architecture: client does the heavy lifting, Wix stays thin

A binding constraint (C1): nothing compute-heavy ever runs on a Wix endpoint — decode, projection
math, and rendering are all in-browser. Endpoints validate, elevate, call the SDK, and return.

```
Browser (the heavy half)                        Wix (the thin half)
├─ libraw-wasm / libheif decode in a Worker     ├─ @wix/astro managed auth
├─ exifr metadata (2 ms) + instant thumbnails   ├─ Thin Astro API endpoints (elevate())
├─ three.js globe — client:only island          ├─ Wix Data: Photos / PublicPins
│    terrain · buildings · imagery · vectors    ├─ Media Manager (TUS + previews)
├─ frustum projection + WGS84 geodesy           ├─ Pricing Plans (quota gate)
├─ astronomy-engine ephemeris + BSC5 sky        └─ eCommerce digital (Phase 6)
└─ zustand stores (live what-if re-projection)
```

| Layer | Choice |
|---|---|
| Framework | Astro 5 (Wix-managed headless) + React 18 islands |
| 3D | three.js 0.185 + `3d-tiles-renderer` — Cesium World Terrain & OSM Buildings (ion), Esri imagery, CARTO drape, OpenFreeMap MVT vectors |
| RAW decode | `libraw-wasm` (exact-pinned 1.0.5) in a disposable Web Worker · `exifr` · `libheif-js` |
| Ephemeris | `astronomy-engine` (JPL-Horizons-tested ±0.05°) + Yale BSC5 catalog |
| State | `zustand` |
| Backend | Wix Data · Media · Members · Pricing Plans · eCommerce · Wix AI |

**Status:** Phases 1–5.5 complete (globe, decode, projection, ephemeris sky, members + pins, the
full UX batch). Phase 6 (marketplace-light) is next. Quality gates at head: **377 vitest tests
across 38 files, `astro check` 0 errors / 0 warnings**, browser flows verified via Playwright on
`wix dev`. The released URL currently serves the earlier Phase 5 build; the latest work is
release-gated behind a canary check.

## Built entirely by AI agents

The second experiment. There is no human-written code in this repository — research, architecture,
ADRs, implementation, tests, browser verification, and documentation were all produced by Claude
Code agents. What made that work is committed and inspectable:

- **[`.claude/CLAUDE.md`](.claude/CLAUDE.md)** — the operating contract (knowledge search order,
  binding constraints, verification rules).
- **[`.claude/claude-docs/`](.claude/claude-docs/)** — `PROJECT_SEED.md` (6 binding constraints +
  15 locked ADRs), `provenance/DEEP_RESEARCH.md` (cited feasibility research), `ARCHITECTURE.md` +
  `IMPLEMENTATION_PLAN.md` (the 7-phase build), and an append-only, dated `DECISIONS.md` —
  the entire decision history survives context resets.
- **[`.claude/conventions/`](.claude/conventions/)** — distilled platform mechanics; the
  Wix-headless one is reusable by any team building on managed headless.
- **Discipline:** every claim cited or marked UNVERIFIED; nothing declared done without its
  verification tier (unit tests + typecheck locally, Playwright in the browser, `wix dev` against
  the real cloud); failed hypotheses recorded as falsified, not deleted.

## Run it

Prereqs: Node ≥ 20.11, Wix CLI authed (`npx @wix/cli@latest whoami`).

```bash
npm install --legacy-peer-deps    # pnpm fails against the @wix/cli template — proven, see conventions
npm run dev                       # wix dev — local dev wired to a real Wix site sandbox
npm test                          # 377 vitest unit tests (projection, geodesy, ephemeris, geohash…)
npx astro check                   # typecheck (0 errors at head)
npm run build && npm run release  # publish to Wix cloud — there is no other prod
```

Missing `WIX_CLIENT_ID` → `npx @wix/cli@latest env pull --json`.

## Where to look next

- **Wix mechanics playbook** → [`.claude/conventions/wix-headless.md`](.claude/conventions/wix-headless.md)
- **Intent, constraints, ADRs** → [`.claude/claude-docs/PROJECT_SEED.md`](.claude/claude-docs/PROJECT_SEED.md)
- **Execution map** → [`.claude/claude-docs/ARCHITECTURE.md`](.claude/claude-docs/ARCHITECTURE.md) + [`IMPLEMENTATION_PLAN.md`](.claude/claude-docs/IMPLEMENTATION_PLAN.md)
- **Full decision history** → [`.claude/claude-docs/DECISIONS.md`](.claude/claude-docs/DECISIONS.md)
- **City 3D-tile bakes** (Dnipro default + OSM2World variants, onboarding another city — e.g. `?enriched=st-albans-o2w`) → [`scripts/bake/README.md`](scripts/bake/README.md)
- **Decoder licenses** → [`THIRD_PARTY.md`](THIRD_PARTY.md); map/imagery attribution (Esri, CARTO, OpenStreetMap, Cesium ion, NASA, Natural Earth, OpenFreeMap) is rendered live in the app footer
