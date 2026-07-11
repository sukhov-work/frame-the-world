/**
 * Moonlight photometry — Krisciunas & Schaefer 1991 (PASP 103, 1033) lunar brightness vs
 * phase angle, the standard sky-brightness model (Phase 5.5 S5, §Item 7).
 *
 *   I(α) ∝ 10^(−0.4 · (0.026·α + 4·10⁻⁹·α⁴))      α = phase angle in DEGREES (0 = full moon)
 *
 * The polynomial encodes the opposition surge near full and the steep gibbous→quarter falloff:
 * a quarter moon (α = 90°) delivers ≈ 9% of full-moon light, NOT the 50% a linear
 * illuminated-fraction scale implies. We normalise to I(0) = 1 and use it as a RELATIVE scale
 * on the scene's full-moon-calibrated lighting (SKY.moonKeyIntensity / moonSceneGlow) — honest
 * physics for a stylized scene: the moon:sun ratio (~1:400,000) is exposure, not this curve.
 *
 * Pure and three-free. α comes from astronomy-engine `Illumination()` via
 * `bodyStatesAt().moonPhaseAngleDeg`.
 */

/** Relative lunar irradiance at phase angle `phaseAngleDeg` (0 full → 180 new), I(0) = 1.
 *  K&S 1991: quarter (90°) ≈ 0.091 · new (180°) ≈ 3e-4. Input is clamped to [0, 180]. */
export function moonPhaseIntensity(phaseAngleDeg: number): number {
  const a = Math.min(Math.max(Math.abs(phaseAngleDeg), 0), 180);
  return 10 ** (-0.4 * (0.026 * a + 4e-9 * a ** 4));
}
