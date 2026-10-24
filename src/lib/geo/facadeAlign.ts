/**
 * facadeAlign.ts — F5's UI half, the PURE part (T172 — 2026-10-24): the alignment RECORD a
 * FacadePhotos row stores (`alignment`, JSON-in-TEXT ≤ 16 KiB), the geodetic ↔ ENU bridge the
 * point pairs ride, and the ONE solve the panel calls — `solveFacadeDraft` (the placed draft's pose
 * + its pairs → `solveFacadePose` → the `FacadePoseSnapshot` the journal restores). No three.js, no
 * zustand, no tunables: the server's record core (`lib/wix/facadeRecords.ts`) imports the record half
 * for the SOLVED stamp; the panel and the orchestrator import the bridge and the solve.
 *
 * THE RECORD. `{ pairs, origin, solved? }`:
 *   • `pairs[i] = { uv: [u, v], enu: [e, n, u], target? }` — the photo point (u right, v DOWN, both
 *     in [0, 1] — `pnp.ts`'s frame, the projector's sample frame) and the building point in ENU
 *     metres about `origin`; `target` the building's key (`osm:w…` — `lib/globe/facadeTargets`).
 *   • `origin = { lat, lon, altM }` — the ENU origin: the draft's APEX (ellipsoidal altitude) the
 *     moment the first pair was picked. FIXED for the life of the record: a building point is an
 *     absolute fact, so moving the camera afterwards (a gizmo drag, a solve) never moves a pair.
 *   • `solved = { pose, rmsPx, n, fovSolved, planar, at }` — the last solve's output; `pose` is the
 *     EXACT snapshot `restorePose` wrote (never rounded — the server stamps `poseSource: "SOLVED"`
 *     when the saved pose still equals it; a nudge afterwards reads MANUAL again).
 *
 * THE ALTITUDE LAW (PhotoFrustum.ts): a MANUAL `altitudeM` is metres above the RENDERED ground
 * (`terrainH + altitudeM`), an untouched EXIF altitude an absolute height clamped above the ground.
 * The solver answers an ellipsoidal apex (origin.altM + enu up), so the snapshot's `altitudeM` is
 * that height MINUS the ground under the draft NOW (`apexAltM − apexAboveGroundM`). The frustum
 * re-samples the terrain at the NEW lat / lon, so on a slope the seated apex lands off by the
 * terrain delta over the move — the panel shows the LIVE reprojection of the seated pose, and a
 * second SOLVE converges (the delta is centimetres on a street, the solver's own bar is 0.4 m).
 */

import type { FrustumGeometry } from "./frustum";
import { ecefToGeodetic, enuBasis, geodeticToEcef, type Geodetic, type Vec3 as RVec3 } from "./projection";
import {
  facadeReprojection,
  solveFacadePose,
  type FacadeEnuPose,
  type FacadeIntrinsics,
  type FacadePair,
  type SolveResult,
  type Vec3,
} from "./pnp";
import type { FacadePoseSnapshot } from "../wix/facadeRecords";

export type { FacadePair as FacadeAlignPair } from "./pnp";

/** The ENU origin of a record's pairs — the apex at the first pick; `altM` ellipsoidal. */
export interface FacadeAlignOrigin {
  lat: number;
  lon: number;
  altM: number;
}

/** The pose a solve wrote — the journal snapshot's shape, every angle a number (a solve leaves nothing unset). */
export type FacadeSolvedPose = FacadePoseSnapshot;

/** The last solve's record (what the panel prints and the server's SOLVED stamp reads). */
export interface FacadeSolved {
  pose: FacadeSolvedPose;
  /** The RMS reprojection error of `pose` over the pairs, in photo pixels (`widthPx` = the texture width). */
  rmsPx: number;
  /** How many pairs the solve used. */
  n: number;
  /** The H-FOV was released (N ≥ 6 and the checkbox). */
  fovSolved: boolean;
  /** The pairs lay on ONE plane (one wall): yaw and sideways position trade off — a corner pins them. */
  planar: boolean;
  /** ISO time of the solve. */
  at: string;
}

export interface FacadeAlignmentRecord {
  pairs: FacadePair[];
  origin: FacadeAlignOrigin;
  solved?: FacadeSolved;
}

/** The solver's floor (`solveFacadePose` refuses fewer). */
export const FACADE_PAIRS_MIN = 4;
/** The H-FOV release + the outlier pass need this many (`pnp.ts`). */
export const FACADE_PAIRS_FOV_MIN = 6;
/** The cap: ≈ 110 B a pair serialised → 24 pairs ≈ 2.6 KB + the solve, well under the 16 KiB seat. */
export const FACADE_PAIRS_MAX = 24;
/** The longest building key a pair may name (the `targetFeatureIds` rail). */
export const FACADE_PAIR_TARGET_MAX_LEN = 80;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : isNum(v) ? v : undefined);

