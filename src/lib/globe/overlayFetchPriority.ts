/**
 * OVERLAY FETCH PRIORITY — the imagery fetches of the ground renderer follow their TILE.
 *
 * ### The stall this removes (owner 2026-09-10b, "10, 20, 30 s, 1 min+ … without any visible
 * progress for seconds at a time … until I moved")
 *
 * `ImageOverlayPlugin` (3d-tiles-renderer 0.4.28) does two things that, together, park the
 * ground pipeline for tens of seconds at a time:
 *
 *   1. On `tile-download-start` it PRELOADS the tile's composite imagery (`_initTileOverlayInfo`
 *      → `overlay.lockTexture(range)` → 4–9 Esri GETs), and every such GET enters the renderer's
 *      own `downloadQueue` as `{ priority: -performance.now() }` — i.e. below every terrain
 *      download (a tile compares as 0) and FIFO among images (`errorPriorityCallback`,
 *      TilesRendererBase.js:39-45). With 25 download jobs and virtual tile-splitting down to
 *      Esri's max zoom, the image queue outgrows the terrain queue 4:1 (8,186 image GETs against
 *      1,920 terrain GETs in the first 14 s of the Everest zoom pose).
 *   2. The five parse slots each hold their slot THROUGH the composite (`parseTile` awaits
 *      `processTileModel` → `_fetchTileOverlayTexture` → `overlay.getTexture(range)`), and the
 *      parse queue picks tiles by SCREEN-SPACE ERROR, not by age — so a slot regularly goes to a
 *      recently downloaded tile whose preloaded images sit at the very END of the image FIFO.
 *
 * Measured on the house Chrome (`f=27.989704,86.927075,312.4,217.3,-5.1,6.8`, ULTRA, cold
 * imagery cache): the parse queue sat at 374 waiting / 5 in flight and `img.composites` at 391
 * for 38 s while the download queue drained 1,042 image GETs at ~27/s — zero tiles finished,
 * zero pixels changed — and the picture resumed only once the FIFO reached the slot-holders'
 * images. A warm cache hides it entirely, which is why it reads as random.
 *
 * ### The fix
 *
 * Give every image fetch a LIVE priority that follows the tile it was locked for:
 *
 *   · a tile currently in a parse slot (`plugin.pendingTiles`)      → `SLOT`, above terrain;
 *   · a downloaded tile waiting for a slot (`loadingState PARSING`) → `PARSED`, above terrain;
 *   · a tile still downloading (the preload)                          → below terrain;
 *   · a tile that is gone (disposed / unused)                          → last.
 *
 * WITHIN a band the order is the library's own FIFO (the tag sequence = the traversal order:
 * coarse before fine, siblings adjacent). A first cut ordered the bands by traversal ERROR and the
 * sweep caught it: on a cold imagery cache the bandwidth went to the finest tiles first, whose
 * parents cannot hide until all four children have landed — the Dnipro fpv-south pose sat at 62
 * visible ground tiles at the 8 s cap against the golden's 296. FIFO keeps the coarse-to-fine
 * progression the owner sees as "closer objects first"; the SLOT band alone removes the stall.
 *
 * The priority is a GETTER, read by the library's comparator on every `tryRunJobs` sort, so an
 * image re-ranks the moment its tile changes state — nothing is re-queued. The tile is known
 * because the plugin locks the composite synchronously inside `_initTileOverlayInfo` /
 * `_initTileSceneOverlayInfo`, which this module brackets with a context variable. Fetches with
 * no context (the failed-overlay retry re-lock) keep the library's own FIFO value.
 *
 * Fail-soft like `esriPlaceholder`: any library-shape drift (a missing method, a queue without
 * `add`) installs nothing and the ground streams exactly as before. No pixel is changed — this
 * is ORDER, not content — so the `high` byte-identical rule and the ULTRA off-state law hold by
 * construction, and the phones (which run the same plugin) only ever finish tiles sooner.
 */

/** The library's per-tile loading states (TilesRendererBase `constants.js`) we key on. */
const PARSING = 3; // download complete, waiting for / holding a parse slot

export interface OverlayPriorityTile {
  internal?: { loadingState?: number };
  traversal?: { error?: number; used?: boolean };
}

interface QueueLike {
  add: (item: unknown, cb: (...a: unknown[]) => unknown) => unknown;
}

interface PluginLike {
  pendingTiles?: Map<object, unknown>;
  _initTileOverlayInfo?: (tile: object, overlay?: unknown) => unknown;
  _initTileSceneOverlayInfo?: (scene: unknown, tile: object, overlay?: unknown) => unknown;
}

export interface OverlayFetchPriorityStats {
  /** Image fetches given a live tile-following priority. */
  tagged: number;
  /** Image fetches queued with no tile context (kept at the library's FIFO value). */
  untagged: number;
  /** Fetches that were re-ranked into the parse-slot band at least once (a slot was waiting). */
  slotBoosts: number;
}

export interface OverlayFetchPriorityHandle {
  stats: OverlayFetchPriorityStats;
  /** Whether the install found every seam it needs (false = the library drifted, nothing wrapped). */
  installed: boolean;
  dispose(): void;
}

