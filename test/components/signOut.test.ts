import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { read, stripComments } from "../styles/_css";

/**
 * SIGN OUT on both shells (owner bug report 2026-09-18: the /m menu's SIGN OUT landed on a blank
 * page saying "Cross-site POST form submissions are forbidden").
 *
 * THE CAUSE, machine-checked against production: under the Wix cloud adapter Astro's request URL
 * carries the internal `http:` scheme, so `url.origin` is `http://www.plux.today` while a browser
 * form POST says `Origin: https://www.plux.today` — `security.checkOrigin` (ON since 2026-08-18)
 * refuses EVERY real form POST on the live host, the managed `POST /api/auth/logout` included,
 * while dev (which never runs the check) looked fine. JSON content-types are exempt.
 *
 * THE RULE this file fences: no `<form method="post">` anywhere in the app; sign-out is
 * `store/member.ts signOut()` → `POST /api/signout` (JSON; hands back the managed logout URL) →
 * a TOP-LEVEL navigation that runs the same-origin logout chain the form used to trigger.
 */

const logout = vi.fn();
vi.mock("@wix/essentials", () => ({
  auth: { getContextualAuth: () => ({ logout: (...a: unknown[]) => logout(...a) }), elevate: (f: unknown) => f },
}));
vi.mock("@wix/members", () => ({ members: { getCurrentMember: vi.fn() } }));

const realFetch = globalThis.fetch;
beforeEach(() => {
  logout.mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the fence — no form POSTs, one sign-out path", () => {
  it("no component posts a real form to the managed logout route (or anywhere)", () => {
    for (const f of [
      "src/components/mobile/MobileAccount.tsx",
      "src/components/panels/MemberBadge.tsx",
      "src/components/mobile/MobileShell.tsx",
      "src/pages/index.astro",
      "src/pages/m.astro",
    ]) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/<form[^>]*method=["']?post/i);
      expect(src, f).not.toContain('action="/api/auth/logout"');
    }
  });

  it("both shells' SIGN OUT buttons call the shared signOut() and surface a retry on failure", () => {
    for (const f of ["src/components/mobile/MobileAccount.tsx", "src/components/panels/MemberBadge.tsx"]) {
      const src = stripComments(read(f));
      expect(src, f).toMatch(/import \{[^}]*\bsignOut\b[^}]*\} from "\.\.\/\.\.\/store\/member"/);
      expect(src, f).toMatch(/signOut\(\)\.catch\(\(\) => set\w+\("error"\)\)/);
      expect(src, f).toMatch(/type="button"[\s\S]{0,200}disabled=\{\w+ === "busy"\}/);
    }
  });

  it("the stylesheets no longer carry the dead form wrappers", () => {
    expect(read("src/styles/mobile/mobile.css")).not.toContain(".m-menu__form");
    expect(read("src/styles/member-badge.css")).not.toContain(".mb-form");
  });
});

describe("signOut() — the client half", () => {
  it("POSTs JSON (the content-type the origin check exempts) with the cookie, then navigates to the logout URL", async () => {
    const { signOut } = await import("../../src/store/member");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ logoutUrl: "https://www.plux.today/_api/iam/authentication/v1/logout?x=1" }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const navigate = vi.fn();
    await signOut("/m#p=48.4,35.0,18000000,0,0", navigate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/signout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ returnTo: "/m#p=48.4,35.0,18000000,0,0" });
    expect(navigate).toHaveBeenCalledWith("https://www.plux.today/_api/iam/authentication/v1/logout?x=1");
  });

  it("throws (so the button can offer RETRY) on a non-2xx or a reply without a logout URL — and never navigates", async () => {
    const { signOut } = await import("../../src/store/member");
    const navigate = vi.fn();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "SIGNOUT_FAILED" }) })) as unknown as typeof fetch;
    await expect(signOut("/", navigate)).rejects.toThrow(/502/);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(signOut("/", navigate)).rejects.toThrow();
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } })) as unknown as typeof fetch;
    await expect(signOut("/", navigate)).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("defaults the return to the current view (the login idiom) — SSR-safe", async () => {
    const { signOut } = await import("../../src/store/member");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ logoutUrl: "https://x/l" }) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await signOut(undefined, vi.fn());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ returnTo: "/" }); // no window here → "/"
  });
});

describe("POST /api/signout — the server half", () => {
  const call = async (opts: { origin?: string | null; url?: string; body?: unknown }) => {
    const { POST } = await import("../../src/pages/api/signout");
    const headers = new Headers({ "content-type": "application/json" });
    if (opts.origin) headers.set("origin", opts.origin);
    const url = new URL(opts.url ?? "http://www.plux.today/api/signout"); // the adapter's http: URL
    const request = new Request(url, { method: "POST", headers, body: JSON.stringify(opts.body ?? {}) });
    const res = await (POST as unknown as (ctx: { request: Request; url: URL }) => Promise<Response>)({ request, url });
    return { status: res.status, body: await res.json() };
  };

  it("mints the managed logout URL with a callback on the browser's https origin and the relative returnTo", async () => {
    logout.mockResolvedValue({ logoutUrl: "https://www.plux.today/_api/iam/authentication/v1/logout?o=1" });
    const r = await call({ origin: "https://www.plux.today", body: { returnTo: "/m#p=48.4,35.0,18000000,0,0" } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ logoutUrl: "https://www.plux.today/_api/iam/authentication/v1/logout?o=1" });
    expect(logout).toHaveBeenCalledTimes(1);
    const postFlow = new URL(logout.mock.calls[0][0] as string);
    expect(postFlow.origin).toBe("https://www.plux.today"); // the Origin header's scheme, not the adapter's http:
    expect(postFlow.pathname).toBe("/api/auth/logout-callback"); // the managed callback swaps the cookie
    expect(postFlow.searchParams.get("returnTo")).toBe("/m#p=48.4,35.0,18000000,0,0");
  });

  it("trusts Origin only on our own host, and never an absolute or protocol-relative returnTo", async () => {
    logout.mockResolvedValue({ logoutUrl: "https://l" });
    await call({ origin: "https://evil.example", body: { returnTo: "https://evil.example/" } });
    let postFlow = new URL(logout.mock.calls[0][0] as string);
    expect(postFlow.origin).toBe("http://www.plux.today"); // foreign Origin → the adapter's own origin
    expect(postFlow.searchParams.get("returnTo")).toBe("/");
    await call({ origin: null, body: { returnTo: "//evil.example/" } });
    postFlow = new URL(logout.mock.calls[1][0] as string);
    expect(postFlow.origin).toBe("http://www.plux.today");
    expect(postFlow.searchParams.get("returnTo")).toBe("/");
    await call({ origin: "not a url", body: null });
    postFlow = new URL(logout.mock.calls[2][0] as string);
    expect(postFlow.searchParams.get("returnTo")).toBe("/");
  });

  it("answers 502 (not a redirect, not a 500 page) when the contextual auth cannot mint the URL", async () => {
    logout.mockRejectedValue(new Error("no session"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call({ origin: "https://www.plux.today" });
    err.mockRestore();
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("SIGNOUT_FAILED");
  });

  it("is a JSON route — the origin check exempts it, and it is the ONLY sign-out door", () => {
    const src = stripComments(read("src/pages/api/signout.ts"));
    expect(src).toMatch(/auth\.getContextualAuth<IOAuthStrategy>\(\)/);
    expect(src).toMatch(/new URL\("\/api\/auth\/logout-callback"/);
    expect(src).not.toMatch(/redirect\(/); // it returns the URL; the CLIENT navigates top-level
  });
});
