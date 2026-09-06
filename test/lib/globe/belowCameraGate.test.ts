import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  beginBelowCameraGate,
  belowCameraGateArmed,
  belowCameraGateInstalled,
  belowCameraGateStats,
  endBelowCameraGate,
  installBelowCameraGate,
  localBoxFor,
  meshMayReachBand,
  resetBelowCameraGateStats,
  sphereSupportAbove,
  topHeightAbove,
  uninstallBelowCameraGate,
  vertexSupportAbove,
} from "../../../src/lib/globe/belowCameraGate";

/**
 * T79 — the below-camera gate's EXACTNESS contract, pinned by construction rather than by example:
 * for random scenes, cameras and bands, the gated first hit of the library's down-ray decides
 * "push the camera up?" exactly as the ungated one does, and when it pushes it is the SAME hit.
 * The library decision being mirrored (EnvironmentControls.js :995-1030 and :1059-1067):
 *   hit = raycaster.intersectObject(scene)[0]; dist = hit.distance − 1e5; push iff dist < band.
 */

const RAY_LIFT = 1e5;

/** Deterministic LCG so a failure replays. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function downRay(camPos: THREE.Vector3, up: THREE.Vector3): THREE.Raycaster {
  const rc = new THREE.Raycaster();
  rc.ray.origin.copy(camPos).addScaledVector(up, RAY_LIFT);
  rc.ray.direction.copy(up).multiplyScalar(-1);
  rc.near = 0;
  rc.far = Infinity;
  return rc;
}

interface Decision {
  push: boolean;
  object: THREE.Object3D | null;
  distance: number | null;
  point: THREE.Vector3 | null;
}

function decide(scene: THREE.Object3D, camPos: THREE.Vector3, up: THREE.Vector3, band: number): Decision {
  const hit = downRay(camPos, up).intersectObject(scene, true)[0] ?? null;
  if (!hit) return { push: false, object: null, distance: null, point: null };
  const dist = hit.distance - RAY_LIFT;
  return { push: dist < band, object: hit.object, distance: hit.distance, point: hit.point.clone() };
}

const mat = () => new THREE.MeshBasicMaterial();

/**
 * A random "city": boxes of 5–200 m on a ground plane (some tilted, some non-indexed soups), one
 * InstancedMesh, a BACKDROP SPHERE 1.9 km under the ground (the base-earth shape: 3 km radius,
 * ellipsoidal scale, its own rotation) and a tilted sunk disc whose AABB reaches above the ground
 * while its vertices never do — all inside a world frame rotated by a random quaternion, so `up`
 * is never an axis and every one of the three bounds earns its keep.
 */
function buildScene(r: () => number): { scene: THREE.Group; up: THREE.Vector3; frame: THREE.Matrix4 } {
  const frame = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
  );
  const scene = new THREE.Group();
  scene.applyMatrix4(frame);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(frame);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 4, 4), mat());
  ground.rotation.x = -Math.PI / 2; // y-up plane
  scene.add(ground);

  const n = 4 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    const w = 5 + r() * 60;
    const h = 5 + r() * 200;
    let geom: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, 5 + r() * 60);
    if (r() < 0.3) geom = geom.toNonIndexed(); // the enriched-soup shape
    const m = new THREE.Mesh(geom, mat());
    m.position.set((r() - 0.5) * 1500, h / 2, (r() - 0.5) * 1500);
    m.rotation.y = r() * Math.PI;
    if (r() < 0.25) m.rotation.z = (r() - 0.5) * 0.6; // a leaning tower
    scene.add(m);
  }

  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 40, 10), mat(), 6);
  const im = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    im.makeTranslation((r() - 0.5) * 1200, 20 + r() * 100, (r() - 0.5) * 1200);
    inst.setMatrixAt(i, im);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);

  // The backdrop: an ellipsoidal sphere whose top sits 1,900 m under the ground plane. 30 km of
  // radius so that — like the real base earth under a 48° `up` — its AABB reaches kilometres ABOVE
  // the ground and only the ellipsoid-support bound can prove it out of the band.
  const R = 30_000;
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat());
  backdrop.scale.set(R, R * 0.9967, R); // an oblate-ish ellipsoid (support along any direction ≤ R)
  backdrop.quaternion.set(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize(); // its own frame — the AABB is diagonal to `up`
  backdrop.position.set((r() - 0.5) * 400, -1900 - R, (r() - 0.5) * 400);
  scene.add(backdrop);

  // A sunk tilted disc: 1,500 m radius, 2 m thick, tilted about TWO axes, its top vertex at least
  // 300 m under the ground — its AABB reaches far above the ground, its vertices never do, and it
  // is not a sphere: only the vertex scan can prove it out of the band.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1500, 1500, 2, 64), mat());
  disc.rotation.set(0.5 + r() * 0.5, r() * Math.PI, 0.5 + r() * 0.5);
  disc.position.set((r() - 0.5) * 300, -300 - 1500 - 1, (r() - 0.5) * 300);
  scene.add(disc);

  scene.updateMatrixWorld(true);
  return { scene, up, frame };
}

