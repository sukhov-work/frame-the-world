// Scripted-Chrome verification of the 2026-09-18 mobile fixes (owner: three /m asks, then deploy).
//   1. THE WHOLE-PLANET BOOT — a bare `/m` boots the 2D map at MOBILE2D.bootAltM (18,000 km): the
//      camera mirror and the nav chip's readout both say so; the globe's disc sits inside the frame.
//   2. THE FPV RAIL, signed out — the 2026-09-08b geometry byte for byte: AR · ⤒ · ⤓ then ◎ SAVE
//      (dimmed) then ✕ EXIT VIEW, one x for every round cell, no two rects touching.
//   3. THE FPV RAIL, signed in — the member's ▤ PLACES is a 44 px icon cell BETWEEN ◎ SAVE and
//      ✕ EXIT VIEW; EXIT VIEW is the lowest cell; the altitude column seats one cell higher, so ⤓ no
//      longer covers ◎ SAVE (the owner's bug). A tap on ▤ PLACES opens the SEARCH sheet.
//   4. SIGN OUT from the PLUX menu (signed in) — the JSON round-trip + the top-level logout chain
//      land back on /m with a VISITOR cookie and SIGN IN in the menu (the form used to 403 live).
//   5. SIGN OUT from the desktop badge — the same path on the other shell.
// The member session is minted the verify-places-member way (the documented test member from
// .env.local). Screenshots land in verify-shots/mobile-fixes-2026-09-18/ (git-ignored).
// Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-mobile-fixes-2026-09-18.mjs [cdpPort] [shotsDir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots/mobile-fixes-2026-09-18";
mkdirSync(SHOTS, { recursive: true });
const APP = "http://localhost:4321";
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — 15:00 in Dnipro
const M_URL = `${APP}/m`;
const M_FPV_URL = `${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const BOOT_ALT_M = 18_000_000; // MOBILE2D.bootAltM at the time of writing (the check reads the live mirror)

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- the member session (node side; the verify-places-member recipe) --------------------------
function mintCookie() {
  const env = readFileSync(".env.local", "utf-8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const clientId = get("WIX_CLIENT_ID");
  const email = get("TEST_MEMBER_EMAIL");
  const password = get("TEST_MEMBER_PASSWORD");
  if (!clientId || !email || !password) throw new Error("WIX_CLIENT_ID / TEST_MEMBER_* missing from .env.local");
  return (async () => {
    const client = createClient({ auth: OAuthStrategy({ clientId }) });
    const login = await client.auth.login({ email, password });
    if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
    const REDIRECT = `${APP}/api/auth/callback`;
    const oauthData = client.auth.generateOAuthData(REDIRECT, APP + "/");
    const authorizeUrl =
      `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
      `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
      `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
    const authRes = await fetch(authorizeUrl, { redirect: "manual" });
    const loc = authRes.headers.get("location");
    if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
    const code = new URL(loc).searchParams.get("code");
    const state = new URL(loc).searchParams.get("state");
    const tokens = await client.auth.getMemberTokens(code, state, oauthData);
    console.log("member tokens minted:", tokens.refreshToken.role);
    return encodeURIComponent(JSON.stringify({ clientId, tokens }));
  })();
}

// ---- CDP plumbing (the uxbatch harness idiom; a FRESH target per page — the pointer-event trap) --
async function attach({ mobile = true } = {}) {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id); // audit #3 C11: register for close
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
  if (mobile) {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
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
  const click = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const tapSel = async (sel) => {
    const r = await rect(sel);
    if (!r) return false;
    await (mobile ? tap(r.x + r.w / 2, r.y + r.h / 2) : click(r.x + r.w / 2, r.y + r.h / 2));
    return true;
  };
  /** Set the member cookie on the app origin: load a page there first (document.cookie needs it). */
  const seedCookie = async (cookieVal) => {
    await goto(`${APP}/api/ping`, 800);
    await evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800"`);
    await goto("about:blank", 300);
  };
  const cookieRole = () =>
    evalJs(`(() => { const m = /(?:^|; )wixSession=([^;]+)/.exec(document.cookie); if (!m) return null;
      try { return JSON.parse(decodeURIComponent(m[1])).tokens.refreshToken.role; } catch { return "unparsable"; } })()`);
  const close = () => ws.close();
  return { send, evalJs, shoot, goto, waitFor, rect, tap, click, tapSel, seedCookie, cookieRole, close };
}

