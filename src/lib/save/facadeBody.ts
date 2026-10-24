/**
 * Pure mapping: facade-store snapshot → `/api/facades` bodies (PHOTO PROJECTION F2 persist, T169 —
 * 2026-10-21). The `pinBody.ts` twin: one derivation shared with the UI — the H-FOV comes from
 * `effectiveHFovDeg` (the same function the frustum, the projector and the SCALE gizmo use — they
 * must never disagree); the EXIF pose is captured by `exifPoseOf` at ingest / place and rides the
 * save body as the RESET baseline. The SERVER derives `geohash9` / `gh5` / `isPublic` / `moderation`
 * / `poseSource` and copies the URLs off the verified descriptors — nothing of that is computed here.
 */

import type { PhotoExif } from "../decode/extract";
import { derivedFov, effectiveHFovDeg, exifBaselineParams, type AdjustableParams, type Placement } from "../decode/params";
import type { FacadePose, SaveFacadeBody, UpdateFacadeBody } from "../wix/facadeRecords";
import { titleFromFileName } from "./pinBody";

/** What the facade store holds at SAVE / UPDATE time (the pin `UploadSnapshot` + the facade extras). */
export interface FacadeSnapshot {
  exif: PhotoExif;
  params: AdjustableParams;
  placement: Placement;
  /** The roll nudge (degrees); undefined = the EXIF roll or 0 (the store's `rollDeg` contract). */
  rollDeg?: number;
  /** The H-FOV override (F1: SCALE = the H-FOV); undefined = the `derivedFov` baseline. */
  hFovDeg?: number;
  projection: { strength: number; ownLight: number; rangeM: number | null };
  textureWidth?: number;
  textureHeight?: number;
  fileName?: string;
  fileSizeBytes?: number;
  /** The rendered apex height above the ellipsoid (m) — what the owner saw (facadeRecords header). */
  apexAltM: number;
  /** The EXIF baseline captured at ingest / place (`exifPoseOf`); null when the store has none. */
  exifPose: FacadePose | null;
  /** The custom title; blank / null falls back to the file-name title. */
  title: string | null;
  /** T172 (F5): the buildings the projector paints at SAVE / UPDATE time (`probeFacadeTargets` —
   *  the globe's 7×5 ray grid); undefined / null = no probe answer (no globe, tiles not in). */
  targetFeatureIds?: string[] | null;
  /** T172 (F5): the point-pair record (`alignmentRecordOf` — `lib/geo/facadeAlign.ts`), its `solved.pose`
   *  the server's SOLVED proof; undefined / null = nothing to store (no pairs picked). */
  alignment?: Record<string, unknown> | null;
}

/** The Media ids the three uploads handed back — the display JPEG is required (it is what every slot samples). */
export interface FacadeFileIds {
  originalFileId: string | null;
  displayFileId: string;
  thumbFileId: string | null;
}

/** The same test `effectiveHFovDeg` applies to its override — mirrored here so `fovEstimated` and the
 *  number it describes can never disagree (an override that fails this test is NOT in effect). */
function hasHFovOverride(override: number | undefined): boolean {
  return typeof override === "number" && Number.isFinite(override) && override > 0.5 && override < 179.5;
}

/** The pose block of a snapshot — the builder's one source for both the save and the update body. */
function poseOf(s: FacadeSnapshot): FacadePose {
  const fov = derivedFov(s.exif, s.params);
  return {
    lat: s.placement.latDeg,
    lon: s.placement.lonDeg,
    apexAltM: s.apexAltM,
    altitudeM: s.params.altitudeM ?? null,
    headingDeg: s.params.headingDeg ?? s.exif.headingDeg ?? 0,
    pitchDeg: s.params.pitchDeg ?? s.exif.pitchDeg ?? 0,
    // Roll has no slider in the pin flow; the facade flow's gizmo nudges it (F1) — the nudge wins,
    // then the EXIF roll, then level.
    rollDeg: s.rollDeg ?? s.exif.rollDeg ?? 0,
    focalLengthMm: s.params.focalLengthMm ?? s.exif.focalLengthMm ?? null,
    hFovDeg: effectiveHFovDeg(s.exif, s.params, s.hFovDeg),
    // An override is an exact number the owner set (the gizmo / the lens slider) — never an estimate.
    fovEstimated: hasHFovOverride(s.hFovDeg) ? false : fov.estimated,
    textureWidth: s.textureWidth ?? null,
    textureHeight: s.textureHeight ?? null,
  };
}

