import type { ParsedVtile } from "../../components/globe/scene/vectorTiles";
import {
  handleParseRequest,
  unpackVtile,
  type VtileParseMessage,
  type VtileParseRequest,
  type VtileParser,
} from "./vtileWire";

/**
 * THE MAIN-THREAD SIDE of the vector-tile parse worker (T77 lever 11, 2026-09-07j).
 *
 * `attachVectorTiles` (`scene/vectorTiles.ts`) fetches a tile as before and hands the buffer here;
 * the worker parses and packs it (`lib/geo/vtileWire.ts`); this client SEATS the result — one
 * `unpackVtile` per message, ≤ ~0.5 ms desktop / ~2 ms Pixel for the heaviest Dnipro tile — and
 * calls back with the same `ParsedVtile` the in-thread parser used to produce. The cache, its
 * `"pending"` / `"failed"` states, the eviction and the `version()` epoch all stay in the handle.
 *
 * ONE PATH, TWO THREADS. When no `Worker` exists (a non-browser twin), when spawning throws, or
 * when the worker CRASHES mid-session, the same request goes through `handleParseRequest` INLINE —
 * parse → pack → unpack on the caller, with the parser the CALLER hands in (`scene/vectorTiles.ts`
 * passes `parseVectorTile`; this module never imports the worker or the parser by value, so the
 * worker's `self.onmessage` shell is never evaluated on a page) — so the inline twin is
 * byte-identical to the worker path and a crash costs nothing but the parse time it was meant to
 * save. A crash re-issues every in-flight
 * tile inline (the request buffers are kept until their result lands — a structured-clone copy of
 * a ≤ 200 KB buffer is a memcpy) and the client stays inline for the rest of the session. Tiles
 * never become `"failed"` because of the worker; only a parse error on the tile itself does that
 * (the shipped semantics: a failed tile stays failed, no refetch churn).
 *
 * Every message is its own macrotask, so the seats of several tiles landing together interleave
 * with rendering rather than stacking into one frame.
 */

export interface VtileParseHandlers {
  onParsed(key: string, parsed: ParsedVtile): void;
  onFailed(key: string, message: string): void;
}

export interface VtileParseStats {
  posted: number;
  workerParsed: number;
  inlineParsed: number;
  failed: number;
  pending: number;
  /** False before the first post; false forever once the client fell back inline. */
  workerLive: boolean;
  crashed: boolean;
  /** The main-thread seat (`unpackVtile`) — last and worst, ms. */
  seatMs: number;
  seatMaxMs: number;
  /** The worker's own parse + pack — worst, ms (0 in inline mode). */
  workerMaxMs: number;
}

export interface VtileParseClient {
  /** Fire-and-forget. `buf` is NOT transferred — the caller keeps it until the result lands. */
  parse(key: string, buf: ArrayBuffer, tx: number, ty: number): void;
  stats(): VtileParseStats;
  dispose(): void;
}

export interface VtileParseClientOptions {
  /** Test seam: how to spawn the worker. `null` = inline. Default: the module worker. */
  spawn?: () => Worker | null;
}

const defaultSpawn = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    // `astro.config.mjs` sets `worker: { format: "es" }`; Vite splits this into its own chunk.
    return new Worker(new URL("./vtileParseWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
};

export function createVtileParseClient(
  h: VtileParseHandlers,
  /** The parser the inline twin runs — the caller's `parseVectorTile`. */
  parse: VtileParser,
  opts: VtileParseClientOptions = {},
): VtileParseClient {
  const spawn = opts.spawn ?? defaultSpawn;
  let worker: Worker | null = null;
  let tried = false;
  let crashed = false;
  let disposed = false;
  const pending = new Map<string, VtileParseRequest>();
  const stats: VtileParseStats = {
    posted: 0,
    workerParsed: 0,
    inlineParsed: 0,
    failed: 0,
    pending: 0,
    workerLive: false,
    crashed: false,
    seatMs: 0,
    seatMaxMs: 0,
    workerMaxMs: 0,
  };

  const seat = (m: VtileParseMessage, viaWorker: boolean) => {
    if (disposed) return;
    // A result for a key that was re-issued inline after a crash is stale — the inline seat won.
    if (!pending.has(m.key)) return;
    pending.delete(m.key);
    stats.pending = pending.size;
    if (m.type === "failed") {
      stats.failed++;
      h.onFailed(m.key, m.message);
      return;
    }
    const t0 = performance.now();
    const parsed = unpackVtile(m.wire);
    stats.seatMs = performance.now() - t0;
    if (stats.seatMs > stats.seatMaxMs) stats.seatMaxMs = stats.seatMs;
    if (viaWorker) {
      stats.workerParsed++;
      if (m.workerMs > stats.workerMaxMs) stats.workerMaxMs = m.workerMs;
    } else {
      stats.inlineParsed++;
    }
    h.onParsed(m.key, parsed);
  };

  const inline = (req: VtileParseRequest) => handleParseRequest(req, parse, (m) => seat(m, false));

  const onCrash = (message: string) => {
    if (crashed || disposed) return;
    crashed = true;
    stats.crashed = true;
    stats.workerLive = false;
    console.warn("[globe] vector-tile parse worker crashed — parsing inline from here on:", message);
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    worker = null;
    // Re-issue every in-flight tile on the caller, in post order; their buffers are still ours.
    for (const req of [...pending.values()]) inline(req);
  };

  const ensure = (): Worker | null => {
    if (worker || tried || crashed) return worker;
    tried = true;
    const w = spawn();
    if (!w) return null;
    w.onmessage = (event: MessageEvent<VtileParseMessage>) => {
      const m = event.data;
      if (m && (m.type === "parsed" || m.type === "failed")) seat(m, true);
    };
    w.onerror = (event) => onCrash(event.message || "worker error");
    w.onmessageerror = () => onCrash("message deserialisation failed");
    worker = w;
    stats.workerLive = true;
    return w;
  };

  return {
    parse(key, buf, tx, ty) {
      if (disposed) return;
      const req: VtileParseRequest = { type: "parse", key, buf, tx, ty };
      pending.set(key, req);
      stats.pending = pending.size;
      stats.posted++;
      const w = ensure();
      if (!w) {
        inline(req);
        return;
      }
      try {
        w.postMessage(req);
      } catch (err) {
        onCrash(err instanceof Error ? err.message : String(err));
      }
    },
    stats() {
      return { ...stats };
    },
    dispose() {
      disposed = true;
      pending.clear();
      stats.pending = 0;
      try {
        worker?.terminate();
      } catch {
        /* already gone */
      }
      worker = null;
      stats.workerLive = false;
    },
  };
}
