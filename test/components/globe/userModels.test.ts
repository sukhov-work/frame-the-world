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
  tU: 0,
  pitchDeg: 0,
  rollDeg: 0,
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
    h.setSeats("a", { rotDeg: 90, scale: 2, liftM: 0, pitchDeg: 0, rollDeg: 0 }, true);
    expect(r.body.scale.x).toBe(2);
    expect(h.info("a")).toMatchObject({ seats: { rotDeg: 90, scale: 2, liftM: 0, pitchDeg: 0, rollDeg: 0 }, resident: true, sizeM: 4, sizeM3: [4, 4, 6] }); // MS5b: w × d × h
    h.setSeats("a", { rotDeg: 0, scale: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 });
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

  it("MS7 — the lift is the anchor's Y: railed on read against the model's height × scale, live through placeRig, eased on a row change", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    // bbox [4, 6, 4] → 6 m tall → the floor keeps 1.5 m above the seat → −4.5.
    h.setModels([row("a", { tU: -2 }), row("b", { tU: -40 }), row("c", { tU: 400 })]);
    const cam = cameraNear();
    h.update(cam, 0);
    await flush();
    h.update(cam, MODELS.residencyEveryFrames); // the third fetch waits for the next re-plan (2 concurrent loads)
    await flush();
    const ra = h.rig("a")!;
    expect(ra.anchor.position.y).toBe(-2);
    expect(h.info("a")?.seats.liftM).toBe(-2);
    expect(h.rig("b")!.anchor.position.y).toBe(-4.5);
    expect(h.rig("c")!.anchor.position.y).toBe(50);
    // The loaded bounds outrank the record's bbox for the floor (the box is 6 m, so unchanged here).
    expect(h.info("b")?.sizeM3).toEqual([4, 4, 6]);
    // A live drag writes the lift straight onto the anchor and reads back as tU.
    h.setDragging("a", true);
    h.placeRig("a", { sx: 1, sy: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 3 });
    expect(ra.anchor.position.y).toBe(3);
    const back = rigToTransform(
      { ax: ra.anchor.position.x, ay: ra.anchor.position.y, az: ra.anchor.position.z, qy: ra.body.quaternion.y, qw: ra.body.quaternion.w, sx: ra.body.scale.x, sy: ra.body.scale.y, sz: ra.body.scale.z },
      { cx: 0, cz: 0, liveBaseY: 0, inflate: 1 },
    );
    expect(back.tU).toBe(3);
    // A cancelled drag falls back on the committed lift; a snapped commit lands at once (railed).
    h.setDragging("a", false);
    expect(ra.anchor.position.y).toBe(-2);
    h.setSeats("a", { rotDeg: 0, scale: 1, liftM: -10, pitchDeg: 0, rollDeg: 0 }, true);
    expect(ra.anchor.position.y).toBe(-4.5);
    // A shrink re-rails the floor: at 0.5× the box is 3 m → floor −2.25.
    h.setSeats("a", { rotDeg: 0, scale: 0.5, liftM: -4.5, pitchDeg: 0, rollDeg: 0 }, true);
    expect(ra.anchor.position.y).toBe(-2.25);
    // A row change (a RESET from the list / another member) eases the lift back to the ground.
    h.setModels([row("a", { tU: 0, updatedAt: "2026-09-03T00:00:00.000Z" }), row("b", { tU: -40 }), row("c", { tU: 400 })]);
    h.update(cam, 1);
    expect(ra.anchor.position.y).toBeGreaterThan(-2.25);
    expect(ra.anchor.position.y).toBeLessThan(0);
    for (let f = 2; f < 300; f++) h.update(cam, f);
    expect(ra.anchor.position.y).toBe(0);
    // The label anchor rides the lift (the top of a lifted model is higher).
    const top = new THREE.Vector3();
    h.setSeats("c", { rotDeg: 0, scale: 1, liftM: 50, pitchDeg: 0, rollDeg: 0 }, true);
    expect(h.topWorld("c", top)).toBe(true);
    const frameC = h.rig("c")!.anchor.parent as THREE.Group;
    const upC = new THREE.Vector3(0, 1, 0).applyQuaternion(frameC.quaternion);
    expect(top.clone().sub(frameC.position).dot(upC)).toBeCloseTo(56, 6); // 50 lift + 6 tall
    // Rebase keeps the lift (only east/north return to zero).
    h.setSeats("a", { rotDeg: 0, scale: 1, liftM: -1, pitchDeg: 0, rollDeg: 0 }, true);
    h.rebase("a", LAT + 0.001, LON);
    expect(ra.anchor.position.x).toBe(0);
    expect(ra.anchor.position.y).toBe(-1);
    h.dispose();
  });

  it("MS8 — the tilt: the body carries the YXZ quaternion of yaw/pitch/roll, live through placeRig, slerp-eased on a row change, the floor follows a flip", async () => {
    const scene = new THREE.Scene();
    const loader = makeLoader();
    const h = attachUserModels(scene, { terrainHeightAt: () => 100, loader });
    // bbox [4, 6, 4] → w 4, d 4, h 6. "b" is flipped on the row at lift 0 → held up a quarter (1.5 m).
    h.setModels([row("a", { rotDeg: 30, pitchDeg: 20, rollDeg: -10 }), row("b", { rollDeg: 180, tU: 0 })]);
    const cam = cameraNear();
    h.update(cam, 0);
    await flush();
    const ra = h.rig("a")!;
    const expectQ = (q: THREE.Quaternion, yaw: number, pitch: number, roll: number) => {
      const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
      expect((e.y * 180) / Math.PI).toBeCloseTo(yaw, 6);
      expect((e.x * 180) / Math.PI).toBeCloseTo(pitch, 6);
      expect((e.z * 180) / Math.PI).toBeCloseTo(roll, 6);
    };
    expectQ(ra.body.quaternion, 30, 20, -10);
    expect(h.info("a")?.seats).toMatchObject({ rotDeg: 30, pitchDeg: 20, rollDeg: -10, liftM: 0 });
    // The flipped row: the tilt applied, the lift railed UP to the floor (top 0, span 6 → keep 1.5).
    const rb = h.rig("b")!;
    expectQ(rb.body.quaternion, 0, 0, 180);
    expect(rb.anchor.position.y).toBe(1.5);
    expect(h.info("b")?.seats.liftM).toBe(1.5);
    // A live drag writes the whole rotation onto the body (three's Euler agrees on the triple).
    h.setDragging("a", true);
    h.placeRig("a", { sx: 1, sy: 1, sz: 1, rotDeg: -60, tE: 0, tN: 0, tU: 0, pitchDeg: 45, rollDeg: 90 });
    expectQ(ra.body.quaternion, -60, 45, 90);
    // A building-shaped place (no tilt fields) reads as upright — the yaw alone.
    h.placeRig("a", { sx: 1, sy: 1, sz: 1, rotDeg: 15, tE: 0, tN: 0, tU: 0 });
    expectQ(ra.body.quaternion, 15, 0, 0);
    // A cancelled drag falls back on the committed rotation; a snapped commit lands at once.
    h.setDragging("a", false);
    expectQ(ra.body.quaternion, 30, 20, -10);
    h.setSeats("a", { rotDeg: 0, scale: 1, liftM: 0, pitchDeg: 90, rollDeg: 0 }, true);
    expectQ(ra.body.quaternion, 0, 90, 0);
    // On its side the 4 m depth straddles the pivot: the floor is −1 (top 2, span 4, keep 1) — a
    // deeper commit comes up to it.
    h.setSeats("a", { rotDeg: 0, scale: 1, liftM: -5, pitchDeg: 90, rollDeg: 0 }, true);
    expect(ra.anchor.position.y).toBe(-1);
    // A row change (another member stood it up) eases the rotation as a slerp: monotone, lands exactly.
    h.setModels([row("a", { rotDeg: 0, pitchDeg: 0, rollDeg: 0, tU: 0, updatedAt: "2026-09-05T00:00:00.000Z" }), row("b", { rollDeg: 180, tU: 0 })]);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, "YXZ"));
    let prev = ra.body.quaternion.angleTo(target);
    h.update(cam, 1);
    let now = ra.body.quaternion.angleTo(target);
    expect(now).toBeLessThan(prev);
    expect(now).toBeGreaterThan(0);
    for (let f = 2; f < 400; f++) {
      h.update(cam, f);
      const a = ra.body.quaternion.angleTo(target);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
    expect(ra.body.quaternion.angleTo(target)).toBe(0);
    expect(h.info("a")?.seats).toMatchObject({ rotDeg: 0, pitchDeg: 0, rollDeg: 0 });
    expect(ra.anchor.position.y).toBe(0);
    // The label anchor is the tilted box's HIGHEST point: the flipped "b" (held up 1.5 m, its top
    // AT the pivot) pins at 1.5 m; upright "a" at its 6 m height (the MS7 number).
    const top = new THREE.Vector3();
    const upOf = (id: string) => {
      const frame = h.rig(id)!.anchor.parent as THREE.Group;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
      expect(h.topWorld(id, top)).toBe(true);
      return top.clone().sub(frame.position).dot(up);
    };
    expect(upOf("b")).toBeCloseTo(1.5, 6);
    expect(upOf("a")).toBeCloseTo(6, 6);
    h.setSeats("a", { rotDeg: 0, scale: 2, liftM: 0, pitchDeg: 90, rollDeg: 0 }, true); // on its side at 2×: top = d/2 × 2 = 4
    expect(upOf("a")).toBeCloseTo(4, 6);
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
