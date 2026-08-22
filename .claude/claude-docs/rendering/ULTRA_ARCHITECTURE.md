# ULTRA — as-built architecture

**Status:** SHIPPED 2026-08-22j (T44 + T45, both backlog rows CLOSED).
**This is the durable reference.** `ULTRA_PLAN.md` is the CHARTER that produced it — read that for
*why* each lever was chosen and ranked; read this for *how it is wired* and what may not be broken.
Decision log: `DECISIONS.md` §Recent **2026-08-22j**. Session log:
`mem:project/wip-2026-08-22-ultra-track`. Tunable contract: `conventions/globe-tuning.md` §ULTRA.

---

## 1. What ULTRA is

One desktop-only, explicit-opt-in, **off-by-default** chip (`ULT`, in `CameraTiltPanel`) that turns
on **nine rendering levers** across two halves:

| Half | Levers |
|---|---|
| **TEXTURE** (T44) | §1a photographic de-grade in 3D · §1b anisotropic filtering on the ground drape |
| **LIGHT** (T45) | S9 twilight-band day curve · S11 exposure ramp · S4 aerial perspective · S10 ephemeris-tracked hemisphere · S2 soft shadows · S5 8192² shadow map + metric bias · S3 terrain casts shadows |

Plus the pre-existing **TILE** half (`QUALITY.ultraDesktop`, shipped 2026-08-22i): buildings SSE,
street-name and vector budgets, both LRU caps, and the governor tier pin.

**The owner's ruling that defines its cost posture (2026-08-22j):** *"even if it is sub 15FPS but
graphics fidelity improves and gives nicer richer picture — worth it, user enables it in it's own
volition anyways."* Frame time is **measured and reported, never a veto**. This supersedes
`ULTRA_PLAN.md` §2's "a 12 fps ULTRA is a broken feature" and is what made the construction-time
shadow levers shippable at all. Measured at ship (dev build, 1600×950 @ DPR 2, owner's machine):
city OFF 30.7 ms → **ON 36.1 ms (+18%, 33 → 28 fps)**; Everest ON 29.3 ms.

---

## 2. The gate — one rule, two readers

`ftw:view-prefs:v1` is **one localStorage blob shared by both shells on the same origin**,
`useCameraStore` is one store, and `/m` mounts the **same** `GlobeCanvas` + `StylizedTiles` modules.
A user who enables the chip on desktop genuinely has `ultraQuality: true` in storage when they next
open `/m` in that browser. **Hiding the UI isolates nothing.** So the fence lives on the *read*.

```
                         ultraQuality (persisted, shared by both shells)
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        │                                                               │
  RUNTIME reader                                              BOOT reader
  StylizedTiles.ts                                            lib/globe/ultraBoot.ts
  hqAllowed = !isMobileShell && !coarsePointerShell           ultraShellAllowed() && pref
        │                                                               │
  ultraOn  ──► every edge- and frame-applied lever            ultraBootOn() ──► GlobeCanvas
                                                                        shadowMap.enabled + mapSize
```

Both gate terms are load-bearing and neither alone is enough:
- `!isMobileShell` excludes the `/m` **route** — but `index.astro` deliberately keeps tablets and
  touch laptops on desktop, and `/m`'s DESKTOP chip sends a phone to `/?d=1` permanently, so a phone
  **can** be running the desktop shell.
- `!coarsePointerShell` excludes that **hardware** — and it tests the PRIMARY pointer, so a trackpad
  laptop with a touchscreen stays on the fine-pointer path.

**Why two readers exist.** TWO shadow levers are construction-time: three latches a shadow map's
depth target on first render and ignores a later `mapSize` write, and flipping
`renderer.shadowMap.enabled` recompiles every material in the scene. Those must be decided at
RENDERER CONSTRUCTION — inside `GlobeCanvas`'s own setup effect, before the tiles orchestrator (and
therefore the entire store-driven edge path) has even been imported for this page: the renderer is
built near the top of that effect, the `import("./StylizedTiles")` is dynamic and lands much later.
`GlobeCanvas` deliberately imports **no store at all**; it reads the persisted blob the store is
itself seeded from, and reads it as a **snapshot, not a subscription** — which is exactly why a
mid-session flip moves every edge-applied lever but leaves the shadow rig where the page booted.
`ULTRA_PLAN.md` §2 sanctions exactly two paths and forbids a third: **edge-applied through
`QUALITY.ultraDesktop`, or read from the pref at BOOT.**

