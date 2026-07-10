/**
 * Client → Wix Media upload steps for the save-pin flow (Phase 5). Browser-only.
 *
 * Bytes go DIRECTLY to Wix Media (C1 — the thin /api/upload-url endpoint only mints URLs):
 *  • preview  — small derived JPEG, single PUT against a generateFileUploadUrl URL;
 *  • original — the untouched camera file; >10MB REQUIRES the resumable TUS protocol
 *    (tus-js-client against a generateFileResumableUploadUrl URL, then a finalize PUT that
 *    returns the file descriptor) — platform rule from conventions/wix-headless.md §9.
 *
 * Both uploads are ASYNC on the Wix side (descriptor may report PENDING before READY); the
 * save flow stores ids/urls and does not block on readiness.
 */

export interface UploadedFile {
  fileId: string | null;
  /** Static serving URL (previews) — absent for private originals. */
  url: string | null;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

/** Upload the small preview JPEG (plain PUT). Returns the descriptor id + static URL. */
export async function uploadPreview(blob: Blob, fileName: string): Promise<UploadedFile> {
  const { uploadUrl } = await postJson("/api/upload-url", {
    kind: "preview",
    fileName,
    mimeType: "image/jpeg",
    sizeBytes: blob.size,
  });
  const res = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
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
