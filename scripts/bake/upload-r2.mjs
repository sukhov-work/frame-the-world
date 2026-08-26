#!/usr/bin/env node
// Upload a baked city tileset (public/enriched/<city>/) to Cloudflare R2 — pure Node SigV4 PUTs
// against the S3-compatible endpoint (no SDK/wrangler; public npm is blocked here). Slice 2 of
// `.claude/claude-docs/dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md`.
//
//   node scripts/bake/upload-r2.mjs --city dnipro [--dry-run]
//   node scripts/bake/upload-r2.mjs --city dnipro --terrain [--dry-run]   # terrain patch mode:
//     uploads cfg.terrain.output (recursive z/x/y tree, .terrain+.json) → terrain/<city>/
//
// Required env (NEVER printed). The R2_* names take precedence; the owner's Cloudflare-native
// CLOUDFLARE_* names (as written in .env.local) are accepted as a fallback so that
// `node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro` just works:
//   R2_ACCOUNT_ID        | CLOUDFLARE_ACCOUNT_ID       account id (hex in the R2 endpoint URL)
//   R2_ACCESS_KEY_ID     | CLOUDFLARE_ACCESSKEY_ID     R2 API token key id  (Object Read & Write)
//   R2_SECRET_ACCESS_KEY | CLOUDFLARE_SECRET_ACCESSKEY R2 API token secret
//   R2_BUCKET            | CLOUDFLARE_R2_BUCKET        bucket name (e.g. frame-the-world-bucket)
// Optional:
//   R2_PREFIX              key prefix (default enriched/<city>) — the same prefix the Worker serves
//
// SERVING (the part the upload can't do — one-time per bucket, in the Cloudflare dash):
//   r2.dev serves NO CORS headers → connect a CUSTOM DOMAIN to the bucket, then add the CORS policy
//   from dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md §Recipe (GET/HEAD, range/if-match headers, expose content-range/
//   accept-ranges/etag). Then point PUBLIC_ENRICHED_TILES_URL at
//   https://<custom-domain>/<prefix>/tileset.json and restart wix dev / release.
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeFor, encodeS3Path, sha256Hex, sigV4Headers } from "./lib/s3sign.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const city = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
const dryRun = args.includes("--dry-run");
const terrainMode = args.includes("--terrain");
if (!city) {
  console.error("usage: node scripts/bake/upload-r2.mjs --city <name> [--terrain] [--dry-run]");
  process.exit(1);
}

const cfg = JSON.parse(await readFile(join(here, "cities", `${city}.json`), "utf8"));
const outDir = terrainMode
  ? resolve(here, "../..", cfg.terrain.output)
  : resolve(here, "../..", cfg.output ?? `public/enriched/${city}`);
// Terrain patches are a z/x/y tree of .terrain tiles under layer.json; building tilesets are flat.
async function walkFiles(dir, exts) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkFiles(p, exts)));
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(relative(outDir, p));
  }
  return out.sort();
}
const files = await walkFiles(outDir, terrainMode ? [".json", ".terrain"] : [".json", ".glb"]);
const rootFile = terrainMode ? "layer.json" : "tileset.json";
if (!files.includes(rootFile)) {
  console.error(
    `no ${rootFile} in ${outDir} — run \`${terrainMode ? `node --env-file=.env.local scripts/bake/terrain/bake-terrain.mjs --city ${city}` : `npm run bake -- --city ${city}`}\` first`,
  );
  process.exit(1);
}
// A terrain tree's layer.json is written by mago BEFORE the rim blend, the deep-level prune, the
// availability post and the probe verify. So `layer.json` present proves only that the mesher
// ran — it does NOT prove the bake finished. patch-info.json is the LAST thing bake-terrain.mjs
// writes, which makes it the only honest completion marker. Without this gate an interrupted
// bake uploads an unblended, unpruned, unverified pyramid that looks entirely normal (hit for
// real 2026-08-26: the Chernobyl blend died on ENFILE and left exactly this tree on disk).
if (terrainMode && !files.includes("patch-info.json")) {
  console.error(
    `${outDir} has layer.json but no patch-info.json — that bake did NOT complete (the blend/prune/probe steps never ran).\n` +
      `Re-run it: npm run bake:terrain -- --city ${city}`,
  );
  process.exit(1);
}

// R2_* wins; CLOUDFLARE_* (the owner's .env.local names) is the fallback.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESSKEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESSKEY;
const R2_BUCKET = process.env.R2_BUCKET ?? process.env.CLOUDFLARE_R2_BUCKET;
const prefix = process.env.R2_PREFIX ?? (terrainMode ? `terrain/${city}` : `enriched/${city}`);
if (!dryRun && !(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET)) {
  console.error(
    "missing env: set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET\n" +
      "         (or CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_ACCESSKEY_ID / CLOUDFLARE_SECRET_ACCESSKEY / CLOUDFLARE_R2_BUCKET)",
  );
  process.exit(1);
}
const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

async function putFile(name) {
  const body = await readFile(join(outDir, name));
  const key = `${prefix}/${name}`;
  if (dryRun) return { name, key, bytes: body.length, status: "dry-run" };
  const path = `/${R2_BUCKET}/${key}`;
  const payloadHash = sha256Hex(body);
  const headers = sigV4Headers({
    method: "PUT",
    host,
    path,
    payloadHash,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
  const res = await fetch(`https://${host}${encodeS3Path(path)}`, {
    method: "PUT",
    headers: { ...headers, "content-type": contentTypeFor(name) },
    body,
  });
  if (!res.ok) throw new Error(`PUT ${key} → ${res.status} ${await res.text()}`);
  return { name, key, bytes: body.length, status: res.status };
}

console.log(`▶ upload-r2 --city ${city}${dryRun ? " (dry-run)" : ""}`);
console.log(`  ${files.length} files from ${outDir} → ${dryRun ? "(nowhere)" : `s3://${R2_BUCKET}/${prefix}/`}`);
let total = 0;
const queue = [...files];
const workers = Array.from({ length: 6 }, async () => {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const r = await putFile(f);
    total += r.bytes;
    console.log(`  ${String(r.status).padEnd(7)} ${r.key}  (${(r.bytes / 1024).toFixed(0)} KB)`);
  }
});
await Promise.all(workers);
console.log(`✓ ${files.length} files · ${(total / 1024 / 1024).toFixed(2)} MB`);
if (!dryRun) {
  console.log(`  NEXT: connect a custom domain to the bucket (r2.dev has NO CORS) + CORS policy`);
  console.log(`  (dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md §Recipe), then set`);
  console.log(`  PUBLIC_ENRICHED_TILES_URL=https://<custom-domain>/${prefix}/tileset.json`);
}
