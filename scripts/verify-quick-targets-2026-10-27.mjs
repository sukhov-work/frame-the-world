// Browser verification of the 2026-10-27 QUICK TARGETS (owner: "two quick buttons — round, only the icons — of
// sun and moon on the left of the tracked object's name, to start tracking them (and goto) regardless of what is
// tracked; the redundant one dropped on the sun's / the moon's own panel; also pin them as quick search targets in
// the search panel list and under them add 3 recent sky searches").
//   1. THE PEEK BAR (iPhone · Pixel · 360 px twins, the /m MAP): ☀ then ☾ lead the row, 25 px round cells; the bar
//      is not a pixel taller than the 2026-10-25 row (38.59 px — the owner's hard line); the name keeps a 6-letter
//      budget; a tap on ☀ makes the sun the target (SHOW on, the lock on) and turns the planned cone to it, the ☀
//      cell leaves and ☾ stays; the touch extension fires from above the cell; a plain row tap still opens TARGET;
//      the console carries no nested-button warning.
//   2. FPV (iPhone): the ☀ tap glides the look onto the sun and the lock holds it (heading / pitch settle on the
//      body's bearing, no fight between the one-shot glide and the per-frame lock); no sheet opens.
//   3. THE SEARCH SHEET (iPhone): idle SKY shows QUICK TARGETS ☀ SUN · ☾ MOON above MY PLACES; a search pick lands
//      in RECENT (newest first, 3 shown of 5 kept); the pinned rows never enter RECENT; a quick row tracks.
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-quick-targets-2026-10-27.mjs [cdpPort] [--legs 1,2,3]
// Screenshots → verify-shots/quick-targets-2026-10-27/ (git-ignored). Runs on the ONE house Chrome (:9333).
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const LEGS = (args.includes("--legs") ? args[args.indexOf("--legs") + 1] : "1,2,3").split(",");
const DEVS = (args.includes("--devices") ? args[args.indexOf("--devices") + 1] : "iphone,pixel,narrow").split(",");
const SHOTS = "verify-shots/quick-targets-2026-10-27";
mkdirSync(SHOTS, { recursive: true });
const APP = (process.env.FTW_APP_URL || "http://localhost:4321").replace(/\/$/, "");
// 2026-08-21T09:40Z ≈ solar noon in Dnipro — the sun due south, ~55° up; the moon (waxing gibbous) up in the east.
const NOON_UTC = 1787305200000;
const M_MAP = `${APP}/m#p=48.4640,35.0460,2200,0,0&t=${NOON_UTC}`;
const M_FPV = `${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const BOOT_MS = 60_000;
/** The 2026-10-25 row: 38.56 baseline + 0.03 (the almanac's line boxes) — the gate is the baseline + 0.1 px. */
const BAR_CEIL = 38.56 + 0.1;

const DEVICES = {
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
  pixel: { width: 412, height: 892, deviceScaleFactor: 3.5, mobile: true },
  narrow: { width: 360, height: 780, deviceScaleFactor: 3, mobile: true },
};

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const info = (name, detail = "") => console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
const angDist = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
console.log(`target ${APP} · legs ${LEGS.join(",")}`);

// ---- CDP plumbing (the house idiom; a FRESH target per page; a console collector) --------------
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
  const consoleLog = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "warning" || msg.params.type === "error")) {
      consoleLog.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") consoleLog.push("EXCEPTION " + (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? ""));
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
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const shoot = async (name, clip = null) => {
    await send("Page.bringToFront").catch(() => {});
    const r = await send("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 1 } } : { format: "jpeg", quality: 85 });
    const file = `${SHOTS}/${name}.${clip ? "png" : "jpeg"}`;
    writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log(`shot  ${file}`);
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
  const tapSel = async (sel) => {
    const r = await rect(sel);
    if (!r) return false;
    await tap(r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  /** Type into a focused input the way a keyboard does (React's onChange rides the input events). */
  const type = async (sel, text) => {
    await evalJs(`document.querySelector(${JSON.stringify(sel)})?.focus()`);
    await send("Input.insertText", { text });
  };
  const close = () => ws.close();
  return { dev, send, evalJs, shoot, goto, waitFor, rect, tap, tapSel, type, close, consoleLog };
}

// ---- in-page probes -----------------------------------------------------------------------------
/** Track the COMET (the default guest) — three almanac pairs and both quick cells. The house profile keeps the
 *  LAST TRACKED BODY, so every leg sets the target explicitly. */
const TRACK_COMET = `(async () => {
  const s = window.__skyStore?.getState(); if (!s) return "no store";
  const m = await import("/src/lib/ephemeris/targets.ts");
  s.setTarget(m.cometTarget()); if (!s.visible) s.setVisible(true); s.setTrack(false);
  return window.__skyStore.getState().target.id;
})()`;
/** A 7-letter planet — the widest common name; the budget gate must hold with it, not only with "10P". */
const TRACK_PLANET = (id) => `(async () => {
  const s = window.__skyStore?.getState(); if (!s) return "no store";
  const m = await import("/src/lib/ephemeris/targets.ts");
  s.setTarget(m.planetTarget(${JSON.stringify(id)})); if (!s.visible) s.setVisible(true); s.setTrack(false);
  return window.__skyStore.getState().target.id;
})()`;
/** Step scene time forward (½ h steps, ≤ 2 days) until the planet is BELOW the horizon at the focus — the BELOW badge
 *  joins the row; returns the instant it picked. */
const TIME_WHEN_BELOW = (id) => `(async () => {
  const m = await import("/src/lib/ephemeris/targets.ts"); const t = await import("/src/store/time.ts");
  const c = window.__cameraStore.getState(); let ms = t.sceneTimeMs();
  for (let i = 0; i < 96; i++) { const p = m.targetAzAlt(m.planetTarget(${JSON.stringify(id)}), ms, c.focusLatDeg, c.focusLonDeg); if (p.altDeg < -2) break; ms += 1800000; }
  t.useTimeStore.getState().setTime(ms); return ms;
})()`;
const SET_TIME = (ms) => `(async () => { const t = await import("/src/store/time.ts"); t.useTimeStore.getState().setTime(${ms}); return true; })()`;
/** Outside FPV the focal cone draws the PLANNED view — give it one: heading north, 60° wide. */
const PLAN_CONE = `(() => { const c = window.__cameraStore?.getState(); if (!c) return false; c.setPlannedView({ headingDeg: 0, hFovDeg: 60 }); return true; })()`;
/** The body's live bearing at the view focus / the eye (the row's own observer). */
const BEARING = (id) => `(async () => {
  const m = await import("/src/lib/ephemeris/targets.ts");
  const t = await import("/src/store/time.ts");
  const c = window.__cameraStore.getState(); const at = c.camGeo ?? { latDeg: c.focusLatDeg, lonDeg: c.focusLonDeg };
  const p = m.targetAzAlt(m.bodyTarget(${JSON.stringify(id)}), t.sceneTimeMs(), at.latDeg, at.lonDeg);
  return { az: p.azDeg, alt: p.altDeg };
})()`;
const SKY = `(() => { const s = window.__skyStore.getState(); return { id: s.target.id, visible: s.visible, track: s.track }; })()`;
const BAR = `(() => {
  const bar = document.querySelector(".m-peekbar"); const row = document.querySelector(".m-peek"); if (!bar || !row) return null;
  const br = bar.getBoundingClientRect(); const rr = row.getBoundingClientRect();
  const cells = [...bar.querySelectorAll(".m-peek__quick")].map((c) => { const r = c.getBoundingClientRect(); return { kind: c.dataset.quick, w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1), glyph: c.textContent.replace(/\\uFE0E/g, "").trim(), radius: getComputedStyle(c).borderRadius, label: c.getAttribute("aria-label") }; });
  const name = row.querySelector(".m-peek__name"); const nr = name.getBoundingClientRect();
  const badge = row.querySelector(".m-badge")?.getBoundingClientRect() ?? nr;
  const alm = row.querySelector(".m-peek__alm")?.getBoundingClientRect();
  const nameBudget = alm ? +(nr.width + (alm.left - badge.right - 10)).toFixed(1) : null;
  const nested = row.querySelectorAll("button").length;
  return { barH: +br.height.toFixed(2), barW: +br.width.toFixed(1), rowH: +rr.height.toFixed(2), rowX: +rr.x.toFixed(1), cells, glyphLead: !!row.querySelector(".m-peek__glyph"),
    name: name.textContent, nameW: +nr.width.toFixed(1), nameClipped: name.scrollWidth > name.clientWidth + 1, nameBudget, overflow: row.scrollWidth - row.clientWidth, nested,
    cellsInsideBar: cells.every((c) => c.y >= br.y - 0.5 && c.y + c.h <= br.y + br.height + 0.5), sheet: !!document.querySelector(".m-sheet") };
})()`;
/** The house profile persists the LAST TRACKED BODY, and the sky store's idle restore (requestIdleCallback, up to
 *  8 s after boot) re-seats it OVER a harness-set comet — the restore's guard only skips when the current target is
 *  not the comet. Seed the blob's `skyTargetId` to the comet and reload: the restore then has nothing to do. */
const SEED_COMET = `(() => { try { const p = JSON.parse(localStorage.getItem("ftw:view-prefs:v1") || "{}"); p.skyTargetId = "comet:10P"; localStorage.setItem("ftw:view-prefs:v1", JSON.stringify(p)); return true; } catch { return false; } })()`;
const PREFS = `(() => { try { return JSON.parse(localStorage.getItem("ftw:view-prefs:v1") || "{}"); } catch { return {}; } })()`;
const CLEAR_RECENTS = `(() => { try { const p = JSON.parse(localStorage.getItem("ftw:view-prefs:v1") || "{}"); delete p.recentSky; localStorage.setItem("ftw:view-prefs:v1", JSON.stringify(p)); return true; } catch { return false; } })()`;
const nestedWarnings = (log) => log.filter((l) => /validateDOMNesting|cannot be a descendant of|cannot contain a nested/.test(l));

// ── 1. THE PEEK BAR on the three twins ─────────────────────────────────────────────────────────
if (LEGS.includes("1")) {
  for (const device of DEVS) {
    const m = await attach(device);
    await m.goto(M_MAP, 1000);
    await m.waitFor(`!!window.__skyStore`, BOOT_MS);
    await m.evalJs(SEED_COMET);
    await m.goto(M_MAP, 1500);
    check(`1.${device}a the /m shell boots with the peek bar`, await m.waitFor(`!!document.querySelector(".m-peekbar .m-peek") && !!window.__skyStore && !!window.__cameraStore`, BOOT_MS));
    await m.evalJs(TRACK_COMET);
    await m.evalJs(PLAN_CONE);
    await sleep(1200);
    const comet = await m.evalJs(BAR);
    info(`1.${device} comet tracked`, JSON.stringify(comet));
    const r = await m.rect(".m-bottom");
    await m.shoot(`01-${device}-bar-comet`, { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8 });
    check(`1.${device}b ☀ then ☾ lead the row — round icon-only cells, no leading kind glyph, nothing nested in the row button`,
      comet !== null && comet.cells.map((c) => c.kind).join(",") === "sun,moon" && comet.cells.map((c) => c.glyph).join("") === "☀☾" && comet.cells.every((c) => c.radius === "50%" && Math.abs(c.w - c.h) < 0.6 && c.w >= 21 && c.w <= 26) && comet.cells[1].x > comet.cells[0].x && comet.rowX > comet.cells[1].x && !comet.glyphLead && comet.nested === 0,
      JSON.stringify(comet?.cells));
    check(`1.${device}c the bar is not a pixel taller than the 2026-10-25 row (≤ ${BAR_CEIL.toFixed(2)} px) and the cells sit inside it`, comet !== null && comet.barH <= BAR_CEIL && comet.cellsInsideBar, `bar ${comet?.barH} · row ${comet?.rowH} · cells ${JSON.stringify(comet?.cells.map((c) => [c.y, c.h]))}`);
    check(`1.${device}d the row never overflows and the name keeps a 6-letter budget (≥ 44 px; the 360 twin ≥ 42)`, comet !== null && comet.overflow <= 0 && !comet.nameClipped && comet.nameBudget != null && comet.nameBudget >= (device === "narrow" ? 42 : 44), `overflow ${comet?.overflow} · name "${comet?.name}" ${comet?.nameW} px · budget ${comet?.nameBudget} px`);
    // JUPITER (7 letters, ≈ 50 px) must keep its letters with both cells up — the comet's "10P" proves little.
    await m.evalJs(TRACK_PLANET("jupiter"));
    await sleep(900);
    const jup = await m.evalJs(BAR);
    info(`1.${device} jupiter tracked`, `name "${jup?.name}" ${jup?.nameW} px · clipped ${jup?.nameClipped} · budget ${jup?.nameBudget} · badge ${await m.evalJs(`document.querySelector(".m-peek .m-badge")?.textContent ?? "none"`)}`);
    await m.shoot(`01b-${device}-bar-jupiter`, { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8 });
    check(`1.${device}d2 JUPITER keeps its letters with both cells up (not clipped, no overflow)`, jup !== null && jup.name === "JUPITER" && !jup.nameClipped && jup.overflow <= 0 && jup.cells.length === 2, `name ${jup?.nameW} px · budget ${jup?.nameBudget} px`);
    // …and with the BELOW badge up (the row's widest common case): scene time stepped to when Jupiter is down.
    await m.evalJs(TIME_WHEN_BELOW("jupiter"));
    await sleep(900);
    const jupBelow = await m.evalJs(BAR);
    const badgeBelow = await m.evalJs(`document.querySelector(".m-peek .m-badge")?.textContent ?? "none"`);
    info(`1.${device} jupiter below`, `name "${jupBelow?.name}" ${jupBelow?.nameW} px · clipped ${jupBelow?.nameClipped} · budget ${jupBelow?.nameBudget} · badge ${badgeBelow}`);
    await m.shoot(`01c-${device}-bar-jupiter-below`, { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8 });
    check(`1.${device}d3 JUPITER + the BELOW badge: still unclipped, no overflow, the bar height holds`, jupBelow !== null && badgeBelow === "BELOW" && !jupBelow.nameClipped && jupBelow.overflow <= 0 && jupBelow.barH <= BAR_CEIL, `name ${jupBelow?.nameW} px · budget ${jupBelow?.nameBudget} px · bar ${jupBelow?.barH}`);
    await m.evalJs(SET_TIME(NOON_UTC));
    await m.evalJs(TRACK_COMET);
    await sleep(600);
    check(`1.${device}e the cells say what they do`, comet !== null && comet.cells[0].label === "Track the sun and go to it" && comet.cells[1].label === "Track the moon and go to it", JSON.stringify(comet?.cells.map((c) => c.label)));

    // The ☀ tap: the sun becomes the target (SHOW on, the lock on), the planned cone turns to it, ☀ leaves.
    const sunB = await m.evalJs(BEARING("sun"));
    const pv0 = await m.evalJs(`window.__cameraStore.getState().plannedView?.headingDeg ?? null`);
    await m.tapSel('.m-peekbar [data-quick="sun"]');
    const swapped = await m.waitFor(`window.__skyStore.getState().target.id === "body:sun"`, 4000);
    await sleep(600);
    const sky1 = await m.evalJs(SKY);
    const pv1 = await m.evalJs(`window.__cameraStore.getState().plannedView?.headingDeg ?? null`);
    const bar1 = await m.evalJs(BAR);
    check(`1.${device}f a tap on ☀ makes the sun the tracked target — SHOW on, the lock on — and opens no sheet`, swapped && sky1.id === "body:sun" && sky1.visible && sky1.track && !bar1.sheet, JSON.stringify(sky1));
    check(`1.${device}g …the planned cone turned to the sun's azimuth (±2°; the row's long-press goto on the map)`, typeof pv1 === "number" && angDist(pv1, sunB.az) < 2 && angDist(pv0, sunB.az) > 10, `planned ${pv0?.toFixed(1)} → ${pv1?.toFixed(1)} vs sun az ${sunB.az.toFixed(1)} (alt ${sunB.alt.toFixed(1)})`);
    check(`1.${device}h …and the ☀ cell left: only ☾ remains, the almanac at two pairs`, bar1.cells.map((c) => c.kind).join(",") === "moon" && (await m.evalJs(`document.querySelectorAll(".m-peek__alm-cell").length`)) === 2, JSON.stringify(bar1.cells.map((c) => c.kind)));
    await m.shoot(`02-${device}-bar-sun`, { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8 });
    check(`1.${device}i the bar height holds with one cell`, bar1.barH <= BAR_CEIL, `bar ${bar1.barH}`);

    // The touch extension: a tap 5 px ABOVE the ☾ cell still fires it (the ::before inset −7 px).
    const moonCell = bar1.cells[0];
    const moonB = await m.evalJs(BEARING("moon"));
    await m.tap(moonCell.x + moonCell.w / 2, moonCell.y - 5);
    const swappedMoon = await m.waitFor(`window.__skyStore.getState().target.id === "body:moon"`, 4000);
    await sleep(600);
    const bar2 = await m.evalJs(BAR);
    const pv2 = await m.evalJs(`window.__cameraStore.getState().plannedView?.headingDeg ?? null`);
    check(`1.${device}j a tap 5 px above the ☾ cell (its touch extension) tracks the moon; ☀ is back, ☾ gone`, swappedMoon && bar2.cells.map((c) => c.kind).join(",") === "sun" && !bar2.sheet, JSON.stringify(bar2.cells.map((c) => c.kind)));
    if (moonB.alt > 0) check(`1.${device}k …the planned cone turned to the moon (up, alt ${moonB.alt.toFixed(1)}°)`, typeof pv2 === "number" && angDist(pv2, moonB.az) < 2, `planned ${pv2?.toFixed(1)} vs moon az ${moonB.az.toFixed(1)}`);
    else info(`1.${device}k the moon is below the horizon at this pose — the cone aims at its rise azimuth`, `planned ${pv2?.toFixed(1)}`);
    await m.shoot(`03-${device}-bar-moon`, { x: 0, y: r.y - 4, width: DEVICES[device].width, height: r.h + 8 });

    // A plain tap on the row still opens the TARGET sheet.
    await m.tapSel(".m-peek__pos");
    const opened = await m.waitFor(`!!document.querySelector(".m-sheet .m-findrow")`, 6000);
    check(`1.${device}l a plain tap on the row still opens the TARGET sheet`, opened);
    await m.evalJs(`document.querySelector(".m-sheet__x")?.click()`);
    await sleep(500);
    const warn = nestedWarnings(m.consoleLog);
    check(`1.${device}m no nested-button / DOM-nesting warning in the console`, warn.length === 0, warn.slice(0, 2).join(" | "));
    m.close();
  }
}

// ── 2. FPV: the ☀ tap glides the look onto the sun and the lock holds it ──────────────────────
if (LEGS.includes("2")) {
  const m = await attach("iphone");
  await m.goto(M_MAP, 1000);
  await m.waitFor(`!!window.__skyStore`, BOOT_MS);
  await m.evalJs(SEED_COMET);
  await m.goto(M_FPV, 1000);
  check("2a /m FPV boots with the HUD mirror", await m.waitFor(`!!window.__cameraStore?.getState().fpvHud && !!document.querySelector(".m-peekbar")`, BOOT_MS));
  await m.evalJs(TRACK_COMET);
  await sleep(9000); // the FPV boot's cell landings settle (T77)
  const sunB = await m.evalJs(BEARING("sun"));
  const h0 = await m.evalJs(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const p0 = await m.evalJs(`window.__cameraStore.getState().fpvHud.pitchDeg`);
  await m.shoot("04-fpv-before");
  await m.tapSel('.m-peekbar [data-quick="sun"]');
  const swapped = await m.waitFor(`window.__skyStore.getState().target.id === "body:sun"`, 4000);
  await sleep(2500);
  const h1 = await m.evalJs(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const p1 = await m.evalJs(`window.__cameraStore.getState().fpvHud.pitchDeg`);
  await sleep(1500);
  const h2 = await m.evalJs(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const p2 = await m.evalJs(`window.__cameraStore.getState().fpvHud.pitchDeg`);
  const sky = await m.evalJs(SKY);
  const sheet = (await m.rect(".m-sheet")) !== null;
  check("2b the ☀ tap tracked the sun (SHOW on, the lock on) and opened no sheet", swapped && sky.id === "body:sun" && sky.visible && sky.track && !sheet, JSON.stringify(sky));
  const oneShot = await m.evalJs(`window.__cameraStore.getState().skyLook`);
  check("2b2 the one-shot skyLook is cleared under the lock (no phantom glide when the lock releases later)", oneShot === null, JSON.stringify(oneShot));
  check("2c the look glided onto the sun: heading within 3° of its azimuth, pitch within 3° of its altitude", typeof h2 === "number" && angDist(h2, sunB.az) < 3 && Math.abs(p2 - sunB.alt) < 3, `heading ${h0?.toFixed(1)} → ${h1?.toFixed(1)} → ${h2?.toFixed(1)} vs az ${sunB.az.toFixed(1)} · pitch ${p0?.toFixed(1)} → ${p1?.toFixed(1)} → ${p2?.toFixed(1)} vs alt ${sunB.alt.toFixed(1)}`);
  check("2d …and holds (the one-shot glide and the per-frame lock agree: < 1° drift over 1.5 s)", typeof h1 === "number" && angDist(h1, h2) < 1 && Math.abs(p1 - p2) < 1, `Δheading ${angDist(h1, h2).toFixed(2)} · Δpitch ${Math.abs(p1 - p2).toFixed(2)}`);
  await m.shoot("05-fpv-on-the-sun");
  const bar = await m.evalJs(BAR);
  check("2e the bar in FPV: only ☾ remains, the height holds", bar !== null && bar.cells.map((c) => c.kind).join(",") === "moon" && bar.barH <= BAR_CEIL, `cells ${JSON.stringify(bar?.cells.map((c) => c.kind))} · bar ${bar?.barH}`);
  const warn = nestedWarnings(m.consoleLog);
  check("2f no DOM-nesting warning in FPV either", warn.length === 0, warn.slice(0, 2).join(" | "));
  m.close();
}

// ── 3. THE SEARCH SHEET: QUICK TARGETS + RECENT ────────────────────────────────────────────────
if (LEGS.includes("3")) {
  const m = await attach("iphone");
  await m.goto(M_MAP, 1000);
  check("3a the /m shell boots", await m.waitFor(`!!document.querySelector(".m-peekbar") && !!window.__skyStore`, BOOT_MS));
  await m.evalJs(CLEAR_RECENTS); // the house profile persists prefs across runs — start from no recents
  await m.evalJs(SEED_COMET);
  await m.goto(M_MAP, 1500);
  await m.waitFor(`!!document.querySelector(".m-peekbar") && !!window.__skyStore`, BOOT_MS);
  await m.evalJs(TRACK_COMET);
  const openSearch = async () => {
    const t = await m.evalJs(`(() => { const t = [...document.querySelectorAll(".m-tab")].find((b) => /SEARCH/i.test(b.textContent)); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!t) return false;
    await m.tap(t.x, t.y);
    const up = await m.waitFor(`!!document.querySelector('.m-sheet--full[aria-label="SEARCH"] .m-input')`, 6000);
    await sleep(600); // the sheet's slide — a rect read mid-animation sends the tap to the wrong place
    return up;
  };
  const closeSheet = async () => {
    await m.evalJs(`document.querySelector(".m-sheet__x")?.click()`);
    await m.waitFor(`!document.querySelector(".m-sheet")`, 4000);
  };
  const SHEET_ROWS = `(() => { const s = document.querySelector('.m-sheet--full[aria-label="SEARCH"]'); if (!s) return null;
    const q = [...s.querySelectorAll('.m-quick [data-quick]')].map((b) => ({ kind: b.dataset.quick, name: b.querySelector(".m-hit__name")?.textContent.trim(), detail: b.querySelector(".m-hit__detail")?.textContent.trim() }));
    const r = [...s.querySelectorAll('.m-quick [data-recent]')].map((b) => ({ id: b.dataset.recent, name: b.querySelector(".m-hit__name")?.textContent.trim() }));
    const heads = [...s.querySelectorAll(".m-places__head")].map((h) => h.textContent.trim());
    const quick = s.querySelector(".m-quick"); const places = s.querySelector(".m-places");
    const order = quick && places ? quick.compareDocumentPosition(places) & Node.DOCUMENT_POSITION_FOLLOWING ? "quick-before-places" : "places-before-quick" : (quick ? "quick-only" : "none");
    const skyOn = s.querySelector('.m-mode__btn--on')?.textContent.trim();
    return { q, r, heads, order, skyOn }; })()`;

  check("3b the SEARCH sheet opens from its tab", await openSearch());
  await sleep(600);
  const idle0 = await m.evalJs(SHEET_ROWS);
  info("3 idle SKY sheet", JSON.stringify(idle0));
  await m.shoot("06-search-idle-quick");
  check("3c idle SKY: QUICK TARGETS pins ☀ SUN then ☾ MOON (the catalog's own rows) above MY PLACES; no RECENT yet", idle0 !== null && idle0.skyOn === "SKY" && idle0.q.map((x) => x.kind).join(",") === "sun,moon" && idle0.q[0].name === "☀ SUN" && idle0.q[1].name === "☾ MOON" && /OUR STAR/.test(idle0.q[0].detail) && idle0.r.length === 0 && idle0.heads[0] === "QUICK TARGETS" && !idle0.heads.includes("RECENT") && /quick-before-places|quick-only/.test(idle0.order), JSON.stringify(idle0));

  // Four searches: Saturn, Mars, Jupiter, Vega — the recents keep 5, show 3, newest first.
  const picks = [["saturn", "planet:saturn", "SATURN"], ["mars", "planet:mars", "MARS"], ["jupiter", "planet:jupiter", "JUPITER"], ["vega", "star:", "VEGA"]];
  for (const [q, idPrefix, title] of picks) {
    if (!(await m.evalJs(`!!document.querySelector('.m-sheet--full[aria-label="SEARCH"]')`))) await openSearch();
    await m.type('.m-sheet--full[aria-label="SEARCH"] .m-input', q);
    const hit = await m.waitFor(`(() => { const h = document.querySelector('.m-sheet [role="listbox"] .m-hit .m-hit__name'); return !!h && /${title}/i.test(h.textContent); })()`, 8000);
    check(`3d "${q}" → the first hit is ${title}`, hit);
    await sleep(300);
    await m.tapSel('.m-sheet [role="listbox"] .m-hit');
    const tracked = await m.waitFor(`window.__skyStore.getState().target.id.startsWith(${JSON.stringify(idPrefix)}) && !!document.querySelector('.m-sheet[aria-label=${JSON.stringify(title)}]')`, 8000);
    check(`3e …tracks it and swaps the sheet to TARGET · ${title}`, tracked, await m.evalJs(`window.__skyStore.getState().target.id`));
    await closeSheet();
  }
  const prefs = await m.evalJs(PREFS);
  const ids = (prefs.recentSky ?? []).map((e) => e.id);
  check("3f the blob keeps the four, newest first, inside ftw:view-prefs:v1", ids.length === 4 && ids[0].startsWith("star:") && ids[1] === "planet:jupiter" && ids[2] === "planet:mars" && ids[3] === "planet:saturn", JSON.stringify(ids));
  check("3g the SEARCH sheet reopens", await openSearch());
  await sleep(600);
  const idle1 = await m.evalJs(SHEET_ROWS);
  info("3 idle after four searches", JSON.stringify(idle1));
  await m.shoot("07-search-idle-recent");
  check("3h RECENT shows the newest THREE (Vega · Jupiter · Mars) under the pinned pair, Saturn held in the blob but not shown", idle1 !== null && idle1.heads.join(",").startsWith("QUICK TARGETS,RECENT") && idle1.r.length === 3 && idle1.r[0].name.endsWith("VEGA") && idle1.r[1].name === "◉ JUPITER" && idle1.r[2].name === "◉ MARS" && idle1.q.length === 2, JSON.stringify(idle1?.r));
  // A tap on the pinned ☾ MOON row tracks the moon (TARGET sheet) and never enters RECENT.
  await m.tapSel('.m-sheet .m-quick [data-quick="moon"]');
  const moonTracked = await m.waitFor(`window.__skyStore.getState().target.id === "body:moon" && !!document.querySelector('.m-sheet[aria-label="MOON"]')`, 8000);
  check("3i a tap on the pinned ☾ MOON row tracks the moon and swaps to its TARGET sheet", moonTracked, await m.evalJs(`window.__skyStore.getState().target.id`));
  await closeSheet();
  const prefs2 = await m.evalJs(PREFS);
  check("3j …and the moon did not enter RECENT (still the four)", JSON.stringify((prefs2.recentSky ?? []).map((e) => e.id)) === JSON.stringify(ids), JSON.stringify((prefs2.recentSky ?? []).map((e) => e.id)));
  // A re-pick moves to the front, never duplicates.
  check("3k the SEARCH sheet reopens again", await openSearch());
  await m.type('.m-sheet--full[aria-label="SEARCH"] .m-input', "mars");
  await m.waitFor(`(() => { const h = document.querySelector('.m-sheet [role="listbox"] .m-hit .m-hit__name'); return !!h && /MARS/i.test(h.textContent); })()`, 8000);
  await sleep(300);
  await m.tapSel('.m-sheet [role="listbox"] .m-hit');
  await m.waitFor(`window.__skyStore.getState().target.id === "planet:mars"`, 8000);
  await closeSheet();
  const prefs3 = await m.evalJs(PREFS);
  const ids3 = (prefs3.recentSky ?? []).map((e) => e.id);
  check("3l a re-pick (Mars) moves to the front, no duplicate, still four", ids3.length === 4 && ids3[0] === "planet:mars" && ids3.filter((i) => i === "planet:mars").length === 1, JSON.stringify(ids3));
  const warn = nestedWarnings(m.consoleLog);
  check("3m no DOM-nesting warning on the search sheet", warn.length === 0, warn.slice(0, 2).join(" | "));
  m.close();
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
await finishVerify(failures === 0 ? 0 : 1);
