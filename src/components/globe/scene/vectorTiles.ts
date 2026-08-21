import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { STREETS, VECTOR } from "../tuning";

/**
 * Shared OpenFreeMap MVT source (S7 feedback batch). One fetch/parse per z14 tile now feeds TWO
 * consumers — street-name labels (scene/streetNames) and the vector feature web (roads/water/
 * green, scene/vectorFeatures) — where S7 v2 threw the geometry away after deriving label
 * anchors. The TileJSON is resolved once at attach (the dated tile-path segment rotates with
 * OpenFreeMap's builds — never hardcode it); tiles parse into plain lon/lat data (no three
 * imports — unit-testable), consumers build their own GL from it.
 *
 * OpenMapTiles schema, maxzoom 14 (deeper tiles do not exist — probe-verified S7). Parsed layers:
 *   transportation_name → StreetLabelFeat (one candidate label per named line feature)
 *   transportation      → VecLineFeat kind "road" (class + brunnel; tunnels kept but flagged)
 *   waterway            → VecLineFeat kind "waterway" (river/stream lines)
 *   water               → VecPolyFeat kind "water" (river/lake surfaces — the Dnipro IS a polygon)
 *   landcover/park      → VecPolyFeat kind "green" (grass/wood/park fills)
 *   building            → VecPolyFeat kind "building" (footprints — the FPV mini-map's anchor
 *                         detail; probe-verified over Dnipro: ~1.5k rings per central z14 tile.
 *                         The 3D web ignores them — only the mini-map draws this kind.)
 */

export interface StreetLabelFeat {
  name: string;
  /** Index into STREETS.classPriority (lower = more important). */
  rank: number;
  /** Tile-local line length (extent units) — the selection tiebreak. */
  lineLen: number;
  /** Anchor + a direction point along the street. v4: a long named line carries SEVERAL
   *  anchors (every STREETS.repeatEveryM of arc length) — Google-style repeats; the consumer's
   *  same-name separation keeps them apart on screen. */
  latDeg: number;
  lonDeg: number;
  bLatDeg: number;
  bLonDeg: number;
}

interface VecLineFeat {
  kind: "road" | "waterway";
  /** OpenMapTiles class (motorway/primary/…/river/stream). */
  cls: string;
  bridge: boolean;
  tunnel: boolean;
  /** Polylines as [lon, lat][][] (a feature may be a multiline). */
  lines: [number, number][][];
}

interface VecPolyFeat {
  kind: "water" | "green" | "building";
  /** Polygons as GeoJSON-style rings: [polygon][ring][vertex][lon, lat] (ring 0 = outer). */
  polys: [number, number][][][];
}

interface ParsedVtile {
  tx: number;
  ty: number;
  labels: StreetLabelFeat[];
  lines: VecLineFeat[];
  polys: VecPolyFeat[];
}

export interface VectorTilesHandle {
  /** Fire-and-forget: keep a (2·ring+1)² neighborhood around the focus fetched. */
  ensureRing(focusLatDeg: number, focusLonDeg: number, ring: number): void;
  /** Parsed tiles, keyed "tx/ty" at STREETS.tileZ. */
  tiles(): ReadonlyMap<string, ParsedVtile | "pending" | "failed">;
  /** Bumps whenever a tile finishes parsing — consumers rebuild on change, never per frame. */
  version(): number;
  dispose(): void;
}

