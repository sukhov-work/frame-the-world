import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDebugFeedForTests,
  debugActionIds,
  debugFeedActive,
  debugProviderIds,
  debugPush,
  debugSeriesRead,
  debugSeriesStatsOf,
  makeRateTracker,
  readDebugProvider,
  registerDebugAction,
  registerDebugProvider,
  runDebugAction,
  setDebugFeedActive,
} from "../../../src/lib/globe/debugFeed";
import { DEBUGHUD } from "../../../src/components/globe/tuning";

beforeEach(() => __resetDebugFeedForTests());

describe("debugFeed — series rings", () => {
  it("a push while INACTIVE is a no-op (the whole off-state contract)", () => {
    expect(debugFeedActive()).toBe(false);
    debugPush("frame.dt", 16.7);
    const out = new Float32Array(8);
    expect(debugSeriesRead("frame.dt", out)).toBe(0);
    expect(debugSeriesStatsOf("frame.dt")).toBeNull();
  });

  it("stores samples oldest→newest and wraps at ring capacity", () => {
    setDebugFeedActive(true);
    const cap = DEBUGHUD.ringCapacity;
    for (let i = 0; i < cap + 10; i++) debugPush("frame.dt", i);
    const out = new Float32Array(cap);
    const n = debugSeriesRead("frame.dt", out);
    expect(n).toBe(cap);
    // Oldest surviving sample is 10 (the first 10 were overwritten), newest is cap+9.
    expect(out[0]).toBe(10);
    expect(out[n - 1]).toBe(cap + 9);
    // Monotone — proves the wrap re-ordered nothing.
    for (let i = 1; i < n; i++) expect(out[i]).toBe(out[i - 1] + 1);
  });

  it("reads into a smaller buffer by keeping the NEWEST samples", () => {
    setDebugFeedActive(true);
    for (let i = 0; i < 50; i++) debugPush("frame.cpu", i);
    const out = new Float32Array(10);
    const n = debugSeriesRead("frame.cpu", out);
    expect(n).toBe(10);
    expect(out[0]).toBe(40);
    expect(out[9]).toBe(49);
  });

  it("stats: avg/min/max/p50/p95/worst1/jitter on a known series", () => {
    setDebugFeedActive(true);
    // 99 samples of 10 ms and one 100 ms hitch.
    for (let i = 0; i < 99; i++) debugPush("frame.draw", 10);
    debugPush("frame.draw", 100);
    const s = debugSeriesStatsOf("frame.draw")!;
    expect(s.n).toBe(100);
    expect(s.last).toBe(100);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
    expect(s.avg).toBeCloseTo(10.9, 5);
    expect(s.p50).toBe(10);
    // worst1 = mean of the worst ceil(100/100)=1 sample — the hitch itself.
    expect(s.worst1).toBe(100);
    expect(s.jitter).toBe(s.p95 - s.p50);
  });

  it("stats survive the wrap (order statistics don't care about ring phase)", () => {
    setDebugFeedActive(true);
    const cap = DEBUGHUD.ringCapacity;
    for (let i = 0; i < cap * 2; i++) debugPush("frame.tris", (i % 4) + 1); // 1..4 repeating
    const s = debugSeriesStatsOf("frame.tris")!;
    expect(s.n).toBe(cap);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.avg).toBeCloseTo(2.5, 5);
  });
});

describe("debugFeed — providers", () => {
  it("registers, reads, lists, and unregisters", () => {
    const off = registerDebugProvider("canvas", () => ({ tier: "high", dpr: 2 }));
    expect(debugProviderIds()).toEqual(["canvas"]);
    expect(readDebugProvider("canvas")).toEqual({ tier: "high", dpr: 2 });
    off();
    expect(debugProviderIds()).toEqual([]);
    expect(readDebugProvider("canvas")).toBeNull();
  });

  it("a THROWING provider reads as null — a broken reach is a finding, not a crash", () => {
    registerDebugProvider("tiles", () => {
      throw new Error("plugin reach broke");
    });
    expect(readDebugProvider("tiles")).toBeNull();
  });

  it("re-registration replaces (a re-attached globe must not stack stale closures)", () => {
    registerDebugProvider("camera", () => ({ v: 1 }));
    const off2 = registerDebugProvider("camera", () => ({ v: 2 }));
    expect(readDebugProvider("camera")).toEqual({ v: 2 });
    off2();
    expect(readDebugProvider("camera")).toBeNull();
  });

  it("a stale unregister does not remove a NEWER registration", () => {
    const off1 = registerDebugProvider("astro", () => ({ v: 1 }));
    registerDebugProvider("astro", () => ({ v: 2 }));
    off1(); // the old closure's unregister — must be a no-op now
    expect(readDebugProvider("astro")).toEqual({ v: 2 });
  });
});

describe("debugFeed — actions", () => {
  it("runs on demand and surfaces a throw as { error }", () => {
    registerDebugAction("seats", () => ({ cells: 101 }));
    registerDebugAction("boom", () => {
      throw new Error("traversal died");
    });
    expect(debugActionIds().sort()).toEqual(["boom", "seats"]);
    expect(runDebugAction("seats")).toEqual({ cells: 101 });
    expect(runDebugAction("boom")).toEqual({ error: "Error: traversal died" });
    expect(runDebugAction("nope")).toEqual({ error: 'no action "nope"' });
  });
});

describe("debugFeed — rate tracker (the cumulative-counter discipline)", () => {
  it("first sample yields null, second yields the per-second rate", () => {
    const t = makeRateTracker();
    expect(t.rate("draws", 100, 1000)).toBeNull();
    expect(t.rate("draws", 160, 2000)).toBe(60); // +60 over 1 s
    expect(t.rate("draws", 160, 2500)).toBe(0); // flat counter → 0/s, not null
  });

  it("a counter that went BACKWARD re-seats silently (re-attach reset)", () => {
    const t = makeRateTracker();
    t.rate("epoch", 500, 1000);
    expect(t.rate("epoch", 3, 2000)).toBeNull(); // reset detected — no negative rate
    expect(t.rate("epoch", 13, 3000)).toBe(10); // and the next window is honest again
  });

  it("keys are independent", () => {
    const t = makeRateTracker();
    t.rate("a", 0, 0);
    t.rate("b", 0, 0);
    expect(t.rate("a", 10, 1000)).toBe(10);
    expect(t.rate("b", 20, 1000)).toBe(20);
  });
});
