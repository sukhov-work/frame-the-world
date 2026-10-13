/**
 * The 2026-10-13 fixes on the REAL iPhone 17 Pro (AWS Device Farm, Remote Access + Appium, Safari) —
 * the FARM leg beside the Chrome twins (`scripts/verify-fpv-collision-2026-10-13.mjs`,
 * `scripts/probe-lighting-2026-10-13.mjs`). Same session plumbing as `ios-mobile-fixes-2026-10-10.mjs`
 * (read ITS header and `ios-baseline.mjs` for the prerequisites, the billing and the traps). The farm
 * tests the LIVE site (`--prod`): no DEV seams there, so every read is DOM, in-page rAF or a screenshot.
 *   L. THE DAYLIGHT — the owner's two Dnipro poses at 15:03 / 16:47 local (12 Oct 2026) on /m, the
 *      ground-and-buildings band of each device screenshot read as a luminance ledger (p5/p25/p50, the
 *      share of near-black pixels) — the desktop "before" was 36 % under 12/255 and a median of 17 at
 *      the second pose; the fix's twin read 0 % and 87.
 *   C. THE STICKY BOX — a first-person eye 30 m over the owner's embankment model: the ⤓ chip is held
 *      (a dispatched pointerdown — the chip's own handler), the EYE readout sampled every 120 ms in-page
 *      (monotone to 1.7 m, never up — the old rig re-based the eye on the way down), the view STILL once
 *      landed (two screenshots 1.2 s apart), then a stick walk into the buildings while an in-page rAF
 *      sampler reads the frame time with the 4-column box live (p95 against the phone's budget).
 *
 *   AWS_PROFILE=plux node tools/devicefarm/ios-mobile-fixes-2026-10-13.mjs --prod [--dry-run] [--legs L,C]
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
const LEGS = (opt("--legs", "L,C") || "").split(",");
// --prod: the LIVE site (https://www.plux.today). No DEV seams there — the target is seeded through the
// persisted view prefs (`ftw:view-prefs:v1`), FIND is read from the DOM, the GL fan from screenshots.
// The 2026-10-10 lesson: a DEV build over a slow tunnel never boots the engine on the phone.
const PROD = flag("--prod");
const LABEL = "fixes-1013";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = fileURLToPath(new URL("../../verify-shots/perf", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
if (!HOST && !DRY && !PROD) throw new Error("--host https://<tunnel-host> is required (the phone cannot reach localhost), or --prod for the live site");
const BASE = PROD ? (HOST || "https://www.plux.today") : HOST;
const T1 = 1791806580000; // 12 Oct 2026 15:03 EEST — the owner's first screenshot
const T2 = 1791812820000; // 16:47 EEST — the second
const URLS = {
  owner1: `${BASE}/m#p=48.470991,35.053172,320,28,63&t=${T1}`,
  owner2: `${BASE}/m#p=48.469500,35.050500,180,75,70&t=${T2}`,
  // the embankment model's centre (naberegna_3), the eye 30 m up looking down at 40°
  fpvNab: `${BASE}/m#f=48.469040,35.056870,30,20,-40,55&t=${T1}`,
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
  const resp = await df.send(new CreateRemoteAccessSessionCommand({ projectArn, deviceArn: device.arn, name: `collision + daylight 2026-10-13 ${STAMP}`, configuration: { parameters: { "appium:version": "3" } } }));
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

/** The luminance ledger of a device screenshot's ground-and-buildings band (the frame minus the
 *  status bar / wordmark above and the dock below; the rails left and right). */
function ledger(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const x0 = Math.floor(W * 0.12), x1 = Math.floor(W * 0.88), y0 = Math.floor(H * 0.28), y1 = Math.floor(H * 0.74);
  const lum = [];
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * W + x) * 4; lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]); }
  lum.sort((a, b) => a - b);
  const q = (p) => Math.round(lum[Math.floor(p * (lum.length - 1))]);
  return { w: W, h: H, n: lum.length, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), black: +(lum.filter((v) => v < 12).length / lum.length).toFixed(3), dark: +(lum.filter((v) => v < 30).length / lum.length).toFixed(3) };
}
/** Mean absolute luminance difference (0..255) between two screenshots over the same band. */
function bandDiff(a, b) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return null;
  const W = A.width, H = A.height; const x0 = Math.floor(W * 0.12), x1 = Math.floor(W * 0.88), y0 = Math.floor(H * 0.28), y1 = Math.floor(H * 0.74);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * W + x) * 4; const la = 0.2126 * A.data[i] + 0.7152 * A.data[i + 1] + 0.0722 * A.data[i + 2]; const lb = 0.2126 * B.data[i] + 0.7152 * B.data[i + 1] + 0.0722 * B.data[i + 2]; sum += Math.abs(la - lb); n++; }
  return +(sum / n).toFixed(2);
}

