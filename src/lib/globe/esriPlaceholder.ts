/**
 * RC5 — Esri's HTTP-200 "Map data not available" placeholder (owner bug B1, 2026-08-25).
 *
 * Esri World Imagery does not 404 outside its local coverage. It returns **200 OK with a
 * 2,521-byte JPEG that says "Map data not available"**, byte-identical everywhere — live-probed
 * 2026-08-25 at Everest z19, at a random Pacific z19, and at a z22 beyond the service's own max
 * level: same bytes, same `ETag: "vvvvvvvvvvvvf"`, `Cache-Control: max-age=86400`.
 *
 * That single fact defeats every fallback the stack has. The placeholder decodes as a perfectly
 * valid texture, so `info.failed` never sets, `load-error` never fires, and the debounced
 * `resetFailedOverlays()` retry never arms — those are network-FAILURE paths and this is a
 * success. `fetchOptions: { cache: "force-cache" }` then pins the placeholder without
 * revalidation, and on iOS `public/sw.js` stores any `res.ok` response for seven days, so it
 * never heals in-session and mostly not across sessions either.
 *
 * A static per-region level cap cannot fix it: around Everest the z19 coverage is an ISLAND —
 * the summit tile is real imagery while 100 % of tiles a few hundred out are the sentinel, and
 * the boundary is sub-kilometre. So the cap has to be LEARNED, per tile, at runtime.
 *
 * ### What this module does
 *
 * Wraps the overlay's own `fetch` at construction time (before `ImageOverlayPlugin._initOverlay`
 * re-wraps it with the download queue, so the final order is queue → this → network). On a
 * sentinel it fetches the PARENT tile, crops the child's quadrant, upscales it to tile size and
 * returns a synthesized `Response` — **the placeholder never draws**. It also:
 *
 *   · re-issues the request once per tile per session with `cache: "default"`, so a sentinel
 *     pinned in the HTTP cache from an earlier session can heal within Esri's own max-age;
 *   · learns which tiles and which 8×8 blocks are sentinel-only, and skips their GETs entirely
 *     on the next visit — the network win, and the reason a wander over Khumbu stops storming.
 *
 * ### Two traps paid for here
 *
 * **ETag is not readable in the browser.** The root-cause analysis proposed detecting the
 * sentinel by byte length + `ETag`, but Esri sends no `Access-Control-Expose-Headers` (probed
 * 2026-08-25), and `ETag` is not CORS-safelisted — `res.headers.get("etag")` is `null` from a
 * page. Detection is therefore on the BYTES: exact length plus an FNV-1a-32 of the body, which
 * is what `isPlaceholderBytes` checks.
 *
 * **Do not override `calculateLevel` instead.** `lockTexture`/`releaseTexture` recompute the
 * level as a DEFAULT ARGUMENT (`ImageOverlayPlugin.js:1617-1626`), so a cap table that changes
 * between lock and release makes `DataCache.releaseViaFullKey` throw.
 *
 * Every path is fail-soft: anything unexpected (an unparseable URL, a missing `OffscreenCanvas`,
 * a parent that is also a sentinel all the way up) returns the original response, which is
 * exactly the behaviour that shipped before this slice.
 */

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

/**
 * The sentinel's fingerprint, measured against the live service 2026-08-25 (md5
 * `f27d9de7f80c13501f470595e327aa6d`). Both fields must match: the length alone is a plausible
 * size for a real low-detail JPEG.
 */
export const ESRI_PLACEHOLDER = {
  byteLength: 2521,
  fnv1a32: 0x92d9118f,
} as const;

/** FNV-1a, 32-bit. Cheap enough to run on every tile body on the main thread (~2.5 KB here). */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function isPlaceholderBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength !== ESRI_PLACEHOLDER.byteLength) return false;
  return fnv1a32(new Uint8Array(buf)) === ESRI_PLACEHOLDER.fnv1a32;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface XyzUrlCodec {
  build(t: TileXYZ): string;
  parse(url: string): TileXYZ | null;
}

