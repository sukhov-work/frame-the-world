/**
 * The 2026-10-10 mobile fixes on the REAL iPhone 17 Pro (AWS Device Farm, Remote Access + Appium,
 * Safari) — the FARM leg the owner asked for beside the Chrome twins (`scripts/verify-mobile-fixes-
 * 2026-10-10.mjs`). Same session plumbing as `ios-baseline.mjs` (the T77 tool; read its header for
 * the prerequisites, the billing and the traps); this one reads the three fixes on glass:
 *   R. THE RADAR ON GLASS — the mini-map's canvas store is the card's PHYSICAL size (124 css × 3 =
 *      372 px — it was a 400 px store minified into 372, the one place the iPhone diverged from the
 *      Pixel), the target ray + the cone legs measured from the canvas's own pixels in CSS px, the
 *      GL fan's stroke profile + ray reach through `__globe.aimRadar()`, screenshots of the 2D map
 *      at nadir and tilted (the eye judges the weight and the reach).
 *   F. FIND THIS ONE — the target sheet's ⌖ FIND IN FRAME scans the sun alone; the range chips live.
 *   K. THE KEYBOARD — a REAL soft keyboard: the SAVE VIEW name field is tapped, Safari raises the
 *      keys, and the sheet's bottom edge must sit on the visual viewport's bottom (above them), the
 *      field focused — the owner's screenshot had the whole dialog hidden behind the keyboard.
 *      (Signed in through the same member cookie the Chrome harness mints; the cookie is set via
 *      `document.cookie` on the tunnel origin — a dev build, not the live Secure cookie.)
 *
 *   cloudflared tunnel --protocol http2 --url http://localhost:4321     # → https://<x>.trycloudflare.com
 *   # 2026-10-10: every *.trycloudflare.com host timed out from this Mac, VPN on or off — the account-free
 *   # fallback that worked: ssh -R 80:localhost:4321 nokey@localhost.run  → https://<x>.lhr.life
 *   npx wix dev --allowed-hosts .lhr.life          # (or .trycloudflare.com — a suffix wildcard)
 *   AWS_PROFILE=plux node tools/devicefarm/ios-mobile-fixes-2026-10-10.mjs --host https://<x>.lhr.life [--dry-run] [--legs R,F,P,K]
 *
 *   P. THE PLAN SHEET'S NUMBER FIELD — a sign-in-free REAL keyboard: the NPF field in the PLAN sheet (a non-full
 *      sheet) raises the numeric keys; the sheet must lift by `min(inset, innerH − sheetH − 56)` — the clamped case.
 *
 * ~10–15 device minutes. Output: verify-shots/perf/devicefarm-fixes-1010-<stamp>.json + PNGs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import { inflateSync } from "node:zlib";

/** A minimal PNG reader for Appium's device screenshots (8-bit RGB/RGBA, non-interlaced, filters 0–4) —
 *  the npm registry was unreachable through the VPN on 2026-10-10, so no `pngjs`. Returns RGBA. */
