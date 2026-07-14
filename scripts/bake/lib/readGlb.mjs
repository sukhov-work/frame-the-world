// readGlb — the inverse of scripts/bake/lib/gltf.mjs `encodeGlb`. Parses a binary glTF (GLB) into
// { json, bin } and reads any accessor into a flat JS array (handles indexed/non-indexed, interleaved
// byteStride, and all component types). This is the load-bearing piece the OSM2World adapter
// (bake-osm2world.mjs) needs: OSM2World emits glb → we re-bin its triangles into our grid and
// re-emit via encodeGlb. Promoted verbatim from the browser-VERIFIED Slice-1.5 spike
// (scripts/bake/spike-osm2world/readGlb.mjs), plus Buffer input for round-trip tests.

import { readFileSync } from "node:fs";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const COMP = {
  5120: { name: "BYTE", bytes: 1, get: (dv, o) => dv.getInt8(o) },
  5121: { name: "UBYTE", bytes: 1, get: (dv, o) => dv.getUint8(o) },
  5122: { name: "SHORT", bytes: 2, get: (dv, o) => dv.getInt16(o, true) },
  5123: { name: "USHORT", bytes: 2, get: (dv, o) => dv.getUint16(o, true) },
  5125: { name: "UINT", bytes: 4, get: (dv, o) => dv.getUint32(o, true) },
  5126: { name: "FLOAT", bytes: 4, get: (dv, o) => dv.getFloat32(o, true) },
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Parse a GLB (file path or Buffer) → { version, byteLength, json, bin:Buffer }. */
export function readGlb(src) {
  const buf = Buffer.isBuffer(src) ? src : readFileSync(src);
  const label = Buffer.isBuffer(src) ? "<buffer>" : src;
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${label}: not a GLB (bad magic)`);
  const version = buf.readUInt32LE(4);
  const byteLength = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off + 8 <= byteLength) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error(`${label}: no JSON chunk`);
  return { version, byteLength, json, bin: bin ?? Buffer.alloc(0) };
}

/** Read accessor `idx` → { array:number[], nComp, count, comp, min, max, normalized }. */
export function readAccessor(json, bin, idx) {
  const acc = json.accessors[idx];
  const comp = COMP[acc.componentType];
  const nc = NCOMP[acc.type];
  const count = acc.count;
  const out = new Array(count * nc);
  if (acc.bufferView == null) { out.fill(0); return { array: out, nComp: nc, count, comp: comp.name, min: acc.min, max: acc.max }; }
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride || comp.bytes * nc;
  const base = bin.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer);
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    for (let k = 0; k < nc; k++) out[i * nc + k] = comp.get(dv, o + k * comp.bytes);
  }
  return { array: out, nComp: nc, count, comp: comp.name, min: acc.min, max: acc.max, normalized: !!acc.normalized };
}

/** Return a primitive's triangle vertex indices (explicit, or implied 0..N for non-indexed). */
export function readIndices(json, bin, prim, positionCount) {
  if (prim.indices == null) return Array.from({ length: positionCount }, (_, i) => i);
  return readAccessor(json, bin, prim.indices).array;
}
