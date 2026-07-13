// C6 (wartime geo-sensitivity) exclusion filter — applied BEFORE tiling, per the plan's
// "military/critical-infrastructure exclusion mask applied BEFORE tiling (first-class, not bolted on)".
//
// Two layers: a conservative built-in TAG blocklist (errs toward excluding), plus optional per-city
// POLYGON exclusions (GeoJSON-style rings) matched against the building footprint centroid. The set of
// applied rules and the excluded count are reported by the baker (no silent drops).

/** Default sensitive-tag rules. `[k]` excludes any `k=*`; `[k, v]` excludes only `k=v`. */
export const DEFAULT_EXCLUDE_TAGS = [
  ["military"], // military=* (base, danger_area, bunker, checkpoint, …)
  ["landuse", "military"],
  ["building", "military"],
  ["building", "bunker"],
  ["building:use", "military"],
  ["power", "substation"], // critical infrastructure
  ["power", "plant"],
  ["power", "generator"],
  ["power", "transformer"],
];

/** Ray-casting point-in-polygon. `ring` = [[lon,lat], …] (first/last need not be equal). */
export function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Build an excluder for a city config.
 * @returns {(tags:Record<string,string>, lon:number, lat:number) => string|null} matched rule, or null.
 */
export function makeExcluder(config) {
  const tagRules = config?.exclusion?.tags ?? DEFAULT_EXCLUDE_TAGS;
  const polys = config?.exclusion?.polygons ?? []; // [{ id, ring:[[lon,lat],…] }] or bare rings
  return function excluded(tags, lon, lat) {
    for (const [k, v] of tagRules) {
      if (v === undefined) {
        if (tags[k] !== undefined) return `tag:${k}`;
      } else if (tags[k] === v) {
        return `tag:${k}=${v}`;
      }
    }
    for (let i = 0; i < polys.length; i++) {
      const ring = polys[i].ring ?? polys[i];
      if (Array.isArray(ring) && pointInPolygon(lon, lat, ring)) return `polygon:${polys[i].id ?? i}`;
    }
    return null;
  };
}
