/**
 * MESH SUITE MS1 — the per-feature SPATIAL transform of an enriched building (owner order
 * 2026-09-01; design MESH_SUITE_PLAN.md §6). Pure + three-free: the vertex math the engine's
 * ONE position-array writer (`scene/enrichedBuildings.ts` applyFeatureSeats) calls per frame for
 * a spatially edited feature, plus the ease, the rails and the bounds arithmetic around it.
 *
 * THE TWO PATHS. U8's height override is a Y-scale about the LIVE base, written INCREMENTALLY
 * (`y = liveBase + (y − liveBase)·ratio` on top of the seat's `+= dy`) — safe only because a
 * Y-translate and a Y-scale-about-base commute. Nothing else commutes with that writer: a
 * rotation or an XZ scale applied incrementally would compound float error and could never be
 * undone exactly. So a feature that carries ANY spatial component (`SpatialXf` ≠ identity) is
 * recomposed ABSOLUTELY every frame it changes, from a lazily captured PRISTINE copy of its run:
 *
 *     p = pivot + R_y(rot) · diag(sx, sy, sz) · (p0 − pivot) + (tE, dyM + tU, −tN)
 *
 * with pivot = (cx, baseY, cz) — the pristine centroid X/Z (the re-bake checksum, never moved) at
 * the TRUE base — and dyM the seat delta the cell/feature re-seat has applied. For the identity
 * spatial transform this is EXACTLY the incremental writer's invariant
 * `y = baseY + dyM + (y0 − baseY)·sy`, which is what lets a feature drop back to the fast path
 * once its spatial components settle at identity (unit-tested: `recomposeVerts` ≡ incremental).
 *
 * FRAME. glTF local +X = east, +Y = geodetic up, −Z = north (bake mapping ENU → (e, u, −n)), so
 * `tE`/`tN` are metres east/north and `rotDeg` is a rotation about +Y in three's own sense
 * (`Matrix4.makeRotationY`: x' = c·x + s·z, z' = −s·x + c·z — POSITIVE = counter-clockwise seen
 * from above, east turning toward north). `tU` is a LIFT above the seated base, railed to ≥ 0 —
 * the owner's "never pushable irreversibly underground" rule is structural: ground contact stays
 * owned by the terrain seat, an edit can only add height above it.
 *
 * Rails (the contract half — `lib/globe/bldgOverrides.ts` owns the numbers): scales inside the
 * SANITY rail, |(tE, tN)| inside a sanity translate radius, lift inside [0, liftMax] — `clampXf`
 * is parametric and clamps onto whatever rails it is handed. The GESTURE rails are per edit about
 * the committed transform (MS5b 2026-09-02l: a move ≤ `EDIT_MOVE_MAX_M` from where the building
 * stands, every scale axis a tenth to ten times its committed value via the same `clampEditK`,
 * compounding). The cell's tile-level culling volume is NOT grown by a move — far from its cell a
 * building can pop with the cell at the view edge (accepted, said in the guide).
 */

/** Spatial components of one feature edit. Absent/identity ⇒ the feature never leaves the
 *  incremental fast path (zero memory, zero per-frame cost — the §4a no-regression contract). */
export interface SpatialXf {
  /** XZ scale about the pristine centroid (1 = original). */
  sx: number;
  sz: number;
  /** Rotation about local +Y in degrees, three's sense (CCW from above); (−180, 180]. */
  rotDeg: number;
  /** Translation, metres east / north. */
  tE: number;
  tN: number;
  /** Lift above the seated base, metres, ≥ 0. */
  tU: number;
}

/** The full edit as the engine/UI exchange it: Y scale + the spatial components. */
export interface FeatureTransform extends SpatialXf {
  /** Height (Y) scale vs the baked height (1 = original) — the U8 fast-path scalar. */
  sy: number;
}

export const IDENTITY_XF: Readonly<SpatialXf> = Object.freeze({
  sx: 1,
  sz: 1,
  rotDeg: 0,
  tE: 0,
  tN: 0,
  tU: 0,
});

export const IDENTITY_TRANSFORM: Readonly<FeatureTransform> = Object.freeze({
  ...IDENTITY_XF,
  sy: 1,
});

/** Neutrality thresholds per unit ("back to original" ⇒ the row is deleted, not stored). Scale
 *  mirrors `NEUTRAL_K_EPS` in bldgOverrides.ts; a 1 cm move or a 0.05° twist is not an edit. */
export const XF_NEUTRAL_EPS = Object.freeze({ scale: 0.005, rotDeg: 0.05, m: 0.01 });

