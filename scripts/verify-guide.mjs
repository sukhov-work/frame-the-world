// Browser verification for the GUIDE FINALIZATION track (G-A…G-J, 2026-08-22g).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-guide.mjs [cdpPort] [shotsDir]
//
// Every check names the slice it closes and the mutation that turns it RED.
//
//   Desktop panel (Guide.tsx)
//   1. THE LIVE BUG — a crosslink to a topic in the CURRENT chapter SCROLLS. Trigger-guarded:
//      the run first proves the target starts off-screen, or the check passes on a coincidence.
//      (RED by removing navSeq from the scroll effect's deps.)
//   2. SURF-4 — the chapter header stays pinned while the body scrolls.
//   3. SURF-2 — the rail carries a topic tier for the OPEN chapter only.
//   4. G-E — search marks the matched terms, labels chapter vs topic, counts in aria-live,
//      and never fills the list from one chapter.
//   5. IX-4 — "/" focuses the search box; ↓ then Enter takes a hit.
//   6. IX-6 — a goal opens a reading ROUTE with a STEP n OF m footer.
//   7. COV-18d — PREV exists alongside NEXT.
//   8. IX-3 — Escape inside the guide does NOT unwind first-person view (capture phase).
//   9. IX-2 — ?guide=<id> opens straight to a topic and strips itself, keeping the pose hash.
//   /guide page (guide.astro)
//  10. SURF-9 — exactly one h1.
//  11. SURF-3 — every goal links the TOPIC, and that id is rendered on the page.
//  12. SURF-1 — the bundled search unhides itself and ranks; it is hidden without JS.
//  13. SURF-2 — the outline lists EVERY topic as a real anchor (67 → 70 this session).
//  14. T24 — the page emits no innerHTML-built markup (nodes only).
//   /m sheet (GuideSheet.tsx)
//  15. SURF-8 — search sits ABOVE the index/chapter split (reachable from inside a chapter).
//  16. SRCH-10 — /m hits carry the snippet the shell used to drop.
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z
const BASE = "http://localhost:4321";
const POSE = `#p=48.4640,35.0460,2500,0,60&t=${NOON_UTC}`;

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
/** Topic count measured on /guide — the /m index must match it exactly. */
let PAGE_TOPICS = 0;
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
  trackTarget(PORT, target.id); // audit #3 C11 — an abandoned target holds a WebGL context
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
      await sleep(400);
    }
    return false;
  };
  /**
   * Navigate through about:blank. A Page.navigate to a URL that differs only in its HASH is a
   * SAME-DOCUMENT navigation and never reloads — and the globe rewrites the hash ~1.6 s after
   * boot, so the second leg of any run would silently reuse the first leg's document.
   */
  const goto = async (url) => {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await send("Page.navigate", { url });
  };
  /** Real key events — a React onKeyDown never fires from a dispatched JS Event. */
  const key = async (k, code, keyCode) => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(150);
  };
  const typeText = async (t) => {
    for (const ch of t) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
    await sleep(400);
  };
  return { send, evalJs, shoot, waitFor, goto, key, typeText };
}

// ── DESKTOP PANEL ─────────────────────────────────────────────────────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await d.goto(`${BASE}/${POSE}`);
check("desktop: engine booted", await d.waitFor(`!!window.__cameraStore && !!window.__globe`));
await sleep(6000);

// Open the guide on the MOVE chapter (it owns both ends of the same-chapter crosslink).
await d.evalJs(`[...document.querySelectorAll('.gd-toggle')].find(b=>b.textContent.trim()==='Guide')?.click()`);
await sleep(500);
await d.evalJs(`[...document.querySelectorAll('.gd-railbtn')].find(b=>b.textContent.includes('MOVE'))?.click()`);
await sleep(600);

