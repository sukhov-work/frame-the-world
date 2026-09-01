#!/usr/bin/env node
// Delete every object under a key PREFIX in the R2 bucket — the retirement twin of upload-r2.mjs
// (same pure-Node SigV4, same env names; no SDK/wrangler). Written 2026-09-02 to remove the
// Chernobyl region's objects on the owner's confirmation (`enriched/chernobyl/`,
// `enriched/chernobyl-o2w/`, `terrain/chernobyl/`).
//
//   node --env-file=.env.local scripts/bake/delete-r2.mjs --prefix enriched/<city>/ [--dry-run]
//   node --env-file=.env.local scripts/bake/delete-r2.mjs --prefix enriched/<city>/ --yes
//
// Safety rails: the prefix MUST end in "/" (so `enriched/chernobyl` cannot also take
// `enriched/chernobyl-o2w`), must have at least two segments, and nothing is deleted without
// `--yes`. Every run lists FIRST (ListObjectsV2, paginated) and prints the count + bytes; a real
// run deletes one object per DELETE request (6 in flight) and lists AGAIN to prove zero remain.
import { encodeS3Path, sha256Hex, sigV4Headers } from "./lib/s3sign.mjs";

const args = process.argv.slice(2);
const prefix = args.includes("--prefix") ? args[args.indexOf("--prefix") + 1] : null;
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run") || !yes;
if (!prefix || !prefix.endsWith("/") || prefix.split("/").filter(Boolean).length < 2) {
  console.error("usage: node scripts/bake/delete-r2.mjs --prefix <a>/<b>/ [--dry-run | --yes]  (prefix must end in '/')");
  process.exit(1);
}
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESSKEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESSKEY;
const R2_BUCKET = process.env.R2_BUCKET ?? process.env.CLOUDFLARE_R2_BUCKET;
if (!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET)) {
  console.error("missing env: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET (or the CLOUDFLARE_* names)");
  process.exit(1);
}
const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const EMPTY = sha256Hex("");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** One ListObjectsV2 page. Returns { keys: [{key, size}], next: token | null }. */
async function listPage(token) {
  const params = { "list-type": "2", "max-keys": "1000", prefix };
  if (token) params["continuation-token"] = token;
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join("&");
  const path = `/${R2_BUCKET}`;
  const headers = sigV4Headers({
    method: "GET",
    host,
    path,
    query,
    payloadHash: EMPTY,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
  const res = await fetch(`https://${host}${encodeS3Path(path)}?${query}`, { headers });
  const xml = await res.text();
  if (!res.ok) throw new Error(`LIST ${prefix} → ${res.status} ${xml.slice(0, 300)}`);
  const keys = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
    if (key) keys.push({ key: key.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'), size });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
  return { keys, next: next ? next.replace(/&amp;/g, "&") : null };
}
async function listAll() {
  const out = [];
  let token = null;
  do {
    const page = await listPage(token);
    out.push(...page.keys);
    token = page.next;
  } while (token);
  return out;
}
async function deleteKey(key) {
  const path = `/${R2_BUCKET}/${key}`;
  const headers = sigV4Headers({
    method: "DELETE",
    host,
    path,
    payloadHash: EMPTY,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
  const res = await fetch(`https://${host}${encodeS3Path(path)}`, { method: "DELETE", headers });
  if (!res.ok && res.status !== 204) throw new Error(`DELETE ${key} → ${res.status} ${await res.text()}`);
  return res.status;
}

console.log(`▶ delete-r2 --prefix ${prefix}${dryRun ? " (dry-run — nothing deleted)" : " --yes"}`);
const before = await listAll();
const bytes = before.reduce((a, k) => a + k.size, 0);
console.log(`  ${before.length} objects · ${(bytes / 1024 / 1024).toFixed(2)} MB under s3://${R2_BUCKET}/${prefix}`);
if (before.length > 0) {
  console.log(`  first: ${before[0].key}`);
  console.log(`  last:  ${before[before.length - 1].key}`);
}
// Zero-result validation: every key must start with the prefix, or the list answered a different question.
for (const k of before) if (!k.key.startsWith(prefix)) throw new Error(`listed key outside the prefix: ${k.key}`);
if (dryRun || before.length === 0) {
  console.log(dryRun ? "  dry-run: re-run with --yes to delete" : "  nothing to delete");
  process.exit(0);
}
let done = 0;
const queue = [...before];
const workers = Array.from({ length: 6 }, async () => {
  for (let k = queue.shift(); k; k = queue.shift()) {
    await deleteKey(k.key);
    done++;
    if (done % 100 === 0 || done === before.length) console.log(`  deleted ${done}/${before.length}`);
  }
});
await Promise.all(workers);
const after = await listAll();
console.log(`✓ ${done} deleted · ${after.length} remain under ${prefix}`);
process.exit(after.length === 0 ? 0 : 2);
