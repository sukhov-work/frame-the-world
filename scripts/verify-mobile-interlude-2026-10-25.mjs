// Browser verification of the 2026-10-25 mobile interlude (owner: iPhone 17 Pro first, Pixel 6 Pro consistent).
//   1. THE MINI-MAP'S RADAR WEARS THE MAIN MAP'S STROKES — the direction line (the target ray), the focal-cone
//      legs and the rim arcs on the FPV mini-map measure the SAME CSS px as the GL fan on the /m map. Measured on
//      the composited glass (a device-scale PNG, decoded with sharp): a ring between the sun and the target bands,
//      where only the direction lines cross, gives the ray / leg widths (the rim arcs follow the same radius-
//      fraction rule — `fanStrokeCssPx` — and are pinned by the unit test; a glass reader cannot separate a
//      1.5 px rim from the band fill's edge). The chart (the fullscreen map) wears the same weights since
//      2026-10-25b (the owner: every mobile surface consistent); the desktop mini-map must NOT move.
//   2. THE PEEK ROW'S ALMANAC — ☀ and ☾ rise / set ride the target row permanently, the tracked object's own
//      pair beside them (dropped when the object IS the sun or the moon); the row is not one pixel taller, never
//      overflows, the name stays readable on 402 / 412 / 360 px wide twins.
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-mobile-interlude-2026-10-25.mjs [cdpPort] [--legs 1,2] [--baseline]
//   --baseline prints the measurements as INFO only (run BEFORE the change to record the "before").
// Screenshots → verify-shots/mobile-interlude-2026-10-25/ (git-ignored). Runs on the ONE house Chrome.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const LEGS = (args.includes("--legs") ? args[args.indexOf("--legs") + 1] : "1,2").split(",");
const BASELINE = args.includes("--baseline");
const SHOTS = "verify-shots/mobile-interlude-2026-10-25";
mkdirSync(SHOTS, { recursive: true });
const APP = (process.env.FTW_APP_URL || "http://localhost:4321").replace(/\/$/, "");
// 2026-08-21T09:40Z ≈ solar noon in Dnipro (lon 35.05° → 12:00 − 2 h 20 m): the sun due SOUTH, so its
// direction line runs straight DOWN a north-up surface — clear of the side chrome on every twin.
const NOON_UTC = 1787305200000;
const M_FPV = `${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const M_MAP = `${APP}/m#p=48.4640,35.0460,2200,0,0&t=${NOON_UTC}`;
const D_FPV = `${APP}/#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const BOOT_MS = 60_000;

const DEVICES = {
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  pixel: { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true },
  narrow: { width: 360, height: 780, deviceScaleFactor: 3, mobile: true },
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false },
};

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const info = (name, detail = "") => console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
console.log(`target ${APP} · legs ${LEGS.join(",")}${BASELINE ? " · BASELINE (info only)" : ""}`);

// ---- CDP plumbing (the house idiom; a FRESH target per page) ----------------------------------
async function attach(device) {
  const dev = DEVICES[device];
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: dev.width, height: dev.height, deviceScaleFactor: dev.deviceScaleFactor, mobile: dev.mobile });
  if (dev.mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  }
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  /** A device-scale PNG of the glass, decoded to raw RGBA (what the owner's eye gets). */
  const glass = async (name) => {
    await send("Page.bringToFront").catch(() => {});
    const r = await send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(r.data, "base64");
    if (name) {
      writeFileSync(`${SHOTS}/${name}.png`, buf);
      console.log(`shot  ${SHOTS}/${name}.png`);
    }
    const { data, info: meta } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, W: meta.width, H: meta.height, ch: meta.channels };
  };
  const shoot = async (name) => {
    await send("Page.bringToFront").catch(() => {});
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
    writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
    console.log(`shot  ${SHOTS}/${name}.jpeg`);
  };
  const goto = async (url, settleMs = 1500) => {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await send("Page.navigate", { url });
    await send("Page.bringToFront").catch(() => {});
    await sleep(settleMs);
  };
  const waitFor = async (expr, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await evalJs(expr).catch(() => false);
      if (v) return true;
      await sleep(250);
    }
    return false;
  };
  const rect = (sel) =>
    evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, text: el.textContent.trim(), cls: el.className }; })()`);
  const tap = async (x, y, holdMs = 60) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await sleep(holdMs);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const click = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const tapSel = async (sel) => {
    const r = await rect(sel);
    if (!r) return false;
    await (dev.mobile ? tap(r.x + r.w / 2, r.y + r.h / 2) : click(r.x + r.w / 2, r.y + r.h / 2));
    return true;
  };
  const close = () => ws.close();
  return { dev, send, evalJs, glass, shoot, goto, waitFor, rect, tap, click, tapSel, close };
}

