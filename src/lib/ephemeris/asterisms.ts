/**
 * Asterism figures for the night sky (Phase 5.5 S6, §Item 4) — parses the baked
 * `public/data/asterisms.json` (d3-celestial, BSD-3; see scripts/build-asterisms.mjs) into
 * LineSegments-ready unit vectors on the J2000 equatorial sphere — the same frame as the BSC5
 * star positions, so the figures ride the star sphere's −GAST rotation for free.
 *
 * UNIT TRAP (caught in review): the baked file stores RA in DEGREES 0–360;
 * `raDecToUnit` takes HOURS — the ÷15 happens here and nowhere else.
 */

import { raDecToUnit } from "./stars";

export interface AsterismsAsset {
  credit: string;
  asterisms: Array<{
    id: string;
    name: string;
    /** Polylines of [raDeg 0–360, decDeg] vertices. */
    lines: number[][][];
  }>;
}

export interface AsterismSegments {
  /** Flat xyz per vertex, PAIRED for LineSegments (each consecutive pair = one segment). */
  positions: Float32Array;
  /** Segment pair count = positions.length / 6. */
  segmentCount: number;
  figureCount: number;
}

/** Flatten every asterism polyline into LineSegments vertex pairs of unit J2000 directions. */
export function asterismSegments(asset: AsterismsAsset): AsterismSegments {
  const xyz: number[] = [];
  for (const figure of asset.asterisms) {
    for (const line of figure.lines) {
      for (let i = 1; i < line.length; i++) {
        const [ra0, dec0] = line[i - 1];
        const [ra1, dec1] = line[i];
        xyz.push(...raDecToUnit(ra0 / 15, dec0), ...raDecToUnit(ra1 / 15, dec1));
      }
    }
  }
  return {
    positions: new Float32Array(xyz),
    segmentCount: xyz.length / 6,
    figureCount: asset.asterisms.length,
  };
}
