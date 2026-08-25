/**
 * GLSL helpers shared by the scene modules (convention: `.claude/conventions/globe-tuning.md`).
 */

import { ULTRA } from "../tuning";

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
 * Two terms, and the second is what makes it read as dusk rather than as grey fog:
 *   · EXTINCTION — `1 − exp(−d / hazeDistM)`, the classic exponential air column;
 *   · FORWARD (Mie-like) SCATTERING — the haze BRIGHTENS toward the sun, so a low sun backlights
 *     the far field. Without it, "more haze at sunset" just desaturates the frame.
 *
 * `hazeK` arrives already carrying the twilight-band curve and every gate (altitude, flat chart,
 * dark drape), so `hazeK <= 0.0` — the ULTRA-off state — returns the input colour untouched and
 * costs one compare. `cameraPosition` is a three built-in fragment uniform. Operate in LINEAR
 * colour: the ground calls this on `diffuseColor` and the buildings right after
 * `<opaque_fragment>`, both before tone mapping.
 */
export const FTW_AERIAL_GLSL = /* glsl */ `
  vec3 ftwAerial(vec3 col, vec3 wpos, vec3 sunW, float hazeK, vec3 hazeCol) {
    if (hazeK <= 0.0) return col;
    vec3 toFrag = wpos - cameraPosition;
    float dist = length(toFrag);
    float f = min((1.0 - exp(-dist / ${glf(ULTRA.hazeDistM)})) * hazeK, ${glf(ULTRA.hazeMaxK)});
    float mie = pow(max(dot(toFrag / max(dist, 1.0), normalize(sunW)), 0.0), ${glf(ULTRA.hazeSunPow)});
    return mix(col, hazeCol * (1.0 + ${glf(ULTRA.hazeSunGain)} * mie), f);
  }`;
