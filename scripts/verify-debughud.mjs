// Scripted-Chrome verification of the DBG debug HUD (owner 2026-09-01; CDP, no deps).
// Asserts, in order:
//   A  boot: globe up, DBG chip rendered in the camera deck, aria-pressed=false, no panel,
//      debugHud pref false (precondition-SET, trap (f): /tmp profile persists prefs).
//   B  chip ON: panel appears (DOM + screenshot), chip lit, pref persisted true.
//   C  live data: the FPS header and the frame-Δt row become numeric and CHANGE between two
//      samples 1.5 s apart (a frozen number is the failure mode screenshots can't catch).
//   D  provider rows: tile-streaming numbers present (gnd visible > 0 after the initial load).
//   E  filter: typing "shadow" collapses the list to the SHADOWS/ULTRA-matching rows.
//   F  actions: SCAN TERRAIN CAST returns a JSON block (⏱ line present).
//   G  chip OFF: panel unmounts, pref false again.
//   H  perf note (report-only): rAF median with the HUD open.
import { writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const URL = "http://localhost:4321/";
const SHOTS = process.argv[3] ?? "verify-shots";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(s.data, "base64"));
};

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });

const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 90_000) throw new Error("globe never booted");
  await sleep(250);
}
console.log(`globe booted after ${Date.now() - t0} ms`);
// Occlusion honesty for every timed read below.
await send("Page.bringToFront");

// Dismiss the WELCOME landing FIRST — it visually covers the chrome, so every screenshot
// below would show the landing while the DOM assertions quietly passed underneath (the
// rendered-truth-vs-DOM trap, caught on this harness's own first run).
await evalJs(`(() => {
  document.querySelector(".wl-btn--primary")?.click();
  return !document.body.classList.contains("welcome-active");
})()`);
await sleep(500);
check("A0 welcome dismissed", await evalJs(`!document.body.classList.contains("welcome-active")`));

// ---- A: off-state (precondition-SET the pref — the /tmp profile persists blobs) -------------
await evalJs(`(() => {
  try {
    const k = "ftw:view-prefs:v1";
    const b = JSON.parse(localStorage.getItem(k) ?? "{}");
    delete b.debugHud;
    localStorage.setItem(k, JSON.stringify(b));
  } catch {}
  if (window.__cameraStore.getState().debugHud) window.__cameraStore.getState().setDebugHud(false);
  return true;
})()`);
await sleep(300);
check("A1 chip rendered", await evalJs(`!!document.querySelector(".ct-dbg")`));
check("A2 chip unlit", await evalJs(`document.querySelector(".ct-dbg")?.getAttribute("aria-pressed") === "false"`));
check("A3 no panel while off", await evalJs(`document.querySelector(".dbg-panel") === null`));
check("A4 pref false", await evalJs(`window.__cameraStore.getState().debugHud === false`));

// ---- B: chip ON ------------------------------------------------------------------------------
await evalJs(`document.querySelector(".ct-dbg").click()`);
await sleep(600);
check("B1 chip lit", await evalJs(`document.querySelector(".ct-dbg")?.className.includes("is-on")`));
check("B2 panel mounted", await evalJs(`!!document.querySelector(".dbg-panel")`));
check(
  "B3 pref persisted true",
  await evalJs(`JSON.parse(localStorage.getItem("ftw:view-prefs:v1") ?? "{}").debugHud === true`),
);

// ---- C: live, MOVING numbers -----------------------------------------------------------------
const readHdr = () =>
  evalJs(`(() => {
    const cells = [...document.querySelectorAll(".dbg-hdr__cell b")].map((b) => b.textContent);
    const dtRow = [...document.querySelectorAll(".dbg-row")].find((r) =>
      r.querySelector(".dbg-row__label")?.textContent === "frame Δt");
    return { fps: cells[0] ?? null, dt: dtRow?.querySelector(".dbg-row__value")?.textContent ?? null };
  })()`);
