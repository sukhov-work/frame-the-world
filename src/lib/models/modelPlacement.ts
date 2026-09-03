/**
 * User-model PLACEMENT contract (MESH SUITE MS5, D3 — 2026-09-02): the pure, three-free maths
 * behind `scene/userModels.ts`, `store/userModels.ts` and the `/api/models` PATCH. Everything
 * here is unit-pinned (`test/lib/models/modelPlacement.test.ts`); the scene module owns only
 * Object3D plumbing.
 *
 * THE MODEL. A stored model has a PLACEMENT (`lat`/`lon` — the member's chosen spot for a
 * world-visible object, never a capture GPS: C6-clean, MESH_SUITE_PLAN §9.1-8) and a TRANSFORM
 * seat (`rotDeg` yaw in three's `makeRotationY` sense, `scale` UNIFORM, and — MESH SUITE MS7,
 * owner 2026-09-03 — `liftM`, the height above the terrain seat; the record's `tU` column). The
 * model stands on the rendered terrain at its footprint centre (`groundFitOffset` re-bases the GLB
 * so its bounds centre sits on the origin and its lowest point at y = 0) PLUS its lift: 0 by
 * default (on the ground); a vertical drag of the gizmo's Y arrow stores a new one. The owner's
 * "never pushable irreversibly underground or into the sky" rule is a RAIL: the lift is clamped
 * onto `[liftFloorM(scaled height), MODEL_LIFT_MAX_M]` on every path (the live drag, the commit,
 * the server PATCH, every read), and the floor keeps at least `MODEL_LIFT_KEEP` of the model
 * above the seat — a sunk model always shows enough of itself to be picked and reset.
 *
 * THE GIZMO READ-BACK. The MS2 gizmo (`scene/bldgGizmo.ts`) is reused unchanged: the model's
 * `anchor` (translation, ENU metres: +X east, +Y up, −Z north) and `body` (yaw + scale) ARE a
 * GhostRig-shaped rig with `cx = cz = 0`, `liveBaseY = 0`, `inflate = 1`, so `rigToTransform`
 * yields `{ tE, tN, tU, rotDeg, sx, sy, sz }` and `clampModelEdit` turns that into a ModelEdit:
 * the per-axis scales collapse to ONE uniform factor (the axis that moved most from the start —
 * three's scale mode writes `scaleStart × offset` on the dragged axis only, so any handle scales
 * the model uniformly), railed by the building band (`clampEditK`: 0.1×..10× PER EDIT about the
 * committed scale, compounding, under the loose 0.001×..1000× sanity rail — MS5b 2026-09-02l); the
 * yaw wraps; the move is a bounded ENU offset that the COMMIT folds into a new placement
 * (`offsetGeodetic`), never a stored offset; the lift (the anchor's own Y) is the third seat.
 *
 * STREAMING. The world read is a geohash-cover query (`planModelCover`: the p5 cells — ≈ 4.9 km
 * squares — around the camera's ground focus, none above `maxAltM` where a model is sub-pixel)
 * and residency is a closest-first walk under a triangle budget (`planResidency`): what the
 * budget refuses inside the load radius is `skipped`, and that number IS the physical-density
 * warning (owner 2026-09-01c: no quota — warn instead).
 */

import { SCALE_MAX_K, SCALE_MIN_K, clampEditK } from "../globe/bldgOverrides";
import { normalizeDeg, type FeatureTransform } from "../globe/featureTransform";
import { decodeGeohash, geohashesForViewport } from "../geo/geohash";
import { WGS84_A, WGS84_B } from "../geo/projection";

/** Uniform-scale SANITY rail — the building rail's twin (contract: a stored value outside it is
 *  clamped onto it on read; the server clamps on PATCH). The gesture rail is the per-edit band
 *  (`clampEditK`), not this. */
export const MODEL_SCALE_MIN = SCALE_MIN_K;
export const MODEL_SCALE_MAX = SCALE_MAX_K;
/** Max |(tE, tN)| of ONE move drag (m): keeps the flat-ENU offset exact to the centimetre
 *  (the geodetic fold-in is linear in the offset) and a drag on screen. Ten drags go further. */
