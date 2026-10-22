/**
 * FACADE PHOTOS (the photo flow (b), F2 persist — T169, 2026-10-21): the record shapes shared by
 * the elevated `/api/facades` endpoint, the client wrappers (`lib/save/uploadMedia.ts`), the facade
 * store and the residency read. Pure module: no zustand, no tuning, no `@wix` imports — safe for
 * server routes, `lib/wix` and client stores alike (the `lib/pins/fields.ts` locality rule).
 *
 * THE RECORD IS THE POSE, NEVER A BAKED ATLAS (triage §4; C1): a row holds where the camera stood
 * and how it looked, the projection parameters, the Media ids of the three files (the private
 * original · the public 2048-px display JPEG · the public 512-px thumb) and the alignment seats
 * (T172 — `targetFeatureIds` + `alignment`, empty in v1). The projection itself happens at runtime
 * in the city material from this pose.
 *
 * C6: a projected facade photo is EXACT by nature — the pose IS the content, so reduced precision
 * cannot apply. T190 (owner ruling 2026-10-22g): the world read is PUBLIC — every visitor streams
 * every member's rows, signed out and unmoderated (`isPublic` / `moderation` are stamped but not
 * consulted; REMOVED is the one withheld state, set by hand only). The owner id, the file ids and
 * the original never leave the server. MINE and the writes stay owner-gated.
 *
 * THE APEX HEIGHT. `apexAltM` is the rendered apex height above the WGS84 ellipsoid at save time —
 * the number the owner saw — so a resident (read-only) facade rebuilds its frustum from it directly
 * with no terrain lookup; `altitudeM` keeps the slider / EXIF value for the editor (the pin flow's
 * D4 semantics: EXIF-sourced = absolute, manual = metres above the rendered ground).
 */

import { numOrNull, strOrNull } from "../geo/coerce";
import { encodeGeohash } from "../geo/geohash";
import { titleFromFileName } from "../save/pinBody";

/** The camera pose + optics of a facade photo — what the frustum and the projector are built from. */
export interface FacadePose {
  lat: number;
  lon: number;
  /** The rendered apex height above the ellipsoid (m) — see the module header. */
  apexAltM: number;
  /** The editor's altitude value (the EXIF GPS altitude or the slider's metres above ground); null = unset. */
  altitudeM: number | null;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** The EXIF / edited physical focal (informational — the H-FOV below is the truth the frustum uses). */
  focalLengthMm: number | null;
  /** The EFFECTIVE horizontal field of view (deg) — the one number the frustum, the projector and the
   *  SCALE gizmo agree on (F1: scale = the H-FOV; a wider frustum IS a shorter focal, never a stretch). */
  hFovDeg: number;
  fovEstimated: boolean;
  textureWidth: number | null;
  textureHeight: number | null;
}

/** The projection parameters (the panel's PROJECTION section + the per-slot range). */
export interface FacadeProjectionParams {
  /** 0..1 — how much of the facade's albedo the photo replaces. */
  strength: number;
  /** 0..1 — 0 = lit by the scene, 1 = the photo's own colours. */
  ownLight: number;
  /** Metres from the apex the photo papers geometry; null = `PHOTO_PROJECT.rangeM`. */
  rangeM: number | null;
}

/** The alignment seats (T172 / F5) — born with the record, empty in v1. */
export interface FacadeAlignment {
  /** Building keys the projector paints: `"osm:<id>"` or `"<variant>|<cell>|<featureId>"` — never a
   *  bare `_feature_id_0` (ids restart per tile). Empty until the id map lands (T172). */
  targetFeatureIds: string[];
  /** `{ pairs: [{ uv: [u, v], featureId, cornerIndex | worldEcef }] }` once a solver exists; `{}` in v1. */
  alignment: Record<string, unknown>;
}

/** Where the pose came from (the D4 idiom): the EXIF baseline, a manual gizmo / slider edit, or a solver. */
export type FacadePoseSource = "EXIF" | "MANUAL" | "SOLVED";

/**
 * What the client POSTs to save a facade photo — the pose + params + the Media ids the client got
 * back from its three uploads + the EXIF facts. The server derives `geohash9`, `gh5`, `isPublic`
 * (false), `moderation` ("PRIVATE"), copies the public URLs off the VERIFIED descriptors (the
 * models' posture — a client never dictates a URL) and stamps `poseSource`.
 */
export interface SaveFacadeBody extends FacadePose, FacadeProjectionParams, FacadeAlignment {
  title: string;
  /** TZ-naive EXIF local ISO string, stored verbatim (`mem:patterns/upload-flow`). */
  capturedAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  /** The private original (TUS, `kind: "original"`) — null when its upload degraded. */
  originalFileId: string | null;
  /** The public 2048-px display JPEG (`kind: "facade"`) — REQUIRED: it is what every slot projects. */
  displayFileId: string;
  /** The public 512-px thumb (`kind: "facade"`) — null when its upload degraded (markers fall back to the display). */
  thumbFileId: string | null;
  /** The EXIF pose as the photo arrived (before any gizmo / slider edit) — the RESET baseline. */
  exifPose: FacadePose | null;
}

