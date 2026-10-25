// T200 — THE MOON'S PERCEIVED VISIBILITY on glass (owner 2026-10-25e). Boots an FPV frame AIMED AT THE MOON
// (the almanac's own topocentric az / alt — astronomy-engine, airless, the house contract) at a ladder of
// dusk / dawn / day / night instants over Dnipro, on the phone twins and the desktop, and reads the DISC
// against the SKY AROUND IT from a device-scale PNG: the disc core's luminance percentiles and mean RGB, the
// sky annulus's, the Weber contrast (disc − sky) / sky and the disc's R/G · B/G (the reddening of a low moon).
// `--baseline` records the "before" as INFO; a later run compares. `--prod` reads the LIVE site (no `__` seams:
// a fixed settle, DOM-free) — the same cells, the same reader.
//
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-t200-moon.mjs [cdpPort] [--devices iphone,pixel,desktop]
//        [--cells dusk-full-low,…] [--fov 14] [--eye 90] [--label post] [--compare pre] [--legs M,V] [--baseline] [--prod] [--settle 9000]
// Shots → verify-shots/t200-moon/<label>/ (git-ignored). Runs on the ONE house Chrome.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { Observer, Body, Equator, Horizon, MakeTime, Illumination } from "astronomy-engine";
import { sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const DEVICES = opt("--devices", "iphone,pixel,desktop").split(",");
const CELLS = opt("--cells", "").split(",").filter(Boolean);
const FOV = Number(opt("--fov", "14"));
const EYE = Number(opt("--eye", "90"));
const LABEL = opt("--label", "run");
const COMPARE = opt("--compare", "");
const REPLAY = opt("--replay", "");
const LEGS = opt("--legs", "M").split(",");
const SETTLE = Number(opt("--settle", "9000"));
const BASELINE = args.includes("--baseline");
const PROD = args.includes("--prod");
const APP = (process.env.FTW_APP_URL || (PROD ? "https://www.plux.today" : "http://localhost:4321")).replace(/\/$/, "");
const SHOTS = `verify-shots/t200-moon/${LABEL}`;
mkdirSync(SHOTS, { recursive: true });
const BOOT_MS = 75_000;

// The owner's Dnipro street — the sunset pose's own site (`poses.mjs` dnipro-fpv-west-sunset), 90 m up so the
// low moon clears the roofs.
const SITE = { lat: 48.464627, lon: 35.064907 };

/** The ladder: every cell is a REAL instant (UTC ms) with the moon up over Dnipro; the aim is computed below. */
const INSTANTS = {
  "dusk-full-low": Date.UTC(2026, 9, 25, 14, 45), // sun −2.8° · the full moon 8.4° up in the east — the owner's own evening
  "dusk-gibbous-daylight": Date.UTC(2026, 9, 20, 14, 30), // sun +1.0° · gibbous (0.68) at 15.6° — the daylight moon
  "dusk-quarter-nautical": Date.UTC(2026, 9, 18, 15, 30), // sun −8.1° · first quarter at 16.7° — the dark limb vs a lit sky
  "dawn-full-setting": Date.UTC(2026, 9, 26, 4, 0), // sun −3.4° · the full moon 4.5° up in the west — heavy airmass
  "day-quarter-high": Date.UTC(2026, 10, 2, 8, 0), // sun +24.1° · last quarter (0.45) 32.9° up in the morning sky — the daytime moon
  "night-full": Date.UTC(2026, 6, 29, 22, 10), // sun −22.8° · full moon 21° — the classic night disc (verify-s5-night's instant)
};

const obs = new Observer(SITE.lat, SITE.lon, 0);
function azAlt(body, ms) {
  const t = MakeTime(new Date(ms));
  const eq = Equator(body, t, obs, true, true);
  const h = Horizon(t, obs, eq.ra, eq.dec);
  return { az: h.azimuth, alt: h.altitude };
}
function cellAim(ms) {
  const m = azAlt(Body.Moon, ms), s = azAlt(Body.Sun, ms);
  const il = Illumination(Body.Moon, MakeTime(new Date(ms)));
  return { moonAz: m.az, moonAlt: m.alt, sunAlt: s.alt, illum: il.phase_fraction, phaseAngle: il.phase_angle, mag: il.mag };
}

const TWINS = {
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  pixel: { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true },
  narrow: { width: 360, height: 780, deviceScaleFactor: 3, mobile: true },
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false },
};

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const info = (name, detail = "") => console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
console.log(`target ${APP} · devices ${DEVICES.join(",")} · fov ${FOV} · eye ${EYE} m · label ${LABEL}${BASELINE ? " · BASELINE" : ""}${PROD ? " · PROD (no seams)" : ""}`);