export const MODEL_MOVE_MAX_M = 250;
/** MESH SUITE MS7 (owner 2026-09-03) — the LIFT seat's absolute SANITY rail (m, both ways): a
 *  stored `tU` outside it is clamped on read, the server clamps on PATCH, the gizmo's Y arrow
 *  stops at it. Wider than the buildings' `LIFT_MAX_M` 25 so a model can stand on a Dnipro
 *  rooftop [ASSUMPTION 2026-09-03: 50 m is a taste call]. */
export const MODEL_LIFT_MAX_M = 50;
/** The owner's "it must never fully fall into the texture" rule as numbers: whatever the lift,
 *  at least this FRACTION of the model's SCALED height — and never less than this many metres of
 *  it — stays above the terrain seat. A sunk model is therefore always visible, pickable and
 *  recoverable (RESET puts it back on the ground). */
export const MODEL_LIFT_KEEP = Object.freeze({ frac: 0.25, minM: 0.5 });
/** The world-read cell precision (p5 ≈ 4.9 km × 4.9 km) — the `gh5` column `hasSome` matches. */
export const MODEL_COVER_PRECISION = 5;

/** The record's three transform seats. `null` on the row = identity. */
export interface ModelTransform {
  /** Yaw about local +Y, degrees, three's `makeRotationY` sense (CCW seen from above). */
  rotDeg: number;
  /** Uniform scale (1 = as uploaded). */
  scale: number;
  /** MS7: height above the terrain seat (m; 0 = standing on the ground; negative = sunk, railed
   *  by `liftFloorM`). The row's `tU`. */
  liftM: number;
}

export const IDENTITY_MODEL_TRANSFORM: Readonly<ModelTransform> = Object.freeze({ rotDeg: 0, scale: 1, liftM: 0 });

/** Neutrality thresholds — below them an edit reads as "as uploaded" (the chip's ↺ test). The
 *  lift's 1 cm is the buildings' `XF_NEUTRAL_EPS.m`. */
export const MODEL_XF_EPS = Object.freeze({ rotDeg: 0.05, scale: 0.005, liftM: 0.01 });

/** A LIVE edit: the two seats plus the move offset of the drag in progress (metres east/north
 *  of the committed placement). `tE`/`tN` are always 0 on a committed transform — a commit folds
 *  them into the placement. */
export interface ModelEdit extends ModelTransform {
  tE: number;
  tN: number;
}

export const IDENTITY_MODEL_EDIT: Readonly<ModelEdit> = Object.freeze({ ...IDENTITY_MODEL_TRANSFORM, tE: 0, tN: 0 });

const fin = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);

/** MS7 — the lowest lift a model of this SCALED height may take (m, ≤ 0): the floor that keeps
 *  `MODEL_LIFT_KEEP` of it above the seat. An unknown / degenerate height pins the model to the
 *  ground (0): when nothing proves the model would stay visible, it does not sink. */
export function liftFloorM(scaledHeightM: number | null): number {
  if (scaledHeightM === null || !Number.isFinite(scaledHeightM) || scaledHeightM <= 0) return 0;
  const keep = Math.max(MODEL_LIFT_KEEP.frac * scaledHeightM, MODEL_LIFT_KEEP.minM);
  const depth = Math.max(0, Math.min(MODEL_LIFT_MAX_M, scaledHeightM - keep));
  return depth > 0 ? -depth : 0; // (never a −0: it survives JSON as "0" but fails a strict compare)
}

/** MS7 — a lift onto its rails: the floor for this scaled height, the absolute ceiling. NaN and
 *  friends read as 0 (on the ground). Pure; never throws. */
export function clampLiftM(liftM: unknown, scaledHeightM: number | null): number {
  const v = fin(liftM, 0);
  const lo = liftFloorM(scaledHeightM);
  const out = Math.max(lo, Math.min(MODEL_LIFT_MAX_M, v));
  return out || 0; // fold a −0
}

/** A stored row's seats → a transform (null/absent/garbage = identity; out-of-rail scale and
 *  lift clamped onto the rails — the read-tolerant half of the contract). `heightM` is the
 *  model's height at scale 1 (the row's `bboxY` / the loaded bounds) — the lift floor is taken
 *  at `heightM × scale`; null (unknown) pins the lift to the ground. */