/** PATCH body: the id + any subset of the editable fields (file ids / URLs are never patched). */
export interface UpdateFacadeBody extends Partial<FacadePose>, Partial<FacadeProjectionParams>, Partial<FacadeAlignment> {
  facadeId: string;
  title?: string;
}

/**
 * The slim world row the residency read returns — enough to build the frustum + the projector slot
 * + a marker; NEVER an owner id, a file id or the original. One shape for "mine" and "world". T190
 * (owner ruling 2026-10-22g): the world read is PUBLIC — every visitor streams every member's rows,
 * signed out and unmoderated — so this shape IS the public tier; it never grows an owner field.
 */
export interface FacadeWorldItem extends FacadePose, FacadeProjectionParams {
  id: string;
  title: string;
  displayUrl: string;
  thumbUrl: string | null;
  /** `_updatedDate` as ISO — the LWW / read-lag merge key (the models' precedent). */
  updatedAt: string;
}

/** The owner's own list row (MY FACADES): the world shape + the editor's facts. */
export interface FacadeListItem extends FacadeWorldItem, FacadeAlignment {
  capturedAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  poseSource: FacadePoseSource;
  exifPose: FacadePose | null;
  createdAt: string;
  isPublic: boolean;
  moderation: string;
}

/**
 * The pose the EDIT JOURNAL snapshots (F1 undo): one gizmo release = one entry whose before / after
 * are this shape, read from the facade store (`lat`/`lon` = the placement, the rest = the params
 * + the roll nudge + the H-FOV override). Null fields = "unset" (the EXIF baseline), compared
 * verbatim — a `restorePose` writes them back as-is.
 */
export interface FacadePoseSnapshot {
  lat: number;
  lon: number;
  altitudeM: number | null;
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  hFovDeg: number | null;
}

/** "Same persisted pose" for the journal's unchanged-since guard: every field exact (a release
 *  without movement produces an identical snapshot and is dropped as a no-op). */
export function sameFacadePose(a: FacadePoseSnapshot | null, b: FacadePoseSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.altitudeM === b.altitudeM &&
    a.headingDeg === b.headingDeg &&
    a.pitchDeg === b.pitchDeg &&
    a.rollDeg === b.rollDeg &&
    a.hFovDeg === b.hFovDeg
  );
}

/** The collection id (the provisioner's `id`), the one page size and the residency cell precision. */
export const FACADES_COLLECTION = "FacadePhotos";
export const FACADE_PAGE = 200;
/** Health rail, not a product limit (owner: "hundreds per city, maybe thousands"): one count per POST. */
export const FACADE_MAX_PER_MEMBER = 5000;
/** The residency cell — p5 (~4.9 × 4.9 km), the UserModels `gh5` precedent (`hasSome` on a set). */
export const FACADE_COVER_PRECISION = 5;
export const FACADE_MEDIA_FOLDER = "/plux/facades";
/** The display derivative's long edge (px) + JPEG quality, and the thumb's (plan §3, T170). */
export const FACADE_DISPLAY_LONG_EDGE_PX = 2048;
export const FACADE_DISPLAY_JPEG_QUALITY = 0.82;
export const FACADE_THUMB_LONG_EDGE_PX = 512;
export const FACADE_THUMB_JPEG_QUALITY = 0.8;
/** The display JPEG's byte cap at the upload-url gate (a 2048-px q 0.82 frame is ~0.35–0.6 MB). */
export const FACADE_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

// ── F2 persist (2026-10-21): the parsers, the record builders and the row mappers ───────────────
// The PURE core of `/api/facades` (the pinRecords / modelRecords posture: the endpoint stays thin —
// validate → auth → verify the descriptor → write — and everything unit-testable lives here,
// `test/lib/wix/facadeRecords.test.ts`).

/** Public Wix Media images are served from here (every `~mv2` image descriptor the pins and the
 *  model thumbnails ever read back) — the ALLOWLIST prefix for a facade display / thumb URL: the
 *  server copies a URL off the descriptor only when it starts with this, so a row can never point
 *  anywhere but the platform's static image host. */
export const FACADE_URL_PREFIX = "https://static.wixstatic.com/media/";
/** The one mime type the `/api/upload-url` kind `"facade"` mints (the derivatives are JPEG by construction). */
export const FACADE_IMAGE_MIME = "image/jpeg";
export const FACADE_TITLE_MAX = 120;
/** The alignment seats (T172) are JSON-IN-TEXT: the provisioner knows TEXT / NUMBER / BOOLEAN only
 *  (`scripts/provision-collections.mjs`), so the array and the object are serialized, and the parser
 *  is the size rail (a Wix TEXT column is not the place for a megabyte of correspondences). */
