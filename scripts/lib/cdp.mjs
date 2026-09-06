/**
 * CDP plumbing shared by the visual-sweep harness — the house idiom, factored.
 *
 * Every helper here is LIFTED, not invented: `scripts/verify-perf-baseline.mjs:177-265` and
 * `scripts/verify-temporal-stability.mjs:150-200` both carry the same `attach / send / evalJs /
 * waitFor / ticks` block, and every line of it encodes a trap that cost a real session:
 *
 *   • a 90 s per-command timeout, because a stalled main thread must not hang a run silently;
 *   • `Runtime.evaluate` with `awaitPromise: true` and `returnByValue: true`, because the in-page
 *     probes are promises and a RemoteObject handle is useless to Node;
 *   • `Page.bringToFront` before any rAF window — the occlusion flags do NOT cover tab
 *     backgrounding, and a backgrounded tab's rAF runs at 1 Hz or not at all;
 *   • the bounce through `about:blank`, because `Page.navigate` to a URL that differs only in its
 *     hash does not reload — the pose would silently be the previous pose's.
 *
 * NOTHING in `verify-perf-baseline.mjs` or `verify-temporal-stability.mjs` was modified to make
 * this file: it is a copy with the two scripts' divergences reconciled, so those runs keep
 * whatever behaviour they were calibrated against.
 *
 * The `/json/new` + `trackTarget` pair deliberately stays in the CALLER (see
 * `test/verifyHarness.test.ts` C11: the fence reads `scripts/verify-*.mjs`, so a harness that
 * hides its target opening in a lib would be unfenced). `openTarget` below takes the already
 * created target descriptor.
 */
import { execFileSync, spawnSync } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The browser's HTTP endpoint (works even when a page's WebSocket is dead). */
export const httpJson = (port, path, method = "GET") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method }).then((r) => r.json());

/**
 * Make sure a CDP browser answers on `port`, launching the HEADLESS verify instance if not.
 *
 * Port 9222 is the OWNER's headed Chrome and is never launched or killed from here — if it is
 * down that is a fact about the owner's desktop, not something a harness may repair. 9333 is the
 * house headless instance and is launched through `scripts/verify-chrome.mjs` (never a raw
 * spawn: that script is the one place that knows about the three occlusion flags and about
 * refusing to kill a foreign port owner).
 */
export async function ensureBrowser(port, { profile = "/tmp/ftw-cdp", launch = true } = {}) {
  try {
    const v = await httpJson(port, "/json/version");
    return { launched: false, browser: v.Browser };
  } catch {
    /* nobody home */
  }
  if (!launch || String(port) === "9222") {
    throw new Error(
      `no CDP browser on :${port}` +
        (String(port) === "9222"
          ? " — that is the owner's headed Chrome; start it yourself (node scripts/verify-chrome.mjs) rather than from a harness"
          : ""),
    );
  }
  const node = process.execPath;
  spawnSync(
    node,
    ["scripts/verify-chrome.mjs", "--headless", "--port", String(port), "--profile", profile, "--kill-stale"],
    { stdio: "inherit", encoding: "utf8" },
  );
  for (let i = 0; i < 40; i++) {
    try {
      const v = await httpJson(port, "/json/version");
      return { launched: true, browser: v.Browser };
    } catch {
      await sleep(400);
    }
  }
  throw new Error(`launched a headless Chrome on :${port} but CDP never answered`);
}

/** `lsof` sanity: who owns the port (reported, never acted on). */
export function portOwner(port) {
  try {
    const pids = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    return pids.map((pid) => ({
      pid: Number(pid),
      cmd: execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" }).trim().slice(0, 160),
    }));
  } catch {
    return [];
  }
}

/**
 * A live CDP session on one page target.
 *
 * `target` is the descriptor `/json/new` returned — the caller opens it (and calls `trackTarget`)
 * so the harness fence can see both. Returns the send/eval/wait surface every verify script uses,
 * plus the exception and crash journals the report cites.
 */
