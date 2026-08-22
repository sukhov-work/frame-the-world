# WIP 2026-08-22j — THE ULTRA FIDELITY TRACK (T44 textures + T45 light/shadows) — SHIPPED

Owner order: `ULTRA_PLAN.md` (authored 2026-08-22i). Entry brief: `NEXT_SESSION_PROMPT.md`.
Gates at ship: **vitest 1,330/1,330 (111 files)** · `astro check` 0 err / 5 hints · `npx knip`
exit-0 · NEW `scripts/verify-ultra.mjs` **28/28 ALL PASS** (shots `ultra-{off,on}-{city,everest}-*`).

## THE RULING THAT UNBLOCKED THE WHOLE TRACK (owner 2026-08-22j)

> *"regarding low fps ceiling in manual ULTRA mode, even if it is sub 15FPS but graphics fidelity
> improves and gives nicer richer picture — worth it, user enables it in it's own volition anyways."*

This **supersedes `ULTRA_PLAN.md` §2's "a 12 fps ULTRA is a broken feature"**. It is what makes the
construction-time shadow levers shippable at all — an 8192² map (~512 MiB) and terrain casting were
previously ruled out as too expensive to justify. **Frame time is now MEASURED and REPORTED, never a
veto.** Measured on the owner's box, dev build, 1600×950 @ DPR 2: city OFF 30.7 ms → city ON 36.1 ms
(33 → 28 fps, **+18% frame time**), Everest ON 29.3 ms. Far cheaper than feared.

## WHAT SHIPPED — one chip (`ULT`), one gate, nine levers

Owner's open question in the plan ("re-instate an HQ chip, or fold both halves under ULT?") was
resolved as **fold under `ULT`** — the owner's own words treat it as one mode ("manual ULTRA mode").

| # | Lever | Where |
|---|---|---|
| §1a | photographic de-grade in 3D on its OWN uniform `uFtwPhoto3d` | `imageryGround.ts` |
| §1b | **anisotropy 16** on the drape composites | `imageryGround.ts` |
| S9 | day factor from a **twilight-band curve**, replacing the termBand smoothstep | `lightBands.ts` + `imageryGround.ts` |
| S11 | `toneMappingExposure` ramp over sun elevation | `StylizedTiles.stepUltraLook` |
| S4 | **aerial perspective** on ground + buildings + edges | `glsl.FTW_AERIAL_GLSL` |
| S10 | hemisphere on **LOCAL UP** + ephemeris tint/intensity | `StylizedTiles.stepUltraLook` |
| S2 | soft shadows via `shadow.radius` 2→4 | `stepUltraGate` |
| S5 | 8192² map (boot) + metric bias + 0.45 normalBias | `GlobeCanvas` + `stepKeyLightAndShadow` |
| S3 | **terrain casts shadows** | `imageryGround.applyTerrainCast` |

