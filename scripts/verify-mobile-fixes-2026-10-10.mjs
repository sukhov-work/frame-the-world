// Browser verification of the 2026-10-10 mobile fixes (owner: iPhone 17 Pro + Pixel 6 Pro screens).
//   1. THE RADAR ON GLASS — every stroke authored in SCREEN CSS px, the mini-map's store sized to
//      the glass, the /m stroke profile (×1.4 width, lifted inks) on the mini-map, the chart AND
//      the GL fan (rim + spokes are quads now); desktop byte-identical. Measured by reading the
//      2D canvases' own pixels along a ring between the bands (only the direction lines cross it)
//      on the iPhone twin, the Pixel twin and the desktop twin — parity in CSS px.
//   2. THE DIALS ALWAYS LEAVE THE SCREEN — the chart's target ray after a long pan (the anchor
//      off the canvas), the GL fan's ray at nadir and at the 3D tilt (`__globe.aimRadar()`).
//   3. FIND THIS ONE — ⌖ FIND IN FRAME on the target sheet scans the named object ALONE; the
//      1W · 1M · 6M · 1Y chips share its row, disabled until that scan is on; the FIND tab agrees.
//   4. THE SAVE VIEW SHEET RIDES ABOVE THE KEYBOARD — signed in, a synthetic visualViewport
//      shrink lifts the sheet by the inset (the owner's Pixel showed it hidden behind the keys).
//   5. The desktop twin — the TARGET panel's row + solo rule, the mini-map's unchanged weights.
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-mobile-fixes-2026-10-10.mjs [cdpPort] [--legs 1,2,3,4,5]
// Screenshots → verify-shots/mobile-fixes-2026-10-10/ (git-ignored). Runs on the ONE house Chrome.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const LEGS = (args[args.indexOf("--legs") + 1] && args.includes("--legs") ? args[args.indexOf("--legs") + 1] : "1,2,3,4,5").split(",");
const SHOTS = "verify-shots/mobile-fixes-2026-10-10";
mkdirSync(SHOTS, { recursive: true });
const APP = (process.env.FTW_APP_URL || "http://localhost:4321").replace(/\/$/, "");
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — 15:00 in Dnipro, the sun well up
const M_FPV = `${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const M_MAP = `${APP}/m#p=48.4640,35.0460,2200,0,0&t=${NOON_UTC}`;
const D_FPV = `${APP}/#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const D_MAP = `${APP}/#p=48.4640,35.0460,2200,0,0&t=${NOON_UTC}`;
const BOOT_MS = 60_000;
// The tuning the checks pin (read the live tuning if it ever moves): AIMCONES.mobileStroke + strokePx.
const STROKE_PX = 1;
const MOBILE_WIDTH_K = 1.4;
const CONE_LEG_K = 1.5; // the mini-map's legs are 1.5 × the radar line (the GL 1.25× rule, rounded there)

const DEVICES = {
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  pixel: { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true },
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false },
};

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const info = (name, detail = "") => console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
console.log(`target ${APP} · legs ${LEGS.join(",")}`);

