// Minimal quantized-mesh-1.0 DECODER (header + vertices + triangle indices) + a barycentric
// height sampler. Format facts proven against installed 3d-tiles-renderer 0.4.28 source
// (QuantizedMeshLoaderBase: 88 B header, u32 vertexCount, three zigzag-delta u16 streams,
// high-watermark index decode, 32767 normalization) and the U7 direct-probe session
// (UPLIFT_PLAN Appendix A). Used by the bake for CWT rim-blend reference + output verification.

const ZIGZAG = (v) => (v >> 1) ^ -(v & 1);

/** Decode one .terrain tile buffer → { header, u, v, h, heights, indices }. u/v/h are the raw
 *  0..32767 grids; heights[] is metres above the WGS84 ellipsoid per vertex. */
export function decodeQuantizedMesh(buf) {
  const dv = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength);
  let o = 0;
  const header = {
    centerX: dv.getFloat64(0, true),
    centerY: dv.getFloat64(8, true),
    centerZ: dv.getFloat64(16, true),
    minHeight: dv.getFloat32(24, true),
    maxHeight: dv.getFloat32(28, true),
    // sphere center xyz + radius (32..63), horizon occlusion point (64..87) — skipped
  };
  o = 88;
  const vertexCount = dv.getUint32(o, true);
  o += 4;
  const u = new Uint16Array(vertexCount);
  const v = new Uint16Array(vertexCount);
  const h = new Uint16Array(vertexCount);
  for (const arr of [u, v, h]) {
    let acc = 0;
    for (let i = 0; i < vertexCount; i++) {
      acc += ZIGZAG(dv.getUint16(o + i * 2, true));
      arr[i] = acc;
    }
    o += vertexCount * 2;
  }
  // Index data: u32 stream when vertexCount > 65536 (with 4-byte alignment), else u16.
  const use32 = vertexCount > 65536;
  if (use32 && o % 4 !== 0) o += 2;
  const triangleCount = dv.getUint32(o, true);
  o += 4;
  const indices = use32 ? new Uint32Array(triangleCount * 3) : new Uint16Array(triangleCount * 3);
  let highest = 0;
  for (let i = 0; i < indices.length; i++) {
    const code = use32 ? dv.getUint32(o + i * 4, true) : dv.getUint16(o + i * 2, true);
    indices[i] = highest - code; // high-watermark decode
    if (code === 0) highest++;
  }
  const heights = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    heights[i] = header.minHeight + (h[i] / 32767) * (header.maxHeight - header.minHeight);
  }
  return { header, vertexCount, u, v, h, heights, indices };
}

/** Rewrite ONLY the height stream (+ header min/max) of a quantized-mesh tile — the rim-blend
 *  splice. u/v streams, triangle/edge indices, and every extension stay BYTE-IDENTICAL (same
 *  vertex count ⇒ same layout); heights re-quantize over the new min/max and re-encode as the
 *  same zigzag-delta u16 stream in place. Header sphere/occlusion stay — the renderer re-derives
 *  its culling region from the min/max we rewrite (QuantizedMeshPlugin parseToMesh:300-303). */
export function spliceHeights(buf, mesh, newHeights) {
  const out = Buffer.from(buf); // copy
  let min = Infinity;
  let max = -Infinity;
  for (const h of newHeights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (min === max) max = min + 1e-3; // degenerate flat tile — keep the scale finite
  out.writeFloatLE(min, 24);
  out.writeFloatLE(max, 28);
  const n = mesh.vertexCount;
  const hOff = 88 + 4 + n * 2 * 2; // header + vcount + u,v streams
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const q = Math.round(((newHeights[i] - min) / (max - min)) * 32767);
    const delta = q - prev;
    prev = q;
    const zig = (delta << 1) ^ (delta >> 31);
    out.writeUInt16LE(zig & 0xffff, hOff + i * 2);
  }
  return out;
}

/** Height (m, ellipsoidal) at normalized tile coords (tu, tv) in [0,1] — barycentric lookup over
 *  the decoded triangulation; falls back to nearest vertex when outside every triangle (degenerate
 *  edges / fp noise). tv counts from the tile's SOUTH edge (quantized-mesh v axis). */
export function sampleQuantizedHeight(mesh, tu, tv) {
  const { u, v, heights, indices } = mesh;
  const px = tu * 32767;
  const py = tv * 32767;
  const EPS = 1e-6 * 32767;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = u[a], ay = v[a], bx = u[b], by = v[b], cx = u[c], cy = v[c];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (den === 0) continue;
    const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
    const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
    const wc = 1 - wa - wb;
    if (wa >= -EPS && wb >= -EPS && wc >= -EPS) {
      return wa * heights[a] + wb * heights[b] + wc * heights[c];
    }
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < u.length; i++) {
    const d = (u[i] - px) ** 2 + (v[i] - py) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return heights[best];
}
