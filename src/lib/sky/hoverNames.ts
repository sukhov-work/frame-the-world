// Sky hover names (qol4, owner 2026-08-14): given a J2000 unit direction under the cursor,
// name the most specific thing there — an IAU-named star, a named asterism figure, or the
// constellation (figure lines first, label-anchor as the wide fallback). The "brightest Milky
// Way band stars" ask is covered by the star tier: every naked-eye band landmark (Deneb,
// Altair, Antares, Shaula, Nunki, …) is IAU-named and passes the vmag gate.
//
// PURE data-in/data-out: the caller (scene/skyNames) lazy-loads the heavy catalogs
// (lib/sky/starNames + constellations are on the lazyContract HEAVY list) and hands plain
// arrays over — this module never imports them. Angular math on unit vectors only.

export type Vec3 = [number, number, number];

export interface HoverStarIn {
  name: string;
  /** IAU constellation abbreviation — the label's sub-line resolves it to the full name. */
  con: string | null;
  vmag: number | null;
  raDeg: number;
  decDeg: number;
}

export interface HoverFigureIn {
  name: string;
  /** One or more polylines of [raDeg, decDeg] J2000 vertices (the d3-celestial format). */
  lines: [number, number][][];
}

export interface HoverAnchorIn {
  name: string;
  raDeg: number;
  decDeg: number;
}

export interface HoverNameHit {
  kind: "star" | "asterism" | "constellation";
  name: string;
  /** Dimmer second line — the star's constellation, or the tier tag. */
  sub: string | null;
  /** Angular distance to the hit (deg) — the caller may use it for tie-breaking/analytics. */
  sepDeg: number;
}

interface StarEntry {
  name: string;
  sub: string | null;
  hitDeg: number;
  v: Vec3;
}

interface Segment {
  a: Vec3;
  b: Vec3;
  cosAB: number;
}

interface FigureEntry {
  name: string;
  segments: Segment[];
}

interface AnchorEntry {
  name: string;
  v: Vec3;
}

export interface HoverNameIndex {
  stars: StarEntry[];
  asterisms: FigureEntry[];
  constellationFigures: FigureEntry[];
  anchors: AnchorEntry[];
}

export interface HoverIndexOptions {
  /** Stars fainter than this are not hover targets (the IAU list tails into vmag 12 exoplanet
   *  hosts that no eye can find). */
  maxVmag: number;
  /** Star hit radius at vmag 0 and at maxVmag — linear in between (bright = bigger pad). */
  starHitBrightDeg: number;
  starHitFaintDeg: number;
}

/** J2000 RA/Dec (deg) → equatorial unit vector — the star sphere's frame (x at the equinox,
 *  z at the north celestial pole); scene code rotates by −GAST to reach ECEF. */
export function raDecUnit(raDeg: number, decDeg: number): Vec3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angular distance (rad) from unit dir `d` to the great-circle ARC a→b (arcs are ≪ 180°). */
export function arcDistRad(d: Vec3, seg: Segment): number {
  const { a, b, cosAB } = seg;
  // normal of the great circle through a,b
  let nx = a[1] * b[2] - a[2] * b[1];
  let ny = a[2] * b[0] - a[0] * b[2];
  let nz = a[0] * b[1] - a[1] * b[0];
  const L = Math.hypot(nx, ny, nz);
  const endA = Math.acos(Math.min(1, Math.max(-1, dot(d, a))));
  if (L < 1e-9) return endA; // degenerate segment
  nx /= L;
  ny /= L;
  nz /= L;
  const s = d[0] * nx + d[1] * ny + d[2] * nz; // sin of distance to the full circle
  // foot of d on the circle's plane; inside the arc iff it is at least as close to BOTH
  // endpoints as they are to each other (valid for arcs < 180°).
  const fx = d[0] - nx * s;
  const fy = d[1] - ny * s;
  const fz = d[2] - nz * s;
  const fl = Math.hypot(fx, fy, fz);
  if (fl > 1e-9) {
    const foot: Vec3 = [fx / fl, fy / fl, fz / fl];
    if (dot(foot, a) >= cosAB && dot(foot, b) >= cosAB) {
      return Math.abs(Math.asin(Math.min(1, Math.max(-1, s))));
    }
  }
  const endB = Math.acos(Math.min(1, Math.max(-1, dot(d, b))));
  return Math.min(endA, endB);
}

