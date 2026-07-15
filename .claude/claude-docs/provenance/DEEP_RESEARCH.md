# Deep-Research Pass: Technical Architecture + Handoff Prompts for the "Photo-on-Globe" Wix Headless App

## Part 1 — Executive Summary

**Bottom line: build the globe on three.js + the NASA-AMMOS `3d-tiles-renderer` (Apache-2.0, v0.4.27, May 2026) loading Cesium OSM Buildings (ion asset 96188) with per-tile material override for the stylized look, and do RAW decode client-side with `libraw-wasm` plus an `exifr` embedded-JPEG instant-preview path.** This single stack satisfies constraint 2 (real 3D buildings AND geo-accuracy AND full cinematic camera + custom materials) better than CesiumJS (hard to restyle), MapLibre (flat prism buildings only), or Google Photorealistic tiles (ToS prohibits stylization/derivation). [VERIFIED]

**The engine decision (Section C):** three.js WebGLRenderer (WebGL2 primary; WebGPU as later progressive enhancement) + `3d-tiles-renderer` + `GlobeControls` + Cesium OSM Buildings via `CesiumIonAuthPlugin`. Stylization is achieved with the documented `load-model` event, traversing each tile's meshes and swapping materials. Globe-scale float64 precision is handled by re-centering the tiles group near the origin (manual, `ReorientationPlugin`, or `GLTFCesiumRTCExtension`) plus `GlobeControls` dynamic near/far. Google Photorealistic 3D Tiles is retained only as an optional "realistic mode" toggle, never restyled.

### Final architecture (textual + ASCII)

```
                          BROWSER (Astro client:only island)
  +-----------------------------------------------------------------------+
  |  Upload UI  ->  Web Worker (decode)                                   |
  |     |            - exifr: metadata + embedded JPEG (instant preview)  |
  |     |            - libraw-wasm: full RAW demosaic (progressive)       |
  |     |            - libheif-js: HEIC fallback (if no native support)   |
  |     v                                                                 |
  |  State store (Zustand)  <----- reactive EXIF params (focal, heading,  |
  |     |                            pitch, position, time)               |
  |     v                                                                 |
  |  three.js scene (client:only)                                         |
  |    - 3d-tiles-renderer -> Cesium OSM Buildings (ion 96188)            |
  |    - GlobeControls (orbit -> street continuous zoom)                  |
  |    - custom stylized materials (load-model traversal)                 |
  |    - camera frustum + photo image-plane primitive per pin            |
  |    - procedural sky + sun/moon/stars (astronomy-engine)              |
  |    - post FX: color grade / fog / bloom (restrained)                 |
  +----------------------------|------------------------------------------+
                               |  Wix JS SDK (auto-auth via @wix/astro)
                               v
                     WIX-MANAGED HEADLESS (serverless)
  +-----------------------------------------------------------------------+
  |  HTTP endpoints (Astro backend)                                       |
  |    - POST /api/photos (elevate + insert to Data Collection)          |
  |    - POST /api/upload-url (generateFileResumableUploadUrl for RAW)   |
  |    - POST /api/analyze (runtime Claude via Wix AI APIs)              |
  |  Data Collections: Photos, PublicPins, Listings                      |
  |  Media Manager: originals (private) + derived previews (public)      |
  |  Pricing Plans API: free(10)/paid(unlimited) quota                   |
  |  eCommerce: digital products for RAW sales (owner-mediated payout)   |
  +-----------------------------------------------------------------------+
```

### Stack list with versions (July 2026)

| Layer | Choice | Version | License |
|---|---|---|---|
| Framework | Astro (Wix-managed headless) | Astro 5 (Astro 6 NOT supported by Wix link) | MIT |
| 3D engine | three.js | r17x (WebGPU via `three/webgpu`) | MIT |
| Tiles | 3d-tiles-renderer | 0.4.27 | Apache-2.0 |
| Buildings | Cesium OSM Buildings (ion asset 96188) | quarterly-updated | OSM/ODbL + ion ToS |
| RAW decode | libraw-wasm | current | LGPL/CDDL (LibRaw dual) |
| HEIC decode | libheif-js | 1.19.8 | LGPL-3.0 |
| Metadata | exifr | 7.x | MIT |
| Ephemeris | astronomy-engine | 2.1.19 | MIT |
| Map fallback | MapLibre GL JS | 5.24.0 | BSD-3 |
| State | Zustand | 5.x | MIT |

### Cost table ($/month at PoC scale)

| Item | PoC cost | Notes |
|---|---|---|
| Wix hosting (free tier) | $0 | Global CDN, SSL, serverless included; 10GB storage cap on non-premium |
| Cesium ion Community | $0 | Free for non-commercial/eval: 5GB storage, 15GB/mo streaming |
| Cesium ion Commercial (if monetizing) | $149/mo | Per Vendr's Cesium listing: "$1,788/year ($149/month). Includes 50 GB storage, 150 GB/month data streaming, 5,000 Bing Maps sessions/month, 5,000 Google P3DT/month, 25 Clips/month, and 50,000 geocodes/month" |
| Google Photorealistic 3D Tiles | $0 at PoC | Enterprise SKU: 1,000 free events/mo; only if "realistic mode" enabled |
| Anthropic/Wix AI credits | ~$0-low | ~1 Wix AI credit per method call; billed to site owner |
| Wix Premium (for payments/custom domain) | ~$29/mo | Required to accept payments and connect custom domain |
| **Total PoC (non-commercial)** | **$0** | Everything on free tiers |
| **Total early-commercial** | **~$178/mo** | Wix Premium + ion Commercial |

---

## Part 2 — Research Findings A-H

### A. Client-side RAW decode (WASM)

**Primary recommendation: `libraw-wasm` (ybouane/LibRaw-Wasm) for full decode + `exifr` for instant embedded-JPEG preview.** [VERIFIED]

