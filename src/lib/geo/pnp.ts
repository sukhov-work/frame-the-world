/**
 * pnp.ts — the facade ALIGNMENT solve (F5's remainder, T172 — 2026-10-23): N correspondences between
 * photo pixels and building points → the camera pose that best reprojects them (Perspective-n-Point).
 * Pure float64 TypeScript, no three.js — the `lib/geo/frustum.ts` discipline, so it is unit-tested by
 * synthesis and the UI half (`alignment.pairs` → EXIF / MANUAL / SOLVED) rides on top.
 *
 * CONVENTIONS (every one read off the app, never assumed):
 *   • The photo frame `uv` — u ∈ [0, 1] RIGHT, v ∈ [0, 1] DOWN from the top-left: the bitmap's row 0
 *     is v 0 (`scene/photoProjector.ts` `flipV` / `src.flipY = false`) and the fragment samples
 *     `vec2(ftwUv.x, 1.0 - ftwUv.y)` (`scene/buildingMaterial.ts` — the projector's clip y is GL-up,
 *     the sample's v is image-down). A pixel (px, py) of a W × H frame is uv (px / W, py / H).
 *   • The world — ENU metres about an ORIGIN the caller picks (the EXIF apex guess; the UI maps the
 *     solved offset back through `enuBasis` + `geodeticToEcef`). East, north, up — `projection.ts`.
 *   • The camera basis — EXACTLY `lib/geo/frustum.ts` `frustumGeometry`: forward from the heading
 *     (compass, clockwise from north) and the pitch (+ up) as `cameraForward` builds it (sin h cos p,
 *     cos h cos p, sin p); right = normalise(forward × up_geodetic); up = right × forward; the EXIF
 *     ROLL (clockwise seen from behind the camera) rotates right / up about forward by −roll.
 *   • The pinhole — a point X: d = X − C; (x, y, z) = (d·right, d·up, d·forward), z > 0 in front;
 *     u = ½ + x / (2 z k), v = ½ − y · aspect / (2 z k) with k = tan(hFov / 2), aspect = W / H
 *     (`verticalFovDeg`: tan(vFov / 2) = k / aspect). The far face's top-left lands on (0, 0),
 *     the bottom-right on (1, 1) — pinned by the tests against `frustumGeometry`'s corner order.
 *
 * THE MATHS: the N points are tested for coplanarity (a facade usually is — PCA, the thinnest
 * extent against the widest). Planar → a plane-to-image HOMOGRAPHY by the normalised DLT (Hartley's
 * conditioning), decomposed for a calibrated camera into [R a, R b, R (o − C)] (a, b the in-plane
 * basis, o the centroid) — the sign is the only ambiguity and the points IN FRONT of the camera
 * (z > 0) pick it. General → the 3 × 4 DLT (N ≥ 6), the rotation block orthonormalised. Both feed
 * a Levenberg–Marquardt refinement over (C, a rotation 3-vector, optionally k) minimising the
 * reprojection error in PIXELS (u by W, v by H — the aspect weights v); N ≥ 6 adds one Huber
 * re-weighting pass (a mis-marked pair must not drag the pose). A caller's `init` pose (the EXIF
 * pose) is a second start; the lower RMS wins. Deterministic (no random starts).
 *
 * TRAPS: the app's basis [right, up, forward] is LEFT-handed (frustum.ts: right = forward × up, so
 * right × up = −forward — the GL camera, whose +z is backward); the solver's INTERNAL rotation is
 * [right, DOWN, forward] (det +1, and v is image-down by construction: p = R (X − C) → u = ½ + x /
 * (2 z k), v = ½ + y · aspect / (2 z k)) — `toInternal` / `fromInternal` flip the middle row; the
 * closed-form starts and the LM live in that frame. A −0 heading is folded before `sin`; the
 * rotation update is `exp([δ]×) · R` (the camera frame), so ∂p/∂δ = −[p]× and ∂p/∂C = −R; the
 * homography's null vector comes from the Jacobi eigen-solve of AᵀA (symmetric 9 × 9, no SVD
 * dependency); `k` is refined as tan(hFov / 2), never the angle (the Jacobian is linear in 1 / k).
 */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // rows

