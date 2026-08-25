import { describe, expect, it } from "vitest";
import {
  impostorEdgeWindow,
  impostorEdgeWindowGlsl,
} from "../../../src/components/globe/scene/glsl";
import { COMET, ECLIPSE, SKY, SKY_TARGET } from "../../../src/components/globe/tuning";

/**
 * RC1 / owner bug B2 (2026-08-25) — "a square edge around the sun at totality".
 *
 * The impostors are QUADS carrying additive terms with no compact support (the corona's
 * `x^-2.6` power law, `exp()` halos, a Gaussian ellipse) plus an unconditional ±1/256 dither.
 * Truncating any of those at the quad's own boundary IS a rectangle. The fix is a radial window
 * that closes to exactly zero strictly INSIDE the quad's inscribed radius, applied after the
 * dither — so what this file pins is the geometry: the window must be shut before the edge, and
 * it must not have eaten anything the shader draws on purpose.
 *
 * CPU twin of the GLSL `1.0 - smoothstep(start, end, r)` emitted by impostorEdgeWindowGlsl.
 */

const SUN_START = SKY.sunQuadFade[0] * SKY.sunGlowExtent;
const SUN_END = SKY.sunQuadFade[1] * SKY.sunGlowExtent;

describe("impostorEdgeWindow — the CPU twin", () => {
  it("is exactly 1 inside the start radius and exactly 0 at/after the end radius", () => {
    expect(impostorEdgeWindow(0, 2, 5)).toBe(1);
    expect(impostorEdgeWindow(2, 2, 5)).toBe(1);
    expect(impostorEdgeWindow(5, 2, 5)).toBe(0);
    expect(impostorEdgeWindow(9, 2, 5)).toBe(0);
  });

  it("is monotonically non-increasing across the band", () => {
    let prev = 1;
    for (let r = 0; r <= 6; r += 0.05) {
      const w = impostorEdgeWindow(r, 2, 5);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      prev = w;
    }
  });

  it("matches smoothstep's C1 shape (half-way at the band midpoint)", () => {
    expect(impostorEdgeWindow(3.5, 2, 5)).toBeCloseTo(0.5, 12);
  });

  it("emits a GLSL expression reading the `r` in scope, with glf-formatted bounds", () => {
    expect(impostorEdgeWindowGlsl(2, 5)).toBe("(1.0 - smoothstep(2.0, 5.0, r))");
  });
});

describe("sun impostor — the window closes before the quad does", () => {
  it("window(sunGlowExtent) === 0 — nothing survives to the plane's inscribed radius", () => {
    expect(impostorEdgeWindow(SKY.sunGlowExtent, SUN_START, SUN_END)).toBe(0);
  });

  it("the whole corner region (up to halfExtent·√2) is also zero", () => {
    expect(impostorEdgeWindow(SKY.sunGlowExtent * Math.SQRT2, SUN_START, SUN_END)).toBe(0);
  });

  it("kills the corona pedestal that the quad edge used to truncate", () => {
    // The shader term at the edge, in the sun's own HDR units: outer power law × petal(≈1) ×
    // tot(=1 at totality) × coronaGain. The B2 root cause measured ≈0.003 linear there.
    const corona = (r: number) =>
      ECLIPSE.coronaOuterGain * Math.pow(r, -ECLIPSE.coronaOuterPow) * ECLIPSE.coronaGain;
    const atEdge = corona(SKY.sunGlowExtent);
    expect(atEdge).toBeGreaterThan(1 / 1024); // the pedestal is real — this is the bug
    expect(atEdge * impostorEdgeWindow(SKY.sunGlowExtent, SUN_START, SUN_END)).toBe(0);
  });

  it("leaves the core disc and the near-limb corona untouched", () => {
    // Core disc lives at r ≤ 1, the chromosphere hairline at rm ≈ 1, the inner corona within a
    // few limb radii — all far inside the window's start.
    expect(impostorEdgeWindow(1, SUN_START, SUN_END)).toBe(1);
    expect(impostorEdgeWindow(SKY.sunGlowExtent * 0.5, SUN_START, SUN_END)).toBe(1);
    expect(SUN_START).toBeGreaterThan(1 + ECLIPSE.chromoWidth);
  });

  it("the fade band is wide enough that the residual gradient is gentler than the truncation", () => {
    // The step the window replaces is the whole pedestal at once; the window spreads it over
    // ≥ 1.5 disc radii, where the power law is already falling on its own.
    expect(SUN_END - SUN_START).toBeGreaterThan(1.5);
    expect(SKY.sunQuadFade[0]).toBeGreaterThanOrEqual(0.6); // charter floor
    expect(SKY.sunQuadFade[1]).toBeLessThan(1); // strictly inside the inscribed radius
  });
});

describe("sky-target impostor — the sibling window", () => {
  // Twin of the module-private constants in scene/skyTarget.ts (the plane spans p ∈ [-1,1]²,
  // so every radius below is already a fraction of the half-extent).
  const SPAN_DEG = Math.max(
    COMET.tailLenDeg,
    SKY_TARGET.reticleRadDeg * 1.35,
    COMET.comaAngRadDeg * COMET.comaGlowExtent,
  );
  const [START, END] = SKY_TARGET.quadFade;
  /** Widest reticle the update() path can build: a DSO ring is clamped to SPAN/1.3, ticks add
   *  reticleTickFrac on top. Nothing the shader draws on purpose may sit inside the fade band. */
  const WIDEST_TICK_N = (SPAN_DEG / 1.3 / SPAN_DEG) * (1 + SKY_TARGET.reticleTickFrac);

  it("closes strictly inside the quad", () => {
    expect(END).toBeLessThan(1);
    expect(impostorEdgeWindow(1, START, END)).toBe(0);
    expect(impostorEdgeWindow(Math.SQRT2, START, END)).toBe(0);
  });

  it("starts outside the widest mark the reticle can draw", () => {
    expect(WIDEST_TICK_N).toBeLessThanOrEqual(START);
    expect(impostorEdgeWindow(WIDEST_TICK_N, START, END)).toBe(1);
  });

  it("takes less off the comet tail's tip than the dither it removes there", () => {
    // The tail's own taper is axial = pow(1 - t, 1.5), t = p.x / TAIL_LEN_N, and
    // TAIL_LEN_N = tailLenDeg / SPAN = 1 — so it already reaches zero exactly where the quad
    // ends and the window only trims its last, faintest centimetre. The bar is the dither's
    // full peak-to-peak (1/128), which is what the window exists to take away.
    const tailLenN = COMET.tailLenDeg / SPAN_DEG;
    expect(tailLenN).toBeLessThanOrEqual(1);
    const tailAt = (r: number) =>
      Math.pow(1 - Math.min(r / tailLenN, 1), 1.5) * COMET.tailIntensity;
    let worstLoss = 0;
    for (let r = START; r <= END; r += 0.001) {
      worstLoss = Math.max(worstLoss, tailAt(r) * (1 - impostorEdgeWindow(r, START, END)));
    }
    expect(worstLoss).toBeLessThan(1 / 128);
    expect(tailAt(START) * (1 - impostorEdgeWindow(START, START, END))).toBe(0); // untouched
  });
});
