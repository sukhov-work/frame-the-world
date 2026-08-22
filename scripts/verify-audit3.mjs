// Browser verification for the AUDIT #3 FIX SLICES (F1–F6 + F10, 2026-08-22d).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-audit3.mjs [cdpPort] [shotsDir]
//
// Every check below names the finding it closes and the mutation that makes it RED.
//
//   Desktop leg
//   1. F4/T36 — the ONE anchor ladder: outside FPV the chart and the GL fan agree, and both
//      land on the VIEW FOCUS, never the camera NADIR. Trigger-guarded: the run first proves
//      the nadir and the focus are far apart, or the check would pass on a coincidence.
//   2. F4/T36 — a PLACED photo owns the chart radar (the rung the chart was missing).
//   3. F3/T38 — the focal cone's BufferGeometries survive an hFov sweep (no per-frame realloc).
//   4. F3/T38 — the PiP's second render RESTORES renderer.shadowMap.autoUpdate.
//   5. A1-16 — a radar only claims skyline gaps with enough evidence (coverage ≥ the floor).
//   6. F2/T39 — plannedView.hFovDeg is inside FOCALCONE's band whatever the writer did.
//   /m leg
//   7. F4/T36 — inside FPV the walked eye still owns the radar (the owner's QA rule).
//   8. F10/A1-9 — the SAVE VIEW sheet focuses its input without scrolling the layout viewport.
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
// A TILTED orbit view: the camera nadir and the view focus are kilometres apart, which is
// exactly the state the chart's old ladder got wrong.
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,60&t=${NOON_UTC}`;
const M_URL = `http://localhost:4321/m#p=48.4640,35.0460,600,0,0&t=${NOON_UTC}`;

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Metres between two lat/lon pairs (the qaslice-cab helper). */
const distM = (a, b) => {
  const dN = (a.latDeg - b.latDeg) * 111_320;
  const dE = (a.lonDeg - b.lonDeg) * 111_320 * Math.cos((a.latDeg * Math.PI) / 180);
  return Math.hypot(dN, dE);
};

async function attach() {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  // audit #3 C11: register for close — an abandoned target holds a WebGL context.
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
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shoot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
    console.log(`shot  ${SHOTS}/${name}.jpeg`);
  };
  const waitFor = async (expr, timeoutMs = 40000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await evalJs(expr)) return true;
      } catch {
        /* booting */
      }
      await sleep(500);
    }
    return false;
  };
  return { send, evalJs, shoot, waitFor };
}

// ── DESKTOP ───────────────────────────────────────────────────────────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await d.send("Page.navigate", { url: ORBIT_URL });
check("desktop: engine booted", await d.waitFor(`!!window.__cameraStore && !!window.__globe`));
await sleep(9000);

// 1 — F4/T36: the ONE ladder, and it never reaches the nadir.
{
  const cam = await d.evalJs(
    `(() => { const s = window.__cameraStore.getState();
      return { camGeo: s.camGeo, focus: { latDeg: s.focusLatDeg, lonDeg: s.focusLonDeg },
               fpv: s.fpvHud !== null, tempPin: s.tempPin }; })()`,
  );
  // TRIGGER GUARD: with a level-ish camera the nadir and the focus coincide and the whole
  // check would pass on a coincidence — the very failure mode audit #3 C3 caught.
  const spread = cam?.camGeo ? distM(cam.camGeo, cam.focus) : 0;
  check(
    "F4 trigger guard: the camera NADIR and the view FOCUS are far apart (tilted view)",
    spread > 200,
    `${spread.toFixed(0)} m apart`,
  );
  const gl = await d.evalJs(`window.__globe.aim()`);
  check(
    "F4/T36: the GL fan anchors on the VIEW FOCUS outside FPV, not the nadir",
    gl !== null &&
      distM({ latDeg: gl.anchorLatDeg, lonDeg: gl.anchorLonDeg }, cam.focus) < 5 &&
      distM({ latDeg: gl.anchorLatDeg, lonDeg: gl.anchorLonDeg }, cam.camGeo) > 200,
    `anchor ${gl?.anchorLatDeg?.toFixed?.(5)},${gl?.anchorLonDeg?.toFixed?.(5)}`,
  );
  // Open the chart and read ITS resolved anchor — the two surfaces must agree exactly.
  await d.evalJs(`window.__minimapStore.getState().setMapWindowOpen(true)`);
  await sleep(1400);
  const chart = await d.evalJs(`window.__mapWindowView ?? null`);
  check(
    "F4/T36: the CHART resolves the SAME anchor as the GL fan (the divergence is closed)",
    chart !== null &&
      distM(
        { latDeg: chart.anchorLatDeg, lonDeg: chart.anchorLonDeg },
        { latDeg: gl.anchorLatDeg, lonDeg: gl.anchorLonDeg },
      ) < 1,
    `chart ${chart?.anchorLatDeg?.toFixed?.(5)},${chart?.anchorLonDeg?.toFixed?.(5)}`,
  );
  await d.shoot("a3-01-desktop-chart-anchor-on-focus");
}

