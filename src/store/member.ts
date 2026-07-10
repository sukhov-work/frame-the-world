import { create } from "zustand";

/**
 * Member session seam (Phase 5) — who is signed in, for the save-pin flow and the nav badge.
 *
 * Managed-headless auth is owned by @wix/astro: it injects GET /api/auth/login (302 to the
 * Wix-hosted login page), POST /api/auth/logout, and keeps the session in the `wixSession`
 * cookie that every ambient @wix/* SDK call resolves automatically (browser AND server).
 * This store only mirrors that session for the UI: `refresh()` asks the SDK for the current
 * member once; an anonymous visitor rejects → phase "anonymous".
 *
 * The SDK import is lazy (inside refresh) so tests and the globe bundle never pull @wix/members.
 */

export type MemberPhase = "unknown" | "loading" | "member" | "anonymous";

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

/** Short label for the nav badge: nickname → email user part → generic. */
export function memberLabel(member: MemberInfo | null): string {
  if (!member) return "Member";
  if (member.nickname) return member.nickname;
  if (member.loginEmail) return member.loginEmail.split("@")[0];
  return "Member";
}

// DEV convenience (mirrors store/upload.ts): poke the member store from the console.
declare global {
  interface Window {
    __memberStore?: typeof useMemberStore;
  }
}
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  window.__memberStore = useMemberStore;
}