const PNG = {
  sync: {
    read(buf) {
      if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
      let pos = 8, width = 0, height = 0, bitDepth = 8, colorType = 6, interlace = 0;
      const idat = [];
      while (pos < buf.length) {
        const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8); const body = buf.subarray(pos + 8, pos + 8 + len);
        if (type === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bitDepth = body[8]; colorType = body[9]; interlace = body[12]; }
        else if (type === "IDAT") idat.push(body);
        else if (type === "IEND") break;
        pos += 12 + len;
      }
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported PNG: depth ${bitDepth} type ${colorType} interlace ${interlace}`);
      const bpp = colorType === 6 ? 4 : 3;
      const raw = inflateSync(Buffer.concat(idat));
      const stride = width * bpp;
      const out = Buffer.alloc(width * height * 4);
      let prev = Buffer.alloc(stride);
      for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)];
        const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
          let v = line[i];
          if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
          else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
          line[i] = v & 255;
        }
        for (let x = 0; x < width; x++) { const o = (y * width + x) * 4, s = x * bpp; out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = bpp === 4 ? line[s + 3] : 255; }
        prev = line;
      }
      return { width, height, data: out };
    },
  },
};
import {
  DeviceFarmClient,
  ListDevicesCommand,
  ListDevicePoolsCommand,
  ListProjectsCommand,
  CreateRemoteAccessSessionCommand,
  GetRemoteAccessSessionCommand,
  StopRemoteAccessSessionCommand,
} from "@aws-sdk/client-device-farm";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const HOST = (opt("--host", "") || "").replace(/\/$/, "");
const PROJECT_ARN = opt("--project-arn", process.env.DEVICEFARM_PROJECT_ARN ?? null);
const DEVICE_MODEL = opt("--device", "iPhone 17 Pro");
const SESSION_ARN = opt("--session-arn", null);
const KEEP = flag("--keep-session");
const DRY = flag("--dry-run");
const LEGS = (opt("--legs", "R,F,P,K") || "").split(",");
// --prod: the LIVE site (https://www.plux.today). No DEV seams there — the target is seeded through the
// persisted view prefs (`ftw:view-prefs:v1`), FIND is read from the DOM, the GL fan from screenshots.
// The 2026-10-10 lesson: a DEV build over a slow tunnel never boots the engine on the phone.
const PROD = flag("--prod");
const LABEL = "fixes-1010";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = fileURLToPath(new URL("../../verify-shots/perf", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
if (!HOST && !DRY && !PROD) throw new Error("--host https://<tunnel-host> is required (the phone cannot reach localhost), or --prod for the live site");
const BASE = PROD ? (HOST || "https://www.plux.today") : HOST;
const NOON_UTC = 1787313600000;
const URLS = {
  mfpv: `${BASE}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`,
  mmap: `${BASE}/m#p=48.4640,35.0460,2200,0,0&t=${NOON_UTC}`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = { stamp: STAMP, host: HOST, device: DEVICE_MODEL, checks: [], notes: [] };
let failures = 0;
const check = (name, ok, detail = "") => {
  results.checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const save = () => writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`, JSON.stringify(results, null, 2));

// ─── the member cookie (the Chrome harness's recipe, minted on the Mac) ─────────────────────
async function mintCookie() {
  const { createClient, OAuthStrategy } = await import(`${REPO}node_modules/@wix/sdk/build/index.js`);
  const env = readFileSync(`${REPO}.env.local`, "utf-8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const clientId = get("WIX_CLIENT_ID");
  const email = get("TEST_MEMBER_EMAIL");
  const password = get("TEST_MEMBER_PASSWORD");
  if (!clientId || !email || !password) throw new Error("WIX_CLIENT_ID / TEST_MEMBER_* missing from .env.local");
  const client = createClient({ auth: OAuthStrategy({ clientId }) });
  const login = await client.auth.login({ email, password });
  if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
  const REDIRECT = `${BASE}/api/auth/callback`;
  const oauthData = client.auth.generateOAuthData(REDIRECT, BASE + "/");
  const SITE = "https://www.plux.today";
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

// ─── preflight + the Device Farm session (the ios-baseline idiom) ───────────────────────────
async function preflight() {
  if (PROD) {
    const live = await fetch(`${BASE}/api/ping`).then((r) => r.status).catch(() => null);
    if (live !== 200) throw new Error(`the live site does not answer ${BASE}/api/ping (${live})`);
    return;
  }
  const local = await fetch("http://localhost:4321/api/ping").then((r) => r.status).catch(() => null);
  if (local !== 200 && !DRY) throw new Error(`wix dev is not answering locally (${local})`);
  if (DRY) return;
  const via = await fetch(`${HOST}/api/ping`, { redirect: "manual" }).then((r) => r.status).catch((e) => String(e));
  if (via !== 200) throw new Error(`the tunnel does not serve wix dev (${via}) — is \`wix dev --allowed-hosts <the tunnel's suffix>\` running?`);
}
const df = new DeviceFarmClient({ region: "us-west-2" });
async function resolveProject() {
  if (PROJECT_ARN) return PROJECT_ARN;
  const { projects } = await df.send(new ListProjectsCommand({}));
  if (!projects?.length) throw new Error("no Device Farm project");
  return projects[0].arn;
}
async function poolDevice(projectArn) {
  const { devicePools } = await df.send(new ListDevicePoolsCommand({ arn: projectArn, type: "PRIVATE" })).catch(() => ({ devicePools: [] }));
  for (const pool of devicePools ?? []) for (const r of pool.rules ?? []) {
    if (r.attribute !== "ARN") continue;
    let arns = [];
    try { arns = JSON.parse(r.value); } catch { arns = []; }
    for (const arn of arns) {
      const { devices } = await df.send(new ListDevicesCommand({ filters: [{ attribute: "ARN", operator: "IN", values: [arn] }] })).catch(() => ({ devices: [] }));
      const d = devices?.[0];
      if (d && d.platform === "IOS" && d.remoteAccessEnabled) return d;
    }
  }
  return null;
}
async function pickDevice() {
  let nextToken;
  const found = [];
  do {
    const page = await df.send(new ListDevicesCommand({ filters: [{ attribute: "MODEL", operator: "CONTAINS", values: [DEVICE_MODEL] }, { attribute: "PLATFORM", operator: "EQUALS", values: ["IOS"] }], nextToken }));
    for (const d of page.devices ?? []) found.push(d);
    nextToken = page.nextToken;
  } while (nextToken);
  if (!found.length) throw new Error(`no iOS device matching "${DEVICE_MODEL}"`);
  const avail = found.filter((d) => d.remoteAccessEnabled && d.availability !== "TEMPORARY_NOT_AVAILABLE" && d.availability !== "BUSY");
  return (avail.length ? avail : found)[0];
}
async function openSession(projectArn) {
  if (SESSION_ARN) return SESSION_ARN;
  const device = (await poolDevice(projectArn)) ?? (await pickDevice());
  log(`device → ${device.name} (${device.os}) ${device.availability}`);
  const resp = await df.send(new CreateRemoteAccessSessionCommand({ projectArn, deviceArn: device.arn, name: `mobile fixes 2026-10-10 ${STAMP}`, configuration: { parameters: { "appium:version": "3" } } }));
  log(`remote access session ${resp.remoteAccessSession.arn} → ${resp.remoteAccessSession.status}`);
  return resp.remoteAccessSession.arn;
}
async function waitRunning(arn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    const { remoteAccessSession: s } = await df.send(new GetRemoteAccessSessionCommand({ arn }));
    if (s.status === "RUNNING") {
      const ep = s.endpoints?.remoteDriverEndpoint;
      if (!ep) throw new Error("RUNNING but no remoteDriverEndpoint");
      log(`RUNNING — ${s.device?.name} ${s.device?.os}`);
      return ep;
    }
    if (s.status === "STOPPING" || s.status === "COMPLETED") throw new Error(`session ended early: ${s.status} ${s.message ?? ""}`);
    log(`session ${s.status}…`);
    await sleep(5000);
  }
  throw new Error("timed out waiting for RUNNING");
}

