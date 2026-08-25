/**
 * RC2 — the elevation-gate ramps that kill the sunset/sunrise snap (owner bug B3, 2026-08-25).
 *
 * The rig has ONE key light and switches its SOURCE at a single boolean threshold,
 * `SHADOWS.minSunElevSin` (+0.46° of solar elevation). Three things used to happen in the same
 * frame at that value:
 *
 *   1. `castShadow` flipped, so a kilometres-long 0.75-opacity shadow field vanished at once —
 *      and it did so at the key's BRIGHTEST moment of the day, because the golden bell is flat at
 *      1.0 there (`SUN.keyIntensity × (1 + GOLDEN.keyBrighten)` = 2.025);
 *   2. with a qualifying moon up, the key's intensity, colour and DIRECTION all teleported to the
 *      moon in the same frame;
 *   3. the dedicated moonlight in `scene/sky.ts` stood down in the same frame, because the rig
 *      was now impersonating the moon.
 *
 * These functions are the fade the rig applies to each. The property that matters, and the one
 * `test/lib/globe/keyHandoff.test.ts` pins, is that BOTH SIDES REACH ZERO AT THE GATE: the sun
 * arm's contribution and the rig's moon arm both trough to nothing exactly where the switch
 * happens, so the direction teleport occurs while the rig delivers no light, and the total moon
 * key stays continuous because the dedicated light gives up exactly the share the rig takes.
 *
 * Everything here is a pure function of the CURRENT geometry, never of time — no easing state,
 * no τ, and therefore nothing to assert "after the snap" (the eased-uniform trap does not apply).
 */

export interface KeyGateProfile {
  /** `SHADOWS.minSunElevSin` — the source gate, in sine of elevation above the focus. */
  gateSin: number;
  /** `SHADOWS.fadeBandSin` — band width either side of the gate. 0 restores the boolean snap. */
  bandSin: number;
  /** `SHADOWS.moonMinIllum` — illuminated fraction at which the moon may take the key. */
  moonMinIllum: number;
  /** `SHADOWS.moonIllumSoftFrac` — how far below that the readiness ramp starts. */
  moonIllumSoftFrac: number;
}

/** Hermite ramp, three's `MathUtils.smoothstep` semantics (0 at/below `min`, 1 at/above `max`). */
function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

/** 0 exactly AT the gate, 1 a full band above it — "how far up is this source". */
export function aboveGateK(dotUp: number, p: KeyGateProfile): number {
  return smoothstep(dotUp, p.gateSin, p.gateSin + p.bandSin);
}

/** 0 exactly AT the gate, 1 a full band below it — "how committed is the night". */
export function belowGateK(dotUp: number, p: KeyGateProfile): number {
  return smoothstep(p.gateSin - dotUp, 0, p.bandSin);
}

/**
 * How ready the moon is to take the key: smooth in BOTH of its own gates, so a moon crossing its
 * elevation or its illumination threshold during the sun's handoff band cannot itself step the
 * trough that the handoff depends on.
 */
export function moonReadyK(
  moonDotUp: number,
  moonIllum: number,
  p: KeyGateProfile,
): number {
  return (
    aboveGateK(moonDotUp, p) *
    smoothstep(moonIllum, p.moonMinIllum * (1 - p.moonIllumSoftFrac), p.moonMinIllum)
  );
}

/**
 * Multiplier on the SUN key. 1 when no moon is waiting — the phantom night key survives
 * untouched, because killing it changes the frozen night look everywhere and is owner A/B item
 * AB1, not this slice's call. With a qualifying moon it troughs to 0 at the gate, which is what
 * makes the direction teleport invisible.
 */
export function sunKeyTroughK(
  sunDotUp: number,
  moonDotUp: number,
  moonIllum: number,
  p: KeyGateProfile,
): number {
  return 1 - moonReadyK(moonDotUp, moonIllum, p) * (1 - aboveGateK(sunDotUp, p));
}

/**
 * The share of the moon key the RIG carries while it impersonates the moon; the dedicated
 * moonlight carries `1 −` this. Zero at the gate, one once the night has committed.
 */
export function moonRigTakeoverK(sunDotUp: number, p: KeyGateProfile): number {
  return belowGateK(sunDotUp, p);
}