/** Priority bands. Terrain tiles compare as 0 in `errorPriorityCallback` (`a.priority || 0`), so
 *  anything positive runs before terrain downloads and anything negative after them; the
 *  library's own image value is `-performance.now()` (≈ −1e5…−1e7), which the `GONE` band
 *  sits well below. Exported for the tests. */
export const OVERLAY_PRIORITY = {
  SLOT: 3e12,
  PARSED: 2e12,
  PRELOAD: -1e12, // + the FIFO term (≤ 1e11) stays negative: below every terrain download
  GONE: -1e15,
  /** The FIFO term's range within a band: `seqCap − seq`, so an older fetch (a smaller seq)
   *  ranks higher; seq is a per-install counter and never reaches this in a session. */
  seqCap: 1e11,
} as const;

/**
 * The pure ranking — exported so the tests can pin it without a library instance.
 * `inSlot` = the plugin is running `_processTileModel` for this tile right now; `seq` = the
 * order the fetch was queued in (the traversal order — FIFO within a band).
 */
export function overlayFetchPriority(tile: OverlayPriorityTile | null, inSlot: boolean, seq = 0): number {
  if (!tile) return OVERLAY_PRIORITY.GONE;
  const fifo = OVERLAY_PRIORITY.seqCap - Math.min(Math.max(seq, 0), OVERLAY_PRIORITY.seqCap);
  if (inSlot) return OVERLAY_PRIORITY.SLOT + fifo;
  const state = tile.internal?.loadingState;
  if (state === PARSING) return OVERLAY_PRIORITY.PARSED + fifo;
  if (state === undefined || state === 0 /* UNLOADED = disposed */) return OVERLAY_PRIORITY.GONE;
  return OVERLAY_PRIORITY.PRELOAD + fifo;
}

/**
 * Install on ONE renderer + its ImageOverlayPlugin. Idempotent per queue (a second call on the
 * same queue returns a handle that wraps nothing).
 */
export function installOverlayFetchPriority(
  tiles: { downloadQueue?: QueueLike },
  plugin: PluginLike,
): OverlayFetchPriorityHandle {
  const stats: OverlayFetchPriorityStats = { tagged: 0, untagged: 0, slotBoosts: 0 };
  const queue = tiles.downloadQueue;
  const q = queue as (QueueLike & { __ftwOverlayPriority?: boolean }) | undefined;
  if (
    !q ||
    typeof q.add !== "function" ||
    q.__ftwOverlayPriority ||
    typeof plugin._initTileOverlayInfo !== "function" ||
    typeof plugin._initTileSceneOverlayInfo !== "function" ||
    !(plugin.pendingTiles instanceof Map)
  ) {
    return { stats, installed: false, dispose() {} };
  }
  q.__ftwOverlayPriority = true;
  const pending = plugin.pendingTiles;

  // The tile whose composite is being locked RIGHT NOW (the plugin locks synchronously inside
  // the two init calls; `_initTileSceneOverlayInfo` only awaits before the lock when the overlay
  // is not ready yet, in which case the preload has already set the range and no lock happens).
  let ctx: object | null = null;
  const initInfo0 = plugin._initTileOverlayInfo;
  const initScene0 = plugin._initTileSceneOverlayInfo;
  plugin._initTileOverlayInfo = function (this: unknown, tile: object, overlay?: unknown) {
    const prev = ctx;
    ctx = tile;
    try {
      return initInfo0.call(this, tile, overlay);
    } finally {
      ctx = prev;
    }
  };
  plugin._initTileSceneOverlayInfo = function (this: unknown, scene: unknown, tile: object, overlay?: unknown) {
    const prev = ctx;
    ctx = tile;
    try {
      return initScene0.call(this, scene, tile, overlay);
    } finally {
      ctx = prev;
    }
  };

  const add0 = q.add;
  let seq = 0;
  q.add = function (this: unknown, item: unknown, cb: (...a: unknown[]) => unknown) {
    const it = item as { priority?: unknown; internal?: unknown } | null;
    // An image fetch is the plugin's `{ priority: number }` bag; tiles carry `internal`.
    if (it && typeof it === "object" && typeof it.priority === "number" && !it.internal) {
      const tile = ctx as OverlayPriorityTile | null;
      if (tile) {
        stats.tagged++;
        const mySeq = ++seq;
        let boosted = false;
        Object.defineProperty(it, "priority", {
          configurable: true,
          enumerable: true,
          get: () => {
            const inSlot = pending.has(tile as object);
            if (inSlot && !boosted) {
              boosted = true;
              stats.slotBoosts++;
            }
            return overlayFetchPriority(tile, inSlot, mySeq);
          },
        });
      } else {
        stats.untagged++;
      }
    }
    return add0.call(this, item, cb);
  };

  return {
    stats,
    installed: true,
    dispose() {
      q.add = add0;
      delete q.__ftwOverlayPriority;
      plugin._initTileOverlayInfo = initInfo0;
      plugin._initTileSceneOverlayInfo = initScene0;
    },
  };
}
