/**
 * GLSL helpers shared by the scene modules (convention: `.claude/conventions/globe-tuning.md`).
 */

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
 */
export const DITHER_GLSL = /* glsl */ `
        color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;`;
