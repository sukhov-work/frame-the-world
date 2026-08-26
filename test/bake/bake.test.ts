import { describe, it, expect } from "vitest";
import { parseMeters, normalizeRoofShape, inferBuilding, signedArea, cleanRing, triangulate, obb, emitBuilding, skirtFor, skirtForSoup, SKIRT_MIN_EXTENT_M, SKIRT_MAX_BASE_M } from "../../scripts/bake/lib/buildings.mjs";
import { yExtent, metaRow, cellMetaJson, META_SCHEMA } from "../../scripts/bake/lib/meta.mjs";
import { makeExcluder, pointInPolygon } from "../../scripts/bake/lib/exclusion.mjs";
import { enuBasis, projectEN, geodeticToEcef } from "../../scripts/bake/lib/geo.mjs";
import { encodeGlb, regionRad } from "../../scripts/bake/lib/gltf.mjs";

// The bake is a reproducible offline pipeline (scripts/bake) — its pure geometry + inference logic is
// load-bearing (a wrong height/triangulation ships a broken building), so it is unit-gated like the
// projection/FOV/geohash math.

describe("parseMeters", () => {
  it("parses metres, units, and feet; rejects junk", () => {
    expect(parseMeters("12")).toBe(12);
    expect(parseMeters("12.5 m")).toBe(12.5);
    expect(parseMeters("12m")).toBe(12);
    expect(parseMeters("40'")).toBeCloseTo(12.192, 2);
    expect(parseMeters(null)).toBeNull();
    expect(parseMeters("tall")).toBeNull();
  });
});

describe("normalizeRoofShape", () => {
  it("maps families; unknown → flat", () => {
    expect(normalizeRoofShape("gabled")).toBe("gabled");
    expect(normalizeRoofShape("round")).toBe("gabled");
    expect(normalizeRoofShape("hipped")).toBe("pyramidal");
    expect(normalizeRoofShape("pyramidal")).toBe("pyramidal");
    expect(normalizeRoofShape("dome")).toBe("pyramidal");
    expect(normalizeRoofShape("skillion")).toBe("skillion");
    expect(normalizeRoofShape("mansard")).toBe("flat"); // unmodelled → safe flat
    expect(normalizeRoofShape(undefined)).toBe("flat");
  });
});

describe("inferBuilding", () => {
  const cfg = { levelHeightM: 3, defaultHeightM: 8, classDefaultsM: { church: 22 } };
  it("height tag wins", () => {
    const b = inferBuilding({ height: "15" }, cfg);
    expect(b.height).toBe(15);
    expect(b.heightSource).toBe("height");
  });
  it("building:levels × levelHeight", () => {
    const b = inferBuilding({ "building:levels": "5" }, cfg);
    expect(b.height).toBe(15);
    expect(b.heightSource).toBe("levels");
  });
  it("per-class default, then generic default", () => {
    expect(inferBuilding({ building: "church" }, cfg)).toMatchObject({ height: 22, heightSource: "class" });
    expect(inferBuilding({ building: "yes" }, cfg)).toMatchObject({ height: 8, heightSource: "default" });
  });
  it("base from min_height; roof from roof:height", () => {
    const b = inferBuilding({ height: "12", min_height: "3", "roof:shape": "gabled", "roof:height": "4" }, cfg);
    expect(b.base).toBe(3);
    expect(b.roofShape).toBe("gabled");
    expect(b.roofHeight).toBe(4);
    // The returned `height` is the EAVE: emitBuilding raises the ridge to height + roofHeight,
    // so 8 + 4 lands exactly on the tagged total of 12.
    expect(b.height).toBe(8);
  });

  // OSM's `height` is the TOTAL including the roof; `building:levels` counts storeys BELOW it.
  // Conflating the two made every co-tagged building render taller by exactly roof:height
  // (2026-08-26, the Chernobyl bake's New Safe Confinement).
  describe("roof:height is INSIDE a tagged height, but ON TOP of levels/defaults", () => {
    const ridge = (t: Record<string, string>) => {
      const b = inferBuilding(t, cfg);
      return b.height + (b.roofHeight ?? 0);
    };
    it("a tagged total height is preserved, not exceeded", () => {
      expect(ridge({ height: "20", "roof:shape": "gabled", "roof:height": "5" })).toBe(20);
      expect(ridge({ height: "20", "roof:shape": "gabled", "roof:levels": "2" })).toBe(20);
    });
    it("levels and class defaults still stack the roof on top", () => {
      expect(ridge({ "building:levels": "5", "roof:shape": "gabled", "roof:height": "4" })).toBe(19);
      expect(ridge({ building: "church", "roof:shape": "gabled", "roof:height": "6" })).toBe(28);
    });
    it("a building that is ALL roof keeps its tagged total and a 1 m wall to cap", () => {
      // w456732992, the New Safe Confinement: height=110 roof:height=110 roof:shape=round.
      // It used to come out a 220 m ridge. The wall must not collapse to zero — emitBuilding
      // caps the ring at the eave before raising the ridge.
      const b = inferBuilding({ height: "110", "roof:shape": "round", "roof:height": "110" }, cfg);
      expect(b.height).toBe(1);
      expect(b.roofHeight).toBe(109);
      expect(b.height + (b.roofHeight ?? 0)).toBe(110);
    });
    it("min_height is clamped against the EAVE, so walls never invert", () => {
      // Pre-fix this clamped against the pre-roof total and could seat the base ABOVE the wall
      // top, flipping every wall quad.
      const b = inferBuilding({ height: "20", min_height: "15", "roof:shape": "gabled", "roof:height": "8" }, cfg);
      expect(b.height).toBe(12);
      expect(b.base).toBeLessThan(b.height);
      expect(b.base).toBe(11);
    });
    it("no roof tags → untouched: height stays the eave and the pitch fills the roof", () => {
      expect(inferBuilding({ height: "15" }, cfg)).toMatchObject({ height: 15, roofHeight: null });
    });
  });

  it("clamps insane heights", () => {
    expect(inferBuilding({ "building:levels": "9999" }, cfg).height).toBe(400);
    expect(inferBuilding({ height: "0" }, cfg).height).toBe(2);
  });
});