**Fenced by** `test/components/globe/fences.test.ts` — five owner files may name the flag at all;
every engine read must sit on a line naming `hqAllowed`; every boot read must name
`ultraShellAllowed`; and the two gate expressions must test the same two terms.

**The engine rule has exactly ONE exemption, and the fence asserts that it is OCCUPIED** (a dead
exemption is a fence that has quietly stopped fencing): reads inside the `__globe.ultra()` DEV-probe
window print the RAW pref on purpose — that is what lets the `/m` proof below show `pref:true`
sitting next to `on:false`. The exemption is keyed on a 12-line context window containing
`ultra: () => ({`, so what passes the fence is *any* read inside that window, not the one probe line
by identity. Note `__globe.ultra()` is the GATE probe; `__globe.ultraLook()` (§11) is a separate
seam and reads no pref.

**Browser-proven under the real leak condition:** with `ultraQuality: true` written into the shared
blob, `/m` reports `{allowed:false, coarsePointer:true, pref:true, on:false}` with every lever at
baseline and `shadowMapPx 1024`.

---

## 3. Module map

| Module | Role | New? |
|---|---|---|
| `src/lib/globe/lightBands.ts` | **Pure** band-curve math + **the emitted GLSL twin** + the shared easing coefficient. three-free, DOM-free. | NEW |
| `src/lib/globe/ultraBoot.ts` | The BOOT gate (`ultraShellAllowed` / `ultraBootOn`). | NEW |
| `src/components/globe/tuning.ts` → `ULTRA` | Every number. Curves are anchor tables in sun elevation. | NEW block |
| `src/components/globe/scene/glsl.ts` → `FTW_AERIAL_GLSL` | **ONE** aerial-perspective function, compiled into ground AND buildings. | NEW export |
| `src/components/globe/scene/imageryGround.ts` | §1a `uFtwPhoto3d` · S9 `dayK` mix · S4 call · §1b anisotropy stamp · S3 terrain-cast wiring · owns the haze GATES and all the GROUND-side easing (`uFtwPhoto3d` / `uFtwUltraLight` / `uFtwHaze`; `hazeCol` is copied, not eased). **Exposure (S11) and the hemisphere (S10) ease in `StylizedTiles.stepUltraLook`, not here.** | extended |
| `src/components/globe/scene/buildingMaterial.ts` | S4 on the fill **and** the edge material (both need it, or the city floats as a wireframe in fog). | extended |
| `src/components/globe/scene/buildings.ts` / `enrichedBuildings.ts` | `setUltraHaze` — mirrors of each other. | extended |
| `src/components/globe/StylizedTiles.ts` | `stepUltraLook` (the one sample per frame) · `stepUltraGate` (the edge) · shadow-rig profile in `stepKeyLightAndShadow` · the `__globe.ultraLook()` DEV seam. | extended |
| `src/components/globe/GlobeCanvas.tsx` | The **only** boot read: `shadowMap.enabled` + `mapSize`. Hoists the HemisphereLight into a variable so S10 can reach it. | extended |
| `scripts/verify-ultra.mjs` | The timelapse harness — 28 checks, city + Everest, off/on/off. | NEW |
| `test/lib/globe/lightBands.test.ts` | 23 tests incl. the GLSL/JS twin equivalence. | NEW |

---

## 4. Per-frame data flow

```
stepUltraGate()          ← the EDGE only. Fires on a chip flip; applies anisotropy, shadow
  (before the ground)      radius/normalBias, re-runs applyQualityTier, un-settles the look.

stepGroundUpdate()       ← ground.update() eases uFtwPhoto3d / uFtwUltraLight / uFtwHaze toward
                           the targets set LAST frame, and applies the three haze gates
                           (altitude ramp · flat-chart cutout · dark-drape scale).

stepEphemerisResample()  ← sunDirW / moonDirW refreshed (1 Hz cadence).

stepUltraLook()          ← ONE ultraLightAt(ULTRA, sunDirW·focusUp) sample per frame:
                             ├─ tint ramp → _hazeCol (4 palette stops, ≤2 live at a time)
                             ├─ ground.setUltraTargets({photo3d, light, haze, hazeCol})
                             ├─ read the ground's LIVE uFtwHaze back out
                             │    └─ buildings.setUltraHaze(sameNumber) + enriched.setUltraHaze(…)
                             ├─ renderer.toneMappingExposure ← eased (S11)
                             └─ hemiLight position/intensity/colour ← eased (S10)

stepKeyLightAndShadow()  ← shadow rig profile: lightDist, bounds, near/far, DERIVED bias (S5),
                           then ground.setTerrainCast(…) (S3).
```

