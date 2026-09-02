// Browser verification for MESH SUITE MS4 — the D3 upload pipeline (2026-09-02): the photo|model
// fork of the UPLOAD modal, the client-side load → inspect → decimate → pack pipeline, the
// allowlisted mint, the UserModels record, and the bytes as the world would stream them. Usage:
// wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs --headless --port 9333 --profile <dir>):
//   node scripts/verify-modelupload.mjs [cdpPort] [shotsDir]      (Node ≥22: global WebSocket)
//
// Fixtures are written procedurally at run time (a minimal glTF-2.0 binary writer — the MS0 probe's,
// grown a PNG texture — plus an OBJ+MTL cube and a zero-filled oversize file); nothing binary is
// committed. Legs, at the Dnipro FPV pose (owner memo 2026-09-02c: Dnipro first, always):
//   1. the overlay opens on the DEV seam; a 6,240-triangle UV sphere GLB dropped through the hidden
//      file input walks the pipeline to REVIEW: format glb · exact tris · 1 mesh · 0 textures ·
//      metres · a packed GLB under 200 KB · a blob thumbnail · the header reads 1 UPLOAD · 2 CHECK ·
//      3 STORE with CHECK lit; screenshot
//   2. a DENSE TEXTURED sphere (159,200 tris + a 64² PNG) is auto-DECIMATED to ≤ 100k (the source
//      count remembered), keeps its texture, packs under the cap; screenshot
//   3. an OBJ cube + its MTL (a 3,000-unit cube) reads as 12 triangles with the unit GUESSED as cm
//      (30 m); switching to metres re-packs and the footprint reads 3,000 m
//   4. a 16 MiB zero-filled .glb is REFUSED before parsing (RAW_TOO_LARGE, no mint request) and
//      the dropzone shows the notice
//   5. anonymous gate: the CHECK card's primary action is SIGN IN TO UPLOAD (a login link) and the
//      seam's upload() bounces off the endpoint's 401 (SIGNED_OUT) with the packed model intact
//   6. member (the verify-places-member recipe): the allowlist refuses a kind:"model" mint for
//      image/jpeg and for a .gltf name (400 UNSUPPORTED_MODEL), a valid mint answers a URL (the
//      elevated call with the folder option works), /api/models refuses a bogus fileId (404)
//   7. member upload of the dense textured sphere with an UPLOAD HERE seed: STORED (readiness
//      READY, a wixstatic /3d/ URL, a thumbnail); GET lists it with the facts + the seed; the
//      served GLB answers 200 model/gltf-binary + CORS * and its JSON chunk proves the pipeline
//      (generator THREE.GLTFExporter · one image · no animations · POSITION count ≤ 3 × tris —
//      compaction); a re-POST answers the existing row; the descriptor sits in the /plux/models
//      folder (CLI-token REST read)
//   8. cleanup (finally): DELETE removes the row + the media; GET no longer lists it
// Screenshots in verify-shots/ (git-ignored). Every row/file this harness creates it removes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
const FPV_URL = "http://localhost:4321/#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000";
const MODEL_MIME = "model/gltf-binary";
const MAX_TRIS = 100_000;
const MAX_GLB = 8 * 1024 * 1024;