/**
 * Build/parse tile URLs for an XYZ template. Token ORDER is read off the template rather than
 * assumed — Esri's is `{z}/{y}/{x}`, CARTO's is `{z}/{x}/{y}`, and swapping the two silently
 * fetches a tile on the other side of the world.
 */
export function makeXyzUrlCodec(template: string): XyzUrlCodec {
  const order: Array<"z" | "x" | "y"> = [];
  const re = /\{\s*(z|x|y|reverseY|-\s*y)\s*\}/gi;
  let pattern = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    pattern += escapeRe(template.slice(last, m.index));
    const tok = m[1].toLowerCase().replace(/\s/g, "");
    order.push(tok === "z" ? "z" : tok === "x" ? "x" : "y");
    pattern += "(\\d+)";
    last = m.index + m[0].length;
  }
  pattern += escapeRe(template.slice(last));
  const rx = new RegExp(`^${pattern}(?:[?#].*)?$`);
  return {
    build(t) {
      let i = 0;
      return template.replace(re, () => String(t[order[i++]]));
    },
    parse(url) {
      const hit = rx.exec(url);
      if (!hit || order.length !== 3) return null;
      const out: TileXYZ = { z: 0, x: 0, y: 0 };
      order.forEach((k, i) => {
        out[k] = Number(hit[i + 1]);
      });
      return Number.isFinite(out.z) && Number.isFinite(out.x) && Number.isFinite(out.y)
        ? out
        : null;
    },
  };
}

export function tileKey(t: TileXYZ): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/** The tile `up` levels shallower, in the SAME URL token space (verified top-left at Esri). */
export function ancestorOf(t: TileXYZ, up: number): TileXYZ | null {
  if (up < 1 || t.z - up < 0) return null;
  return { z: t.z - up, x: t.x >>> up, y: t.y >>> up };
}

export interface QuadrantRect {
  sx: number;
  sy: number;
  size: number;
}

/** Where `t` sits inside its `up`-levels-shallower ancestor, in the ancestor's pixel space. */
export function quadrantOf(t: TileXYZ, up: number, tilePx: number): QuadrantRect {
  const scale = 1 << up;
  const size = Math.max(1, Math.round(tilePx / scale));
  return { sx: (t.x & (scale - 1)) * size, sy: (t.y & (scale - 1)) * size, size };
}

/**
 * The learned cap table. Two granularities, and the coarse one is deliberately conservative:
 * a block is only treated as capped while it has produced sentinels and NO real tile, and one
 * real tile opens it permanently. The Everest coverage boundary is sub-kilometre, so a block
 * that guessed would blank real imagery — the exact failure the static-cap idea died on.
 */
export class PlaceholderMemo {
  /** log2 of the block edge in tiles. 3 → 8×8 tiles (~600 m at z19 near the equator). */
  static readonly BLOCK_SHIFT = 3;
  /** Sentinels needed in an all-sentinel block before its GETs are skipped. */
  static readonly BLOCK_MIN = 8;

  private readonly sentinels = new Set<string>();
  private readonly blocks = new Map<string, { miss: number; real: number }>();

  private blockKey(t: TileXYZ): string {
    const s = PlaceholderMemo.BLOCK_SHIFT;
    return `${t.z}/${t.x >>> s}/${t.y >>> s}`;
  }

  private block(t: TileXYZ) {
    const k = this.blockKey(t);
    let b = this.blocks.get(k);
    if (!b) {
      b = { miss: 0, real: 0 };
      this.blocks.set(k, b);
    }
    return b;
  }

  noteSentinel(t: TileXYZ): void {
    if (this.sentinels.has(tileKey(t))) return;
    this.sentinels.add(tileKey(t));
    this.block(t).miss++;
  }

  noteReal(t: TileXYZ): void {
    this.sentinels.delete(tileKey(t));
    this.block(t).real++;
  }

