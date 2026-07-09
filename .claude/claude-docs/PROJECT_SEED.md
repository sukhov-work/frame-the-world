# Frame the World: Project Seed

Working title, rename freely. Owner: Yevhen. Version 1.0, 2026-07-09.
Status: research complete, pre-implementation.

**How to use this document.** Commit it to the repo root as `PROJECT_SEED.md` and reference it from `CLAUDE.md`. Paste it at the top of any new Claude session touching this project. Treat Section 3 as binding constraints and Section 4 as ADR-000: every future architecture decision either extends this log or explicitly supersedes an entry in it. Two companion documents derive from this seed and go deeper: Handoff #1 (Claude Design brief: tokens, 11 screens, motion specs) and Handoff #2 (architecture + 7-phase implementation plan for Claude Code). This seed is the source of truth on intent; the handoffs are the source of truth on execution.

---

## 1. Genesis

The project emerged from a July 2026 investigation of the Wix-managed headless platform (Astro-based, Wix-hosted serverless) and its Claude agentic toolchain (Wix MCP, Wix Skills, Claude Code plugin). A first brainstorm produced 12 candidate projects anchored in the owner's domains (astrophotography, RAW-first photography, the @svitrees art project, post-classical music). Instead of picking one, the owner synthesized an original hybrid that merges the strongest threads: EXIF intelligence, a cinematic 3D globe, ephemeris planning, and a light marketplace. Two research passes then verified the platform bindings and the full technical architecture. This document is the canonical restatement of the founding prompt plus every binding clarification and decision.

## 2. Product vision (canonical, cleaned from the founding prompt)