// ── fixtures: a minimal glTF-2.0 binary writer (+ optional PNG texture), an OBJ+MTL cube ─────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngRGBA(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** UV sphere: 2·segW·segH − 2·segW triangles, (segW+1)(segH+1) vertices. */
export const sphereTris = (segW, segH) => 2 * segW * segH - 2 * segW;
function sphereGlb({ segW = 80, segH = 40, radius = 1, textured = false } = {}) {
  const pos = [];
  const nrm = [];
  const uv = [];
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
      uv.push(u, v);
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
  const uvF = new Float32Array(uv);
  const idxU = new Uint32Array(idx);
  const png = textured ? pngRGBA(64, 64, (x, y) => (((x >> 3) + (y >> 3)) & 1 ? [230, 120, 40, 255] : [40, 60, 200, 255])) : null;
  const pad4 = (n) => (n + 3) & ~3;
  const parts = [posF, nrmF, uvF, idxU, ...(png ? [png] : [])];
  const binLen = parts.reduce((a, p) => a + pad4(p.byteLength), 0);
  const bin = new Uint8Array(binLen);
  let off = 0;
  const put = (arr) => {
    bin.set(arr instanceof Uint8Array ? arr : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), off);
    const start = off;
    off += pad4(arr.byteLength);
    return start;
  };
  const posOff = put(posF);
  const nrmOff = put(nrmF);
  const uvOff = put(uvF);
  const idxOff = put(idxU);
  const pngOff = png ? put(png) : 0;
  const json = {
    asset: { version: "2.0", generator: "plux verify-modelupload" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "sphere" }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            mode: 4,
            ...(textured ? { material: 0 } : {}),
          },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posF.length / 3, type: "VEC3", min: [-radius, -radius, -radius], max: [radius, radius, radius] },
      { bufferView: 1, componentType: 5126, count: nrmF.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: uvF.length / 2, type: "VEC2" },
      { bufferView: 3, componentType: 5125, count: idxU.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posF.byteLength, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmF.byteLength, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvF.byteLength, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxU.byteLength, target: 34963 },
      ...(png ? [{ buffer: 0, byteOffset: pngOff, byteLength: png.byteLength }] : []),
    ],
    buffers: [{ byteLength: binLen }],
    ...(textured
      ? {
          images: [{ bufferView: 4, mimeType: "image/png" }],
          textures: [{ source: 0 }],
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
        }
      : {}),
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
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}
/** A cube of `size` source units, 12 triangles, one MTL material. */
const cubeObj = (size) => {
  const s = size / 2;
  const v = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const f = [
    [1, 2, 3], [1, 3, 4], [5, 8, 7], [5, 7, 6], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 8], [3, 8, 4], [5, 1, 4], [5, 4, 8],
  ];
  return `mtllib cube.mtl\no cube\n${v.map((p) => `v ${p.join(" ")}`).join("\n")}\nusemtl brick\n${f.map((t) => `f ${t.join(" ")}`).join("\n")}\n`;
};
const cubeMtl = "newmtl brick\nKd 0.80 0.25 0.20\nKs 0.05 0.05 0.05\nNs 10\n";

const parseGlbJson = (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true) === 0x46546c67;
  const version = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(12, true);
  const jsonChunk = dv.getUint32(16, true) === 0x4e4f534a;
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  return { magic, version, jsonChunk, json };
};

const FIX = mkdtempSync(join(tmpdir(), "plux-modelupload-"));
const fixture = (name, bytes) => {
  const p = join(FIX, name);
  writeFileSync(p, bytes);
  return p;
};
const SMALL = { segW: 80, segH: 40 };
const DENSE = { segW: 400, segH: 200 };
const F = {
  small: fixture("plux-sphere.glb", sphereGlb(SMALL)),
  dense: fixture("plux-dense-textured.glb", sphereGlb({ ...DENSE, radius: 6, textured: true })),
  obj: fixture("cube.obj", cubeObj(3000)),
  mtl: fixture("cube.mtl", cubeMtl),
  huge: fixture("too-big.glb", Buffer.alloc(16 * 1024 * 1024)),
};
console.log(`fixtures in ${FIX}: small ${readFileSync(F.small).byteLength} B · dense ${readFileSync(F.dense).byteLength} B (${sphereTris(DENSE.segW, DENSE.segH)} tris)`);

// ── CDP plumbing (the verify-meshedit idiom) ─────────────────────────────────────────────────
const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id); // audit #3 C11: an abandoned target holds a WebGL context
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let seq = 0;
const pending = new Map();
const apiRequests = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === "Network.requestWillBeSent") {
    const u = msg.params?.request?.url ?? "";
    if (u.includes("/api/")) apiRequests.push(u);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(shot.data, "base64"));
  console.log(`shot: ${SHOTS}/${name}`);
};
/** audit #3 C11: THROW — unwinds to verify-cdp-cleanup's handler (closes the target, exits 1). */
const fail = (msg) => {
  throw new VerifyFailure(msg);
};

const MS = "window.__modelUploadStore.getState()";
const modelState = () =>
  evalJs(
    `(() => { const s = ${MS}; return { phase: s.phase, progress: s.progress, fileName: s.fileName ?? null, format: s.format ?? null, rawBytes: s.rawBytes ?? null, title: s.title, stats: s.stats ?? null, decimatedFromTris: s.decimatedFromTris, glbBytes: s.glbBytes ?? null, textureEdge: s.textureEdge ?? null, thumbnailUrl: s.thumbnailUrl ?? null, warnings: s.warnings, violations: s.violations, error: s.error ?? null, errorCode: s.errorCode ?? null, unit: s.unit, unitSuggested: s.unitSuggested, placement: s.placement ?? null, stored: s.stored ?? null }; })()`,
  );
