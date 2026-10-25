#!/usr/bin/env node
/**
 * T200 — THE MOON'S PERCEIVED VISIBILITY on the REAL iPhone 17 Pro (AWS Device Farm, Remote Access +
 * Appium, Safari) — the FARM leg beside the Chrome twins (`scripts/verify-t200-moon.mjs`). Same session
 * plumbing as `ios-mobile-fixes-2026-10-13.mjs` (read ITS header and `ios-baseline.mjs` for the
 * prerequisites, the billing and the traps). The farm tests the LIVE site (`--prod`): no DEV seams, so
 * every read is a screenshot or the DOM.
 *   M. THE MOON ON GLASS — `/m` FPV frames AIMED at the moon (the almanac's own topocentric az / alt,
 *      astronomy-engine, airless) at the owner's 2026-10-25 dusk (the full moon 8.4° up at civil dusk),
 *      the setting full moon at 4.5° the next dawn, and a night full moon at 21°: the disc core's mean
 *      RGB and luminance against the sky annulus — the low discs must be ORANGE (b/g well under the
 *      night disc's) and dimmer than the night one; the night disc neutral, as shipped.
 *   V. THE VERDICT — the PLAN tab's MOON section "☾ NOW · <LABEL>" line and the TODAY rows' "☾ <LABEL>"
 *      meta, read from the DOM at the dusk instant (BRIGHT) and at a daytime quarter moon (PALE).
 *
 *   AWS_PROFILE=plux node tools/devicefarm/ios-t200-moon-2026-10-25.mjs --prod [--dry-run] [--legs M,V] [--keep-session]
 *
 * ≈ 5–7 device minutes. Output: verify-shots/perf/devicefarm-t200-<stamp>.json + PNGs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { remote } from "webdriverio";
import {
  DeviceFarmClient,
  ListDevicesCommand,
  ListDevicePoolsCommand,
  ListProjectsCommand,
  CreateRemoteAccessSessionCommand,
  GetRemoteAccessSessionCommand,
  StopRemoteAccessSessionCommand,
} from "@aws-sdk/client-device-farm";

/** A minimal PNG reader for Appium's device screenshots (8-bit RGB/RGBA, non-interlaced) — the 10-13 idiom. */
function readPng(buf) {
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
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const HOST = (opt("--host", "") || "").replace(/\/$/, "");
const PROJECT_ARN = opt("--project-arn", process.env.DEVICEFARM_PROJECT_ARN ?? null);
const DEVICE_MODEL = opt("--device", "iPhone 17 Pro");
const SESSION_ARN = opt("--session-arn", null);
const KEEP = flag("--keep-session");
const DRY = flag("--dry-run");
const PROD = flag("--prod");
const LEGS = (opt("--legs", "M,V") || "").split(",");
const FOV = Number(opt("--fov", "14"));
const LABEL = "t200";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = fileURLToPath(new URL("../../verify-shots/perf", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
if (!HOST && !DRY && !PROD) throw new Error("--host https://<tunnel-host> is required, or --prod for the live site");
const BASE = PROD ? (HOST || "https://www.plux.today") : HOST;

// The owner's Dnipro street (the sunset pose's site), 90 m up so the low moon clears the roofs; the aims
// are astronomy-engine's own topocentric az / alt (airless — the house contract), precomputed by
// scripts/verify-t200-moon.mjs's cellAim at the same instants (the farm box has no astronomy-engine).
const SITE = { lat: 48.464627, lon: 35.064907, eye: 90 };
const CELLS = {
  "dusk-full-low": { ms: Date.UTC(2026, 9, 25, 14, 45), az: 80.19, alt: 8.45, sun: -2.8, illum: 0.99 },
  "dawn-full-setting": { ms: Date.UTC(2026, 9, 26, 4, 0), az: 289.04, alt: 4.51, sun: -3.4, illum: 1.0 },
  "night-full": { ms: Date.UTC(2026, 6, 29, 22, 10), az: 181.86, alt: 21.34, sun: -22.8, illum: 1.0 },
};
const fpvUrl = (c) => `${BASE}/m#f=${SITE.lat.toFixed(6)},${SITE.lon.toFixed(6)},${SITE.eye.toFixed(1)},${c.az.toFixed(1)},${c.alt.toFixed(1)},${FOV.toFixed(1)}&t=${c.ms}`;
const T_DUSK = CELLS["dusk-full-low"].ms;
const T_DAY_QUARTER = Date.UTC(2026, 10, 2, 8, 0); // sun +24° · the last quarter 33° up — PALE
const planUrl = (ms) => `${BASE}/m#p=48.4640,35.0460,2200,0,0&t=${ms}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = { stamp: STAMP, host: BASE, device: DEVICE_MODEL, checks: [], notes: [], cells: [] };
let failures = 0;
const check = (name, ok, detail = "") => { results.checks.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const save = () => writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`, JSON.stringify(results, null, 2));

// ── the glass reader (the Chrome harness's ring reader, on the device PNG) ───────────────────
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function ring(img, cx, cy, r0, r1) {
  const { data, width: W, height: H } = img;
  let R = 0, G = 0, B = 0, n = 0; const L = [];
  for (let y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(H - 1, Math.ceil(cy + r1)); y++)
    for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(W - 1, Math.ceil(cx + r1)); x++) {
      const d = Math.hypot(x - cx, y - cy); if (d < r0 || d > r1) continue;
      const i = (y * W + x) * 4; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; L.push(lum(data[i], data[i + 1], data[i + 2]));
    }
  if (!n) return null;
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.floor(p * (L.length - 1))];
  return { n, rgb: [R / n, G / n, B / n].map(Math.round), p10: Math.round(q(0.1)), p50: Math.round(q(0.5)), p90: Math.round(q(0.9)) };
}
/** Disc stats about the frame centre; the bright blob within ±2.5 r refines the centre (full moons only here). */
function discStats(png, fovDeg) {
  const img = readPng(png);
  const r = (Math.tan((0.259 * Math.PI) / 180) / Math.tan((fovDeg / 2) * Math.PI / 180)) * (img.height / 2);
  let cx = img.width / 2, cy = img.height / 2;
  const sky0 = ring(img, cx, cy, r * 1.6, r * 2.6) ?? { p50: 0 };
  const thr = sky0.p50 + 40;
  // The device PNG is the WHOLE screen (status bar + Safari chrome), so the canvas centre is not the PNG centre and the
  // hash pitch may settle a hair off: a wide ±6 r window — every farm cell is a FULL moon on a dusk / night sky, so nothing
  // else bright sits near the centre to grab.
  let sx = 0, sy = 0, n = 0; const win = Math.round(r * 6);
  for (let y = Math.max(0, Math.round(cy - win)); y <= Math.min(img.height - 1, Math.round(cy + win)); y++)
    for (let x = Math.max(0, Math.round(cx - win)); x <= Math.min(img.width - 1, Math.round(cx + win)); x++) {
      const i = (y * img.width + x) * 4;
      if (lum(img.data[i], img.data[i + 1], img.data[i + 2]) > thr) { sx += x; sy += y; n++; }
    }
  const area = Math.PI * r * r;
  if (n > area * 0.2) { cx = sx / n; cy = sy / n; }
  const core = ring(img, cx, cy, 0, r * 0.72);
  const sky = ring(img, cx, cy, r * 1.6, r * 2.4);
  if (!core || !sky) return null;
  return { r: +r.toFixed(1), cx: Math.round(cx), cy: Math.round(cy), blobFrac: +(n / area).toFixed(2), core, sky,
    contrast: +((core.p50 - sky.p50) / Math.max(1, sky.p50)).toFixed(2),
    tint: { rg: +(core.rgb[0] / Math.max(1, core.rgb[1])).toFixed(3), bg: +(core.rgb[2] / Math.max(1, core.rgb[1])).toFixed(3) } };
}

