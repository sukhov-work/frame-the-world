import * as THREE from "three";
import type { TilesRenderer } from "3d-tiles-renderer";
import type { TileBoundingVolume } from "3d-tiles-renderer/three";
import { LoadRegionPlugin, RayRegion, SphereRegion } from "3d-tiles-renderer/plugins";
import type { FoveationTierCfg } from "../../../lib/globe/quality";

/**
 * UPLIFT U6 — the foveated-loading adapter (scene twin of scene/tilePriority.ts): one
 * LoadRegionPlugin + a range-capped fovea ray + an eye bubble per tile renderer. The orchestrator
 * flips regions at the FPV boundary and feeds the world-space eye/look every pose step; this
 * module owns the library objects and the WORLD → GROUP-LOCAL conversion (0.4.28 evaluates
 * regions against tile bounding volumes in the tiles-group frame with NO matrixWorld fold-in,
 * LoadRegionPlugin.js `tile.engineData.boundingVolume`; cameras get inverse-transformed instead,
 * TilesRenderer.js:571-581). Buildings/ground groups are identity (world == ECEF) — the enriched
 * group carries its seat lift, which the same inverse handles. `clearRegions()` == plugin-off by
 * construction (the region loop never runs), so orbit/2D/high-tier pay nothing.
 */

/** RayRegion with a range cap + a real queue distance. The stock ray is INFINITE: a street-level
 *  look ray pierces the globe and would force tiles beyond the visual horizon (and on the exit
 *  side) to refine off-camera — cache/bandwidth thrash bounded only by the LRU. The cap bounds
 *  the fovea to cfg.rayRangeM from the eye. `calculateDistance` (stock: Infinity) feeds the
 *  merged `target.distance` so fovea-forced tiles keep a sane place in the distance-ordered
 *  queues. Subclassing is the library's blessed extension point ("Subclass and override
 *  intersectsTile", LoadRegionPlugin.js). */
class RangedRayRegion extends RayRegion {
  maxRangeM = 0;
  override intersectsTile(boundingVolume: TileBoundingVolume): boolean {
    return (
      this.maxRangeM > 0 &&
      boundingVolume.intersectsRay(this.ray) &&
      boundingVolume.distanceToPoint(this.ray.origin) < this.maxRangeM
    );
  }
  override calculateDistance(boundingVolume: TileBoundingVolume): number {
    return boundingVolume.distanceToPoint(this.ray.origin);
  }
}

export interface TileFoveationHandle {
  /** Register on the renderer once, right after construction (one plugin per renderer). */
  plugin: LoadRegionPlugin;
  /** Tier fan-out: per-tier radii (null = foveation off for this tier / on `high`). */
  configure(cfg: FoveationTierCfg | null): void;
  /** FPV boundary flip. ON adds the regions (when a tier cfg exists); OFF clears them. */
  setActive(on: boolean): void;
  /** Per-frame while active: WORLD-space eye + unit look (converted group-local inside). */
  setPose(eyeWorld: THREE.Vector3, fwdWorld: THREE.Vector3): void;
  /** DEV probe (__globe.u6()). */
  snapshot(): {
    engaged: boolean;
    cfg: FoveationTierCfg | null;
    regionErrorTargetM: number;
  };
}

export function makeTileFoveation(
  tiles: TilesRenderer,
  regionErrorTargetM: number,
): TileFoveationHandle {
  const plugin = new LoadRegionPlugin();
  const fovea = new RangedRayRegion({ errorTarget: regionErrorTargetM });
  const bubble = new SphereRegion({ errorTarget: regionErrorTargetM });
  const _inv = new THREE.Matrix4();
  let cfg: FoveationTierCfg | null = null;
  let active = false;

  const applyRegions = () => {
    if (active && cfg) {
      fovea.maxRangeM = cfg.rayRangeM;
      bubble.sphere.radius = cfg.eyeRadiusM;
      plugin.addRegion(fovea); // addRegion dedups — safe on tier changes mid-FPV
      plugin.addRegion(bubble);
    } else {
      plugin.clearRegions();
    }
    // The ground's UpdateOnChangePlugin re-tiles only on camera motion — a region flip with a
    // parked camera (tier force(), FPV glide end) must nudge the re-traverse itself. Harmless
    // no-op listener-wise on the building renderers.
    (tiles as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({
      type: "needs-update",
    });
  };

  return {
    plugin,
    configure(next) {
      cfg = next;
      applyRegions();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      applyRegions();
    },
    setPose(eyeWorld, fwdWorld) {
      if (!(active && cfg)) return;
      // TilesGroup maintains matrixWorldInverse every updateMatrixWorld (TilesGroup.js) — fall
      // back to a local invert if a future library drops the field (one-frame staleness of the
      // enriched seat lift is centimetres against 100 m+ radii).
      const g = tiles.group as THREE.Group & { matrixWorldInverse?: THREE.Matrix4 };
      const inv = g.matrixWorldInverse ?? _inv.copy(g.matrixWorld).invert();
      fovea.ray.origin.copy(eyeWorld);
      fovea.ray.direction.copy(fwdWorld);
      fovea.ray.applyMatrix4(inv); // origin as point, direction via transformDirection (re-normalized)
      bubble.sphere.center.copy(eyeWorld).applyMatrix4(inv);
      // radius stays metric — the tiles groups carry translation only (no scale).
    },
    snapshot() {
      return { engaged: active && cfg !== null, cfg, regionErrorTargetM };
    },
  };
}
