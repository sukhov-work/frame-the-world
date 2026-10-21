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

// ---- T177 (owner test 2026-10-22): "the texture available should be aware of where I LOOK, not
// only where I am; with larger distances gracefully degrade and not just clip out". The apex is
// the wrong thing to test — a photo whose apex sits BEHIND the camera paints the facades in front
// of it. What the viewer sees is the PAINTED VOLUME: the cone from the apex along the forward
// axis, as wide as the frustum, as long as the photo's range. Residency ranks by the nearest point
// of that volume (0 = the camera stands inside it), gates by the volume's bounding sphere against
// the view cone, and fades a resident slot's strength toward 0 across the last `fadeFrac` of the
// range before the planner releases it (the planner's hysteresis band sits beyond the fade's end,
// so a release is invisible). ---------------------------------------------------------------------

/** The painted volume of a facade photo — a right circular cone that CONTAINS the rectangular
 *  frustum (the half-angle is the corner's), plus its bounding sphere for the in-view test. */
export interface FacadePaintedVolume {
  apex: Vec3;
  /** Unit axis. */
  forward: Vec3;
  /** The cone's length (m) = the photo's effective range. */
  lengthM: number;
  /** tan of the half-angle to the frustum's CORNER (the cone contains the whole rectangle). */
  tanHalf: number;
  /** The bounding sphere: centred on the axis at half the length. */
  centre: Vec3;
  radiusM: number;
}

/** The painted volume from the frustum the marker + the projector share, and the effective range
 *  (the projector's `effectiveRangeM` — the paint stops there, so should the residency). Pure. */
export function facadePaintedVolume(geom: FrustumGeometry, rangeM: number): FacadePaintedVolume {
  const [tl, tr, br, bl] = geom.corners;
  const halfW = Math.hypot(tl[0] - tr[0], tl[1] - tr[1], tl[2] - tr[2]) / 2;
  const halfH = Math.hypot(tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]) / 2;
  const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4 - geom.apex[0];
  const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4 - geom.apex[1];
  const cz = (tl[2] + tr[2] + br[2] + bl[2]) / 4 - geom.apex[2];
  const planeDistM = cx * geom.forward[0] + cy * geom.forward[1] + cz * geom.forward[2];
  const tanHalf = planeDistM > 0 && Number.isFinite(planeDistM) ? Math.hypot(halfW, halfH) / planeDistM : 1;
  const lengthM = Number.isFinite(rangeM) && rangeM > 0 ? rangeM : 0;
  const half = lengthM / 2;
  const centre: Vec3 = [
    geom.apex[0] + geom.forward[0] * half,
    geom.apex[1] + geom.forward[1] * half,
    geom.apex[2] + geom.forward[2] * half,
  ];
  // The far rim sits at (lengthM, lengthM·tanHalf) from the apex in (axial, radial); the apex at
  // (0, 0): both are within hypot(half, lengthM·tanHalf) of the centre.
  return { apex: geom.apex, forward: geom.forward, lengthM, tanHalf, centre, radiusM: Math.hypot(half, lengthM * tanHalf) };
}

/** The camera's distance (m) to the nearest point of the painted volume — 0 inside the cone.
 *  Behind the apex the apex is the nearest point; beside the cone the slant surface is; past the
 *  far cap the cap's rim or disc is. A ranking metric (exact for the three regions' axes, a
 *  close lower bound in between), never a render test. Pure. */
export function facadeVolumeDistanceM(vol: FacadePaintedVolume, camera: Vec3): number {
  const tx = camera[0] - vol.apex[0];
  const ty = camera[1] - vol.apex[1];
  const tz = camera[2] - vol.apex[2];
  const axial = tx * vol.forward[0] + ty * vol.forward[1] + tz * vol.forward[2];
  const radial = Math.sqrt(Math.max(0, tx * tx + ty * ty + tz * tz - axial * axial));
  const L = vol.lengthM;
  if (L <= 0) return Math.hypot(tx, ty, tz);
  if (axial <= 0) {
    // Behind the apex: the tip is the nearest point unless the camera sits inside the mirrored
    // cone's shadow — the tip is still the nearest point of the cone there. Plain distance.
    return Math.hypot(tx, ty, tz);
  }
  const cosHalf = 1 / Math.hypot(1, vol.tanHalf);
  if (axial >= L) {
    // Past the far cap: inside the cap's disc → the axial overshoot; outside → to the rim.
    const rimR = L * vol.tanHalf;
    const over = axial - L;
    return radial <= rimR ? over : Math.hypot(over, radial - rimR);
  }
  const coneR = axial * vol.tanHalf;
  if (radial <= coneR) return 0; // inside the painted volume
  // Beside the slant surface: the perpendicular distance to the cone's generator line.
  return (radial - coneR) * cosHalf;
}

/** Does the painted volume meet the view? Its bounding sphere against the models' `inViewCone`
 *  (the frame's corner cone widened by `marginRad`) — a LOAD gate, generous on purpose: a camera
 *  inside the sphere is always in view, so a photo painting the facades in front of a viewer
 *  who stands near its apex (looking any way) stays live. Pure. */
export function facadeVolumeInView(
  vol: FacadePaintedVolume,
  cameraPos: Vec3,
  cameraFwd: Vec3,
  tanHalfV: number,
  aspect: number,
  marginRad: number,
): boolean {
  const to: Vec3 = [vol.centre[0] - cameraPos[0], vol.centre[1] - cameraPos[1], vol.centre[2] - cameraPos[2]];
  const distM = Math.hypot(to[0], to[1], to[2]);
  const cos = distM > 0 ? dot(to, cameraFwd) / distM : 1;
  return inViewCone(cos, distM, vol.radiusM, tanHalfV, aspect, marginRad);
}

/** The viewer-distance fade of a resident slot: 1 inside `rangeM · (1 − fadeFrac)`, a smoothstep
 *  down to 0 at `rangeM`. `fadeFrac` ≤ 0 → a hard edge at `rangeM`; ≥ 1 → the fade spans the whole
 *  range. Pure. */
export function facadeSlotFade(distM: number, rangeM: number, fadeFrac: number): number {
  if (!Number.isFinite(distM) || !(rangeM > 0)) return 0;
  if (distM >= rangeM) return 0;
  const frac = Math.min(1, Math.max(0, Number.isFinite(fadeFrac) ? fadeFrac : 0));
  const start = rangeM * (1 - frac);
  if (distM <= start) return 1;
  const t = (distM - start) / (rangeM - start);
  return 1 - t * t * (3 - 2 * t);
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
  /** Camera → the photo (m): the nearest point of its painted volume since T177 (0 = inside);
   *  the apex distance before it. */
  distM: number;
  /** In view for this camera (`facadeVolumeInView` since T177, `facadeInView` before). */
  inView: boolean;
  /** T177 hysteresis: the in-view test with the KEEP margin (wider) — a resident stays while this
   *  holds; absent = `inView`. A candidate needs `inView`. */
  inViewKeep?: boolean;
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
 *   • KEEP — a resident row stays while it is in view (`inViewKeep` when given — the wider cone,
 *     T177) and inside `rangeM + swapMarginM` (out of view or past the band → released; more
 *     keepers than K → the nearest K stay);
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

  // KEEP: the residents still in view (the wider KEEP cone when given — T177) and inside the band,
  // in their current slot order.
  let keepers: FacadeSlotRow[] = [];
  for (const id of resident) {
    const r = byRow.get(id);
    if (r && (r.inViewKeep ?? r.inView) && r.distM <= rangeM + margin) keepers.push(r);
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
