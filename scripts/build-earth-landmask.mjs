// Last baked: 2026-07-11 (git-dated, audit-2 B3) — update this line on regen (a PNG carries no
// header to stamp).
// ONE-TIME BAKE (like build-star-catalog.mjs) — derives public/textures/earth-landmask-8k.png
// from the SHIPPED 8k BMNG colour map, so the mask is registration-PERFECT with the rendered
// coastlines (any external mask misaligns at coast scale). Classifier: BMNG-bathy blue-dominance
// + near-black-lake rule (BMNG paints inland lakes ~black: Baikal (0,8,11), Tanganyika (3,3,5);
// darkest land — Congo forest, taiga — stays ≥ ~30) + ice/gray guards (bright/desaturated → land).
// Prerequisites: `wix dev` on :4321 (serves /textures/earth-color-8k.jpg) + headless Chrome
// (`--headless=new --remote-debugging-port=9333`); run with Node ≥20 `--experimental-websocket`.
// Output lands in the scratchpad path below — review the probes + the PNG, then copy into
// public/textures/. The colour source itself: NASA BMNG July 21600×10800 (record 73751)
// sips-downscaled to 8192×4096 q88.
import { writeFileSync } from "node:fs";
const PORT = "9333";
const URL = "http://localhost:4321/";
const http = (p, m = "GET") => fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }).then((r) => r.json());
let target;
try { target = await http("/json/new?about:blank", "PUT"); } catch { target = await http("/json/new?about:blank", "GET"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr, timeout = 300000) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
await send("Page.enable"); await send("Runtime.enable");
// A lightweight same-origin page (do NOT boot the globe) — the 404 page serves fine.
await send("Page.navigate", { url: URL + "__mask_job__" });
await new Promise((r) => setTimeout(r, 1500));

const result = await evalJs(`(async () => {
  const img = await createImageBitmap(await (await fetch("/textures/earth-color-8k.jpg")).blob());
  const W = img.width, H = img.height;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0); img.close();
  const id = cx.getImageData(0, 0, W, H);
  const d = id.data;
  const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
  const score = (r, g, b) => {
    const m = b - Math.max(r, g);                 // blue dominance (BMNG water is bathy-blue)
    let s = clamp01((m - 2) / 10);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const v = mx / 255, sat = mx > 0 ? (mx - mn) / mx : 0;
    if (v > 0.82) s *= clamp01((0.9 - v) / 0.08); // bright ice/snow → land
    if (sat < 0.12) s *= sat / 0.12;              // gray glacier/rock → land
    if (b < 20) s *= b / 20;                      // near-black noise guard
    // BMNG renders inland lakes ~BLACK (Baikal (0,8,11), Superior (9,20,3), Tanganyika (3,3,5))
    // with JPEG chroma noise destroying the hue — near-black IS water; the darkest land
    // (Congo forest 37, Siberian taiga 47) stays above the band.
    const dark = clamp01((28 - mx) / 12);
    return Math.max(s, dark);
  };
  // sanity probes (name, lat, lon, expect)
  const probes = [
    ["Atlantic", 0, -30, "water"], ["Pacific", -20, -140, "water"], ["Barents", 74, 35, "water"],
    ["BlackSea", 43, 34, "water"], ["Caspian", 42, 50, "water"], ["Baikal", 53.5, 108.5, "water"],
    ["Azov", 46.2, 36.6, "water"], ["Mediterr", 35, 18, "water"],
    ["Sahara", 23, 10, "land"], ["Amazon", -5, -60, "land"], ["Himalaya", 30, 85, "land"],
    ["GreenlandIce", 72, -40, "land"], ["Antarctica", -80, 90, "land"], ["Iceland", 64.8, -18, "land"],
    ["UkraineSteppe", 48.6, 35, "land"], ["Andes", -20, -68, "land"],
    ["ArcticPackIce", 87, 0, "?"], ["Bahamas", 23.9, -77.9, "?"],
  ];
  const report = probes.map(([name, lat, lon, exp]) => {
    const x = Math.round(((lon + 180) / 360) * W), y = Math.round(((90 - lat) / 180) * H);
    const i = (y * W + x) * 4;
    return { name, exp, rgb: [d[i], d[i + 1], d[i + 2]], score: +score(d[i], d[i + 1], d[i + 2]).toFixed(2) };
  });
  // classify all pixels → write gray into the canvas (land=white ⇒ 1−water, matching the boot mask)
  for (let i = 0; i < d.length; i += 4) {
    const s = Math.round((1 - score(d[i], d[i + 1], d[i + 2])) * 255);
    d[i] = d[i + 1] = d[i + 2] = s; d[i + 3] = 255;
  }
  cx.putImageData(id, 0, 0);
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  return { report, size: blob.size, b64 };
})()`);
console.log("probes:");
for (const p of result.report) console.log(" ", JSON.stringify(p));
console.log("mask png bytes:", result.size);
// Repo-relative output (audit B6 2026-08-13 — was a dead machine/session scratchpad path).
writeFileSync(new URL("../public/textures/earth-landmask-8k.png", import.meta.url), Buffer.from(result.b64, "base64"));
console.log("saved earth-landmask-8k.png");
ws.close();
process.exit(0);
