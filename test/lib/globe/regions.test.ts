import { describe, it, expect } from "vitest";
import {
  BAKED_REGIONS,
  regionById,
  regionContaining,
  regionOfVariant,
} from "../../../src/lib/globe/regions";

// The baked-region registry (owner rule 2026-08-18) — structural invariants every new region
// entry must keep, so "add a city" stays a one-entry edit that cannot silently break selection.

describe("BAKED_REGIONS invariants", () => {
  it("every region has a sane bbox and at least one variant (best first)", () => {
    for (const r of BAKED_REGIONS) {
      const [w, s, e, n] = r.bbox;
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      expect(r.variants.length).toBeGreaterThan(0);
      for (const v of r.variants) expect(v).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("region ids and variant names are globally unique (variant → region must be unambiguous)", () => {
    const ids = BAKED_REGIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const variants = BAKED_REGIONS.flatMap((r) => r.variants);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("terrain patches nest correctly: cityBbox ⊆ extentBbox, depths ordered", () => {
    for (const r of BAKED_REGIONS) {
      if (!r.terrain) continue;
      const t = r.terrain;
      expect(t.cityBbox[0]).toBeGreaterThanOrEqual(t.extentBbox[0]);
      expect(t.cityBbox[1]).toBeGreaterThanOrEqual(t.extentBbox[1]);
      expect(t.cityBbox[2]).toBeLessThanOrEqual(t.extentBbox[2]);
      expect(t.cityBbox[3]).toBeLessThanOrEqual(t.extentBbox[3]);
      expect(t.extentMaxDepth).toBeLessThanOrEqual(t.maxDepth);
      // The mask/bake coupling: the region bbox IS the terrain city bbox where a patch exists.
      expect(t.cityBbox).toEqual(r.bbox);
    }
  });
});

describe("lookups", () => {
  it("regionContaining is exact point-in-bbox", () => {
    expect(regionContaining(48.46, 35.05)?.id).toBe("dnipro");
    expect(regionContaining(51.75, -0.33)?.id).toBe("st-albans");
    expect(regionContaining(50.45, 30.52)).toBeNull(); // Kyiv — no bake yet
  });

  it("regionOfVariant / regionById resolve and miss cleanly", () => {
    expect(regionOfVariant("dnipro-o2w")?.id).toBe("dnipro");
    expect(regionOfVariant("dnipro")?.id).toBe("dnipro");
    expect(regionOfVariant("st-albans-o2w")?.id).toBe("st-albans");
    expect(regionOfVariant("nope")).toBeNull();
    expect(regionById("dnipro")?.id).toBe("dnipro");
    expect(regionById("nope")).toBeNull();
  });
});
