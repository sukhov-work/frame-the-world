import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginUrl, memberLabel, useMemberStore } from "../../src/store/member";

// refresh() lazy-imports @wix/members; the mock lets each test script the SDK response.
const getCurrentMember = vi.fn();
vi.mock("@wix/members", () => ({
  members: { getCurrentMember: (...args: unknown[]) => getCurrentMember(...args) },
}));

beforeEach(() => {
  getCurrentMember.mockReset();
  useMemberStore.setState({ phase: "unknown", member: null });
});

describe("loginUrl", () => {
  it("points at the managed auth route and encodes the return path", () => {
    expect(loginUrl("/")).toBe("/api/auth/login?returnToUrl=%2F");
    expect(loginUrl("/a b?x=1")).toBe("/api/auth/login?returnToUrl=%2Fa%20b%3Fx%3D1");
  });
});

describe("memberLabel", () => {
  it("prefers nickname, then the email user part, then a generic label", () => {
    expect(memberLabel({ id: "1", nickname: "Yev", loginEmail: "a@b.c" })).toBe("Yev");
    expect(memberLabel({ id: "1", nickname: null, loginEmail: "yev@wix.com" })).toBe("yev");
    expect(memberLabel({ id: "1", nickname: null, loginEmail: null })).toBe("Member");
    expect(memberLabel(null)).toBe("Member");
  });
});

describe("refresh", () => {
  it("lands on phase 'member' with id/nickname/email when the SDK returns a member", async () => {
    getCurrentMember.mockResolvedValue({
      member: {
        _id: "m-123",
        loginEmail: "yev@wix.com",
        profile: { nickname: "Yev" },
      },
    });
    await useMemberStore.getState().refresh();
    const s = useMemberStore.getState();
    expect(s.phase).toBe("member");
    expect(s.member).toEqual({ id: "m-123", nickname: "Yev", loginEmail: "yev@wix.com" });
    expect(getCurrentMember).toHaveBeenCalledWith({ fieldsets: ["FULL"] });
  });

  it("lands on 'anonymous' when the SDK rejects (visitor identity)", async () => {
    getCurrentMember.mockRejectedValue(new Error("403"));
    await useMemberStore.getState().refresh();
    expect(useMemberStore.getState().phase).toBe("anonymous");
    expect(useMemberStore.getState().member).toBeNull();
  });

  it("lands on 'anonymous' when the response carries no member id", async () => {
    getCurrentMember.mockResolvedValue({ member: undefined });
    await useMemberStore.getState().refresh();
    expect(useMemberStore.getState().phase).toBe("anonymous");
  });

  it("is re-entrant: a refresh in flight is not restarted", async () => {
    let release: (v: { member: { _id: string } }) => void = () => {};
    getCurrentMember.mockReturnValue(new Promise((r) => (release = r)));
    const first = useMemberStore.getState().refresh();
    const second = useMemberStore.getState().refresh(); // no-op while loading
    release({ member: { _id: "m-1" } });
    await Promise.all([first, second]);
    expect(getCurrentMember).toHaveBeenCalledTimes(1);
    expect(useMemberStore.getState().phase).toBe("member");
  });
});