/** The FPV right rail as rects: the altitude column's cells + the actions column's buttons. */
const RAIL_JS = `(() => {
  const col = document.querySelector(".m-altcol"); if (!col) return null;
  const r2o = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, text: el.textContent.trim(), cls: el.className }; };
  const cells = [...col.children].map((c) => r2o(c.querySelector("button") || c));
  const acts = [...document.querySelectorAll(".m-actions > button, .m-actions > * > button")].map(r2o);
  const cr = col.getBoundingClientRect();
  return { col: { x: cr.x, y: cr.y, w: cr.width, h: cr.height, bottom: cr.bottom }, cells, acts,
    token: getComputedStyle(document.body).getPropertyValue("--m-altcol-bottom").trim() };
})()`;

// ── 1. THE WHOLE-PLANET BOOT (anonymous, bare /m) ──────────────────────────────────────────
{
  const m = await attach();
  await m.goto(M_URL, 1000);
  const booted = await m.waitFor("!!(window.__globe && window.__cameraStore && window.__cameraStore.getState().camGeo)", 60000);
  check("1a. a bare /m boots (globe + camera mirror live)", booted);
  await sleep(2500);
  const st = await m.evalJs("(() => { const s = window.__cameraStore.getState(); return { alt: s.zoomAltM, mode: s.mapMode, tilt: s.tiltDeg, lat: s.focusLatDeg, lon: s.focusLonDeg }; })()");
  check("1b. the camera mirror sits at MOBILE2D.bootAltM (18,000 km, ±2 %)", Math.abs(st.alt - BOOT_ALT_M) / BOOT_ALT_M < 0.02, `${(st.alt / 1000).toFixed(0)} km`);
  check("1c. …on the 2D map (nadir, north-up)", st.mode === "2d" && Math.abs(st.tilt) < 1, `mode ${st.mode} tilt ${st.tilt?.toFixed(1)}`);
  check("1d. …over the Dnipro-ish default focus", Math.abs(st.lat - 48.46) < 0.5 && Math.abs(st.lon - 35.05) < 0.5, `${st.lat?.toFixed(2)},${st.lon?.toFixed(2)}`);
  const nav = await m.rect(".m-nav__alt");
  check("1e. the nav chip reads the whole-planet altitude", nav !== null && /^1[78]\d{3} KM$/.test(nav.text), `"${nav?.text}"`);
  await m.shoot("01-boot-whole-planet");
  m.close();
}

// ── 2. THE FPV RAIL, signed out ────────────────────────────────────────────────────────────
{
  const m = await attach();
  await m.goto(M_FPV_URL, 1000);
  check("2a. FPV live (anonymous)", await m.waitFor("window.__cameraStore && window.__cameraStore.getState().fpvHud !== null", 45000));
  await sleep(2500);
  const rail = await m.evalJs(RAIL_JS);
  check("2b. the altitude column is up with its three cells", rail !== null && rail.cells.length === 3, `${rail?.cells.length} cells`);
  const names = rail.acts.map((a) => a.text.replace(/\s+/g, " "));
  check("2c. the actions column is ◎ SAVE then ✕ EXIT VIEW — nothing else", names.length === 2 && /SAVE/.test(names[0]) && /EXIT VIEW/.test(names[1]), names.join(" · "));
  check("2d. no PLACES cell for a visitor", !rail.acts.some((a) => /m-act--places/.test(a.cls)));
  const xs = [...rail.cells, rail.acts[0]].map((c) => c.x);
  check("2e. the four round cells share one x", Math.max(...xs) - Math.min(...xs) < 1, xs.map((v) => v.toFixed(0)).join(","));
  const all = [...rail.cells, ...rail.acts];
  const hits = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlaps(all[i], all[j])) hits.push(`${all[i].text.slice(0, 8)}×${all[j].text.slice(0, 8)}`);
  check("2f. no two rail rects overlap", hits.length === 0, hits.join(" ") || "clean");
  check("2g. the seat token is the signed-out base (16.4rem)", /^16\.4rem$/.test(rail.token), rail.token);
  check("2h. the column's bottom edge clears the SAVE cell", rail.col.bottom <= rail.acts[0].y - 3, `gap ${(rail.acts[0].y - rail.col.bottom).toFixed(1)} px`);
  await m.shoot("02-fpv-rail-signed-out");
  m.close();
}

