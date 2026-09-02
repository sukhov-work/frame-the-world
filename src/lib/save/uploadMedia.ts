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
 *    synchronous for a small GLB — the MS0 probe), and /api/models re-reads it server-side.
 *
 * Photo uploads are ASYNC on the Wix side (descriptor may report PENDING before READY); the
 * save flow stores ids/urls and does not block on readiness.
 */
import { MODEL_MIME, type ModelListItem, type ModelPatchAnswer, type PublicModel } from "../wix/modelRecords";

export interface UploadedFile {
  fileId: string | null;
  /** Static serving URL (previews) — absent for private originals. */
  url: string | null;
}

async function requestJson(path: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
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
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    bitmap.close();
  }
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
  const res = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: blob,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`preview upload failed: HTTP ${res.status}`);
  const file = json?.file ?? json;
  return { fileId: file?.id ?? null, url: file?.url ?? null };
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
  scale?: number;
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
