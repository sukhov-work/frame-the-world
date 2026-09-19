import { describe, expect, it } from "vitest";
import { boxGlb, PRIMITIVE_MIME, primitiveById, primitiveFile, PRIMITIVES } from "../../../src/lib/models/primitives";
import { auditRawSize, classifyDrop, suggestUnit } from "../../../src/lib/models/modelCaps";
import { safeModelFileName } from "../../../src/lib/wix/modelRecords";

/** Split a GLB into its parsed JSON chunk and its BIN chunk (asserting the container on the way). */
function readGlb(glb: Uint8Array) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const binLen = dv.getUint32(binAt, true);
  expect(dv.getUint32(binAt + 4, true)).toBe(0x004e4942); // "BIN\0"
  expect(binLen % 4).toBe(0);
  expect(binAt + 8 + binLen).toBe(glb.byteLength);
  const bin = glb.slice(binAt + 8, binAt + 8 + binLen);
  return { json, bin };
}

describe("primitives — the box GLB writer", () => {
  it("writes a valid glTF-2.0 binary container: header, padded JSON chunk, BIN chunk", () => {
    const { json, bin } = readGlb(boxGlb(5, 5, 5));
    expect(json.asset.version).toBe("2.0");
    expect(json.buffers[0].byteLength).toBe(bin.byteLength);
    expect(json.accessors.map((a: { count: number }) => a.count)).toEqual([24, 24, 36]);
  });

  it("is exactly w × h × d metres, footprint centred, BASE at y = 0 (it stands on the ground)", () => {
    const { json, bin } = readGlb(boxGlb(5, 7, 3));
    expect(json.accessors[0].min).toEqual([-2.5, 0, -1.5]);
    expect(json.accessors[0].max).toEqual([2.5, 7, 1.5]);
    // …and the declared bounds are the DATA's bounds, not just a claim.
    const pos = new Float32Array(bin.buffer, 0, 72);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 72; i++) {
      min[i % 3] = Math.min(min[i % 3], pos[i]);
      max[i % 3] = Math.max(max[i % 3], pos[i]);
    }
    expect(min).toEqual([-2.5, 0, -1.5]);
    expect(max).toEqual([2.5, 7, 1.5]);
  });

  it("every triangle winds counter-clockwise seen from outside: its face normal IS its vertex normal", () => {
    const { bin } = readGlb(boxGlb(5, 5, 5));
    const pos = new Float32Array(bin.buffer, 0, 72);
    const nor = new Float32Array(bin.buffer, 288, 72);
    const idx = new Uint16Array(bin.buffer, 576, 36);
    const v = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (let t = 0; t < 12; t++) {
      const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
      const [pa, pb, pc] = [v(a), v(b), v(c)];
      const e1 = pb.map((x, i) => x - pa[i]);
      const e2 = pc.map((x, i) => x - pa[i]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(cr[0], cr[1], cr[2]);
      expect(len).toBeGreaterThan(0);
      for (const vi of [a, b, c]) {
        const n = [nor[vi * 3], nor[vi * 3 + 1], nor[vi * 3 + 2]];
        expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12);
        expect((cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]) / len).toBeCloseTo(1, 6);
      }
    }
  });

  it("carries ONE matte material (the glTF default is metallic 1 — near-black without an env map)", () => {
    const { json } = readGlb(boxGlb(5, 5, 5));
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(json.meshes[0].primitives[0]).toMatchObject({ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 });
  });

  it("refuses a degenerate size", () => {
    for (const s of [[0, 5, 5], [5, -1, 5], [5, 5, NaN], [Infinity, 5, 5]] as const) {
      expect(() => boxGlb(s[0], s[1], s[2])).toThrow(/boxGlb/);
    }
  });

  it("round-trips through the REAL GLTFLoader as one 12-triangle mesh of the declared size", async () => {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const THREE = await import("three");
    const bytes = boxGlb(5, 5, 5);
    const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer as ArrayBuffer, "");
    const box = new THREE.Box3().setFromObject(gltf.scene);
    expect(box.min.toArray()).toEqual([-2.5, 0, -2.5]);
    expect(box.max.toArray()).toEqual([2.5, 5, 2.5]);
    let meshes = 0;
    let tris = 0;
    gltf.scene.traverse((o) => {
      const m = o as InstanceType<typeof THREE.Mesh>;
      if (!m.isMesh) return;
      meshes++;
      tris += (m.geometry.index?.count ?? 0) / 3;
      const mat = m.material as InstanceType<typeof THREE.MeshStandardMaterial>;
      expect(mat.isMeshStandardMaterial).toBe(true);
      expect(mat.metalness).toBe(0);
      expect(mat.flatShading).toBe(false); // it has real normals
      expect(mat.emissive).toBeDefined(); // the armed highlight's slot
    });
    expect(meshes).toBe(1);
    expect(tris).toBe(12);
  });
});

describe("primitives — the registry walks the UPLOADED model's door", () => {
  it("ids are unique; the first entry is the owner's 5 × 5 × 5 m box", () => {
    expect(new Set(PRIMITIVES.map((p) => p.id)).size).toBe(PRIMITIVES.length);
    expect(PRIMITIVES[0]).toMatchObject({ id: "box-5m", sizeM: [5, 5, 5], title: "BOX 5 m" });
    expect(primitiveById("nope")).toBeNull();
  });

  it("every primitive passes the drop's own gates: a .glb name, the raw-size cap, metres", () => {
    for (const p of PRIMITIVES) {
      const bytes = p.build();
      expect(classifyDrop([{ name: p.fileName }])).toMatchObject({ kind: "model", format: "glb", index: 0 });
      expect(auditRawSize(bytes.byteLength)).toBeNull();
      expect(safeModelFileName(p.fileName)).toMatch(/\.glb$/);
      expect(suggestUnit(Math.max(...p.sizeM))).toBe("m");
      const { json } = readGlb(bytes);
      const { min, max } = json.accessors[0];
      expect(max.map((v: number, i: number) => v - min[i])).toEqual([...p.sizeM]);
    }
  });

  it("primitiveFile is the File `begin()` takes (null for an unknown id)", async () => {
    const f = primitiveFile("box-5m");
    expect(f).not.toBeNull();
    expect(f!.name).toBe("box-5m.glb");
    expect(f!.type).toBe(PRIMITIVE_MIME);
    expect(new Uint8Array(await f!.arrayBuffer())).toEqual(boxGlb(5, 5, 5));
    expect(primitiveFile("nope")).toBeNull();
  });
});
