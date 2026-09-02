import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ecefToGeodetic, geodeticToEcef } from "../../../src/lib/geo/projection";
import { rigToTransform } from "../../../src/lib/globe/featureTransform";
import { MODELS } from "../../../src/components/globe/tuning";
import { attachUserModels, patchModelShader, type ModelLoader, type ModelShader } from "../../../src/components/globe/scene/userModels";
import type { PublicModel } from "../../../src/lib/wix/modelRecords";

// MESH SUITE MS5 — the scene module driven headlessly (real three objects, no renderer, the
// skyGhosts precedent): residency under the budget, the ENU frame + ground-fit re-base, the
// eased seat, the pick, the gizmo rig round-trip, seats/rebase/armed, visibility and disposal.

const LAT = 48.4647;
const LON = 35.0462;
const row = (id: string, over: Partial<PublicModel> = {}): PublicModel => ({
  id,
  title: `Model ${id}`,
  url: `https://static.wixstatic.com/3d/${id}.glb`,
  thumbnailUrl: null,
  tris: 1000,
  glbBytes: 5000,
  bbox: [4, 6, 4],
  lat: LAT,
  lon: LON,
  rotDeg: 0,
  scale: 1,
  updatedAt: "2026-09-02T12:00:00.000Z",
  ...over,
});

/** A synthetic GLB root: a 4 × 6 × 4 box whose base sits at y = 2 and centre at x = 10 — the
 *  ground-fit must move it onto the origin / the ground. */
const makeLoader = () => {
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const loader: ModelLoader & { calls: string[]; gates: Array<() => void>; hold: boolean } = {
    calls,
    gates,
    hold: false,
    async load(url) {
      calls.push(url);
      if (loader.hold) await new Promise<void>((res) => gates.push(res));
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4), new THREE.MeshStandardMaterial());
      mesh.position.set(10, 5, 0); // base at y = 2, centre x = 10
      root.add(mesh);
      return root;
    },
  };
  return loader;
};

