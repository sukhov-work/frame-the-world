/**
 * FPV MESH CLEARANCE (owner order 2026-09-22, FPV item 3 — "do not clip through buildings / user
 * meshes: if moving through any mesh, or suddenly inside one, move to the next surface ABOVE as if
 * standing on it; already moving up inside a multi-layer mesh → the next available layer; a pin
 * dropped inside a mesh lands on top of it at FPV entry").
 *
 * THE COLUMN. The orchestrator casts ONE vertical line through the eye against the building
 * tiles, the enriched cells and the user models (never the terrain — the terrain re-seat owns
 * that) and hands this function every crossing as an absolute height plus which way the face
 * looks: UP (a top — a roof, a floor, a deck, a car's bonnet) or DOWN (an underside — a ceiling,
 * the belly of a bridge). Walking the crossings from the top down, a TOP opens a solid and the
 * next UNDERSIDE closes it; a top with no underside under it is a solid that stands on the
 * ground (an extruded OSM building has no floor). That single rule tells a bridge deck (top +
 * underside, a thin slab you walk UNDER) from a building (a top with nothing under it — you are
 * INSIDE), a parked car (a closed body you would wade through) from a courtyard (nothing above).
 *
 * THE BODY is the 1.7 m under the eye (`bodyM`), whatever the flying height: a viewer hovering
 * 50 m over a roof is not "inside" the building below. INSIDE = the body overlaps a solid; the
 * answer is the overlapping solid's top (the highest one when several — a rooftop plant room
 * on the roof is the NEXT layer, found on the next frame's column). Not inside: the surface the
 * viewer STANDS on — the highest top at the feet (a roof they walked onto, within `stepM`), or,
 * once standing on a mesh, whatever top is under the feet now (walking off a roof edge drops to
 * the lower roof or to the ground — null). A viewer on the ground never "stands" on a top far
 * under their feet (the terrain owns them).
 *
 * Pure, three-free; unit-pinned in `test/lib/globe/fpvClearance.test.ts`.
 */
export interface ColumnHit {
  /** Absolute height of the crossing (m above the ellipsoid — the caller's convention). */
  hM: number;
  /** The face looks UP (a top) rather than DOWN (an underside). */
  up: boolean;
}

export interface Solid {
  /** Bottom of the solid; −Infinity for a solid that stands on the ground. */
  loM: number;
  hiM: number;
}

export interface ClearanceIn {
  /** The eye's absolute height and the body's length under it. */
  eyeM: number;
  bodyM: number;
  /** The mesh top the viewer is currently standing on (absolute m), or null on the terrain. */
  standingOnM: number | null;
  /** A top this close under the feet counts as the surface under them. */
  stepM: number;
}

export interface ClearanceVerdict {
  /** The body overlaps a solid — lift the FEET onto `standOnM` now. */
  inside: boolean;
  /** The surface to stand on (absolute m): the lift target when inside; else the mesh top under
   *  the feet; null = the terrain. */
  standOnM: number | null;
}

/** Fold the column's crossings into solid intervals, highest first. Faces that look SIDEWAYS
 *  never reach here (the caller drops them: a vertical line through a wall is not a crossing). */
export function solidsFromColumn(hits: readonly ColumnHit[]): Solid[] {
  const sorted = hits.filter((h) => Number.isFinite(h.hM)).sort((a, b) => b.hM - a.hM);
  const out: Solid[] = [];
  let open: number | null = null; // the top of the solid we are inside, walking downward
  for (const h of sorted) {
    if (h.up) {
      if (open === null) open = h.hM; // a top opens a solid (a second top inside one is a floor)
    } else if (open !== null) {
      out.push({ loM: h.hM, hiM: open }); // an underside closes it
      open = null;
    }
    // an underside with nothing open above it is the belly of a solid whose top the column
    // sampled above its range — nothing to close; ignore
  }
  if (open !== null) out.push({ loM: -Infinity, hiM: open }); // stands on the ground
  return out;
}

export function fpvClearance(hits: readonly ColumnHit[], i: ClearanceIn): ClearanceVerdict {
  const solids = solidsFromColumn(hits);
  const feetM = i.eyeM - i.bodyM;
  // INSIDE — the body [feet, eye] overlaps a solid (open intervals: touching a top with the feet
  // is standing on it, not being in it).
  let liftTo: number | null = null;
  for (const s of solids) {
    if (s.loM < i.eyeM && s.hiM > feetM + 1e-3) {
      if (liftTo === null || s.hiM > liftTo) liftTo = s.hiM;
    }
  }
  if (liftTo !== null) return { inside: true, standOnM: liftTo };
  // STANDING — the highest top at or under the feet.
  let under: number | null = null;
  for (const s of solids) {
    if (s.hiM <= feetM + 1e-3 && (under === null || s.hiM > under)) under = s.hiM;
  }
  if (under === null) return { inside: false, standOnM: null };
  if (i.standingOnM !== null) return { inside: false, standOnM: under }; // on a mesh: follow what is under the feet
  // on the terrain: only a top right under the feet is a surface walked onto (a step, a kerb)
  return { inside: false, standOnM: feetM - under <= i.stepM ? under : null };
}
