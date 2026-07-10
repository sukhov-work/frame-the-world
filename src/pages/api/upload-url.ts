// POST /api/upload-url — mint a Wix Media upload URL for the save-pin flow (ARCHITECTURE §6).
// Thin per C1: authenticate → elevate → generate URL → return. The client uploads DIRECTLY to
// Wix Media (originals >10MB over TUS, small preview JPEGs over a plain PUT) — bytes never
// pass through this endpoint.
import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { members } from "@wix/members";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const POST: APIRoute = async ({ request }) => {
  let member;
  try {
    ({ member } = await members.getCurrentMember());
  } catch {
    member = undefined;
  }
  if (!member?._id) return json({ error: "SIGNED_OUT", message: "sign in to save pins" }, 401);

  const raw = await request.json().catch(() => null);
  const kind = raw?.kind === "original" ? "original" : raw?.kind === "preview" ? "preview" : null;
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
