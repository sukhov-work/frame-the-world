# mem:patterns/upload-flow — UploadFlow panel + REAL decode pipeline (UI 2026-07-10, decode Phase 2 SHIPPED same day, both browser-VERIFIED)

Board-05 upload overlay (drop → review → place) with board-04 sliders, wired to the **real** exifr +
libraw-wasm + libheif-js pipeline. No stub remains.

## Decode pipeline (`src/lib/decode/`)
- **`extract.ts`** — orchestrator `extractMetadata(file, {onProgress, onPreview, signal})`:
  displayable (jpeg/png/webp/gif/avif) → native object URL; RAW → exifr metadata + embedded IFD1 thumb
  (instant, `onPreview('…','embedded')`) → worker decode → decoded blob URL (`previewSource:'decoded'`,
  `textureWidth/Height`); HEIC → native probe (`createImageBitmap` on the actual file — Safari) else
  libheif in the worker. Decode failure ≠ fatal: returns metadata + embedded preview + `decodeError`.
- **`exif.ts`** — exifr with `{tiff,exif,gps,reviveValues:false}` (ifd0 always on; listing it trips the
  Options type). `reviveValues:false` is LOAD-BEARING: EXIF dates stay TZ-naive strings → string-sliced
  to ISO (`exifDateToIso`); a revived Date shifts the wall clock by machine TZ (caught live). Rationals
  stay numeric; signed `latitude/longitude` still computed; `GPSAltitudeRef` comes as byte-wrapper
  `{0:0}` → `refByte()`. ARW/NEF/DNG = TIFF-based → full metadata in ~2 ms incl. GPSImgDirection→heading;
  CR3/RAF → `{}` → D4 manual path. `extractEmbeddedPreviewUrl` = exifr.thumbnail → blob URL.
- **`worker.ts`** — module worker, ONE file per worker lifetime, client terminates it after each decode
  (emscripten heap never shrinks: Node RSS 337→814 MB over 3 decodes → disposable workers ARE the memory
  strategy). RAW: `{useCameraWb:true, halfSize:true, outputBps:8}` (halfSize skips demosaic: 26 MP = 4.2 s
  Node / 4.8 s Chrome vs 11.1 s full-AHD; → 3136×2084 texture) → `channelsToRgba` (`convert.ts`, pure,
  handles 1/3/4ch + 16→8bit) → OffscreenCanvas → JPEG blob q0.92 (`pixels` transfer fallback for
  no-OffscreenCanvas, painted by client). Stage posts are REAL boundaries only (wasm .15 / unpack .70 /
  demosaic .88 / encode .97) — libraw-wasm has NO intra-stage progress.
- **`workerClient.ts`** — spawn `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`,
  transfer buffer zero-copy, terminate on settle/cancel (cancel → AbortError-named rejection).
- **`wasm-modules.d.ts`** — ambient types for libraw-wasm@1.0.5 (ships none) + libheif bundle + `?url`.

## The libraw-wasm pin (CRITICAL — do not "upgrade" casually)
`libraw-wasm@1.0.5` EXACT-pinned: **1.1.2+ are all pthread builds** (shared WebAssembly.Memory, spawns
`em-pthread` nested workers; their own test serves COOP/COEP) → hard-require cross-origin isolation =
unverified on Wix hosting + would force CORP on Esri/ion/fonts. 1.0.5 = single-threaded, no internal
worker, runs on calling thread → lives in OUR worker. Probed 1.0.5 API: `open(bytes,settings)` (does
unpack, ~3.4 s/26MP) · `metadata()` → width/height/camera_make/camera_model/iso_speed/shutter/aperture/
focal_len/timestamp(unix s) — **NO GPS in 1.0.5** (exifr owns metadata) · `imageData()` →
`{width,height,colors,bits,dataSize,data}` · no thumbnailData/dispose. Upgrade path only after
TODO-VERIFY #2 (COOP/COEP on Wix) proves out AND subresource CORP is solved.

## Vite/bundling traps (each cost real debugging)
- 1.0.5 fetches `libraw.wasm` as a **runtime sibling URL** (not the static `new URL(x, import.meta.url)`
  Vite rewrites) → worker patches `self.fetch` to redirect `*libraw.wasm` → `?url`-imported asset. Dev =
  pass-through; build = hashed `/_astro/libraw-*.wasm` (verified in dist).
