// /api/signout — the member sign-out as a JSON round-trip (owner bug report 2026-09-18: SIGN OUT
// landed on a blank page saying "Cross-site POST form submissions are forbidden").
//
// WHY THIS ROUTE EXISTS. @wix/astro's managed `POST /api/auth/logout` is a real-form route, and
// under the Wix cloud adapter Astro's request URL carries the INTERNAL `http:` scheme — `url.origin`
// is `http://www.plux.today` while every browser form POST says `Origin: https://www.plux.today`,
// so `security.checkOrigin` (ruled ON 2026-08-18, audit-2 B1) refuses the form on the live host.
// Machine-checked 2026-09-18 against production: a form POST with `Origin: http://www.plux.today`
// is accepted, `https://…` gets the 403; JSON content-types are exempt from the check. (The same
// scheme mismatch is why the managed login/logout routes patch their callback's protocol from the
// Referer — DECISIONS §Traps / Wix.) Astro has no route-level opt-out and dev never runs the
// check, so the fix is structural: no form POST anywhere; the client fetches THIS route as JSON
// and then navigates TOP-LEVEL to the managed logout URL — the same-origin redirect chain the
// form used to trigger (`/_api/iam/authentication/v1/logout` → `/api/auth/logout-callback`, which
// swaps the member cookie for visitor tokens → `returnTo`) runs in the browser exactly as before.
//
// Thin per C1: this does what the managed route does — mint the logout URL through the contextual
// auth (`@wix/essentials` re-exports it) — and returns it instead of redirecting.
import type { APIRoute } from "astro";
import type { IOAuthStrategy } from "@wix/sdk";
import { auth } from "@wix/essentials";
import { json } from "../../lib/api/http";

/** The managed logout-callback's query name (`@wix/astro` constants — it insists on a RELATIVE
 *  return URL, so anything else falls back to the shell root). */
const RETURN_TO = "returnTo";

/** A relative in-app path (`/m#p=…`), never a protocol-relative or absolute URL. */
export function safeReturnTo(v: unknown): string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

/** The PUBLIC origin the browser sees. A same-origin fetch always sends `Origin`; it is trusted only
 *  when its host is ours (the scheme is exactly what the adapter gets wrong), else the adapter's. */
export function publicOrigin(originHeader: string | null, url: URL): string {
  if (originHeader) {
    try {
      const o = new URL(originHeader);
      if (o.host === url.host) return o.origin;
    } catch {
      /* not a URL — fall through to the adapter's origin */
    }
  }
  return url.origin;
}

export const POST: APIRoute = async ({ request, url }) => {
  const body = (await request.json().catch(() => null)) as { returnTo?: unknown } | null;
  const postFlowUrl = new URL("/api/auth/logout-callback", publicOrigin(request.headers.get("origin"), url));
  postFlowUrl.searchParams.set(RETURN_TO, safeReturnTo(body?.returnTo));
  try {
    const strategy = auth.getContextualAuth<IOAuthStrategy>();
    const { logoutUrl } = await strategy.logout(postFlowUrl.toString());
    return json({ logoutUrl });
  } catch (e) {
    console.error("[signout]", e);
    return json({ error: "SIGNOUT_FAILED", message: "could not start the sign-out" }, 502);
  }
};
