import { describe, it, expect } from "vitest";
import { frameNeedsRender, framePoseChanged, type FrameGateCfg } from "../../../src/lib/globe/frameGate";
import { pipCapture, type PipPose } from "../../../src/lib/globe/pipCache";
import { GATE, ULTRA } from "../../../src/components/globe/tuning";

const identity = () => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
const poseAt = (x = 0, y = 0, z = 0, sun: [number, number, number] = [0, 1, 0]): PipPose => {
  const view = identity();
  view[12] = x;
  view[13] = y;
  view[14] = z;
  return pipCapture({ view, proj: identity(), sun });
};

/** The shipped knobs with the seam forced ON — every test below is about the gate's behaviour
 *  once enabled, and the off-state gets its own explicit lock. */
const on: FrameGateCfg = { ...GATE, enabled: true };

describe("frameGate — RC21 on-demand render", () => {
  describe("the two rollbacks are LOCKED, not just documented", () => {
    it("ships OFF: the shipped tuning returns true unconditionally", () => {
      expect(GATE.enabled).toBe(false);
      // Parked camera, nothing dirty, long past the heartbeat and the settle window — the one
      // situation the gate exists to skip. With the seam off it must STILL draw.
      const p = poseAt();
      expect(frameNeedsRender(p, poseAt(), 10_000, 10_000, false, GATE)).toBe(true);
    });

    it("`maxStaleMs: 0` is the second rollback — always render even with the seam on", () => {
      const p = poseAt();
      expect(frameNeedsRender(p, poseAt(), 10_000, 10_000, false, { ...on, maxStaleMs: 0 })).toBe(true);
    });
  });

  describe("the skip condition — all four of these must hold at once", () => {
    it("a quiet, settled, undirty, within-heartbeat frame is skipped", () => {
      expect(frameNeedsRender(poseAt(), poseAt(), 50, 10_000, false, on)).toBe(false);
    });

    it("…but never before the first drawn frame", () => {
      expect(frameNeedsRender(null, poseAt(), 50, 10_000, false, on)).toBe(true);
    });

    it("…never while dirty (the seam for changes the epsilons cannot see)", () => {
      expect(frameNeedsRender(poseAt(), poseAt(), 50, 10_000, true, on)).toBe(true);
    });

    it("…never past the heartbeat — this is the freeze guard, so assert it at the boundary", () => {
      expect(frameNeedsRender(poseAt(), poseAt(), GATE.maxStaleMs - 1, 10_000, false, on)).toBe(false);
      expect(frameNeedsRender(poseAt(), poseAt(), GATE.maxStaleMs, 10_000, false, on)).toBe(true);
    });

    it("…and never inside the settle window, which is what protects the no-snap eases", () => {
      expect(frameNeedsRender(poseAt(), poseAt(), 50, GATE.restMs - 1, false, on)).toBe(true);
      expect(frameNeedsRender(poseAt(), poseAt(), 50, GATE.restMs, false, on)).toBe(false);
    });
  });

  describe("pose sensitivity", () => {
    it("a translation past posEpsM counts; one under it does not", () => {
      const p = poseAt();
      expect(framePoseChanged(p, poseAt(GATE.posEpsM * 2), on)).toBe(true);
      expect(framePoseChanged(p, poseAt(GATE.posEpsM * 0.4), on)).toBe(false);
    });

    it("the sun is compared as a DIRECTION — distance alone is not a change", () => {
      // ULTRA swaps SHADOWS.lightDistM by ~an order of magnitude without moving the shading.
      const near = poseAt(0, 0, 0, [0, 1_000, 0]);
      const far = poseAt(0, 0, 0, [0, 50_000, 0]);
      expect(framePoseChanged(near, far, on)).toBe(false);
      const tilted = poseAt(0, 0, 0, [0.5, 1_000, 0]);
      expect(framePoseChanged(near, tilted, on)).toBe(true);
    });

    it("a projection change (FOV glide / aspect / near-far re-fit) counts", () => {
      const p = poseAt();
      const q = poseAt();
      (q.proj as Float64Array)[0] = 1 + GATE.projEps * 10;
      expect(framePoseChanged(p, q, on)).toBe(true);
    });

    it("a pose change forces a draw even when everything else says skip", () => {
      expect(frameNeedsRender(poseAt(), poseAt(5), 0, 10_000, false, on)).toBe(true);
    });
  });

  it("restMs covers the slowest LOOK-only ease at the repo's ≥6.2τ settling convention", () => {
    // The sizing argument, machine-checked: if someone raises exposureTauMs (or lowers restMs)
    // the gate could engage while the exposure ease is still visibly moving. `toBeGreaterThan…`
    // against a missing constant yields NaN and FAILS — which is how the first draft of this
    // assertion caught itself naming the wrong export.
    expect(ULTRA.exposureTauMs).toBeTypeOf("number");
    expect(GATE.restMs).toBeGreaterThanOrEqual(6.2 * ULTRA.exposureTauMs);
  });
});
