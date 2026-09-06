# PLUX — the sunset shadow cliff and the brightness inversion

Read-only investigation of the owner's Everest FPV defect at
`#f=27.989179,86.925144,27.6,276.7,-1.9,42.0`, frame A `t=1788697093370` vs frame B
`t=1788697486657`.

Repo: `/Users/yevhens/Projects/wix-private/headless-frame-the-world` @ `200ef98` (master).
No file was edited. All scalars were evaluated by esbuild-bundling the real modules
(`tuning.ts`, `lib/globe/lightBands`, `keyHandoff`, `duskLight`, `shadowFit`) and running them in
Node — no anchor table was transcribed by hand. Ground shade uses the shipped JS twin from
`test/components/globe/duskShadeRatio.test.ts:38-81`.

---

# Findings

## 0. Bottom line

**Frame B is the shipped-as-designed state, not a regression** — nothing in the light path has
changed since `47d844d` (2026-08-27, the taste pass) — and **the frames are provably ULTRA-on**,
because the base rig has no terrain casters at all (`StylizedTiles.ts:6226` gates `setTerrainCast`
on `ultraOn &&`; `tuning.ts:1066-1068` "the ground … receives and never casts"), so a
mountain-shadow frame cannot exist with the chip off.

More precisely, it is neither "regression" nor "settled": it is the **explicitly reopened shadow
issue**. `DECISIONS_ARCHIVE.md:1866-1869`, entry 2026-09-01: *"The 2026-08-27b/c shadow work did
NOT fully fix the owner's issue — the topic re-opens in a later session; do not treat that round as
closing it."*

Three separate things fire between the two frames, and the dominant one is not a curve, it is a
cliff:

| | mechanism | A → B |
|---|---|---|
| **1 (dominant)** | The shadow field is **released while 15 % of the direct sun is still there.** `shadow.intensity` goes 1.000 → 0.000, `castShadow` true → false, all terrain casters detach. | in-shadow terrain **× 5.22 brighter** |
| **2** | The dome's **afterglow is an unbounded additive band** that rises while everything else falls. | afterglow **× 1.35** (and × 2.1 by −2°) |
| **3** | haze **× 1.03** (peaks at 0°), exposure **× 1.004**, both monotone-up | small, but never the other way |

Against that, `directK` falls × 0.41 and `skyLevel` × 0.87 — but those only dim the *lit* surfaces,
which at a raking sun are the minority of the frame.

---

## 1. What the code actually sees: the sun is GEOMETRIC, not refracted

`sunDirW` comes from `bodyStatesAt` → `sampleEphemeris` (`StylizedTiles.ts:892`), and
`bodies.ts:101` is `GeoVector(Body.Sun, time, true)` — geocentric, aberration-corrected,
**no refraction** (`bodies.ts:139` "no refraction argument = airless"). `sunDot =
sunDirW.dot(_focusUp)` (`StylizedTiles.ts:5944`) is therefore `sin(geometric elevation)`.

Re-computed with astronomy-engine at 27.989179 / 86.925144 (identical at observer height 30 m and
8848 m — solar parallax is 8.8″):

| frame | t | **geometric (what the code sees)** | refracted (the reported figure) | `sin` |
|---|---|---|---|---|
| A | 1788697093370 | **+1.2975°**, az 276.47 | +1.6325° | +0.022644 |
| B | 1788697486657 | **−0.1403°**, az 277.23 | +0.3636° | −0.002448 |

Descent rate 0.2194 °/min (Δ1.4378° over 393.287 s). **Frame B's sun is already geometrically below
the horizon.** Every ULTRA anchor table is authored as if 0° were sunset, but geometric sunset
(upper limb: 34′ refraction + 16′ semidiameter) is **−0.833°** — so the whole dusk model fires
**0.83° ≈ 3.8 minutes early**.

Moon at both frames: alt −30.2° / −30.9°, illum 0.259 → `moonShadows` false, `moonReadyK` = 0,
`sunKeyTroughK` = 1 exactly. Every number below therefore has no moon term.

---

## 2. The complete per-frame light path

### `stepUltraLook` — `StylizedTiles.ts:5760-5910`

Early-returns at `:5768` when the chip is off and settled (zero per-frame cost). One sample:

```
5809  const sinSunFocus = sunDirW.dot(_focusUp);
5810  ultraSkyLevel = light ? bandCurve(ULTRA.skyLevelCurve,  sinSunFocus) * eclipseK : 0;
5811  ultraAfterglow= light ? bandCurve(ULTRA.afterglowCurve, sinSunFocus) * eclipseK : 0;
5812  ultraDirectK  = light ? bandCurve(ULTRA.keyExtinctCurve,sinSunFocus)            : 1;
5813  ultraEmisK    = light ? bandCurve(ULTRA.buildingEmisCurve, sinSunFocus)         : 1;
5814  ultraEdgeK    = light ? bandCurve(ULTRA.buildingEdgeCurve, sinSunFocus)         : 1;
5823  ground.setUltraTargets({ photo3d, light, haze: light.hazeK*eclipseK, hazeCol,
                               hazeCool, skyLevel, afterglow, directK });
5834  buildings.setUltraHaze(hazeNow, …);   5842  atmosphere.setUltraBand(…);
5857  const expTarget = (light ? light.exposureK : 1) * RENDERER.toneMappingExposure;
5858  ultraExposure += (expTarget - ultraExposure) * easeK(dtMs, ULTRA.exposureTauMs);
5859  renderer.toneMappingExposure = ultraExposure;
5868  hemiLight.intensity += ((light ? SUN.hemiIntensity * light.hemiK : _hemiIntensity0)
                              - hemiLight.intensity) * k;
5883-5908  settle: snap EXACTLY to baseline, ultraDirectK = 1, skyLevel = afterglow = 0.
```

`ultraLightAt` (`lib/globe/lightBands.ts:170`) folds `dayCurve`, `exposureCurve`, `hemiCurve`,
`hazeCurve` and `rampWeights(tintStopsDeg)` at that one `sinElev`. `bandCurve`
(`lightBands.ts:92-110`) is a fold from the lowest anchor upward; its GLSL twin is emitted from
the same table by `bandCurveGlsl` (`:119-140`).

### `stepKeyLightAndShadow` — `StylizedTiles.ts:5919-6234`, sun arm

