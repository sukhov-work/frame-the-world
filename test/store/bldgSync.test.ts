import { beforeEach, describe, expect, it } from "vitest";
import { useBldgSyncStore } from "../../src/store/bldgSync";

// MESH SUITE MS3 — the world-sync seam: the globe writes the counters, the chip asks ONCE.

describe("bldgSync store", () => {
  beforeEach(() => {
    useBldgSyncStore.setState({
      world: "idle",
      shared: 0,
      complete: false,
      dirty: 0,
      syncing: false,
      result: null,
      syncRequest: false,
    });
  });

  it("boots idle with nothing shared, nothing pending, no ask", () => {
    const s = useBldgSyncStore.getState();
    expect(s.world).toBe("idle");
    expect(s.shared).toBe(0);
    expect(s.dirty).toBe(0);
    expect(s.syncing).toBe(false);
    expect(s.result).toBeNull();
    expect(s.syncRequest).toBe(false);
  });

  it("requestSync is a one-shot the orchestrator consumes explicitly", () => {
    useBldgSyncStore.getState().requestSync();
    expect(useBldgSyncStore.getState().syncRequest).toBe(true);
    useBldgSyncStore.getState()._consumeSyncRequest();
    expect(useBldgSyncStore.getState().syncRequest).toBe(false);
  });

  it("_set patches only the mirror fields it is handed", () => {
    useBldgSyncStore.getState().requestSync();
    useBldgSyncStore.getState()._set({ world: "ready", shared: 12, complete: true, dirty: 3 });
    const s = useBldgSyncStore.getState();
    expect(s.world).toBe("ready");
    expect(s.shared).toBe(12);
    expect(s.complete).toBe(true);
    expect(s.dirty).toBe(3);
    expect(s.syncRequest).toBe(true); // untouched
    useBldgSyncStore.getState()._set({ syncing: false, result: { kind: "synced", upserted: 3, removed: 0, atMs: 5 } });
    expect(useBldgSyncStore.getState().result?.kind).toBe("synced");
  });
});
