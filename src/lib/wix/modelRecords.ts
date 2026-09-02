/**
 * User-model contract + record builders — the PURE core of /api/models and of the model branch
 * of /api/upload-url (MESH SUITE MS4, D3 — 2026-09-02). Everything unit-testable lives here
 * (`test/lib/wix/modelRecords.test.ts`); the endpoints stay thin (validate → auth → verify the
 * descriptor → write, per C1).
 *
 * The posture, from the MS0 probe (MESH_SUITE_PLAN §1 — measured, not remembered):
 *  · the bytes are a PUBLIC Wix Media MODEL3D file (private 3D is refused with a 400) served
 *    from `static.wixstatic.com/3d/<id>.glb` with no expiry, CORS `*` and Range 206; ingest is
 *    synchronous for a small GLB (`operationStatus: READY` on the PUT response itself);
 *  · the RECORD is the source of truth for everything else (owner, readiness, hidden, placement,
 *    transform) — "hide" and "delete" are record-level, the bytes of a hidden model stay
 *    fetchable by URL (accepted under the open-POC ruling, owner 2026-09-01c);
 *  · the repo's FIRST server-side mime allowlist has exactly ONE entry: the client normalizes
 *    every accepted format to GLB, so the mint (`checkModelUploadRequest`) and the record
 *    (`verifyModelDescriptor`) both insist on `model/gltf-binary` — and the record's `url` /
 *    `thumbnailUrl` are copied from the descriptor the SERVER fetched, never from the client, so
 *    the world only ever streams bytes the platform classified as a 3D model.
 */

import { numOrNull, strOrNull } from "../geo/coerce";
import { encodeGeohash } from "../geo/geohash";
import { MODEL_CAPS, MODEL_FORMATS, type ModelCaps, type ModelFormat } from "../models/modelCaps";
import { titleFromFileName } from "../save/pinBody";

export const MODELS_COLLECTION = "UserModels";
/** Owner GET page — a member's own models (the world read is an MS5 concern). */
export const MODEL_PAGE = 200;
/** The ONE mime type the allowlist admits — the normalized GLB. */
export const MODEL_MIME = "model/gltf-binary";
/** Media Manager folder the mint files models under (created on first use by the platform). */
export const MODEL_MEDIA_FOLDER = "/plux/models";