// ── 3. THE FPV RAIL, signed in ─────────────────────────────────────────────────────────────
const cookieVal = await mintCookie();
{
  const m = await attach();
  await m.seedCookie(cookieVal);
  await m.goto(M_FPV_URL, 1000);
  check("3a. FPV live (member)", await m.waitFor("window.__cameraStore && window.__cameraStore.getState().fpvHud !== null", 45000));
  check("3b. the member session resolved on /m", await m.waitFor(`window.__memberStore && window.__memberStore.getState().phase === "member"`, 20000));
  await sleep(2000);
  const rail = await m.evalJs(RAIL_JS);
  const names = rail.acts.map((a) => a.text.replace(/\s+/g, " "));
  check("3c. the actions column is ◎ SAVE · ▤ PLACES · ✕ EXIT VIEW, in that order", names.length === 3 && /SAVE/.test(names[0]) && /PLACES/.test(names[1]) && /EXIT VIEW/.test(names[2]), names.join(" · "));
  const places = rail.acts[1];
  check("3d. ▤ PLACES is a 44 × 44 icon cell (m-act--icon m-act--places)", places && /m-act--icon/.test(places.cls) && /m-act--places/.test(places.cls) && Math.abs(places.w - 44) < 1 && Math.abs(places.h - 44) < 1, `${places?.w.toFixed(0)}×${places?.h.toFixed(0)} ${places?.cls}`);
  check("3e. …not the old text pill", !names.some((n) => /SAVED PLACES/.test(n)));
  const exit = rail.acts[2];
  check("3f. ✕ EXIT VIEW is the LOWEST cell of the rail", exit && rail.acts.every((a) => a.y <= exit.y) && rail.cells.every((c) => c.y < exit.y), `exit y ${exit?.y.toFixed(0)}`);
  const xs = [...rail.cells, rail.acts[0], rail.acts[1]].map((c) => c.x);
  check("3g. the five round cells share one x", Math.max(...xs) - Math.min(...xs) < 1, xs.map((v) => v.toFixed(0)).join(","));
  check("3h. EXIT VIEW's right edge aligns with the cells", Math.abs(exit.right - rail.cells[0].right) < 1, `${exit.right.toFixed(0)} vs ${rail.cells[0].right.toFixed(0)}`);
  const all = [...rail.cells, ...rail.acts];
  const hits = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlaps(all[i], all[j])) hits.push(`${all[i].text.slice(0, 8)}×${all[j].text.slice(0, 8)}`);
  check("3i. no two rail rects overlap — ⤓ no longer covers ◎ SAVE (the owner's bug)", hits.length === 0, hits.join(" ") || "clean");
  check("3j. the seat token lifted by one cell + gap", /calc\(16\.4rem \+ 52px\)/.test(rail.token), rail.token);
  check("3k. the column's bottom edge clears the SAVE cell", rail.col.bottom <= rail.acts[0].y - 3, `gap ${(rail.acts[0].y - rail.col.bottom).toFixed(1)} px`);
  await m.shoot("03-fpv-rail-member");
  // A tap on ▤ PLACES opens the SEARCH sheet (the MY PLACES list lives in its idle state).
  await m.tapSel(".m-actions .m-act--places");
  await sleep(700);
  const sheet = await m.rect(".m-sheet");
  check("3l. a tap on ▤ PLACES opens the sheet", sheet !== null, sheet ? `sheet at y ${sheet.y.toFixed(0)}` : "no sheet");
  await m.shoot("04-places-sheet-from-fpv");
  m.close();
}

