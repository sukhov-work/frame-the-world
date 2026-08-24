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
 *                         …and, since 2026-08-24, its POLYGON features as VecAreaFeat kind "deck"
 *   waterway            → VecLineFeat kind "waterway" (river/stream lines)
 *   water               → VecPolyFeat kind "water" (river/lake surfaces — the Dnipro IS a polygon)
 *   landcover/park      → VecPolyFeat kind "green" (grass/wood/park fills)
 *   landcover (rest)    → VecAreaFeat kind "landcover" (wetland/sand/farmland — NOT map ink)
 *   landuse             → VecAreaFeat kind "landuse" (military/industrial/pitch/…)
 *   building            → VecPolyFeat kind "building" (footprints — the FPV mini-map's anchor
 *                         detail; probe-verified over Dnipro: ~1.5k rings per central z14 tile.
 *                         The 3D web ignores them — only the mini-map draws this kind.)
 *
 * ── THE 2026-08-24 WIDENING (BESTSPOT_PLAN §4, "parser widening") ────────────────────────────
 * Five fields and one whole geometry class were being read off the wire and thrown on the floor.
 * The widening is **ADDITIVE BY CONTRACT**: every field it adds is OPTIONAL, the new geometry
 * lands in a NEW array (`areas`), and nothing an existing consumer already destructured changed
 * value — `vectorFeatures`, `streetNames`, `minimapFeed` and `MiniMap` see byte-identical
 * `lines`/`polys`/`labels`. Two consequences of that rule are load-bearing and are commented at
 * their sites: `VecLineFeat.tunnel` still ignores waterway brunnels (see `brunnel`), and the
 * landcover→"green" filter still admits exactly the same features (see GREEN_CLASSES).
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

export interface VecLineFeat {
  kind: "road" | "waterway";
  /** OpenMapTiles class (motorway/primary/…/river/stream). */
  cls: string;
  bridge: boolean;
  /** ROAD brunnels only — deliberately NOT set for waterways. `minimapFeed` skips `tunnel` lines,
   *  so flipping this on for a culverted drain would DELETE it from the shipped FPV mini-map: a
   *  behaviour change, which this widening is not allowed to make. Consumers that want the honest
   *  answer for a waterway read `brunnel` instead. (Recorded 2026-08-24: the mini-map drawing a
   *  culverted drain as a visible watercourse is a real, pre-existing, out-of-scope defect.) */
  tunnel: boolean;
  /** Raw OpenMapTiles `brunnel` ("bridge" | "tunnel" | "ford"), for BOTH kinds. */
  brunnel?: string;
  /** OpenMapTiles `subclass` — the PEDESTRIAN taxonomy (footway / steps / path / cycleway) that
   *  `class` flattens into a single "path". Measured in the Dnipro 3×3 ring: footway 88, pedestrian
   *  31, steps 30, path 26, cycleway 17 — an accessibility ladder that cannot rank a staircase
   *  against a promenade without this field. */
  subclass?: string;
  /** `surface` (paved / unpaved / gravel / …). Unpaved DEMOTES a way; it never certifies one. */
  surface?: string;
  /** `access` (no / private / customers / …) — a HARD exclusion for the BEST SPOT ground rules. */
  access?: string;
  /** `foot` (no / yes / designated). `foot=no` demotes. */
  foot?: string;
  /** OSM `layer` (…, −1, 0, 1, …). SIGNED, and absent stays `undefined` rather than collapsing to
   *  0 — a tile that omits the tag is not asserting ground level. */
  layer?: number;
  /** `intermittent` — a seasonal watercourse is evidence of wet ground, not of standing water. */
  intermittent?: boolean;
  /** Polylines as [lon, lat][][] (a feature may be a multiline). */
  lines: [number, number][][];
}

export interface VecPolyFeat {
  kind: "water" | "green" | "building";
  /** Polygons as GeoJSON-style rings: [polygon][ring][vertex][lon, lat] (ring 0 = outer). */
  polys: [number, number][][][];
  /** OpenMapTiles `class`. water: lake / river / pond / **swimming_pool** — "the Dnipro" and "a
   *  hotel pool" were the same object before this field survived. landcover: grass / wood / sand. */
  cls?: string;
  /** OpenMapTiles `subclass`. landcover's park / meadow / pitch / recreation_ground live HERE and
   *  NOT in `class` — see the GREEN_CLASSES note for the dead branch that hid them. */
  subclass?: string;
  /** water only — a seasonal pond is not a standing hazard. */
  intermittent?: boolean;
  /** building only: the extrusion envelope, present on EVERY z14 building feature (probed). A point
   *  is inside a SOLID INTERIOR when `renderMinHeightM <= h < renderHeightM`, which is the whole of
   *  owner ruling R1's aerial mask — a drone flies THROUGH the arch of a building on stilts. */
  renderHeightM?: number;
  renderMinHeightM?: number;
}

