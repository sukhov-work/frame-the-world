# TRACK 3: Lighting, shadows, sky, atmosphere, ULTRA, dusk, eclipse (agent report, confidence 86%)

## Findings — as-built
**Lights: exactly 2 lit-material lights + N depth-only lights.** One `DirectionalLight` key (`GlobeCanvas.tsx:262`), one `HemisphereLight` fill (`:354`), one dedicated moonlight `DirectionalLight` in `scene/sky.ts:543`, and under ULTRA-at-boot two cascade `DirectionalLight`s at `intensity=0` that only own depth maps (`GlobeCanvas.tsx:322-343`). No `AmbientLight`, no envMap/PMREM/IBL anywhere (grep: zero hits for `envMap|PMREM|irradiance|scene.fog|SSR|TAA|FXAA|SMAA|volumetric|cloud|weather`).

**Which materials read lights.** Only `MeshStandardMaterial` surfaces: building fills (`buildingMaterial.ts:104-111`, flatShading, roughness 0.85, `emissive tokens.land × 0.1`), enriched buildings + instanced trees (`enrichedBuildings.ts:555,1047-1048,1087-1088`), user GLB models (`userModels.ts:405-406`). Everything else is **self-lit**: base earth `ShaderMaterial` (`baseEarth.ts:83`, own `dayK`), terrain drape swapped to unlit `MeshBasicMaterial` per tile (`imageryGround.ts:296`) with its own grade, sky dome (`atmosphere.ts:118`), stars, impostors, ~22 raw ShaderMaterials across 14 modules. Ground receives shadows only through a `ShadowMaterial` twin per tile (`imageryGround.ts:760-767`, colour `tokens.water`, opacity 0.75, visible only below `SHADOWS.maxAltM`).

**Key light model (`stepKeyLightAndShadow` `StylizedTiles.ts:5842`):**
- Direction = ephemeris `sunDirW` (sampled at 1 Hz scene-time).
- Colour: `lerpColors(white, goldenHour, goldenFactor(sunDot)·keyStrength)` (`:5939`); ULTRA multiplies Kasten-Young `solarChroma` at `keyChromaK` 0.85 (`duskLight.ts:60-100`).
- Intensity: `SUN.keyIntensity 1.5 × (1+goldenK·0.35) × eclipseK × sunKeyTroughK × ultraDirectK` (`:5976-5985`). `ultraDirectK` = `bandCurve(keyExtinctCurve)` (0 at −0.5°) is 1 with the chip off. **Baseline has no elevation term: without a qualifying moon `sunKeyTroughK` returns 1 (`keyHandoff.ts:73-86`) and walls stay keyed at 1.5 all night** — the charter's AB1 "phantom night key", still open.
- Golden bell: one `smoothstep` bell over sin(elev), −12°…−1° in, +10°…+21° out (`GOLDEN` `tuning.ts:315-321`), GLSL twins in earth/ground/atmosphere.
- Sun→moon handoff (`keyHandoff.ts`): at `minSunElevSin` 0.008 (+0.46°) the SAME light impersonates the moon (`moonKeyIntensity 0.3 × moonKs` K&S-1991); the dedicated `sky.ts` moonlight gives up. Both arms trough to 0 at the gate across `fadeBandSin` 0.0523 (≈3°).
- Eclipse: `stepEclipse` (`:5648-5686`) topocentric coverage per frame, eases `eclipseK` (τ 220 ms) to `daylightFloor` 0.04, multiplies the key, ground `uFtwEclipse`, dome `uEclipse`, stars reveal. `baseEarth` deliberately unwired (T46).

**Hemisphere.** Constructed `landHi/water × 0.32` at three's default position (0,1,0) = ECEF +Y — correct on one meridian. ULTRA lerps it onto `_focusUp`, scales by `hemiCurve`, tints sky half by `hemiTintK` 0.22 (`:5794-5808`); off-state restores (0,1,0) exactly. AB2 open. Measured contribution: **0.18 % of a facade pixel** (ULTRA_ARCH §14.2) — the building emissive floor 0.1 is ~100× it.

**ULTRA look (`stepUltraLook` `:5688-5840`):** one `ultraLightAt(ULTRA, sunDirW·focusUp)` sample → `dayK/exposureK/hemiK/hazeK/tint` (`lightBands.ts:88-95`); pushes ground targets, reads the ground's eased `uFtwHaze` back and hands it to buildings/enriched/models/dome; exposure eased τ 950 ms (`exposureCurve` 1→1.46). Off-state snaps to exact baseline.