export interface FacadePair {
  /** The photo point — u right, v down, both in [0, 1] (see the header). */
  uv: [number, number];
  /** The world point — ENU metres about the caller's origin. */
  enu: Vec3;
  /** Optional: the building this point sits on (`osm:w…` — `lib/globe/facadeTargets`). */
  target?: string;
}

export interface FacadeIntrinsics {
  /** The full horizontal field of view (deg) — the EXIF / edited H-FOV; solved when `solveFov`. */
  hFovDeg: number;
  /** W / H of the photo. */
  aspect: number;
  /** The photo's width in px — the residuals' unit (default 1000, a relative scale). */
  widthPx?: number;
}

/** The pose the app stores (ENU metres about the origin + the frustum's angles + the H-FOV). */
export interface FacadeEnuPose {
  enu: Vec3;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  hFovDeg: number;
}

export interface SolveOptions {
  /** A starting pose (the EXIF / MANUAL one) — a second LM start; the better result wins. */
  init?: Partial<FacadeEnuPose>;
  /** Refine the H-FOV too (needs N ≥ 6 — held otherwise). */
  solveFov?: boolean;
  /** The planarity test: the thinnest extent over the widest (default 0.02) — a facade's reliefs. */
  planarRatio?: number;
}

export interface SolveResult {
  ok: boolean;
  reason?: string;
  pose: FacadeEnuPose;
  /** Per pair: the uv residual (predicted − observed) and its length in px. */
  residuals: { uv: [number, number]; px: number }[];
  rmsPx: number;
  iterations: number;
  planar: boolean;
  /** The H-FOV was refined (N ≥ 6 and `solveFov`). */
  fovSolved: boolean;
}

const DEG = Math.PI / 180;
const fin = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ── small linear algebra ─────────────────────────────────────────────────────────────────────────
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
};
const matVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];
const matMul = (a: Mat3, b: Mat3): Mat3 => {
  const bt = transpose(b);
  return [
    [dot(a[0], bt[0]), dot(a[0], bt[1]), dot(a[0], bt[2])],
    [dot(a[1], bt[0]), dot(a[1], bt[1]), dot(a[1], bt[2])],
    [dot(a[2], bt[0]), dot(a[2], bt[1]), dot(a[2], bt[2])],
  ];
};
/** Rodrigues: the rotation matrix of the rotation vector `w` (axis × angle). */
function expSO3(w: Vec3): Mat3 {
  const th = norm(w);
  if (th < 1e-12) return [[1, -w[2], w[1]], [w[2], 1, -w[0]], [-w[1], w[0], 1]];
  const k = scale(w, 1 / th);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  return [
    [c + k[0] * k[0] * t, k[0] * k[1] * t - k[2] * s, k[0] * k[2] * t + k[1] * s],
    [k[1] * k[0] * t + k[2] * s, c + k[1] * k[1] * t, k[1] * k[2] * t - k[0] * s],
    [k[2] * k[0] * t - k[1] * s, k[2] * k[1] * t + k[0] * s, c + k[2] * k[2] * t],
  ];
}
/** The nearest rotation to a 3 × 3 (Gram–Schmidt on the rows, right-handed) — enough for an LM start. */
function orthonormalise(m: Mat3): Mat3 {
  const r0 = unit(m[0]);
  const r1 = unit(sub(m[1], scale(r0, dot(m[1], r0))));
  const r2 = cross(r0, r1);
  return [r0, r1, r2];
}
/** Cyclic Jacobi on a symmetric n × n: eigenvalues (ascending) + eigenvectors (columns). */
function symEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const m = a.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => m[i][i] - m[j][j]);
  return { values: order.map((i) => m[i][i]), vectors: order.map((i) => v.map((row) => row[i])) };
}
/** The null vector of A (rows) = the eigenvector of AᵀA with the smallest eigenvalue. */
function nullVector(rows: number[][], n: number): { x: number[]; gap: number } {
  const ata = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of rows) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ata[i][j] += r[i] * r[j];
  const e = symEigen(ata);
  return { x: e.vectors[0], gap: e.values[1] > 0 ? e.values[0] / e.values[1] : 1 };
}
/** Solve M x = b (M symmetric positive-ish, n ≤ 7) by Gaussian elimination with pivoting; null when singular. */
function solveLinear(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  const a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-14) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => r[n] / r[i]);
}