```
5945  const shadowEligible = alt < SHADOWS.maxAltM && !flatGroundNow();
5946  const sunUp      = sunDot > SHADOWS.minSunElevSin;        // 0.008 = +0.4584°
5947  const sunShadows = shadowEligible && sunUp;
5959  moonRigTakeover  = moonShadows ? moonRigTakeoverK(sunDot, KEY_GATE) : 0;
5964-5990  RC4 view fit -> fitShadowBox(eyeAlt, viewDistM, ultraOn ? _shadowFitUltra : _shadowFitBase)
6011  const goldenK = goldenFactor(sunDot, GOLDEN);
6012  sunLight.color.lerpColors(_keyWhite, _goldenCol, goldenK * GOLDEN.keyStrength);
6031-6037  if (ultraOn) sunLight.color.lerp(solarChroma(asin(sunDot)) * color, ULTRA.keyChromaK);
6046  sunLight.intensity = SUN.keyIntensity                       // 1.5
                         * (1 + goldenK * GOLDEN.keyBrighten)     // × up to 1.35
                         * eclipseK
                         * sunKeyTroughK(sunDot, moonDot, moonIllum, KEY_GATE)
                         * ultraDirectK;                          // 1 with the chip off
6071  sunLight.shadow.intensity = aboveGateK(sunDot, ultraOn ? ULTRA_SHADOW_GATE : KEY_GATE);
6072  if (sunShadows) {
6073    sunLight.position.copy(_shadowFocus).addScaledVector(sunDirW, shadowLightDistM);
6080    const duskK = ultraOn ? 1 - aboveGateK(sunDot, KEY_GATE) : 0;
6081    ground.setShadowStrength(
          lerp(lerp(SHADOWS.groundOpacity, DRAPE.shadowOpacity, dark01),
               ULTRA.groundShadowDuskK, duskK) * eclipseK);
6089  } else { direction-only: sunLight.position = sunDirW * SUN.keyLightFarM; }
6094  sunLight.castShadow = sunShadows || moonShadows;
6100-6135  ortho box resize + metres-derived bias (only while casting)
6161-6222  the cascade ladder; 6185: cl.shadow.intensity = sunLight.shadow.intensity
6226  ground.setTerrainCast(ultraOn && ULTRA.terrainCast
                            && (sunShadows||moonShadows) && alt < ULTRA.terrainCastMaxAltM);
6232  buildings.setNight(sunDirW.dot(_focusUp), _focusUp);
```

Gate profiles (`StylizedTiles.ts:3092-3102`):

```
KEY_GATE          = { gateSin: SHADOWS.minSunElevSin 0.008, bandSin: SHADOWS.fadeBandSin 0.0523, … }
ULTRA_SHADOW_GATE = { ...KEY_GATE, bandSin: ULTRA.shadowFadeBandSin 0.0105 }
aboveGateK(x,p)   = smoothstep(x, p.gateSin, p.gateSin + p.bandSin)      // keyHandoff.ts:46-48
```

**`setShadowStrength` is only called inside `if (sunShadows)`** (`:6081`) — below the gate the
`ShadowMaterial.opacity` is stale. Harmless only because `castShadow = false` makes the shadow mask
1.0 everywhere.

### The GPU consumers

- `imageryGround.ts:735` — the composite: `diffuseColor.rgb = graded * shade + moonlit + ambient;`
  then `:742-743` `ftwAerial(…, uFtwHaze, uFtwHazeCol, uFtwHazeCool, uFtwSkyLevel, uFtwAfterglowG)`.
- `imageryGround.ts:578` legacy `dayK = smoothstep(-0.105, 0.055, sunUpDot)` (`EARTH.termBand`,
  `tuning.ts:1833`); `:587` `dayK = mix(dayK, ftwUltraDayK(sunUpDot), uFtwUltraLight)`;
  `:593` `max(dayK, uFtwFlat2d)`; `:599` `dayK *= uFtwEclipse`.
- `imageryGround.ts:648-657` — the direct/ambient split. `directK` is a **numerator on the direct
  arm**, and through `1−directK` the shaper of the ambient azimuth term; it is *not* a
  `direct/(direct+flat)` normalisation:
  ```glsl
  float skyExposure = mix(1.0, 0.5 + 0.5*dot(nS,nUp), 0.45);              // groundAmbientSkyK
  float skyAzK      = 0.8 * pow(clamp(1.0-uFtwDirectK,0.0,1.0), 0.5);     // groundAmbientAzK/AzPow
  float skyAz       = mix(1.0, 0.5 + 0.5*dot(normalize(uFtwSun),nS), skyAzK);
  float lambert     = max((sunDot + 0.18)/(1.0+0.18), 0.0);               // groundDirectWrap
  float dayShadeU   = 0.68*skyExposure*skyAz*mix(1.0,uFtwSkyLevel,1.0)    // groundAmbientK/LevelK
                    + (1.0-0.68)*uFtwDirectK*lambert;
  ```
- `glsl.ts:96-117` — the shared aerial term:
  ```glsl
  float f  = min((1.0 - exp(-dist/55000.0)) * hazeK, 0.72);      // hazeDistM / hazeMaxK
  float cosG = dot(toFrag/dist, normalize(sunW));
  vec3  tint = mix(hazeColCool, hazeCol, ftwAirSun(cosG)*0.85);  // airWarmSwing
  vec3  inScatter = tint * max(skyLevel, afterglow*ftwAirSun(cosG)) * ftwAirLevel(cosG);
  return mix(col, inScatter, f);
  ```
  Lobes emitted by `duskLight.airLightGlsl` (`duskLight.ts:110-128`): `ftwAirSun = pow(max(x,0),3.5)`,
  `ftwAirLevel = (0.9*0.75*(1+x²) + 1.35*ftwAirSun) / (0.9*1.5 + 1.35)` — exactly 1 at the sun,
  0.5 anti-solar.
- `buildingMaterial.ts:244,253-256,366-369` — the buildings and their edge strokes get the
  byte-identical `ftwAerial`; `buildings.ts:368-381` `setUltraHaze` also writes
  `emissiveIntensity = BUILDINGS.emissiveIntensity * emisK` and `edgeMat.opacity *= edgeK`.
  The building fragment shader has **no other solar-elevation term** — in the base rig buildings
  respond to dusk only through `sunLight.intensity`.
- `sky.ts:187-191` base disc `sunExtinctionK`; `:611-616` ULTRA `discLevelCurve`; `:620-627`
  `uSolid` / `uHaloK = discLevel²`; `:713` `moonLight.intensity`.
- `atmosphere.ts:257-258` — the dome:
  ```glsl
  vec3 skyCol = zenithCol*0.85*dayK + hazeCol*haze*0.2*max(dayK, hGold);
  ```
  with `:229-230` `dayK = smoothstep(-0.12,0.12,sunEl)*uEclipse` and `:249-250` `hGold`
  = the GOLDEN bell. `:264-287` is the ULTRA directional block, whose last statement is an
  **unbounded additive band**: `skyCol += dirCol*hzA*1.15*uFtwAfterglow*sunSide*uFtwDirK`.
- `imageryGround.ts:1153-1155` `setShadowStrength(o) { shadowMat.opacity = o; }` — one shared
  `THREE.ShadowMaterial` (colour `tokens.water`, `:760-764`) worn by a per-tile child overlay mesh
  (`:926-934`), visible on `alt < SHADOWS.maxAltM && !flat2d` (`:1370-1374`), i.e. **not** gated on
  sun elevation. `shadow.intensity` reaches it because `getShadowMask()` multiplies every
  directional shadow mask (`tuning.ts:502-508` documents this explicitly).

---

## 3. The numeric tables

`dark01 = 0` (satellite/terrain, not the dark CARTO drape), `eclipseK = 1`, no moon,
flat ground for the "ground" columns, `slope 30°` for the lit-slope column.

### BASE RIG (ULTRA off — the `high` tier default)

