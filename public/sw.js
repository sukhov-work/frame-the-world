/*
 * PLUX — tile service worker (#15, owner batch #4 S3 — iOS-DIRECTED mitigation).
 *
 * WHY: iOS Safari's HTTP disk cache is small and pressure-pruned — a planning session that
 * wanders a city re-downloads its tile working set over and over (the ranked cause of the
 * owner's iOS tile storm). Desktop Chrome's disk cache HOLDS (~95% fromDiskCache on reload,
 * measured by scripts/measure-tile-cache.mjs, 2026-08-21) — so registration is gated to
 * iOS-like devices in the layout snippets; this file never runs on desktop.
 *
 * STRATEGY: cache-first over Cache Storage (which iOS prunes far less aggressively than the
 * HTTP cache) for the four tile hosts + the R2 worker, with a FIFO entry cap (~300 MB at the
 * measured ~50 KB median tile) and a per-entry max age. NEVER cached: tileset.json/layer.json
 * (mutable manifests must revalidate), api.cesium.com (token-bearing endpoint — not in the
 * allowlist), the OpenFreeMap /planet TileJSON (the mutable pointer to the dated tile build).
 *
 * Esri ToS posture (tuning.ts TILESETS note — "hackathon-standard, UNVERIFIED for production"):
 * entries expire after MAX_AGE_MS, so this is a performance cache, never an offline extract.
 */
/** This file runs in a ServiceWorkerGlobalScope; the checker lints it with DOM libs. */
const swSelf = /** @type {any} */ (self);

const CACHE = "ftw-tiles-v1";
const MAX_ENTRIES = 6000; // ≈ 300 MB at the ~50 KB median tile (measure-tile-cache.mjs)
const TRIM_EVERY = 50; // puts between FIFO trims — cache.keys() is O(entries)
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // performance cache, not an archive

const TILE_HOSTS = [
  "server.arcgisonline.com", // Esri World Imagery drape (TILESETS.esriImageryUrl)
  "basemaps.cartocdn.com", // CARTO dark drape (TILESETS.cartoDarkUrl)
  "assets.ion.cesium.com", // ion tile content — ?v= versioned; auth rides request headers
  "tiles.openfreemap.org", // street-name MVT tiles (dated build path)
];

/** GET-only, tile-content-only policy. Mutable manifests and token endpoints fall through to
 *  the network untouched (api.cesium.com is simply not in the allowlist). */
function cacheable(url) {
  if (url.pathname.endsWith("tileset.json") || url.pathname.endsWith("layer.json")) return false;
  if (url.hostname === "tiles.openfreemap.org" && url.pathname === "/planet") return false;
  if (TILE_HOSTS.indexOf(url.hostname) !== -1) return true;
  // R2 enriched/terrain binaries (PUBLIC_ENRICHED_TILES_URL / PUBLIC_TERRAIN_TILES_URL) — the
  // subdomain is env-driven, so match the suffix. Dev serves these same-origin (/enriched,
  // /terrain via the astro middleware) and never reaches this branch.
  return url.hostname.endsWith(".workers.dev");
}

self.addEventListener("install", () => {
  swSelf.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await swSelf.clients.claim();
    })(),
  );
});

let putsSinceTrim = 0;

/** FIFO eviction: cache.keys() returns insertion order. Hits don't refresh order (so this is
 *  FIFO, not true LRU) — for tile traffic that's fine: an evicted tile that's still wanted
 *  simply re-enters on its next miss. */
async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/** Stamp-and-store: Response headers are immutable, so re-wrap the body to carry the cached-at
 *  stamp the max-age check reads on match. */
async function putStamped(cache, request, response) {
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("x-ftw-cached-at", String(Date.now()));
  await cache.put(
    request,
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
  putsSinceTrim += 1;
  if (putsSinceTrim >= TRIM_EVERY) {
    putsSinceTrim = 0;
    await trim(cache);
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!cacheable(url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: ion responses can carry Vary: Origin; the URL (with its ?v=) is the key.
      const hit = await cache.match(event.request, { ignoreVary: true });
      if (hit) {
        const at = Number(hit.headers.get("x-ftw-cached-at") || 0);
        if (Date.now() - at < MAX_AGE_MS) return hit;
        await cache.delete(event.request);
      }
      const res = await fetch(event.request);
      // Only 200 + CORS-readable responses are stored (all allowlisted hosts are CORS-clean —
      // the #15 spec premise); opaque/error responses pass through uncached.
      if (res.ok && (res.type === "basic" || res.type === "cors")) {
        event.waitUntil(putStamped(cache, event.request, res.clone()));
      }
      return res;
    })(),
  );
});
