// Building geometry engine: OSM footprint + tags → watertight extruded mass with an inferred height
// and a roof shape. Pure + unit-tested (test/bake/buildings.test.ts). All authoring is in LOCAL ENU
// metres (e = east, n = north, u = up); emit maps ENU (e,n,u) → glTF Y-up vertex (e, u, -n), matching
// the browser-VERIFIED Slice-0 writer so the up-axis stays correct.
//
// Height inference (the whole point — <10% of OSM buildings carry a height, ~47% in central Dnipro):
//   height  = height tag → building:levels × levelHeightM → per-class default → generic default
//   base    = min_height → building:min_level × levelHeightM → 0
//   roof    = roof:shape (flat | gabled | hipped/pyramidal/… ) + roof:height/roof:levels or span×pitch

// ── tag parsing ─────────────────────────────────────────────────────────────────────────────────

/** Parse an OSM length ("12", "12 m", "12.5m", "40'") → metres, or null. */
export function parseMeters(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const feet = /'\s*$/.test(s) || /\bft\b/i.test(s);
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return null;
  return feet ? n * 0.3048 : n;
}

/** Map an OSM roof:shape to one of our supported families. Unknown/absent → "flat". */
export function normalizeRoofShape(v) {
  const s = (v ?? "").toLowerCase().trim();
  if (s === "gabled" || s === "gambrel" || s === "round") return "gabled";
  if (s === "hipped" || s === "half-hipped" || s === "pyramidal" || s === "dome" || s === "conical" || s === "onion")
    return "pyramidal";
  if (s === "skillion" || s === "lean_to" || s === "mono_pitch" || s === "monopitch") return "skillion";
  return "flat"; // flat, sawtooth, mansard, and anything unrecognised → flat cap (safe, watertight)
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Infer massing parameters from OSM tags + a per-city config.
 * @returns {{base:number, height:number, roofShape:string, roofHeight:number|null, heightSource:string}}
 */
export function inferBuilding(tags, cfg = {}) {
  const levelH = cfg.levelHeightM ?? 3.0;
  let height = parseMeters(tags.height ?? tags["building:height"]);
  let heightSource = height != null ? "height" : null;
  if (height == null) {
    const levels = parseFloat(tags["building:levels"]);
    if (Number.isFinite(levels) && levels > 0) {
      height = levels * levelH;
      heightSource = "levels";
    }
  }
  if (height == null) {
    height = cfg.classDefaultsM?.[tags.building] ?? cfg.defaultHeightM ?? 8;
    heightSource = cfg.classDefaultsM?.[tags.building] != null ? "class" : "default";
  }
  height = clamp(height, 2, 400);

  const roofShape = normalizeRoofShape(tags["roof:shape"]);
  let roofHeight = parseMeters(tags["roof:height"]);
  if (roofHeight == null) {
    const roofLevels = parseFloat(tags["roof:levels"]);
    if (Number.isFinite(roofLevels) && roofLevels > 0) roofHeight = roofLevels * levelH;
  }
  // roofHeight null + non-flat → filled from footprint span × pitch in emitBuilding.
  //
  // `height` in OSM is the TOTAL height INCLUDING the roof, so when it is what we resolved
  // against, the returned `height` must be the EAVE (total − roof:height) — emitBuilding raises
  // its ridge to `height + roofHeight`, which then lands back on the tagged total. Capping
  // roof:height at total − 1 (rather than at total) is what makes that exact: it leaves a 1 m
  // wall for the cap to sit on instead of clamping the eave afterwards and overshooting by a
  // metre. `building:levels` and the class defaults mean the OPPOSITE — storeys BELOW the roof —
  // so for those the roof is correctly stacked on top and `height` already is the eave.
  //
  // Without the split every co-tagged building rendered too tall by exactly roof:height. Found
  // 2026-08-26 on the Chernobyl bake, where the New Safe Confinement (w456732992, height=110
  // roof:height=110 roof:shape=round → gabled) came out a 220 m ridge — the degenerate case,
  // because there the whole structure IS the roof. Blast radius measured over every cached
  // Overpass response: 1/1,275 footprints here, 164/128,649 in Dnipro (all ≤ 20 m rendered),
  // 0/25,510 in St Albans. Dnipro's shipped bake predates this and is NOT re-baked yet.
  if (roofHeight != null) {
    roofHeight = clamp(roofHeight, 0, heightSource === "height" ? height - 1 : height);
    if (heightSource === "height") height -= roofHeight;
  }

  let base = parseMeters(tags.min_height);
  if (base == null) {
    const minLevel = parseFloat(tags["building:min_level"]);
    if (Number.isFinite(minLevel) && minLevel > 0) base = minLevel * levelH;
  }
  // Clamped against the EAVE, which is why the base block moved below the roof block: a building
  // tagged height=20 min_height=15 roof:height=8 has an eave at 12, and clamping base against
  // the pre-roof 20 would have left base=15 above its own wall top and inverted the quads.
  base = clamp(base ?? 0, 0, height - 1);

  return { base, height, roofShape, roofHeight, heightSource };
}

// ── footprint helpers ─────────────────────────────────────────────────────────────────────────────

/** Signed area of a 2D ring ([[e,n],…]); >0 ⇒ CCW. */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  }
  return a / 2;
}

