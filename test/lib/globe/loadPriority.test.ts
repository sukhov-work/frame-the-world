import { describe, it, expect } from "vitest";
import {
  effectiveDistance,
  makeClosestFirstComparator,
  makeLoadAim,
  makeTileLatencyProbe,
  type LoadAim,
  type PriorityTile,
  type TileCenterReader,
} from "../../../src/lib/globe/loadPriority";

/** A minimal 0.4.28-shaped tile. Centers live in a side map read by the injected reader. */
function tile(over: {
  used?: boolean;
  inFrustum?: boolean;
  unrenderable?: boolean;
  dist?: number;
  depth?: number;
  priority?: number;
  center?: { x: number; y: number; z: number };
}): PriorityTile & { center?: { x: number; y: number; z: number } } {
  return {
    ...(over.priority !== undefined ? { priority: over.priority } : {}),
    traversal: {
      used: over.used ?? true,
      inFrustum: over.inFrustum ?? true,
      distanceFromCamera: over.dist ?? 100,
    },
    internal: {
      hasUnrenderableContent: over.unrenderable ?? false,
      depthFromRenderedParent: over.depth ?? 1,
    },
    center: over.center,
  };
}

const readCenter: TileCenterReader = (t, out) => {
  const c = (t as { center?: { x: number; y: number; z: number } }).center;
  if (!c) return false;
  out.x = c.x;
  out.y = c.y;
  out.z = c.z;
  return true;
};

/** Aim looking down +x from the origin. */
function fpvAim(k = 1.5): LoadAim {
  const aim = makeLoadAim();
  aim.active = true;
  aim.k = k;
  aim.fwd = { x: 1, y: 0, z: 0 };
  aim.epoch = 1;
  return aim;
}

describe("makeLoadAim", () => {
  it("starts inactive with zero bias (pure library ordering until the first FPV frame)", () => {
    const aim = makeLoadAim();
    expect(aim.active).toBe(false);
    expect(aim.k).toBe(0);
    expect(aim.epoch).toBe(0);
  });
});

describe("makeClosestFirstComparator — library parity when the aim is inactive", () => {
  // Contract (TilesRendererBase.js:37): returning 1 means "tile a" runs FIRST (the queue sorts
  // ascending and pops from the END). Each branch mirrors distancePriorityCallback verbatim.
  const cmp = makeClosestFirstComparator(makeLoadAim(), readCenter);

  it("used tiles run before unused ones", () => {
    expect(cmp(tile({ used: true }), tile({ used: false }))).toBe(1);
    expect(cmp(tile({ used: false }), tile({ used: true }))).toBe(-1);
  });

  it("in-frustum tiles run before out-of-frustum ones", () => {
    expect(cmp(tile({ inFrustum: true }), tile({ inFrustum: false }))).toBe(1);
    expect(cmp(tile({ inFrustum: false }), tile({ inFrustum: true }))).toBe(-1);
  });

  it("external tilesets (unrenderable content) run before renderable tiles", () => {
    expect(cmp(tile({ unrenderable: true }), tile({ unrenderable: false }))).toBe(1);
  });

  it("nearer tiles run first — the closest-first core", () => {
    expect(cmp(tile({ dist: 50 }), tile({ dist: 200 }))).toBe(1);
    expect(cmp(tile({ dist: 200 }), tile({ dist: 50 }))).toBe(-1);
  });

  it("at equal distance, shallower tiles run first", () => {
    expect(cmp(tile({ depth: 1 }), tile({ depth: 3 }))).toBe(1);
    expect(cmp(tile({ depth: 3 }), tile({ depth: 1 }))).toBe(-1);
  });

  it("identical tiles compare equal", () => {
    expect(cmp(tile({}), tile({}))).toBe(0);
  });

  it("mirrors the library's explicit-priority escape hatch (unifiedPriorityCallback)", () => {
    // Verbatim library expression: `(a.priority ?? Infinity) > (b.priority ?? Infinity) ? 1 : -1`.
    expect(cmp(tile({ priority: 5 }), tile({ priority: 1 }))).toBe(1);
    expect(cmp(tile({ priority: 1 }), tile({ priority: 5 }))).toBe(-1);
  });

  it("stays total on non-tile items (processNodeQueue reads this callback for plugin work)", () => {
    expect(cmp({}, tile({}))).toBe(0);
    expect(cmp({} as PriorityTile, {} as PriorityTile)).toBe(0);
  });
});

