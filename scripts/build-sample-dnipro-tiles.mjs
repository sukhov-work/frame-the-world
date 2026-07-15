// Build a HAND-BAKED sample 3D-Tiles set for the Dnipro-enrichment Slice-0 de-risk spike.
//
// This is deliberately crude synthetic data (a dozen extruded central-Dnipro blocks, a couple with
// gable roofs) — its job is to validate the INTEGRATION (a 3rd TilesRenderer at a plain URL, masking
// the Cesium OSM Buildings underneath, and the R1 vertical-datum seating strategy), NOT data quality.
// See `.claude/claude-docs/dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md` §Slice 0 and `dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md`.
//
// Pure Node, zero deps: it writes a valid GLB (glTF 2.0 binary, Y-up per the glTF spec) + a
// `tileset.json` (3D Tiles 1.1, region bounding volume, ENU→ECEF root transform). No OSM2World /
// 3dfier needed for the spike — those are the Slice-1 production path.
//
// SEATING CONTRACT (the thing under test): geometry is baked with its ground at LOCAL up = 0 (i.e.
// the tile origin sits ON the WGS84 ellipsoid, h=0). The buildings therefore render ~1 CWT-terrain-
// height BELOW the rendered Cesium World Terrain until the runtime re-seats them. scene/enrichedBuildings.ts
// lifts the whole tileset group by `terrainHeightAt(originLat, originLon)` (the rendered-CWT sampler) —
// that runtime re-seat is exactly strategy R1(a). If it seats correctly, the strategy is proven.
//
// Run:  node scripts/build-sample-dnipro-tiles.mjs
// Out:  public/enriched-sample/dnipro/{tileset.json, buildings.glb}
// Serve (local, no R2 needed): `wix dev` serves public/ → set PUBLIC_ENRICHED_TILES_URL=/enriched-sample/dnipro/tileset.json

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "enriched-sample", "dnipro");

// --- WGS84 (matches src/lib/geo/projection.ts) ---------------------------------------------------
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.314245;
const E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
const DEG = Math.PI / 180;

/** Geodetic (deg, deg, m ellipsoidal) → ECEF metres. */
function geodeticToEcef(latDeg, lonDeg, hM) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return [
    (N + hM) * cosLat * Math.cos(lon),
    (N + hM) * cosLat * Math.sin(lon),
    (N * (1 - E2) + hM) * sinLat,
  ];
}

/** Column-major 4×4 ENU→ECEF at a geodetic origin — the 3D-Tiles root `transform`. Columns are the
 *  East / North / Up basis vectors then the origin ECEF (glTF/3D-Tiles matrices are column-major). */
function enuToEcefMatrix(latDeg, lonDeg, hM) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const east = [-sinLon, cosLon, 0];
  const north = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
  const up = [cosLat * cosLon, cosLat * sinLon, sinLat];
  const o = geodeticToEcef(latDeg, lonDeg, hM);
  // prettier-ignore
  return [
    east[0],  east[1],  east[2],  0,
    north[0], north[1], north[2], 0,
    up[0],    up[1],    up[2],    0,
    o[0],     o[1],     o[2],     1,
  ];
}

// --- Sample city block layout (central Dnipro, near Yavornytskoho Ave / the river embankment) -----
// Origin on the WGS84 ellipsoid (h=0 — the runtime re-seats to CWT). Buildings positioned in local
// ENU metres from this origin; the bbox spans roughly ±350 m E/W and ±260 m N/S.
const ORIGIN = { latDeg: 48.4622, lonDeg: 35.0456, hM: 0 };

