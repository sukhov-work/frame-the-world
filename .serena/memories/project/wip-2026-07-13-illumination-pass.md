# Illumination pass — crisp shadows + sun/moon golden-hour GI + cyberpunk windows (2026-07-13)

Owner ask: bring back CRISP shadows + MORE golden-hour dusk global illumination from BOTH sun AND moon,
sunrise/sunset + smooth day/night dynamics, realistic-but-stylized cyberpunk. Believed a prior "yellow
building faces" rework deleted it. Gates: **astro check 0/0 · vitest 422 · wix build Complete. Runtime =
BROWSER-UNVERIFIED** (esp. the building GLSL — a shader compile/link error only surfaces over Dnipro tiles;
this is the #1 risk). Designed via a 5-agent understand+design workflow.

## UPDATE 2026-07-13 (later) — WINDOWS REMOVED, shadow refocus (owner: "remove windows emulation, never
asked for this, looks junky… what I need is buildings casting nice shadows on the ground and other building")
- The procedural window GRID is GONE (reverted scene/buildings.ts to the dormant R3 flat emissive, gain 0;
  removed vertex vFtwLPos/vFtwObjUp, the dFdx/dFdy per-wall grid, uFtwWindowCool, and the 6 BUILDINGS window
  tunables; `nightWindowGain` 0.4→0). Buildings carry NO night emissive by design — night identity = dark
  mass + lit edges + cast/received SHADOWS + golden/moon key. "Cyberpunk" = the moody dramatic-shadow
  aesthetic, NOT lit-window textures (my earlier over-interpretation).
- Building-shadow focus: `SHADOWS.normalBias` 1.0→0.75 (anchor shadows to bases — kill peter-panning
  "floating" look; still covers ~0.5 m float32 acne; revert to 1.0 if acne) + `SHADOWS.radius` 1→2 (revert
  to the verified soft edge). Building→ground shadows already stronger via DRAPE.shadowOpacity 0.80; building
  →building via receiveShadow (contrast capped by the dark palette — a browser-tune call, not a code bug).
- So the shader-heavy §"Cyberpunk windows" change below and checklist item 6 are SUPERSEDED/void. The rest
  of the pass (crisp shadows + sun/moon golden GI + night fill) stands and is still browser-UNVERIFIED.

## UPDATE 2026-07-13 (§shadow-gating) — "still not a single cast shadow" ROOT-CAUSED (owner screenshot @ 20:46
local / 1% new moon). The shadow PIPELINE was never broken (renderer.shadowMap.enabled per tier, castShadow/
receiveShadow, ShadowMaterial ground twins all fine). Two independent GATING reasons for that view:
(1) TIME — sun ≈ +0.7° (near sunset) < `SHADOWS.minSunElevSin` 0.03 (~1.7°) + 1% new moon (< moonMinIllum 0.6)
→ no caster above threshold. (2) REGION — the shadow ortho was a FIXED ±1600 m patch around screen-centre
(street tuning) → at an oblique CITY zoom most buildings sit OUTSIDE it → no shadow even at midday.
FIX: `minSunElevSin` 0.03→0.008 (shadows persist through golden/dusk, stays above horizon) + ALTITUDE-ADAPTIVE
bounds (StylizedTiles.stepKeyLightAndShadow: half-extent = clamp(alt×`boundsAltK` 0.6, boundsM 1600,
`maxBoundsM` 5000); depth near/far extended with it). NEW SHADOWS tunables: boundsAltK 0.6, maxBoundsM 5000.
Gates green; BROWSER-UNVERIFIED — confirm dusk shadows appear + tune boundsAltK/maxBoundsM vs the visible
extent; a new/low moon still correctly casts nothing (scrub to a fuller moon or daytime). LESSON: "no shadows"
at city zoom = the fixed ortho patch, not a pipeline bug; golden-hour shadows need the sun-elevation gate low
enough to overlap the golden band.

