# RENDERING ARCHITECTURE — PLUX, as built

Written 2026-08-26 to close the RENDERING CHARTER (RC30). It absorbs the "what we already do"
tables from `FPV_FIDELITY_AUDIT_2026-08-22.md` and the three.js facts and rejection tables from
`ULTRA_ARCHITECTURE.md`; both stay as provenance. Where this file and an older one disagree, this
one is current.

Two halves. The first describes the frame's journey in broad terms and is meant to be read start
to finish. The second is per-module reference — knobs, seams, and the facts that constrain the
design.

---

## Part 1 — how a frame is made

### 1.1 The scene graph and the two tile renderers

The globe is one `client:only` React island (`GlobeCanvas.tsx`) that owns a `WebGLRenderer`, a
`PerspectiveCamera`, an `EffectComposer`, and one directional key light with one hemisphere fill.
Everything else lives behind `attachStylizedTiles` (`StylizedTiles.ts`), which is the orchestrator:
it builds the scene modules, owns all store reads, and exposes a small handle back to GlobeCanvas.
GlobeCanvas never reads a store. That split is what keeps the renderer levers and the tile levers
independently testable.

Three `TilesRenderer` instances stream in parallel:

| Renderer | Content | Module |
|---|---|---|
| ground | Cesium World Terrain (quantized mesh) with a self-baked GLO-30 patch swapped per tile, draped with Esri World Imagery and optionally a CARTO dark layer | `scene/imageryGround.ts` |
| buildings | Cesium OSM Buildings (ion), masked off inside any baked region | `scene/buildings.ts` |
| enriched | our own baked city tiles — roof-shaped buildings, walls, street furniture, instanced trees | `scene/enrichedBuildings.ts` |

The ground renderer is special in two ways that recur throughout this document. It is the one
surface `heightAt` raycasts against, so it is the **single vertical authority**; and it is the only
one carrying `UpdateOnChangePlugin`, so its traversal — and therefore its LRU trim — runs only on
frames where something moved.

### 1.2 The per-frame step order

`tilesHandle.update()` runs a fixed sequence of ~55 small step functions. The ones that matter for
the look, in order:

```
stepFrameTiming → stepViewFocus → … camera/FPV steps … → stepUltraGate → stepGroundUpdate
  → stepEphemerisResample → stepEclipse → stepUltraLook → stepKeyLightAndShadow
  → … sky, pins, labels, feeds … → (back in GlobeCanvas) composer.render()
```

Two ordering rules are load-bearing. `stepUltraGate` runs before anything that reads an ULTRA
value, because it is the only writer of `ultraOn`. And `stepKeyLightAndShadow` runs last among the
light steps, because it consumes the eclipse scalar and the ULTRA look values that the two steps
before it produce.

One trap has bitten twice: orchestrator state must be declared **above** the ephemeris seam in
`StylizedTiles.ts`. A `let` declared below it puts the variable in the temporal dead zone for
`applyQualityTier`, which runs during attach; the resulting `ReferenceError` is caught by
GlobeCanvas's `.catch` and logged as a console *warning*, and the app silently renders the
procedural placeholder globe instead of the real one. `astro check` cannot see it.

### 1.3 The light model

One `DirectionalLight` is the key. Its colour and intensity come from a twilight band curve over
solar elevation, and its direction comes from the ephemeris — the same `SUN.direction` the ground
and earth shaders read, so shading always agrees with the terminator.

Four things modulate it:

- **The golden bell** (−12°…+21°) warms and brightens the key near the horizon.
- **The eclipse scalar** `eclipseK` darkens the world at totality, bottoming at a `daylightFloor`.
- **The sun→moon handoff** (`lib/globe/keyHandoff.ts`) fades the key across the horizon crossing.
- **ULTRA** adds exposure, aerial-perspective haze and a hemisphere tint on top, all driven by the
  same solar elevation — which is the root of both ULTRA seams and of how they were fixed (§1.6).