| elev° | goldenK | key | shadow.int | castShadow | ground opac | dayK | exposure | hemi | haze | skyLevel | afterglow | disc extK | flat ground | ground in shadow |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +3.457 | 1.00 | **2.025** | 1.000 | true | 0.750 | 1.000 | 1.000 | 0.320 | 0 | 0 | 0 | 0.454 | 0.834 | 0.209 |
| +3.0 | 1.00 | **2.025** | 0.937 | true | 0.750 | 0.999 | 1.000 | 0.320 | 0 | 0 | 0 | 0.530 | 0.830 | 0.246 |
| +2.0 | 1.00 | **2.025** | 0.521 | true | 0.750 | 0.957 | 1.000 | 0.320 | 0 | 0 | 0 | 0.462 | 0.803 | 0.489 |
| +1.63 | 1.00 | **2.025** | 0.339 | true | 0.750 | 0.927 | 1.000 | 0.320 | 0 | 0 | 0 | 0.443 | 0.787 | 0.587 |
| **+1.2975 (A)** | 1.00 | **2.025** | **0.191** | true | 0.750 | 0.894 | 1.000 | 0.320 | 0 | 0 | 0 | 0.428 | 0.769 | **0.659** |
| +1.0 | 1.00 | **2.025** | 0.086 | true | 0.750 | 0.861 | 1.000 | 0.320 | 0 | 0 | 0 | 0.417 | 0.752 | 0.703 |
| +0.5 | 1.00 | **2.025** | 0.001 | true | 0.750 | 0.797 | 1.000 | 0.320 | 0 | 0 | 0 | 0.404 | 0.719 | 0.719 |
| **+0.4584 (gate)** | 1.00 | **2.025** | **0.000** | **false→** | (stale) | 0.778 | 1.000 | 0.320 | 0 | 0 | 0 | 0.403 | 0.717 | 0.717 |
| +0.36 | 1.00 | **2.025** | 0 | false | (stale) | 0.778 | 1.000 | 0.320 | 0 | 0 | 0 | 0.402 | 0.709 | 0.709 |
| 0 | 1.00 | **2.025** | 0 | false | (stale) | 0.727 | 1.000 | 0.320 | 0 | 0 | 0 | 0.400 | 0.676 | 0.676 |
| **−0.1403 (B)** | 1.00 | **2.025** | 0 | false | (stale) | 0.706 | 1.000 | 0.320 | 0 | 0 | 0 | 0.400 | **0.668** | **0.668** |
| −0.5 | 1.00 | **2.025** | 0 | false | (stale) | 0.650 | 1.000 | 0.320 | 0 | 0 | 0 | 0.400 | 0.647 | 0.647 |
| −1.0 | 1.00 | **2.025** | 0 | false | (stale) | 0.571 | 1.000 | 0.320 | 0 | 0 | 0 | 0.400 | 0.617 | 0.617 |

The base key is **flat at its daily maximum 2.025** across the entire window, because
`GOLDEN.fadeInHi = -0.0175` = sin(−1.003°) and `fadeOutLo = 0.17` = sin(+9.79°), so `goldenK ≡ 1`
(`tuning.ts:317,319,336`). Base exposure, hemi, haze, skyLevel and afterglow are constants — the
whole dusk model is ULTRA-gated. On Everest the base rows are academic: **no terrain casts at all**
without the chip (`StylizedTiles.ts:6226`, `tuning.ts:1066-1068`), so `shadow.int` has nothing to
darken.

### ULTRA ON

| elev° | directK | key | shadow.int | castShadow | duskK | ground opac | dayK | exposure | hemi | haze | skyLevel | **afterglow** | disc lvl | emisK | edgeK | flat ground ×exp | **in-shadow ground ×exp** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| +3.457 | 0.665 | 1.350 | 1.000 | true | 0.063 | 0.758 | 0.796 | 1.096 | 0.336 | 0.735 | 0.816 | 0.028 | 0.157 | 0.435 | 0.734 | 0.573 | 0.143 |
| +3.0 | 0.620 | 1.256 | 1.000 | true | 0.063 | 0.758 | 0.780 | 1.101 | 0.336 | 0.745 | 0.800 | 0.055 | 0.145 | 0.406 | 0.720 | 0.560 | 0.135 |
| +2.0 | 0.480 | 0.972 | 1.000 | true | 0.479 | 0.812 | 0.703 | 1.111 | 0.324 | 0.795 | 0.743 | 0.175 | 0.125 | 0.331 | 0.697 | 0.452 | 0.085 |
| +1.63 | 0.406 | 0.822 | 1.000 | true | 0.661 | 0.836 | 0.678 | 1.114 | 0.315 | 0.812 | 0.704 | 0.223 | 0.114 | 0.313 | 0.680 | 0.402 | 0.066 |
| **+1.2975 (A)** | **0.357** | **0.722** | **1.000** | true | 0.809 | **0.855** | 0.659 | 1.116 | 0.307 | 0.825 | 0.668 | **0.263** | 0.107 | 0.303 | 0.661 | 0.366 | **0.053** |
| **+1.060 (band top)** | 0.341 | 0.690 | **1.000** | true | 0.887 | 0.866 | 0.648 | 1.117 | 0.303 | 0.831 | 0.649 | 0.283 | 0.106 | 0.301 | 0.651 | 0.349 | **0.047 ← darkest** |
| +1.0 | 0.340 | 0.689 | 0.972 | true | 0.914 | 0.869 | 0.644 | 1.118 | 0.300 | 0.834 | 0.637 | 0.295 | 0.105 | 0.300 | 0.643 | 0.345 | 0.054 |
| +0.5 | 0.260 | 0.527 | 0.014 | true | 0.999 | 0.880 | 0.626 | 1.119 | 0.292 | 0.846 | 0.596 | 0.335 | 0.105 | 0.303 | 0.610 | 0.305 | **0.301** |
| **+0.4584 (gate)** | 0.250 | 0.506 | **0.000** | **false→** | 1.000 | (stale) | 0.625 | 1.119 | 0.291 | 0.847 | 0.592 | 0.338 | 0.105 | 0.304 | 0.606 | 0.302 | 0.302 |
| +0.36 | 0.227 | 0.460 | 0 | false | 1.000 | (stale) | 0.623 | 1.120 | 0.290 | 0.848 | 0.589 | 0.342 | 0.105 | 0.305 | 0.601 | 0.295 | 0.295 |
| 0 | 0.180 | 0.365 | 0 | false | 1.000 | (stale) | 0.620 | 1.120 | 0.288 | 0.850 | 0.580 | 0.350 | 0.105 | 0.312 | 0.577 | 0.283 | 0.283 |
| **−0.1403 (B)** | **0.145** | **0.295** | **0** | **false** | 1.000 | (stale) | 0.619 | 1.120 | 0.288 | 0.850 | 0.579 | **0.356** | 0.105 | 0.316 | 0.569 | **0.277** | **0.277** |
| −0.5 | 0.000 | 0.000 | 0 | false | 1.000 | (stale) | 0.611 | 1.123 | 0.286 | 0.848 | 0.570 | 0.413 | 0.105 | 0.326 | 0.548 | 0.258 | 0.258 |
| −1.0 | 0.000 | 0.000 | 0 | false | 1.000 | (stale) | 0.589 | 1.132 | 0.280 | 0.842 | 0.542 | **0.550** | 0.105 | 0.342 | 0.523 | 0.247 | 0.247 |