- `libraw-wasm` wraps LibRaw compiled to WASM, exposes `open()`, `metadata()`, `imageData()` (RGB pixels), and `rawImageData()` (16-bit mosaic). It has CI integration tests decoding `example-sony.ARW` in headless Chromium, confirming Sony ARW support. [VERIFIED] LibRaw itself supports Sony ARW (a6700-class), Apple ProRAW DNG, Canon CR3 (ISOBMFF), Nikon NEF, and Fujifilm RAF; the LibRaw camera list is frozen per major release and is the industry-standard coverage. [VERIFIED]
- Alternative wrappers: `ssssota/libraw.wasm` (~30 stars, thinner), `discere-os/LibRaw.wasm` (SIMD-optimized fork claiming professional coverage). `libraw-wasm` is the most actively documented; note its author states ~90% of the code was AI-generated, so validate edge cases. [VERIFIED] [caveat]
- LibRaw dual license: LGPL 2.1 or CDDL 1.0 (pick one). No GPL contamination for either. [VERIFIED]
- **License risk**: LGPL/CDDL dynamic linking via WASM is acceptable for a web app; you are not statically linking into proprietary native binaries. [INFERRED]

**Instant-preview strategy (progressive):** Most RAW files embed a full-size JPEG preview. `exifr` can extract the embedded thumbnail (`extractThumbnail()`), giving a sub-100ms preview while `libraw-wasm` demosaics the full frame in the background. This is the recommended two-stage pipeline. [VERIFIED for exifr thumbnail API; INFERRED for the exact latency]

**Memory + performance:** A 26MP ARW decodes to ~26M x 3 (or 4) bytes = ~78-104MB RGB in the WASM heap; a 60MP file ~180-240MB. wasm32 has a hard 4GB linear-memory ceiling; a single decode is well within it, but you must free buffers between images and avoid holding multiple decoded frames. [INFERRED from arithmetic + known wasm32 limit] Run decode in a Web Worker with `OffscreenCanvas` and transfer the `ArrayBuffer` (zero-copy) back to the main thread. [VERIFIED pattern]