**Aerial perspective `ftwAerial`** (`glsl.ts:71-118`): `f=min((1−exp(−d/55 km))·hazeK, 0.72)`, `inScatter = tint(cool→warm by Mie lobe)·max(skyLevel, afterglow·mie)·airLevel(cosγ)`, then `mix(col, inScatter, f)`. **No surface-normal term** (T69). Compiled into ground, building fill+edge, models.

**Tone/post**: `NeutralToneMapping` exposure 1.0, `SRGBColorSpace`; `RenderPass → [GTAO] → UnrealBloom(0.4/0.5/0.9) → OutputPass` into HalfFloat MSAA×4; `antialias:false`. Bloom off on `low` + lean. No post-AA.
**GTAO**: constructed only if `AO.enabled` (false), then gated `tier==="high" && alt<12 km`; the ULT chip pins tier to `high`, so flipping `AO.enabled` on would make AO an ULTRA lever.

**Sky dome** (`atmosphere.ts`): analytic, not precomputed. Orbital limb = exponential density at ray closest-approach altitude, two scale heights (60/240 km), Chapman obliquity, sun modulation (`:151-178`). Below 120 km blends to a low-altitude sky: zenith ramp `smoothstep^0.55`, horizon haze `exp(−sRel/0.075)` above / `exp(sRel/0.08)` below the TRUE horizon (dip included, CPU float64 `horizonTerms`), golden warming, `dayK=smoothstep(−0.12,0.12,sunEl)·uEclipse` (`:184-232`). ULTRA adds a directional arm: shared `airLightGlsl` (Rayleigh `0.75(1+cos²γ)` + Mie `cosγ^3.5`) blended by `uFtwDirK` 0.9, plus additive afterglow band `exp(−sRel/0.30)` (`:240-266`). T70: `Ds` ellipsoid-scaled vs raw ECEF `uSunDir` (≤0.19°). Dome re-anchors to the camera at 0.45·far below 350 km.

**Stars** (`stars.ts`): BSC5 9,096 stars, softened Pogson (`sizeGamma 0.42, brightGamma 0.6, brightMin 0.65`), B-V tint 0.6, twinkle `0.7+0.3·sin(1.5t+φ)`, night fade over sin(elev) −0.02→−0.14, day dim floor 0.25 from orbit, eclipse reveal. Milky Way: NASA SVS 8192×4096 JPEG haze (~134 MB VRAM, mips off — T16) or 2k on mobile, + 14k procedural points, horizon extinction band 16°.

**Sun/moon impostors** (`sky.ts`): camera-anchored at `far×0.5`, true angular size, analytic horizon fade; sun additive HDR core ×5 with a premultiplied "solid" arm 6°→1° (ULTRA `discLevelCurve`); moon `albedo·(earthshine+lit^0.8·2.9)` with LROC map, umbra/penumbra carving; eclipse corona gated to coverage ≥0.985.

**Dusk model (ULTRA only):** `keyExtinctCurve`, `skyLevelCurve` (`tuning.ts:1205`), `afterglowCurve` peak 0.75 at −2°, `airRayleighK 0.9 / airWarmSwing 0.85`, ground direct/ambient split `groundAmbientK 0.68 + skyExposure·skyAz·skyLevel`, direct = `directK·lambert` (`imageryGround.ts:621-656`), photo-shade lift rides `directK^3`, building `emis/edge` troughs, moon-elevation gate on the dedicated moonlight.

**Terminator on the base earth** (`baseEarth.ts:146-170`): `dayK=smoothstep(sin −6°, sin +3.2°)`, `dayShade=mix(0.78,1,√sunDot)`, city lights band over VIIRS/Black Marble 8k, moon night term, rim `(1−N·V)^3·0.12`.

