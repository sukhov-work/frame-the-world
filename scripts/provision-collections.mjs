#!/usr/bin/env node
/**
 * Provision the Wix Data collections (Photos, PublicPins, BuildingOverrides, UserModels, FacadePhotos,
 * SavedPlaces) on the live site.
 *
 * Idempotent: existing collections are left untouched (re-run safe). This script is the
 * source of truth for the collection schemas — the CLI `extensions.dataCollections` builder
 * was tried first and does NOT provision from `wix dev` (verified 2026-07-10), so schemas
 * live here and are pushed over REST per the official wix-manage recipe
 * (node_modules/@wix/agent-skills/skills/wix-manage/references/cms/cms-schema-management.md).
 *
 * Run: node scripts/provision-collections.mjs
 * Auth: CLI session (`npx wix whoami`); mints one site-scoped token.
 *
 * NOTE (C6): PublicPins is world-readable and holds ONLY reduced-precision location fields —
 * see src/lib/geo/precision.ts. Photos keeps exact GPS and is ADMIN-only: every write goes
 * through the elevated /api/photos endpoint, which enforces the pin quota (free 100 · premium 1000,
 * owner ruling 2026-07-17).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { siteId } = JSON.parse(readFileSync(join(root, "wix.config.json"), "utf-8"));

const text = (key, displayName, required = false) => ({ key, displayName, type: "TEXT", ...(required ? { required: true } : {}) });
const num = (key, displayName) => ({ key, displayName, type: "NUMBER" });
const bool = (key, displayName) => ({ key, displayName, type: "BOOLEAN" });

const COLLECTIONS = [
  {
    id: "Photos",
    displayName: "Photos",
    fields: [
      text("title", "Title"),
      text("ownerMemberId", "Owner Member Id", true),
      num("lat", "Latitude"),
      num("lon", "Longitude"),
      num("altitudeM", "Altitude (m)"),
      num("headingDeg", "Heading (deg)"),
      num("pitchDeg", "Pitch (deg)"),
      num("rollDeg", "Roll (deg)"),
      num("focalLengthMm", "Focal Length (mm)"),
      num("hFovDeg", "Horizontal FOV (deg)"),
      bool("fovEstimated", "FOV Estimated"),
      text("geohash9", "Geohash (p9)"),
      // TZ-naive EXIF local ISO string, on purpose (see mem:patterns/upload-flow)
      text("capturedAt", "Captured At (EXIF local)"),
      text("cameraMake", "Camera Make"),
      text("cameraModel", "Camera Model"),
      text("lensModel", "Lens Model"),
      num("textureWidth", "Texture Width"),
      num("textureHeight", "Texture Height"),
      text("fileName", "File Name"),
      num("fileSizeBytes", "File Size (bytes)"),
      text("originalFileId", "Original File Id"),
      text("previewFileId", "Preview File Id"),
      text("previewUrl", "Preview URL"),
      bool("isPublic", "Is Public"),
      text("publicPrecision", "Public Precision"),
      text("publicPinId", "Public Pin Id"),
      // Marketplace-light (Phase 6): set when the owner lists this photo as a Stores Catalog V3
      // digital product (digitalFile = the retained originalFileId). Managed ONLY by /api/listings.
      text("productId", "Stores Product Id"),
      text("productVariantId", "Stores Variant Id"),
      num("priceAmount", "Price Amount"),
      text("currency", "Currency"),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ADMIN" },
  },
  {
    id: "PublicPins",
    displayName: "Public Pins",
    fields: [
      text("title", "Title"),
      text("photoRef", "Photo Ref"),
      // denormalized member display label (Phase 5.5 S3) — identity, not location (C6-ok)
      text("authorName", "Author Name"),
      num("latReduced", "Latitude (reduced)"),
      num("lonReduced", "Longitude (reduced)"),
      text("geohash", "Geohash (tier cell)"),
      text("gh4", "Geohash Prefix p4"),
      text("gh6", "Geohash Prefix p6"),
      text("precision", "Precision Tier"),
      text("previewUrl", "Preview URL"),
      text("capturedAt", "Captured At (EXIF local)"),
      // camera POSE (orientation/optics — NOT location; C6 governs coordinates only):
      // powers "click a pin → full camera view" for everyone (added 2026-07-10)
      num("altitudeM", "Altitude (m)"),
      num("headingDeg", "Heading (deg)"),
      num("pitchDeg", "Pitch (deg)"),
      num("rollDeg", "Roll (deg)"),
      num("focalLengthMm", "Focal Length (mm)"),
      num("hFovDeg", "Horizontal FOV (deg)"),
      num("textureWidth", "Texture Width"),
      num("textureHeight", "Texture Height"),
      text("cameraMake", "Camera Make"),
      text("cameraModel", "Camera Model"),
      text("lensModel", "Lens Model"),
      // Marketplace-light (Phase 6): denormalized listing so buyers see "for sale" + price on the
      // shared globe. World-readable, but productId/price are NOT location data (C6-ok). variantId
      // is required to build the checkout catalogReference (productId-only → empty checkout).
      text("productId", "Stores Product Id"),
      text("productVariantId", "Stores Variant Id"),
      num("priceAmount", "Price Amount"),
      text("currency", "Currency"),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ANYONE" },
  },
  {
    // U8 building height overrides (owner 2026-08-19, backend prep for the batch-sync phase):
    // ONE world-shared row per overridden building, `_id` = deterministic hash of
    // `variant|cell|featureId` (LWW via items.bulkSave). ADMIN everything — all access through
    // the elevated /api/building-overrides (public GET strips memberId; POST requires login).
    // C6: cx/cz are BAKE-LOCAL checksum metres, not geographic coordinates; no member GPS.
    id: "BuildingOverrides",
    displayName: "Building Overrides",
    fields: [
      text("variant", "Bake Variant", true),
      text("cell", "Cell URI", true),
      num("featureId", "Baked Feature Id"),
      // MESH SUITE MS3 (2026-09-02): the OSM element id IS the `_id` key when present (the
      // re-bake-stable identity; the fingerprint below stays as locator + checksum).
      text("osmId", "OSM Element Id"),
      num("heightScale", "Height Scale (vs baked)"),
      // MS3: the v2 row's spatial components (lib/globe/featureTransform.ts) — null = identity.
      num("sx", "Scale X (east)"),
      num("sz", "Scale Z (north)"),
      num("rotDeg", "Yaw (deg, three sense)"),
      num("tE", "Offset East (m)"),
      num("tN", "Offset North (m)"),
      num("tU", "Lift (m)"),
      num("cx", "Centroid X (bake-local m)"),
      num("cz", "Centroid Z (bake-local m)"),
      num("vc", "Run Vertex Count"),
      num("bakedHeightM", "Baked Height (m)"),
      text("region", "Region Id"),
      text("memberId", "Last Editor Member Id", true),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ADMIN" },
  },
  {
    // MESH SUITE MS4 (2026-09-02, D3 — user-uploaded models): ONE row per uploaded model = the
    // source of truth for an object whose BYTES live in Wix Media (MODEL3D, PUBLIC — the platform
    // refuses private 3D files, MS0 probe 2026-09-02). ADMIN everything — the photos posture: all
    // access through the elevated /api/models (owner-filtered GET/POST/DELETE; the MS5 world read
    // strips ownerMemberId). `url`/`thumbnailUrl` are copied SERVER-side from the verified MODEL3D
    // descriptor, never from the client. Placement (lat/lon/geohash9) and the transform seats
    // (rotDeg/scale) are the MS5/MS6 fields, provisioned now so the record is born complete.
    // C6: lat/lon here is the member's CHOSEN placement of a world-visible object, not a capture
    // GPS — nothing about the member's own location is stored.
    id: "UserModels",
    displayName: "User Models",
    fields: [
      text("title", "Title"),
      text("ownerMemberId", "Owner Member Id", true),
      text("fileId", "Media File Id", true),
      text("url", "Static GLB URL"),
      // Our OWN rendered card thumbnail (a public IMAGE beside the GLB) — the platform's MODEL3D
      // "thumbnail" URL answers 403 forever (measured 2026-09-02h), so it is never stored.
      text("thumbnailFileId", "Thumbnail File Id"),
      text("thumbnailUrl", "Thumbnail URL"),
      text("fileName", "Source File Name"),
      text("sourceFormat", "Source Format"),
      num("rawBytes", "Source Size (bytes)"),
      num("glbBytes", "GLB Size (bytes)"),
      num("tris", "Triangles"),
      num("meshes", "Meshes"),
      num("textures", "Textures"),
      num("decimatedFromTris", "Decimated From (triangles)"),
      num("bboxX", "Bounds X (m)"),
      num("bboxY", "Bounds Y (m)"),
      num("bboxZ", "Bounds Z (m)"),
      text("readiness", "Readiness"),
      bool("hidden", "Hidden"),
      num("lat", "Placement Latitude"),
      num("lon", "Placement Longitude"),
      text("geohash9", "Placement Geohash (p9)"),
      // MESH SUITE MS5 (2026-09-02): the world-read cell — `hasSome` on this column is the
      // pins' gh4/gh6 precedent (equality on a set; a p9 hash cannot be prefix-queried).
      text("gh5", "Placement Geohash (p5)"),
      num("rotDeg", "Yaw (deg)"),
      // T128 (owner 2026-09-08b): the scale is PER AXIS now. `scale` (born MS5 as the uniform
      // factor) is the Y / HEIGHT factor — the BuildingOverrides `heightScale` precedent — and
      // `scaleX` / `scaleZ` are the two new columns (its `sx` / `sz`); a null axis reads as
      // `scale`, so every row written before T128 is the same uniform box it always was. The
      // display name stays so the Wix Data column keeps its identity.
      num("scale", "Uniform Scale"),
      num("scaleX", "Scale X (east)"),
      num("scaleZ", "Scale Z (north)"),
      // MESH SUITE MS7 (2026-09-03): the lift above the terrain seat — the BuildingOverrides name.
      num("tU", "Lift (m)"),
      // MESH SUITE MS8 (2026-09-05): the VERTICAL rotation — pitch about the model's own +X, roll
      // about its own +Z (degrees; with `rotDeg` the intrinsic YXZ triple, `lib/models/
      // modelPlacement.ts`). Models only: BuildingOverrides stays yaw-only (§4a).
      num("pitchDeg", "Pitch (deg, about X)"),
      num("rollDeg", "Roll (deg, about Z)"),
      // MESH SUITE MS6 (2026-09-02m): the LAST EDITOR of the transform — any signed-in member may
      // move / turn / resize any model (LWW), so the owner's list can say "edited by another
      // member". Stamped server-side from the session (the BuildingOverrides `memberId`
      // precedent); NEVER emitted by the public world read (C6); the owner at POST.
      text("editorMemberId", "Last Editor Member Id"),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ADMIN" },
  },
  {
    // PHOTO PROJECTION F2 persist (T169 / T172, 2026-10-21): ONE row per facade photo = the POSE
    // (where the camera stood, how it looked, the EFFECTIVE H-FOV), the projection params, the Media
    // ids of the three files (the private original · the public 2048-px display JPEG · the public
    // 512-px thumb) and the alignment seats (`targetFeatureIds` / `alignment`, empty in v1). THE
    // RECORD IS THE POSE, NEVER A BAKED ATLAS (plan §4; C1): the projection happens at runtime from
    // these numbers. JSON-IN-TEXT: `exifPose`, `targetFeatureIds` and `alignment` are serialized
    // JSON in TEXT columns — this provisioner speaks TEXT / NUMBER / BOOLEAN only, and the parser
    // (`src/lib/wix/facadeRecords.ts`) is their size rail (≤ 8 KB / ≤ 16 KB). ADMIN everything — all
    // access through the elevated /api/facades (the owner's list + the PUBLIC world read on
    // `gh5` — T190, the UserModels `hasSome` precedent; POST / PATCH / DELETE owner-gated). `displayUrl` /
    // `thumbUrl` are copied SERVER-side off the verified IMAGE descriptors (the UserModels posture).
    // C6: a projected facade photo is EXACT by nature — the pose IS the content, so reduced precision
    // cannot apply. `isPublic` / `moderation` are stamped server-side (never body-driven) and NOT
    // consulted by the world read since T190 (owner 2026-10-22g): every visitor sees every row;
    // REMOVED (set by hand) is the one withheld state.
    // `apexAltM` is the rendered apex height above the ellipsoid at save (a resident facade rebuilds
    // its frustum from it with no terrain lookup); `altitudeM` keeps the editor's slider / EXIF value.
    id: "FacadePhotos",
    displayName: "Facade Photos",
    fields: [
      text("title", "Title"),
      text("ownerMemberId", "Owner Member Id", true),
      num("lat", "Latitude"),
      num("lon", "Longitude"),
      num("apexAltM", "Apex Height (m, ellipsoid)"),
      num("altitudeM", "Altitude (m, editor)"),
      num("headingDeg", "Heading (deg)"),
      num("pitchDeg", "Pitch (deg)"),
      num("rollDeg", "Roll (deg)"),
      num("focalLengthMm", "Focal Length (mm)"),
      num("hFovDeg", "Horizontal FOV (deg, effective)"),
      bool("fovEstimated", "FOV Estimated"),
      // The provenance badge (the D4 idiom): EXIF | MANUAL | SOLVED (T172's solver stamps the last).
      text("poseSource", "Pose Source"),
      text("exifPose", "EXIF Pose (JSON)"),
      num("strength", "Projection Strength"),
      num("ownLight", "Projection Own Light"),
      num("rangeM", "Projection Range (m)"),
      text("geohash9", "Geohash (p9)"),
      // The residency cell — `hasSome` on this column (equality-on-a-set; a p9 hash cannot be
      // prefix-queried), re-derived beside `geohash9` on every pose write.
      text("gh5", "Geohash (p5)"),
      // TZ-naive EXIF local ISO string, on purpose (see mem:patterns/upload-flow)
      text("capturedAt", "Captured At (EXIF local)"),
      text("cameraMake", "Camera Make"),
      text("cameraModel", "Camera Model"),
      text("lensModel", "Lens Model"),
      num("textureWidth", "Texture Width"),
      num("textureHeight", "Texture Height"),
      text("fileName", "File Name"),
      num("fileSizeBytes", "File Size (bytes)"),
      text("originalFileId", "Original File Id"),
      text("displayFileId", "Display File Id"),
      text("displayUrl", "Display URL"),
      text("thumbFileId", "Thumb File Id"),
      text("thumbUrl", "Thumb URL"),
      text("targetFeatureIds", "Target Feature Ids (JSON)"),
      text("alignment", "Alignment (JSON)"),
      bool("isPublic", "Is Public"),
      text("moderation", "Moderation"),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ADMIN" },
  },
  {
    // Saved first-person viewpoints (owner 2026-07-15): photo-less FPV bookmarks — exactly the
    // `#f=` share-hash pose + an optional pinned scene time. Member-private (ADMIN everything;
    // all access through the elevated /api/places, owner-filtered) — never published (C6).
    id: "SavedPlaces",
    displayName: "Saved Places",
    fields: [
      text("title", "Title"),
      text("ownerMemberId", "Owner Member Id", true),
      num("lat", "Latitude"),
      num("lon", "Longitude"),
      num("eyeM", "Eye Height Above Ground (m)"),
      num("headingDeg", "Heading (deg)"),
      num("pitchDeg", "Pitch (deg)"),
      num("fovDeg", "Vertical FOV (deg)"),
      num("timeMs", "Pinned Scene Time (UTC ms)"),
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ADMIN" },
  },
];

// The site token: `WIX_SITE_TOKEN` when the caller already minted one (mint ONCE, cache — the
// wix-headless convention), else the PROJECT's own CLI (`node_modules/.bin/wix`, the version
// package.json pins). Not `npx @wix/cli@latest`: 2026-10-22 the latest CLI began refusing every
// Node below 24.18 while the machine's newest is 24.10, and the pinned CLI still answers.
const token =
  process.env.WIX_SITE_TOKEN?.trim() ||
  // The CLI prints an "update available" box (box-drawing glyphs) on stdout, glued to the END of
  // the token line without a newline — the token is the leading run of token characters of the
  // first line that has one (`OauthNG.JWS.…`), never a whole line and never the last line.
  execFileSync(join(root, "node_modules", ".bin", "wix"), ["token", "--site", siteId], {
    encoding: "utf-8",
  })
    .split("\n")
    .map((l) => l.trim().match(/^[A-Za-z0-9._~+/=-]{20,}/)?.[0])
    .filter((t) => typeof t === "string")
    .shift();
if (!token) {
  console.error("no site token: `wix token --site` printed nothing token-shaped (is the CLI signed in? `wix whoami`)");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "wix-site-id": siteId,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`https://www.wixapis.com${path}`, { headers, ...init });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const existing = await api("/wix-data/v2/collections?fields=displayName");
if (existing.status !== 200) {
  console.error("list collections failed:", existing.status, JSON.stringify(existing.body));
  process.exit(1);
}
const have = new Set((existing.body.collections ?? []).map((c) => c.id));

for (const collection of COLLECTIONS) {
  if (have.has(collection.id)) {
    // Incremental schema evolution: diff this script's fields against the live schema and
    // create any that are missing (create-field per the same wix-manage recipe). Never
    // deletes or retypes — destructive changes stay manual.
    const live = await api(`/wix-data/v2/collections/${collection.id}`);
    if (live.status !== 200) {
      console.error(`! ${collection.id} schema fetch failed:`, live.status);
      process.exitCode = 1;
      continue;
    }
    const liveKeys = new Set((live.body.collection?.fields ?? []).map((f) => f.key));
    const missing = collection.fields.filter((f) => !liveKeys.has(f.key));
    if (missing.length === 0) {
      console.log(`= ${collection.id} up to date — skipped`);
      continue;
    }
    for (const field of missing) {
      const { status, body } = await api("/wix-data/v2/collections/create-field", {
        method: "POST",
        body: JSON.stringify({ dataCollectionId: collection.id, field }),
      });
      if (status === 200) {
        console.log(`+ ${collection.id}.${field.key} field added`);
      } else {
        console.error(
          `! ${collection.id}.${field.key} add failed:`,
          status,
          JSON.stringify(body).slice(0, 300),
        );
        process.exitCode = 1;
      }
    }
    continue;
  }
  const { status, body } = await api("/wix-data/v2/collections", {
    method: "POST",
    body: JSON.stringify({ collection }),
  });
  if (status === 200) {
    console.log(`+ ${collection.id} created (${collection.fields.length} fields)`);
  } else {
    console.error(`! ${collection.id} create failed:`, status, JSON.stringify(body).slice(0, 500));
    process.exitCode = 1;
  }
}