export function sanitizeModelTransform(
  rotDeg: unknown,
  scale: unknown,
  tU: unknown = 0,
  heightM: number | null = null,
): ModelTransform {
  const k = Math.max(MODEL_SCALE_MIN, Math.min(MODEL_SCALE_MAX, fin(scale, 1)));
  return {
    rotDeg: normalizeDeg(fin(rotDeg, 0)),
    scale: k,
    liftM: clampLiftM(tU, heightM !== null && Number.isFinite(heightM) ? heightM * k : null),
  };
}

export function isIdentityModelTransform(t: ModelTransform, eps = MODEL_XF_EPS): boolean {
  return (
    Math.abs(normalizeDeg(t.rotDeg)) < eps.rotDeg &&
    Math.abs(t.scale - 1) < eps.scale &&
    Math.abs(t.liftM ?? 0) < eps.liftM
  );
}

/** What the gizmo's per-axis read-back means for a UNIFORM model: the axis whose scale moved
 *  most (in log space) from the start carries the drag; the other two still hold the start. */
export function uniformScaleFrom(sx: number, sy: number, sz: number, start: number): number {
  const s0 = start > 0 && Number.isFinite(start) ? start : 1;
  let best = s0;
  let bestDev = -1;
  for (const s of [sx, sy, sz]) {
    if (!(s > 0) || !Number.isFinite(s)) continue;
    const dev = Math.abs(Math.log(s / s0));
    if (dev > bestDev) {
      bestDev = dev;
      best = s;
    }
  }
  return best;
}

/** Clamp a gizmo read-back (a FeatureTransform from `rigToTransform` on the model's rig) onto the
 *  model rails: ONE uniform scale inside the per-edit band about `start.scale` (the committed
 *  scale — edits compound under the sanity rail only), the yaw wrapped, the move shortened to
 *  `MODEL_MOVE_MAX_M` (direction kept), the lift (MS7) onto `[liftFloorM(height × the CLAMPED
 *  scale), MODEL_LIFT_MAX_M]` — so a SCALE drag that would shrink a sunk model out of sight lifts
 *  it instead. `heightM` = the model's height at scale 1 (null pins the lift). Pure; never throws. */
export function clampModelEdit(raw: FeatureTransform, start: ModelTransform, heightM: number | null = null): ModelEdit {
  const uniform = uniformScaleFrom(raw.sx, raw.sy, raw.sz, start.scale);
  let tE = fin(raw.tE, 0);
  let tN = fin(raw.tN, 0);
  const r = Math.hypot(tE, tN);
  if (r > MODEL_MOVE_MAX_M && r > 0) {
    const k = MODEL_MOVE_MAX_M / r;
    tE *= k;
    tN *= k;
  }
  const scale = clampEditK(start.scale, uniform);
  return {
    rotDeg: normalizeDeg(fin(raw.rotDeg, 0)),
    scale,
    liftM: clampLiftM(raw.tU, heightM !== null && Number.isFinite(heightM) ? heightM * scale : null),
    tE,
    tN,
  };
}

/** The forward map: a ModelEdit as the FeatureTransform the gizmo's `place`/`start` API speaks
 *  (uniform scale on every axis, the lift as `tU`). `transformToRig` with `cx = cz = 0,
 *  liveBaseY = 0, inflate = 1` then gives the anchor/body writes — the exact inverse of the
 *  read-back above (the anchor's Y IS the lift). */
export function editToFeatureTransform(e: ModelEdit): FeatureTransform {
  return { sx: e.scale, sy: e.scale, sz: e.scale, rotDeg: e.rotDeg, tE: e.tE, tN: e.tN, tU: e.liftM };
}

const DEG = Math.PI / 180;
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

/** MESH SUITE MS6 — "stand beside it": the first-person pose from which a model is seen whole
 *  and can be right-clicked at once. The eye stands `dist` metres from the placement along the
 *  OPPOSITE of `headingDeg` (so the view looks along `headingDeg` at the model), `dist` = three
 *  times the model's longest SCALED extent inside [minM, maxM] (a 3 m box → 15 m; a 30 m tower →
 *  90 m), 1.7 m up, pitched at the model's mid-height. `sizeM3` = `[w, d, h]` at scale 1 (the
 *  record's bbox as `[x, z, y]`); null → the floor distance. MS7: `liftM` raises the aim (the
 *  mid-height rides the lift) and a lifted model is seen from at least three lifts away, so a
 *  rooftop model is in frame from the ground. Pure. */