A minimalist, low-key but hi-tech website where a photographer posts a camera RAW (DNG, ARW, CR3, NEF, RAF, and other popular formats) or a regular image (JPEG/PNG/HEIC, with manually supplemented metadata where EXIF is thin). The app extracts maximum metadata (GPS, altitude, heading, focal length, sensor geometry, timestamp, orientation, lens) and displays how the picture fits into the real world: the photo is superimposed AR-style in 3D space, as an oriented camera frustum plus image plane, at its true capture location on a stylized, beautiful 3D world globe with real 3D buildings (spatial grounding in the spirit of f4map's OSM building demo and Google Earth, rendered with a premium stylized look). Everything happens fluidly.

The core mechanic: the user tweaks EXIF parameters in real time (focal length, heading, pitch, position, capture time) and watches the PROJECTED footage change. What could I have done differently. Time sliders drive accurate sun, moon, and star positions (PhotoPills/Stellarium-grade ephemeris fused into the same scene).

**The signature scene.** Full-browser-page globe, slightly rotating by default, seen from a cinematic low-earth-orbit angle against a realistic but restrained space backdrop. The globe is stylized and adaptive with zoom: explicitly NOT messy half-baked semi-realistic textures, and NOT flat. All public pins and activity are visible from orbit, with search and UI elements fitting organically. Selecting any pin triggers a single smooth continuous zoom-in animation (~2.2s) and transition into the photo's projection. Styling is consistent across the entire site.

### Experience pillars

1. **Ingest anything.** RAW-first (DNG/ARW/CR3/NEF/RAF plus the LibRaw long tail), with a manual-metadata path for JPEG/PNG/HEIC. Maximum EXIF extraction, instant preview.
2. **Projection, not pinning.** Photos live in the world as oriented frustums among 3D buildings, not as flat thumbnails on a map.
3. **Real-time what-if.** Every parameter is reactive; re-projection runs at frame rate, fully client-side. This is the emotional core of the product.
4. **Ephemeris built in.** Sun/moon/star sliders bound to the same scene and lighting model.
5. **Low-key surface, hi-tech core.** Minimalist UI over a deliberate showcase of modern browser tech: WASM SIMD decode, WebGL2 with WebGPU enhancement, Web Workers, OffscreenCanvas, OPFS caching, View Transitions. Performance is prioritized and is itself a feature.

### Membership and business model

- Free member: save up to 10 images. Paid plan: unlimited.
- Any saved image can be made public; public images appear to all users as pins with low-res previews, jumpable via the cinematic zoom. Public pins default to reduced location precision (see C6).
- Premium: AI analyzes the member's images and suggests setting improvements for specific desired conditions (runtime Claude), returned as concrete deltas ("shift heading +12 deg, shoot 40 min earlier").
- Marketplace (v1 light): a member can list the full high-res RAW for sale as a digital download; a fee goes to the site owner; payouts are owner-mediated.
- Members browse their own images via a gallery or by searching the globe.

## 3. Locked constraints (clarification round, 2026-07-09)

- **C1. Client-heavy by design.** Client-side WASM RAW decode is the primary path; offload as much as possible to the client. Server-side decode exists only as an optional external marketplace-verification step, and never runs on Wix HTTP endpoints (timeout/quota limits make 26-60MP decode unsuitable there).
- **C2. Both accuracy and beauty.** Real 3D buildings and maximum geo-accuracy AND an eloquent stylized cinematic look with full camera control, simultaneously. The engine hybrid in D1 exists to satisfy both; neither half may be sacrificed for the other.
- **C3. Marketplace v1 is light.** Digital-only items, tax questions ignored for the PoC, payouts owner-mediated. Verified: Wix supports no split payments, so owner mediation is the only native path.
- **C4. Platform pins.** Wix-managed headless on Astro 5 (Astro 6 unsupported), scaffolded via `npm create @wix/new`. The globe is a `client:only` island; WebGL is never SSR'd.
- **C5. Google tiles stay untouched.** Google Photorealistic 3D Tiles ToS prohibits styling/derivation. If offered at all, it is an optional, unmodified "realistic mode," off by default, with mandatory attribution.
- **C6. Wartime geo-sensitivity.** The owner is based in Dnipro, Ukraine. Public pins default to reduced precision with user-facing options (exact / ~1km / city). Exact GPS is never exposed on public low-res pins. A moderation pass gates publication.

## 4. Decision log (ADR-000)

| ID | Decision | Rationale | Rejected alternatives | Confidence |
|---|---|---|---|---|
| D1 | Globe engine: three.js + `3d-tiles-renderer@^0.4` + Cesium OSM Buildings (ion asset 96188) + `GlobeControls` | Only combination delivering real global 3D buildings (350M+, quarterly-updated), a geo-accurate 3D Tiles pipeline, unrestricted per-tile material override (`load-model` traversal) for the stylized look, and a fully custom cinematic camera | CesiumJS (restyling fights the framework); MapLibre v5 globe (fill-extrusion prisms only; retained as lightweight fallback); Google P3DT as primary (ToS bans stylization); deck.gl (second heavy abstraction, less material/camera control) | VERIFIED |
| D2 | Precision: re-center tiles group near origin (ReorientationPlugin / CESIUM_RTC) + GlobeControls dynamic near/far | Solves float32 jitter at globe scale without a double-precision fork | Custom float64 pipeline | VERIFIED |
| D3 | Decode: `exifr` embedded-JPEG instant preview (<100ms target) then `libraw-wasm` full demosaic in a Web Worker; single-threaded SIMD default; HEIC via Safari-native `createImageBitmap` detect (17-39x faster) with `libheif-js` dynamic-import fallback | Progressive UX; COOP/COEP support on the Wix CDN is unverified so threads cannot be assumed; 26MP ≈ 80-104MB heap, 60MP ≈ 180-240MB, so buffers are freed immediately and mobile uses half-size decode | Server-side decode (violates C1, unfit for Wix endpoints); dcraw ports and thinner wrappers (less coverage/maintenance) | VERIFIED (pipeline), UNVERIFIED (threads) |
| D4 | Orientation UX: nudge-to-align controls are core, not fallback; FOV = 2·atan(sensorWidth / 2·focal) with sensor DB + `FocalLengthIn35mmFormat` fallback | ILCs almost never write heading/pitch; iPhones write `GPSImgDirection`; photo GPS is 3-15m typical with unreliable altitude (terrain-snap by default) | Trusting EXIF orientation blindly | VERIFIED |
| D5 | Projection: textured plane at frustum far face for v1; projective texturing onto tiles as v2 stretch | Robust, occlusion-safe, trivial to re-project reactively | Projective texturing first (occlusion artifacts, complexity) | VERIFIED |
| D6 | Ephemeris: `astronomy-engine` 2.1.19 (MIT, ±1 arcmin, 116,485B minified, VSOP87/NOVAS) + procedural sky + Yale BSC5 (~9,100 stars) point rendering | Accurate, dependency-free, small; drives sun/moon/star sliders and scene lighting from one source | suncalc alone (no planets/stars, lower precision) | VERIFIED |
| D7 | Data: Wix Data Collections with geohash-prefix `hasSome` queries + client refine; denormalized PublicPins collection for viewport loads | Wix Data has no geo operators; geohash prefixes are the index-friendly workaround | Raw lat/lon range scans only (less index-friendly) | VERIFIED (no geo ops), INFERRED (pattern) |
| D8 | Quota: Pricing Plans check + `beforeInsert` hook rejecting insert #11 for free members | Enforced server-side at the data layer, not in UI | Client-side-only enforcement | INFERRED |
| D9 | Media: originals private, derived previews public; resumable TUS upload mandatory for files >10MB; digital download links expire after 30 days (messaged to buyers) | Platform-verified behaviors; RAW files run 25-80MB | Plain upload URL for RAW (fails size guidance) | VERIFIED |
| D10 | AI: runtime Claude via Wix AI APIs (~1 credit/method call; docs demonstrate Claude Opus 4.6), vision receives a downsized JPEG only; premium-gated; the same path doubles as the moderation pass for public pins | Wix handles auth/billing; Claude vision does not accept RAW | Direct Anthropic API (viable fallback, requires own key in Secrets Manager) | VERIFIED |
| D11 | Scheduling: none in v1; if ever needed, external trigger (GitHub Actions cron) hitting a token-secured HTTP endpoint | Wix headless has no native cron/scheduled jobs | Companion Velo site for jobs.config (extra moving part) | VERIFIED |
| D12 | Rendering: WebGL2 primary, WebGPU as progressive enhancement via `three/webgpu` (production-ready since r171; ~70-85% browser availability, July 2026) | Maximum reach now, showcase path later | WebGPU-first (excludes too many users) | VERIFIED |
| D13 | Cesium ion Community (free: 5GB storage, 15GB/mo streaming) for the PoC; switch to Commercial ($149/mo individual) at first real marketplace sale or if run under a >$50K-revenue entity; render ion attributions manually in the UI (3d-tiles-renderer does not auto-credit) | Community license covers personal/exploratory/evaluation use; an uncached city session pulls ~30-60MB so 15GB ≈ 250-500 fresh sessions/mo; dev iteration protected by OPFS/browser tile cache and 2-3 test cities | Self-hosted OSM tiles from day one (heavier lift, defer) | VERIFIED (terms/pricing), INFERRED (burn rate) |
| D14 | Design workflow: paste Handoff #1 into Claude Design (token system + 11 screens) → handoff bundle → Claude Code; keep `/design-sync` round-trip alive; bridge tokens into the GL layer (accent → pin emissive/frustum, background → fog/space, golden-hour tint → sky grade); skip Claude Design's Wix connector (it provisions its own managed project; we scaffold via CLI for control over islands, workers, WASM assets) | Design system as contract between DOM chrome and WebGL scene; prevents drift | Wix connector provisioning (loses CLI control); screenshot-driven implementation (loses fidelity) | VERIFIED (workflow), UNVERIFIED (connector provisioning details) |
| D15 | Working title: "Frame the World" | Provisional, from the design brief | | ASSUMPTION |

## 5. Architecture snapshot

The client does the heavy lifting: metadata extraction, RAW decode, projection math, ephemeris, and all rendering run in the browser (C1). Wix-managed headless provides auth (auto via `@wix/astro`), Data Collections, Media Manager, Pricing Plans, eCommerce digital products, and the AI proxy, accessed through a handful of HTTP endpoints (`/api/upload-url`, `/api/photos`, `/api/analyze`, `/api/moderate`). Repo layout, collection schemas, endpoint contracts, and the 7-phase build plan (scaffold → decode → projection → sky → members/pins → marketplace → AI/polish) live in Handoff #2 and are not duplicated here.

## 6. Positioning

PeakVisor is the nearest prior art: it imports geotagged photos, overlays a 3D terrain model, and pioneered the nudge-to-align affordance this product adopts. It has no buildings, no marketplace, and no what-if re-projection. PhotoPills plans but never projects the user's own photo; fSpy matches cameras but has no globe; Flickr/500px/Google Earth photo layers pinned flat thumbnails. The moat is the triad on one continuous cinematic globe: real-time EXIF what-if re-projection at building level, integrated ephemeris planning, and a RAW marketplace. No shipped product combines all three.

## 7. Top risks (full matrix in research report #2)

1. Mobile decode memory pressure: half-size decode on mobile, one concurrent decode, immediate buffer frees.
2. GPS/heading imprecision: absorbed by design via D4 (nudge controls, terrain snapping).
3. ion streaming quota burn during dev: tile caching active from day one, testing constrained to 2-3 cities.
4. Wartime geo-sensitivity: C6 defaults, moderation gate, no exact coordinates on public pins.

## 8. Open questions (TODO-VERIFY, internal Wix access)

- Exact per-file MB cap for RAW uploads to Wix Media (format list confirmed, cap unpublished).
- COOP/COEP response-header control on managed-headless pages (unlocks WASM threads; single-threaded SIMD is the safe default either way).
- HTTP endpoint execution-time, memory, and concurrency numbers.
- Wix AI APIs vision model list and credit cost at realistic preview sizes.
- Multi-party payout roadmap (public answer today: none).

Empirical validation before Phase 3: a6700 26MP ARW decode benchmark on desktop and a mid-range phone; OSM building coverage check for Dnipro plus 2 rural capture locations; one ephemeris spot-check against an almanac.

---

## Appendix A: Founding prompt, verbatim (provenance, unedited)

> A site where user can post a raw camera image (dng, arw, some other popular raws) or regular formats (jpeg/png/heic image with manually provided additional metadata) and the program will display nicely how this picture fits into the real world (basically superimposing it in some AR manner in 3d space on a stylized nice 3d world globe with imposed 3d buildings and stuff (think "panit pro app", here is some nice example of online service with 3d buildings (https://demo.f4map.com/) also obviously google maps) using as much exif metadata and additional user provided data as possible. All this happens in very fluid and user friendly manner. Site should be really low-key, minimalistic but hi-tech under the hood. We will prioritize performance but also will try to utilize as many nice 3d rendering (and other graphical) modern browsers features as possible. Then you can tweak exif in real time to see how this can affect PROJECTED footage, what you could have done differently etc. Also you have time sliders for moon / sun projected positions, starts etc (basically that astronomy-engine mentioned above, think Photopills app, stellarium etc). If user becomes site member - he can save image and optionally make it public, with paid pricing plan - user can have unlimited images saved and if plan is free - only 10. All public images are visible (as nice pins with low res previews) on globe for all other users and they can jump into them. For premium users AI can analyze their images and suggest improvements in settings for specific desired conditions. User can also select to publish his full high res raw to market and sell it to other users (fee will go to site owner). Also user can view all his saved images via gallery or search for them on 3d globe. 3d globe should have nice stylysed look, not a messy semi realistic half baked textures or flat should be realy nice and adaptive with zoom. By default shold be slightly rotating at a very cinematic angle, full browser page, as if user is in low earth orbit, with all pins and activities visible and nice way to search for stuff and other UI elements. very organically fitting. When selecting any pin it should be followed by very smoth continous zoom in animation and then transition. Backdrop for earth should be realistic space environment but not too over the top. Make sure all styles accross site are consistent.

## Appendix B: Clarification round (2026-07-09)

- Q1 (RAW decode path) → "client-side WASM decode totally ok and in general offload to client as much as possible" → became C1.
- Q2 (globe engine bias) → "I need 3d building and as much accuracy as possible, but at the same time i need everything to be eloquent and stylized + full camera and other controls, so find most optimal way" → became C2, resolved by D1.
- Q3 (marketplace scope) → "light version of marketplace in v1, users can put up their raws for sale, only digital items for now, ignore tax problems, payouts handled by site owner, lightly check if wix has other ways of handling cross-user payments" → became C3; the check confirmed Wix has no split payments.
