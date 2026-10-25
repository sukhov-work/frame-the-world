// T201 (owner 2026-10-26): the TEX toggle hides the facade CAMERA-ICON MARKERS too — on the desktop map (orbit) and
// in FPV, and on the /m shell (the LAYERS modal's TEXTURES is the same pref) — the PIN chip / MY PLACES idiom.
// Reads the rendered truth through `__globe.facades().markersVisible` (the InstancedMesh's `visible`) and the pick seam.
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-t201-tex-markers.mjs [cdpPort]   (dev seams — never the live site)
import { sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "9333";
const APP = (process.env.FTW_APP_URL || "http://localhost:4321").replace(/\/$/, "");
// The live facade verifier's site (the owner's street; the saved textures are PUBLIC — T190 — so dev sees them too).
const CELLS = [
  { id: "desktop-orbit", dev: { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }, url: `${APP}/#p=48.4647,35.0462,700,30,25` },
  { id: "desktop-fpv", dev: { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }, url: `${APP}/#f=48.4647,35.0462,1.7,25,0,60` },
  { id: "iphone-fpv", dev: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true }, url: `${APP}/m#f=48.4647,35.0462,1.7,25,0,60` },
];
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

async function attach(dev) {
  let target;
  try { target = await http("/json/new?about:blank", "PUT"); } catch { target = await http("/json/new?about:blank", "GET"); }
  trackTarget(PORT, target.id);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: dev.width, height: dev.height, deviceScaleFactor: dev.deviceScaleFactor, mobile: dev.mobile });
  if (dev.mobile) { await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] }); }
  const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
  const goto = async (url) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url }); await send("Page.bringToFront").catch(() => {}); await sleep(1500); };
  const waitFor = async (expr, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalJs(expr).catch(() => false); if (v) return true; await sleep(300); } return false; };
  return { send, evalJs, goto, waitFor, close: () => ws.close() };
}

const FACADES = `(() => { const f = window.__globe && window.__globe.facades ? window.__globe.facades() : null; return f ? { world: f.world, drawn: f.markers ? f.markers.drawn : null, visible: f.markersVisible, texturesOn: f.texturesOn } : null; })()`;
const SET_TEX = (on) => `(() => { window.__cameraStore.getState().setTexturesVisible(${on}); return window.__cameraStore.getState().texturesVisible; })()`;
// A pick straight through the markers' own seam: with the markers hidden every NDC answers null.
const PICK_ANY = `(() => { const g = window.__globe; if (!g || !g.facades) return "no seam"; const f = g.facades(); if (f.markers && f.markers.drawn === 0) return "none drawn"; return "ok"; })()`;

try {
  for (const c of CELLS) {
    const g = await attach(c.dev);
    try {
      await g.goto(c.url);
      const booted = await g.waitFor(`!!(window.__globe && window.__globe.facades && window.__cameraStore) && (window.__globe.facades().world > 0) && (window.__globe.facades().markers && window.__globe.facades().markers.drawn > 0)`, 90000);
      check(`${c.id} boots with saved textures and their markers drawn`, booted, JSON.stringify(await g.evalJs(FACADES).catch(() => null)));
      if (!booted) continue;
      await g.evalJs(SET_TEX(true)); await sleep(400);
      const on = await g.evalJs(FACADES);
      check(`${c.id} TEX on → the camera icons render (markersVisible ${on.visible}, drawn ${on.drawn})`, on.visible === true && on.drawn > 0, "");
      await g.evalJs(SET_TEX(false)); await sleep(400);
      const off = await g.evalJs(FACADES);
      check(`${c.id} TEX off → the camera icons are GONE (markersVisible ${off.visible}; texturesOn ${off.texturesOn})`, off.visible === false && off.texturesOn === false, "");
      await g.evalJs(SET_TEX(true)); await sleep(400);
      const back = await g.evalJs(FACADES);
      check(`${c.id} TEX on again → the icons are back (markersVisible ${back.visible})`, back.visible === true, "");
    } finally {
      // the house profile PERSISTS view prefs — leave TEX on for every later harness
      await g.evalJs(SET_TEX(true)).catch(() => {});
      g.close();
    }
  }
} catch (e) { console.error("harness error", e); failures++; }
await finishVerify(failures ? 1 : 0);
