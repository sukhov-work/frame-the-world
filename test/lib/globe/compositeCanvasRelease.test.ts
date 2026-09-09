import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCompositeCanvasReleaseStats,
  installCompositeCanvasRelease,
  releaseCompositeCanvas,
  type CompositeOverlayLike,
} from "../../../src/lib/globe/compositeCanvasRelease";

/**
 * T123 lever (d) — the wrapper leans on three library-PRIVATE shapes in 3d-tiles-renderer 0.4.28:
 * the region source is created inside `TiledImageOverlay._init`, its composites are `CanvasTexture`s
 * over a fresh `document.createElement('canvas')`, and `disposeItem(target, keys)` is the one exit.
 * These pins make a library bump that re-plumbs any of them fail HERE instead of silently leaving
 * the canvases to the collector again.
 */
const LIB = "node_modules/3d-tiles-renderer/src/three/plugins/images/";
const overlayJs = readFileSync(`${LIB}ImageOverlayPlugin.js`, "utf8");
const regionJs = readFileSync(`${LIB}sources/RegionImageSource.js`, "utf8");
const cacheJs = readFileSync(`${LIB}utils/DataCache.js`, "utf8");

const canvas = (w: number, h: number) => ({ width: w, height: h, getContext: () => null });

describe("compositeCanvasRelease — the library surface it wraps is still what 0.4.28 shipped", () => {
  it("TiledImageOverlay creates its region source inside _init, after the image source's init", () => {
    const init = overlayJs.slice(overlayJs.indexOf("class TiledImageOverlay extends ImageOverlay"));
    expect(init).toMatch(/_init\(\) \{[\s\S]{0,400}this\.regionImageSource = new TiledRegionImageSource\( this\.imageSource \)/);
  });

  it("RegionImageSource composites into a fresh <canvas> per region and disposeItem only disposes the texture", () => {
    expect(regionJs).toMatch(/const canvas = document\.createElement\( 'canvas' \);\s*canvas\.width = this\.resolution;/);
    expect(regionJs).toMatch(/const target = new CanvasTexture\( canvas \);/);
    const dispose = regionJs.slice(regionJs.indexOf("disposeItem( target, [ minX, minY, maxX, maxY, level ] )"));
    expect(dispose.slice(0, 300)).toMatch(/target\.dispose\(\);/);
    expect(dispose.slice(0, 300)).not.toMatch(/width = 0/); // the release is OURS — the library leaves the store to GC
    // the single-tile fast path hands out a bitmap CLONE, never a canvas
    expect(regionJs).toMatch(/const clone = tiledImageSource\.get\( tx, ty, tl \)\.clone\(\);/);
  });

  it("DataCache disposes only at lock count 0, and get() never hands out a count-0 entry — nothing can read a released canvas", () => {
    // get(): the count guard is what keeps a disposed composite unreachable
    expect(cacheJs).toMatch(/get\( \.\.\.args \) \{[\s\S]{0,200}if \( key in cache && cache\[ key \]\.count > 0 \)/);
    // releaseViaFullKey(): decrement, then dispose (+ delete) only when the count reached 0 (or forced)
    const rel = cacheJs.slice(cacheJs.indexOf("releaseViaFullKey( key, force = false )"));
    expect(rel).toMatch(/info\.count --;[\s\S]{0,200}if \( info\.count === 0 \|\| force \)/);
    expect(rel).toMatch(/this\.disposeItem\( result, info\.args \);[\s\S]{0,200}delete cache\[ key \];/);
  });
});

describe("releaseCompositeCanvas", () => {
  it("drops a canvas-backed composite's store and reports its RGBA bytes", () => {
    const c = canvas(256, 256);
    expect(releaseCompositeCanvas({ image: c })).toBe(256 * 256 * 4);
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
  });

  it("skips bitmap clones (the fast path), nulls, and already-empty canvases", () => {
    const bitmap = { width: 256, height: 256, close() {} }; // an ImageBitmap has no getContext
    expect(releaseCompositeCanvas({ image: bitmap })).toBe(0);
    expect(bitmap.width).toBe(256);
    expect(releaseCompositeCanvas(null)).toBe(0);
    expect(releaseCompositeCanvas({ image: canvas(0, 0) })).toBe(0);
  });
});

describe("installCompositeCanvasRelease", () => {
  const makeOverlay = () => {
    const disposed: unknown[] = [];
    const source = { disposeItem: (t: unknown, k: unknown) => disposed.push([t, k]) };
    const overlay: CompositeOverlayLike = {
      regionImageSource: null,
      async _init() {
        await Promise.resolve();
        overlay.regionImageSource = source;
      },
    };
    return { overlay, source, disposed };
  };

  it("wraps the region source created by _init; the library's own disposal still runs first", async () => {
    const { overlay, source, disposed } = makeOverlay();
    const stats = createCompositeCanvasReleaseStats();
    installCompositeCanvasRelease(overlay, stats);
    await overlay._init();
    const c = canvas(512, 512);
    const target = { image: c };
    overlay.regionImageSource!.disposeItem(target, [0, 0, 1, 1, 3]);
    expect(disposed).toEqual([[target, [0, 0, 1, 1, 3]]]);
    expect(c.width).toBe(0);
    expect(stats).toEqual({ released: 1, bytes: 512 * 512 * 4, skipped: 0 });
    expect(overlay.regionImageSource).toBe(source); // the same object, wrapped in place
  });

  it("counts fast-path bitmap disposals as skipped and is idempotent per overlay", async () => {
    const { overlay } = makeOverlay();
    const stats = createCompositeCanvasReleaseStats();
    installCompositeCanvasRelease(overlay, stats);
    installCompositeCanvasRelease(overlay, stats);
    await overlay._init();
    await overlay._init(); // a second init (setOverlayResolution rebuilds) must not double-wrap
    overlay.regionImageSource!.disposeItem({ image: { width: 256, height: 256, close() {} } }, []);
    overlay.regionImageSource!.disposeItem({ image: canvas(256, 256) }, []);
    expect(stats).toEqual({ released: 1, bytes: 256 * 256 * 4, skipped: 1 });
  });
});
