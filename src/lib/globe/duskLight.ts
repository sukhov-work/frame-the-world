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
