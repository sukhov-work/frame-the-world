/**
 * Adjustable EXIF param layer (moved out of store/upload in the pre-S7 refactor, B8 — it was pure
 * already, and lib/save/pinBody.ts had to reach UP into the store to use it). The EXIF baseline is
 * immutable once ingested; `AdjustableParams` are the working values the frustum consumes. Reset
 * semantics (design board 04): double-click a slider returns a param to its EXIF baseline, or to
 * unset when the file never had it (the D4 manual-entry fields).
 *
 * Pure — no store, no three. store/upload re-exports the whole surface for back-compat.
 */

import { computeHorizontalFov, type FovResult } from "./sensors";
import type { PhotoExif } from "./extract";

/** Capture location driving the frustum — GPS-seeded at ingest, or set by clicking the globe. */
export interface Placement {
  latDeg: number;
  lonDeg: number;
}

/** The EXIF-seeded values the user can adjust before placing (Phase 3 wires these into the frustum). */
export interface AdjustableParams {
  focalLengthMm?: number;
  headingDeg?: number;
  pitchDeg?: number;
  altitudeM?: number;
}

export type AdjustableKey = keyof AdjustableParams;

/** D4 nudge order — the fields worth flagging when EXIF is thin (focal falls back via the sensor DB). */
const D4_KEYS: readonly AdjustableKey[] = ["headingDeg", "pitchDeg", "altitudeM"];

export function exifBaselineParams(exif: PhotoExif): AdjustableParams {
  return {
    focalLengthMm: exif.focalLengthMm,
    headingDeg: exif.headingDeg,
    pitchDeg: exif.pitchDeg,
    altitudeM: exif.gpsAltitudeM,
  };
}

/** The D4 fields absent from the file's EXIF — the UI must visibly invite manual entry for these. */
export function missingParamKeys(exif: PhotoExif): AdjustableKey[] {
  const baseline = exifBaselineParams(exif);
  return D4_KEYS.filter((k) => baseline[k] === undefined);
}

export type ParamSource = "exif" | "manual" | "missing";

/** Provenance of the current value of one param — drives the EXIF / MANUAL / MISSING badges. */
export function paramSource(exif: PhotoExif, params: AdjustableParams, key: AdjustableKey): ParamSource {
  const baseline = exifBaselineParams(exif)[key];
  const current = params[key];
  if (current === undefined) return baseline === undefined ? "missing" : "exif";
  if (baseline !== undefined && current === baseline) return "exif";
  return "manual";
}

/** True when any param departs from the EXIF baseline — lights the changed dot + "RESET TO EXIF". */
export function isDirty(exif: PhotoExif, params: AdjustableParams): boolean {
  const keys: AdjustableKey[] = ["focalLengthMm", ...D4_KEYS];
  return keys.some((k) => paramSource(exif, params, k) === "manual");
}

/**
 * The live H-FOV for the CURRENT params — the ONE derivation both the review readout and the
 * rendered frustum use (they must never disagree). The focal35 shortcut only holds while focal is
 * untouched from EXIF; a manual focal recomputes via the Make/Model sensor lookup (D4).
 */
export function derivedFov(exif: PhotoExif, params: AdjustableParams): FovResult {
  const focalUntouched = params.focalLengthMm === exif.focalLengthMm;
  return computeHorizontalFov({
    focalLengthMm: params.focalLengthMm,
    focalLengthIn35mmMm: focalUntouched ? exif.focalLengthIn35mmMm : undefined,
    make: exif.make,
    model: exif.model,
  });
}

/**
 * The EFFECTIVE horizontal FOV (deg) when a flow carries an explicit H-FOV override beside the
 * params (the facade flow, F1 2026-10-21: SCALE = the H-FOV, and the lens slider writes the same
 * number). `override` undefined / non-finite → the `derivedFov` baseline, byte-identical to the
 * pin flow (which never sets one). Why an override and not a focal write: the moment the focal is
 * touched `derivedFov` leaves the focal35 path for the sensor DB or the APS-C default, so a scaled
 * focal would JUMP the FOV on the first drag (and a re-opened record, whose exact hFov is reproduced
 * through a synthesized focal35, would jump hardest). Clamped to a sane open interval.
 */
export function effectiveHFovDeg(exif: PhotoExif, params: AdjustableParams, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0.5 && override < 179.5) return override;
  return derivedFov(exif, params).hFovDeg;
}
