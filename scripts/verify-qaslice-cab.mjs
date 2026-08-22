// Browser verification for the PRE-AUDIT QA SLICE (owner 2026-08-21g-end, order C → A → B).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-qaslice-cab.mjs [cdpPort] [shotsDir]
//
// Asserts (/m leg — mobile emulation; the fixed code paths are shell-shared):
//   C. overlay-composite stickiness — the SECOND full 2D→FPV→2D cycle issues ≈0 new Esri
//      GETs (the QA-7b regression rebuilt the whole overlay stack per flip: white chart +
//      a tile refetch storm) and the chart never white-gaps (uFtwFade holds, shots).
//   A. expanded-minimap manual-pan latch — a drag STAYS (no snap-back while standing) and,
//      since the owner micro-slice 2026-08-22, STAYS THROUGH A WALK too, even once the eye
//      leaves the chart bounds: the override is permanent (the 08-21g eye-motion re-arm is
//      superseded — see the annotated block below).
//   2. NEW ◉ RE-CENTRE button — the one path back: lit while overridden, centres on the
//      radar anchor, drops the latch, following resumes.
//   3. NEW bottom-edge attribution — one unclipped full-bleed line under the time strip,
//      which is lifted by --mw-credit-h rather than z-bumped; the bar takes no pointer input.
//   B. screen-relative walk — after a two-finger TWIST, stick-up walks CHART-up: the
//      world track's compass bearing ≈ −rot (published via store/minimap.mapWindowRotRad).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
// Low street altitude — the flat 2D chart runs its deep error target, so overlay composites
// are hot when the mode flips (the storm's worst case).
const M_URL = `http://localhost:4321/m#p=48.4640,35.0460,220,0,0&t=${NOON_UTC}`;

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// Esri GET counter via CDP Network — performance resource entries overflow at 250 long
// before deep tile levels arrive (the qa7ab lesson).
let esriGets = 0;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    if (/World_Imagery\/MapServer\/tile\//.test(msg.params.request.url)) esriGets++;
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
const waitFor = async (expr, timeoutMs = 30000) => {
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
// Wait until the Esri GET stream has been quiet for `quietMs` (initial load / storm settle).
const waitEsriQuiet = async (quietMs = 4000, capMs = 40000) => {
  const t0 = Date.now();
  let last = esriGets;
  let lastChange = Date.now();
  while (Date.now() - t0 < capMs) {
    await sleep(1000);
    if (esriGets !== last) {
      last = esriGets;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) return true;
  }
  return false;
};
const longPress = async (x, y, holdMs = 700) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(holdMs);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const enterFpv = async () => {
  const r = await evalJs(`(() => { const el = document.querySelector(".m-actrow button");
    if (!el) return null; const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) return false;
  await longPress(r.x, r.y);
  return waitFor(`window.__cameraStore.getState().fpvHud !== null`, 12000);
};
const exitFpv = async () => {
  await evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  return waitFor(`window.__cameraStore.getState().fpvHud === null`, 12000);
};
// Eye↔point distance in metres (equirectangular at these scales).
const distM = (a, b) => {
  const dN = (a.latDeg - b.latDeg) * 111320;
  const dE = (a.lonDeg - b.lonDeg) * 111320 * Math.cos((b.latDeg * Math.PI) / 180);
  return Math.hypot(dN, dE);
};

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: M_URL });
await sleep(14000);
check("/m: engine booted", await waitFor(`!!window.__cameraStore && !!window.__globe`));

// ── C. overlay-composite stickiness ─────────────────────────────────────────────────────
// PRECONDITION for the whole C leg (audit #3 C1): the counter matches Esri World_Imagery,
// which only fires in satellite ground mode — and /tmp/ftw-cdp PERSISTS groundMode across
// verify sessions (env class f). With a `vector` pref every GET total below is 0, waitEsriQuiet
// returns on the first quiet window, and the leg passes while measuring nothing. Pin it, and
// give the counter its own positive control.
check(
  "C precondition: satellite ground mode (the Esri counter only fires there)",
  (await evalJs(`window.__cameraStore.getState().groundMode`)) === "satellite",
  await evalJs(`window.__cameraStore.getState().groundMode`),
);
// Let the boot chart settle (initial load + the one legitimate sticky raise to 512).
const settled = await waitEsriQuiet(4000, 45000);
check("/m 2D: initial Esri load settles AND the counter actually counted", settled && esriGets > 0, `${esriGets} GETs so far`);
await shoot("qsl-01-m-2d-settled");
// The invariant is the REBUILD counter, not raw GETs: the pre-existing LRU rest-trim churn
// (tracked — the #15 SW-cache motivation) re-fetches evicted tiles' sources at the same
// magnitude a rebuild would, so GET counts can't isolate the storm. A rebuild destroys ALL
// resident composites (the white chart); the LRU churn only re-composites re-loaded tiles.
const reb0 = await evalJs(`window.__overlayRebuilds ?? 0`);
check("C: ≤1 rebuild by boot settle (the one legitimate sticky raise 256→512)", reb0 <= 1, `${reb0} rebuilds`);
const lruProbe = `(() => { const c = window.__globe?.ground?.lruCache; return c ? { mb: Math.round((c.cachedBytes ?? 0) / 1048576), min: Math.round((c.minBytesSize ?? 0) / 1048576), max: Math.round((c.maxBytesSize ?? 0) / 1048576) } : null; })()`;

// Two full 2D→FPV→2D cycles: with the STICKY composite resolution NEITHER flip may rebuild
// the overlay stack (QA-7b rebuilt on every flip). GET counts per leg are diagnostics.
const legGets = [];
for (let cyc = 1; cyc <= 2; cyc++) {
  const g0 = esriGets;
  check(`/m: FPV entered (cycle ${cyc})`, await enterFpv());
  await waitEsriQuiet(4000, 30000);
  const gFpv = esriGets - g0;
  check(`/m: back to 2D (cycle ${cyc})`, await exitFpv());
  await waitEsriQuiet(4000, 30000);
  legGets.push({ cyc, fpv: gFpv, back: esriGets - g0 - gFpv, lru: await evalJs(lruProbe) });
}
const rebEnd = await evalJs(`window.__overlayRebuilds ?? 0`);
check(
  "C: ZERO overlay rebuilds across both 2D↔FPV cycles (sticky composite — the storm is dead)",
  rebEnd === reb0,
  `${rebEnd - reb0} new rebuilds; legs ${JSON.stringify(legGets)}`,
);
// No white gap: the ground reveal never dips (a rebuild used to blank every composite).
const fade = await evalJs(`window.__globe?.groundUniforms?.uFtwFade?.value ?? null`);
check("C: ground reveal holds after the cycles (uFtwFade ≈ 1, no white chart)", fade !== null && fade > 0.9, String(fade));
await shoot("qsl-02-m-2d-after-cycles");

// ── A. manual-pan latch on the expanded chart ───────────────────────────────────────────
check("/m: FPV re-entered for the map leg", await enterFpv());
await evalJs(`(() => { const el = document.querySelector(".mm-open"); el?.click(); return !!el; })()`);
await sleep(2500);
check("/m: fullscreen map open", await evalJs(`!!document.querySelector(".mw")`));
const eye0 = await evalJs(`window.__cameraStore.getState().camGeo`);
const v0 = await evalJs(`window.__mapWindowView ?? null`);
check("/m: __mapWindowView probe live", v0 !== null, JSON.stringify(v0));

// AUDIT #3 A1-1 — a sub-threshold JITTER must not arm the permanent override. Before the fix
// panBy() latched on every pointer move, so the ~2 px drift of a long-press (the primary /m
// chart gesture — it places a point) armed a latch only ◉ could clear. 3 px < DRAG_CANCEL_PX 6.
{
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 620, id: 1 }] });
  for (const [x, y] of [[301, 621], [302, 621], [303, 622]]) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await sleep(40);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  check(
    "A1-1: a 3 px jitter does NOT arm the permanent override",
    (await evalJs(`document.querySelector(".mw-recenter").classList.contains("is-panned")`)) === false,
  );
}

// Drag the chart ~300 CSS px up-left (fast — never a long-press; clear of the left stick
// rail x≲126 and the top-right PiP). The follow used to snap it back on release.
{
  const path = [
    [330, 640],
    [300, 560],
    [250, 480],
    [180, 400],
    [140, 340],
  ];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: path[0][0], y: path[0][1], id: 1 }] });
  for (const [x, y] of path.slice(1)) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await sleep(40);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await sleep(600);
const vDragged = await evalJs(`window.__mapWindowView`);
const draggedAwayM = eye0 && vDragged ? distM(vDragged, eye0) : 0;
check("A: drag moved the chart off the eye", draggedAwayM > 40, `${draggedAwayM.toFixed(0)} m`);
await sleep(3000); // standing still — the old follow recentred within one paint
const vHeld = await evalJs(`window.__mapWindowView`);
check(
  "A: chart STAYS where dragged while standing (manual-pan latch, no snap-back)",
  vHeld !== null && distM(vHeld, vDragged) < 5,
  `moved ${vHeld ? distM(vHeld, vDragged).toFixed(1) : "?"} m in 3 s`,
);
await shoot("qsl-03-m-chart-dragged-held");

// ── SUPERSEDED CHECK (annotated, not deleted — the house rule) ──────────────────────────
// This block asserted, on 2026-08-21g: "A: walking re-armed the follow — chart recentred onto
// the eye" (the FOLLOW_REARM_M 0.5 m eye-motion detector). The owner REVERSED that ruling on
// 2026-08-22 after device-testing the slice: "I do not want to auto-latch back after any
// manual panning starts, at all." The manual override is now PERMANENT — walking must leave
// the chart exactly where it was dragged, even once the eye walks clean off the visible chart
// — and the NEW ◉ RE-CENTRE button is the only path back. The assertions below are that
// inversion plus the button's restore.
await evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
await sleep(2600); // long enough to carry the eye clean past the chart's half-diagonal
await evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
await sleep(1200);
const eyeAfterWalk = await evalJs(`window.__cameraStore.getState().camGeo`);
const vAfterWalk = await evalJs(`window.__mapWindowView`);
const walkedM = eye0 && eyeAfterWalk ? distM(eyeAfterWalk, eye0) : 0;
check("A: walk moved the eye (the old re-arm trigger — must now do nothing)", walkedM > 0.5, `${walkedM.toFixed(1)} m`);
check(
  "A: walking does NOT recentre the chart — the manual override is permanent",
  vAfterWalk !== null && distM(vAfterWalk, vDragged) < 5,
  `chart moved ${vAfterWalk ? distM(vAfterWalk, vDragged).toFixed(1) : "?"} m during the walk`,
);
// …and specifically past the VIEW BOUNDS: the eye is off the visible chart and still no pull.
// Ground resolution from the published z (Web-Mercator m per CSS px at this latitude — one
// tile spans 256 CSS px at any dpr, the retina boost only changes the source level). Beyond
// the HALF-DIAGONAL a point is off-screen in EVERY direction, so this is the strict bound.
{
  const viewport = await evalJs(`({ w: window.innerWidth, h: window.innerHeight })`);
  const mpp =
    vAfterWalk === null
      ? 0
      : (156543.03392 * Math.cos((vAfterWalk.latDeg * Math.PI) / 180)) / 2 ** vAfterWalk.z;
  const halfDiagM = (mpp * Math.hypot(viewport.w, viewport.h)) / 2;
  const eyeOffChartM = vAfterWalk && eyeAfterWalk ? distM(vAfterWalk, eyeAfterWalk) : 0;
  check(
    "A: the eye walked OUTSIDE the visible chart and the chart still did not follow",
    eyeOffChartM > halfDiagM,
    `eye ${eyeOffChartM.toFixed(0)} m from chart centre vs ${halfDiagM.toFixed(0)} m half-diagonal (z ${vAfterWalk?.z?.toFixed?.(2)})`,
  );
}
// SUPERSEDED ARTIFACT (audit #3 C17, annotated 2026-08-22): this shot was
// `qsl-04-m-walk-rearmed-follow` while the QA-slice-A rule was "walking re-arms the follow".
// The owner micro-slice 2026-08-22 made the manual override PERMANENT, so the check was
// inverted and the shot renamed to match what it now shows. Older DECISIONS lines citing the
// old filename refer to the superseded behaviour, not a missing file.
await shoot("qsl-04-m-chart-held-past-bounds");

// ── NEW (owner micro-slice 2026-08-22 items 1+2): the ◉ RE-CENTRE button is the way back ──
// Owner 2026-08-22b: the /m right rail is one stack — the PiP's TOP edge must line up with
// the MAP/+/− pills, and the ◉ button hangs off the PiP's bottom. Rendered geometry, not CSS
// text (the fence test covers the token wiring; this proves what actually paints).
{
  const rail = await evalJs(`(() => {
    const q = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const pills = [...document.querySelectorAll(".mw-top .mw-title, .mw-top .mw-btn")]
      .filter((e) => !e.classList.contains("mw-recenter"))
      .map((e) => e.getBoundingClientRect());
    const pip = q(".mw-pip"); const rec = q(".mw-recenter"); const row = q(".mw-top");
    if (!pip || !rec || !row || pills.length < 3) return null;
    return { pipTop: pip.top, rowTop: row.top, pillTop: Math.min(...pills.map((r) => r.top)),
             pillsRight: Math.max(...pills.map((r) => r.right)), pipLeft: pip.left,
             pipBottom: pip.bottom, recTop: rec.top,
             rowEvents: getComputedStyle(document.querySelector(".mw-top")).pointerEvents }; })()`);
  check("2b: /m PiP TOP-ALIGNED with the MAP/+/− pills", rail !== null && Math.abs(rail.pipTop - rail.pillTop) < 1.5, JSON.stringify(rail));
  check("2b: …and does not overlap them horizontally", rail !== null && rail.pipLeft > rail.pillsRight, `pills end ${rail?.pillsRight?.toFixed?.(0)} px, PiP starts ${rail?.pipLeft?.toFixed?.(0)} px`);
  check("2b: the full-width top row stays click-through over the PiP", rail !== null && rail.rowEvents === "none");
  check("2b: ◉ hangs just off the PiP's BOTTOM edge (the [+ −]·[PiP]·[◉] rail)", rail !== null && rail.recTop > rail.pipBottom && rail.recTop - rail.pipBottom < 16, `gap ${rail ? (rail.recTop - rail.pipBottom).toFixed(1) : "?"} px`);
  // The PiP is a HOLE (draw() clearRects it, body.m .mw has no background), so ANY fixed
  // surface stacked between the GL canvas (z 0) and the map window (z 20) that overlaps the
  // rect paints inside it — the batch-#5 "minimap inside minimap" class. Moving the hole up
  // onto the .m-status rung re-opened it for the Plux/GUIDE/DESKTOP strip. This sweeps the
  // whole intersection rather than naming today's offenders, so the next reseat can't
  // silently reintroduce it.
  // Widened past `position:fixed` and past numeric z-index (audit #3 C6): an absolute/sticky
  // overlay, or one at `z-index: auto` (parseInt → NaN), paints in the hole just the same.
  // `scanned` is the sweep's own POSITIVE CONTROL — a zero-result is only evidence if the
  // probe examined candidates at all.
  const bleed = await evalJs(`(() => {
    const pip = document.querySelector(".mw-pip")?.getBoundingClientRect();
    if (!pip) return null;
    const bad = []; let scanned = 0;
    for (const el of document.querySelectorAll("body *")) {
      // The window's OWN parts (canvas, top row, the PiP button + its tag) live inside .mw's
      // z-20 stacking context — the hole is punched in .mw-canvas itself, so they are not
      // "mid-stack chrome under the window". Only surfaces stacked BELOW .mw can bleed.
      if (el.closest(".mw")) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "static") continue;
      // auto = paints in DOM order above the z-0 canvas, so it counts as mid-stack.
      const z = cs.zIndex === "auto" ? 1 : parseInt(cs.zIndex, 10);
      if (!Number.isFinite(z) || z < 1 || z >= 20) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right <= pip.left || r.left >= pip.right) continue;
      if (r.bottom <= pip.top || r.top >= pip.bottom) continue;
      scanned++;                                        // it OVERLAPS the hole — a real candidate
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      bad.push((el.className || el.tagName) + " z" + cs.zIndex);
    }
    return { bad, scanned }; })()`);
  check(
    "2b: the bleed sweep actually examined candidates (positive control)",
    bleed !== null && bleed.scanned > 0,
    `${bleed?.scanned} overlapping mid-stack elements considered`,
  );
  check(
    "2b: NOTHING mid-stack (1 ≤ z < 20) bleeds through the PiP hole at its new rung",
    bleed !== null && bleed.bad.length === 0,
    bleed === null ? "no PiP" : bleed.bad.join(" · "),
  );
  // AUDIT #3 A1-2 — the ◉ is the ONLY exit from the permanent override, and the FPV altitude
  // column rides z 24, ABOVE this z-20 window. On a short viewport the un-floored seat slid
  // under it: the tap would nudge the eye's altitude instead. Exercise the SHORT viewport
  // explicitly (390×844 never reached the collision, which is why the first pass missed it).
  for (const [vw, vh] of [
    [390, 844],
    [360, 640],
    [360, 560],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 3, mobile: true });
    await sleep(900);
    const seat = await evalJs(`(() => {
      const b = document.querySelector(".mw-recenter"); const alt = document.querySelector(".m-altcol");
      if (!b) return null;
      const rb = b.getBoundingClientRect();
      const ra = alt ? alt.getBoundingClientRect() : null;
      return { top: rb.top, bottom: rb.bottom, h: rb.height, altTop: ra ? ra.top : null,
               altPresent: !!alt, vh: window.innerHeight }; })()`);
    const clear = seat !== null && seat.altTop !== null && seat.bottom <= seat.altTop + 0.5;
    const onScreen = seat !== null && seat.top >= 0 && seat.bottom <= seat.vh;
    // altPresent is asserted, not merely captured (audit #3 C5): .m-altcol mounts ONLY inside
    // FPV, so if this loop ever ran outside it, all three sizes would pass vacuously — on the
    // one occlusion this check exists to disprove, guarding the sole exit from a permanent
    // override.
    check(
      `A1-2: ◉ stays clear of the z-24 altitude column at ${vw}×${vh}`,
      seat?.altPresent === true && clear && onScreen,
      JSON.stringify(seat),
    );
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(900);
}
const recBtn = await evalJs(`(() => { const b = document.querySelector(".mw-recenter");
  return b ? { text: b.textContent.trim(), lit: b.classList.contains("is-panned"),
               label: b.getAttribute("aria-label") } : null; })()`);
check("2: ◉ RE-CENTRE button present on the open chart", recBtn !== null, JSON.stringify(recBtn));
check("2: it is ACCENT-LIT while the chart is overridden (is-panned)", recBtn?.lit === true);
check("2: glyph is ◉ and it is labelled for screen readers", recBtn?.text === "◉" && !!recBtn?.label, recBtn?.label);
await evalJs(`document.querySelector(".mw-recenter").click()`);
await sleep(700);
const vRecentred = await evalJs(`window.__mapWindowView`);
const eyeAtRecentre = await evalJs(`window.__cameraStore.getState().camGeo`);
check(
  "2: ◉ centres the chart on the radar anchor (the live FPV eye)",
  vRecentred !== null && eyeAtRecentre !== null && distM(vRecentred, eyeAtRecentre) < 5,
  `chart ${vRecentred && eyeAtRecentre ? distM(vRecentred, eyeAtRecentre).toFixed(1) : "?"} m from the eye`,
);
check(
  "2: the button drops back to the muted following state",
  (await evalJs(`document.querySelector(".mw-recenter").classList.contains("is-panned")`)) === false,
);
// Following is RESTORED: walk again and the rubber band pulls the chart to the deadband edge.
await evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
await sleep(1800);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
await sleep(1200);
const eyeAfterRecentreWalk = await evalJs(`window.__cameraStore.getState().camGeo`);
const vAfterRecentreWalk = await evalJs(`window.__mapWindowView`);
// TRIGGER GUARD (audit #3 C3): ◉ had just centred the chart ON the eye (the < 5 m check
// above), so if this walk moved nothing the chart-to-eye distance stays ≈0 and a "following
// resumed" assertion passes while following is dead. Prove the eye actually left the deadband
// first — the first walk carries the same guard; this one did not.
const recentreWalkM =
  eyeAtRecentre && eyeAfterRecentreWalk ? distM(eyeAfterRecentreWalk, eyeAtRecentre) : 0;
check(
  "2: the resumed-follow walk really moved the eye past the deadband (trigger guard)",
  recentreWalkM > 60,
  `${recentreWalkM.toFixed(1)} m walked`,
);
check(
  "2: following RESUMED after ◉ — the chart tracks the walking eye to the deadband edge",
  vAfterRecentreWalk !== null &&
    eyeAfterRecentreWalk !== null &&
    distM(vAfterRecentreWalk, eyeAfterRecentreWalk) < 25, // measured edge ≈18.5 m at z18/390×844
  `chart ${vAfterRecentreWalk && eyeAfterRecentreWalk ? distM(vAfterRecentreWalk, eyeAfterRecentreWalk).toFixed(1) : "?"} m from eye`,
);
await shoot("qsl-04b-m-recentred-following");

// ── Item 3: the attribution line owns the screen's bottom edge, under the time strip ──────
{
  const bar = await evalJs(`(() => {
    const bar = document.querySelector(".mw-creditbar");
    const a = document.querySelector(".mw-credit");
    const dock = document.querySelector(".m-bottom");
    if (!bar || !a) return null;
    const rb = bar.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rd = dock ? dock.getBoundingClientRect() : null;
    const cs = getComputedStyle(bar);
    return {
      barBottom: rb.bottom, vh: window.innerHeight, barTop: rb.top,
      lines: Math.round(ra.height / parseFloat(getComputedStyle(a).fontSize)),
      // Honest clip test: the anchor's own box must sit INSIDE the viewport. scrollWidth is
      // no use here — a nowrap flex item never shrinks, so the BAR clips it while the anchor
      // still reports width === scrollWidth.
      clipped: ra.left < -0.5 || ra.right > window.innerWidth + 0.5,
      hasEsri: a.textContent.includes("Esri"), hasCarto: a.textContent.includes("CARTO"),
      hasOsm: a.textContent.includes("OpenStreetMap"),
      barEvents: cs.pointerEvents, anchorEvents: getComputedStyle(a).pointerEvents,
      dockBottom: rd ? rd.bottom : null,
    }; })()`);
  check("3: attribution bar pinned to the screen's bottom edge", bar !== null && Math.abs(bar.barBottom - bar.vh) < 1.5, JSON.stringify(bar));
  check("3: the time strip sits ABOVE it (dock lifted by --mw-credit-h, not z-bumped)", bar !== null && bar.dockBottom !== null && bar.dockBottom <= bar.barTop + 1, `dock bottom ${bar?.dockBottom} vs bar top ${bar?.barTop}`);
  check("3: ONE line, unclipped — the full Esri/CARTO/OSM list stays legible (contractual)", bar !== null && bar.lines === 1 && bar.clipped === false && bar.hasEsri && bar.hasCarto && bar.hasOsm);
  check("3: the bar cannot steal a bottom-edge drag (events on the anchor only)", bar !== null && bar.barEvents === "none" && bar.anchorEvents === "auto");
  await shoot("qsl-04c-m-bottom-attribution");
}

// ── B. screen-relative walk on a TWISTED chart ──────────────────────────────────────────
check("B: rot published while open (store/minimap)", (await evalJs(`window.__minimapStore.getState().mapWindowRotRad`)) !== null);
// Two-finger twist, constant 100 px separation (pure rotation, no zoom): the pair pivots
// ~90° about (240, 480) — clear of the stick rail and the PiP.
{
  const cx = 240, cy = 480, r = 50;
  const steps = 8;
  const pts = (a) => [
    { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 },
    { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 2 },
  ];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0) });
  for (let i = 1; i <= steps; i++) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts((i / steps) * (Math.PI / 2)) });
    await sleep(50);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await sleep(800);
const rotState = await evalJs(`({ view: window.__mapWindowView?.rot ?? null, pub: window.__minimapStore.getState().mapWindowRotRad })`);
check(
  "B: twist landed + published (view.rot ≈ mapWindowRotRad ≠ 0)",
  rotState.view !== null && rotState.pub !== null && Math.abs(rotState.view) > 0.5 && Math.abs(rotState.view - rotState.pub) < 0.01,
  JSON.stringify(rotState),
);

// Stick-UP on the twisted chart: the world track's compass bearing must be −rot (chart-up),
// NOT the camera heading and NOT north.
const eyeB0 = await evalJs(`window.__cameraStore.getState().camGeo`);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
await sleep(1800);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
await sleep(600);
const eyeB1 = await evalJs(`window.__cameraStore.getState().camGeo`);
{
  const dN = (eyeB1.latDeg - eyeB0.latDeg) * 111320;
  const dE = (eyeB1.lonDeg - eyeB0.lonDeg) * 111320 * Math.cos((eyeB0.latDeg * Math.PI) / 180);
  const trackAz = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
  const wantAz = (((-rotState.pub * 180) / Math.PI) % 360 + 360) % 360;
  const dAz = Math.abs((((trackAz - wantAz) % 360) + 540) % 360 - 180);
  const heading = await evalJs(`window.__cameraStore.getState().fpvHud?.headingDeg ?? null`);
  check(
    "B: stick-up walks CHART-up on the twisted chart (track ≈ −rot, world-correct)",
    Math.hypot(dN, dE) > 0.5 && dAz < 6,
    `track ${trackAz.toFixed(1)}° vs chart-up ${wantAz.toFixed(1)}° (Δ ${dAz.toFixed(1)}°; camera heading ${heading?.toFixed?.(0)}°)`,
  );
}
await shoot("qsl-05-m-twisted-chart-walk");

// ── DESKTOP leg — items 1+2+3 seat differently on the desktop shell ──────────────────────
// The /m map is fullscreen with a 32vw PiP owning the right rung; desktop is a centred,
// DRAGGABLE window whose transform would trap a position:fixed descendant — the credit bar
// must still reach the screen's bottom edge, and the REAL TimeScrubber (z 43) must ride above
// it. Fresh target: this shell needs its own metrics and a clean WebGL context.
{
  let d;
  try {
    d = await http("/json/new?about:blank", "PUT");
  } catch {
    d = await http("/json/new?about:blank", "GET");
  }
  const dws = new WebSocket(d.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((dws.onopen = res), (dws.onerror = rej)));
  let dseq = 0;
  const dpending = new Map();
  dws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && dpending.has(msg.id)) {
      const { res, rej } = dpending.get(msg.id);
      dpending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const dsend = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++dseq;
      dpending.set(id, { res, rej });
      dws.send(JSON.stringify({ id, method, params }));
    });
  await dsend("Page.enable");
  await dsend("Runtime.enable");
  const dEval = async (expression) => {
    const r = await dsend("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const dShoot = async (name) => {
    const r = await dsend("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
    console.log(`shot  ${SHOTS}/${name}.jpeg`);
  };
  const dWaitFor = async (expr, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await dEval(expr)) return true;
      } catch {
        /* booting */
      }
      await sleep(500);
    }
    return false;
  };
  await dsend("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await dsend("Page.navigate", { url: `http://localhost:4321/#p=48.4640,35.0460,900,0,0&t=${NOON_UTC}` });
  await sleep(15000);
  await dsend("Page.bringToFront"); // rAF must tick — the draw loop owns __mapWindowView
  check("desktop: engine booted", await dWaitFor(`!!window.__cameraStore && !!window.__minimapStore`));
  await dEval(`window.__minimapStore.getState().setMapWindowOpen(true)`);
  await sleep(2500);
  check("desktop: map window open", await dEval(`!!document.querySelector(".mw")`));

  // Item 2 seat: round, right edge, on the rung item 3 freed — clear of the top row above it.
  const seat = await dEval(`(() => {
    const b = document.querySelector(".mw-recenter");
    const top = document.querySelector(".mw-top");
    const close = document.querySelector(".mw-close");
    if (!b || !top) return null;
    const rb = b.getBoundingClientRect();
    const rt = top.getBoundingClientRect();
    const rc = close ? close.getBoundingClientRect() : null;
    const mw = document.querySelector(".mw").getBoundingClientRect();
    return {
      round: Math.abs(rb.width - rb.height) < 1,
      radiusPx: parseFloat(getComputedStyle(b).borderRadius),
      w: rb.width,
      belowTopRow: rb.top >= rt.bottom - 0.5,
      clearOfClose: rc ? rb.top >= rc.bottom - 0.5 : true,
      rightInset: mw.right - rb.right,
      lit: b.classList.contains("is-panned"),
    }; })()`);
  check("desktop 2: ◉ is a CIRCLE (equal w/h under the pill radius)", seat !== null && seat.round && seat.radiusPx >= seat.w / 2 - 0.5, JSON.stringify(seat));
  check("desktop 2: seated on the right edge below the top row (and below ✕ MINI-MAP)", seat !== null && seat.belowTopRow && seat.clearOfClose && Math.abs(seat.rightInset - 12) < 2, `right inset ${seat?.rightInset?.toFixed?.(1)} px`);
  check("desktop 2: muted while the chart is still following", seat !== null && seat.lit === false);

  // Item 1 on desktop: a mouse drag latches the override; nothing but ◉ clears it.
  const v0d = await dEval(`window.__mapWindowView ?? null`);
  const cx = 800;
  const cy = 500;
  await dsend("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await dsend("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx - i * 20, y: cy - i * 15, button: "left", buttons: 1 });
    await sleep(40);
  }
  await dsend("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx - 120, y: cy - 90, button: "left", buttons: 0, clickCount: 1 });
  await sleep(700);
  const vDragD = await dEval(`window.__mapWindowView`);
  check("desktop 1: drag moved the chart", v0d !== null && vDragD !== null && distM(vDragD, v0d) > 20, `${v0d && vDragD ? distM(vDragD, v0d).toFixed(0) : "?"} m`);
  check("desktop 2: ◉ lights up once you have panned away", (await dEval(`document.querySelector(".mw-recenter").classList.contains("is-panned")`)) === true);
  await dShoot("qsl-06-desktop-panned-lit");
  await dEval(`document.querySelector(".mw-recenter").click()`);
  await sleep(700);
  const vRecD = await dEval(`window.__mapWindowView`);
  // audit #3 T36: READ the resolved anchor the app published — this was a hand-transcribed
  // copy of the chart's ladder (`(fpv?camGeo) ?? tempPin ?? camGeo ?? focus`), i.e. the C8
  // anti-pattern. When F4 hoisted the ladder and dropped the bare-camGeo NADIR rung, the copy
  // went stale and this check failed by 81.8 m against an app that was correct.
  const anchorD = vRecD
    ? { latDeg: vRecD.anchorLatDeg, lonDeg: vRecD.anchorLonDeg }
    : null;
  // Positive control: the published anchor must exist at all (an undefined pair would make
  // distM NaN, and `NaN < 5` is false — it would fail loudly rather than pass, but say why).
  check(
    "desktop 2: the chart publishes its resolved aim anchor (probe validated)",
    anchorD !== null && Number.isFinite(anchorD.latDeg) && Number.isFinite(anchorD.lonDeg),
    JSON.stringify(anchorD),
  );
  check("desktop 2: ◉ centres the chart on the radar anchor", vRecD !== null && anchorD !== null && distM(vRecD, anchorD) < 5, `${vRecD && anchorD ? distM(vRecD, anchorD).toFixed(1) : "?"} m`);
  check("desktop 2: and drops back to muted", (await dEval(`document.querySelector(".mw-recenter").classList.contains("is-panned")`)) === false);

  // Item 3 on desktop: exactly ONE bottom line. The page credit (index.astro .map-credit) is
  // a strict SUPERSET of the map window's sources and already owns the screen's bottom edge,
  // so it is the one promoted to the full-bleed bar — MapWindow's own .mw-creditbar stays
  // /m-only. Two overlapping attribution lines is what this check exists to prevent.
  const barD = await dEval(`(() => {
    const bar = document.querySelector(".map-creditbar");
    const a = document.querySelector(".map-credit");
    const mwBar = document.querySelector(".mw-creditbar");
    const ts = document.querySelector(".ts");
    if (!bar || !a) return null;
    const rb = bar.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rt = ts ? ts.getBoundingClientRect() : null;
    const txt = a.textContent;
    return {
      inMw: !!a.closest(".mw"),
      bottomGap: window.innerHeight - rb.bottom,
      barH: rb.height,
      lines: Math.round(ra.height / parseFloat(getComputedStyle(a).fontSize)),
      clipped: ra.left < -0.5 || ra.right > window.innerWidth + 0.5,
      mwBarShown: mwBar ? getComputedStyle(mwBar).display !== "none" : false,
      barEvents: getComputedStyle(bar).pointerEvents,
      anchorEvents: getComputedStyle(a).pointerEvents,
      superset: ["Esri", "Maxar", "Earthstar", "CARTO", "OpenStreetMap"].every((s) => txt.includes(s)),
      globeSources: ["Cesium ion", "OpenMapTiles", "Copernicus", "NASA"].every((s) => txt.includes(s)),
      tsBottomGap: rt ? window.innerHeight - rt.bottom : null,
      tsZ: ts ? getComputedStyle(ts).zIndex : null,
    }; })()`);
  check("desktop 3: the promoted page credit is full-bleed on the screen's bottom edge", barD !== null && Math.abs(barD.bottomGap) < 1.5, JSON.stringify(barD));
  check("desktop 3: exactly ONE bottom line — MapWindow's own bar stays /m-only (no duplicate)", barD !== null && barD.mwBarShown === false);
  check("desktop 3: one unclipped line carrying the map sources AND the globe's", barD !== null && barD.lines === 1 && barD.clipped === false && barD.superset && barD.globeSources);
  check("desktop 3: the bar cannot steal a bottom-edge drag (events on the anchor only)", barD !== null && barD.barEvents === "none" && barD.anchorEvents === "auto");
  // The LIFT, measured as a DELTA (audit #3 C2). The old form asserted `tsBottomGap > barH`,
  // which is 35.2 px > 13.1 px from the scrubber's BASE `bottom: 2.2rem` alone — it held with
  // the mw-open lift deleted entirely, so it proved the bar existed and never proved the lift.
  const tsClosed = await dEval(`(() => { window.__minimapStore.getState().setMapWindowOpen(false); return 0; })()`);
  await sleep(600);
  const gapClosed = await dEval(`(() => { const ts = document.querySelector(".ts");
    return ts ? window.innerHeight - ts.getBoundingClientRect().bottom : null; })()`);
  await dEval(`window.__minimapStore.getState().setMapWindowOpen(true)`);
  await sleep(1200);
  const reopened = await dEval(`(() => { const ts = document.querySelector(".ts");
    const bar = document.querySelector(".map-creditbar");
    return { gap: ts ? window.innerHeight - ts.getBoundingClientRect().bottom : null,
             barH: bar ? bar.getBoundingClientRect().height : null,
             z: ts ? getComputedStyle(ts).zIndex : null }; })()`);
  const lift = gapClosed !== null && reopened.gap !== null ? reopened.gap - gapClosed : null;
  check(
    "desktop 3: opening the map LIFTS the real scrubber by exactly the bar's height",
    lift !== null && reopened.barH !== null && Math.abs(lift - reopened.barH) < 1.5 && reopened.z === "43",
    `lift ${lift?.toFixed?.(1)} px vs bar ${reopened.barH?.toFixed?.(1)} px (closed gap ${gapClosed?.toFixed?.(1)}, open ${reopened.gap?.toFixed?.(1)}, z ${reopened.z})`,
  );
  void tsClosed;
  await dShoot("qsl-07-desktop-bottom-attribution");
  // AUDIT #3 A1-3 — below ≈900 px the clamp floor stops the shrink while the 265-char list
  // keeps its width, so `nowrap` + `overflow:hidden` clipped BOTH ends (losing "© Esri"
  // itself). The narrow branch wraps and grows the bar; the scrubber lift must track it.
  for (const [vw, vh] of [
    [1100, 900],
    [820, 900],
    [700, 900],
  ]) {
    await dsend("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const n = await dEval(`(() => {
      const bar = document.querySelector(".map-creditbar");
      const a = document.querySelector(".map-credit");
      const ts = document.querySelector(".ts");
      if (!bar || !a) return null;
      const rb = bar.getBoundingClientRect(); const ra = a.getBoundingClientRect();
      const rt = ts ? ts.getBoundingClientRect() : null;
      return { clipped: ra.left < -0.5 || ra.right > window.innerWidth + 0.5 || ra.top < rb.top - 0.5 || ra.bottom > rb.bottom + 0.5,
               barBottomGap: window.innerHeight - rb.bottom, barH: rb.height,
               tsGap: rt ? window.innerHeight - rt.bottom : null }; })()`);
    check(
      `A1-3: desktop attribution stays fully legible at ${vw} px wide`,
      n !== null && n.clipped === false && Math.abs(n.barBottomGap) < 1.5,
      JSON.stringify(n),
    );
    check(
      `A1-3: …and the scrubber lift tracks the bar's height at ${vw} px`,
      n !== null && n.tsGap !== null && n.tsGap > n.barH - 0.5,
      `scrubber ${n?.tsGap?.toFixed?.(1)} px up vs bar ${n?.barH?.toFixed?.(1)} px tall`,
    );
  }
  await dShoot("qsl-08-desktop-narrow-attribution");
  await dsend("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  // A1-15: the TimeReadout is co-axial with the scrub rail by design — it must ride the same
  // lift, or the two instruments split by exactly --mw-credit-h while the map is open.
  const coax = await dEval(`(() => {
    const ts = document.querySelector(".ts"); const tr = document.querySelector(".tr");
    if (!ts || !tr) return null;
    const a = ts.getBoundingClientRect(); const b = tr.getBoundingClientRect();
    return { tsGap: window.innerHeight - a.bottom, trGap: window.innerHeight - b.bottom }; })()`);
  // Their designed separation is 2.85rem − 2.2rem = 0.65rem = 10.4 px; if only one of them
  // takes the lift that gap changes by exactly --mw-credit-h. Invariance IS the assertion.
  check(
    "A1-15: the TimeReadout rides the same --mw-credit-h lift as the scrub rail",
    coax !== null && Math.abs(coax.trGap - coax.tsGap - 10.4) < 2,
    `separation ${coax ? (coax.trGap - coax.tsGap).toFixed(1) : "?"} px (designed 10.4)`,
  );
  // …and the closed state restores the original bottom-right chip (the wrapper is inert).
  await dEval(`window.__minimapStore.getState().setMapWindowOpen(false)`);
  await sleep(600);
  const closedD = await dEval(`(() => {
    const a = document.querySelector(".map-credit");
    const bar = document.querySelector(".map-creditbar");
    const r = a.getBoundingClientRect();
    return { fixed: getComputedStyle(a).position === "fixed", rightGap: window.innerWidth - r.right,
             barH: bar.getBoundingClientRect().height, events: getComputedStyle(a).pointerEvents }; })()`);
  check("desktop 3: closing the map restores the page credit's bottom-RIGHT chip", closedD.fixed === true && closedD.rightGap < 20 && closedD.events === "auto", JSON.stringify(closedD));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);