// ── the camera basis ↔ the app's pose (the frustum.ts formulas, verbatim) ───────────────────────
const ENU_UP: Vec3 = [0, 0, 1];
const rotateAround = (v: Vec3, k: Vec3, rad: number): Vec3 => add(scale(v, Math.cos(rad)), scale(cross(k, v), Math.sin(rad)));

/** The camera basis in ENU — rows [right, up, forward] — of a facade pose (`frustumGeometry` twin). */
export function facadeCameraBasis(headingDeg: number, pitchDeg = 0, rollDeg = 0): Mat3 {
  const h = (fin(headingDeg, 0) || 0) * DEG; // `|| 0` folds a −0 heading (the facadePose.ts care)
  const p = fin(pitchDeg, 0) * DEG;
  const cp = Math.cos(p);
  const forward = unit([Math.sin(h) * cp, Math.cos(h) * cp, Math.sin(p)]);
  let right = cross(forward, ENU_UP);
  if (norm(right) === 0) right = cross(forward, [0, 1, 0]); // straight up / down: nudge via north
  right = unit(right);
  let up = cross(right, forward);
  const roll = -fin(rollDeg, 0) * DEG;
  if (roll !== 0) {
    right = rotateAround(right, forward, roll);
    up = rotateAround(up, forward, roll);
  }
  return [right, up, forward];
}

/** The inverse: heading / pitch / roll (deg) of a camera basis (rows [right, up, forward]). */
export function facadePoseOfBasis(basis: Mat3): { headingDeg: number; pitchDeg: number; rollDeg: number } {
  const [right, , forward] = basis;
  const headingDeg = wrap360(Math.atan2(forward[0], forward[1]) / DEG);
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, forward[2]))) / DEG;
  let right0 = cross(forward, ENU_UP);
  if (norm(right0) === 0) right0 = cross(forward, [0, 1, 0]);
  right0 = unit(right0);
  // The signed angle from the levelled right to the rolled right about forward is −roll.
  const rollDeg = -Math.atan2(dot(cross(right0, right), forward), dot(right0, right)) / DEG;
  return { headingDeg, pitchDeg, rollDeg: rollDeg === 0 ? 0 : rollDeg };
}
const wrap360 = (d: number): number => {
  const w = ((d % 360) + 360) % 360;
  return w === 0 ? 0 : w;
};
/** The app's left-handed [right, up, forward] ↔ the solver's proper rotation [right, down, forward]. */
const toInternal = (b: Mat3): Mat3 => [b[0], scale(b[1], -1), b[2]];
const fromInternal = (r: Mat3): Mat3 => [r[0], scale(r[1], -1), r[2]];

/** The photo uv of a world point under a pose (null behind the camera). */
export function projectFacadePoint(enu: Vec3, pose: FacadeEnuPose, aspect: number): [number, number] | null {
  const R = facadeCameraBasis(pose.headingDeg, pose.pitchDeg, pose.rollDeg);
  const k = Math.tan((pose.hFovDeg * DEG) / 2);
  const p = matVec(R, sub(enu, pose.enu));
  if (!(p[2] > 1e-9)) return null;
  return [0.5 + p[0] / (2 * p[2] * k), 0.5 - (p[1] * aspect) / (2 * p[2] * k)];
}

/** The reprojection residuals of a pose over the pairs (the UI's EXIF-vs-SOLVED readout). */
export function facadeReprojection(pairs: readonly FacadePair[], pose: FacadeEnuPose, intr: FacadeIntrinsics): { residuals: SolveResult["residuals"]; rmsPx: number } {
  const W = fin(intr.widthPx, 1000);
  const H = W / intr.aspect;
  let sum = 0;
  const residuals = pairs.map((p) => {
    const uv = projectFacadePoint(p.enu, pose, intr.aspect);
    const du = uv ? uv[0] - p.uv[0] : Number.NaN;
    const dv = uv ? uv[1] - p.uv[1] : Number.NaN;
    const px = uv ? Math.hypot(du * W, dv * H) : Number.POSITIVE_INFINITY;
    sum += uv ? px * px : 1e12;
    return { uv: [du, dv] as [number, number], px };
  });
  return { residuals, rmsPx: Math.sqrt(sum / Math.max(1, pairs.length)) };
}