// ── 4. SIGN OUT from the PLUX menu (/m, signed in) ─────────────────────────────────────────
{
  const m = await attach();
  await m.seedCookie(cookieVal);
  await m.goto(M_URL, 1000);
  check("4a. /m booted as a member", await m.waitFor(`window.__memberStore && window.__memberStore.getState().phase === "member"`, 45000));
  check("4b. the cookie carries MEMBER tokens before", (await m.cookieRole()) === "member", await m.cookieRole());
  await sleep(1500);
  check("4c. the wordmark opens the PLUX menu", await m.tapSel(".m-status .m-title[aria-haspopup='menu']"));
  await sleep(500);
  const menuItems = () => m.evalJs(`[...document.querySelectorAll(".m-menu[role='menu'] [role='menuitem']")].map((e) => e.textContent.trim())`);
  let items = await menuItems();
  // TRANSIENT (seen 1 run in 3, 2026-09-18): the menu row's own refresh() hit a rejected
  // getCurrentMember and the store flipped to "anonymous" while the cookie still carried MEMBER
  // tokens (store/member treats any SDK failure as signed-out). Not the sign-out path under test —
  // re-resolve once, LOUDLY, and reopen; a real regression fails the same check on the retry.
  if (!items.some((t) => /SIGN OUT/.test(t)) && (await m.cookieRole()) === "member") {
    console.log("note  4d transient: the store read anonymous on a member cookie — refreshing once and reopening");
    await m.evalJs(`window.__memberStore.getState().refresh()`);
    await m.waitFor(`window.__memberStore.getState().phase === "member"`, 15000);
    await m.evalJs(`document.querySelector(".m-menu-scrim")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    await sleep(400);
    await m.tapSel(".m-status .m-title[aria-haspopup='menu']");
    await sleep(500);
    items = await menuItems();
  }
  check("4d. the menu lists the member row, SIGN OUT, GUIDE, DESKTOP", items.length === 4 && /SIGN OUT/.test(items[1]) && /GUIDE/.test(items[2]) && /DESKTOP/.test(items[3]), items.join(" · "));
  check("4e. SIGN OUT is a button, not a form", await m.evalJs(`document.querySelector(".m-menu form") === null && [...document.querySelectorAll(".m-menu button[role='menuitem']")].some((b) => /SIGN OUT/.test(b.textContent))`));
  await m.shoot("05-menu-member");
  const signOut = await m.evalJs(`(() => { const b = [...document.querySelectorAll(".m-menu button[role='menuitem']")].find((b) => /SIGN OUT/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  check("4f. the SIGN OUT row is tappable", signOut !== null);
  await m.tap(signOut.x, signOut.y);
  // The JSON round-trip, then the top-level chain: IAM logout → logout-callback → /m (a fresh document).
  const back = await m.waitFor(`location.pathname === "/m" && window.__memberStore && window.__memberStore.getState().phase === "anonymous" && !document.querySelector(".m-menu")`, 45000);
  check("4g. the chain lands back on /m with an ANONYMOUS session", back, await m.evalJs("location.href + ' · ' + (window.__memberStore ? window.__memberStore.getState().phase : 'no store')"));
  check("4h. the cookie now carries VISITOR tokens", (await m.cookieRole()) === "visitor", await m.cookieRole());
  await sleep(1200);
  await m.tapSel(".m-status .m-title[aria-haspopup='menu']");
  await sleep(500);
  const after = await m.evalJs(`[...document.querySelectorAll(".m-menu[role='menu'] [role='menuitem']")].map((e) => e.textContent.trim())`);
  check("4i. the menu offers SIGN IN again", after.length === 3 && /SIGN IN/.test(after[0]), after.join(" · "));
  const body = await m.evalJs("document.body.innerText");
  check("4j. no 'Cross-site POST form submissions are forbidden' anywhere", !/Cross-site .*forbidden/i.test(body));
  await m.shoot("06-menu-after-sign-out");
  m.close();
}

// ── 5. SIGN OUT from the desktop badge (/) ─────────────────────────────────────────────────
{
  const m = await attach({ mobile: false });
  await m.seedCookie(cookieVal);
  await m.goto(`${APP}/?d=1`, 1000);
  check("5a. the desktop booted as a member", await m.waitFor(`window.__memberStore && window.__memberStore.getState().phase === "member"`, 45000));
  await sleep(1500);
  // Dismiss the welcome hero first (the verify-places-member idiom) — it owns the pointer until then.
  await m.click(800, 500);
  await sleep(900);
  check("5b. the badge's Sign out is a button (no form)", await m.evalJs(`document.querySelector("form.mb-form") === null && document.querySelector("button.mb-out") !== null`));
  check("5c. click Sign out", await m.tapSel("button.mb-out"));
  await sleep(400);
  const label = await m.evalJs(`document.querySelector("button.mb-out")?.textContent ?? "(navigating)"`);
  check("5c'. the click armed the round-trip (label is busy or the page already left)", /Signing out|navigating/.test(label), label);
  const back = await m.waitFor(`location.pathname === "/" && window.__memberStore && window.__memberStore.getState().phase === "anonymous"`, 45000);
  check("5d. the chain lands back on / with an ANONYMOUS session", back, await m.evalJs("location.href + ' · ' + (window.__memberStore ? window.__memberStore.getState().phase : 'no store')"));
  check("5e. the cookie now carries VISITOR tokens", (await m.cookieRole()) === "visitor", await m.cookieRole());
  await sleep(800);
  check("5f. the badge offers Sign in again", await m.evalJs(`document.querySelector("a.mb-in") !== null`));
  await m.shoot("07-desktop-after-sign-out");
  m.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
await finishVerify(failures ? 1 : 0);