async function attach(device) {
  const dev = TWINS[device];
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
  if (dev.mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  }
  const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
  const glass = async (name) => {
    await send("Page.bringToFront").catch(() => {});
    const r = await send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(r.data, "base64");
    if (name) writeFileSync(`${SHOTS}/${name}.png`, buf);
    const { data, info: meta } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { buf, data, W: meta.width, H: meta.height, ch: meta.channels };
  };
  const goto = async (url, settleMs = 1500) => { await send("Page.navigate", { url: "about:blank" }); await sleep(200); await send("Page.navigate", { url }); await send("Page.bringToFront").catch(() => {}); await sleep(settleMs); };
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalJs(expr).catch(() => false); if (v) return true; await sleep(300); } return false; };
  const rect = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent.trim() }; })()`);
  return { dev, send, evalJs, glass, goto, waitFor, rect, close: () => ws.close() };
}

// ---- the glass reader -------------------------------------------------------------------------------------
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Pixel stats over an annulus r0..r1 (phys px) about (cx, cy). */
function ring(img, cx, cy, r0, r1) {
  const { data, W, H, ch } = img;
  let R = 0, G = 0, B = 0, n = 0; const L = [];
  for (let y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(H - 1, Math.ceil(cy + r1)); y++)
    for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(W - 1, Math.ceil(cx + r1)); x++) {
      const d = Math.hypot(x - cx, y - cy); if (d < r0 || d > r1) continue;
      const i = (y * W + x) * ch; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; L.push(lum(data[i], data[i + 1], data[i + 2]));
    }
  if (!n) return null;
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.floor(p * (L.length - 1))];
  return { n, rgb: [R / n, G / n, B / n].map((v) => Math.round(v)), p10: Math.round(q(0.1)), p50: Math.round(q(0.5)), p90: Math.round(q(0.9)), max: Math.round(L[L.length - 1]) };
}
/** The disc's radius on glass: the moon's angular radius against the VERTICAL fov. */
function discRadiusPx(fovDeg, hPhys, moonAngRadDeg = 0.259) {
  return (Math.tan((moonAngRadDeg * Math.PI) / 180) / Math.tan((fovDeg / 2) * Math.PI / 180)) * (hPhys / 2);
}

async function cell(g, device, name, ms) {
  const aim = cellAim(ms);
  const path = g.dev.mobile ? "/m" : "/";
  const hash = `#f=${SITE.lat.toFixed(6)},${SITE.lon.toFixed(6)},${EYE.toFixed(1)},${aim.moonAz.toFixed(1)},${aim.moonAlt.toFixed(1)},${FOV.toFixed(1)}&t=${ms}`;
  const url = `${APP}${path}${hash}`;
  const tag = `${device}-${name}`;
  info(`${tag} ${new Date(ms).toISOString()} sun ${aim.sunAlt.toFixed(1)}° · moon ${aim.moonAlt.toFixed(1)}° @ ${aim.moonAz.toFixed(1)}° · illum ${aim.illum.toFixed(2)} · α ${aim.phaseAngle.toFixed(0)}° · mag ${aim.mag.toFixed(1)}`);
  await g.goto(url, 1500);
  if (PROD) {
    await sleep(BOOT_MS / 3);
  } else {
    const booted = await g.waitFor(`!!(window.__globe && window.__globe.fpv && window.__globe.fpv().active)`, BOOT_MS);
    if (!booted) { check(`${tag} FPV boots`, false, "no fpv().active within the boot budget"); return null; }
  }
  await sleep(SETTLE);
  // Optional: the dev seam's deterministic capture (the sweep's idiom); harmless if absent.
  if (!PROD) await g.evalJs(`(() => { try { window.__globe.freezeFrame && window.__globe.freezeFrame(true); } catch {} return 1; })()`).catch(() => {});
  await sleep(300);
  const img = await g.glass(tag);
  if (!PROD) await g.evalJs(`(() => { try { window.__globe.freezeFrame && window.__globe.freezeFrame(false); } catch {} return 1; })()`).catch(() => {});
  const cv = (await g.rect("canvas")) ?? { x: 0, y: 0, w: g.dev.width, h: g.dev.height };
  const dpr = g.dev.deviceScaleFactor;
  let cx = (cv.x + cv.w / 2) * dpr, cy = (cv.y + cv.h / 2) * dpr;
  // The LIVE camera (dev seam): the FPV boot may settle a hair off the hash in PITCH (the yaw seam reads the
  // controls' own frame, not a compass heading — never used), so the disc centre is corrected from the camera's
  // own pitch / fov; then, for a full or gibbous disc, the bright blob nearest the prediction refines it.
  let fovV = FOV;
  if (!PROD) {
    const f = await g.evalJs(`(() => { const f = window.__globe.fpv(); return { pitch: f.pitchDeg, fov: f.fovDeg }; })()`).catch(() => null);
    if (f && Number.isFinite(f.pitch)) {
      fovV = f.fov || FOV;
      const fPx = (cv.h * dpr) / 2 / Math.tan((fovV / 2) * Math.PI / 180);
      cy -= fPx * Math.tan(((aim.moonAlt - f.pitch) * Math.PI) / 180);
      if (Math.abs(aim.moonAlt - f.pitch) > 0.05) info(`${tag} camera pitch ${f.pitch.toFixed(2)} vs aim ${aim.moonAlt.toFixed(2)} → disc y ${Math.round(cy)}`);
    }
  }
  const r0 = discRadiusPx(fovV, cv.h * dpr);
  {
    // Blob refinement: the centroid of "bright" pixels (above the local sky by 40) within ±2.5 r of the prediction.
    const sky0 = ring(img, cx, cy, r0 * 1.6, r0 * 2.6) ?? { p50: 0 };
    const thr = sky0.p50 + 40;
    let sx = 0, sy = 0, n = 0;
    const win = Math.round(r0 * (PROD ? 6 : 2.5)); // no seams live: the centre may be off by the hash's settle — search wide
    for (let y = Math.max(0, Math.round(cy - win)); y <= Math.min(img.H - 1, Math.round(cy + win)); y++)
      for (let x = Math.max(0, Math.round(cx - win)); x <= Math.min(img.W - 1, Math.round(cx + win)); x++) {
        const i = (y * img.W + x) * img.ch;
        if (lum(img.data[i], img.data[i + 1], img.data[i + 2]) > thr) { sx += x; sy += y; n++; }
      }
    const area = Math.PI * r0 * r0;
    if (n > area * 0.2 && aim.illum >= 0.85) {
      const bx = sx / n, by = sy / n;
      info(`${tag} bright blob ${n} px (${(n / area).toFixed(2)} of a disc) at ${Math.round(bx)},${Math.round(by)} vs predicted ${Math.round(cx)},${Math.round(cy)}`);
      cx = bx; cy = by;
    } else if (n > 0) info(`${tag} bright pixels ${n} (${(n / area).toFixed(2)} of a disc) — centre kept at the prediction`);
  }
  const r = discRadiusPx(fovV, cv.h * dpr);
  const core = ring(img, cx, cy, 0, r * 0.72);
  const limb = ring(img, cx, cy, r * 0.72, r * 0.98);
  const sky = ring(img, cx, cy, r * 1.6, r * 2.4);
  if (!core || !sky) { check(`${tag} readable`, false, "empty ring"); return null; }
  const contrast = (core.p50 - sky.p50) / Math.max(1, sky.p50);
  const peakContrast = (core.p90 - sky.p50) / Math.max(1, sky.p50);
  const darkDelta = core.p10 - sky.p50; // < 0 ⇒ some of the disc reads DARKER than the sky around it
  const tint = { rg: +(core.rgb[0] / Math.max(1, core.rgb[1])).toFixed(3), bg: +(core.rgb[2] / Math.max(1, core.rgb[1])).toFixed(3) };
  const skyTint = { rg: +(sky.rgb[0] / Math.max(1, sky.rgb[1])).toFixed(3), bg: +(sky.rgb[2] / Math.max(1, sky.rgb[1])).toFixed(3) };
  // a 3× crop around the disc for the eye
  const pad = Math.round(r * 2.6);
  try {
    await sharp(img.buf).extract({ left: Math.max(0, Math.round(cx - pad)), top: Math.max(0, Math.round(cy - pad)), width: Math.min(img.W - Math.max(0, Math.round(cx - pad)), 2 * pad), height: Math.min(img.H - Math.max(0, Math.round(cy - pad)), 2 * pad) }).resize({ width: 480, kernel: "nearest" }).png().toFile(`${SHOTS}/${tag}-crop.png`);
  } catch (e) { info(`${tag} crop failed`, String(e.message)); }
  const row = { device, cell: name, ms, ...aim, r: +r.toFixed(1), core, limb, sky, contrast: +contrast.toFixed(3), peakContrast: +peakContrast.toFixed(3), darkDelta, tint, skyTint };
  console.log(`DATA  ${tag} disc p10/p50/p90 ${core.p10}/${core.p50}/${core.p90} rgb ${core.rgb.join(",")} · sky p50 ${sky.p50} rgb ${sky.rgb.join(",")} · contrast ${contrast.toFixed(2)} (peak ${peakContrast.toFixed(2)}) · dark−sky ${darkDelta} · tint r/g ${tint.rg} b/g ${tint.bg} (sky ${skyTint.rg}/${skyTint.bg})`);
  return row;
}

