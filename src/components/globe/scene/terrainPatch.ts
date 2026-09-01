/**
 * Self-baked terrain-patch composite (GLO-30 bake slice, design ruling 2026-08-18) — swaps the
 * high-accuracy R2 patch into the ONE ground renderer in place of CWT tiles, inside the bake
 * extent only. No second renderer: heightAt raycasts, the imagery drape, the grade chain, fades,
 * foveation and every seat-easing consumer keep working untouched, and the seam machinery is the
 * library's own (out-of-set siblings become virtual children clipped from the shared parent —
 * QuantizedMeshPlugin.expandChildren — and skirts cover residual cracks; the bake rim-blends
 * patch heights onto CWT at the extent edge so same-level neighbours meet with no step).
 *
 * Two cooperating pieces, both installed by attachImageryGround when a patch is configured:
 *
 * 1. `hookTerrainPatch(qmPlugin, base, cfg)` — wraps the QuantizedMeshPlugin instance's
 *    `createChild(level, x, y, available)` (0.4.28 installed source: an ordinary instance method;
 *    `available` is the availability-range ARRAY, passed through untouched). For tiles the
 *    serve-set rule claims (lib/geo/terrainTiles.patchServesTile — O(1)), the returned tile's
 *    `content` is overridden to the patch URL. expandChildren then counts them as REAL children
 *    (`child.content !== null`), which is exactly how availability-driven children work — forcing
 *    content where CWT has none (beyond its L13 over UA) descends the quadtree deeper for free.
 *    CWT's own metadata-availability path is bypassed inside the extent (content is forced
 *    unconditionally there) and untouched outside it. A missing patch tile 404s into a dead leaf
 *    (TilesRendererBase FAILED state) and the parent keeps rendering — graceful by construction;
 *    the bake's containment assert makes that path unreachable in practice.
 *
 * 2. `makeTerrainPatchFetchPlugin(base)` — a fetchData plugin at priority between the
 *    QuantizedMeshPlugin (−1000, only claims its virtual split URLs) and CesiumIonAuthPlugin (0):
 *    claims patch URLs with a PLAIN fetch, so the ion Bearer token never reaches the patch CDN.
 *    (Ion's preprocessURL appends `?v=` to every URL — harmless: the R2 Worker keys on pathname.)
 *
 * No tunables — the patch geometry/config is registry data (lib/globe/regions.ts), the CDN base
 * is env (PUBLIC_TERRAIN_TILES_URL), and tile selection follows the ground renderer's existing
 * errorTarget/foveation levers untouched (patch tiles share the per-level geometricError formula).
 */
import { patchServesTile, patchTileUri, type TerrainPatchCfg } from "../../../lib/geo/terrainTiles";

export interface TerrainPatchOpts {
  /** Absolute CDN base serving the terrain/ namespace (no trailing slash). */
  base: string;
  /** Every baked patch (regions.ts) — serve sets are disjoint per-region extents, so the hook
   *  is region-agnostic: whichever patch claims a tile wins, everywhere else stays CWT. */
  cfgs: TerrainPatchCfg[];
}

/** Absolutize the env base (dev uses the same-origin "/terrain" middleware path). */
export function resolveTerrainBase(envBase: string | undefined): string | null {
  if (!envBase) return null;
  try {
    const abs =
      typeof location === "undefined" ? envBase : new URL(envBase, location.href).toString();
    return abs.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Wrap the QuantizedMeshPlugin instance's createChild — call RIGHT AFTER construction (inside
 *  the ion assetTypeHandler), before any layer.json load, so every tile ever created passes
 *  through the serve-set rule. */
export function hookTerrainPatch(
  qmPlugin: { createChild: (level: number, x: number, y: number, available: unknown) => { content: unknown } | null },
  base: string,
  cfgs: TerrainPatchCfg[],
): void {
  const orig = qmPlugin.createChild;
  qmPlugin.createChild = function (level: number, x: number, y: number, available: unknown) {
    const tile = orig.call(this, level, x, y, available);
    if (tile) {
      for (const cfg of cfgs) {
        if (patchServesTile(cfg, level, x, y)) {
          tile.content = { uri: patchTileUri(cfg, base, level, x, y) };
          patchRewrites++;
          break;
        }
      }
    }
    return tile;
  };
}

// DEBUG HUD (owner 2026-09-01): before this counter, GLO-30 patch tiles were runtime-
// indistinguishable from CWT ones — a 404'd patch tile degrades silently into a dead leaf.
// Module-level is fine: one globe per page, and a re-attach keeps counting monotonically.
let patchRewrites = 0;

/** How many tile content URIs the patch hook has rewritten to GLO-30 this session. */
export function terrainPatchStats(): { rewrites: number } {
  return { rewrites: patchRewrites };
}

/** The fetch claimer — register on the ground TilesRenderer at attach time. */
export function makeTerrainPatchFetchPlugin(base: string): object {
  const prefix = `${base}/`;
  return {
    name: "FTW_TERRAIN_PATCH",
    // Between QuantizedMeshPlugin (−1000) and CesiumIonAuthPlugin (0): invokeOnePlugin takes the
    // first truthy fetchData in ascending priority order (TilesRendererBase.js:738-754).
    priority: -500,
    fetchData(url: string | URL, options: RequestInit) {
      const u = String(url);
      if (!u.startsWith(prefix)) return null; // decline → ion (or default fetch) handles it
      // #15(c) (batch #4 S3): patch tiles are bake-content-addressed → immutable; force-cache
      // skips the revalidation round-trip entirely. Only .terrain binaries — manifests never
      // route here (hookTerrainPatch rewrites tile content URIs only), but stay defensive.
      return fetch(u, u.endsWith(".terrain") ? { ...options, cache: "force-cache" } : options);
    },
  };
}