// ── the record: parse (lenient, untrusted) + serialise ───────────────────────────────────────────

/** A pose block of the record → the snapshot, or null when any angle is missing / non-finite
 *  (`altitudeM` may be null — "unset"). Untrusted input: a body can carry anything. */
export function parseFacadeSolvedPose(raw: unknown): FacadeSolvedPose | null {
  if (!isObj(raw)) return null;
  const alt = numOrNull(raw.altitudeM);
  if (alt === undefined) return null;
  const lat = raw.lat;
  const lon = raw.lon;
  const headingDeg = raw.headingDeg;
  const pitchDeg = raw.pitchDeg;
  const rollDeg = raw.rollDeg;
  const hFovDeg = raw.hFovDeg;
  if (!isNum(lat) || !isNum(lon) || !isNum(headingDeg) || !isNum(pitchDeg) || !isNum(rollDeg) || !isNum(hFovDeg)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(hFovDeg > 0 && hFovDeg < 180)) return null;
  return { lat, lon, altitudeM: alt, headingDeg, pitchDeg, rollDeg, hFovDeg };
}

/**
 * The stored / posted `alignment` object → a typed record, or null when it holds no usable
 * alignment (`{}`, a legacy shape, no origin, no valid pair). Malformed pairs are DROPPED, not
 * fatal; the pairs are capped at `FACADE_PAIRS_MAX`; a malformed `solved` is dropped on its own.
 */
export function parseFacadeAlignment(raw: unknown): FacadeAlignmentRecord | null {
  if (!isObj(raw)) return null;
  const o = raw.origin;
  if (!isObj(o) || !isNum(o.lat) || !isNum(o.lon) || !isNum(o.altM) || Math.abs(o.lat) > 90 || Math.abs(o.lon) > 180) return null;
  if (!Array.isArray(raw.pairs)) return null;
  const pairs: FacadePair[] = [];
  for (const p of raw.pairs) {
    if (pairs.length >= FACADE_PAIRS_MAX) break;
    if (!isObj(p) || !Array.isArray(p.uv) || !Array.isArray(p.enu) || p.uv.length !== 2 || p.enu.length !== 3) continue;
    const [u, v] = p.uv;
    const [e, n, up] = p.enu;
    if (!isNum(u) || !isNum(v) || !isNum(e) || !isNum(n) || !isNum(up)) continue;
    if (u < -0.5 || u > 1.5 || v < -0.5 || v > 1.5) continue; // a point well outside the frame is garbage
    const pair: FacadePair = { uv: [u, v], enu: [e, n, up] };
    if (typeof p.target === "string" && p.target.length > 0 && p.target.length <= FACADE_PAIR_TARGET_MAX_LEN) pair.target = p.target;
    pairs.push(pair);
  }
  if (pairs.length === 0) return null;
  const record: FacadeAlignmentRecord = { pairs, origin: { lat: o.lat, lon: o.lon, altM: o.altM } };
  const s = raw.solved;
  if (isObj(s)) {
    const pose = parseFacadeSolvedPose(s.pose);
    if (pose && isNum(s.rmsPx) && s.rmsPx >= 0 && isNum(s.n) && Number.isInteger(s.n) && s.n >= 0 && typeof s.at === "string") {
      record.solved = { pose, rmsPx: s.rmsPx, n: s.n, fovSolved: s.fovSolved === true, planar: s.planar === true, at: s.at };
    }
  }
  return record;
}

/** The solve's pose off an `alignment` value (typed or raw) — the server's SOLVED-stamp read. */
export function solvedPoseOfAlignment(alignment: unknown): FacadeSolvedPose | null {
  if (!isObj(alignment)) return null;
  const s = alignment.solved;
  return isObj(s) ? parseFacadeSolvedPose(s.pose) : null;
}

const round = (v: number, dp: number): number => {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
};

/**
 * The plain object the bodies carry: pairs rounded (uv to 1e-6 ≈ 0.002 px, ENU to the millimetre —
 * both far inside the click noise), the origin and the solve VERBATIM (the solved pose must equal
 * the saved pose byte for byte — the SOLVED stamp). Null when there is nothing to store (no pairs):
 * the bodies then leave `alignment` out, so a re-save never wipes a stored set.
 */