// ---- leg V: the VERDICT on the planning surfaces (DOM text — works on the live site too) ---------------
const OPEN_PLAN_M = `(() => { const b = [...document.querySelectorAll("button")].find((x) => /\\bPLAN\\b/.test(x.textContent || "")); if (!b) return "no PLAN tab"; b.click(); return "clicked"; })()`;
const OPEN_PLAN_D = `(() => { const b = [...document.querySelectorAll("button")].find((x) => /^\\s*☀?\\s*PLAN\\s*$/.test(x.textContent || "") || /planning window|Light planner|PLAN\\/FIND|plan/i.test(x.getAttribute("aria-label") || "")); if (!b) return "no PLAN button"; b.click(); return "clicked"; })()`;
const READ_VERDICTS = `(() => { const t = document.body.innerText || ""; const ver = (document.querySelector(".version-stamp") || {}).textContent || null; const now = t.match(/☾ NOW · ([A-Z ]+?)(?: ·|\\n|$)/); const rows = [...t.matchAll(/☾ (RISE|SET)[\\s\\S]{0,60}?☾ ([A-Z][A-Z ]*?)(?:\\n|$)/g)].map((m) => m[1] + ":" + m[2].trim()); return { now: now ? now[1].trim() : null, rows, hasPlan: /LIGHT PLANNER|TODAY · MIDNIGHT/.test(t), version: ver ? ver.trim() : null }; })()`;
async function verdictLeg(g, device) {
  const cases = [["dusk", INSTANTS["dusk-full-low"], "BRIGHT"], ["day-quarter", INSTANTS["day-quarter-high"], "PALE"]];
  for (const [id, ms, want] of cases) {
    const path = g.dev.mobile ? "/m" : "/";
    await g.goto(`${APP}${path}#p=48.4640,35.0460,2200,0,0&t=${ms}`, 1500);
    if (PROD) await sleep(BOOT_MS / 4); else await g.waitFor(`!!window.__globe && !!document.querySelector("canvas")`, BOOT_MS);
    await sleep(3000);
    const opened = await g.evalJs(g.dev.mobile ? OPEN_PLAN_M : OPEN_PLAN_D).catch((e) => String(e.message));
    await sleep(2000);
    const v = await g.evalJs(READ_VERDICTS).catch(() => null);
    await g.glass(`${device}-V-${id}`);
    info(`${device}-V-${id} ${opened} → ${JSON.stringify(v)}`);
    check(`${device}-V-${id} the PLAN surface opened (${opened}; version ${v && v.version})`, opened === "clicked" && !!v && v.hasPlan, "");
    check(`${device}-V-${id} the MOON section's NOW line reads ${want} (got ${v && v.now})`, !!v && v.now === want, "");
    if (id === "dusk") check(`${device}-V-${id} the TODAY moonrise row carries a ☾ verdict (${v && v.rows.join(" ")})`, !!v && v.rows.some((r) => r.startsWith("RISE:")), "");
  }
}

