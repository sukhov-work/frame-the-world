// Browser verification for OWNER BATCH #5 (2026-08-21d — post-batch-#4 fixes).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch5.mjs [cdpPort] [shotsDir]
//
// Asserts:
//   Desktop leg
//   1. Item 1 — radar band RESTING fills + focal-cone edge weight (shots for the eye; the
//      fillAlphaRest/band math is unit-locked in aimCones.test.ts)
//   2. Item 6 — the Mobile nav link rewrites to /m + pose hash with tilt forced to 0; /m
//      boots the 2D map at the exact coords/altitude (camera-store probe)
//   /m leg (mobile emulation: coarse pointer + touch)
//   3. Item 5 — dock date+time: input.md-time[type=time] exists; .md-date styled (no
//      whole-input invert, solid border, dark color-scheme)
//   4. Item 3 — PiP box is 32vw × 32dvh (viewport-aspect miniature), hole cleared on the map
//      canvas, mid-stack chrome (.mm) hidden while the map is up
//   5. Item 4 — long-press on the map PLACES the temp pin and the map STAYS open
//   6. Item 6 reverse — DESKTOP chip carries the live hash back to /?d=1
// Screenshots land in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
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
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const shoot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
    console.log(`shot  ${SHOTS}/${name}.jpeg`);
  };
  const goto = async (url, settleMs = 1500) => {
    await send("Page.navigate", { url });
    await sleep(settleMs);
  };
  const rect = (sel) =>
    evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  return { send, evalJs, shoot, goto, rect, click };
}

// ───────────────────────── Desktop leg ─────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await d.goto(ORBIT_URL, 16000);

// 1 — item 1: resting band fills (focus stays on the DEFAULT target — the sun/moon strips
// must show their body-tinted wash regardless) + focal-cone edge weight (plannedView seeded
// directly). Shots for the eye; the alphas/widths are tunable-locked.
await d.evalJs(`window.__cameraStore.getState().setPlannedView({ headingDeg: 40, hFovDeg: 60 })`);
await sleep(1500);
await d.shoot("uxb5-01-desktop-radar-resting-fills-cone");
const planned = await d.evalJs(`window.__cameraStore.getState().plannedView?.hFovDeg ?? null`);
check("desktop: plannedView seeded (cone drawn for the shot)", planned === 60, String(planned));

