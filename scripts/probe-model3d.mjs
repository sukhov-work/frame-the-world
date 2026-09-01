#!/usr/bin/env node
/**
 * MESH SUITE MS0 — the ONE empirical Wix Media MODEL3D probe (MESH_SUITE_PLAN.md §1, owner
 * 2026-09-01c). Answers, with bytes rather than docs, the four platform unknowns D3 rests on:
 *   (1) does a PUBLIC MODEL3D descriptor carry a `urlExpirationDate` (does the URL expire)?
 *   (2) does the static host serve `model/gltf-binary` with CORS + Range (three's loaders need
 *       `Access-Control-Allow-Origin`; streaming/partial fetches need `Accept-Ranges` / 206)?
 *   (3) what does the ingest walk look like (`operationStatus` on the PUT response → READY)?
 *   (4) what mime/mediaType does the platform assign a .glb (MODEL3D is the documented enum)?
 *
 * Runs against the LIVE site with a site-scoped CLI token (the provision-collections.mjs auth
 * shape — `npx @wix/cli@latest token --site <siteId>`; `wix whoami` must be logged in). Never
 * touches the app, the dev server or any collection. Uploads two ~110 KB procedurally generated
 * GLBs (a UV sphere written by a minimal glTF-2.0 binary writer — no three, no DOM): one
 * PUBLIC (the D3 posture) and one PRIVATE (the hidden/deleted posture), then curls the public
 * URL with `Origin` + `Range` headers and records the response headers verbatim.
 *
 *   node scripts/probe-model3d.mjs                         # upload + descriptor + headers
 *   node scripts/probe-model3d.mjs --recheck <report.json> # re-curl a saved URL (expiry leg)
 *
 * Output: a JSON report under verify-shots/ (git-ignored) + a console summary. REST paths are
 * the ones the installed SDK maps (node_modules/@wix/auto_sdk_media_files/build/cjs/index.js:
 * `POST /v1/files/generate-upload-url`, `GET /v1/files/get-file-by-id`; service mount
 * `site-media`) — nothing here is a remembered signature.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "verify-shots");
const API = "https://www.wixapis.com/site-media/v1/files";
const ORIGINS = ["https://www.plux.today", "http://localhost:4321"];
const HEADER_KEYS = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "accept-ranges",
  "content-range",
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "x-cache",
  "server",
  "vary",
];

// ── a minimal glTF 2.0 binary writer (positions + normals + uint16 indices, one mesh) ────────
function sphereGlb(segW = 80, segH = 40, radius = 1) {
  const pos = [];
  const nrm = [];
  for (let y = 0; y <= segH; y++) {
    const v = y / segH;
    const phi = v * Math.PI;
    for (let x = 0; x <= segW; x++) {
      const u = x / segW;
      const th = u * Math.PI * 2;
      const nx = -Math.cos(th) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.sin(th) * Math.sin(phi);
      pos.push(nx * radius, ny * radius, nz * radius);
      nrm.push(nx, ny, nz);
    }
  }
  const idx = [];
  for (let y = 0; y < segH; y++) {
    for (let x = 0; x < segW; x++) {
      const a = y * (segW + 1) + x;
      const b = a + segW + 1;
      if (y !== 0) idx.push(a, b, a + 1);
      if (y !== segH - 1) idx.push(b, b + 1, a + 1);
    }
  }
  const posF = new Float32Array(pos);
  const nrmF = new Float32Array(nrm);
  const idxU = new Uint16Array(idx);
  const pad4 = (n) => (n + 3) & ~3;
  const binLen = pad4(posF.byteLength) + pad4(nrmF.byteLength) + pad4(idxU.byteLength);
  const bin = new Uint8Array(binLen);
  let off = 0;
  const put = (arr) => {
    bin.set(new Uint8Array(arr.buffer), off);
    const start = off;
    off += pad4(arr.byteLength);
    return start;
  };
  const posOff = put(posF);
  const nrmOff = put(nrmF);
  const idxOff = put(idxU);
  const json = {
    asset: { version: "2.0", generator: "plux probe-model3d" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "probe-sphere" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: posF.length / 3,
        type: "VEC3",
        min: [-radius, -radius, -radius],
        max: [radius, radius, radius],
      },
      { bufferView: 1, componentType: 5126, count: nrmF.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: idxU.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posF.byteLength, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmF.byteLength, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxU.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binLen }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  if (jsonBytes.length % 4) {
    const padded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // BIN
  out.set(bin, binStart + 8);
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (headers) => {
  const o = {};
  for (const k of HEADER_KEYS) {
    const v = headers.get(k);
    if (v != null) o[k] = v;
  }
  return o;
};
async function curl(url, { method = "GET", origin, range } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (range) headers.Range = range;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, headers, redirect: "manual" });
    // Drain a bounded amount so a ranged GET reports its real payload size without pulling
    // the whole file on a non-ranged response.
    let bytes = 0;
    if (method === "GET" && res.body) {
      const reader = res.body.getReader();
      while (bytes < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
      await reader.cancel().catch(() => {});
    }
    return { status: res.status, ms: Date.now() - t0, bytesRead: bytes, headers: pick(res.headers) };
  } catch (e) {
    return { status: null, error: String(e?.message ?? e), ms: Date.now() - t0 };
  }
}
const headerLegs = async (url) => {
  const legs = {};
  legs["GET plain"] = await curl(url);
  legs["HEAD plain"] = await curl(url, { method: "HEAD" });
  for (const origin of ORIGINS) {
    legs[`GET Origin=${origin}`] = await curl(url, { origin });
    legs[`GET Origin=${origin} Range=bytes=0-1023`] = await curl(url, { origin, range: "bytes=0-1023" });
  }
  legs["GET Range=bytes=1024-2047 (no Origin)"] = await curl(url, { range: "bytes=1024-2047" });
  return legs;
};
const summarize = (label, legs) => {
  console.log(`\n── ${label}`);
  for (const [name, r] of Object.entries(legs)) {
    const h = r.headers ?? {};
    console.log(
      `  ${name}\n    → ${r.status ?? "ERR " + r.error} ${r.ms} ms` +
        (r.bytesRead != null ? ` · read ${r.bytesRead} B` : "") +
        `\n    ACAO=${h["access-control-allow-origin"] ?? "—"} · Accept-Ranges=${h["accept-ranges"] ?? "—"}` +
        ` · Content-Range=${h["content-range"] ?? "—"}\n    Content-Type=${h["content-type"] ?? "—"}` +
        ` · Content-Length=${h["content-length"] ?? "—"} · Cache-Control=${h["cache-control"] ?? "—"}`,
    );
  }
};

// ── --recheck: the expiry leg on a saved report ──────────────────────────────────────────────
const args = process.argv.slice(2);
if (args[0] === "--recheck") {
  const path = args[1];
  if (!path) {
    console.error("usage: node scripts/probe-model3d.mjs --recheck <verify-shots/probe-model3d-*.json>");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(path, "utf-8"));
  const now = new Date().toISOString();
  report.rechecks ??= [];
  for (const up of report.uploads) {
    const url = up.descriptor?.media?.model3d?.url ?? up.descriptor?.url;
    if (!url) continue;
    const legs = await headerLegs(url);
    report.rechecks.push({ at: now, kind: up.kind, url, ageMin: +((Date.now() - Date.parse(up.readyAt ?? report.startedAt)) / 60000).toFixed(1), legs });
    summarize(`RECHECK ${up.kind} · ${url} · age ${((Date.now() - Date.parse(up.readyAt ?? report.startedAt)) / 60000).toFixed(1)} min`, legs);
  }
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`\nreport updated: ${path}`);
  process.exit(0);
}

// ── main: mint → upload (public, private) → poll → headers ───────────────────────────────────
const { siteId } = JSON.parse(readFileSync(join(root, "wix.config.json"), "utf-8"));
const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], { encoding: "utf-8" })
  .trim()
  .split("\n")
  .pop();
const headers = {
  Authorization: `Bearer ${token}`,
  "wix-site-id": siteId,
  "Content-Type": "application/json",
};
const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, { headers, ...init });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
};

const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, "-");
const glb = sphereGlb();
console.log(`probe GLB: ${glb.byteLength} bytes (magic ${String.fromCharCode(...glb.slice(0, 4))})`);
const report = { startedAt, siteId, glbBytes: glb.byteLength, uploads: [] };

for (const kind of ["public", "private"]) {
  const fileName = `plux-probe-${kind}-${stamp}.glb`;
  console.log(`\n=== ${kind.toUpperCase()} upload: ${fileName}`);
  const up = { kind, fileName, steps: [] };
  report.uploads.push(up);

  // 1. mint
  const mint = await api("/generate-upload-url", {
    method: "POST",
    body: JSON.stringify({
      mimeType: "model/gltf-binary",
      fileName,
      sizeInBytes: String(glb.byteLength),
      private: kind === "private",
    }),
  });
  up.steps.push({ step: "generate-upload-url", status: mint.status, body: mint.body });
  console.log(`generate-upload-url → ${mint.status}`, mint.status === 200 ? "" : JSON.stringify(mint.body).slice(0, 400));
  if (mint.status !== 200 || !mint.body.uploadUrl) continue;

  // 2. PUT the bytes (the uploadMedia.ts preview shape: ?filename= + Content-Type)
  const putRes = await fetch(`${mint.body.uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: "PUT",
    headers: { "Content-Type": "model/gltf-binary" },
    body: glb,
  });
  const putText = await putRes.text();
  let putJson;
  try {
    putJson = JSON.parse(putText);
  } catch {
    putJson = { raw: putText.slice(0, 500) };
  }
  up.steps.push({ step: "PUT", status: putRes.status, body: putJson });
  const putFile = putJson?.file ?? putJson;
  console.log(
    `PUT → ${putRes.status} · id=${putFile?.id ?? "—"} · mediaType=${putFile?.mediaType ?? "—"} · operationStatus=${putFile?.operationStatus ?? "—"}`,
  );
  if (!putRes.ok || !putFile?.id) {
    console.log(JSON.stringify(putJson).slice(0, 800));
    continue;
  }
  up.fileId = putFile.id;
  up.putDescriptor = putFile;

  // 3. poll the descriptor to READY (or FAILED) — the ingest walk
  const t0 = Date.now();
  let desc = null;
  let polls = 0;
  while (Date.now() - t0 < 90_000) {
    polls++;
    let got = await api(`/get-file-by-id?fileId=${encodeURIComponent(up.fileId)}`);
    if (got.status === 404) got = await api(`/${encodeURIComponent(up.fileId)}`); // path-style fallback
    desc = got.body?.file ?? got.body;
    const st = desc?.operationStatus;
    if (polls === 1) console.log(`get-file-by-id → ${got.status} · operationStatus=${st ?? "—"}`);
    if (got.status !== 200) {
      up.steps.push({ step: "get-file-by-id", status: got.status, body: got.body });
      break;
    }
    if (st === "READY" || st === "FAILED") break;
    await sleep(1500);
  }
  up.readyAt = new Date().toISOString();
  up.readyAfterMs = Date.now() - t0;
  up.polls = polls;
  up.descriptor = desc;
  console.log(`descriptor after ${polls} poll(s) / ${Date.now() - t0} ms: operationStatus=${desc?.operationStatus}`);
  console.log("descriptor (verbatim):");
  console.log(JSON.stringify(desc, null, 2));

  // 4. the static-host headers (public only carries a servable URL; private is expected to
  //    need generateFileDownloadUrl — record whatever the descriptor says either way)
  const url = desc?.media?.model3d?.url ?? desc?.url;
  if (url) {
    up.legs = await headerLegs(url);
    summarize(`${kind} · ${url}`, up.legs);
  } else {
    console.log("no servable url on the descriptor");
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `probe-model3d-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nreport: ${outPath}\nre-run later for the expiry leg: node scripts/probe-model3d.mjs --recheck ${outPath}`);
