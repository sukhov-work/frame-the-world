/**
 * FPV MESH CLEARANCE — the STICKY BOX (owner order 2026-10-13, superseding the 2026-09-22 column).
 *
 * 2026-09-22 (FPV item 3): "do not clip through buildings / user meshes: if moving through any
 * mesh, or suddenly inside one, move to the next surface ABOVE as if standing on it". That shipped
 * as ONE vertical column through the eye and a SNAP: the moment the feet came within `stepM` of a
 * roof the eye was re-based from terrain-relative to roof-relative height without preserving where
 * it was — a slow descent onto a 20 m roof threw the eye 20 m UP the frame the feet touched
 * (measured 2026-10-13: +19.9 m in one frame; a fast descent skipped the band and landed clean,
 * which is why it read as speed-dependent). Hovering over a roof and walking over a taller one
 * lifted the eye by the difference (the floor followed whatever top was under the feet). Rising
 * into a slab from below snapped the eye onto the slab's top. Walking into a wall teleported the
 * eye onto the roof.
 *
 * 2026-10-13: "sticky, not bouncy — a more realistic box around an average human (0.5 × 0.3 × 2 m,
 * the eye stays at 1.7); descending onto a mesh stays ON the surface, rising from below likewise;
 * a box already intersecting geometry, or hitting the SIDE of a shape, keeps moving UP so we can
 * gracefully scale buildings; never clip."
 *
 * THE MODEL. The body is a box: feet at `eye − bodyM`, head at `eye + headM`, a footprint of
 * `halfWidthM × halfDepthM` around the eye in the walk frame. The orchestrator casts one vertical
 * COLUMN per sample point (the centre, and the four footprint corners while walking) against the
 * building tiles, the enriched cells and the user models — never the terrain — and hands every
 * crossing here as an absolute height plus which way the face looks: UP (a top) or DOWN (an
 * underside). `solidsFromColumn` folds one column's crossings into solid intervals (a top opens a
 * solid, the next underside closes it; a top with nothing under it stands on the ground).
 *
 * `boxClearance` reads the solids of every column against the body and answers four things:
 *   inside   — the CENTRE column's body interval overlaps a solid: climb onto its top (the
 *              reference glides up; the owner's "already intersecting → keep moving up").
 *   wallTopM — a CORNER overlaps a solid the centre does not: the box's edge is in a wall. The
 *              orchestrator BLOCKS the walk step (the box stops at the wall — no clip) and climbs
 *              toward this top; once the feet clear it the step is accepted and the box is on the
 *              roof ("hitting the side → keep moving up … gracefully scale buildings").
 *   floorM   — the highest top at or under the feet (any distance within reach): the surface the
 *              feet LAND on. Descending clamps the feet to it — sticky, no snap past it.
 *   ceilingM — the lowest underside above the head: rising clamps the head under it — sticky.
 *
 * `stepStickyEye` is the per-frame vertical authority, pure. The eye the orchestrator renders is
 * `ref + eyeM`, where `ref` is the FLOOR REFERENCE the eye is measured from — the mesh floor the
 * walker stands on or hovers over (eased while it changes), else the terrain under the feet
 * (`baseAbsM`, which the terrain seats own and ease themselves). The invariants that kill the
 * bounce:
 *   • a reference change while HOVERING (eyeM above the standing height) is EYE-PRESERVING — `eyeM`
 *     is re-expressed against the new reference, the eye does not move;
 *   • a reference change while STANDING (eyeM at the standing height) moves the feet with the
 *     floor: a lower floor is a FALL (eased), a kerb under the feet a STEP up (glided);
 *   • landing is a clamp (the feet stop ON the top the frame they would pass it), never a re-base;
 *   • the terrain moving under a mesh walker never moves the eye (the mesh is the reference).
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

export interface BoxIn {
  /** The eye's absolute height (m) — where the eye IS this frame. */
  eyeM: number;
  /** The body under the eye and the head above it (m). */
  bodyM: number;
  headM: number;
  /** While WALKING: the centre column cast at the eye's position BEFORE this frame's step (the
   *  sweep). With it, "inside" means the box was already in a solid before the step, and a solid
   *  the post-step centre or a corner enters is a WALL the step must not cross. Without it (no
   *  step this frame) the centre column answers both. */
  preStepHits?: readonly ColumnHit[] | null;
}

export interface BoxVerdict {
  /** The centre column's body overlaps a solid — climb onto `climbToM`. */
  inside: boolean;
  climbToM: number | null;
  /** A corner overlaps a solid the centre does not — the box edge is in a wall whose top is this. */
  wallTopM: number | null;
  /** The highest top at or under the feet (the landing surface), or null (nothing within reach). */
  floorM: number | null;
  /** The lowest underside above the head, or null. */
  ceilingM: number | null;
}

const EPS = 1e-3;

