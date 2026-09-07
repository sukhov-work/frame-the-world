import type {
  ParsedVtile,
  StreetLabelFeat,
  VecAreaFeat,
  VecLineFeat,
  VecPolyFeat,
} from "../../components/globe/scene/vectorTiles";

/**
 * The vector-tile WIRE — how a `ParsedVtile` crosses the worker boundary (T77 lever 11, 2026-09-07j).
 *
 * WHY A WIRE AT ALL. `parseVectorTile` runs on the main thread today and its cost on the Pixel's
 * descent is 199–262 ms of the hitch frames (MEASUREMENTS §25.1 / §25.5 — `ringsOfFeature` +
 * `parseVectorTile` + `tileLocalToLonLat`, vector tiles LEADING the app's share after T106). The
 * obvious move — parse in a worker, `postMessage` the `ParsedVtile` — buys NOTHING: measured on the
 * 25 real z14 tiles around the owner's `dnipro-descent` pose, a structured clone of the nested
 * `[lon, lat][][][]` shape costs 60.6 ms against 60.8 ms of parsing (the receive side deserialises
 * ~100k two-element arrays; the serialised form is 7× the PBF). The cost of the parse IS the
 * allocation of those small arrays, so any transport that re-allocates them on the main thread
 * keeps the whole bill there.
 *
 * THIS WIRE. Every coordinate goes into ONE `Float64Array` (exact doubles — identity, not a float32
 * round-trip), every ring/line length and polygon count into ONE `Uint32Array` "shape" stream, and
 * the per-feature scalars (kind, class, flags — a few hundred small objects) ride as plain data.
 * Both typed arrays are TRANSFERRED (zero-copy). Rehydrating the consumer-facing nested arrays on
 * the main thread then costs 3.1 ms for the same 25 tiles — one twentieth of the parse, ≤ 0.54 ms
 * for the heaviest tile on the desktop (≈ 2 ms on the Pixel) — a one-shot seat that cannot make a
 * hitch frame on its own, so it is not sliced.
 *
 * THE CONTRACT IS IDENTITY. `unpackVtile(packVtile(p))` is `toStrictEqual` to `p` — same values,
 * same key ORDER (the geometry key keeps its position in each feature object), same `undefined`-
 * valued optional keys (structured clone preserves them; the round-trip test pins it through
 * `structuredClone` on the committed Dnipro fixture). The four main-thread consumers
 * (`vectorFeatures`, `streetNames`, `minimapFeed`, `landcoverRaster`) and BEST SPOT's
 * `vectorVersion` epoch see exactly what the in-thread parser gave them; `bestSpotWorker` keeps its
 * own in-worker parse and never touches this wire.
 *
 * Pure and three-free (the scene-test twin rule) — imported by the parse worker AND the main thread.
 * The message types and the one request handler live here too, with the PARSER INJECTED: the worker
 * passes `parseVectorTile`, the client's inline twin passes the same function from its caller, and
 * this module never imports `scene/vectorTiles.ts` by value — `vectorTiles` → client → wire is a
 * straight line, and the worker module (which installs `self.onmessage`) is never evaluated on the
 * main thread.
 */

/** A feature with its nested geometry replaced by `null` — the key keeps its position. */
type LineMeta = Omit<VecLineFeat, "lines"> & { lines: null };
type PolyMeta = Omit<VecPolyFeat, "polys"> & { polys: null };
type AreaMeta = Omit<VecAreaFeat, "polys"> & { polys: null };

export interface VtileWire {
  tx: number;
  ty: number;
  /** Geometry-free already — a few dozen small objects, cloned as-is. */
  labels: StreetLabelFeat[];
  lines: LineMeta[];
  polys: PolyMeta[];
  areas: AreaMeta[];
  /**
   * The shape stream, in feature order (lines, then polys, then areas):
   *   line feature → `nLines, len₁ … lenₙ`
   *   poly/area feature → `nPolys, (nRings, len₁ … lenₘ)…`
   */
  shape: Uint32Array;
  /** `lon, lat` pairs in shape order. */
  coords: Float64Array;
}

export interface PackedVtile {
  wire: VtileWire;
  /** The two buffers to hand to `postMessage` — zero-copy across the boundary. */
  transfer: ArrayBuffer[];
}

type LonLat = [number, number];

/** Count first so the typed arrays are allocated ONCE at their exact size — no growth, no slice. */
function sizeOf(p: ParsedVtile): { shape: number; coords: number } {
  let shape = 0;
  let coords = 0;
  for (const f of p.lines) {
    shape += 1 + f.lines.length;
    for (const ln of f.lines) coords += ln.length;
  }
  for (const list of [p.polys, p.areas]) {
    for (const f of list) {
      shape += 1;
      for (const poly of f.polys) {
        shape += 1 + poly.length;
        for (const ring of poly) coords += ring.length;
      }
    }
  }
  return { shape, coords: coords * 2 };
}

