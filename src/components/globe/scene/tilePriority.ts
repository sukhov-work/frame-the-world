import * as THREE from "three";
import type { PriorityTile, TileCenterReader } from "../../../lib/globe/loadPriority";

/**
 * UPLIFT U5 — the three-side adapter between lib/globe/loadPriority (pure comparator math) and
 * 3d-tiles-renderer's Tile objects: reads a tile's bounding-sphere CENTRE in world metres via
 * `engineData.boundingVolume.getSphere` (the same `engineData ?? cached` reach the Dnipro OSM
 * mask plugin uses — buildings.ts). One scratch Sphere per adapter, zero per-call allocation:
 * the comparator runs inside the queue's `items.sort` every scheduled `tryRunJobs`.
 */
export function makeTileCenterReader(): TileCenterReader {
  const sphere = new THREE.Sphere();
  return (tile: PriorityTile, out: { x: number; y: number; z: number }): boolean => {
    const bv = (tile as { engineData?: { boundingVolume?: unknown }; cached?: { boundingVolume?: unknown } })
      .engineData?.boundingVolume ??
      (tile as { cached?: { boundingVolume?: unknown } }).cached?.boundingVolume;
    if (!bv || typeof (bv as { getSphere?: unknown }).getSphere !== "function") return false;
    (bv as { getSphere(target: THREE.Sphere): void }).getSphere(sphere);
    out.x = sphere.center.x;
    out.y = sphere.center.y;
    out.z = sphere.center.z;
    return true;
  };
}
