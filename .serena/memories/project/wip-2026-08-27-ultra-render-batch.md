# ULTRA rendering batch — the owner's three immersion breakers (2026-08-27b)

One session, three defects reported verbatim with screenshots, all three **measured before they
were fixed**. Gate: `scripts/verify-ultra-dusk.mjs` **21/21**. Doc: `rendering/ULTRA_ARCHITECTURE.md`
§13 (§10's CSM row amended in place). Decision line: `DECISIONS.md` §Recent **2026-08-27b**.

## The measurements that decided each fix

**1. Shadows cropped.** `__globe.ultraLook()` at his own poses, before any change:
`viewFitM` **148,757 / 427,828 / 100,163 m** vs `boundsM` **18,000** (the ULTRA cap) → covered
**24 % / 8 % / 35 %**. Past the box three returns lit with a straight cut. RC4 had already written
the escape hatch ("full visible-frustum fit stays in reserve").

**2. Dusk.** The load-bearing mechanism had no name: `ftwAerial` mixed toward a fixed palette stop
at up to `hazeMaxK` 0.72 **with no LEVEL term**, so at sunset the far field was 72 % bright orange
and *brighter than the foreground*. Plus: the key BRIGHTENED 35 % through the golden band and never
died; `EARTH.dayGradMin` 0.78 floors the slope ramp at every hour; the dome's haze is a function of
elevation above the horizon ONLY (no azimuth).

**3. Tile seams.** TWO hypotheses died first — `ULTRA.mipLevels` 4 → 1 changed the grid **not at
all**, nor did anisotropy. Suppressing the terrain CASTERS removed it completely.

## What shipped

| Module | Role |
|---|---|
| `lib/globe/shadowCascade.ts` | NEW. Pure ladder fit + the refresh policy. |
| `lib/globe/duskLight.ts` | NEW. Kasten-Young airmass, per-channel extinction, the two scattering lobes + their GLSL twin. |
| `lib/globe/terrainSkirt.ts` | NEW. The cap/skirt group contract the seam fix depends on. |
| `scripts/verify-ultra-dusk.mjs` | NEW gate, 21 checks. Separate from `verify-ultra.mjs` on purpose. |
| `tuning.ULTRA` | cascade ladder · `keyExtinctCurve` · `skyLevelCurve` · `afterglowCurve` · air lobes · direct/ambient split. `hemiCurve` + `hemiTintK` RE-ANCHORED. |

## The four things that will bite a future session

1. **`WebGLLights.js:295-305,459-465` — shadow-casting directional lights must come FIRST.** three
   indexes `directionalShadow[]` by position among ALL directional lights and then truncates the
   array to the CASTER COUNT. A non-caster in front of a caster silently drops the caster's shadow.
   `sun` is always first; cascades cast only while `sun` does. The reverse would be a silent,
   position-dependent corruption.
2. **`getShadowMask()` MULTIPLIES every directional shadow mask with no cascade dispatch.**
   `ULTRA_ARCHITECTURE` §10 lists that as a reason CSM could not work here — for NESTED boxes it is
   exactly the mechanism that makes the ladder compose (outside its box a cascade returns 1.0, so
   the product is the union). The cascade lights are `intensity = 0`: they light nothing.
3. **`WebGLShadowMap.js:170` skips a non-`needsUpdate` shadow BEFORE `updateMatrices`.** So a
   throttled cascade keeps a shadow matrix that still matches the map it rendered — which is why
   the light must NOT be moved on a frame that does not also set `needsUpdate`.
4. **Backticks inside an injected-GLSL template literal terminate it.** Cost ~15 phantom TS errors
   twice in this session (`` `max` ``, `` `uFtwDirectK` `` inside GLSL comments). The trap is
   already in `NEXT_SESSION_PROMPT`; it bites anyway because the comments read like TS comments.

## Numbers worth keeping

- Cascade cost, measured (dev, 1600×950 @ DPR 2): mountain 31.2 → **34.2 ms**, city 47.0 →
  **50.3 ms** (+7-10 %). VRAM **+168 MB** (4096² + 2048²) on top of cascade 0's 536 MB.
- Dusk sweep (sun 26.8° → −5.4°): `skyLevel` 1.000 → 0.973 → 0.806 → 0.580 → 0.282 ·
  `directK` 1.000 → 0.959 → 0.668 → 0.166 → 0.000 · sun disc **0.378 at 3.4°** · key **0.002** at
  sunset · `afterglow` peaks **0.55** below the horizon.
- The skirt: `skirtLength` defaults to `tile.geometricError` — hundreds of metres at wide-view LODs,
  which is why the dark band scaled with zoom. Caster polygon-offset sweep **2 → 1600 units moved
  the residual hairline not at all**; it was the skirt RECEIVING, fixed on the twin's own draw.

## Rollback ladder (in order)

1. `ULTRA.cascades[0].mapPx` 4096 → 2048 (−100 MB, 59 m/texel at reach).
2. `ULTRA.shadowMapSize` 8192 → 4096 (RC27) — cheaper now than before, because cascade 0 no longer
   has to stretch to hold the whole view.
3. `ULTRA.cascades: []` — restores the shipped single-box rig exactly; the extra lights are never
   constructed.
4. Dusk taste: `keyExtinctCurve` (level), `skyLevelCurve` (far-field brightness), `airRayleighK`
   (raise toward 2 to flatten the sky's directional contrast), `airWarmSwing` (0 = the old
   direction-independent tint).

Related: [[project/wip-2026-08-22-ultra-track]] [[project/wip-2026-08-25-rendering-charter]]
[[patterns/globe-rendering]] [[patterns/sky-bodies-terrain]]