Anchor-table sources: `tuning.ts:879` `dayCurve` · `:896` `exposureCurve` · `:918` `hemiCurve` ·
`:962` `hazeCurve` · `:1182` `keyExtinctCurve` · `:1205` `skyLevelCurve` · `:1219` `afterglowCurve`
· `:128` `discLevelCurve` · `:1382` `buildingEmisCurve` · `:1395` `buildingEdgeCurve` ·
`:493` `minSunElevSin` · `:511` `fadeBandSin` · `:517` `groundOpacity` · `:1332`
`shadowFadeBandSin` · `:1337` `groundShadowDuskK` · `:1359` `afterglowGain` · `:336` `keyBrighten`.

Solar chroma applied at `keyChromaK` 0.85 (`tuning.ts:1193`): (1.000, 0.382, 0.037) at A →
(1.000, 0.194, 0.004) at B — the key is nearly monochrome red by frame B.

---

## 4. (a) Which terms make frame B BRIGHTER than frame A

### ULTRA (the owner's case)

| | A (+1.2975°) | B (−0.1403°) | B/A |
|---|---|---|---|
| **terrain that was in shadow** | **0.0531** | **0.2772** | **× 5.22** |
| terrain not in shadow | 0.3664 | 0.2772 | × 0.76 |
| sun-facing 30° slope | 0.4442 | 0.3346 | × 0.75 |
| dome afterglow term (× gain 1.15 × exposure) | 0.338 | 0.458 | × 1.36 |
| haze fraction | 0.825 | 0.850 | × 1.03 |
| exposure | 1.1160 | 1.1203 | × 1.004 |
| key intensity | 0.722 | 0.295 | × 0.41 |
| skyLevel | 0.668 | 0.579 | × 0.87 |
| dayK | 0.659 | 0.619 | × 0.94 |
| hemi | 0.307 | 0.288 | × 0.94 |

The lit surfaces darken correctly. **Everything that was in shadow brightens 5.2×.** On a
raking-sun mountain frame that is most of the pixels: at 70 % shadowed, the frame mean goes
0.171 → 0.294, **× 1.72**.

The "uniform pink wash" is two things at once: `hazeK` climbing to its 0.85 peak at 0°
(`tuning.ts:962-971`) while the tint ramp reaches **99.6 % `tokens.goldenHour`**
(`ULTRA.tintStopsDeg [10,0,−6,−16]`, `tuning.ts:997`), painted over a frame that has lost all
shadow structure; plus the additive dome band at `atmosphere.ts:286`, which is unbounded and
**turns the sun-side dome around** — it bottoms at 0° and rises 12 % again by −2°, while the
anti-solar dome keeps collapsing.

It is made worse by the taste pass: the overlay was at its **darkest ever** the frame before it
vanished. `duskK = 0.809` at A → `setShadowStrength` had just lerped 0.75 → **0.855** toward
`ULTRA.groundShadowDuskK` 0.88.

Note also that the wide and narrow bands **fight** in the last 0.6°: `duskK` deepens the overlay
opacity over `fadeBandSin` (3°) while `shadow.intensity` collapses over `shadowFadeBandSin` (0.6°),
and because the ground twins resolve through `getShadowMask()` (which multiplies by
`shadowIntensity`), the deepening **cannot** compensate. Net is release.

### BASE rig

The key never dims (2.025 flat), exposure/hemi/haze never move, and the sky dome's horizon band
rides `max(dayK, hGold)` (`atmosphere.ts:258`) with `hGold ≡ 1` from +9.79° down to −1.003° —
a constant-luminance, azimuth-blind pink ring whose `hazeCol` luminance actually **rises 8 %**
as it saturates toward `goldenHour × GOLDEN.castGain 1.3` (`atmosphere.ts:252`). The ground's own
golden cast is also pinned at full weight (`imageryGround.ts:708-710`, `graded *= goldenHour × 1.3`
at `gold = 1`). Only `dayK` falls (0.894 → 0.706). If the base rig had casters, its shadow release
would brighten the frame **3.5×** across the fade band (in-shadow ground 0.209 at +3.457° →
0.717 at the gate).

### The non-monotone bump, stated as one number

Under ULTRA the in-shadow ground falls to a minimum of **0.047 at +1.060°**, then jumps to
**0.302 at +0.4584°** — a **× 6.5 brightening in 0.60° of elevation ≈ 2.7 minutes**. That is the
"jump" the owner is seeing.

---

## 5. (b) Which terms remove the shadows, and where each hits zero

| term | file:line | base rig | ULTRA |
|---|---|---|---|
| `castShadow` hard flip | `StylizedTiles.ts:5946, 6094` | **+0.4584°** (geometric) | **+0.4584°** — identical; `SHADOWS.minSunElevSin` is not ULTRA-switched |
| cascades off (lockstep) | `:6175-6180` | n/a | +0.4584° |
| terrain casters detached | `:6226` | **never on** (`ultraOn &&`) | +0.4584° |
| `shadow.intensity` fade → 0 | `:6071`, `keyHandoff.ts:46` | 0 at **+0.4584°**, 1 at **+3.457°** (`fadeBandSin` 0.0523) | 0 at **+0.4584°**, 1 at **+1.060°** (`shadowFadeBandSin` 0.0105) |
| ground overlay opacity | `:6081`, `imageryGround.ts:1153` | flat 0.75; stale below the gate | 0.75 → 0.88 by `duskK`; **peaks at 0.880 exactly where it is deleted** |

Measured `shadow.intensity`:

| elev° | +3 | +2 | **+1.2975 (A)** | +1.06 | +1 | +0.7 | +0.5 | +0.4584 |
|---|---|---|---|---|---|---|---|---|
| base | 0.937 | 0.521 | **0.191** | 0.105 | 0.086 | — | 0.001 | 0.000 |
| ULTRA | 1.000 | 1.000 | **1.000** | 1.000 | 0.972 | 0.35 | 0.014 | 0.000 |

(The base 52 % @ +2° / 8.6 % @ +1° reproduce the figures recorded in
`DECISIONS_ARCHIVE.md:2015`, which validates the model.)

The `castShadow` flip is **not** the visible step — `aboveGateK` is exactly 0 at the gate by
construction, so both rigs reach zero continuously and RC2's "`castShadow` never flips at all"
claim is true. **The visible step is the fade band being far too narrow relative to how much direct
light survives past it**: under ULTRA, `directK` is still **0.250** when the field hits zero.

### Timing, against true sunset (geometric centre −0.833°)

| event | geometric | apparent | minutes before true sunset |
|---|---|---|---|
| base fade starts | +3.457° | +3.68° | 19.6 |
| ULTRA fade starts | +1.060° | +1.46° | 8.6 |
| **shadows gone (both rigs)** | **+0.4584°** | **+0.95°** | **5.9** |
| frame A | +1.2975° | +1.67° | 9.7 |
| frame B | −0.1403° | +0.47° | 3.2 |
| `keyExtinctCurve` = 0 | −0.5° | +0.07° | 1.5 |
| **true sunset (upper limb)** | **−0.833°** | 0 | 0 |

---

## 6. (c) What physically SHOULD happen, in numbers

- The sun's **upper limb** sets at geometric centre elevation **−0.833°** (34′ refraction + 16′
  semidiameter). Between +0.46° and −0.833° the disc is fully visible, the ground is directly lit,
  and shadows must exist and must lengthen. Currently they are gone for the last **5.9 minutes**
  of visible sunlight.
