/**
 * DUSK LIGHT — atmospheric extinction and the directional air-light (owner defect 2, 2026-08-27).
 *
 * WHAT WAS WRONG, in the owner's words: *"too much yellow tint during sunset and sunrise … you
 * uniformly illuminate the whole scene in some piss very bright colour instead of naturally
 * darkening scene and sky … the whole sky dome has the same colour and luminosity … you illuminate
 * in the same way the opposite sides of the terrain and buildings from the sun … the sun is still
 * too bright when it is lower than around 3-4 degrees."*
 *
 * Four mechanisms in the shipped code produced exactly that, and each is answered here:
 *
 *  1. THE KEY NEVER DIED. `sunLight.intensity` was `SUN.keyIntensity × (1 + goldenK × keyBrighten)`
 *     — it BRIGHTENS by up to 35 % through the golden band and carries full strength to the
 *     horizon. `sunExtinctionK` (scene/sky.ts) dims only the DISC IMPOSTOR, never the light.
 *  2. NO REDDENING. The key lerps toward one fixed `tokens.goldenHour`, so the last degree of
 *     sunlight is the same hue as the first hour of it.
 *  3. THE AIR-LIGHT WAS A PAINT COLOUR, NOT A RADIANCE. `ftwAerial` mixed toward a fixed palette
 *     stop at up to `hazeMaxK` 0.72, so distant terrain became 72 % bright orange — brighter than
 *     the near field, and identical whether you looked at the sun or away from it.
 *  4. NOTHING KNEW WHERE THE SUN WAS IN AZIMUTH. The sky dome's horizon haze is a function of
 *     elevation above the horizon only, so the anti-solar horizon glowed exactly as brightly as
 *     the solar one.
 *
 * THE SPLIT THIS MODULE MAKES, and it is the design decision worth stating: the **chromaticity**
 * of low sunlight is PHYSICS and is computed here from Kasten-Young airmass and per-channel
 * optical depth; the **level** is AUTHORED, as an anchor table in `tuning.ULTRA`. That is not a
 * fudge, it is honesty about what this renderer is. True extinction at a geometric elevation of 0°
 * is ~1 % of zenith sunlight, and a physically-exposed frame there would be black — a real camera
 * only holds it because it opens up by seven stops. We have an exposure ramp, not an eye. So the
 * hue comes from the atmosphere and the brightness comes from a curve the owner can turn.
 *
 * Pure, three-free, DOM-free, and every consumer's GLSL is EMITTED from the same constants so the
 * shader and the JS cannot drift — the `lib/globe/lightBands` discipline, extended.
 */

/** Optical depth at unit airmass, per channel. Rayleigh τ(λ) ≈ 0.008735·λ⁻⁴·⁰⁸ at sea level
 *  (Hansen & Travis 1974) evaluated at 610/550/470 nm, plus a weak neutral aerosol term. These
 *  are the only physical constants here; everything else about the LOOK is authored in tuning. */
export const SOLAR_TAU: readonly [number, number, number] = [0.118, 0.16, 0.262];

/**
 * Relative airmass at a geometric solar elevation, Kasten & Young (1989):
 *
 *     AM(h) = 1 / (sin h + 0.50572 · (h° + 6.07995)^−1.6364)
 *
 * — which is why this takes DEGREES and not the sine everything else in the light path uses: the
 * correction term is polynomial in degrees, and it is the whole point of the formula (plain
 * `1/sin h` diverges at the horizon and is already 2× wrong by 10°).
 *
 * Clamped at −1.5°: below that the geometry is refraction-dominated and the fit is out of its
 * domain, and the level curve has taken over anyway.
 */
export function airMass(elevDeg: number): number {
  const h = Math.max(elevDeg, -1.5);
  const denom = Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364);
  const m = denom > 1e-6 ? 1 / denom : 1 / 1e-6;
  // Floored at 1 because the fit is an approximation and 1 is the physical minimum: the raw
  // formula returns 0.99971 at the zenith, which would make `solarTransmittance` return 1.00003
  // and hand the midday key a hair MORE than white. Small, but it would mean the off-state claim
  // "at high sun this changes nothing" was only approximately true, and this track's whole
  // discipline is that such claims are exact.
  return Math.max(m, 1);
}

/** Per-channel atmospheric transmittance of direct sunlight, normalised to 1 at the zenith so the
 *  midday key stays exactly the white it is today. Values fall fast and unevenly — at 5° this is
 *  about (0.33, 0.23, 0.09), which IS why a low sun is orange. */