// ── the closed-form starts ───────────────────────────────────────────────────────────────────────
/** The best-fit plane: centroid, in-plane basis (a, b), normal, and the extents (PCA). */
function fitPlane(pts: readonly Vec3[]): { o: Vec3; a: Vec3; b: Vec3; n: Vec3; extents: Vec3 } {
  const o: Vec3 = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) o[i] += p[i] / pts.length;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = sub(p, o);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const e = symEigen(cov);
  const n = unit(e.vectors[0] as Vec3);
  const a = unit(e.vectors[2] as Vec3);
  const b = cross(n, a);
  const extents: Vec3 = [Math.sqrt(Math.max(0, e.values[2])), Math.sqrt(Math.max(0, e.values[1])), Math.sqrt(Math.max(0, e.values[0]))];
  return { o, a, b, n, extents };
}
/** Hartley normalisation of 2-D points: a similarity T with centroid 0 and mean distance √2. */
function normalise2(pts: number[][]): { T: number[][]; out: number[][] } {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) (cx += p[0] / n), (cy += p[1] / n);
  let md = 0;
  for (const p of pts) md += Math.hypot(p[0] - cx, p[1] - cy) / n;
  const s = md > 0 ? Math.SQRT2 / md : 1;
  return { T: [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]], out: pts.map((p) => [s * (p[0] - cx), s * (p[1] - cy)]) };
}
const mul3 = (a: number[][], b: number[][]): number[][] => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const inv3T = (T: number[][]): number[][] => [[1 / T[0][0], 0, -T[0][2] / T[0][0]], [0, 1 / T[1][1], -T[1][2] / T[1][1]], [0, 0, 1]];

/** The homography start: plane coords (s, t) → normalised image coords (x, y) = (x_c / z_c, y_c / z_c). */
function planarStart(pairs: readonly FacadePair[], xy: number[][], plane: ReturnType<typeof fitPlane>): { R: Mat3; C: Vec3 } | null {
  const st = pairs.map((p) => {
    const d = sub(p.enu, plane.o);
    return [dot(d, plane.a), dot(d, plane.b)];
  });
  const A = normalise2(st);
  const B = normalise2(xy);
  const rows: number[][] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [s, t] = A.out[i];
    const [x, y] = B.out[i];
    rows.push([-s, -t, -1, 0, 0, 0, x * s, x * t, x]);
    rows.push([0, 0, 0, -s, -t, -1, y * s, y * t, y]);
  }
  const { x: h, gap } = nullVector(rows, 9);
  // Four points always fit a homography exactly; N 5 off the plane fits one loosely (the LM finishes
  // it); only a rank-deficient system (collinear image points) has NO usable null vector.
  if (!(gap < 0.5)) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]];
  const Hm = mul3(mul3(inv3T(B.T), Hn), A.T); // de-normalise: H = Tb⁻¹ · Hn · Ta
  const c1: Vec3 = [Hm[0][0], Hm[1][0], Hm[2][0]];
  const c2: Vec3 = [Hm[0][1], Hm[1][1], Hm[2][1]];
  const c3: Vec3 = [Hm[0][2], Hm[1][2], Hm[2][2]];
  const lambda = (norm(c1) + norm(c2)) / 2;
  if (!(lambda > 0)) return null;
  let best: { R: Mat3; C: Vec3 } | null = null;
  for (const sign of [1, -1]) {
    const r1 = unit(scale(c1, sign / lambda));
    const r2 = unit(scale(c2, sign / lambda));
    const Rc = orthonormalise([r1, r2, cross(r1, r2)]); // rows: R a, R b, R n (as COLUMN images) — see below
    // Rc holds the images of a, b, n as ROWS; R maps world → camera with R·a = Rc[0] etc.:
    // R = [Rc rows as columns] · [a b n]ᵀ.
    const RcT = transpose(Rc);
    const basisT: Mat3 = [plane.a, plane.b, plane.n];
    const R = matMul(RcT, basisT);
    const tcam = scale(c3, sign / lambda);
    const C = sub(plane.o, matVec(transpose(R), tcam));
    const inFront = pairs.every((p) => matVec(R, sub(p.enu, C))[2] > 0);
    if (inFront) best = { R, C };
  }
  return best;
}
/** The general start: the 3 × 4 DLT (N ≥ 6), the rotation block orthonormalised. */
function generalStart(pairs: readonly FacadePair[], xy: number[][]): { R: Mat3; C: Vec3 } | null {
  const rows: number[][] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [X, Y, Z] = pairs[i].enu;
    const [x, y] = xy[i];
    rows.push([-X, -Y, -Z, -1, 0, 0, 0, 0, x * X, x * Y, x * Z, x]);
    rows.push([0, 0, 0, 0, -X, -Y, -Z, -1, y * X, y * Y, y * Z, y]);
  }
  const { x: p, gap } = nullVector(rows, 12);
  if (!(gap < 1e-2)) return null;
  const M: Mat3 = [[p[0], p[1], p[2]], [p[4], p[5], p[6]], [p[8], p[9], p[10]]];
  const t: Vec3 = [p[3], p[7], p[11]];
  const s = (norm(M[0]) + norm(M[1]) + norm(M[2])) / 3;
  if (!(s > 0)) return null;
  // The null vector's sign is fixed by det(M) > 0 — M ∝ a PROPER rotation (an in-front test alone
  // can accept the 180°-twisted twin of the wrong sign, whose points also sit at z > 0).
  const det = dot(M[0], cross(M[1], M[2]));
  const sign = det < 0 ? -1 : 1;
  const R = orthonormalise([scale(M[0], sign / s), scale(M[1], sign / s), scale(M[2], sign / s)]);
  const C = scale(matVec(transpose(R), scale(t, sign / s)), -1);
  return pairs.every((q) => matVec(R, sub(q.enu, C))[2] > 0) ? { R, C } : null;
}

