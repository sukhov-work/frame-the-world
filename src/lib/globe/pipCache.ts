/**
 * RC19 — the /m picture-in-picture cache decision (RENDERING CHARTER Group E).
 *
 * THE DEFECT. Batch #5 item 3 renders the WHOLE scene a SECOND time, every frame, scissored into
 * the map window's hole — same camera, same lights, a true miniature. On the one shell where it
 * runs (`/m`, coarse-pointer, lean profile) that is a doubled scene traversal on the weakest
 * hardware in the product.
 *
 * WHY HALF-RATE IS NOT THE FIX — the finding this module exists to encode. `composer.render()`
 * writes the whole backbuffer, INCLUDING the PiP rect, on every frame. Skip the second pass on
 * alternate frames and the rect alternates between the miniature and the full-scale view
 * underneath it: a 30 Hz flicker, not a saving. The second pass must therefore keep PAINTING
 * every frame; only the expensive half — rendering the scene — may be cached. So the miniature
 * gets its own render target and the backbuffer gets a one-triangle blit.
 *
 * This module is the decision half: given the camera pose, the sun and the age of the cached
 * frame, has the miniature gone stale? Pure, three-free, DOM-free → unit-tested. The apply site
 * (GlobeCanvas) owns the target, the blit and the colour path.
 *
 * THE PREDICATE IS DELIBERATELY CHEAP AND DELIBERATELY WRONG-ON-THE-SAFE-SIDE. It sees camera
 * motion, projection changes and the sun; it does NOT see tile streaming, the drape crossfade,
 * `uTime` twinkle, or any eased uniform. `maxStaleMs` is what covers all of those — a hard
 * refresh cadence, so anything the predicate misses is stale for at most that long instead of
 * forever. A frozen miniature would be a bug; a 4 Hz one is a cadence.
 */

/** The PiP hole in VIEWPORT CSS px, as measured from the `.mw-pip` box. */
export interface PipRectPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything the cheap predicate compares. Element arrays are three's LIVE ones — the caller
 *  must go through `pipCapture` before storing, or the snapshot aliases a mutating buffer. */
export interface PipPose {
  /** `camera.matrixWorld.elements` — [12,13,14] are metres, [0..10] the unit basis. */
  view: ArrayLike<number>;
  /** `camera.projectionMatrix.elements` — FOV, aspect and the near/far planes in one place. */
  proj: ArrayLike<number>;
  /** The UNNORMALISED sun direction (light position − target position). */
  sun: readonly [number, number, number];
}

export interface PipDeltaCfg {
  posEpsM: number;
  basisEps: number;
  projEps: number;
  sunDirEps: number;
  maxStaleMs: number;
}

/**
 * Drawing-buffer size for the PiP rect. Mirrors `WebGLRenderer.setViewport`, which multiplies the
 * CSS-px rect by the pixel ratio and ROUNDS — so the cached texture is exactly the footprint the
 * old scissored pass covered, and the blit is 1:1 with no resample.
 *
 * Floors at 1 px because `h` can legitimately arrive as 0 mid-`dvh` transition on iOS (the box is
 * sized in `dvh`, which animates with the URL bar), and a zero-dimension framebuffer is a GL
 * error, not a small texture.
 */
export function pipRtSizePx(rect: PipRectPx, dpr: number): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(rect.w * dpr)),
    h: Math.max(1, Math.round(rect.h * dpr)),
  };
}

/** Copy the three arrays out of three's live buffers so a stored pose cannot alias them. */
export function pipCapture(p: PipPose): PipPose {
  const view = new Float64Array(16);
  const proj = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    view[i] = p.view[i];
    proj[i] = p.proj[i];
  }
  return { view, proj, sun: [p.sun[0], p.sun[1], p.sun[2]] };
}

function unit(v: readonly [number, number, number]): [number, number, number] {
  const L = Math.hypot(v[0], v[1], v[2]);
  return L > 0 ? [v[0] / L, v[1] / L, v[2] / L] : [0, 0, 0];
}

/**
 * Has the cached miniature stopped showing what the live view shows?
 *
 * `maxStaleMs: 0` makes this return `true` unconditionally, which is byte-for-byte the pre-RC19
 * every-frame pass — that is the documented rollback, and it is locked by a unit test rather
 * than left as a claim in a comment.
 *
 * The sun is compared as a DIRECTION. Its light is parked kilometres away and ULTRA swaps
 * `lightDistM` by nearly an order of magnitude when the chip flips, so a raw position compare
 * would call that a view change when the shading is identical.
 */
export function pipNeedsRender(
  prev: PipPose | null,
  next: PipPose,
  ageMs: number,
  cfg: PipDeltaCfg,
): boolean {
  if (prev === null) return true;
  if (ageMs >= cfg.maxStaleMs) return true;

  for (let i = 0; i < 16; i++) {
    // 12/13/14 are the translation column (metres); everything else is the dimensionless basis.
    const eps = i >= 12 && i <= 14 ? cfg.posEpsM : cfg.basisEps;
    if (Math.abs(next.view[i] - prev.view[i]) > eps) return true;
  }
  for (let i = 0; i < 16; i++) {
    if (Math.abs(next.proj[i] - prev.proj[i]) > cfg.projEps) return true;
  }

  const a = unit(prev.sun);
  const b = unit(next.sun);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a[i] - b[i]) > cfg.sunDirEps) return true;
  }
  return false;
}