export type ModelReadiness = "READY" | "PENDING" | "FAILED";

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
const str = (v: unknown, maxLen: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen ? v : null;

/** Media file ids look like `166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb` (probe 2026-09-02) and,
 *  for images, `166a86_…~mv2.png` — the tilde is part of the id. */
const FILE_ID_RE = /^[A-Za-z0-9_.~-]{8,255}$/;
/** Our own card thumbnail, uploaded as a public image beside the GLB — bounded like a pin preview. */
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** What the client posts once the GLB is stored — facts about the file it packed. */
export interface CreateModelBody {
  fileId: string;
  /** The rendered card thumbnail, uploaded by the client as a PUBLIC image (kind:"preview" mint);
   *  null when the browser could not paint one. The platform's own MODEL3D "thumbnail" is NOT
   *  used: its URL answers 403 forever (measured 2026-09-02h on the MS0 file, a day old). */
  thumbnailFileId: string | null;
  title: string;
  fileName: string | null;
  sourceFormat: ModelFormat;
  rawBytes: number | null;
  glbBytes: number;
  tris: number;
  meshes: number;
  textures: number;
  decimatedFromTris: number | null;
  /** Extent in metres [x, y, z] after the unit scale, or null when unknown. */
  bbox: [number, number, number] | null;
  /** The UPLOAD HERE seed — both present or both null; MS5 places the rest. */
  lat: number | null;
  lon: number | null;
}

/** Validate an untrusted request body into a CreateModelBody, or name the offending field. */
export function parseCreateModelBody(
  raw: unknown,
  caps: ModelCaps = MODEL_CAPS,
): { body: CreateModelBody } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;

  const fileId = str(r.fileId, 255);
  if (fileId === null || !FILE_ID_RE.test(fileId)) return { error: "fileId must be a media file id" };
  const thumbnailFileId = r.thumbnailFileId == null ? null : str(r.thumbnailFileId, 255);
  if (r.thumbnailFileId != null && (thumbnailFileId === null || !FILE_ID_RE.test(thumbnailFileId)))
    return { error: "thumbnailFileId must be a media file id" };
  if (!(MODEL_FORMATS as readonly unknown[]).includes(r.sourceFormat))
    return { error: `sourceFormat must be one of ${MODEL_FORMATS.join(" | ")}` };
  const glbBytes = num(r.glbBytes, 1, caps.maxGlbBytes);
  if (glbBytes === null) return { error: `glbBytes must be a number in [1, ${caps.maxGlbBytes}]` };
  const tris = num(r.tris, 1, caps.maxTris);
  if (tris === null) return { error: `tris must be a number in [1, ${caps.maxTris}]` };
  const meshes = num(r.meshes, 1, caps.maxMeshes);
  if (meshes === null) return { error: `meshes must be a number in [1, ${caps.maxMeshes}]` };
  const textures = num(r.textures, 0, caps.maxTextures);
  if (textures === null) return { error: `textures must be a number in [0, ${caps.maxTextures}]` };

  let bbox: [number, number, number] | null = null;
  if (r.bbox != null) {
    const b = r.bbox;
    const ok =
      Array.isArray(b) && b.length === 3 && b.every((v) => typeof v === "number" && v >= 0 && v <= 100_000);
    if (!ok) return { error: "bbox must be three non-negative metres [x, y, z]" };
    bbox = [b[0], b[1], b[2]];
  }

  const hasLat = r.lat != null;
  const hasLon = r.lon != null;
  if (hasLat !== hasLon) return { error: "lat and lon must be given together" };
  const lat = hasLat ? num(r.lat, -90, 90) : null;
  const lon = hasLon ? num(r.lon, -180, 180) : null;
  if (hasLat && (lat === null || lon === null)) return { error: "lat/lon must be numbers in [-90, 90] / [-180, 180]" };

  const fileName = str(r.fileName, 255);
  const decimated = r.decimatedFromTris == null ? null : num(r.decimatedFromTris, tris, 1_000_000_000);
  if (r.decimatedFromTris != null && decimated === null)
    return { error: "decimatedFromTris must be a number ≥ tris" };

  return {
    body: {
      fileId,
      thumbnailFileId,
      title: str(r.title, 120) ?? titleFromFileName(fileName ?? undefined),
      fileName,
      sourceFormat: r.sourceFormat as ModelFormat,
      rawBytes: r.rawBytes == null ? null : num(r.rawBytes, 0, 100_000_000_000),
      glbBytes,
      tris,
      meshes,
      textures,
      decimatedFromTris: decimated,
      bbox,
      lat,
      lon,
    },
  };
}

/**
 * The mint gate for `/api/upload-url` kind:"model" — the allowlist. One mime type, a `.glb`
 * name (the platform infers the media type from it too — a `.png` name would become an IMAGE),
 * a size inside the packed cap. Returns the SANITIZED file name the mint should use.
 */
export function checkModelUploadRequest(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  caps: ModelCaps = MODEL_CAPS,
): { ok: true; fileName: string } | { ok: false; error: string } {
  if (mimeType !== MODEL_MIME) return { ok: false, error: `models are uploaded as ${MODEL_MIME} only` };
  if (!(Number.isFinite(sizeBytes) && sizeBytes >= 1 && sizeBytes <= caps.maxGlbBytes))
    return { ok: false, error: `a packed model must be 1..${caps.maxGlbBytes} bytes` };
  const safe = safeModelFileName(fileName);
  if (!safe) return { ok: false, error: "fileName must end in .glb" };
  return { ok: true, fileName: safe };
}

