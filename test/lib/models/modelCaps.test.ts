import { describe, expect, it } from "vitest";
import {
  MODEL_ACCEPT,
  MODEL_CAPS,
  MODEL_FORMATS,
  MODEL_UNITS,
  TEXTURE_EDGE_LADDER,
  UNIT_SCALE,
  auditGlbSize,
  auditModelStats,
  auditRawSize,
  classifyDrop,
  decimationPlan,
  formatTris,
  modelFormatOf,
  suggestUnit,
  violationMessage,
  type ModelStats,
  type ModelViolation,
} from "../../../src/lib/models/modelCaps";

// MESH SUITE MS4 — the pure half of the D3 upload pipeline: the drop fork, the caps, the audit.

const names = (...n: string[]) => n.map((name) => ({ name }));

const healthy: ModelStats = {
  tris: 42_000,
  meshes: 6,
  textures: 3,
  maxTextureEdge: 2048,
  animations: 0,
  skinned: false,
  morphs: false,
  bbox: [12.4, 31.2, 8.0],
};

describe("classifyDrop — the photo|model fork", () => {
  it("an empty drop is nothing; a photo drop keeps the legacy FIRST-file path", () => {
    expect(classifyDrop([])).toEqual({ kind: "none" });
    expect(classifyDrop(names("DSC_4021.ARW"))).toEqual({ kind: "photo", index: 0 });
    expect(classifyDrop(names("a.jpg", "b.jpg"))).toEqual({ kind: "photo", index: 0 });
  });

  it("recognises every model format, case-insensitively, and only those", () => {
    for (const f of MODEL_FORMATS) {
      expect(modelFormatOf(`thing.${f}`)).toBe(f);
      expect(modelFormatOf(`THING.${f.toUpperCase()}`)).toBe(f);
      expect(MODEL_ACCEPT).toContain(`.${f}`);
    }
    expect(modelFormatOf("photo.jpeg")).toBeNull();
    expect(modelFormatOf("scene.bin")).toBeNull();
    expect(modelFormatOf("noext")).toBeNull();
  });

  it("a single .glb is a model drop with no companions", () => {
    expect(classifyDrop(names("tower.glb"))).toEqual({
      kind: "model",
      index: 0,
      format: "glb",
      companions: [],
      ignored: [],
    });
  });

  it("a .gltf with its buffer + textures resolves the model wherever it sits in the list", () => {
    const c = classifyDrop(names("albedo.png", "scene.gltf", "scene.bin"));
    expect(c).toEqual({ kind: "model", index: 1, format: "gltf", companions: [0, 2], ignored: [] });
  });

  it("an OBJ + MTL pair is a model drop; a photo beside a model is a companion, not a second intent", () => {
    expect(classifyDrop(names("house.obj", "house.mtl"))).toMatchObject({ kind: "model", format: "obj", companions: [1] });
    expect(classifyDrop(names("ref.jpg", "house.fbx"))).toMatchObject({ kind: "model", index: 1, format: "fbx", companions: [0] });
  });

  it("only ONE model per drop — extra model files are named and ignored", () => {
    const c = classifyDrop(names("a.glb", "b.glb", "c.obj"));
    expect(c).toMatchObject({ kind: "model", index: 0, format: "glb", companions: [], ignored: ["b.glb", "c.obj"] });
  });
});

describe("auditModelStats — the caps as a verdict", () => {
  it("a healthy model passes clean: no violations, no decimation, no warnings", () => {
    expect(auditModelStats(healthy)).toEqual({ violations: [], decimateTo: null, warnings: [] });
  });

  it("triangles over budget become a DECIMATION target, never a refusal", () => {
    const a = auditModelStats({ ...healthy, tris: 312_400 });
    expect(a.violations).toEqual([]);
    expect(a.decimateTo).toBe(MODEL_CAPS.maxTris);
    expect(auditModelStats({ ...healthy, tris: MODEL_CAPS.maxTris }).decimateTo).toBeNull();
  });

  it("names every hard refusal: meshes, textures, rigging, empty", () => {
    const codes = (s: Partial<ModelStats>) => auditModelStats({ ...healthy, ...s }).violations.map((v) => v.code);
    expect(codes({ meshes: MODEL_CAPS.maxMeshes + 1 })).toEqual(["TOO_MANY_MESHES"]);
    expect(codes({ meshes: MODEL_CAPS.maxMeshes })).toEqual([]);
    expect(codes({ textures: MODEL_CAPS.maxTextures + 1 })).toEqual(["TOO_MANY_TEXTURES"]);
    expect(codes({ skinned: true })).toEqual(["RIGGED"]);
    expect(codes({ morphs: true })).toEqual(["RIGGED"]);
    expect(codes({ tris: 0 })).toEqual(["EMPTY"]);
    expect(codes({ tris: Number.NaN })).toEqual(["EMPTY"]);
  });

  it("oversize textures and animations are WARNINGS (downscaled / dropped), not refusals", () => {
    const a = auditModelStats({ ...healthy, maxTextureEdge: 4096, animations: 2 });
    expect(a.violations).toEqual([]);
    expect(a.warnings).toEqual([
      "TEXTURES DOWNSCALED TO 2048² (WAS 4096²)",
      "2 ANIMATIONS DROPPED — MODELS ARE STATIC",
    ]);
    expect(auditModelStats({ ...healthy, animations: 1 }).warnings).toEqual(["1 ANIMATION DROPPED — MODELS ARE STATIC"]);
  });

  it("the byte gates pass AT the cap and refuse one byte past it", () => {
    expect(auditRawSize(MODEL_CAPS.maxRawBytes)).toBeNull();
    expect(auditRawSize(MODEL_CAPS.maxRawBytes + 1)).toMatchObject({ code: "RAW_TOO_LARGE", max: MODEL_CAPS.maxRawBytes });
    expect(auditGlbSize(MODEL_CAPS.maxGlbBytes, 512)).toBeNull();
    expect(auditGlbSize(MODEL_CAPS.maxGlbBytes + 1, 512)).toMatchObject({ code: "GLB_TOO_LARGE", edge: 512 });
  });

  it("the caps themselves are the ratified numbers (MESH_SUITE_PLAN §1 / §4)", () => {
    expect(MODEL_CAPS).toEqual({
      maxTris: 100_000,
      maxTextureEdge: 2048,
      maxTextures: 8,
      maxMeshes: 25,
      maxRawBytes: 15 * 1024 * 1024,
      maxGlbBytes: 8 * 1024 * 1024,
    });
    expect(TEXTURE_EDGE_LADDER).toEqual([2048, 1024, 512]);
  });
});

