/**
 * Client → Wix Media upload steps for the save-pin flow (Phase 5) and, since MESH SUITE MS4
 * (D3, 2026-09-02), the user-model flow. Browser-only.
 *
 * Bytes go DIRECTLY to Wix Media (C1 — the thin /api/upload-url endpoint only mints URLs):
 *  • preview  — small derived JPEG, single PUT against a generateFileUploadUrl URL;
 *  • original — the untouched camera file; >10MB REQUIRES the resumable TUS protocol
 *    (tus-js-client against a generateFileResumableUploadUrl URL, then a finalize PUT that
 *    returns the file descriptor) — platform rule from conventions/wix-headless.md §9;
 *  • model    — the normalized GLB (≤ 8 MB, under the TUS threshold), single PUT against a
 *    kind:"model" mint; the PUT response already carries the MODEL3D descriptor (ingest is
 *    synchronous for a small GLB — the MS0 probe), and /api/models re-reads it server-side;
 *  • facade   — PHOTO PROJECTION F2 (T169, 2026-10-21): the 2048-px display JPEG + the 512-px thumb
 *    (`makeFacadeDerivatives`, made here from the decoded texture — C1), each a single PUT against a
 *    kind:"facade" mint (public, under FACADE_MEDIA_FOLDER); the original rides kind:"original"
 *    (TUS, private) as a pin's does, and /api/facades copies the URLs off the descriptors it fetches.
 *
 * Photo uploads are ASYNC on the Wix side (descriptor may report PENDING before READY); the
 * save flow stores ids/urls and does not block on readiness.
 */
import { dataFetchInit, jsonWriteInit } from "../api/dataFetch";
import {
  FACADE_DISPLAY_JPEG_QUALITY,
  FACADE_DISPLAY_LONG_EDGE_PX,
  FACADE_IMAGE_MIME,
  FACADE_THUMB_JPEG_QUALITY,
  FACADE_THUMB_LONG_EDGE_PX,
  type FacadeListItem,
  type FacadeWorldItem,
  type SaveFacadeBody,
  type UpdateFacadeBody,
} from "../wix/facadeRecords";
import { MODEL_MIME, type ModelListItem, type ModelPatchAnswer, type PublicModel } from "../wix/modelRecords";

export interface UploadedFile {
  fileId: string | null;
  /** Static serving URL (previews) — absent for private originals. */
  url: string | null;
}

async function requestJson(path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<any> {
  // A WRITE always carries the JSON content type, body or not — a bare DELETE is 403'd by the
  // live host's origin check before the route runs (`jsonWriteInit`, owner bug 2026-09-19).
  const res = await fetch(path, method === "GET" ? { method } : jsonWriteInit(method, body));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message ?? `HTTP ${res.status}`);
    (err as Error & { code?: string; status?: number }).code = json?.error;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return json;
}

const postJson = (path: string, body: unknown) => requestJson(path, "POST", body);

/** Downscale the decoded display texture to a public preview JPEG (longest edge ≤ maxEdgePx). */
export async function downscaleToJpeg(
  sourceUrl: string,
  maxEdgePx = 1280,
  quality = 0.82,
): Promise<Blob> {
  const source = await fetch(sourceUrl).then((r) => r.blob());
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context for preview downscale");
    // 2026-10-21 (F2): the 2d context defaults to LOW smoothing (a 2×2 bilinear tap) — a big ratio
    // aliases; "high" asks for the browser's best filter at no cost worth measuring.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    bitmap.close();
  }
}

/** The plain-PUT upload against a minted URL (the small-file path: previews, model thumbnails, facade
 *  derivatives) — the PUT response carries the descriptor (`file` or the bare object). Hoisted out of
 *  `uploadPreview` for the facade kinds (F2, 2026-10-21); byte-identical behaviour for the pins. */