const READY_FPV = `!!(document.querySelector(".mm-canvas") && document.querySelector(".m-altcol") && document.querySelector(".m-fpvhud"))`;
const EYE_READ = `(() => { const cells = [...document.querySelectorAll(".m-fpvhud__cell")]; const c = cells.find((el) => (el.querySelector(".m-fpvhud__k") || {}).textContent === "EYE"); if (!c) return null; const t = c.textContent.replace("EYE", "").trim(); const m = t.match(/([\\d.]+)\\s*(m|km)/); return m ? +m[1] * (m[2] === "km" ? 1000 : 1) : null; })()`;
/** Hold the ⤓ chip for `ms` and sample the EYE readout every 120 ms — all in-page, one async script. */
const DESCEND_SAMPLED = (ms) => `(async () => {
  const chip = document.querySelector('.m-alt[aria-label="Descend (hold)"]'); if (!chip) return { err: "no chip" };
  const read = ${EYE_READ.replace(/^\(\(\) => \{/, "() => {").replace(/\}\)\(\)$/, "}")};
  const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
  const out = [read()];
  chip.dispatchEvent(ev("pointerdown"));
  const t0 = performance.now();
  await new Promise((res) => { const tick = () => { out.push(read()); if (performance.now() - t0 < ${ms}) setTimeout(tick, 120); else res(); }; setTimeout(tick, 120); });
  chip.dispatchEvent(ev("pointerup"));
  await new Promise((r) => setTimeout(r, 400));
  out.push(read());
  return { samples: out };
})()`;
/** Deflect the WALK stick forward by `k` for `ms` while an rAF sampler reads the frame time. */
const WALK_SAMPLED = (k, ms) => `(async () => {
  const pad = document.querySelector('.m-joy[aria-label="Walk joystick — drag to walk where you look"]'); if (!pad) return { err: "no stick" };
  const r = pad.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2;
  const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
  pad.dispatchEvent(ev("pointerdown", cx, cy));
  await new Promise((res) => setTimeout(res, 50));
  pad.dispatchEvent(ev("pointermove", cx, cy - rad * ${k}));
  const dts = []; let last = performance.now(); const t0 = last;
  await new Promise((res) => { const step = (now) => { dts.push(now - last); last = now; if (now - t0 < ${ms}) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  pad.dispatchEvent(ev("pointerup", cx, cy - rad * ${k}));
  dts.sort((a, b) => a - b); const q = (p) => +dts[Math.floor(p * (dts.length - 1))].toFixed(1);
  const read = ${EYE_READ.replace(/^\(\(\) => \{/, "() => {").replace(/\}\)\(\)$/, "}")};
  return { frames: dts.length, p50: q(0.5), p95: q(0.95), max: q(1), eyeM: read() };
})()`;

