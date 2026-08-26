import { describe, it, expect } from "vitest";
import {
  pipCapture,
  pipNeedsRender,
  pipRtSizePx,
  type PipDeltaCfg,
  type PipPose,
} from "../../../src/lib/globe/pipCache";
import { PIP } from "../../../src/components/globe/tuning";

const CFG: PipDeltaCfg = { ...PIP };

/** An identity view + a plausible projection + a sun somewhere overhead. */
function pose(overrides: Partial<PipPose> = {}): PipPose {
  const view = new Float64Array(16);
  const proj = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    view[i] = i % 5 === 0 ? 1 : 0; // identity
    proj[i] = i % 5 === 0 ? 1 : 0;
  }
  view[12] = 1000; // a camera a kilometre out, in metres
  view[13] = 2000;
  view[14] = 3000;
  return { view, proj, sun: [0, 1, 0], ...overrides };
}

describe("pipRtSizePx", () => {
  it("matches setViewport's own CSS-px × pixelRatio, rounded", () => {
    expect(pipRtSizePx({ x: 0, y: 0, w: 124.8, h: 270.1 }, 3)).toEqual({ w: 374, h: 810 });
    expect(pipRtSizePx({ x: 0, y: 0, w: 100, h: 50 }, 1)).toEqual({ w: 100, h: 50 });
  });

  it("floors at 1 px — a dvh transient can hand us a zero-height box, and GL rejects it", () => {
    // The .mw-pip box is sized in `dvh`, which animates with the iOS URL bar; a 0-dimension
    // framebuffer is a GL error, not a small texture.
    expect(pipRtSizePx({ x: 0, y: 0, w: 0, h: 0 }, 3)).toEqual({ w: 1, h: 1 });
    expect(pipRtSizePx({ x: 0, y: 0, w: 0.1, h: 0.1 }, 1)).toEqual({ w: 1, h: 1 });
  });
});

describe("pipCapture", () => {
  it("copies out of three's live element arrays — a stored pose must not alias them", () => {
    // camera.matrixWorld.elements is mutated IN PLACE every frame. Storing the reference would
    // make the cached pose equal to the live one forever: the predicate would never fire again,
    // and the miniature would freeze at whatever it first showed.
    const live = pose();
    const snap = pipCapture(live);
    (live.view as unknown as Float64Array)[12] = 99999;
    (live.sun as unknown as number[])[0] = 42;
    expect(snap.view[12]).toBe(1000);
    expect(snap.sun[0]).toBe(0);
  });
});

