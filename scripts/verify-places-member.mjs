// Scripted-Chrome verification of SAVED PLACES (owner 2026-07-15) — member flow, end to end.
// Mints a member session for the documented Phase-5 test member (mem:patterns/members-pins
// recipe: OAuthStrategy login → session token → prompt=none authorize → member tokens →
// wixSession cookie), then drives: SAVE PLACE in temp FPV → PLACES tab lists it → row click
// jumps into the exact viewpoint → FPV→FPV re-jump → delete cleanup.
// Usage: node scripts/verify-places-member.mjs [cdpPort]   (wix dev on :4321, Chrome CDP on :9333)
import { readFileSync, writeFileSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";

const PORT = process.argv[2] ?? "9333";
const APP = "http://localhost:4321/";
const SITE = "https://frame-the-a173087b-yevhens.wix-site-host.com";
const SHOTS = "verify-shots";
const _envB2 = readFileSync(".env.local", "utf-8");
const TEST_MEMBER = {
  email: _envB2.match(/^TEST_MEMBER_EMAIL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
  password: _envB2.match(/^TEST_MEMBER_PASSWORD=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
}; // audit B2 (2026-08-13): credential moved out of git — lives in gitignored .env.local
if (!TEST_MEMBER.email || !TEST_MEMBER.password)
  throw new Error("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD missing from .env.local (audit B2)");
const TITLE = `Verify place ${Date.now() % 1_000_000}`; // unique per run — Wix Data reads lag writes
const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };

const clientId = readFileSync(".env.local", "utf-8")
  .match(/^WIX_CLIENT_ID=(.+)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!clientId) throw new Error("WIX_CLIENT_ID missing from .env.local");

// ---- mint member tokens (node side) --------------------------------------------------------
const client = createClient({ auth: OAuthStrategy({ clientId }) });
const login = await client.auth.login({ email: TEST_MEMBER.email, password: TEST_MEMBER.password });
if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
const sessionToken = login.data.sessionToken;
// The OAuth app allowlist admits only the auth-route callbacks (not "/") — we never navigate
// there; the code is harvested from the redirect Location header.
const REDIRECT = "http://localhost:4321/api/auth/callback";
const oauthData = client.auth.generateOAuthData(REDIRECT, APP);
const authorizeUrl =
  `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
  `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
  `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${sessionToken}`;
const authRes = await fetch(authorizeUrl, { redirect: "manual" });
const loc = authRes.headers.get("location");
if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
const code = new URL(loc).searchParams.get("code");
const state = new URL(loc).searchParams.get("state");
const tokens = await client.auth.getMemberTokens(code, state, oauthData);
console.log("member tokens minted:", tokens.refreshToken.role);
const cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens }));

// ---- CDP plumbing (verify-s5-night idiom) ---------------------------------------------------
const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
let target;
try { target = await http("/json/new?about:blank", "PUT"); }
catch { target = await http("/json/new?about:blank", "GET"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
  console.log(`  shot: ${SHOTS}/${name}`);
};
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: APP });
await sleep(2500);
await evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800"`);
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: APP });
const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__memberStore && window.__cameraStore)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
  await sleep(250);
}
await sleep(2500);
// resolve the member session (MemberBadge triggers refresh on mount)
const tMember = Date.now();
while ((await evalJs("window.__memberStore.getState().phase")) !== "member" && Date.now() - tMember < 15_000) await sleep(500);
check("member session", (await evalJs("window.__memberStore.getState().phase")) === "member");
// dismiss welcome/explore
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "left", clickCount: 1 });
await sleep(800);

// ---- baseline: places list empty (clean any strays first) ----------------------------------
const strays = await evalJs("fetch('/api/places').then(r=>r.json())");
for (const p of strays.places ?? []) {
  await evalJs(`fetch('/api/places?id=${p.id}', { method: 'DELETE' }).then(r=>r.status)`);
}
check("GET /api/places ok", Array.isArray(strays.places), `pre-existing=${strays.places?.length ?? "ERR"}`);

