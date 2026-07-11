/**
 * Free geocoding for the location finder (Phase 5.5 S1) — a tiny provider adapter so endpoints
 * can swap without touching the UI (both public instances are fair-use with no SLA).
 *
 *  • Photon (photon.komoot.io) — search-as-you-type. Keyless, CORS `*`, autocomplete is its
 *    designed use. MUST be debounced (tuning.SEARCH.debounceMs) and MUST carry a lat/lon bias
 *    (the camera's view focus) — unbiased POI ranking is unusable ("eiffel tower" → Canada).
 *  • Nominatim (nominatim.openstreetmap.org) — explicit-submit only. Its usage policy FORBIDS
 *    autocomplete, caps at 1 req/s, and requires client-side caching of results; global
 *    importance ranking + zip handling are better than Photon's, which is why Enter re-asks it.
 *
 * Both serve OpenStreetMap data (ODbL) — the UI shows "© OpenStreetMap contributors".
 * Parsers are pure and exported for unit tests; fetchers are thin and abortable.
 */

import { SEARCH } from "../../components/globe/tuning";

export interface GeocodeHit {
  /** Primary label — place / street / POI name. */
  name: string;
  /** Secondary context — "city, region, country" (deduped, may be empty). */
  detail: string;
  latDeg: number;
  lonDeg: number;
  /** Largest angular span (deg) of the result's bounding extent, when the provider gives one —
   *  drives the fly-to arrival altitude (city ≫ street address). */
  spanDeg?: number;
}

/** Metres per degree of latitude (WGS84 mean) — good enough for arrival-altitude sizing. */
const M_PER_DEG = 111_320;

/** Result extent → fly-to arrival altitude (m), clamped to SEARCH.altMinM..altMaxM.
 *  No extent → SEARCH.altDefaultM. The floor is load-bearing: the flight path is terrain-blind
 *  until the S2 flight fix, so arrivals must never hug the ground. */
export function arrivalAltM(spanDeg: number | undefined): number {
  if (spanDeg === undefined || !Number.isFinite(spanDeg) || spanDeg <= 0) {
    return SEARCH.altDefaultM;
  }
  const spanM = spanDeg * M_PER_DEG;
  return Math.min(SEARCH.altMaxM, Math.max(SEARCH.altMinM, spanM * SEARCH.extentAltFactor));
}

/** Join context parts, dropping empties and consecutive duplicates ("Paris, Paris, France"). */
function joinDetail(parts: Array<string | undefined>): string {
  const clean: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (clean[clean.length - 1] === p) continue;
    clean.push(p);
  }
  return clean.join(", ");
}

/** Photon GeoJSON → hits. Coordinates are [lon, lat]; `extent` is [minLon, maxLat, maxLon, minLat]. */
export function parsePhoton(json: unknown, limit: number = SEARCH.limit): GeocodeHit[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const hits: GeocodeHit[] = [];
  for (const f of features) {
    const props = (f as any)?.properties ?? {};
    const coords = (f as any)?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lonDeg = Number(coords[0]);
    const latDeg = Number(coords[1]);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
    const name =
      props.name ??
      joinDetail([props.housenumber && props.street ? `${props.street} ${props.housenumber}` : props.street, props.postcode]) ??
      "";
    if (!name) continue;
    let spanDeg: number | undefined;
    const ext = props.extent;
    if (Array.isArray(ext) && ext.length === 4) {
      const lonSpan = Math.abs(Number(ext[2]) - Number(ext[0])) * Math.cos((latDeg * Math.PI) / 180);
      const latSpan = Math.abs(Number(ext[1]) - Number(ext[3]));
      const s = Math.max(lonSpan, latSpan);
      if (Number.isFinite(s) && s > 0) spanDeg = s;
    }
    hits.push({
      name,
      detail: joinDetail([props.city, props.state, props.country]),
      latDeg,
      lonDeg,
      spanDeg,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Nominatim jsonv2 → hits. lat/lon are strings; boundingbox is [latMin, latMax, lonMin, lonMax]. */
export function parseNominatim(json: unknown, limit: number = SEARCH.limit): GeocodeHit[] {
  if (!Array.isArray(json)) return [];
  const hits: GeocodeHit[] = [];
  for (const row of json as any[]) {
    const latDeg = Number(row?.lat);
    const lonDeg = Number(row?.lon);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
    const display = String(row?.display_name ?? "");
    const [name, ...rest] = display.split(", ");
    if (!name) continue;
    let spanDeg: number | undefined;
    const bb = row?.boundingbox;
    if (Array.isArray(bb) && bb.length === 4) {
      const latSpan = Math.abs(Number(bb[1]) - Number(bb[0]));
      const lonSpan = Math.abs(Number(bb[3]) - Number(bb[2])) * Math.cos((latDeg * Math.PI) / 180);
      const s = Math.max(latSpan, lonSpan);
      if (Number.isFinite(s) && s > 0) spanDeg = s;
    }
    hits.push({ name, detail: rest.slice(-3).join(", "), latDeg, lonDeg, spanDeg });
    if (hits.length >= limit) break;
  }
  return hits;
}

// Result caches — Nominatim's policy REQUIRES caching identical queries; Photon just benefits.
const photonCache = new Map<string, GeocodeHit[]>();
const nominatimCache = new Map<string, GeocodeHit[]>();
const CACHE_CAP = 200;
function remember(cache: Map<string, GeocodeHit[]>, key: string, hits: GeocodeHit[]) {
  if (cache.size >= CACHE_CAP) cache.clear(); // tiny session cache — wholesale reset is fine
  cache.set(key, hits);
}

/** Autocomplete search (debounce upstream!). Bias = current camera view focus. */
export async function photonSearch(
  query: string,
  bias: { latDeg: number; lonDeg: number },
  signal?: AbortSignal,
): Promise<GeocodeHit[]> {
  const key = `${query}|${bias.latDeg.toFixed(1)},${bias.lonDeg.toFixed(1)}`;
  const cached = photonCache.get(key);
  if (cached) return cached;
  const url =
    `${SEARCH.photonUrl}?q=${encodeURIComponent(query)}` +
    `&limit=${SEARCH.limit}&lang=en&lat=${bias.latDeg.toFixed(3)}&lon=${bias.lonDeg.toFixed(3)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const hits = parsePhoton(await res.json());
  remember(photonCache, key, hits);
  return hits;
}

/** Explicit-submit search (Enter) — better global ranking + zips. NEVER call per keystroke. */
export async function nominatimSearch(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const cached = nominatimCache.get(query);
  if (cached) return cached;
  const url =
    `${SEARCH.nominatimUrl}?q=${encodeURIComponent(query)}` +
    `&format=jsonv2&limit=${SEARCH.limit}&addressdetails=0&accept-language=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = parseNominatim(await res.json());
  remember(nominatimCache, query, hits);
  return hits;
}
