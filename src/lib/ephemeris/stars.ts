/**
 * Yale Bright Star Catalog (BSC5) — packed-binary parsing + star math (Phase 4, ADR D6).
 *
 * The asset (`public/data/bsc5.bin`, built by `scripts/build-star-catalog.mjs` from
 * brettonw/YaleBrightStarCatalog bsc5.json, MIT; catalog: Hoffleit & Warren, The Bright Star
 * Catalogue, 5th Rev. Ed. 1991) is little-endian float32 records of STAR_RECORD_FLOATS each:
 *   [x, y, z, vmag, bv]
 * where (x,y,z) is the J2000 equatorial unit direction (x → RA 0h at the equator, z → celestial
 * north pole — the SAME axis convention as ECEF, so rotating the star sphere by −GAST about +Z
 * puts every star over its correct earth longitude for the scene time; precession since J2000 is
 * <0.5° — invisible at star-point scale). bv is BV_SENTINEL where the catalog has no B-V.
 *
 * Pure and three-free (unit-tested); the scene module (`globe/scene/stars.ts`) feeds the arrays
 * straight into BufferAttributes.
 */

export const STAR_RECORD_FLOATS = 5;
/** B-V is absent for 310 of the 9,096 BSC5 stars — this sentinel marks them (real B-V ≤ ~3.4). */
export const BV_SENTINEL = 9.99;

export interface StarCatalog {
  count: number;
  /** xyz unit directions, J2000 equatorial frame (3 floats per star). */
  positions: Float32Array;
  /** Apparent V magnitude per star. */
  vmag: Float32Array;
  /** B-V colour index per star (BV_SENTINEL when the catalog lacks it). */
  bv: Float32Array;
}

/** J2000 equatorial unit vector from RA (hours) + Dec (degrees). z = celestial north pole. */
export function raDecToUnit(raHours: number, decDeg: number): [number, number, number] {
  const ra = (raHours * Math.PI) / 12; // 15°/hour
  const dec = (decDeg * Math.PI) / 180;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/** De-interleave the packed asset. Throws on a malformed byte length (truncated fetch). */
export function parseStarCatalog(buffer: ArrayBuffer): StarCatalog {
  // Float32Array reads platform-endian; every target platform (x86/ARM browsers) is LE, matching
  // the LE writer in the build script.
  const all = new Float32Array(buffer);
  if (all.length === 0 || all.length % STAR_RECORD_FLOATS !== 0) {
    throw new Error(`star catalog: bad record stream (${all.length} floats)`);
  }
  const count = all.length / STAR_RECORD_FLOATS;
  const positions = new Float32Array(count * 3);
  const vmag = new Float32Array(count);
  const bv = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * STAR_RECORD_FLOATS;
    positions[i * 3] = all[o];
    positions[i * 3 + 1] = all[o + 1];
    positions[i * 3 + 2] = all[o + 2];
    vmag[i] = all[o + 3];
    bv[i] = all[o + 4];
  }
  return { count, positions, vmag, bv };
}

export interface MagMapping {
  /** Reference magnitude (≈ naked-eye median) — stars at magRef get the base size / full alpha. */
  magRef: number;
  sizeBase: number;
  sizeSpread: number;
  /** Exponent softener on the Pogson flux law for SIZE (pure flux would blow up Sirius). */
  sizeGamma: number;
  sizeMax: number;
  /** Flux-law softener for the brightness (alpha) attribute. */
  brightGamma: number;
  brightMin: number;
}

/** V magnitude → point size (px, pre-DPR): sizeBase + sizeSpread·10^(−0.4·(V−magRef)·sizeGamma). */
export function magToSize(v: number, m: MagMapping): number {
  const flux = Math.pow(10, -0.4 * (v - m.magRef) * m.sizeGamma);
  return Math.min(m.sizeMax, m.sizeBase + m.sizeSpread * flux);
}