**Threads / SIMD:** WASM SIMD is broadly available in all 2026 browsers. WASM threads require `SharedArrayBuffer`, which requires cross-origin isolation (COOP: `same-origin` + COEP: `require-corp`). **Whether Wix-managed headless lets you set COOP/COEP response headers on Astro pages is UNVERIFIED** — Wix docs confirm you can set response headers on HTTP functions (`WixHttpFunctionResponse.headers`, with the caveat that free sites can't set `content-type: text/html`), but page-level COOP/COEP control on the managed CDN is not documented. **Fallback: single-threaded SIMD decode**, which LibRaw-WASM supports without cross-origin isolation. Design for single-threaded first; treat threads as an optional speedup only if header control is confirmed. [UNVERIFIED - flagged for internal check]

### B. Metadata extraction

**Recommendation: `exifr` (MIT, ~73KB full / 45KB lite / 22KB gzipped full).** [VERIFIED] It is the fastest JS EXIF library, parses via pointer-jumping rather than full-file reads, and handles JPEG, TIFF/IIQ, HEIC/HEIF, PNG, and RAW (DNG/CR2/CR3/NEF/ARW/ORF/RW2/RAF/etc. are TIFF-container-based and parse through the TIFF path). [VERIFIED]

- **Segments:** EXIF/TIFF + GPS (✔ all formats), XMP (✔ JPEG/TIFF/HEIC, ✗ PNG), IPTC, ICC, thumbnail extraction (✔ JPEG). GPS block gives `GPSLatitude`, `GPSLongitude`, `GPSAltitude`, `GPSImgDirection` (heading), `GPSImgDirectionRef`. [VERIFIED]
- **Heading availability**: iPhones write `GPSImgDirection`; dedicated cameras (Sony a6700, most ILCs) almost never do. Design implication: **heading and pitch must be user-adjustable with sensible defaults** (e.g., default heading = 0/north or derived from a subsequent-frame GPS track if present; default pitch = 0 horizon). [VERIFIED for iPhone behavior; INFERRED design implication]
- **Pose/pitch tags** (`PoseHeadingDegrees`, `PosePitchDegrees`) live in XMP and are rare (Google panorama/Photo Sphere). Parse them opportunistically. [INFERRED]
- **FOV computation**: horizontal FOV = 2 × atan(sensorWidth / (2 × focalLength)). `FocalLengthIn35mmFormat` (EXIF tag) gives a shortcut: hFOV = 2 × atan(36 / (2 × focal35)). When only the physical focal length is present, derive sensor width from a camera-model lookup. **Maintained sensor dataset**: use a curated table keyed on `Make`+`Model`; the exiftool/LibRaw databases embed sensor geometry, or use community "camera sensor sizes" datasets. Fall back to `FocalLengthIn35mmFormat` when model is unknown. [VERIFIED formula; INFERRED dataset approach]
- **HEIC**: exifr reads HEIC metadata natively. Pixel decode is separate (see F). [VERIFIED]

### C. Globe + 3D buildings engine (the core decision)

**WINNER: three.js + `3d-tiles-renderer` (0.4.27) + Cesium OSM Buildings.** [VERIFIED]

**1. CesiumJS + Cesium OSM Buildings / Google P3DT.** CesiumJS (Apache-2.0) is the most geo-accurate and has `Cesium3DTileset`, camera control, `CustomShader`, and post-processing stages. But restyling Cesium's globe to a minimalist stylized look fights the framework's photorealistic defaults, and integrating a bespoke cinematic camera + arbitrary three.js-style materials is harder than in raw three.js. Cesium ion Community is free (non-commercial); Commercial is $149/mo (50GB storage, 150GB/mo streaming, 5,000 Google P3DT/mo). Resium provides React bindings. Viable but not optimal for constraint 2. [VERIFIED]

**2. three.js + `3d-tiles-renderer` (the chosen hybrid).** The NASA-AMMOS renderer (Apache-2.0, v0.4.27 May 2026, three.js + Babylon + r3f) loads Cesium ion assets via `CesiumIonAuthPlugin({ apiToken, assetId })` and specifically loads **Cesium OSM Buildings (asset 96188)** — confirmed in GitHub issue #662, where maintainer gkjohnson notes the globe-sized tileset works when you "position the camera far out and use the `GlobeControls` class" and that OSM buildings "won't show up until the camera is close up." (The fix required an ADD-refinement bug patch, so pin a recent 0.4.x.) [VERIFIED] Per Cesium's official product page, Cesium OSM Buildings "is a 3D buildings layer covering the entire world... derived from OpenStreetMap and contains over 350 million buildings with per-building metadata... Coverage: Global, updated quarterly." [VERIFIED]
   - **Stylization**: the documented `load-model` event lets you traverse each tile scene and swap materials (`scene.traverse(c => { if (c.material) c.material = new MeshBasicMaterial(); })`), with a companion `dispose-model` event for cleanup. This is exactly the mechanism for a stylized non-photorealistic look with full material/shader control. Caveat: `BatchedTilesPlugin` (draw-call optimization) is incompatible with per-mesh material override, so don't combine them. [VERIFIED]
   - **Float64 precision**: handled by re-centering the tiles group near the origin — manually (`getBoundingSphere` then negate `group.position`), via `ReorientationPlugin` (`transformLatLonHeightToOrigin()`), or via `GLTFCesiumRTCExtension` (CESIUM_RTC relative-to-center, on by default). No double-precision fork of three.js needed; `GlobeControls` also does dynamic near/far to fight z-fighting. [VERIFIED]
   - **Draco + KTX2**: both supported via `GLTFExtensionsPlugin({ dracoLoader, ktxLoader, meshoptDecoder })` or manual loader registration. Covers Google P3DT and Cesium tiles. [VERIFIED]
   - **GlobeControls**: Google-Earth-style navigation with ellipsoid-aware rotation, globe inertia, automatic near/far, continuous orbit-to-street zoom. Exposed as `<GlobeControls />` in r3f. [VERIFIED]
   - **License**: Apache-2.0. Bundle size UNVERIFIED (Bundlephobia was unreachable) but it is pure-JS, tree-shakeable via sub-path exports, and lists three.js as a peer dependency (not bundled). [VERIFIED license; UNVERIFIED size]

**3. MapLibre GL JS v5 globe + fill-extrusion.** Globe projection shipped in v5.0.0 (Jan 2025); current 5.24.0. Vector styling makes stylization trivial and it can host three.js via custom layers (globe example exists). But `fill-extrusion` buildings are flat-roof prisms from OSM height data, NOT detailed models — fails the "real 3D buildings" requirement for a premium look. Historically pitch was capped (~85°). Keep MapLibre as the **fallback / lightweight 2D-ish mode**, not primary. [VERIFIED]

**4. deck.gl + Tile3DLayer / GlobeView.** Viable alternative hybrid (Tile3DLayer loads 3D Tiles, GlobeView exists) but adds a second heavy abstraction over luma.gl and gives less direct cinematic-camera + custom-material control than raw three.js. Not chosen. [INFERRED]

**5. Google Photorealistic 3D Tiles — terms.** Available via Map Tiles API; requires billing account + API key; Enterprise SKU with 1,000 free events/mo; a single root tileset request allows ≥3 hours of tile requests. **Critical ToS constraint**: Google explicitly prohibits "image analysis, machine interpretation, object detection/identification, geodata extraction or resale, offline uses" and states the tiles are "not survey-grade" and "programmatically reading and recording measurements ... is considered derivative and is prohibited." Attribution (Google logo + data-provider strings) is mandatory. **Recoloring/stylizing photorealistic tiles is impractical and against the spirit of the ToS** — this favors OSM buildings for the stylized look. Use Google P3DT only as an optional, unmodified "realistic mode." [VERIFIED]

**6. OSM building data sources.** Cesium OSM Buildings (ion asset 96188) covers the entire world, >350M buildings with per-building metadata, updated quarterly (most recent OSM timestamps observed: Jan 13 2025 and Apr 1 2025). Free on ion Community. Alternative: self-host fill-extrusion vector tiles from OpenFreeMap/Protomaps (trivial styling, but prisms not models). Dnipro/Ukraine OSM building coverage is generally decent in urban cores; rural coverage is sparse (mitigation in H). [VERIFIED for Cesium OSM; INFERRED for Dnipro specifics]

### D. Photo-into-world projection math + UX

- **Camera frustum from EXIF**: position from GPS (lat/lon/alt, snapped to terrain when altitude is junk); orientation from heading (yaw), pitch, roll (roll usually 0 or from `Orientation` tag); FOV from focal + sensor (Section B formula). Build a `THREE.PerspectiveCamera` proxy or a manual frustum, and render the photo as a **textured plane at the frustum's far face** (simplest, robust) with an optional **projective-texture mode** that projects the image onto terrain/buildings (feasible on 3D tiles via a projective UV shader but more complex and prone to occlusion artifacts). Recommend textured-plane primary, projective as a v2 stretch. [VERIFIED math; INFERRED feasibility ranking]
- **Real-time EXIF tweak**: once frustum params (focal, heading, pitch, position, time) are reactive state, re-projection is trivial and fully client-side — update the camera/plane transforms each frame. No server round-trip. [VERIFIED architecture]
- **Prior art for alignment UX**: fSpy (single-image camera matching), PeakVisor (imports any geotagged photo, overlays a 3D landscape model, and lets the user "adjust mountain panorama to perfectly match your photos because recorded by camera photo position might be imprecise"), PhotoPills/Stellarium (planning). Adopt PeakVisor's "nudge to align" affordance. [VERIFIED]
- **Ephemeris sky**: `astronomy-engine` (MIT, 116,485 bytes minified) per its GitHub README is "designed to be small, fast, and accurate to within ±1 arcminute. It is based on the authoritative and well-tested models VSOP87 and NOVAS C 3.1... rigorously unit-tested against NOVAS, JPL Horizons, and other reliable sources of ephemeris data." It drives sun/moon/planet positions from time + observer lat/lon/elev; use `Horizon`/`Equator` transforms for azimuth/altitude. [VERIFIED] Drive a procedural sky shader (Preetham or Hosek-Wilkie in three.js) and a star field from the Yale Bright Star Catalog (~9,100 stars, BSC5) rendered as points sized by magnitude. [VERIFIED catalog; INFERRED rendering approach]

### E. Wix platform bindings

- **Media upload**: `generateFileUploadUrl()` returns an upload URL; PUT the file to it. Wix recommends `importFile()` for larger files, and **`generateFileResumableUploadUrl()` (TUS protocol) for files >10MB** — RAW files at 25-80MB MUST use the resumable path. Errors include `FILE_SIZE_OVER_LIMIT` and `SITE_QUOTA_EXCEEDED`. `generateFileUploadUrl` requires Wix app/user identity (elevate in backend). Visitor uploads land in `visitor-uploads/`. File readiness is async — listen to `onFileDescriptorFileReady()`. [VERIFIED] Supported RAW extensions confirmed by Wix Media: `.arw .srw .nef .cr2 .cr3 .crw .rwl .rw2 .raw .raf .pef .orf .mrw .dng .sr2 .srf .kdc .k25 .dcr .x3f .erf .3fr` plus HEIC/HEIF. **Exact per-file MB size cap for RAW is not published — flag for internal check.** [VERIFIED format list; UNVERIFIED size cap]
- **Storage**: store originals as **private** Media files; store derived low-res previews + mid-res projected textures as public. Non-premium sites cap at 10GB total storage. [VERIFIED]
- **Data Collections + geo-query**: Wix Data query language supports `$eq/$ne/$hasSome/$hasAll/$in/$gt/$lt/$exists/$and/$or/$not` but **has NO native geospatial / `.near` / bounding-box operator.** [VERIFIED] Strategy: store lat/lon as numbers plus a precomputed **geohash** string; query a viewport by `hasSome` on a set of geohash prefixes (compute covering prefixes client-side), then refine client-side. Alternatively range-filter on lat and lon numeric fields with `.gt/.lt` for a bounding box (works but less index-friendly). [INFERRED - standard pattern given no geo ops]
- **Quota (10 free / unlimited paid)**: enforce with Pricing Plans API to check the member's active plan, plus a Data hook (`beforeInsert`) or service plugin that counts the member's existing photos and rejects insert #11 for free members. [VERIFIED APIs exist; INFERRED enforcement design]
- **eCommerce digital products**: Wix Stores digital files auto-deliver a **download link valid for 30 days** (not configurable down; community apps like Customer Download Hub work around it). Digital line items require `itemType.preset: DIGITAL` and a `digitalFile`. For owner-mediated RAW sales, create digital products (or custom line items) and let the owner fulfill/payout manually. [VERIFIED]
- **Multi-party payments**: **Wix does NOT support split payments** — confirmed by Wix Help Center ("Currently, it is not possible to accept split payments in Wix"). No Stripe-Connect-style flow natively. Third-party marketplace apps (e.g., Webkul Multi-Vendor) implement payouts via the seller's own PayPal + manual/auto admin transfer. **v1 decision: owner-mediated manual payout is the only realistic path.** [VERIFIED]
- **Runtime Claude via Wix AI APIs**: Wix AI APIs proxy multiple providers; the docs explicitly show **Claude Opus 4.6** streaming, and note "When a provider releases a new model, it might take a few days before Wix supports it." Each method call ≈ 1 AI credit; Wix handles auth/billing (billed to site owner when developing a site; to the installing user for apps). App dev requires the `INVOKE AI MODELS` permission scope. Claude vision supports JPEG/PNG/GIF/WebP (NOT RAW) — so **send a downsized JPEG preview (not the RAW) to the vision model.** Alternative: call Anthropic directly from an HTTP endpoint with your own key. [VERIFIED]
- **HTTP endpoint limits for server-side fallback decode**: Wix backend has execution-time limits (504 on timeout) and per-minute request quotas (429 when exceeded). Server-side 60MP RAW decode is **unsuitable** on this platform — confirms constraint 1 (client-side decode primary). Server decode only as a last-resort marketplace verification, ideally offloaded to an external service, not the Wix HTTP endpoint. [VERIFIED limits exist; INFERRED unsuitability]
- **Astro SSR + islands**: the globe must be a **`client:only="react"` island** (or client-load) to avoid SSR of WebGL. Wix-managed headless uses Astro 5 with `output: 'server'`, `@wix/astro`, `@astrojs/react`, and `@wix/cloud-provider-fetch-adapter`. **Astro 6 is NOT supported for linking.** [VERIFIED]
- **Headers / COOP-COEP / CDN**: HTTP-function response headers are settable; page-level COOP/COEP on the managed CDN is UNVERIFIED (see A). Static WASM/tiles are served via the global CDN with automatic caching. [VERIFIED CDN; UNVERIFIED COOP/COEP]

### F. Performance + browser tech showcase

- **WebGPU (July 2026)**: shipped by default in Chrome/Edge 113+, Firefox 141+ (Windows), 145+ (Apple-silicon macOS), and Safari 26 (macOS Tahoe 26 / iOS 26 / iPadOS 26). Global coverage ~70-85% (sources vary: web.dev/byteiota ~70%; programming-helper cites 84.68% as of Mar 2026). Firefox on Linux/Android still rolling out. Per the three.js WebGPU migration guide: "Since Three.js r171 (September 2025), WebGPU is production-ready with zero-config imports. Just use import * as THREE from 'three/webgpu' and you get WebGPU rendering with automatic WebGL 2 fallback." **Recommendation: WebGL2 primary, WebGPU as a two-line progressive enhancement.** [VERIFIED]
- **WASM SIMD + threads**: SIMD universal; threads need COOP/COEP (see A). [VERIFIED]
- **OffscreenCanvas in worker**: feasible with three.js; use for the decode pipeline at minimum. Full globe render in a worker is possible but adds complexity — recommend main-thread render, worker decode. [INFERRED]
- **KTX2/Basis**: use for photo textures and tile textures to cut GPU memory. [VERIFIED support via 3d-tiles-renderer]
- **IndexedDB/OPFS caching**: cache decoded previews + tiles in OPFS/IndexedDB to avoid re-decode/re-fetch. [INFERRED best practice]
- **View Transitions API**: use for gallery→globe and pin→detail transitions (broadly supported in Chromium 2026; Safari support improving). [INFERRED]
- **HEIC decode**: browsers largely still don't decode HEIC except **Safari 17.6+ which supports `createImageBitmap()` on HEIC natively**. Per the PicShift build write-up: "Safari 17.6+ natively supports createImageBitmap() for HEIC files. In our benchmarks, this is 17–39x faster than any JS/WASM approach. We detect capability via a simple try/catch — zero-cost probing." Feature-detect via try/catch; fall back to `libheif-js` (1.19.8, LGPL-3.0, ~1.4MB, dynamic-import only when needed). Note `exifr` reads HEIC *metadata* regardless; libheif is only needed for *pixels*. [VERIFIED]
- **Mobile Safari memory budget**: WASM heap for a 26MP decode (~80-100MB) + GL textures can approach mobile limits; free RAW buffers immediately after generating the display texture, prefer half-size decode on mobile, and cap concurrent decodes to 1. [INFERRED]

### G. Competitive / prior-art scan

**PeakVisor** is the closest prior art: it imports any geotagged photo, overlays a high-precision 3D terrain model, labels peaks in AR, includes sun/moon trails for photo planning, and lets users nudge the panorama to match imprecise camera GPS — but it is **terrain/mountain-focused, has no 3D buildings, no marketplace, and no real-time "what-if" EXIF re-projection of the user's own photo into a stylized city globe.** PeakVisor has a web import-photo tool plus iOS/Android apps. **PeakFinder** (since ~2010) is a lighter AR peak-identifier. **PhotoPills** is a mobile-only planning app (sun/moon/Milky Way ephemeris, AR) with no photo-on-globe web product. **fSpy** does single-image camera matching but is a desktop tool with no globe. **Explorest** curates photo spots. **Flickr/500px map** and **Google Earth photo layers** historically pinned geotagged photos on a map/globe but as flat thumbnails, not oriented camera frustums with editable parameters. **Google Earth Studio** does cinematic camera paths but not user-photo projection.

**Distinct positioning**: this product is the only one combining (1) real-time EXIF what-if re-projection of the user's own RAW into a stylized 3D-building city globe, (2) ephemeris-driven sun/moon/star planning bound to the same scene, and (3) a light marketplace for the source RAWs — all on one continuous cinematic globe. That triad is the moat. [VERIFIED for each competitor's feature set; INFERRED for the synthesis]