`HemisphereLight` reads its direction from its **world position**, which had never been set, so its
"sky" pointed along ECEF +Y — correct on exactly one meridian and progressively inverted
everywhere else. ULTRA re-seats it onto the local up at the view focus; the baseline deliberately
restores the ECEF +Y construction state, because changing it would change the default look. That
choice is an open owner A/B (AB2), not a defect left in place by accident.

### 1.4 Shadows

One ortho shadow camera, refit every frame. Three facts shape the rig:

**`shadow.intensity` is a live per-frame uniform.** One write fades the shadows buildings receive
and the ground's `ShadowMaterial` twins together, because `getShadowMask()` routes both through it.
This is what made the sunset fix possible without a recompile: shadows now fade to nothing over the
last ~3° before the `castShadow` boolean flips, instead of a kilometres-long shadow field vanishing
in a single frame at the sun's brightest moment of the day.

**The box is fit to the viewer, not to the screen-centre ground hit.** Before RC4 the half-extent
was `clamp(alt·K, 1600, cap)` centred on the ellipsoid intersection, which meant covering your own
foreground required a pitch of at least 59° (base) or 42° (ULTRA) **at every altitude** — extent
and hit distance both scale with altitude, so zooming never helped. Now a rig-only `_shadowFocus`
puts the eye at the box's edge. `_focus` itself is untouched: it is the tilt/heading pivot and the
lat/lon source for PLAN, FIND and BEST SPOT.

**That fix has a stated cost.** Near-level looks now spend the shadow texels on about 5 km instead
of 1.6 km — 0.78 → 2.44 m per texel. It buys shadows at pitches that had none at all and costs
crispness where there were already some. `SHADOWS.viewFitK: 0` restores the old extent while
keeping the re-centring. This is queued as AB4.

Terrain casting is ULTRA-only. It also fails **silently** without `shadowSide = FrontSide`: the
terrain tiles are single-sided sheets, and three's depth material flips FrontSide → BackSide by
default, so the terrain casts nothing with no error and no warning.

### 1.5 Imagery and the availability cap

Esri tiles are composited per terrain tile onto a canvas, then draped. The stylized grade is
injected **after** the composite (into `alphamap_fragment`, not `map_fragment`) and chains
`onBeforeCompile` rather than assigning it.

Two things about coverage are worth knowing before touching this path.

**Esri serves an HTTP-200 placeholder beyond local coverage.** It is 2,521 bytes, byte-identical
every time. Because it is a *success*, none of the failure machinery arms: `info.failed` never
fires, the debounced overlay reset never runs, `force-cache` pins it without revalidation, and the
iOS service worker caches it for seven days. Around Everest, z19 coverage is an island — the summit
tile is real, and 100% of sampled windows 256–1024 tiles out are placeholder, while z16–z18 are
complete. The fix detects the sentinel by **bytes** (length plus an FNV-1a-32 hash), fetches the
parent, and crops the correct quadrant. It cannot detect by ETag: Esri sends no
`Access-Control-Expose-Headers`, so the header is not CORS-readable from a page. The charter's
proposed detector would have half-failed.

**Desktop imagery is availability-capped, not refinement-capped.** Forcing the ground errorTarget
to 0.05 produced *zero* extra tiles. Any plan that tries to buy sharpness with more aggressive
refinement on desktop is refuted before it starts.

### 1.6 ULTRA, and the off-state law

ULTRA is an opt-in desktop profile, not a fourth quality tier. Making it a tier would have made
`caps[tier]` a type error and broken the literal `TIER_ORDER` assertion the whole quality pass
rests on. It is applied as overrides on top of whatever tier the governor is running — structurally
the same shape as the iOS lean profile.

