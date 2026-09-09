import { describe, expect, it } from "vitest";
import {
  OVERLAY_PRIORITY,
  installOverlayFetchPriority,
  overlayFetchPriority,
} from "../../../src/lib/globe/overlayFetchPriority";

/**
 * 2026-09-10b — the imagery fetches of the ground renderer follow their TILE through the
 * download queue. The library's comparator (`errorPriorityCallback`) reads `a.priority || 0`
 * and sorts LOWER values first, popping from the END — so a higher number runs sooner, a
 * terrain tile (no `priority`) compares as 0, and the library's own image value
 * `-performance.now()` was FIFO below every terrain download. These pin the ranking and the
 * install's mechanics against a fake queue + plugin (the real shapes, no three).
 */

const PARSING = 3;
const LOADING = 2;
const UNLOADED = 0;

const tile = (state: number, error = 0) => ({ internal: { loadingState: state }, traversal: { error, used: true } });

describe("overlayFetchPriority — the pure ranking", () => {
  it("a tile in a parse slot outranks everything, including terrain downloads (0)", () => {
    const p = overlayFetchPriority(tile(PARSING, 10), true, 1e9);
    expect(p).toBeGreaterThan(OVERLAY_PRIORITY.PARSED + OVERLAY_PRIORITY.seqCap); // above the oldest parsed
    expect(p).toBeGreaterThan(0);
  });

  it("a downloaded tile waiting for a slot ranks above terrain and below a slot — FIFO within the band, never by error", () => {
    const older = overlayFetchPriority(tile(PARSING, 1), false, 10);
    const newer = overlayFetchPriority(tile(PARSING, 500), false, 20);
    expect(older).toBeGreaterThan(newer); // the traversal order (coarse first, siblings adjacent) wins
    expect(newer).toBeGreaterThan(0);
    expect(older).toBeLessThan(OVERLAY_PRIORITY.SLOT);
    // a higher error never lifts a newer fetch over an older one
    expect(overlayFetchPriority(tile(PARSING, 1e6), false, 20)).toBeLessThan(older);
  });

  it("a preload for a tile still downloading ranks BELOW terrain (negative), FIFO within the band", () => {
    const a = overlayFetchPriority(tile(LOADING, 1), false, 5);
    const b = overlayFetchPriority(tile(LOADING, 900), false, 6);
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(a);
    expect(b).toBeLessThan(0);
    expect(overlayFetchPriority(tile(LOADING), false, 0)).toBeLessThan(0); // the very first preload too
  });

  it("a gone tile (disposed / unloaded / unknown) ranks last — below the library's own FIFO value", () => {
    expect(overlayFetchPriority(null, false)).toBe(OVERLAY_PRIORITY.GONE);
    expect(overlayFetchPriority(tile(UNLOADED), false)).toBe(OVERLAY_PRIORITY.GONE);
    expect(overlayFetchPriority({}, false)).toBe(OVERLAY_PRIORITY.GONE);
    // the library queues images at -performance.now(): ≈ -1e5…-1e7 during a session
    expect(OVERLAY_PRIORITY.GONE).toBeLessThan(-1e9);
  });

  it("the FIFO term is bounded so no sequence can cross a band", () => {
    const first = overlayFetchPriority(tile(PARSING), false, 0);
    const late = overlayFetchPriority(tile(PARSING), false, 1e30);
    expect(first).toBe(OVERLAY_PRIORITY.PARSED + OVERLAY_PRIORITY.seqCap);
    expect(late).toBe(OVERLAY_PRIORITY.PARSED);
    expect(first).toBeLessThan(OVERLAY_PRIORITY.SLOT);
    expect(overlayFetchPriority(tile(PARSING), true, 1e30)).toBeGreaterThan(first);
  });
});

