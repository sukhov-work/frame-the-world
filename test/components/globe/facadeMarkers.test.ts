import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachFacadeMarkers, FACADE_MARKER_CAP } from "../../../src/components/globe/scene/facadeMarkers";
import { PHOTO_PROJECT } from "../../../src/components/globe/tuning";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";
import { tokens } from "../../../src/lib/theme/tokens";
import type { FacadeWorldItem } from "../../../src/lib/wix/facadeRecords";

// F3 residency (T169 / T171, 2026-10-21): the marker mesh driven headlessly (three in Node, no GL
// until a render) — instance bookkeeping, the bounding-sphere trap, the hidden row, the resident
// tint, the geometry cache, the angular-size clamp and the NDC pick.

const row = (id: string, over: Partial<FacadeWorldItem> = {}): FacadeWorldItem => ({
  id,
  title: `Facade ${id}`,
  displayUrl: `https://static.wixstatic.com/media/${id}.jpg`,
  thumbUrl: null,
  updatedAt: "2026-10-21T10:00:00.000Z",
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 137.5,
  altitudeM: 1.7,
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  ...over,
});

/** A camera `distM` above the apex of `r` (along the geodetic up), looking at it. */
function cameraOver(r: FacadeWorldItem, distM: number): THREE.PerspectiveCamera {
  const apex = geodeticToEcef(r.lat, r.lon, r.apexAltM);
  const { up } = enuBasis(r.lat, r.lon);
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.5, 1e7);
  camera.position.set(apex[0] + up[0] * distM, apex[1] + up[1] * distM, apex[2] + up[2] * distM);
  camera.lookAt(apex[0], apex[1], apex[2]);
  camera.updateMatrixWorld(true);
  return camera;
}

const attach = () => {
  const scene = new THREE.Scene();
  const h = attachFacadeMarkers(scene);
  return { scene, h };
};

describe("facadeMarkers — rows → instances", () => {
  it("setRows draws one instance per row, nulls the bounding sphere, and counts", () => {
    const { h } = attach();
    expect(h.mesh.count).toBe(0);
    // The trap: a raycast before any row caches an EMPTY sphere…
    new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1)).intersectObject(h.mesh, false);
    expect(h.mesh.boundingSphere).not.toBeNull();
    h.setRows([row("a"), row("b", { lon: 35.05 }), row("a")]); // a duplicate id draws once
    expect(h.mesh.count).toBe(2);
    expect(h.mesh.boundingSphere).toBeNull(); // …and every instance write clears it
    expect(h.count()).toEqual({ total: 2, drawn: 2, resident: 0 });
    expect(h.rows().map((r) => r.id)).toEqual(["a", "b"]);
    h.setRows([row("b", { lon: 35.05 })]);
    expect(h.mesh.count).toBe(1);
    expect(h.apexOf("a")).toBeNull();
    expect(h.rowGeometry("a")).toBeNull();
    h.dispose();
  });

  it("the cap holds (the cover caps the read; the mesh never overflows its buffer)", () => {
    const { h } = attach();
    const rows: FacadeWorldItem[] = [];
    for (let i = 0; i < FACADE_MARKER_CAP + 5; i++) rows.push(row(`r${i}`, { lon: 35 + i * 1e-4 }));
    h.setRows(rows);
    expect(h.mesh.count).toBe(FACADE_MARKER_CAP);
    expect(h.count().total).toBe(FACADE_MARKER_CAP + 5);
    h.dispose();
  });

  it("apexOf / rowGeometry come from the cached frustum: apex at apexAltM, forward along the heading", () => {
    const { h } = attach();
    const r = row("a", { headingDeg: 90, pitchDeg: 0 });
    h.setRows([r]);
    const apex = geodeticToEcef(r.lat, r.lon, r.apexAltM);
    const got = h.apexOf("a")!;
    expect(got[0]).toBeCloseTo(apex[0], 6);
    expect(got[1]).toBeCloseTo(apex[1], 6);
    expect(got[2]).toBeCloseTo(apex[2], 6);
    const g = h.rowGeometry("a")!;
    const { east } = enuBasis(r.lat, r.lon);
    expect(g.forward[0] * east[0] + g.forward[1] * east[1] + g.forward[2] * east[2]).toBeCloseTo(1, 9);
    // The cache stands for a row whose pose did not change (a rename), and rebuilds when it did.
    h.setRows([{ ...r, title: "Renamed" }]);
    expect(h.rowGeometry("a")).toBe(g);
    expect(h.rows()[0].title).toBe("Renamed");
    h.setRows([{ ...r, headingDeg: 180 }]);
    expect(h.rowGeometry("a")).not.toBe(g);
    const { north } = enuBasis(r.lat, r.lon);
    const g2 = h.rowGeometry("a")!;
    expect(g2.forward[0] * north[0] + g2.forward[1] * north[1] + g2.forward[2] * north[2]).toBeCloseTo(-1, 9);
    h.dispose();
  });

  it("setHidden drops the row from the draw and from the candidates, keeps its geometry, and restores", () => {
    const { h } = attach();
    h.setRows([row("a"), row("b", { lon: 35.05 }), row("c", { lon: 35.06 })]);
    h.setHidden("b");
    expect(h.mesh.count).toBe(2);
    expect(h.mesh.boundingSphere).toBeNull();
    expect(h.rows().map((r) => r.id)).toEqual(["a", "c"]);
    expect(h.rowGeometry("b")).not.toBeNull();
    expect(h.count()).toEqual({ total: 3, drawn: 2, resident: 0 });
    h.setHidden(null);
    expect(h.mesh.count).toBe(3);
    expect(h.rows().map((r) => r.id)).toEqual(["a", "b", "c"]);
    h.dispose();
  });

  it("setResident tints the resident instances brighter than the accent and counts them", () => {
    const { h } = attach();
    h.setRows([row("a"), row("b", { lon: 35.05 })]);
    const accent = new THREE.Color(tokens.accent);
    const c = new THREE.Color();
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(accent.getHex());
    h.setResident(["b", "ghost"]);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(accent.getHex());
    h.mesh.getColorAt(1, c);
    expect(c.getHex()).not.toBe(accent.getHex());
    expect(c.r + c.g + c.b).toBeGreaterThan(accent.r + accent.g + accent.b); // lifted toward white
    expect(h.count()).toEqual({ total: 2, drawn: 2, resident: 1 });
    // The tint survives a re-push and follows a hidden row's removal.
    h.setRows([row("b", { lon: 35.05 }), row("a")]);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).not.toBe(accent.getHex());
    h.setResident([]);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(accent.getHex());
    h.dispose();
  });
});