### H. Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| WASM decode perf on mobile | High | Half-size decode on mobile; single concurrent decode; instant embedded-JPEG preview via exifr; free buffers immediately |
| 3D tiles bandwidth cost | Med | Cesium OSM Buildings free on ion Community; cap streaming; OSM buildings load only at close zoom (fewer tiles); monitor ion 15GB/mo streaming quota |
| Google tiles ToS (if realistic mode) | Med | Never restyle/derive; show mandatory attribution; keep Google mode optional and off by default; no measurement/extraction |
| OSM building gaps (rural capture) | Med | Fallback to terrain-only + horizon line + procedural sky when no buildings; still show frustum + sun/moon over terrain |
| GPS precision (3-15m, junk altitude) | High | User nudge controls for position/heading/pitch (PeakVisor pattern); snap altitude to terrain height by default |
| Wix media upload size cap for RAW | Med | Use resumable upload (>10MB); confirm exact cap internally; store originals private; consider client-side downscale-before-upload for previews |
| Content moderation (public pins) | Med | Queue public pins for owner review; runtime Claude moderation pass on the preview JPEG before publishing |
| **Ukraine wartime geo-sensitivity** | **High** | **User-facing precision-reduction option (snap public pin to ~1km grid or city centroid); default public pins to reduced precision; allow disabling exact coordinates near sensitive areas; never expose exact GPS on public low-res pins.** |