**The law: with the chip off, no ULTRA value may change a pixel.** Proofs are literal — `=== 0`,
not `< ε`; `toBe` identity, not deep equality. `ultraTileLevers` returns its `base` argument *by
identity* when off, so no call site can even observe a re-created object. The browser leg asserts
zero with the chip off, flips it on, flips it off, and re-asserts exactly zero *after the ease has
snapped* (>6.2τ) — because a correct ease sampled too early reads as a bug.

Both ULTRA seams came from the same root and were fixed the same way. Every ULTRA look term is
driven by solar elevation, so ULTRA's additions were on their own schedule:

- An eclipse does not move the sun, so at totality the band curve still said "day" and the aerial
  perspective painted a day-tinted veil over a world the eclipse had just darkened. Fix: under an
  eclipse, ULTRA's day-driven additions fade toward baseline — the darkening already lives in the
  shaders baseline carries.
- The sky dome tinted from the golden bell while the ground tinted from a four-stop band curve over
  36°, and they met at the terrain/sky junction. Fix: the orchestrator pushes the ground's own
  effective, already-eased haze and tint into the dome, so the dome cannot drift onto a second
  schedule. Share the emitted value, not the intent.

Three ULTRA shadow levers are construction-time (`mapSize` is latched by three on first render;
flipping `shadowMap.enabled` recompiles every material), so a mid-session toggle leaves the rig on
the boot profile. `ultraBootSnapshot()` freezes the boot answer and the ULT chip shows a warning
dot when the live pref disagrees with it.

**One accidental coupling is on record rather than fixed.** `updateAoEnabled()` gates on
`tier === "high"`, and the ULTRA chip pins the tier to `high`. So if `AO.enabled` is ever turned
on, then on a machine the governor had stepped down to `mid`, enabling ULTRA would also enable
ambient occlusion — a coupling nobody chose, in no tunable, inside a track whose whole contract is
"the chip off changes no pixel". It is recorded next to `AO.enabled` with two honest options.

### 1.7 Seats — the one vertical authority

Every baked building is placed at ellipsoid h = 0 and lifted onto the *rendered* terrain at
runtime. Never bake absolute Z: Cesium World Terrain is WGS84-ellipsoidal and open DEMs are
geoid-orthometric.

There is exactly one sampler, `heightAt`, and everything vertical goes through it. It raycasts the
ground renderer's group; the shadow twins carry `raycast = () => {}` so it can only hit real
terrain. Its results are memoised on `(terrainEpoch, lat, lon)` — an exact key, with `null` never
cached — which measured an 84% hit rate over 18,457 entries and paid for a 4× raise in the seat
sweep budget.

The seat itself is four eased levels (group → cell → per-building → per-tree) that sum to the
footprint's own terrain even mid-ease, with one law: **the first real sample snaps, refinements
ease.** A snap on the first sample is what stops a building rising visibly out of the ground; an
ease on refinements is what stops it twitching.

### 1.8 Adaptive quality

A device tier is detected at boot and a governor steps it from smoothed frame time. `high`
reproduces the pre-quality-pass constants exactly, so a capable machine is byte-identical to before
the feature existed and only weaker hardware ever degrades. That invariant is locked by tests
against the live constants.

Tier changes are split (RC18). A **promote's tile levers land immediately, even inside FPV**;
the renderer levers always wait for FPV to end. The asymmetry is justified by the tier table, which
is itself asserted: a promote only ever lowers an error target and raises an LRU cap, so it cannot
evict or rebuild anything. A **demote** never splits — shrinking a cap mid-FPV evicts everything
outside the visible set and then discards each freshly parsed tile against the full cache, which is
the "the whole city re-rendered" loop this discipline exists to prevent.

The composite resolution is excluded from the fast half in both directions, because a change there
is a fresh-instance overlay rebuild — every composited texture destroyed plus a refetch storm.

### 1.9 The post chain