describe("decimationPlan — proportional per-mesh targets", () => {
  it("within budget: the plan is the identity", () => {
    expect(decimationPlan([30_000, 20_000], [false, false], 100_000)).toEqual([30_000, 20_000]);
  });

  it("over budget: every free mesh shrinks by the same ratio and the sum fits", () => {
    const plan = decimationPlan([300_000, 100_000], [false, false], 100_000)!;
    expect(plan).toEqual([75_000, 25_000]);
    expect(plan.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100_000);
  });

  it("locked (multi-material) meshes keep their count and shrink the others' budget", () => {
    const plan = decimationPlan([40_000, 120_000], [true, false], 100_000)!;
    expect(plan[0]).toBe(40_000);
    expect(plan[1]).toBe(60_000);
  });

  it("impossible when the locked meshes alone bust the cap", () => {
    expect(decimationPlan([120_000, 10], [true, false], 100_000)).toBeNull();
  });

  it("keeps at least one triangle per non-empty mesh, leaves empty meshes empty, and still fits", () => {
    const counts = [0, 5, 5, 5, 1_000_000];
    const plan = decimationPlan(counts, counts.map(() => false), 100_000)!;
    expect(plan[0]).toBe(0);
    expect(plan.slice(1, 4).every((t) => t >= 1)).toBe(true);
    expect(plan.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100_000);
  });

  it("a swarm of tiny meshes that cannot all keep one triangle is impossible", () => {
    const counts = Array.from({ length: 50 }, () => 10);
    expect(decimationPlan(counts, counts.map(() => false), 40)).toBeNull();
  });
});

describe("units + formatting", () => {
  it("guesses metres for building-sized extents, centimetres and millimetres past the thresholds", () => {
    expect(suggestUnit(31)).toBe("m");
    expect(suggestUnit(600)).toBe("m");
    expect(suggestUnit(3_100)).toBe("cm");
    expect(suggestUnit(60_000)).toBe("cm");
    expect(suggestUnit(310_000)).toBe("mm");
    expect(suggestUnit(0)).toBe("m");
    expect(suggestUnit(Number.NaN)).toBe("m");
  });

  it("the unit table covers every listed unit with metres-per-unit", () => {
    for (const u of MODEL_UNITS) expect(UNIT_SCALE[u]).toBeGreaterThan(0);
    expect(UNIT_SCALE.m).toBe(1);
    expect(UNIT_SCALE.cm).toBe(0.01);
    expect(UNIT_SCALE.ft).toBeCloseTo(0.3048);
  });

  it("formats triangle counts the way the card reads them", () => {
    expect(formatTris(312_400)).toBe("312K");
    expect(formatTris(98_400)).toBe("98.4K");
    expect(formatTris(7_300)).toBe("7,300");
    expect(formatTris(Number.NaN)).toBe("—");
  });

  it("every violation code has member-facing copy with its numbers in it", () => {
    const all: ModelViolation[] = [
      { code: "RAW_TOO_LARGE", bytes: 20 * 1024 * 1024, max: MODEL_CAPS.maxRawBytes },
      { code: "GLB_TOO_LARGE", bytes: 9 * 1024 * 1024, max: MODEL_CAPS.maxGlbBytes, edge: 512 },
      { code: "TOO_MANY_MESHES", count: 40, max: 25 },
      { code: "TOO_MANY_TEXTURES", count: 12, max: 8 },
      { code: "TOO_MANY_TRIS", count: 250_000, max: 100_000 },
      { code: "RIGGED" },
      { code: "EMPTY" },
      { code: "UNSUPPORTED_COMPRESSION" },
    ];
    for (const v of all) {
      const m = violationMessage(v);
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toContain("undefined");
    }
    expect(violationMessage(all[2])).toContain("40 MESHES");
    expect(violationMessage(all[1])).toContain("512²");
    expect(violationMessage(all[4])).toContain("250K");
  });
});