describe("footprint helpers", () => {
  it("signedArea sign + cleanRing → CCW, dedups, drops closing point", () => {
    const cw = [[0, 0], [0, 1], [1, 1], [1, 0]]; // clockwise
    expect(signedArea(cw)).toBeLessThan(0);
    const ring = cleanRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]); // closed
    expect(ring).toHaveLength(4); // closing point dropped
    expect(signedArea(ring)).toBeGreaterThan(0); // forced CCW
    expect(cleanRing([[0, 0], [0.01, 0]])).toBeNull(); // degenerate
  });
});

describe("triangulate", () => {
  it("square → 2 tris; concave L → n-2 tris", () => {
    expect(triangulate([[0, 0], [1, 0], [1, 1], [0, 1]])).toHaveLength(2);
    const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]; // concave, CCW
    const tris = triangulate(L);
    expect(tris).toHaveLength(4); // simple polygon triangulates to n-2
    for (const [a, b, c] of tris) expect(new Set([a, b, c]).size).toBe(3); // no degenerate index tris
  });
});

describe("obb (PCA)", () => {
  it("recovers a 4×2 rectangle's extents", () => {
    const box = obb([[0, 0], [4, 0], [4, 2], [0, 2]]);
    const long = Math.max(box.halfLen, box.halfWid);
    const short = Math.min(box.halfLen, box.halfWid);
    expect(long).toBeCloseTo(2, 1);
    expect(short).toBeCloseTo(1, 1);
    expect(box.cx).toBeCloseTo(2, 1);
    expect(box.cy).toBeCloseTo(1, 1);
  });
});

