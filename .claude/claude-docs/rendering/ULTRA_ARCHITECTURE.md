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

> **AMENDED 2026-08-27 (owner defect 1).** The CSM row below still stands *as a rejection of that
> library*, and none of its facts have changed. What changed is that a CASCADE LADDER shipped
> anyway, by a different route — see §13. Read the row as "not `three/examples/jsm/csm`", not as
> "not cascades"; and note that its last sentence ("its job is already done for free") was
> **measured false** and is the defect §13 fixes.

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

---

## 13. THE 2026-08-27 BATCH — the owner's three immersion breakers

Shipped in one session against a verbatim owner report. Gate: **`scripts/verify-ultra-dusk.mjs`
21/21**, alongside an unchanged `verify-ultra.mjs` 28/28 and `verify-rendering-charter.mjs` 85/85.
Decision log: `DECISIONS.md` §Recent **2026-08-27b**. Session log:
`mem:project/wip-2026-08-27-ultra-render-batch`.

### 13.1 Shadow cascades — "shadows are cropped, sliced, hollow and incomplete"

**Measured first.** `__globe.ultraLook()` at the owner's own poses, ULTRA on, before any change:

| pose | `viewFitM` | `boundsM` | covered |
|---|---|---|---|
| Fuji, 5.2 km, 84° tilt | 148,757 m | 18,000 m | **24 %** |
| Fuji, 15 km, 68° tilt | 427,828 m | 18,000 m | **8 %** |
| mountains, 3.5 km, dusk | 100,163 m | 18,000 m | **35 %** |

Everything past the box renders fully lit (three r185 `shadowmap_pars_fragment` returns 1.0 outside
`[0,1]`) with a straight cut where the box ends. That is the "gap" in Mount Fuji's own shadow and
the "only this spot has a shadow" frame. RC4 anticipated it — "full visible-frustum fit stays in
reserve, build only if shots after RC4 still show hard shadow edges inside the frame".

**How it ships without CSM.** Each extra cascade is a plain `DirectionalLight` at `intensity = 0`,
added at BOOT right after `sun`. It contributes no light to any lit material; it only owns a depth
map. The ground receives through `ShadowMaterial` twins, and `getShadowMask()` **multiplies every
directional shadow mask with no cascade dispatch** — §10 lists that as a reason CSM could not work
here, and for NESTED boxes it is exactly the mechanism: a fragment outside a cascade's box gets 1.0
from it, so the product is the UNION and a coarse cascade can only add shadow a finer one agrees
with. No `onBeforeCompile` is touched, so the buildings' 15-uniform injection and the ground's
chained one are untouched, and the ~19 raw `ShaderMaterial`s are unaffected as before.

Three invariants, each machine-checked:
- **Lockstep down, never up.** `WebGLLights.js:295-305,459-465` indexes `directionalShadow[]` by
  position among ALL directional lights and then truncates to the CASTER COUNT — a non-casting
  light in front of a casting one silently drops the caster's shadow. `sun` is always first, so
  cascades-off-while-sun-on is safe and is how a chip flip lands; the reverse is impossible by
  construction.
- **Move only when refreshing.** Cascades run `shadow.autoUpdate = false`; the skip at
  `WebGLShadowMap.js:170` happens BEFORE `updateMatrices`, so a cascade that did not re-render this
  frame keeps a matrix that still matches its map. Refresh triggers: extent changed · terrain epoch
  changed · eye drifted > `cascadeMoveFrac` of the half-extent · key swung > `cascadeRefreshDeg` ·
  `cascadeMaxStaleMs` (the RC21-shaped safety net — a missed trigger costs bounded staleness, never
  a frozen shadow).
- **Centred on the EYE**, not pushed down the look like cascade 0: the box then contains the eye at
  every pitch (strict nesting, no inter-cascade gap is possible) and does not move when the camera
  merely turns, which is what makes a 1.5 s cadence invisible.

