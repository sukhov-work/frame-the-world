# Rendering Quality Pass — perf · fluidity · aesthetics · the planning moat

> **Design investigation, 2026-07-12.** Mode: design (investigate-design-v3), Deep tier. Method:
> inline scout (memories + module map + grep) → 4 parallel cited-evidence research tracks
> (performance/cross-device · fluidity/transitions · Dnipro realism · obstruction/astro moat) →
> crux claims self-verified against source → this synthesis. Peer of `ARCHITECTURE_REVIEW.md`.
> A backlog + sequenced plan, **not yet implemented**. Owner rates current street-level detail 2/5.

## The mandate (owner, verbatim intent)
A hard pass on **performance, fluidity, and visual aesthetics** of all current 3D rendering —
especially **street level and FPV** — so transitions, loading, and interactions are as efficient
and nice-looking as possible, **and it must run on more than an M3 Pro** (weaker laptops,
integrated GPUs, mid mobile). **Dnipro** buildings/landmarks/terrain need to look nicer/more real.
And the product's stated moat is still unmet: *fit a photo into a realistic cityscape → tune it →
**predict** future astro events / lighting → adjust photo parameters against the **actual cityscape
and obstructions**.*

## The synthesis thesis (read this first)
The four asks look separate but resolve to **one architectural keystone plus three payloads on
top of it.**

The keystone is an **adaptive quality system**: a device-tier picked at startup + a runtime
frame-time governor that scales a degradation ladder (DPR → bloom → AO → shadows → tile error
targets → vector density). Today there is **none** — DPR is a static `min(DPR, 2)`, the composer
renders full quality every frame forever, and there is no way for a weak GPU to shed load
(`GlobeCanvas.tsx:31,228`). This single absence is why the scene will cook anything below the
owner's M3 Pro, and it is also what unlocks the C2 tension: *"both accuracy AND stylized beauty,
neither sacrificed"* is only affordable across devices if the beauty **degrades gracefully**
rather than being dialed down for everyone. Every realism addition below (ambient occlusion,
night emissive, per-building variation) registers as a tier-gated capability so it's rich on
capable hardware and absent on weak — the same scene, tiered, not a lowest-common-denominator
compromise.

The three payloads then ride the keystone:
- **Fluidity** — kill the pops (buildings, vector web, labels) with a shared screen-door reveal,
  and choreograph the street-level "assemble."
- **Dnipro aesthetics** — the 2/5→4/5 lives in *default stylized* upgrades (AO first), **not** in
  photoreal tiles: Google Photorealistic 3D Tiles are **verified absent over Ukraine**.
- **The moat** — mostly a *pure, testable* ephemeris planner + a terrain horizon profile; real
  building-occlusion is a bounded structural add.

---

## Workstream 1 — Cross-device performance (the keystone)

### Findings (cited; verified against source)
- **No adaptive quality anywhere.** DPR is fixed `min(devicePixelRatio, RENDERER.maxPixelRatio=2)`
  (`GlobeCanvas.tsx:31`, `tuning.ts:185`); the rAF loop calls `composer.render()` unconditionally
  every frame (`GlobeCanvas.tsx:221-230`) — a static street view still pays full price forever
  (idle drift is off below 400 km, so nothing even *needs* the redraw).
- **`antialias: true` on the base `WebGLRenderer` is redundant** (`GlobeCanvas.tsx:30`). The scene
  is composited through an MSAA HalfFloat target (`GlobeCanvas.tsx:169-173`, `samples:4`); the only
  draw to the default framebuffer is `OutputPass`'s fullscreen triangle, which has no internal
  edges to smooth. It allocates a multisampled backbuffer that does nothing — pure VRAM waste,
  worst at 4K/DPR2.
- **Composer + bloom + shadows are heavy and un-tiered.** EffectComposer clones its RT, so **two**
  MSAA4 HalfFloat targets exist; UnrealBloom adds ~11 half-float mip targets and ~12 fullscreen
  draws; shadows are **PCF 4096²** with **per-tile `ShadowMaterial` twins** that double terrain
  draw calls whenever `alt < 30 km` (`GlobeCanvas.tsx:145`, `tuning.ts:151`, `imageryGround.ts:303-322,407-411`).
  None of it scales by device.