export function alignmentRecordOf(pairs: readonly FacadePair[], origin: FacadeAlignOrigin | undefined, solved?: FacadeSolved): Record<string, unknown> | null {
  if (!origin || pairs.length === 0) return null;
  const out: Record<string, unknown> = {
    pairs: pairs.slice(0, FACADE_PAIRS_MAX).map((p) => ({
      uv: [round(p.uv[0], 6), round(p.uv[1], 6)],
      enu: [round(p.enu[0], 3), round(p.enu[1], 3), round(p.enu[2], 3)],
      ...(p.target ? { target: p.target } : {}),
    })),
    origin: { lat: origin.lat, lon: origin.lon, altM: origin.altM },
  };
  if (solved) out.solved = { pose: { ...solved.pose }, rmsPx: solved.rmsPx, n: solved.n, fovSolved: solved.fovSolved, planar: solved.planar, at: solved.at };
  return out;
}

// ── the geodetic ↔ ENU bridge ────────────────────────────────────────────────────────────────────

const dot3 = (a: RVec3, b: RVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** ECEF metres → ENU metres about the origin (east, north, up). */
export function enuOfEcef(origin: FacadeAlignOrigin, ecef: RVec3): Vec3 {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.altM);
  const b = enuBasis(origin.lat, origin.lon);
  const d: RVec3 = [ecef[0] - o[0], ecef[1] - o[1], ecef[2] - o[2]];
  return [dot3(d, b.east), dot3(d, b.north), dot3(d, b.up)];
}

/** ENU metres about the origin → ECEF metres. */
export function ecefOfEnu(origin: FacadeAlignOrigin, enu: RVec3): Vec3 {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.altM);
  const b = enuBasis(origin.lat, origin.lon);
  return [
    o[0] + enu[0] * b.east[0] + enu[1] * b.north[0] + enu[2] * b.up[0],
    o[1] + enu[0] * b.east[1] + enu[1] * b.north[1] + enu[2] * b.up[1],
    o[2] + enu[0] * b.east[2] + enu[1] * b.north[2] + enu[2] * b.up[2],
  ];
}

/** A geodetic point (ellipsoidal altitude) → ENU metres about the origin. */
export function enuOfGeodetic(origin: FacadeAlignOrigin, latDeg: number, lonDeg: number, altM: number): Vec3 {
  return enuOfEcef(origin, geodeticToEcef(latDeg, lonDeg, altM));
}

/** ENU metres about the origin → geodetic (ellipsoidal altitude). */
export function geodeticOfEnu(origin: FacadeAlignOrigin, enu: RVec3): Geodetic {
  return ecefToGeodetic(ecefOfEnu(origin, enu));
}

/** The unit direction from the apex through the far face at photo uv (u right, v down) — bilinear
 *  over `frustumGeometry`'s corners `[TL, TR, BR, BL]`; the one-point twin of `rayGridDirections`.
 *  ECEF. Pure. */
