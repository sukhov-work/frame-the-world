/**
 * FACADE RESIDENCY (the photo flow (b), F3 — T169 / T171, 2026-10-21): the pure half of "many
 * photos, few live". A saved facade photo is a MARKER at its apex until it earns one of the K
 * projector slots (`PHOTO_PROJECT.slots`); this module answers, with no three.js and no store,
 *   • how a stored pose becomes the frustum the marker and the projector share
 *     (`facadeFrustumGeometry` — the apex sits at the RECORDED `apexAltM`, never a terrain lookup:
 *     `lib/wix/facadeRecords.ts` § THE APEX HEIGHT), and
 *   • which rows hold a slot this frame (`planFacadeSlots` — the models' `planResidency` law cut
 *     down to a K-cap with hysteresis: a texture + a depth map is the dearest thing a slot owns,
 *     so a pan must not thrash it).
 * The orchestrator feeds the planner from the camera each `MODELS.residencyEveryFrames` frames
 * (`facadeApexDistanceM` / `facadeInView` are the two numbers it needs per row); the scene module
 * `scene/facadeMarkers.ts` draws the glyphs and caches the geometry by id.
 */

import { verticalFovDeg } from "../decode/sensors";
import { frustumGeometry, type FrustumGeometry } from "../geo/frustum";
import { dot, type Vec3 } from "../geo/projection";
import { inViewCone } from "../models/modelPlacement";
import type { FacadePose } from "../wix/facadeRecords";

/** The in-view test's sphere about the apex (m) — a marker is a point; a few metres of slack keeps
 *  a photo whose apex sits a hair off-frame a candidate (its frustum is what the viewer sees). */
export const FACADE_VIEW_RADIUS_M = 5;

/** The H-FOV a garbage record falls back to (deg) — a NaN frustum poisons an instance matrix and
 *  every raycast after it; the server validates the band, this is the belt to its braces. */
const FALLBACK_HFOV_DEG = 60;

/** The texture aspect a stored pose implies — its own pixels, else the caller's fallback (the
 *  `PhotoFrustum.ts` rule: `textureWidth / textureHeight || FRUSTUM.fallbackAspect`). */
export function facadeAspect(pose: Pick<FacadePose, "textureWidth" | "textureHeight">, fallbackAspect: number): number {
  const w = pose.textureWidth;
  const h = pose.textureHeight;
  if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0 && Number.isFinite(w / h)) return w / h;
  return fallbackAspect;
}

/** The frustum of a stored facade pose: apex at `apexAltM` above the ellipsoid, the recorded
 *  heading / pitch / roll, the EFFECTIVE H-FOV (the one number the frustum, the projector and the
 *  SCALE gizmo agree on) and the V-FOV from the texture's aspect. Pure. */
export function facadeFrustumGeometry(pose: FacadePose, planeDistM: number, fallbackAspect: number): FrustumGeometry {
  const hFovDeg = Number.isFinite(pose.hFovDeg) && pose.hFovDeg > 0 && pose.hFovDeg < 180 ? pose.hFovDeg : FALLBACK_HFOV_DEG;
  const aspect = facadeAspect(pose, fallbackAspect);
  return frustumGeometry({
    latDeg: pose.lat,
    lonDeg: pose.lon,
    altM: Number.isFinite(pose.apexAltM) ? pose.apexAltM : 0,
    headingDeg: Number.isFinite(pose.headingDeg) ? pose.headingDeg : 0,
    pitchDeg: Number.isFinite(pose.pitchDeg) ? pose.pitchDeg : 0,
    rollDeg: Number.isFinite(pose.rollDeg) ? pose.rollDeg : 0,
    hFovDeg,
    vFovDeg: verticalFovDeg(hFovDeg, aspect),
    planeDistM,
  });
}

/** Camera → apex distance (m). Pure. */
export function facadeApexDistanceM(apex: Vec3, camera: Vec3): number {
  return Math.hypot(apex[0] - camera[0], apex[1] - camera[1], apex[2] - camera[2]);
}

/** Is the apex inside the view? The models' `inViewCone` (the frame's corner cone, widened by
 *  `marginRad`) about a `FACADE_VIEW_RADIUS_M` sphere — a LOAD gate, generous on purpose; the eye
 *  on the apex is always in view. `cameraFwd` is the unit view axis. Pure. */