// ---- enter temp FPV, compose a view, SAVE PLACE via the UI ---------------------------------
await evalJs(`window.__cameraStore.getState().setTempPin({ latDeg: ${DNIPRO.latDeg}, lonDeg: ${DNIPRO.lonDeg} }); window.__cameraStore.getState().setTempFpv(true)`);
await sleep(4000);
check("temp FPV active", await evalJs("window.__globe.fpv().active === true"));
check("SAVE PLACE button present", await evalJs("!!document.querySelector('.ct-saveplace')"));
const hud = await evalJs("window.__cameraStore.getState().fpvHud");
console.log(`  view: heading ${hud.headingDeg.toFixed(1)} pitch ${hud.pitchDeg.toFixed(1)} fov ${hud.fovDeg.toFixed(1)} eye ${hud.eyeAboveGroundM.toFixed(1)}`);
await evalJs("document.querySelector('.ct-saveplace').click()");
await sleep(400);
check("name input opened", await evalJs("!!document.querySelector('.ct-saveplace__input')"));
await shot("prephase6-d1-saveplace-input.jpeg");
await evalJs(`(() => {
  const el = document.querySelector('.ct-saveplace__input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(TITLE)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await evalJs("document.querySelector('.ct-saveplace__ok').click()");
// Flash check FIRST — "✓ PLACE SAVED" reverts after 1.8 s, before the save-poll below ends.
await sleep(1400);
check("saved flash shown", await evalJs("document.querySelector('.ct-saveplace')?.textContent?.includes('SAVED') ?? false"));
let saved = null;
for (let i = 0; i < 12 && !saved; i++) {
  await sleep(1000);
  const afterSave = await evalJs("fetch('/api/places').then(r=>r.json())").catch(() => null);
  saved = afterSave?.places?.find((p) => p.title === TITLE) ?? null;
}
check("place saved", !!saved, saved ? JSON.stringify(saved).slice(0, 140) : "row never appeared");
if (!saved) process.exit(1);
check("saved pose ≈ live hud", Math.abs(saved.headingDeg - hud.headingDeg) < 1 && Math.abs(saved.fovDeg - hud.fovDeg) < 0.5);

// ---- exit FPV, open MY PINS → PLACES, jump from the list ------------------------------------
await evalJs("window.__cameraStore.getState().setTempPin(null)");
await sleep(3500);
await evalJs("document.querySelector('.mp-toggle').click()");
await sleep(600);
await evalJs("[...document.querySelectorAll('.mp-tab')].find(t => t.textContent.includes('PLACES')).click()");
// The tab fetches once per open and Wix Data reads lag writes — bounce the tabs (re-fires the
// fetch effect) until the new row lands.
let rowListed = false;
for (let i = 0; i < 8 && !rowListed; i++) {
  await sleep(1500);
  rowListed = await evalJs(`[...document.querySelectorAll('.mp-item')].some(el => el.textContent.includes(${JSON.stringify(TITLE)}))`);
  if (!rowListed) {
    await evalJs("[...document.querySelectorAll('.mp-tab')].find(t => t.textContent.includes('MY PINS')).click()");
    await sleep(400);
    await evalJs("[...document.querySelectorAll('.mp-tab')].find(t => t.textContent.includes('PLACES')).click()");
  }
}
check("places row listed", rowListed);
await shot("prephase6-d2-places-tab.jpeg");
await evalJs(`[...document.querySelectorAll('.mp-item')].find(el => el.textContent.includes(${JSON.stringify(TITLE)})).click()`);
await sleep(7000); // jump flight + FPV entry
const fpvAfter = await evalJs("window.__globe.fpv()");
check("jump entered FPV", fpvAfter.active === true && fpvAfter.kind === "temp");
const hud2 = await evalJs("window.__cameraStore.getState().fpvHud");
check("heading restored", Math.abs((((hud2.headingDeg - saved.headingDeg) % 360) + 540) % 360 - 180) > 179 || Math.abs(hud2.headingDeg - saved.headingDeg) < 1.5, `got ${hud2.headingDeg.toFixed(1)} want ${saved.headingDeg.toFixed(1)}`);
check("fov restored", Math.abs(hud2.fovDeg - saved.fovDeg) < 0.8, `got ${hud2.fovDeg.toFixed(1)}`);
check("eye restored", Math.abs(hud2.eyeAboveGroundM - saved.eyeM) < 1.5, `got ${hud2.eyeAboveGroundM.toFixed(1)} want ${saved.eyeM.toFixed(1)}`);
await shot("prephase6-d3-jumped-into-place.jpeg");

// ---- FPV→FPV re-jump (forced re-entry path) --------------------------------------------------
await evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${DNIPRO.latDeg + 0.003}, lonDeg: ${DNIPRO.lonDeg}, eyeM: 5, headingDeg: 90, pitchDeg: 1, fovDeg: 40 })`);
await sleep(7000);
const fpv3 = await evalJs("window.__globe.fpv()");
const hud3 = await evalJs("window.__cameraStore.getState().fpvHud");
check("re-jump stayed FPV", fpv3.active === true && fpv3.kind === "temp");
check("re-jump heading 90°", Math.abs(hud3.headingDeg - 90) < 1.5, `got ${hud3.headingDeg.toFixed(1)}`);
check("re-jump fov 40°", Math.abs(hud3.fovDeg - 40) < 0.8, `got ${hud3.fovDeg.toFixed(1)}`);

// ---- cleanup: delete via UI two-press --------------------------------------------------------
await evalJs("window.__cameraStore.getState().setTempPin(null)");
await sleep(3000);
await evalJs("document.querySelector('.mp-toggle').click()");
await sleep(500);
await evalJs("[...document.querySelectorAll('.mp-tab')].find(t => t.textContent.includes('PLACES')).click()");
await sleep(1500);
const delBtn = `[...document.querySelectorAll('.mp-row')].find(r => r.textContent.includes(${JSON.stringify(TITLE)}))?.querySelector('.mp-del')`;
await evalJs(`${delBtn}.click()`); // arm
await sleep(700);
check("delete armed (SURE?)", await evalJs(`${delBtn}?.textContent === 'SURE?'`));
await evalJs(`${delBtn}.click()`); // fire
await sleep(500);
console.log("  del state after fire:", await evalJs(`${delBtn}?.textContent`), "| warn:", await evalJs("document.querySelector('.mp-note--warn')?.textContent ?? 'none'"));
// Wix Data read-after-write lags — poll for THIS row's disappearance, not an empty list.
let deleted = false;
for (let i = 0; i < 12 && !deleted; i++) {
  await sleep(1000);
  const afterDel = await evalJs("fetch('/api/places').then(r=>r.json())").catch(() => null);
  deleted = !!afterDel?.places && !afterDel.places.some((p) => p.id === saved.id);
}
check("place deleted", deleted);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
