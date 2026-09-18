import { create } from "zustand";

/**
 * Member session seam (Phase 5) — who is signed in, for the save-pin flow and the nav badge.
 *
 * Managed-headless auth is owned by @wix/astro: it injects GET /api/auth/login (302 to the
 * Wix-hosted login page), POST /api/auth/logout, and keeps the session in the `wixSession`
 * cookie that every ambient @wix/* SDK call resolves automatically (browser AND server).
 * This store only mirrors that session for the UI: `refresh()` asks the SDK for the current
 * member once; an anonymous visitor rejects → phase "anonymous". Sign-out goes through
 * `signOut()` below — NEVER a form POST to the managed route (owner bug 2026-09-18; the reason
 * is on `pages/api/signout.ts`).
 *
 * The SDK import is lazy (inside refresh) so tests and the globe bundle never pull @wix/members.
 */

type MemberPhase = "unknown" | "loading" | "member" | "anonymous";

export interface MemberInfo {
  id: string;
  nickname: string | null;
  loginEmail: string | null;
}

export interface MemberState {
  phase: MemberPhase;
  member: MemberInfo | null;
  /** Query the current member via the ambient SDK (browser island only). */
  refresh: () => Promise<void>;
  _setMember: (member: MemberInfo) => void;
  _setAnonymous: () => void;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  phase: "unknown",
  member: null,
  refresh: async () => {
    if (get().phase === "loading") return;
    set({ phase: "loading" });
    try {
      const { members } = await import("@wix/members");
      const { member } = await members.getCurrentMember({ fieldsets: ["FULL"] });
      if (member?._id) {
        set({
          phase: "member",
          member: {
            id: member._id,
            nickname: member.profile?.nickname ?? null,
            loginEmail: member.loginEmail ?? null,
          },
        });
      } else {
        set({ phase: "anonymous", member: null });
      }
    } catch {
      // Anonymous visitors reject getCurrentMember (exact error shape varies) — treat any
      // failure as signed-out; the login redirect is always a safe next step.
      set({ phase: "anonymous", member: null });
    }
  },
  _setMember: (member) => set({ phase: "member", member }),
  _setAnonymous: () => set({ phase: "anonymous", member: null }),
}));

/** The managed login route (@wix/astro) — returns to `returnTo` after the hosted login. */
export function loginUrl(returnTo: string): string {
  return `/api/auth/login?returnToUrl=${encodeURIComponent(returnTo)}`;
}

/**
 * Sign the member out (owner bug report 2026-09-18 — both shells' SIGN OUT rows). A JSON
 * `fetch` to our `/api/signout` (JSON content-types pass Astro's CSRF origin check, which the
 * live host fails for every real form POST — see that route) hands back the managed logout URL,
 * and a TOP-LEVEL navigation runs the same-origin redirect chain the old form used to trigger:
 * the Wix IAM logout → `/api/auth/logout-callback` (member cookie → visitor tokens) → `returnTo`,
 * which defaults to this exact view so the pose hash survives the round trip (the login idiom).
 * Throws on a non-2xx / malformed reply so the caller can offer a retry; `navigate` is injectable
 * for the DOM-less tests.
 */
export async function signOut(
  returnTo: string = returnHereUrl(),
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const r = await fetch("/api/signout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnTo }),
  });
  const j = (await r.json().catch(() => null)) as { logoutUrl?: unknown } | null;
  if (!r.ok || typeof j?.logoutUrl !== "string") throw new Error(`sign-out HTTP ${r.status}`);
  navigate(j.logoutUrl);
}

/**
 * The current in-app location incl. the `#p=`/`#f=` pose hash the orchestrator mirrors at low
 * cadence — so a login/checkout round-trip lands back on the exact view (the viewed pin) instead
 * of the home reset. SSR-safe fallback for the island's first render pass.
 */
export function returnHereUrl(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Short label for the nav badge: nickname → email user part → generic. */
export function memberLabel(member: MemberInfo | null): string {
  if (!member) return "Member";
  if (member.nickname) return member.nickname;
  if (member.loginEmail) return member.loginEmail.split("@")[0];
  return "Member";
}

// DEV convenience (mirrors store/upload.ts): poke the member store from the console. The TYPE
// lives in the central registry `src/global.d.ts` like every other seam — it was declared
// locally here, which is why `contracts.md §3` under-counted (audit #3 D7 / A2-5's class).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  window.__memberStore = useMemberStore;
}