// ---- in-page probes -----------------------------------------------------------------------------
/** Track the SUN (due south at the pose — a full-alpha ray straight down), radar master + target line on.
 *  A SkyTarget carries a method, so the page imports `bodyTarget` from its own module (the house idiom). */
const TRACK = (id) => `(async () => {
  const s = window.__skyStore?.getState(); if (!s) return "no store";
  const m = await import("/src/lib/ephemeris/targets.ts");
  s.setTarget(m.bodyTarget(${JSON.stringify(id)}));
  if (!s.visible) s.setVisible(true);
  if (!s.aimVisible) s.setAimVisible(true);
  if (!s.aimTarget) s.setAimTarget(true);
  return window.__skyStore.getState().target.id;
})()`;
/** The comet (the app's default target) — the house profile keeps the LAST tracked body across runs, so leg 2
 *  sets it explicitly: the three-pair case. */
const TRACK_COMET = `(async () => {
  const s = window.__skyStore?.getState(); if (!s) return "no store";
  const m = await import("/src/lib/ephemeris/targets.ts");
  s.setTarget(m.cometTarget()); if (!s.visible) s.setVisible(true);
  return window.__skyStore.getState().target.id;
})()`;
/** Outside FPV the focal cone draws the PLANNED view — give it one: heading north, 60° wide. */
const PLAN_CONE = `(() => { const c = window.__cameraStore?.getState(); if (!c) return false; c.setPlannedView({ headingDeg: 0, hFovDeg: 60 }); return true; })()`;

// ---- glass readers (node side, raw RGBA) ----------------------------------------------------------
const isCyan = (r, g, b) => g > 120 && b > 110 && g - r > 55 && b - r > 40; // the accent target ray
// The focal-cone ink (#e08fc6 at ~0.8): a MAGENTA test — blue well above green — so the chart's warm satellite imagery
// (brick roofs, a red kiosk: r 170 / g 130 / b 120) never counts; the 10-10 reader's looser test read a 28 px "leg" on the Pixel.
const isPink = (r, g, b) => r > 150 && b > 140 && r - g > 45 && b - g > 25;
/** Runs of cyan / pink ink along a ring of radius R (phys px) about (cx, cy) — only the direction lines cross
 *  a ring between the bands, and they cross it at right angles, so a run's arc length IS the stroke width. */
/** `pinkWhere(thDeg, x, y)` (screen angle 0 = +x / 90 = down; the sample in phys px) limits where PINK counts — on the
 *  /m chart the AIM STICK's knob (lower-left) and the live-3D PiP box (top) both carry the focal-cone ink: the Pixel twin's
 *  ring crossed the PiP, whose FPV view draws the cone's rays, and read a 28 px "leg". */
function ringRuns(img, cx, cy, R, pinkWhere = () => true) {
  const { data, W, H, ch } = img;
  const steps = Math.max(2880, Math.round(2 * Math.PI * R * 4)); // ≥ 4 samples per phys px of arc
  const cls = (x, y, thDeg) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const i = (yi * W + xi) * ch;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isCyan(r, g, b)) return "cyan";
    if (isPink(r, g, b) && pinkWhere(thDeg, xi, yi)) return "pink";
    return null;
  };
  const runs = [];
  let cur = null;
  for (let k = 0; k <= steps; k++) {
    const th = (k / steps) * 2 * Math.PI;
    const kind = k < steps ? cls(cx + R * Math.cos(th), cy + R * Math.sin(th), (th * 180) / Math.PI) : null;
    if (cur && kind === cur.kind) { cur.n++; continue; }
    if (cur) runs.push(cur);
    cur = kind ? { kind, n: 1, th0: th } : null;
  }
  const arc = (2 * Math.PI * R) / steps;
  const best = (kind) => runs.filter((r) => r.kind === kind).sort((a, b) => b.n - a.n)[0] ?? null;
  const out = (r) => (r ? { widthPx: +(r.n * arc).toFixed(2), thDeg: +(((r.th0 + (r.n * arc) / (2 * R)) * 180) / Math.PI).toFixed(1) } : null);
  return { cyan: out(best("cyan")), pink: out(best("pink")), cyanRuns: runs.filter((r) => r.kind === "cyan").length, pinkRuns: runs.filter((r) => r.kind === "pink").length };
}
const css = (phys, dpr) => +(phys / dpr).toFixed(2);