export const FACADE_TARGET_IDS_MAX = 200;
export const FACADE_TARGET_ID_MAX_LEN = 80;
export const FACADE_TARGET_IDS_MAX_BYTES = 8 * 1024;
export const FACADE_ALIGNMENT_MAX_BYTES = 16 * 1024;
/** The projection defaults when a body omits them (the store's `DEFAULT_PROJECTION`). */
export const FACADE_STRENGTH_DEFAULT = 1;
export const FACADE_OWN_LIGHT_DEFAULT = 0.6;
/** The per-slot range rail (m): under 10 m paints nothing useful, over 5 km is the whole city. */
export const FACADE_RANGE_MIN_M = 10;
export const FACADE_RANGE_MAX_M = 5_000;
/** "The pose equals the EXIF pose" tolerance for the provenance badge (`derivePoseSource`). */
export const FACADE_POSE_EPS = 1e-9;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
/** Media file ids look like `166a86_…~mv2.jpg` — the modelRecords `FILE_ID_RE` twin (not exported there). */
const FILE_ID_RE = /^[A-Za-z0-9_.~-]{8,255}$/;
const POSE_SOURCES: readonly FacadePoseSource[] = ["EXIF", "MANUAL", "SOLVED"];

/** A compass heading wrapped onto [0, 360) — `-90` → `270`, `360` → `0`, `-0` → `0`. */
export function wrapHeadingDeg(deg: number): number {
  const w = ((deg % 360) + 360) % 360;
  return w === 0 ? 0 : w; // fold -0
}

/** The facade pose line, one format for MY FACADES and the marker hover card (T183):
 *  `"N 48.46470 E 35.04620 · 90.0°"` — hemisphere letters, 5 decimals (~1 m), heading to 0.1°. */
export function facadePoseLine(item: { lat: number; lon: number; headingDeg: number }): string {
  const ns = `${item.lat >= 0 ? "N" : "S"} ${Math.abs(item.lat).toFixed(5)}`;
  const ew = `${item.lon >= 0 ? "E" : "W"} ${Math.abs(item.lon).toFixed(5)}`;
  return `${ns} ${ew} · ${item.headingDeg.toFixed(1)}°`;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

// ── the pose fields, ONE rule table shared by the save body, the EXIF pose and the PATCH ──────

type PoseKey = keyof FacadePose;
type PoseRule =
  | { kind: "num"; min: number; max: number; openMin?: boolean; openMax?: boolean; nullable?: boolean }
  | { kind: "heading" }
  | { kind: "bool" };

const POSE_RULES: Record<PoseKey, PoseRule> = {
  lat: { kind: "num", min: -90, max: 90 },
  lon: { kind: "num", min: -180, max: 180 },
  apexAltM: { kind: "num", min: -500, max: 20_000 },
  altitudeM: { kind: "num", min: -500, max: 20_000, nullable: true },
  headingDeg: { kind: "heading" },
  pitchDeg: { kind: "num", min: -90, max: 90 },
  rollDeg: { kind: "num", min: -180, max: 180 },
  focalLengthMm: { kind: "num", min: 0, max: 5_000, openMin: true, nullable: true },
  // The effective H-FOV — the open interval `effectiveHFovDeg` clamps onto (`lib/decode/params.ts`).
  hFovDeg: { kind: "num", min: 0.5, max: 179.5, openMin: true, openMax: true },
  fovEstimated: { kind: "bool" },
  textureWidth: { kind: "num", min: 1, max: 100_000, nullable: true },
  textureHeight: { kind: "num", min: 1, max: 100_000, nullable: true },
};
const POSE_KEYS = Object.keys(POSE_RULES) as PoseKey[];
/** The pose fields whose edit is a POSE CHANGE for the provenance badge (not the file facts). */
const POSE_EDIT_KEYS: readonly PoseKey[] = ["lat", "lon", "apexAltM", "altitudeM", "headingDeg", "pitchDeg", "rollDeg", "focalLengthMm", "hFovDeg"];

/** Validate ONE present pose value against its rule; the error names the field (prefixed for a nested pose). */
function poseField(key: PoseKey, v: unknown, prefix = ""): { ok: true; value: number | boolean | null } | { ok: false; error: string } {
  const rule = POSE_RULES[key];
  const name = `${prefix}${key}`;
  if (rule.kind === "bool") {
    return typeof v === "boolean" ? { ok: true, value: v } : { ok: false, error: `${name} must be a boolean` };
  }
  if (rule.kind === "heading") {
    return typeof v === "number" && Number.isFinite(v)
      ? { ok: true, value: wrapHeadingDeg(v) }
      : { ok: false, error: `${name} must be a finite number (degrees)` };
  }
  if (v === null && rule.nullable) return { ok: true, value: null };
  const inRange =
    typeof v === "number" &&
    Number.isFinite(v) &&
    (rule.openMin ? v > rule.min : v >= rule.min) &&
    (rule.openMax ? v < rule.max : v <= rule.max);
  if (inRange) return { ok: true, value: v };
  const range = `${rule.openMin ? "(" : "["}${rule.min}, ${rule.max}${rule.openMax ? ")" : "]"}`;
  return { ok: false, error: `${name} must be a number in ${range}${rule.nullable ? " or null" : ""}` };
}

/** A FULL pose off an untrusted object: the nullable fields default to null, `fovEstimated` to false,
 *  everything else is required. `prefix` labels a nested pose's errors (`exifPose.lat …`). */
export function parseFacadePose(raw: unknown, prefix = ""): { pose: FacadePose } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `${prefix || "pose "}must be an object` };
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of POSE_KEYS) {
    const rule = POSE_RULES[key];
    const v = r[key];
    if (v === undefined) {
      if (rule.kind === "bool") out[key] = false;
      else if (rule.kind === "num" && rule.nullable) out[key] = null;
      else return { error: `${prefix}${key} is required` };
      continue;
    }
    const f = poseField(key, v, prefix);
    if (!f.ok) return { error: f.error };
    out[key] = f.value;
  }
  return { pose: out as unknown as FacadePose };
}

