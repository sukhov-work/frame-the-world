# TRACK 6: Mobile profile + device tiers (agent report, confidence 78%; ~35% on real-device behaviour)

## Tier detection (`GlobeCanvas.tsx:36-54` → `quality.ts:338-377`)
- `WEBGL_debug_renderer_info` UNMASKED_RENDERER (regex families `WEAK_GPU`/`STRONG_GPU`), `navigator.deviceMemory` (undefined off Chrome → assumed 8 GB, :368), `hardwareConcurrency` (undefined → 8), `maxTextureSize` (<8192 → low). `failIfMajorPerformanceCaveat`/`softwareGL` flag declared but **never probed** (`readDeviceCaps` never sets it).
- **The only phone signal is `matchMedia("(pointer: coarse)")`** (:52). iOS reports "Apple GPU" → STRONG_GPU, no deviceMemory → an iPhone would detect `high`; coarse pointer caps detection at `mid` and the governor ceiling at `mid`. UA sniffing only for SW registration (`MobileLayout.astro:44-46`) and the index→/m redirect (`index.astro:60-64`).
- Governor: EMA, budget 35 ms / restore 13 ms, 100 down / 240 up frames, 2.5 s cooldown. Phone: ceiling `mid`, floor `low`. Shadows follow the device tier, never the governor. RC18 split applies.

## Lean profile vs desktop (`QUALITY.leanMobile` override on any coarse-pointer device, tuning.ts:708-724)
| Lever | desktop `high` | `mid` | `low` | lean (over tier) | `/m` effective |
|---|---|---|---|---|---|
| DPR cap | 2 | 1.5 | 1.25 | **1.25**; **1.5 on flat 2D chart** | 1.25 FPV/3D · 1.5 chart |
| Bloom | on | on | off | **off** | off |
| Shadows | on 4096² | on 2048² | off | map clamped **1024²**, ON | on 1024² in FPV/3D; rig OFF on the chart |
| GTAO | high + low-alt only (but AO.enabled false) | off | off | — | off |
| Composer target | HalfFloat MSAA×4 | same | same | same | same at 1.25× DPR |
| bldg/enriched LRU | library 0.4 GiB | 256 / floor 192 | 160 / 120 | per tier | 256/192 |
| ground LRU | 400 | 320 (+ flip bank 0.92×, 45 s) | 192 | per tier | 320, bank on |
| overlay composite px | 512 | 256 | 256 | — | **256 base but sticky-ratchets to 512 on the first flat-chart frame = boot on /m; FPV then shares 512** (quality.ts:110-127; StylizedTiles.ts:5588-5601) |
| Esri max zoom | z19 | z19 | z19 | **z18** coarse | z18 |
| groundErrorNear / bldg SSE | 2 / 16 | 3 / 24 | 5 / 40 | — | 3/24; chart deep 0.35 < 1.2 km |
| queue caps dl/parse | 25/5 | 12/3 | 8/2 | — | 12/3 |
| foveation (FPV) | null | ray 1400 m / eye 160 m / ×1.5 | 900/110/×1.6 | — | mid |
| street names / lattice | 40 / 8 | 28 / 5 | 16 / 3 | — | 28/5 |
| 8k earth swaps (3 tex) | yes | yes | yes if ≥8192 | **skipped** (`allow8k: !coarsePointer`) | skipped |
| Milky-way haze | 8192×4096 JPEG | same | same | **2k bake** | 2k |
| Buildings attached | always (BLD pref) | | | — | **detached in 2D** (scene-graph removal + frozen update); attached in 3D/FPV |
| Idle LEO drift | on | | | — | off in 2D |
| ULTRA / HQ 3D / BEST SPOT | fine-pointer desktop only | | | **blocked** | blocked |
| Frame gate RC21 | OFF everywhere | | | | OFF |
| SW tile cache | never | | | iOS UA only | iOS only |

DPR policy: `setPixelRatio(min(devicePixelRatio, tier.dprCap, leanCap))`; a tier/chart flip re-applies only when effective DPR changes. Governing a phone to `low` changes tile levers and drops the chart 1.5→1.25; FPV DPR unchanged.

**OFF on /m**: bloom, GTAO, 8k textures, ULTRA/HQ/BEST SPOT, buildings in 2D, idle drift, shadows on the chart, street names in FPV (StylizedTiles.ts:6834-6838), day arcs/aim cones outside FPV, upload/marketplace/pins, CARTO unless dark mode. **Still ON**: vector features, geo labels (altitude-gated), stars/2k haze, user models, all 56 orchestrator steps.