async function mintCookie() {
  const env = readFileSync(".env.local", "utf-8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const clientId = get("WIX_CLIENT_ID");
  const email = get("TEST_MEMBER_EMAIL");
  const password = get("TEST_MEMBER_PASSWORD");
  if (!clientId || !email || !password) throw new Error("WIX_CLIENT_ID / TEST_MEMBER_* missing from .env.local");
  const client = createClient({ auth: OAuthStrategy({ clientId }) });
  const login = await client.auth.login({ email, password });
  if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
  const REDIRECT = `${APP}/api/auth/callback`;
  const oauthData = client.auth.generateOAuthData(REDIRECT, APP + "/");
  const authorizeUrl =
    `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
    `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
    `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
  const authRes = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = authRes.headers.get("location");
  if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
  const code = new URL(loc).searchParams.get("code");
  const state = new URL(loc).searchParams.get("state");
  const tokens = await client.auth.getMemberTokens(code, state, oauthData);
  return encodeURIComponent(JSON.stringify({ clientId, tokens }));
}

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
  await send("Network.enable");
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
  /** A one-finger drag in N steps (the chart pan gesture). */
  const drag = async (x0, y0, x1, y1, steps = 12) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id: 1 }] });
      await sleep(16);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(200);
  };
  const seedCookie = async (cookieVal) => {
    await send("Network.setCookie", { name: "wixSession", value: cookieVal, url: APP + "/", path: "/" });
  };
  const close = () => ws.close();
  return { dev, send, evalJs, shoot, goto, waitFor, rect, tap, click, tapSel, drag, seedCookie, close };
}

// ---- in-page probes -----------------------------------------------------------------------------
/** Track the SUN (well up at the noon pose — a full-alpha ray), radar master + target line on.
 *  A SkyTarget carries a method (`stateAt`), so it cannot be injected as JSON: the dev server
 *  serves the app's own module, and the page imports `bodyTarget` from it (the same instance). */
const TRACK_SUN = `(async () => {
  const s = window.__skyStore?.getState(); if (!s) return "no store";
  const m = await import("/src/lib/ephemeris/targets.ts");
  s.setTarget(m.bodyTarget("sun"));
  if (!s.visible) s.setVisible(true);
  if (!s.aimVisible) s.setAimVisible(true);
  if (!s.aimTarget) s.setAimTarget(true);
  return window.__skyStore.getState().target.id;
})()`;
/** Runs of ink along a ring between the sun and the target bands of a 2D radar canvas — only the
 *  direction lines (cyan target ray, pink focal-cone legs) cross it. Widths in STORE px. */
const ringProbe = (sel, ringK, centre) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return { err: "no canvas" };
  const ctx = c.getContext("2d"); const W = c.width, H = c.height;
  const rBase = ${centre === "square" ? "W * 0.44" : "H * 0.5 * 0.8"};
  const R = rBase * ${ringK};
  const cx = W / 2, cy = H / 2;
  const img = ctx.getImageData(0, 0, W, H).data;
  const cls = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const i = (yi * W + xi) * 4; const r = img[i], g = img[i + 1], b = img[i + 2];
    if (g > 120 && b > 110 && g - r > 55 && b - r > 40) return "cyan";
    if (r > 140 && b > 100 && r - g > 40) return "pink"; return null; };
  const steps = 2880; const runs = []; let cur = null;
  for (let k = 0; k <= steps; k++) { const th = (k / steps) * 2 * Math.PI; const kind = k < steps ? cls(cx + R * Math.cos(th), cy + R * Math.sin(th)) : null;
    if (cur && kind === cur.kind) { cur.n++; continue; } if (cur) runs.push(cur); cur = kind ? { kind, n: 1, th0: th } : null; }
  const arc = (2 * Math.PI * R) / steps;
  const best = (kind) => runs.filter((r) => r.kind === kind).sort((a, b) => b.n - a.n)[0] ?? null;
  const out = (r) => (r ? { widthPx: +(r.n * arc).toFixed(2), thDeg: +((r.th0 + (r.n * arc) / (2 * R)) * 180 / Math.PI).toFixed(1) } : null);
  return { W, H, store: W, css: c.getBoundingClientRect().width, dpr: +(W / c.getBoundingClientRect().width).toFixed(3), R, cyan: out(best("cyan")), pink: out(best("pink")), runs: runs.length };
})()`;
/** Walk the cyan ray outward from (ax, ay) [store px] along thDeg to the canvas edge: the share of
 *  samples that are cyan past r0 and whether the LAST in-canvas samples are. */
const rayProbe = (sel, ax, ay, thDeg, r0) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return { err: "no canvas" };
  const ctx = c.getContext("2d"); const W = c.width, H = c.height; const img = ctx.getImageData(0, 0, W, H).data;
  const th = ${thDeg} * Math.PI / 180; const dx = Math.cos(th), dy = Math.sin(th);
  const isCyan = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    // the ray is a few px wide: look ±3 px across it
    for (let o = -3; o <= 3; o++) { const px = Math.round(x - dy * o), py = Math.round(y + dx * o); if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 4; const r = img[i], g = img[i + 1], b = img[i + 2]; if (g > 120 && b > 110 && g - r > 55 && b - r > 40) return true; }
    return false; };
  let n = 0, hit = 0, lastIn = -1; const tail = [];
  for (let r = ${r0}; r < 6000; r += 2) { const x = ${ax} + dx * r, y = ${ay} + dy * r; const v = isCyan(x, y); if (v === null) { if (lastIn >= 0) break; continue; }
    n++; if (v) hit++; lastIn = r; tail.push(v); if (tail.length > 8) tail.shift(); }
  return { samples: n, share: n ? +(hit / n).toFixed(3) : 0, lastInPx: lastIn, tailCyan: tail.filter(Boolean).length, tailN: tail.length };
})()`;

/** Cyan ink on the canvas BORDER (2 px inside each edge): a ray that reaches the edge leaves a run
 *  there; one that ends inside the canvas leaves none. Only the target ray is cyan on the chart. */
const borderProbe = (sel) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return { err: "no canvas" };
  const ctx = c.getContext("2d"); const W = c.width, H = c.height; const img = ctx.getImageData(0, 0, W, H).data;
  const cyan = (x, y) => { const i = (y * W + x) * 4; const r = img[i], g = img[i + 1], b = img[i + 2]; return g > 120 && b > 110 && g - r > 55 && b - r > 40; };
  const pts = []; const d = 2;
  for (let x = 0; x < W; x++) { pts.push([x, d]); } for (let y = 0; y < H; y++) { pts.push([W - 1 - d, y]); }
  for (let x = W - 1; x >= 0; x--) { pts.push([x, H - 1 - d]); } for (let y = H - 1; y >= 0; y--) { pts.push([d, y]); }
  let runs = 0, maxRun = 0, cur = 0, where = null;
  for (const [x, y] of pts) { if (cyan(x, y)) { if (cur === 0) runs++; cur++; if (cur > maxRun) { maxRun = cur; where = [x, y]; } } else cur = 0; }
  return { runs, maxRun, where, W, H };
})()`;