/** Basename only, a conservative character set, forced `.glb`, ≤ 200 chars (the SDK's max). */
export function safeModelFileName(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  if (!/\.glb$/i.test(base)) return null;
  const stem = base
    .slice(0, -4)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return `${stem || "model"}.glb`;
}

/** What the server learned from the MODEL3D descriptor — the ONLY source of the model url. The
 *  thumbnail is filled from OUR image descriptor (`verifyThumbnailDescriptor`), never from the
 *  model3d one (its URL is a permanent 403 — see CreateModelBody.thumbnailFileId). */
export interface VerifiedModelFile {
  fileId: string;
  url: string;
  thumbnailFileId: string | null;
  thumbnailUrl: string | null;
  sizeBytes: number | null;
  readiness: ModelReadiness;
}

export type DescriptorVerdict =
  | { ok: true; file: VerifiedModelFile }
  | {
      ok: false;
      code: "NOT_A_MODEL" | "WRONG_MIME" | "PRIVATE_FILE" | "TOO_LARGE" | "NO_URL" | "INGEST_FAILED";
      error: string;
    };

/**
 * Judge a Media FileDescriptor (shape as the SDK returns it — `sizeInBytes` is a DECIMAL STRING,
 * the 3D url/thumbnail live under `media.model3d`). Anything that is not a public, size-capped,
 * GLB-typed MODEL3D with a static URL is refused; a still-ingesting file is accepted as PENDING
 * (the record carries readiness; MS5's loader treats PENDING as "not yet").
 */
export function verifyModelDescriptor(d: unknown, caps: ModelCaps = MODEL_CAPS): DescriptorVerdict {
  const r = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
  const fileId = strOrNull(r._id) ?? strOrNull(r.id);
  if (r.mediaType !== "MODEL3D" || !fileId)
    return { ok: false, code: "NOT_A_MODEL", error: "the file is not a 3D model" };
  if (typeof r.mimeType === "string" && r.mimeType !== MODEL_MIME)
    return { ok: false, code: "WRONG_MIME", error: `the file is ${r.mimeType}, not ${MODEL_MIME}` };
  if (r.private === true) return { ok: false, code: "PRIVATE_FILE", error: "the file is private" };
  const sizeRaw = r.sizeInBytes;
  const sizeBytes =
    typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw)
      ? Number(sizeRaw)
      : typeof sizeRaw === "number"
        ? sizeRaw
        : null;
  if (sizeBytes !== null && sizeBytes > caps.maxGlbBytes)
    return { ok: false, code: "TOO_LARGE", error: `the file is ${sizeBytes} bytes; the limit is ${caps.maxGlbBytes}` };
  const media = (r.media as Record<string, unknown> | undefined)?.model3d as Record<string, unknown> | undefined;
  const url = strOrNull(media?.url) ?? strOrNull(r.url);
  if (!url || !/^https:\/\//.test(url)) return { ok: false, code: "NO_URL", error: "the file has no static URL yet" };
  const status = r.operationStatus;
  if (status === "FAILED") return { ok: false, code: "INGEST_FAILED", error: "the platform could not process the file" };
  return {
    ok: true,
    file: {
      fileId,
      url,
      thumbnailFileId: null,
      thumbnailUrl: null,
      sizeBytes,
      readiness: status === "READY" ? "READY" : "PENDING",
    },
  };
}

/**
 * Judge the descriptor of OUR uploaded card thumbnail: a public, size-bounded IMAGE with a static
 * URL. A refusal never blocks the model — the record simply carries no thumbnail.
 */
