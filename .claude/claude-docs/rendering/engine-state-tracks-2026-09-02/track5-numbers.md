# TRACK 5: History, numbers, refuted lists, verification, owner pain (agent report, confidence 82%)
Key: **M** measured, **D** derived arithmetic, **E** estimate. HW: **OM** owner's M3 Pro Mac (dev build 1600×950 @ DPR 2) · **HL** headless tier-`low` CDP Chrome · **WC** OM warm cache · **RP** real phone (none exist).

## 1. Timeline
| Date | What shipped | Headline number |
|---|---|---|
| 07-09 | Phase-1 scaffold; static `min(DPR,2)`, composer every frame, PCF 4096² + per-tile ShadowMaterial twins | none |
| 07-12 | RENDERING_QUALITY_PASS Pass-1: `quality.ts` tier detect + EMA governor, `antialias:false`, `high` byte-identical; tile-knob tiering, F1 screen-door fade, GTAO wired OFF | 0 browser numbers |
| 07-12/13 | Pass 2: R2 per-building tone; R3 flat emissive → owner rejected twice | — |
| 07-13 | Illumination pass; governor threw the M3 Pro to `low` and killed shadows → shadows decoupled from governor, floor `mid` | 22 ms/45 fps budget breached on OM at retina |
| 07-17 | T5 checkerboard + 1500→200 km flicker reported, parked | — |
| 08-11 | Mobile design (`/m`), 2k milky-way | FPV 53 fps OM |
| 08-13/14 | M0–M2 mobile infra; mobile tier coarse→mid, DPR 1.5, 3×256 MB LRU | none on device |
| 08-17/18 | U1 2D-first · U2 FPV stability (LRU floor, governor parks in FPV) · U3/U4 map · U5 closest-first · U6 foveation · U7 terrain audit (CWT = 4-vertex quads) · U7b GLO-30 bake | U5 EMA ~21 ms, U6 16.7 ms WC; river 88–94→68.9 m |
| 08-19 | U8 height override | — |
| 08-21h | QA-7b overlay-rebuild storm killed; T34 rest-trim churn quantified | ~600 Esri GETs/leg HL low |
| 08-22h | T43 FPV fidelity audit (65 agents, 26 gaps, zero code) | 43/58 survived, 15 refuted |
| 08-22i | T44 HQ refinement region built, measured inert, removed | errorTarget 0.05 → 0 extra tiles |
| 08-22j | ULTRA (T44 textures + T45 light/shadows): 9 levers, 8192² map, terrain casts | city 30.7→36.1 ms (+18 %) |
| 08-25b–e | Rendering Charter; RC0 probes; Groups B, C, F shipped | near 1 m/far 180,375 m, 24-bit depth, heightAt 0.018–0.067 ms |
| 08-26 | Groups E (RC18/19/20/25), D (RC13/17, RC16), RC21 OFF; RC12/RC15/RC28 refuted; RC30 doc | mip chain ×1.328 VRAM, 5.36→0.06 ms |
| 08-27b/c | Cascade ladder + dusk light model + skirt seam; taste pass | +3.0/+3.3 ms, +168 MB |
| 09-01 | DBG HUD (151 metrics + 3 actions, GPU timer); owner: 08-27 shadow work "did NOT fully fix" | GPU 7.3 ms, rAF median 33.4 ms HL |
| 09-02 | MESH SUITE MS1–MS6 (models: 24 resident / 1.5 M tris cap); T77 ordered | §12 cliffs are E only |

