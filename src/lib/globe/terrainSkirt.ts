/**
 * THE TERRAIN SKIRT, AND WHY IT MUST LEAVE THE SHADOW PIPELINE (owner defect 3, 2026-08-27).
 *
 * Every quantized-mesh terrain tile carries a vertical APRON hanging from its border, of length
 * `tile.geometricError` by default (`QuantizedMeshPlugin.js:260,281` — hundreds of metres at the
 * LODs a wide view uses). Its job is in the COLOUR pass: it hides the crack where two neighbouring
 * tiles sit at different LODs. It has no business in the shadow pass, and once ULTRA's S3 let the
 * terrain cast, it drew a dark line along EVERY tile boundary at EVERY zoom — the owner's
 * "reproduces on any part of the map".
 *
 * TWO mechanisms, both measured in the browser rather than argued:
 *
 *  1. THE APRON CASTS. A wall standing on the tile edge occludes the neighbour's surface across a
 *     band of width ≈ skirtLength · cos(sun elevation). Take a 45° sun: a skirt point δ into the
 *     band is nearer to the light than the surface behind it by exactly 2δ, so the band is
 *     genuinely shadowed, not an artefact of bias. Removing the terrain casters removed the grid
 *     (`verify-shots/seamab-{A,B,C}`); removing the RC25 mip chain did nothing.
 *  2. THE APRON RECEIVES. Clipping (1) left a hairline. It is NOT the caster's bias — sweeping the
 *     depth material's `polygonOffsetUnits` 2 → 1600 moved it not at all (`seam2-units-*`) while
 *     switching the shadow pass off removed it (`seam2-noshadow`). The apron is a vertical sheet
 *     standing exactly on the border; where its top edge is coincident with the neighbour's
 *     surface it samples that surface's depth, reads as self-shadowed, and the `ShadowMaterial`
 *     twin paints its slate over the one-pixel sliver that is visible at a grazing angle.
 *
 * The fix on both sides is the same: draw the SURFACE CAP ONLY. `renderBufferDirect` intersects
 * `geometry.drawRange` with the index count (`WebGLRenderer.js:1211-1227`), so clipping the range
 * for the duration of one draw and restoring it after is exact and costs nothing.
 *
 * This module is the pure half — the CONTRACT the clip depends on, stated so a library upgrade
 * that reorders the groups fails a unit test instead of silently un-fixing the seam.
 */

/** The minimum of `THREE.BufferGeometry` this rule reads. Kept structural so the test needs no
 *  three import and the caller can pass a real geometry unchanged. */
export interface SkirtGeometryLike {
  readonly index: { readonly count: number } | null;
  readonly groups: ReadonlyArray<{ start: number; count: number }>;
}

/**
 * Index count of the surface cap, or `0` when the geometry does not have the cap/skirt layout.
 *
 * THE CONTRACT, source-verified against `3d-tiles-renderer` 0.4.28:
 *   · `QuantizedMeshLoader.js:136` adds the cap FIRST, at offset 0, before the optional solid
 *     bottom (`:173`) and the skirt (`:247`);
 *   · `QuantizedMeshClipper.js:238` does the same for region-clipped tiles.
 * So `groups[0]` is the cap iff it starts at 0 and does not already cover the whole index buffer.
 *
 * `0` means "leave this geometry alone" and is deliberately the fail-safe reading: a tile that
 * does not match casts and receives exactly as it did before, which is a dark seam — visible and
 * reportable — rather than a hole. Never returns a range that would clip real surface away.
 */
export function surfaceCapIndexCount(geom: SkirtGeometryLike): number {
  const total = geom.index?.count ?? 0;
  if (!(total > 0)) return 0;
  const g0 = geom.groups[0];
  if (!g0 || g0.start !== 0 || !(g0.count > 0) || g0.count >= total) return 0;
  return g0.count;
}