/** POST /api/facades body — the pose + params + the EXIF facts + the three file ids. */
export function buildSaveFacadeBody(s: FacadeSnapshot, files: FacadeFileIds): SaveFacadeBody {
  const customTitle = s.title?.trim();
  return {
    ...poseOf(s),
    strength: s.projection.strength,
    ownLight: s.projection.ownLight,
    rangeM: s.projection.rangeM,
    // T172 (F5): the buildings the projector painted at SAVE (the globe's probe); [] without one.
    targetFeatureIds: s.targetFeatureIds ?? [],
    // T172 (F5): the pairs + the last solve; `{}` without any (the POST field is required).
    alignment: s.alignment ?? {},
    title: customTitle || titleFromFileName(s.fileName),
    capturedAt: s.exif.capturedAt ?? null,
    cameraMake: s.exif.make ?? null,
    cameraModel: s.exif.model ?? null,
    lensModel: s.exif.lensModel ?? null,
    fileName: s.fileName ?? null,
    fileSizeBytes: s.fileSizeBytes ?? null,
    originalFileId: files.originalFileId,
    displayFileId: files.displayFileId,
    thumbFileId: files.thumbFileId,
    exifPose: s.exifPose,
  };
}

/**
 * PATCH /api/facades body — the pose + the projection params + the title; NEVER a file field (the
 * edit flow re-uploads nothing), never the texture dims (file facts). `alignment` (the F5 pairs + the
 * last solve) rides ONLY when the snapshot holds a record — a re-save without pairs must never wipe a
 * stored set; the server re-stamps `poseSource` (SOLVED while the pose equals `solved.pose`).
 * `targetFeatureIds` come from the POSE (the globe re-probes at UPDATE), so they ride along — but
 * ONLY as a non-empty set: an empty / null probe (the tiles not streamed in yet, no globe) keeps the
 * stored set, because a re-save on a half-loaded city must never wipe a good one.
 */
export function buildUpdateFacadeBody(s: FacadeSnapshot, facadeId: string): UpdateFacadeBody {
  const { textureWidth: _w, textureHeight: _h, ...pose } = poseOf(s);
  const customTitle = s.title?.trim();
  return {
    facadeId,
    ...pose,
    strength: s.projection.strength,
    ownLight: s.projection.ownLight,
    rangeM: s.projection.rangeM,
    ...(Array.isArray(s.targetFeatureIds) && s.targetFeatureIds.length > 0 ? { targetFeatureIds: s.targetFeatureIds } : {}),
    ...(s.alignment ? { alignment: s.alignment } : {}),
    title: customTitle || titleFromFileName(s.fileName),
  };
}

/**
 * The EXIF baseline pose the store captures at ingest / place (before any gizmo / slider edit) —
 * the RESET target and the `poseSource` reference (EXIF while the saved pose still equals it).
 * `placement` is the GPS seed (or the owner's click when the file had none), `apexAltM` the
 * rendered apex at that moment, `hFovDeg` the baseline H-FOV the caller derived; the frame dims are
 * the EXIF's (the SAVE body carries the decoded texture's beside it).
 */
export function exifPoseOf(exif: PhotoExif, placement: Placement, apexAltM: number, hFovDeg: number): FacadePose {
  return {
    lat: placement.latDeg,
    lon: placement.lonDeg,
    apexAltM,
    altitudeM: exif.gpsAltitudeM ?? null,
    headingDeg: exif.headingDeg ?? 0,
    pitchDeg: exif.pitchDeg ?? 0,
    rollDeg: exif.rollDeg ?? 0,
    focalLengthMm: exif.focalLengthMm ?? null,
    hFovDeg,
    fovEstimated: derivedFov(exif, exifBaselineParams(exif)).estimated,
    textureWidth: exif.width ?? null,
    textureHeight: exif.height ?? null,
  };
}
