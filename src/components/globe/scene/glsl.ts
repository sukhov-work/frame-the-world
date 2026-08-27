/**
 * GLSL helpers shared by the scene modules (convention: `.claude/conventions/globe-tuning.md`).
 */

import { ULTRA } from "../tuning";
import { airLightGlsl } from "../../../lib/globe/duskLight";

/**
 * Format a JS number as a GLSL ES float literal — `2` → `"2.0"`. GLSL ES rejects `float x = 2;`
 * so every tuning value injected into a shader template MUST go through this.
 */
export function glf(n: number): string {
  const s = String(n);
  return /[.e]/i.test(s) ? s : `${s}.0`;
}

/** Format a 3-tuple tunable as a GLSL `vec3(...)` literal (same float rules as glf). */
export function glf3(v: readonly [number, number, number]): string {
  return `vec3(${glf(v[0])}, ${glf(v[1])}, ${glf(v[2])})`;
}

/**
 * Hash dither, ±1/256 — additive gradients on a near-black background band badly without it.
 * Appends to a `vec3 color` in scope. Structural (not a tunable).
 *
 * It is UNCONDITIONAL by design (a gate would band the gate's own edge), which is why every
 * impostor that uses it must also carry an edge window — see `impostorEdgeWindow` below.
 */
export const DITHER_GLSL = /* glsl */ `
        color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;`;

/**
 * IMPOSTOR EDGE WINDOW — the one fix for the "square around the body" class of bug (owner B2,
 * 2026-08-25: a square edge appeared around the sun at totality).
 *
 * Every camera-anchored impostor paints a QUAD, and several of the additive terms drawn on it have
 * no compact support: an `exp()` halo, the corona's `x^-2.6` power law, a Gaussian ellipse. Each is
 * still nonzero where the quad ends, so the quad's own boundary truncates a live field — a hard
 * brightness step in the shape of a rectangle. `DITHER_GLSL` is worse: it paints ±1/256 of noise
 * over the WHOLE quad, including every pixel where the signal is exactly zero. Both are invisible
 * until the background drops near their level, which is why totality (ECLIPSE.daylightFloor 0.04)
 * is where the owner first saw it.
 *
 * The window is applied to the FINAL colour, AFTER the dither, so the noise fades out with the
 * signal instead of stopping at a line — and `end` sits strictly inside the quad's INSCRIBED
 * radius (the half-extent, in whatever units `r` is measured), which makes `window(halfExtent)`
 * exactly 0. Fragments past `end` discard: the corners of the quad reach halfExtent·√2 and now
 * never run a ROP at all.
 *
 * CPU twin of `impostorEdgeWindowGlsl` — `test/components/globe/impostorEdge.test.ts` pins that
 * the window closes before the edge for every impostor that uses it.
 */
export function impostorEdgeWindow(r: number, start: number, end: number): number {
  if (r <= start) return 1;
  if (r >= end) return 0;
  const t = (r - start) / (end - start);
  return 1 - t * t * (3 - 2 * t); // 1 − smoothstep(start, end, r)
}

/** GLSL emitter for `impostorEdgeWindow`; expects a `float r` in scope at the call site. */
export function impostorEdgeWindowGlsl(start: number, end: number): string {
  return `(1.0 - smoothstep(${glf(start)}, ${glf(end)}, r))`;
}

/**
 * ULTRA S4 — AERIAL PERSPECTIVE, the ONE definition (T45, owner 2026-08-22i).
 *
 * Injected verbatim into BOTH the imagery ground and the building materials, because the
 * ULTRA_PLAN's hardest constraint on this half is that ground and buildings must move TOGETHER —
 * a city whose air thickens at a different rate from the ground it stands on is the exact
 * incoherence that made forcing `dayK` a C2 breach. Sharing the emitted function rather than the
 * intent is what makes that structural instead of a review promise.
 *
 * Three terms, and 2026-08-27 (owner defect 2) is when the last two became separable:
 *   · EXTINCTION — `1 − exp(−d / hazeDistM)`, the classic exponential air column;
 *   · DIRECTION — the two scattering lobes from `lib/globe/duskLight` (broad Rayleigh + tight
 *     forward Mie), which decide both how BRIGHT and how WARM the in-scattered light is for this
 *     particular view ray. The shipped version had only a `pow(·, 7)` glint on a fixed colour, so
 *     the air looked identical facing into a sunset and facing away from it;
 *   · LEVEL (`skyLevel`) — air-light is light, and it has to go out with the sun. Without this
 *     term the far field mixed toward a bright palette stop at up to `hazeMaxK` 0.72 and ended up
 *     BRIGHTER than the foreground at dusk: the owner's "uniformly illuminating the whole scene in
 *     some piss very bright colour". It is a uniform, not a curve, so ground/buildings/dome all
 *     read the same number in the same frame.
 *
 * `hazeK` arrives already carrying the twilight-band curve and every gate (altitude, flat chart,
 * dark drape), so `hazeK <= 0.0` — the ULTRA-off state — returns the input colour untouched and
 * costs one compare. `cameraPosition` is a three built-in fragment uniform. Operate in LINEAR
 * colour: the ground calls this on `diffuseColor` and the buildings right after
 * `<opaque_fragment>`, both before tone mapping.
 */
export const FTW_AERIAL_GLSL = /* glsl */ `
  ${airLightGlsl(ULTRA.airRayleighK, ULTRA.airMiePow, ULTRA.airMieGain)}
  vec3 ftwAerial(vec3 col, vec3 wpos, vec3 sunW, float hazeK, vec3 hazeCol,
                 vec3 hazeColCool, float skyLevel, float afterglow) {
    if (hazeK <= 0.0) return col;
    vec3 toFrag = wpos - cameraPosition;
    float dist = length(toFrag);
    float f = min((1.0 - exp(-dist / ${glf(ULTRA.hazeDistM)})) * hazeK, ${glf(ULTRA.hazeMaxK)});
    // Direction to the fragment vs direction to the sun: the ONE term whose absence made a
    // sunset's air-light look the same whether you faced into it or away from it.
    float cosG = dot(toFrag / max(dist, 1.0), normalize(sunW));
    // COLOUR: cool away from the sun, warm toward it. hazeColCool is the anti-solar tint the
    // orchestrator supplies alongside the band tint, so both ends of the swing come from the
    // palette rather than from a hue rotation nobody can tune.
    vec3 tint = mix(hazeColCool, hazeCol, ftwAirSun(cosG) * ${glf(ULTRA.airWarmSwing)});
    // LEVEL: air-light is LIGHT. skyLevel collapses it as the sun goes down, which is the whole
    // fix for "uniformly illuminating the whole scene in some piss very bright colour" — before
    // this the far field was mixed toward a fixed bright palette stop and ended up BRIGHTER than
    // the foreground at the exact moment the world should be going dark.
    // AFTERGLOW (taste pass 2026-08-27c). The dome was painting a post-sunset glow that the
    // distant terrain under it knew nothing about — skyLevel is 0.22 at -6 deg while the dome's
    // afterglow is 0.49, a 2.2x disagreement at exactly the terrain/sky junction RC24 exists to
    // close. max() rather than a sum: the afterglow does not stack on a still-bright sky, it is
    // what is left once the sky has gone. max(x, 0.0) is exactly x with the chip off.
    vec3 inScatter = tint * max(skyLevel, afterglow * ftwAirSun(cosG)) * ftwAirLevel(cosG);
    return mix(col, inScatter, f);
  }`;