const rows = [];
try {
  const names = CELLS.length ? CELLS : Object.keys(INSTANTS);
  if (REPLAY) {
    // `--replay <label>`: re-judge a recorded run's report.json against the expectations (no Chrome).
    rows.push(...JSON.parse(readFileSync(`verify-shots/t200-moon/${REPLAY}/report.json`, "utf8")).rows);
    info(`replay ${REPLAY}`, `${rows.length} cells`);
  } else
  for (const device of DEVICES) {
    const g = await attach(device);
    try {
      if (LEGS.includes("V")) await verdictLeg(g, device);
      if (LEGS.includes("M")) for (const name of names) {
        const ms = INSTANTS[name];
        if (!ms) { check(`cell ${name} exists`, false); continue; }
        const row = await cell(g, device, name, ms);
        if (row) rows.push(row);
      }
    } finally { g.close(); }
  }
  if (!REPLAY) {
    writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ label: LABEL, app: APP, fov: FOV, eye: EYE, rows }, null, 2));
    console.log(`report ${SHOTS}/report.json · ${rows.length} cells`);
  }
  if (!BASELINE && !PROD) {
    // THE EXPECTATIONS (T200, 2026-10-25f) — against the "before" of `--compare <label>` when given
    // (`verify-shots/t200-moon/<label>/report.json`, recorded with `--baseline`), else absolute.
    let base = null;
    if (COMPARE) {
      try { base = JSON.parse(readFileSync(`verify-shots/t200-moon/${COMPARE}/report.json`, "utf8")).rows; }
      catch (e) { check(`baseline ${COMPARE} readable`, false, String(e.message)); }
    }
    const baseOf = (r) => base?.find((b) => b.device === r.device && b.cell === r.cell) ?? null;
    for (const r of rows) {
      const tag = `${r.device}-${r.cell}`;
      const b = baseOf(r);
      check(`${tag} the disc is on glass (core p90 ${r.core.p90} > sky p50 ${r.sky.p50} + 6)`, r.core.p90 > r.sky.p50 + 6);
      if (r.cell === "dusk-full-low" || r.cell === "dawn-full-setting") {
        // the low full moon is ORANGE (b/g well under the night disc's ~0.96) and dimmer than before
        check(`${tag} the low moon is orange on glass (b/g ${r.tint.bg} < 0.85)`, r.tint.bg < 0.85, "");
        check(`${tag} …and warmer than white (r/g ${r.tint.rg} > 1.04)`, r.tint.rg > 1.04, "");
        if (b) check(`${tag} …dimmer than the white "before" (p50 ${r.core.p50} < ${b.core.p50}; b/g ${r.tint.bg} < ${b.tint.bg} − 0.08)`, r.core.p50 < b.core.p50 && r.tint.bg < b.tint.bg - 0.08, "");
        check(`${tag} …but never erased (core p50 ${r.core.p50} > sky p50 ${r.sky.p50} + 40)`, r.core.p50 > r.sky.p50 + 40, "");
      }
      if (r.cell === "dawn-full-setting") {
        const dusk = rows.find((x) => x.device === r.device && x.cell === "dusk-full-low");
        if (dusk) check(`${tag} the 4.5° moon is deeper orange than the 8.4° one (b/g ${r.tint.bg} < ${dusk.tint.bg})`, r.tint.bg < dusk.tint.bg, "");
      }
      if (r.cell === "dusk-gibbous-daylight")
        check(`${tag} the dark limb no longer punches a hole in the twilight sky (dark−sky ${r.darkDelta} ≥ −4; was −16)`, r.darkDelta >= -4, "");
      if (r.cell === "night-full" || r.cell === "day-quarter-high" || r.cell === "dusk-quarter-nautical") {
        // ABOVE THE BAND nothing moves: the night disc at 21°, the daytime quarter at 33°, the quarter at 16.7°
        if (b) check(`${tag} unchanged above the band (p50 ${r.core.p50} vs ${b.core.p50} ±3 · b/g ${r.tint.bg} vs ${b.tint.bg} ±0.03 · dark−sky ${r.darkDelta} vs ${b.darkDelta} ±3)`,
          Math.abs(r.core.p50 - b.core.p50) <= 3 && Math.abs(r.tint.bg - b.tint.bg) <= 0.03 && Math.abs(r.darkDelta - b.darkDelta) <= 3, "");
        if (r.cell === "night-full") check(`${tag} the night disc stays neutral (b/g ${r.tint.bg} in 0.9–1.05)`, r.tint.bg > 0.9 && r.tint.bg < 1.05, "");
      }
    }
  }
} catch (e) {
  console.error("harness error", e);
  failures++;
}
await finishVerify(failures ? 1 : 0);