**PiP cache (RC19)** — GlobeCanvas.tsx:983-1032, `lib/globe/pipCache.ts`: scene re-render into a HalfFloat RT only on camera/projection/sun delta or the 250 ms heartbeat; 1-triangle blit every frame; `shadowMap.autoUpdate=false` around the pass.
**2D map mode**: `/m` boots nadir north-up at 1.1 Mm over Dnipro; flat treatment = deep imagery error, photographic de-grade, shadow rig off, bloom off, fast zoom. MapWindow is a raw XYZ 2D canvas, not a second GL view.
**FPV touch loop**: look-drag + pinch-FOV (StylizedTiles.ts:2360/2451/2564); joystick walk quadratic curve (FPV.walkStickMaxMult 3); long-press 500 ms; touch hit pad ×1.7.
**Wake lock**: `FpvControls.tsx:31-60`, only while FPV mounted on /m.
**Lifecycle**: hidden page → tick skipped + governor clock re-seated; all 9 tile queues frozen on hide/pagehide; `webglcontextlost/restored` → render gate + composer realloc.
**SW caching** (`public/sw.js`): cache-first over 4 tile hosts + `*.workers.dev`, FIFO 6000 entries ≈ 300 MB, 7-day, manifests excluded; RC5 Esri placeholder byte-sniff carve-out.
**Decode policy**: `halfSize: true` universal (`lib/decode/worker.ts:51-52`); "1 concurrent" (ARCHITECTURE.md:51) UNVERIFIED in code. Moot on /m (no upload there).
**`?d=1` escape**: `index.astro:47-70`; the engine still applies lean + coarse gates there.

## Per-frame cost on /m
| Runs every frame | Notes |
|---|---|
| `tilesHandle.update()` — 56 steps incl. 3× `tiles.update()` | never skippable; buildings/enriched frozen while detached in 2D; all three live in FPV/3D |
| Governor step + tier apply | cheap |
| Shadow depth pass (1024²) | when `castShadow` (sun up, alt < 30 km); off on chart |
| `composer.render()` RenderPass→OutputPass into HalfFloat MSAA×4 at 1.25× | bloom/AO off; RC21 OFF |
| PiP: RT render ≤4 Hz + blit each frame | while MapWindow open |
| ImageOverlayPlugin composites (Esri; CARTO dark) | 512² sticky composites on /m |
| Street names, vector ribbons, geo labels, stars/haze, aim cones (FPV), user models | vector MVT parse synchronous main-thread |
| GLB parse | parse queue 3 jobs (mid), main-thread; DRACO uses three's DRACOLoader default worker pool (EXTERNAL-KNOWLEDGE, not configured) |

## Measured (with DEVICE)
| Metric | Value | Device |
|---|---|---|
| Coarse-shim tier + fetches | `mid`; only the 2k haze fetched, zero 8k | desktop Chrome CDP 402×874 coarse shim |
| Milky-way 2k | 572 KB vs 6.4 MB file; VRAM "~8 MB vs ~134 MB" (DECISIONS) vs "~2 MB" (tuning.ts) — inconsistent, ESTIMATED | files |
| FPV touch: walk 65.92 m/s, drift 0.0000 m, pinch 55→27.7°, wake lock 1/1/1 | desktop Chrome CDP |
| U5 stream: bldg mean 376 / max 540 ms; 4 s walk 0 hitches, ~46-48 fps, EMA ~21 ms; /m EMA 8.3 ms | M3 Pro warm |
| U6 foveated FPV: 0 hitches/8 s, EMA 16.7 ms both shells | M3 Pro |
| Ground-LRU churn: ~600 Esri GETs per 2D↔FPV leg; cache 145/144 MB vs 192 cap | headless :9333 `low` |
| Reload: 1,173 tile URLs fromDiskCache vs 64 net (~95%); median tile ~50 KB | desktop Chrome; emulated-mobile WANDER "didn't register" |
| `/m #f=` FPV entry engages after ~1–3 min vs desktop ~20 s | CDP emulation |
| Real-device, **qualitative only**: iPhone 17 Pro Safari — tile storm, Safari page reloads (jetsam), selection tint, gesture list; QA-7b storm "white chart + vector ink for seconds→10 s+ on device" | owner's iPhone 17 Pro (DECISIONS:1215; UXBATCH4_PLAN.md) |
| "the Pixel bug" (sticky standings) | owner's Pixel |

**Never measured on a real device (T1)**: fps / EMA / hitch count on iPhone or Pixel; JS heap, VRAM, jetsam threshold; thermal onset; natural governor demotion; queue caps 12/3·8/2 and fpvBiasK A/B; foveation radii; lean heat; SW effectiveness and whether Wix serves `/sw.js` with correct MIME/scope (UNVERIFIED); z18 + 512-composite VRAM; lruBank holdMs; PiP feel; iOS pinch suppression; gesture feel; ARW decode on a phone (T21); cold-network closest-first visual.

