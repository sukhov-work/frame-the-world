import { describe, expect, it } from "vitest";
import { createLoadQueue, type LoadUnit } from "../../../src/lib/globe/loadQueue";

/** A fake clock the units advance themselves — every step "costs" what it says. */
const clock = () => {
  let t = 0;
  return { now: () => t, tick: (ms: number) => (t += ms) };
};

const unit = (
  key: object,
  opts: { steps: number; costMs: number; priority?: number; tick: (ms: number) => number; log: string[]; name: string },
): LoadUnit => {
  let left = opts.steps;
  return {
    key,
    priority: () => opts.priority ?? 0,
    step() {
      opts.tick(opts.costMs);
      opts.log.push(opts.name);
      left--;
      return left <= 0;
    },
  };
};

describe("T106 (b) — the deferred load queue", () => {
  it("always makes progress: one step runs even under a zero budget", () => {
    const c = clock();
    const log: string[] = [];
    const q = createLoadQueue(c.now);
    q.push(unit({}, { steps: 3, costMs: 5, tick: c.tick, log, name: "a" }));
    expect(q.drain(0)).toBe(5);
    expect(log).toEqual(["a"]);
    expect(q.pending()).toBe(1);
    q.drain(0);
    q.drain(0);
    expect(q.pending()).toBe(0);
    expect(q.stats().done).toBe(1);
    expect(q.stats().frames).toBe(3);
    expect(q.stats().maxFrameMs).toBe(5);
  });

  it("stops at the budget: a step that crosses the deadline ends the drain", () => {
    const c = clock();
    const log: string[] = [];
    const q = createLoadQueue(c.now);
    for (const n of ["a", "b", "c", "d"]) q.push(unit({}, { steps: 1, costMs: 3, tick: c.tick, log, name: n }));
    // 3 ms per unit, 7 ms budget: a (3) → b (6, still < 7) → c (9 ≥ 7, stop). d waits.
    expect(q.drain(7)).toBe(9);
    expect(log).toEqual(["a", "b", "c"]);
    expect(q.pending()).toBe(1);
    q.drain(7);
    expect(log).toEqual(["a", "b", "c", "d"]);
    expect(q.stats().maxFrameMs).toBe(9);
  });

  it("picks the lowest priority first, re-read at every pick; ties keep arrival order", () => {
    const c = clock();
    const log: string[] = [];
    const q = createLoadQueue(c.now);
    let farP = 10;
    const far: LoadUnit = { key: {}, priority: () => farP, step: () => (log.push("far"), true) };
    q.push(far);
    q.push(unit({}, { steps: 1, costMs: 1, priority: 5, tick: c.tick, log, name: "mid-1" }));
    q.push(unit({}, { steps: 1, costMs: 1, priority: 5, tick: c.tick, log, name: "mid-2" }));
    q.push(unit({}, { steps: 1, costMs: 1, priority: 1, tick: c.tick, log, name: "near" }));
    q.drain(0); // one step: the nearest
    expect(log).toEqual(["near"]);
    farP = 0; // the camera turned — the far cell is now the one in view
    q.drain(0);
    expect(log).toEqual(["near", "far"]);
    q.drain(100);
    expect(log).toEqual(["near", "far", "mid-1", "mid-2"]);
  });

  it("a unit mid-flight is sticky: stepped again before a nearer arrival, so one builder is live at a time", () => {
    const c = clock();
    const log: string[] = [];
    const q = createLoadQueue(c.now);
    q.push(unit({}, { steps: 3, costMs: 1, priority: 5, tick: c.tick, log, name: "far" }));
    q.drain(0); // far: step 1 of 3 — now mid-flight
    q.push(unit({}, { steps: 1, costMs: 1, priority: 0, tick: c.tick, log, name: "near" }));
    q.drain(0);
    q.drain(0);
    expect(log).toEqual(["far", "far", "far"]); // finished before the nearer unit ran
    q.drain(0);
    expect(log).toEqual(["far", "far", "far", "near"]);
  });

  it("cancel drops every unit of a key, mid-flight included, and never runs it again", () => {
    const c = clock();
    const log: string[] = [];
    const q = createLoadQueue(c.now);
    const sceneA = {};
    const sceneB = {};
    q.push(unit(sceneA, { steps: 3, costMs: 1, tick: c.tick, log, name: "a1" }));
    q.push(unit(sceneA, { steps: 1, costMs: 1, priority: 1, tick: c.tick, log, name: "a2" }));
    q.push(unit(sceneB, { steps: 1, costMs: 1, priority: 2, tick: c.tick, log, name: "b" }));
    q.drain(0); // a1 (priority 0) mid-flight
    expect(log).toEqual(["a1"]);
    expect(q.cancel(sceneA)).toBe(2);
    expect(q.pending()).toBe(1);
    q.drain(100);
    expect(log).toEqual(["a1", "b"]);
    expect(q.stats()).toMatchObject({ pending: 0, done: 1, cancelled: 2 });
    expect(q.cancel(sceneA)).toBe(0);
  });

  it("an idle drain costs nothing and counts no frame", () => {
    const c = clock();
    const q = createLoadQueue(c.now);
    expect(q.drain(5)).toBe(0);
    expect(q.stats().frames).toBe(0);
    q.push({ key: {}, priority: () => 0, step: () => true });
    q.clear();
    expect(q.pending()).toBe(0);
    expect(q.stats().cancelled).toBe(1);
  });
});