**Why `stepUltraLook` runs AFTER the ground.** The ground owns the haze gates and its own easing.
Reading its live `uFtwHaze` back out and handing *that* to the buildings makes "one atmosphere over
the city and the ground it stands on" true **by construction** rather than by two parallel
calculations agreeing. Cost: a one-frame lag on targets, against easings of 0.4–1 s.

---

## 5. The off-state contract

> **With the chip off, no ULTRA value can change a rendered pixel, and every lever reads EXACTLY
> its pre-track value — not approximately.**

Stated as *inert*, not *absent*, on purpose: ULTRA-derived GLSL constants are compiled into every
ground and building shader unconditionally, `ULTRA.terrainDepthOffset` is assigned at attach, and
the ease/gate constants are read every frame by `ground.update()`. All provably inert — which is a
checkable claim, where "never read" would simply be false.

This is the standing rule for the whole track and the only claim that protects every user who never
touches it. It is enforced three ways:

1. **Identity arithmetic.** `mix(legacy, ultra, 0.0)` is exactly `legacy`; `max(x, 0.0)` is exactly
   `x`; `ftwAerial` early-returns at `hazeK <= 0.0`; `ultraTileLevers` returns its input **by
   identity**. There is no "close enough" path.
2. **Snap, don't asymptote.** Every eased uniform snaps to 0 under an epsilon, and `stepUltraLook`
   early-returns once settled — an exponential low-pass never *reaches* its target, and
   `mix(a, b, 3e-9)` is not `a`. The unwind takes ~9 s by design (a ~950 ms τ from a night exposure
   of 1.46 down to 1e-4); visually it is done in ~3 s. **A 5 s wait in the verify script once
   measured 1.0023 and read as a bug that wasn't one.**
3. **Browser proof, not inspection.** `verify-ultra.mjs` reads the live engine through
   `__globe.ultraLook()` and asserts literal zeros: `photo3d 0 · dayMix 0 · haze 0 · exposure 1 ·
   hemiPos [0,1,0] · radius 2 · normalBias 0.75 · terrain casting 0 · composite anisotropy 1`.

**Two documented exceptions — both are levers that cannot be applied RETROACTIVELY on a live flip:**

1. **The construction-time shadow levers.** `__globeQuality.ultra !== .ultraBoot` is exactly the
   "toggled this session, reload for the full shadow rig" state, and it is reported, not hidden.
2. **§1b anisotropy, in BOTH directions.** The stamp lands at texture CREATION and nothing walks
   live composites on either edge, so after an ON→OFF flip every drape created while the chip was
   on keeps `anisotropy = 16` until it is evicted and re-created. That is the deliberate price of
   never paying a full re-upload per composite (§9): the exactness claim above is about the
   ENGINE's state, and a cached texture's filter is not a lever the engine is reading.

---

## 6. S9 — the twilight-band light model

The scene's entire day/night response used to hang off one line: a `smoothstep` over a **dot
product**, spanning ~9.2° of solar elevation with no physical meaning at either edge. That is the
owner's *"naive and linear"*.

ULTRA replaces it with anchor tables in **sun elevation (degrees)** whose knots are the thresholds
`lib/ephemeris/twilight.ts` already gives the planner and the scrubber bands — golden +6/−4, civil
−6, nautical −12, astronomical −18. **One vocabulary for "what light is it" across the planner, the
scrubber and the renderer**, and a transition spanning **36° of solar elevation instead of 9.2°**, with
structure instead of one blend. (Stated in DEGREES on purpose — the wall-clock duration is a
function of latitude and date, so any single "X hours" figure is wrong somewhere. At the Dnipro
verify pose, 48.5°N on 2026-08-21, it works out at ≈4.4 h against ≈62 min.)