describe("installOverlayFetchPriority — the install on the library shapes", () => {
  const makeWorld = () => {
    const added: Array<{ item: unknown; cb: unknown }> = [];
    const queue = { add: (item: unknown, cb: () => unknown) => (added.push({ item, cb }), "added") };
    const pending = new Map<object, unknown>();
    let lockNow: ((range: unknown) => void) | null = null;
    const plugin = {
      pendingTiles: pending,
      // the real plugin locks the composite synchronously inside these two
      _initTileOverlayInfo(_tile: object) {
        lockNow?.("range");
      },
      _initTileSceneOverlayInfo(_scene: unknown, _tile: object) {
        lockNow?.("range");
        return Promise.resolve();
      },
    };
    // the overlay's fetch → the plugin's wrapper → queue.add({ priority: -now }, cb)
    lockNow = () => queue.add({ priority: -performance.now() }, () => "fetch");
    return { queue, pending, plugin, added };
  };

  it("two fetches in one band keep their queue order (the traversal order)", () => {
    const w = makeWorld();
    installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    const a = tile(PARSING, 1);
    const b = tile(PARSING, 999);
    w.plugin._initTileOverlayInfo(a);
    w.plugin._initTileOverlayInfo(b);
    const pa = (w.added[0].item as { priority: number }).priority;
    const pb = (w.added[1].item as { priority: number }).priority;
    expect(pa).toBeGreaterThan(pb);
  });

  it("tags an image fetch queued inside _initTileOverlayInfo with a LIVE priority that follows the tile", () => {
    const w = makeWorld();
    const h = installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    expect(h.installed).toBe(true);
    const t = tile(LOADING, 40);
    w.plugin._initTileOverlayInfo(t);
    expect(w.added).toHaveLength(1);
    const item = w.added[0].item as { priority: number };
    // still downloading → a preload, below terrain
    expect(item.priority).toBeLessThan(0);
    // the download completes → waiting for a slot → above terrain
    t.internal.loadingState = PARSING;
    expect(item.priority).toBeGreaterThan(0);
    expect(item.priority).toBeLessThan(OVERLAY_PRIORITY.SLOT);
    // the plugin takes it into a parse slot → the top band, and the boost is counted once
    w.pending.set(t, {});
    expect(item.priority).toBeGreaterThan(OVERLAY_PRIORITY.SLOT);
    expect(item.priority).toBeGreaterThan(OVERLAY_PRIORITY.SLOT);
    expect(h.stats).toMatchObject({ tagged: 1, untagged: 0, slotBoosts: 1 });
    // the slot ends → back to the parsed band (no re-queue needed: it is a getter)
    w.pending.delete(t);
    expect(item.priority).toBeLessThan(OVERLAY_PRIORITY.SLOT);
  });

  it("an image fetch with no tile context keeps the library's own value and is counted untagged", () => {
    const w = makeWorld();
    const h = installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    w.queue.add({ priority: -12345 }, () => "fetch"); // the failed-overlay re-lock path
    expect((w.added[0].item as { priority: number }).priority).toBe(-12345);
    expect(h.stats.untagged).toBe(1);
  });

  it("terrain tiles (items with `internal`) pass through untouched", () => {
    const w = makeWorld();
    installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    const t = tile(LOADING);
    w.queue.add(t, () => "download");
    expect(w.added[0].item).toBe(t);
    expect((t as { priority?: unknown }).priority).toBeUndefined();
  });

  it("is idempotent per queue and dispose() restores the original methods", () => {
    const w = makeWorld();
    const add0 = w.queue.add;
    const init0 = w.plugin._initTileOverlayInfo;
    const h1 = installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    const h2 = installOverlayFetchPriority({ downloadQueue: w.queue }, w.plugin);
    expect(h1.installed).toBe(true);
    expect(h2.installed).toBe(false);
    h1.dispose();
    expect(w.queue.add).toBe(add0);
    expect(w.plugin._initTileOverlayInfo).toBe(init0);
  });

  it("installs nothing when the library shape drifted (no pendingTiles / no queue)", () => {
    const h = installOverlayFetchPriority({}, { pendingTiles: new Map() });
    expect(h.installed).toBe(false);
    const w = makeWorld();
    const h2 = installOverlayFetchPriority({ downloadQueue: w.queue }, { _initTileOverlayInfo() {}, _initTileSceneOverlayInfo() {} });
    expect(h2.installed).toBe(false);
  });
});
