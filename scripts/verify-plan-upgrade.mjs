// UPGRADE flow probe: sign in as the test member, click the nav UPGRADE chip, and confirm
// the redirect session opens the Wix-hosted PLAN checkout for the owner's plan id.
import { readFileSync, writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
import { createClient, OAuthStrategy } from "@wix/sdk";

const APP = "http://localhost:4321";
// Domain cutover 2026-08-19: www.plux.today is the primary (the old wix-site-host URL
// 301s site-wide). FTW_SITE_URL env overrides the origin when needed.
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const _envB2 = readFileSync(".env.local", "utf-8");
const TEST_MEMBER = {
  email: _envB2.match(/^TEST_MEMBER_EMAIL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
  password: _envB2.match(/^TEST_MEMBER_PASSWORD=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
}; // audit B2 (2026-08-13): credential moved out of git — lives in gitignored .env.local
if (!TEST_MEMBER.email || !TEST_MEMBER.password)
  throw new Error("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD missing from .env.local (audit B2)");
const EXPECTED_PLAN = "5874dba8-44ae-49ce-b6f6-d36bc93ce978";
const CDP = "9333";

const env = readFileSync(".env.local", "utf-8");
const clientId = env.match(/^WIX_CLIENT_ID=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");

// 1) what does the client-side resolver pick? (visitor identity, same call the chip makes)
const client = createClient({ auth: OAuthStrategy({ clientId }) });
const { plans } = await import("@wix/pricing-plans");
const pres = await client.use(plans).queryPublicPlans().find();
const picked = pres.items?.find((p) => p.primary === true) ?? pres.items?.[0];
console.log("resolved plan:", picked?._id, "| name:", picked?.name, "| primary:", picked?.primary,
  "| price:", picked?.pricing?.price?.value, picked?.pricing?.price?.currency,
  "| oneTime:", JSON.stringify(picked?.pricing?.singlePaymentUnlimited ?? picked?.pricing?.subscription ?? null));
console.log(picked?._id === EXPECTED_PLAN ? "PASS plan id matches the owner's" : "FAIL plan id mismatch");

// 2) member session cookie (the chip only shows signed-in)
const login = await client.auth.login(TEST_MEMBER);
const REDIRECT = "http://localhost:4321/api/auth/callback";
const oauthData = client.auth.generateOAuthData(REDIRECT, `${APP}/`);
const authorizeUrl =
  `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
  `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
  `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
const loc = (await fetch(authorizeUrl, { redirect: "manual" })).headers.get("location");
const code = new URL(loc).searchParams.get("code");
const state = new URL(loc).searchParams.get("state");
const tokens = await client.auth.getMemberTokens(code, state, oauthData);
const cookieVal = JSON.stringify({ clientId, tokens });
console.log("member session minted:", tokens.refreshToken.role);

// 3) browser: chip visible → click → lands on the hosted plan checkout
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${CDP}${path}`, { method }).then((r) => r.json());
let target;
try { target = await http("/json/new?about:blank", "PUT"); } catch { target = await http("/json/new?about:blank", "GET"); }
// audit #3 C11: register for close — an abandoned target holds a WebGL context.
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const nav = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) nav.push(m.params.frame.url);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Network.setCookie", { name: "wixSession", value: encodeURIComponent(cookieVal), url: APP, path: "/" });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${APP}/` });
await sleep(9000);
const chip = await evalJs(`document.querySelector('.mb-upgrade')?.textContent ?? null`);
console.log(chip === "UPGRADE" ? "PASS UPGRADE chip visible" : `FAIL chip: ${chip}`);
await evalJs(`document.querySelector('.mb-upgrade')?.click(); true`);
await sleep(12000);
const finalUrl = nav.at(-1) ?? (await evalJs(`location.href`).catch(() => "(detached)"));
console.log("final url:", finalUrl.slice(0, 140));
const onCheckout = /wix|checkout|payment|plan/i.test(finalUrl) && !finalUrl.startsWith(APP);
console.log(onCheckout ? "PASS left the app for the Wix-hosted plan checkout" : "FAIL still on the app / no redirect");
const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
writeFileSync("verify-shots/phase69-06-plan-checkout.jpeg", Buffer.from(s.data, "base64"));
console.log("shot: verify-shots/phase69-06-plan-checkout.jpeg");
ws.close();
await finishVerify(0); // audit #3 C11: return the CDP target