export function solarTransmittance(
  elevDeg: number,
  tau: readonly [number, number, number] = SOLAR_TAU,
): [number, number, number] {
  const m = airMass(elevDeg);
  return [
    Math.exp(-tau[0] * (m - 1)),
    Math.exp(-tau[1] * (m - 1)),
    Math.exp(-tau[2] * (m - 1)),
  ];
}

/**
 * The CHROMATICITY of that transmittance — the same vector renormalised so its largest component
 * is 1. This is what tints the key light and the sun disc; the brightness is a separate, authored
 * decision (see the module note). Keeping them apart is what lets the owner make dusk brighter
 * without also making it less orange.
 */
export function solarChroma(
  elevDeg: number,
  tau: readonly [number, number, number] = SOLAR_TAU,
): [number, number, number] {
  const t = solarTransmittance(elevDeg, tau);
  const peak = Math.max(t[0], t[1], t[2], 1e-6);
  return [t[0] / peak, t[1] / peak, t[2] / peak];
}

/**
 * GLSL twin of the DIRECTIONAL part of the air-light, shared verbatim by the aerial perspective
 * (ground + buildings) and the sky dome, so the air over the terrain and the air above the horizon
 * cannot disagree — the same structural trick `FTW_AERIAL_GLSL` uses for ground-vs-buildings.
 *
 * Two lobes, and the second is the whole point:
 *   · a broad Rayleigh-shaped base `0.75·(1 + cos²γ)`, which is nearly flat and keeps the sky from
 *     going black away from the sun;
 *   · a tight forward MIE lobe `cosγ^p`, which is the sun-side glow — the thing whose absence made
 *     the anti-solar horizon as bright as the solar one.
 *
 * `warmK` is the SUN-SIDE fraction the consumer uses to lerp its cool tint toward its warm one, so
 * the colour is directional too and not just the intensity. Nothing here knows about elevation
 * bands or palettes; the caller owns those.
 */
export function airLightGlsl(rayleighK: number, miePow: number, mieGain: number): string {
  const f = (n: number): string => {
    const s = n.toPrecision(9);
    return /[.e]/i.test(s) ? s : `${s}.0`;
  };
  return /* glsl */ `
  // x = cos(angle between the view ray and the sun). 0..1 weight on the sun-side (Mie) lobe —
  // the term the tint swing rides, so warm colour and warm brightness cannot drift apart.
  float ftwAirSun(float x) { return clamp(pow(max(x, 0.0), ${f(miePow)}), 0.0, 1.0); }
  // Relative in-scattered brightness for this view ray, NORMALISED so that looking straight at
  // the sun gives exactly 1. The normalisation is what makes skyLevel mean what it says: without
  // it the two lobes summed to 2.18 at their peak and the far field came out BRIGHTER than the
  // palette colour it was supposed to be mixing toward — the original defect, one layer down.
  float ftwAirLevel(float x) {
    float ray = 0.75 * (1.0 + x * x);
    return (${f(rayleighK)} * ray + ${f(mieGain)} * ftwAirSun(x))
      * ${f(1 / (rayleighK * 1.5 + mieGain))};
  }`;
}

/** CPU twin of the emitted pair — `test/lib/globe/duskLight.test.ts` asserts they agree. */
export function airSun(cosGamma: number, miePow: number): number {
  return Math.min(1, Math.max(0, Math.pow(Math.max(cosGamma, 0), miePow)));
}
export function airLevel(
  cosGamma: number,
  rayleighK: number,
  miePow: number,
  mieGain: number,
): number {
  const ray = 0.75 * (1 + cosGamma * cosGamma);
  return (
    ((rayleighK * ray + mieGain * airSun(cosGamma, miePow)) * 1) /
    (rayleighK * 1.5 + mieGain)
  );
}