// ─── the in-page probes (the Chrome harness's, verbatim where they are pure DOM/canvas reads) ──
const READY_FPV = PROD
  ? `!!(document.querySelector(".mm-canvas") && document.querySelector(".m-altcol"))` // the mini-map + the FPV rail render only once the pose mirrors are live
  : `!!(window.__cameraStore && window.__cameraStore.getState().camGeo && document.querySelector(".mm-canvas"))`;
/** Prod: the sun as the tracked target through the persisted prefs (the sky store restores `skyTargetId`
 *  after boot; `aimTarget` / `aimVisible` on) — written on a page of the same origin BEFORE the FPV boot. */
const SEED_SUN_PREFS = `(() => { const k = "ftw:view-prefs:v1"; let o = {}; try { o = JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch {} o.skyTargetId = "body:sun"; o.aimTarget = true; o.aimVisible = true; o.aimSun = true; o.aimMoon = true; localStorage.setItem(k, JSON.stringify(o)); return localStorage.getItem(k).length; })()`;
const TARGET_NAME = `(document.querySelector(".m-peek__name") || {}).textContent || ""`;
const TRACK_SUN = `(async () => { const s = window.__skyStore?.getState(); if (!s) return "no store"; const m = await import("/src/lib/ephemeris/targets.ts"); s.setTarget(m.bodyTarget("sun")); if (!s.visible) s.setVisible(true); if (!s.aimVisible) s.setAimVisible(true); if (!s.aimTarget) s.setAimTarget(true); return window.__skyStore.getState().target.id; })()`;
const RING = `(() => {
  const c = document.querySelector(".mm-canvas"); if (!c) return { err: "no canvas" };
  const ctx = c.getContext("2d"); const W = c.width, H = c.height; const R = W * 0.44 * 0.44; const cx = W / 2, cy = H / 2;
  const img = ctx.getImageData(0, 0, W, H).data;
  const cls = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null; const i = (yi * W + xi) * 4; const r = img[i], g = img[i + 1], b = img[i + 2];
    if (g > 120 && b > 110 && g - r > 55 && b - r > 40) return "cyan"; if (r > 140 && b > 100 && r - g > 40) return "pink"; return null; };
  const steps = 2880; const runs = []; let cur = null;
  for (let k = 0; k <= steps; k++) { const th = (k / steps) * 2 * Math.PI; const kind = k < steps ? cls(cx + R * Math.cos(th), cy + R * Math.sin(th)) : null;
    if (cur && kind === cur.kind) { cur.n++; continue; } if (cur) runs.push(cur); cur = kind ? { kind, n: 1 } : null; }
  const arc = (2 * Math.PI * R) / steps; const best = (kind) => runs.filter((r) => r.kind === kind).sort((a, b) => b.n - a.n)[0] ?? null;
  const css = c.getBoundingClientRect().width;
  return { store: W, css, dpr: devicePixelRatio, cyanPx: best("cyan") ? +(best("cyan").n * arc).toFixed(2) : null, pinkPx: best("pink") ? +(best("pink").n * arc).toFixed(2) : null };
})()`;