## UPDATE 2026-07-13 (§shadow-governor) — THE REAL "no shadows" BUG, owner-CONFIRMED via live diagnostic.
The gate/bounds fix above did NOT fix it (owner: "still not a single shadow"). A live `window.__globe` console
dump proved it: `tier:'low'`, `shadowMapEnabled:false`, `hasShadowMap:false` — WHILE `sunCastShadow:true`,
`14/14` buildings casting, `32` ground shadow-twins ready. So the whole shadow PIPELINE is correct; the
runtime FRAME GOVERNOR threw the M3 Pro to tier `low`, and `low.shadowsEnabled=false` disables
`renderer.shadowMap.enabled` → no shadow map is ever rendered, at any time/zoom. The governor over-degraded
the reference machine (retina DPR 2 + the heavy street scene can't hold the 22 ms/45 fps budget → high→mid→low).
FIX (2 parts): (A) shadow enable + map size follow the DEVICE tier, decoupled from the governor —
`GlobeCanvas.applyTier` no longer sets `renderer.shadowMap.enabled`/size (set once at init from `deviceTier`);
a capable machine keeps shadows even when the governor sheds DPR/bloom/tiles. (B) governor FLOOR —
`makeGovernor(initial,cfg,ceiling,floor)`; GlobeCanvas passes `floor = deviceTier==='high' ? 'mid' : 'low'`
so a strong device never collapses below `mid` (keeps bloom + DPR 1.5 + shadows). Files: GlobeCanvas.tsx,
lib/globe/quality.ts (+floor test). Gates: astro check 0 · vitest 423 · wix build. Root cause CONFIRMED
(live); visual BROWSER-UNVERIFIED (Playwright blocked by a Vite 504 optimize-dep desync from this session's
`wix build` runs — needs a `wix dev` restart, client reload can't clear it). LESSON: shadows/bloom are core
looks, NOT frame-rate-degradable levers — the governor must throttle DPR/tile-detail, never disable them on a
capable device; "M3 Pro stays capable" was the quality pass's intent and the governor was violating it.

## Diagnosis — NOTHING was deleted; illumination was SOFTENED across 3 passes (cited)
- **Sun shadow presence cut in the DEFAULT view**: `DRAPE.shadowOpacity` 0.9→0.62 (S7 "jarringly black
  ground"). The normal dark-drape city view blends toward DRAPE.shadowOpacity (StylizedTiles.ts:1677-79),
  NOT the crisp `SHADOWS.groundOpacity` 0.75 — THIS is why shadows read faint. The RIG is already crisp
  (4096²/0.78 m·texel/radius 2).
- **Dusk sky golden lost >half its budget** as collateral: `ATMOSPHERE.skyHorizonGain` 0.35→0.16 (bloom
  white-out fix), and the sky's golden warming multiplies that gain (atmosphere.ts:151).
- **Dark-of-moon night fill regressed**: `SUN.hemiIntensity` 0.4→0.25 "when moonlight landed", but all moon
  terms are phase-gated by moonKs (~0.05 near new moon) → low-phase nights lost the fill; only ambientNightK
  0.012 + walked-down night floors compensated.
- The "yellow faces" rework touched a DIFFERENT path — `BUILDINGS.nightWindowGain` 0.6→0.4→0 (flat R3
  emissive). Buildings' GOLDEN key-lerp was UNTOUCHED. CEILING (owner's hypothesis, confirmed): golden cast +
  ShadowMaterial are both MULTIPLIES against a dark grade (DRAPE.gain 1.3, GROUND.gain 0.56) → crisper
  shadows AND richer golden both need a brighter base grade too.

## Changes (all in tuning.ts unless noted; every new gain 0 = byte-identical no-op)
**Shadows (crisp):** DRAPE.shadowOpacity 0.62→0.80 (the big win) · DRAPE.gain 1.3→1.6 (brighter default
ground = the contrast ceiling) · GROUND.gain 0.56→0.60 (SAT twin) · SHADOWS.radius 2→1 (tighter edge) ·
DRAPE.moonShadowOpacity 0.5→0.62 · SHADOWS.moonGroundOpacity 0.55→0.62 · SHADOWS.moonMinIllum 0.85→0.6
(moon shadows across more of the month).
**Golden hour (sun, richer + wider, symmetric by construction):** GOLDEN band widened fadeInLo -0.139→-0.21
(−12°), fadeOutLo 0.122→0.17 (+10°), fadeOutHi 0.276→0.36 (+21°) · castGain 1.15→1.3 · earthStrength
0.7→0.9 · groundStrength 0.8→1.0 · atmStrength 0.6→0.8 · keyStrength 0.85→1.0 · ATMOSPHERE.skyGoldStrength
0.55→0.72 (dusk sky; NOT in the skyBudget guard) · skyHorizonGain 0.16→0.20 (guard still green).
**NEW GOLDEN.keyBrighten 0.35** → StylizedTiles.ts:1673 `sunLight.intensity = SUN.keyIntensity*(1+goldenK*keyBrighten)`
(buildings BRIGHTEN warm at dusk, not just hue-shift). **NEW GOLDEN.moonKeyStrength 0.4** → StylizedTiles.ts:1661
lerp moon key toward goldenHour by bell(moon elev) = "moon golden hour" at moonrise/set.
**Night/moon GI:** SUN.hemiIntensity 0.25→0.32 · GROUND.ambientNightK 0.012→0.02 · GROUND.nightFloor
0.35→0.40 · EARTH.nightFloor 0.19→0.23 · SKY.moonSceneGlow 0.35→0.5 · GROUND.moonFillK 0.5→0.7.
**Cyberpunk windows (scene/buildings.ts — the risky shader):** `nightWindowGain 0→0.4` now drives a
PROCEDURAL lit-window GRID (replaces the twice-rejected flat emissive). Built in OBJECT space (vFtwLPos =
RTC-local vertex `position` → float32-safe + camera-stable; view-space height would crawl). New varyings
`vFtwLPos`/`vFtwObjUp` (`vFtwObjUp = normalize(transpose(mat3(modelMatrix))*uFtwUp)`); fragment derives the
per-wall tangent from `cross(dFdx(vFtwLPos),dFdy(vFtwLPos))` → floor bands (`h/nightFloorH`) × window columns
(`u/nightWindowW`), AA panes (nightWindowFill/AA), per-window on hash (nightWindowOnFrac), cool-cyan minority
(`uFtwWindowCool = tokens.atmosphere`, nightCyanFrac), gated to vertical walls (existing wallness) + the
top-~25% building hash. Rides the ONE shared material's existing onBeforeCompile. NaN-guarded (degenerate
face → fallback tangent). New BUILDINGS knobs: nightFloorH 3.5, nightWindowW 4.0, nightWindowFill 0.34,
nightWindowAA 0.08, nightCyanFrac 0.18, nightWindowOnFrac 0.6.

## Browser-verify checklist (owner, wix dev — MANDATORY before trusting)
1. City/Dnipro, default dark drape, scrub to noon: crisp contact shadows under buildings, brighter ground
   didn't bloom/wash; toggle SAT chip.
2. Scrub sunrise↔sunset: golden band SYMMETRIC + lingering sweep + buildings BRIGHTEN warm (keyBrighten).
3. `npm test` (skyBudget) green (already) + eyeball dusk horizon for re-whiting.
4. Full-moon night: crisp moon shadows + richer moonlit ground; scrub moon LOW → cool golden swell (moonKeyStrength).
5. New-moon night: not pitch black (hemi/ambientNightK/nightFloor) but terminator + VIIRS not washed.
6. **Windows (crux):** `nightWindowGain 0.4`, reload over Dnipro → reads as LIT WINDOWS up facades (NOT
   roof/wall flood), ~top-25% towers, a few cyan; roofs dark; no bloom-smear. **PRECISION: console.log a
   building `geometry.attributes.position` bbox magnitude at load-model — must be RTC-local small metres, not
   ECEF-huge; if huge the grid aliases/tears → object-space approach must change.**
7. Regression safety: set nightWindowGain/keyBrighten/moonKeyStrength = 0 → byte-identical to pre-change.

Related: [[patterns/globe-rendering]] [[patterns/sky-bodies-terrain]] — the golden/shadow/moon twins to keep
in sync. Prior: rendering/RENDERING_QUALITY_PASS.md (this is an illumination sub-pass).
