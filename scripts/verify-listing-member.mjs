// Member-authenticated in-runtime verification of /api/listings (Phase 6 marketplace-light).
// Mints the Phase-5 test member's session (mem:patterns/members-pins recipe), finds one of their
// PUBLIC pins, lists it for sale, confirms the sales view + the checkout catalogReference resolves,
// then unlists (cleanup). Proves the endpoint's elevate() + productsV3.createProduct works under a
// real member session in the app runtime. Usage: wix dev on :4321, then `node scripts/verify-listing-member.mjs`.
import { readFileSync } from "node:fs";
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

const env = readFileSync(".env.local", "utf-8");
const clientId = env.match(/^WIX_CLIENT_ID=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const siteId = JSON.parse(readFileSync("wix.config.json", "utf-8")).siteId;
if (!clientId) throw new Error("WIX_CLIENT_ID missing from .env.local");

// ---- mint member tokens → wixSession cookie ------------------------------------------------
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
const cookie = `wixSession=${encodeURIComponent(JSON.stringify({ clientId, tokens }))}`;
console.log("member session minted:", tokens.refreshToken.role);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const api = async (path, method = "GET", body) => {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// ---- find a public pin owned by the member ---------------------------------------------------
const photos = await api("/api/photos");
check("GET /api/photos ok", photos.status === 200, `${photos.json.photos?.length ?? "ERR"} pins`);
const publicPins = (photos.json.photos ?? []).filter((p) => p.isPublic);
console.log(`  member has ${photos.json.photos?.length ?? 0} pins, ${publicPins.length} public`);
if (publicPins.length === 0) {
  console.log("  NO PUBLIC PIN to list — save a public pin as this member first (upload → SAVE PIN, public).");
  process.exit(2);
}

// Try to list one (the endpoint 409s if it has no stored original — walk until one lists).
let listed = null;
let target = null;
for (const p of publicPins) {
  if (p.productId) {
    // already listed from a prior run — unlist first so this run creates fresh
    await api(`/api/listings?photoId=${p.id}`, "DELETE");
  }
  const r = await api("/api/listings", "POST", { photoId: p.id, priceAmount: PRICE });
  if (r.status === 200) {
    listed = r.json;
    target = p;
    break;
  }
  console.log(`  · ${p.title}: ${r.status} ${r.json.error ?? ""} (${r.json.message ?? ""})`);
}
check("POST /api/listings → 200 with productId", !!listed?.productId, listed ? JSON.stringify(listed) : "no pin could be listed");
if (!listed) process.exit(1);
check("listing carries productVariantId (required for checkout)", !!listed.productVariantId, listed.productVariantId ?? "MISSING");

// ---- sales view lists it ---------------------------------------------------------------------
const sales = await api("/api/listings");
const inSales = (sales.json.listings ?? []).some((l) => l.productId === listed.productId);
check("GET /api/listings shows the new listing", inSales, `${sales.json.listings?.length ?? "ERR"} listings`);

// ---- the checkout catalogReference resolves to a paid line item ------------------------------
const token = readFileSync("/tmp/wix_site_token.txt", "utf-8").trim();
const coRes = await fetch("https://www.wixapis.com/ecom/v1/checkouts", {
  method: "POST",
  headers: { Authorization: token, "wix-site-id": siteId, "Content-Type": "application/json" },
  body: JSON.stringify({
    channelType: "WEB",
    lineItems: [
      {
        quantity: 1,
        catalogReference: {
          appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e",
          catalogItemId: listed.productId,
          options: { variantId: listed.productVariantId },
        },
      },
    ],
  }),
});
const co = await coRes.json().catch(() => ({}));
const li = co.checkout?.lineItems ?? [];
check("checkout resolves the digital line item", li.length === 1 && li[0]?.itemType?.preset === "DIGITAL",
  li[0] ? `price ${li[0].price?.formattedAmount}` : "empty checkout");

// ---- unlist (cleanup) — removes the Stores product -------------------------------------------
const un = await api(`/api/listings?photoId=${target.id}`, "DELETE");
check("DELETE /api/listings → 200", un.status === 200 && un.json.unlisted === true);
const salesAfter = await api("/api/listings");
check("listing gone from sales after unlist",
  !(salesAfter.json.listings ?? []).some((l) => l.productId === listed.productId));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