// --- THE SHADOW'S OWN DUSK (sunset shadow-release, 2026-09-06) ----------------------------------
//
// The two pure bounds the shadow field needs once it is allowed to live past +0.46°. They sit
// here, beside the extinction maths, and not in `lib/globe/shadowFit` (which owns the ortho BOX)
// because both are answers to the same question the dusk model asks every frame — *how much of
// this shadow is still real?* — and both are read in the same four lines of
// `stepKeyLightAndShadow`.
//
// THE DEFECT THEY ANSWER, measured (`verify-shots/sunset-lightpath-report.md` §4/§6): between
// geometric sun +1.30° and −0.14° the terrain that was in shadow got **5.22× BRIGHTER**, and it
// did so in a 0.60° window (× 6.5 between +1.06° and +0.46°, ≈ 2.7 minutes). Two mechanisms, and
// the dominant one is the second:
//   1. the field was RELEASED at `SHADOWS.minSunElevSin` (+0.4584°) while 25 % of the direct sun
//      was still there — 5.9 minutes before the upper limb actually sets (−0.833°);
//   2. the ground overlay is a `ShadowMaterial` twin, i.e. a multiplier on the WHOLE composite,
//      while a shadow physically removes only the DIRECT arm of `imageryGround`'s split
//      (`dayShadeU = groundAmbientK·ambient + (1−groundAmbientK)·directK·lambert`, :648-657).
// §6's shadow-budget table is why moving the gate alone cannot work: at ANY gate the shipped
// overlay is 3.1–6.5× deeper than the direct light it stands for, so releasing it always
// brightens. Bounding it by the direct share removes the step wherever the gate is put.

/**
 * The ground overlay's DIRECT SHARE — how much of a lit surface's brightness the direct sun is
 * still responsible for, normalised to the reference sun, so the `ShadowMaterial` can never
 * darken more than the arm it stands for.
 *
 * The shader's per-fragment split (`scene/imageryGround.ts:648-657`) is
 *
 *     dayShadeU = a·skyExposure·skyAz·mix(1, skyLevel, levelK)  +  (1−a)·directK·lambert
 *                 └──────────────── ambient ─────────────────┘     └───── direct ─────┘
 *
 * with `a = ULTRA.groundAmbientK`. The exact share is `direct / (ambient + direct)`, which needs
 * the fragment's own normal (`skyExposure`, `skyAz`, `lambert`) — and the overlay is one shared
 * material opacity written once per frame on the CPU, so it gets a SCALAR. The scalar evaluates
 * that ratio for the REFERENCE receiver — a flat surface under an overhead sun, where
 * `skyExposure = skyAz = lambert = 1` and the ambient level is its own unit — and normalises by
 * its own value there:
 *
 *     s(d) = (1−a)·d / (a + (1−a)·d)        s(1) = 1−a        k(d) = s(d)/s(1) = d / (a + (1−a)·d)
 *
 * TWO PROPERTIES THIS BUYS, and both are pinned in `test/lib/globe/duskLight.test.ts`:
 *   · **k(1) is EXACTLY 1.** `a + (1−a)·1 = 1` with no rounding, so the daytime overlay is
 *     byte-identical — and with the ULT chip OFF `ultraDirectK` is seeded and re-settled to
 *     exactly 1 (`StylizedTiles.stepUltraLook`), so the off-state overlay is byte-identical too.
 *     That exactness is the whole off-state contract; `d/(a + (1−a)d)` was chosen over every
 *     other shape partly because it delivers it without a clamp.
 *   · **k(0) = 0.** When no direct light survives there is nothing for a shadow to remove, so the
 *     overlay retires on its own — which is what lets the gate move below the horizon at all.
 *
 * WHY THE AMBIENT LEVEL IS HELD AT ITS REFERENCE and not fed the live `skyLevel`: letting the
 * ambient arm dim with the sky pushes the ratio the wrong way — measured at +3° with
 * `A = skyLevel·skyAz` the formula returns **k = 1.008**, i.e. it would ask for MORE overlay than
 * ships today and re-open the cliff it exists to close. Conversely, folding in the receiver's own
 * `lambert` (0.159 at a grazing sun) collapses the overlay to 0.13 at +3° against the shipped
 * 0.758 — that deletes exactly the raking-hour terrain shadow the 2026-08-27c taste pass was
 * written to preserve ("shadows that were there before should not just disappear"). The scalar
 * sits between those two failures on purpose.
 *
 * Measured effect on the in-shadow ground at the owner's Everest pose (the twin in
 * `test/components/globe/duskShadeRatio.test.ts` computes both columns from the shipped tunables,
 * so neither is transcribed): across `[+3, +2, +1.06, +0.5, +0.4584, 0, −0.5]` the worst
 * brightening anywhere on the ladder falls from **× 6.479 to × 1.255**, the owner's own two frames
 * go from **× 5.22 to × 1.16**, and +3° → +0.7° becomes strictly decreasing.
 *
 * @param directK  `ultraDirectK` — the `ULTRA.keyExtinctCurve` level, 1 at high sun, 0 by −0.5°.
 * @param ambientK `ULTRA.groundAmbientK` — the shader's own ambient weight (0.68).
 */