export function packVtile(p: ParsedVtile): PackedVtile {
  const size = sizeOf(p);
  const shape = new Uint32Array(size.shape);
  const coords = new Float64Array(size.coords);
  let si = 0;
  let ci = 0;
  const ring = (r: LonLat[]) => {
    shape[si++] = r.length;
    for (let i = 0; i < r.length; i++) {
      coords[ci++] = r[i][0];
      coords[ci++] = r[i][1];
    }
  };
  const lines: LineMeta[] = new Array(p.lines.length);
  for (let i = 0; i < p.lines.length; i++) {
    const f = p.lines[i];
    lines[i] = { ...f, lines: null };
    shape[si++] = f.lines.length;
    for (const ln of f.lines) ring(ln);
  }
  const polyMeta = <F extends VecPolyFeat | VecAreaFeat>(list: F[]) => {
    const out: (Omit<F, "polys"> & { polys: null })[] = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      out[i] = { ...f, polys: null };
      shape[si++] = f.polys.length;
      for (const poly of f.polys) {
        shape[si++] = poly.length;
        for (const r of poly) ring(r);
      }
    }
    return out;
  };
  const polys = polyMeta(p.polys);
  const areas = polyMeta(p.areas);
  return {
    wire: { tx: p.tx, ty: p.ty, labels: p.labels, lines, polys, areas, shape, coords },
    transfer: [shape.buffer as ArrayBuffer, coords.buffer as ArrayBuffer],
  };
}

export function unpackVtile(w: VtileWire): ParsedVtile {
  const { shape, coords } = w;
  let si = 0;
  let ci = 0;
  const ring = (): LonLat[] => {
    const n = shape[si++];
    const out: LonLat[] = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = [coords[ci], coords[ci + 1]];
      ci += 2;
    }
    return out;
  };
  const lines: VecLineFeat[] = new Array(w.lines.length);
  for (let i = 0; i < w.lines.length; i++) {
    const n = shape[si++];
    const ls: LonLat[][] = new Array(n);
    for (let k = 0; k < n; k++) ls[k] = ring();
    // Assigning to the existing `lines: null` key keeps its position in the object.
    const f = { ...w.lines[i] } as unknown as VecLineFeat;
    f.lines = ls;
    lines[i] = f;
  }
  const polyFeats = <F extends VecPolyFeat | VecAreaFeat>(
    list: (Omit<F, "polys"> & { polys: null })[],
  ): F[] => {
    const out: F[] = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const nPolys = shape[si++];
      const ps: LonLat[][][] = new Array(nPolys);
      for (let k = 0; k < nPolys; k++) {
        const nRings = shape[si++];
        const poly: LonLat[][] = new Array(nRings);
        for (let r = 0; r < nRings; r++) poly[r] = ring();
        ps[k] = poly;
      }
      const f = { ...list[i] } as unknown as F;
      f.polys = ps;
      out[i] = f;
    }
    return out;
  };
  const polys = polyFeats<VecPolyFeat>(w.polys);
  const areas = polyFeats<VecAreaFeat>(w.areas);
  return { tx: w.tx, ty: w.ty, labels: w.labels, lines, polys, areas };
}

// ── The messages ─────────────────────────────────────────────────────────────────────────────

export type VtileParseRequest = {
  type: "parse";
  /** The cache key (`"tx/ty"`) — echoed back so an evicted-then-refetched key still seats. */
  key: string;
  buf: ArrayBuffer;
  tx: number;
  ty: number;
};

export type VtileParseMessage =
  | {
      type: "parsed";
      key: string;
      wire: VtileWire;
      /** The parse + pack time (ms) where it ran — the DBG `mvt.workerMaxMs` row. */
      workerMs: number;
    }
  | { type: "failed"; key: string; message: string };

export type VtileParser = (buf: ArrayBuffer, tx: number, ty: number) => ParsedVtile;

/** The ONE request handler — the worker and the client's inline twin both run exactly this. */
export function handleParseRequest(
  msg: VtileParseRequest,
  parse: VtileParser,
  post: (m: VtileParseMessage, transfer: ArrayBuffer[]) => void,
): void {
  try {
    const t0 = performance.now();
    const { wire, transfer } = packVtile(parse(msg.buf, msg.tx, msg.ty));
    post({ type: "parsed", key: msg.key, wire, workerMs: performance.now() - t0 }, transfer);
  } catch (err) {
    post(
      { type: "failed", key: msg.key, message: err instanceof Error ? err.message : String(err) },
      [],
    );
  }
}