/** The pose fields PRESENT on an untrusted PATCH, each validated by the same rule (absent = untouched). */
function parsePosePatch(r: Record<string, unknown>): { patch: Partial<FacadePose> } | { error: string } {
  const out: Record<string, unknown> = {};
  for (const key of POSE_KEYS) {
    const v = r[key];
    if (v === undefined) continue;
    const f = poseField(key, v);
    if (!f.ok) return { error: f.error };
    out[key] = f.value;
  }
  return { patch: out as Partial<FacadePose> };
}

// ── the projection params, the alignment seats, the strings ──────────────────────────────────

function parseStrength(v: unknown, key: "strength" | "ownLight", fallback: number): { value: number } | { error: string } {
  if (v === undefined) return { value: fallback };
  const n = num(v, 0, 1);
  return n === null ? { error: `${key} must be a number in [0, 1]` } : { value: n };
}

function parseRange(v: unknown): { value: number | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  const n = num(v, FACADE_RANGE_MIN_M, FACADE_RANGE_MAX_M);
  return n === null ? { error: `rangeM must be a number in [${FACADE_RANGE_MIN_M}, ${FACADE_RANGE_MAX_M}] or null` } : { value: n };
}

function parseTargetFeatureIds(v: unknown): { value: string[] } | { error: string } {
  if (v === undefined) return { value: [] };
  const ok =
    Array.isArray(v) &&
    v.length <= FACADE_TARGET_IDS_MAX &&
    v.every((id) => typeof id === "string" && id.length > 0 && id.length <= FACADE_TARGET_ID_MAX_LEN);
  if (!ok)
    return { error: `targetFeatureIds must be an array of ≤ ${FACADE_TARGET_IDS_MAX} strings (1..${FACADE_TARGET_ID_MAX_LEN} chars each)` };
  const ids = v as string[];
  if (utf8Bytes(JSON.stringify(ids)) > FACADE_TARGET_IDS_MAX_BYTES)
    return { error: `targetFeatureIds must serialize to ≤ ${FACADE_TARGET_IDS_MAX_BYTES} bytes` };
  return { value: ids };
}

function parseAlignment(v: unknown): { value: Record<string, unknown> } | { error: string } {
  if (v === undefined) return { value: {} };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { error: "alignment must be a plain object" };
  let bytes: number;
  try {
    bytes = utf8Bytes(JSON.stringify(v));
  } catch {
    return { error: "alignment must be JSON-serializable" };
  }
  if (bytes > FACADE_ALIGNMENT_MAX_BYTES) return { error: `alignment must serialize to ≤ ${FACADE_ALIGNMENT_MAX_BYTES} bytes` };
  return { value: v as Record<string, unknown> };
}

/** An optional string column: absent / null → null; a string within the cap → itself; else the field is named. */
function optStr(r: Record<string, unknown>, key: string, maxLen: number): { value: string | null } | { error: string } {
  const v = r[key];
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string" || v.length > maxLen) return { error: `${key} must be a string of ≤ ${maxLen} characters` };
  return { value: v.length === 0 ? null : v };
}

/** An optional Media file id: absent / null → null; else it must LOOK like one (the models' rule). */
function optFileId(r: Record<string, unknown>, key: string): { value: string | null } | { error: string } {
  const v = r[key];
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string" || !FILE_ID_RE.test(v)) return { error: `${key} must be a media file id` };
  return { value: v };
}

/** The title rule: a string, trimmed, ≤ FACADE_TITLE_MAX; blank / absent → the file-name title (the pin precedent). */
function parseTitle(v: unknown, fileName: string | null): { value: string } | { error: string } {
  if (v === undefined || v === null) return { value: titleFromFileName(fileName ?? undefined) };
  if (typeof v !== "string") return { error: "title must be a string" };
  const t = v.trim();
  if (t.length > FACADE_TITLE_MAX) return { error: `title must keep ≤ ${FACADE_TITLE_MAX} characters` };
  return { value: t || titleFromFileName(fileName ?? undefined) };
}