- **Two `TilesRenderer`s each default to a 0.4 GB LRU byte cap** (up to ~0.8 GB of tile bytes) —
  never tuned down; a real mobile-OOM risk (`node_modules/3d-tiles-renderer/.../LRUCache.js` default,
  no override in repo). Buildings never set `errorTarget` (default 16 SSE); ground ramps 2→12 by
  altitude (`imageryGround.ts:366`, `tuning.ts:672-677`).
- **~10 un-accelerated raycasts/frame at street level.** `heightAt` does
  `raycaster.intersectObjects(tiles.group.children, true)` recursively against every loaded terrain
  tile, no BVH (`imageryGround.ts:340-350`); the vector lattice (up to 8×) and street-name reseat
  (2×) funnel through it (`vectorFeatures.ts:380-491`, `streetNames.ts:273-305`).
- **WebGPU (D12) is not a near-term lever.** The look is built on raw-GLSL `ShaderMaterial`s +
  `onBeforeCompile` string grades; `WebGPURenderer` needs TSL/NodeMaterial and ignores
  `onBeforeCompile` — porting is a multi-week rewrite of the C2 look. Keep D12 as a *future* path.

### Backlog
**Quick wins (safe, pure-`tuning.ts`/constructor, locally A/B-verifiable):**

| # | Lever | Win | Effort | File |
|---|---|---|---|---|
| P1 | Drop `antialias:true` (composer owns AA) | frees a multisampled backbuffer | S | `GlobeCanvas.tsx:30` |
| P2 | `powerPreference:'high-performance'`; probe `failIfMajorPerformanceCaveat` to detect software GL | avoids low-power/software renderers | S | `GlobeCanvas.tsx:30` |
| P3 | Tier the DPR cap (high 2 · mid 1.5 · low 1.25) + clamp by total drawing-buffer pixels | big fill-rate cut on 4K/hi-DPR | S | `GlobeCanvas.tsx:31` + `tuning.ts` |
| P4 | Tune both `tiles.lruCache.maxBytesSize` per tier (~150–200 MB on mobile) | bounds the ~0.8 GB default | S | `imageryGround.ts`, `buildings.ts` |
| P5 | Tier `SHADOWS.mapSize` (2048 mid) + `shadowMap.enabled=false` on low | ~50 MB + halves shadow pass + drops twin draws | S | `GlobeCanvas.tsx:40,145` |
| P6 | Set buildings `errorTarget` (24–32 on low) + raise `errorTargetNear` on low | fewer tiles = fewer draws/VRAM | S | `buildings.ts`, `tuning.ts:672` |
| P7 | `bloomPass.enabled=false` on low tier | removes ~12 fullscreen draws + ~11 RTs | S | `GlobeCanvas.tsx:182` |
| P8 | Thin vector web / street-name budgets on low tier | fewer raycasts + draws | S | `tuning.ts` VECTOR/STREETS |

**Structural bets:**

| # | Lever | Win | Effort |
|---|---|---|---|
| P9 | **Runtime frame governor** — EMA frame time drives the degradation ladder up/down with hysteresis; hangs off the existing `stepFrameTiming` (`StylizedTiles.ts:777`) | the decisive cross-device win — a fixed pipeline becomes adaptive | M |
| P10 | **Device-tier detection** at init — `WEBGL_debug_renderer_info` UNMASKED_RENDERER + `navigator.deviceMemory`/`hardwareConcurrency` + `maxTextureSize` → seed the tier | right starting quality, no first-seconds jank | M |
| P11 | **On-demand render** at street level — skip `composer.render()` when nothing changed (camera static, no active flight/glide/ease/drift) | idle GPU ~0%; battery/thermal | M–L (must decide what happens to always-on `uTime` shimmer/twinkle) |
| P12 | **BVH for terrain `heightAt`** (three-mesh-bvh or a cached height grid) instead of recursive `intersectObjects` | cuts ~10 raycasts/frame from O(tiles) to O(log) | M |

