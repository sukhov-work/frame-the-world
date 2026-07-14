import { describe, it, expect } from "vitest";
import { parseMeters, normalizeRoofShape, inferBuilding, signedArea, cleanRing, triangulate, obb, emitBuilding } from "../../scripts/bake/lib/buildings.mjs";
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
