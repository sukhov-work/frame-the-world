#!/usr/bin/env node
/**
 * Back-fill `authorName` on existing PublicPins rows (Phase 5.5 S3).
 *
 * For every PublicPins row without an authorName: resolve its Photos row via `photoRef`
 * (NEVER positionally — the pose back-fill's dataItems[0] bug is on record in
 * mem:patterns/members-pins), read ownerMemberId, fetch the member, and write the same
 * nickname → email-user-part → "Member" label the endpoint denormalizes at save time
 * (authorLabel in src/lib/wix/pinRecords.ts). Idempotent: rows with an authorName are skipped.
 *
 * Run: node scripts/backfill-author-names.mjs
 * Auth: CLI session (`npx wix whoami`); mints one site-scoped token (same as provisioning).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { siteId } = JSON.parse(readFileSync(join(root, "wix.config.json"), "utf-8"));

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

/** nickname → login-email user part → "Member" (twin of authorLabel in pinRecords.ts). */
const label = (member) =>
  member?.profile?.nickname ||
  (member?.loginEmail ? member.loginEmail.split("@")[0] : null) ||
  "Member";

// 1) All PublicPins rows (the collection is tiny at this phase — one page is plenty).
const pins = await api("/wix-data/v2/items/query", {
  method: "POST",
  body: JSON.stringify({
    dataCollectionId: "PublicPins",
    query: { paging: { limit: 1000 } },
  }),
});
if (pins.status !== 200) {
  console.error("PublicPins query failed:", pins.status, JSON.stringify(pins.body).slice(0, 300));
  process.exit(1);
}

const rows = pins.body.dataItems ?? [];
const memberCache = new Map(); // ownerMemberId → label

let filled = 0;
let skipped = 0;
for (const row of rows) {
  const data = row.data ?? {};
  if (typeof data.authorName === "string" && data.authorName.length > 0) {
    skipped++;
    continue;
  }
  const photoRef = data.photoRef;
  if (typeof photoRef !== "string" || photoRef.length === 0) {
    console.warn(`? pin ${row.id} has no photoRef — skipped`);
    continue;
  }

  // 2) The Photos row this pin derives from — keyed on photoRef, never positionally.
  const photos = await api("/wix-data/v2/items/query", {
    method: "POST",
    body: JSON.stringify({
      dataCollectionId: "Photos",
      query: { filter: { _id: photoRef }, paging: { limit: 1 } },
    }),
  });
  const owner = photos.body.dataItems?.[0]?.data?.ownerMemberId;
  if (typeof owner !== "string" || owner.length === 0) {
    console.warn(`? pin ${row.id} → photo ${photoRef} has no ownerMemberId — skipped`);
    continue;
  }

  // 3) The owner's display label (cached per member).
  if (!memberCache.has(owner)) {
    const member = await api(`/members/v1/members/${owner}?fieldsets=FULL`);
    memberCache.set(owner, member.status === 200 ? label(member.body.member) : "Member");
  }
  const authorName = memberCache.get(owner);

  // 4) Write the row back (full data + the new field), keyed on ITS OWN id.
  const put = await api(`/wix-data/v2/items/${row.id}`, {
    method: "PUT",
    body: JSON.stringify({
      dataCollectionId: "PublicPins",
      dataItem: { data: { ...data, authorName } },
    }),
  });
  if (put.status === 200) {
    console.log(`+ pin ${row.id} ← authorName "${authorName}"`);
    filled++;
  } else {
    console.error(`! pin ${row.id} update failed:`, put.status, JSON.stringify(put.body).slice(0, 300));
    process.exitCode = 1;
  }
}

console.log(`done: ${filled} filled, ${skipped} already had authorName, ${rows.length} total`);
