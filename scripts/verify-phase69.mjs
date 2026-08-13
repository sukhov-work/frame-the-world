// Phase 6.9 verification — marketplace + access batch (2026-07-17).
// Part A (member API): quota limit now 100 · listing stamps currency EUR · GET /api/listings row
//   shape (+soldCount) · PUBLIC GET /api/market carries the listed pin (reduced coords only) ·
//   queryPublicPlans reachability (the UPGRADE flow's plan source).
// Part B (scripted Chrome CDP, no deps): MARKETPLACE nav button + panel row (€ price) · row click
//   opens the buyer detail panel · SIGN IN TO BUY returnTo carries the current path (not "/") ·
//   PinHoverCard price chip (dev-seam _syncHover) · ?purchased=1 toast · member: SALES tab +
//   UPGRADE chip in the nav badge.
// Leaves the pin LISTED unless --cleanup is passed (the demo-seed session wants a populated market).
// Usage: wix dev on :4321, Chrome headless on CDP :9333, then `node scripts/verify-phase69.mjs [--cleanup]`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";

const APP = "http://localhost:4321";
const SITE = "https://frame-the-a173087b-yevhens.wix-site-host.com";
const _envB2 = readFileSync(".env.local", "utf-8");
const TEST_MEMBER = {
  email: _envB2.match(/^TEST_MEMBER_EMAIL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
  password: _envB2.match(/^TEST_MEMBER_PASSWORD=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
}; // audit B2 (2026-08-13): credential moved out of git — lives in gitignored .env.local
if (!TEST_MEMBER.email || !TEST_MEMBER.password)
  throw new Error("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD missing from .env.local (audit B2)");
const PRICE = 7.5;
const CDP = process.argv.includes("--no-browser") ? null : "9333";
const CLEANUP = process.argv.includes("--cleanup");
const SHOTS = "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const env = readFileSync(".env.local", "utf-8");
const clientId = env.match(/^WIX_CLIENT_ID=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!clientId) throw new Error("WIX_CLIENT_ID missing from .env.local");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---- mint member tokens → wixSession cookie (mem:patterns/members-pins recipe) ---------------
const client = createClient({ auth: OAuthStrategy({ clientId }) });
const login = await client.auth.login(TEST_MEMBER);
if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
const REDIRECT = "http://localhost:4321/api/auth/callback";
const oauthData = client.auth.generateOAuthData(REDIRECT, `${APP}/`);
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
const cookieVal = JSON.stringify({ clientId, tokens });
const cookie = `wixSession=${encodeURIComponent(cookieVal)}`;
console.log("member session minted:", tokens.refreshToken.role);

const api = async (path, method = "GET", body, withCookie = true) => {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      ...(withCookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

console.log("\n== A · API tier ==");

// A1 — quota limit is 100 now
const photos = await api("/api/photos");
check("GET /api/photos ok", photos.status === 200, `${photos.json.photos?.length ?? "ERR"} pins`);
check("quota.limit is 100 (owner re-ruling)", photos.json.quota?.limit === 100,
  `limit=${photos.json.quota?.limit}`);

// A2 — list a public pin; the response must stamp EUR
const publicPins = (photos.json.photos ?? []).filter((p) => p.isPublic);
if (publicPins.length === 0) {
  console.log("  NO PUBLIC PIN to list — save one as this member first.");
  process.exit(2);
}
let listed = null;
let target = null;
for (const p of publicPins) {
  if (p.productId) await api(`/api/listings?photoId=${p.id}`, "DELETE");
  const r = await api("/api/listings", "POST", { photoId: p.id, priceAmount: PRICE });
  if (r.status === 200) {
    listed = r.json;
    target = p;
    break;
  }
  console.log(`  · ${p.title}: ${r.status} ${r.json.error ?? ""}`);
}
check("POST /api/listings → 200", !!listed?.productId, JSON.stringify(listed ?? {}));
if (!listed) process.exit(1);
check("listing stamps currency EUR (was null)", listed.currency === "EUR", `currency=${listed.currency}`);

// A3 — owner sales row shape
const sales = await api("/api/listings");
const row = (sales.json.listings ?? []).find((l) => l.productId === listed.productId);
check("GET /api/listings row present", !!row);
check("row: currency EUR + numeric soldCount", row?.currency === "EUR" && typeof row?.soldCount === "number",
  row ? `currency=${row.currency} soldCount=${row.soldCount}` : "");

// A4 — PUBLIC market endpoint (no cookie)
const market = await api("/api/market", "GET", undefined, false);
const mrow = (market.json.pins ?? []).find((p) => p.productId === listed.productId);
check("GET /api/market (signed-out) → 200", market.status === 200, `${market.json.pins?.length ?? "ERR"} pins`);
check("market row: variantId + price + EUR", !!mrow?.productVariantId && mrow?.priceAmount === PRICE && mrow?.currency === "EUR",
  mrow ? JSON.stringify({ v: mrow.productVariantId, p: mrow.priceAmount, c: mrow.currency }) : "row missing");
check("market row is C6-reduced (no exact-GPS fields)", mrow && !("latReduced" in mrow) && mrow.lat !== undefined && !("gpsLat" in mrow),
  mrow ? `lat=${mrow.lat} lon=${mrow.lon} precision=${mrow.precision}` : "");

// A5 — the UPGRADE flow's plan source: is a public plan configured?
let planCount = null;
try {
  const res = await client.use((await import("@wix/pricing-plans")).plans).queryPublicPlans().find();
  planCount = res.items?.length ?? 0;
} catch (e) {
  console.log("  · queryPublicPlans threw:", e?.message ?? e);
}
check("site has ≥1 public pricing plan (UPGRADE target)", (planCount ?? 0) >= 1,
  planCount === null ? "call failed — check manually" : `${planCount} public plan(s)`);

// ---- B · browser tier -------------------------------------------------------------------------
if (CDP) {
  console.log("\n== B · browser tier (CDP :" + CDP + ") ==");
  const http = (path, method = "GET") =>
    fetch(`http://127.0.0.1:${CDP}${path}`, { method }).then((r) => r.json());
  let targetPage;
  try {
    targetPage = await http("/json/new?about:blank", "PUT");
  } catch {
    targetPage = await http("/json/new?about:blank", "GET");
  }
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const navRequests = []; // Network.requestWillBeSent URLs (the click-time returnTo check)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === "Network.requestWillBeSent") {
      navRequests.push(msg.params.request?.url ?? "");
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
    console.log(`  shot: ${SHOTS}/${name}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  // The Chrome profile persists cookies across runs — B1–B4 must be genuinely signed out.
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // B1 — signed-out: marketplace button + panel + row
  await send("Page.navigate", { url: `${APP}/` });
  await sleep(9000); // globe boot
  // Dismiss the welcome with a REAL canvas click (the natural gesture) — force-removing the
  // overlay DOM would leave body.welcome-active on, which suppresses the #p= hash mirror.
  await evalJs(`document.querySelector('.bp')?.remove(); true`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 720, y: 520, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 720, y: 520, button: "left", clickCount: 1 });
  await sleep(1500);
  const welcomeGone = await evalJs(`!document.body.classList.contains('welcome-active')`);
  check("welcome dismissed via real click (hash mirror unblocked)", welcomeGone);
  const hasBtn = await evalJs(`!!document.querySelector('.mk-toggle')`);
  check("MARKETPLACE nav button renders", hasBtn);
  await evalJs(`document.querySelector('.mk-toggle')?.click()`);
  await sleep(2500);
  const rowInfo = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.mk-item')];
    const prices = [...document.querySelectorAll('.mk-price')].map((n) => n.textContent);
    return { rows: rows.length, prices };
  })()`);
  check("marketplace panel lists the for-sale pin", rowInfo.rows >= 1, JSON.stringify(rowInfo));
  check("panel price renders €7.50", (rowInfo.prices ?? []).some((p) => p.includes("€7.50")), rowInfo.prices?.join(","));
  await shot("phase69-01-marketplace-panel.jpeg");

  // B2 — row click opens the buyer detail panel with SIGN IN TO BUY (signed-out)
  await evalJs(`document.querySelector('.mk-item')?.click()`);
  await sleep(7000); // fly + panel + first #p= hash mirror (~1.6 s cadence)
  const buySeam = await evalJs(`(() => {
    const badge = [...document.querySelectorAll('.pd-market__badge')].map((n) => n.textContent).join('|');
    return { badge, hash: location.hash, here: location.pathname + location.search + location.hash };
  })()`);
  check("detail panel FOR SALE badge shows €7.50", buySeam.badge.includes("€7.50"), buySeam.badge);
  check("pose hash is live-mirrored before the click", buySeam.hash.startsWith("#p="), buySeam.hash.slice(0, 24));
  await shot("phase69-02-buyer-detail.jpeg");

  // B3 — hover price chip on a REAL pointer hover (the orchestrator clears synthetic
  // _syncHover within one frame, so sweep the pointer until the LISTED pin is picked;
  // hitting an unlisted pin first also proves the chip stays hidden for those).
  const hoverTarget = await evalJs(`(() => {
    const p = (window.__pinsStore.getState().pins ?? []).find((x) => x.productId);
    return p ? { lat: p.lat, lon: p.lon } : null;
  })()`);
  let chipHit = null;
  if (hoverTarget) {
    // Clear the placed view first — the frustum/plane occludes the pin heads for picking.
    await evalJs(`window.__uploadStore.getState().clear(); true`);
    for (const altM of [4000, 2000]) {
      await evalJs(`window.__cameraStore.getState().requestFly({ latDeg: ${hoverTarget.lat}, lonDeg: ${hoverTarget.lon}, altM: ${altM} }); true`);
      await sleep(9000);
      outer:
      for (let y = 200; y <= 700; y += 18) {
        for (let x = 380; x <= 1060; x += 18) {
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
          await sleep(30);
          chipHit = await evalJs(`(() => {
            const s = window.__pinsStore.getState();
            if (!s.hoverPin || !s.hoverPin.productId) return null;
            return { chip: document.querySelector('.pinhover__price')?.textContent ?? null, title: s.hoverPin.title };
          })()`);
          if (chipHit) break outer;
        }
      }
      if (chipHit) break;
    }
  }
  check("PinHoverCard price chip on the listed pin", !!chipHit?.chip && chipHit.chip.includes("€7.50"),
    chipHit ? `${chipHit.chip} on '${chipHit.title}'` : "listed pin never hovered");
  await shot("phase69-03-hover-chip.jpeg");

  // B3.5 — SIGN IN TO BUY: click-time returnTo carries the CURRENT url (path + #p= hash).
  // Reopen the listed pin's detail panel (the fly moved the camera off it), then click.
  await send("Network.enable");
  await evalJs(`(() => {
    const p = (window.__pinsStore.getState().pins ?? []).find((x) => x.productId);
    window.__uploadStore.getState().openSavedPin({ ...p, pinId: p.id });
    return true;
  })()`);
  await sleep(7000);
  const hereBefore = await evalJs(`location.pathname + location.search + location.hash`);
  navRequests.length = 0;
  await evalJs(`[...document.querySelectorAll('.pd-market a')].at(-1)?.click(); true`);
  await sleep(2500);
  const loginReq = navRequests.find((u) => u.includes("/api/auth/login"));
  const wantedReturn = `returnToUrl=${encodeURIComponent(hereBefore)}`;
  check("SIGN IN TO BUY navigates with click-time returnTo (#p= carried)",
    !!loginReq && loginReq.includes(wantedReturn) && hereBefore.includes("#p="),
    loginReq ? loginReq.slice(loginReq.indexOf("returnToUrl")) : "no /api/auth/login request seen");

  // B4 — purchased toast
  await send("Page.navigate", { url: `${APP}/?purchased=1` });
  await sleep(5000);
  const toast = await evalJs(`document.querySelector('.mk-toast')?.textContent ?? null`);
  check("?purchased=1 shows the acknowledgment toast", !!toast && toast.includes("ORDER PLACED"), toast ?? "no toast");
  const cleanedUrl = await evalJs(`location.search`);
  check("purchased param stripped after toast", !cleanedUrl.includes("purchased"), `search='${cleanedUrl}'`);
  await shot("phase69-04-purchased-toast.jpeg");

  // B5 — member tier: set the session cookie → SALES tab + UPGRADE chip
  await send("Network.enable");
  await send("Network.setCookie", {
    name: "wixSession", value: encodeURIComponent(cookieVal), url: APP, path: "/",
  });
  await send("Page.navigate", { url: `${APP}/` });
  await sleep(9000);
  await evalJs(`document.querySelector('.bp')?.remove(); true`);
  const memberUi = await evalJs(`(() => ({
    badge: document.querySelector('.mb-name')?.textContent ?? null,
    upgrade: document.querySelector('.mb-upgrade')?.textContent ?? null,
  }))()`);
  check("member session active in browser", !!memberUi.badge, memberUi.badge ?? "");
  check("UPGRADE chip shows for the free member", memberUi.upgrade === "UPGRADE", memberUi.upgrade ?? "not rendered");
  await evalJs(`document.querySelector('.mp-toggle')?.click()`);
  await sleep(800);
  await evalJs(`[...document.querySelectorAll('.mp-tab')].find((t) => t.textContent.startsWith('SALES'))?.click()`);
  await sleep(2500);
  const salesUi = await evalJs(`(() => ({
    rows: document.querySelectorAll('.mp-item--static').length,
    text: [...document.querySelectorAll('.mp-item--static')].map((n) => n.textContent).join('|'),
  }))()`);
  check("MY PINS · SALES tab lists the listing", salesUi.rows >= 1 && salesUi.text.includes("€7.50"), salesUi.text);
  await shot("phase69-05-sales-tab.jpeg");
  ws.close();
}

// ---- cleanup ---------------------------------------------------------------------------------
if (CLEANUP && target) {
  const un = await api(`/api/listings?photoId=${target.id}`, "DELETE");
  check("cleanup: DELETE /api/listings → 200", un.status === 200);
} else {
  console.log(`\n(listing left ACTIVE: '${target?.title}' @ €${PRICE} — pass --cleanup to remove)`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