`RenderPass → [GTAO] → UnrealBloom → OutputPass`, rendering into a HalfFloat MSAA target so HDR
survives to tone mapping. The renderer itself is constructed `antialias: false`: the only draw to
the default framebuffer is OutputPass's fullscreen triangle, which has no internal edges, so a
multisampled default backbuffer would be pure VRAM waste.

The space backdrop must be `scene.background` and not the renderer clear colour. `setClearColor`
converts to the renderer's *output* space, and `EffectComposer` runs with autoClear off, so those
sRGB values landed in the linear HalfFloat buffer and were read back as linear — `#05070B` rendered
as navy across every empty sky pixel.

On `/m` the map window shows a miniature of the whole view. That used to be a second full scene
render every frame, on the weakest hardware in the product. It is now cached into a render target
and blitted (RC19). Half-rate was not available: `composer.render()` overwrites the PiP rect every
frame, so a skipped second pass flickers between the miniature and the full-scale view underneath.
The blit therefore still runs every frame; only the scene render is cached.

The colour path there is worth stating because the design note that preceded it was wrong. three
forces `NoToneMapping` on **anything** rendered into a render target, and the output encode into a
target is the working colour space (identity). So the target holds raw linear HDR, and the blit to
the canvas is the only remaining place tone mapping can be applied — the blit material's
`toneMapped` must stay **true**. Setting it false, as the note said, would have shipped an
un-tone-mapped, clipping miniature.

---

## Part 2 — reference

### 2.1 What the measurements refuted

The most useful output of this track is the list of things that are *not* worth building. Each of
these was measured, not argued.

| Refuted | The measurement |
|---|---|
| **Tangent-plane curvature is the dominant float** (charter RC12) | Every cell is re-seated onto terrain at its own centre, so curvature survives only as its variation *across one cell* — bounded by the cell radius, never the bake radius. At the 3,500–4,000 m ring: **0.568 m of curvature residual against 14.20 m rms of within-cell relief, 4.0%**. A 1/25 term does not justify re-baking three regions. |
| **A crossfading parent tile wins the seat raycast** (M7) | `hitsPerSample` was exactly **1.00** over 37,742 at-rest and 9,874 mid-refine samples. The deepest-tile-hit selection that was built for this is cheap insurance, not a fix for anything observed. |
| **Depth precision needs work** (charter RC28) | **24 depth bits** over a 1.0 m near plane and a 180,375 m far plane, and no shimmer case was observed in any of ten browser legs. Touching 22 raw `ShaderMaterial` instances across 14 modules on a hunch is the wrong trade. |
| **Desktop far-field needs more refinement** (audit S10) | Ground errorTarget forced to 0.05 produced **zero** extra tiles. Desktop imagery is availability-capped. |
| **Ground-LRU rest-trim churn hurts desktop** (T34/M13) | On `high` the ground cache rests at **109.7 MB against a 322.1 MB floor** — the trim condition never arises. The ~600-GET churn is a mid/low-tier phenomenon, which is why the flip bank ships enabled for mid and low only. |

Two more, from the audit's own list, still stand and should not be re-discovered: CSM, PCSS, VSM
and real-time GI are all rejected with reasons in `ULTRA_ARCHITECTURE.md` §10, and the audit's §4
table of 15 refuted candidates is unchanged.

### 2.2 three.js facts that constrain the design

All verified against `three` 0.185.0 in `node_modules`, not from memory. Each one changed a plan.

1. **`PCFSoftShadowMap` is dead code.** three intercepts it, warns "deprecated", and rewrites it to
   `PCFShadowMap`; no shader branch exists. The r185 soft-shadow lever is `shadow.radius` on a
   5-tap Vogel disk rotated per pixel by interleaved gradient noise — a live uniform, and because
   the disk is per-pixel rotated a large radius degrades to noise rather than banding.
2. **`shadow.bias` is a fraction of the shadow camera's near→far range, not a length** — and the
   range moves with altitude. The same constant means −1.4 m at construction and −12.6 to −19.2 m
   under ULTRA's 60 km light distance, which would detach every shadow from its caster. ULTRA
   authors the bias in metres and re-derives it on every rig resize.