/** Ease snap tails — below these a per-frame ease lands exactly on its target (the
 *  `overrideEaseK` tail rule the height override already uses: 0.002 on a scale). */
export const XF_SNAP_EPS = Object.freeze({ scale: 0.002, rotDeg: 0.02, m: 0.005 });

export interface XfRails {
  scaleMin: number;
  scaleMax: number;
  /** Max |(tE, tN)| in metres — the vector is shortened, direction kept. */
  translateMaxM: number;
  liftMaxM: number;
}

/** Normalize degrees to (−180, 180]. */
export function normalizeDeg(d: number): number {
  if (!Number.isFinite(d)) return 0;
  let x = ((d + 180) % 360) - 180;
  if (x <= -180) x += 360;
  return x === 0 ? 0 : x; // folds −0 into +0 (a −0 would survive JSON as "0" but fail ===)
}

export function isIdentityXf(x: SpatialXf, eps = XF_NEUTRAL_EPS): boolean {
  return (
    Math.abs(x.sx - 1) < eps.scale &&
    Math.abs(x.sz - 1) < eps.scale &&
    Math.abs(normalizeDeg(x.rotDeg)) < eps.rotDeg &&
    Math.abs(x.tE) < eps.m &&
    Math.abs(x.tN) < eps.m &&
    Math.abs(x.tU) < eps.m
  );
}

export function isIdentityTransform(t: FeatureTransform, eps = XF_NEUTRAL_EPS): boolean {
  return Math.abs(t.sy - 1) < eps.scale && isIdentityXf(t, eps);
}

/** Exact-equality identity (no tolerance) — the "applied state has landed" test. */
export function isExactIdentityXf(x: SpatialXf): boolean {
  return x.sx === 1 && x.sz === 1 && x.rotDeg === 0 && x.tE === 0 && x.tN === 0 && x.tU === 0;
}

/** Clamp an untrusted/proposed spatial transform onto the rails. Pure; never throws; a
 *  non-finite component degrades to identity for that component. */
export function clampXf(x: SpatialXf, rails: XfRails): SpatialXf {
  const fin = (v: number, dflt: number) => (Number.isFinite(v) ? v : dflt);
  const sc = (v: number) => Math.max(rails.scaleMin, Math.min(rails.scaleMax, fin(v, 1)));
  let tE = fin(x.tE, 0);
  let tN = fin(x.tN, 0);
  const r = Math.hypot(tE, tN);
  if (r > rails.translateMaxM && r > 0) {
    const k = rails.translateMaxM / r;
    tE *= k;
    tN *= k;
  }
  return {
    sx: sc(x.sx),
    sz: sc(x.sz),
    rotDeg: normalizeDeg(fin(x.rotDeg, 0)),
    tE,
    tN,
    tU: Math.max(0, Math.min(rails.liftMaxM, fin(x.tU, 0))),
  };
}

/** One per-frame exponential ease of every spatial component toward its target (rotation takes
 *  the short way round). `moved` = something changed this frame; `settled` = the result IS the
 *  target on every component. */
export function easeXf(
  applied: SpatialXf,
  target: SpatialXf,
  k: number,
  snap = XF_SNAP_EPS,
): { next: SpatialXf; moved: boolean; settled: boolean } {
  const step = (a: number, t: number, eps: number): number => {
    let n = a + (t - a) * k;
    if (Math.abs(t - n) < eps) n = t;
    return n;
  };
  const rotTarget = applied.rotDeg + normalizeDeg(target.rotDeg - applied.rotDeg);
  const next: SpatialXf = {
    sx: step(applied.sx, target.sx, snap.scale),
    sz: step(applied.sz, target.sz, snap.scale),
    rotDeg: step(applied.rotDeg, rotTarget, snap.rotDeg),
    tE: step(applied.tE, target.tE, snap.m),
    tN: step(applied.tN, target.tN, snap.m),
    tU: step(applied.tU, target.tU, snap.m),
  };
  if (next.rotDeg === rotTarget) next.rotDeg = normalizeDeg(target.rotDeg);
  const moved =
    next.sx !== applied.sx ||
    next.sz !== applied.sz ||
    next.rotDeg !== applied.rotDeg ||
    next.tE !== applied.tE ||
    next.tN !== applied.tN ||
    next.tU !== applied.tU;
  const settled =
    next.sx === target.sx &&
    next.sz === target.sz &&
    next.rotDeg === normalizeDeg(target.rotDeg) &&
    next.tE === target.tE &&
    next.tN === target.tN &&
    next.tU === target.tU;
  return { next, moved, settled };
}

