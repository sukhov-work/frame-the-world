// store/sky UNFOLLOW contract (owner 2026-08-19, UX batch items 7/8) — stopFollowing is the
// one-verb dismissal: SHOW off + camera lock off, while `target` itself stays set (the
// non-nullable contract — 10P/Tempel 2 is the standing default guest).
import { beforeEach, describe, expect, it } from "vitest";
import { useSkyStore } from "../../src/store/sky";

describe("store/sky stopFollowing", () => {
  beforeEach(() => {
    useSkyStore.setState({ visible: true, track: true });
  });

  it("drops SHOW and the camera lock in one call", () => {
    useSkyStore.getState().stopFollowing();
    const s = useSkyStore.getState();
    expect(s.visible).toBe(false);
    expect(s.track).toBe(false);
  });

  it("keeps the target set (non-nullable contract) so re-follow paths still have it", () => {
    const before = useSkyStore.getState().target;
    useSkyStore.getState().stopFollowing();
    expect(useSkyStore.getState().target).toBe(before);
  });

  it("setVisible(true) re-follows without touching the (session-only) camera lock", () => {
    useSkyStore.getState().stopFollowing();
    useSkyStore.getState().setVisible(true);
    const s = useSkyStore.getState();
    expect(s.visible).toBe(true);
    expect(s.track).toBe(false);
  });
});