/** Does the body [feet, head] overlap this solid (open intervals: touching is not overlapping)? */
function overlaps(s: Solid, feetM: number, headM: number): boolean {
  return s.loM < headM - EPS && s.hiM > feetM + EPS;
}
/** A solid the HEAD BAND alone (eye → head) pokes into from below is a ceiling to stop under, not
 *  a solid to climb: the encoder writes the next frame's eye before the clamp can answer, so a
 *  rising eye always arrives a step inside the underside — treating that as "inside" restarted
 *  the climb from the ground every other frame (a 3 m sawtooth under a 6 m slab, measured). */
function headOnly(s: Solid, eyeM: number): boolean {
  return s.loM >= eyeM - EPS;
}

/**
 * The box verdict. `columns[0]` is the CENTRE column at the position the box is evaluated at
 * (after this frame's step); the rest are the footprint's leading corners (empty while not
 * walking — the centre alone is the 2026-09-22 column). With `preStepHits` the sweep is on: a
 * solid the box was NOT in before the step and IS in after it is a wall, whatever the speed —
 * a 0.15 m box depth cannot catch a 0.4 m step on its own (measured: the centre crossed the wall
 * plane first and climbed from INSIDE the building).
 */
export function boxClearance(columns: readonly (readonly ColumnHit[])[], i: BoxIn): BoxVerdict {
  const feetM = i.eyeM - i.bodyM;
  const headM = i.eyeM + i.headM;
  let inside = false;
  let climbToM: number | null = null;
  let wallTopM: number | null = null;
  let floorM: number | null = null;
  let ceilingM: number | null = null;
  const sweep = i.preStepHits != null;
  const ceil = (s: Solid) => {
    if (Number.isFinite(s.loM) && (ceilingM === null || s.loM < ceilingM)) ceilingM = s.loM;
  };
  // the sweep: was the box in a solid BEFORE the step? A solid the post-step centre is in that
  // the box was NOT in before is a wall; one the box WAS in but has left (walked off an edge as
  // the feet dropped) is nothing — only a solid it is in both before and after is "inside".
  let preInside = false;
  if (sweep) {
    for (const s of solidsFromColumn(i.preStepHits!)) {
      if (overlaps(s, feetM, headM) && !headOnly(s, i.eyeM)) preInside = true;
    }
  }
  columns.forEach((hits, idx) => {
    const solids = solidsFromColumn(hits);
    for (const s of solids) {
      if (overlaps(s, feetM, headM)) {
        if (headOnly(s, i.eyeM)) ceil(s);
        else if (idx === 0 && (!sweep || preInside)) {
          inside = true;
          if (climbToM === null || s.hiM > climbToM) climbToM = s.hiM;
        } else if (wallTopM === null || s.hiM > wallTopM) wallTopM = s.hiM;
        continue;
      }
      // the landing surface: the highest top at/under the feet, across the whole footprint
      if (s.hiM <= feetM + EPS && (floorM === null || s.hiM > floorM)) floorM = s.hiM;
      // the ceiling: the lowest underside above the head
      if (s.loM >= headM - EPS) ceil(s);
    }
  });
  if (inside) wallTopM = null; // the centre's climb outranks a corner's
  return { inside, climbToM, wallTopM, floorM, ceilingM };
}

export interface EyeState {
  /** The eye's height above its floor reference (the mesh floor, else the terrain). */
  eyeM: number;
  /** The mesh floor the eye is referenced to (absolute m), or null = the terrain. */
  floorAbsM: number | null;
  /** The EASED reference the eye is measured from this frame (absolute m), or null = exactly the
   *  terrain (`baseAbsM`). Non-null only while on / gliding toward / falling off a mesh floor. */
  refAbsM: number | null;
}

export interface EyeIn {
  /** The TERRAIN reference (absolute m): the terrain-seated eye minus `eyeM` — where the feet
   *  would stand with no mesh under them (the pin's eased ground + the walk re-seat). */
  baseAbsM: number;
  verdict: BoxVerdict;
  /** The standing eye height (m) and the head above the eye (m). */
  standM: number;
  headM: number;
  /** A mesh top this close under the terrain still counts as the floor (a kerb at ground level). */
  stepM: number;
  /** Frame time (ms) and the two eases: the CLIMB (up, with a floor rate so a tall wall is not a
   *  crawl at the end) and the FALL (down, off a roof edge). */
  dtMs: number;
  climbTauMs: number;
  climbMinRateMps: number;
  fallTauMs: number;
}

export interface EyeStep extends EyeState {
  /** The vertical term the orchestrator adds to the terrain-seated eye: `ref − base` (0 on the terrain). */
  liftM: number;
  /** The box edge is in a wall: the orchestrator reverts this frame's walk step. */
  blockedWalk: boolean;
  /** The reference is still gliding up toward a climb target. */
  climbing: boolean;
  /** The feet are on a floor (mesh or terrain) at the standing height. */
  standing: boolean;
}

const easeK = (dtMs: number, tauMs: number) => 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));

