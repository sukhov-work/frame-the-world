import { describe, it, expect } from "vitest";
import {
  hashSeed,
  mulberry32,
  extractVegetation,
  buildFootprintIndex,
  scatterTrees,
  unitTreeGeometry,
} from "../../scripts/bake/lib/vegetation.mjs";
import { makeExcluder } from "../../scripts/bake/lib/exclusion.mjs";

// Slice 3 (trees): the scatter is load-bearing the same way the building emitter is — a wrong
// rejection ships trees inside buildings, a nondeterministic RNG breaks reproducible bakes.

describe("deterministic RNG", () => {
  it("hashSeed is stable and input-sensitive", () => {
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(1, 2, 4));
    expect(hashSeed(350500000, 484620000)).toBe(hashSeed(350500000, 484620000));
  });
  it("mulberry32 reproduces its sequence and stays in [0,1)", () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("extractVegetation", () => {
  const json = {
    elements: [
      { type: "node", lon: 35.05, lat: 48.46, tags: { natural: "tree", height: "12" } },
      { type: "node", lon: 35.06, lat: 48.46, tags: { natural: "peak" } }, // not a tree
      { type: "way", tags: { natural: "tree_row" }, geometry: [{ lon: 35.0, lat: 48.43 }, { lon: 35.001, lat: 48.43 }] },
      { type: "way", tags: { natural: "wood" }, geometry: [{ lon: 35.0, lat: 48.43 }, { lon: 35.01, lat: 48.43 }, { lon: 35.01, lat: 48.44 }] },
      { type: "way", tags: { landuse: "forest" }, geometry: [{ lon: 35.02, lat: 48.43 }, { lon: 35.03, lat: 48.43 }, { lon: 35.03, lat: 48.44 }] },
      { type: "way", tags: { leisure: "park" }, geometry: [{ lon: 35.04, lat: 48.43 }, { lon: 35.05, lat: 48.43 }, { lon: 35.05, lat: 48.44 }] },
      {
        type: "relation",
        tags: { natural: "wood" },
        members: [
          { role: "outer", geometry: [{ lon: 35.06, lat: 48.43 }, { lon: 35.07, lat: 48.43 }, { lon: 35.07, lat: 48.44 }] },
          { role: "inner", geometry: [{ lon: 35.064, lat: 48.434 }] },
        ],
      },
    ],
  };
  it("classifies points / rows / polys and keeps outer rings only", () => {
    const veg = extractVegetation(json);
    expect(veg.points).toHaveLength(1);
    expect(veg.points[0].tags.height).toBe("12");
    expect(veg.rows).toHaveLength(1);
    expect(veg.polys).toHaveLength(4); // wood way + forest way + park way + wood relation outer
    expect(veg.polys.filter((p) => p.kind === "wood")).toHaveLength(3);
    expect(veg.polys.filter((p) => p.kind === "park")).toHaveLength(1);
  });
});

describe("buildFootprintIndex", () => {
  it("blocks points inside a footprint, passes points outside", () => {
    const ring: [number, number][] = [[35.05, 48.46], [35.051, 48.46], [35.051, 48.461], [35.05, 48.461]];
    const idx = buildFootprintIndex([ring]);
    expect(idx.blocked(35.0505, 48.4605)).toBe(true);
    expect(idx.blocked(35.055, 48.4605)).toBe(false);
  });
});

describe("scatterTrees", () => {
  const bbox: [number, number, number, number] = [35.0, 48.42, 35.1, 48.5];
  // ~330 × 220 m wood block — big enough for a dense deterministic scatter.
  const wood = {
    ring: [[35.02, 48.45], [35.0245, 48.45], [35.0245, 48.452], [35.02, 48.452]] as [number, number][],
    kind: "wood" as const,
    tags: {},
  };

  it("is deterministic (two runs → identical placements)", () => {
    const veg = { points: [], rows: [], polys: [wood] };
    const a = scatterTrees(veg, { bbox });
    const b = scatterTrees(veg, { bbox });
    expect(a.placements.length).toBeGreaterThan(50);
    expect(a.placements).toEqual(b.placements);
  });

  it("tagged tree height wins; default heights stay in range", () => {
    const veg = {
      points: [{ lon: 35.05, lat: 48.46, tags: { height: "21" } }, { lon: 35.06, lat: 48.47, tags: {} }],
      rows: [],
      polys: [],
    };
    const { placements } = scatterTrees(veg, { bbox });
    expect(placements[0].heightM).toBe(21);
    expect(placements[1].heightM).toBeGreaterThanOrEqual(8);
    expect(placements[1].heightM).toBeLessThanOrEqual(15);
    for (const p of placements) expect(p.radiusM).toBeGreaterThan(0);
  });

  it("samples tree rows at the configured spacing", () => {
    // ~220 m straight row at 48.46°N → ≈ 24 trees at 9 m spacing.
    const veg = {
      points: [],
      rows: [{ line: [[35.05, 48.46], [35.053, 48.46]] as [number, number][], tags: {} }],
      polys: [],
    };
    const { placements, stats } = scatterTrees(veg, { bbox });
    expect(stats.rows).toBeGreaterThan(20);
    expect(stats.rows).toBeLessThan(30);
    expect(placements).toHaveLength(stats.rows);
  });

  it("rejects placements inside building footprints and C6 exclusion polygons", () => {
    const veg = { points: [], rows: [], polys: [wood] };
    const base = scatterTrees(veg, { bbox });
    // A footprint covering the wood's west half swallows roughly half the trees.
    const idx = buildFootprintIndex([[[35.02, 48.45], [35.0222, 48.45], [35.0222, 48.452], [35.02, 48.452]]]);
    const withFp = scatterTrees(veg, { bbox, footprintIndex: idx });
    expect(withFp.stats.rejectedBuilding).toBeGreaterThan(0);
    expect(withFp.placements.length).toBeLessThan(base.placements.length);
    // C6: an exclusion polygon over the whole wood kills every placement.
    const excluder = makeExcluder({ exclusion: { tags: [], polygons: [{ id: "site", ring: [[35.019, 48.449], [35.025, 48.449], [35.025, 48.453], [35.019, 48.453]] }] } });
    const withExcl = scatterTrees(veg, { bbox, excluder });
    expect(withExcl.placements).toHaveLength(0);
    expect(withExcl.stats.rejectedExcluded).toBe(base.placements.length);
  });

  it("clips to the bbox and thins deterministically to maxTrees", () => {
    const outside = { points: [{ lon: 34.9, lat: 48.46, tags: {} }], rows: [], polys: [] };
    expect(scatterTrees(outside, { bbox }).stats.rejectedOutside).toBe(1);

    const veg = { points: [], rows: [], polys: [wood] };
    const capped = scatterTrees(veg, { bbox, cfg: { maxTrees: 40 } });
    expect(capped.placements.length).toBeLessThanOrEqual(60); // hash-probability keep ≈ cap
    expect(capped.stats.thinned).toBeGreaterThan(0);
    expect(capped.placements).toEqual(scatterTrees(veg, { bbox, cfg: { maxTrees: 40 } }).placements);
  });

  it("does not double-plant where same-class polygons overlap", () => {
    const veg1 = { points: [], rows: [], polys: [wood] };
    const veg2 = { points: [], rows: [], polys: [wood, wood] }; // identical overlapping polys
    expect(scatterTrees(veg2, { bbox }).placements.length).toBe(scatterTrees(veg1, { bbox }).placements.length);
  });
});

describe("unitTreeGeometry", () => {
  it("emits a finite, unit-bounded, flat-shaded soup", () => {
    const { positions, normals } = unitTreeGeometry();
    expect(positions.length).toBe(normals.length);
    expect(positions.length % 9).toBe(0); // whole triangles
    expect(positions.every((v) => Number.isFinite(v))).toBe(true);
    let minY = Infinity, maxY = -Infinity, maxR = 0;
    for (let i = 0; i < positions.length; i += 3) {
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      maxR = Math.max(maxR, Math.hypot(positions[i], positions[i + 2]));
    }
    expect(minY).toBe(0); // trunk base on the ground
    expect(maxY).toBe(1); // unit height
    expect(maxR).toBeCloseTo(0.5, 5); // unit canopy radius
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 5);
    }
  });
});