---

## Part 3 — HANDOFF PROMPT #1: Claude Design brief

```
You are designing the complete visual system and screen inventory for a web app called (working title) "Frame the World." Produce high-fidelity screen designs. Do NOT ask for more context; everything you need is below.

PRODUCT IN ONE PARAGRAPH
A minimalist, low-key but hi-tech website where a photographer uploads a camera RAW (DNG/ARW/CR3/NEF/RAF) or a JPEG/PNG/HEIC, and the app reads its EXIF/metadata and projects the photo as an oriented camera frustum + image plane at its real-world capture location on a beautiful, stylized 3D world globe with real 3D buildings. Users tweak EXIF parameters (focal length, heading, pitch, position, time) in real time to see how the projected shot changes ("what could I have done differently"). Time sliders drive sun/moon/star positions. Members save images; public images appear as low-res pins on a shared globe. Premium users get AI shot-improvement suggestions. A light marketplace lets users sell their full-res RAWs as digital downloads.

BRAND MOOD
Minimalist, hi-tech, cinematic. The signature moment is the landing: a full-browser-page, slowly rotating Earth seen from a cinematic low-earth-orbit angle, against a restrained, non-busy space backdrop (deep near-black with the faintest star dust, no lens flares, no garish nebulae). The globe is STYLIZED and adaptive-with-zoom: clean, restrained, elegant — NOT messy half-baked semi-realistic satellite textures, NOT a flat 2D map. Think "premium observatory instrument," calm and precise.

COLOR DIRECTION (dark space-neutral, single accent)
- Base background: near-black to deep space blue-black. Example hex range: #05070B to #0B0F14.
- Surface/panel: #12161C to #1A1F27 with subtle 1px borders at #232935.
- Text primary: #E8ECF2; secondary: #9AA4B2; muted: #5B6472.
- Single accent (choose ONE and use sparingly for active states, the frustum, key CTAs): a luminous cyan-to-teal, example #38E1D0 / #2FD1C4, OR a warm amber #FFB865 if you prefer a "golden hour" signature. Pick one accent family and commit.
- Land/globe stylized palette: desaturated slate greens/greys for land, darker for water, buildings in a slightly lighter cool grey that catches the accent on hover. Sun-driven warm tint at golden hour.

TYPOGRAPHY
- One geometric/grotesk sans for UI (e.g., Inter, Söhne, or similar). Tight, technical, generous letter-spacing on labels.
- A monospace for numeric readouts (focal length, lat/lon, azimuth, time) to reinforce the instrument feel.
- Large, quiet headings; small ALL-CAPS micro-labels for controls.

FULL SCREEN / PAGE INVENTORY (design each)
1. Landing / Globe Home: full-page rotating stylized globe, minimal top nav (logo, Explore, Upload, Sign in), a single quiet headline overlay, public pins scattered as small glowing dots. Idle auto-rotation.
2. Globe Explore (authenticated or public): same globe, filter chips (time of day, recent, near me), pin clustering, hover preview card.
3. Pin selected -> cinematic zoom-in: continuous camera flight from orbit down to the capture location; the photo's frustum + image plane fade in; detail overlay slides up.
4. Photo Detail overlay: the projected photo in-scene, plus a right-side EXIF tweak panel (sliders: focal length, heading, pitch, position nudge, roll) and a bottom time scrubber (date + time-of-day driving sun/moon/stars). Numeric monospace readouts. A "reset to EXIF" control. A subtle before/after of the projected footprint.
5. Upload flow: drag-drop zone; instant embedded-JPEG preview; decode progress; a metadata review step (auto-filled fields + manual supplement for missing heading/pitch/GPS); "place on globe" confirm.
6. Gallery (my images): grid of the member's saved images with quota indicator (e.g., "7 / 10 saved" for free, "Unlimited" for paid); quick actions (edit projection, make public, list for sale, delete).
7. Marketplace listing: a photo's sale page — large stylized preview, price, "digital download (full-res RAW)" badge, seller info, buy button; clear "digital-only, delivered as download" messaging.
8. Purchase / checkout: minimal Wix-commerce checkout skin consistent with the dark theme; post-purchase "download available for 30 days" notice.
9. Auth / Membership / Pricing: sign-in/up; a pricing page with Free (save up to 10 images) vs Paid (unlimited + AI shot analysis) tiers; single accent on the recommended tier.
10. AI Analysis panel (premium): within Photo Detail — a "suggest improvements for [desired condition: golden hour / blue hour / clear sky]" control that returns Claude's suggestions as tidy cards (e.g., "shift heading +12° and shoot 40 min earlier").
11. Settings: profile, default public-pin precision (privacy: exact / ~1km / city), units, theme density.

INTERACTION SPECS
- Pin hover: dot grows 1.4x, faint accent ring, small preview card (thumbnail + focal + location) after 150ms delay.
- Continuous zoom-in transition (pin -> detail): single uninterrupted camera flight, ~2.2s, ease-in-out-cubic; globe rotation pauses on selection; image plane opacity 0->1 over the last 0.6s; UI chrome fades in after arrival. Provide a "reduced motion" variant that cross-fades instead.
- Sliders: live update the 3D scene every frame; monospace value tracks the thumb; double-click resets to EXIF value; accent fill on the active track.
- Time scrubber: dragging visibly moves sun/moon and shifts scene lighting/star visibility in real time.
- Idle globe: ~0.02-0.05 deg/frame auto-rotation; stops on any user interaction, resumes after ~8s idle.

MOTION PRINCIPLES
Calm, weighty, cinematic. Long easing, no bouncy springs. Motion communicates space and scale (orbit -> street). Nothing blinks or pulses aggressively. The accent color is the only thing allowed to "glow."

COMPONENT LIST
Top nav, globe canvas layer, pin/dot + cluster, hover preview card, EXIF tweak panel (slider rows with mono readouts), time scrubber, upload dropzone + progress, metadata review form, quota badge, pricing tier cards, marketplace listing card, buy/checkout module, AI suggestion cards, toast/notice, settings rows, modal/overlay shell.

RESPONSIVE BEHAVIOR
- Desktop-first (this is a WebGL-heavy instrument). Globe is full-viewport.
- Tablet: panels become bottom sheets; time scrubber docks bottom.
- Mobile: globe remains but controls collapse into a single expandable bottom sheet; reduce default decode size; keep the cinematic zoom but shorter (~1.6s). Warn on very low-memory devices.

ACCESSIBILITY
- WCAG AA contrast on all text over the dark base; the accent must pass AA for its use as text/icons or be paired with a label.
- Full keyboard control for sliders and pins; visible focus rings in accent.
- "Reduced motion" setting disables auto-rotation and replaces flights with cross-fades.
- All numeric readouts have text labels for screen readers (e.g., "Heading, 128 degrees").

EXPLICIT NON-GOALS
- No skeuomorphic camera/leather textures. No busy space art. No rainbow gradients. No photorealistic satellite globe by default. No cluttered dashboards. No dark-pattern upsell. Keep it quiet, precise, and premium.

DELIVERABLE: a cohesive design system (color tokens, type scale, spacing, component states) plus the 11 screens above in desktop, with tablet/mobile variants for screens 1, 4, 5, 6, 7.
```