// ── the refinement ───────────────────────────────────────────────────────────────────────────────
interface Refined { R: Mat3; C: Vec3; k: number; iterations: number; rmsPx: number }
function refine(pairs: readonly FacadePair[], start: { R: Mat3; C: Vec3 }, k0: number, aspect: number, W: number, solveFov: boolean, weights: number[]): Refined {
  const H = W / aspect;
  let R = start.R;
  let C = start.C;
  let k = k0;
  const m = solveFov ? 7 : 6;
  const cost = (Rr: Mat3, Cc: Vec3, kk: number): number => {
    let s = 0;
    for (let i = 0; i < pairs.length; i++) {
      const p = matVec(Rr, sub(pairs[i].enu, Cc));
      if (!(p[2] > 1e-9)) return Number.POSITIVE_INFINITY;
      const du = (0.5 + p[0] / (2 * p[2] * kk) - pairs[i].uv[0]) * W;
      const dv = (0.5 + (p[1] * aspect) / (2 * p[2] * kk) - pairs[i].uv[1]) * H;
      s += weights[i] * (du * du + dv * dv);
    }
    return s;
  };
  let cur = cost(R, C, k);
  let lambda = 1e-3;
  let it = 0;
  let done = false;
  for (; it < 60 && !done; it++) {
    const JtJ = Array.from({ length: m }, () => new Array(m).fill(0));
    const Jtr = new Array(m).fill(0);
    for (let i = 0; i < pairs.length; i++) {
      const p = matVec(R, sub(pairs[i].enu, C));
      const z = p[2];
      const inv2zk = 1 / (2 * z * k);
      const ru = (0.5 + p[0] * inv2zk - pairs[i].uv[0]) * W;
      const rv = (0.5 + p[1] * aspect * inv2zk - pairs[i].uv[1]) * H;
      // ∂u/∂p = W/(2k) · [1/z, 0, −x/z²]; ∂v/∂p = H·aspect/(2k) · [0, 1/z, −y/z²] (y is image-down)
      const gu: Vec3 = [(W / (2 * k)) / z, 0, (-(W / (2 * k)) * p[0]) / (z * z)];
      const gv: Vec3 = [0, ((H * aspect) / (2 * k)) / z, (-((H * aspect) / (2 * k)) * p[1]) / (z * z)];
      // ∂p/∂C = −R ; ∂p/∂δ = −[p]× (the update exp([δ]×)·R)
      const dpdC: Mat3 = [scale(R[0], -1), scale(R[1], -1), scale(R[2], -1)]; // rows = ∂p_i/∂C
      const px: Mat3 = [[0, p[2], -p[1]], [-p[2], 0, p[0]], [p[1], -p[0], 0]]; // −[p]× rows
      const Ju = new Array(m).fill(0);
      const Jv = new Array(m).fill(0);
      for (let c = 0; c < 3; c++) {
        Ju[c] = gu[0] * dpdC[0][c] + gu[1] * dpdC[1][c] + gu[2] * dpdC[2][c];
        Jv[c] = gv[0] * dpdC[0][c] + gv[1] * dpdC[1][c] + gv[2] * dpdC[2][c];
        Ju[3 + c] = gu[0] * px[0][c] + gu[1] * px[1][c] + gu[2] * px[2][c];
        Jv[3 + c] = gv[0] * px[0][c] + gv[1] * px[1][c] + gv[2] * px[2][c];
      }
      if (solveFov) {
        Ju[6] = (-(W * p[0]) / (2 * z)) / (k * k);
        Jv[6] = (-(H * aspect * p[1]) / (2 * z)) / (k * k);
      }
      const w = weights[i];
      for (let a = 0; a < m; a++) {
        Jtr[a] += w * (Ju[a] * ru + Jv[a] * rv);
        for (let b = 0; b < m; b++) JtJ[a][b] += w * (Ju[a] * Ju[b] + Jv[a] * Jv[b]);
      }
    }
    let stepped = false;
    for (let tries = 0; tries < 8 && !stepped; tries++) {
      const Md = JtJ.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = solveLinear(Md, Jtr.map((v) => -v));
      if (!d) {
        lambda *= 10;
        continue;
      }
      const C2 = add(C, [d[0], d[1], d[2]]);
      const R2 = matMul(expSO3([d[3], d[4], d[5]]), R);
      const k2 = solveFov ? Math.max(0.05, Math.min(20, k + d[6])) : k;
      const c2 = cost(R2, C2, k2);
      if (c2 < cur) {
        const rel = (cur - c2) / Math.max(cur, 1e-30);
        C = C2;
        R = R2;
        k = k2;
        cur = c2;
        lambda = Math.max(1e-9, lambda / 3);
        stepped = true;
        if (rel < 1e-12 || Math.hypot(d[0], d[1], d[2]) < 1e-9) done = true;
      } else lambda *= 10;
    }
    if (!stepped) break;
  }
  const wsum = weights.reduce((s, w) => s + w, 0);
  return { R, C, k, iterations: it, rmsPx: Math.sqrt(cur / Math.max(wsum, 1e-9)) };
}