/** Cyan runs on an inset border of the MAP region of a device screenshot (pngjs): the box spans
 *  x 4 %..96 %, y 12 %..58 % of the screen — below the status bar + wordmark, above the dock and the
 *  rails — so a ray that leaves it has run ≥ ~500 px from the centred anchor on every side. */
function borderCyan(png) {
  const img = PNG.sync.read(png);
  const { width: W, height: H, data } = img;
  const x0 = Math.round(W * 0.04), x1 = Math.round(W * 0.96), y0 = Math.round(H * 0.12), y1 = Math.round(H * 0.58);
  const cyan = (x, y) => { const i = (y * W + x) * 4; const r = data[i], g = data[i + 1], b = data[i + 2]; return g > 120 && b > 110 && g - r > 55 && b - r > 40; };
  const pts = [];
  for (let x = x0; x <= x1; x++) pts.push([x, y0]);
  for (let y = y0; y <= y1; y++) pts.push([x1, y]);
  for (let x = x1; x >= x0; x--) pts.push([x, y1]);
  for (let y = y1; y >= y0; y--) pts.push([x0, y]);
  let runs = 0, cur = 0, maxRun = 0, where = null;
  for (const [x, y] of pts) { if (cyan(x, y)) { if (cur === 0) runs++; cur++; if (cur > maxRun) { maxRun = cur; where = [x, y]; } } else cur = 0; }
  return { W, H, box: [x0, y0, x1, y1], runs, maxRun, where };
}

