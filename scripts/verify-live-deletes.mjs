// LIVE proof of the 2026-09-19 DELETE fix (owner bug: "couldn't delete some user model").
//
// The defect only exists on the LIVE host: the cloud adapter hands Astro an `http:` request URL, so
// `security.checkOrigin` never sees a matching Origin and passes a non-safe method only when it
// carries a NON-form content type. A body-less `fetch(url, { method: "DELETE" })` has none → 403
// before the route. `wix dev` never runs the check, so THIS script (after a release) is the only
// place the fix can be seen working — through the deployed client, not through curl:
//
//   1. the wire, from Node with the test member's session cookie:
//        bare DELETE                       → 403 "Cross-site DELETE…"   (the middleware — unchanged by design)
//        DELETE + Content-Type: json       → the ROUTE answers (404 "no such … of yours") for
//                                            /api/models, /api/photos, /api/listings, /api/places
//   2. the DEPLOYED UI: a throw-away saved place is created as the test member, then deleted with
//      the real MY PINS · PLACES ✕ → SURE? button in a browser; the DELETE the page sends must
//      answer 200, carry `content-type: application/json`, and the place must be gone from the API.
//
//   FTW_APP_URL=https://www.plux.today node scripts/verify-live-deletes.mjs [9333]
//   (default target = the live site; pass FTW_APP_URL=http://localhost:4321 for the dev twin, where
//    leg 1's bare DELETE reads 404/401 instead of 403 — dev has no origin check)
//
// It leaves nothing behind: the probe place is removed by the UI leg, or by the finally block.
import { readFileSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 9333);
const APP = (process.env.FTW_APP_URL || "https://www.plux.today").replace(/\/$/, "");
const LIVE = APP.startsWith("https://");
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
console.log(`target ${APP} (${LIVE ? "LIVE" : "dev"})`);