## The shadow rig
| Mechanism | As built | Cite |
|---|---|---|
| Type | `PCFShadowMap`; 5-tap Vogel disk rotated by IGN per pixel, `radius` in texels, `mix(1, shadow, intensity)`; **returns 1.0 (lit) outside [0,1]** | `shadowmap_pars_fragment.glsl.js:115-149` |
| Map size | boot-latched: high 4096 / mid 2048 / low 1024 / lean 1024; ULTRA 8192 (clamped to `maxTextureSize`) | `GlobeCanvas.tsx:278-283` |
| Enable | device tier `shadowsEnabled` OR ULTRA boot; governor cannot disable | `GlobeCanvas.tsx:154` |
| Box fit (cascade 0) | `fitShadowBox(alt, viewDistM)`: half = clamp(max(alt·K, d/2+800), 1600, cap) rounded UP to 128 m; centre = eye ground point + `fwdHoriz·min(d/2, half−800)`; K 0.6/cap 5 km base, 1.1/18 km ULTRA | `shadowFit.ts:60-79`, `StylizedTiles.ts:5893-5915` |
| Refit cadence | position/target written **every frame**; projection only on extent step or profile flip | `:6000-6001,6044-6063` |
| Near/far | `lightDist ± (margin + half)`: 8 km±3.5 km base, 60 km±30 km ULTRA | `:6050-6052` |
| Bias | base: raw `−2e-4` (a FRACTION of near→far, so −1.4 m at construction, −2.0…−3.3 m when casting); ULTRA: `−0.6 m/(far−near)` re-derived per resize | `:6060-6062` |
| Normal bias | 0.75 m base / 0.45 m ULTRA (world-space) | |
| Radius | 2 texels base / 4 ULTRA (live uniform) | `:5577-5578` |
| Fade | `shadow.intensity = aboveGateK(sunDot)` over sin(3°) base / sin(0.6°) ULTRA, 0 at +0.46° where `castShadow` flips | `:5998`, `keyHandoff.ts:46-48` |
| Ground opacity | 0.75 (sat) / 0.8 (dark) → 0.88 through the ULTRA dusk band; moon 0.62 | `:6005-6015` |
| Casters | OSM buildings, enriched, trees, user models; terrain **ULTRA-only** via shared `customDepthMaterial` (polygonOffset 2) + `shadowSide=FrontSide` + skirt clip `onBeforeShadow` draw-range | `imageryGround.ts:796-798,832-842,886-897` |
| Receivers | building fills (per-light), ground twins (`getShadowMask` product) | |
| Cascades (ULTRA boot) | 2 zero-intensity lights, 4096² reach 60 km (29 m/texel) + 2048² reach 260 km (254 m/texel), `autoUpdate=false`, centred on the EYE, refresh on extent/epoch/drift>12%/swing>0.25°/1.5 s | `shadowCascade.ts`, `StylizedTiles.ts:6080-6150` |
| /m PiP | second render skips the shadow pass | `GlobeCanvas.tsx:1015-1019` |

**Why shadows are still unpredictable (precise mechanisms; browser-unverified items marked):**
1. **No texel snapping, ever.** Box centre is continuous (`_eyeGround + fwdHoriz·pushM`); three's `LightShadow.updateMatrices` does no quantisation. Every translation AND every yaw (`_fwdHoriz` is camera-forward) re-phases the texel grid → edge crawl on every drag. Only the extent is quantised (`boundsQuantM` 128 m).
2. **Extent steps pop.** Half-extent rides `viewDistM` (pitch) and altitude in 128 m steps; each step re-rasterises every edge at a new texel size. At the cap (5 km base / 18 km ULTRA) the far edge is a straight cut to fully lit — **the base profile has no cascade, so "cropped, sliced" is the shipped default for every non-ULTRA user** (AB7 open).
3. **Cascade composition is a raw product with no dispatch or blend band.** At cascade 0's edge the penumbra jumps from 4×(0.39–4.4 m) to 3×29 m ≈ 90 m and the normal offset from 0.45 m to ~44 m (ESTIMATED from `shadowCascade.ts:129-139`). `shadow *= getShadow(...)`: any coarse-cascade shadow (29 m blocky edges, grazing-sun terrain acne) multiplies INTO the near field. Argued from shader source; UNVERIFIED in browser.
4. **Lit materials receive cascade 0 only.** Per-light shadowing multiplies `directLight.color`, and cascade lights are black — beyond 18 km a wall is unshadowed while the ground under it is; near the eye the ground gets the coarser union while walls get crisp cascade 0. Argued.
5. **Cascades are stale between discrete triggers.** Far field ticks at 0.25° / 1.5 s while cascade 0 is smooth; any terrain epoch forces both cascade maps to re-render — spikes and shape pops as tile LOD refines.
6. **Casters pop, receivers fade.** Terrain LOD swaps are crossfaded in colour but the shared depth material ignores per-tile fade; buildings screen-door in over 600 ms yet cast from frame 1. Argued, UNVERIFIED.
7. **Noise, not softness.** Vogel+IGN is a per-pixel screen-space rotated pattern with no temporal filter — grain that crawls with the camera; penumbra width constant in texels regardless of occluder distance (no contact hardening).
8. **Base bias is not metric** (raw −2e-4 over a range that moves 7→10–16.5 km with altitude) → contact/peter-pan varies with altitude on the default profile.
9. **Elevation gates.** Base shadows die from +3.5° — the raking hour is shadowless outside ULTRA; the rig's direction teleports sun→moon at +0.46°.
10. **Boot-latched levers.** A mid-session ULT flip leaves map size/cascades on the boot profile.
11. 1 Hz ephemeris sampling steps the direction ~0.004° in live mode → ~1 texel/s crawl at 0.39 m/texel (ESTIMATED).

