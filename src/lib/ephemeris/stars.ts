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