/** Glide `from` toward `to` upward: an exponential approach with a floor rate, never past `to`. */
function glideUp(from: number, to: number, dtMs: number, tauMs: number, minRateMps: number): number {
  if (to <= from) return to > from ? to : from;
  const stepEase = (to - from) * easeK(dtMs, tauMs);
  const stepMin = (minRateMps * dtMs) / 1000;
  return Math.min(to, from + Math.max(stepEase, stepMin));
}

/** Ease `from` down toward `to` (the fall off an edge); settles exactly. */
function fallTo(from: number, to: number, dtMs: number, tauMs: number): number {
  if (to >= from) return from;
  const next = from + (to - from) * easeK(dtMs, tauMs);
  return next - to < EPS ? to : next;
}

/**
 * The per-frame vertical step. The eye the orchestrator renders is `(refAbsM ?? baseAbsM) + eyeM`;
 * this returns the next state plus the lift to apply and the flags.
 */
export function stepStickyEye(s: EyeState, i: EyeIn): EyeStep {
  const v = i.verdict;
  const stand = i.standM;
  const base = i.baseAbsM;
  const refNow = s.refAbsM ?? base;
  const eyeAbs = refNow + s.eyeM;
  let eyeM = s.eyeM;
  let floor = s.floorAbsM;
  let ref: number | null = s.refAbsM;
  let blockedWalk = false;
  let climbing = false;
  const out = (): EyeStep => {
    const r = ref ?? base;
    return {
      eyeM,
      floorAbsM: floor,
      refAbsM: ref,
      liftM: r - base,
      blockedWalk,
      climbing,
      standing: eyeM <= stand + EPS && !climbing,
    };
  };

  // 1. INSIDE — climb onto the overlapping solid's top: the reference glides up to it, the eye
  //    at the standing height over it from now on.
  if (v.inside && v.climbToM !== null) {
    floor = v.climbToM;
    eyeM = stand;
    // the climb starts where the eye IS (a hovering eye that walked into a wall keeps its
    // height and rises from there) — never from the terrain under it
    ref = glideUp(Math.max(refNow, eyeAbs - stand), floor, i.dtMs, i.climbTauMs, i.climbMinRateMps);
    climbing = ref < floor - EPS;
    return out();
  }

  // 2. The floor this frame: the highest top under the feet, if it is at/above the terrain under
  //    them (a top below the terrain is buried — the terrain is the floor).
  const meshFloor = v.floorM !== null && v.floorM >= base - i.stepM ? v.floorM : null;
  const standing = s.eyeM <= stand + EPS;
  if (meshFloor !== floor) {
    if (standing) {
      floor = meshFloor; // the feet follow the floor (the fall / the step, eased below)
    } else {
      // HOVERING — eye-preserving re-base: the eye does not move, only its reference does
      floor = meshFloor;
      ref = meshFloor; // null = the terrain
      eyeM = eyeAbs - (ref ?? base);
    }
  }

  // 3. A WALL in the footprint — block the walk and climb toward the wall's top: the feet must
  //    reach it before the step can land. The eye keeps its own height above the reference.
  if (v.wallTopM !== null) {
    blockedWalk = true;
    const target = v.wallTopM + stand - eyeM; // the reference that puts the feet on the top
    // climb toward the top, then HOLD there (the latch keeps a wall verdict after the climb;
    // falling through to the floor logic from here was a 2 m sawtooth at the top edge, measured)
    ref = target > refNow ? glideUp(refNow, target, i.dtMs, i.climbTauMs, i.climbMinRateMps) : refNow;
    climbing = ref < target - EPS;
    return out();
  }

  // 4. The reference follows the floor target: up is a glide (a kerb under standing feet), down
  //    is the eased fall; on the terrain the reference IS the terrain (no ease — the seats own it).
  const target = floor ?? base;
  const cur = ref ?? base;
  if (target > cur + EPS) {
    ref = glideUp(cur, target, i.dtMs, i.climbTauMs, i.climbMinRateMps);
    climbing = ref < target - EPS;
  } else if (target < cur - EPS) {
    ref = fallTo(cur, target, i.dtMs, i.fallTauMs);
  } else {
    ref = floor === null ? null : target;
  }
  if (ref !== null && floor === null && Math.abs(ref - base) < EPS) ref = null;

  // 5. LANDING — the feet never pass the floor: when the eye would sit under the standing height
  //    over the floor target, land it there exactly (the clamp, not a re-base).
  if (eyeM < stand) eyeM = stand;
  if (!climbing && (ref ?? base) + eyeM < target + stand) {
    eyeM = stand;
    ref = floor === null ? null : target;
  }

  // 6. THE CEILING — the head never passes an underside: clamp the eye under it (sticky).
  if (v.ceilingM !== null) {
    const over = (ref ?? base) + eyeM + i.headM - v.ceilingM;
    if (over > 0) eyeM = Math.max(stand, eyeM - over);
  }

  return out();
}