async function drive(endpoint) {
  const u = new URL(endpoint);
  const driver = await remote({
    protocol: u.protocol.replace(":", ""), hostname: u.hostname, port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80, path: u.pathname + u.search,
    logLevel: "warn", connectionRetryTimeout: 240_000, connectionRetryCount: 0,
    capabilities: { platformName: "iOS", "appium:automationName": "XCUITest", browserName: "Safari" },
  });
  const js = (expr) => driver.execute(`return (${expr});`);
  const jsAsync = (expr) => driver.executeAsync(`const done = arguments[arguments.length - 1]; Promise.resolve(${expr}).then(done, (e) => done({ err: String(e) }));`);
  // Where the page is, every 15 s while a wait runs — a tunnel-served dev build boots slowly and a
  // timeout with no trace taught nothing (farm run 1, 2026-10-10: "timed out waiting for the /m FPV seams").
  const DIAG = `(() => ({ ready: document.readyState, href: location.href.slice(0, 90), title: document.title, canvas: !!document.querySelector("canvas"), cam: !!window.__cameraStore, geo: !!(window.__cameraStore && window.__cameraStore.getState().camGeo), mm: !!document.querySelector(".mm-canvas"), body: document.body ? document.body.className.slice(0, 60) : null, scripts: document.scripts.length, errs: (window.__farmErrs || []).slice(-3) }))()`;
  const waitFor = async (expr, ms, label) => {
    const t0 = Date.now();
    let nextDiag = 15_000;
    while (Date.now() - t0 < ms) {
      try { if (await js(expr)) return true; } catch { /* navigating */ }
      if (Date.now() - t0 > nextDiag) { nextDiag += 15_000; log(`  …${label}: ${JSON.stringify(await js(DIAG).catch((e) => ({ err: String(e).slice(0, 80) })))}`); }
      await sleep(1000);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const shot = async (tag) => { try { const p = `${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-${tag}.png`; writeFileSync(p, Buffer.from(await driver.takeScreenshot(), "base64")); log(`shot ${p}`); } catch { /* no shot */ } };
  const tapSel = async (sel) => { const el = await driver.$(sel); await el.click(); };
  /** A NATIVE tap (XCUITest, the system's own touch) at a page element's centre — the only tap that
   *  makes iOS raise the soft keyboard. WebDriver's `element.click()` is a synthetic click through the
   *  remote inspector: it focuses the field (live-site farm run 1: `focusedInput: true`) but the visual
   *  viewport never shrinks. Page CSS px → screen points through `mobile: viewportRect` (the web view's
   *  placement in device PIXELS) and the device pixel ratio; a status-bar-only fallback when the
   *  command is unavailable (Safari's URL bar sits at the BOTTOM on iOS 15+). */
  const nativeTapSel = async (sel) => {
    // The PLAN sheet's fields sit below its fold (live-site farm run 2: the tap landed in Safari's
    // toolbar, nothing focused) — bring the element into view first, then read where it is.
    await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({ block: "center", inline: "nearest" }); return !!el; })()`);
    await sleep(400);
    const r = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, dpr: devicePixelRatio, innerH: innerHeight }; })()`);
    if (!r) throw new Error(`nativeTap: no element ${sel}`);
    let top = 54, left = 0;
    try { const vp = await driver.execute("mobile: viewportRect"); top = vp.top / r.dpr; left = vp.left / r.dpr; log(`  viewportRect ${JSON.stringify(vp)} → top ${top.toFixed(1)} pt`); } catch (e) { log(`  viewportRect unavailable (${String(e).slice(0, 60)}) — status-bar fallback ${top} pt`); }
    const ctxs = await driver.getContexts();
    const web = ctxs.find((c) => String(c) !== "NATIVE_APP") ?? ctxs[ctxs.length - 1];
    await driver.switchContext("NATIVE_APP");
    try {
      await driver.performActions([{ type: "pointer", id: "finger1", parameters: { pointerType: "touch" }, actions: [
        { type: "pointerMove", duration: 0, x: Math.round(left + r.x), y: Math.round(top + r.y) },
        { type: "pointerDown", button: 0 }, { type: "pause", duration: 90 }, { type: "pointerUp", button: 0 } ] }]);
      await driver.releaseActions().catch(() => {});
    } finally {
      await driver.switchContext(web);
    }
    return r;
  };
  const boot = async (url) => {
    await driver.url("about:blank");
    await sleep(300);
    await driver.url(url);
    // an in-page error log the DIAG probe reads (window.onerror is lost across navigations — re-armed per boot)
    await js(`(window.__farmErrs = [], window.addEventListener("error", (e) => window.__farmErrs.push(String(e.message).slice(0, 120))), window.addEventListener("unhandledrejection", (e) => window.__farmErrs.push("rej " + String(e.reason).slice(0, 120))), true)`).catch(() => {});
  };
  try {
   try {
    // One read of a lifted sheet under a REAL keyboard — the geometry every K/P check shares.
    const SHEET_READ = (label) => `(() => { const s = document.querySelector('.m-sheet[aria-label=${JSON.stringify(label)}]'); if (!s) return { err: "no sheet" }; const r = s.getBoundingClientRect(); const vv = visualViewport; const inp = document.activeElement; const ir = inp && inp.matches("input") ? inp.getBoundingClientRect() : null;
      return { bottom: r.bottom, top: r.y, sheetH: r.height, innerH: innerHeight, vvH: vv.height, vvTop: vv.offsetTop, lift: s.dataset.lift ?? null, focusedInput: !!ir, inputBottom: ir ? ir.bottom : null, scrollY, full: s.classList.contains("m-sheet--full") }; })()`;
    const judgeLift = (tag, k) => {
      const keyboardUp = k.vvH < k.innerH - 80;
      check(`${tag}1 Safari raised the keyboard (the visual viewport shrank)`, keyboardUp, JSON.stringify(k));
      if (!keyboardUp) return;
      const vvBottom = k.vvH + k.vvTop;
      const inset = Math.max(0, Math.round(k.innerH - k.vvH - k.vvTop));
      const room = Math.max(0, k.innerH - k.sheetH - 56);
      const wantLift = Math.min(inset, room);
      check(`${tag}2 the sheet lifted by min(inset ${inset}, room ${room}) = ${wantLift} px (data-lift)`, Number(k.lift ?? 0) === wantLift || Math.abs(Number(k.lift ?? 0) - wantLift) <= 1, `lift ${k.lift} · sheet bottom ${k.bottom.toFixed(0)} · vv bottom ${vvBottom.toFixed(0)}`);
      if (wantLift === inset) check(`${tag}3 the sheet's bottom edge sits on the visual viewport's bottom — above the keys`, Math.abs(k.bottom - vvBottom) <= 2, `sheet bottom ${k.bottom.toFixed(0)} vs vv bottom ${vvBottom.toFixed(0)}`);
      else log(`${tag}3 INFO the lift is clamped by the room above (sheet ${k.sheetH.toFixed(0)} px tall): bottom ${k.bottom.toFixed(0)} vs vv bottom ${vvBottom.toFixed(0)}`);
      check(`${tag}4 the focused field is visible above the keyboard, the layout viewport unscrolled, the head on screen`, k.focusedInput && k.inputBottom <= vvBottom + 1 && k.scrollY === 0 && k.top >= 0, `input bottom ${k.inputBottom} · top ${k.top.toFixed(0)}`);
    };
    // ONE FPV boot serves the mini-map read, the FIND row and the PLAN-sheet keyboard (a tunnel-served
    // dev build boots in minutes — farm run 1 timed out at 120 s; four boots in the run, not six).
    const onFpv = async () => {
      if (PROD) {
        await boot(`${BASE}/m`);
        await waitFor(`document.readyState === "complete"`, 120_000, "the shell");
        log(`  prefs seeded: ${await js(SEED_SUN_PREFS)} B`);
      }
      await boot(URLS.mfpv);
      await waitFor(READY_FPV, PROD ? 180_000 : 300_000, "the /m FPV seams");
      if (PROD) { await sleep(4000); log(`  tracked: ${JSON.stringify(await js(TARGET_NAME))}`); }
    };
    const trackSun = async () => { if (PROD) return; await jsAsync(TRACK_SUN); };
    let fpvUp = false;
    if (LEGS.includes("R")) {
      await onFpv(); fpvUp = true;
      await trackSun();
      await sleep(3000);
      const ring = await js(RING);
      results.ring = ring;
      check("R1 the mini-map's store is the card's PHYSICAL size (124 css × DPR)", ring.store === Math.round(ring.css * ring.dpr), `store ${ring.store} css ${ring.css} dpr ${ring.dpr}`);
      const want = 1.4 * ring.dpr;
      check("R2 the target ray is 1.4 css px on the glass", ring.cyanPx != null && ring.cyanPx >= want - 1 && ring.cyanPx <= want + 2.6, `got ${ring.cyanPx} store px (${ring.cyanPx != null ? (ring.cyanPx / ring.dpr).toFixed(2) : "none"} css) want ${want.toFixed(1)}`);
      check("R3 the focal-cone legs are 2.1 css px (the 1.5× rule)", ring.pinkPx != null && ring.pinkPx >= want * 1.5 - 1 && ring.pinkPx <= want * 1.5 + 2.6, `got ${ring.pinkPx}`);
      await shot("minimap");
      save();
    }
    if (LEGS.includes("F")) {
      if (!fpvUp) { await onFpv(); fpvUp = true; }
      await trackSun();
      if (!PROD) await js(`(window.__findStore.getState().setOpen(false), window.__findStore.setState({ bodies: { sun: false, moon: true, target: false }, rangeDays: 30 }), true)`);
      await sleep(800);
      await tapSel(".m-peek");
      await waitFor(`!!document.querySelector(".m-sheet .m-findrow")`, 15_000, "the target sheet");
      await sleep(900);
      const before = await js(`(() => { const chips = [...document.querySelectorAll(".m-findrow .m-toggle--range")]; return { n: chips.length, disabled: chips.every((c) => c.disabled) }; })()`);
      check("F1 the row: four range chips, disabled until the scan is on", before.n === 4 && before.disabled, JSON.stringify(before));
      await shot("target-sheet-off");
      await tapSel(".m-findrow .m-findframe");
      await sleep(900);
      if (PROD) {
        const after = await js(`(() => ({ pressed: document.querySelector(".m-findrow .m-findframe")?.getAttribute("aria-pressed"), live: [...document.querySelectorAll(".m-findrow .m-toggle--range")].every((c) => !c.disabled), on: [...document.querySelectorAll(".m-findrow .m-toggle--range")].map((c) => c.classList.contains("m-toggle--on")) }))()`);
        check("F2 the tap arms FIND IN FRAME (aria-pressed) and the chips go live with 1M on", after.pressed === "true" && after.live && after.on.join() === "false,true,false,false", JSON.stringify(after));
        await shot("target-sheet-on");
        await tapSel(".m-sheet__x").catch(() => {});
        await sleep(700);
        // the FIND tab agrees: ☀ on, ☾ off, ✦ off — only the named object scans (the solo rule, read from the DOM)
        const tabs2 = await driver.$$(".m-tab");
        for (const tb of tabs2) { if (/FIND/i.test(await tb.getText())) { await tb.click(); break; } }
        await waitFor(`!!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"] .m-toggles')`, 15_000, "the FIND sheet");
        await sleep(700);
        const chips = await js(`[...document.querySelectorAll('.m-sheet[aria-label="FIND IN FRAME"] .m-toggles .m-toggle')].map((c) => ({ t: c.textContent.trim(), on: c.classList.contains("m-toggle--on") }))`);
        check("F3 the FIND tab shows ☀ on · ☾ off · ✦ off — the sun alone", chips.length >= 3 && chips[0].on && !chips[1].on && !chips[2].on, JSON.stringify(chips));
        await shot("find-tab");
        await tapSel(".m-sheet__x").catch(() => {});
        await sleep(700);
      } else {
        const after = await js(`(() => { const f = window.__findStore.getState(); return { bodies: f.bodies, open: f.open, live: [...document.querySelectorAll(".m-findrow .m-toggle--range")].every((c) => !c.disabled) }; })()`);
        check("F2 the tap scans the SUN ALONE and the chips go live", after.bodies.sun === true && after.bodies.moon === false && after.bodies.target === false && after.open === true && after.live, JSON.stringify(after));
        await shot("target-sheet-on");
        await tapSel(".m-sheet__x").catch(() => {});
        await sleep(700);
      }
      save();
    }
    if (LEGS.includes("P")) {
      if (!fpvUp) { await onFpv(); fpvUp = true; }
      // Sign-in-free: the PLAN sheet (non-full) holds number fields — a real numeric keyboard.
      const tabs = await driver.$$(".m-tab");
      let planTab = null;
      for (const t of tabs) { if (/PLAN/i.test(await t.getText())) { planTab = t; break; } }
      check("P0 the PLAN tab exists", !!planTab);
      if (planTab) {
        await planTab.click();
        await waitFor(`!!document.querySelector('.m-sheet[aria-label="LIGHT PLANNER"] .m-in')`, 15_000, "the PLAN sheet's number fields");
        await sleep(900);
        await nativeTapSel('.m-sheet[aria-label="LIGHT PLANNER"] .m-in'); // a SYSTEM tap — the keyboard rises
        await sleep(2500);
        const p = await js(SHEET_READ("LIGHT PLANNER"));
        results.planKeyboard = p;
        judgeLift("P", p);
        await shot("plan-keyboard");
        await js(`(document.activeElement && document.activeElement.blur(), true)`);
        await sleep(800);
        await tapSel(".m-sheet__x").catch(() => {});
      }
      save();
    }
    if (LEGS.includes("R") && PROD) {
      // No seams on the live site: the GL fan is judged from the SCREEN — cyan ink on an inset border of the
      // map region means the target ray left a 1,000+ px box around the anchor at nadir AND tilted (the
      // Chrome twins measured rayK / reachK through the seam; here the glass itself answers).
      await boot(URLS.mmap);
      await waitFor(`!!document.querySelector(".m-actions") && document.readyState === "complete"`, 180_000, "the /m map");
      await sleep(8000); // tiles + the radar's first paint
      const png0 = Buffer.from(await driver.takeScreenshot(), "base64");
      writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-map-nadir.png`, png0);
      const b0 = borderCyan(png0);
      check("R4 nadir: the target ray crosses the map region's inset border (the glass, no seam)", b0.runs >= 1, JSON.stringify(b0));
      const chip = await driver.$$(".m-actions button");
      for (const b of chip) { if ((await b.getText()).trim() === "▲ 3D") { await b.click(); break; } }
      await sleep(5000);
      const png1 = Buffer.from(await driver.takeScreenshot(), "base64");
      writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-map-tilted.png`, png1);
      const b1 = borderCyan(png1);
      check("R5 tilted: the target ray still crosses the inset border (the owner's 'shorter than the screen')", b1.runs >= 1, JSON.stringify(b1));
      save();
    }
    if (LEGS.includes("R") && !PROD) {
      await boot(URLS.mmap);
      await waitFor(`!!(window.__globe && window.__globe.aimRadar)`, 300_000, "the /m map seams");
      await jsAsync(TRACK_SUN);
      await sleep(4000);
      const nadir = await js(`window.__globe.aimRadar()`);
      results.nadir = nadir;
      check("R4 the GL fan: /m stroke profile, quads, the rayLenK ray at nadir", nadir.widthK === 1.4 && nadir.rim === "mesh" && nadir.rayK >= 6, JSON.stringify(nadir));
      await shot("map-nadir");
      const chip = await driver.$$(".m-actions button");
      for (const b of chip) { if ((await b.getText()).trim() === "▲ 3D") { await b.click(); break; } }
      await sleep(4000);
      const tilt = await js(`window.__globe.aimRadar()`);
      results.tilt = tilt;
      check("R5 tilted: the ray stretches past the far corners", tilt.rayK > 6 && tilt.reachK > 6, JSON.stringify(tilt));
      await shot("map-tilted");
      save();
    }
    if (LEGS.includes("K")) {
      const cookie = await mintCookie();
      await boot(`${BASE}/m`);
      await waitFor(`document.readyState === "complete"`, 120_000, "the shell");
      // The member cookie: WebDriver's cookie store first (it can replace a server-set cookie), then
      // document.cookie as the fallback (ignored when the server's cookie is HttpOnly).
      let viaDriver = false;
      try { await driver.setCookies([{ name: "wixSession", value: cookie, path: "/", secure: true, ...(PROD ? { sameSite: "None" } : {}) }]); viaDriver = true; } catch (e) { log(`driver.setCookies refused: ${String(e).slice(0, 120)}`); }
      await js(`(document.cookie = "wixSession=" + ${JSON.stringify(cookie)} + "; path=/; max-age=86400; secure", true)`).catch(() => {});
      await boot(URLS.mfpv);
      let member = true;
      try { await waitFor(`!!document.querySelector(".m-actions .m-act--places")`, 300_000, "the member FPV rail"); } catch { member = false; }
      check(`K0 the phone accepted the member cookie (${viaDriver ? "driver" : "document.cookie"}) — the ▤ PLACES cell renders`, member);
      if (member) {
        await tapSel('.m-actions .m-act--icon[aria-label^="Save this view"]');
        await waitFor(`!!document.querySelector('.m-sheet[aria-label="SAVE VIEW"]')`, 8000, "the SAVE VIEW sheet");
        await sleep(600);
        // a REAL keyboard: tap the name field on the glass
        await nativeTapSel('.m-sheet[aria-label="SAVE VIEW"] .m-input'); // a SYSTEM tap — the keyboard rises
        await sleep(2500);
        const k = await js(SHEET_READ("SAVE VIEW"));
        results.keyboard = k;
        judgeLift("K", k);
        await shot("saveview-keyboard");
      } else {
        results.notes.push("K: the member cookie was not accepted on the phone — the SAVE VIEW keyboard read is the P leg's (PLAN sheet) only");
      }
      save();
    }
   } catch (e) {
    // an exception is a FAILED run, never a silent "ALL PASS" (farm run 1)
    failures++;
    results.notes.push(`drive: ${String(e).slice(0, 300)}`);
    log(`drive FAILED: ${String(e).slice(0, 300)}`);
    try { log(`  page: ${JSON.stringify(await js(DIAG))}`); } catch { /* gone */ }
    await shot("error");
    save();
   }
  } finally {
    await driver.deleteSession().catch(() => {});
  }
}