- Everything should fall monotonically. It does not: `afterglow` × 2.1 from A to −1°, `haze` +3 %,
  `exposure` +0.4 %, and the shadow release × 5.2.
- The proper gate is `sin(−0.833°) = −0.014544`, with the fade band ≈ the disc diameter (0.53°) so
  the field softens as the horizon bisects the disc, not 3° (base) or 0.6° (ULTRA) above it.

### But moving the gate alone does not fix it — the shadow budget

This is the most important arithmetic in the report. The shadow overlay is a **multiplier on the
whole composite**, not on the direct arm. Requiring that the in-shadow ground not brighten when the
field is released — `flat(e_gate)·exp ≤ flat(1.06°)·exp·(1 − ovl·sI)` — gives a hard ceiling on
the overlay:

| gate | un-shadowed ground there | max `ovl × shadow.int` allowed | shipped (0.866) is over-dark by |
|---|---|---|---|
| **+0.4584° (shipped)** | 0.302 | **0.134** | **× 6.45** |
| 0° | 0.283 | 0.190 | × 4.56 |
| −0.1403° | 0.277 | 0.205 | × 4.22 |
| −0.3° | 0.267 | 0.235 | × 3.69 |
| −0.5° | 0.258 | 0.260 | × 3.34 |
| **−0.833° (true sunset)** | 0.251 | 0.280 | × 3.10 |
| −2° | 0.213 | 0.388 | × 2.23 |
| −4° | 0.167 | 0.523 | × 1.66 |
| −6° | 0.111 | 0.682 | × 1.27 |

So a gate at −0.833° still leaves a **3.1× over-dark overlay**, and simply moving it (verified by
simulation) shifts the step later without removing it: gate −0.5° gives 0.035 → 0.258 (× 7.3),
gate −0.833° gives 0.033 → 0.251 (× 7.5).

**The physically correct model is monotone at every elevation.** If the shadow removes only the
direct arm — `(1 − groundAmbientK 0.68) · directK · lambert`, `imageryGround.ts:648-657` — then:

| elev° | lit ×exp | ambient-only ×exp | shadow depth ratio |
|---|---|---|---|
| +30 | 0.946 | 0.872 | 0.922 |
| +6 | 0.759 | 0.718 | 0.946 |
| +3 | 0.560 | 0.531 | 0.949 |
| +1.63 | 0.402 | 0.385 | 0.959 |
| +1.06 | 0.349 | 0.336 | 0.963 |
| +0.4584 | 0.302 | 0.293 | 0.971 |
| −0.1403 | 0.277 | 0.272 | 0.983 |
| −0.5 | 0.258 | 0.258 | 1.000 |
| −0.833 | 0.251 | 0.251 | 1.000 |
| −6 | 0.111 | 0.111 | 1.000 |

Both columns strictly decreasing, and the two converge naturally at −0.5° where `directK` = 0 —
i.e. the field can be released **anywhere** with no visible step.

---

## 7. Why "a below-horizon sun projects garbage", and what a −0.83° gate needs

The comment (`tuning.ts:490`, echoed at `:427-430` and quoted in `bestspot/BESTSPOT_PLAN.md:114`)
is about **projection degeneracy, not clipping**. Each candidate, checked with numbers at the
Everest FPV pose (eye 30 m, near-level look ⇒ `viewDistM` = `horizonDistanceM(30, WGS84_A)` =
19 562 m; base fit half-extent 5 000 m / push 4 200 m; ULTRA fit half-extent 10 688 m / push
9 781 m):

| candidate failure | verdict |
|---|---|
| near-plane clipping | **No.** Base `near = max(1, 8000−3500−5000) = 1`, `far = 16 500`. ULTRA `near = 60000−30000−10688 = 19 312`, `far = 100 688`. Depth along the light axis is `D − x`; at the box edge that is 49 312 — comfortably inside. Cascades set `lightDist = half+relief+clear`, `near = clear` by construction (`shadowCascade.ts:100-118`). |
| light below the terrain | **Harmless for an ortho camera** — translating along the view direction only shifts the depth range, never the projection. At −0.833° the light sits **116 m** (base, `lightDistM` 8 000) / **872 m** (ULTRA, `lightDistM` 60 000) below the focus tangent plane, while Earth drops only **9 m** over the 10.7 km box. Nothing is clipped. |
| self-shadow acne at grazing | **Already handled.** `ULTRA.terrainDepthOffset: 2` (`tuning.ts:1082`) is a slope-scaled polygon offset on the terrain casters' own depth material, precisely because "terrain is a single-sided sheet that both casts and receives … the global `bias`/`normalBias` cannot fix it without peter-panning the BUILDING shadows". |
| **shadow-length degeneracy** | **This is it.** A 100 m caster's shadow: **1 908 m at +3°**, 5 405 m at +1.06°, **12 499 m at the gate** — already 58 % of the 21 376 m ULTRA box — 28 648 m at +0.2°, 57 296 m at +0.1°, **infinite at 0°**. At negative elevations the ray travels *upward* while a curved surface falls away, so it never lands on open ground; it lands only on facing slopes, as kilometre-scale hard-edged slabs thrown from the box edge — "that super elongated naive shadows we fixed before". |
| **the planet's own terminator is not modelled** | Below −0.833° the focus is in Earth's shadow, but the only occluders in a local ortho box are local relief. `keyExtinctCurve` reaching 0 at −0.5° is the stand-in for that missing global term. |
| **one `_focusUp` for the whole box** | "Sun elevation" is not a single number across the box. The up vector rotates 0.045° over 5 km, 0.096° over 10.7 km, 0.162° at `maxBoundsM` 18 km, 0.539° at 60 km and **2.336° over the 260 km cascade** — larger than the whole ULTRA fade band (0.60°). |

**What a −0.83° gate needs:** (i) a shadow-**length** bound rather than an elevation bound — fade
the field on projected length (`h/tan ε` against the live `shadowBoundsM`), which degrades
gracefully and stays well-defined at ε ≤ 0; (ii) the overlay bounded by the direct fraction (§6),
or the release is visible wherever the gate goes; (iii) below 0°, the correct answer is a *global*
terminator term (everything → ambient), not a longer box.