/** @typedef {{ e:number, n:number, w:number, d:number, h:number, roof?: 'flat'|'gable', rot?:number }} Bldg */
/** e,n = footprint centre (ENU m); w=width(E) d=depth(N) m; h=eave height m; rot=yaw deg (about up). */
/** @type {Bldg[]} */
const BUILDINGS = [
  { e: -280, n: 150, w: 46, d: 30, h: 34, roof: "flat" },
  { e: -210, n: 120, w: 30, d: 28, h: 22, roof: "gable" },
  { e: -120, n: 175, w: 55, d: 34, h: 41, roof: "flat" },
  { e: -40, n: 130, w: 34, d: 26, h: 18, roof: "gable", rot: 12 },
  { e: 55, n: 165, w: 42, d: 30, h: 28, roof: "flat" },
  { e: 150, n: 140, w: 38, d: 40, h: 46, roof: "flat" },
  { e: 250, n: 175, w: 30, d: 24, h: 15, roof: "gable" },
  { e: -230, n: -40, w: 40, d: 32, h: 25, roof: "flat", rot: -8 },
  { e: -110, n: -70, w: 60, d: 30, h: 38, roof: "flat" },
  { e: 20, n: -30, w: 28, d: 28, h: 16, roof: "gable", rot: 20 },
  { e: 140, n: -55, w: 48, d: 34, h: 30, roof: "flat" },
  { e: 260, n: -20, w: 32, d: 26, h: 20, roof: "gable" },
];

// --- Geometry assembly (triangle soup: POSITION + NORMAL, glTF Y-up) ------------------------------
// glTF is Y-up; 3D Tiles rotates content +90° about +X (y-up→z-up): (x,y,z)_gltf → (x,-z,y)_tile.
// We want tile-local ENU (x=east, y=north, z=up), so a local ENU point (e,n,u) is authored as the
// glTF vertex (e, u, -n). All positions below go through enu() so the whole file stays Y-up-correct.
const positions = []; // flat [x,y,z, ...]
const normals = [];

/** Local ENU (east, north, up) → glTF Y-up vertex. */
function enu(e, n, u) {
  return [e, u, -n];
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}
/** Push a triangle (three glTF-space vertices), computing one flat face normal (CCW winding). */
function tri(p0, p1, p2) {
  const nrm = norm(cross(sub(p1, p0), sub(p2, p0)));
  for (const p of [p0, p1, p2]) {
    positions.push(p[0], p[1], p[2]);
    normals.push(nrm[0], nrm[1], nrm[2]);
  }
}
/** Push a quad as two CCW triangles. */
function quad(a, b, c, d) {
  tri(a, b, c);
  tri(a, c, d);
}

/** Rotate a footprint-local (dx,dy) by yaw (deg, about up) then translate to the building centre. */
function place(b, dx, dy) {
  const r = (b.rot ?? 0) * DEG;
  const cs = Math.cos(r), sn = Math.sin(r);
  return { e: b.e + dx * cs - dy * sn, n: b.n + dx * sn + dy * cs };
}

for (const b of BUILDINGS) {
  const hw = b.w / 2, hd = b.d / 2;
  // four footprint corners (CCW seen from above): SW, SE, NE, NW
  const c = [
    place(b, -hw, -hd),
    place(b, hw, -hd),
    place(b, hw, hd),
    place(b, -hw, hd),
  ];
  const base = c.map((p) => enu(p.e, p.n, 0));
  const eave = c.map((p) => enu(p.e, p.n, b.h));
  // walls (outward-facing, CCW from outside)
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(base[i], base[j], eave[j], eave[i]);
  }
  if (b.roof === "gable") {
    // ridge runs along the E-axis (building width); apex above the N/S midline, +40% of eave height.
    const ridgeH = b.h + Math.min(b.d, b.w) * 0.45;
    const midW = place(b, -hw, 0), midE = place(b, hw, 0);
    const ridgeW = enu(midW.e, midW.n, ridgeH);
    const ridgeE = enu(midE.e, midE.n, ridgeH);
    // two roof slopes (S slope over corners 0-1, N slope over corners 3-2)
    quad(eave[0], eave[1], ridgeE, ridgeW); // south slope
    quad(eave[2], eave[3], ridgeW, ridgeE); // north slope
    // two gable triangles (E and W ends)
    tri(eave[1], eave[2], ridgeE);
    tri(eave[3], eave[0], ridgeW);
  } else {
    // flat roof cap
    quad(eave[0], eave[1], eave[2], eave[3]);
  }
}

const vertexCount = positions.length / 3;