/** The recompose pivot: pristine centroid X/Z at the TRUE base. */
export interface XfPivot {
  cx: number;
  baseY: number;
  cz: number;
}

/**
 * Recompose `count` pristine vertices (stride 3, read from `src` starting at `srcOffset`) into
 * `dst` starting at `dstOffset`. `sy` is the applied height scale, `dyM` the applied seat delta.
 * Identity `xf` reproduces the incremental writer exactly (see module header).
 */
export function recomposeVerts(
  src: ArrayLike<number>,
  srcOffset: number,
  dst: Float32Array,
  dstOffset: number,
  count: number,
  pivot: XfPivot,
  xf: SpatialXf,
  sy: number,
  dyM: number,
): void {
  const rad = (xf.rotDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ox = pivot.cx + xf.tE;
  const oy = pivot.baseY + dyM + xf.tU;
  const oz = pivot.cz - xf.tN;
  for (let i = 0; i < count; i++) {
    const si = srcOffset + i * 3;
    const di = dstOffset + i * 3;
    const X = (src[si] - pivot.cx) * xf.sx;
    const Y = (src[si + 1] - pivot.baseY) * sy;
    const Z = (src[si + 2] - pivot.cz) * xf.sz;
    dst[di] = ox + c * X + s * Z;
    dst[di + 1] = oy + Y;
    dst[di + 2] = oz - s * X + c * Z;
  }
}

/**
 * The same recompose for SCATTERED destination vertices (an edge-CSR bucket): the j-th packed
 * pristine triple of `src` lands at vertex index `dstIdx[j]` of `dst`, for j in [from, to).
 * `src` is packed in the same j order (see `pristineIndexed`).
 */
export function recomposeIndexed(
  src: ArrayLike<number>,
  dst: Float32Array,
  dstIdx: ArrayLike<number>,
  from: number,
  to: number,
  pivot: XfPivot,
  xf: SpatialXf,
  sy: number,
  dyM: number,
): void {
  const rad = (xf.rotDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ox = pivot.cx + xf.tE;
  const oy = pivot.baseY + dyM + xf.tU;
  const oz = pivot.cz - xf.tN;
  for (let j = from; j < to; j++) {
    const si = (j - from) * 3;
    const di = dstIdx[j] * 3;
    const X = (src[si] - pivot.cx) * xf.sx;
    const Y = (src[si + 1] - pivot.baseY) * sy;
    const Z = (src[si + 2] - pivot.cz) * xf.sz;
    dst[di] = ox + c * X + s * Z;
    dst[di + 1] = oy + Y;
    dst[di + 2] = oz - s * X + c * Z;
  }
}

/**
 * Recover a run's PRISTINE vertices from the incremental writer's live state: X/Z are untouched
 * by that writer and `y = baseY + dyM + (y0 − baseY)·sy` inverts exactly (a few float32 ulps at
 * most). At load-model (dyM 0, sy 1) this is a straight copy, so ONE helper serves both the
 * re-apply-at-load and the first-spatial-edit snapshot.
 */
export function pristineFromIncremental(
  pos: ArrayLike<number>,
  start: number,
  count: number,
  baseY: number,
  dyM: number,
  sy: number,
): Float32Array {
  const out = new Float32Array(count * 3);
  const inv = 1 / (sy || 1);
  for (let i = 0; i < count; i++) {
    const si = (start + i) * 3;
    out[i * 3] = pos[si];
    out[i * 3 + 1] = baseY + (pos[si + 1] - baseY - dyM) * inv;
    out[i * 3 + 2] = pos[si + 2];
  }
  return out;
}

/** Ditto for scattered vertices (edge-CSR bucket `idx[from..to)`), packed in bucket order. */
export function pristineIndexed(
  pos: ArrayLike<number>,
  idx: ArrayLike<number>,
  from: number,
  to: number,
  baseY: number,
  dyM: number,
  sy: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, to - from) * 3);
  const inv = 1 / (sy || 1);
  for (let j = from; j < to; j++) {
    const si = idx[j] * 3;
    const o = (j - from) * 3;
    out[o] = pos[si];
    out[o + 1] = baseY + (pos[si + 1] - baseY - dyM) * inv;
    out[o + 2] = pos[si + 2];
  }
  return out;
}

/** Local-frame position of the transformed pivot BEFORE the seat delta: the live building
 *  centre at base level. Feed it the seat delta on Y to get the on-ground point. */
export function xfPivotLocal(pivot: XfPivot, xf: SpatialXf): [number, number, number] {
  return [pivot.cx + xf.tE, pivot.baseY + xf.tU, pivot.cz - xf.tN];
}