- `optimizeDeps.exclude: ['libraw-wasm']` (esbuild pre-bundle would break import.meta.url pathing) AND
  `optimizeDeps.include: ['libheif-js/libheif-wasm/libheif-bundle.mjs']` — Vite's startup scanner never
  crawls worker entries; first worker spawn mid-session discovers the dep → "optimized dependencies
  changed. reloading" → **full page reload kills the flow** (hit live during verification).
- `worker: { format: 'es' }` — the worker code-splits its dynamic wasm imports; iife workers can't.
- libheif-js: use the **`.mjs` bundle subpath** (ESM, wasm inlined base64 → no asset pathing); default
  export is an async factory → `await factory()` → `new libheif.HeifDecoder()` → `decode()` →
  `image.display({data,width,height}, cb)` → `img.free()`.

## Store (`src/store/upload.ts`)
`loadFile`: seq counter + AbortController (module-level) — a re-drop mid-decode aborts + terminates the
old worker (browser-verified clean supersede). Progress = trickle interval (80 ms) easing toward the
latest REAL stage target — bar moves inside long stages without lying about boundaries. `onPreview`
swaps preview URL mid-decode (revokes stale blob URLs). `stub` field REMOVED; added `loadError` (file
unreadable → back to dropzone + notice) and `decodeError` (review shows warn badge "FULL DECODE FAILED —
SHOWING WHAT WE COULD READ"). Right label: DECODED / EMBEDDED PREVIEW / READ by previewSource.

## Fixtures + tests
`test/fixtures/`: `gps-heading.jpg` COMMITTED (2.5 KB, exiftool-written iPhone EXIF: GPS 48.4647N
35.0462E, alt 96, **GPSImgDirection 214**, focal 6.86/35eq 24, DateTimeOriginal 2026:05:03 07:15:02) ·
`example-sony.arw` (31 MB ILME-FX30, libraw-wasm's own fixture, curl from their GitHub) + `gps-heading.heic`
(sips-converted) both GITIGNORED — tests `describe.skipIf(!existsSync(...))`; regen commands in
`test/fixtures/README.md`. exifr runs in Node → real-fixture assertions in vitest (76 green). The ARW's
DateTimeOriginal is `2023:04:29 00:01:20` **OffsetTime -05:00** — anything showing 21:01 means a TZ
round-trip bug. Sensor DB += ILCE-7RM4 35.7 / ILME-FX30 23.3 / IPHONE 15 PRO(+MAX) 9.8; 7RM5 fixed →35.7.

## Verified in browser (Playwright, wix dev :4322)
ARW: embedded thumb ~120 ms → review 4.8 s, decoded 3136×2084 blob, full FX30 EXIF fields, GPS-less →
3× MISSING—ADD + H-FOV 45.4° (exact for focal35 43). HEIC (Chrome = no native) → libheif 0.4 s, GPS +
heading 214 EXIF-badged, pitch-only flag. JPEG native 0.1 s. Slider ArrowRight→MANUAL+dot,
dblclick→EXIF. Escape/reopen retention. Globe untouched. Console clean (pre-existing frog beacon only).
UNVERIFIED: mobile decode ms/heap (real device needed), Safari native-HEIC branch, `wix release` serving.

## UI notes (unchanged from UI ship + this session's touches)
Overlay opened by `[data-open-upload]` delegation, closed Escape/← GLOBE. Decoding step now shows
`.uf-progress__thumb` (embedded preview during decode). Review placeholder copy → "NO PREVIEW / this
file carries no image we can display". Slider: `.uf-slider__track[role=slider][aria-label=...]` —
keyboard arrows/Home/End/Backspace; dblclick reset. Phone focal 6.9 mm below the 8–400 slider range →
knob clamps 0%, reset still exact (known, fine). Playwright: use `setInputFiles` on the hidden input;
files must live under repo roots.

Related: `mem:core` · `mem:patterns/design-system` · `mem:decisions/adr-000-locked-stack` (D3/D4) ·
DECISIONS 2026-07-10 (Phase 2 decode entry) · `THIRD_PARTY.md` (LGPL/CDDL notes).
