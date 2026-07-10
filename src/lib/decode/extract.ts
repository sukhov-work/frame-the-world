/**
 * Metadata + preview extraction — the real Phase-2 pipeline (ADR D3/D4).
 *
 * Flow per file kind:
 *   - Browser-displayable (JPEG/PNG/WebP/GIF/AVIF): exifr metadata + a native object-URL preview.
 *     No WASM ever runs.
 *   - RAW (ARW/DNG/CR3/NEF/RAF): exifr metadata (~2 ms) + embedded EXIF thumbnail as an instant
 *     preview (<100 ms), then the full libraw-wasm decode in a disposable Web Worker
 *     (`worker.ts`/`workerClient.ts`) produces the final display texture. CR3/RAF are not
 *     TIFF-based, so their metadata comes back empty → the D4 manual-entry path.
 *   - HEIC/HEIF: exifr metadata, then native display when the browser can rasterise HEIC
 *     (Safari — probed with `createImageBitmap` on the actual file), else the libheif-js WASM
 *     fallback in the same worker.
 *
 * A failed full decode is NOT fatal: the caller gets the metadata + the best preview we reached,
 * with `decodeError` set so the UI can say so honestly.
 */

import { parseExif, extractEmbeddedPreviewUrl } from "./exif";
import { decodeInWorker, type DecodeHandle } from "./workerClient";

export interface PhotoExif {
  make?: string;
  model?: string;
  lensModel?: string;
  /** Physical focal length in mm (EXIF `FocalLength`). */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (EXIF 0xA405) — preferred FOV path per D4. */
  focalLengthIn35mmMm?: number;
  fNumber?: number;
  exposureSec?: number;
  iso?: number;
  /** Capture timestamp as a local ISO string, e.g. "2026-06-21T18:42:17" (no TZ — EXIF is TZ-naive). */
  capturedAt?: string;
  width?: number;
  height?: number;
  gpsLat?: number;
  gpsLon?: number;
  /** GPS altitude in metres above the ellipsoid, when present. */
  gpsAltitudeM?: number;
  /** Compass heading in degrees (EXIF `GPSImgDirection`) — usually absent on ILCs (the D4 nudge). */
  headingDeg?: number;
  /** Camera pitch in degrees — almost never in EXIF (the D4 nudge). */
  pitchDeg?: number;
  rollDeg?: number;
}

export type PreviewSource = "embedded" | "native" | "decoded" | "none";

export interface ExtractedPhoto {
  fileName: string;
  fileSizeBytes: number;
  previewUrl?: string;
  previewSource: PreviewSource;
  exif: PhotoExif;
  /** Pixel dimensions of the decoded display texture (halfSize decode → ~half the sensor dims). */
  textureWidth?: number;
  textureHeight?: number;
  /** Set when the full WASM decode failed — metadata + embedded preview are still delivered. */
  decodeError?: string;
}

export interface ExtractHooks {
  /** Real decode-stage boundaries; `target` is the progress ceiling [0..1] for the stage. */
  onProgress?(target: number, stage: string): void;
  /** Fired when a preview becomes available before extraction resolves (embedded → decoded). */
  onPreview?(previewUrl: string, source: PreviewSource): void;
  signal?: AbortSignal;
}

const RAW_EXTENSIONS = new Set(["arw", "dng", "cr3", "nef", "raf"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isRawFile(name: string): boolean {
  return RAW_EXTENSIONS.has(fileExtension(name));
}

export function isHeicFile(name: string): boolean {
  return HEIC_EXTENSIONS.has(fileExtension(name));
}

/** MIME types the browser can paint into an <img> without any WASM decode. */
export function isBrowserDisplayable(mimeType: string): boolean {
  return /^image\/(jpeg|png|webp|gif|avif)$/.test(mimeType);
}

/** Can this browser rasterise HEIC natively (Safari)? Probed on the actual file — not sniffable. */
async function canDisplayNatively(file: File): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return false;
  try {
    (await createImageBitmap(file)).close();
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Extraction aborted");
    err.name = "AbortError";
    throw err;
  }
}

export async function extractMetadata(file: File, hooks: ExtractHooks = {}): Promise<ExtractedPhoto> {
  const { onProgress, onPreview, signal } = hooks;
  const raw = isRawFile(file.name);
  const heic = isHeicFile(file.name);

  onProgress?.(0.08, "metadata");
  const exif = await parseExif(file);
  throwIfAborted(signal);

  const result: ExtractedPhoto = {
    fileName: file.name,
    fileSizeBytes: file.size,
    previewSource: "none",
    exif,
  };

  if (isBrowserDisplayable(file.type) || (heic && (await canDisplayNatively(file)))) {
    result.previewUrl = URL.createObjectURL(file);
    result.previewSource = "native";
    return result;
  }

  if (!raw && !heic) return result; // unknown format — metadata-only review card

  // Instant preview while the WASM decode runs.
  const embeddedUrl = await extractEmbeddedPreviewUrl(file);
  throwIfAborted(signal);
  if (embeddedUrl) {
    result.previewUrl = embeddedUrl;
    result.previewSource = "embedded";
    onPreview?.(embeddedUrl, "embedded");
  }

  let handle: DecodeHandle | undefined;
  const onAbort = () => handle?.cancel();
  try {
    const buffer = await file.arrayBuffer();
    throwIfAborted(signal);
    handle = decodeInWorker(raw ? "raw" : "heic", buffer, onProgress);
    signal?.addEventListener("abort", onAbort);
    const decoded = await handle.result;

    const decodedUrl = URL.createObjectURL(decoded.blob);
    // The embedded thumb is superseded; the store revokes the old URL when it swaps previews.
    result.previewUrl = decodedUrl;
    result.previewSource = "decoded";
    result.textureWidth = decoded.width;
    result.textureHeight = decoded.height;
    onPreview?.(decodedUrl, "decoded");
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
    // Keep metadata + embedded preview; surface the failure honestly.
    result.decodeError = err instanceof Error ? err.message : String(err);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return result;
}
