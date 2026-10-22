/**
 * BUILDING HIT (F5 — T172, 2026-10-22): the stable identity under a raycast hit on an OSM building
 * fill mesh — pure, three-TYPED only (no runtime three, no scene state, no store). Cesium OSM
 * Buildings (ion asset 96188) arrive as b3dm: every vertex carries `_batchid` (the legacy attribute;
 * a 3D Tiles 1.1 tile would carry `_feature_id_0`), and the tile's scene root carries the batch
 * table (3d-tiles-renderer's B3DMLoader: `scene.batchTable`), whose per-id facts ride the
 * `3DTILES_batch_table_hierarchy` extension under the `Building` class — `elementType`
 * ("way" | "relation" | "node") + `elementId` (probed in the browser 2026-10-22: `getKeys()` is
 * empty there, the hierarchy holds everything). `scene/buildings.ts` delegates here;
 * `lib/globe/facadeTargets.osmTargetId` turns the pair into the record's `osm:w…` key.
 */
import type * as THREE from "three";

export interface OsmElementRef {
  elementType: string;
  elementId: number;
}

type BatchTableLike = { getDataFromId(id: number): Record<string, unknown> };

/** The batch table on the object's ancestor chain (the tile's scene root), if any. */
export function batchTableOf(object: THREE.Object3D | null): BatchTableLike | null {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    const bt = (o as unknown as { batchTable?: Partial<BatchTableLike> }).batchTable;
    if (bt && typeof bt.getDataFromId === "function") return bt as BatchTableLike;
  }
  return null;
}

/** The OSM element under a raycast hit on a b3dm building mesh, or null — no batch-id attribute,
 *  no table up the chain, a table that throws, or a row without the Building facts. The facts are
 *  read from the hierarchy's `Building` class first, then from a flat row (a tileset without the
 *  extension), so a different bake keeps working. */
export function osmElementOfHit(hit: Pick<THREE.Intersection, "object" | "face">): OsmElementRef | null {
  const mesh = hit.object as THREE.Mesh;
  const geom = mesh.geometry as THREE.BufferGeometry | undefined;
  const a = hit.face?.a;
  if (!geom || typeof geom.getAttribute !== "function" || typeof a !== "number") return null;
  const attr = (geom.getAttribute("_batchid") ?? geom.getAttribute("_feature_id_0")) as
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  if (!attr || a < 0 || a >= attr.count) return null;
  const bid = attr.getX(a);
  const table = batchTableOf(mesh);
  if (!table) return null;
  let row: Record<string, unknown>;
  try {
    row = table.getDataFromId(bid);
  } catch {
    return null;
  }
  if (!row || typeof row !== "object") return null;
  const hier = row["3DTILES_batch_table_hierarchy"] as Record<string, Record<string, unknown> | undefined> | undefined;
  const b = hier?.Building ?? row;
  const elementType = b?.elementType;
  const elementId = b?.elementId;
  if (typeof elementType !== "string" || typeof elementId !== "number" || !Number.isFinite(elementId)) return null;
  return { elementType, elementId };
}