  isSentinel(t: TileXYZ): boolean {
    return this.sentinels.has(tileKey(t));
  }

  /** True when this tile's own GET can be skipped: known sentinel, or an all-sentinel block. */
  isCapped(t: TileXYZ): boolean {
    if (this.isSentinel(t)) return true;
    const b = this.blocks.get(this.blockKey(t));
    return !!b && b.real === 0 && b.miss >= PlaceholderMemo.BLOCK_MIN;
  }

  stats() {
    return { sentinelTiles: this.sentinels.size, blocks: this.blocks.size };
  }
}

export interface PlaceholderStats {
  /** Sentinel bodies seen (before any substitution). */
  sentinels: number;
  /** Sentinels that a `cache: "default"` re-issue turned into real imagery. */
  healed: number;
  /** Sentinels replaced by an upscaled ancestor quadrant. */
  substituted: number;
  /** GETs never issued because the learned table already knew. */
  skippedGets: number;
  /** Sentinels that survived everything and drew (no real ancestor within the cap). */
  drawn: number;
}

export interface PlaceholderFallbackOptions {
  urlTemplate: string;
  /** Source tile edge in pixels (Esri: 256). */
  tilePx?: number;
  /** How many levels up the substitution may walk before giving up. */
  maxLevelsUp?: number;
  /** Injectable for tests; defaults to the browser pipeline. */
  cropUpscale?: (
    bytes: ArrayBuffer,
    rect: QuadrantRect,
    tilePx: number,
  ) => Promise<ArrayBuffer | null>;
}

interface FetchLike {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

/** Crop a quadrant out of a tile body and upscale it back to full tile size. */
async function cropUpscaleInBrowser(
  bytes: ArrayBuffer,
  rect: QuadrantRect,
  tilePx: number,
): Promise<ArrayBuffer | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]), rect.sx, rect.sy, rect.size, rect.size, {
      resizeWidth: tilePx,
      resizeHeight: tilePx,
      resizeQuality: "high",
    });
    const canvas = new OffscreenCanvas(tilePx, tilePx);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return await blob.arrayBuffer();
  } catch {
    return null; // no OffscreenCanvas, a decode failure — the sentinel draws, as it always did
  }
}

function respond(buf: ArrayBuffer, from: Response): Response {
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": from.headers.get("content-type") ?? "image/jpeg" },
  });
}

export interface PlaceholderProbeResult {
  url: string;
  /** Bytes the wrapper handed back (the library would decode exactly these). */
  byteLength: number;
  /** True only if a sentinel survived everything and would have DRAWN. */
  isPlaceholder: boolean;
  stats: PlaceholderStats;
}

/**
 * Install the fallback on an overlay. Returns the live counters + memo so the DEV seam can read
 * what actually happened rather than what we intended (`__globe.esriPlaceholder()`), plus a
 * `probe` that runs the SHIPPED wrapper against one tile.
 *
 * `probe` exists because the substitution path is genuinely hard to reach from a camera pose:
 * whether the composite ever asks for a tile outside Esri's coverage depends on the terrain
 * tileset's own LOD at that spot. Unit tests cover the logic with a scripted server; this is how
 * a browser run proves the same code answers the REAL service correctly.
 */