async function putSmallFile(uploadUrl: string, fileName: string, mimeType: string, blob: Blob, label: string): Promise<UploadedFile> {
  const res = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: blob,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} upload failed: HTTP ${res.status}`);
  const file = json?.file ?? json;
  return { fileId: file?.id ?? file?._id ?? null, url: file?.url ?? null };
}

/** Upload a small public preview image (plain PUT) — the pin's JPEG derivative, or (MESH SUITE
 *  MS4) a model's rendered PNG card thumbnail. Returns the descriptor id + static URL. */
export async function uploadPreview(blob: Blob, fileName: string, mimeType = "image/jpeg"): Promise<UploadedFile> {
  const { uploadUrl } = await postJson("/api/upload-url", {
    kind: "preview",
    fileName,
    mimeType,
    sizeBytes: blob.size,
  });
  return putSmallFile(uploadUrl, fileName, mimeType, blob, "preview");
}

/** Upload the original camera file over TUS with progress. Returns the descriptor id. */
export async function uploadOriginal(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedFile> {
  const mimeType = file.type || "application/octet-stream";
  const { uploadUrl, uploadToken } = await postJson("/api/upload-url", {
    kind: "original",
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
  });

  const { Upload } = await import("tus-js-client");
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: uploadUrl,
      metadata: { filename: file.name, contentType: mimeType, token: uploadToken ?? "" },
      onError: reject,
      onProgress: (sent, total) => onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  // Finalize per the Wix resumable-upload recipe — the PUT response carries the descriptor.
  const fin = await fetch(
    `${uploadUrl}/${uploadToken}?filename=${encodeURIComponent(file.name)}`,
    { method: "PUT" },
  );
  const json = await fin.json().catch(() => ({}));
  if (!fin.ok) throw new Error(`original finalize failed: HTTP ${fin.status}`);
  const descriptor = json?.file ?? json;
  return { fileId: descriptor?.id ?? null, url: descriptor?.url ?? null };
}

/** POST the pin record; returns { photoId, publicPinId, quota }. Throws with .code/.status. */
export async function postPhotoRecord(body: Record<string, unknown>): Promise<{
  photoId: string;
  publicPinId: string | null;
  quota: { used: number; limit: number };
}> {
  return postJson("/api/photos", body);
}

/** PATCH an owned pin (Phase 5.5 S3) — body is {photoId, …save-pin fields}. */
export async function patchPhotoRecord(body: Record<string, unknown>): Promise<{
  photoId: string;
  publicPinId: string | null;
}> {
  return requestJson("/api/photos", "PATCH", body);
}

/** DELETE an owned pin; the response carries the freed quota count. */
export async function deletePhotoRecord(photoId: string): Promise<{
  deleted: boolean;
  quota: { used: number; limit: number };
}> {
  return requestJson(`/api/photos?id=${encodeURIComponent(photoId)}`, "DELETE");
}

/** POST /api/listings — list an owned public pin for sale (Phase 6). Throws with .code/.status. */
export async function postListing(
  photoId: string,
  priceAmount: number,
): Promise<{
  productId: string;
  productVariantId: string | null;
  priceAmount: number;
  currency: string | null;
}> {
  return postJson("/api/listings", { photoId, priceAmount });
}

/** DELETE /api/listings — unlist an owned pin (removes the Stores product). */
export async function deleteListing(photoId: string): Promise<{ unlisted: boolean }> {
  return requestJson(`/api/listings?photoId=${encodeURIComponent(photoId)}`, "DELETE");
}

/** What the model PUT handed back — the record POST needs only the id (it re-reads the rest). */
export interface UploadedModelFile {
  fileId: string;
  url: string | null;
  thumbnailUrl: string | null;
  operationStatus: string | null;
}

/** MESH SUITE MS4: upload the packed GLB (plain PUT) against a kind:"model" mint. */
export async function uploadModelGlb(glb: Blob, fileName: string): Promise<UploadedModelFile> {
  const minted = await postJson("/api/upload-url", {
    kind: "model",
    fileName,
    mimeType: MODEL_MIME,
    sizeBytes: glb.size,
  });
  const name: string = typeof minted?.fileName === "string" ? minted.fileName : fileName;
  const res = await fetch(`${minted.uploadUrl}?filename=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": MODEL_MIME },
    body: glb,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`model upload failed: HTTP ${res.status}`);
  const file = json?.file ?? json;
  const fileId = file?.id ?? file?._id;
  if (typeof fileId !== "string" || fileId.length === 0) throw new Error("model upload returned no file id");
  return {
    fileId,
    url: file?.media?.model3d?.url ?? file?.url ?? null,
    thumbnailUrl: file?.media?.model3d?.thumbnail?.url ?? file?.thumbnailUrl ?? null,
    operationStatus: file?.operationStatus ?? null,
  };
}

/** POST /api/models — register the stored GLB; the server verifies the descriptor itself. */
export async function postModelRecord(body: Record<string, unknown>): Promise<{
  modelId: string;
  url: string;
  thumbnailUrl: string | null;
  readiness: string;
  existing?: boolean;
}> {
  return postJson("/api/models", body);
}

/** MESH SUITE MS5: PATCH /api/models — place / re-place a model (+ its seats). MS6: open to
 *  every signed-in member (LWW); the answer says whether the caller owns the row and carries the
 *  owner-shaped list row only then, the public row always. */