### The adaptive-quality design (keystone)
- **`QUALITY` block in `tuning.ts`** (pure data, honors the tuning contract): three tiers, each a
  record of `{dprCap, bloom, ao, shadowMapSize|0, groundErrorNear, buildingErrorTarget, lruBytesMB,
  vectorLatticeBudget, maxStreetNames}`.
- **Tier picker** (`GlobeCanvas` pre-composer): renderer string + deviceMemory/cores/maxTextureSize
  → `low|mid|high`. Seeds DPR, shadow size, bloom/AO on/off, error targets, LRU caps.
- **Frame governor** (`stepFrameTiming`): EMA of `dtMs`; > budget (e.g. >20 ms) for N frames →
  step **down** the cheapest-loss-first ladder (DPR → bloom → AO → shadows → errorTarget → vector);
  < lower bound (e.g. <13 ms) while interacting for M frames → step **up**; hysteresis + cooldown
  to avoid oscillation. DPR changes debounced (they realloc targets: `setPixelRatio`+`setSize`).

---

## Workstream 2 — Fluidity / transitions / loading

### Findings (cited)
- **Buildings hard-pop — the #1 street-level jank.** `attachBuildings` registers **no
  `TilesFadePlugin`** (`buildings.ts:45-56`); each b3dm snaps to full opacity on `load-model`
  (`buildings.ts:119-139`). And it *can't* just use the plugin: the fade manager keys params in a
  per-material WeakMap and calls `needsUpdate` on the shared material when any tile fades
  (`node_modules/3d-tiles-renderer/.../FadeMaterialManager.js:24-46,93-104`) — with ONE shared
  material that means last-tile-wins + constant global recompiles. Structurally incompatible with
  the one-material invariant.
- **Vector web + street-name pops.** Vector tiles reveal at full opacity in one frame once built
  (`vectorFeatures.ts:492-494`), serialized ~1/frame (`buildBudgetPerFrame:1`) → the "~1–3 s per
  tile" pop-in. Street-name labels have per-label materials but jump 0→full with no ease
  (`streetNames.ts:304`) and are dropped instantly on deselect (`:251`).
- **FPV entry compiles a shader variant at the worst moment.** Entering FPV flips
  `styleMat.transparent` and forces `needsUpdate` mid-flight (`buildings.ts:152-165`); `transparent`
  is part of three's program cache key (`WebGLPrograms.js`), so the transparent building variant
  **compiles on first FPV entry** — a one-time hitch. FPV entry also uses the full 2.2 s flight with
  no terrain floor (`StylizedTiles.ts:948`); FPV look is undamped (`:1029-1046`).
- **Smaller:** idle drift is frame-rate-dependent (no dt scaling, `StylizedTiles.ts:1113-1124`);
  graticule hard-toggles at 150 km (`:1836`); new-query pins pop in (`Pins.ts:354-383`).
- **The good, to keep as the reference:** the pin→projection flight (`flight.ts:238-263`), the
  imagery ground's readiness-gated `uFtwFade` dissolve (`imageryGround.ts:374-389`), the dark-drape
  live-uniform crossfade (`:391-403`), the welcome→explore handoff (`explore.ts:236-240`), and all
  the eased glides/encoders (`StylizedTiles.ts:784-829`). These are the model the pops should copy.

### Backlog (top items)
| # | Fix | Win | Effort | Kind |
|---|---|---|---|---|
| F1 | **Building per-tile screen-door reveal** (recommendation below) | removes the #1 street pop | M | structural |
| F2 | **Shared reveal helper** across buildings + vector fills + ribbons; per-tile birth = `max(loadTime, tierStart)` so the scene *assembles* in order (terrain→drape→roads→water→buildings→names) | kills vector pops + graceful assembly | L | structural |
| F3 | Street-name per-label opacity ease (in + ease-to-0 before drop) | stops name snapping | S | quick |
| F4 | Pre-warm the transparent building variant at init (`renderer.compile`) | removes FPV-entry hitch | S | quick |
| F5 | dt-normalize idle drift + eased resume | consistent pace across refresh rates | S | quick |
| F6 | New-query pin fade-in (reuse hover/select ease) | | S | quick |
| F7 | Graticule opacity fade instead of `visible` boolean | | S | quick |
| F8 | FPV entry: shorter (~1 s) + terrain-floored flight; small look damping | subjective smoothness | S | quick |