- **Evaluated in sin(elevation)**, which is what both the shader (`dot(up, sunDir)`) and the
  orchestrator (`sunDirW.dot(_focusUp)`) already hold — no `asin` per fragment. Anchors are authored
  in degrees (the physical vocabulary) and hit **exactly**; only the shape between knots differs.
- **Per-fragment, not per-sample.** `sunUpDot` *is* sin(solar elevation) at that fragment, so the
  curve still draws a true terminator from orbit. It did not need feeding a single almanac sample.
- **The GLSL is EMITTED from the same table** by `bandCurveGlsl`, as the identical fold
  (`v = mix(v, hi, smoothstep(lo, hi, s))` from the lowest anchor up). A test parses the emitted
  GLSL back into an evaluator and compares against `bandCurve` across the domain to float32
  precision — so the two languages cannot drift by review error.
- **Range-bounded by construction** — each step is a convex blend of the running value and the next
  anchor, so a curve can never overshoot its own endpoints. That is what keeps `dayK` inside [0,1]
  with no output clamp. **Monotonicity is an AUTHORING property, not a structural one:** the
  evaluator preserves it, it does not create it; `hemiCurve` and `hazeCurve` deliberately PEAK
  mid-table (dusk is the brightest skylight and the haziest air), so the unit test asserts global
  monotonicity for `dayCurve` ALONE. A non-monotone `dayCurve` edit would still evaluate — and would
  read as a timelapse brightening while the sun set.

**Coherence.** The ground's `dayK` staying at 0.30 through civil twilight would leave the buildings
dark, because their light comes from the sun key and a −6° sun contributes almost nothing. The
answer is physical, not a fudge: at civil twilight a city is lit by the **sky**, so `hemiCurve` holds
the hemisphere near full and `hemiTintK` warms its sky half toward the band tint. Ground and
buildings move together because the same sample drives both.

---

## 7. Sanctioned lever paths (there is no third)

Three PATHS — but the edge path lands at TWO sites, and the difference is load-bearing:

| Path | Applies | Levers |
|---|---|---|
| **Edge-applied, immediate** (`stepUltraGate`) | on the chip flip, at once — including inside FPV | anisotropy · `shadow.radius` · `shadow.normalBias` · the tile profile (`applyQualityTier` → `ultraTileLevers`: buildings SSE, street-name + vector budgets, both LRU caps) |
| **Edge-applied, DEFERRED** (`GlobeCanvas` tick) | on the chip flip, but PARKED while FPV owns the camera | the governor **tier pin** — polled off `TilesHandle.ultraPin()`, sets `pendingTier = "high"`; the OFF edge additionally re-seats with `governor.force(deviceTier)`, because a suppressed governor can sit at its floor and never fire `changed` again. Lands on the first non-FPV frame. |
| **Frame-applied** (`stepUltraLook`) | every frame while on | photo3d · dayK mix · haze + tint · exposure · hemisphere |
| **Frame-applied** (`stepKeyLightAndShadow`) | every frame while on | light distance · ortho bounds · near/far · the DERIVED metric bias · terrain cast |
| **Boot-read** (`ultraBootOn`) | once, at renderer construction | `shadowMap.enabled` · `shadow.mapSize` |

**Why the edge path splits.** The tile levers are cheap and land immediately, but a tier change is a
composer-target realloc plus three LRU re-caps — the owner-confirmed U2 "the whole city re-rendered"
bug if it fires mid-viewfinder. So the pin rides the existing `pendingTier` deferral instead.

---

## 8. Five three.js facts this design encodes

All source-verified against `node_modules/three` **0.185.0**. Each one changed the plan.

1. **`PCFSoftShadowMap` is DEAD CODE.** `WebGLShadowMap.js:99-104` intercepts it, warns
   "deprecated", and rewrites `this.type = PCFShadowMap`; `WebGLProgram.js:345-352` has no
   `SHADOWMAP_TYPE_PCF_SOFT` entry and no shader branch exists. **`ULTRA_PLAN.md` S2 as written
   would have shipped a no-op.** The r185 soft-shadow lever is **`shadow.radius`** on a 5-tap
   **Vogel disk rotated per pixel by interleaved gradient noise**
   (`shadowmap_pars_fragment.glsl.js:115-149`) — each tap a free 2×2 hardware PCF ⇒ ~20 effective
   taps for 5 fetches. It is a **live uniform** (`WebGLLights.js:290-292`), so S2 became both
   cheaper *and* edge-applied; and because the disk is per-pixel rotated, a large radius degrades to
   **noise, not banding**.