// ================================================================================================
const expectWidth = (kind, dpr, mobile) => (kind === "ray" ? STROKE_PX : STROKE_PX * CONE_LEG_K) * (mobile ? MOBILE_WIDTH_K : 1) * dpr;
const within = (got, want, lo = 1.0, hi = 2.6) => got != null && got >= want - lo && got <= want + hi;
const results = {};

// ── 1. THE RADAR ON GLASS — the mini-map on the iPhone twin, the Pixel twin, the desktop twin ──
if (LEGS.includes("1")) {
  for (const device of ["iphone", "pixel", "desktop"]) {
    const m = await attach(device);
    const mobile = DEVICES[device].mobile;
    await m.goto(mobile ? M_FPV : D_FPV, 1500);
    const up = await m.waitFor(`!!document.querySelector(".mm-canvas") && !!window.__cameraStore?.getState().camGeo`, BOOT_MS);
    check(`1.${device}a FPV boots with the mini-map`, up);
    const tid = await m.evalJs(TRACK_SUN);
    info(`1.${device} tracked target`, String(tid));
    await sleep(2500);
    const probe = await m.evalJs(ringProbe(".mm-canvas", mobile ? 0.44 : 0.525, "square"));
    results[device] = probe;
    const wantStore = Math.round((mobile ? 124 : 200) * DEVICES[device].deviceScaleFactor);
    check(`1.${device}b the mini-map's store is the GLASS (${wantStore} px = card ${mobile ? 124 : 200} css × DPR ${DEVICES[device].deviceScaleFactor})`, probe.store === wantStore, `store ${probe.store} css ${probe.css} dpr ${probe.dpr}`);
    const rayWant = expectWidth("ray", DEVICES[device].deviceScaleFactor, mobile);
    const legWant = expectWidth("leg", DEVICES[device].deviceScaleFactor, mobile);
    check(`1.${device}c the target ray is ${rayWant.toFixed(1)} store px (= ${(rayWant / DEVICES[device].deviceScaleFactor).toFixed(2)} css px) on the glass`, within(probe.cyan?.widthPx, rayWant), `got ${probe.cyan?.widthPx ?? "none"} at ${probe.cyan?.thDeg}°`);
    check(`1.${device}d the focal-cone legs are ${legWant.toFixed(1)} store px (the 1.5× rule)`, within(probe.pink?.widthPx, legWant), `got ${probe.pink?.widthPx ?? "none"} at ${probe.pink?.thDeg}°`);
    if (probe.cyan) {
      const edge = await m.evalJs(rayProbe(".mm-canvas", probe.W / 2, probe.H / 2, probe.cyan.thDeg, probe.W * 0.44 * 0.72));
      check(`1.${device}e the ray runs to the patch edge (past the target band)`, edge.share >= 0.7 && edge.tailCyan >= 1, `share ${edge.share} of ${edge.samples} · tail ${edge.tailCyan}/${edge.tailN} · last r ${edge.lastInPx}`);
    }
    await m.shoot(`01-minimap-${device}`);
    m.close();
  }
  if (results.iphone?.cyan && results.pixel?.cyan) {
    const a = results.iphone.cyan.widthPx / DEVICES.iphone.deviceScaleFactor;
    const b = results.pixel.cyan.widthPx / DEVICES.pixel.deviceScaleFactor;
    check("1.parity the iPhone and the Pixel draw the ray at the SAME css width", Math.abs(a - b) <= 0.45, `iPhone ${a.toFixed(2)} css px · Pixel ${b.toFixed(2)} css px`);
  }
  if (results.desktop?.cyan) {
    check("1.desktop the desktop mini-map is unchanged: a 1 css px ray, 1.5 css px legs", within(results.desktop.cyan.widthPx, 2, 0.8, 1.6) && within(results.desktop.pink?.widthPx, 3, 1, 1.8), `ray ${results.desktop.cyan.widthPx} · legs ${results.desktop.pink?.widthPx}`);
  }
}