describe("emitBuilding", () => {
  it("a flat-roof square box = 8 wall + 2 cap tris, one featureId per vertex", () => {
    const out = { positions: [], normals: [], featureIds: [] };
    emitBuilding([[0, 0], [10, 0], [10, 10], [0, 10]], { base: 0, height: 12, roofShape: "flat", roofHeight: null }, 7, out);
    expect(out.positions.length).toBe(10 * 3 * 3); // 10 tris × 3 verts × 3 floats
    expect(out.featureIds.length).toBe(30);
    expect(out.featureIds.every((f) => f === 7)).toBe(true);
    expect(out.positions.every((v) => Number.isFinite(v))).toBe(true);
  });
  it("a gabled box adds a ridge (more tris than flat) and stays finite", () => {
    const flat = { positions: [], normals: [], featureIds: [] };
    const gab = { positions: [], normals: [], featureIds: [] };
    const fp = [[0, 0], [12, 0], [12, 6], [0, 6]];
    emitBuilding(fp, { base: 0, height: 10, roofShape: "flat", roofHeight: null }, 0, flat);
    emitBuilding(fp, { base: 0, height: 10, roofShape: "gabled", roofHeight: null }, 0, gab);
    expect(gab.positions.length).toBeGreaterThan(flat.positions.length);
    expect(gab.positions.every((v) => Number.isFinite(v))).toBe(true);
  });
  it("skips a degenerate footprint", () => {
    const out = { positions: [], normals: [], featureIds: [] };
    emitBuilding([[0, 0], [0.01, 0]], { base: 0, height: 10, roofShape: "flat" }, 0, out);
    expect(out.positions.length).toBe(0);
  });
});