## 2. Measured-numbers ledger (beyond tracks 1–3)
| Metric | Value | Pose/tier | HW | Source | Kind |
|---|---|---|---|---|---|
| Shadow-box coverage pre-cascade | 24 % / 8 % / 35 % (`viewFitM` 148,757/427,828/100,163 vs `boundsM` 18,000) | Fuji 5.2 km 84°, 15 km 68°, mountain 3.5 km | OM | ULTRA_ARCH §13.1 | M |
| Shadow range (bias) | 63.2 km street / 85.3 km Everest; −2e-4 = −1.4 m at 7 km, −12.6…−19.2 m at ULTRA range | | OM | §8.2 | M/D |
| Sunset snap fix | 103 samples +4.21°→−1.28°, max step 0.0270 (was 1.0) | city | OM | mem:charter-groupBC | M |
| Totality square fix | step 2.66/255 vs 32.05 control | Burgos | OM | | M |
| Curvature residual (M5) | 0.568 m vs 14.20 m rms within-cell relief (4.0 %) at 3.5–4 km ring | Dnipro bake | | RC0/M5 | M |
| Height memo (RC11) | 84.0 % hit, 18,457 entries; 47 % @10 s, 87 % @120 s; cap 20k→100k (~15 MB) | | OM | | M |
| Seat convergence (RC7) | look-cone 50.3 % vs city 33.9 % sampled (bar 0.9 NOT met) | fresh FPV entry | OM | groupBC | M |
| FPV walk re-seat (RC10) | 302 m walk: 0.50 m correction, 0.23 m worst step, 0 >0.5 m jumps | balka | OM | | M |
| Working set | 39,302 buildings + 60,527 trees / 101 cells | Dnipro | | | M |
| T34 churn | ~600 Esri GETs per 2D↔FPV leg; cache rests at `minBytesSize` 145/144 MB, cap 192 | /m, `low` | **HL** | DECISIONS 08-21h | M (headless only) |
| Mip chain (RC25) | 357/357 chained @4 levels; VRAM ×1.328; readback 5.36→0.06 ms/composite; ~450 composites/flight; mid-session flip 2/321 vs boot 452/452 | 20 km grazing | OM | | M |
| ULTRA×eclipse haze (RC23) | 0.0253 totality vs 0.1138 golden | Burgos | | | M |
| U2 LRU pairs | mid 192/256 · low 120/160 · high 307/410 MB; exit-alt drift 0.00 m | soak | OM | | M |
| Terrain truth (U7) | CWT L13 = 4-vertex quads (~2×1.6 km); river +33…37 m, balka +58; post-GLO-30 city 120.4→85.9 m, river →68.9 m; L13 188 verts | Dnipro | | UPLIFT App A | M |
| Everest bake | 13,487 files / 210 MB; GLO-30 summit 8,732 m (111 m under 8,848.86) | | bake | | M |
| Skirt (RC13) | +0 verts (naive append +59 %/+78 %) | 5 bakes | | | M |
| DSM signature (M11) | +0.34 m median Dnipro; canopy +1.01 m Dnipro | | tool | | M |
| Straddlers (RC16) | 123/61/1 real; FAR median 761 m/40 km/36 km | | tool | | M |
| Governor budget | 22 ms/45 fps (07-13) → now `budgetMs` 35, `restoreMs` 13 | | | tuning.ts:626 | config |
| Bundle | 33 MB (08-13) → 30 (08-18) → 33 (08-22) | | | audits | M |
| Decode / FPV | 26 MP decode ≈4.8 s (07-10); FPV 53 fps (08-11) | Dnipro | OM | audit-full 08-13 | M |
| Milky-way | 8k ≈134 MB VRAM desktop; 6.5 MB pano | | | T16 | D |
| Tile cache | reload ≈95 % fromDiskCache, ~60 revalidations; 0 in-session refetch over 6 pans | desktop | OM | `measure-tile-cache.mjs` | M |
| User models | 2048² ≈21 MB, 24×4 ≈2 GB; 24×25 draws; 20–200 ms hitch/model; ≤192 MB/area | | | MESH_SUITE §12 | **E** |

## 3. NEVER measured
- Any real device (T1): iPhone 17 Pro / Pixel 6 Pro fps, heap, jetsam, GET counts, gesture feel, U5 cold-network, mid/low queue caps, RC22 knobs.
- `mid`/`low` tiers on real weak hardware (T10); governor natural deferral (OM "never governs down").
- GTAO cost at DPR 2 (T10).
- Baseline (non-ULTRA) stage breakdown: fill vs raycast vs parse "needs a profile to rank levers" (RQP 07-12) — never taken.
- Draw calls / triangles / texture bytes for any pose — DBG rows exist; T77 says start there.
- Total VRAM: not readable; only D figures.
- Shadow pass in isolation (ms shadows on/off) — only whole-frame deltas.
- RC19 PiP saving (no number recorded); RC21 gate (shipped OFF, unverified).
- Dense-metro cost — poses are Dnipro, St Albans, Everest, Fuji; no NYC/Tokyo-class OSM density.
- Open audit measurements: M4, M9, M10, M12 (reversed-Z + MSAA + GTAO), M14.
- T34 mid/low GET count on device; T65 far-cascade worth; T5 checkerboard under instrumentation; prod (Wix cloud) render perf.