async function drive(endpoint) {
  const u = new URL(endpoint);
  const driver = await remote({
    protocol: u.protocol.replace(":", ""), hostname: u.hostname, port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80, path: u.pathname + u.search,
    logLevel: "warn", connectionRetryTimeout: 240_000, connectionRetryCount: 0,
    capabilities: { platformName: "iOS", "appium:automationName": "XCUITest", browserName: "Safari" },
  });
  const js = (expr) => driver.execute(`return (${expr});`);
  const jsAsync = (expr) => driver.executeAsync(`const done = arguments[arguments.length - 1]; Promise.resolve(${expr}).then(done, (e) => done({ err: String(e) }));`);
  const DIAG = `(() => ({ ready: document.readyState, href: location.href.slice(0, 90), canvas: !!document.querySelector("canvas"), hud: !!document.querySelector(".m-fpvhud"), body: document.body ? document.body.className.slice(0, 60) : null, errs: (window.__farmErrs || []).slice(-3) }))()`;
  const waitFor = async (expr, ms, label) => {
    const t0 = Date.now(); let nextDiag = 15_000;
    while (Date.now() - t0 < ms) {
      try { if (await js(expr)) return true; } catch { /* navigating */ }
      if (Date.now() - t0 > nextDiag) { nextDiag += 15_000; log(`  …${label}: ${JSON.stringify(await js(DIAG).catch((e) => ({ err: String(e).slice(0, 80) })))}`); }
      await sleep(1000);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const shotBuf = async () => Buffer.from(await driver.takeScreenshot(), "base64");
  const shot = async (tag) => { try { const p = `${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-${tag}.png`; const b = await shotBuf(); writeFileSync(p, b); log(`shot ${p}`); return b; } catch { return null; } };
  const boot = async (url) => {
    await driver.url("about:blank");
    await sleep(300);
    await driver.url(url);
    await js(`(window.__farmErrs = [], window.addEventListener("error", (e) => window.__farmErrs.push(String(e.message).slice(0, 120))), window.addEventListener("unhandledrejection", (e) => window.__farmErrs.push("rej " + String(e.reason).slice(0, 120))), true)`).catch(() => {});
  };
  try {
    try { await driver.setTimeout({ script: 25_000 }); } catch { /* older driver */ }
    // ── L. THE DAYLIGHT ───────────────────────────────────────────────────────────────────────
    if (LEGS.includes("L")) {
      for (const [id, url] of [["owner1", URLS.owner1], ["owner2", URLS.owner2]]) {
        await boot(url);
        await waitFor(`!!document.querySelector("canvas") && document.readyState === "complete"`, 120_000, `${id} canvas`);
        // no stream seams on the live site: a fixed settle for the tiles, long enough for a city view on cellular
        await sleep(28_000);
        const buf = await shot(`L-${id}`);
        if (!buf) { check(`L ${id} screenshot`, false, "no screenshot"); continue; }
        const L = ledger(buf);
        results.notes.push(`L ${id} ledger ${JSON.stringify(L)}`);
        log(`L ${id} ledger ${JSON.stringify(L)}`);
        check(`L ${id} the ground-and-buildings band is not black (near-black share ${(L.black * 100).toFixed(1)} % < 6 %; was 36 % at pose 2 on the desktop twin)`, L.black < 0.06, JSON.stringify(L));
        check(`L ${id} …and not dim (p50 ${L.p50} > 45; was 17 at pose 2)`, L.p50 > 45, "");
        check(`L ${id} …and not blown out (p95 ${L.p95} < 230)`, L.p95 < 230, "");
      }
    }
    // ── C. THE STICKY BOX ─────────────────────────────────────────────────────────────────────
    if (LEGS.includes("C")) {
      await boot(URLS.fpvNab);
      await waitFor(READY_FPV, 120_000, "the /m FPV HUD");
      await sleep(12_000); // the embankment model + the city stream in (the box lifts out if the eye is in one)
      const eye0 = await js(EYE_READ);
      check(`C0 the first-person eye reads ${eye0} m before the descent (seeded 30 m)`, eye0 !== null && eye0 > 20, `eye ${eye0}`);
      await shot("C-before-descent");
      const d = await jsAsync(DESCEND_SAMPLED(5000));
      const samples = (d && d.samples) ? d.samples.filter((v) => v !== null) : [];
      results.notes.push(`C descent samples ${JSON.stringify(samples)}`);
      log(`C descent EYE samples: ${samples.join(" ")}`);
      let ups = 0, maxUp = 0;
      for (let i = 1; i < samples.length; i++) { const dv = samples[i] - samples[i - 1]; if (dv > 0.15) { ups++; maxUp = Math.max(maxUp, dv); } }
      check(`C1 the ⤓ hold descends the eye to the standing height (last ${samples.at(-1)} m, ${samples.length} samples)`, samples.length > 10 && samples.at(-1) !== null && samples.at(-1) <= 2.0, "");
      check(`C2 …and the readout never steps UP on the way down (${ups} up-steps, max +${maxUp.toFixed(2)} m)`, ups === 0, "");
      const s1 = await shotBuf(); await sleep(1200); const s2 = await shotBuf();
      writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-C-landed.png`, s2);
      const dv = bandDiff(s1, s2);
      check(`C3 the view is STILL once landed (two screenshots 1.2 s apart differ by ${dv} / 255 on the ground band; a re-based eye moved the whole frame)`, dv !== null && dv < 10, `diff ${dv}`);
      const w = await jsAsync(WALK_SAMPLED(0.7, 3500));
      results.notes.push(`C walk ${JSON.stringify(w)}`);
      log(`C walk ${JSON.stringify(w)}`);
      check(`C4 a 3.5 s stick walk into the city keeps the frame time sane with the box live (p50 ${w && w.p50} ms · p95 ${w && w.p95} ms · max ${w && w.max} ms; ${w && w.frames} frames)`, !!w && w.p95 !== undefined && w.p95 < 120, JSON.stringify(w));
      check(`C5 …and the eye is on its feet after the walk (EYE ${w && w.eyeM} m)`, !!w && w.eyeM !== null && w.eyeM <= 2.5, "");
      await shot("C-after-walk");
      save();
    }
  } catch (e) {
    failures++;
    results.notes.push(`drive: ${String(e).slice(0, 300)}`);
    log(`drive FAILED: ${String(e).slice(0, 300)}`);
    try { log(`  page: ${JSON.stringify(await js(DIAG))}`); } catch { /* gone */ }
    await shot("error");
    save();
  } finally {
    await driver.deleteSession().catch(() => {});
  }
}

log(`collision + daylight 2026-10-13 on the farm — device "${DEVICE_MODEL}" ${PROD ? "LIVE " + BASE : "host " + (HOST || "(dry run)")} legs ${LEGS.join(",")}`);
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
