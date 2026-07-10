/**
 * exifr-backed metadata + embedded-preview extraction (ADR D3/D4).
 *
 * exifr parses the TIFF/EXIF/GPS blocks of JPEG, PNG, HEIC and TIFF-based RAW (ARW/NEF/DNG) in
 * single-digit milliseconds — measured 2 ms on a 31 MB ARW — so metadata never waits on the WASM
 * decode. CR3/RAF are not TIFF-based and come back empty; their D4 fields fall to manual entry.
 *
 * `reviveValues: false` keeps `DateTimeOriginal` as the raw TZ-naive EXIF string ("2026:05:03
 * 07:15:02") — we string-slice it into an ISO local timestamp instead of round-tripping through
 * `Date` (EXIF has no timezone; `readout.ts` formats it by string surgery for the same reason).
 * Numeric rationals (FocalLength, ExposureTime, GPSImgDirection…) are unaffected by that flag,
 * and exifr still emits computed signed `latitude`/`longitude` (verified against fixtures).
 */

import exifr from "exifr";
import type { PhotoExif } from "./extract";

// ifd0 is always parsed (exifr can't disable it) — listing it trips the Options type.
const PARSE_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  reviveValues: false,
} as const;

/** "2026:05:03 07:15:02" (EXIF) → "2026-05-03T07:15:02" (TZ-naive ISO). */
export function exifDateToIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * EXIF ref tags sometimes surface as a raw byte wrapper (`{ "0": 0 }` / Uint8Array) instead of a
 * number — observed for GPSAltitudeRef. 0 = above sea level, 1 = below.
 */
function refByte(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && 0 in (value as Record<number, unknown>)) {
    return asNumber((value as Record<number, unknown>)[0]);
  }
  return undefined;
}

/** Map a raw exifr tag object onto the PhotoExif contract. Pure — unit-tested against fixtures. */
export function toPhotoExif(tags: Record<string, unknown> | undefined): PhotoExif {
  if (!tags) return {};

  const altitude = asNumber(tags.GPSAltitude);
  const belowSeaLevel = refByte(tags.GPSAltitudeRef) === 1;

  return {
    make: asString(tags.Make),
    model: asString(tags.Model),
    lensModel: asString(tags.LensModel),
    focalLengthMm: asNumber(tags.FocalLength),
    focalLengthIn35mmMm: asNumber(tags.FocalLengthIn35mmFormat),
    fNumber: asNumber(tags.FNumber),
    exposureSec: asNumber(tags.ExposureTime),
    iso: asNumber(tags.ISO),
    capturedAt: exifDateToIso(tags.DateTimeOriginal) ?? exifDateToIso(tags.CreateDate),
    width: asNumber(tags.ExifImageWidth) ?? asNumber(tags.ImageWidth),
    height: asNumber(tags.ExifImageHeight) ?? asNumber(tags.ImageHeight),
    gpsLat: asNumber(tags.latitude),
    gpsLon: asNumber(tags.longitude),
    gpsAltitudeM: altitude === undefined ? undefined : belowSeaLevel ? -altitude : altitude,
    headingDeg: asNumber(tags.GPSImgDirection),
    // pitch/roll are effectively never in EXIF (the D4 nudge) — left for manual entry.
  };
}

/** Parse metadata from any supported file. Never throws — unreadable/foreign formats yield {}. */
export async function parseExif(input: Blob | ArrayBuffer | Uint8Array): Promise<PhotoExif> {
  try {
    const tags = (await exifr.parse(input, PARSE_OPTIONS)) as Record<string, unknown> | undefined;
    return toPhotoExif(tags);
  } catch {
    return {};
  }
}

/**
 * Extract the embedded EXIF (IFD1) thumbnail as an object URL — the <100 ms instant preview shown
 * while the full WASM decode runs. Small (typically ~160px–1.6k px) but immediate. Returns
 * undefined when the file has none (or in non-browser contexts).
 */
export async function extractEmbeddedPreviewUrl(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<string | undefined> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  try {
    const bytes = await exifr.thumbnail(input);
    if (!bytes || bytes.length === 0) return undefined;
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  } catch {
    return undefined;
  }
}
