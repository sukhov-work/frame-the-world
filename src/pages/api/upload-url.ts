// POST /api/upload-url — mint a Wix Media upload URL for the save-pin flow (ARCHITECTURE §6) and,
// since MESH SUITE MS4 (D3, 2026-09-02), for a user model. Thin per C1: authenticate → elevate →
// generate URL → return. The client uploads DIRECTLY to Wix Media (originals >10MB over TUS,
// small preview JPEGs and packed GLBs over a plain PUT) — bytes never pass through this endpoint.
import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { json, requireMember } from "../../lib/api/http";
import { checkModelUploadRequest, MODEL_MEDIA_FOLDER, MODEL_MIME } from "../../lib/wix/modelRecords";

export const POST: APIRoute = async ({ request }) => {
  const member = await requireMember();
  if (!member) return json({ error: "SIGNED_OUT", message: "sign in to upload" }, 401);

  const raw = await request.json().catch(() => null);
  const kind =
    raw?.kind === "original"
      ? "original"
      : raw?.kind === "preview"
        ? "preview"
        : raw?.kind === "model"
          ? "model"
          : null;
  const fileName = typeof raw?.fileName === "string" && raw.fileName ? raw.fileName : null;
  const mimeType = typeof raw?.mimeType === "string" && raw.mimeType ? raw.mimeType : null;
  const sizeBytes =
    typeof raw?.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) && raw.sizeBytes > 0
      ? Math.round(raw.sizeBytes)
      : null;
  if (!kind || !fileName || !mimeType || sizeBytes === null) {
    return json({ error: "BAD_REQUEST", message: "kind, fileName, mimeType, sizeBytes required" }, 400);
  }

  try {
    if (kind === "model") {
      // MESH SUITE MS4 (D3): the repo's FIRST server-side mime allowlist — ONE entry, because the
      // client normalizes every accepted format (glb/gltf/obj/fbx) to a binary glTF. PUBLIC by
      // necessity (the platform refuses private 3D files — MS0 probe 2026-09-02), a plain PUT
      // (the packed cap sits under the TUS threshold), filed under MODEL_MEDIA_FOLDER so the
      // Media Manager stays legible. The record POST re-verifies the descriptor server-side.
      const gate = checkModelUploadRequest(fileName, mimeType, sizeBytes);
      if (!gate.ok) return json({ error: "UNSUPPORTED_MODEL", message: gate.error }, 400);
      const res = await auth.elevate(files.generateFileUploadUrl)(MODEL_MIME, {
        fileName: gate.fileName,
        sizeInBytes: String(sizeBytes),
        private: false,
        filePath: MODEL_MEDIA_FOLDER,
      });
      return json({ kind, uploadUrl: res.uploadUrl, fileName: gate.fileName });
    }
    if (kind === "original") {
      // >10MB RAW originals MUST use the resumable (TUS) path; stored private.
      const res = await auth.elevate(files.generateFileResumableUploadUrl)(mimeType, {
        fileName,
        sizeInBytes: String(sizeBytes), // .d.ts: DECIMAL_VALUE string, not number
        private: true,
        uploadProtocol: "TUS",
      });
      return json({ kind, uploadUrl: res.uploadUrl, uploadToken: res.uploadToken });
    }
    // Public preview derivative — small JPEG, plain PUT upload.
    const res = await auth.elevate(files.generateFileUploadUrl)(mimeType, {
      fileName,
      sizeInBytes: String(sizeBytes),
      private: false,
    });
    return json({ kind, uploadUrl: res.uploadUrl });
  } catch (e) {
    console.error("[upload-url]", e);
    return json({ error: "UPLOAD_URL_FAILED", message: "could not create an upload URL" }, 502);
  }
};
