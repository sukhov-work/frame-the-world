/**
 * THE AR CALIBRATION AXES LOCK on the REAL iPhone 17 Pro (AWS Device Farm, Remote Access + Appium,
 * Safari) — the FARM leg beside the Chrome twin (`scripts/verify-ar-calibration.mjs` §3/§4). Same
 * session plumbing as `ios-mobile-fixes-2026-10-13.mjs` (read ITS header and `ios-baseline.mjs` for the
 * prerequisites, the billing and the traps). The farm tests the LIVE site (`--prod`): no DEV seams
 * there, so every read is DOM — the calibration strip's own `YAW · PITCH · mm` readout, the cells'
 * `aria-pressed`, the FPV HUD's PITCH cell as a second witness.
 *
 *   A. THE LOCK (owner order 2026-10-14): AR on (the motion sheet accepted), a NATIVE hold on the AR
 *      chip opens CALIBRATE AR (the camera sheet accepted), ↕ PITCH reads OFF; a NATIVE diagonal
 *      stroke on the pad (right 90 × down 60 pt) turns the view — YAW moves — and tilts it by nothing
 *      (PITCH stays +0.0°); ↕ PITCH tapped → lit; the same stroke now moves PITCH too; CANCEL; a second
 *      hold re-opens the pad LOCKED again (the toggle is per visit); the stored record is untouched.
 *
 *   AWS_PROFILE=plux node tools/devicefarm/ios-ar-axes-2026-10-14.mjs --prod [--dry-run] [--keep-session]
 *
 * ≈ 3–4 device minutes. Output: verify-shots/perf/devicefarm-ar-axes-1014-<stamp>.json + PNGs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const PROD = flag("--prod");
const LABEL = "ar-axes-1014";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = fileURLToPath(new URL("../../verify-shots/perf", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
if (!HOST && !DRY && !PROD) throw new Error("--host https://<tunnel-host> is required (the phone cannot reach localhost), or --prod for the live site");
const BASE = PROD ? (HOST || "https://www.plux.today") : HOST;
const NOON_UTC = 1787313600000;
// the owner's Dnipro street at the standing eye, heading 25°, a slight upward pitch — the twin's `dnipro-fpv-south` neighbourhood
const URL_FPV = `${BASE}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = { stamp: STAMP, host: BASE, device: DEVICE_MODEL, checks: [], notes: [] };
let failures = 0;
const check = (name, ok, detail = "") => {
  results.checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const info = (line) => { results.notes.push(line); log(`INFO  ${line}`); };
const save = () => writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`, JSON.stringify(results, null, 2));

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
  const resp = await df.send(new CreateRemoteAccessSessionCommand({ projectArn, deviceArn: device.arn, name: `AR axes lock 2026-10-14 ${STAMP}`, configuration: { parameters: { "appium:version": "3" } } }));
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

const READY_FPV = `!!(document.querySelector(".mm-canvas") && document.querySelector(".m-altcol") && document.querySelector(".m-fpvhud"))`;
/** The calibration strip's readout, parsed: `YAW +1.2° · PITCH −0.3° · 27 mm` → numbers (the sign is U+2212). */
const CAL_READ = `(() => { const el = document.querySelector('[data-read="cal"]'); if (!el) return null; const t = el.textContent.replace(/\\u2212/g, "-"); const m = t.match(/YAW ([+-][\\d.]+)° · PITCH ([+-][\\d.]+)° · (\\d+) mm/); return m ? { yaw: +m[1], pitch: +m[2], mm: +m[3], text: el.textContent } : { text: el.textContent }; })()`;
/** The FPV HUD's PITCH cell (the VIEW's pitch, sensors + calibration) — a second witness. */
const HUD_PITCH = `(() => { const cells = [...document.querySelectorAll(".m-fpvhud__cell")]; const c = cells.find((el) => (el.querySelector(".m-fpvhud__k") || {}).textContent === "PITCH"); if (!c) return null; const m = c.textContent.replace(/\\u2212/g, "-").match(/([+-]?[\\d.]+)°/); return m ? +m[1] : null; })()`;
const AXES_READ = `(() => { const b = document.querySelector('[data-act="ar-cal-axes"]'); if (!b) return null; const c = document.querySelector('[data-act="ar-cal-cancel"]'); const cs = getComputedStyle(b), cc = c ? getComputedStyle(c) : null; const r = b.getBoundingClientRect(); const rc = c ? c.getBoundingClientRect() : null; return { pressed: b.getAttribute("aria-pressed"), accent: b.classList.contains("m-act--accent"), label: b.textContent.trim(), w: r.width, h: r.height, round: cs.borderTopLeftRadius /* the LONGHAND: WebKit handed the shorthand back undefined on the device (farm run 2) */, sameInk: cc ? cs.color === cc.color && cs.borderColor === cc.borderColor : null, aboveCancel: rc ? r.bottom <= rc.top : null, acts: [...document.querySelectorAll('.m-arcal__actions [data-act]')].map((e) => e.dataset.act).join(",") }; })()`;
const STORED = `localStorage.getItem("ftw:ar-calib:v1")`;