/** The solve's own planarity test, standalone (the UI's "one flat wall" note BEFORE a solve): true
 *  when the points' thinnest extent is under `planarRatio` of the widest, false when they span a
 *  volume (a corner, two walls), null when fewer than 3 points or collinear (no plane to test). */
export function facadePairsPlanar(pairs: readonly FacadePair[], planarRatio = 0.02): boolean | null {
  if (pairs.length < 3 || !pairs.every((p) => p.enu.every(Number.isFinite))) return null;
  const plane = fitPlane(pairs.map((p) => p.enu));
  if (!(plane.extents[0] > 1e-6) || plane.extents[1] / plane.extents[0] < 1e-4) return null;
  return plane.extents[2] / plane.extents[0] < planarRatio;
}

// ── the solve ────────────────────────────────────────────────────────────────────────────────────
const FAIL = (reason: string, pose: FacadeEnuPose, planar = false): SolveResult => ({ ok: false, reason, pose, residuals: [], rmsPx: Number.POSITIVE_INFINITY, iterations: 0, planar, fovSolved: false });

export function solveFacadePose(pairs: readonly FacadePair[], intr: FacadeIntrinsics, opts: SolveOptions = {}): SolveResult {
  const init: FacadeEnuPose = {
    enu: (opts.init?.enu as Vec3 | undefined) ?? [0, 0, 0],
    headingDeg: fin(opts.init?.headingDeg, 0),
    pitchDeg: fin(opts.init?.pitchDeg, 0),
    rollDeg: fin(opts.init?.rollDeg, 0),
    hFovDeg: fin(opts.init?.hFovDeg, intr.hFovDeg),
  };
  const N = pairs.length;
  if (N < 4) return FAIL(`need at least 4 pairs (got ${N})`, init);
  if (!pairs.every((p) => p.uv.every(Number.isFinite) && p.enu.every(Number.isFinite))) return FAIL("a pair carries a non-finite number", init);
  const aspect = intr.aspect;
  const k0 = Math.tan((intr.hFovDeg * DEG) / 2);
  if (!(aspect > 0) || !(k0 > 0) || intr.hFovDeg >= 180) return FAIL("the intrinsics must be a positive aspect and an H-FOV in (0, 180)", init);
  const W = fin(intr.widthPx, 1000);
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++)
      if (norm(sub(pairs[i].enu, pairs[j].enu)) < 1e-6 || Math.hypot(pairs[i].uv[0] - pairs[j].uv[0], pairs[i].uv[1] - pairs[j].uv[1]) < 1e-9)
        return FAIL(`pairs ${i} and ${j} repeat a point`, init);
  const plane = fitPlane(pairs.map((p) => p.enu));
  if (!(plane.extents[0] > 1e-6) || plane.extents[1] / plane.extents[0] < 1e-4) return FAIL("the world points are collinear", init);
  const planar = plane.extents[2] / plane.extents[0] < fin(opts.planarRatio, 0.02);
  const xy = pairs.map((p) => [(p.uv[0] - 0.5) * 2 * k0, ((p.uv[1] - 0.5) * (2 * k0)) / aspect]); // (x, y) = (x_c, y_c) / z_c, y DOWN
  const starts: { R: Mat3; C: Vec3 }[] = [];
  const closed = planar || N < 6 ? planarStart(pairs, xy, plane) : (generalStart(pairs, xy) ?? planarStart(pairs, xy, plane));
  if (closed) starts.push(closed);
  if (opts.init && opts.init.enu) starts.push({ R: toInternal(facadeCameraBasis(init.headingDeg, init.pitchDeg, init.rollDeg)), C: init.enu });
  if (starts.length === 0) return FAIL("no closed-form start (a degenerate configuration — collinear image points?)", init, planar);
  const solveFov = !!opts.solveFov && N >= 6;
  const kInit = solveFov && opts.init?.hFovDeg ? Math.tan((init.hFovDeg * DEG) / 2) : k0;
  let best: Refined | null = null;
  for (const s of starts) {
    const ones = new Array(N).fill(1);
    // Staged: the pose at the given H-FOV first, then (N ≥ 6) the H-FOV released with it — a joint
    // start from a wrong k walks the dolly-zoom valley into a false minimum.
    const r0 = refine(pairs, s, kInit, aspect, W, false, ones);
    let r = solveFov && Number.isFinite(r0.rmsPx) ? refine(pairs, { R: r0.R, C: r0.C }, r0.k, aspect, W, true, ones) : r0;
    if (solveFov && Number.isFinite(r0.rmsPx)) r = { ...r, iterations: r0.iterations + r.iterations };
    if (N >= 6 && Number.isFinite(r.rmsPx)) {
      // One Huber pass: a pair past 1.5 × the median residual (floored at 2 px) is down-weighted.
      const res = pairs.map((p, i) => {
        const q = matVec(r.R, sub(p.enu, r.C));
        return Math.hypot((0.5 + q[0] / (2 * q[2] * r.k) - p.uv[0]) * W, (0.5 + (q[1] * aspect) / (2 * q[2] * r.k) - p.uv[1]) * (W / aspect));
      });
      const med = [...res].sort((a, b) => a - b)[Math.floor(N / 2)];
      const c = Math.max(2, 1.5 * med);
      const w = res.map((e) => (e > c ? c / e : 1));
      if (w.some((x) => x < 1)) {
        const r2 = refine(pairs, { R: r.R, C: r.C }, r.k, aspect, W, solveFov, w);
        if (Number.isFinite(r2.rmsPx)) r = { ...r2, iterations: r.iterations + r2.iterations };
      }
    }
    if (!best || r.rmsPx < best.rmsPx) best = r;
  }
  if (!best || !Number.isFinite(best.rmsPx)) return FAIL("the refinement diverged (points behind the camera)", init, planar);
  const angles = facadePoseOfBasis(fromInternal(best.R));
  const pose: FacadeEnuPose = { enu: best.C, ...angles, hFovDeg: (2 * Math.atan(best.k)) / DEG };
  const rep = facadeReprojection(pairs, pose, intr);
  return { ok: true, pose, residuals: rep.residuals, rmsPx: rep.rmsPx, iterations: best.iterations, planar, fovSolved: solveFov };
}