## 4. Refuted / rejected ledger (merged)
| Id | Candidate | Why | M/A |
|---|---|---|---|
| F-1 | Terrain LOD geomorphing | `heightAt` is a CPU raycast; fades snap; TIN has no vertex correspondence | A |
| F-2 | `TileFlatteningPlugin` under footprints | no tessellation; self-confirming fixed point | A |
| F-3 | Seat invalidation on LOD/foveation | `high` has no foveation; residual absorbed | A |
| F-4 | Enriched cells lack LOD tier | nearest cell reserved first; sweep ~0.2 ms | A |
| F-5 | Imagery LOD lacks screen-space criterion | transitive via SSE in device px | A |
| F-6 | Foveation on `high` sharpens far field | arithmetic no-op | A |
| F-7 | KTX2/texture budget for composites | bakes carry no textures | A |
| F-8 | Refracted vs airless horizon seam | 0.0176° worst | A |
| F-9 | No horizon/limb culling | far plane does it | A |
| F-10 | geoLabels float32 rebase | premise wrong; asset ulp 0.42 m | A |
| F-11 | Ground queue lacks FPV look bias | error-first ordering merges region error | A |
| F-12 | CSS-px SSE 2× coarser than terrain | enriched inert; terrain L13-capped; narrowed to #15 | A |
| F-13 | DPR foveation | ceiling is heat/jetsam not fill | A |
| F-14 | near/far frozen in FPV | `adjustCamera` runs every frame | A |
| F-15 | Stale rim oct normals | rim 0.59°/interior 0.55° — indistinguishable | M |
| U-1 | CSM library | clobbers `onBeforeCompile`; +3 lights recompile; "already free" measured false | A→M |
| U-2 | PCSS | not in npm; needs raw depth vs `sampler2DShadow` | A |
| U-3 | VSM | every receiver casts → 768 MiB at 8192² | D |
| U-4 | Real-time GI | owner-accepted; streaming tiles can't hold probes | A |
| U-5 | `PCFSoftShadowMap` | dead code | source |
| U-6 | Full auto mip chain | transparent-border bleed | A |
| U-7 | HQ refinement region (T44) | 0 extra tiles; availability-capped | M |
| R-1 | Tangent-plane curvature dominant (RC12) | 0.568 m vs 14.20 m | M |
| R-2 | Fading parent wins raycast (M7) | 1.00 hits/sample | M |
| R-3 | Depth precision work (RC28) | 24 bits, no shimmer in 10 legs | M |
| R-4 | Desktop far-field refinement (S10) | zero extra tiles | M |
| R-5 | T34 churn on desktop | cache rests 109.8 MB vs 322.1 floor | M |
| R-6 | DSM→DTM building punch (RC15) | +0.34 m median | M |
| R-7 | RC16 margin bake + crossfade | straddlers already harvested | M |
| R-8 | RC21 full animation predicate | 40+ sources; false negative = frozen globe | A |
| R-9 | Naive appended skirt | +59 %/+78 % verts | M |
| R-10 | `getImageData` mip filter | 5.36 ms/composite stalled page | M |
| R-11 | PiP half-rate | composer overwrites PiP rect | A |
| R-12 | Blit `toneMapped:false` | three forces NoToneMapping into RTs | source |
| R-13 | Tilt hemisphere toward sun | 0.18 % of facade pixel | M |
| R-14 | Google P3DT for Dnipro | no coverage over UA; C5 | A |
| R-15 | WebGPU (D12) near-term | raw GLSL/`onBeforeCompile` look = rewrite | A |
| R-16 | `TilesFadePlugin` for buildings | per-material WeakMap vs one-material invariant | A |
| R-17 | Flat/procedural window emissive (R3) | owner: "painted", "junky" — twice | owner |
| R-18 | TAA | continuous drift/walk, no motion vectors, smears dithers | A |
| R-19 | Runtime geoid (#26) | D4 binding; smaller than GPS noise | A |
| R-20 | Occlusion culling (#20) | non-conservative profile; cull↔evict loop; C2 | A |
| R-21 | Governor disabling shadows/bloom | over-degraded the M3 Pro (07-13) | M |

## 5. T43 gap ladder status
1 drape mips/aniso → ULTRA-gated (AB3) · 2 heightAt BVH/topmost → RC6 (fixed nothing observed) · 3 curvature → REFUTED · 4 sweep look bias → RC7 (0.9 bar unmet) · 5 45 m gate → RC8 · 6 seat dies on evict → RC9 (warm-restore UNVERIFIED) · 7 OSM unseated over patch → RC14 NOT BUILT · 8 FPV walk re-sample → RC10 · 9 aerial perspective → S4 ULTRA (T69 open) · 10 far-field refinement → REFUTED · 11 DSM seating → building REFUTED, canopy → T58 · 12 governor never promotes in FPV → RC18 · 13 rigid box → OPEN (skirt masks) · 14 depth encoding → REFUTED · 15 buildings CSS-px SSE → OPEN (AB6) · 16 hemisphere ECEF +Y → ULTRA (AB2) · 17 FPV shadows off on miss → RC3/RC4 · 18 straddlers → RC16 · 19 sidecars → RC17 · 20 occlusion culling → out of scope · 21 post-AA → OPEN · 22 composite aspect → upstream OPEN · 23 governor inputs (`hitchCount` unused) → OPEN · 24 T34 churn → RC20 mid/low · 25/26 → doc lines.

## 6. RC1–RC30
RC0 probes ✔ · RC1 sun-quad window ✔ · RC2 shadow fade 3° ✔ (AB4) · RC3 `focusHit` gate gone ✔ · RC4 viewer-fit shadow box ✔ (0.78→2.44 m/texel cost) · RC5 Esri sentinel ✔ · RC6 deepest-hit ✔ · RC7 look-biased sweep ✔ (bar unmet) · RC8 relief gate ✔ · RC9 seat bank ✔ (warm-restore UNVERIFIED) · RC10 walk re-seat ✔ · RC11 height memo ✔ · **RC12 REFUTED** · RC13 skirt ✔ · **RC14 OSM per-tile seat ✗ never built** (registry gap) · **RC15 REFUTED** · RC16 straddler rule ✔ · RC17 sidecars ✔ · RC18 lever split ✔ · RC19 PiP RT cache ✔ · RC20 LRU bank mid/low ✔ · RC21 frame gate OFF · RC22 mobile knobs A/B-prep ✔ (unapplied) · RC23 eclipse haze ✔ · RC24 dome seam ✔ · RC25 capped mips ✔ · RC26 chip-flip hint ✔ · RC27 tuning notes ✔ · **RC28 REFUTED** · RC29 docs ✔ · RC30 RENDERING_ARCHITECTURE ✔.

## 7. Verification inventory
| Harness | Proves | Legs | Last result | UNVERIFIED tails |
|---|---|---|---|---|
| `verify-ultra.mjs` | off-state exactness, live flip, timelapse, Everest casts | 28 | 28/28 (09-02) warm run 3 | — |
| `verify-ultra-dusk.mjs` | cascade coverage, monotone dusk, skirt seam | 21 | 21/21 | owner: not fixed |
| `verify-rendering-charter.mjs` | RC0–RC11 + E/F | 85 | 85/85 (09-02, 228 s) | RC9 warm restore; RC7 bar |
| `verify-eclipse.mjs` | topocentric geometry + pixels | 37/38 | PASS | T46 |
| `verify-debughud.mjs` | chip/panel/moving numbers | 17 | 17/17 | `/m`-negative leg |
| `verify-qaslice-cab.mjs` | /m 2D↔FPV ≈0 GETs, minimap | 64 | 64/64 (08-22) | device GETs |
| `verify-bake-ladder.mjs` | skirt + sidecar | 7 | 7/7 | — |
| `verify-terrain-patch.mjs` | GLO-30 streams, river ≤84 m | 5 | PASS (08-18) | — |
| `verify-s5-night.mjs` | Black Marble, K&S moon, moon shadows | ~5 | PASS | — |
| `verify-bldg-override.mjs` / `meshedit` / `usermodels` / `modelupload` | U8 + MS1–MS6 | 7/22/18/8 | PASS (09-02) | model perf cliffs (E) |
| `verify-audit3.mjs` | anchor ladder, focalCone realloc, PiP shadow restore | 16 | 16/16 | — |
| `verify-qa7ab.mjs` | 2D photographic chart | 6 | PASS | — |
| `verify-pin-reframe.mjs` | pin-arrival reframe | — | **RED** (T76) | — |
| `verify-bestspot.mjs` | BEST SPOT | 101 | 96/101 RED (T61) | — |
| `verify-prod-globe.mjs` | prod boots | — | ops only | prod render perf |
Traps: occluded-tab frozen rAF, fail-open undefined probes, cumulative-counter single reads, 504 Outdated Optimize Dep.

## 8. Owner pain points (verbatim-ish)
- 07-12: hard pass on perf/fluidity/aesthetics, "must run on more than an M3 Pro"; Dnipro detail 2/5.
- 07-13: "remove windows emulation … looks junky… what I need is buildings casting nice shadows on the ground and other building"; "still not a single cast shadow".
- 07-17: ground checkerboard stipple + "super flickering" 1500→200 km (T5 OPEN).
- 08-17: mobile "barely acceptable" on iPhone 17 Pro + Pixel 6 Pro; "FPV random full re-render / violent camera jerk to orbit / buildings re-seat at new altitude — must never happen"; closest-first; foveation.
- 08-22i: "the visual difference between 2d and tilted is huge… less resolution, and very grayish"; shadows "quite naive and linear"; terrain shadows "should produce amazing looks in high mountain regions"; no ray tracing "even macbook m3 may die".
- 08-22j: "even if it is sub 15FPS but graphics fidelity improves… worth it" (ULTRA only).
- 08-25: B1 "Map data not available" · B2 square edge at totality · B3 sunset shadow snap + luminosity jump · B4 shadows off / partial coverage.
- 08-27b: shadows "cropped, sliced, hollow and incomplete… as if part of the global shadows are omitted"; "you uniformly illuminate the whole scene in some piss very bright colour instead of naturally darkening"; "whole sky dome has same colour"; "backs of the building lit with the same ugly tint"; "sun still too bright… lower than around 3-4 degrees"; "dark lines/gaps between tiles in ULTRA"; "if current behavior [is] due to resource or performance constraints — this is bad solution."
- 08-27c: sun disc "too white and transparent"; "weird tint, especially on backside of objects"; "mountains just below the sun which should be in complete shadow"; shadows "should become darker and more global, not just disappear"; afterglow missing.
- 09-01: 08-27b/c shadow work "did NOT fully fix the owner's issue — the topic re-opens".
- 09-02k: T77 ordered.

## 9. DBG metrics available (perf-relevant)
frame: `frame.dt/cpu/draw/gpu`, `canvas.emaMs/hitches`, `mem.jsHeapMB/longTasks` · renderer: `frame.calls/tris`, `canvas.infoGeometries/Textures/Programs`, `canvas.bloom/gtao/gateEnabled/gateSkips/pipActive/pipRenders/pipBlits` · quality: `canvas.tier/tileTier/pendingTier/deviceTier/tierChanges/dpr/ultra/ultraBoot/mapFlat/fpvActive` · shadow/ULTRA: `ultra.on/settled/sunElevDeg/exposure/keyLevel/directK/skyLevel/afterglow/haze`, `ultra.shadow.casting/mapPx/mPerTexel/coverM/viewFitM`, `ultra.cas1|cas2.active/ageMs`; action `ultra.terrainCensus` · tiles: `tiles.bld|gnd|enr.{dlLen,parseLen,visible,inCache,failed,lruMB}`, `tiles.gnd.bankMsLeft`, `tiles.lat.gndMeanMs/pending`, `tiles.aim.active`, `tiles.fovea.on` · imagery: `tiles.img.composites/zMin/zMax/queueLen`, `terrain.overlayPxEff/overlayRebuilds`, `terrain.esri.*`; action `ultra.anisoCensus` · terrain: `terrain.epoch`, `terrain.memo.hits/misses/entries`, `terrain.pick.parentWinRate`, `terrain.patchRewrites` · buildings/models: `buildings.cells/priorityCells/seatEpoch/seatQuietFrames/deferred/rejected/seatCacheHits`, `models.world/resident/loading/skipped/tris/failed/cover/mine`; action `buildings.seats` · vector/camera/system: `vector.mvt.*`, `vector.labels.*`, `camera.nearM/farM/fpv.*/updateErrors`, `system.gpu/cores/deviceMemoryGB/maxTextureSize/msaaSamples/precision`, `canvas.gpuTimer/ctxLost/hidden`.
**Not readable**: total VRAM/texture bytes, per-pass ms (shadow vs composer), per-level imagery histogram (T73).
