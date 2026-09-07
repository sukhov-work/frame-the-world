/// <reference lib="webworker" />
/**
 * THE VECTOR-TILE PARSE WORKER (T77 lever 11, 2026-09-07j).
 *
 * One long-lived module worker that turns a fetched z14 MVT buffer into the `VtileWire` shape
 * (`lib/geo/vtileWire.ts` — the wire, the messages and the one request handler) and posts it back
 * with its two typed arrays TRANSFERRED. The main thread keeps the fetch (network attribution,
 * `cache: "force-cache"` and the attach-scoped abort are unchanged — `scene/vectorTiles.ts`), keeps
 * the cache, and only SEATS the result (`lib/geo/vtileParseClient.ts`).
 *
 * `parseVectorTile` is IMPORTED from the shipped parser, never forked — the same rule
 * `bestSpotWorker` states in its header (two MVT parsers that look alike is this repo's most
 * expensive recurring bug class). Its `STREETS` reads (`classPriority`, `tileZ`, `repeatEveryM`,
 * `maxAnchorsPerFeat`) are static module constants on BOTH threads — no runtime tunable editor
 * exists in `src/` (grep 2026-09-07j: no `patchTuning` / `__tune` / assignment to `STREETS.*`), so
 * the worker latching them at spawn reads the same numbers the main thread would have. The fence
 * in `test/components/globe/fences.test.ts` walks this worker's static graph and pins its tuning
 * edges to that one module; a runtime tunable editor would have to ride the job here first.
 *
 * `@mapbox/vector-tile` and `pbf` reach this worker through the parser's STATIC imports — a
 * dynamic `await import(...)` inside a worker is what triggered the libheif "optimized
 * dependencies changed" full-page reload (`astro.config.mjs:73-80`). This module is ONLY ever
 * loaded as a worker (`new Worker(new URL(...))`); the main thread imports nothing from it — on a
 * page `self` is `window` and the shell below would install `window.onmessage`.
 */

import { parseVectorTile } from "../../components/globe/scene/vectorTiles";
import { handleParseRequest, type VtileParseMessage, type VtileParseRequest } from "./vtileWire";

function installShell(): void {
  if (typeof self === "undefined" || typeof (self as unknown as Worker).postMessage !== "function") {
    return;
  }
  const post = (m: VtileParseMessage, transfer: ArrayBuffer[]) =>
    (self as unknown as Worker).postMessage(m, transfer);
  self.onmessage = (event: MessageEvent<VtileParseRequest>) => {
    if (event.data?.type === "parse") handleParseRequest(event.data, parseVectorTile, post);
  };
}

installShell();