export async function openSession(target, { timeoutMs = 90_000 } = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  const crashEvents = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.text ?? "exception");
    }
    if (msg.method === "Inspector.targetCrashed" || msg.method === "Inspector.detached") {
      crashEvents.push(`${new Date().toISOString()} ${msg.method} ${JSON.stringify(msg.params ?? {})}`);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, {
        res: (v) => (clearTimeout(timer), res(v)),
        rej: (e) => (clearTimeout(timer), rej(e)),
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    }
    return r.result.value;
  };
  /** Poll an expression until truthy. Exceptions mean "still booting", not failure. */
  const waitFor = async (expr, ms = 90_000, label = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await evalJs(expr)) return Date.now() - t0;
      } catch {
        /* booting */
      }
      await sleep(400);
    }
    throw new Error(`timed out after ${ms} ms waiting for: ${label}`);
  };
  /**
   * Wait `frames` rAF ticks, with a WATCHDOG (MEASUREMENTS §13: a rAF promise stalled for > 90 s
   * in 3 of 27 boots while the page answered ordinary evaluates within 50 ms). A stall is
   * REPORTED as `-1`, never a hung run — the caller decides what that means for its pose.
   */
  const ticks = async (frames = 2, watchdogMs = 15_000) => {
    await send("Page.bringToFront").catch(() => {});
    return evalJs(
      `new Promise((res) => {
         let n = 0;
         const wd = setTimeout(() => res(-1), ${watchdogMs});
         const step = () => (++n >= ${frames} ? (clearTimeout(wd), res(n)) : requestAnimationFrame(step));
         requestAnimationFrame(step);
       })`,
    );
  };
  /** Navigate through about:blank — a hash-only change does NOT reload (the oldest trap here). */
  const bootUrl = async (url) => {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await send("Page.navigate", { url });
  };
  const close = () => {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Inspector.enable").catch(() => {});
  return { ws, send, evalJs, waitFor, ticks, bootUrl, close, consoleErrors, crashEvents, target };
}

/**
 * Compose a CONTACT SHEET or a STRIP in the BROWSER.
 *
 * Deliberately dependency-free: `sharp` happens to be installed (as a transitive Astro dep, not a
 * declared one) but drawing captions with it means hand-rolling SVG text, and the harness already
 * holds a browser. A throwaway tab is handed a data-URL grid page and screenshotted — the same
 * mechanism that produced the tiles, so a sheet can never disagree with them.
 *
 * `items` = `[{ b64, caption, sub }]` (b64 = a raw base64 PNG, no data: prefix).
 */