/**
 * A polygon that is neither map ink nor a footprint — pure ACCESSIBILITY evidence, kept in its own
 * array so the shipped `polys` consumers keep a closed 3-kind union and cannot be broken by it.
 *
 *  · "deck"      — the transportation layer's POLYGON features. `vectorTiles` threw these away for
 *                  a year (`if (f.type !== 2) continue; // skip … plazas/piers`), and with them a
 *                  29,039 m² bridge deck at 48.47831,35.05757 — the OWNER'S HERO LOCATION, the one
 *                  standable strip over the Dnipro. Also piers, pedestrian plazas and platforms.
 *  · "landuse"   — the whole landuse layer (military / industrial / railway / quarry / landfill /
 *                  construction are hard exclusions; pitch / playground are soft ones). C6-relevant.
 *  · "landcover" — the landcover features the "green" map-ink filter REJECTS (wetland, sand/beach,
 *                  farmland, ice, rock). They are not ink, but "is this a swamp" is exactly the
 *                  question the accessibility ladder asks. Geometry is never duplicated: a feature
 *                  goes to `polys` as green OR here, never both.
 */
export interface VecAreaFeat {
  kind: "deck" | "landuse" | "landcover";
  /** OpenMapTiles `class` ("" when the tile omits it). */
  cls: string;
  /** OpenMapTiles `subclass` ("" when absent). */
  subclass: string;
  /** `access` (no / private / …) where the schema carries it. */
  access?: string;
  /** OSM `layer` — a bridge deck carries ≥ 1; absent stays `undefined` (see VecLineFeat.layer). */
  layer?: number;
  /** Polygons as GeoJSON-style rings: [polygon][ring][vertex][lon, lat] (ring 0 = outer). */
  polys: [number, number][][][];
}

export interface ParsedVtile {
  tx: number;
  ty: number;
  labels: StreetLabelFeat[];
  lines: VecLineFeat[];
  polys: VecPolyFeat[];
  /** ADDED 2026-08-24. A separate array on purpose — see VecAreaFeat. */
  areas: VecAreaFeat[];
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

/**
 * Map-ink "green". Mixed on purpose: `grass`/`wood` are landcover **classes**, while
 * `park`/`meadow`/`recreation_ground` are landcover **subclasses** (all three sit under
 * `class = "grass"`).
 *
 * THE DEAD BRANCH (BESTSPOT_PLAN §4, fixed 2026-08-24): the filter used to be called with
 * `String(f.properties.class ?? f.properties.subclass ?? "")`. EVERY landcover feature carries
 * `class`, so `??` short-circuited on the first operand every single time and the subclass half of
 * this set was unreachable code. `isGreen` now reads both explicitly. The set is deliberately left
 * as-is: at OpenMapTiles' mapping the three subclasses all live under `class = "grass"`, which
 * already matched — so the fix restores the INTENT without changing which features become ink,
 * which is what keeps the widening additive.
 */
const GREEN_CLASSES = new Set(["grass", "wood", "park", "meadow", "recreation_ground"]);

/** Green iff the class OR the subclass is green — the fix for the `class ?? subclass` dead branch. */
const isGreen = (cls: string, subclass: string): boolean =>
  GREEN_CLASSES.has(cls) || GREEN_CLASSES.has(subclass);

/** MVT property → string, absent stays absent. `String(undefined)` yields the literal "undefined",
 *  which is how a missing tag becomes a value that silently matches nothing forever. */
const propStr = (v: number | string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : String(v);

/** MVT property → finite number, absent/garbage stays absent (heights and `layer` are both signed
 *  and both legitimately 0, so a 0 fallback would be indistinguishable from real data). */
const propNum = (v: number | string | boolean | undefined): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** MVT property → boolean. OpenMapTiles encodes `intermittent` as the integer 0/1, not a bool. */
const propBool = (v: number | string | boolean | undefined): boolean | undefined => {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v === "true" || v === "1" || v === "yes";
};

const classRank = new Map<string, number>(STREETS.classPriority.map((c, i) => [c, i] as const));

const toLonLat = (tx: number, ty: number, extent: number, p: { x: number; y: number }) => {
  const { lonDeg, latDeg } = tileLocalToLonLat(STREETS.tileZ, tx, ty, extent, p.x, p.y);
  return [lonDeg, latDeg] as [number, number];
};

/** Tile-local rings → clipped lon/lat polygons, GeoJSON-style ([polygon][ring][vertex]).
 *  MVT emits a FLAT ring list: a positive-area ring opens a polygon, negative-area rings are
 *  holes of the last one opened. Rings are clipped to the exact tile square FIRST — the
 *  encoder's buffer otherwise overlaps the neighbour tile's fill (the "river flicker"). */
const ringsOfFeature = (
  f: { loadGeometry(): { x: number; y: number }[][] },
  extent: number,
  tx: number,
  ty: number,
): [number, number][][][] => {
  const polys: [number, number][][][] = [];
  for (const rawRing of f.loadGeometry()) {
    if (rawRing.length < 4) continue;
    const ring = clipRingToBounds(rawRing, 0, extent);
    if (ring.length < 3) continue;
    const outer = ringArea(ring) > 0;
    const lonlat = ring.map((p) => toLonLat(tx, ty, extent, p));
    if (outer || polys.length === 0) polys.push([lonlat]);
    else polys[polys.length - 1].push(lonlat);
  }
  return polys;
};

/**
 * Parse ONE z14 MVT tile into plain lon/lat data. Pure and GL-free (the scene-test twin rule):
 * hoisted out of `attachVectorTiles`'s closure 2026-08-24 so a committed fixture tile can be run
 * through the real parser in vitest — the deck/landuse/subclass widening is otherwise only
 * observable through a network fetch, and an unfalsifiable check is the exact failure mode this
 * feature's plan opens with.
 */
export const parseVectorTile = (buf: ArrayBuffer, tx: number, ty: number): ParsedVtile => {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const out: ParsedVtile = { tx, ty, labels: [], lines: [], polys: [], areas: [] };

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

  // --- transportation → road lines + (2026-08-24) DECK polygons -----------------------------
  const roadLayer = vt.layers["transportation"];
  if (roadLayer) {
    for (let i = 0; i < roadLayer.length; i++) {
      const f = roadLayer.feature(i);
      // The schema's POLYGON features. This branch sits ABOVE the roadWidthM gate on purpose:
      // the hero deck's class is "bridge", which is not a ribbon width and never will be.
      if (f.type === 3) {
        const polys = ringsOfFeature(f, roadLayer.extent, tx, ty);
        if (polys.length === 0) continue;
        out.areas.push({
          kind: "deck",
          cls: String(f.properties.class ?? ""),
          subclass: String(f.properties.subclass ?? ""),
          access: propStr(f.properties.access),
          layer: propNum(f.properties.layer),
          polys,
        });
        continue;
      }
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
        brunnel: propStr(f.properties.brunnel),
        subclass: propStr(f.properties.subclass),
        surface: propStr(f.properties.surface),
        access: propStr(f.properties.access),
        foot: propStr(f.properties.foot),
        layer: propNum(f.properties.layer),
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
        // `bridge`/`tunnel` stay hard-false for waterways — see VecLineFeat.tunnel. The truth is
        // in `brunnel`, which the accessibility raster reads to stop a CULVERTED drain from
        // being scored as an open hazard.
        bridge: false,
        tunnel: false,
        brunnel: propStr(f.properties.brunnel),
        intermittent: propBool(f.properties.intermittent),
        lines,
      });
    }
  }