// ── preflight + the Device Farm session (the ios-baseline idiom) ─────────────────────────────
async function preflight() {
  const live = await fetch(`${BASE}/api/ping`).then((r) => r.status).catch(() => null);
  if (live !== 200 && !DRY) throw new Error(`the site does not answer ${BASE}/api/ping (${live})`);
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
    let arns = []; try { arns = JSON.parse(r.value); } catch { arns = []; }
    for (const arn of arns) {
      const { devices } = await df.send(new ListDevicesCommand({ filters: [{ attribute: "ARN", operator: "IN", values: [arn] }] })).catch(() => ({ devices: [] }));
      const d = devices?.[0];
      if (d && d.platform === "IOS" && d.remoteAccessEnabled) return d;
    }
  }
  return null;
}
async function pickDevice() {
  let nextToken; const found = [];
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
  const resp = await df.send(new CreateRemoteAccessSessionCommand({ projectArn, deviceArn: device.arn, name: `T200 moon visibility ${STAMP}`, configuration: { parameters: { "appium:version": "3" } } }));
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

// ── in-page reads (DOM only — the live site has no seams) ───────────────────────────────────
const READY_FPV = `!!document.querySelector("canvas") && document.readyState === "complete" && !!document.querySelector(".m-fpvhud, .m-peek")`;
/** Open the PLAN tab (the bottom tab whose text says PLAN) and read the moon verdicts from the text. */
const OPEN_PLAN = `(() => { const b = [...document.querySelectorAll("button")].find((x) => /\\bPLAN\\b/.test(x.textContent || "")); if (!b) return "no PLAN tab"; b.click(); return "clicked"; })()`;
const READ_VERDICTS = `(() => { const t = document.body.innerText || ""; const ver = (document.querySelector(".version-stamp") || {}).textContent || null; const now = t.match(/☾ NOW · ([A-Z ]+?)(?: ·|\\n|$)/); const rows = [...t.matchAll(/☾ (RISE|SET)[\\s\\S]{0,60}?☾ ([A-Z][A-Z ]*?)(?:\\n|$)/g)].map((m) => m[1] + ":" + m[2].trim()); return { now: now ? now[1].trim() : null, rows, hasPlan: /LIGHT PLANNER|TODAY · MIDNIGHT/.test(t), version: ver ? ver.trim() : null }; })()`;

async function drive(endpoint) {
  const u = new URL(endpoint);
  const driver = await remote({
    protocol: u.protocol.replace(":", ""), hostname: u.hostname, port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80, path: u.pathname + u.search,
    logLevel: "warn", connectionRetryTimeout: 240_000, connectionRetryCount: 0,
    capabilities: { platformName: "iOS", "appium:automationName": "XCUITest", browserName: "Safari" },
  });
  const js = (expr) => driver.execute(`return (${expr});`);
  const DIAG = `(() => ({ ready: document.readyState, href: location.href.slice(0, 90), canvas: !!document.querySelector("canvas"), hud: !!document.querySelector(".m-fpvhud"), errs: (window.__farmErrs || []).slice(-3) }))()`;
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
    await js(`(window.__farmErrs = [], window.addEventListener("error", (e) => window.__farmErrs.push(String(e.message).slice(0, 120))), true)`).catch(() => {});
  };
  try {
    try { await driver.setTimeout({ script: 25_000 }); } catch { /* older driver */ }
    // ── M. THE MOON ON GLASS ────────────────────────────────────────────────────────────────
    const stats = {};
    if (LEGS.includes("M")) {
      for (const [id, c] of Object.entries(CELLS)) {
        await boot(fpvUrl(c));
        await waitFor(READY_FPV, 120_000, `${id} FPV`);
        await sleep(16_000); // the sky needs no tiles; the FPV camera settles on the hash
        const buf = await shot(`M-${id}`);
        if (!buf) { check(`M ${id} screenshot`, false, "no screenshot"); continue; }
        const s = discStats(buf, FOV);
        if (!s) { check(`M ${id} readable`, false, "empty ring"); continue; }
        stats[id] = s;
        results.cells.push({ id, ...c, ...s });
        log(`M ${id} disc p10/p50/p90 ${s.core.p10}/${s.core.p50}/${s.core.p90} rgb ${s.core.rgb.join(",")} · sky p50 ${s.sky.p50} rgb ${s.sky.rgb.join(",")} · contrast ${s.contrast} · tint r/g ${s.tint.rg} b/g ${s.tint.bg} · blob ${s.blobFrac}`);
        check(`M ${id} the disc is on glass (blob ${s.blobFrac} of a disc; core p90 ${s.core.p90} > sky p50 ${s.sky.p50} + 20)`, s.blobFrac > 0.5 && s.core.p90 > s.sky.p50 + 20, "");
      }
      const dusk = stats["dusk-full-low"], dawn = stats["dawn-full-setting"], night = stats["night-full"];
      if (dusk && night) {
        check(`M the dusk moon at 8.4° is ORANGE on the real phone (b/g ${dusk.tint.bg} < 0.85; the night disc ${night.tint.bg})`, dusk.tint.bg < 0.85 && dusk.tint.bg < night.tint.bg - 0.08, "");
        check(`M …and dimmer than the night disc (core p50 ${dusk.core.p50} < ${night.core.p50})`, dusk.core.p50 < night.core.p50, "");
        check(`M the night moon at 21° stays neutral (b/g ${night.tint.bg} in 0.9–1.05)`, night.tint.bg > 0.9 && night.tint.bg < 1.05, "");
      }
      if (dawn && dusk) check(`M the setting moon at 4.5° is deeper orange than the dusk one (b/g ${dawn.tint.bg} < ${dusk.tint.bg})`, dawn.tint.bg < dusk.tint.bg, "");
      save();
    }
    // ── V. THE VERDICT ──────────────────────────────────────────────────────────────────────
    if (LEGS.includes("V")) {
      for (const [id, ms, want] of [["dusk", T_DUSK, "BRIGHT"], ["day-quarter", T_DAY_QUARTER, "PALE"]]) {
        await boot(planUrl(ms));
        await waitFor(`!!document.querySelector("canvas") && document.readyState === "complete"`, 120_000, `${id} shell`);
        await sleep(6_000);
        const opened = await js(OPEN_PLAN);
        await sleep(2_500);
        const v = await js(READ_VERDICTS);
        results.notes.push(`V ${id} ${opened} ${JSON.stringify(v)}`);
        log(`V ${id} ${opened} → ${JSON.stringify(v)}`);
        await shot(`V-${id}`);
        check(`V ${id} the PLAN tab opened (${opened})`, opened === "clicked" && !!v && v.hasPlan, "");
        check(`V ${id} the MOON section's NOW line reads ${want} (got ${v && v.now})`, !!v && v.now === want, "");
        if (id === "dusk") check(`V ${id} the TODAY moonrise row carries a ☾ verdict (${v && v.rows.join(" ")})`, !!v && v.rows.some((r) => r.startsWith("RISE:")), "");
      }
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

log(`T200 the moon on the farm — device "${DEVICE_MODEL}" ${PROD ? "LIVE " + BASE : "host " + (HOST || "(dry run)")} legs ${LEGS.join(",")}`);
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
