/**
 * Public-pin precision tiers (C6 — BINDING).
 *
 * A public pin never carries the exact capture GPS unless the member explicitly chose the
 * "exact" tier. For reduced tiers the public location is the CENTER of the geohash cell that
 * contains the exact point — every point inside a cell maps to the same public location, so
 * the published coordinates carry no more information than the tier's cell size:
 *   exact → p9 (±2.4 m, member opt-in) · 1km → p6 (cell ≈1.2×0.61 km) · city → p4 (≈39×19.5 km)
 *
 * The server endpoint is the only writer of PublicPins and derives ALL public fields through
 * `reduceLocation` — client-supplied "reduced" values are never trusted.
 */

import { decodeGeohash, encodeGeohash } from "./geohash";

export type PrecisionTier = "exact" | "1km" | "city";

export const PRECISION_TIERS: readonly PrecisionTier[] = ["exact", "1km", "city"];

/** C6: the default choice at save time is reduced, never exact. */
export const DEFAULT_PRECISION_TIER: PrecisionTier = "1km";

export const TIER_GEOHASH_PRECISION: Record<PrecisionTier, number> = {
  exact: 9,
  "1km": 6,
  city: 4,
};

export interface ReducedLocation {
  /** Public latitude — the tier cell's center (or the input for the exact tier). */
  latReduced: number;
  /** Public longitude — same derivation as latReduced. */
  lonReduced: number;
  /** The tier cell itself (geohash at the tier's precision). */
  geohash: string;
  /** Viewport-query prefixes, both derived from the PUBLIC location only. */
  gh4: string;
  gh6: string;
  precision: PrecisionTier;
}

export function isPrecisionTier(value: unknown): value is PrecisionTier {
  return typeof value === "string" && (PRECISION_TIERS as string[]).includes(value);
}

/** Derive every public location field for a pin from the exact GPS + chosen tier. */
export function reduceLocation(lat: number, lon: number, tier: PrecisionTier): ReducedLocation {
  const precision = TIER_GEOHASH_PRECISION[tier];
  const cell = encodeGeohash(lat, lon, precision);

  let latReduced = lat;
  let lonReduced = lon;
  if (tier !== "exact") {
    const center = decodeGeohash(cell);
    latReduced = center.lat;
    lonReduced = center.lon;
  }

  // gh4 is always a prefix of the tier cell (min precision is 4). gh6 is the p6 cell of the
  // PUBLIC location — for the city tier that is the cell containing the p4 center, which still
  // shares the p4 prefix (the center lies inside its own cell).
  const gh4 = cell.slice(0, 4);
  const gh6 = precision >= 6 ? cell.slice(0, 6) : encodeGeohash(latReduced, lonReduced, 6);

  return { latReduced, lonReduced, geohash: cell, gh4, gh6, precision: tier };
}