// 1 — THE LIVE BUG: move-minimap → move-aimstick, both inside MOVE.
{
  const before = await d.evalJs(`(() => {
    const host = document.querySelector('.gd-scroll');
    const el = host?.querySelector('[data-gd-topic="move-aimstick"]');
    if (!host || !el) return null;
    host.scrollTop = 0;
    return { scrollTop: host.scrollTop, offBy: el.getBoundingClientRect().top - host.getBoundingClientRect().top };
  })()`);
  // TRIGGER GUARD: if the target already sits at the top, a broken scroll would still "pass".
  check(
    "nav-bug trigger guard: the same-chapter target starts well BELOW the fold",
    before !== null && before.offBy > 200,
    before ? `${before.offBy.toFixed(0)} px down, scrollTop ${before.scrollTop}` : "not found",
  );
  await d.evalJs(`(() => {
    const t = document.querySelector('[data-gd-topic="move-minimap"]');
    const link = [...t.querySelectorAll('.gd-link')].find(b => b.textContent.includes('AIM stick'));
    link?.click();
  })()`);
  await sleep(700);
  const after = await d.evalJs(`(() => {
    const host = document.querySelector('.gd-scroll');
    const el = host?.querySelector('[data-gd-topic="move-aimstick"]');
    return { scrollTop: host.scrollTop, maxScroll: host.scrollHeight - host.clientHeight,
             clientH: host.clientHeight,
             offBy: el.getBoundingClientRect().top - host.getBoundingClientRect().top };
  })()`);
  // The target is the LAST topic of MOVE, so the scroller clamps at its maximum before the
  // element can reach y=0. "Landed" therefore means: it scrolled, and the topic is now inside
  // the visible column — not that it sits exactly at the top.
  const clamped = after.maxScroll - after.scrollTop < 2;
  check(
    "1. G-F: a crosslink INSIDE the open chapter scrolls to its topic (the live bug)",
    after.scrollTop > 50 && after.offBy >= 0 && after.offBy < after.clientH && (clamped || after.offBy < 60),
    `scrollTop 0→${after.scrollTop.toFixed(0)} (max ${after.maxScroll.toFixed(0)}${clamped ? ", CLAMPED" : ""}), target ${after.offBy.toFixed(0)} px into a ${after.clientH.toFixed(0)} px column`,
  );
}

// 2 — SURF-4: the header is pinned while the body is scrolled.
{
  const r = await d.evalJs(`(() => {
    const host = document.querySelector('.gd-scroll');
    const head = document.querySelector('.gd-head');
    const cs = getComputedStyle(head);
    return { pos: cs.position, headTop: head.getBoundingClientRect().top,
             hostTop: host.getBoundingClientRect().top, scrolled: host.scrollTop,
             bg: cs.backgroundColor };
  })()`);
  check(
    "2. SURF-4: the chapter header stays pinned to the top of the scroller",
    r.pos === "sticky" && r.scrolled > 50 && Math.abs(r.headTop - r.hostTop) < 4,
    `position:${r.pos}, head ${(r.headTop - r.hostTop).toFixed(1)} px from the scroller top at scrollTop ${r.scrolled.toFixed(0)}`,
  );
  check("2b. SURF-4: the sticky band is opaque (the gap would show text through)", r.bg !== "rgba(0, 0, 0, 0)", r.bg);
}

// 3 — SURF-2: a topic tier, for the OPEN chapter only.
{
  const r = await d.evalJs(`(() => ({
    groups: document.querySelectorAll('.gd-railgroup').length,
    tiers: document.querySelectorAll('.gd-railtopics').length,
    topics: document.querySelectorAll('.gd-railtopic').length,
  }))()`);
  check(
    "3. SURF-2: the rail expands topics for exactly ONE chapter",
    r.groups === 11 && r.tiers === 1 && r.topics > 4,
    `${r.groups} chapters, ${r.tiers} expanded, ${r.topics} topics`,
  );
}

// 4 — G-E presentation.
{
  await d.evalJs(`(() => { const i = document.querySelector('.gd-search'); i.focus(); })()`);
  await d.typeText("map");
  await sleep(400);
  const r = await d.evalJs(`(() => ({
    marks: document.querySelectorAll('.gd-hit mark').length,
    kinds: document.querySelectorAll('.gd-hit__kind').length,
    count: document.querySelector('.gd-hitcount')?.textContent ?? '',
    live: document.querySelector('.gd-hitcount')?.getAttribute('aria-live') ?? '',
    snips: document.querySelectorAll('.gd-hit__snip').length,
    perChapter: (() => {
      const m = {};
      for (const b of document.querySelectorAll('.gd-hit')) {
        const ch = b.querySelector('.gd-hit__ch')?.textContent ?? '?';
        m[ch] = (m[ch] ?? 0) + 1;
      }
      return Math.max(0, ...Object.values(m));
    })(),
  }))()`);
  check("4a. G-E: matched terms are marked", r.marks > 0, `${r.marks} <mark> runs`);
  check("4b. G-E: every hit shows chapter-vs-topic", r.kinds > 0, `${r.kinds} kind pills`);
  check("4c. G-E: the result count is announced", /RESULT/.test(r.count) && r.live === "polite", `"${r.count}" aria-live=${r.live}`);
  check("4d. G-E: no chapter fills the list", r.perChapter > 0 && r.perChapter <= 3, `worst chapter has ${r.perChapter} rows`);
  check("4e. SRCH-10: hits carry a snippet", r.snips > 0, `${r.snips} snippets`);
  await d.shoot("guide-01-desktop-search");
}