// --- GLB encode -----------------------------------------------------------------------------------
const posF32 = new Float32Array(positions);
const nrmF32 = new Float32Array(normals);
const posBytes = Buffer.from(posF32.buffer);
const nrmBytes = Buffer.from(nrmF32.buffer);

// min/max are required for POSITION accessors (glTF spec).
const pMin = [Infinity, Infinity, Infinity];
const pMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < posF32.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    pMin[k] = Math.min(pMin[k], posF32[i + k]);
    pMax[k] = Math.max(pMax[k], posF32[i + k]);
  }
}

const binLength = posBytes.length + nrmBytes.length;
const gltf = {
  asset: { version: "2.0", generator: "frame-the-world/build-sample-dnipro-tiles" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
  materials: [
    { name: "dnipro-sample", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.55, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertexCount, type: "VEC3", min: pMin, max: pMax },
    { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
    { buffer: 0, byteOffset: posBytes.length, byteLength: nrmBytes.length, target: 34962 },
  ],
  buffers: [{ byteLength: binLength }],
};

function padTo4(buf, padByte) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, padByte)]);
}
const jsonBuf = padTo4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20); // space-pad
const binBuf = padTo4(Buffer.concat([posBytes, nrmBytes]), 0x00); // zero-pad

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4); // version
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8); // total length

function chunk(type, data) {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
}
const glb = Buffer.concat([
  header,
  chunk(0x4e4f534a, jsonBuf), // "JSON"
  chunk(0x004e4942, binBuf), // "BIN\0"
]);

// --- tileset.json (3D Tiles 1.1) ------------------------------------------------------------------
// Region bounding volume = geographic (lon/lat radians, ellipsoidal min/max height) — independent of
// the ENU transform, so it stays correct regardless of the runtime re-seat. maxHeight covers the
// tallest building; heights are relative to the ellipsoid (the geometry's h=0 origin).
const halfSpanM = 420; // a touch beyond the building spread, in metres
const latPadDeg = halfSpanM / 111_320;
const lonPadDeg = halfSpanM / (111_320 * Math.cos(ORIGIN.latDeg * DEG));
const maxBuildingH = Math.max(...BUILDINGS.map((b) => b.h)) * 1.5;
const region = [
  (ORIGIN.lonDeg - lonPadDeg) * DEG,
  (ORIGIN.latDeg - latPadDeg) * DEG,
  (ORIGIN.lonDeg + lonPadDeg) * DEG,
  (ORIGIN.latDeg + latPadDeg) * DEG,
  0,
  maxBuildingH,
];

const tileset = {
  asset: { version: "1.1", tilesetVersion: "slice0-sample-1" },
  geometricError: 200,
  root: {
    transform: enuToEcefMatrix(ORIGIN.latDeg, ORIGIN.lonDeg, ORIGIN.hM),
    boundingVolume: { region },
    geometricError: 0,
    refine: "ADD",
    content: { uri: "buildings.glb" },
  },
};

// --- Write ----------------------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "buildings.glb"), glb);
writeFileSync(join(OUT_DIR, "tileset.json"), JSON.stringify(tileset, null, 2));

// The bbox the mask must cover (matches ENRICHED.bbox in tuning.ts) — [west,south,east,north] deg.
const bbox = {
  west: ORIGIN.lonDeg - lonPadDeg,
  south: ORIGIN.latDeg - latPadDeg,
  east: ORIGIN.lonDeg + lonPadDeg,
  north: ORIGIN.latDeg + latPadDeg,
};
console.log(`✓ wrote ${BUILDINGS.length} buildings (${vertexCount} verts) → ${OUT_DIR}`);
console.log(`  buildings.glb  ${(glb.length / 1024).toFixed(1)} KB`);
console.log(`  tileset.json   region bbox deg: [${bbox.west.toFixed(4)}, ${bbox.south.toFixed(4)}, ${bbox.east.toFixed(4)}, ${bbox.north.toFixed(4)}]`);
console.log(`  origin (ellipsoid h=0): ${ORIGIN.latDeg}, ${ORIGIN.lonDeg} — runtime re-seats to CWT via terrainHeightAt`);
