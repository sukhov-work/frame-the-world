/**
 * RC25 — the capped mip chain for the drape composites (RENDERING CHARTER Group F).
 *
 * WHY THE CHAIN IS CAPPED, corrected from the charter's own statement of the reason.
 *
 * The charter bans a full auto chain because "box-filtering pulls the transparent border inward".
 * Reading the pipeline says the dominant seam is something else entirely, and no filter can fix
 * it: every 3D tile composites over its OWN cartographic bbox, so adjacent composites share NO
 * border texels. At level k the two sides of a shared edge are averaged from DISJOINT texel sets
 * and disagree by the imagery's local variance over 2^k finest texels — a C0 discontinuity about
 * one screen pixel wide, whose AMPLITUDE grows with k. Capping the chain is what bounds that
 * amplitude. At the shipped 4 levels the coarsest texel spans 8 finest texels, ≈1.6% of a tile.
 *
 * WHY THE LEVELS ARE BUILT WITH `drawImage` AND NOT IN JS — measured, not assumed.
 *
 * The first implementation read the composite back with `getImageData` and halved it with an
 * alpha-weighted 2×2 filter in JS. Browser-measured on a live 512² composite: **4.10 ms for the
 * readback plus 1.26 ms for the filter = 5.36 ms per composite, on the main thread.** Composites
 * arrive in bursts while flying and there are ~450 live at Dnipro, so that is seconds of blocking
 * work per flight — it stalled the verification harness badly enough that CDP evaluations stopped
 * returning. The same three levels built by halving into canvases with `drawImage`: **0.06 ms**,
 * 89× cheaper.
 *
 * That path is also *correct* for the artefact this slice worries about. The composite is uploaded
 * non-premultiplied and the drape shader premultiplies at sample time (`tint.rgb *= tint.a`), so a
 * naive filter multiplies by alpha twice and produces a dark ring at coverage edges. Canvas 2D
 * compositing operates in premultiplied alpha, so `drawImage` premultiplies *before* filtering —
 * which is exactly the inverse of the shader's multiply, and the ring cannot form.
 *
 * What is left here is the arithmetic: the VRAM budget and the level sizes. Pure, three-free,
 * DOM-free → unit-tested.
 */

/**
 * VRAM multiplier for a chain of `levels` TOTAL levels (level 0 included).
 *
 * `1` is exactly `1` — the off-state is an identity, not an epsilon, which is what lets the ULTRA
 * off-state proof use `===`.
 *
 * The budget arithmetic the charter's "3–4 levels" glosses over: 4 total levels cost
 * 1 + 1/4 + 1/16 + 1/64 = 85/64 = **+32.81 %**, which fits the ≤ +33 % ceiling. FIVE total levels
 * cost 341/256 = **+33.20 %** and breach it, and a full auto chain is +33.33 %. So 4 is not a
 * round number, it is the largest chain the stated budget allows.
 */
export function mipByteFactor(levels: number): number {
  let f = 0;
  for (let i = 0; i < levels; i++) f += 1 / 4 ** i;
  return f;
}

/**
 * The largest chain a texture of this size can carry: every level must halve exactly, so the
 * chain stops at the first odd dimension. A 512² composite reaches 64² at 4 levels; a 256² one
 * (the mid/low tiers) reaches 32².
 */
export function maxMipLevels(width: number, height: number): number {
  let n = 1;
  let w = width;
  let h = height;
  while (w % 2 === 0 && h % 2 === 0 && w > 1 && h > 1) {
    w /= 2;
    h /= 2;
    n++;
  }
  return n;
}

/**
 * The dimensions of levels 1..levels-1, or `null` when there is no chain to build.
 *
 * `null` means "leave `texture.mipmaps` at its `[]` default, i.e. the untouched library state" —
 * returned when the chain is off (`levels <= 1`) or the size cannot carry it. Refusing is
 * deliberate: three allocates IMMUTABLE storage sized to the level count it is given, so a short
 * or mis-sized chain is the one way this slice could render garbage. Staying on the library's own
 * path is the correct failure.
 *
 * Level 0 is NOT in the result — it is the source canvas itself, and the caller puts it at the
 * head of `texture.mipmaps` because three sizes its allocation from `mipmaps[0]`.
 */
export function planMipSizes(
  width: number,
  height: number,
  levels: number,
): Array<{ width: number; height: number }> | null {
  if (levels <= 1) return null;
  if (levels > maxMipLevels(width, height)) return null;
  const out: Array<{ width: number; height: number }> = [];
  let w = width;
  let h = height;
  for (let i = 1; i < levels; i++) {
    w >>= 1;
    h >>= 1;
    out.push({ width: w, height: h });
  }
  return out;
}