// 2 — item 6: the Mobile nav link carries the pose with tilt forced to 0
const hashBefore = await d.evalJs(`location.hash`);
check("desktop: pose hash mirrored before the switch", /^#p=/.test(hashBefore), hashBefore);
await d.evalJs(`(() => { const a = document.querySelector('.topnav a[href="/m"]'); a?.click(); return !!a; })()`);
await sleep(12000);
// NOTE: /m re-mirrors the LIVE camera into the hash within ~1.6 s of boot (urlPoseEveryFrames),
// so the exact transformed link hash is unreadable this late — the tilt-0 transform itself is
// unit-locked (mobileShellHash tests). Assert the race-free facts: we ARE on /m, the pose is a
// near-nadir orbit (< the 10° 2D door), and the scene time rode along.
const mUrl = await d.evalJs(`location.pathname + location.hash`);
const mTilt = Number((/^\/m#p=[^,]+,[^,]+,[^,]+,[^,]+,([\d.]+)/.exec(mUrl) ?? [])[1]);
check("desktop→/m: on /m with a near-nadir pose hash + scene time", /^\/m#p=/.test(mUrl) && mTilt < 10 && mUrl.includes("&t="), mUrl);
const mBoot = await d.evalJs(
  `(() => { const c = window.__cameraStore.getState(); return { mode: c.mapMode, lat: c.focusLatDeg, lon: c.focusLonDeg, alt: c.zoomAltM }; })()`,
);
check(
  "desktop→/m: 2D map at the exact coords/altitude (no 1100 km default)",
  mBoot.mode === "2d" && Math.abs(mBoot.lat - 48.464) < 0.02 && Math.abs(mBoot.lon - 35.046) < 0.02 && mBoot.alt > 1200 && mBoot.alt < 6000,
  JSON.stringify(mBoot),
);
await d.shoot("uxb5-02-shell-switch-landed-2d");

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto("http://localhost:4321/m", 14000);

// 3 — item 5: dock date+time = the desktop scrubber twins
const timeInput = await m.evalJs(`!!document.querySelector('input.md-time[type="time"]')`);
check("/m: dock time readout IS a native time input", timeInput === true);
const dateStyle = await m.evalJs(`(() => {
  const el = document.querySelector(".md-date");
  if (!el) return null;
  const s = getComputedStyle(el);
  return { filter: s.filter, border: s.borderTopStyle, scheme: s.colorScheme, radius: s.borderRadius };
})()`);
check(
  "/m: .md-date styled again (no whole-input invert; solid border; dark scheme)",
  dateStyle !== null && dateStyle.filter === "none" && dateStyle.border === "solid" && /dark/.test(dateStyle.scheme),
  JSON.stringify(dateStyle),
);
const clockGone = await m.evalJs(`document.querySelector("span.md-clock") === null`);
check("/m: read-only clock span retired", clockGone === true);
await m.shoot("uxb5-03-m-dock-datetime");

// 4+5 — items 3/4: FPV → fullscreen map → PiP geometry + place-point stays on the map
const chipRect = await m.rect(".m-actrow button");
if (chipRect) {
  const cx = chipRect.x + chipRect.w / 2;
  const cy = chipRect.y + chipRect.h / 2;
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await sleep(700);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(4500);
  check("/m: long-press 3D entered FPV", await m.evalJs(`!!document.querySelector(".m-joy")`));
  await m.click(".mm-open");
  await sleep(3000);

  // Item 3 — PiP: viewport-fraction box (aspect = screen aspect ⇒ true miniature)
  const pip = await m.rect(".mw-pip");
  const vp = await m.evalJs(`({ w: innerWidth, h: innerHeight })`);
  check(
    "/m: PiP box is 32vw × 32dvh (viewport-aspect miniature)",
    pip !== null && Math.abs(pip.w - vp.w * 0.32) < 2 && Math.abs(pip.h - vp.h * 0.32) < 3,
    `${JSON.stringify(pip)} vs vp ${JSON.stringify(vp)}`,
  );
  const holeProbe = await m.evalJs(`(() => {
    const pip = document.querySelector(".mw-pip");
    const canvas = document.querySelector(".mw-canvas");
    if (!pip || !canvas) return null;
    const pr = pip.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const dpr = canvas.width / cr.width;
    const ctx = canvas.getContext("2d");
    const inside = ctx.getImageData((pr.left - cr.left + pr.width / 2) * dpr, (pr.top - cr.top + pr.height / 2) * dpr, 1, 1).data;
    const outside = ctx.getImageData((pr.left - cr.left - 24) * dpr, (pr.top - cr.top + pr.height / 2) * dpr, 1, 1).data;
    return { insideAlpha: inside[3], outsideAlpha: outside[3] };
  })()`);
  check(
    "/m: hole cleared on the map canvas, chart intact beside it",
    holeProbe !== null && holeProbe.insideAlpha === 0 && holeProbe.outsideAlpha === 255,
    JSON.stringify(holeProbe),
  );
  const pipPublished = await m.evalJs(`window.__minimapStore.getState().pipRect !== null`);
  check("/m: PiP rect published to the engine (scaled pass armed)", pipPublished === true);
  const mmHidden = await m.evalJs(
    `(() => { const el = document.querySelector(".mm"); return el ? getComputedStyle(el).visibility : "absent"; })()`,
  );
  check("/m: minimap card hidden under the map (no minimap-in-minimap)", mmHidden === "hidden" || mmHidden === "absent", mmHidden);
  await m.shoot("uxb5-04-m-pip-miniature");

  // Item 4 — long-press on the chart places the pin and STAYS in the map. Press point must
  // clear the left stick rail (walk + aim, x ≲ 126 since batch #6) AND the top-right PiP.
  const pinBefore = await m.evalJs(`JSON.stringify(window.__cameraStore.getState().tempPin)`);
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 230, y: 520, id: 1 }] });
  await sleep(750);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const pinAfter = await m.evalJs(`JSON.stringify(window.__cameraStore.getState().tempPin)`);
  const mapStillOpen = await m.evalJs(`!!document.querySelector(".mw")`);
  check("/m: long-press PLACED the point (temp pin moved)", pinAfter !== pinBefore && pinAfter !== "null", `${pinBefore} → ${pinAfter}`);
  check("/m: map STAYED open (no FPV jump)", mapStillOpen === true);
  await m.shoot("uxb5-05-m-place-point-stays");

  // Back to FPV via the PiP; then item 6 reverse — DESKTOP chip carries the hash
  await m.click(".mw-pip");
  await sleep(1500);
  check("/m: PiP tap returned to FPV", await m.evalJs(`document.querySelector(".mw") === null`));
  const mHash = await m.evalJs(`location.hash`);
  await m.evalJs(`(() => { const a = document.querySelector('a.m-chip[href="/?d=1"]'); a?.click(); return !!a; })()`);
  await sleep(2500);
  const dUrl = await m.evalJs(`location.pathname + location.search + location.hash`);
  check(
    "/m→desktop: DESKTOP chip carried the live hash",
    dUrl.startsWith("/?d=1#") && mHash.length > 2 && dUrl.endsWith(mHash),
    `${mHash} → ${dUrl}`,
  );
} else {
  check("/m: long-press 3D entered FPV", false, "no ▲ 3D chip found");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