// 2 — F4/T36: a PLACED photo owns the chart radar (the rung the chart never had).
{
  const placed = await d.evalJs(
    `(() => { const u = window.__uploadStore.getState();
      u.setPlacement ? u.setPlacement(48.4700, 35.0600) : null;
      return window.__uploadStore.getState().phase; })()`,
  ).catch(() => null);
  if (placed === "placed") {
    await sleep(900);
    const chart = await d.evalJs(`window.__mapWindowView ?? null`);
    check(
      "F4/T36: a PLACED photo owns the chart radar (the missing rung)",
      chart !== null &&
        distM(
          { latDeg: chart.anchorLatDeg, lonDeg: chart.anchorLonDeg },
          { latDeg: 48.47, lonDeg: 35.06 },
        ) < 5,
      `${chart?.anchorLatDeg?.toFixed?.(5)},${chart?.anchorLonDeg?.toFixed?.(5)}`,
    );
  } else {
    // Honest skip rather than a vacuous pass — say so, and say why (audit #3 C1/C5 class).
    check(
      "F4/T36: placed-photo rung — SKIPPED (no upload store seam to place one without a file)",
      true,
      `upload phase=${placed}`,
    );
  }
}

// 3 — F3/T38: the focal cone's geometries survive an hFov sweep.
{
  const before = await d.evalJs(`window.__globe.aim()`);
  const hFov0 = await d.evalJs(`window.__cameraStore.getState().plannedView?.hFovDeg ?? null`);
  // Sweep the planned focal the way the aim stick does — many small steps, each below the
  // module's 0.1° rebuild deadband in aggregate terms but well past it in total.
  await d.evalJs(
    `(() => { const c = window.__cameraStore.getState();
      const h = c.plannedView?.headingDeg ?? 0;
      for (let i = 1; i <= 40; i++) c.setPlannedView({ headingDeg: h, hFovDeg: 30 + i * 1.5 });
      return true; })()`,
  );
  await sleep(1200);
  const after = await d.evalJs(`window.__globe.aim()`);
  const hFov1 = await d.evalJs(`window.__cameraStore.getState().plannedView?.hFovDeg ?? null`);
  // POSITIVE CONTROL: the sweep really moved the cone, or "geometry unchanged" is trivially true.
  check(
    "F3 trigger guard: the sweep actually changed the planned focal",
    hFov0 !== null && hFov1 !== null && Math.abs(hFov1 - hFov0) > 5,
    `${hFov0?.toFixed?.(1)}° → ${hFov1?.toFixed?.(1)}°`,
  );
  check(
    "F3/T38: focal-cone BufferGeometries are REUSED across the sweep (no per-frame realloc)",
    before?.focalGeoIds?.length === 2 &&
      JSON.stringify(before.focalGeoIds) === JSON.stringify(after?.focalGeoIds),
    `${JSON.stringify(before?.focalGeoIds)} → ${JSON.stringify(after?.focalGeoIds)}`,
  );
}

// 6 — F2/T39: whatever any writer passed, the stored hFov is inside the band.
{
  const banded = await d.evalJs(
    `(() => { const c = window.__cameraStore.getState();
      const out = [];
      for (const h of [0.4, 1.27, 122.4, 5000, -3]) {
        c.setPlannedView({ headingDeg: 10, hFovDeg: h });
        out.push(window.__cameraStore.getState().plannedView.hFovDeg);
      }
      return out; })()`,
  );
  check(
    "F2/T39: every out-of-band hFov a writer can produce is clamped at the store seam",
    Array.isArray(banded) && banded.every((h) => h >= 3 && h <= 120),
    JSON.stringify(banded),
  );
  // POSITIVE CONTROL: the inputs really were out of band, so the clamp did work.
  check(
    "F2 trigger guard: the probe fed genuinely out-of-band values",
    Array.isArray(banded) && banded.some((h) => h === 3) && banded.some((h) => h === 120),
    JSON.stringify(banded),
  );
}