export interface Standpoint {
  latDeg: number;
  lonDeg: number;
  eyeM: number;
  headingDeg: number;
  pitchDeg: number;
  fovDeg: number;
  /** The eye's distance from the placement (m) — diagnostics. */
  distM: number;
}
export const STANDPOINT = Object.freeze({ eyeM: 1.7, fovDeg: 60, minM: 6, maxM: 120, factor: 3 });
export function modelStandpoint(
  latDeg: number,
  lonDeg: number,
  sizeM3: readonly [number, number, number] | null,
  scale: number,
  headingDeg = 0,
  liftM = 0,
): Standpoint {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const lift = Number.isFinite(liftM) ? liftM : 0;
  const longest = sizeM3 ? Math.max(sizeM3[0], sizeM3[1], sizeM3[2]) * k : 0;
  const distM = Math.max(STANDPOINT.minM, Math.min(STANDPOINT.maxM, STANDPOINT.factor * Math.max(longest, Math.abs(lift))));
  const h = normalizeDeg(Number.isFinite(headingDeg) ? headingDeg : 0);
  const rad = (h * Math.PI) / 180;
  // The eye sits BEHIND the viewer's line of sight: opposite the heading from the model.
  const at = offsetGeodetic(latDeg, lonDeg, -distM * Math.sin(rad), -distM * Math.cos(rad));
  const midH = lift + (sizeM3 ? (sizeM3[2] * k) / 2 : STANDPOINT.eyeM);
  const pitchDeg = (Math.atan2(midH - STANDPOINT.eyeM, distM) * 180) / Math.PI;
  return {
    latDeg: at.latDeg,
    lonDeg: at.lonDeg,
    eyeM: STANDPOINT.eyeM,
    headingDeg: h < 0 ? h + 360 : h,
    pitchDeg: Math.max(-89, Math.min(89, pitchDeg)),
    fovDeg: STANDPOINT.fovDeg,
    distM,
  };
}

/** Move a geodetic point by ENU metres on the WGS-84 ellipsoid (meridional radius for north,
 *  prime-vertical radius × cos φ for east — exact to the millimetre at the drag scale). The
 *  latitude is clamped to ±90, the longitude wrapped to (−180, 180]. */
export function offsetGeodetic(
  latDeg: number,
  lonDeg: number,
  eastM: number,
  northM: number,
): { latDeg: number; lonDeg: number } {
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const w2 = 1 - WGS84_E2 * sinLat * sinLat;
  const n = WGS84_A / Math.sqrt(w2);
  const m = (WGS84_A * (1 - WGS84_E2)) / (w2 * Math.sqrt(w2));
  const dLat = (northM / m) / DEG;
  const dLon = cosLat > 1e-9 ? (eastM / (n * cosLat)) / DEG : 0;
  const outLat = Math.max(-90, Math.min(90, latDeg + dLat));
  let outLon = lonDeg + dLon;
  outLon = ((outLon + 180) % 360 + 360) % 360 - 180;
  if (outLon === -180) outLon = 180;
  return { latDeg: outLat, lonDeg: outLon };
}

/** The GLB re-base: translate the root so its bounds centre X/Z sits on the origin (the
 *  footprint centre = the pivot every seat, yaw and scale acts about) and its lowest point at
 *  y = 0 (the ground contact the terrain seat owns). Returns the offset to ADD to the root. */
export function groundFitOffset(min: readonly [number, number, number], max: readonly [number, number, number]): [number, number, number] {
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  // `|| 0` folds a −0 into +0 (a −0 survives JSON as "0" but fails a strict compare).
  return [-(Number.isFinite(cx) ? cx : 0) || 0, -(Number.isFinite(min[1]) ? min[1] : 0) || 0, -(Number.isFinite(cz) ? cz : 0) || 0];
}