// ================================================================================================
const results = {};

// ── 1. THE STROKES — the GL fan on the /m map · the FPV mini-map · the fullscreen chart ───────────
if (LEGS.includes("1")) {
  for (const device of ["iphone", "pixel"]) {
    const dpr = DEVICES[device].deviceScaleFactor;
    const out = (results[device] = {});
    // (a) the GL fan at nadir on the /m map — the owner's "main map"
    {
      const g = await attach(device);
      await g.goto(M_MAP, 1500);
      check(`1.${device}a the /m map boots with the aim radar seam`, await g.waitFor(`!!window.__globe?.aimRadar && !!window.__cameraStore?.getState()`, BOOT_MS));
      await g.evalJs(TRACK("sun"));
      await g.evalJs(PLAN_CONE);
      await sleep(3500);
      const fan = await g.evalJs(`window.__globe.aimRadar()`);
      const vh = DEVICES[device].height;
      // The fan's on-screen radius: radiusM over the metres per CSS px at nadir (vertical FOV 38°, the camera's
      // geodetic altitude from the pose; the ground is ~85 m up at Dnipro — read live).
      const cam = await g.evalJs(`(() => { const c = window.__cameraStore.getState(); return { alt: c.altitudeM ?? c.focusAltM ?? null, keys: Object.keys(c).filter((k) => /alt|Alt/.test(k)).slice(0, 8) }; })()`);
      info(`1.${device}a fan`, `radiusM ${fan.radiusM?.toFixed?.(0)} · widthK ${fan.widthK} · rayK ${fan.rayK} · cam ${JSON.stringify(cam)}`);
      const img = await g.glass(`01-${device}-map-fan`);
      // Rings between the sun band (outer 0.42 R) and the target band (inner 0.46 R) on /m: the radius is
      // scanned over the plausible band of R (0.36–0.46 × view height) and the ring with ONE cyan run wins.
      const cx = (DEVICES[device].width / 2) * dpr, cy = (vh / 2) * dpr;
      let pick = null;
      for (const rk of [0.36, 0.38, 0.4, 0.42, 0.44, 0.46]) {
        const R = 0.44 * rk * vh * dpr;
        const rr = ringRuns(img, cx, cy, R);
        if (rr.cyan && rr.cyanRuns <= 2 && (!pick || (rr.pink && !pick.pink))) pick = { rk, R, ...rr };
      }
      out.fan = pick;
      info(`1.${device}a GL fan on glass`, pick ? `ray ${pick.cyan.widthPx} phys = ${css(pick.cyan.widthPx, dpr)} css px @${pick.cyan.thDeg}° · cone leg ${pick.pink ? `${pick.pink.widthPx} phys = ${css(pick.pink.widthPx, dpr)} css px` : "none"} · ring ${pick.R.toFixed(0)} phys (R ≈ ${(pick.rk * vh).toFixed(0)} css)` : "no cyan run found");
      g.close();
    }
    // (b) the FPV mini-map — the canvas store AND the glass
    {
      const m = await attach(device);
      await m.goto(M_FPV, 1500);
      check(`1.${device}b FPV boots with the mini-map`, await m.waitFor(`!!document.querySelector(".mm-canvas") && !!window.__cameraStore?.getState().camGeo`, BOOT_MS));
      await m.evalJs(TRACK("sun"));
      await sleep(3000);
      const r = await m.rect(".mm-canvas");
      const store = await m.evalJs(`(() => { const c = document.querySelector(".mm-canvas"); return { w: c.width, css: c.getBoundingClientRect().width }; })()`);
      const img = await m.glass(`02-${device}-fpv-minimap`);
      const cx = (r.x + r.w / 2) * dpr, cy = (r.y + r.h / 2) * dpr;
      const Rc = 0.44 * 0.44 * r.w * dpr; // the band gap on the mini-map (rBase = 0.44 × the canvas)
      const rr = ringRuns(img, cx, cy, Rc);
      out.mini = { store: store.w, css: store.css, ...rr };
      info(`1.${device}b mini-map on glass`, `store ${store.w} px for ${store.css} css · ray ${rr.cyan ? `${rr.cyan.widthPx} phys = ${css(rr.cyan.widthPx, dpr)} css px @${rr.cyan.thDeg}°` : "none"} · cone leg ${rr.pink ? `${rr.pink.widthPx} phys = ${css(rr.pink.widthPx, dpr)} css px` : "none"}`);
      // (c) the fullscreen chart — tap the patch
      check(`1.${device}c the mini-map opens the fullscreen chart`, (await m.tapSel(".mm-open")) && (await m.waitFor(`!!document.querySelector(".mw-canvas")`, 8000)));
      await sleep(3000);
      const cr = await m.rect(".mw-canvas");
      const cimg = await m.glass(`03-${device}-chart`);
      const ccx = (cr.x + cr.w / 2) * dpr, ccy = (cr.y + cr.h / 2) * dpr;
      const Rchart = 0.44 * (cr.h * 0.5 * 0.8) * dpr; // rBase = h × 0.5 × 0.8 on /m
      // The FPV cone (heading 25°, 60° wide) points UP the north-up chart — its legs cross the ring's upper half;
      // the lower-left holds the aim stick's pink knob and the top the PiP box (its FPV view draws the cone's rays).
      const pip = await m.rect(".mw-pip");
      const inPip = (x, y) => !!pip && x >= (pip.x - 2) * dpr && x <= (pip.right + 2) * dpr && y >= (pip.y - 2) * dpr && y <= (pip.bottom + 2) * dpr;
      const crr = ringRuns(cimg, ccx, ccy, Rchart, (th, x, y) => th > 180 && th < 360 && !inPip(x, y));
      info(`1.${device}c PiP box`, pip ? `${pip.x.toFixed(0)},${pip.y.toFixed(0)} ${pip.w.toFixed(0)}×${pip.h.toFixed(0)} css` : "none");
      const cstore = await m.evalJs(`(() => { const c = document.querySelector(".mw-canvas"); return { w: c.width, css: c.getBoundingClientRect().width }; })()`);
      out.chart = { store: cstore.w, css: cstore.css, ...crr };
      info(`1.${device}c chart on glass`, `store ${cstore.w} px for ${cstore.css} css · ray ${crr.cyan ? `${crr.cyan.widthPx} phys = ${css(crr.cyan.widthPx, dpr)} css px @${crr.cyan.thDeg}°` : "none"} · cone leg ${crr.pink ? `${crr.pink.widthPx} phys = ${css(crr.pink.widthPx, dpr)} css px` : "none"}`);
      m.close();
    }
    if (!BASELINE) {
      const f = out.fan, mi = out.mini, ch = out.chart;
      // The threshold reader's AA noise is ±0.4 css px across the twins (the SAME nominal fan read 2.67 on the
      // iPhone and 3.43 on the Pixel), so the fan↔mini-map match is judged at 0.75, and the mini-map must
      // also sit in the fan's nominal band (2.5–3.6 line · 3.2–4.6 legs) — clearly past its old 1.4–1.7 / 2.1.
      const fanLine = f?.cyan ? css(f.cyan.widthPx, dpr) : null, miniLine = mi.cyan ? css(mi.cyan.widthPx, dpr) : null;
      const fanCone = f?.pink ? css(f.pink.widthPx, dpr) : null, miniCone = mi.pink ? css(mi.pink.widthPx, dpr) : null;
      check(`1.${device}d the mini-map's direction line is the GL fan's (± 0.75 css px, inside 2.5–3.6)`, fanLine != null && miniLine != null && Math.abs(fanLine - miniLine) <= 0.75 && miniLine >= 2.5 && miniLine <= 3.6, `fan ${fanLine} · mini ${miniLine} css px`);
      check(`1.${device}e the mini-map's cone legs are the GL fan's (± 0.75 css px, inside 3.2–4.6)`, fanCone != null && miniCone != null && Math.abs(fanCone - miniCone) <= 0.75 && miniCone >= 3.2 && miniCone <= 4.6, `fan ${fanCone} · mini ${miniCone} css px`);
      // 2026-10-25b (owner: "consistently thick and stylised … across all mobile surfaces"): the chart too. Its store is
      // capped at 2× and upscaled onto a DPR-3 / 3.5 glass, so the threshold reader sees the bilinear shoulders: judged at
      // ± 0.9 of the fan and inside 2.5–3.9 (it read 1.67 / 1.71 before).
      const chartLine = ch.cyan ? css(ch.cyan.widthPx, dpr) : null, chartCone = ch.pink ? css(ch.pink.widthPx, dpr) : null;
      check(`1.${device}f the chart's direction line is the GL fan's too (± 0.9 css px, inside 2.5–3.9)`, fanLine != null && chartLine != null && Math.abs(fanLine - chartLine) <= 0.9 && chartLine >= 2.5 && chartLine <= 3.9, `fan ${fanLine} · chart ${chartLine} css px`);
      check(`1.${device}g the chart's cone legs are the GL fan's too (± 0.9 css px, inside 3.2–4.9)`, fanCone != null && chartCone != null && Math.abs(fanCone - chartCone) <= 0.9 && chartCone >= 3.2 && chartCone <= 4.9, `fan ${fanCone} · chart ${chartCone} css px`);
    }
  }
  if (!BASELINE && results.iphone?.mini?.cyan && results.pixel?.mini?.cyan) {
    const a = css(results.iphone.mini.cyan.widthPx, 3), b = css(results.pixel.mini.cyan.widthPx, 3.5);
    check("1.parity the iPhone and the Pixel mini-maps draw the ray at the SAME css width (± 0.45)", Math.abs(a - b) <= 0.45, `iPhone ${a} · Pixel ${b} css px`);
  }
  // the desktop mini-map must not move (byte-identical policy): the canvas store's own ink
  {
    const d = await attach("desktop");
    await d.goto(D_FPV, 1500);
    check("1.desktop FPV boots with the mini-map", await d.waitFor(`!!document.querySelector(".mm-canvas") && !!window.__cameraStore?.getState().camGeo`, BOOT_MS));
    await d.evalJs(TRACK("sun"));
    await sleep(2500);
    const probe = await d.evalJs(`(() => {
      const c = document.querySelector(".mm-canvas"); const ctx = c.getContext("2d"); const W = c.width, H = c.height;
      const R = W * 0.525 * 0.44; const cx = W / 2, cy = H / 2; const img = ctx.getImageData(0, 0, W, H).data;
      const cls = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
        const i = (yi * W + xi) * 4; const r = img[i], g = img[i + 1], b = img[i + 2];
        if (g > 120 && b > 110 && g - r > 55 && b - r > 40) return "cyan"; if (r > 140 && b > 100 && r - g > 40) return "pink"; return null; };
      const steps = 2880; const runs = []; let cur = null;
      for (let k = 0; k <= steps; k++) { const th = (k / steps) * 2 * Math.PI; const kind = k < steps ? cls(cx + R * Math.cos(th), cy + R * Math.sin(th)) : null;
        if (cur && kind === cur.kind) { cur.n++; continue; } if (cur) runs.push(cur); cur = kind ? { kind, n: 1 } : null; }
      const arc = (2 * Math.PI * R) / steps; const best = (kind) => runs.filter((r) => r.kind === kind).sort((a, b) => b.n - a.n)[0] ?? null;
      return { W, cyan: best("cyan") ? +(best("cyan").n * arc).toFixed(2) : null, pink: best("pink") ? +(best("pink").n * arc).toFixed(2) : null }; })()`);
    info("1.desktop mini-map store", JSON.stringify(probe));
    if (!BASELINE) check("1.desktop the desktop mini-map is unchanged: a 1 css px ray (2 store px), 1.5 css px legs (3)", probe.W === 400 && probe.cyan != null && probe.cyan >= 1.2 && probe.cyan <= 3.6 && probe.pink != null && probe.pink >= 2 && probe.pink <= 4.6, JSON.stringify(probe));
    await d.shoot("04-desktop-minimap");
    d.close();
  }
}