export function installEsriPlaceholderFallback(
  overlay: FetchLike,
  opts: PlaceholderFallbackOptions,
): {
  stats: PlaceholderStats;
  memo: PlaceholderMemo;
  probe(t: TileXYZ): Promise<PlaceholderProbeResult>;
} {
  const tilePx = opts.tilePx ?? 256;
  const maxUp = opts.maxLevelsUp ?? 3;
  const crop = opts.cropUpscale ?? cropUpscaleInBrowser;
  const codec = makeXyzUrlCodec(opts.urlTemplate);
  const memo = new PlaceholderMemo();
  const stats: PlaceholderStats = {
    sentinels: 0,
    healed: 0,
    substituted: 0,
    skippedGets: 0,
    drawn: 0,
  };
  /** Tiles already given their one `cache: "default"` heal attempt this session. */
  const healAttempted = new Set<string>();
  /** The sentinel body, banked on first sighting. It is byte-identical service-wide, so once a
   *  tile is known to be a sentinel with no substitutable ancestor there is nothing left to ask
   *  the network for — without this, such a tile re-GETs on every visit forever. Reachable in
   *  practice only past Esri's own max level, where every ancestor is a sentinel too. */
  let bankedSentinel: ArrayBuffer | null = null;
  const network = overlay.fetch.bind(overlay);

  /** Walk up until a real ancestor answers, then return this tile's quadrant of it. */
  const substitute = async (t: TileXYZ, options: RequestInit): Promise<Response | null> => {
    for (let up = 1; up <= maxUp; up++) {
      const anc = ancestorOf(t, up);
      if (!anc) return null;
      if (memo.isSentinel(anc)) continue; // already known bad — don't ask again
      let bytes: ArrayBuffer;
      try {
        const r = await network(codec.build(anc), options);
        if (!r.ok) return null;
        bytes = await r.arrayBuffer();
      } catch {
        return null;
      }
      if (isPlaceholderBytes(bytes)) {
        memo.noteSentinel(anc);
        continue;
      }
      memo.noteReal(anc);
      const out = await crop(bytes, quadrantOf(t, up, tilePx), tilePx);
      if (!out) return null;
      stats.substituted++;
      return new Response(out, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    return null;
  };

  overlay.fetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const tile = codec.parse(url);
    if (!tile) return network(url, options); // not a tile URL we understand — hands off

    if (memo.isCapped(tile)) {
      const sub = await substitute(tile, options);
      if (sub) {
        stats.skippedGets++;
        return sub;
      }
      // No substitute — but if we already KNOW this exact tile is a sentinel, the network has
      // nothing new to say, so serve the banked body instead of re-asking on every visit.
      if (memo.isSentinel(tile) && bankedSentinel) {
        stats.skippedGets++;
        stats.drawn++;
        return new Response(bankedSentinel.slice(0), {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      }
      // Otherwise this was only a BLOCK guess; fall through and ask for the tile after all.
    }

    const res = await network(url, options);
    if (!res.ok) return res; // real network failure → the existing load-error retry owns it
    const buf = await res.arrayBuffer();
    if (!isPlaceholderBytes(buf)) {
      memo.noteReal(tile);
      return respond(buf, res);
    }

    stats.sentinels++;
    bankedSentinel ??= buf.slice(0);
    // `force-cache` will hand back a sentinel stored last week forever. Ask the network once per
    // tile per session so newly published imagery appears within Esri's own 24 h max-age.
    const key = tileKey(tile);
    if (!healAttempted.has(key)) {
      healAttempted.add(key);
      try {
        const fresh = await network(url, { ...options, cache: "default" });
        if (fresh.ok) {
          const freshBuf = await fresh.arrayBuffer();
          if (!isPlaceholderBytes(freshBuf)) {
            stats.healed++;
            memo.noteReal(tile);
            return respond(freshBuf, fresh);
          }
        }
      } catch {
        /* the heal is opportunistic — never let it fail the tile */
      }
    }

    memo.noteSentinel(tile);
    const sub = await substitute(tile, options);
    if (sub) return sub;
    stats.drawn++;
    return respond(buf, res); // fail-soft: exactly the pre-RC5 behaviour
  };

  const wrapped = overlay.fetch;
  return {
    stats,
    memo,
    async probe(t) {
      const url = codec.build(t);
      const r = await wrapped(url, {});
      const buf = await r.arrayBuffer();
      return {
        url,
        byteLength: buf.byteLength,
        isPlaceholder: isPlaceholderBytes(buf),
        stats: { ...stats },
      };
    },
  };
}
