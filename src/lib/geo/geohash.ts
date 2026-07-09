/**
 * Geohash — encode/decode + viewport-covering prefixes (ADR D7).
 *
 * Wix Data has NO geospatial query, so public pins are stored with a denormalised geohash and queried by
 * `geohash hasSome [<prefixes covering the viewport>]`, then refined on the client. This module provides the
 * encode/decode + the prefix-set computation for a lat/lon viewport.
 *
 * Standard base-32 geohash (Niemeyer 2008), reference algorithm after Chris Veness (MIT).
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export interface GeohashBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface GeohashCenter {
  lat: number;
  lon: number;
  /** Half-height / half-width of the cell in degrees (the ± error). */
  latErr: number;
  lonErr: number;
}

/** Encode a lat/lon to a geohash of the given precision (default 9 ≈ ±2.4 m). */
export function encodeGeohash(lat: number, lon: number, precision = 9): string {
  if (precision < 1) throw new Error("encodeGeohash: precision must be >= 1");
  if (lat < -90 || lat > 90) throw new Error(`encodeGeohash: lat out of range (${lat})`);
  if (lon < -180 || lon > 180) throw new Error(`encodeGeohash: lon out of range (${lon})`);

  let idx = 0;
  let bit = 0;
  let evenBit = true; // even bits encode longitude, odd bits latitude
  let hash = "";
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        idx = idx * 2 + 1;
        lonMin = mid;
      } else {
        idx = idx * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** Decode a geohash to its cell bounds. */
export function decodeGeohashBounds(geohash: string): GeohashBounds {
  if (!geohash) throw new Error("decodeGeohashBounds: empty geohash");
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  for (const ch of geohash.toLowerCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`decodeGeohashBounds: invalid geohash char '${ch}'`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bitN === 1) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN === 1) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { latMin, latMax, lonMin, lonMax };
}

/** Decode a geohash to its centre point + ± error. */
export function decodeGeohash(geohash: string): GeohashCenter {
  const b = decodeGeohashBounds(geohash);
  return {
    lat: (b.latMin + b.latMax) / 2,
    lon: (b.lonMin + b.lonMax) / 2,
    latErr: (b.latMax - b.latMin) / 2,
    lonErr: (b.lonMax - b.lonMin) / 2,
  };
}

// --- adjacency (Veness reference tables) -----------------------------------------------------------------
type Dir = "n" | "s" | "e" | "w";
const NEIGHBOURS: Record<Dir, [string, string]> = {
  n: ["p0r21436x8zb9dcf5h7kjnmqesgutwvy", "bc01fg45238967deuvhjyznpkmstqrwx"],
  s: ["14365h7k9dcfesgujnmqp0r2twvyx8zb", "238967debc01fg45kmstqrwxuvhjyznp"],
  e: ["bc01fg45238967deuvhjyznpkmstqrwx", "p0r21436x8zb9dcf5h7kjnmqesgutwvy"],
  w: ["238967debc01fg45kmstqrwxuvhjyznp", "14365h7k9dcfesgujnmqp0r2twvyx8zb"],
};
const BORDERS: Record<Dir, [string, string]> = {
  n: ["prxz", "bcfguvyz"],
  s: ["028b", "0145hjnp"],
  e: ["bcfguvyz", "prxz"],
  w: ["0145hjnp", "028b"],
};

/** The geohash cell adjacent to `geohash` in a cardinal direction (same precision). */
export function adjacentGeohash(geohash: string, direction: Dir): string {
  const gh = geohash.toLowerCase();
  const last = gh.slice(-1);
  let parent = gh.slice(0, -1);
  const type = gh.length % 2;
  if (BORDERS[direction][type].indexOf(last) !== -1 && parent !== "") {
    parent = adjacentGeohash(parent, direction);
  }
  return parent + BASE32[NEIGHBOURS[direction][type].indexOf(last)];
}

/** The 8 surrounding geohash cells (N, NE, E, SE, S, SW, W, NW). */
export function neighbourGeohashes(geohash: string): Record<string, string> {
  const n = adjacentGeohash(geohash, "n");
  const s = adjacentGeohash(geohash, "s");
  return {
    n,
    e: adjacentGeohash(geohash, "e"),
    s,
    w: adjacentGeohash(geohash, "w"),
    ne: adjacentGeohash(n, "e"),
    nw: adjacentGeohash(n, "w"),
    se: adjacentGeohash(s, "e"),
    sw: adjacentGeohash(s, "w"),
  };
}

/**
 * The set of geohash prefixes (at the given precision) that cover a lat/lon viewport, for a Wix Data
 * `hasSome` query (D7). Geohash cells are a regular lat/lon grid, so the step is constant per precision.
 * Keep `precision` low for wide viewports (fewer, larger cells) — callers pick it from the zoom level.
 */
export function geohashesForViewport(
  bounds: GeohashBounds,
  precision = 5,
): string[] {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  if (latMin > latMax || lonMin > lonMax) {
    throw new Error("geohashesForViewport: min must be <= max");
  }
  // One cell's dimensions at this precision (uniform across the grid).
  const cell = decodeGeohashBounds(encodeGeohash(0, 0, precision));
  const latStep = cell.latMax - cell.latMin;
  const lonStep = cell.lonMax - cell.lonMin;

  const set = new Set<string>();
  const add = (lat: number, lon: number) =>
    set.add(encodeGeohash(clampLat(lat), clampLon(lon), precision));

  for (let lat = latMin; lat < latMax + latStep; lat += latStep) {
    const rowLat = Math.min(lat, latMax);
    for (let lon = lonMin; lon < lonMax + lonStep; lon += lonStep) {
      add(rowLat, Math.min(lon, lonMax));
    }
    add(rowLat, lonMax); // ensure the east edge is covered
  }
  // Ensure all four corners are present regardless of stepping.
  add(latMax, lonMin);
  add(latMax, lonMax);
  return [...set];
}

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}
function clampLon(lon: number): number {
  return Math.max(-180, Math.min(180, lon));
}