/** V magnitude → brightness multiplier (0..1 alpha weight), floored so faint stars stay visible. */
export function magToBright(v: number, m: MagMapping): number {
  const flux = Math.pow(10, -0.4 * (v - m.magRef) * m.brightGamma);
  return Math.min(1, Math.max(m.brightMin, flux));
}

/** B−V colour index → effective temperature (K). Ballesteros (2012, EPL 97, 34008) — a
 *  blackbody fit valid across the main sequence (±3% over B−V ∈ [−0.4, 2]). */
export function bvToTempK(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/**
 * B−V colour index → linear-ish sRGB tint, normalized so max(r,g,b) = 1 (brightness stays the
 * magnitude attributes' job — the tint must never double-dim a star). Blackbody chromaticity via
 * `bvToTempK` + the Tanner Helland piecewise fit of the Planckian locus (the standard compact
 * approximation; kelvin → 0..255 channels, here rescaled 0..1). BV_SENTINEL (no catalog colour)
 * → white. Anchors: Rigel (−0.03) blue-white · Sun (0.65) warm white · Betelgeuse (1.85) orange.
 */
export function bvToRgb(bv: number): [number, number, number] {
  if (bv >= 9) return [1, 1, 1];
  const t = Math.min(Math.max(bvToTempK(Math.min(Math.max(bv, -0.4), 2.0)), 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clamp01 = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  const rr = clamp01(r);
  const gg = clamp01(g);
  const bb = clamp01(b);
  const max = Math.max(rr, gg, bb, 1e-6);
  return [rr / max, gg / max, bb / max];
}

// ---------------------------------------------------------------------------------------------
// Milky Way — the galactic plane at its REAL celestial coordinates. IAU J2000 galactic frame:
// north galactic pole RA 12h51m26.28s / Dec +27°07'42.0", galactic centre (l=0, b=0) at
// RA 17h45m37.2s / Dec −28°56'10" (Sgr A* direction). The band renders as a child of the BSC5
// star sphere, so the same −GAST rotation places it correctly over the earth for the scene time.
// ---------------------------------------------------------------------------------------------

/** North galactic pole, J2000 equatorial (RA 192.85948°, Dec +27.12825°). */
export const GALACTIC_NORTH_POLE = { raHours: 192.85948 / 15, decDeg: 27.12825 } as const;
/** Galactic centre (l=0, b=0), J2000 equatorial (RA 266.405°, Dec −28.93617°). */
export const GALACTIC_CENTER = { raHours: 266.405 / 15, decDeg: -28.93617 } as const;

/** Galactic (l, b) degrees → J2000 equatorial unit vector (same frame as the star catalog). */
export function galacticToEquatorial(lDeg: number, bDeg: number): [number, number, number] {
  // Orthonormal galactic basis in the equatorial frame: z = NGP, x = towards the galactic
  // centre (Gram-Schmidt against z — the published values are ~0.005° from orthogonal), y = z×x.
  const z = raDecToUnit(GALACTIC_NORTH_POLE.raHours, GALACTIC_NORTH_POLE.decDeg);
  const c0 = raDecToUnit(GALACTIC_CENTER.raHours, GALACTIC_CENTER.decDeg);
  const dzc = z[0] * c0[0] + z[1] * c0[1] + z[2] * c0[2];
  const xr: [number, number, number] = [c0[0] - dzc * z[0], c0[1] - dzc * z[1], c0[2] - dzc * z[2]];
  const xl = Math.hypot(xr[0], xr[1], xr[2]);
  const x: [number, number, number] = [xr[0] / xl, xr[1] / xl, xr[2] / xl];
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const cb = Math.cos(b);
  const gx = cb * Math.cos(l);
  const gy = cb * Math.sin(l);
  const gz = Math.sin(b);
  return [
    gx * x[0] + gy * y[0] + gz * z[0],
    gx * x[1] + gy * y[1] + gz * z[1],
    gx * x[2] + gy * y[2] + gz * z[2],
  ];
}

export interface MwBandSegments {
  /** J2000 equatorial unit vectors, PAIRED per segment (same contract as `asterismSegments`). */
  positions: Float32Array;
  segmentCount: number;
}

/**
 * Galactic-equator guide polylines (Phase 8a P2): one closed small-circle of constant galactic
 * latitude per entry in `latitudesDeg` (b=0 = the galactic equator; ±edges delimit the visual
 * ribbon), sampled every `stepDeg` of galactic longitude. Unit-sphere vertices — the star
 * sphere's scale supplies the world radius, its −GAST spin supplies the time dependence
 * (precession deliberately ignored there: ≤0.3° at 2026, invisible at band width).
 */
export function milkyWayBandSegments(stepDeg: number, latitudesDeg: readonly number[]): MwBandSegments {
  const perLine = Math.ceil(360 / stepDeg);
  const segmentCount = perLine * latitudesDeg.length;
  const positions = new Float32Array(segmentCount * 6);
  let o = 0;
  for (const b of latitudesDeg) {
    for (let i = 0; i < perLine; i++) {
      const l0 = i * stepDeg;
      const l1 = Math.min(l0 + stepDeg, 360);
      const [x0, y0, z0] = galacticToEquatorial(l0, b);
      const [x1, y1, z1] = galacticToEquatorial(l1, b);
      positions[o++] = x0;
      positions[o++] = y0;
      positions[o++] = z0;
      positions[o++] = x1;
      positions[o++] = y1;
      positions[o++] = z1;
    }
  }
  return { positions, segmentCount };
}

export interface MilkyWayOptions {
  count: number;
  /** Gaussian half-thickness across galactic latitude (deg). */
  sigmaBDeg: number;
  /** Fraction of points drawn from a 2.5× wider gaussian (soft halo — no hard band edge). */
  haloFrac: number;
  /** Brightness bulge toward the galactic centre: w = base + (1−base)·exp(−½(l/σ)²). */
  bulgeSigmaLDeg: number;
  baseWeight: number;
  sizeBase: number;
  sizeSpread: number;
}

export interface MilkyWayField {
  /** J2000 equatorial unit directions (3 floats per point). */
  positions: Float32Array;
  /** Point size (px, pre-DPR) per point. */
  size: Float32Array;
  /** Brightness weight (0..1) per point — bulges toward the galactic centre. */
  bright: Float32Array;
}

/** Procedural Milky Way band: points scattered about the galactic plane, denser & brighter
 *  toward the galactic centre. `rand` is injectable for deterministic tests. */
export function milkyWayField(opts: MilkyWayOptions, rand: () => number = Math.random): MilkyWayField {
  const positions = new Float32Array(opts.count * 3);
  const size = new Float32Array(opts.count);
  const bright = new Float32Array(opts.count);
  for (let i = 0; i < opts.count; i++) {
    // Galactic longitude weighted toward the centre by rejection sampling on the bulge weight.
    let lDeg = 0;
    let w = 0;
    do {
      lDeg = rand() * 360;
      const lWrap = lDeg > 180 ? lDeg - 360 : lDeg; // distance from the galactic centre (l=0)
      w = opts.baseWeight + (1 - opts.baseWeight) * Math.exp(-0.5 * (lWrap / opts.bulgeSigmaLDeg) ** 2);
    } while (rand() > w);
    // Gaussian galactic latitude (Box-Muller); a slice of points from a wider gaussian softens
    // the band edge into a halo.
    const u1 = Math.max(rand(), 1e-12);
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
    const sigma = rand() < opts.haloFrac ? opts.sigmaBDeg * 2.5 : opts.sigmaBDeg;
    const bDeg = Math.max(-89, Math.min(89, gauss * sigma));
    const p = galacticToEquatorial(lDeg, bDeg);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    const r = rand();
    size[i] = opts.sizeBase + r * r * opts.sizeSpread;
    bright[i] = w * (0.6 + 0.4 * rand());
  }
  return { positions, size, bright };
}