**Geometric vs refracted:** the direction is geometric (`bodies.ts:101,139`). Do **not** refract
`sunDirW` — it also anchors the sun impostor, the eclipse geometry (`StylizedTiles.ts:5726`) and
every shader's `uFtwSun`/`uSunDir`. Move the anchor tables instead; they already declare themselves
airless (`lightBands.ts:32-33`, "the same convention as `lib/ephemeris/twilight.ts`, which is
airless by contract").

---

## 8. History — regression or shipped-as-designed?

**Shipped-as-designed, and already reopened by the owner.**

### DECISIONS dating

| tunable / behaviour | shipped | entry | rig |
|---|---|---|---|
| `minSunElevSin` 0.03 → **0.008** | **2026-07-13** | `DECISIONS_ARCHIVE.md:555` — "`minSunElevSin` 0.03→0.008 (~0.46°: shadows persist through the golden/dusk hour … while staying above the horizon so no garbage)" | **base** (ULTRA inherits) |
| owner-VERIFIED illumination pass | 2026-07-13 | `DECISIONS_ARCHIVE.md:553`; digest `DECISIONS.md:219` | base |
| the gate doubles as the sun→moon **source switch** | 2026-07-11 | `DECISIONS_ARCHIVE.md:590` (Phase 5.5 S5) | base |
| the snap root-caused as charter bug **B3** | 2026-08-25b | `DECISIONS_ARCHIVE.md:2210` — "`castShadow` is a one-frame BOOLEAN at sun elevation +0.46° … fired at the key's daily MAXIMUM (1.5 × golden 1.35 = 2.025)"; "ULTRA shares the gates (its exposure ramp slightly **AMPLIFIES** the step)" | base |
| **`fadeBandSin` 0.0523** + `lib/globe/keyHandoff.ts` (RC2) | **2026-08-25c** | `DECISIONS_ARCHIVE.md:2208` | base |
| `keyExtinctCurve` / `skyLevelCurve` / `afterglowCurve` / `lib/globe/duskLight.ts` | **2026-08-27b** | `DECISIONS_ARCHIVE.md:2032` | **ULTRA-only** |
| **`shadowFadeBandSin` 0.0105 + `groundShadowDuskK` 0.88** (the AB4 verdict) | **2026-08-27c** | `DECISIONS_ARCHIVE.md:2015`; extension list `:2019` | **ULTRA-only** |
| `exposureCurve` (ULTRA S11) | 2026-08-22j | `DECISIONS.md:387-389` | ULTRA-only |
| byte-identical-`high` law | origin 2026-07-12 | `DECISIONS_ARCHIVE.md:567`; standing form `DECISIONS.md:431-432` ("relaxing either needs an owner ruling"); owner restatement `NEXT_SESSION_PROMPT.md:48`; machine-checked `test/lib/globe/quality.test.ts:207-260` | — |

The 2026-08-27c entry, verbatim (`DECISIONS_ARCHIVE.md:2015`):

> "**CAST SHADOWS** ("should become darker and more global"): `sunLight.shadow.intensity =
> aboveGateK(sunDot, KEY_GATE)` faded the whole field over sin(3°) — measured **52 % by +2° and
> 9 % by +1°**, the exact band where a raking shadow is the most dramatic thing in the frame. That
> loss was recorded on `SHADOWS.fadeBandSin` as owner A/B item **AB4**, deferred for a verdict; the
> verdict is now in. The band cannot be deleted — it also hides the sun→moon SOURCE SWITCH, which
> teleports the rig's direction at `minSunElevSin` — so ULTRA gets its own NARROW band
> (`shadowFadeBandSin` sin(0.6°)) for the shadow field alone, still exactly 0 AT the gate, while
> the key trough and the moon takeover keep the wide one."

### Git evidence — the path is byte-frozen since 2026-08-27

```
git log -S"shadowFadeBandSin" -- src/components/globe/tuning.ts
  47d844d 2026-08-27   ← the only commit
git log -S"keyExtinctCurve"   -- src/components/globe/tuning.ts
  47d844d 2026-08-27   ← the only commit
git log -S"fadeBandSin"       -- src/components/globe/tuning.ts
  47d844d 2026-08-27 · e25a21c 2026-08-26
git log -S"minSunElevSin"     -- src/components/globe/tuning.ts
  47d844d 2026-08-27 · e25a21c 2026-08-26 · d6d73e8 2026-07-11 · 086c63c 2026-07-10
```

`git diff 47d844d..HEAD -- src/components/globe/tuning.ts` filtered for
`minSunElev|fadeBand|keyExtinct|afterglow|skyLevel|groundShadowDusk|hemiCurve|exposureCurve|hazeCurve|dayCurve|keyBrighten|groundOpacity|lightDistM|discLevel`
→ **empty**. The same diff on `StylizedTiles.ts` filtered for
`sunLight.|shadow.intensity|castShadow|aboveGateK|setShadowStrength|ultraDirectK|goldenK|setTerrainCast|toneMappingExposure|hemiLight`
returns **only debug-provider read-outs**. Per-file commit counts: `duskLight.ts` = 1 (47d844d),
`shadowCascade.ts` = 1 (47d844d), `terrainSkirt.ts` = 1 (47d844d), `keyHandoff.ts` = 1 (e25a21c,
2026-08-26), `lightBands.ts` = 1 (5d61050, 2026-08-22).

The only two later commits touching the light path at all:
- `2d38658` (2026-09-01, DBG chip) — read-only HUD readouts `exposure`, `keyLevel`, `directK`,
  `skyLevel`, `afterglow`, `shadow.casting`, `shadow.mapPx`. **No light change.**
- `8b67018` (2026-09-02, MESH SUITE MS6) — one line piping the *existing* dusk terms onto user
  GLBs (`userModels.setUltraHaze(...)`). Consumes, does not alter.

Note that `47d844d`'s squash title says only "BEST SPOT PARKED"; both 2026-08-27b and 2026-08-27c
landed inside it (57 files, +5 904/−120, incl. `duskLight.ts` +145 new, `shadowCascade.ts` +204 new,
`tuning.ts` +399, `verify-ultra-dusk.mjs` +280 new, `probe-dusk.mjs` +154 new).

### The owner has already refused this round

`DECISIONS_ARCHIVE.md:1866-1869`, entry **2026-09-01**:

> "**The 2026-08-27b/c shadow work did NOT fully fix the owner's issue** — the topic re-opens in a
> later session; do not treat that round as closing it."

Restated at `DECISIONS.md:450` and `NEXT_SESSION_PROMPT.md:75` ("The shadow issue is not closed
(T65–T70 queue behind it)"). So the correct characterisation is: **not a regression; the
explicitly reopened shadow issue, whose deciding commit is `47d844d`.**

### RC2's own verification measured the wrong quantity

`DECISIONS_ARCHIVE.md:2208` (2026-08-25c):

> "Browser-measured across 103 samples from sun +4.21° to −1.28°: shadow field
> **1.000 → 0.0000 → 0.601**, largest single-step change **0.0270** … trough at sun elevation
> **0.426°** … and `castShadow` never flips at all."

103 samples across the band — every one measuring the *continuity of `shadow.intensity`*, never
the *brightness of the frame*. The step it certified as smooth is exactly the release that makes
the scene 5.2× brighter.

### AB provenance (`.claude/claude-docs/rendering/RENDERING_CHARTER_2026-08-25.md:296-304`)

- **AB1** (`:298`) — "promote the twilight band curve to baseline + give the sun key an elevation
  term so it actually dies below the horizon + decide the phantom night key" — **OPEN**. This is
  the base rig's flat 2.025 key.
- **AB4** (`:301`) — "RC2's look change: shadows now fade over the last ~3° of sun — confirm the
  raking-shadow loss is acceptable." Verdict 2026-08-27c: *no* → **ULTRA only**; the base rig kept
  sin(3°) under the byte-identical-`high` law.
- **AB5** (`:302`) — ULTRA taste knobs.
- **AB7** (`:304`) — "Terrain shadows outside ULTRA: keep the split (current design)" → base has no
  terrain casts.
- `track3-lighting.md:114` states the surviving base defects plainly: "hemisphere ECEF +Y (AB2);
  **key never dies (AB1); shadows die from +3.5° (AB4); terrain never casts outside ULTRA (AB7)**."

---

## 9. The minimal fix set

Ordered by defect-per-line. All ULTRA-only unless flagged; each is byte-identical with the chip off
because `ultraOn` already selects the profile at `StylizedTiles.ts:6071` / `:6080`.

### F1 — bound the ground shadow overlay by the direct fraction
*The one fix that removes the brightening at any gate.*

- **Anchor:** `src/components/globe/StylizedTiles.ts:6081-6088` — multiply the `setShadowStrength`
  result by a normalised `ultraDirectK`; or, in the shader, apply the overlay to the direct arm
  only (`src/components/globe/scene/imageryGround.ts:648-657`).
- **Byte-identical-`high`:** yes — wrap in `ultraOn ?`; `duskK` is already 0 with the chip off.
- **Falsification:** extend `test/components/globe/duskShadeRatio.test.ts` with an in-shadow twin
  and assert it is **monotone decreasing** over `[+3, +2, +1.06, +0.5, +0.4584, 0, −0.5]`. Today it
  rises 0.047 → 0.302 between +1.06° and +0.4584°.

### F2 — move the shadow gate to true sunset, ULTRA-only

- **Anchor:** new `ULTRA.shadowGateSin: -0.014544` (sin −0.833°) beside
  `src/components/globe/tuning.ts:1332`; consume at `StylizedTiles.ts:5946` (`sunUp`) and as
  `gateSin` in **both** `KEY_GATE` (`:3092`) and `ULTRA_SHADOW_GATE` (`:3102`) when `ultraOn`.
- **Why both:** they must move together, or `test/lib/globe/keyHandoff.test.ts`'s "both arms reach
  zero at the gate" invariant breaks and the sun→moon direction teleport becomes visible.
  `moonShadows` is `!sunUp`-gated (`StylizedTiles.ts:5950`), so the two arms stay mutually
  exclusive automatically.
- **Byte-identical-`high`:** yes.
- **Falsification:** `__globe.ultraLook().shadow.casting` must still be `true` at
  `ultra.sunElevDeg = −0.5`, and `false` at `−1.0`.

### F3 — widen the ULTRA fade band to the disc

- **Anchor:** `src/components/globe/tuning.ts:1332` `shadowFadeBandSin: 0.0105` → ≈ `0.0093`
  anchored on the new gate, so the field fades over −0.833° → −0.30° (the half-degree the horizon
  takes to eat the disc) instead of dying 5.9 min early.
- **Byte-identical-`high`:** yes — the constant is only read at `StylizedTiles.ts:3102`.
- **Falsification:** sample `__globe.ultraLook().cascades[0].intensity`
  (`StylizedTiles.ts:3824`, `= sunLight.shadow.intensity` at `:6185`) on a 30 s ladder from +2° to
  −1.5°; it must be ≥ 0.9 down to −0.4°.

### F4 — stop the afterglow outliving its own sky

- **Anchor:** `src/components/globe/scene/atmosphere.ts:286` adds
  `dirCol · hzA · afterglowGain 1.15 · uFtwAfterglow · sunSide · uFtwDirK` with no ceiling, while
  `ULTRA.afterglowCurve` (`tuning.ts:1219`) rises 0.263 → 0.356 → 0.550 and
  `skyLevelCurve` (`:1205`) falls. Multiply the additive band by `uFtwSkyLevel`, or clamp
  `ULTRA.afterglowGain` (`:1359`).
- **Byte-identical-`high`:** yes — the whole block is gated on `uFtwDirK > 0.0`.
- **Falsification:** `ultra.afterglow × ultra.skyLevel` must be monotone across the ladder; today
  `ultra.afterglow` alone rises × 2.1 from A to −1°.
- **Caveat:** the afterglow is *deliberately* the one non-monotone curve in the model
  (`duskLight.test.ts:178-186`); this is a taste call, not a bug fix. It belongs to T66.

### F5 — AB1 (needs an owner ruling; breaks byte-identical-`high`)

- **Anchors:** `StylizedTiles.ts:6046` (base key flat at 2.025 with `goldenK ≡ 1`) and
  `src/components/globe/scene/atmosphere.ts:258` (the dome's `max(dayK, hGold)` band).
- These are the *deliberately preserved* defect. `test/components/globe/duskShadeRatio.test.ts:120-131`
  pins it: "with the chip off the ratio is the legacy dayGradMin ramp diluted by the night floor, so
  it can only ever RISE toward 1 as the sun sets — **the defect, preserved exactly**."
- No fix is possible under the current law. This is charter AB1.

---

## 10. Debug-feed inventory

### Present — `src/lib/globe/debugCatalog.ts`, provider registered at `StylizedTiles.ts:3976`

`ultra.on` (:352) · `ultra.settled` (:359) · **`ultra.sunElevDeg`** (:366) · `ultra.exposure` (:374)
· `ultra.keyLevel` (:382) · `ultra.directK` (:390) · `ultra.skyLevel` (:397) · `ultra.afterglow`
(:404) · `ultra.haze` (:411) · **`ultra.shadow.casting`** (:418) · `ultra.shadow.mapPx` (:425) ·
`ultra.shadow.mPerTexel` (:432) · `ultra.shadow.coverM` (:439) · `ultra.shadow.viewFitM` (:446) ·
`ultra.cas1.active` / `.ageMs` (:453, :460) · `ultra.cas2.active` / `.ageMs` (:469, :476) ·
`ultra.terrainCensus` (:1325) · `ultra.anisoCensus` (:1331) · `astro.sunElevDeg` (:1065).

Richer shapes via `__globe.ultraLook()` (`StylizedTiles.ts:3758`):
`.dusk.{skyLevel, directK, afterglow, hazeCool, keyLevel, keyCol, sunDiscExtinct, domeSkyLevel}`
(`:3770-3779`) · `.shadow.{mapPx, radius, bias, normalBias, boundsM, near, far, casting,
biasMetres, viewFitM, focusOffsetM, metresPerTexel}` (`:3788-3807`) ·
`.cascades[i].{casting, active, boundsM, near, far, radius, intensity, normalBias, biasMetres,
metresPerTexel, lightIntensity, ageMs}` (`:3816-3830`) · `.shadowCoverM` (`:3832`) ·
`.terrain` (`:3848`).

### Missing — and this is why the defect was invisible

There is **no id for `sunLight.shadow.intensity`** and **none for the ground `ShadowMaterial`
opacity**. The only readable copy anywhere is `__globe.ultraLook().cascades[i].intensity`
(`:3824`), which exists only while a cascade light exists and is `active`.

**Add `ultra.shadow.intensity` and `ultra.shadow.groundOpacity`.** Those two numbers turn this
argument into a graph.

### The existing harnesses are blind to this class of defect

`scripts/verify-ultra-dusk.mjs:206-213` is a **time** ladder, not an elevation ladder. Measured
elevations at its five stamps (`ULTRA_ARCHITECTURE.md:429-435`): **+26.8° / +9.5° / +3.4° / −0.5° /
−5.4°**. Consecutive samples straddle a **3.9° gap** containing the entire ULTRA release band
(+1.06° → +0.46°, ≈3 min) *and* the whole lower half of the base band. Its dusk leg reads only
`look.dusk` (`:219`), which does not contain `shadow.intensity`; the shadow numbers live in a
separate `look.shadow` the sequence never touches, and that object does not expose `intensity`
either. So `mono("skyLevel")` and `mono("directK")` (`:238-242`) would **pass** even if the ladder
sampled inside the band. Its `keyLevel < 0.2` check (`:248`) is evaluated at −0.5°, after the
release. Screenshots are taken (`:220`) but nothing asserts on them.

`scripts/probe-dusk.mjs` is the closer instrument and the cheapest fix: `:93-112` draws the canvas
to a 320×180 offscreen and returns Rec.709 mean luma for two windows — `sky: band(20,70)` and
**`ground: band(105,165)`**, exactly what this defect needs. But it uses the same coarse timestamps
(`:80-88`) and **asserts nothing**: no `check()`, no threshold, `process.exit(0)` at `:154`.

**Cheapest falsification for F1–F4:** add three samples to `probe-dusk.mjs`'s ladder at geometric
+1.5° / +0.9° / +0.2°, promote its `groundLuma` to a `check()`, and assert monotone non-increasing.
Today that fails by **× 5.2** between +1.06° and +0.46°, and no test in the suite can see it.
`ENGINE_STATE_2026-09-02.md:116` already concedes the general form: "**No harness asserts temporal
stability** (no shimmer/pop metric exists)."

---

## 11. Backlog coverage — `.claude/skills/frame/references/tracked-backlog.md`

| finding | already tracked? |
|---|---|
| Afterglow keyed on **geometric** elevation (§1, §7) | **T68** (`:94`) — "`ULTRA.afterglowCurve` is evaluated at the GEOMETRIC solar elevation, so a sun hidden behind a ridge at +2° geometric produces no afterglow at all", with a shippable `lib/geo/horizonProfile` subset. Covers the *terrain-horizon* half; it does **not** name the 0.83° refraction + semidiameter offset. |
| `keyExtinctCurve` / `skyLevelCurve` / `afterglowCurve` levels (F4) | **T66** (`:92`) — "the dusk model's taste knobs … all shipped and coherent, none owner-judged"; also flags `hemiCurve` and `hemiTintK` as re-anchored and deserving a second opinion. |
| Key non-monotonicity from `GOLDEN.keyBrighten` × extinction | **T67** (`:93`) — "peaks the key at ×1.29 around 9°… nobody has judged the product". Confirmed here: `goldenK ≡ 1` from −1.003° to +9.79°. |
| Far-field contrast erased by `ftwAerial` (the pink wash's second half) | **T69** (`:95`) — "beyond ~5 km a wall in full sun and a wall in total shadow are the same colour to within one 8-bit code value"; proposes `hazeMaxK` as a curve. |
| Cascade VRAM / reach A/B | **T65** (`:91`) — not this defect. |
| `atmosphere.ts` frame mismatch in the dome's Mie lobe (≤0.19°) | **T70** (`:96`) — cosmetic. |
| Base rig's key that never dies | **AB1**, `RENDERING_CHARTER_2026-08-25.md:298` — OPEN. |
| Shadows fading over the last 3° | **AB4**, `:301` — verdict 2026-08-27c, ULTRA-only. |
| Base rig has no terrain casts | **AB7**, `:304` — "keep the split (current design)". |
| The parent umbrella | T65–T70 all read "queued behind **the shadow issue**" — i.e. this. |

**Not tracked anywhere (new debt):**
1. the `minSunElevSin` gate firing 5.9 minutes before true sunset (both rigs);
2. the shadow-overlay-vs-direct-fraction mismatch (§6) — the reason moving the gate cannot fix it;
3. the non-monotone in-shadow brightness at +1.06° → +0.46° (× 6.5);
4. the missing `ultra.shadow.intensity` / `ultra.shadow.groundOpacity` debug ids;
5. `verify-ultra-dusk.mjs`'s inability to sample or measure the band.

**One correction to the record:** T66 says `afterglowCurve` has "peak 0.55 at −2°". The shipped
table is **0.75 at −2°**, 0.55 at −5° (`tuning.ts:1222,1227`). 0.55 was the *measured civil-band
value* from the 2026-08-27b sweep, not a curve anchor. All numbers in this report use the shipped
table.

---

# Gaps

1. **No pixels were measured.** Everything is the shipped tables and expressions evaluated
   analytically (esbuild-bundled real modules for the scalars; the `duskShadeRatio.test.ts` JS twin
   for the ground). Slope, tile albedo, bloom and the tone-map curve are not in the model, so
   absolute levels are proxies; ratios and monotonicity are not affected. A browser run at both
   timestamps reading `__globe.ultraLook()` would close this.
2. **ULTRA-on is inferred**, from "terrain shadows exist at all" (`setTerrainCast` is
   `ultraOn`-gated, `StylizedTiles.ts:6226`). If the owner somehow had buildings in frame, base is
   possible — both tables are given regardless. If it *was* base, the relevant frozen date is
   2026-08-26 (`e25a21c`), not 2026-08-27.
3. **The shadowed fraction of the frame is assumed** (0.4 / 0.6 / 0.7 sampled). The 5.22×
   in-shadow figure is exact; the frame-mean 1.72× depends on that assumption.
4. **`dark01 = 0`** and `alt` ≈ 30 m for the shadow fit. Under the dark CARTO drape the overlay
   uses `DRAPE.shadowOpacity` 0.8 and haze is halved (`ULTRA.hazeDarkK` 0.55) — direction
   unchanged, magnitudes shift.
5. **The "garbage" diagnosis in §7 is reasoned from geometry, not observed.** Clipping and acne are
   ruled out with numbers; the shadow-length degeneracy is arithmetic. "What it actually looks like
   at −0.5°" still needs one browser run with the gate temporarily lowered.
6. **`ShadowMaterial` is modelled as `1 − opacity·mask`.** It is `NormalBlending` toward
   `tokens.water` (a near-black slate, `imageryGround.ts:760-764`), not pure black, so the true
   darkening is slightly less than modelled.
7. **Anti-solar / azimuth terms are only partly in the ground twin** (`groundAmbientAzK` yes, the
   dome's directional arm no). The owner is looking *at* the sun — the sun-side half where the
   afterglow and the Mie lobe are strongest — so the afterglow figures here are if anything
   conservative.
8. **Colour management** was not verified (`THREE.ColorManagement`), so absolute luminances could
   be off by a gamma. Ratios and monotonicity are unaffected.
9. **The DECISIONS prose was mined by a delegated agent** with a Python context-window extractor
   (the files are 75 KB / 911 KB with multi-KB single lines). Line numbers and quotes are as
   reported by that sweep; the git evidence in §8 was gathered and verified directly and is
   independent of it.
10. **Bloom was not traced.** The sun disc's `uHaloK = discLevel²` collapses to ~0.011 by +0.36°, so
    bloom is losing energy, not gaining — but the pinned base-rig horizon band was not checked
    against `BLOOM.threshold`.

---

**Confidence: 89%** — very high on the code trace, the line citations, the anchor-table evaluation
(real modules, not transcribed), the geometric-vs-refracted elevations, and the history verdict
(git-proven three ways); high on the shadow-cliff diagnosis, the shadow-budget arithmetic and the
harness-blindness analysis; moderate on the absolute luminance proxies and on the below-horizon
failure mode, which is geometric inference rather than an observed frame.