// 5 — IX-4: "/" focuses search; ↓ then Enter takes a hit.
{
  // Clear the box the LAYERED-ESC way (a real user path, and it proves that half of IX-3):
  // Escape with a non-empty query must clear the query and leave the panel open.
  await d.key("Escape", "Escape", 27);
  const cleared = await d.evalJs(`({ q: document.querySelector('.gd-search')?.value ?? null, panel: !!document.querySelector('.gd-panel') })`);
  check("5a. IX-3: Escape clears a non-empty query and keeps the panel open", cleared.q === "" && cleared.panel, `query "${cleared.q}", panel ${cleared.panel}`);

  await d.evalJs(`document.querySelector('.gd-search').blur(); document.querySelector('.gd-scroll').focus();`);
  await d.key("/", "Slash", 191);
  const focused = await d.evalJs(`document.activeElement?.className ?? ''`);
  check("5b. IX-4: \"/\" focuses the guide search", focused.includes("gd-search"), `activeElement .${focused}`);
  await d.typeText("radar");
  await sleep(400);
  const nHits = await d.evalJs(`document.querySelectorAll('.gd-hit').length`);
  check("5c trigger guard: the query actually produced hits to walk", nHits > 1, `${nHits} hits`);
  await d.key("ArrowDown", "ArrowDown", 40);
  const cur = await d.evalJs(`document.querySelectorAll('.gd-hit.is-cur').length`);
  check("5d. IX-4: ↓ moves a keyboard cursor through the hits", cur === 1, `${cur} highlighted`);
  await d.key("Enter", "Enter", 13);
  await sleep(700);
  const landed = await d.evalJs(`({ chapter: document.querySelector('.gd-chtitle')?.textContent ?? '', q: document.querySelector('.gd-search')?.value ?? '' })`);
  check(
    "5e. IX-4: Enter navigates to the highlighted hit and clears the query",
    landed.chapter.length > 0 && landed.q === "",
    `chapter "${landed.chapter}", query "${landed.q}"`,
  );
}

// 6 + 7 — IX-6 goal routes, COV-18d PREV.
{
  await d.evalJs(`[...document.querySelectorAll('.gd-railbtn')].find(b=>b.textContent.includes('START'))?.click()`);
  await sleep(500);
  await d.evalJs(`[...document.querySelectorAll('.gd-goal')].find(b=>b.textContent.includes('Scout a location'))?.click()`);
  await sleep(700);
  const r = await d.evalJs(`(() => {
    const route = document.querySelector('.gd-next--route');
    return { route: route?.textContent ?? '', prev: document.querySelector('.gd-prev')?.textContent ?? '',
             next: [...document.querySelectorAll('.gd-next')].map(b=>b.textContent).find(t=>t.startsWith('NEXT')) ?? '' };
  })()`);
  check("6. IX-6: a goal opens a numbered reading route", /STEP \d+ OF \d+/.test(r.route), `"${r.route.trim()}"`);
  check("7. COV-18d: PREV rides beside NEXT", r.prev.includes("PREV") && r.next.includes("NEXT"), `"${r.prev.trim()}" / "${r.next.trim()}"`);
  await d.shoot("guide-02-desktop-route");
}