### Building-fade recommendation
**A per-tile "age" screen-door reveal through the existing chained `onBeforeCompile` on the ONE
shared `styleMat`** (the same dither idiom the imagery ground already ships, `imageryGround.ts:280-284`).
Stamp each tile's birth time on `load-model` (a cheap `mesh.onBeforeRender` uniform write, birth is
constant per tile); fragment computes `age = clamp((uTime−birth)/fadeMs, 0, 1)` and screen-door
`discard`s against a bayer threshold; stamp the same birth on the edge geometry. Keeps ONE material
compiled once (no per-tile program, no recompile), stays **opaque** (no transparent sort / depth
loss), and reuses house style. Rejected alternatives: per-tile clones = the banned pattern; a single
global opacity uniform can't tell a new tile from an old one. Trade-off: a ~600 ms dither stipple per
tile — already the site's look, reads as intentional. Same helper powers F2.

---

## Workstream 3 — Dnipro realism (the 2/5 → 4/5)

### The headline: Google Photorealistic 3D Tiles are useless over Dnipro
Google's own [coverage table](https://developers.google.com/maps/coverage) shows **Ukraine has no
3D / Photorealistic coverage** (Poland, Romania do). Over Dnipro, P3DT would render **terrain +
draped 2D imagery and zero textured buildings** — nothing beyond what the app already approximates —
on top of the C5 "unmodified only" ToS constraint, a $6 CPM enterprise cost, and an EEA-billing-403
gotcha. **Verdict: do not wire Google P3DT for Dnipro.** (The realistic-mode toggle, if ever wanted,
would have to be a self-hosted Overture/OSM2World→3D-Tiles extract — infra-heavy; the earlier
Overture-hosting trial 500'd. Deprioritized.)

### The realism ceiling is the source, not the styling
Cesium OSM Buildings is **LOD1 — flat-roofed prismatic extrusion**; per the OSM Simple-3D-Buildings
spec, roof shapes are *ignored* by the source ([OSM S3DB](https://wiki.openstreetmap.org/wiki/Simple3DBuildingsV1),
[Cesium OSM Buildings](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/)), and the
app renders them as ONE shared dark material (`buildings.ts:65-73`) with no AO, no per-building
variation, no night facades. But the underlying OSM data is rich (live Overpass, Dnipro core bbox):
**85,802 buildings; ~14% with a usable height; 2,568 `roof:shape`; 1,766 `building:part`; 1,195
named** — a curated few-thousand-feature landmark subset carries the roof detail the current source
throws away. So the 2/5→4/5 is a *default-stylized* problem, and most of it is data-free.

### Recommended default-stylized stack (C2-compliant, tier-gated)
| # | Upgrade | Gain | Effort | Notes |
|---|---|---|---|---|
| R1 | **Ambient occlusion pass** — `GTAOPass` (built into three 0.185; `examples/jsm/postprocessing/GTAOPass.js` — **no new dep**), inserted after `RenderPass`, before bloom; AO tinted toward `tokens.skyHorizon` for crude skylight | **highest ROI** — turns floating gray boxes into massing with depth | S | **tier-gate it** (WS1) — it's composer cost the perf track wants sheddable |
| R2 | Per-building tonal/height variation baked as vertex colors from OSM batch metadata (`GLTFStructuralMetadataExtension`), keeping ONE material | kills the uniform-slab read | M | *probe first* — verify Cesium OSM tiles expose a readable batch table in this renderer |
| R3 | Restrained night window/facade emissive in the building shader (existing `onBeforeCompile`, gated by night) | "city alive at night" | M | reuse `buildings.ts:85` hook |
| R4 | Client-side S3DB roof/part reconstruction for the ~2–4k `roof:shape`/`building:part` subset + optionally one curated hero glb (DRACO loader already wired) | **"reads as Dnipro"** identity | L | the landmark layer; schedule after R1–R3 |
| R5 | 3D river water + bridge-deck slabs (replace flat ink at street level) | med | M | optional street polish |

Skip a DEM swap — Dnipro is a flat river city and the geoid→ellipsoid offset would break building
seating; Cesium World Terrain is fine. **First move: R1 (GTAOPass), tier-gated.**

---

## Workstream 4 — The obstruction / astro-prediction moat

### Everything needed is already in the tree (verified)
- The **frustum apex is the photographer's eye in ECEF** and the natural ray origin
  (`lib/geo/frustum.ts:63-64`, live via `PhotoFrustum.current()`).
- **Pure, tested ephemeris**: `bodyStatesAt` + topocentric `horizontal(body,ms,lat,lon)`
  (`lib/ephemeris/bodies.ts:60,105`) + day-arc sampling (`lib/ephemeris/dayArc.ts:68`).
- **The finder engine already ships** in astronomy-engine (verified `astronomy.d.ts`): `Search`
  (generic root find, :1241), `SearchRiseSet` **with an observer-height horizon dip** (:1667),
  `SearchAltitude` (golden/blue/twilight boundaries, :1735), `SearchHourAngle` (:1808),
  `SearchMoonQuarter`/`SearchMoonPhase` (:1556/:1523), `Seasons` (:1894), plus eclipse/apsis/transit.
- **Buildings are raycastable** — only the edge lines disable raycast; the building meshes keep
  default raycast (`buildings.ts:126-135`). The one-material invariant is about per-fragment
  shading and **does not block CPU raycasting** (important correction).
- Today's sky-body occlusion is **analytic against the smooth ellipsoid limb only** — it ignores
  real relief and buildings (`scene/sky.ts:46-60`, `scene/dayArcs.ts:16-21`). That is exactly the gap.

### Capability designs
- **A — real body-blocked test:** raycast the sun/moon ECEF direction from the apex against
  `[buildings.tiles.group, ground.tiles.group]`; hit within a trust radius ⇒ BLOCKED. (Moon dir must
  be camera-relative, ~1° parallax — as the HUD already does, `StylizedTiles.ts:1474`.)
- **B — horizon/skyline profile:** sweep azimuth bins from the apex, marching `heightAt` outward
  (+ curvature/refraction) for a terrain profile, optionally lifted by near-building raycasts. Render
  by folding `profile(az)` into the existing day-arc fade (`dayArcs.ts:82-88`). **Once cached, A
  becomes an O(1) lookup** `bodyAlt < profile(bodyAz)` for all times.
- **C — "when is the light right" finder:** the astronomy-engine searches above → golden/blue/
  twilight windows, sun/moon rise-set with eye-height dip, body-at-target-azimuth, full moon over a
  bearing, solstice alignments, and the money feature "body clears the *real* skyline" via
  `Search(f)` where `f = bodyAlt − profile(bodyAz)`. Surface as **jump-to-time chips** →
  `useTimeStore.setTime(ms)` (already the relight seam).
- **D — shadow/light prediction on the subject:** back-project the frustum's subject surface, then
  A's point-in-shadow test across the day + the golden bell → "in shadow until 15:20 · golden light
  18:40." The scene already renders the correct shadow; D adds an analytic readout.

### The streamed-LOD caveat (honest)
Real occlusion (A/B-building/D) only sees **currently-streamed** geometry — a tower 3 km toward a
low sun may be unloaded, so a ray falsely reports "visible." Mitigation: run at FPV/city altitude
where the relevant tiles are already loaded, cap at a 2–4 km trust radius, label beyond it "horizon
unknown," and fall back to the cached **terrain** profile for long range. The **pure ephemeris path
(C) has no such caveat** — it's exact.

### Phased plan
- **Quick win (mostly pure, testable, no LOD risk):** `lib/ephemeris/planner.ts` (golden/blue/
  twilight/rise-set/body-at-azimuth/full-moon-over-bearing/solstice — pure, unit-tested like
  `bodies.test.ts`) + `lib/ephemeris/horizonProfile.ts` (terrain-only, injected `heightAt`) + a
  `PlanPanel` of jump-to-time chips + an `A-lite` "blocked" flag via the cached profile. Effort M.
- **Structural:** `lib/geo/occlusion.ts` (raycaster over the two tile groups, trust-radius policy) →
  building-accurate A/B, obstruction overlay, subject shadow-timeline D. Effort L; needs a browser
  precision/LOD characterization first.

---

## Cross-track seams (consolidator resolution)
1. **AO (R1) adds composer cost that WS1 wants sheddable.** Resolution: AO is a **tier-gated
   capability in the degradation ladder** (on high, off low) — not a global on. This is the thesis in
   miniature: realism additions must register in the quality system.
2. **Building screen-door fade (F1) vs the one-material invariant (WS1/perf).** Compatible — the
   fade is a per-fragment `discard` on the *shared* material via the existing chained
   `onBeforeCompile`, O(1) per draw, no per-tile material. No conflict.
3. **Moat raycasts (WS4) vs the ~10 raycasts/frame perf finding (WS1).** Resolution: moat occlusion
   runs at **low cadence** (on scene-time change / hover, not per frame) and B's profile is **cached
   per placement**; it does not add per-frame cost. The BVH (P12) would also accelerate it.
4. **Nothing here supersedes a locked ADR.** All additive: AO/adaptive-quality extend D12 ("use
   modern browser tech; performance is a feature"); the planner extends D6 (the PhotoPills/Stellarium
   ephemeris intent); the realistic-mode verdict *upholds* C5. These align with Phase 7's existing
   earmarks (KTX2, OPFS cache, mobile half-size, View Transitions) — WS1 is the front half of Phase 7
   pulled forward.

---

## Recommended sequence
**Pass 1 — Foundation (perf + fluidity + baseline aesthetics; mostly local/type-verifiable):**
the `QUALITY` tier scaffold + governor (P3/P9/P10) as the keystone, the safe perf quick-wins
(P1/P2/P4/P5/P6/P7/P8), the building screen-door fade (F1) + street-name/graticule/drift eases
(F3/F5/F7), and **GTAOPass tier-gated (R1)**. This *is* the "hard pass on perf + fluidity +
aesthetics, runs below an M3 Pro" the owner asked for, and it makes everything after it sheddable.

**Pass 2 — Dnipro identity:** per-building variation (R2, after a metadata probe) + night emissive
(R3) + the landmark roof/part reconstruction and hero glb (R4). This is the 2/5→4/5 "reads as
Dnipro" layer.

**Pass 3 — The moat:** the pure ephemeris planner + terrain horizon profile + jump-to-time chips
(WS4 quick win), then building-accurate occlusion + subject shadow timeline (WS4 structural).

Rationale: Pass 1 is the highest-confidence, most-broadly-felt, and load-bearing (the tier system
gates Pass 2's richness); Pass 3 is the differentiator but a larger, more design-heavy build better
done as its own focused effort.

## Verification plan
- **Local (every slice):** `npm test` (planner/horizon-profile/tier math are pure — unit-test them
  like `bodies.test.ts`), `npx astro check`. Pure logic + type gates only.
- **Browser (mark UNVERIFIED until run in `wix dev` + a real weak device):** actual FPS/heap per
  tier, the AO look + cost at DPR 2, the building-fade feel, governor stability (no oscillation),
  raycast precision/LOD reach for occlusion. Use the existing golden-gate + Playwright harness; the
  cross-device claim specifically needs a non-M3 machine (owner or a throttled profile).

## Open decisions for the owner (genuine forks)
1. **Which pass first** — Foundation (perf+fluidity+AO, recommended), Dnipro identity, or the moat?
2. **The moat's scope now** — build the pure-ephemeris planner quick-win in this pass, or hold the
   whole moat as its own phase after the marketplace (Phase 6)?
3. **Realistic mode** — since Google is dead for Dnipro, drop the idea and pour that budget into
   stylized quality, or keep a self-hosted-tiles toggle on the someday list?

## Confidence & gaps
**Confidence 84%** on the diagnosis and the plan shape (crux claims self-verified: composer/DPR
redundancy, GTAOPass built-in, the finder API, building raycastability, Google-Dnipro absence).
**Gaps (browser/data, UNVERIFIED — no `wix dev` in this pass):** which stage actually bottlenecks
street level (fill-rate vs raycasts vs parse) needs a profile to *rank* levers by real payoff; the
GTAO cost at DPR 2; whether Cesium OSM tiles expose readable per-building metadata here (probe before
R2); raycast precision + terrain `heightAt` reach for occlusion; governor tuning to avoid oscillation.