2. **`shadow.bias`'s unit is a FRACTION of the shadow camera's near→far range**, not a length. It is
   added to `shadowCoord.z` after the perspective divide, and an ortho shadow matrix maps to [0,1]
   linearly in view depth (`LightShadow.js:227-232`). **And the range MOVES.** The rig is BUILT at 7,000 m
   (`lightDistM ± depthMarginM`), but the altitude-adaptive block then runs it at `7,000 + 2b` with
   b = 1.6–5 km — i.e. **10.2–16.5 km whenever it is actually casting** — so the shipped −2e-4 is
   −1.4 m only at construction and **−2.0 to −3.3 m** thereafter. ULTRA runs `60,000 + 2b` with b up
   to 18 km, i.e. **63–96 km** (browser-measured: 63.2 km at street level, 85.3 km at Everest),
   where that same constant would be **−12.6 to −19.2 m** and detach every shadow from its caster. ULTRA authors `shadowBiasM` in **metres** and derives
   `bias = −shadowBiasM / (far − near)` on every rig resize. **Changing `depthMarginM` silently
   rescales any raw bias constant** — that coupling is why this must never go back to a literal.
3. **Terrain casting fails SILENTLY without `shadowSide`.** `getDepthMaterial` sets
   `side = material.shadowSide ?? invert[material.side]`, where the map flips FrontSide → BackSide.
   The terrain tiles are single-sided sheets, so the default draws their **back** faces, culls
   everything, and the terrain casts **nothing** — no error, no warning. `shadowSide = FrontSide` is
   what makes the feature exist. (The verify probe counts `frontSideShadow` off the **live scene
   graph** for exactly this reason: our own flag would have passed.)
4. **`shadow.mapSize` is LATCHED.** three reallocates the depth target only when `shadow.map` is
   null or the *type* changed, so a runtime `mapSize.set()` is a **no-op** — hence the boot read.
   three also silently clamps `mapSize` **down** past `maxTextureSize`, so the clamp is applied at
   the call site or the tuning constant and the live rig disagree.
5. **A directional shadow target costs 2× a depth-only reading.** Default `RenderTarget` options
   give it an **RGBA8 colour attachment** — written by `MeshDepthMaterial`, sampled by nothing (the
   shader reads the depth texture) — plus a D24 depth texture. **4096² ≈ 128 MiB; 8192² ≈ 512 MiB.**
   `SHADOWS.mapSize`'s old "~67 MB" comment was wrong by 2× and is corrected in place.

---

## 9. §1b — how anisotropy reaches the drape

`3d-tiles-renderer` exposes **no hook** for the composite textures and does not export the class that
builds them. The stamp therefore wraps **`TiledRegionImageSource.prototype.fetchItem`** — the unique
choke point: **both** creation paths return through it (the compose `CanvasTexture` and the
single-tile `.clone()` fast path), and it is the only producer of the region `DataCache` entries the
shader ultimately samples. It runs exactly once per composite (cache-miss only) and **before first
bind**.

- **Prototype, not instance** — `setOverlayResolution` deletes both overlays and builds fresh ones;
  a prototype patch survives that, and one patch covers Esri *and* CARTO.
- **Module-scoped wanted value**, not an attach closure — a dispose + re-attach must not leave the
  live patch reading a dead closure's frozen value.
- **Lazy** — nothing is patched until the chip asks for more than one tap.
- **Stamped at CREATION only.** `anisotropy` is part of three's GL texture cache key, so re-stamping
  a live texture forces a full re-upload per composite. Documented consequence: **fly a little for
  the full effect.** OFF restores the library default 1 — the identical cache key.
- **The value must be deterministic.** Clones share their `.source` and three keys GL textures by
  (source, cacheKey); a varying anisotropy would fragment that sharing and *multiply* GPU memory.
- Setting one field is sufficient: `minFilter` is already `LinearMipmapLinearFilter`, which is the
  gate three requires before it will issue the anisotropy `texParameterf`.

**Mip chains deliberately NOT built** (the other half of §1b). Each composite is an independent
ClampToEdge canvas cleared **transparent**; a chain box-filters that border inward and clamps at
coarse levels into a visible tile-seam grid. That needs hand-built capped levels and a browser
judgement, not a flag.