3. **`shadow.mapSize` is latched.** three reallocates the depth target only when the map is null or
   the type changed, so a runtime `mapSize.set()` is a no-op — hence the boot read. It also
   silently clamps down past `maxTextureSize`, so the clamp belongs at the call site or the tuning
   constant and the live rig disagree.
4. **A directional shadow target costs 2× a depth-only reading** — an RGBA8 colour attachment
   written by `MeshDepthMaterial` and sampled by nothing, plus a D24 depth texture. 4096² ≈ 128 MiB;
   8192² ≈ 512 MiB.
5. **Tone mapping is skipped for anything rendered into a render target**, and the output encode
   into a target is the working colour space. Both of these are single `if` statements in
   `WebGLPrograms`/`WebGLRenderer` keyed on `currentRenderTarget === null`.
6. **Manual mip chains do not need `TEXTURE_MAX_LEVEL`.** three never sets it anywhere. With
   `generateMipmaps` false it allocates immutable storage sized to `mipmaps.length` and uploads
   level `i` from `mipmaps[i]`; an immutable-format texture is complete over exactly its allocated
   levels. The "an incomplete chain renders black" failure belongs to the mutable WebGL1 path,
   which this renderer never takes. The trap is the opposite one: setting `generateMipmaps = true`
   to obtain the levels would allocate the full chain while filling only part of it.
7. **`FullScreenQuad.dispose()` disposes a module-level shared geometry** that bloom, output and
   GTAO all draw with. Never call it.

And one from `3d-tiles-renderer` 0.4.28 that explains an entire class of churn:
`hasBytesToUnload = unused && cachedBytes > minBytesSize || …`. A single tile the current traversal
did not visit, plus a cache above the **floor**, starts an eviction — the cap is not consulted. A
mode flip marks the whole previous working set unused in one frame.

### 2.3 The vertical-datum asymmetry

