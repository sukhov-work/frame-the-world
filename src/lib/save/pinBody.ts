/**
 * Pure mapping: upload-store snapshot → POST /api/photos body (Phase 5).
 *
 * One derivation, shared with the UI: hFov comes from `derivedFov` (the same function the
 * readout + frustum use — they must never disagree). Exact GPS goes in the body; the SERVER
 * derives every public reduced field (C6) — nothing reduced is computed client-side.
 */

import type { PhotoExif } from "../decode/extract";
import type { PrecisionTier } from "../geo/precision";
import { derivedFov, type AdjustableParams, type Placement } from "../../store/upload";

export interface UploadSnapshot {
  exif: PhotoExif;
  params: AdjustableParams;
  placement: Placement;
  textureWidth?: number;
  textureHeight?: number;
  fileName?: string;
  fileSizeBytes?: number;
}

export interface SaveOptions {
  isPublic: boolean;
  precision: PrecisionTier;
  originalFileId: string | null;
  previewFileId: string | null;
  previewUrl: string | null;
  /** Custom pin name (Phase 5.5 S3) — blank/absent falls back to the file-name title. */
  title?: string | null;
}

/** Strip the extension for a humane default pin title. */
export function titleFromFileName(fileName: string | undefined): string {
  if (!fileName) return "Untitled";
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base || "Untitled";
}

export function buildSavePinBody(u: UploadSnapshot, opts: SaveOptions): Record<string, unknown> {
  const fov = derivedFov(u.exif, u.params);
  const customTitle = opts.title?.trim();
  return {
    title: customTitle || titleFromFileName(u.fileName),
    lat: u.placement.latDeg,
    lon: u.placement.lonDeg,
    altitudeM: u.params.altitudeM ?? null,
    headingDeg: u.params.headingDeg ?? null,
    pitchDeg: u.params.pitchDeg ?? null,
    rollDeg: u.exif.rollDeg ?? null,
    focalLengthMm: u.params.focalLengthMm ?? null,
    hFovDeg: fov.hFovDeg,
    fovEstimated: fov.estimated,
    capturedAt: u.exif.capturedAt ?? null,
    cameraMake: u.exif.make ?? null,
    cameraModel: u.exif.model ?? null,
    lensModel: u.exif.lensModel ?? null,
    textureWidth: u.textureWidth ?? null,
    textureHeight: u.textureHeight ?? null,
    fileName: u.fileName ?? null,
    fileSizeBytes: u.fileSizeBytes ?? null,
    originalFileId: opts.originalFileId,
    previewFileId: opts.previewFileId,
    previewUrl: opts.previewUrl,
    isPublic: opts.isPublic,
    precision: opts.precision,
  };
}
