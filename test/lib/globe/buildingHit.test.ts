// F5 (T172, 2026-10-22) — the OSM element under a raycast hit on a b3dm building mesh: the vertex's
// `_batchid` resolved through the tile root's batch table (the `3DTILES_batch_table_hierarchy`
// `Building` class Cesium OSM Buildings carry — probed on asset 96188 in the browser).
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { batchTableOf, osmElementOfHit } from "../../../src/lib/globe/buildingHit";
import { osmTargetId } from "../../../src/lib/globe/facadeTargets";

const hierarchyTable = (ids: Record<number, { elementType: string; elementId: number }>) => ({
  getDataFromId: (id: number) => ({
    "3DTILES_batch_table_hierarchy": {
      Building: { ...ids[id], "cesium#estimatedHeight": 12, building: "yes" },
      Geometry: { "cesium#color": null },
    },
  }),
});

/** A unit box at the origin whose every vertex carries batch id `bid`, under a tile root. */
function tile(bid: number, attrName = "_batchid", table: unknown = hierarchyTable({ [bid]: { elementType: "way", elementId: 100 + bid } })) {
  const geom = new THREE.BoxGeometry(2, 2, 2);
  const n = geom.getAttribute("position").count;
  geom.setAttribute(attrName, new THREE.Float32BufferAttribute(new Float32Array(n).fill(bid), 1));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  (root as unknown as { batchTable?: unknown }).batchTable = table;
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

const hitFromFront = (root: THREE.Object3D): THREE.Intersection => {
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1), 0, 100);
  const hits = ray.intersectObject(root, true);
  expect(hits.length).toBeGreaterThan(0); // the probe CAN match — a zero-result guard
  return hits[0];
};

describe("buildingHit — osmElementOfHit (F5, T172)", () => {
  it("resolves the vertex's _batchid through the tile root's hierarchy table to the OSM element", () => {
    const { root } = tile(7);
    const hit = hitFromFront(root);
    expect(osmElementOfHit(hit)).toEqual({ elementType: "way", elementId: 107 });
    expect(osmTargetId("way", 107)).toBe("osm:w107");
  });

  it("falls back to _feature_id_0 (a 3D Tiles 1.1 bake) and to a flat row without the hierarchy", () => {
    const flat = { getDataFromId: (id: number) => ({ elementType: "relation", elementId: 5000 + id }) };
    const { root } = tile(3, "_feature_id_0", flat);
    expect(osmElementOfHit(hitFromFront(root))).toEqual({ elementType: "relation", elementId: 5003 });
  });

  it("answers null without a batch-id attribute, without a table, when the table throws, or on garbage facts", () => {
    const geom = new THREE.BoxGeometry(2, 2, 2);
    const bare = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    const bareRoot = new THREE.Group();
    (bareRoot as unknown as { batchTable?: unknown }).batchTable = hierarchyTable({ 0: { elementType: "way", elementId: 1 } });
    bareRoot.add(bare);
    bareRoot.updateMatrixWorld(true);
    expect(osmElementOfHit(hitFromFront(bareRoot))).toBeNull(); // no attribute

    const { root: noTable } = tile(1, "_batchid", null); // null, not undefined — a default parameter would fill in a table
    expect(batchTableOf(noTable)).toBeNull();
    expect(osmElementOfHit(hitFromFront(noTable))).toBeNull();

    const { root: throwing } = tile(1, "_batchid", {
      getDataFromId: () => {
        throw new Error("out of range");
      },
    });
    expect(osmElementOfHit(hitFromFront(throwing))).toBeNull();

    const { root: garbage } = tile(1, "_batchid", { getDataFromId: () => ({ elementType: 4, elementId: "w1" }) });
    expect(osmElementOfHit(hitFromFront(garbage))).toBeNull();
    expect(osmElementOfHit({ object: new THREE.Object3D(), face: null } as unknown as THREE.Intersection)).toBeNull();
  });

  it("finds the table on a deeper ancestor (the tile root above a glTF node)", () => {
    const { root, mesh } = tile(2);
    const node = new THREE.Group();
    root.remove(mesh);
    node.add(mesh);
    root.add(node);
    root.updateMatrixWorld(true);
    expect(batchTableOf(mesh)).not.toBeNull();
    expect(osmElementOfHit(hitFromFront(root))).toEqual({ elementType: "way", elementId: 102 });
  });
});
