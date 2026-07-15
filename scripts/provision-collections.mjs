#!/usr/bin/env node
/**
 * Provision the Phase-5 Wix Data collections (Photos, PublicPins) on the live site.
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
 * through the elevated /api/photos endpoint, which enforces the 10-pin free quota.
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
    ],
    permissions: { insert: "ADMIN", update: "ADMIN", remove: "ADMIN", read: "ANYONE" },
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

const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
  encoding: "utf-8",
}).trim().split("\n").pop();

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