export function facadeInView(
  apex: Vec3,
  cameraPos: Vec3,
  cameraFwd: Vec3,
  tanHalfV: number,
  aspect: number,
  marginRad: number,
): boolean {
  const to: Vec3 = [apex[0] - cameraPos[0], apex[1] - cameraPos[1], apex[2] - cameraPos[2]];
  const distM = Math.hypot(to[0], to[1], to[2]);
  const cos = distM > 0 ? dot(to, cameraFwd) / distM : 1;
  return inViewCone(cos, distM, FACADE_VIEW_RADIUS_M, tanHalfV, aspect, marginRad);
}

export interface FacadeSlotRow {
  id: string;
  /** Camera → apex (m). */
  distM: number;
  /** `facadeInView` for this camera. */
  inView: boolean;
}

export interface FacadeSlotConfig {
  /** K — the projector slots a frame may fill (`PHOTO_PROJECT.slots`, minus the draft's). */
  slots: number;
  /** A row earns a slot only inside this apex distance (`PHOTO_PROJECT.slotRangeM`). */
  rangeM: number;
  /** The hysteresis band (`PHOTO_PROJECT.slotSwapMarginM`): a resident row keeps its slot out to
   *  `rangeM + swapMarginM`, and is displaced only by a candidate nearer than it by MORE than this. */
  swapMarginM: number;
}

export interface FacadeSlotPlan {
  /** The rows holding a slot after the plan. STABLE: the surviving residents keep their relative
   *  order (a slot index is a texture unit — a texture never migrates), a displaced resident's
   *  position goes to its displacer, newcomers fill free room nearest first. */
  slots: string[];
  /** Resident ids that lost their slot (left the view / the range band, displaced, or K shrank). */
  released: string[];
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The K nearest IN-VIEW rows inside `rangeM`, with hysteresis both ways:
 *   • KEEP — a resident row stays while it is in view and inside `rangeM + swapMarginM`
 *     (out of view or past the band → released; more keepers than K → the nearest K stay);
 *   • DISPLACE — a non-resident candidate takes a kept row's slot only when it is nearer than
 *     that row by more than `swapMarginM` (the farthest keeper goes first).
 * Deterministic: distance ties break by id. Rows with a non-finite distance are ignored.
 */
export function planFacadeSlots(rows: readonly FacadeSlotRow[], resident: readonly string[], cfg: FacadeSlotConfig): FacadeSlotPlan {
  const k = Math.max(0, Math.floor(cfg.slots));
  const rangeM = Math.max(0, cfg.rangeM);
  const margin = Math.max(0, cfg.swapMarginM);
  const byRow = new Map<string, FacadeSlotRow>();
  for (const r of rows) if (Number.isFinite(r.distM) && !byRow.has(r.id)) byRow.set(r.id, r);
  const residentSet = new Set(resident);
  const nearer = (a: FacadeSlotRow, b: FacadeSlotRow) => a.distM - b.distM || byId(a.id, b.id);

  // KEEP: the residents still in view and inside the band, in their current slot order.
  let keepers: FacadeSlotRow[] = [];
  for (const id of resident) {
    const r = byRow.get(id);
    if (r && r.inView && r.distM <= rangeM + margin) keepers.push(r);
  }
  if (keepers.length > k) {
    const nearest = new Set([...keepers].sort(nearer).slice(0, k).map((r) => r.id));
    keepers = keepers.filter((r) => nearest.has(r.id));
  }
  const slots: FacadeSlotRow[] = [...keepers];

  // CANDIDATES: the non-resident rows in view inside the range, nearest first.
  const candidates = [...byRow.values()].filter((r) => !residentSet.has(r.id) && r.inView && r.distM <= rangeM).sort(nearer);
  for (const c of candidates) {
    if (slots.length < k) {
      slots.push(c);
      continue;
    }
    // Full: displace the farthest KEEPER (never a newcomer — they are nearer by construction)
    // when this candidate beats it by more than the margin. Candidates come nearest first, so
    // the first one that cannot displace ends the pass.
    let farthest = -1;
    for (let i = 0; i < slots.length; i++) {
      if (!residentSet.has(slots[i].id)) continue;
      if (farthest < 0 || nearer(slots[i], slots[farthest]) > 0) farthest = i;
    }
    if (farthest < 0 || slots[farthest].distM - c.distM <= margin) break;
    slots[farthest] = c;
  }

  const kept = new Set(slots.map((r) => r.id));
  const released: string[] = [];
  for (const id of resident) if (!kept.has(id) && !released.includes(id)) released.push(id);
  return { slots: slots.map((r) => r.id), released };
}