// 8 — IX-3: Escape inside the guide must not unwind FPV.
{
  await d.evalJs(`window.__cameraStore.getState().setTempPin({ latDeg: 48.464, lonDeg: 35.046 })`);
  await sleep(400);
  await d.evalJs(`window.__cameraStore.getState().setTempFpv(true)`);
  await sleep(2500);
  const inFpv = await d.evalJs(`window.__cameraStore.getState().tempFpv === true`);
  check("8 trigger guard: first-person view is actually active before the Escape", inFpv);
  // The panel may already be open from the route checks — the toggle TOGGLES, so clicking it
  // blindly closes it and the Escape below would reach the globe instead. Open only if shut.
  await d.evalJs(`(() => {
    if (!document.querySelector('.gd-panel'))
      [...document.querySelectorAll('.gd-toggle')].find(b=>b.textContent.trim()==='Guide')?.click();
  })()`);
  await sleep(600);
  const openBefore = await d.evalJs(`!!document.querySelector('.gd-panel')`);
  check("8 trigger guard: the guide panel is open before the Escape", openBefore);
  await d.key("Escape", "Escape", 27);
  await sleep(500);
  const after = await d.evalJs(`({ fpv: window.__cameraStore.getState().tempFpv, panel: !!document.querySelector('.gd-panel') })`);
  check(
    "8. IX-3: Escape closes the GUIDE and leaves first-person view standing",
    openBefore && after.panel === false && after.fpv === true,
    `panel ${openBefore}→${after.panel}, tempFpv still ${after.fpv}`,
  );
}

// 9 — IX-2: ?guide=<id> opens a topic and strips itself, keeping the pose hash.
{
  await d.goto(`${BASE}/?guide=fpv-focal-axes${POSE}`);
  check("desktop: engine re-booted", await d.waitFor(`!!window.__cameraStore`));
  await sleep(5000);
  const r = await d.evalJs(`(() => ({
    open: !!document.querySelector('.gd-panel'),
    chapter: document.querySelector('.gd-chtitle')?.textContent ?? '',
    hit: !!document.querySelector('[data-gd-topic="fpv-focal-axes"]'),
    search: location.search, hash: location.hash.slice(0, 3),
  }))()`);
  check(
    "9. IX-2: ?guide=<id> opens the panel at that topic",
    r.open && r.hit && r.chapter.length > 0,
    `chapter "${r.chapter}", topic present ${r.hit}`,
  );
  check("9b. IX-2: the param strips itself and the pose hash survives", r.search === "" && r.hash === "#p=", `search "${r.search}" hash "${r.hash}"`);
  await d.shoot("guide-03-desktop-deeplink");
}

// ── /guide PAGE ───────────────────────────────────────────────────────────────────────────
{
  await d.goto(`${BASE}/guide`);
  check("/guide: rendered", await d.waitFor(`!!document.querySelector('.g-chapter')`));
  await sleep(800);
  const r = await d.evalJs(`(() => ({
    h1: document.querySelectorAll('h1').length,
    h1text: document.querySelector('h1')?.textContent ?? '',
    goals: [...document.querySelectorAll('.g-goals > li > a')].map(a => a.getAttribute('href')),
    goalTargetsRendered: [...document.querySelectorAll('.g-goals > li > a')]
      .every(a => !!document.querySelector(a.getAttribute('href').replace('#', '#').replace(/^#/, '#'))
        || !!document.getElementById(a.getAttribute('href').slice(1))),
    tocTopics: document.querySelectorAll('.g-toctopics a').length,
    topics: document.querySelectorAll('.g-topic').length,
    routes: document.querySelectorAll('.g-route').length,
    findHidden: document.getElementById('g-find')?.hidden,
    lists: document.querySelectorAll('.g-list').length,
    imgLinks: document.querySelectorAll('.g-fig a img').length,
    imgsSized: [...document.querySelectorAll('.g-fig img')].every(i => i.getAttribute('width') && i.getAttribute('height')),
  }))()`);
  check("10. SURF-9: the page has exactly one h1", r.h1 === 1, `${r.h1} — "${r.h1text}"`);
  check("11. SURF-3: every goal links a rendered TOPIC id", r.goalTargetsRendered && r.goals.length === 14, `${r.goals.length} goals, all resolve`);
  // Derived, not hard-coded: the invariant is "the outline lists EVERY topic", and the topic
  // count grows whenever the guide does (67 → 70 this session).
  check("13. SURF-2: the outline lists every topic", r.tocTopics === r.topics && r.topics > 60, `${r.tocTopics} outline entries / ${r.topics} rendered topics`);
  check("13b. IX-6: goal routes render as anchor lists", r.routes === 14, `${r.routes} routes`);
  check("G-B: list fields render on the page", r.lists > 5, `${r.lists} <ul>`);
  check("G-B: every image reserves its box", r.imgsSized, "width+height on all figures");
  check("IX-5: images link to their full size (zero-JS)", r.imgLinks === 13, `${r.imgLinks} linked`);
  check("12a. SURF-1: search is UNHIDDEN once the bundle runs", r.findHidden === false, `hidden=${r.findHidden}`);

  await d.evalJs(`(() => { const i = document.getElementById('g-find-q'); i.focus(); i.value=''; })()`);
  await d.typeText("recentre");
  await sleep(500);
  const s = await d.evalJs(`(() => {
    const hits = [...document.querySelectorAll('.g-find__hit')];
    return { n: hits.length, first: hits[0]?.getAttribute('href') ?? '', kinds: document.querySelectorAll('.g-find__k').length };
  })()`);
  check("12b. SURF-1: the page ranks with the SAME engine as the shells", s.n > 0 && s.first === "#fpv-map-controls", `${s.n} hits, first ${s.first}`);
  check("12c. SURF-1: hits carry the chapter/topic pill", s.kinds === s.n, `${s.kinds}/${s.n}`);
  await d.shoot("guide-04-page-search");

  // 14 — T24: the enhancement builds NODES; no innerHTML anywhere in the shipped page.
  const noInner = await d.evalJs(`![...document.scripts].some(s => (s.textContent||'').includes('innerHTML'))`);
  check("14. T24: the page's own scripts never use innerHTML", noInner);
  PAGE_TOPICS = r.topics; // /m must list exactly what the page renders — one corpus, three surfaces
}