Worth stating on its own because it has cost real time twice. Heights are unified to
**WGS84-ellipsoidal at bake time** (mago's `--geoid EGM2008`), so the runtime needs zero datum
handling. `scripts/bake/terrain/geoid.mjs` is the checked-in verification twin, and it exists
because of a 48 m Everest reference bug. A runtime geoid is a binding architectural rejection:
document it, do not code it.

The asymmetry: EXIF altitudes arrive geoid-orthometric, terrain is ellipsoidal. They are not the
same number and the difference is tens of metres.

### 2.4 DEV seams

All are `import.meta.env.DEV`-only and are read by the verification harnesses. The rule that
matters: **read the authority, never a transcribed copy.** Probes that mirror a value into their
own field go stale and then report a pass.

| Seam | What it publishes |
|---|---|
| `__globe.u2()` | eye-jump ring, seat state, per-renderer LRU (`min`/`max`/`cached`/`items`/`bankMsLeft`) |
| `__globe.debugSeats()` | seat sweep counters including gate rejections |
| `__globe.ultraLook()` | eased ULTRA values, the shadow rig's own numbers, and the live composite probe (anisotropy, mip levels, real and level-0 bytes) |
| `__globe.fpv()` | FPV active/kind/pose — a **function**, not a field on `u2()` |
| `__globe.bodies()` | publishes `sunDir`, **not** `sunAltDeg` |
| `__globeQuality` | `tier` (renderer), `tileTier` (tiles), dpr, flat latches, ULTRA state, shadow map px |
| `__quality` | governor, tier log, `force()` (immediate) and `governorPromote()` (routed through the deferral) |
| `__pipCache` | PiP renders vs blits, target size, and a writable `maxStaleMs` for the cost A/B |
| `__overlayRebuilds` | the sticky-composite invariant counter |

### 2.5 Verification harnesses

| Script | Covers |
|---|---|
| `verify-rendering-charter.mjs` | the charter ladder — owner bugs, seat/height core, the Group E/F slices |
| `verify-ultra.mjs` | the ULTRA off-state contract and the gate |
| `verify-eclipse.mjs` | the eclipse path |
| `verify-qaslice-cab.mjs` | the /m 2D↔FPV flip, including the Esri GET counter |
| `npm run proofs` | the Lean 4 floor — not part of the normal loop |

Traps these harnesses have paid for, in the order they will bite again:

- **The verify Chrome carries no occlusion flags.** A backgrounded tab has rAF frozen, and every
  per-frame scalar then reads the same stale frame. The first sunset scrub reported a perfect pass
  from 61 identical samples. Use `ticks()` and assert that consecutive samples actually differ.
- **A probe that reads a field which does not exist fails open.** It does not throw; it returns
  `undefined` and the check reports the safe-looking answer. The RC18 leg reported "not in FPV"
  while the engine was demonstrably in FPV.
- **`JSON.stringify(<async IIFE>)` stringifies the promise** — `{}`, and it never fails.
- **`Page.navigate` to a hash-only-different URL does not reload.** Bounce through `about:blank`.
- **Eased uniforms must be asserted after the snap** (≥6.2τ), or a correct ease reads as a bug.
- **`504 Outdated Optimize Dep` presents as every island failing to hydrate**, while the page
  itself answers 200 throughout. The diagnostic is `curl` on a dep URL. Moving `node_modules/.vite`
  aside is not enough on its own: bring the server fully down, restart, then warm it with one real
  page load before any browser attaches.

### 2.6 Known limits

- **Imagery is availability-capped**, not refinement-capped, on desktop. Sharpness beyond the
  provider's coverage is not reachable by tuning.
- **Per-tile composite boundaries are a C0 discontinuity.** Every 3D tile composites over its own
  cartographic bbox, so adjacent composites share no border texels: at mip level *k* the two sides
  of a shared edge average disjoint texel sets. No filter removes this; only the level cap bounds
  the amplitude. At the shipped 4-level cap the coarsest texel spans 8 finest texels, about 1.6% of
  a tile.
- **Creation-time levers reach almost nothing mid-session.** Anisotropy and the mip chain are
  stamped when a composite is created, and on desktop the ground cache never turns over — the whole
  Dnipro drape fits inside the cap, and squeezing the cap does not help because the tiles under the
  camera are in the renderer's used set. Flipping the chip mid-session left 2 of 321 composites
  chained; with the chip on at boot, 452 of 452. These levers are delivered by a **reload**.
- **A building is still a rigid box translated by one scalar at one centroid.** On a slope the
  downhill edge hangs and the uphill edge buries by ±(slope × half-diagonal). The bake-side base
  skirt that hides the downhill residual shipped as RC13 on 2026-08-26c (the wall rim lowered 4 m
  below the base, +0 vertices); the uphill burial remains. *(Sentence corrected 2026-09-02n — it
  previously said the skirt was not built.)*
- **Depth encoding is unchanged** and, per §2.1, has no evidence behind changing it.
- **Post-process AA is absent.** There is no FXAA/SMAA/TAA anywhere; MSAA on the composer target is
  the only anti-aliasing.
- **Occlusion culling is out of scope** until the horizon profile has a conservative variant.

---

## Standing rules

- The globe is `client:only`. Never SSR WebGL.
- Design imports write only under `src/components/panels|ui|controls/**` and `src/styles/**` —
  never `src/components/globe/**` or `src/lib/**`.
- Anything touching `heightAt`, seats, or the FPV eye is a `[SEAT]` change and verifies against
  `__globe.u2()` and `__globe.debugSeats()`.
- ULTRA off-state exactness, byte-identical `high`, the ULTRA gate file list, and the brand fence
  are all machine-checked. A change that needs one of them relaxed needs an owner ruling first.