/** Validate an untrusted POST body into a SaveFacadeBody, or name the offending field. */
export function parseSaveFacadeBody(raw: unknown): { body: SaveFacadeBody } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;

  const pose = parseFacadePose(r);
  if ("error" in pose) return pose;

  const strength = parseStrength(r.strength, "strength", FACADE_STRENGTH_DEFAULT);
  if ("error" in strength) return strength;
  const ownLight = parseStrength(r.ownLight, "ownLight", FACADE_OWN_LIGHT_DEFAULT);
  if ("error" in ownLight) return ownLight;
  const rangeM = parseRange(r.rangeM);
  if ("error" in rangeM) return rangeM;

  const fileName = optStr(r, "fileName", 255);
  if ("error" in fileName) return fileName;
  const title = parseTitle(r.title, fileName.value);
  if ("error" in title) return title;
  const capturedAt = optStr(r, "capturedAt", 40);
  if ("error" in capturedAt) return capturedAt;
  const cameraMake = optStr(r, "cameraMake", 80);
  if ("error" in cameraMake) return cameraMake;
  const cameraModel = optStr(r, "cameraModel", 80);
  if ("error" in cameraModel) return cameraModel;
  const lensModel = optStr(r, "lensModel", 120);
  if ("error" in lensModel) return lensModel;

  let fileSizeBytes: number | null = null;
  if (r.fileSizeBytes !== undefined && r.fileSizeBytes !== null) {
    fileSizeBytes = num(r.fileSizeBytes, 0, 100_000_000_000);
    if (fileSizeBytes === null) return { error: "fileSizeBytes must be a number in [0, 1e11] or null" };
  }

  const originalFileId = optFileId(r, "originalFileId");
  if ("error" in originalFileId) return originalFileId;
  // The display JPEG is REQUIRED — it is what every projector slot samples (the module header).
  const displayFileId = typeof r.displayFileId === "string" && FILE_ID_RE.test(r.displayFileId) ? r.displayFileId : null;
  if (displayFileId === null) return { error: "displayFileId must be a media file id" };
  const thumbFileId = optFileId(r, "thumbFileId");
  if ("error" in thumbFileId) return thumbFileId;

  const targetFeatureIds = parseTargetFeatureIds(r.targetFeatureIds);
  if ("error" in targetFeatureIds) return targetFeatureIds;
  const alignment = parseAlignment(r.alignment);
  if ("error" in alignment) return alignment;

  let exifPose: FacadePose | null = null;
  if (r.exifPose !== undefined && r.exifPose !== null) {
    const p = parseFacadePose(r.exifPose, "exifPose.");
    if ("error" in p) return p;
    exifPose = p.pose;
  }

  return {
    body: {
      ...pose.pose,
      strength: strength.value,
      ownLight: ownLight.value,
      rangeM: rangeM.value,
      targetFeatureIds: targetFeatureIds.value,
      alignment: alignment.value,
      title: title.value,
      capturedAt: capturedAt.value,
      cameraMake: cameraMake.value,
      cameraModel: cameraModel.value,
      lensModel: lensModel.value,
      fileName: fileName.value,
      fileSizeBytes,
      originalFileId: originalFileId.value,
      displayFileId,
      thumbFileId: thumbFileId.value,
      exifPose,
    },
  };
}

/** The editable subset a PATCH may carry (everything in `UpdateFacadeBody` but the id). */
export type FacadeUpdatePatch = Omit<UpdateFacadeBody, "facadeId">;

/**
 * Validate an untrusted PATCH body: `facadeId` + any subset of the editable fields, each under the
 * SAVE rule (absent = untouched; a nullable field may be set to null). File ids, URLs, the owner,
 * the EXIF pose and the moderation state are NOT editable and are simply never read off the body.
 */
export function parseUpdateFacadeBody(raw: unknown): { facadeId: string; body: FacadeUpdatePatch } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const facadeId = typeof r.facadeId === "string" && r.facadeId.length > 0 && r.facadeId.length <= 64 ? r.facadeId : null;
  if (facadeId === null) return { error: "facadeId is required" };

  const pose = parsePosePatch(r);
  if ("error" in pose) return pose;
  const body: FacadeUpdatePatch = { ...pose.patch };

  if (r.strength !== undefined) {
    const s = parseStrength(r.strength, "strength", FACADE_STRENGTH_DEFAULT);
    if ("error" in s) return s;
    body.strength = s.value;
  }
  if (r.ownLight !== undefined) {
    const s = parseStrength(r.ownLight, "ownLight", FACADE_OWN_LIGHT_DEFAULT);
    if ("error" in s) return s;
    body.ownLight = s.value;
  }
  if (r.rangeM !== undefined) {
    const s = parseRange(r.rangeM);
    if ("error" in s) return s;
    body.rangeM = s.value;
  }
  if (r.targetFeatureIds !== undefined) {
    const s = parseTargetFeatureIds(r.targetFeatureIds);
    if ("error" in s) return s;
    body.targetFeatureIds = s.value;
  }
  if (r.alignment !== undefined) {
    const s = parseAlignment(r.alignment);
    if ("error" in s) return s;
    body.alignment = s.value;
  }
  if (r.title !== undefined) {
    if (typeof r.title !== "string") return { error: "title must be a string" };
    const t = r.title.trim();
    if (t.length === 0 || t.length > FACADE_TITLE_MAX) return { error: `title must keep 1..${FACADE_TITLE_MAX} characters` };
    body.title = t;
  }
  if (Object.keys(body).length === 0) return { error: "nothing to change — give a pose, projection, alignment or title field" };
  return { facadeId, body };
}