/** Web-mercator tile of a lon/lat at zoom z (pure — unit-tested). */
export function lonLatToTile(lonDeg: number, latDeg: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (latDeg * Math.PI) / 180;
  return {
    x: Math.floor(((lonDeg + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
}

/** Tile-local MVT coordinates (0..extent) → lon/lat degrees (pure — unit-tested). */
export function tileLocalToLonLat(
  z: number,
  x: number,
  y: number,
  extent: number,
  px: number,
  py: number,
): { lonDeg: number; latDeg: number } {
  const n = 2 ** z;
  const lonDeg = ((x + px / extent) / n) * 360 - 180;
  const latDeg =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return { lonDeg, latDeg };
}

/** Signed area of a tile-local ring (MVT y grows south → positive = clockwise = outer). Pure. */
export function ringArea(ring: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

type Pt = { x: number; y: number };

/** One Sutherland–Hodgman half-plane pass (axis ≥/≤ bound), lerped intersections. */
function clipHalfPlane(pts: Pt[], axis: "x" | "y", bound: number, keepGreater: boolean): Pt[] {
  const out: Pt[] = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const aIn = keepGreater ? a[axis] >= bound : a[axis] <= bound;
    const bIn = keepGreater ? b[axis] >= bound : b[axis] <= bound;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Clip a polygon ring to the square [min,max]² (Sutherland–Hodgman; winding preserved;
 *  < 3 vertices left → []). MVT features carry a BUFFER past the tile edge, so unclipped
 *  neighbor tiles OVERLAP — two translucent water fills z-fighting at every seam was the
 *  "river tiles flicker" (S7 feedback #2). Pure — unit-tested. */
export function clipRingToBounds(ring: Pt[], min: number, max: number): Pt[] {
  let r = clipHalfPlane(ring, "x", min, true);
  if (r.length >= 3) r = clipHalfPlane(r, "x", max, false);
  if (r.length >= 3) r = clipHalfPlane(r, "y", min, true);
  if (r.length >= 3) r = clipHalfPlane(r, "y", max, false);
  return r.length >= 3 ? r : [];
}

/** Liang–Barsky clip of one segment to the square; null when fully outside. */
function clipSeg(
  a: Pt,
  b: Pt,
  min: number,
  max: number,
): { a: Pt; b: Pt; aClipped: boolean; bClipped: boolean } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - min, max - a.x, a.y - min, max - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return null;
    } else {
      const r = q[k] / p[k];
      if (p[k] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return {
    a: t0 > 0 ? { x: a.x + dx * t0, y: a.y + dy * t0 } : a,
    b: t1 < 1 ? { x: a.x + dx * t1, y: a.y + dy * t1 } : b,
    aClipped: t0 > 0,
    bClipped: t1 < 1,
  };
}

/** Clip a polyline to the square [min,max]², splitting it where it leaves the bounds
 *  (same buffer-overlap rationale as clipRingToBounds). Pure — unit-tested. */
export function clipLineToBounds(pts: Pt[], min: number, max: number): Pt[][] {
  const parts: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSeg(pts[i], pts[i + 1], min, max);
    if (!seg) {
      if (cur.length > 1) parts.push(cur);
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(seg.a);
    else if (seg.aClipped) {
      // discontinuity (re-entry) — flush and restart at the entry point
      parts.push(cur);
      cur = [seg.a];
    }
    cur.push(seg.b);
    if (seg.bClipped) {
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

/** Arc-length anchors along a tile-local polyline (v4 — "names along the streets"): one anchor
 *  every stepUnits of accumulated length starting at stepUnits/2, each with the direction point
 *  of the segment it lands on; a line shorter than one step keeps the v3 single mid-vertex
 *  anchor. Capped at maxAnchors (spread from the start — long streets repeat, never crowd).
 *  Pure — unit-tested. */
export function sampleLineAnchors(
  line: Pt[],
  stepUnits: number,
  maxAnchors: number,
): { a: Pt; b: Pt }[] {
  if (line.length < 2) return [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  }
  const mid = Math.floor((line.length - 1) / 2);
  const midNext = Math.min(mid + 1, line.length - 1);
  if (!(stepUnits > 0) || total < stepUnits) {
    return [{ a: line[mid], b: line[midNext] }];
  }
  const out: { a: Pt; b: Pt }[] = [];
  let next = stepUnits / 2;
  const lastAt = total - stepUnits / 2; // half-step end margin (no anchor at the line tip —
  let walked = 0; //                       its direction point would be degenerate)
  for (let i = 1; i < line.length && out.length < maxAnchors; i++) {
    const p = line[i - 1];
    const q = line[i];
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    while (walked + seg >= next && next <= lastAt && out.length < maxAnchors) {
      const t = seg > 1e-9 ? (next - walked) / seg : 0;
      out.push({ a: { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, b: q });
      next += stepUnits;
    }
    walked += seg;
  }
  return out.length > 0 ? out : [{ a: line[mid], b: line[midNext] }];
}

const GREEN_CLASSES = new Set(["grass", "wood", "park", "meadow", "recreation_ground"]);

export function attachVectorTiles(): VectorTilesHandle {
  let tileTemplate: string | null = null;
  const abort = new AbortController();
  const templateReady = fetch(STREETS.tileJsonUrl, { signal: abort.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((tj: { tiles: string[] }) => {
      tileTemplate = tj.tiles[0];
    })
    .catch((e) => console.warn("[globe] vector-tile TileJSON unavailable:", e));

  const cache = new Map<string, ParsedVtile | "pending" | "failed">();
  let version = 0;
  const classRank = new Map<string, number>(STREETS.classPriority.map((c, i) => [c, i] as const));

  const toLonLat = (tx: number, ty: number, extent: number, p: { x: number; y: number }) => {
    const { lonDeg, latDeg } = tileLocalToLonLat(STREETS.tileZ, tx, ty, extent, p.x, p.y);
    return [lonDeg, latDeg] as [number, number];
  };

  const parseTile = (buf: ArrayBuffer, tx: number, ty: number): ParsedVtile => {
    const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
    const out: ParsedVtile = { tx, ty, labels: [], lines: [], polys: [] };

    // --- transportation_name → label candidates (S7 v2 logic, geometry-free) -----------------
    const nameLayer = vt.layers["transportation_name"];
    if (nameLayer) {
      for (let i = 0; i < nameLayer.length; i++) {
        const f = nameLayer.feature(i);
        const name = f.properties.name;
        if (typeof name !== "string" || name.length === 0 || f.type !== 2) continue;
        const rank = classRank.get(String(f.properties.class)) ?? STREETS.classPriority.length;
        // Longest line of the (multi)line — its middle vertex anchors the label, the next
        // vertex gives the street direction.
        let line: { x: number; y: number }[] | null = null;
        let lineLen = 0;
        for (const cand of f.loadGeometry()) {
          if (cand.length < 2) continue;
          let len = 0;
          for (let v = 1; v < cand.length; v++) {
            len += Math.hypot(cand[v].x - cand[v - 1].x, cand[v].y - cand[v - 1].y);
          }
          if (len > lineLen) {
            lineLen = len;
            line = cand;
          }
        }
        if (!line) continue;
        // v4: repeat anchors along the line every STREETS.repeatEveryM (converted to extent
        // units at this tile's latitude — a z14 tile is ~2.4 km wide at 48°N).
        const centreLat = tileLocalToLonLat(
          STREETS.tileZ,
          tx,
          ty,
          nameLayer.extent,
          nameLayer.extent / 2,
          nameLayer.extent / 2,
        ).latDeg;
        const tileWidthM =
          (40_075_016.686 * Math.cos((centreLat * Math.PI) / 180)) / 2 ** STREETS.tileZ;
        const stepUnits = (STREETS.repeatEveryM / tileWidthM) * nameLayer.extent;
        for (const { a: pA, b: pB } of sampleLineAnchors(
          line,
          stepUnits,
          STREETS.maxAnchorsPerFeat,
        )) {
          const a = toLonLat(tx, ty, nameLayer.extent, pA);
          const b = toLonLat(tx, ty, nameLayer.extent, pB);
          out.labels.push({
            name,
            rank,
            lineLen,
            lonDeg: a[0],
            latDeg: a[1],
            bLonDeg: b[0],
            bLatDeg: b[1],
          });
        }
      }
    }

    // --- transportation → road lines (skip the schema's polygon features — plazas/piers) -----
    const roadLayer = vt.layers["transportation"];
    if (roadLayer) {
      for (let i = 0; i < roadLayer.length; i++) {
        const f = roadLayer.feature(i);
        if (f.type !== 2) continue;
        const cls = String(f.properties.class ?? "");
        if (!(cls in VECTOR.roadWidthM)) continue; // transit/aerialway/construction noise stays out
        const brunnel = String(f.properties.brunnel ?? "");
        const lines: [number, number][][] = [];
        for (const part of f.loadGeometry()) {
          if (part.length < 2) continue;
          // Clip away the MVT buffer — neighbor tiles otherwise draw the same road twice.
          for (const clipped of clipLineToBounds(part, 0, roadLayer.extent)) {
            lines.push(clipped.map((p) => toLonLat(tx, ty, roadLayer.extent, p)));
          }
        }
        if (lines.length === 0) continue;
        out.lines.push({
          kind: "road",
          cls,
          bridge: brunnel === "bridge",
          tunnel: brunnel === "tunnel",
          lines,
        });
      }
    }

    // --- waterway → river/stream lines --------------------------------------------------------
    const waterwayLayer = vt.layers["waterway"];
    if (waterwayLayer) {
      for (let i = 0; i < waterwayLayer.length; i++) {
        const f = waterwayLayer.feature(i);
        if (f.type !== 2) continue;
        const lines: [number, number][][] = [];
        for (const part of f.loadGeometry()) {
          if (part.length < 2) continue;
          for (const clipped of clipLineToBounds(part, 0, waterwayLayer.extent)) {
            lines.push(clipped.map((p) => toLonLat(tx, ty, waterwayLayer.extent, p)));
          }
        }
        if (lines.length === 0) continue;
        out.lines.push({
          kind: "waterway",
          cls: String(f.properties.class ?? "stream"),
          bridge: false,
          tunnel: false,
          lines,
        });
      }
    }

    // --- water + landcover/park → fill polygons (outer/hole split by ring winding) ------------
    const polyLayers: { name: string; kind: VecPolyFeat["kind"]; filter?: (cls: string) => boolean }[] = [
      { name: "water", kind: "water" },
      { name: "landcover", kind: "green", filter: (c) => GREEN_CLASSES.has(c) },
      { name: "park", kind: "green" },
      { name: "building", kind: "building" }, // mini-map footprints (merged multipolygons at z14)
    ];
    for (const { name, kind, filter } of polyLayers) {
      const layer = vt.layers[name];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        if (filter && !filter(String(f.properties.class ?? f.properties.subclass ?? ""))) continue;
        // MVT polygons arrive as a flat ring list: positive-area rings open a polygon,
        // negative-area rings are holes of the last opened one. Rings are clipped to the
        // exact tile square FIRST — the encoder's buffer otherwise overlaps the neighbor
        // tile's fill (two translucent water surfaces z-fighting = the river flicker).
        const polys: [number, number][][][] = [];
        for (const rawRing of f.loadGeometry()) {
          if (rawRing.length < 4) continue;
          const ring = clipRingToBounds(rawRing, 0, layer.extent);
          if (ring.length < 3) continue;
          const outer = ringArea(ring) > 0;
          const lonlat = ring.map((p) => toLonLat(tx, ty, layer.extent, p));
          if (outer || polys.length === 0) polys.push([lonlat]);
          else polys[polys.length - 1].push(lonlat);
        }
        if (polys.length) out.polys.push({ kind, polys });
      }
    }
    return out;
  };

  const ensureTile = (tx: number, ty: number) => {
    const key = `${tx}/${ty}`;
    if (cache.has(key)) return;
    cache.set(key, "pending");
    templateReady.then(() => {
      if (!tileTemplate) {
        cache.set(key, "failed");
        return;
      }
      const url = tileTemplate
        .replace("{z}", String(STREETS.tileZ))
        .replace("{x}", String(tx))
        .replace("{y}", String(ty));
      // #15(c) (batch #4 S3): the TileJSON template embeds a dated build path → tile URLs are
      // immutable; force-cache skips revalidation. The /planet TileJSON fetch above keeps the
      // default mode — it is the mutable pointer that rotates to each new OpenFreeMap build.
      fetch(url, { signal: abort.signal, cache: "force-cache" })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((buf) => {
          cache.set(key, parseTile(buf, tx, ty));
          version++;
        })
        .catch(() => cache.set(key, "failed")); // empty/failed tiles stay failed — no refetch churn
      // LRU-ish eviction: drop the oldest parsed entries once over budget (pendings are kept).
      while (cache.size > VECTOR.tileCacheMax) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined || cache.get(oldest) === "pending") break;
        cache.delete(oldest);
        version++;
      }
    });
  };

  return {
    ensureRing(focusLatDeg, focusLonDeg, ring) {
      const t = lonLatToTile(focusLonDeg, focusLatDeg, STREETS.tileZ);
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          ensureTile(t.x + dx, t.y + dy);
        }
      }
    },
    tiles() {
      return cache;
    },
    version() {
      return version;
    },
    dispose() {
      abort.abort();
      cache.clear();
    },
  };
}
