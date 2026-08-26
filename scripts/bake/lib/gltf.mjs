// glTF 2.0 binary (GLB) encoder + 3D-Tiles 1.1 tileset writer for the bake.
//
// Generalized from scripts/build-sample-dnipro-tiles.mjs (the browser-VERIFIED Slice-0 writer):
// same Y-up authoring + region bounding volume + ENU→ECEF root transform, now driven by real
// geometry and emitting a per-building `_FEATURE_ID_0` (3D-Tiles 1.1) so Slice 2 can drive the
// shared building material's per-building tonal variation (buildings.ts reads `_feature_id_0`).

import { Buffer } from "node:buffer";
import { enuToEcefMatrix, DEG } from "./geo.mjs";

const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const MODE_TRIANGLES = 4;

function pad4(buf, padByte) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, padByte)]);
}

/**
 * Encode one cell to a GLB buffer: an optional buildings triangle-soup mesh + an optional
 * `EXT_mesh_gpu_instancing` tree node (Slice 3 — verified default-supported by three ≥0.185
 * GLTFLoader, which turns it into ONE `InstancedMesh` per cell; the runtime detects it via
 * `isInstancedMesh` and swaps in the shared tree material).
 * @param {{positions:number[]|Float32Array, normals:number[]|Float32Array, featureIds?:number[]|Float32Array,
 *          trees?:{geometry:{positions:number[], normals:number[]},
 *                  translations:Float32Array, rotations:Float32Array, scales:Float32Array, count:number}}} m
 * @returns {Buffer}
 */
export function encodeGlb({ positions, normals, featureIds, trees }) {
  const bufferViews = [], accessors = [], meshes = [], nodes = [], binParts = [];
  let byteOffset = 0;
  const treeCount = trees?.count ?? 0;

  // Accessor writer: appends one typed-array bufferView + accessor, returns the accessor index.
  // Vertex data gets the ARRAY_BUFFER target hint; instance TRS data carries none (per the
  // EXT_mesh_gpu_instancing usage — three's parser only slices bytes either way).
  const addAccessor = (f32, type, { target, minMax } = {}) => {
    const bytes = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const compCount = type === "VEC3" ? 3 : type === "VEC4" ? 4 : 1;
    const count = f32.length / compCount;
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target) view.target = ARRAY_BUFFER;
    bufferViews.push(view);
    const acc = { bufferView: bufferViews.length - 1, componentType: FLOAT, count, type };
    if (minMax) {
      const mn = Array(compCount).fill(Infinity), mx = Array(compCount).fill(-Infinity);
      for (let i = 0; i < f32.length; i += compCount) {
        for (let k = 0; k < compCount; k++) {
          const v = f32[i + k];
          if (v < mn[k]) mn[k] = v;
          if (v > mx[k]) mx[k] = v;
        }
      }
      acc.min = mn;
      acc.max = mx;
    }
    accessors.push(acc);
    binParts.push(bytes);
    byteOffset += bytes.length;
    return accessors.length - 1;
  };

  const materials = [
    { name: "ftw-enriched", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.55, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  ];

  // Buildings mesh (absent for tree-only cells, e.g. a park at the bbox edge).
  const pos = new Float32Array(positions);
  if (pos.length > 0) {
    const attributes = {
      POSITION: addAccessor(pos, "VEC3", { target: true, minMax: true }),
      NORMAL: addAccessor(new Float32Array(normals), "VEC3", { target: true }),
    };
    if (featureIds) {
      // three's GLTFLoader → geometry.attributes._feature_id_0
      attributes._FEATURE_ID_0 = addAccessor(new Float32Array(featureIds), "SCALAR", { target: true });
    }
    meshes.push({ primitives: [{ attributes, material: 0, mode: MODE_TRIANGLES }] });
    nodes.push({ mesh: meshes.length - 1 });
  }

  // Instanced trees node.
  if (treeCount > 0) {
    materials.push({
      name: "ftw-trees",
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.32, 0.24, 1], metallicFactor: 0, roughnessFactor: 1 },
    });
    meshes.push({
      primitives: [{
        attributes: {
          POSITION: addAccessor(new Float32Array(trees.geometry.positions), "VEC3", { target: true, minMax: true }),
          NORMAL: addAccessor(new Float32Array(trees.geometry.normals), "VEC3", { target: true }),
        },
        material: materials.length - 1,
        mode: MODE_TRIANGLES,
      }],
    });
    nodes.push({
      name: "ftw-trees",
      mesh: meshes.length - 1,
      extensions: {
        EXT_mesh_gpu_instancing: {
          attributes: {
            TRANSLATION: addAccessor(trees.translations, "VEC3", { minMax: true }),
            ROTATION: addAccessor(trees.rotations, "VEC4"),
            SCALE: addAccessor(trees.scales, "VEC3"),
          },
        },
      },
    });
  }

  const binLength = binParts.reduce((s, b) => s + b.length, 0);
  const gltf = {
    asset: { version: "2.0", generator: "frame-the-world/bake" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  // extensionsUsed only (NOT extensionsRequired): three supports it natively; a loader without
  // support would fall back to one un-instanced tree rather than refusing the whole tile.
  if (treeCount > 0) gltf.extensionsUsed = ["EXT_mesh_gpu_instancing"];

  const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20); // space-pad
  const binBuf = pad4(Buffer.concat(binParts), 0x00); // zero-pad

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, binBuf)]);
}

/** Geographic region bounding volume (radians) for a [west,south,east,north] deg cell + height span. */
export function regionRad(westD, southD, eastD, northD, minH, maxH) {
  return [westD * DEG, southD * DEG, eastD * DEG, northD * DEG, minH, maxH];
}

/**
 * Build a 3D-Tiles 1.1 tileset over a grid of leaf cells. All cells share ONE ENU→ECEF root
 * transform (origin at the bake centre) — children inherit it, so the runtime R1 re-seat (one
 * group translation) seats every cell at once, exactly as it does the single-tile Slice-0 sample.
 * Each child carries a geographic region bounding volume → the renderer culls/streams per cell.
 */
export function buildTileset({ originLatDeg, originLonDeg, bboxRegionRad, rootGeometricError, cells, version }) {
  return {
    asset: { version: "1.1", tilesetVersion: version ?? "dnipro-1" },
    geometricError: rootGeometricError,
    root: {
      transform: enuToEcefMatrix(originLatDeg, originLonDeg, 0),
      boundingVolume: { region: bboxRegionRad },
      geometricError: rootGeometricError,
      refine: "ADD",
      // CACHE BUST (2026-08-26, with the RC13/RC17 re-bake). The R2 worker serves `.glb` as
      // `max-age=31536000, immutable` and re-bakes REUSE FILENAMES, so a browser that already
      // holds a cell would never see a new bake — for a year. Stamping the tileset version into
      // the content uri makes each bake a distinct cache key, and it propagates within the 5
      // minutes `tileset.json` is cached. Safe against the loader: content dispatch reads the
      // glTF MAGIC BYTES and only falls back to the extension (`TilesRenderer.parseTile`), and
      // the working path is derived by stripping the last path segment.
      // The RUNTIME strips this back off — `cell.uri` must stay the bare basename or every U8
      // override row and every banked cell seat would be invalidated by a version bump alone.
      children: cells.map((c) => ({
        boundingVolume: { region: c.regionRad },
        geometricError: c.geometricError ?? 0,
        content: { uri: version ? `${c.contentUri}?v=${encodeURIComponent(version)}` : c.contentUri },
      })),
    },
  };
}
