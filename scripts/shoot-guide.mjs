// GUIDE SCREENSHOT capture (audit #3 D10, 2026-08-22). One shot per invocation, driven over
// raw CDP against a running `wix dev` — the same harness the verify scripts use, so a shot is
// reproducible instead of a hand-cropped artifact nobody can regenerate.
//
//   node --experimental-websocket scripts/shoot-guide.mjs <recipe> [cdpPort]
//
// Recipes live in RECIPES below: each names the shell, the viewport, the URL, a `prepare()`
// that drives the app into the state to be photographed, and the output size the guide uses
// (360×783 portrait for /m, 720×450 for desktop — matching the shipped set).
//
// WARM-CACHE RULE (the 2026-07-16 cold-edge lesson): run each recipe TWICE and keep the second
// shot. The first paints half-loaded tiles; guide art must show the app as a user sees it after
// a moment. `--once` opts out for a quick look.
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const RECIPE = process.argv[2];
const PORT = process.argv[3] ?? "9222";
const ONCE = process.argv.includes("--once");
const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RECIPES = {
  /** The expanded MAP on /m: ◉, the live-3D window, the pills, the time strip, the credit line.
   *  This is the shot `fpv-map-controls` needs and no shipped image showed. */
  "fpv-map": {
    out: "public/guide/fpv-map.webp",
    width: 390,
    height: 844,
    scale: 3,
    mobile: true,
    resize: [360, 783],
    url: `http://localhost:4321/m#p=48.4640,35.0460,600,0,0&t=${NOON_UTC}`,
    async prepare({ evalJs, send }) {
      // Long-press ▲ 3D → stand in the scene, then open the fullscreen chart.
      const inFpv = await evalJs(`window.__cameraStore.getState().fpvHud !== null`);
      if (!inFpv) {
        const chip = await evalJs(
          `(() => { const el = document.querySelector(".m-actrow button"); if (!el) return null;
            const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
        if (!chip) throw new Error("▲3D chip not found");
        await send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: chip.x, y: chip.y, id: 1 }],
        });
        await sleep(700);
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(7000);
      }
      await evalJs(`window.__minimapStore.getState().setMapWindowOpen(true)`);
      await sleep(2500);
      // Pan a little so ◉ is LIT — the state the topic describes ("lit once you have explored
      // away") is the one worth photographing.
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 200, y: 500, id: 1 }],
      });
      for (let i = 1; i <= 8; i++) {
        await send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 200 - i * 8, y: 500 - i * 6, id: 1 }],
        });
        await sleep(40);
      }
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(2500);
    },
  },

  /** Desktop ORBIT — the chapter hero. Re-shot 2026-08-22 (D10): the 2×4 toggle grid, the
   *  banded radar and the focal cone all post-date the 2026-08-15 original. */
  orbit: {
    out: "public/guide/orbit.webp",
    width: 1440,
    height: 900,
    scale: 1,
    mobile: false,
    resize: [720, 450],
    url: `http://localhost:4321/#p=48.4640,35.0460,2500,0,55&t=${NOON_UTC}`,
    async prepare() {
      await sleep(4000); // the drape settles a beat after the engine reports ready
    },
  },

  /** Desktop FPV — the street-level hero: HUD, compact deck, the mini-map with its radar,
   *  the AIM stick in the mini-map corner and the focal cone on the ground. */
  fpv: {
    out: "public/guide/fpv.webp",
    width: 1440,
    height: 900,
    scale: 1,
    mobile: false,
    resize: [720, 450],
    url: `http://localhost:4321/#f=48.464000,35.046000,1.7,137.0,0.0,55.0&t=${NOON_UTC}`,
    async prepare({ evalJs }) {
      const t0 = Date.now();
      while (Date.now() - t0 < 40_000) {
        if (await evalJs(`window.__cameraStore.getState().fpvHud !== null`)) break;
        await sleep(500);
      }
      await sleep(6000);
    },
  },

  /** /m FPV touch controls — the caption enumerates what the picture shows, and the shipped
   *  one predates the AIM stick entirely (audit #3 D10). */
  "fpv-m": {
    out: "public/guide/fpv-m.webp",
    width: 390,
    height: 844,
    scale: 3,
    mobile: true,
    resize: [360, 783],
    url: `http://localhost:4321/m#f=48.464000,35.046000,1.7,137.0,0.0,55.0&t=${NOON_UTC}`,
    async prepare({ evalJs }) {
      const t0 = Date.now();
      while (Date.now() - t0 < 40_000) {
        if (await evalJs(`window.__cameraStore.getState().fpvHud !== null`)) break;
        await sleep(500);
      }
      await sleep(6000);
    },
  },

  /** Desktop TARGET panel with the moon tracked — the radar is BANDED now, wears an N marker
   *  and always-on washes; none of that is in the 2026-08-15 shot. */
  target: {
    out: "public/guide/target.webp",
    width: 1440,
    height: 900,
    scale: 1,
    mobile: false,
    resize: [720, 450],
    url: `http://localhost:4321/#p=48.4640,35.0460,3000,0,60&t=${NOON_UTC}`,
    async prepare({ evalJs }) {
      // Track the MOON, turn the radar on, and OPEN the panel — the caption names the object
      // card, the toggles and the ghost chain, so all three have to be on screen.
      await evalJs(
        `(() => { const s = window.__skyStore.getState();
          s.setAimVisible(true); s.setAimSun(true); s.setAimMoon(true);
          s.setVisible?.(true); s.setGhosts?.(true); s.setOpen(true);
          return true; })()`,
      ).catch((e) => console.warn("  sky setup:", e.message));
      await sleep(6000);
    },
  },
};

const recipe = RECIPES[RECIPE];
if (!recipe) {
  console.error(`usage: shoot-guide.mjs <${Object.keys(RECIPES).join("|")}> [cdpPort]`);
  await finishVerify(2);
}

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

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

await send("Emulation.setDeviceMetricsOverride", {
  width: recipe.width,
  height: recipe.height,
  deviceScaleFactor: recipe.scale,
  mobile: recipe.mobile,
});
if (recipe.mobile)
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const passes = ONCE ? 1 : 2;
let data = null;
for (let pass = 1; pass <= passes; pass++) {
  console.log(`pass ${pass}/${passes} — ${pass === 1 && passes > 1 ? "warming" : "capturing"}`);
  // TRAP: navigating to a URL that differs only in its HASH does not reload the document —
  // and /m re-mirrors the live camera into location.hash ~1.6 s after boot, so by pass 2 the
  // address bar no longer matches `recipe.url`. Bounce through about:blank for a real load.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(600);
  await send("Page.navigate", { url: recipe.url });
  // Boot: wait for the engine, not a fixed sleep.
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try {
      if (await evalJs(`!!window.__cameraStore && !!window.__globe`)) break;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  await sleep(6000);
  await recipe.prepare({ evalJs, send });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  data = shot.data;
}

mkdirSync("public/guide", { recursive: true });
const buf = Buffer.from(data, "base64");
const [w, h] = recipe.resize;
await sharp(buf).resize(w, h, { fit: "cover", position: "top" }).webp({ quality: 82 }).toFile(recipe.out);
const meta = await sharp(recipe.out).metadata();
console.log(`wrote ${recipe.out} — ${meta.width}×${meta.height} ${meta.format}`);
ws.close();
await finishVerify(0);