New files: `src/lib/globe/lightBands.ts` (pure) · `src/lib/globe/ultraBoot.ts` (boot gate) ·
`test/lib/globe/lightBands.test.ts` (23 tests; the suite's +25 = these plus 2 new fence rules) · `scripts/verify-ultra.mjs` (28 checks).
New tunables: `tuning.ULTRA` (a whole block). New DEV seam: `__globe.ultraLook()`.

## THE FIVE THINGS A FUTURE SESSION MUST NOT RELEARN

1. **`PCFSoftShadowMap` IS DEAD CODE in three 0.185.** `WebGLShadowMap.js:99-104` intercepts it,
   warns "deprecated", and rewrites `this.type = PCFShadowMap`; there is no
   `SHADOWMAP_TYPE_PCF_SOFT` define and no shader branch. **`ULTRA_PLAN` §2's S2 as written would
   have shipped a no-op.** What replaced it: a 5-tap **Vogel disk rotated per pixel by interleaved
   gradient noise** (`shadowmap_pars_fragment.glsl.js:115-149`), each tap a free 2×2 hardware PCF ⇒
   ~20 effective taps for 5 fetches, where `radius` scales the disk in texels. It is a **LIVE
   uniform** — so the soft-shadow lever is edge-applied, not construction-time, and a big radius
   degrades to NOISE rather than banding.
2. **`shadow.bias`'s unit is a FRACTION of the shadow camera's near→far range**, not a length. It is
   added to `shadowCoord.z` after the divide and an ortho shadow matrix maps to [0,1] linearly in
   view depth. The base rig's −2e-4 over 7,000 m is **−1.4 m**. ULTRA widens the range to ~96 km for
   terrain casting, where the same constant would be **−19 m** and detach every shadow from its
   caster. The rig now derives `bias = −ULTRA.shadowBiasM / (far − near)` on every resize; the
   tunable is in METRES. **Changing `depthMarginM` silently rescales the shipped bias** — that
   coupling is why this must never go back to a raw constant.
3. **Terrain casting fails SILENTLY without `shadowSide`.** `getDepthMaterial` sets
   `side = material.shadowSide ?? shadowSide[material.side]` where the map inverts FrontSide →
   BackSide. Terrain tiles are single-sided sheets, so the default draws their BACK faces, culls
   everything, and the terrain casts **nothing** — no error, no warning. `shadowSide = FrontSide`
   is what makes the feature exist. (The verify script counts `frontSideShadow` off the live scene
   graph for exactly this reason — our own flag would have passed.)
4. **`mapSize` is LATCHED.** three reallocates the depth target only when `shadow.map === null` or
   the TYPE changed, so a runtime `mapSize.set()` is a **no-op**. Hence the boot-read
   (`lib/globe/ultraBoot.ts`). Also: three silently mutates `mapSize` DOWN past `maxTextureSize`,
   so clamp at the call site or tuning and the live rig disagree.
5. **A directional shadow target costs 2× what a depth-only reading suggests** — an RGBA8 colour
   attachment (written by MeshDepthMaterial, read by nothing) plus D24. 4096² ≈ 128 MiB, **8192² ≈
   512 MiB**. `tuning.SHADOWS.mapSize`'s "~67 MB" comment was wrong by 2× and is corrected.

## REJECTED, WITH REASONS (do not re-attempt without new information)

- **CSM** — present (`three/examples/jsm/csm/`) but architecturally incompatible here.
  `setupMaterial()` **ASSIGNS** `onBeforeCompile`, clobbering the buildings' 12-uniform injection
  and the ground's explicitly-CHAINED one; `ShadowMaterial` (the ground twins) uses
  `getShadowMask()`, which **multiplies all cascades with no cascade dispatch**; it creates 3 extra
  DirectionalLights ⇒ full scene recompile + 3 depth passes; and it has zero reach into the ~19 raw
  ShaderMaterials. **The altitude-adaptive ortho extent already does a cascade's job for free** —
  street level clamps to 1.6 km (8192² ⇒ 0.39 m/texel), a mountain view spends the same texels on
  11 km of relief.
- **PCSS** — **not shipped in the npm package at all** (`files` ships `examples/jsm` only; the
  `webgl_shadowmap_pcss` demo is not installed). A hand port also needs a RAW depth read for its
  blocker search, but the PCF sampler is a `sampler2DShadow` with hardware compare.
- **VSM** — `WebGLShadowMap.js:515` makes every `receiveShadow` mesh an implicit caster, which
  means all the ground twins. 768 MiB at 8192².
- **Full mip chains on the drape composites** — each composite is an independent ClampToEdge canvas
  cleared TRANSPARENT; a chain box-filters that border inward and clamps at coarse levels into a
  visible tile-seam grid. Anisotropy alone is the legal win (and `minFilter` is ALREADY
  `LinearMipmapLinearFilter`, which is the gate three needs, so setting one field is sufficient).
- **GI** — stays rejected, owner-accepted, and the timelapse says the condition was met.

## MECHANISM NOTES

- **The anisotropy stamp** wraps `TiledRegionImageSource.prototype.fetchItem` — the unique choke
  point (BOTH creation paths return through it: the compose `CanvasTexture` and the single-tile
  `.clone()` fast path) and the only producer of the region `DataCache` entries. The library
  exports neither the class nor any hook. Stamped at CREATION: `anisotropy` is part of three's GL
  texture cache key, so a live re-stamp is a full re-upload per composite. Consequence, documented:
  **fly a little for the full effect**. The wanted value is module-scoped, not attach-closure-scoped,
  so a dispose+re-attach cannot leave the live patch reading a dead closure.
- **S9's dayK is per-FRAGMENT.** `sunUpDot` IS sin(solar elevation) at that fragment, so the curve
  still draws a true terminator from orbit — no need to feed it a single almanac sample. The JS
  twin and the GLSL are **emitted from one table** by `bandCurveGlsl`; a test parses the emitted
  GLSL back and compares against `bandCurve` across the domain to float32 precision.
- **Ground and buildings share ONE haze number**: the orchestrator pushes the band value to the
  ground, the ground applies the gates + easing, and the orchestrator then reads the ground's live
  `uFtwHaze` back out and hands THAT to both building sets. Identical by construction, not by two
  calculations agreeing.
- **Every OFF state is EXACT, not asymptotic.** The eased uniforms snap to 0 under an epsilon and
  `stepUltraLook` early-returns once settled. The unwind takes ~9 s by design (a ~950 ms τ from a
  night exposure of 1.46 down to 1e-4) — visually done in ~3 s. A 5 s wait in the verify script
  measured 1.0023 and read as a bug that wasn't one.

## TRAPS THAT COST TIME THIS SESSION

- **Backticks inside a GLSL template literal terminate it.** Writing `` `uFtwFlat2d` `` in a comment
  inside an injected-shader template produced 17 phantom TS parse errors. Prose only in there.
- **The Vite dep-cache trap bit exactly as documented** — two new imports into the globe bundle and
  EVERY module 504'd (`Failed to fetch dynamically imported module` on all ~24 islands). Restarting
  `wix dev` was NOT enough; `node_modules/.vite` had to be moved aside.
- **A passing check over a worthless picture.** The first Everest pose (alt 6400 over ground that is
  itself 6.6 km) put the camera UNDER the terrain; the street-floor guard rescued it and reset tilt
  to 20°, so every assertion passed while the shot showed a wall of snow. The pose check is now
  derived from the live shadow extent (`boundsM > 9 km ⇒ alt > 8.2 km`), which is falsifiable.

## OPEN TAILS (owner taste, not defects)

- `ULTRA.dayCurve` civil anchor **0.30** — the ground stays notably bright at civil twilight (that
  is the physical intent; a real civil twilight is navigable). First knob if the owner finds it too
  lit. Neighbours: `hazeMaxK 0.72`, `photo3dK 0.6`, `hemiTintK 0.6`.
- **The sky DOME was not touched.** At golden hour the ground haze goes warm while the dome above
  the horizon is still the old blue-grey — a mild seam. Fixing it means reaching into
  `scene/atmosphere.ts`, which was out of this slice's scope.
- Capped mip chain on the composites (the other half of §1b) — deferred with reasons above.
- `ULTRA.shadowMapSize` 8192 is the rollback knob if ~512 MiB proves too much on a weaker box.

Related: `mem:core` · `mem:decisions/session_workflow` · backlog **T44 / T45** ·
`.claude/claude-docs/ULTRA_PLAN.md` · `rendering/FPV_FIDELITY_AUDIT_2026-08-22.md` (gaps #9/#16/#17
all now addressed under ULTRA).