describe("facadeMarkers — update / pick", () => {
  it("update anchors the mesh at the camera, composes apex-relative matrices with the clamped angular scale, and only on a > 1 m move", () => {
    const { h } = attach();
    const r = row("a");
    h.setRows([r]);
    const near = cameraOver(r, 20);
    h.update(near);
    expect(h.mesh.visible).toBe(true);
    expect(h.mesh.position.distanceTo(near.position)).toBe(0);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    h.mesh.getMatrixAt(0, m);
    m.decompose(p, q, s);
    // 20 m × 0.02 = 0.4 m → the 0.5 m floor (4 places: the quaternion → matrix round-trip's float floor is ~1e-8 relative).
    expect(20 * PHOTO_PROJECT.markerAngularSize).toBeLessThan(PHOTO_PROJECT.markerMinM); // the premise
    expect(s.x).toBeCloseTo(PHOTO_PROJECT.markerMinM, 4);
    // T178: the quad is screen-aligned — the instance carries the CAMERA's quaternion (the stock
    // raycast then sees the same face the eye does).
    expect(Math.abs(q.dot(near.quaternion))).toBeCloseTo(1, 6);
    const apex = h.apexOf("a")!;
    // `instanceMatrix` is a Float32Array: a 300 m translation quantises at ~2e-5 m — a millimetre is the honest bar.
    expect(p.clone().add(h.mesh.position).distanceTo(new THREE.Vector3(...apex))).toBeLessThan(1e-3);
    expect(h.mesh.boundingSphere).toBeNull();
    // A sub-metre nudge is no rebuild; a metre is.
    const v0 = h.mesh.instanceMatrix.version;
    near.position.addScaledVector(new THREE.Vector3(1, 0, 0), 0.5);
    h.update(near);
    expect(h.mesh.instanceMatrix.version).toBe(v0);
    near.position.addScaledVector(new THREE.Vector3(1, 0, 0), 1.0);
    h.update(near);
    expect(h.mesh.instanceMatrix.version).toBe(v0 + 1);
    // Far away the scale hits the ceiling.
    h.update(cameraOver(r, 200_000));
    h.mesh.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(s.x).toBeCloseTo(PHOTO_PROJECT.markerMaxM, 3);
    // Mid-range: the angular law.
    h.update(cameraOver(r, 10_000));
    h.mesh.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(s.x).toBeCloseTo(10_000 * PHOTO_PROJECT.markerAngularSize, 4);
    // A TURN (no move) recomposes too — the billboard follows the camera.
    const cam = cameraOver(r, 10_000);
    h.update(cam);
    const v1 = h.mesh.instanceMatrix.version;
    cam.rotateZ(0.3);
    h.update(cam);
    expect(h.mesh.instanceMatrix.version).toBe(v1 + 1);
    h.dispose();
  });

  afterEach(() => vi.restoreAllMocks());

  it("T183: setHover eases the hovered marker toward white and `markerHoverScale` larger; un-hover eases it back", () => {
    // The ease reads the wall clock (`performance.now`) — a tight test loop would see dt ≈ 0, so
    // the clock ticks 16 ms per read (a 60 Hz frame).
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 16));
    const { h } = attach();
    const a = row("a");
    h.setRows([a, row("b", { lon: 35.05 })]);
    const cam = cameraOver(a, 10_000);
    h.update(cam);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const accent = new THREE.Color(tokens.accent);
    const base = 10_000 * PHOTO_PROJECT.markerAngularSize;
    expect(h.hovered()).toBeNull();
    h.setHover("a");
    expect(h.hovered()).toBe("a");
    // The ease runs across update() calls (an exponential with the pins' tau) — drive it to rest.
    let settled = false;
    for (let i = 0; i < 400 && !settled; i++) {
      h.update(cam);
      h.mesh.getMatrixAt(0, m);
      m.decompose(p, q, s);
      settled = Math.abs(s.x - base * PHOTO_PROJECT.markerHoverScale) < 1e-3;
    }
    expect(settled).toBe(true);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff); // white at rest
    h.mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(accent.getHex()); // the other marker untouched
    h.mesh.getMatrixAt(1, m);
    m.decompose(p, q, s);
    expect(s.x).toBeCloseTo(base, 0); // "b" sits ~4 m farther than "a" (its own angular scale, no hover factor)
    // Un-hover: back to the accent and the base scale.
    h.setHover(null);
    expect(h.hovered()).toBeNull();
    settled = false;
    for (let i = 0; i < 400 && !settled; i++) {
      h.update(cam);
      h.mesh.getMatrixAt(0, m);
      m.decompose(p, q, s);
      settled = Math.abs(s.x - base) < 1e-3;
    }
    expect(settled).toBe(true);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(accent.getHex());
    // A resident hovered marker rests on white too, and returns to the LIFTED accent.
    h.setResident(["a"]);
    h.setHover("a");
    for (let i = 0; i < 400; i++) h.update(cam);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff);
    h.setHover(null);
    for (let i = 0; i < 400; i++) h.update(cam);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).not.toBe(accent.getHex());
    expect(c.r + c.g + c.b).toBeGreaterThan(accent.r + accent.g + accent.b);
    h.dispose();
  });

  it("T201 (owner 2026-10-26): the orchestrator mirrors the TEX pref into setVisible every frame, before update()", () => {
    // The TEX chip / the /m LAYERS modal share `texturesVisible`; the camera-icon markers must go with
    // the projected textures — the PIN chip / MY PLACES idiom (`stepPinsUpdate`). A source pin: the
    // flag flows through the handle right before the per-frame `update(camera)`, so a flip applies on
    // the next frame without the camera moving.
    const src = readFileSync(join(__dirname, "../../../src/components/globe/StylizedTiles.ts"), "utf8");
    const i = src.indexOf("facadeMarkers.setVisible(useCameraStore.getState().texturesVisible);");
    const j = src.indexOf("facadeMarkers.update(camera);");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(200);
  });

  it("no rows / hidden → the mesh is invisible and nothing is picked", () => {
    const { h } = attach();
    const cam = cameraOver(row("a"), 300);
    h.update(cam);
    expect(h.mesh.visible).toBe(false);
    expect(h.pick(0, 0, cam)).toBeNull();
    h.setRows([row("a")]);
    h.setVisible(false);
    h.update(cam);
    expect(h.mesh.visible).toBe(false);
    expect(h.pick(0, 0, cam)).toBeNull();
    h.setVisible(true);
    h.update(cam);
    expect(h.mesh.visible).toBe(true);
    expect(h.pick(0, 0, cam)).toBe("a");
    h.dispose();
  });

  it("pick hits the marker at its projected NDC (the camera-relative anchor included) and misses beside it", () => {
    const { h } = attach();
    const a = row("a");
    const b = row("b", { lon: 35.0462 + 0.0015 }); // ~110 m east of a — inside the ±231 m the 60° lens sees from 400 m
    h.setRows([a, b]);
    const cam = cameraOver(a, 400);
    h.update(cam);
    // The marker under the centre is "a" (the camera looks straight at its apex).
    expect(h.pick(0, 0, cam)).toBe("a");
    // "b" sits where its apex projects.
    const ndcB = new THREE.Vector3(...h.apexOf("b")!).project(cam);
    expect(Math.abs(ndcB.x)).toBeLessThan(1);
    expect(Math.abs(ndcB.y)).toBeLessThan(1);
    expect(h.pick(ndcB.x, ndcB.y, cam)).toBe("b");
    // Empty sky beside them.
    expect(h.pick(0.95, 0.95, cam)).toBeNull();
    // The hidden row is unpickable; the other still is.
    h.setHidden("a");
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBeNull();
    expect(h.pick(ndcB.x, ndcB.y, cam)).toBe("b");
    h.dispose();
  });

  it("a pick after rows changed but before a frame does not read a stale sphere", () => {
    const { h } = attach();
    const a = row("a");
    const cam = cameraOver(a, 400);
    h.setRows([]);
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBeNull(); // the empty-sphere cache the trap is about
    h.setRows([a]);
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBe("a");
    h.dispose();
  });
});