afterEach(() => {
  endBelowCameraGate();
  uninstallBelowCameraGate();
  resetBelowCameraGateStats();
});

describe("belowCameraGate — the exactness contract (property, 400 random scenes)", () => {
  it("gated and ungated agree on the push decision, and on the hit whenever it pushes", () => {
    const r = rng(20260906);
    let pushes = 0;
    const skips = { box: 0, sphere: 0, scan: 0 };
    for (let k = 0; k < 400; k++) {
      const { scene, up, frame } = buildScene(r);
      // Camera: sometimes hovering over a roof (inside the band), sometimes far above, sometimes low.
      const local = new THREE.Vector3((r() - 0.5) * 1500, 0, (r() - 0.5) * 1500);
      const mode = r();
      local.y = mode < 0.35 ? 0.2 + r() * 300 : mode < 0.7 ? 300 + r() * 2000 : -5 + r() * 15;
      const camPos = local.applyMatrix4(frame);
      const band = 2.5 + (r() < 0.5 ? 0 : r() * 20) + 0.5;

      const plain = decide(scene, camPos, up, band);
      installBelowCameraGate();
      resetBelowCameraGateStats();
      beginBelowCameraGate(camPos, up, band);
      const gated = decide(scene, camPos, up, band);
      endBelowCameraGate();
      const stats = belowCameraGateStats();
      uninstallBelowCameraGate();

      expect(gated.push, `scene ${k}: push decision`).toBe(plain.push);
      if (plain.push) {
        pushes++;
        expect(gated.object, `scene ${k}: same object`).toBe(plain.object);
        expect(gated.distance, `scene ${k}: same distance`).toBe(plain.distance);
        expect(gated.point!.equals(plain.point!), `scene ${k}: same point`).toBe(true);
      }
      skips.box += stats.skipBox;
      skips.sphere += stats.skipSphere;
      skips.scan += stats.skipScan;
      expect(stats.seen).toBeGreaterThan(0);
    }
    // The property must have exercised BOTH branches, and every one of the three bounds.
    expect(pushes).toBeGreaterThan(40);
    expect(400 - pushes).toBeGreaterThan(40);
    expect(skips.box).toBeGreaterThan(1000);
    expect(skips.sphere).toBeGreaterThan(100);
    expect(skips.scan).toBeGreaterThan(100);
  });

  it("far above the city every mesh is skipped; hovering a roof the roof's mesh is tested", () => {
    const r = rng(7);
    const { scene, up, frame } = buildScene(r);
    installBelowCameraGate();

    resetBelowCameraGateStats();
    const high = new THREE.Vector3(0, 5000, 0).applyMatrix4(frame);
    beginBelowCameraGate(high, up, 3);
    downRay(high, up).intersectObject(scene, true);
    endBelowCameraGate();
    let s = belowCameraGateStats();
    expect(s.seen).toBeGreaterThan(0);
    expect(s.skipped).toBe(s.seen);

    // Sit 1 m over the tallest box's roof → its mesh cannot be skipped, and the hit is the roof.
    let tallest: THREE.Mesh | null = null;
    let top = -Infinity;
    for (const o of scene.children) {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.geometry.type !== "BoxGeometry") continue;
      const t = topHeightAbove(localBoxFor(m.geometry)!, m.matrixWorld, up, 0);
      if (t > top) {
        top = t;
        tallest = m;
      }
    }
    expect(tallest).not.toBeNull();
    const centre = tallest!.getWorldPosition(new THREE.Vector3());
    const roofCam = centre.clone().addScaledVector(up, top - centre.dot(up) + 1);
    resetBelowCameraGateStats();
    beginBelowCameraGate(roofCam, up, 3);
    const hits = downRay(roofCam, up).intersectObject(scene, true);
    endBelowCameraGate();
    s = belowCameraGateStats();
    expect(s.skipped).toBeLessThan(s.seen);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].object).toBe(tallest);
  });
});

