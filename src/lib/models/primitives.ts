/**
 * PREDEFINED PRIMITIVES (owner order 2026-09-19) — "apart from uploading a mesh, a quick option to
 * add the simplest predefined box (5 × 5 × 5 m), stored as a user mesh; maybe other primitives
 * later".
 *
 * THE SHAPE. A primitive is NOT a second kind of model: it is a tiny GLB this file writes in
 * memory and hands to the SAME door an uploaded file walks through
 * (`store/modelUpload.begin([file], 0, "glb")`). Everything downstream — the caps audit, the
 * re-export, the thumbnail, the Media PUT, the `UserModels` row, MY MODELS, placement, the gizmo,
 * lift, delete — is the uploaded model's path byte for byte, so a box can do nothing an upload
 * cannot and nothing new can break on it. The record's `sourceFormat` stays `"glb"`; no server,
 * scene or schema change.
 *
 * THE REGISTRY. `PRIMITIVES` is the list the dialogs map over; one more entry (+ its writer) is
 * one more button. Pure — no three, no DOM, no `Buffer` (typed arrays + DataView), so the writer is
 * unit-pinned under vitest/node and round-tripped through the real `GLTFLoader`
 * (`test/lib/models/primitives.test.ts`).
 *
 * WHY NORMALS AND A MATERIAL. A primitive without a `NORMAL` attribute makes GLTFLoader flat-shade
 * by derivative (fine) but a primitive without a MATERIAL gets the glTF default — metallic 1 —
 * which renders near-black with no environment map. The box therefore carries 24 vertices (4 per
 * face, true face normals) and one matte neutral material whose `emissive` slot the armed
 * highlight (`scene/userModels.ts`) can drive.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const FLOAT = 5126;
const USHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export const PRIMITIVE_MIME = "model/gltf-binary";

/**
 * A w × h × d metre box as a glTF-2.0 binary: Y-up, metres (the glTF spec's own frame), the
 * footprint centred on the origin and the BASE at y = 0 — it stands on the ground as authored
 * (`groundFitOffset` would re-base it identically either way). Counter-clockwise winding seen
 * from outside, so the faces agree with their normals.
 */
export function boxGlb(w: number, h: number, d: number): Uint8Array {
  if (!(w > 0) || !(h > 0) || !(d > 0) || ![w, h, d].every(Number.isFinite)) {
    throw new Error(`boxGlb: the size must be finite and > 0 (got ${w} × ${h} × ${d})`);
  }
  const x = w / 2;
  const z = d / 2;
  // Each face: its outward normal + four corners, counter-clockwise seen from OUTSIDE.
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]] },
    { n: [-1, 0, 0], v: [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]] },
    { n: [0, 1, 0], v: [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]] },
    { n: [0, -1, 0], v: [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]] },
    { n: [0, 0, 1], v: [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]] },
    { n: [0, 0, -1], v: [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]] },
  ];
  const pos = new Float32Array(24 * 3);
  const nor = new Float32Array(24 * 3);
  const idx = new Uint16Array(36);
  faces.forEach((f, fi) => {
    f.v.forEach((p, vi) => {
      pos.set(p, (fi * 4 + vi) * 3);
      nor.set(f.n, (fi * 4 + vi) * 3);
    });
    const b = fi * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], fi * 6);
  });

  const binLen = pos.byteLength + nor.byteLength + idx.byteLength; // 288 + 288 + 72 — already ÷ 4
  const json = {
    asset: { version: "2.0", generator: "plux primitives" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "box" }],
    meshes: [{ name: "box", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        name: "plux-primitive",
        pbrMetallicRoughness: { baseColorFactor: [0.78, 0.78, 0.76, 1], metallicFactor: 0, roughnessFactor: 0.85 },
      },
    ],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: ELEMENT_ARRAY_BUFFER },
    ],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: 24, type: "VEC3", min: [-x, 0, -z], max: [x, h, z] },
      { bufferView: 1, componentType: FLOAT, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: USHORT, count: 36, type: "SCALAR" },
    ],
  };

  // The JSON chunk is padded with SPACES, the BIN chunk with zeros, each to a 4-byte boundary.
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(jsonRaw.byteLength / 4) * 4;
  const binPadded = Math.ceil(binLen / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binPadded;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonRaw, 20);
  const binAt = 20 + jsonLen;
  dv.setUint32(binAt, binPadded, true);
  dv.setUint32(binAt + 4, CHUNK_BIN, true);
  out.set(new Uint8Array(pos.buffer), binAt + 8);
  out.set(new Uint8Array(nor.buffer), binAt + 8 + pos.byteLength);
  out.set(new Uint8Array(idx.buffer), binAt + 8 + pos.byteLength + nor.byteLength);
  return out;
}

export interface PrimitiveDef {
  id: string;
  /** The dialog button's text. */
  label: string;
  /** The model's title in MY MODELS (the member can rename it on the CHECK card). */
  title: string;
  /** The synthetic source file's name — `.glb`, so every file-name rule downstream holds. */
  fileName: string;
  /** Width (E–W) × height × depth, metres. */
  sizeM: readonly [number, number, number];
  build(): Uint8Array;
}

export const PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  Object.freeze({
    id: "box-5m",
    label: "▣ ADD A BOX — 5 × 5 × 5 m",
    title: "BOX 5 m",
    fileName: "box-5m.glb",
    sizeM: [5, 5, 5] as const,
    build: () => boxGlb(5, 5, 5),
  }),
]);

export function primitiveById(id: string): PrimitiveDef | null {
  return PRIMITIVES.find((p) => p.id === id) ?? null;
}

/** The primitive as the `File` the upload pipeline expects, or null for an unknown id / a runtime
 *  without `File` (SSR). */
export function primitiveFile(id: string): File | null {
  const def = primitiveById(id);
  if (!def || typeof File === "undefined") return null;
  const bytes = def.build();
  // A fresh ArrayBuffer-backed copy: `BlobPart` rejects a `Uint8Array<ArrayBufferLike>` under TS 5.7+.
  return new File([bytes.slice().buffer as ArrayBuffer], def.fileName, { type: PRIMITIVE_MIME });
}