const cameraNear = () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 1, 50_000);
  const p = geodeticToEcef(LAT, LON + 0.001, 200);
  cam.position.set(p[0], p[1], p[2]);
  cam.updateMatrixWorld(true);
  return cam;
};

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("scene/userModels", () => {
  it("loads a nearby model, ground-fits it onto an ENU frame at the (fallback) seat, and eases onto the real terrain", async () => {
    const scene = new THREE.Scene();
    let terrain: number | null = null;
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => terrain, loader });
    h.setModels([row("a")]);
    expect(h.counts()).toMatchObject({ world: 1, resident: 0, loading: 0 });
    const cam = cameraNear();
    h.update(cam, 0);
    expect(loader.calls).toEqual([row("a").url]);
    expect(h.counts().loading).toBe(1);
    await flush();
    expect(h.counts()).toMatchObject({ resident: 1, loading: 0, tris: 1000, skipped: 0, warn: false });
    const rig = h.rig("a")!;
    expect(rig).toMatchObject({ cx: 0, cz: 0, liveBaseY: 0, inflate: 1 });
    // The frame sits at the placement, at the FALLBACK ground (no tile yet)…
    const frame = rig.anchor.parent as THREE.Group;
    const g = ecefToGeodetic([frame.position.x, frame.position.y, frame.position.z]);
    expect(g.latDeg).toBeCloseTo(LAT, 6);
    expect(g.lonDeg).toBeCloseTo(LON, 6);
    expect(g.altM).toBeCloseTo(MODELS.fallbackGroundM, 3);
    // …its +Y is geodetic up and −Z is north (the glTF / baker convention).
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
    const p = geodeticToEcef(LAT, LON, 0);
    const radial = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    expect(up.dot(radial)).toBeGreaterThan(0.999);
    const north = new THREE.Vector3(0, 0, -1).applyQuaternion(frame.quaternion);
    const pn = geodeticToEcef(LAT + 0.01, LON, 0);
    const toNorth = new THREE.Vector3(pn[0] - p[0], pn[1] - p[1], pn[2] - p[2]).normalize();
    expect(north.dot(toNorth)).toBeGreaterThan(0.99);
    // The GLB root was re-based: footprint centre on the origin, lowest point at y = 0.
    const root = rig.body.children[0];
    expect(root.position.x).toBeCloseTo(-10, 9);
    expect(root.position.y).toBeCloseTo(-2, 9);
    expect(root.position.z).toBeCloseTo(0, 9);
    const top = new THREE.Vector3();
    expect(h.topWorld("a", top)).toBe(true);
    expect(top.distanceTo(frame.position)).toBeCloseTo(6, 3); // the box height, straight up
    // Every mesh casts + receives.
    const mesh = root.children[0] as THREE.Mesh;
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    // The terrain answers 90 m: resnap + a few frames ease the frame down (never a teleport).
    terrain = 90;
    h.resnap();
    h.update(cam, 1);
    const g1 = ecefToGeodetic([frame.position.x, frame.position.y, frame.position.z]);
    expect(g1.altM).toBeLessThan(MODELS.fallbackGroundM);
    expect(g1.altM).toBeGreaterThan(90);
    for (let f = 2; f < 400; f++) h.update(cam, f);
    const g2 = ecefToGeodetic([frame.position.x, frame.position.y, frame.position.z]);
    expect(g2.altM).toBeCloseTo(90, 2);
    expect(h.debug()).toMatchObject({ resident: 1, armedId: null });
    h.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("picks the model under a ray, and the gizmo rig round-trips a live transform", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    h.setModels([row("a")]);
    const cam = cameraNear();
    h.update(cam, 0);
    await flush();
    // A ray straight down onto the model from 50 m above its top.
    const frame = h.rig("a")!.anchor.parent as THREE.Group;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
    const origin = frame.position.clone().addScaledVector(up, 50);
    const ray = new THREE.Raycaster(origin, up.clone().negate());
    expect(h.pick(ray)).toMatchObject({ id: "a" });
    expect(h.pick(ray)!.distance).toBeCloseTo(44, 1); // 50 − the 6 m box
    // A ray that misses.
    const miss = new THREE.Raycaster(origin.clone().addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(frame.quaternion), 30), up.clone().negate());
    expect(h.pick(miss)).toBeNull();
    // The gizmo's forward map → the rig → the read-back is exact.
    h.setDragging("a", true);
    h.placeRig("a", { sx: 1.5, sy: 1.5, sz: 1.5, rotDeg: 30, tE: 4, tN: -2, tU: 0 });
    const r = h.rig("a")!;
    const back = rigToTransform(
      { ax: r.anchor.position.x, ay: r.anchor.position.y, az: r.anchor.position.z, qy: r.body.quaternion.y, qw: r.body.quaternion.w, sx: r.body.scale.x, sy: r.body.scale.y, sz: r.body.scale.z },
      { cx: 0, cz: 0, liveBaseY: 0, inflate: 1 },
    );
    expect(back.tE).toBeCloseTo(4, 9);
    expect(back.tN).toBeCloseTo(-2, 9);
    expect(back.tU).toBe(0);
    expect(back.rotDeg).toBeCloseTo(30, 9);
    expect(back.sx).toBeCloseTo(1.5, 9);
    // While dragging the per-frame writes leave the rig alone…
    h.update(cam, 5);
    expect(r.anchor.position.x).toBeCloseTo(4, 9);
    // …and the release re-places from the committed seats (the anchor returns to zero).
    h.setDragging("a", false);
    expect(r.anchor.position.length()).toBe(0);
    expect(r.body.scale.x).toBe(1);
    // A committed seat snaps; a later one eases.
    h.setSeats("a", { rotDeg: 90, scale: 2 }, true);
    expect(r.body.scale.x).toBe(2);
    expect(h.info("a")).toMatchObject({ seats: { rotDeg: 90, scale: 2 }, resident: true, sizeM: 4, sizeM3: [4, 4, 6] }); // MS5b: w × d × h
    h.setSeats("a", { rotDeg: 0, scale: 1 });
    h.update(cam, 6);
    expect(r.body.scale.x).toBeLessThan(2);
    expect(r.body.scale.x).toBeGreaterThan(1);
    for (let f = 7; f < 300; f++) h.update(cam, f);
    expect(r.body.scale.x).toBe(1);
    // Rebase moves the frame at once and zeroes the anchor.
    h.rebase("a", LAT + 0.001, LON);
    const g = ecefToGeodetic([frame.position.x, frame.position.y, frame.position.z]);
    expect(g.latDeg).toBeCloseTo(LAT + 0.001, 6);
    expect(h.info("a")?.lat).toBeCloseTo(LAT + 0.001, 9);
    // Armed = an emissive lift in the accent colour; disarm restores the material.
    const mat = (r.body.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    h.setArmed("a");
    expect(mat.emissiveIntensity).toBe(MODELS.armedEmissive);
    h.setArmed(null);
    expect(mat.emissiveIntensity).toBe(1);
    expect(mat.emissive.getHex()).toBe(0x000000);
    h.dispose();
  });

  it("plans residency closest-first under the budget, counts the skipped, honours the MDL gate and drops removed rows", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    const far = row("far", { lat: LAT + 0.2 }); // ~22 km — outside the load radius
    const heavy = row("heavy", { lon: LON - 0.0005, tris: MODELS.triBudget }); // farther than `near`; eats the whole budget
    const near = row("near", { tris: 10 });
    h.setModels([far, heavy, near]);
    const cam = cameraNear();
    h.update(cam, 0);
    await flush();
    // `near` (10 tris) loads first; `heavy` would bust the budget → skipped → the warning.
    expect(loader.calls).toEqual([near.url]);
    expect(h.counts()).toMatchObject({ world: 3, resident: 1, skipped: 1, warn: true });
    expect(h.info("far")?.resident).toBe(false);
    // The MDL chip off releases everything and stops loading; on brings it back.
    h.setVisible(false);
    h.update(cam, 1);
    expect(h.counts()).toMatchObject({ resident: 0, visible: false, skipped: 0 });
    expect(scene.getObjectByName("userModels")!.visible).toBe(false);
    h.setVisible(true);
    h.update(cam, 2);
    await flush();
    expect(h.counts().resident).toBe(1);
    // A removed row unloads; a moved row rebases; a re-seated row eases.
    h.setModels([{ ...near, rotDeg: 45, updatedAt: "2026-09-02T13:00:00.000Z" }]);
    expect(h.counts().world).toBe(1);
    expect(h.info("near")?.seats.rotDeg).toBe(45);
    h.setModels([]);
    h.update(cam, 3);
    expect(h.counts()).toMatchObject({ world: 0, resident: 0 });
    h.dispose();
  });

  it("drops a fetch that lands after the model was released, and reports a failed load", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    loader.hold = true;
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    h.setModels([row("a")]);
    const cam = cameraNear();
    h.update(cam, 0);
    expect(h.counts().loading).toBe(1);
    h.setModels([]); // released while the bytes are in flight
    loader.gates[0]();
    await flush();
    expect(h.counts()).toMatchObject({ world: 0, resident: 0, loading: 0 });
    expect(scene.getObjectByName("userModels")!.children.length).toBe(0);
    // A loader failure is a FAILED entry, never retried by the plan.
    const failing: ModelLoader = { load: async () => { throw new Error("404"); } };
    const h2 = attachUserModels(scene, { terrainHeightAt: () => 100, loader: failing });
    h2.setModels([row("b")]);
    h2.update(cam, 0);
    await flush();
    expect(h2.counts()).toMatchObject({ resident: 0, loading: 0, failed: 1 });
    h2.update(cam, MODELS.residencyEveryFrames);
    expect(h2.counts().failed).toBe(1);
    h2.dispose();
    h.dispose();
  });

  it("MS6: chains the haze + dissolve patch onto a loaded GLB's materials and drives it through the handle", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    h.setModels([row("a")]);
    h.update(cameraNear(), 0);
    await flush();
    const mesh = scene.getObjectByName("userModels")!.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(typeof mat.onBeforeCompile).toBe("function");
    // Drive the hook with a shader skeleton carrying the anchors three's materials all have.
    const shader: ModelShader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main(){\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main(){\n#include <color_fragment>\n#include <opaque_fragment>\n}",
    };
    mat.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain("vFtwWPos = (modelMatrix * vec4(transformed, 1.0)).xyz");
    expect(shader.fragmentShader).toContain("ftwAerial(gl_FragColor.rgb, vFtwWPos");
    expect(shader.fragmentShader).toContain("if (ftwFb > uFtwModelAlpha) discard;");
    for (const k of ["uFtwHaze", "uFtwHazeCol", "uFtwHazeCool", "uFtwSkyLevel", "uFtwAfterglowG", "uFtwSunW", "uFtwModelAlpha"]) {
      expect(shader.uniforms[k]).toBeDefined();
      expect(shader.fragmentShader).toContain(`uniform ${k === "uFtwHazeCol" || k === "uFtwHazeCool" || k === "uFtwSunW" ? "vec3" : "float"} ${k};`);
    }
    // The holders are bound by reference: the handle's setters reach every program.
    h.setUltraHaze(0.4, new THREE.Color("#ff8800"), new THREE.Vector3(0, 1, 0), new THREE.Color("#0044ff"), 0.7, 0.2);
    expect((shader.uniforms.uFtwHaze as { value: number }).value).toBe(0.4);
    expect((shader.uniforms.uFtwSkyLevel as { value: number }).value).toBe(0.7);
    h.setSolidity(0);
    expect((shader.uniforms.uFtwModelAlpha as { value: number }).value).toBeCloseTo(0.28, 6);
    h.setSolidity(0.5);
    expect((shader.uniforms.uFtwModelAlpha as { value: number }).value).toBeCloseTo(0.64, 6);
    h.setSolidity(null);
    expect((shader.uniforms.uFtwModelAlpha as { value: number }).value).toBe(1);
    // The patch is ONE named function (three's program cache key is its source) and idempotent on
    // the anchors: a second material gets the same text.
    const twin: ModelShader = { uniforms: {}, vertexShader: shader.vertexShader.replace(/vFtwWPos[^\n]*\n/g, ""), fragmentShader: "#include <common>\n#include <color_fragment>\n#include <opaque_fragment>" };
    patchModelShader(twin);
    expect(twin.fragmentShader).toContain("ftwAerial(");
    expect(h.debug()).toMatchObject({ shader: { chained: true, alpha: 1 } });
    h.dispose();
  });
});
