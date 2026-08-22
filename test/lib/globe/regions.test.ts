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
  it("every region has a sane bbox and carries SOME bake — buildings, terrain, or both", () => {
    for (const r of BAKED_REGIONS) {
      const [w, s, e, n] = r.bbox;
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      // Relaxed 2026-08-22h from "at least one variant": `everest` is TERRAIN-ONLY. What must
      // still hold is that an entry is never a no-op — a region with neither a variant nor a
      // patch claims ground from `regionContaining` and then supplies nothing for it.
      expect(r.variants.length > 0 || !!r.terrain).toBe(true);
      for (const v of r.variants) expect(v).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("the registry HEAD has variants — it is the last-resort enriched fallback", () => {
    // defaultRegion() ends at BAKED_REGIONS[0] when nothing else resolves and reads variants[0]
    // unguarded. A terrain-only region promoted to the head would silently emit
    // `…/enriched/undefined/tileset.json`. Terrain-only entries go at the TAIL.
    expect(BAKED_REGIONS[0].variants.length).toBeGreaterThan(0);
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
    // A terrain-only region owns its ground for the geometric lookup just like any other.
    expect(regionContaining(27.988056, 86.925278)?.id).toBe("everest"); // the summit
    expect(regionContaining(27.6, 86.7)).toBeNull(); // Lukla, ~30 km south — outside the box
  });

  it("the everest patch really covers a 20 km radius around the summit", () => {
    // The whole point of the bake. Walk the four cardinal points at exactly 20 km and require
    // each to fall inside cityBbox — this is what would break if the degree-length conversion
    // in everest.json were ever "simplified" to a flat 111 km/deg on both axes.
    const t = regionById("everest")!.terrain!;
    const [lon0, lat0] = [86.925278, 27.988056];
    const dLat = 20 / 110.819; // metres per degree of MERIDIAN arc at φ=27.988
    const dLon = 20 / 98.376; //  … and of PARALLEL arc, which is 11 % shorter here
    for (const [lon, lat] of [
      [lon0, lat0 + dLat],
      [lon0, lat0 - dLat],
      [lon0 + dLon, lat0],
      [lon0 - dLon, lat0],
    ]) {
      expect(lon).toBeGreaterThanOrEqual(t.cityBbox[0]);
      expect(lat).toBeGreaterThanOrEqual(t.cityBbox[1]);
      expect(lon).toBeLessThanOrEqual(t.cityBbox[2]);
      expect(lat).toBeLessThanOrEqual(t.cityBbox[3]);
    }
    // POSITIVE CONTROL: the box is a 20 km box, not an accidentally huge one — 25 km out is
    // outside it on both axes, so the assertions above are not vacuously satisfied.
    expect(lat0 + dLat * 1.25).toBeGreaterThan(t.cityBbox[3]);
    expect(lon0 + dLon * 1.25).toBeGreaterThan(t.cityBbox[2]);
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