export function verifyThumbnailDescriptor(d: unknown): { ok: true; fileId: string; url: string } | { ok: false; error: string } {
  const r = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
  const fileId = strOrNull(r._id) ?? strOrNull(r.id);
  if (r.mediaType !== "IMAGE" || !fileId) return { ok: false, error: "the thumbnail is not an image" };
  if (r.private === true) return { ok: false, error: "the thumbnail is private" };
  const sizeRaw = r.sizeInBytes;
  const sizeBytes = typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : typeof sizeRaw === "number" ? sizeRaw : null;
  if (sizeBytes !== null && sizeBytes > THUMBNAIL_MAX_BYTES) return { ok: false, error: "the thumbnail is too large" };
  const url = strOrNull(r.url);
  if (!url || !/^https:\/\//.test(url)) return { ok: false, error: "the thumbnail has no static URL" };
  return { ok: true, fileId, url };
}

/** The UserModels row (ADMIN-only collection; /api/models is the only writer). */
export function modelRecord(
  body: CreateModelBody,
  file: VerifiedModelFile,
  ownerMemberId: string,
): Record<string, unknown> {
  const placed = body.lat !== null && body.lon !== null;
  return {
    title: body.title,
    ownerMemberId,
    fileId: file.fileId,
    url: file.url,
    thumbnailFileId: file.thumbnailFileId,
    thumbnailUrl: file.thumbnailUrl,
    fileName: body.fileName,
    sourceFormat: body.sourceFormat,
    rawBytes: body.rawBytes,
    // The platform's own byte count outranks the client's when the descriptor carries one.
    glbBytes: file.sizeBytes ?? body.glbBytes,
    tris: body.tris,
    meshes: body.meshes,
    textures: body.textures,
    decimatedFromTris: body.decimatedFromTris,
    bboxX: body.bbox?.[0] ?? null,
    bboxY: body.bbox?.[1] ?? null,
    bboxZ: body.bbox?.[2] ?? null,
    readiness: file.readiness,
    hidden: false,
    lat: placed ? body.lat : null,
    lon: placed ? body.lon : null,
    geohash9: placed ? encodeGeohash(body.lat as number, body.lon as number, 9) : null,
    // Transform seats (MS5/MS6) — null = identity, the BuildingOverrides convention.
    rotDeg: null,
    scale: null,
  };
}

/** Owner-facing list row for GET /api/models. */
export interface ModelListItem {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  fileName: string | null;
  sourceFormat: string | null;
  glbBytes: number | null;
  tris: number | null;
  meshes: number | null;
  textures: number | null;
  decimatedFromTris: number | null;
  bbox: [number, number, number] | null;
  readiness: ModelReadiness;
  hidden: boolean;
  lat: number | null;
  lon: number | null;
  createdAt: string | null;
}

export function modelListItem(item: Record<string, unknown>): ModelListItem | null {
  if (typeof item._id !== "string") return null;
  const url = strOrNull(item.url);
  // A row without a URL cannot be streamed — drop it defensively rather than list a ghost.
  if (!url) return null;
  const bx = numOrNull(item.bboxX);
  const by = numOrNull(item.bboxY);
  const bz = numOrNull(item.bboxZ);
  const created = item._createdDate;
  const readiness = item.readiness;
  return {
    id: item._id,
    title: strOrNull(item.title) ?? "Untitled model",
    url,
    thumbnailUrl: strOrNull(item.thumbnailUrl),
    fileName: strOrNull(item.fileName),
    sourceFormat: strOrNull(item.sourceFormat),
    glbBytes: numOrNull(item.glbBytes),
    tris: numOrNull(item.tris),
    meshes: numOrNull(item.meshes),
    textures: numOrNull(item.textures),
    decimatedFromTris: numOrNull(item.decimatedFromTris),
    bbox: bx !== null && by !== null && bz !== null ? [bx, by, bz] : null,
    readiness: readiness === "READY" || readiness === "FAILED" ? readiness : "PENDING",
    hidden: item.hidden === true,
    lat: numOrNull(item.lat),
    lon: numOrNull(item.lon),
    createdAt:
      created instanceof Date ? created.toISOString() : typeof created === "string" ? created : null,
  };
}