// ── 2. THE PEEK ROW'S ALMANAC ────────────────────────────────────────────────────────────────────
const PEEK = `(() => {
  const row = document.querySelector(".m-peek"); if (!row) return null;
  const r = row.getBoundingClientRect(); const name = row.querySelector(".m-peek__name"); const nr = name.getBoundingClientRect();
  const cells = [...row.querySelectorAll(".m-peek__alm-cell, .m-peek__rs")];
  const glyphs = [...row.querySelectorAll(".m-peek__alm-glyph")].map((g) => g.textContent.replace(/\uFE0E/g, "").trim());
  // The name's BUDGET: its own width plus the slack between the badge (or the name) and the almanac — what a
  // long name could grow into before the ellipsis.
  const badge = row.querySelector(".m-badge")?.getBoundingClientRect() ?? nr;
  const alm = row.querySelector(".m-peek__alm")?.getBoundingClientRect();
  const nameBudget = alm ? +(nr.width + (alm.left - badge.right - 10)).toFixed(1) : null;
  const times = [...row.querySelectorAll(".m-peek__alm-t, .m-peek__rs-row")].map((t) => t.textContent.trim());
  const pos = row.querySelector(".m-peek__pos")?.getBoundingClientRect();
  return { h: +r.height.toFixed(2), w: +r.width.toFixed(1), overflow: row.scrollWidth - row.clientWidth, name: name.textContent, nameW: +nr.width.toFixed(1),
    nameClipped: name.scrollWidth > name.clientWidth + 1, nameBudget, cells: cells.length, glyphs, times, posW: pos ? +pos.width.toFixed(1) : null, label: row.getAttribute("aria-label") };
})()`;
if (LEGS.includes("2")) {
  for (const device of ["iphone", "pixel", "narrow"]) {
    const m = await attach(device);
    await m.goto(M_MAP, 1500);
    check(`2.${device}a the /m shell boots with the target peek row`, await m.waitFor(`!!document.querySelector(".m-peek") && !!window.__skyStore`, BOOT_MS));
    await m.evalJs(TRACK_COMET);
    await sleep(1200);
    const comet = await m.evalJs(PEEK); // the comet → three pairs on the new code
    info(`2.${device} comet (default)`, JSON.stringify(comet));
    const r = await m.rect(".m-bottom");
    await m.send("Page.bringToFront").catch(() => {});
    {
      const shot = await m.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8, scale: 1 } });
      writeFileSync(`${SHOTS}/05-${device}-peek-comet.png`, Buffer.from(shot.data, "base64"));
      console.log(`shot  ${SHOTS}/05-${device}-peek-comet.png`);
    }
    await m.evalJs(TRACK("sun"));
    await sleep(800);
    const sun = await m.evalJs(PEEK);
    info(`2.${device} sun tracked`, JSON.stringify(sun));
    await m.evalJs(TRACK("moon"));
    await sleep(800);
    const moon = await m.evalJs(PEEK);
    info(`2.${device} moon tracked`, JSON.stringify(moon));
    {
      const shot = await m.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8, scale: 1 } });
      writeFileSync(`${SHOTS}/06-${device}-peek-moon.png`, Buffer.from(shot.data, "base64"));
      console.log(`shot  ${SHOTS}/06-${device}-peek-moon.png`);
    }
    if (!BASELINE) {
      // The bar's height is the owner's hard line. The 2026-10-25 BASELINE read 38.56 px on every twin (0.5rem
      // pads + the two 0.56rem / 1.15 rows + the 1 px border); the almanac reads 38.59 — the old pair's baseline-
      // aligned rows were 0.03 CSS px shorter than two pure line boxes. 0.03 CSS px is 0.09 of a device pixel on
      // DPR 3: no pixel moves. The gate is the baseline + 0.1 px.
      const CEIL = 38.56 + 0.1;
      check(`2.${device}b the row is not a pixel taller than before (baseline 38.56 px; ≤ ${CEIL.toFixed(2)})`, comet.h <= CEIL && sun.h <= CEIL && moon.h <= CEIL, `comet ${comet.h} · sun ${sun.h} · moon ${moon.h} px`);
      check(`2.${device}c three pairs for the comet (☀ ☾ ☄), two when the sun or the moon is tracked`, comet.cells === 3 && sun.cells === 2 && moon.cells === 2 && comet.glyphs.join("") === "☀☾☄" && sun.glyphs.join("") === "☀☾" && moon.glyphs.join("") === "☀☾", `comet ${comet.glyphs.join("")} · sun ${sun.glyphs.join("")} · moon ${moon.glyphs.join("")}`);
      check(`2.${device}d the row never overflows and the name stays readable (not clipped at the comet's 3 pairs; a 6-character budget ≥ 44 px)`, comet.overflow <= 0 && sun.overflow <= 0 && moon.overflow <= 0 && !comet.nameClipped && comet.nameBudget != null && comet.nameBudget >= 44, `overflow ${comet.overflow}/${sun.overflow}/${moon.overflow} · name "${comet.name}" ${comet.nameW} px clipped ${comet.nameClipped} · budget ${comet.nameBudget} px`);
      check(`2.${device}e every pair prints two clocks (rise / set) and the aria-label names the bodies`, comet.times.length === 6 && /Sun rise .*Moon rise .*10P rise /.test(comet.label ?? "") && !/—/.test(comet.label ?? ""), `times ${comet.times.join(" | ")} · label ${comet.label}`);
    }
    m.close();
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
await finishVerify(failures === 0 ? 0 : 1);