**Owner status.** 2026-08-27b: shadows "cropped, sliced, hollow and incomplete … as if part of the global shadows are omitted"; 27c: "should become darker and more global, not just disappear … do not bring back that super elongated naive shadows"; 2026-09-01 (DECISIONS.md:828-829): "did NOT fully fix the owner's issue — the topic re-opens". No verbatim 09-01 wording recorded.

## Tunables (selected)
| Name | Value | file:line |
|---|---|---|
| `SUN.keyIntensity / hemiIntensity` | 1.5 / 0.32 | tuning.ts:47,51 |
| `GOLDEN.fadeInLo…fadeOutHi / castGain / keyBrighten` | −0.21…0.36 / 1.3 / 0.35 | :315-336 |
| `SHADOWS.*` | see track 1 | |
| `SHADOWS.moonMinIllum / moonGroundOpacity` | 0.6 / 0.62 | :523-530 |
| `ULTRA.terrainCast / terrainCastMaxAltM / terrainDepthOffset` | true / 30 000 / 2 | :1071-1082 |
| `ULTRA.cascades[]` | 60 km@4096²/r3/q4 km; 260 km@2048²/r2/q16 km; bias 0.6 tx, nBias 1.5 tx | :1122-1149 |
| `ULTRA.shadowFadeBandSin / groundShadowDuskK` | 0.0105 / 0.88 | :1332,1337 |
| `ULTRA.hemiTintK / domeTintK / domeDirK` | 0.22 / 0.45 / 0.9 | |
| `ULTRA.hazeDistM / hazeMaxK` | 55 000 / 0.72 | :974,977 |
| `ULTRA.keyExtinctCurve / keyChromaK / skyLevelCurve / afterglowCurve` | tables / 0.85 | :1182-1219 |
| `ULTRA.airRayleighK / airMiePow / airMieGain / airWarmSwing` | 0.9 / 3.5 / 1.35 / 0.85 | :1237-1248 |
| `ULTRA.groundAmbientK / photo3dShadePow` | 0.68 / 3 | :1263,1297 |
| `EARTH.termBand / dayGradMin / lightsBand / nightFloor` | [−0.105,0.055] / 0.78 / [−0.12,−0.005] / 0.23 | |
| `ATMOSPHERE.skyFullAlt / skyGoneAlt` | 12 km / 120 km | :1927-1965 |
| `ECLIPSE.daylightFloor / umbraLight / coronaGain` | 0.04 / 0.055 / 1.15 | :1434-1477 |
| `BUILDINGS.emissiveIntensity` | 0.1 | :2124 |

## Measured numbers
| Metric | Value | Kind |
|---|---|---|
| ULTRA frame time city / Everest | 30.7 → 36.1 ms (+18 %) / 29.3 ms | MEASURED (owner M3 Pro) |
| Cascade ladder cost | mountain 31.2→34.2; city 47.0→50.3 ms | MEASURED |
| Cascade VRAM | +168 MB over cascade 0's 536 MB | ESTIMATED arithmetic |
| Pre-cascade coverage | 24 % / 8 % / 35 % → post 100 % | MEASURED |
| Depth range when casting | base 10.2–16.5 km; ULTRA 63.2 km street / 85.3 km Everest | MEASURED |
| Base m/texel | 0.78 (1.6 km) → 2.44 (5 km) | ESTIMATED |
| ULTRA m/texel | 0.39 → 4.39 (18 km); cascades 29 / 254 | ESTIMATED |
| Shadow fade loss | 52 % at +2°, 9 % at +1° (base band) | MEASURED |
| Dusk sweep | skyLevel 1→0.282, directK 1→0, keyLevel peak 1.294@9.5°, disc 0.378@3.4° | MEASURED |
| Terrain anti/lit ratio @+2° | 0.969 → 0.685 | MEASURED |
| Facade front:back | 1.28@3° → 1.08@0° | MEASURED |
| Hemisphere on a facade | 0.18 % of pixel; emissive 3.6× sun @3° | MEASURED |
| T69 wall contrast | 1.13@2 km, 1.043@10 km, 1.0025@30 km | MEASURED |
| ULTRA off-state | photo3d 0 · haze 0 · exposure 1 · hemiPos [0,1,0] · radius 2 (verify-ultra 28/28) | MEASURED |

