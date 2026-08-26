import { describe, it, expect } from "vitest";
import {
  maxMipLevels,
  mipByteFactor,
  planMipSizes,
} from "../../../src/lib/globe/mipChain";
import { ULTRA, GROUND, QUALITY } from "../../../src/components/globe/tuning";

describe("mipByteFactor — the VRAM budget", () => {
  it("ONE level is EXACTLY 1 — the ULTRA off-state is an identity, not an epsilon", () => {
    expect(mipByteFactor(1)).toBe(1);
  });

  it("the shipped 4 levels cost +32.81%, inside the charter's <= +33% budget", () => {
    expect(mipByteFactor(4)).toBeCloseTo(85 / 64, 12);
    expect(mipByteFactor(4) - 1).toBeLessThan(0.33);
    expect(mipByteFactor(4) - 1).toBeCloseTo(0.328125, 10);
  });

  it("a FIFTH level BREACHES the budget — which is why the cap is 4 and not a round guess", () => {
    // 341/256 = +33.203%. The charter says "3–4 levels" and "<= +33%"; both cannot hold.
    expect(mipByteFactor(5) - 1).toBeGreaterThan(0.33);
    expect(mipByteFactor(5)).toBeCloseTo(341 / 256, 12);
    // And a full auto chain converges to +33.33%, the thing that is banned outright.
    expect(mipByteFactor(64) - 1).toBeCloseTo(1 / 3, 10);
  });

  it("ULTRA.mipLevels is set to the largest value the budget allows", () => {
    expect(ULTRA.mipLevels).toBe(4);
    expect(mipByteFactor(ULTRA.mipLevels) - 1).toBeLessThanOrEqual(0.33);
    expect(mipByteFactor(ULTRA.mipLevels + 1) - 1).toBeGreaterThan(0.33);
  });
});

describe("maxMipLevels", () => {
  it("stops at the first odd dimension — every level must halve exactly", () => {
    expect(maxMipLevels(512, 512)).toBe(10); // 512 → 1
    expect(maxMipLevels(256, 256)).toBe(9);
    expect(maxMipLevels(12, 12)).toBe(3); // 12 → 6 → 3, then odd
    expect(maxMipLevels(7, 8)).toBe(1);
  });

  it("both shipped composite sizes carry the 4-level chain", () => {
    // `high` composites at GROUND.overlayResolution; mid/low at their tier value.
    expect(maxMipLevels(GROUND.overlayResolution, GROUND.overlayResolution)).toBeGreaterThanOrEqual(
      ULTRA.mipLevels,
    );
    for (const tier of ["high", "mid", "low"] as const) {
      const px = QUALITY.tiers[tier].overlayResolutionPx;
      expect(maxMipLevels(px, px)).toBeGreaterThanOrEqual(ULTRA.mipLevels);
    }
  });
});

describe("planMipSizes", () => {
  it("returns null when OFF — not an empty array, because those differ to three", () => {
    // A `mipmaps` array with any entries takes three's MANUAL upload branch and allocates
    // IMMUTABLE storage for exactly that many levels; an empty one is the library's own path.
    // The off-state has to be the latter, or "the chip off changes nothing" stops being true.
    expect(planMipSizes(512, 512, 1)).toBeNull();
    expect(planMipSizes(512, 512, 0)).toBeNull();
  });

  it("EXCLUDES level 0 — that is the composite canvas itself, added by the caller", () => {
    expect(planMipSizes(8, 8, 4)).toEqual([
      { width: 4, height: 4 },
      { width: 2, height: 2 },
      { width: 1, height: 1 },
    ]);
  });

  it("refuses a chain the size cannot carry, rather than emitting a short one", () => {
    // three allocates immutable storage sized to the level count it is given, so an under-filled
    // allocation is the one way this slice could render garbage. Refusing is the correct failure.
    expect(planMipSizes(8, 8, 5)).toBeNull();
    expect(planMipSizes(12, 12, 4)).toBeNull(); // 12 → 6 → 3, then odd
    expect(planMipSizes(12, 12, 3)).not.toBeNull();
  });

  it("plans the shipped 512² chain down to 64²", () => {
    const sizes = planMipSizes(512, 512, ULTRA.mipLevels)!;
    expect(sizes).toHaveLength(ULTRA.mipLevels - 1);
    expect(sizes[sizes.length - 1]).toEqual({ width: 64, height: 64 });
  });

  it("the planned sizes cost exactly what mipByteFactor bills", () => {
    // The two numbers do different jobs — one sizes the GPU allocation, the other re-bills the
    // tile LRU — and a disagreement between them IS the under-billing that parks unaccounted
    // VRAM past the cap.
    const w = 64;
    const sizes = planMipSizes(w, w, 4)!;
    const total = w * w * 4 + sizes.reduce((n, l) => n + l.width * l.height * 4, 0);
    expect(total).toBe(Math.round(w * w * 4 * mipByteFactor(4)));
  });

  it("handles non-square composites", () => {
    expect(planMipSizes(64, 32, 3)).toEqual([
      { width: 32, height: 16 },
      { width: 16, height: 8 },
    ]);
  });
});