// ── /m SHEET ──────────────────────────────────────────────────────────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(`${BASE}/m${POSE}`);
check("/m: engine booted", await m.waitFor(`!!window.__cameraStore`));
await sleep(7000);
{
  await m.evalJs(`[...document.querySelectorAll('.m-chip')].find(b=>b.textContent.trim()==='GUIDE')?.click()`);
  await sleep(800);
  const idx = await m.evalJs(`(() => ({
    search: !!document.querySelector('.m-gsearch'),
    topics: document.querySelectorAll('.m-gchtopic').length,
  }))()`);
  check("15a. SURF-8: the /m index shows the search box", idx.search);
  check("15b. SURF-2: the /m index lists every topic", idx.topics === PAGE_TOPICS, `${idx.topics} chips vs ${PAGE_TOPICS} on /guide`);
  // Drill into a chapter — the search box must SURVIVE the view switch (it used to vanish).
  await m.evalJs(`[...document.querySelectorAll('.m-grow__ch')].find(s=>s.textContent.includes('STAND IN IT'))?.closest('button')?.click()`);
  await sleep(700);
  const inCh = await m.evalJs(`(() => ({
    search: !!document.querySelector('.m-gsearch'),
    chapter: document.querySelector('.m-section')?.textContent ?? '',
  }))()`);
  check(
    "15. SURF-8: search is reachable from INSIDE a chapter on /m",
    inCh.search && inCh.chapter.length > 0,
    `chapter "${inCh.chapter}", search present ${inCh.search}`,
  );
  await m.evalJs(`(() => { const i = document.querySelector('.m-gsearch'); i.focus(); })()`);
  await m.typeText("moon");
  await sleep(500);
  const hits = await m.evalJs(`(() => ({
    n: document.querySelectorAll('.m-grow').length,
    snips: document.querySelectorAll('.m-ghit__snip').length,
    marks: document.querySelectorAll('.m-ghit mark').length,
    count: document.querySelector('.m-gcount')?.textContent ?? '',
  }))()`);
  check("16. SRCH-10: /m hits carry the snippet the shell used to drop", hits.snips > 0, `${hits.snips}/${hits.n} rows`);
  check("16b. G-E: /m marks matched terms and counts them", hits.marks > 0 && /RESULT/.test(hits.count), `${hits.marks} marks, "${hits.count}"`);
  await m.shoot("guide-05-m-search");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
// finishVerify takes the EXIT CODE and exits itself, after returning every tracked CDP
// target. A bare process.exit() here would skip that cleanup and leak a WebGL context
// (test/verifyHarness.test.ts fences both halves — it caught this file passing PORT).
await finishVerify(failures === 0 ? 0 : 1);