describe("belowCameraGate — the three bounds", () => {
  it("localBoxFor equals computeBoundingBox and follows the position attribute's version", () => {
    const g = new THREE.BoxGeometry(2, 4, 6);
    const box = localBoxFor(g)!;
    g.computeBoundingBox();
    expect(box.min.toArray()).toEqual(g.boundingBox!.min.toArray());
    expect(box.max.toArray()).toEqual(g.boundingBox!.max.toArray());
    const built = belowCameraGateStats().boxesBuilt;
    expect(localBoxFor(g)).toBe(box); // cached
    expect(belowCameraGateStats().boxesBuilt).toBe(built);
    // A seat rewrite: move every vertex up 50 m and flag the attribute → the cache re-reads.
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + 50);
    pos.needsUpdate = true;
    const box2 = localBoxFor(g)!;
    expect(box2.max.y).toBeCloseTo(52, 9);
    expect(belowCameraGateStats().boxesBuilt).toBe(built + 1);
    // A geometry with no positions is never bounded (→ never skipped).
    expect(localBoxFor(new THREE.BufferGeometry())).toBeNull();
  });

  it("topHeightAbove is the brute-force max over the eight transformed corners", () => {
    const r = rng(99);
    for (let k = 0; k < 50; k++) {
      const box = new THREE.Box3(
        new THREE.Vector3(-r() * 10, -r() * 10, -r() * 10),
        new THREE.Vector3(r() * 10, r() * 10, r() * 10),
      );
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((r() - 0.5) * 100, (r() - 0.5) * 100, (r() - 0.5) * 100),
        new THREE.Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        new THREE.Vector3(0.5 + r(), 0.5 + r(), 0.5 + r()),
      );
      const up = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const camDot = (r() - 0.5) * 100;
      let brute = -Infinity;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const h = new THREE.Vector3(x, y, z).applyMatrix4(m).dot(up) - camDot;
            brute = Math.max(brute, h);
          }
      expect(topHeightAbove(box, m, up, camDot)).toBeCloseTo(brute, 9);
    }
  });

  it("the sphere support and the vertex support both bound every vertex, and the sphere one is tight", () => {
    const r = rng(5);
    for (let k = 0; k < 40; k++) {
      const radius = 0.5 + r() * 2;
      const g = new THREE.SphereGeometry(radius, 32, 24);
      const m = new THREE.Mesh(g, mat());
      m.position.set((r() - 0.5) * 100, (r() - 0.5) * 100, (r() - 0.5) * 100);
      m.quaternion.set(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      m.scale.set(1 + r() * 5, 1 + r() * 5, 1 + r() * 5);
      m.updateMatrixWorld(true);
      const up = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const camDot = (r() - 0.5) * 50;
      // brute force over the transformed vertices
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      let brute = -Infinity;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) brute = Math.max(brute, v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).dot(up) - camDot);
      const sphere = sphereSupportAbove(radius, m.matrixWorld, up, camDot);
      const scan = vertexSupportAbove(g, m.matrixWorld, up, camDot);
      expect(scan).toBeCloseTo(brute, 6); // the scan IS the vertex max
      expect(sphere).toBeGreaterThanOrEqual(brute - 1e-9); // the ellipsoid contains its polygon
      expect(sphere - brute).toBeLessThan(0.02 * radius * 6); // …and tightly (the chord sag of a 32×24 sphere)
    }
  });

  it("the vertex support is cached per (version, count, local up) and re-scanned when any changes", () => {
    const g = new THREE.CylinderGeometry(10, 10, 4, 16);
    const m = new THREE.Mesh(g, mat());
    m.updateMatrixWorld(true);
    const up = new THREE.Vector3(0.3, 0.9, 0.1).normalize();
    resetBelowCameraGateStats();
    const a = vertexSupportAbove(g, m.matrixWorld, up, 0);
    expect(belowCameraGateStats().scans).toBe(1);
    expect(vertexSupportAbove(g, m.matrixWorld, up, 5)).toBeCloseTo(a - 5, 9); // camera term recomputed, no scan
    expect(belowCameraGateStats().scans).toBe(1);
    // translation only: no rescan (the linear part is unchanged)
    m.position.set(0, 100, 0);
    m.updateMatrixWorld(true);
    expect(vertexSupportAbove(g, m.matrixWorld, up, 0)).toBeCloseTo(a + 100 * up.y, 6);
    expect(belowCameraGateStats().scans).toBe(1);
    // a rotation changes Lᵀup → rescan
    m.rotation.z = 0.4;
    m.updateMatrixWorld(true);
    vertexSupportAbove(g, m.matrixWorld, up, 0);
    expect(belowCameraGateStats().scans).toBe(2);
    // a position rewrite → rescan
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    pos.setY(0, pos.getY(0) + 1);
    pos.needsUpdate = true;
    vertexSupportAbove(g, m.matrixWorld, up, 0);
    expect(belowCameraGateStats().scans).toBe(3);
  });

  it("the base-earth shape: a 1.9 km-sunk WGS84-scaled sphere is skipped at 700 m over 48° N, tested at 1 m over its top", () => {
    // The real shape (StylizedTiles `baseScale`): SphereGeometry(1, N, N) · scale (A, B, A) · shrink,
    // rotation.x = π/2 — the polar semi-axis rides LOCAL Y, which the rotation maps to ECEF Z.
    const a = 6_378_137;
    const b = 6_356_752.314245;
    const shrink = 1 - 1900 / a;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), mat());
    earth.scale.set(a * shrink, b * shrink, a * shrink);
    earth.rotation.x = Math.PI / 2;
    earth.updateMatrixWorld(true);
    // A camera 700 m over the WGS84 surface at 48.4647° N (geodetic), `up` the geodetic normal.
    const lat = (48.4647 * Math.PI) / 180;
    const lon = (35.0462 * Math.PI) / 180;
    const e2 = 1 - (b * b) / (a * a);
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const at = (h: number) =>
      new THREE.Vector3((N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * Math.sin(lat));
    const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const cam = at(700);
    const camDot = cam.dot(up);
    // The AABB reaches ~9,000 km above the camera (the 48° diagonal) — useless — while the ellipsoid
    // support puts the top ~2,600 m below the camera (1,900 m sunk + 700 m altitude).
    expect(topHeightAbove(localBoxFor(earth.geometry)!, earth.matrixWorld, up, camDot)).toBeGreaterThan(1e6);
    const support = sphereSupportAbove(1, earth.matrixWorld, up, camDot);
    expect(support).toBeLessThan(-2000);
    expect(support).toBeGreaterThan(-3500);
    resetBelowCameraGateStats();
    expect(meshMayReachBand(earth, up, camDot, 3)).toBe(false);
    expect(belowCameraGateStats().skipSphere).toBe(1);
    expect(belowCameraGateStats().scans).toBe(0); // the O(1) bound settled it — no 8k-vertex scan
    // The ellipsoid bound is LOOSER than the vertex max (a 64-segment sphere sags ~1 km inside its
    // ellipsoid here) — both are upper bounds on the surface, in that order.
    const topAbs = vertexSupportAbove(earth.geometry, earth.matrixWorld, up, 0);
    expect(sphereSupportAbove(1, earth.matrixWorld, up, 0)).toBeGreaterThanOrEqual(topAbs);
    // A camera 1 m over the polygon's highest point along `up`: reachable (the scan says so after
    // the ellipsoid bound could not prove it out); 10 m higher than the band: skipped by the scan.
    resetBelowCameraGateStats();
    expect(meshMayReachBand(earth, up, topAbs - 1, 3)).toBe(true);
    expect(meshMayReachBand(earth, up, topAbs + 10, 3)).toBe(false);
    expect(belowCameraGateStats().skipScan).toBe(1);
  });

  it("skinned and morphed meshes are never skipped; a plain mesh far below is; the band edge is inclusive", () => {
    const up = new THREE.Vector3(0, 1, 0);
    const far = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat());
    far.position.y = -500;
    far.updateMatrixWorld(true);
    expect(meshMayReachBand(far, up, 0, 3)).toBe(false);
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), mat());
    skinned.position.y = -500;
    skinned.updateMatrixWorld(true);
    expect(meshMayReachBand(skinned, up, 0, 3)).toBe(true);
    const morphed = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat());
    morphed.morphTargetInfluences = [0.5];
    morphed.position.y = -500;
    morphed.updateMatrixWorld(true);
    expect(meshMayReachBand(morphed, up, 0, 3)).toBe(true);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), mat());
    edge.position.y = -4; // top at −3
    edge.updateMatrixWorld(true);
    expect(meshMayReachBand(edge, up, 0, 3)).toBe(true);
    expect(meshMayReachBand(edge, up, 0, 2.999)).toBe(false);
  });

  it("install is idempotent, the wrapper is inert when unarmed, and uninstall restores three's method", () => {
    const original = THREE.Mesh.prototype.raycast;
    expect(belowCameraGateInstalled()).toBe(false);
    const un1 = installBelowCameraGate();
    const wrapped = THREE.Mesh.prototype.raycast;
    expect(wrapped).not.toBe(original);
    installBelowCameraGate();
    expect(THREE.Mesh.prototype.raycast).toBe(wrapped); // not double-wrapped
    expect(belowCameraGateArmed()).toBe(false);
    // Unarmed: identical intersections to the original method.
    const m = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat());
    m.position.y = -500;
    m.updateMatrixWorld(true);
    const rc = downRay(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const a: THREE.Intersection[] = [];
    original.call(m, rc, a);
    const b = rc.intersectObject(m, false);
    expect(b.length).toBe(a.length);
    expect(b[0].distance).toBe(a[0].distance);
    expect(belowCameraGateStats().seen).toBe(0);
    un1();
    expect(THREE.Mesh.prototype.raycast).toBe(original);
    expect(belowCameraGateInstalled()).toBe(false);
  });
});