## Limitations / traps
- `shadow.bias` is a fraction of near→far; `mapSize` latched; `shadowSide=FrontSide` or terrain casts nothing silently; RGBA8 colour attachment doubles VRAM.
- `WebGLLights.js:295-305` truncates `directionalShadow[]` to caster count — `sun` must stay first.
- `WebGLShadowMap.js:170` skips before `updateMatrices` — never move a cascade without `needsUpdate`.
- Skirt clip depends on `geometry.groups[0]` layout (`terrainSkirt.ts`).
- ULTRA tints from solar elevation: eclipse seam (RC23) and dome seam (RC24) patched by fading toward baseline, not by a shared model.
- `afterglowCurve` evaluated at GEOMETRIC elevation — no terrain-horizon sun (T68).
- Baseline: hemisphere ECEF +Y (AB2); key never dies (AB1); shadows die from +3.5° (AB4); terrain never casts outside ULTRA (AB7).
- User GLB PBR materials get no IBL: metallic surfaces read black under a single key.
- **No harness asserts temporal stability** (no shimmer/pop metric exists).

## Refuted / rejected
| Candidate | Reason | M/A |
|---|---|---|
| `three/examples/jsm/csm` | `setupMaterial` ASSIGNS `onBeforeCompile` (clobbers chained patches), `ShadowMaterial` has no cascade dispatch, +3 lights = recompile, no reach into ~19 raw ShaderMaterials; its "already free" claim measured FALSE | argued + measured |
| PCSS | not in npm; hand port needs raw depth read, PCF sampler is `sampler2DShadow` hardware-compare | argued |
| VSM | every receiver an implicit caster → 768 MiB at 8192² | argued |
| Real-time GI | owner-accepted 2026-08-22i | argued/owner |
| `PCFSoftShadowMap` | dead code in 0.185 | source |
| Tilting the hemisphere toward the sun | 0.18 % of a facade pixel | measured |
| Reusing `ftwAirLevel` as ambient azimuth | lobe ≠ hemisphere integral | measured |
| Dimming the additive sun disc | dim = dissolve under addition | measured |
| Mip chain / anisotropy as the tile-seam cause | skirt was the cause | measured |

## Open rows: T10, T16, T45 (closed but owner reopened shadows 09-01 with no row), T46, T47, T65, T66, T67, T68, T69, T70; charter AB1/AB2/AB4/AB5/AB7.

## Gaps vs a modern engine (ASSESSMENT)
- **Stable CSM (texel-snapped, world-space-quantised centre, cascade blend band, per-cascade dispatch):** absent. Snapping the cascade-0 centre to its own texel grid along the light's right/up axes is cheap, pure-JS — the single highest-value fix for "swim". Constraint: ECEF magnitudes mean the snap must be done in the light's local frame in float64 before writing `position`.
- **PCSS / contact hardening:** a hand-written second depth read is possible but touches `shadowmap_pars_fragment` on every receiver — the same blast radius that killed CSM.
- **Shadow caching/scrolling, SDF/RT shadows:** none; owner ruled out RT. Terrain casters could be cached per epoch instead of re-rendered every frame.
- **Physically-based sky (Bruneton/Hillaire LUTs), sky irradiance/IBL, volumetric clouds, weather, fog volumes, SSGI:** none. A precomputed transmittance/sky-view LUT (Hillaire 2020) fits the ephemeris-driven, globe-scale design and would give ONE model for key chroma, sky, aerial perspective and ambient — now kept coherent by hand-shared uniforms. Off-state law makes it ULTRA-first.
- **Exposure adaptation:** authored ramp, not luminance-driven.
- **Temporal AA / temporal shadow filtering:** none. Under ECEF float32 jitter a TAA pass is risky; cheaper first step is world-space-stable noise (hash on world position, not `gl_FragCoord`).
- Hardest constraints: the off-state law, streaming casters with LOD pops, one shared depth material for terrain, globe-scale depth ranges (bias must stay metric everywhere).