/** Drop a repeated closing vertex + near-duplicate consecutive points; return a CCW ring (or null). */
export function cleanRing(poly) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) out.push([p[0], p[1]]);
  }
  if (out.length >= 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.05) out.pop();
  }
  if (out.length < 3) return null;
  return signedArea(out) < 0 ? out.reverse() : out;
}

function pointInTri(p, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return false;
  const s = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const t = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return s >= -1e-6 && t >= -1e-6 && s + t <= 1 + 1e-6;
}

/** Ear-clipping triangulation of a simple CCW ring → array of index triples. Concave-safe; on a
 *  degenerate/self-intersecting ring it falls back to a triangle fan (never throws). */
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = [...Array(n).keys()];
  const tris = [];
  let guard = n * n + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) continue; // reflex/collinear on a CCW ring ⇒ not an ear
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else if (tris.length === 0) for (let i = 1; i < n - 1; i++) tris.push([0, i, i + 1]); // fan fallback
  return tris;
}

/** PCA oriented bounding box of a ring → {cx,cy, ax,ay (unit axis), px,py (unit perp), halfLen, halfWid}. */
export function obb(poly) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of poly) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(theta), ay = Math.sin(theta);
  const px = -ay, py = ax;
  let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (const p of poly) {
    const dx = p[0] - cx, dy = p[1] - cy;
    const a = dx * ax + dy * ay, b = dx * px + dy * py;
    if (a < amin) amin = a; if (a > amax) amax = a;
    if (b < bmin) bmin = b; if (b > bmax) bmax = b;
  }
  const midA = (amin + amax) / 2, midB = (bmin + bmax) / 2;
  return {
    cx: cx + midA * ax + midB * px,
    cy: cy + midA * ay + midB * py,
    ax, ay, px, py,
    halfLen: (amax - amin) / 2,
    halfWid: (bmax - bmin) / 2,
  };
}

// ── RC13 · the base skirt ─────────────────────────────────────────────────────────────────────────
//
// A building is baked at a nominal ground of u = 0 and SEATED onto terrain at runtime (per group,
// per cell, then per footprint). Every rung of that ladder leaves a residual, and while a cell is
// still streaming its features sit on the cell plane. Where the residual is positive the building
// hovers and you see SKY UNDER ITS WALLS — the one artifact that reads as broken rather than as
// imprecise. The skirt hides it with geometry: the walls simply start `skirtM` lower.
//
// IT COSTS NO VERTICES. The charter says "extrude a skirt", and the naive reading — append a quad
// per bottom boundary edge — was measured on the real OSM2World intermediates at **+59 % vertices
// bake-wide, +78 % on Building alone**, against the audit's own acceptance bar of "+≤10 %"
// (S13). But the walls already HAVE a bottom rim; lowering it is the same picture for zero new
// triangles, and it is what both bakers do. The audit's bar is met at +0 %.
//
// Two guards, both learned from the o2w classes (see `skirtForSoup`) rather than assumed.

/** Y-extent (m) below which a feature is a flat ribbon with no wall to extend. */
export const SKIRT_MIN_EXTENT_M = 0.5;
/** Base height (m) above which a feature is deliberately founded off the ground — never fill that gap. */
export const SKIRT_MAX_BASE_M = 0.25;
/** Half-band (m) around a soup feature's own minimum Y that counts as "the bottom rim". */
export const SKIRT_BAND_M = 0.05;

/**
 * Skirt depth (m) for a footprint-extruded building. `base > 0` means OSM `min_height` /
 * `building:min_level`: the mass is authored to START above the ground (a tower over a podium, an
 * arch, a building part), and the gap under it is intentional. Skirting those would fill a hole
 * the mapper drew on purpose, so they get nothing.
 */
export function skirtFor(params, cfg = {}) {
  const m = Math.max(0, cfg.skirtM ?? 0);
  return params.base <= SKIRT_MAX_BASE_M ? m : 0;
}

/**
 * Skirt depth (m) for an OSM2World triangle-soup feature, decided from its own Y extent because
 * that is all the adapter has — OSM2World hands back geometry, not tags.
 *
 * The first guard is not hypothetical. The o2w bake runs with `createTerrain=false` and no SRTM
 * directory, so its ground is the plane u = 0 — and `Cliff` (60 in the shipped Dnipro manifest)
 * and `RetainingWall` (171) come back with `minY === maxY === 0`, flat ribbons with no height to
 * express. Lowering their "bottom rim" is lowering the whole feature, which buries a surface that
 * currently renders, and appending a skirt to one would hang a 4 m curtain off a zero-height line.
 */