const waitModelPhase = async (label, phases, timeoutMs = 90_000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await modelState();
    if (phases.includes(last.phase)) return last;
    if (last.phase === "error" && !phases.includes("error")) fail(`${label}: pipeline refused — ${last.errorCode}: ${last.error}`);
    await sleep(200);
  }
  fail(`${label}: model phase never reached ${phases.join("|")} (last ${JSON.stringify(last)})`);
};
const openOverlay = async (label) => {
  await evalJs("window.__uploadStore.getState().openPanel(), true");
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if (await evalJs("!!document.querySelector('.uf input[type=file]')")) return;
    await sleep(120);
  }
  fail(`${label}: the upload overlay never mounted its file input`);
};
const dropFiles = async (label, paths) => {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf input[type=file]" });
  if (!nodeId) fail(`${label}: no file input in the overlay`);
  await send("DOM.setFileInputFiles", { files: paths, nodeId });
};
const headerSteps = () =>
  evalJs("Array.from(document.querySelectorAll('.uf-steps__step')).map((e) => [e.textContent, e.classList.contains('uf-steps__step--active')])");
const dismissWelcome = () =>
  evalJs("(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");
const waitBoot = async (label) => {
  const t0 = Date.now();
  while (true) {
    const ok = await evalJs("!!(window.__globe && window.__globe.camera && window.__uploadStore && window.__modelUploadStore && window.__memberStore)").catch(() => false);
    if (ok) return;
    if (Date.now() - t0 > 90_000) fail(`${label}: globe + the MS4 seams never booted`);
    await sleep(300);
  }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("boot");
await dismissWelcome();
await sleep(500);
console.log("boot: globe + seams up at the Dnipro FPV pose");

// ═══ 1: the small sphere → REVIEW ════════════════════════════════════════════════════════════
await openOverlay("leg 1");
await dropFiles("leg 1", [F.small]);
const t1 = Date.now();
let s1 = await waitModelPhase("leg 1", ["review"]);
const ms1 = Date.now() - t1;
const smallTris = sphereTris(SMALL.segW, SMALL.segH);
if (s1.format !== "glb") fail(`leg 1: format ${s1.format}`);
if (s1.stats.tris !== smallTris) fail(`leg 1: tris ${s1.stats.tris} ≠ ${smallTris}`);
if (s1.stats.meshes !== 1 || s1.stats.textures !== 0) fail(`leg 1: meshes/textures ${s1.stats.meshes}/${s1.stats.textures}`);
if (s1.decimatedFromTris !== null) fail("leg 1: a 6k sphere must not be decimated");
if (s1.unit !== "m" || s1.unitSuggested) fail(`leg 1: unit ${s1.unit} suggested ${s1.unitSuggested}`);
if (!(s1.glbBytes > 1000 && s1.glbBytes < 200_000)) fail(`leg 1: packed ${s1.glbBytes} B`);
if (!(s1.thumbnailUrl ?? "").startsWith("blob:")) fail(`leg 1: no blob thumbnail (${s1.thumbnailUrl})`);
if (!s1.stats.bbox.every((v) => near(v, 2, 0.05))) fail(`leg 1: bbox ${JSON.stringify(s1.stats.bbox)} (radius-1 sphere → 2 m)`);
if (s1.title !== "plux-sphere") fail(`leg 1: title ${s1.title}`);
const steps1 = await headerSteps();
if (JSON.stringify(steps1) !== JSON.stringify([["1 UPLOAD", false], ["2 CHECK", true], ["3 STORE", false]])) fail(`leg 1: header ${JSON.stringify(steps1)}`);
if (!(await evalJs("!!document.querySelector('.uf-preview--model img')"))) fail("leg 1: the CHECK card shows no thumbnail image");
await shoot("modelupload-01-check-card.jpeg");
console.log(`leg 1: small sphere → REVIEW in ${ms1} ms · ${s1.stats.tris} tris · packed ${s1.glbBytes} B · thumbnail · header CHECK lit`);

// ═══ 2: the dense textured sphere → DECIMATED ═══════════════════════════════════════════════
await evalJs(`${MS}.clear(), true`);
await openOverlay("leg 2");
await dropFiles("leg 2", [F.dense]);
const t2 = Date.now();
const s2 = await waitModelPhase("leg 2", ["review"]);
const ms2 = Date.now() - t2;
const denseTris = sphereTris(DENSE.segW, DENSE.segH);
if (s2.decimatedFromTris !== denseTris) fail(`leg 2: decimatedFromTris ${s2.decimatedFromTris} ≠ ${denseTris}`);
if (!(s2.stats.tris <= MAX_TRIS && s2.stats.tris >= MAX_TRIS * 0.5)) fail(`leg 2: decimated to ${s2.stats.tris} (cap ${MAX_TRIS})`);
if (s2.stats.textures !== 1) fail(`leg 2: textures ${s2.stats.textures}`);
if (!(s2.glbBytes <= MAX_GLB)) fail(`leg 2: packed ${s2.glbBytes} B over the cap`);
if (s2.textureEdge !== 2048) fail(`leg 2: texture edge ${s2.textureEdge} (a 64² texture packs on the first rung)`);
if (!(await evalJs("(document.querySelector('.uf-filerow .uf-badge--warn')?.textContent ?? '').includes('DECIMATED')"))) fail("leg 2: no DECIMATED badge on the card");
await shoot("modelupload-02-decimated.jpeg");
console.log(`leg 2: dense textured sphere → REVIEW in ${ms2} ms · ${denseTris} → ${s2.stats.tris} tris · 1 texture · packed ${s2.glbBytes} B`);

// ═══ 3: OBJ + MTL → units guessed, re-packed on change ═══════════════════════════════════════
await evalJs(`${MS}.clear(), true`);
await openOverlay("leg 3");
await dropFiles("leg 3", [F.mtl, F.obj]);
const s3 = await waitModelPhase("leg 3", ["review"]);
if (s3.format !== "obj" || s3.fileName !== "cube.obj") fail(`leg 3: format ${s3.format} file ${s3.fileName}`);
if (s3.stats.tris !== 12 || s3.stats.meshes !== 1) fail(`leg 3: tris/meshes ${s3.stats.tris}/${s3.stats.meshes}`);
if (s3.unit !== "cm" || !s3.unitSuggested) fail(`leg 3: unit ${s3.unit} suggested ${s3.unitSuggested} (a 3,000-unit cube reads as cm)`);
if (!s3.stats.bbox.every((v) => near(v, 30, 0.01))) fail(`leg 3: bbox ${JSON.stringify(s3.stats.bbox)} ≠ 30 m`);
const glb3cm = s3.glbBytes;
await evalJs("Array.from(document.querySelectorAll('button.uf-chip')).find((b) => b.textContent === 'M').click(), true");
const s3m = await waitModelPhase("leg 3 (m)", ["review"], 30_000);
if (s3m.unit !== "m" || s3m.unitSuggested) fail(`leg 3: after the click unit ${s3m.unit} suggested ${s3m.unitSuggested}`);
if (!s3m.stats.bbox.every((v) => near(v, 3000, 0.5))) fail(`leg 3: bbox after m ${JSON.stringify(s3m.stats.bbox)}`);
if (!(s3m.glbBytes > 0)) fail("leg 3: no re-packed GLB");
console.log(`leg 3: OBJ+MTL → 12 tris · guessed cm (30 m) · M chip → 3,000 m · re-packed ${glb3cm} → ${s3m.glbBytes} B`);

// ═══ 4: the oversize file is refused before parsing ══════════════════════════════════════════
await evalJs(`${MS}.clear(), true`);
await openOverlay("leg 4");
const apiBefore = apiRequests.length;
await dropFiles("leg 4", [F.huge]);
const s4 = await waitModelPhase("leg 4", ["error"], 20_000);
if (s4.errorCode !== "RAW_TOO_LARGE") fail(`leg 4: ${s4.errorCode} — ${s4.error}`);
if (!(await evalJs("(document.querySelector('.uf-notice')?.textContent ?? '').includes('Could not take that model')"))) fail("leg 4: the dropzone shows no refusal notice");
if (!(await evalJs("!!document.querySelector('.uf-dropzone')"))) fail("leg 4: the dropzone is not back after a refusal");
if (apiRequests.length !== apiBefore) fail(`leg 4: a refused drop touched the network: ${apiRequests.slice(apiBefore).join(", ")}`);
console.log(`leg 4: 16 MiB file → ${s4.errorCode} before any parse · notice shown · no /api request`);

// ═══ 5: anonymous gate ═══════════════════════════════════════════════════════════════════════
await evalJs(`${MS}.clear(), true`);
await openOverlay("leg 5");
await dropFiles("leg 5", [F.small]);
await waitModelPhase("leg 5", ["review"]);
const t5 = Date.now();
while ((await evalJs("window.__memberStore.getState().phase")) !== "anonymous" && Date.now() - t5 < 15_000) await sleep(300);
const primary5 = await evalJs("(() => { const a = document.querySelector('.uf-actions a.uf-btn--primary'); return a ? { text: a.textContent, href: a.getAttribute('href') } : null; })()");
if (!primary5 || !primary5.text.includes("SIGN IN TO UPLOAD") || !primary5.href.startsWith("/api/auth/login?returnToUrl=")) fail(`leg 5: primary action ${JSON.stringify(primary5)}`);
await evalJs(`${MS}.upload()`);
const s5 = await modelState();
if (s5.phase !== "review" || s5.errorCode !== "SIGNED_OUT") fail(`leg 5: anonymous upload → ${s5.phase} ${s5.errorCode} ${s5.error}`);
if (!(s5.glbBytes > 0)) fail("leg 5: the packed model did not survive the refused upload");
console.log(`leg 5: anonymous → SIGN IN TO UPLOAD link · upload() → 401 ${s5.errorCode} · model kept`);

// ═══ member session (the verify-places-member recipe) ═══════════════════════════════════════
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const envLocal = readFileSync(".env.local", "utf-8");
const envVal = (k) => envLocal.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const TEST_MEMBER = { email: envVal("TEST_MEMBER_EMAIL"), password: envVal("TEST_MEMBER_PASSWORD") };
const clientId = envVal("WIX_CLIENT_ID");
if (!TEST_MEMBER.email || !TEST_MEMBER.password || !clientId)
  fail("legs 6–8 need TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID in .env.local (audit B2)");
const sdk = createClient({ auth: OAuthStrategy({ clientId }) });
const login = await sdk.auth.login({ email: TEST_MEMBER.email, password: TEST_MEMBER.password });
if (login.loginState !== "SUCCESS") fail(`member login state ${login.loginState}`);
const REDIRECT = "http://localhost:4321/api/auth/callback";
const oauthData = sdk.auth.generateOAuthData(REDIRECT, "http://localhost:4321/");
const authorizeUrl =
  `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
  `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
  `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
const authRes = await fetch(authorizeUrl, { redirect: "manual" });
const loc = authRes.headers.get("location");
if (!loc) fail(`authorize gave no redirect (${authRes.status})`);
const memberTokens = await sdk.auth.getMemberTokens(
  new URL(loc).searchParams.get("code"),
  new URL(loc).searchParams.get("state"),
  oauthData,
);
const cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens: memberTokens }));
console.log(`member tokens minted (${memberTokens.refreshToken.role})`);
const setCookie = () => evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800", true`);
const clearCookie = () => evalJs(`document.cookie = "wixSession=; path=/; max-age=0", true`);
const pageApi = (path, init = null) =>
  evalJs(
    `fetch(${JSON.stringify(path)}, ${init ? JSON.stringify(init) : "undefined"}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`,
  );