## Limitations / traps
- **Phone tier rests on one media query.** A tablet/touch-laptop is coarse too; a phone on a desktop-class OS may not be. Privacy-hardened renderer string → `mid`. `softwareGL` never probed.
- **Governor is blind to heat and memory** (stated in code, GlobeCanvas.tsx:108-111).
- **The 256-composite demand shrink is effectively dead on /m**: the chart is the boot state, so the sticky ratchet reaches 512 at frame 1 and never lowers; FPV inherits it. RC22 #1 (384) proposed, unapplied.
- z17→z18 coarse cap flagged "roll back to 17 if it heats" — untested.
- **Shadow pass runs on phones from 30 km down** at 1024² (RC22 #2 proposes 8 km).
- Flip-bank holds a raised ground-LRU floor for 45 s — trades iOS network for iOS memory, "THE knob to judge on device".
- SW pins any `res.ok` for 7 days — the B1 placeholder trap.
- Main-thread parse: GLB + MVT; `livePromoteInFpv: true` raises parse concurrency 2→3→5 mid-viewfinder ("if a promote ever hitches on a real device, this is the switch").
- **Jetsam ≠ contextlost**: a memory kill fires no event; no memory-pressure listener anywhere.
- **HalfFloat MSAA target on iOS** requires WebGL2 RGBA16F renderability — EXTERNAL-KNOWLEDGE, unverified on device; `powerPreference: "high-performance"` honoured on iOS — EXTERNAL-KNOWLEDGE.
- **GPU timer absent on Safari** → no GPU-time telemetry on the target device.
- **No WebGPU path** (zero hits); no KTX2/Basis; OffscreenCanvas used only in decode/placeholder/upload, never the globe.
- Every "mobile" number comes from desktop Chrome at 402×874 or headless :9333.
- Desktop-Chrome-mobile-view tile storm the owner observed is unresolved.

## Refuted / rejected mobile candidates
Responsive retrofit of `index.astro` (frozen desktop) · server-side UA redirect (CDN `Vary` unverifiable) · half-rate PiP (flicker) · RC21 default-on (frozen-globe risk) · 4th tier for lean/ULTRA (override profiles) · `visible=false` building detach (Raycaster ignores `visible`) · tile-host cache headers as storm cause (falsified) · blanket LRU raise on mid/low (worsens jetsam) · raising parse queue caps (main-thread hitches) · ULTRA `dprCap` raise (inert) · two-finger tilt-into-3D door (removed after device test) · MY LOCATION straight into FPV (superseded) · auto re-arm MapWindow follow (reversed after device test) · ground-LRU churn as a desktop problem (refuted).

## Open rows: T1 (the whole real-device exit gate), T16, T21, T34 (device GETs), T51, RC22 (unapplied), AB6/AB7.

## Gaps vs a modern mobile engine (ASSESSMENT)
| Capability | State | Gap |
|---|---|---|
| Thermal governor | none; frame-time EMA only | No thermal web API on Safari (EXTERNAL); a proxy (sustained EMA drift, battery API on Android) unbuilt |
| GPU-time budget | HUD timer only, Safari-absent | Governor never sees GPU time; CPU frame time conflates parse hitches with fill-rate |
| VRAM budget | none; LRU caps are library byte estimates | No renderer-string-keyed VRAM table; iPhone assumed 8 GB; 512² composites + 1024² shadow + HalfFloat MSAA×4 backbuffer + 2k haze uncounted |
| Compressed textures (ASTC/KTX2) | absent | Earth/haze JPEG→RGBA8; Esri composites RGBA8 (~1 MiB/tile at 512²) |
| Half-res + upscale / dynamic resolution | static 3-rung DPR cap; changes realloc the composer, 2.5 s cooldown, deferred out of FPV | No continuous render-scale |
| Reduced shadow/lighting tiers | lean 1024² shadows on; RC22 8 km cap unapplied; no light-model tier | Shadow pass + full light rig identical to desktop mid |
| Worker-side parsing | GLB + MVT main-thread | Parse caps (3/2) the only hitch lever |
| Memory-pressure listeners | none | Jetsam silent; SW cache + 45 s LRU bank add memory on a device that kills silently |
| iOS WebGL2 caveats | HalfFloat MSAA target, `high-performance` hint, "Apple GPU" string, no deviceMemory, no GPU timer, throttled hidden rAF | All EXTERNAL-KNOWLEDGE except the two the code names — web-research to verify per iOS version |