// RC13 — the base skirt. The point of these is the SHAPE of the fix as much as its effect: the
// audit's acceptance clause for S13 is "cell vert count +≤10 %", and lowering the rim is what
// makes that 0 % instead of the +59 % an appended course of quads measures on the o2w soup.
describe("emitBuilding — RC13 base skirt", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const bake = (params: Record<string, unknown>, cfg?: Record<string, unknown>) => {
    const out: { positions: number[]; normals: number[]; featureIds: number[] } =
      { positions: [], normals: [], featureIds: [] };
    emitBuilding(square, params, 0, out, cfg);
    const ys = out.positions.filter((_, i) => i % 3 === 1);
    return { out, minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const flat = { base: 0, height: 12, roofShape: "flat", roofHeight: null };

  it("costs ZERO extra vertices — it lowers the rim, it does not append a course", () => {
    const without = bake(flat, { skirtM: 0 });
    const with4 = bake(flat, { skirtM: 4 });
    expect(with4.out.positions.length).toBe(without.out.positions.length);
    expect(with4.out.featureIds.length).toBe(without.out.featureIds.length);
  });

  it("drops the wall bottom by exactly skirtM and leaves the roof alone", () => {
    expect(bake(flat, { skirtM: 0 })).toMatchObject({ minY: 0, maxY: 12 });
    expect(bake(flat, { skirtM: 4 })).toMatchObject({ minY: -4, maxY: 12 });
  });

  it("leaves a min_height mass alone — that gap is drawn on purpose", () => {
    // height=20 min_height=15 ⇒ a tower over a podium. Skirting it fills a hole the mapper meant.
    const raised = { base: 15, height: 20, roofShape: "flat", roofHeight: null };
    expect(bake(raised, { skirtM: 4 }).minY).toBe(15);
  });

  it("no config ⇒ no skirt (every pre-RC13 caller keeps its geometry)", () => {
    expect(bake(flat).minY).toBe(0);
    expect(bake(flat, {}).minY).toBe(0);
  });

  it("skirtFor: the rule is the base, not the height", () => {
    expect(skirtFor({ base: 0 }, { skirtM: 4 })).toBe(4);
    expect(skirtFor({ base: 0.2 }, { skirtM: 4 })).toBe(4); // inside SKIRT_MAX_BASE_M
    expect(skirtFor({ base: 3 }, { skirtM: 4 })).toBe(0);
    expect(skirtFor({ base: 0 }, { skirtM: 0 })).toBe(0);
    expect(skirtFor({ base: 0 }, {})).toBe(0);
  });
});

// The o2w half decides from geometry, because the adapter gets triangles and no tags.
describe("skirtForSoup — the OSM2World half", () => {
  const cfg = { skirtM: 4 };
  it("skirts an ordinary wall-bearing feature", () => {
    expect(skirtForSoup(0, 15, cfg)).toBe(4);
    expect(skirtForSoup(-0.5, 9, cfg)).toBe(4);
  });
  it("refuses a flat ribbon — Cliff and RetainingWall come back at minY === maxY === 0", () => {
    expect(skirtForSoup(0, 0, cfg)).toBe(0);
    expect(skirtForSoup(0, SKIRT_MIN_EXTENT_M - 1e-6, cfg)).toBe(0);
    expect(skirtForSoup(0, SKIRT_MIN_EXTENT_M, cfg)).toBe(4);
  });
  it("refuses a feature founded above the ground plane", () => {
    expect(skirtForSoup(SKIRT_MAX_BASE_M + 1e-6, 20, cfg)).toBe(0);
    expect(skirtForSoup(3, 20, cfg)).toBe(0);
  });
  it("is off by default", () => {
    expect(skirtForSoup(0, 15, {})).toBe(0);
    expect(skirtForSoup(0, 15, { skirtM: 0 })).toBe(0);
  });
});

// RC17 — the sidecar schema. `base`/`top` are MEASURED from emitted vertices in both bakers, so
// the row means the same thing whichever baker wrote it.
describe("meta sidecar (RC17)", () => {
  it("yExtent reads the Y column only, from a vertex offset", () => {
    const positions = [0, 5, 0, 1, 9, 1, 2, -3, 2];
    expect(yExtent(positions)).toEqual({ lo: -3, hi: 9 });
    expect(yExtent(positions, 1)).toEqual({ lo: -3, hi: 9 });
    expect(yExtent(positions, 2)).toEqual({ lo: -3, hi: -3 });
    expect(yExtent([], 0)).toBeNull();
    expect(yExtent(positions, 3)).toBeNull();
  });

  it("metaRow adds the skirt back, so `base` is the TRUE ground contact", () => {
    // A 12 m building skirted 4 m emits vertices from −4 to 12; the row must say base 0, top 12.
    expect(metaRow({ id: 3, osm: "w1", cls: "Building", lo: -4, hi: 12, skirt: 4, src: "levels" }))
      .toEqual({ id: 3, osm: "w1", cls: "Building", base: 0, top: 12, skirt: 4, src: "levels" });
  });

  it("metaRow keeps `top - base` equal to the real rendered height", () => {
    const r = metaRow({ id: 0, osm: null, cls: "Building", lo: 11, hi: 20, skirt: 0, src: "height" });
    expect(r.top - r.base).toBe(9); // a min_height mass: unskirted, and its real height is 9 m
    expect(r.osm).toBeNull();
  });

  it("cellMetaJson stamps the schema so the runtime can refuse a shape it does not know", () => {
    const j = JSON.parse(cellMetaJson({ variant: "dnipro-o2w", skirtM: 4, features: [] }));
    expect(j).toEqual({ schema: META_SCHEMA, variant: "dnipro-o2w", skirtM: 4, features: [] });
    expect(META_SCHEMA).toBeGreaterThanOrEqual(2);
  });
});

describe("C6 exclusion", () => {
  const excl = makeExcluder({});
  it("drops military + critical-infra, keeps ordinary buildings", () => {
    expect(excl({ building: "yes", military: "bunker" }, 35, 48)).toMatch(/military/);
    expect(excl({ building: "yes", power: "substation" }, 35, 48)).toBe("tag:power=substation");
    expect(excl({ landuse: "military" }, 35, 48)).toBe("tag:landuse=military");
    expect(excl({ building: "apartments" }, 35, 48)).toBeNull();
  });
  it("polygon exclusion via centroid", () => {
    const e = makeExcluder({ exclusion: { tags: [], polygons: [{ id: "site", ring: [[0, 0], [2, 0], [2, 2], [0, 2]] }] } });
    expect(e({ building: "yes" }, 1, 1)).toBe("polygon:site");
    expect(e({ building: "yes" }, 3, 3)).toBeNull();
    expect(pointInPolygon(1, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true);
  });
});

describe("geo projection", () => {
  const basis = enuBasis(48.462, 35.045);
  it("origin → [0,0]; 100 m east → e≈100,n≈0", () => {
    const o = projectEN(48.462, 35.045, basis);
    expect(Math.hypot(o[0], o[1])).toBeLessThan(0.01);
    const dLon = 100 / (111320 * Math.cos((48.462 * Math.PI) / 180));
    const east = projectEN(48.462, 35.045 + dLon, basis);
    expect(east[0]).toBeCloseTo(100, 0);
    expect(Math.abs(east[1])).toBeLessThan(1);
  });
  it("geodeticToEcef magnitude ≈ Earth radius", () => {
    const p = geodeticToEcef(48.462, 35.045, 0);
    expect(Math.hypot(p[0], p[1], p[2])).toBeGreaterThan(6.35e6);
    expect(Math.hypot(p[0], p[1], p[2])).toBeLessThan(6.39e6);
  });
});

describe("glb encoder", () => {
  const gltfJson = (glb: Buffer) => {
    expect(glb.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
    expect(glb.readUInt32LE(4)).toBe(2); // version
    expect(glb.readUInt32LE(8)).toBe(glb.length); // total length matches
    const jsonLen = glb.readUInt32LE(12);
    return JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
  };

  it("emits a valid GLB header + feature ids (buildings-only cell — structure unchanged by Slice 3)", () => {
    const glb = encodeGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], featureIds: [3, 3, 3] });
    const json = gltfJson(glb);
    expect(json.meshes[0].primitives[0].attributes._FEATURE_ID_0).toBe(2);
    expect(json.nodes).toHaveLength(1);
    expect(json.extensionsUsed).toBeUndefined(); // no trees → no instancing extension
  });

  it("emits an EXT_mesh_gpu_instancing tree node with TRS accessors matching the tree count", () => {
    const trees = {
      geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      translations: new Float32Array([5, 0, -5, 10, 0, -10]),
      rotations: new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]),
      scales: new Float32Array([2, 12, 2, 3, 9, 3]),
      count: 2,
    };
    const glb = encodeGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], featureIds: [3, 3, 3], trees });
    const json = gltfJson(glb);
    expect(json.extensionsUsed).toEqual(["EXT_mesh_gpu_instancing"]);
    expect(json.extensionsRequired).toBeUndefined(); // never required — graceful un-instanced fallback
    expect(json.nodes).toHaveLength(2);
    const treeNode = json.nodes[1];
    expect(treeNode.name).toBe("ftw-trees");
    const attrs = treeNode.extensions.EXT_mesh_gpu_instancing.attributes;
    for (const [key, type] of [["TRANSLATION", "VEC3"], ["ROTATION", "VEC4"], ["SCALE", "VEC3"]] as const) {
      const acc = json.accessors[attrs[key]];
      expect(acc.count).toBe(2);
      expect(acc.type).toBe(type);
    }
    // Tree base geometry is its own mesh with its own material.
    expect(json.meshes).toHaveLength(2);
    expect(json.materials[json.meshes[treeNode.mesh].primitives[0].material].name).toBe("ftw-trees");
    // All bufferViews must stay inside the binary chunk.
    for (const bv of json.bufferViews) expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
  });

  it("emits a tree-only cell (park at the bbox edge — no buildings mesh)", () => {
    const trees = {
      geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      translations: new Float32Array([1, 0, -1]),
      rotations: new Float32Array([0, 0, 0, 1]),
      scales: new Float32Array([2, 10, 2]),
      count: 1,
    };
    const json = gltfJson(encodeGlb({ positions: [], normals: [], featureIds: [], trees }));
    expect(json.nodes).toHaveLength(1);
    expect(json.nodes[0].name).toBe("ftw-trees");
    expect(json.nodes[0].extensions.EXT_mesh_gpu_instancing).toBeDefined();
  });

  it("regionRad converts degrees → radians", () => {
    const r = regionRad(35, 48, 36, 49, 0, 100);
    expect(r[0]).toBeCloseTo((35 * Math.PI) / 180, 6);
    expect(r[5]).toBe(100);
  });
});

describe("packTreeInstances", () => {
  it("maps ENU → glTF Y-up, yaw → +Y quaternion, unit tree → metre scale", async () => {
    const { packTreeInstances } = await import("../../scripts/bake/lib/vegetation.mjs");
    const { translations, rotations, scales, count } = packTreeInstances([
      { e: 100, n: 50, heightM: 12, radiusM: 2.5, yawRad: Math.PI },
    ]);
    expect(count).toBe(1);
    expect([...translations]).toEqual([100, 0, -50]); // (e, u=0, −n)
    expect(rotations[1]).toBeCloseTo(1, 6); // sin(π/2) about +Y
    expect(rotations[3]).toBeCloseTo(0, 6);
    expect(Math.hypot(rotations[0], rotations[1], rotations[2], rotations[3])).toBeCloseTo(1, 6);
    expect([...scales]).toEqual([5, 12, 5]); // radius 2.5 / unit 0.5 → 5; height 12
  });
});