export function shadowDirectShareK(directK: number, ambientK: number): number {
  const d = Math.min(1, Math.max(0, directK));
  const a = Math.min(1, Math.max(0, ambientK));
  const denom = a + (1 - a) * d;
  // The guard is reachable only at a = 0 AND d = 0 — an all-direct ground with no direct light,
  // which is 0 overlay either way. At a = 1 (an all-ambient ground) the expression degrades to a
  // plain linear `directK` rather than to 0/0, which is the right degenerate limit: there is no
  // reference direct arm to normalise against, so the fade is simply the extinction level.
  return denom > 0 ? d / denom : 0;
}

/**
 * The shadow-LENGTH guard — the bound that makes a gate BELOW the horizon safe.
 *
 * `verify-shots/sunset-lightpath-report.md` §7 ruled out every other candidate for "a
 * below-horizon sun projects garbage" (`tuning.ts:490`) with numbers — no near-plane clipping, no
 * ortho degeneracy from a light 872 m under the focus plane, acne already handled by
 * `ULTRA.terrainDepthOffset` — and found exactly one real failure: **projected length diverges**.
 * A 100 m caster's shadow is 1 908 m at +3°, 12 499 m at the old gate, 28 648 m at +0.2°,
 * 57 296 m at +0.1° and INFINITE at 0°. Past the box it is not a long shadow, it is a hard-edged
 * kilometre-scale slab thrown from the box edge — the "super elongated naive shadows we fixed
 * before" the owner named as a do-not-return.
 *
 * So the field fades on GEOMETRY rather than on an authored elevation: `min(1, reach / (h/tan ε))`,
 * which is 1 while the box can hold the shadow, falls as 1/length once it cannot, and is 0 at and
 * below the horizon where the length is infinite or the ray travels upward. It is inert above
 * `atan(casterM / reachM)` — 0.54° at the Everest FPV fit (reach 10 688 m), 0.32° at the
 * `ULTRA.maxBoundsM` cap — so it costs nothing through the raking hour and only bites in the last
 * half-degree, where `shadowDirectShareK` has already taken the overlay down to a fifth.
 *
 * Its real job is the FUTURE: `ULTRA.keyExtinctCurve` reaches 0 at −0.5° today, so nothing draws a
 * shadow below the horizon anyway; if a later curve keeps `directK > 0` down there, this is what
 * still stops the slab.
 *
 * Never NaN: ε ≤ 0 returns 0 before any division, a zero/absent box returns 1 (no bound rather
 * than a silent blackout on the first frames, where `shadowBoundsM` is still 0), and a sun at the
 * zenith returns 1 without dividing by cos = 0.
 *
 * @param sinElev Sine of the GEOMETRIC solar elevation over the focus — `sunDirW · focusUp`.
 * @param casterM Reference caster height (m) — `ULTRA.shadowLengthCasterM`.
 * @param reachM  Ground distance (m) the live shadow box can hold — the fitted half-extent.
 */
export function shadowLengthK(
  sinElev: number,
  casterM: number,
  reachM: number,
  horizonSin = 0,
): number {
  if (!(casterM > 0) || !(reachM > 0)) return 1;
  // 2026-09-06h, measured on the owner's strip: with the horizon at GEOMETRIC 0° this guard zeroed
  // the field at frame B (−0.14°) while the disc was still up (apparent +0.36°) — the release the
  // whole fix exists to remove, re-introduced one term later. The shadow is thrown by the DISC,
  // so the elevation that matters is measured from where the disc sets (`horizonSin`, the ULTRA
  // gate's sin −0.833°): a sun 0.7° above true sunset throws a long, real, beautiful shadow.
  const s = sinElev - horizonSin;
  if (!(s > 0)) return 0;
  const cosElev = Math.sqrt(Math.max(0, 1 - s * s));
  if (cosElev <= 0) return 1; // sun at the zenith: the shadow is a point
  // reach / (casterM/tan ε), written without tan so the zenith case cannot divide by zero.
  return Math.min(1, (reachM * s) / (casterM * cosElev));
}