export async function patchModelPlacement(body: {
  id: string;
  lat: number;
  lon: number;
  rotDeg?: number;
  /** T128: the scale per axis (`sy` = the height); the server still takes the legacy uniform
   *  `scale` alias, but no client writes it any more. */
  sx?: number;
  sy?: number;
  sz?: number;
  /** MS7: the lift (m). */
  tU?: number;
  /** MS8: the vertical rotation (degrees). */
  pitchDeg?: number;
  rollDeg?: number;
}): Promise<ModelPatchAnswer> {
  return requestJson("/api/models", "PATCH", body);
}

/** MESH SUITE MS6: PATCH /api/models with a MANAGEMENT body — rename and/or hide an OWNED model
 *  (a body without coordinates; the server dispatches on the shape). */
export async function patchModelMeta(body: { id: string; title?: string; hidden?: boolean }): Promise<ModelPatchAnswer> {
  return requestJson("/api/models", "PATCH", body);
}

/** MESH SUITE MS6: DELETE /api/models?id= — remove an owned model: the row, then the media
 *  best-effort (`mediaDeleted` says whether the bytes went too). */
export async function deleteModelRecord(id: string): Promise<{ deleted: boolean; mediaDeleted: boolean }> {
  return requestJson(`/api/models?id=${encodeURIComponent(id)}`, "DELETE");
}

/** MESH SUITE MS5: GET /api/models — the member's own models (ids feed the "mine" set). */
export async function fetchMyModels(): Promise<{ models: ModelListItem[] }> {
  return requestJson("/api/models", "GET");
}