// ── the descriptor verdict (the models' posture: the SERVER copies a URL, never the client) ──

export type FacadeImageVerdict =
  | { ok: true; fileId: string; url: string }
  | { ok: false; code: "NOT_AN_IMAGE" | "PRIVATE_FILE" | "TOO_LARGE" | "NO_URL" | "INGEST_FAILED"; error: string };

/**
 * Judge a Media FileDescriptor (as the SDK returns it — `sizeInBytes` a DECIMAL STRING) for a facade
 * display / thumb: a PUBLIC, size-capped IMAGE whose static URL sits under `FACADE_URL_PREFIX`.
 * `NO_URL` is the one RETRYABLE verdict — image ingest is async on the platform (wix-headless §9), so
 * the endpoint answers it 409 `FILE_NOT_READY` rather than storing a URL the client dictated.
 */
export function verifyFacadeImageDescriptor(d: unknown): FacadeImageVerdict {
  const r = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
  const fileId = strOrNull(r._id) ?? strOrNull(r.id);
  if (r.mediaType !== "IMAGE" || !fileId) return { ok: false, code: "NOT_AN_IMAGE", error: "the file is not an image" };
  if (r.private === true) return { ok: false, code: "PRIVATE_FILE", error: "the file is private" };
  const sizeRaw = r.sizeInBytes;
  const sizeBytes = typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : typeof sizeRaw === "number" ? sizeRaw : null;
  if (sizeBytes !== null && sizeBytes > FACADE_IMAGE_MAX_BYTES)
    return { ok: false, code: "TOO_LARGE", error: `the file is ${sizeBytes} bytes; the limit is ${FACADE_IMAGE_MAX_BYTES}` };
  if (r.operationStatus === "FAILED") return { ok: false, code: "INGEST_FAILED", error: "the platform could not process the file" };
  const url = strOrNull(r.url);
  if (!url || !url.startsWith(FACADE_URL_PREFIX)) return { ok: false, code: "NO_URL", error: "the file has no static image URL yet" };
  return { ok: true, fileId, url };
}

/**
 * The mint gate for `/api/upload-url` kind `"facade"`: JPEG only (the derivatives are JPEG by
 * construction — `makeFacadeDerivatives`), a size inside the display cap, a sanitized `.jpg` name
 * (the platform infers the media type from the name too — a `.png` name on JPEG bytes would still
 * ingest, but the Media Manager would mislabel it). Returns the SANITIZED name the mint should use.
 */
export function checkFacadeUploadRequest(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
): { ok: true; fileName: string } | { ok: false; error: string } {
  if (mimeType !== FACADE_IMAGE_MIME) return { ok: false, error: `facade images are uploaded as ${FACADE_IMAGE_MIME} only` };
  if (!(Number.isFinite(sizeBytes) && sizeBytes >= 1 && sizeBytes <= FACADE_IMAGE_MAX_BYTES))
    return { ok: false, error: `a facade image must be 1..${FACADE_IMAGE_MAX_BYTES} bytes` };
  return { ok: true, fileName: safeFacadeFileName(fileName) };
}

/** Basename only, ANY short extension dropped (the stem is a label — the type is forced `.jpg`), a
 *  conservative character set, ≤ 200 chars (the SDK's max). */
export function safeFacadeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const stem = base
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return `${stem || "facade"}.jpg`;
}

// ── the record ───────────────────────────────────────────────────────────────────────────────

/** The provenance badge of a pose against its EXIF baseline (the D4 idiom, `paramSource`): EXIF when
 *  the six camera numbers match within `FACADE_POSE_EPS`, else MANUAL. SOLVED is stamped by a solver
 *  (T172), never derived here. The heights (`apexAltM` / `altitudeM`) are deliberately NOT compared —
 *  the apex is a rendering fact (terrain under the eye), not a camera parameter the owner edited. */
export function derivePoseSource(pose: FacadePose, exifPose: FacadePose | null): FacadePoseSource {
  if (!exifPose) return "MANUAL";
  const near = (a: number, b: number) => Math.abs(a - b) <= FACADE_POSE_EPS;
  return near(pose.lat, exifPose.lat) &&
    near(pose.lon, exifPose.lon) &&
    near(pose.headingDeg, exifPose.headingDeg) &&
    near(pose.pitchDeg, exifPose.pitchDeg) &&
    near(pose.rollDeg, exifPose.rollDeg) &&
    near(pose.hFovDeg, exifPose.hFovDeg)
    ? "EXIF"
    : "MANUAL";
}

/** The editable columns of a row as a flat object (the pose, the params, the seats, the title). */
export type FacadeEditable = FacadePose & FacadeProjectionParams & FacadeAlignment & { title: string };