describe("effectiveDistance — the FPV look-direction bias", () => {
  it("returns the raw distance while the aim is inactive", () => {
    const t = tile({ dist: 100, center: { x: 100, y: 0, z: 0 } });
    expect(effectiveDistance(t, makeLoadAim(), readCenter)).toBe(100);
  });

  it("shrinks the distance of a tile along the look vector by 1/(1+k·dot)", () => {
    const t = tile({ dist: 100, center: { x: 100, y: 0, z: 0 } }); // dead ahead → dot 1
    expect(effectiveDistance(t, fpvAim(1.5), readCenter)).toBeCloseTo(40, 10); // 100/(1+1.5)
  });

  it("leaves tiles behind the camera at raw distance (dot clamped at 0)", () => {
    const t = tile({ dist: 100, center: { x: -100, y: 0, z: 0 } });
    expect(effectiveDistance(t, fpvAim(1.5), readCenter)).toBe(100);
  });

  it("falls back to raw distance when the tile has no readable centre", () => {
    const t = tile({ dist: 100 }); // no center → reader returns false
    expect(effectiveDistance(t, fpvAim(1.5), readCenter)).toBe(100);
  });

  it("caches per epoch: a stale aim is reused until the frame bumps epoch", () => {
    const aim = fpvAim(1.5);
    const t = tile({ dist: 100, center: { x: 100, y: 0, z: 0 } });
    expect(effectiveDistance(t, aim, readCenter)).toBeCloseTo(40, 10);
    aim.fwd = { x: -1, y: 0, z: 0 }; // turn around WITHOUT a new frame…
    expect(effectiveDistance(t, aim, readCenter)).toBeCloseTo(40, 10); // …cached value holds
    aim.epoch++; // the per-frame bump invalidates
    expect(effectiveDistance(t, aim, readCenter)).toBe(100); // now behind → raw
  });

  it("orders an ahead tile before an equally-near behind tile in FPV", () => {
    const cmp = makeClosestFirstComparator(fpvAim(1.5), readCenter);
    const ahead = tile({ dist: 100, center: { x: 100, y: 0, z: 0 } });
    const behind = tile({ dist: 100, center: { x: -100, y: 0, z: 0 } });
    expect(cmp(ahead, behind)).toBe(1);
    expect(cmp(behind, ahead)).toBe(-1);
  });

  it("k = 0 degenerates to pure distance even with the aim active", () => {
    const cmp = makeClosestFirstComparator(fpvAim(0), readCenter);
    const ahead = tile({ dist: 100, depth: 3, center: { x: 100, y: 0, z: 0 } });
    const behind = tile({ dist: 100, depth: 1, center: { x: -100, y: 0, z: 0 } });
    expect(cmp(ahead, behind)).toBe(-1); // equal distance → depth tiebreak (shallower first)
  });
});

describe("makeTileLatencyProbe", () => {
  it("pairs download-start with load-model and aggregates mean/max", () => {
    let t = 0;
    const p = makeTileLatencyProbe(() => t, 32);
    const a = {};
    const b = {};
    p.start(a); // t=0
    t = 100;
    p.start(b);
    p.end(a); // dt 100
    t = 400;
    p.end(b); // dt 300
    const s = p.snapshot();
    expect(s.n).toBe(2);
    expect(s.meanMs).toBe(200);
    expect(s.maxMs).toBe(300);
    expect(s.recent).toEqual([100, 300]);
    expect(s.pending).toBe(0);
  });

  it("ignores an end without a matching start (already-cached tiles)", () => {
    const p = makeTileLatencyProbe(() => 0, 32);
    p.end({});
    expect(p.snapshot().n).toBe(0);
  });

  it("cancel forgets an in-flight tile (load-error path)", () => {
    const p = makeTileLatencyProbe(() => 0, 32);
    const a = {};
    p.start(a);
    p.cancel(a);
    p.end(a);
    expect(p.snapshot().n).toBe(0);
    expect(p.snapshot().pending).toBe(0);
  });

  it("mark() opens a time-to-first window closed by the NEXT completion only", () => {
    let t = 0;
    const p = makeTileLatencyProbe(() => t, 32);
    const a = {};
    const b = {};
    p.start(a); // pre-mark in-flight
    t = 200;
    p.mark();
    expect(p.snapshot().firstAfterMarkMs).toBeNull();
    t = 260;
    p.end(a); // first completion after the mark — even if started before it
    expect(p.snapshot().firstAfterMarkMs).toBe(60);
    t = 300;
    p.start(b);
    t = 500;
    p.end(b); // later completions never move the window
    expect(p.snapshot().firstAfterMarkMs).toBe(60);
  });

  it("keeps the recent ring at its cap and the pending map bounded", () => {
    let t = 0;
    const p = makeTileLatencyProbe(() => t, 4);
    for (let i = 0; i < 10; i++) {
      const o = {};
      p.start(o);
      t += 1;
      p.end(o);
    }
    expect(p.snapshot().recent.length).toBe(4);
    for (let i = 0; i < 600; i++) p.start({});
    expect(p.snapshot().pending).toBeLessThanOrEqual(512);
  });
});