/** MESH SUITE MS5: GET /api/world-models?cells= — the public world read for a geohash cover. */
export async function fetchWorldModels(cells: readonly string[]): Promise<{ models: PublicModel[]; complete: boolean }> {
  const res = await fetch(`/api/world-models?cells=${encodeURIComponent(cells.join(","))}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message ?? `HTTP ${res.status}`);
    (err as Error & { code?: string; status?: number }).code = json?.error;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return json;
}

// ── PHOTO PROJECTION F2 persist (T169, 2026-10-21) — the facade wires ────────────────────────

/** A GET of a `/api` list with the data panels' timeout budget (`dataFetchInit`) and no HTTP cache
 *  (the residency read must see a row the member just saved). Throws with .code/.status like `requestJson`. */
async function getJson(path: string): Promise<any> {
  const res = await fetch(path, { ...dataFetchInit(), cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message ?? `HTTP ${res.status}`);
    (err as Error & { code?: string; status?: number }).code = json?.error;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return json;
}

/** Upload a facade display / thumb JPEG (plain PUT) against a kind:"facade" mint — public, under the
 *  facade folder; the server sanitizes the name (`.jpg` forced) and answers it back, so the PUT
 *  names the file the mint knows. Returns the descriptor id + static URL (the id is what the record
 *  POST carries — the server re-reads the URL itself). */
export async function uploadFacadeImage(blob: Blob, fileName: string): Promise<UploadedFile> {
  const minted = await postJson("/api/upload-url", {
    kind: "facade",
    fileName,
    mimeType: FACADE_IMAGE_MIME,
    sizeBytes: blob.size,
  });
  const name: string = typeof minted?.fileName === "string" ? minted.fileName : fileName;
  return putSmallFile(minted.uploadUrl, name, FACADE_IMAGE_MIME, blob, "facade image");
}

/** The decoded texture as an ImageBitmap with the EXIF orientation APPLIED (a JPEG object URL still
 *  carries its orientation tag; a RAW decode is already upright and has none). Older engines throw
 *  on the option — fall back to the bare call rather than lose the derivative. */
async function decodeOriented(source: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(source);
  }
}

/**
 * Downscale by REPEATED HALVING onto an OffscreenCanvas while `long / 2 ≥ target`, then ONE final
 * draw to the exact long edge (a ratio under 2). Why not one draw: the 2d context's resampler taps
 * a small neighbourhood (even at "high" quality it is a bilinear / bicubic kernel, not a box over
 * the whole footprint), so a 4032 → 512 single draw skips ~7 of every 8 source rows — aliasing and
 * sparkle on brick, railings, window grids; each 2× step keeps every source pixel in the average
 * (the mip-chain argument), and the sub-2× tail is where the kernel is exact enough. Never upscales:
 * a source under the target is drawn 1:1 (the caller still gets a canvas to encode from).
 */
function halveTo(src: ImageBitmap | OffscreenCanvas, targetLongEdgePx: number): OffscreenCanvas {
  let cur: ImageBitmap | OffscreenCanvas = src;
  let w = src.width;
  let h = src.height;
  const draw = (nw: number, nh: number): OffscreenCanvas => {
    const canvas = new OffscreenCanvas(nw, nh);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context for the facade derivative");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, nw, nh);
    return canvas;
  };
  while (Math.max(w, h) / 2 >= targetLongEdgePx) {
    const nw = Math.max(1, Math.round(w / 2));
    const nh = Math.max(1, Math.round(h / 2));
    cur = draw(nw, nh);
    w = nw;
    h = nh;
  }
  const long = Math.max(w, h);
  if (long > targetLongEdgePx) {
    const s = targetLongEdgePx / long;
    cur = draw(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  } else if (cur === src) {
    cur = draw(w, h); // already small enough — a 1:1 copy so the caller can encode it
  }
  return cur as OffscreenCanvas;
}

/**
 * The two public derivatives of a facade photo from the decoded texture URL (F2 / T170 — "not huge,
 * not too blurry"): the 2048-px display JPEG (q 0.82) every projector slot samples, and the 512-px
 * thumb (q 0.8) for markers / lists — the thumb continues the halving chain FROM the display canvas
 * (one decode, no second pass over the full frame). Browser-only (OffscreenCanvas + ImageBitmap);
 * the bitmap is closed on every path.
 */
export async function makeFacadeDerivatives(sourceUrl: string): Promise<{ display: Blob; thumb: Blob }> {
  const source = await fetch(sourceUrl).then((r) => r.blob());
  const bitmap = await decodeOriented(source);
  try {
    const displayCanvas = halveTo(bitmap, FACADE_DISPLAY_LONG_EDGE_PX);
    const display = await displayCanvas.convertToBlob({ type: FACADE_IMAGE_MIME, quality: FACADE_DISPLAY_JPEG_QUALITY });
    const thumbCanvas = halveTo(displayCanvas, FACADE_THUMB_LONG_EDGE_PX);
    const thumb = await thumbCanvas.convertToBlob({ type: FACADE_IMAGE_MIME, quality: FACADE_THUMB_JPEG_QUALITY });
    return { display, thumb };
  } finally {
    bitmap.close();
  }
}

/** POST /api/facades — register the facade photo; the server verifies the display / thumb descriptors
 *  itself. A 409 `FILE_NOT_READY` (async image ingest) surfaces as `.code` — the caller may retry
 *  the same body. Throws with .code/.status. `facade` is the saved list row (the server builds it
 *  from the inserted item, falling back to the record it sent — never null for a body the parser
 *  admitted, since the display URL and the pose it needs are exactly what the parser requires). */
export async function postFacadeRecord(body: SaveFacadeBody): Promise<{ facadeId: string; facade: FacadeListItem }> {
  return postJson("/api/facades", body);
}

/** PATCH /api/facades — the owner's edit (pose / projection / title; never a file field). */
export async function patchFacadeRecord(body: UpdateFacadeBody): Promise<{ facadeId: string; facade: FacadeListItem }> {
  return requestJson("/api/facades", "PATCH", body);
}

/** DELETE /api/facades?id= — remove an owned facade photo: the row, then the three files best-effort
 *  (`mediaDeleted` says whether the bytes went too). Through `jsonWriteInit` — NEVER a bare DELETE
 *  (the live host's origin check, `test/lib/api/jsonWrites.test.ts`). */
export async function deleteFacadeRecord(id: string): Promise<{ deleted: boolean; mediaDeleted: boolean }> {
  return requestJson(`/api/facades?id=${encodeURIComponent(id)}`, "DELETE");
}

/** GET /api/facades?skip= — the member's own facades, newest first, `FACADE_PAGE` per page. */
export async function fetchMyFacades(skip = 0): Promise<{ facades: FacadeListItem[]; hasNext: boolean }> {
  return getJson(skip > 0 ? `/api/facades?skip=${encodeURIComponent(String(skip))}` : "/api/facades");
}

/** GET /api/facades?cells= — the residency read for a geohash cover (p5 cells, ≤ 16 per query — a
 *  larger cover goes out as several queries, the `fetchWorldCover` precedent). PUBLIC since T190
 *  (owner 2026-10-22g) — no sign-in, every member's rows. */
export async function fetchWorldFacades(cells: readonly string[]): Promise<{ facades: FacadeWorldItem[]; complete: boolean }> {
  return getJson(`/api/facades?cells=${encodeURIComponent(cells.join(","))}`);
}