export function skirtForSoup(minU, maxU, cfg = {}) {
  const m = Math.max(0, cfg.skirtM ?? 0);
  if (m <= 0) return 0;
  if (maxU - minU < SKIRT_MIN_EXTENT_M) return 0;
  if (minU > SKIRT_MAX_BASE_M) return 0;
  return m;
}

// ── mesh emission (ENU → glTF Y-up) ────────────────────────────────────────────────────────────────

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normV(v) { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; }
/** ENU (e,n,u) → glTF Y-up vertex (e, u, -n). */
const gv = (e, n, u) => [e, u, -n];

/**
 * Emit one building's triangles into flat `out` arrays. `out = {positions, normals, featureIds}`.
 * Normals are forced OUTWARD (away from the building's mid-height centroid) so flat shading + shadows
 * read correctly under the DoubleSide material.
 */
export function emitBuilding(footprintEN, params, featureId, out, cfg = {}) {
  const ring = cleanRing(footprintEN);
  if (!ring) return 0;
  const { base, height, roofShape } = params;
  let roofHeight = params.roofHeight;
  const pitch = cfg.roofPitch ?? 0.4;

  let cE = 0, cN = 0;
  for (const p of ring) { cE += p[0]; cN += p[1]; }
  cE /= ring.length; cN /= ring.length;
  const insideRef = [cE, (base + height) / 2, -cN]; // glTF-space mid-height centroid (for outward test)
  let triCount = 0;

  const pushTri = (P0, P1, P2) => {
    let a = P0, b = P1, c = P2;
    let nrm = normV(crossV(sub(b, a), sub(c, a)));
    const fc = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const outward = [fc[0] - insideRef[0], fc[1] - insideRef[1], fc[2] - insideRef[2]];
    if (nrm[0] * outward[0] + nrm[1] * outward[1] + nrm[2] * outward[2] < 0) {
      b = P2; c = P1; // flip winding
      nrm = normV(crossV(sub(b, a), sub(c, a)));
    }
    for (const p of [a, b, c]) {
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(nrm[0], nrm[1], nrm[2]);
      if (out.featureIds) out.featureIds.push(featureId);
    }
    triCount++;
  };
  const pushQuad = (a, b, c, d) => { pushTri(a, b, c); pushTri(a, c, d); };

  // Walls: one quad per footprint edge, (base − skirt) → eave. RC13: the skirt lowers the rim
  // rather than appending a second course of quads, so the wall count is unchanged.
  const wallBottom = base - skirtFor(params, cfg);
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    pushQuad(gv(A[0], A[1], wallBottom), gv(B[0], B[1], wallBottom), gv(B[0], B[1], height), gv(A[0], A[1], height));
  }

  // Roof.
  const capTris = triangulate(ring);
  const emitFlatCap = () => { for (const [i, j, k] of capTris) pushTri(gv(ring[i][0], ring[i][1], height), gv(ring[j][0], ring[j][1], height), gv(ring[k][0], ring[k][1], height)); };
  const centroidInside = capTris.some(([i, j, k]) => pointInTri([cE, cN], ring[i], ring[j], ring[k]));

  if (roofShape === "pyramidal" && centroidInside) {
    const span = Math.min(...ring.map((p) => Math.hypot(p[0] - cE, p[1] - cN))) * 2;
    const rH = roofHeight ?? clamp(span * pitch, 1.5, height * 0.8);
    const apex = gv(cE, cN, height + rH);
    for (let i = 0; i < ring.length; i++) {
      const A = ring[i], B = ring[(i + 1) % ring.length];
      pushTri(gv(A[0], A[1], height), gv(B[0], B[1], height), apex);
    }
  } else if (roofShape === "gabled") {
    emitFlatCap(); // watertight base under the (OBB) gable
    const box = obb(ring);
    const rH = roofHeight ?? clamp(box.halfWid * 2 * pitch, 1.5, height * 0.8);
    // four OBB corners at eave height
    const corner = (sa, sb) => [box.cx + sa * box.halfLen * box.ax + sb * box.halfWid * box.px,
                                box.cy + sa * box.halfLen * box.ay + sb * box.halfWid * box.py];
    const c1 = corner(-1, -1), c2 = corner(1, -1), c3 = corner(1, 1), c4 = corner(-1, 1);
    const rw = gv(box.cx - box.halfLen * box.ax, box.cy - box.halfLen * box.ay, height + rH); // ridge ends
    const re = gv(box.cx + box.halfLen * box.ax, box.cy + box.halfLen * box.ay, height + rH);
    const e1 = gv(c1[0], c1[1], height), e2 = gv(c2[0], c2[1], height), e3 = gv(c3[0], c3[1], height), e4 = gv(c4[0], c4[1], height);
    pushQuad(e1, e2, re, rw); // slope along -perp
    pushQuad(e3, e4, rw, re); // slope along +perp
    pushTri(e2, e3, re);      // gable end
    pushTri(e4, e1, rw);      // gable end
  } else {
    emitFlatCap();
  }
  return triCount;
}