/** The editable columns of a `FacadeEditable` as they are STORED (the two JSON-in-TEXT seats serialized). */
function editableColumns(e: FacadeEditable): Record<string, unknown> {
  return {
    title: e.title,
    lat: e.lat,
    lon: e.lon,
    apexAltM: e.apexAltM,
    altitudeM: e.altitudeM,
    headingDeg: e.headingDeg,
    pitchDeg: e.pitchDeg,
    rollDeg: e.rollDeg,
    focalLengthMm: e.focalLengthMm,
    hFovDeg: e.hFovDeg,
    fovEstimated: e.fovEstimated,
    textureWidth: e.textureWidth,
    textureHeight: e.textureHeight,
    strength: e.strength,
    ownLight: e.ownLight,
    rangeM: e.rangeM,
    geohash9: encodeGeohash(e.lat, e.lon, 9),
    // The residency cell (`hasSome` is equality-on-a-set — the UserModels `gh5` precedent).
    gh5: encodeGeohash(e.lat, e.lon, FACADE_COVER_PRECISION),
    targetFeatureIds: JSON.stringify(e.targetFeatureIds),
    alignment: JSON.stringify(e.alignment),
  };
}

/**
 * The FacadePhotos row (ADMIN-only collection; `/api/facades` is the only writer). The URLs come
 * from the descriptors the SERVER verified (`verifyFacadeImageDescriptor`) — a client never
 * dictates one; a thumb whose descriptor was refused is stored as NO thumb (id and URL both null —
 * the id is only ever meaningful beside a verified URL; markers fall back to the display).
 * C6: `isPublic` false and `moderation` "PRIVATE" are not body-driven. T190 (owner 2026-10-22g):
 * the world read IGNORES both — every row is public to every visitor; REMOVED is the only withheld
 * state (a moderation flag kept for a future gate, never consulted today).
 */
export function facadeRecord(
  body: SaveFacadeBody,
  ownerMemberId: string,
  urls: { displayUrl: string; thumbUrl: string | null },
): Record<string, unknown> {
  return {
    ...editableColumns(body),
    ownerMemberId,
    poseSource: derivePoseSource(body, body.exifPose),
    exifPose: body.exifPose ? JSON.stringify(body.exifPose) : null,
    capturedAt: body.capturedAt,
    cameraMake: body.cameraMake,
    cameraModel: body.cameraModel,
    lensModel: body.lensModel,
    fileName: body.fileName,
    fileSizeBytes: body.fileSizeBytes,
    originalFileId: body.originalFileId,
    displayFileId: body.displayFileId,
    displayUrl: urls.displayUrl,
    thumbFileId: urls.thumbUrl ? body.thumbFileId : null,
    thumbUrl: urls.thumbUrl,
    isPublic: false,
    moderation: "PRIVATE",
  };
}

/** The pose off a stored row — null when the four numbers a frustum cannot do without are missing. */
function rowPose(item: Record<string, unknown>): FacadePose | null {
  const lat = numOrNull(item.lat);
  const lon = numOrNull(item.lon);
  const apexAltM = numOrNull(item.apexAltM);
  const hFovDeg = numOrNull(item.hFovDeg);
  if (lat === null || lon === null || apexAltM === null || hFovDeg === null) return null;
  return {
    lat,
    lon,
    apexAltM,
    altitudeM: numOrNull(item.altitudeM),
    headingDeg: numOrNull(item.headingDeg) ?? 0,
    pitchDeg: numOrNull(item.pitchDeg) ?? 0,
    rollDeg: numOrNull(item.rollDeg) ?? 0,
    focalLengthMm: numOrNull(item.focalLengthMm),
    hFovDeg,
    fovEstimated: item.fovEstimated === true,
    textureWidth: numOrNull(item.textureWidth),
    textureHeight: numOrNull(item.textureHeight),
  };
}

/** The editable columns off a stored row (the JSON seats parsed leniently — a corrupt column reads empty). */
function rowEditable(item: Record<string, unknown>): FacadeEditable | null {
  const pose = rowPose(item);
  if (!pose) return null;
  return {
    ...pose,
    title: strOrNull(item.title) ?? "Untitled",
    strength: num(item.strength, 0, 1) ?? FACADE_STRENGTH_DEFAULT,
    ownLight: num(item.ownLight, 0, 1) ?? FACADE_OWN_LIGHT_DEFAULT,
    rangeM: num(item.rangeM, FACADE_RANGE_MIN_M, FACADE_RANGE_MAX_M),
    targetFeatureIds: jsonColumn(item.targetFeatureIds, (v) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : null)) ?? [],
    alignment: jsonColumn(item.alignment, (v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)) ?? {},
  };
}

/** The stored EXIF baseline (JSON-in-TEXT) re-validated through the pose rules; null when absent / corrupt. */
function storedExifPose(item: Record<string, unknown>): FacadePose | null {
  return jsonColumn(item.exifPose, (v) => {
    const p = parseFacadePose(v);
    return "pose" in p ? p.pose : null;
  });
}