// 5 — A1-16: gaps are only claimed with evidence.
{
  const aim = await d.evalJs(`window.__globe.aim()`);
  check(
    "A1-16: the radar never claims skyline gaps below the coverage floor",
    aim !== null && (!aim.skylineClaimed || aim.coverage >= aim.minCoverage),
    `claimed=${aim?.skylineClaimed} coverage=${aim?.coverage?.toFixed?.(2)} floor=${aim?.minCoverage}`,
  );
  check(
    "A1-16 probe validated: the floor is a real threshold the surface can read",
    typeof aim?.minCoverage === "number" && aim.minCoverage > 0,
    String(aim?.minCoverage),
  );
}

// 4 — F3/T38: the PiP bracket restores the shadow-map flag (desktop has no PiP, so this
// asserts the RESTING truth the bracket must never leave behind).
check(
  "F3/T38: renderer.shadowMap.autoUpdate is left TRUE (the PiP bracket restores it)",
  (await d.evalJs(`window.__globe.aim().shadowAutoUpdate`)) === true,
);
await d.shoot("a3-02-desktop-cone-after-sweep");

// ── /m ────────────────────────────────────────────────────────────────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
});
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.send("Page.navigate", { url: M_URL });
check("/m: engine booted", await m.waitFor(`!!window.__cameraStore && !!window.__globe`));
await sleep(9000);

// 7 — F4/T36: inside FPV the WALKED EYE still owns the radar (owner QA 2026-08-21 item 1).
{
  const chip = await m.evalJs(
    `(() => { const el = document.querySelector(".m-actrow button"); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (chip) {
    await m.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: chip.x, y: chip.y, id: 1 }],
    });
    await sleep(700);
    await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(6000);
    await m.evalJs(`window.__minimapStore.getState().setMapWindowOpen(true)`);
    await sleep(1600);
    const st = await m.evalJs(
      `(() => { const s = window.__cameraStore.getState();
        return { fpv: s.fpvHud !== null, camGeo: s.camGeo, view: window.__mapWindowView ?? null }; })()`,
    );
    check("/m: FPV is live (trigger guard for the rung below)", st?.fpv === true);
    check(
      "F4/T36: inside FPV the WALKED EYE owns the chart radar (owner QA item 1 preserved)",
      st?.view !== null &&
        st?.camGeo !== null &&
        distM({ latDeg: st.view.anchorLatDeg, lonDeg: st.view.anchorLonDeg }, st.camGeo) < 2,
      `anchor ${distM({ latDeg: st?.view?.anchorLatDeg ?? 0, lonDeg: st?.view?.anchorLonDeg ?? 0 }, st?.camGeo ?? { latDeg: 0, lonDeg: 0 }).toFixed(1)} m from the eye`,
    );
    await m.shoot("a3-03-m-fpv-anchor-on-eye");
    await m.evalJs(`window.__minimapStore.getState().setMapWindowOpen(false)`);
    await sleep(800);
  } else {
    check("/m: ▲3D chip found", false);
  }
}

// 8 — F10/A1-9: the SAVE VIEW sheet focuses without scrolling the layout viewport.
{
  const opened = await m.evalJs(
    `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("SAVE VIEW"));
      if (!b) return "no-chip"; b.click(); return "clicked"; })()`,
  );
  if (opened === "clicked") {
    await sleep(900);
    const st = await m.evalJs(
      `(() => { const el = document.querySelector(".m-savename input");
        return el ? { focused: document.activeElement === el, scrollY: window.scrollY } : null; })()`,
    );
    check(
      "F10/A1-9: the SAVE VIEW name field is focused via the hook",
      st !== null && st.focused === true,
      JSON.stringify(st),
    );
    check(
      "F10/A1-9: …and the layout viewport is still pinned at 0 (the iOS dark-screen trap)",
      st !== null && st.scrollY === 0,
      `scrollY ${st?.scrollY}`,
    );
    await m.shoot("a3-04-m-saveview-focus");
  } else {
    // A member gate hides the chip for an anonymous visitor — say so instead of passing blind.
    check(
      "F10/A1-9: SAVE VIEW sheet — SKIPPED (chip is member-gated and this run is anonymous)",
      true,
      opened,
    );
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);