log(`mobile fixes 2026-10-10 on the farm — device "${DEVICE_MODEL}" ${PROD ? "LIVE " + BASE : "host " + (HOST || "(dry run)")} legs ${LEGS.join(",")}`);
await preflight();
if (DRY) {
  const projectArn = await resolveProject();
  const d = (await poolDevice(projectArn)) ?? (await pickDevice());
  log(`dry run OK — project ${projectArn}; device ${d.name} ${d.os} ${d.availability}; no session created`);
} else {
  const projectArn = await resolveProject();
  let sessionArn = null;
  try {
    sessionArn = await openSession(projectArn);
    const endpoint = await waitRunning(sessionArn);
    await drive(endpoint);
  } finally {
    if (sessionArn && !KEEP) {
      const s = await df.send(new StopRemoteAccessSessionCommand({ arn: sessionArn })).catch((e) => ({ error: String(e) }));
      log(`session stop → ${s.remoteAccessSession?.status ?? JSON.stringify(s)}`);
    }
    results.sessionMinutes = sessionArn ? (await df.send(new GetRemoteAccessSessionCommand({ arn: sessionArn })).catch(() => null))?.remoteAccessSession?.deviceMinutes ?? null : null;
    save();
    log(`${failures === 0 ? "ALL PASS" : `${failures} FAIL`} — wrote ${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`);
  }
}
process.exitCode = failures === 0 ? 0 : 1;
