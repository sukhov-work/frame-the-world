/**
 * Sensor DB + field-of-view computation (ADR D4).
 *
 * The frustum's horizontal FOV drives the whole projection, so this math is load-bearing and unit-tested.
 *   hFOV = 2 · atan( sensorWidthMm / (2 · focalLengthMm) )
 *
 * Fallback ordering (most reliable first), per D4:
 *   1. `FocalLengthIn35mmFormat` (EXIF 0xA405) — a full-frame-equivalent focal length. Phones and many ILCs
 *      write it; combined with the 36 mm full-frame width it gives an exact FOV with no sensor lookup.
 *   2. Make+Model → sensor width from the curated DB, combined with the real `FocalLength`.
 *   3. A flagged default (APS-C width) so the pipeline never hard-fails; `estimated` is set so the UI can nudge.
 */

/** Full-frame ("35 mm") sensor width in millimetres — the reference for FocalLengthIn35mmFormat. */
export const FULL_FRAME_WIDTH_MM = 36;

/** Fallback sensor width when Make/Model is unknown and no 35 mm-equivalent focal is present (APS-C). */
export const DEFAULT_SENSOR_WIDTH_MM = 23.5;

/**
 * Curated Make+Model → sensor width (mm). A small, high-confidence subset — extend as needed. Keys are
 * normalised (see `normaliseKey`): uppercased, trimmed, single-spaced. Bodies that share a sensor width are
 * grouped by format at the bottom via `SENSOR_FORMAT_WIDTH_MM` used as a coarse fallback by make.
 */
export const SENSOR_WIDTH_DB_MM: Readonly<Record<string, number>> = {
  // Sony full-frame (Exmor 35.9 mm; 7R bodies 35.7 mm)
  "SONY ILCE-7M4": 35.9,
  "SONY ILCE-7RM4": 35.7,
  "SONY ILCE-7RM5": 35.7,
  "SONY ILCE-7CM2": 35.9,
  // Sony APS-C (23.5 mm; FX30 cine body 23.3 mm — the repo's ARW test fixture)
  "SONY ILCE-6700": 23.5,
  "SONY ILCE-6400": 23.5,
  "SONY ILME-FX30": 23.3,
  // Phones (main camera; phones also write FocalLengthIn35mmFormat so this is the manual-focal path)
  "APPLE IPHONE 15 PRO": 9.8,
  "APPLE IPHONE 15 PRO MAX": 9.8,
  // Canon
  "CANON EOS R5": 36.0,
  "CANON EOS R6M2": 35.9,
  "CANON EOS R7": 22.3, // APS-C
  "CANON EOS 90D": 22.3,
  // Nikon
  "NIKON Z 6_2": 35.9,
  "NIKON Z F": 35.9,
  "NIKON Z50": 23.5, // APS-C
  // Fujifilm (APS-C X-Trans 23.5 mm)
  "FUJIFILM X-T5": 23.5,
  "FUJIFILM X-H2": 23.5,
  // Micro Four Thirds (17.3 mm)
  "OM DIGITAL SOLUTIONS OM-1": 17.3,
  "PANASONIC DC-G9M2": 17.3,
};

/** Coarse per-format widths (mm) for a make/format fallback. */
export const SENSOR_FORMAT_WIDTH_MM = {
  fullFrame: 35.9,
  apsCCanon: 22.3,
  apsC: 23.5,
  mft: 17.3,
  oneInch: 13.2,
} as const;

export interface FovInputs {
  /** EXIF `FocalLength` in mm (the physical focal length). */
  focalLengthMm?: number;
  /** EXIF `FocalLengthIn35mmFormat` (0xA405) — full-frame-equivalent focal length in mm. */
  focalLengthIn35mmMm?: number;
  make?: string;
  model?: string;
}

export type FovSource = "focal35" | "sensorDb" | "default";

export interface FovResult {
  hFovDeg: number;
  /** Effective sensor width used (36 for the focal35 path). */
  sensorWidthMm: number;
  source: FovSource;
  /** True when a default sensor width had to be assumed — the UI should invite manual confirmation (D4). */
  estimated: boolean;
}

/** Horizontal FOV (degrees) for a physical focal length + sensor width. */
export function fovFromFocalAndSensor(focalLengthMm: number, sensorWidthMm: number): number {
  if (focalLengthMm <= 0 || sensorWidthMm <= 0) {
    throw new Error(`fovFromFocalAndSensor: focal and sensor width must be > 0 (got ${focalLengthMm}, ${sensorWidthMm})`);
  }
  return 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)) * (180 / Math.PI);
}

/** Normalise a Make/Model pair to a DB key: uppercased, trimmed, whitespace-collapsed. */
export function normaliseKey(make?: string, model?: string): string {
  return `${make ?? ""} ${model ?? ""}`.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Look up a sensor width from the curated DB. Returns `undefined` when not present. */
export function lookupSensorWidthMm(make?: string, model?: string): number | undefined {
  return SENSOR_WIDTH_DB_MM[normaliseKey(make, model)];
}

/**
 * Compute the horizontal FOV with the D4 fallback ordering. Never throws for missing data — a lens with no
 * usable focal length returns a flagged default so the instrument keeps working and prompts the user.
 */
export function computeHorizontalFov(inputs: FovInputs): FovResult {
  const { focalLengthMm, focalLengthIn35mmMm, make, model } = inputs;

  // 1. Full-frame-equivalent focal length → exact FOV against the 36 mm reference.
  if (focalLengthIn35mmMm && focalLengthIn35mmMm > 0) {
    return {
      hFovDeg: fovFromFocalAndSensor(focalLengthIn35mmMm, FULL_FRAME_WIDTH_MM),
      sensorWidthMm: FULL_FRAME_WIDTH_MM,
      source: "focal35",
      estimated: false,
    };
  }

  // 2. Sensor DB lookup + physical focal length.
  const dbWidth = lookupSensorWidthMm(make, model);
  if (dbWidth && focalLengthMm && focalLengthMm > 0) {
    return {
      hFovDeg: fovFromFocalAndSensor(focalLengthMm, dbWidth),
      sensorWidthMm: dbWidth,
      source: "sensorDb",
      estimated: false,
    };
  }

  // 3. Flagged default: assume APS-C width so the frustum is plausible; UI invites confirmation.
  if (focalLengthMm && focalLengthMm > 0) {
    return {
      hFovDeg: fovFromFocalAndSensor(focalLengthMm, DEFAULT_SENSOR_WIDTH_MM),
      sensorWidthMm: DEFAULT_SENSOR_WIDTH_MM,
      source: "default",
      estimated: true,
    };
  }

  // No usable focal length at all — assume a "normal" ~50°-ish view on the default sensor at 28 mm-equiv.
  return {
    hFovDeg: fovFromFocalAndSensor(28, FULL_FRAME_WIDTH_MM),
    sensorWidthMm: FULL_FRAME_WIDTH_MM,
    source: "default",
    estimated: true,
  };
}

/** Vertical FOV from a horizontal FOV and an aspect ratio (width / height). */
export function verticalFovDeg(hFovDeg: number, aspect: number): number {
  const hRad = (hFovDeg * Math.PI) / 180;
  return 2 * Math.atan(Math.tan(hRad / 2) / aspect) * (180 / Math.PI);
}