describe("pipNeedsRender", () => {
  it("renders when there is no cached frame at all", () => {
    expect(pipNeedsRender(null, pose(), 0, CFG)).toBe(true);
  });

  it("holds the cache on a parked camera within the staleness window", () => {
    const p = pose();
    expect(pipNeedsRender(pipCapture(p), p, 0, CFG)).toBe(false);
  });

  it("refreshes once the frame is older than maxStaleMs — the catch-all for what it cannot see", () => {
    // Tile streaming, the drape crossfade, uTime twinkle and every eased uniform are invisible to
    // the cheap predicate. This is the bound on how wrong the miniature can get.
    const p = pose();
    expect(pipNeedsRender(pipCapture(p), p, CFG.maxStaleMs - 1, CFG)).toBe(false);
    expect(pipNeedsRender(pipCapture(p), p, CFG.maxStaleMs, CFG)).toBe(true);
  });

  it("maxStaleMs: 0 is the ROLLBACK — byte-for-byte the pre-RC19 every-frame pass", () => {
    // Locked as a test rather than left as a claim in a comment: this is the documented escape
    // hatch if the cache ever misbehaves on device.
    const p = pose();
    const off = { ...CFG, maxStaleMs: 0 };
    for (const age of [0, 1, 16, 1000]) {
      expect(pipNeedsRender(pipCapture(p), p, age, off)).toBe(true);
    }
  });

  it("sees camera translation at the metre epsilon, not below it", () => {
    const prev = pipCapture(pose());
    const nudged = pose();
    (nudged.view as unknown as Float64Array)[12] += CFG.posEpsM / 2;
    expect(pipNeedsRender(prev, nudged, 0, CFG)).toBe(false);
    const moved = pose();
    (moved.view as unknown as Float64Array)[12] += CFG.posEpsM * 2;
    expect(pipNeedsRender(prev, moved, 0, CFG)).toBe(true);
  });

  it("sees rotation on the basis columns at the (much finer) dimensionless epsilon", () => {
    const prev = pipCapture(pose());
    const turned = pose();
    (turned.view as unknown as Float64Array)[0] += CFG.basisEps * 2;
    expect(pipNeedsRender(prev, turned, 0, CFG)).toBe(true);
    // A translation-sized change on a BASIS element must not be judged by the metre epsilon —
    // that would let a whole degree of yaw through unnoticed.
    expect(CFG.basisEps).toBeLessThan(CFG.posEpsM);
  });

  it("sees a projection change (FOV glide, aspect, near/far re-fit)", () => {
    const prev = pipCapture(pose());
    const zoomed = pose();
    (zoomed.proj as unknown as Float64Array)[0] += CFG.projEps * 10;
    expect(pipNeedsRender(prev, zoomed, 0, CFG)).toBe(true);
  });

  it("compares the sun as a DIRECTION — an ULTRA lightDistM swap is not a view change", () => {
    // ULTRA parks the key light nearly an order of magnitude further out. The shading is
    // identical; a raw position compare would invalidate the cache on every chip flip.
    const DIST = 8000; // SHADOWS.lightDistM
    const prev = pipCapture(pose({ sun: [0, DIST, 0] }));
    const farther = pose({ sun: [0, 60000, 0] }); // the ULTRA profile — 7.5× further out
    expect(pipNeedsRender(prev, farther, 0, CFG)).toBe(false);
    // But an actual sun MOVE still invalidates. The epsilon is in DIRECTION space, so the
    // comparison has to be scaled by the light distance — this is a ~0.011° swing, roughly what
    // a timelapse scrub covers between frames (the live terminator takes ~1.4 s to reach it, and
    // maxStaleMs catches that case first).
    const moved = pose({ sun: [DIST * CFG.sunDirEps * 2, DIST, 0] });
    expect(pipNeedsRender(prev, moved, 0, CFG)).toBe(true);
    // Below the epsilon, in the same units, is correctly ignored.
    const jitter = pose({ sun: [DIST * CFG.sunDirEps * 0.4, DIST, 0] });
    expect(pipNeedsRender(prev, jitter, 0, CFG)).toBe(false);
  });

  it("a zero-length sun vector degrades to no-change rather than to NaN", () => {
    const prev = pipCapture(pose({ sun: [0, 0, 0] }));
    const next = pose({ sun: [0, 0, 0] });
    expect(pipNeedsRender(prev, next, 0, CFG)).toBe(false);
  });

  it("the shipped epsilons all sit strictly inside the sub-pixel budget they claim", () => {
    // A tuning fence: the doc lines justify these against ~125 CSS px of PiP box at a 55° FOV.
    // If a taste pass loosens one past a visible pixel, that should fail here, not on a phone.
    expect(PIP.posEpsM).toBeGreaterThan(0);
    expect(PIP.posEpsM).toBeLessThan(0.1); // 10 cm would be visible at street level
    expect(PIP.basisEps).toBeLessThan(1e-3); // ≈ 1/8 PiP pixel of yaw
    expect(PIP.projEps).toBeGreaterThan(0);
    expect(PIP.sunDirEps).toBeLessThan(1e-3);
    expect(PIP.maxStaleMs).toBeGreaterThan(0); // 0 is the rollback, not the shipped value
    expect(PIP.maxStaleMs).toBeLessThanOrEqual(500); // ≥2 Hz — below that the PiP reads as laggy
  });
});