## Part 4 — HANDOFF PROMPT #2: Architecture + implementation plan for Claude Code

```
You are Claude Code working on the developer's machine to build a Wix-managed headless (Astro) web app. Follow this plan exactly. Work in small, verified increments. After each phase: run typecheck + build, confirm the definition-of-done, and stop for review. NEVER fabricate Wix API signatures — when unsure, use the Wix MCP doc-search tool (the Wix MCP is a built-in connector) and the Wix Skills/plugin. Prefer the Wix JS SDK over raw REST. Use Astro 5 (Astro 6 is NOT supported by Wix).

PRODUCT (5 lines)
A website where a user uploads a camera RAW (DNG/ARW/CR3/NEF/RAF) or JPEG/PNG/HEIC. The app extracts EXIF (GPS, altitude, heading, focal length, sensor size, timestamp, orientation, lens) and projects the photo as an oriented camera frustum + image plane at its real capture location on a stylized 3D globe with real 3D buildings. Users tweak EXIF (focal/heading/pitch/position/time) in real time; time drives sun/moon/star positions via ephemeris. Free members save up to 10 images, paid = unlimited; public images show as low-res pins on a shared globe with a cinematic zoom-in on selection. Premium users get AI shot-improvement suggestions (runtime Claude via Wix AI APIs). A light marketplace lets users sell full-res RAWs as digital downloads with owner-mediated payout.

LOCKED CONSTRAINTS
1. Client-side WASM RAW decode is primary; offload to the client. Server-side decode only as an optional marketplace-verification fallback (and NOT on Wix HTTP endpoints — those have execution-time/quota limits; use an external service if ever needed).
2. Need real 3D buildings AND geo-accuracy AND stylized cinematic look with full camera control -> use the hybrid engine below.
3. v1 marketplace = light, digital-only, owner-mediated payout (Wix has NO split payments).

PINNED STACK (exact packages)
- Scaffold: `npm create @wix/new` (Wix-managed headless, Astro). Confirm it generates `@wix/astro`, `@astrojs/react`, `output: 'server'`, `@wix/cloud-provider-fetch-adapter`, `wix.config.json`.
- 3D: `three` (r17x). Globe: `3d-tiles-renderer@^0.4` (NASA-AMMOS, Apache-2.0). Buildings: Cesium OSM Buildings (Cesium ion asset 96188) via `CesiumIonAuthPlugin({ apiToken, assetId: 96188 })`. Navigation: `GlobeControls`. Compression: `GLTFExtensionsPlugin({ dracoLoader, ktxLoader })`.
- Stylization: on the tiles renderer `load-model` event, traverse tile scenes and swap materials to a stylized MeshStandard/Toon/custom Shader material; dispose on `dispose-model`. Do NOT use BatchedTilesPlugin (incompatible with per-mesh material override).
- Precision: re-center tiles group near origin (getBoundingSphere -> negate group.position, or ReorientationPlugin). Rely on GLTFCesiumRTCExtension (default on) + GlobeControls dynamic near/far.
- RAW decode: `libraw-wasm` in a Web Worker (OffscreenCanvas, transferable ArrayBuffer). HEIC: feature-detect Safari native `createImageBitmap` first, else `libheif-js@^1.19` (dynamic import).
- Metadata: `exifr@^7` (use lite/mini build in browser; extractThumbnail() for instant preview).
- Ephemeris: `astronomy-engine@^2` (MIT, ±1 arcmin) for sun/moon/planet azimuth-altitude; procedural sky shader + Yale BSC5 star points.
- State: `zustand@^5`. Fallback map mode (optional): `maplibre-gl@^5`.
- The globe MUST be an Astro `client:only="react"` island. Never SSR the WebGL.

REPO LAYOUT
src/
  pages/            # Astro pages: index, explore, gallery, upload, listing/[id], pricing, settings
  components/globe/  # GlobeCanvas (client:only), Frustum, StylizedTiles, Sky, Pins
  components/panels/ # ExifTweakPanel, TimeScrubber, UploadFlow, AiPanel
  lib/decode/        # worker.ts (libraw-wasm), heic.ts, exif.ts (exifr), sensors.ts (sensor DB + FOV)
  lib/geo/           # geohash.ts, projection.ts (EXIF -> frustum), ecef.ts
  lib/ephemeris/     # sun-moon-stars.ts (astronomy-engine)
  lib/wix/           # sdk clients, quota.ts, media.ts, ai.ts
  backend/ or extensions/  # HTTP endpoints, data collections, service plugins
  store/             # zustand stores
public/wasm/         # libraw + libheif wasm assets (CDN-cached)

BUILD PHASES (each: scope / definition-of-done / test)
Phase 1 - Scaffold + deploy "hello globe"
  Scope: scaffold Wix headless Astro; add three.js + 3d-tiles-renderer; render Cesium OSM Buildings globe with GlobeControls in a client:only island; deploy to Wix.
  DoD: `wix dev` shows a rotating stylized globe locally; `wix` release deploys; buildings load at close zoom over a test city (try Dnipro).
  Test: typecheck+build pass; manual smoke on desktop Chrome; confirm ion token loads asset 96188.
Phase 2 - EXIF + decode pipeline
  Scope: upload dropzone; exifr metadata + embedded-JPEG instant preview; libraw-wasm full decode in a Worker; HEIC feature-detect + libheif fallback; sensor DB + FOV computation.
  DoD: dropping a Sony ARW and an iPhone HEIC yields metadata + a decoded display texture; missing heading/pitch flagged for manual entry.
  Test: unit-test FOV math and geohash; integration-decode a sample ARW in headless Chromium.
Phase 3 - Projection + tweak UX
  Scope: build frustum from EXIF (GPS position, heading/pitch/roll, FOV); render image plane at frustum far face; reactive zustand params; live re-projection on slider change; cinematic pin->detail camera flight.
  DoD: a photo appears as an oriented frustum at its location; moving focal/heading/pitch/position/time sliders updates the projection in real time; pin selection triggers a ~2.2s ease-in-out flight.
  Test: verify projection matches a known reference (e.g., a photo with iPhone GPSImgDirection); reduced-motion path cross-fades.
Phase 4 - Ephemeris sky
  Scope: astronomy-engine sun/moon/planet positions from time+location; procedural sky + star field; time scrubber drives lighting.
  DoD: dragging time moves the sun/moon and changes lighting and star visibility; golden-hour tint appears at correct times.
  Test: spot-check sun azimuth/altitude against a known almanac value for a date/location.
Phase 5 - Members + quota + save/public pins
  Scope: auth (Wix @wix/astro auto-auth); Data Collections (Photos, PublicPins); Media upload (resumable for >10MB RAW, private originals + public previews); quota (Pricing Plans + beforeInsert hook: 10 free / unlimited paid); public pins on shared globe with geohash viewport query; default reduced public-pin precision.
  DoD: a free member can save up to 10 images and is blocked on #11; paid is unlimited; public pins render for all users at reduced precision.
  Test: verify quota hook rejects #11; verify viewport geohash query returns only in-view pins.
Phase 6 - Marketplace-light
  Scope: list a photo as a digital product (itemType DIGITAL + digitalFile = full-res RAW); buy flow; owner-mediated payout note; 30-day download-link messaging.
  DoD: a user can list a RAW, another can buy it, buyer gets the 30-day download; owner sees the sale to pay out manually.
  Test: end-to-end purchase in Wix test mode; confirm digital delivery.
Phase 7 - AI analysis + polish
  Scope: premium AI panel calling Wix AI APIs (Claude, e.g., Opus 4.6) with a DOWNSIZED JPEG preview (never RAW; Claude vision takes JPEG/PNG/GIF/WebP) + desired-condition prompt; content-moderation pass on public previews; perf polish (KTX2, OPFS cache, mobile half-size decode).
  DoD: premium user gets tidy suggestion cards ("shift heading +12 deg, shoot 40 min earlier"); public pins pass a moderation check.
  Test: verify AI call consumes ~1 credit and returns structured suggestions; verify non-premium is gated.

WIX EXTENSION INVENTORY
- Data Collections:
  - Photos: { _id, ownerMemberId (ref), title, mediaFileIdOriginal (private), previewUrl (public), lat (num), lon (num), alt (num), geohash (str), headingDeg (num), pitchDeg (num), rollDeg (num), focalMm (num), focal35 (num), sensorWidthMm (num), lensModel (str), captureTime (datetime), tzOffset (str), isPublic (bool), publicPrecision (str: exact|1km|city), forSale (bool), price (num), createdAt }
  - PublicPins (denormalized for fast globe query): { _id, photoRef, geohash, latReduced, lonReduced, previewUrlLowRes, title }
  - Listings: { _id, photoRef, sellerMemberId, price, status, digitalProductId }
- HTTP endpoints (Astro backend):
  - POST /api/upload-url  -> elevate; generateFileResumableUploadUrl for RAW >10MB; return upload URL/token
  - POST /api/photos      -> elevate; validate; enforce quota; insert Photos (+ PublicPins if public)
  - POST /api/analyze     -> premium-gate; call Wix AI (Claude) with downsized JPEG + prompt; return suggestions
  - POST /api/moderate    -> Claude moderation pass on a preview before publishing a public pin
- Service plugins (optional): quota-enforcement plugin if a data hook is insufficient.

KNOWN PLATFORM GOTCHAS (encode these)
- NO cron on Wix headless. If a scheduled job is ever needed (e.g., expiring listings), trigger it via an external scheduler hitting an HTTP endpoint.
- Media upload: files >10MB MUST use generateFileResumableUploadUrl (TUS). generateFileUploadUrl requires Wix app/user identity -> elevate() in backend. Uploads are async -> listen for onFileDescriptorFileReady.
- 403 elevation: backend calls that need admin identity must use elevate(); visitor context is anonymous by default.
- Digital download links expire after 30 days (not shortenable via UI); message this to buyers.
- Wix Data has NO geo query -> use geohash-prefix hasSome + client refine.
- Wix has NO split payments -> owner-mediated manual payout only.
- Claude vision does NOT accept RAW -> always send a JPEG/PNG preview.
- Server-side RAW decode is unsuitable on Wix HTTP endpoints (timeout/quota) -> keep decode client-side.

OPEN QUESTIONS -> TODO-VERIFY markers (the developer will check internal access)
- // TODO-VERIFY: exact max per-file MB cap for RAW uploads to Wix Media (format list is confirmed; size cap is not published)
- // TODO-VERIFY: can Wix-managed headless set COOP/COEP response headers on Astro pages? (needed for WASM threads; if no, ship single-threaded SIMD decode)
- // TODO-VERIFY: exact Wix HTTP-endpoint execution-time limit and max response size
- // TODO-VERIFY: which Claude models are currently exposed by Wix AI APIs and whether vision is enabled on them (docs show Opus 4.6 text; confirm vision)
- // TODO-VERIFY: Wix AI credit cost per vision call at expected image sizes
- // TODO-VERIFY: any multi-party/marketplace payout on the Wix roadmap (currently none)

WORKING AGREEMENTS
- Small verified increments; run typecheck + build every phase; never fabricate Wix API signatures (use Wix MCP doc-search).
- Keep the globe island client:only; never SSR WebGL.
- Prefer Wix JS SDK; elevate() only where required and with least privilege.
- Add a feature flag for an optional "realistic mode" (Google Photorealistic 3D Tiles, UNMODIFIED, with mandatory attribution) — off by default; never restyle Google tiles.
- Commit the sensor-size dataset and unit-test the FOV/geohash math.
```