function figureEntry(f: HoverFigureIn): FigureEntry {
  const segments: Segment[] = [];
  for (const line of f.lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = raDecUnit(line[i][0], line[i][1]);
      const b = raDecUnit(line[i + 1][0], line[i + 1][1]);
      segments.push({ a, b, cosAB: dot(a, b) });
    }
  }
  return { name: f.name, segments };
}

export function buildHoverIndex(
  data: {
    stars: HoverStarIn[];
    /** con abbr → full constellation name (the star sub-line). */
    conNames: Record<string, string>;
    asterisms: HoverFigureIn[];
    constellationFigures: HoverFigureIn[];
    anchors: HoverAnchorIn[];
  },
  opts: HoverIndexOptions,
): HoverNameIndex {
  const stars: StarEntry[] = [];
  for (const s of data.stars) {
    if (s.vmag == null || s.vmag > opts.maxVmag) continue;
    const t = Math.min(1, Math.max(0, s.vmag / opts.maxVmag));
    stars.push({
      name: s.name,
      sub: (s.con && data.conNames[s.con]) || null,
      hitDeg: opts.starHitBrightDeg + (opts.starHitFaintDeg - opts.starHitBrightDeg) * t,
      v: raDecUnit(s.raDeg, s.decDeg),
    });
  }
  return {
    stars,
    asterisms: data.asterisms.map(figureEntry),
    constellationFigures: data.constellationFigures.map(figureEntry),
    anchors: data.anchors.map((a) => ({ name: a.name, v: raDecUnit(a.raDeg, a.decDeg) })),
  };
}

export interface HitTestOptions {
  /** Asterism figures only count while their tracery is on screen (FPV + sky guides). */
  includeAsterisms: boolean;
  /** Figure-line hit radius (deg). */
  figureHitDeg: number;
  /** Constellation label-anchor fallback radius (deg) — the "roughly here" tier. */
  anchorHitDeg: number;
}

/** Most-specific name under the cursor: star → asterism figure → constellation figure →
 *  constellation anchor. `dir` must be a J2000 unit vector (rotate the ECEF pick ray by +GAST). */
export function hitTestNames(
  index: HoverNameIndex,
  dir: Vec3,
  opts: HitTestOptions,
): HoverNameHit | null {
  // Tier 1 — named stars: nearest star that falls inside its own magnitude-scaled pad.
  let best: HoverNameHit | null = null;
  let bestSep = Infinity;
  for (const s of index.stars) {
    const sep = (Math.acos(Math.min(1, Math.max(-1, dot(dir, s.v)))) * 180) / Math.PI;
    if (sep <= s.hitDeg && sep < bestSep) {
      bestSep = sep;
      best = { kind: "star", name: s.name, sub: s.sub, sepDeg: sep };
    }
  }
  if (best) return best;

  const nearestFigure = (
    figures: FigureEntry[],
    kind: "asterism" | "constellation",
    hitDeg: number,
  ): HoverNameHit | null => {
    let name: string | null = null;
    let sep = Infinity;
    for (const f of figures) {
      for (const seg of f.segments) {
        const d = (arcDistRad(dir, seg) * 180) / Math.PI;
        if (d < sep) {
          sep = d;
          name = f.name;
        }
      }
    }
    return name && sep <= hitDeg ? { kind, name, sub: null, sepDeg: sep } : null;
  };

  // Tier 2 — asterism figures (only while the tracery is visible).
  if (opts.includeAsterisms) {
    const hit = nearestFigure(index.asterisms, "asterism", opts.figureHitDeg);
    if (hit) return hit;
  }
  // Tier 3 — constellation figure lines.
  const fig = nearestFigure(index.constellationFigures, "constellation", opts.figureHitDeg);
  if (fig) return fig;
  // Tier 4 — constellation label anchor (wide, "somewhere in ...").
  let anchor: HoverNameHit | null = null;
  let anchorSep = Infinity;
  for (const a of index.anchors) {
    const sep = (Math.acos(Math.min(1, Math.max(-1, dot(dir, a.v)))) * 180) / Math.PI;
    if (sep <= opts.anchorHitDeg && sep < anchorSep) {
      anchorSep = sep;
      anchor = { kind: "constellation", name: a.name, sub: null, sepDeg: sep };
    }
  }
  return anchor;
}