**Cost, measured (dev build, 1600×950 @ DPR 2, owner's machine):** mountain 31.2 → **34.2 ms
(+3.0 ms, +9.6 %)**; city 47.0 → **50.3 ms (+3.3 ms, +7 %)**. VRAM **+168 MB** (4096² + 2048², each
an RGBA8 colour attachment plus a D24 depth texture) on top of cascade 0's 536 MB. Rollback ladder
is on `ULTRA.cascades`; `cascades: []` restores the shipped single-box rig exactly.

### 13.2 The dusk light model — "some piss very bright colour"

Four mechanisms, all in the shipped code, all now answered. The split worth remembering: the
**chromaticity** of low sunlight is physics (`lib/globe/duskLight` — Kasten-Young airmass through
per-channel Rayleigh + aerosol optical depth); the **level** is an authored curve, because true
transmittance at 0° is ~1 % of zenith and this renderer has an exposure ramp rather than an
adapting eye.

| Defect | Mechanism | Fix |
|---|---|---|
| the key never died, and *brightened* 35 % through the golden band | `SUN.keyIntensity × (1 + goldenK × keyBrighten)`, no elevation term; `sunExtinctionK` dims only the DISC | `ULTRA.keyExtinctCurve` scales the key AND the disc; `solarChroma` reddens it |
| "opposite sides of terrain lit the same" | `EARTH.dayGradMin` 0.78 floors the slope ramp at every hour | direct/ambient split (`ULTRA.groundAmbient*`), direct dies with `directK` |
| "uniformly illuminating the whole scene" | `ftwAerial` mixed toward a fixed palette stop at up to `hazeMaxK` 0.72 with **no level term** — the far field came out BRIGHTER than the foreground at dusk | `skyLevel` (`ULTRA.skyLevelCurve`) multiplies the in-scatter |
| "whole sky dome has same colour and luminosity" | the dome's horizon haze is a function of elevation above the horizon ONLY | two normalised scattering lobes shared by the dome and the aerial perspective, plus `afterglowCurve` for the local post-sunset glow |

Measured sweep at the mountain pose (ULTRA on):

| band | sun | skyLevel | directK | afterglow | keyLevel | disc |
|---|---|---|---|---|---|---|
| high | 26.8° | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| low | 9.5° | 0.973 | 0.959 | 0.000 | 1.294 | 0.954 |
| horizon | 3.4° | 0.806 | 0.668 | 0.001 | 0.902 | 0.378 |
| set | −0.5° | 0.580 | 0.166 | 0.352 | 0.002 | 0.066 |
| civil | −5.4° | 0.282 | 0.000 | 0.550 | 0.029 | 0.028 |

Two shipped tuning values were RE-ANCHORED, not merely extended, and both are recorded in place:
`ULTRA.hemiCurve` (peaked at 1.15 at 0° — the ambient fill was brighter at sunset than at noon) and
`ULTRA.hemiTintK` (0.6 → 0.22 — a HemisphereLight is azimuth-free, so 0.6 painted the band tint on
every wall in the city at once: the owner's "backs of the building lit with the same ugly tint").

### 13.3 The tile seam — "dark lines/gaps between tiles"

Not the RC25 mip chain (killing it changed nothing) and not anisotropy. It was the quantized-mesh
**skirt**, on BOTH sides of the shadow pipeline, and only visible once S3 let terrain cast:

1. **It cast.** A wall standing on the tile edge occludes the neighbour's surface across a band of
   width ≈ `skirtLength · cos(sun elevation)`, and `skirtLength` defaults to `tile.geometricError`
   — hundreds of metres at the LODs a wide view uses.
2. **It received.** Clipping (1) left a hairline; sweeping the caster's `polygonOffsetUnits`
   2 → 1600 moved it not at all while switching the shadow pass off removed it. The apron's top
   edge is coincident with the neighbour's surface, samples that surface's depth, reads as
   self-shadowed, and the `ShadowMaterial` twin paints its slate over the visible sliver.

Both fixed by drawing the SURFACE CAP ONLY (`geometry.groups[0]`) for the duration of one draw —
`onBeforeShadow`/`onAfterShadow` for the caster, `onBeforeRender`/`onAfterRender` for the twin. The
colour pass never sees a clipped range, so the skirt keeps doing its real job (hiding inter-LOD
cracks). The contract lives in `lib/globe/terrainSkirt` with a unit test, and fails SAFE: an
unrecognised group layout casts and receives exactly as before.

---

## 14. THE TASTE PASS — what the first dusk batch got wrong (2026-08-27c)

§13 shipped, the owner tested it, and four things were still wrong. Every one turned out to be a
term that had been left OUT of the first pass rather than a knob set badly, which is why the first
pass could not be tuned into correctness. Gate: `verify-ultra-dusk` (unchanged, 21/21) plus
`test/components/globe/{sunDisc,duskShadeRatio}.test.ts`.

**The finding that reframes the whole batch (and it is a lesson, not a line):** `keyExtinctCurve`
divides the DIRECT term by five through the dusk band, and §13 scaled nothing else. Directional
contrast is `direct / (direct + flat)`, so dividing the numerator while holding the denominator is
*the definition of flattening*. Measured front-wall:back-wall on a building, in red, on the surface
alone: **1.28 at 3°, 1.21 at 2°, 1.08 at 0°** — the contrast collapses across exactly the band the
extinction curve was added to. **Dimming the key is only half a dusk; the flat terms have to fall
on the same curve.**

### 14.1 The terrain — a ratio of 0.969

Four independently direction-blind terms compounded. At +2° two 30° slopes, one facing the sun and
one facing DIRECTLY AWAY, rendered at **0.859 vs 0.833 — the shadowed mountain at 96.9 % of the lit
one.** In order of size:

| # | Term | Why it was invisible |
|---|---|---|
| 1 | `shade = mix(shade, 1.0, photo)` at `photo3dK` 0.6 | It lives in the TEXTURE half of the track. `photo3dK`'s docblock lists "shade→1" as part of the raw-Esri de-grade — the shading half was bundled with the colour half, and only the colour half is defensible in 3D. It alone took the ratio from 1.112 to 1.031. |
| 2 | the ambient half of §13's own direct/ambient split | A constant × a term that only knows which way is UP. At dusk it was **worse than the `EARTH.dayGradMin` 0.78 ramp it replaced**, because 0.78 was at least reached through `sqrt(sunDot)` on the lit side. |
| 3 | the golden-hour cast | A bell over SOLAR elevation multiplied into every fragment on the day side. The terrain twin of the `hemiTintK` bug §13 fixed for buildings, left in place. |
| 4 | the additive `uFtwAmbDay` floor | No normal term at all, and still at 88 % of its +2° value at 0°. |

The shade lift now rides `directK^3` — exactly 1 at high sun, so the daytime frame the owner likes
is byte-identical, and 0.066 by +2°. The power has to be steep because `mix(x, 1.0, k)` lifts DARK
values more than bright ones: a linear ride still left the two faces at 0.78.

The ambient gained a LEVEL and an AZIMUTH. The azimuth is a **wrap**, `0.5 + 0.5·dot(n, sun)`, and
the first attempt at it is worth recording: it reused `ftwAirLevel`, the air-light's own lobe pair —
and the JS twin measured the result at 0.50 vs 0.44, no contrast at all. That lobe is the sky's
RADIANCE ALONG ONE RAY; a surface integrates the whole hemisphere around its normal, and the
cosine-weighted integral of a one-sided sky *is* the wrap. Its strength is `(1 − directK)^0.5`,
which is the physically right shape and free: the sky is isotropic at noon (so noon is provably
untouched) and most one-sided as the sun reaches the horizon.

**Measured after:** ratio **0.685 at +2°**, 0.653 at 0°, and monotone from 10° down. Absolute lit
shade falls 0.99 → 0.49 → 0.31 over the same band, so the ratio was not bought by lifting the
shadow side. Pinned by `duskShadeRatio.test.ts`, which is also the file that caught a sign error in
its own geometry and then refuted the first azimuth term.

### 14.2 The city — a constant floor 3.6× the sun

`BUILDINGS.emissiveIntensity` 0.1 on `tokens.land` is a CONSTANT (0.0087, 0.0148, 0.0107) added
straight to `outgoingLight` with no albedo, no normal and no sun term
(`meshphysical.glsl.js:168,198`). **At a 3° sun a wall pointed straight into the sun receives about
3.6× more light from its own emissive than from the sun**, and it is ~100× the entire
HemisphereLight contribution on the same wall.

That last number also settles a question §13 raised: the hemisphere is **0.18 % of a facade pixel**,
so re-anchoring `hemiTintK` could not have fixed the owner's picture, and tilting the hemisphere
toward the sun — an idea that looked elegant — would have moved nothing. It was dropped for that
reason and no other.

Shipped instead: `buildingEmisCurve` and `buildingEdgeCurve`, both **troughs** (the emissive floor
IS the night look, so it has to come back after twilight), applied through ONE authority per module
so they cannot fight the ghost-mode and FPV-solidity writers that already own edge opacity. Plus
`moonLight` finally gets a moon-ELEVATION gate: it had none, so a below-horizon moon still keyed
every wall whose azimuth faced it — 82 % of the sun key at 0° sun, and 33× stronger in blue. The
ground had gated its moon terms on elevation since S7; the buildings never did, and that asymmetry
is what marks it an oversight rather than a decision.

### 14.3 The sun disc — additive has no dim-but-solid state

*"the sun disk becomes too white and transparent."* The impostor was `AdditiveBlending`, so its
result is literally `disc + sky`: **dimming it and dissolving it into the sky are the same
operation.** §13 scaled the additive level down and got exactly what addition promises — a flat pale
plate the colour of the sky behind it (measured: core radiance 5.00 at 14° → 1.11 at 1.6°, spread
uniformly by the flat-topped `1 − smoothstep(0.9, 1.0, r)` mask).

It now carries a PREMULTIPLIED arm as well — the moon's `ONE / ONE_MINUS_SRC_ALPHA` triple,
verbatim, but on a different axis: the moon switches day↔night, the sun switches
bright-and-additive ↔ dim-and-solid. Four things this required, three of which are traps:

- **`uSolid` is EXACTLY 0 above `discSolidHiDeg` 6°**, so `DST' = rgb + DST·1` and the premultiplied
  path degenerates to the addition it replaces. That makes it a provable superset at the blend
  equation rather than a look change at noon.
- **ONE coverage scalar.** Under addition every mask could safely be applied to colour alone,
  because colour 0 already means invisible. Under premultiplied "over" a fragment with rgb 0 and
  a 1 is BLACK — so the disc mask, the carved lunar silhouette and the horizon fade all have to
  reach ALPHA too, or the fix punches a black bite at the eclipse silhouette and at the setting
  limb. `verify-eclipse` 37/0 is the proof it does not.
- **The halo contributes to rgb only.** It is an `exp()` with no compact support (still ~3e-3 at 5
  disc radii, which is why the edge window exists); an alpha built from total brightness would make
  ~14 solar diameters of sky partly opaque.
- **The chroma is FLOORED.** Raw `solarChroma` at 0° is (1.000, 0.212, 0.005): multiplied into
  `sunCore` that is crimson with a dead blue channel, not the orange he asked for.

`discLevelCurve` replaces the `sunExtinctionK × keyExtinctCurve` product — that product started at
10° (not "earlier") and its `ultraExtinctFloor` left the core at 0.028, about half the brightness of
the sky behind it. The new anchors put the `BLOOM.threshold` 0.9 crossing at ~5.5°, deliberately
ABOVE the band the owner watches, so losing bloom reads as a shrinking flare rather than a pop.
**Measured after:** level 0.771 → 0.115 across 14° → 1.6°, `solid` 0 → 0.95, `haloK` 0.60 → 0.013,
tint white → `#ffd6bb`.

### 14.4 The afterglow — a lerp target dimmer than the term it replaced

The directional dome arm was blended in by `hazeNow × domeTintK`, **capped at 0.3825**. Worse, the
legacy omnidirectional band it was lerping against rides `max(dayK, hGold)`, and
`GOLDEN.fadeInLo` = sin(−12.1°) holds `hGold` at 0.977 at −2°. Since 0.75 < 0.977, **`mix()`
SUBTRACTED**: ULTRA could only ever make the dusk sun-side horizon DARKER than baseline. It first
exceeds the legacy term at −9.45°, where the weight has fallen to 0.154 and the band is invisible.

Fixed three ways: the directional arm gets its own weight (`domeDirK`), so `domeTintK` goes back to
being what its docblock says — the TINT coupling, not a master gain on a light source; the afterglow
becomes an ADDITIVE band with `afterglowTauSin` 0.30 (~17.5°) instead of borrowing the daytime haze
crest's ~4.3° ribbon; and it is passed into `ftwAerial` as well, because the dome was painting a glow
the terrain under it knew nothing about (0.49 against a far-field level of 0.22 at −6° — the same
terrain/sky seam RC24 exists to close).

### 14.5 Open, and honest about it

- **The "sun set behind a MOUNTAIN" half of the owner's afterglow ask is NOT shipped.** A
  terrain-horizon sampler exists and is O(1) (`lib/geo/horizonProfile`, 120 azimuth bins), but it is
  built only for a photo apex or an FPV eye, time-sliced over 40+ frames and coverage-gated —
  nothing cheap exists for a free orbit. Backlog **T68**.
- `A-BLD-4` (the edge-stroke trough) is the one finding whose adversarial verification **errored
  out** rather than returning a verdict. It shipped on the strength of its own arithmetic and a
  single-authority refactor; treat it as the least-verified line in this batch.
- The audit's `A5`/`A-BLD-3` — that the aerial perspective replaces up to 72 % of a far surface and
  so erases contrast at distance regardless of what the surface does — is real, measured, and NOT
  addressed here. Backlog **T69**.