const postJson = (path, body, method = "POST") =>
  pageApi(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const reload = async (label, { member = false } = {}) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", { url: FPV_URL });
  await waitBoot(label);
  await dismissWelcome();
  if (member) {
    const t = Date.now();
    while ((await evalJs("window.__memberStore.getState().phase")) !== "member" && Date.now() - t < 15_000) await sleep(400);
    if ((await evalJs("window.__memberStore.getState().phase")) !== "member") fail(`${label}: no member session in the page`);
  }
};
const listMine = async () => {
  const r = await pageApi("/api/models");
  if (r.status !== 200) fail(`GET /api/models → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.models ?? [];
};

let modelId = null;
let cleanupProblem = null;
try {
  await setCookie();
  await reload("member", { member: true });

  // ═══ 6: the allowlist + the record gate, as the member ═════════════════════════════════════
  const bad1 = await postJson("/api/upload-url", { kind: "model", fileName: "x.glb", mimeType: "image/jpeg", sizeBytes: 1000 });
  if (bad1.status !== 400 || bad1.body?.error !== "UNSUPPORTED_MODEL") fail(`leg 6: jpeg-as-model → ${bad1.status} ${JSON.stringify(bad1.body)}`);
  const bad2 = await postJson("/api/upload-url", { kind: "model", fileName: "x.gltf", mimeType: MODEL_MIME, sizeBytes: 1000 });
  if (bad2.status !== 400 || bad2.body?.error !== "UNSUPPORTED_MODEL") fail(`leg 6: .gltf name → ${bad2.status} ${JSON.stringify(bad2.body)}`);
  const bad3 = await postJson("/api/upload-url", { kind: "model", fileName: "x.glb", mimeType: MODEL_MIME, sizeBytes: MAX_GLB + 1 });
  if (bad3.status !== 400) fail(`leg 6: over-cap size → ${bad3.status}`);
  const ok6 = await postJson("/api/upload-url", { kind: "model", fileName: "Дніпро kiosk (v2).glb", mimeType: MODEL_MIME, sizeBytes: 1000 });
  if (ok6.status !== 200 || typeof ok6.body?.uploadUrl !== "string" || ok6.body.fileName !== "kiosk-v2.glb")
    fail(`leg 6: a valid mint → ${ok6.status} ${JSON.stringify(ok6.body)}`);
  const bogus = await postJson("/api/models", { fileId: "166a86_00000000000000000000000000000000.glb", sourceFormat: "glb", glbBytes: 10, tris: 1, meshes: 1, textures: 0 });
  if (bogus.status !== 404 || bogus.body?.error !== "FILE_NOT_FOUND") fail(`leg 6: bogus fileId → ${bogus.status} ${JSON.stringify(bogus.body)}`);
  const anonList = await listMine();
  console.log(`leg 6: allowlist refuses jpeg + .gltf + over-cap (400) · valid mint 200 (sanitized name) · bogus fileId 404 · own list has ${anonList.length} model(s) before`);

  // ═══ 7: the member upload with an UPLOAD HERE seed ═════════════════════════════════════════
  await evalJs("window.__uploadStore.getState().uploadAt(48.4647, 35.0462), true");
  await openOverlay("leg 7");
  await dropFiles("leg 7", [F.dense]);
  const s7 = await waitModelPhase("leg 7", ["review"]);
  if (!s7.placement || !near(s7.placement.latDeg, 48.4647, 1e-9) || !near(s7.placement.lonDeg, 35.0462, 1e-9)) fail(`leg 7: seed not consumed (${JSON.stringify(s7.placement)})`);
  if (await evalJs("window.__uploadStore.getState().pendingPlacement !== undefined")) fail("leg 7: the upload store kept the seed");
  const primary7 = await evalJs("document.querySelector('.uf-actions button.uf-btn--primary')?.textContent ?? null");
  if (!primary7 || !primary7.includes("UPLOAD MODEL")) fail(`leg 7: member primary action ${primary7}`);
  await evalJs(`${MS}.setTitle("Dnipro dense sphere (verify)"), true`);
  const t7 = Date.now();
  await evalJs(`${MS}.upload()`);
  const st7 = await waitModelPhase("leg 7", ["stored"], 120_000);
  const ms7 = Date.now() - t7;
  modelId = st7.stored.modelId;
  if (!/^https:\/\/static\.wixstatic\.com\/3d\/.+\.glb$/.test(st7.stored.url)) fail(`leg 7: stored url ${st7.stored.url}`);
  if (st7.stored.readiness !== "READY") fail(`leg 7: readiness ${st7.stored.readiness}`);
  if (!/^https:\/\/static\.wixstatic\.com\/media\/.+\.png$/.test(st7.stored.thumbnailUrl ?? "")) fail(`leg 7: no stored thumbnail of ours (${st7.stored.thumbnailUrl})`);
  const steps7 = await headerSteps();
  if (!steps7[2] || steps7[2][1] !== true) fail(`leg 7: header after store ${JSON.stringify(steps7)}`);
  await shoot("modelupload-03-stored.jpeg");

  // the record, as the owner GET returns it
  let mine = null;
  for (let i = 0; i < 12 && !mine; i++) {
    mine = (await listMine()).find((m) => m.id === modelId) ?? null;
    if (!mine) await sleep(800);
  }
  if (!mine) fail("leg 7: GET /api/models never listed the stored model (read lag > 10 s?)");
  if (mine.url !== st7.stored.url) fail(`leg 7: listed url ${mine.url} ≠ stored ${st7.stored.url}`);
  if (mine.title !== "Dnipro dense sphere (verify)") fail(`leg 7: listed title ${mine.title}`);
  if (mine.sourceFormat !== "glb" || mine.tris !== s7.stats.tris || mine.decimatedFromTris !== denseTris || mine.textures !== 1)
    fail(`leg 7: listed facts ${JSON.stringify(mine)}`);
  if (!near(mine.lat, 48.4647, 1e-9) || !near(mine.lon, 35.0462, 1e-9)) fail(`leg 7: listed placement ${mine.lat},${mine.lon}`);
  if (mine.readiness !== "READY" || mine.hidden !== false) fail(`leg 7: readiness/hidden ${mine.readiness}/${mine.hidden}`);
  if (!mine.bbox || !mine.bbox.every((v) => near(v, 12, 0.1))) fail(`leg 7: listed bbox ${JSON.stringify(mine.bbox)} (radius-6 sphere → 12 m)`);

  // the bytes, as the world would stream them
  const served = await fetch(st7.stored.url, { headers: { Origin: "http://localhost:4321" } });
  const ct = served.headers.get("content-type") ?? "";
  const acao = served.headers.get("access-control-allow-origin");
  if (served.status !== 200 || !ct.startsWith(MODEL_MIME) || acao !== "*") fail(`leg 7: served ${served.status} ${ct} ACAO=${acao}`);
  const bytes = new Uint8Array(await served.arrayBuffer());
  if (bytes.byteLength !== st7.stored ? bytes.byteLength : 0) { /* size compared below */ }
  const glb = parseGlbJson(bytes);
  if (!glb.magic || glb.version !== 2 || !glb.jsonChunk) fail("leg 7: the served file is not a glTF-2 binary");
  const gen = glb.json.asset?.generator ?? "";
  if (!/GLTFExporter/i.test(gen)) fail(`leg 7: generator ${gen} — the bytes were not re-packed by the exporter`);
  if ((glb.json.images?.length ?? 0) !== 1) fail(`leg 7: images ${glb.json.images?.length}`);
  if ((glb.json.animations?.length ?? 0) !== 0) fail("leg 7: animations leaked into the GLB");
  const prims = (glb.json.meshes ?? []).flatMap((m) => m.primitives ?? []);
  if (prims.length !== 1) fail(`leg 7: ${prims.length} primitives`);
  const posAcc = glb.json.accessors[prims[0].attributes.POSITION];
  const idxAcc = glb.json.accessors[prims[0].indices];
  if (idxAcc.count / 3 !== s7.stats.tris) fail(`leg 7: served index count ${idxAcc.count / 3} tris ≠ ${s7.stats.tris}`);
  const sourceVerts = (DENSE.segW + 1) * (DENSE.segH + 1);
  if (!(posAcc.count <= s7.stats.tris * 3 && posAcc.count < sourceVerts)) fail(`leg 7: POSITION count ${posAcc.count} (source ${sourceVerts}) — orphans were not compacted`);
  if (bytes.byteLength !== s7.glbBytes && Math.abs(bytes.byteLength - s7.glbBytes) > 64) fail(`leg 7: served ${bytes.byteLength} B ≠ packed ${s7.glbBytes} B`);
  // OUR thumbnail (the rendered PNG uploaded as a public image) — served like a pin preview. The
  // platform's own MODEL3D thumbnail URL is a permanent 403 (measured 2026-09-02h) and is never
  // stored; assert that too, from the descriptor read below.
  const tThumb = Date.now();
  let thumbStatus = null;
  let thumbType = "";
  while (Date.now() - tThumb < 20_000) {
    const thumb = await fetch(st7.stored.thumbnailUrl, { headers: { Origin: "http://localhost:4321" } });
    thumbStatus = thumb.status;
    thumbType = thumb.headers.get("content-type") ?? "";
    if (thumbStatus === 200 && thumbType.startsWith("image/")) break;
    await sleep(1500);
  }
  const thumbMs = Date.now() - tThumb;
  if (thumbStatus !== 200 || !thumbType.startsWith("image/")) fail(`leg 7: our thumbnail never served in 20 s (last ${thumbStatus} ${thumbType})`);
  if (mine.thumbnailUrl !== st7.stored.thumbnailUrl) fail(`leg 7: listed thumbnail ${mine.thumbnailUrl} ≠ stored ${st7.stored.thumbnailUrl}`);

  // a re-POST of the same file answers the existing row
  const again = await postJson("/api/models", {
    fileId: mine.url.split("/3d/")[1],
    sourceFormat: "glb",
    glbBytes: s7.glbBytes,
    tris: s7.stats.tris,
    meshes: 1,
    textures: 1,
  });
  if (again.status !== 200 || again.body?.existing !== true || again.body?.modelId !== modelId) fail(`leg 7: re-POST → ${again.status} ${JSON.stringify(again.body)}`);

  // the descriptor's folder (CLI-token REST read — the probe's recipe)
  const { siteId } = JSON.parse(readFileSync("wix.config.json", "utf-8"));
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], { encoding: "utf-8" }).trim().split("\n").pop();
  const fileId = mine.url.split("/3d/")[1];
  const desc = await fetch(`https://www.wixapis.com/site-media/v1/files/get-file-by-id?fileId=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${token}`, "wix-site-id": siteId },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const d = desc.body?.file ?? desc.body;
  if (desc.status !== 200 || d?.mediaType !== "MODEL3D") fail(`leg 7: descriptor ${desc.status} ${JSON.stringify(desc.body).slice(0, 300)}`);
  if (d.parentFolderId === "media-root" || !d.parentFolderId) fail(`leg 7: the model landed in ${d.parentFolderId} — the /plux/models folder option was ignored`);
  const platformThumb = d.thumbnailUrl ?? d.media?.model3d?.thumbnail?.url ?? null;
  const platformThumbStatus = platformThumb ? (await fetch(platformThumb)).status : null;
  if (platformThumb && platformThumbStatus === 200) console.log(`NOTE: the platform's MODEL3D thumbnail now serves 200 (${platformThumb}) — the 2026-09-02h 403 finding may have expired`);
  if (platformThumb === st7.stored.thumbnailUrl) fail("leg 7: the record stored the platform's (403) thumbnail instead of ours");
  console.log(
    `leg 7: member upload → STORED in ${ms7} ms · ${st7.stored.url} · READY · thumbnail · listed with facts + seed (48.4647, 35.0462)` +
      ` · served ${bytes.byteLength} B ${ct} ACAO=* · generator "${gen}" · POSITION ${posAcc.count} (source ${sourceVerts}) · 1 image · 0 animations · our thumbnail ${thumbType} after ${thumbMs} ms (platform's: ${platformThumbStatus}) · re-POST existing · folder ${d.parentFolderId}`,
  );
} finally {
  // ═══ 8: cleanup — the world (and the Media Manager) must be left as found ═══════════════════
  try {
    if (modelId) {
      await setCookie().catch(() => {});
      const del = await postJson(`/api/models?id=${encodeURIComponent(modelId)}`, {}, "DELETE");
      if (del.status !== 200 || del.body?.deleted !== true) cleanupProblem = `DELETE → ${del.status} ${JSON.stringify(del.body)}`;
      else if (del.body.mediaDeleted !== true) cleanupProblem = `record deleted but the media file was not (${JSON.stringify(del.body)})`;
      let still = true;
      for (let i = 0; i < 10 && still; i++) {
        await sleep(800);
        still = (await listMine().catch(() => [])).some((m) => m.id === modelId);
      }
      if (still) cleanupProblem = (cleanupProblem ? cleanupProblem + " · " : "") + "GET still lists the deleted model";
      console.log(`cleanup: DELETE ${del.status} ${JSON.stringify(del.body)} · listed after: ${still}`);
    }
  } catch (e) {
    cleanupProblem = `cleanup threw: ${e?.message ?? e}`;
  }
  await evalJs(`${MS}.clear(), true`).catch(() => {});
  await clearCookie().catch(() => {});
  rmSync(FIX, { recursive: true, force: true });
}
if (cleanupProblem) fail(cleanupProblem);

console.log(
  "PASS: small GLB → CHECK card (exact tris, thumbnail, header) · dense textured → DECIMATED under 100k with its texture · OBJ+MTL → cm guessed, M re-packs" +
    " · 16 MiB refused pre-parse (no network) · anonymous SIGN IN link + 401 · member: allowlist 400s + valid mint + bogus 404 · upload → STORED READY on wixstatic," +
    " listed with facts + seed, served model/gltf-binary CORS *, exporter-generated, compacted, re-POST existing, /plux/models folder · cleanup left nothing",
);
ws.close();
await finishVerify(0);