async function drive(endpoint) {
  const u = new URL(endpoint);
  const driver = await remote({
    protocol: u.protocol.replace(":", ""), hostname: u.hostname, port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80, path: u.pathname + u.search,
    logLevel: "warn", connectionRetryTimeout: 240_000, connectionRetryCount: 0,
    capabilities: { platformName: "iOS", "appium:automationName": "XCUITest", browserName: "Safari" },
  });
  const js = (expr) => driver.execute(`return (${expr});`);
  const DIAG = `(() => ({ ready: document.readyState, href: location.href.slice(0, 90), canvas: !!document.querySelector("canvas"), hud: !!document.querySelector(".m-fpvhud"), ar: !!document.querySelector(".m-arbtn--on"), pad: !!document.querySelector(".m-arcal__pad"), note: (document.querySelector(".m-arnote") || {}).textContent || null, strip: (document.querySelector(".m-arcal") || {}).textContent || null, errs: (window.__farmErrs || []).slice(-3) }))()`;
  const waitFor = async (expr, ms, label) => {
    const t0 = Date.now(); let nextDiag = 15_000;
    while (Date.now() - t0 < ms) {
      try { if (await js(expr)) return true; } catch { /* navigating */ }
      if (Date.now() - t0 > nextDiag) { nextDiag += 15_000; log(`  …${label}: ${JSON.stringify(await js(DIAG).catch((e) => ({ err: String(e).slice(0, 80) })))}`); }
      await sleep(1000);
    }
    return false;
  };
  const shot = async (tag) => { try { const p = `${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-${tag}.png`; writeFileSync(p, Buffer.from(await driver.takeScreenshot(), "base64")); log(`shot ${p}`); } catch { /* no shot */ } };
  const boot = async (url) => {
    await driver.url("about:blank");
    await sleep(300);
    await driver.url(url);
    await js(`(window.__farmErrs = [], window.addEventListener("error", (e) => window.__farmErrs.push(String(e.message).slice(0, 120))), window.addEventListener("unhandledrejection", (e) => window.__farmErrs.push("rej " + String(e.reason).slice(0, 120))), true)`).catch(() => {});
  };
  /** WebKit's permission sheets ("Would Like to Access Motion and Orientation" / "…the Camera") are
   *  native alerts — accept one if it is up; the text comes back for the record. */
  const acceptSheet = async (label) => {
    for (let i = 0; i < 5; i++) {
      try { const t = await driver.getAlertText(); await driver.acceptAlert(); info(`${label}: accepted the sheet "${String(t).slice(0, 80)}"`); return t; } catch { await sleep(600); }
    }
    info(`${label}: no sheet was up (already decided for this origin, or the tap was not a user activation)`);
    return null;
  };
  /** Page CSS px → screen points: the web view's placement through `mobile: viewportRect` (device
   *  pixels) over the DPR; the status-bar fallback when the command is unavailable. */
  const screenOrigin = async () => {
    const dpr = await js(`devicePixelRatio`);
    try { const vp = await driver.execute("mobile: viewportRect"); return { top: vp.top / dpr, left: vp.left / dpr }; } catch { return { top: 54, left: 0 }; }
  };
  /** One NATIVE finger (XCUITest, the system's own touch): the `path` is page CSS px, each leg a
   *  `pointerMove` of `legMs`; `holdMs` pauses with the finger down before it lifts. */
  const nativeStroke = async (path, { holdMs = 0, legMs = 120 } = {}) => {
    const o = await screenOrigin();
    const ctxs = await driver.getContexts();
    const web = ctxs.find((c) => String(c) !== "NATIVE_APP") ?? ctxs[ctxs.length - 1];
    await driver.switchContext("NATIVE_APP");
    try {
      const [p0, ...rest] = path;
      const actions = [
        { type: "pointerMove", duration: 0, x: Math.round(o.left + p0.x), y: Math.round(o.top + p0.y) },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: Math.max(60, holdMs) },
      ];
      for (const p of rest) actions.push({ type: "pointerMove", duration: legMs, x: Math.round(o.left + p.x), y: Math.round(o.top + p.y) });
      if (rest.length) actions.push({ type: "pause", duration: 80 });
      actions.push({ type: "pointerUp", button: 0 });
      await driver.performActions([{ type: "pointer", id: "finger1", parameters: { pointerType: "touch" }, actions }]);
      await driver.releaseActions().catch(() => {});
    } finally {
      await driver.switchContext(web);
    }
  };
  const centre = async (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  /** A diagonal stroke from the screen centre: right `dx`, down `dy`, in eight legs (the pad reads
   *  pointermove deltas — one long leg would be one delta, fine for the math, unlike a thumb). */
  const diagonal = async (dx, dy) => {
    const vw = await js(`innerWidth`), vh = await js(`innerHeight`);
    const cx = vw / 2, cy = vh / 2;
    const path = [{ x: cx, y: cy }];
    for (let i = 1; i <= 8; i++) path.push({ x: cx + (dx * i) / 8, y: cy + (dy * i) / 8 });
    await nativeStroke(path, { holdMs: 80, legMs: 70 });
    await sleep(500);
  };
  const holdChip = async (sel, ms) => { const c = await centre(sel); if (!c) throw new Error(`no ${sel}`); await nativeStroke([c], { holdMs: ms }); };
  /** A WebDriver `element.click()` is a synthetic click through the remote inspector (the 2026-10-10 keyboard
   *  lesson): iOS does not count it as a user activation, so `DeviceOrientationEvent.requestPermission()` rejects
   *  from it (the chip flashed TAP AGAIN on farm run 1). The AR chip takes a NATIVE tap; plain buttons may click. */
  const nativeTap = async (sel) => { await holdChip(sel, 90); await sleep(400); };
  const tapSel = async (sel) => { const el = await driver.$(sel); await el.click(); await sleep(400); };

  try {
    try { await driver.setTimeout({ script: 25_000 }); } catch { /* older driver */ }
    await boot(URL_FPV);
    if (!(await waitFor(READY_FPV, 150_000, "the /m FPV HUD"))) throw new Error("the /m FPV shell never came up");
    await sleep(6000); // the city streams in; the AR chip is live once the HUD is
    const stored0 = await js(STORED);
    info(`stored calibration before the leg: ${stored0 === null ? "none" : String(stored0).slice(0, 120)}`);
    // AR on — a NATIVE tap (a real touch = a user activation); the motion sheet comes from the gesture
    await nativeTap(".m-arbtn");
    await acceptSheet("motion");
    let arOn = await waitFor(`!!document.querySelector(".m-cambtn")`, 8_000, "AR armed");
    if (!arOn) { info(`AR not armed after tap 1: ${JSON.stringify(await js(DIAG))}`); await nativeTap(".m-arbtn"); await acceptSheet("motion"); arOn = await waitFor(`!!document.querySelector(".m-cambtn")`, 8_000, "AR armed (tap 2)"); }
    check("A0 AR armed by a native tap (the CAM chip appeared)", arOn, JSON.stringify(await js(DIAG)));
    // The long press: a NATIVE hold on the AR chip (its own 500 ms timer opens calibration while AR is on)
    await holdChip(".m-arbtn", 850);
    await acceptSheet("camera");
    const padUp = await waitFor(`!!document.querySelector(".m-arcal__pad")`, 10_000, "the calibration pad");
    check("A1 a native hold on AR opens CALIBRATE AR (the pad is up)", padUp, JSON.stringify(await js(DIAG)));
    if (!padUp) throw new Error("no calibration pad — the rest of the leg needs it");
    await sleep(1500);
    const axes0 = await js(AXES_READ);
    check("A2 ↕ PITCH is the TOP cell of the verdict column, OFF on entry, CANCEL's own ink", !!axes0 && axes0.pressed === "false" && !axes0.accent && axes0.aboveCancel === true && axes0.sameInk !== false && axes0.acts === "ar-cal-axes,ar-cal-cancel,ar-cal-reset,ar-cal-confirm", JSON.stringify(axes0));
    check("A2b …a 44 pt round cell like the others", !!axes0 && Math.abs(axes0.w - 44) < 1.5 && Math.abs(axes0.h - 44) < 1.5 && /50%|22px/.test(axes0.round || ""), axes0 ? `${axes0.w}×${axes0.h} ${axes0.round}` : "");
    const read0 = await js(CAL_READ);
    const hudP0 = await js(HUD_PITCH);
    info(`readout on entry ${JSON.stringify(read0)} · HUD pitch ${hudP0}`);
    const hasReadout = !!(read0 && typeof read0.yaw === "number");
    if (!hasReadout) info(`no YAW · PITCH readout (the camera sheet declined? strip: "${read0 && read0.text}") — the HUD's PITCH is the witness`);
    await shot("A-calibrate-open");
    // THE DIAGONAL under the lock: right 90, down 60
    await diagonal(90, 60);
    const read1 = await js(CAL_READ);
    const hudP1 = await js(HUD_PITCH);
    info(`after the locked diagonal ${JSON.stringify(read1)} · HUD pitch ${hudP1}`);
    if (hasReadout) {
      check(`A3 the locked diagonal TURNED the view (YAW ${read1 && read1.yaw}° ≠ 0)`, !!read1 && typeof read1.yaw === "number" && Math.abs(read1.yaw) > 1, JSON.stringify(read1));
      check(`A4 …and tilted it by NOTHING (PITCH ${read1 && read1.pitch}° = ${read0.pitch}° on entry)`, !!read1 && typeof read1.pitch === "number" && Math.abs(read1.pitch - read0.pitch) < 0.05, JSON.stringify(read1));
    } else {
      check(`A4 the locked diagonal left the VIEW's pitch where the sensors hold it (HUD ${hudP0}° → ${hudP1}°, within 1.5° of sensor sway)`, hudP0 !== null && hudP1 !== null && Math.abs(hudP1 - hudP0) < 1.5, "");
    }
    await shot("A-after-locked-drag");
    // ↕ PITCH frees the second axis
    await tapSel('[data-act="ar-cal-axes"]');
    const axes1 = await js(AXES_READ);
    check("A5 ↕ PITCH tapped → lit (aria-pressed true, the accent)", !!axes1 && axes1.pressed === "true" && axes1.accent === true, JSON.stringify(axes1));
    await diagonal(90, 60);
    const read2 = await js(CAL_READ);
    const hudP2 = await js(HUD_PITCH);
    info(`after the free diagonal ${JSON.stringify(read2)} · HUD pitch ${hudP2}`);
    if (hasReadout) {
      check(`A6 with PITCH on the same diagonal TILTS the view (PITCH ${read2 && read2.pitch}°, was ${read1 && read1.pitch}°)`, !!read2 && typeof read2.pitch === "number" && Math.abs(read2.pitch - read1.pitch) > 1, JSON.stringify(read2));
      check(`A6b …and keeps turning it (YAW ${read2 && read2.yaw}° vs ${read1 && read1.yaw}°)`, !!read2 && typeof read2.yaw === "number" && Math.abs(read2.yaw - read1.yaw) > 1, "");
    } else {
      check(`A6 with PITCH on the same diagonal moved the VIEW's pitch (HUD ${hudP1}° → ${hudP2}°)`, hudP1 !== null && hudP2 !== null && Math.abs(hudP2 - hudP1) > 1.5, "");
    }
    await shot("A-after-free-drag");
    // CANCEL: nothing stored changes; a second hold re-opens LOCKED
    await tapSel('[data-act="ar-cal-cancel"]');
    const stored1 = await js(STORED);
    check("A7 CANCEL closes the pad and leaves the stored record as it was", !(await js(`!!document.querySelector(".m-arcal__pad")`)) && stored1 === stored0, `stored ${stored1 === null ? "none" : "kept"}`);
    await holdChip(".m-arbtn", 850);
    await acceptSheet("camera");
    const padUp2 = await waitFor(`!!document.querySelector(".m-arcal__pad")`, 10_000, "the pad again");
    const axes2 = await js(AXES_READ);
    check("A8 a second hold re-opens the pad LOCKED again — the toggle is per visit", padUp2 && !!axes2 && axes2.pressed === "false" && !axes2.accent, JSON.stringify(axes2));
    await shot("A-reopened-locked");
    await tapSel('[data-act="ar-cal-cancel"]');
    await tapSel(".m-arbtn"); // AR off — the camera is released with the overlay
    await sleep(600);
    check("A9 AR off takes the overlay with it", !(await js(`!!document.querySelector(".m-arcam")`)) && !(await js(`!!document.querySelector(".m-cambtn")`)), "");
    save();
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

log(`AR axes lock 2026-10-14 on the farm — device "${DEVICE_MODEL}" ${PROD ? "LIVE " + BASE : "host " + (HOST || "(dry run)")}`);
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