// ---- the member session (the verify-places-member recipe) --------------------------------------
async function mintCookie() {
  const env = readFileSync(".env.local", "utf-8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const clientId = get("WIX_CLIENT_ID");
  const email = get("TEST_MEMBER_EMAIL");
  const password = get("TEST_MEMBER_PASSWORD");
  if (!clientId || !email || !password) throw new Error("WIX_CLIENT_ID / TEST_MEMBER_* missing from .env.local");
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
}
const cookieVal = await mintCookie();
const api = (path, init = {}) =>
  fetch(APP + path, { ...init, headers: { Origin: APP, Cookie: `wixSession=${cookieVal}`, ...(init.headers ?? {}) } });

// ---- 1. the wire ---------------------------------------------------------------------------------
const ROUTES = ["/api/models?id=plux-probe-nonexistent", "/api/photos?id=plux-probe-nonexistent", "/api/listings?photoId=plux-probe-nonexistent", "/api/places?id=plux-probe-nonexistent"];
for (const path of ROUTES) {
  const bare = await api(path, { method: "DELETE" });
  const bareText = (await bare.text()).slice(0, 60);
  if (LIVE) check(`bare DELETE ${path.split("?")[0]} is refused by the origin check (the CAUSE, unchanged by design)`, bare.status === 403 && /Cross-site/.test(bareText), `${bare.status} "${bareText}"`);
  const json = await api(path, { method: "DELETE", headers: { "Content-Type": "application/json" } });
  const body = (await json.text()).slice(0, 90);
  check(`DELETE + Content-Type: application/json reaches the ROUTE ${path.split("?")[0]}`, json.status !== 403 && !/Cross-site/.test(body), `${json.status} ${body}`);
}

// ---- 2. the deployed UI ---------------------------------------------------------------------------
const TITLE = `PLUX release probe ${Date.now()}`;
let placeId = null;
try {
  const made = await api("/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: TITLE, latDeg: 48.4647, lonDeg: 35.0462, eyeM: 1.7, headingDeg: 25, pitchDeg: 0, fovDeg: 55 }),
  });
  const madeJson = await made.json().catch(() => ({}));
  placeId = madeJson.placeId ?? null; // POST /api/places answers { placeId }
  check("the probe place is saved as the test member", made.ok && typeof placeId === "string", `${made.status} id ${placeId}`);
  const listed = async () => {
    const r = await api("/api/places");
    const j = await r.json().catch(() => ({}));
    return (j.places ?? []).some((p) => p.id === placeId);
  };
  // the list read can lag the write (Wix Data) — poll briefly
  let seen = false;
  for (let i = 0; i < 10 && !seen; i++) {
    seen = await listed();
    if (!seen) await sleep(1000);
  }
  check("…and the own list carries it", seen);

  await ensureBrowser(PORT);
  let target;
  try {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  trackTarget(PORT, target.id);
  const s = await openSession(target);
  await s.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.send("Network.enable");
  await s.send("Network.setCookie", { name: "wixSession", value: cookieVal, url: APP + "/", path: "/", ...(LIVE ? { secure: true, sameSite: "None" } : {}) });
  // `?d=` keeps the desktop shell whatever the pointer says
  await s.bootUrl(`${APP}/?d=1#p=48.4647,35.0462,700,25,40`);
  await s.waitFor(`!!document.querySelector(".mp-toggle")`, 90_000, "MY PINS toggle (a member session)");
  // Record what the PAGE sends: the DELETE's own request headers + the answer.
  await s.evalJs(`(() => { window.__delLog = []; const of = window.fetch; window.fetch = async (u, init) => { const isDel = init && String(init.method).toUpperCase() === "DELETE"; const res = await of(u, init); if (isDel) window.__delLog.push({ url: String(u), ct: new Headers(init.headers || {}).get("content-type"), hasBody: init.body !== undefined, status: res.status }); return res; }; return true; })()`);
  await s.evalJs(`document.querySelector(".mp-toggle").click(), true`);
  await s.waitFor(`!!document.querySelector(".mp-panel")`, 15_000, "the panel");
  await s.evalJs(`[...document.querySelectorAll(".mp-tab")].find((b) => /^PLACES/.test(b.textContent.trim())).click(), true`);
  const rowSel = `[...document.querySelectorAll(".mp-row")].find((r) => r.textContent.includes(${JSON.stringify(TITLE)}))`;
  await s.waitFor(`!!(${rowSel})`, 30_000, "the probe row in PLACES");
  check("MY PINS · PLACES lists the probe place in the deployed UI", true);
  await s.evalJs(`(${rowSel}).querySelector(".mp-del").click(), true`);
  await sleep(300);
  const armed = await s.evalJs(`(${rowSel})?.querySelector(".mp-del")?.textContent.trim()`);
  check("first press arms the delete", armed === "SURE?", `"${armed}"`);
  await s.evalJs(`(${rowSel}).querySelector(".mp-del").click(), true`);
  await s.waitFor(`window.__delLog.length > 0`, 30_000, "the page's DELETE");
  const log = JSON.parse(await s.evalJs(`JSON.stringify(window.__delLog)`));
  const d = log[0];
  check("the DEPLOYED client sends the JSON content type on its body-less DELETE", d.ct === "application/json" && d.hasBody === false, JSON.stringify(d));
  check("…and the live host answers 200 (it was 403 before this release)", d.status === 200, `HTTP ${d.status}`);
  await s.waitFor(`!(${rowSel})`, 15_000, "the row leaves the list");
  const note = await s.evalJs(`document.querySelector(".mp-note--warn")?.textContent || ""`);
  check("the row left the list, no error note", note === "", note);
  let gone = false;
  for (let i = 0; i < 10 && !gone; i++) {
    gone = !(await listed());
    if (!gone) await sleep(1000);
  }
  check("the API no longer lists the place", gone);
  if (gone) placeId = null;
  s.close();
} finally {
  // Belt and braces: any probe place this member still owns (an earlier run that lost its id) goes too.
  const left = ((await (await api("/api/places")).json().catch(() => ({}))).places ?? []).filter((p) => /^PLUX release probe \d+$/.test(p.title));
  for (const p of left) {
    if (p.id === placeId) continue;
    const r = await api(`/api/places?id=${encodeURIComponent(p.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
    console.log(`cleanup: removed a leftover probe place ${p.id} (${r.status})`);
  }
  if (placeId) {
    const r = await api(`/api/places?id=${encodeURIComponent(placeId)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
    console.log(`cleanup: removed the probe place through the wire (${r.status})`);
  }
}
console.log(failures ? `\nverify-live-deletes: ${failures} FAILURE(S)` : "\nverify-live-deletes: ALL PASS");
await finishVerify(failures ? 1 : 0);