// ── 2. THE DIALS LEAVE THE SCREEN — the chart after a long pan; the GL fan at nadir + tilt ────
if (LEGS.includes("2")) {
  const m = await attach("iphone");
  await m.goto(M_FPV, 1500);
  check("2a FPV boots", await m.waitFor(`!!document.querySelector(".mm-canvas") && !!window.__cameraStore?.getState().camGeo`, BOOT_MS));
  await m.evalJs(TRACK_SUN);
  await sleep(1500);
  check("2b the mini-map's » opens the fullscreen chart", (await m.tapSel(".mm-open")) && (await m.waitFor(`!!document.querySelector(".mw-canvas")`, 8000)));
  await sleep(3000);
  const chart = await m.evalJs(ringProbe(".mw-canvas", 0.44, "chart"));
  const dpr = chart.dpr;
  const rayWant = expectWidth("ray", Math.min(DEVICES.iphone.deviceScaleFactor, 2), true);
  check("2c the chart's target ray wears the /m weight (store capped at 2×, so 2.8 store px = 1.4 css px)", within(chart.cyan?.widthPx, rayWant), `got ${chart.cyan?.widthPx ?? "none"} at ${chart.cyan?.thDeg}° · store ${chart.W}×${chart.H} dpr ${dpr}`);
  await m.shoot("02-chart-centred");
  if (chart.cyan) {
    // Pan the chart AGAINST the ray (the anchor goes the way the ray comes from) — 5 × 120 css px
    // = 600, far enough that the old one-diagonal reach ended mid-screen in every direction. Every
    // stroke STARTS at the chart's centre and stays inside the middle third: the left aim stick
    // (x ≲ 126, y ≳ 486) and the right rail own the edges — a stroke that started there swung the
    // stick instead of the map (run 3 of this harness).
    const th = (chart.cyan.thDeg * Math.PI) / 180;
    const r = await m.rect(".mw-canvas");
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const ux = Math.cos(th), uy = Math.sin(th);
    for (let i = 0; i < 5; i++) await m.drag(cx, cy, cx - ux * 120, cy - uy * 120, 8);
    await sleep(1500);
    // Where the anchor went, read from the chart's own view (never assumed): metres per css px at
    // the live zoom (the scale-bar rule) → the anchor's offset from the chart centre in css px.
    const view = await m.evalJs(`(() => { const v = window.__mapWindowView; if (!v) return null;
      const mpp = (40075016.686 * Math.cos((v.latDeg * Math.PI) / 180)) / (256 * Math.pow(2, v.z));
      const dy = ((v.anchorLatDeg - v.latDeg) * 111320) / mpp; const dx = ((v.anchorLonDeg - v.lonDeg) * 111320 * Math.cos((v.latDeg * Math.PI) / 180)) / mpp;
      return { offCss: +Math.hypot(dx, dy).toFixed(0), dx: +dx.toFixed(0), dy: +dy.toFixed(0), z: +v.z.toFixed(2) }; })()`);
    const halfDiagCss = Math.hypot(r.w, r.h) / 2;
    check("2d the pan carried the anchor clean off the chart (past half a diagonal from the centre)", !!view && view.offCss > halfDiagCss, `anchor ${view?.offCss} css px from the centre (half-diagonal ${halfDiagCss.toFixed(0)}) dx ${view?.dx} dy ${view?.dy} z ${view?.z}`);
    const border = await m.evalJs(borderProbe(".mw-canvas"));
    check("2e …and the target ray still reaches the chart's EDGE (cyan ink on the border — the old one-diagonal reach ended inside)", border.runs >= 1 && border.maxRun >= 2, `${border.runs} run(s), longest ${border.maxRun} px at ${JSON.stringify(border.where)}`);
    await m.shoot("02-chart-panned");
  }
  m.close();

  const g = await attach("iphone");
  await g.goto(M_MAP, 1500);
  check("2f the /m 2D map boots with the aim radar seam", await g.waitFor(`!!window.__globe?.aimRadar && !!window.__cameraStore?.getState()`, BOOT_MS));
  await g.evalJs(TRACK_SUN);
  await sleep(3000);
  const nadir = await g.evalJs(`window.__globe.aimRadar()`);
  check("2g the GL fan wears the /m stroke profile and draws its rim/spokes as quads", nadir.widthK === MOBILE_WIDTH_K && nadir.rim === "mesh", JSON.stringify(nadir));
  check("2h at nadir the ray is the rayLenK ray (the corners sit inside it)", nadir.rayK >= 6 && nadir.reachK > 0 && nadir.reachK < 6, `rayK ${nadir.rayK.toFixed(2)} reachK ${nadir.reachK.toFixed(2)} radius ${nadir.radiusM.toFixed(0)} m`);
  await g.shoot("03-map-nadir");
  const chip = await g.evalJs(`(() => { const b = [...document.querySelectorAll(".m-actions button")].find((b) => /^▲ 3D$/.test(b.textContent.trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  check("2i the ▲ 3D chip is there", !!chip);
  if (chip) {
    await g.tap(chip.x, chip.y);
    await sleep(3500);
    const tilt = await g.evalJs(`window.__globe.aimRadar()`);
    check("2j tilted 3D: the ray stretches past the rayLenK ray to the far corners (the owner's 'shorter than the screen')", tilt.rayK > 6 && tilt.reachK > 6 && tilt.rayK >= tilt.reachK, `rayK ${tilt.rayK.toFixed(1)} reachK ${tilt.reachK.toFixed(1)} radius ${tilt.radiusM.toFixed(0)} m`);
    await g.shoot("03-map-tilted");
  }
  g.close();
}

// ── 3. FIND THIS ONE — the target sheet's row on the iPhone twin ────────────────────────────────
if (LEGS.includes("3")) {
  const m = await attach("iphone");
  await m.goto(M_FPV, 1500);
  check("3a FPV boots", await m.waitFor(`!!document.querySelector(".m-peek") && !!window.__findStore`, BOOT_MS));
  await m.evalJs(TRACK_SUN);
  await m.evalJs(`window.__findStore.getState().setOpen(false); window.__findStore.setState({ bodies: { sun: false, moon: true, target: false }, rangeDays: 30 }); true`);
  await sleep(600);
  check("3b the target peek opens the target sheet", (await m.tapSel(".m-peek")) && (await m.waitFor(`!!document.querySelector(".m-sheet .m-findrow")`, 8000)));
  await sleep(800); // m-sheet-in is 400 ms — a tap during the slide lands on the scrim
  const row0 = await m.evalJs(`(() => { const row = document.querySelector(".m-findrow"); const btn = row.querySelector(".m-findframe"); const chips = [...row.querySelectorAll(".m-toggle--range")];
    const rr = row.getBoundingClientRect(), br = btn.getBoundingClientRect(), cr = row.querySelector(".m-findrow__ranges").getBoundingClientRect();
    return { pressed: btn.getAttribute("aria-pressed"), text: btn.textContent.trim(), labels: chips.map((c) => c.textContent.trim()), disabled: chips.map((c) => c.disabled), on: chips.map((c) => c.classList.contains("m-toggle--on")), rowW: rr.width, btnW: br.width, chipsW: cr.width, btnLeft: br.x - rr.x, chipsRight: rr.right - cr.right, unfollowBelow: (() => { const u = document.querySelector(".m-unfollow"); return u ? u.getBoundingClientRect().y > rr.bottom - 1 : null; })() }; })()`);
  check("3c the row: ⌖ FIND IN FRAME (off) + 1W · 1M · 6M · 1Y, every chip disabled", row0.pressed === "false" && /⌖ FIND IN FRAME/.test(row0.text) && row0.labels.join() === "1W,1M,6M,1Y" && row0.disabled.every(Boolean), JSON.stringify(row0.labels) + " disabled " + JSON.stringify(row0.disabled));
  check("3d the button is the left half, the chips the right (≈ equal halves, nothing overflowing)", Math.abs(row0.btnW - row0.chipsW) <= row0.rowW * 0.12 && row0.btnLeft < 2 && row0.chipsRight < 2, `row ${row0.rowW.toFixed(0)} btn ${row0.btnW.toFixed(0)} chips ${row0.chipsW.toFixed(0)}`);
  check("3e the row sits above UNFOLLOW", row0.unfollowBelow === true);
  await m.shoot("04-target-sheet-off");
  await m.tapSel(".m-findframe");
  await sleep(600);
  const st1 = await m.evalJs(`(() => { const f = window.__findStore.getState(); const chips = [...document.querySelectorAll(".m-findrow .m-toggle--range")]; return { bodies: f.bodies, open: f.open, range: f.rangeDays, pressed: document.querySelector(".m-findframe").getAttribute("aria-pressed"), disabled: chips.map((c) => c.disabled), on: chips.map((c) => c.classList.contains("m-toggle--on")) }; })()`);
  check("3f the tap scans the SUN ALONE — the moon's default-on chip stood down, FIND is open", st1.bodies.sun === true && st1.bodies.moon === false && st1.bodies.target === false && st1.open === true && st1.pressed === "true", JSON.stringify(st1.bodies));
  check("3g the chips went live with 1M on", st1.disabled.every((d) => !d) && st1.on.join() === "false,true,false,false", JSON.stringify(st1.on));
  const chip1y = await m.evalJs(`(() => { const c = [...document.querySelectorAll(".m-findrow .m-toggle--range")].find((c) => c.textContent.trim() === "1Y"); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await m.tap(chip1y.x, chip1y.y);
  await sleep(500);
  const st2 = await m.evalJs(`(() => { const f = window.__findStore.getState(); return { range: f.rangeDays, on: [...document.querySelectorAll(".m-findrow .m-toggle--range")].map((c) => c.classList.contains("m-toggle--on")) }; })()`);
  check("3h a 1Y tap writes the shared range (365) and the chip lights", st2.range === 365 && st2.on.join() === "false,false,false,true", JSON.stringify(st2));
  await m.shoot("04-target-sheet-on");
  // the FIND tab agrees: only the sun chip is on
  await m.tapSel(".m-sheet__x");
  await sleep(500);
  await m.tapSel(".m-tab:nth-child(3)");
  const findUp = await m.waitFor(`!!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"] .m-toggles')`, 8000);
  const findChips = findUp ? await m.evalJs(`[...document.querySelectorAll('.m-sheet[aria-label="FIND IN FRAME"] .m-toggles .m-toggle')].map((c) => ({ t: c.textContent.trim(), on: c.classList.contains("m-toggle--on") }))`) : [];
  check("3i the FIND tab shows ☀ on, ☾ off, ✦ off and 1Y — the same truth", findUp && findChips.length >= 7 && findChips[0].on && !findChips[1].on && !findChips[2].on && findChips.find((c) => c.t === "1Y")?.on === true, JSON.stringify(findChips));
  await m.shoot("04-find-tab");
  m.close();
}

// ── 4. THE SAVE VIEW SHEET ABOVE THE KEYBOARD (signed in, the iPhone twin) ─────────────────────
if (LEGS.includes("4")) {
  const cookie = await mintCookie();
  const m = await attach("iphone");
  await m.goto("about:blank", 100);
  await m.seedCookie(cookie);
  await m.goto(M_FPV, 1500);
  check("4a FPV boots signed in (the ▤ PLACES cell renders)", await m.waitFor(`!!document.querySelector(".m-actions .m-act--places")`, BOOT_MS));
  const saveSel = `.m-actions .m-act--icon[aria-label^="Save this view"]`;
  check("4b the ◎ SAVE cell is live", !!(await m.rect(saveSel)));
  await m.tapSel(saveSel);
  check("4c the SAVE VIEW sheet opens with its name field focused", await m.waitFor(`!!document.querySelector('.m-sheet[aria-label="SAVE VIEW"]') && document.activeElement?.classList.contains("m-input")`, 5000));
  await sleep(700);
  const before = await m.evalJs(`(() => { const s = document.querySelector('.m-sheet[aria-label="SAVE VIEW"]'); const r = s.getBoundingClientRect(); return { bottom: r.bottom, top: r.y, h: r.height, innerH: innerHeight, lift: s.dataset.lift ?? null, scrollY, vvH: visualViewport.height }; })()`);
  check("4d no keyboard: the sheet sits on the bottom edge, no lift", Math.abs(before.bottom - before.innerH) < 1.5 && before.lift === null, JSON.stringify(before));
  await m.shoot("05-saveview-no-keyboard");
  // The keyboard, synthesised: the visual viewport loses 300 css px (CDP cannot raise a soft
  // keyboard; `visualViewport.height` is what the lift reads, and the resize event is its signal).
  await m.evalJs(`(() => { const vv = visualViewport; Object.defineProperty(vv, "height", { configurable: true, get: () => innerHeight - 300 }); vv.dispatchEvent(new Event("resize")); return true; })()`);
  await sleep(600);
  const during = await m.evalJs(`(() => { const s = document.querySelector('.m-sheet[aria-label="SAVE VIEW"]'); const r = s.getBoundingClientRect(); return { bottom: r.bottom, top: r.y, h: r.height, innerH: innerHeight, lift: s.dataset.lift ?? null, scrollY, focused: document.activeElement?.classList.contains("m-input"), input: document.querySelector('.m-sheet[aria-label="SAVE VIEW"] .m-input').getBoundingClientRect().bottom, lifted: s.classList.contains("m-sheet--lifted") }; })()`);
  check("4e a 300 px keyboard: the sheet rides 300 px up — its bottom edge sits on the keyboard's top", Math.abs(during.bottom - (during.innerH - 300)) < 1.5 && during.lift === "300" && during.lifted, JSON.stringify(during));
  check("4f the name field is above the keys and still focused, the layout viewport unscrolled", during.input <= during.innerH - 300 + 0.5 && during.focused === true && during.scrollY === 0 && during.top >= 0, `input bottom ${during.input.toFixed(0)} · keyboard top ${during.innerH - 300}`);
  await m.shoot("05-saveview-keyboard-300");
  await m.evalJs(`(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event("resize")); return true; })()`);
  await sleep(600);
  const after = await m.evalJs(`(() => { const s = document.querySelector('.m-sheet[aria-label="SAVE VIEW"]'); const r = s.getBoundingClientRect(); return { bottom: r.bottom, innerH: innerHeight, lift: s.dataset.lift ?? null }; })()`);
  check("4g the keyboard gone: the sheet settles back on the bottom edge", Math.abs(after.bottom - after.innerH) < 1.5 && after.lift === null, JSON.stringify(after));
  // a FULL sheet never lifts: the SEARCH sheet under the same synthetic keyboard
  await m.tapSel(".m-sheet__x");
  await sleep(400);
  const searchTab = await m.evalJs(`(() => { const t = [...document.querySelectorAll(".m-tab")].find((b) => /SEARCH/i.test(b.textContent)); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (searchTab) await m.tap(searchTab.x, searchTab.y);
  const searchUp = !!searchTab && (await m.waitFor(`!!document.querySelector('.m-sheet--full[aria-label="SEARCH"]')`, 6000));
  await sleep(700);
  if (searchUp) {
    await m.evalJs(`(() => { const vv = visualViewport; Object.defineProperty(vv, "height", { configurable: true, get: () => innerHeight - 300 }); vv.dispatchEvent(new Event("resize")); return true; })()`);
    await sleep(500);
    const full = await m.evalJs(`(() => { const s = document.querySelector('.m-sheet--full[aria-label="SEARCH"]'); return { lift: s.dataset.lift ?? null, top: s.getBoundingClientRect().y }; })()`);
    check("4h the full SEARCH sheet keeps its place (its input is at the top — no lift)", full.lift === null && full.top >= 0, JSON.stringify(full));
    await m.evalJs(`(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event("resize")); return true; })()`);
  } else info("4h the SEARCH sheet did not open from the first tab — skipped");
  // Leave the shared profile SIGNED OUT: the member cookie seeded above outlives this run, and
  // `verify-mobile-batch-2026-09-08`'s signed-out legs read the SAVE cell's `aria-disabled`
  // (2 FAILs on 2026-10-10 when this harness ran first). A deleted member cookie is re-minted as
  // a visitor cookie on the next HTML response.
  await m.send("Network.deleteCookies", { name: "wixSession", url: APP + "/" }).catch(() => {});
  m.close();
}

// ── 5. THE DESKTOP TWIN — the TARGET panel's row + solo rule; the GL fan's desktop identity ──────
if (LEGS.includes("5")) {
  const d = await attach("desktop");
  await d.goto(D_MAP, 1500);
  check("5a the desktop map boots with the aim radar seam", await d.waitFor(`!!window.__globe?.aimRadar && !!document.querySelector(".tp-pill")`, BOOT_MS));
  await d.evalJs(TRACK_SUN);
  await sleep(2500);
  const fan = await d.evalJs(`window.__globe.aimRadar()`);
  check("5b desktop: the stroke profile is the identity (widthK 1), rim/spokes quads, the rayLenK ray at nadir", fan.widthK === 1 && fan.rim === "mesh" && fan.rayK >= 6, JSON.stringify(fan));
  await d.evalJs(`window.__findStore.getState().setOpen(false); window.__findStore.setState({ bodies: { sun: false, moon: true, target: false }, rangeDays: 30 }); true`);
  await d.tapSel(".tp-pill");
  check("5c the TARGET panel opens with the FIND row", await d.waitFor(`!!document.querySelector(".tp-findrow .tp-findframe") && document.querySelectorAll(".tp-findrow .tp-range").length === 4`, 6000));
  const r0 = await d.evalJs(`(() => { const row = document.querySelector(".tp-findrow"); const chips = [...row.querySelectorAll(".tp-range")]; const u = document.querySelector(".tp-unfollow"); return { disabled: chips.map((c) => c.disabled), labels: chips.map((c) => c.textContent.trim()), above: row.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false, btnW: row.querySelector(".tp-findframe").getBoundingClientRect().width, rowW: row.getBoundingClientRect().width }; })()`);
  check("5d the chips are disabled while the scan is off; the row sits above UNFOLLOW; halves", r0.disabled.every(Boolean) && r0.labels.join() === "1W,1M,6M,1Y" && r0.above && r0.btnW > r0.rowW * 0.38 && r0.btnW < r0.rowW * 0.62, JSON.stringify(r0));
  await d.tapSel(".tp-findframe");
  await sleep(600);
  const s1 = await d.evalJs(`(() => { const f = window.__findStore.getState(); return { bodies: f.bodies, open: f.open, disabled: [...document.querySelectorAll(".tp-range")].map((c) => c.disabled), planOpen: window.__planStore?.getState().open }; })()`);
  check("5e desktop click: the sun ALONE scans, FIND opens, PLAN yields, the chips go live", s1.bodies.sun === true && s1.bodies.moon === false && s1.bodies.target === false && s1.open === true && s1.disabled.every((x) => !x) && s1.planOpen === false, JSON.stringify(s1));
  const c6 = await d.evalJs(`(() => { const c = [...document.querySelectorAll(".tp-range")].find((c) => c.textContent.trim() === "6M"); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await d.click(c6.x, c6.y);
  await sleep(400);
  check("5f a 6M click writes the shared range (182)", (await d.evalJs(`window.__findStore.getState().rangeDays`)) === 182);
  await d.shoot("06-desktop-target-panel");
  await d.tapSel(".tp-findframe");
  await sleep(400);
  check("5g a second click disarms the sun only (plain off)", (await d.evalJs(`JSON.stringify(window.__findStore.getState().bodies)`)) === JSON.stringify({ sun: false, moon: false, target: false }));
  d.close();
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
await finishVerify(failures === 0 ? 0 : 1);
