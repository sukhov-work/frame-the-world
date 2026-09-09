import { describe, expect, it } from "vitest";
import { LRUCache } from "3d-tiles-renderer/core";
import {
  createDetachedReleaseState,
  drainLruCache,
  stepDetachedRelease,
  type DetachedReleasePolicy,
  type DrainableLruCache,
} from "../../../src/lib/globe/detachedRelease";

/**
 * T123 lever (a) — the drain is pinned against the REAL library cache (3d-tiles-renderer 0.4.28),
 * with the lean-tier band the phone runs (`QUALITY.leanMobile.enrichedLruBytesMB` 128 → the
 * U2/A9 floor), so a library upgrade that changes `unloadUnusedContent`'s loop shape fails here
 * before it fails on the farm.
 */
const MB = 1048576;
/** The library's `.d.ts` hides its runtime sets (`itemSet`, `usedSet`) — name what the test reads. */
type OpenLru = LRUCache & DrainableLruCache & { usedSet: Set<unknown>; unloadingHandle: number };
const leanCache = (): OpenLru => {
  const c = new LRUCache() as unknown as OpenLru;
  c.maxBytesSize = 128 * MB;
  c.minBytesSize = 96 * MB;
  return c;
};

/** `n` loaded tiles of `bytes` each plus `inflight` zero-byte ones still downloading. */
const fill = (c: LRUCache, n: number, bytes: number, inflight = 0) => {
  const disposed: string[] = [];
  for (let i = 0; i < n + inflight; i++) {
    const tile = { id: `t${i}` };
    c.add(tile, (t: { id: string }) => disposed.push(t.id));
    if (i < n) {
      c.setLoaded(tile, true);
      c.setMemoryUsage(tile, bytes);
    }
  }
  return disposed;
};

describe("T123 lever (a) — drainLruCache against the library's LRUCache", () => {
  it("evicts EVERY item — loaded, in flight, used this frame — in one synchronous call", () => {
    const c = leanCache();
    const disposed = fill(c, 56, 1 * MB, 3); // 56 MB resident under the 128 cap + 3 in flight
    // the last traversal marked them all used — a detached renderer never unmarks them
    expect(c.usedSet.size).toBe(59);
    const r = drainLruCache(c);
    expect(r).toEqual({ items: 59, bytes: 56 * MB, left: 0 });
    expect(disposed).toHaveLength(59);
    expect(c.itemSet.size).toBe(0);
    expect(c.cachedBytes).toBe(0);
    expect(c.usedSet.size).toBe(0);
  });

  it("restores the four caps VERBATIM (the running tier's band is untouched)", () => {
    const c = leanCache();
    c.minSize = 6000;
    c.maxSize = 8000;
    fill(c, 10, 2 * MB);
    drainLruCache(c);
    expect(c.minSize).toBe(6000);
    expect(c.maxSize).toBe(8000);
    expect(c.minBytesSize).toBe(96 * MB);
    expect(c.maxBytesSize).toBe(128 * MB);
  });

  it("restores the caps even when an unload callback throws", () => {
    const c = leanCache();
    c.add({ id: "boom" }, () => {
      throw new Error("dispose failed");
    });
    expect(() => drainLruCache(c)).toThrow("dispose failed");
    expect(c.minBytesSize).toBe(96 * MB);
    expect(c.maxBytesSize).toBe(128 * MB);
  });

  it("is a no-op on an empty cache — reports zeros and touches nothing", () => {
    const c = leanCache();
    let marked = 0;
    const spy = c as unknown as { markAllUnused: () => void };
    const orig = spy.markAllUnused.bind(c);
    spy.markAllUnused = () => {
      marked++;
      orig();
    };
    expect(drainLruCache(c)).toEqual({ items: 0, bytes: 0, left: 0 });
    expect(marked).toBe(0);
  });

  it("does not leave the library a rerun to schedule (a whole-cache drain needs no second pass)", () => {
    const c = leanCache();
    fill(c, 40, 3 * MB);
    drainLruCache(c);
    // `unloadingHandle` leaves its idle -1 only when `needsRerun` was true after the eviction loop
    expect(c.unloadingHandle).toBe(-1);
  });

  it("the plain library path would NOT have evicted them: the cache sat under its cap", () => {
    // the mechanism the lever exists for — same fill, the library's own unload at the tier's caps
    const c = leanCache();
    fill(c, 56, 1 * MB);
    c.markAllUnused();
    c.unloadUnusedContent();
    expect(c.itemSet.size).toBe(56); // 56 MB < the 96 MB floor: nothing moves
  });
});

describe("T123 lever (a) — stepDetachedRelease, the once-per-detach decision", () => {
  const policy: DetachedReleasePolicy = { enabled: true, graceMs: 2500, maxPerPeriod: 3 };

  it("never fires while attached, and an attach resets the period", () => {
    const st = createDetachedReleaseState();
    expect(stepDetachedRelease(st, true, 1000, 99, policy)).toBe(false);
    expect(st.detachedAtMs).toBeNull();
    // detach → grace → fire; re-attach → the next detach starts a fresh grace
    expect(stepDetachedRelease(st, false, 2000, 99, policy)).toBe(false);
    expect(stepDetachedRelease(st, false, 4500, 99, policy)).toBe(true);
    expect(stepDetachedRelease(st, true, 4600, 99, policy)).toBe(false);
    expect(st.releases).toBe(0);
    expect(stepDetachedRelease(st, false, 4700, 99, policy)).toBe(false);
    expect(stepDetachedRelease(st, false, 7100, 99, policy)).toBe(false); // 2400 < grace
    expect(stepDetachedRelease(st, false, 7200, 99, policy)).toBe(true);
  });

  it("waits out the grace (the FPV-exit flight) before the first drain", () => {
    const st = createDetachedReleaseState();
    stepDetachedRelease(st, false, 0, 50, policy);
    expect(stepDetachedRelease(st, false, 2499, 50, policy)).toBe(false);
    expect(stepDetachedRelease(st, false, 2500, 50, policy)).toBe(true);
  });

  it("asks for nothing while the caches are empty (the boot-time detach costs nothing)", () => {
    const st = createDetachedReleaseState();
    stepDetachedRelease(st, false, 0, 0, policy);
    expect(stepDetachedRelease(st, false, 10_000, 0, policy)).toBe(false);
    expect(st.releases).toBe(0);
    // a late arrival after the grace is drained when it lands
    expect(stepDetachedRelease(st, false, 10_016, 4, policy)).toBe(true);
  });

  it("fires at most maxPerPeriod times per detach — the every-frame guard", () => {
    const st = createDetachedReleaseState();
    stepDetachedRelease(st, false, 0, 9, policy);
    let fired = 0;
    for (let t = 3000; t < 3000 + 16 * 50; t += 16) if (stepDetachedRelease(st, false, t, 9, policy)) fired++;
    expect(fired).toBe(3);
  });

  it("the kill switch holds the period clock but never fires", () => {
    const st = createDetachedReleaseState();
    const off = { ...policy, enabled: false };
    expect(stepDetachedRelease(st, false, 0, 9, off)).toBe(false);
    expect(st.detachedAtMs).toBe(0);
    expect(stepDetachedRelease(st, false, 9000, 9, off)).toBe(false);
    expect(st.releases).toBe(0);
  });
});