/** XZ radius of a run about its centroid from tracked extents (one pass at load — no second
 *  sweep over the vertices). */
export function runRadiusXZ(
  cx: number,
  cz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): number {
  return Math.hypot(Math.max(cx - minX, maxX - cx), Math.max(cz - minZ, maxZ - cz));
}

/** How far (m) an edit can push geometry past its pristine bounds: the translation, the lift,
 *  the XZ growth and the height growth — each term ≥ 0, so the result is monotone in every
 *  component and the engine's one-way bounds pad stays correct (shrink never un-grows). */
export function boundsGrowthM(xf: SpatialXf, sy: number, rXZ: number, heightM: number): number {
  return (
    Math.hypot(xf.tE, xf.tN) +
    Math.max(0, xf.tU) +
    Math.max(0, (Math.max(xf.sx, xf.sz) - 1) * rXZ) +
    Math.max(0, (sy - 1) * heightM)
  );
}

// ── MESH SUITE MS2 (2026-09-02) — the gizmo rig read-back ────────────────────────────────────
// The gizmo's proxy is the engine's ghost RIG: an `anchor` (a Group under the cell mesh, ENU
// frame — +X east, +Y up, −Z north — carrying the translation) and its child `body` (the ghost
// mesh, carrying the yaw + the scale, XZ inflated a hair). TransformControls writes plain
// Object3D fields on whichever of the two it is attached to; these helpers turn those numbers
// back into a `FeatureTransform` (pure, three-free, unit-pinned as the exact inverse of the
// engine's `placeGhost` writes).

/** Yaw in degrees ((−180, 180], three's makeRotationY sense) of a quaternion that is a pure
 *  rotation about +Y: q = (0, sin θ/2, 0, cos θ/2) ⇒ θ = 2·atan2(qy, qw). Reading Euler
 *  `rotation.y` instead is WRONG past ±90° — an XYZ decomposition of R_y(120°) is
 *  (180°, 60°, 180°) — while the quaternion read is exact over the whole circle and tolerant of
 *  float dust on x/z. */
export function yawDegFromQuaternion(qy: number, qw: number): number {
  return normalizeDeg((2 * Math.atan2(qy, qw) * 180) / Math.PI);
}

/** The rig as Object3D numbers (what the gizmo left behind). */
export interface RigPose {
  /** anchor.position — bake-local metres. */
  ax: number;
  ay: number;
  az: number;
  /** body.quaternion y / w (a pure Y rotation). */
  qy: number;
  qw: number;
  /** body.scale — X/Z carry the ghost inflate factor, Y is the height scale itself. */
  sx: number;
  sy: number;
  sz: number;
}

export interface RigFrame {
  /** Pristine centroid (the pivot) and the LIVE base the drag started from. */
  cx: number;
  cz: number;
  liveBaseY: number;
  /** The ghost's XZ inflate factor (`ENRICHED.overrideGhostInflate`). */
  inflate: number;
}

/** Raw (unclamped) read-back — the inverse of `placeGhost`: anchor = (cx + tE, liveBase + tU,
 *  cz − tN), body = R_y(rotDeg) · diag(inflate·sx, sy, inflate·sz). Clamp the result with
 *  `clampGizmoEdit` (bldgOverrides.ts) before it touches the mesh or a row. */
export function rigToTransform(rig: RigPose, frame: RigFrame): FeatureTransform {
  const inv = frame.inflate > 0 && Number.isFinite(frame.inflate) ? 1 / frame.inflate : 1;
  return {
    sx: rig.sx * inv,
    sz: rig.sz * inv,
    sy: rig.sy,
    rotDeg: yawDegFromQuaternion(rig.qy, rig.qw),
    tE: rig.ax - frame.cx,
    tN: frame.cz - rig.az, // (not −(az − cz): a −0 would survive JSON as "0" but fail ===)
    tU: rig.ay - frame.liveBaseY,
  };
}

/** The forward map (`placeGhost` in numbers) — kept beside its inverse so the pair is pinned
 *  together; the engine's writes must agree with it. */
export function transformToRig(t: FeatureTransform, frame: RigFrame): RigPose {
  const rad = (t.rotDeg * Math.PI) / 180;
  return {
    ax: frame.cx + t.tE,
    ay: frame.liveBaseY + t.tU,
    az: frame.cz - t.tN,
    qy: Math.sin(rad / 2),
    qw: Math.cos(rad / 2),
    sx: frame.inflate * t.sx,
    sy: t.sy,
    sz: frame.inflate * t.sz,
  };
}