export function rayThroughUv(geom: FrustumGeometry, u: number, v: number): Vec3 {
  const [tl, tr, br, bl] = geom.corners;
  const lerp = (a: RVec3, b: RVec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const left = lerp(tl, bl, v);
  const right = lerp(tr, br, v);
  const p = lerp(left, right, u);
  const d: Vec3 = [p[0] - geom.apex[0], p[1] - geom.apex[1], p[2] - geom.apex[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  return n > 0 ? [d[0] / n, d[1] / n, d[2] / n] : [0, 0, 0];
}

/** The photo uv of a click over the rendered image rect (u right, v down) — null outside it. The
 *  rect must be the IMAGE's box (no letterbox): the overlay sizes the `<img>` to the photo's aspect. */
export function uvOfClick(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u, v];
}

// ── the solve ────────────────────────────────────────────────────────────────────────────────────

/** What the solve needs to know about the placed draft (the store's resolved numbers). */
export interface FacadeDraftPose {
  lat: number;
  lon: number;
  /** The RENDERED apex height above the ellipsoid (the store's `apexAltM`). */
  apexAltM: number;
  /** The apex height above the rendered ground (the store's `apexAboveGroundM`) — gives the terrain under the draft. */
  apexAboveGroundM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** The EFFECTIVE H-FOV (`effectiveHFovDeg`). */
  hFovDeg: number;
  textureWidth: number;
  textureHeight: number;
}

/** The sliders' rails the solved snapshot is clamped to (the panel passes `PHOTO_PROJECT`'s). */
export interface FacadeSolveRails {
  altM: [number, number];
  pitchMaxDeg: number;
  rollMaxDeg: number;
  hFovDeg: [number, number];
}

export interface FacadeDraftSolveOk {
  ok: true;
  /** The pose to `restorePose` (clamped to the rails when given). */
  snapshot: FacadePoseSnapshot;
  /** The record block for `alignment.solved` (its `pose` IS `snapshot`). */
  solved: FacadeSolved;
  /** The solver's raw answer (residuals, iterations, the planar flag). */
  result: SolveResult;
  /** A rail clipped the answer (the UI says so — the pose no longer minimises the pairs). */
  clamped: boolean;
}
export type FacadeDraftSolve = FacadeDraftSolveOk | { ok: false; reason: string };

/** The draft's pose in the solver's frame (ENU about the origin) — the LM's second start and the
 *  pose the live residual readout is computed for. */
export function enuPoseOfDraft(origin: FacadeAlignOrigin, draft: FacadeDraftPose): FacadeEnuPose {
  return {
    enu: enuOfGeodetic(origin, draft.lat, draft.lon, draft.apexAltM),
    headingDeg: draft.headingDeg,
    pitchDeg: draft.pitchDeg,
    rollDeg: draft.rollDeg,
    hFovDeg: draft.hFovDeg,
  };
}

/** The intrinsics the solve and the readout share: the EFFECTIVE H-FOV, the texture's aspect, and
 *  its width in px so every residual is a real photo pixel. */
export function intrinsicsOfDraft(draft: Pick<FacadeDraftPose, "hFovDeg" | "textureWidth" | "textureHeight">): FacadeIntrinsics {
  const w = draft.textureWidth > 0 ? draft.textureWidth : 1000;
  const h = draft.textureHeight > 0 ? draft.textureHeight : (w * 2) / 3;
  return { hFovDeg: draft.hFovDeg, aspect: w / h, widthPx: w };
}

/** The pairs' reprojection under the draft's CURRENT pose — the live per-pair px readout. */
export function draftReprojection(pairs: readonly FacadePair[], origin: FacadeAlignOrigin, draft: FacadeDraftPose): ReturnType<typeof facadeReprojection> {
  return facadeReprojection(pairs, enuPoseOfDraft(origin, draft), intrinsicsOfDraft(draft));
}

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * ONE solve of the placed draft: the pairs (ENU about `origin`) + the draft's pose as the second
 * start → the snapshot the journal restores + the record block. `solveFov` is honoured only at
 * N ≥ `FACADE_PAIRS_FOV_MIN` (the solver holds the H-FOV otherwise). The snapshot's `altitudeM` is
 * metres above the ground under the draft NOW (the header's altitude law). Never throws.
 */
export function solveFacadeDraft(
  pairs: readonly FacadePair[],
  origin: FacadeAlignOrigin,
  draft: FacadeDraftPose,
  opts: { solveFov?: boolean; rails?: FacadeSolveRails; now?: number } = {},
): FacadeDraftSolve {
  if (pairs.length < FACADE_PAIRS_MIN) return { ok: false, reason: `need at least ${FACADE_PAIRS_MIN} pairs (got ${pairs.length})` };
  if (!isNum(draft.apexAltM) || !isNum(draft.apexAboveGroundM)) return { ok: false, reason: "the globe has not seated the photo yet" };
  const intr = intrinsicsOfDraft(draft);
  const init = enuPoseOfDraft(origin, draft);
  const solveFov = !!opts.solveFov && pairs.length >= FACADE_PAIRS_FOV_MIN;
  let result: SolveResult;
  try {
    result = solveFacadePose(pairs, intr, { init, solveFov });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) return { ok: false, reason: result.reason ?? "the solve failed" };
  const g = geodeticOfEnu(origin, result.pose.enu);
  const terrainH = draft.apexAltM - draft.apexAboveGroundM;
  let altitudeM = g.altM - terrainH;
  let pitchDeg = result.pose.pitchDeg;
  let rollDeg = result.pose.rollDeg;
  let hFovDeg = result.fovSolved ? result.pose.hFovDeg : draft.hFovDeg;
  let clamped = false;
  const r = opts.rails;
  if (r) {
    const a2 = clampTo(altitudeM, r.altM[0], r.altM[1]);
    const p2 = clampTo(pitchDeg, -r.pitchMaxDeg, r.pitchMaxDeg);
    const ro2 = clampTo(rollDeg, -r.rollMaxDeg, r.rollMaxDeg);
    const f2 = clampTo(hFovDeg, r.hFovDeg[0], r.hFovDeg[1]);
    clamped = a2 !== altitudeM || p2 !== pitchDeg || ro2 !== rollDeg || f2 !== hFovDeg;
    altitudeM = a2;
    pitchDeg = p2;
    rollDeg = ro2;
    hFovDeg = f2;
  }
  const snapshot: FacadePoseSnapshot = {
    lat: g.latDeg,
    lon: g.lonDeg,
    altitudeM,
    headingDeg: result.pose.headingDeg,
    pitchDeg,
    rollDeg,
    hFovDeg,
  };
  const solved: FacadeSolved = {
    pose: { ...snapshot },
    rmsPx: result.rmsPx,
    n: pairs.length,
    fovSolved: result.fovSolved,
    planar: result.planar,
    at: new Date(opts.now ?? Date.now()).toISOString(),
  };
  return { ok: true, snapshot, solved, result, clamped };
}