## Part 5 — Open questions + internal-verification checklist

**Wix internals the developer can verify with internal access:**
1. **Media upload size cap for RAW** — format list confirmed (`.arw/.cr3/.nef/.dng/...`), but exact per-file MB limit is unpublished. Test a 25MB and an 80MB ARW via the resumable path. [UNVERIFIED]
2. **COOP/COEP header control on Astro pages** — needed for WASM threads/SharedArrayBuffer. If not settable on the managed CDN, ship single-threaded SIMD decode (already the recommended default). [UNVERIFIED]
3. **HTTP-endpoint execution-time limit + max request/response size** — confirmed limits exist (504 timeout, 429 quota) but exact numbers unpublished; measure. [UNVERIFIED]
4. **Wix AI vision model list** — docs confirm Claude Opus 4.6 (text streaming); confirm which models accept images and whether vision is enabled through the Wix proxy. [UNVERIFIED]
5. **Wix AI credit cost per vision call** — ~1 credit per method call stated; confirm cost at realistic preview-image sizes. [UNVERIFIED]
6. **Multi-party payments roadmap** — currently none (split payments explicitly unsupported); confirm nothing internal changes this. [VERIFIED none public]
7. **3d-tiles-renderer bundle size** — Bundlephobia was unreachable; run `npm view 3d-tiles-renderer dist.unpackedSize` and a bundle analysis. [UNVERIFIED]

**Non-Wix items to validate empirically:**
- libraw-wasm decode times on the a6700 26MP ARW (desktop vs mid-range mobile) and peak WASM heap.
- OSM building coverage quality specifically in Dnipro and rural Ukrainian capture locations.
- Sun-azimuth spot check of astronomy-engine against an almanac for a known date/location.

---

### Confidence summary
The core engine decision (three.js + 3d-tiles-renderer + Cesium OSM Buildings, with `load-model` material override for stylization and re-centering/RTC for precision) is [VERIFIED] against the NASA-AMMOS repo, docs, and issue #662. The RAW-decode (libraw-wasm), metadata (exifr), ephemeris (astronomy-engine), HEIC (libheif/Safari-native), and Wix platform facts (no split payments, 30-day download links, no geo queries, resumable upload >10MB, Claude Opus 4.6 via Wix AI, Astro 5 only) are all [VERIFIED] from primary sources. The remaining unknowns are Wix-internal limits (upload MB cap, COOP/COEP, HTTP timeouts, AI vision model list/credit cost) — enumerated as TODO-VERIFY markers for the developer's internal access, each with a safe default already chosen so the build is not blocked.