  // --- water + landcover/park + building → fill polygons; landuse + rejected landcover → areas
  const polyLayers: {
    name: string;
    kind: VecPolyFeat["kind"] | null;
    /** Reads class AND subclass EXPLICITLY — the `class ?? subclass` dead branch (see isGreen). */
    filter?: (cls: string, subclass: string) => boolean;
    /** Where a feature the filter REJECTS goes instead. Nothing is duplicated: a landcover ring
     *  is map ink (`polys`) or accessibility evidence (`areas`), never both. `kind: null` sends
     *  the WHOLE layer to `areas` (landuse is never ink). */
    rejectsTo?: VecAreaFeat["kind"];
  }[] = [
    { name: "water", kind: "water" },
    { name: "landcover", kind: "green", filter: isGreen, rejectsTo: "landcover" },
    { name: "park", kind: "green" },
    { name: "building", kind: "building" }, // mini-map footprints (merged multipolygons at z14)
    { name: "landuse", kind: null, rejectsTo: "landuse" }, // military/industrial/pitch — C6
  ];
  for (const { name, kind, filter, rejectsTo } of polyLayers) {
    const layer = vt.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class ?? "");
      const subclass = String(f.properties.subclass ?? "");
      if (kind === null || (filter && !filter(cls, subclass))) {
        if (!rejectsTo) continue;
        const rejected = ringsOfFeature(f, layer.extent, tx, ty);
        if (rejected.length === 0) continue;
        out.areas.push({
          kind: rejectsTo,
          cls,
          subclass,
          access: propStr(f.properties.access),
          layer: propNum(f.properties.layer),
          polys: rejected,
        });
        continue;
      }
      const polys = ringsOfFeature(f, layer.extent, tx, ty);
      if (polys.length === 0) continue;
      out.polys.push({
        kind,
        polys,
        cls: propStr(f.properties.class),
        subclass: propStr(f.properties.subclass),
        intermittent: propBool(f.properties.intermittent),
        renderHeightM: propNum(f.properties.render_height),
        renderMinHeightM: propNum(f.properties.render_min_height),
      });
    }
  }
  return out;
};

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
          cache.set(key, parseVectorTile(buf, tx, ty));
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
