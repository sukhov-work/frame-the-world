import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDebugFeedForTests,
  DEBUG_SERIES_IDS,
  debugActionIds,
  debugFeedActive,
  debugFeedSnapshot,
  debugProviderIds,
  debugPush,
  debugSeriesRead,
  debugSeriesStatsOf,
  makeRateTracker,
  publishDebugFeedSeam,
  readDebugProvider,
  registerDebugAction,
  registerDebugProvider,
  runDebugAction,
  setDebugFeedActive,
  type DebugSeriesId,
} from "../../../src/lib/globe/debugFeed";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("debugFeed — the READ seam (T77 MEASURE, 2026-09-05)", () => {
  it("DEBUG_SERIES_IDS is in step with the DebugSeriesId union (source-pinned, both directions)", () => {
    // The snapshot walks this list; a series added to the union but not the list would silently
    // fall out of every harness read. Parse the union out of the source rather than trusting a
    // hand copy — the same "read the app's own encoder" rule the verify scripts follow.
    const src = readFileSync(join(__dirname, "../../../src/lib/globe/debugFeed.ts"), "utf8");
    // The union's members are the `  | "a.b"` lines (a trailing `;` inside a comment — the
    // "frame.gpu" note — is why the block is walked by LINE SHAPE, not cut at the first `;`).
    const from = src.indexOf("export type DebugSeriesId =");
    const inUnion = src
      .slice(from, src.indexOf("\n\n", from))
      .split("\n")
      .map((l) => l.match(/^\s*\|\s*"([a-z]+\.[a-z]+)"/)?.[1])
      .filter((x): x is string => !!x)
      .sort();
    expect(inUnion.length).toBeGreaterThan(3); // zero-result validation: the regex CAN match
    expect([...DEBUG_SERIES_IDS].sort()).toEqual(inUnion);
  });

  it("snapshot() flattens every provider as <id>.<key>, an unreachable one as <id>.__unreachable", () => {
    registerDebugProvider("canvas", () => ({ tier: "high", dpr: 2 }));
    registerDebugProvider("tiles", () => {
      throw new Error("reach broke");
    });
    const snap = debugFeedSnapshot();
    expect(snap["canvas.tier"]).toBe("high");
    expect(snap["canvas.dpr"]).toBe(2);
    expect(snap["tiles.__unreachable"]).toBe(true);
    expect(snap["feed.active"]).toBe(false);
  });

  it("snapshot() carries series statistics only once the feed has pushed (a cold read has none)", () => {
    const cold = debugFeedSnapshot();
    expect(Object.keys(cold).some((k) => k.startsWith("frame."))).toBe(false);
    setDebugFeedActive(true);
    for (const v of [10, 20, 30, 40]) debugPush("frame.dt", v);
    const warm = debugFeedSnapshot();
    expect(warm["feed.active"]).toBe(true);
    expect(warm["frame.dt.n"]).toBe(4);
    expect(warm["frame.dt.avg"]).toBe(25);
    expect(warm["frame.dt.max"]).toBe(40);
    expect(warm["frame.dt.last"]).toBe(40);
    // Series never pushed stay absent — an "absent" is honest, a zero would be a fabricated read.
    expect(warm["frame.gpu.n"]).toBeUndefined();
  });

  it("publishDebugFeedSeam() installs live functions on window and withdraws them cleanly", () => {
    const w = globalThis as unknown as { window?: unknown };
    const hadWindow = "window" in globalThis;
    const fake: Record<string, unknown> = {};
    (globalThis as unknown as { window: unknown }).window = fake;
    try {
      publishDebugFeedSeam(true);
      const seam = fake.__debugFeed as {
        snapshot: () => Record<string, unknown>;
        ids: () => string[];
        series: (id: DebugSeriesId) => unknown;
        active: boolean;
        setActive: (on: boolean) => void;
      };
      expect(typeof seam.snapshot).toBe("function");
      registerDebugProvider("models", () => ({ resident: 6 }));
      expect(seam.ids()).toEqual(["models"]);
      expect(seam.snapshot()["models.resident"]).toBe(6); // LIVE — registered after publish
      expect(seam.active).toBe(false);
      seam.setActive(true);
      expect(seam.active).toBe(true);
      expect(debugFeedActive()).toBe(true);
      publishDebugFeedSeam(false);
      expect("__debugFeed" in fake).toBe(false);
    } finally {
      if (hadWindow) (globalThis as unknown as { window: unknown }).window = w.window;
      else delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