/** Parse a JSON-in-TEXT column through a shape guard; null on a missing / corrupt / wrong-shaped value. */
function jsonColumn<T>(raw: unknown, shape: (v: unknown) => T | null): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return shape(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Merge an owner PATCH into the stored row (the pure core of PATCH /api/facades — read-modify-write,
 * `items.update` replaces the whole item so the untouched columns ride along). A POSE edit re-derives
 * both geohash columns and re-stamps `poseSource` against the stored EXIF baseline (back to exactly
 * the EXIF numbers reads EXIF again — the D4 `paramSource` idiom; anything else MANUAL); a patch
 * without a pose field keeps the stored badge (a SOLVED row stays SOLVED under a title edit). The
 * owner, the file ids, the URLs, the EXIF pose and the moderation state are never written here.
 */
export function applyFacadeUpdate(
  existing: Record<string, unknown>,
  patch: FacadeUpdatePatch,
): { record: Record<string, unknown>; effective: FacadeEditable } {
  const stored = rowEditable(existing) ?? {
    // A row too broken to read as a pose (should not exist — the parser guarantees the columns) still
    // takes the patch; the missing numbers fall to zero rather than refusing the edit.
    lat: 0, lon: 0, apexAltM: 0, altitudeM: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0, focalLengthMm: null,
    hFovDeg: 60, fovEstimated: false, textureWidth: null, textureHeight: null, title: "Untitled",
    strength: FACADE_STRENGTH_DEFAULT, ownLight: FACADE_OWN_LIGHT_DEFAULT, rangeM: null, targetFeatureIds: [], alignment: {},
  };
  const effective: FacadeEditable = { ...stored };
  for (const key of Object.keys(patch) as (keyof FacadeUpdatePatch)[]) {
    const v = patch[key];
    if (v !== undefined) (effective as unknown as Record<string, unknown>)[key] = v;
  }
  const poseEdited = POSE_EDIT_KEYS.some((k) => patch[k] !== undefined);
  const storedSource = strOrNull(existing.poseSource);
  const poseSource: FacadePoseSource = poseEdited
    ? derivePoseSource(effective, storedExifPose(existing))
    : POSE_SOURCES.includes(storedSource as FacadePoseSource)
      ? (storedSource as FacadePoseSource)
      : "MANUAL";
  const record: Record<string, unknown> = {
    ...existing,
    ...editableColumns(effective),
    poseSource,
    _id: existing._id,
  };
  return { record, effective };
}

// ── the row mappers ──────────────────────────────────────────────────────────────────────────

const isoOf = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" && v.length > 0 ? v : null;

/** The world row off a stored item — null for anything a frustum cannot be built from (no pose, no
 *  display URL, no id). One shape for "mine" and "world" (the PUBLIC world row since T190; C6-clean
 *  by construction: no owner id, no file id, no original). */
export function facadeWorldItem(item: Record<string, unknown>): FacadeWorldItem | null {
  if (typeof item._id !== "string") return null;
  const displayUrl = strOrNull(item.displayUrl);
  const e = rowEditable(item);
  if (!displayUrl || !e) return null;
  const { targetFeatureIds: _t, alignment: _a, ...rest } = e;
  return {
    id: item._id,
    ...rest,
    displayUrl,
    thumbUrl: strOrNull(item.thumbUrl),
    // The LWW / read-lag merge key — `_updatedDate`, else the creation date (a row the platform
    // answered without one), else the epoch so the field is always a parseable ISO string.
    updatedAt: isoOf(item._updatedDate) ?? isoOf(item._createdDate) ?? new Date(0).toISOString(),
  };
}

/** The owner's own list row: the world shape + the seats + the editor's facts (MY FACADES). */
export function facadeListItem(item: Record<string, unknown>): FacadeListItem | null {
  const world = facadeWorldItem(item);
  const e = rowEditable(item);
  if (!world || !e) return null;
  const source = strOrNull(item.poseSource);
  return {
    ...world,
    targetFeatureIds: e.targetFeatureIds,
    alignment: e.alignment,
    capturedAt: strOrNull(item.capturedAt),
    cameraMake: strOrNull(item.cameraMake),
    cameraModel: strOrNull(item.cameraModel),
    lensModel: strOrNull(item.lensModel),
    fileName: strOrNull(item.fileName),
    fileSizeBytes: numOrNull(item.fileSizeBytes),
    poseSource: POSE_SOURCES.includes(source as FacadePoseSource) ? (source as FacadePoseSource) : "MANUAL",
    exifPose: storedExifPose(item),
    createdAt: isoOf(item._createdDate) ?? world.updatedAt,
    isPublic: item.isPublic === true,
    moderation: strOrNull(item.moderation) ?? "PRIVATE",
  };
}

/** `?skip=` of the owner list → a 0-based offset, or the offending input. */
export function parseSkip(param: string | null): { skip: number } | { error: string } {
  if (param === null || param === "") return { skip: 0 };
  if (!/^\d{1,7}$/.test(param)) return { error: "skip must be a non-negative integer" };
  return { skip: Number(param) };
}