---

## 10. Rejected, with reasons — do not re-attempt without new information

| Technique | Why not |
|---|---|
| **CSM** (`three/examples/jsm/csm/`) | `setupMaterial()` **ASSIGNS** `onBeforeCompile`, clobbering the buildings' **15**-uniform fill injection (S4 took it from 12 to 15 — this very track) and the ground's explicitly-CHAINED one; the edge material carries a further 5-uniform injection, though as a `LineBasicMaterial` it would never be handed to `setupMaterial`. `ShadowMaterial` (the ground twins) resolves through `getShadowMask()`, which **multiplies all cascades with no cascade dispatch**. It creates 3 extra DirectionalLights ⇒ full scene recompile + 3 depth passes. Zero reach into the ~19 raw ShaderMaterials. **And its job is already done for free:** the shadow ortho rides camera altitude, so street level clamps to 1.6 km (0.39 m/texel at 8192²) while a mountain view spends the same texels on 11 km of relief — an altitude cascade. |
| **PCSS** | **Not shipped in the npm package at all** (`files` ships `examples/jsm` only; the `webgl_shadowmap_pcss` demo is not installed). A hand port needs a RAW depth read for its blocker search, but the PCF sampler is a `sampler2DShadow` with hardware compare — so it means nulling `compareFunction` or dropping to BASIC and losing hardware PCF. |
| **VSM** | `WebGLShadowMap.js:515` makes every `receiveShadow` mesh an implicit caster — i.e. **all the ground twins**. 768 MiB at 8192². |
| **Real-time GI** | Owner-accepted rejection (2026-08-22i), conditional on S4 + S9–S11 delivering the transition. The timelapse says the condition was met. Re-open only with irradiance probes over the STATIC base earth — a streaming tileset cannot hold baked probes. |

---

## 11. Verification

- **`scripts/verify-ultra.mjs` — 28 checks, ALL PASS.** Structure: **A** off-state exactness →
  **B** live flip, every lever + the `__overlayRebuilds` storm guard + a reload for the 8k map →
  the **city timelapse** with a per-band trace → **C** Everest off/on (terrain casts) →
  **D** off again, asserting the unwind lands **exactly**.
- **The acceptance criterion is a TIMELAPSE, never a frame** (owner). Shots:
  `verify-shots/ultra-{off,on}-city-{day,golden,sunset,civil,nautical,night}` and
  `ultra-{off,on}-everest-{day,lowsun,golden}`.
- **Measured band trace at ship:**

  | band | exposure | haze | haze tint |
  |---|---|---|---|
  | day | 1.000 | 0.500 | `#d8e6f2` |
  | golden | 1.109 | 0.819 | `#fdba70` |
  | sunset | 1.267 | 0.598 | `#4c93d4` |
  | civil | 1.382 | 0.297 | `#366d9f` |
  | nautical | 1.436 | 0.172 | `#0d1a25` |
  | night | 1.459 | 0.082 | `#0c1822` |

- **DEV seam `__globe.ultraLook()`** — the one probe that makes this track verifiable at all: the
  lights live in `GlobeCanvas`'s closure, the shadow rig is mutated inside three, and the ground's
  ULTRA uniforms sit behind an attach closure. It reports terrain casting and anisotropy off the
  **live scene graph / live textures**, never off our own flags.

---

## 12. Open tails (owner taste, not defects)

| Item | Knob |
|---|---|
| The ground stays notably bright at civil twilight (physically intended — a real civil twilight is navigable) — **judge this first** | `ULTRA.dayCurve` civil anchor `0.30` |
| Far-field haze strength | `ULTRA.hazeMaxK` `0.72` |
| How photographic the 3D ground goes | `ULTRA.photo3dK` `0.6` |
| Warmth of the dusk skylight on buildings | `ULTRA.hemiTintK` `0.6` |
| **The sky DOME was not touched**, so at golden hour a warm ground haze meets the old blue-grey dome above the horizon — a mild seam. Fixing it means reaching into `scene/atmosphere.ts`, outside this slice. | — |
| Capped mip chain (§9) | — |
| VRAM rollback if 512 MiB proves too much | `ULTRA.shadowMapSize` `8192` |