export async function composeSheet(session, items, { cols = 3, cellW = 640, cellH = 360, title = "" } = {}) {
  const rows = Math.ceil(items.length / cols);
  const capH = 46;
  const pad = 10;
  const width = cols * cellW + (cols + 1) * pad;
  const height = rows * (cellH + capH) + (rows + 1) * pad + (title ? 42 : 0);
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#0d0f12;color:#e8eaed;font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
    .t{height:42px;display:flex;align-items:center;padding:0 ${pad}px;font-size:15px;color:#9aa4b2}
    .g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:${pad}px;padding:${pad}px}
    .c{width:${cellW}px}
    /* CONTAIN, never cover: the /m pose's thumbnail is 166 x 360 and cover cropped away most of
       its frame - a contact sheet that silently hides part of a view defeats its purpose. */
    .c img{display:block;width:${cellW}px;height:${cellH}px;object-fit:contain;background:#000;border:1px solid #222}
    .cap{height:${capH}px;padding:5px 3px;overflow:hidden}
    .id{color:#f0f3f7;font-weight:600}
    .sub{color:#8b97a8}
  </style>${title ? `<div class="t">${esc(title)}</div>` : ""}<div class="g">${items
    .map(
      (it) =>
        `<div class="c"><img src="data:image/png;base64,${it.b64}"><div class="cap"><div class="id">${esc(
          it.caption ?? "",
        )}</div><div class="sub">${esc(it.sub ?? "")}</div></div></div>`,
    )
    .join("")}</div>`;
  await session.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // `Page.setDocumentContent`, NOT a data: URL. Nine 640×360 base64 PNGs are ~5 MB, and once
  // `encodeURIComponent` has inflated that past Chrome's navigation limit the navigate silently
  // yields an empty document — the sheet then times out on "images decoded" with no other clue
  // (measured on the first full 14-pose run, 2026-09-06). setDocumentContent takes the HTML over
  // the protocol, where multi-MB payloads are ordinary.
  await session.send("Page.navigate", { url: "about:blank" });
  await sleep(120);
  const { frameTree } = await session.send("Page.getFrameTree");
  await session.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  // Wait for every <img> to decode — a sheet screenshotted mid-decode is a page of black boxes.
  await session.waitFor(
    `[...document.images].length === ${items.length} && [...document.images].every((i) => i.complete && i.naturalWidth > 0)`,
    20_000,
    "sheet images decoded",
  );
  await session.ticks(2);
  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  return { data: shot.data, width, height };
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * PIXEL-DIFF two base64 PNGs in the BROWSER.
 *
 * There is no PNG decoder in this repo's dependency tree that a harness may rely on (`sharp` is
 * a transitive Astro dep — present today, unpinned tomorrow), and shelling out to an image tool
 * is not portable. The browser IS the decoder: both images are drawn into a canvas, `getImageData`
 * gives the raw RGBA, and the counting is a plain loop. The diff image it returns is drawn the
 * same way — red where the channels disagree, the golden dimmed underneath — so a reviewer can
 * see WHERE, not just how many.
 *
 * Returns `{ ok, differing, total, fraction, maxDelta, w, h, diffB64 }`, or `{ error }` when the
 * two images differ in SIZE (a resize is a real difference, not a diff of zero pixels).
 */
export async function diffPngs(session, goldenB64, currentB64, { threshold = 0 } = {}) {
  await session.send("Page.navigate", { url: "about:blank" }).catch(() => {});
  await sleep(150);
  const expr = `(async () => {
    const load = (b64) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("decode failed"));
      im.src = "data:image/png;base64," + b64;
    });
    const A = await load(${JSON.stringify(goldenB64)});
    const B = await load(${JSON.stringify(currentB64)});
    if (A.naturalWidth !== B.naturalWidth || A.naturalHeight !== B.naturalHeight) {
      return { error: "size mismatch " + A.naturalWidth + "x" + A.naturalHeight + " vs " + B.naturalWidth + "x" + B.naturalHeight };
    }
    const w = A.naturalWidth, h = A.naturalHeight;
    const mk = (im) => { const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0); return x; };
    const a = mk(A).getImageData(0, 0, w, h).data;
    const b = mk(B).getImageData(0, 0, w, h).data;
    const oc = document.createElement("canvas"); oc.width = w; oc.height = h;
    const ox = oc.getContext("2d");
    const out = ox.createImageData(w, h);
    let differing = 0, maxDelta = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > maxDelta) maxDelta = d;
      if (d > ${threshold}) {
        differing++;
        out.data[i] = 255; out.data[i + 1] = 32; out.data[i + 2] = 32; out.data[i + 3] = 255;
      } else {
        const g = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) * 0.35;
        out.data[i] = g; out.data[i + 1] = g; out.data[i + 2] = g; out.data[i + 3] = 255;
      }
    }
    ox.putImageData(out, 0, 0);
    const total = w * h;
    return { differing, total, fraction: differing / total, maxDelta, w, h,
             diffB64: oc.toDataURL("image/png").split(",")[1] };
  })()`;
  const r = await session.evalJs(expr);
  if (r?.error) return r;
  return { ...r, ok: true };
}
