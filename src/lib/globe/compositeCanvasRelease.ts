/**
 * T123 lever (d) (2026-09-10) — release a composite imagery canvas's backing store the moment the
 * library disposes it.
 *
 * `ImageOverlayPlugin` composites the Esri / CARTO source tiles for every ground tile into ITS OWN
 * `<canvas>` (`RegionImageSource.fetchItem`: `document.createElement('canvas')` at the overlay
 * resolution, a `CanvasTexture` over it, `context.drawImage(imageBitmap)` per source tile —
 * 3d-tiles-renderer 0.4.28, `sources/RegionImageSource.js`). When the region's lock count reaches
 * zero the library's `disposeItem(target)` calls `target.dispose()` — the GL texture goes — but the
 * `<canvas>` element keeps its pixel backing store until the element itself is garbage-collected.
 * A canvas wrapper is a tiny JS object, so nothing about it hurries the collector; on the desktop
 * twin the memory-infra dump counted **~450 composites created per stress cycle** (901 in two
 * cycles, `probe-memory-dump.mjs --canvas-zero`), and on iOS an accelerated 2D canvas is an
 * IOSurface counted in the process's physical footprint — the number jetsam reads against
 * WebContent's 2 GB `ActiveHard` limit (MEASUREMENTS §31.6). After lever (a) the `/m` stress leg's
 * app-side caches sit at 0 / 97 / 0 MB on every rest and the page STILL died in the 8th cycle with
 * "flat resources": memory the app's own accounting cannot see.
 *
 * The release is the documented canvas-memory idiom: `canvas.width = canvas.height = 0` drops the
 * backing store synchronously. It is safe by the library's own contract — `disposeItem` runs only
 * when no tile holds the region (the cache entry is deleted first, `DataCache.releaseViaFullKey`),
 * and a re-use fetches a FRESH canvas. Composites that took the single-tile FAST PATH carry an
 * `ImageBitmap` (a clone sharing the source's `Source`) — those are skipped: the tiled source
 * closes its bitmaps on its own release (`TiledImageSource.disposeItem`).
 *
 * Installed per overlay at construction through `_init` (the region source is created inside the
 * library's async init), so `setOverlayResolution`'s rebuilt overlays get it too. Both shells: a
 * disposed canvas can never draw again, so the render is byte-identical; Chrome frees the store at
 * GC anyway (the twin's `canvas` allocator did not move), WebKit is the tier that pays.
 */

/** The structural slice of the library's `TiledImageOverlay` this touches (0.4.28). */
export interface CompositeOverlayLike {
  _init(): Promise<unknown>;
  regionImageSource: { disposeItem(target: unknown, keys: unknown): void } | null;
}

export interface CompositeCanvasReleaseStats {
  /** Composite canvases whose backing store was dropped since boot. */
  released: number;
  /** Their summed RGBA backing-store bytes (width × height × 4 at release time). */
  bytes: number;
  /** `disposeItem` calls that carried no canvas (the fast-path bitmap clones, nulls). */
  skipped: number;
}

/** A canvas-shaped image (the DOM type is absent in vitest; structural on purpose). */
interface CanvasLike {
  width: number;
  height: number;
  getContext?: unknown;
}

const isCanvas = (img: unknown): img is CanvasLike => {
  if (!img || typeof img !== "object") return false;
  const c = img as CanvasLike;
  return typeof c.width === "number" && typeof c.height === "number" && typeof c.getContext === "function";
};

/**
 * Drop the backing store of a composite texture's canvas. Returns the bytes released (0 when
 * the image is not a canvas or is already empty). Pure: touches only the canvas's size.
 */
export function releaseCompositeCanvas(target: unknown): number {
  const img = (target as { image?: unknown } | null | undefined)?.image;
  if (!isCanvas(img)) return 0;
  const bytes = img.width * img.height * 4;
  if (bytes <= 0) return 0;
  img.width = 0;
  img.height = 0;
  return bytes;
}

/**
 * Hook an overlay so every composite the library disposes also releases its canvas. Idempotent
 * per overlay. The stats object is shared across every overlay it is installed on.
 */
export function installCompositeCanvasRelease(
  overlay: CompositeOverlayLike,
  stats: CompositeCanvasReleaseStats,
): void {
  const o = overlay as CompositeOverlayLike & { __compositeReleaseInstalled?: boolean };
  if (o.__compositeReleaseInstalled) return;
  o.__compositeReleaseInstalled = true;
  const wrapSource = () => {
    const rs = o.regionImageSource as
      | (NonNullable<CompositeOverlayLike["regionImageSource"]> & { __compositeReleaseWrapped?: boolean })
      | null;
    if (!rs || rs.__compositeReleaseWrapped) return;
    rs.__compositeReleaseWrapped = true;
    const orig = rs.disposeItem.bind(rs);
    rs.disposeItem = (target, keys) => {
      orig(target, keys);
      const bytes = releaseCompositeCanvas(target);
      if (bytes > 0) {
        stats.released++;
        stats.bytes += bytes;
      } else {
        stats.skipped++;
      }
    };
  };
  const origInit = o._init.bind(o);
  o._init = () => origInit().then((v) => (wrapSource(), v));
  wrapSource(); // an overlay already initialised (defensive; the plugin inits after registration)
}

export const createCompositeCanvasReleaseStats = (): CompositeCanvasReleaseStats => ({
  released: 0,
  bytes: 0,
  skipped: 0,
});