export interface CoverConfig {
  /** Half-side of the square cover around the focus (m). */
  radiusM: number;
  /** Above this camera altitude (m) nothing is fetched — a model is sub-pixel from there. */
  maxAltM: number;
  /** Most cells one query may carry (the `hasSome` list); the nearest win. */
  maxCells: number;
  precision?: number;
}

/** The geohash cells to ask the world for, or null when the camera is too high to care. Sorted
 *  (so two covers compare by `sameCover`) and truncated to the nearest `maxCells`. */
export function planModelCover(latDeg: number, lonDeg: number, altM: number, cfg: CoverConfig): string[] | null {
  if (!Number.isFinite(altM) || altM > cfg.maxAltM) return null;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  const precision = cfg.precision ?? MODEL_COVER_PRECISION;
  const lat = Math.max(-90, Math.min(90, latDeg));
  const lon = Math.max(-180, Math.min(180, lonDeg));
  const dLat = cfg.radiusM / 111_320;
  const dLon = cfg.radiusM / (111_320 * Math.max(0.05, Math.cos(lat * DEG)));
  const cells = geohashesForViewport(
    {
      latMin: Math.max(-90, lat - dLat),
      latMax: Math.min(90, lat + dLat),
      lonMin: Math.max(-180, lon - dLon),
      lonMax: Math.min(180, lon + dLon),
    },
    precision,
  );
  if (cells.length > cfg.maxCells) {
    const dist = (c: string) => {
      const g = decodeGeohash(c);
      return Math.hypot(g.lat - lat, (g.lon - lon) * Math.cos(lat * DEG));
    };
    cells.sort((a, b) => dist(a) - dist(b));
    cells.length = cfg.maxCells;
  }
  return cells.sort();
}

export function sameCover(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface ResidencyRow {
  id: string;
  /** Triangle count from the record (the upload cap bounds it). */
  tris: number;
  /** Camera → model distance (m). */
  distM: number;
}

export interface ResidencyConfig {
  /** A model inside this radius wants to be resident… */
  loadRadiusM: number;
  /** …and a resident one is let go only past this (hysteresis). */
  unloadRadiusM: number;
  maxResident: number;
  /** Resident triangles allowed at once — closest first; the rest are `skipped`. */
  triBudget: number;
}

export interface ResidencyPlan {
  /** Ids to make resident now (nearest first). */
  load: string[];
  /** Resident ids to release (out of range, or refused by the budget). */
  unload: string[];
  /** Ids that stay resident. */
  keep: string[];
  /** Models inside the load radius the budget/cap refused — the density warning's number. */
  skipped: number;
  /** Triangles resident after the plan. */
  tris: number;
}

/** Closest-first residency under a count cap and a triangle budget, with radius hysteresis.
 *  Deterministic; a row's `tris` of 0/NaN counts as 0. */
export function planResidency(rows: readonly ResidencyRow[], resident: ReadonlySet<string>, cfg: ResidencyConfig): ResidencyPlan {
  const candidates = rows
    .filter((r) => Number.isFinite(r.distM) && (r.distM <= cfg.loadRadiusM || (resident.has(r.id) && r.distM <= cfg.unloadRadiusM)))
    .sort((a, b) => a.distM - b.distM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const keepSet = new Set<string>();
  const load: string[] = [];
  const keep: string[] = [];
  let tris = 0;
  let skipped = 0;
  for (const r of candidates) {
    const t = Number.isFinite(r.tris) && r.tris > 0 ? r.tris : 0;
    const fits = keepSet.size < cfg.maxResident && tris + t <= cfg.triBudget;
    if (!fits) {
      if (r.distM <= cfg.loadRadiusM) skipped++;
      continue;
    }
    keepSet.add(r.id);
    tris += t;
    if (resident.has(r.id)) keep.push(r.id);
    else load.push(r.id);
  }
  const unload: string[] = [];
  for (const id of resident) if (!keepSet.has(id)) unload.push(id);
  return { load, unload, keep, skipped, tris };
}

/** The physical-density verdict (owner 2026-09-01c): warn when the budget had to skip a model
 *  nearby, or when the resident load alone is heavy. */
export function densityWarning(skipped: number, residentTris: number, warnTris: number): boolean {
  return skipped > 0 || residentTris >= warnTris;
}
