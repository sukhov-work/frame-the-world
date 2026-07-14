#!/usr/bin/env node
// Deploy scripts/bake/r2-worker.mjs to the Cloudflare Worker that fronts the R2 tiles bucket,
// PRESERVING the R2 binding (a bare PUT would wipe it). Reproducible + idempotent — re-run after
// editing the worker. No wrangler/SDK (public npm is blocked here): a pure-fetch multipart PUT.
//
//   node scripts/bake/deploy-worker.mjs [--dry-run]
//
// Required env (NEVER printed) — the API token, NOT the S3 keys:
//   CLOUDFLARE_API_TOKEN    (Workers Scripts: Edit)      | R2_API_TOKEN
//   CLOUDFLARE_ACCOUNT_ID                                | R2_ACCOUNT_ID
// Optional:
//   CLOUDFLARE_R2_BUCKET        (default frame-the-world-bucket) — the binding target
//   CLOUDFLARE_WORKER_NAME      (default frame-the-world)        — the script name
//   CLOUDFLARE_WORKER_COMPAT_DATE (default 2026-07-13)
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const acct = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.R2_API_TOKEN;
const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? process.env.R2_BUCKET ?? "frame-the-world-bucket";
const name = process.env.CLOUDFLARE_WORKER_NAME ?? "frame-the-world";
const compatibilityDate = process.env.CLOUDFLARE_WORKER_COMPAT_DATE ?? "2026-07-13";

if (!dryRun && !(acct && token)) {
  console.error(
    "missing env: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (the Workers-Edit API token, not the S3 keys)",
  );
  process.exit(1);
}

const src = await readFile(join(here, "r2-worker.mjs"), "utf8");
// Module worker: main_module must name a part in the multipart body. Keep "worker.js" (the name the
// existing script uses) so this is a clean in-place update, binding intact.
const metadata = {
  main_module: "worker.js",
  compatibility_date: compatibilityDate,
  bindings: [{ type: "r2_bucket", name: "R2_BUCKET", bucket_name: bucket }],
};

console.log(`▶ deploy-worker → script "${name}"${dryRun ? " (dry-run)" : ""}`);
console.log(`  module ${src.length} bytes · binding R2_BUCKET=${bucket} · compat ${compatibilityDate}`);
if (dryRun) {
  console.log("  metadata:", JSON.stringify(metadata));
  process.exit(0);
}

const form = new FormData();
form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.set("worker.js", new Blob([src], { type: "application/javascript+module" }), "worker.js");

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${acct}/workers/scripts/${name}`,
  { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form },
);
const json = await res.json().catch(() => ({}));
if (!res.ok || json.success === false) {
  console.error(`✗ deploy failed → HTTP ${res.status}`);
  console.error(JSON.stringify(json.errors ?? json, null, 2));
  process.exit(1);
}
console.log("✓ deployed — the workers.dev URL now serves the tiles with CORS + Range.");
console.log("  verify: curl -H 'Origin: http://localhost:4321' -I <worker-url>/enriched/dnipro/tileset.json");