await sleep(1200); // let the rings fill past the first UI ticks
const s1 = await readHdr();
await sleep(1500);
const s2 = await readHdr();
// Shot AFTER the rings filled — at +600 ms the welcome's exit animation still covered the
// frame and the first run of this harness shipped a screenshot of the landing page.
await shot("debughud-01-open");
check("C1 fps header numeric", /^\d+$/.test(s1.fps ?? ""), `fps=${s1.fps}`);
check("C2 frame Δt row numeric", /ms$/.test(s1.dt ?? ""), `dt=${s1.dt}`);
check("C3 values MOVE between samples", s1.dt !== s2.dt || s1.fps !== s2.fps, `${s1.dt} → ${s2.dt}`);

// ---- D: provider rows carry engine truth -----------------------------------------------------
const gndVisible = await evalJs(`(() => {
  const row = [...document.querySelectorAll(".dbg-row")].find((r) =>
    r.querySelector(".dbg-row__label")?.textContent === "gnd visible");
  return row?.querySelector(".dbg-row__value")?.textContent ?? null;
})()`);
check("D1 gnd visible row numeric+nonzero", /^[1-9]\d*$/.test((gndVisible ?? "").replace(/,/g, "")), `gnd=${gndVisible}`);
const sunElev = await evalJs(`(() => {
  const row = [...document.querySelectorAll(".dbg-row")].find((r) =>
    r.querySelector(".dbg-row__label")?.textContent === "sun elevation");
  return row?.querySelector(".dbg-row__value")?.textContent ?? null;
})()`);
check("D2 astro sun elevation reads deg", /°$/.test(sunElev ?? ""), `sun=${sunElev}`);

// ---- E: filter -------------------------------------------------------------------------------
const totalRows = await evalJs(`document.querySelectorAll(".dbg-row").length`);
await evalJs(`(() => {
  const inp = document.querySelector(".dbg-filter");
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(inp, "shadow");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(300);
const filteredRows = await evalJs(`document.querySelectorAll(".dbg-row").length`);
check("E1 filter narrows the list", filteredRows > 0 && filteredRows < totalRows, `${totalRows} → ${filteredRows}`);
await shot("debughud-02-filter-shadow");
await evalJs(`(() => {
  const inp = document.querySelector(".dbg-filter");
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(inp, "");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(200);

// ---- F: an on-demand action ------------------------------------------------------------------
await evalJs(`(() => {
  const btn = [...document.querySelectorAll(".dbg-btn")].find((b) => b.textContent === "SCAN TERRAIN CAST");
  btn?.click();
  return !!btn;
})()`);
await sleep(400);
const actionOut = await evalJs(`document.querySelector(".dbg-action-out")?.textContent ?? null`);
check("F1 terrain census ran", (actionOut ?? "").startsWith("⏱") && (actionOut ?? "").includes("meshes"), (actionOut ?? "").slice(0, 60));
await shot("debughud-03-action");

// ---- H: perf note (report-only — the owner lifted the fps ceiling for instruments) -----------
// awaitPromise, or Runtime.evaluate returns the PROMISE and every field reads undefined (the
// standing JSON.stringify-an-async-IIFE trap).
const evalAsync = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const frameProbe = await evalAsync(`new Promise((res) => {
  const ds = [];
  let last = performance.now();
  const step = (t) => {
    ds.push(t - last); last = t;
    if (ds.length >= 60) {
      ds.shift();
      const s = [...ds].sort((a, b) => a - b);
      res({ median: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) });
    } else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})`);
console.log(`H  rAF with HUD open: median ${frameProbe.median} ms · p95 ${frameProbe.p95} ms (report-only)`);

// ---- G: chip OFF -----------------------------------------------------------------------------
await evalJs(`document.querySelector(".ct-dbg").click()`);
await sleep(400);
check("G1 panel unmounted", await evalJs(`document.querySelector(".dbg-panel") === null`));
check(
  "G2 pref persisted false",
  await evalJs(`JSON.parse(localStorage.getItem("ftw:view-prefs:v1") ?? "{}").debugHud === false`),
);
await shot("debughud-04-closed");

console.log(failures.length ? `FAIL (${failures.length}): ${failures.join("; ")}` : "ALL PASS");
ws.close();
await finishVerify(failures.length ? 1 : 0);
