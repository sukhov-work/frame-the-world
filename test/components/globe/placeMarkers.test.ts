import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachPlaceMarkers, PLACE_PIN_TIP_FRAC } from "../../../src/components/globe/scene/placeMarkers";
import { PHOTO_PROJECT, PLACEMARKS } from "../../../src/components/globe/tuning";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";
import { tokens } from "../../../src/lib/theme/tokens";
import type { PlaceListItem } from "../../../src/lib/wix/placeRecords";

// T189 (owner 2026-10-22g; ruling 2026-10-22h): MY PLACES on the GL globe are LOCATION-PIN
// billboards in the facade markers' idiom — the marker mesh driven headlessly (three in Node, no
// GL until a render): instance bookkeeping, the bounding-sphere trap, the angular-size clamp (a
// fifth bigger than the facade markers), the camera-quaternion billboard with the tip on the
// ground, the hover ease, the far-hemisphere cull, the NDC pick that hands back the FULL row, the
// resnap; then the orchestrator's wiring as source — the clock first, then the full-pose jump.

const GROUND_M = 100;

const spot = (id: string, over: Partial<PlaceListItem> = {}): PlaceListItem => ({
  id,
  title: `Place ${id}`,
  timeMs: null,
  createdAt: null,
  latDeg: 48.4647,
  lonDeg: 35.0462,
  eyeM: 1.7,
  headingDeg: 90,
  pitchDeg: 0,
  fovDeg: 60,
  ...over,
});

/** Where a place's pin stands: the ground + `liftM`. */
const anchor = (s: PlaceListItem, groundM = GROUND_M) => geodeticToEcef(s.latDeg, s.lonDeg, groundM + PLACEMARKS.liftM);

/** A camera `distM` above the anchor of `s` (along the geodetic up), looking at it. */
function cameraOver(s: PlaceListItem, distM: number): THREE.PerspectiveCamera {
  const a = anchor(s);
  const { up } = enuBasis(s.latDeg, s.lonDeg);
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.5, 1e7);
  camera.position.set(a[0] + up[0] * distM, a[1] + up[1] * distM, a[2] + up[2] * distM);
  camera.lookAt(a[0], a[1], a[2]);
  camera.updateMatrixWorld(true);
  return camera;
}

const attach = (terrainHeightAt: (lat: number, lon: number) => number | null = () => GROUND_M) => {
  const scene = new THREE.Scene();
  const h = attachPlaceMarkers(scene, { terrainHeightAt });
  return { scene, h };
};

const decompose = (h: ReturnType<typeof attachPlaceMarkers>, i: number) => {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  h.mesh.getMatrixAt(i, m);
  m.decompose(p, q, s);
  return { p, q, s };
};

describe("placeMarkers — places → instances", () => {
  it("setPlaces draws one instance per place at the lifted ground point, nulls the bounding sphere, and counts", () => {
    const { h } = attach();
    expect(h.mesh.count).toBe(0);
    expect(h.mesh.name).toBe("placeMarkers");
    // The trap: a raycast before any row caches an EMPTY sphere…
    new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1)).intersectObject(h.mesh, false);
    expect(h.mesh.boundingSphere).not.toBeNull();
    const a = spot("a");
    h.setPlaces([a, spot("b", { lonDeg: 35.05 })]);
    expect(h.mesh.count).toBe(2);
    expect(h.mesh.boundingSphere).toBeNull(); // …and every instance write clears it
    expect(h.count()).toEqual({ total: 2, drawn: 2 });
    const got = h.anchorOf("a")!;
    const want = anchor(a);
    expect(got[0]).toBeCloseTo(want[0], 6);
    expect(got[1]).toBeCloseTo(want[1], 6);
    expect(got[2]).toBeCloseTo(want[2], 6);
    expect(h.anchorOf("zz")).toBeNull();
    // Lavender at rest (the 2D map layer's hue), per instance.
    const c = new THREE.Color();
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(new THREE.Color(tokens.pinLavender).getHex());
    h.setPlaces([]);
    expect(h.mesh.count).toBe(0);
    expect(h.count()).toEqual({ total: 0, drawn: 0 });
    h.dispose();
  });

  it("the cap holds (PLACE_PAGE bounds the fetch; the mesh never overflows its buffer)", () => {
    const { h } = attach();
    const rows: PlaceListItem[] = [];
    for (let i = 0; i < PLACEMARKS.maxRender + 5; i++) rows.push(spot(`r${i}`, { lonDeg: 35 + i * 1e-4 }));
    h.setPlaces(rows);
    expect(h.mesh.count).toBe(PLACEMARKS.maxRender);
    expect(h.count()).toEqual({ total: PLACEMARKS.maxRender + 5, drawn: PLACEMARKS.maxRender });
    h.dispose();
  });

  it("the pin stands on its point: the quad's origin is the glyph's tip, the head rises above it; the raycast is ON", () => {
    const { h } = attach();
    const geo = h.mesh.geometry as THREE.PlaneGeometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.min.y).toBeCloseTo(-PLACE_PIN_TIP_FRAC, 9); // the halo's margin below the tip
    expect(bb.max.y).toBeCloseTo(1 - PLACE_PIN_TIP_FRAC, 9);
    expect(PLACE_PIN_TIP_FRAC).toBeGreaterThan(0);
    expect(PLACE_PIN_TIP_FRAC).toBeLessThan(0.1);
    // The old decoration-only mesh overrode `raycast` to a no-op; the pin is a pick target.
    expect(h.mesh.raycast).toBe(THREE.InstancedMesh.prototype.raycast);
    expect((h.mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(false);
    expect(h.mesh.frustumCulled).toBe(false);
    expect(h.mesh.renderOrder).toBe(3);
    h.dispose();
  });
});

describe("placeMarkers — update / pick", () => {
  it("update anchors the mesh at the camera, composes camera-quaternion matrices with the clamped angular scale, and only on a > 1 m move or a turn", () => {
    const { h } = attach();
    const a = spot("a");
    h.setPlaces([a]);
    // "A bit bigger" than the facade markers (owner 2026-10-22g) — the premise, pinned.
    expect(PLACEMARKS.markerAngularSize).toBeGreaterThan(PHOTO_PROJECT.markerAngularSize);
    expect(PLACEMARKS.markerMinM).toBeGreaterThan(PHOTO_PROJECT.markerMinM);
    const near = cameraOver(a, 10);
    h.update(near);
    expect(h.mesh.visible).toBe(true);
    expect(h.mesh.position.distanceTo(near.position)).toBe(0);
    let { p, q, s } = decompose(h, 0);
    // 10 m × 0.024 = 0.24 m → the 0.6 m floor.
    expect(10 * PLACEMARKS.markerAngularSize).toBeLessThan(PLACEMARKS.markerMinM);
    expect(s.x).toBeCloseTo(PLACEMARKS.markerMinM, 4);
    expect(h.scaleOf("a")).toBeCloseTo(PLACEMARKS.markerMinM, 4);
    // The quad is screen-aligned — the instance carries the CAMERA's quaternion.
    expect(Math.abs(q.dot(near.quaternion))).toBeCloseTo(1, 6);
    // The instance origin (the tip) is the anchor — `instanceMatrix` is float32, a millimetre is the bar.
    expect(p.clone().add(h.mesh.position).distanceTo(new THREE.Vector3(...anchor(a)))).toBeLessThan(1e-3);
    expect(h.mesh.boundingSphere).toBeNull();
    // A sub-metre nudge is no rebuild; a metre is.
    const v0 = h.mesh.instanceMatrix.version;
    near.position.addScaledVector(new THREE.Vector3(1, 0, 0), 0.5);
    h.update(near);
    expect(h.mesh.instanceMatrix.version).toBe(v0);
    near.position.addScaledVector(new THREE.Vector3(1, 0, 0), 1.0);
    h.update(near);
    expect(h.mesh.instanceMatrix.version).toBe(v0 + 1);
    // Far away the scale hits the ceiling; mid-range the angular law.
    h.update(cameraOver(a, 200_000));
    ({ s } = decompose(h, 0));
    expect(s.x).toBeCloseTo(PLACEMARKS.markerMaxM, 3);
    h.update(cameraOver(a, 10_000));
    ({ s } = decompose(h, 0));
    expect(s.x).toBeCloseTo(10_000 * PLACEMARKS.markerAngularSize, 4);
    // A TURN (no move) recomposes too — the billboard follows the camera.
    const cam = cameraOver(a, 10_000);
    h.update(cam);
    const v1 = h.mesh.instanceMatrix.version;
    cam.rotateZ(0.3);
    h.update(cam);
    expect(h.mesh.instanceMatrix.version).toBe(v1 + 1);
    h.dispose();
  });

  afterEach(() => vi.restoreAllMocks());

  it("setHover eases the hovered pin toward white and `markerHoverScale` larger; un-hover eases it back; an unknown id is no hover", () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 16));
    const { h } = attach();
    const a = spot("a");
    h.setPlaces([a, spot("b", { lonDeg: 35.05 })]);
    const cam = cameraOver(a, 10_000);
    h.update(cam);
    const c = new THREE.Color();
    const lavender = new THREE.Color(tokens.pinLavender);
    const base = 10_000 * PLACEMARKS.markerAngularSize;
    expect(h.hovered()).toBeNull();
    h.setHover("a");
    expect(h.hovered()).toBe("a");
    let settled = false;
    for (let i = 0; i < 400 && !settled; i++) {
      h.update(cam);
      settled = Math.abs(decompose(h, 0).s.x - base * PLACEMARKS.markerHoverScale) < 1e-3;
    }
    expect(settled).toBe(true);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff); // white at rest
    h.mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(lavender.getHex()); // the other pin untouched
    expect(decompose(h, 1).s.x).toBeCloseTo(base, 0);
    // The hover survives a re-push of the same rows (the store writes `onMap` / rows often).
    h.setPlaces([a, spot("b", { lonDeg: 35.05 })]);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff);
    expect(h.hovered()).toBe("a");
    // Un-hover: back to lavender and the base scale.
    h.setHover(null);
    expect(h.hovered()).toBeNull();
    settled = false;
    for (let i = 0; i < 400 && !settled; i++) {
      h.update(cam);
      settled = Math.abs(decompose(h, 0).s.x - base) < 1e-3;
    }
    expect(settled).toBe(true);
    h.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(lavender.getHex());
    // An id that is not a place hovers nothing; a hovered place that leaves the list un-hovers.
    h.setHover("ghost");
    expect(h.hovered()).toBeNull();
    h.setHover("b");
    h.setPlaces([a]);
    expect(h.hovered()).toBeNull();
    h.dispose();
  });

  it("no places / hidden → the mesh is invisible and nothing is picked; the far side of the planet is scale 0 and never picked", () => {
    const { h } = attach();
    const a = spot("a");
    const cam = cameraOver(a, 300);
    h.update(cam);
    expect(h.mesh.visible).toBe(false);
    expect(h.pick(0, 0, cam)).toBeNull();
    h.setPlaces([a]);
    h.setVisible(false);
    h.update(cam);
    expect(h.mesh.visible).toBe(false);
    expect(h.pick(0, 0, cam)).toBeNull();
    h.setVisible(true);
    h.update(cam);
    expect(h.mesh.visible).toBe(true);
    expect(h.pick(0, 0, cam)).toBe(a);
    // The antipode: culled to a degenerate quad — never rasterised, never picked.
    const far = spot("far", { latDeg: -a.latDeg, lonDeg: a.lonDeg - 180 });
    h.setPlaces([a, far]);
    h.update(cam);
    expect(h.scaleOf("far")).toBe(0);
    expect(h.scaleOf("a")).toBeGreaterThan(0);
    for (let x = -0.9; x <= 0.9; x += 0.3) for (let y = -0.9; y <= 0.9; y += 0.3) expect(h.pick(x, y, cam)?.id ?? null).not.toBe("far");
    h.dispose();
  });

  it("pick hits the pin at its tip and up its body, hands back the FULL row (the jump needs it), and misses beside it", () => {
    const { h } = attach();
    const a = spot("a", { timeMs: 1_760_000_000_000, eyeM: 2.3, headingDeg: 215, pitchDeg: -4, fovDeg: 48 });
    const b = spot("b", { lonDeg: 35.0462 + 0.0015 }); // ~110 m east of a — inside the ±231 m the 60° lens sees from 400 m
    h.setPlaces([a, b]);
    const cam = cameraOver(a, 400);
    h.update(cam);
    // The tip is under the centre (the camera looks straight at a's anchor) — the SAME row object.
    const hit = h.pick(0, 0, cam);
    expect(hit).toBe(a);
    expect(hit).toMatchObject({ id: "a", timeMs: 1_760_000_000_000, eyeM: 2.3, headingDeg: 215, pitchDeg: -4, fovDeg: 48 });
    // The body: half the quad up the camera's screen-up from the anchor.
    const scale = h.scaleOf("a")!;
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const body = new THREE.Vector3(...anchor(a)).addScaledVector(camUp, 0.5 * scale).project(cam);
    expect(h.pick(body.x, body.y, cam)).toBe(a);
    // "b" sits where its anchor projects.
    const ndcB = new THREE.Vector3(...h.anchorOf("b")!).project(cam);
    expect(Math.abs(ndcB.x)).toBeLessThan(1);
    expect(Math.abs(ndcB.y)).toBeLessThan(1);
    expect(h.pick(ndcB.x, ndcB.y, cam)).toBe(b);
    // Empty sky beside them, and well below the tip (the quad does not extend down).
    expect(h.pick(0.95, 0.95, cam)).toBeNull();
    const below = new THREE.Vector3(...anchor(a)).addScaledVector(camUp, -0.5 * scale).project(cam);
    expect(h.pick(below.x, below.y, cam)).toBeNull();
    h.dispose();
  });

  it("resnap re-asks the terrain for a place that had no ground, moves its anchor, and invalidates the bounds", () => {
    let ground: number | null = null;
    const { h } = attach(() => ground);
    const a = spot("a");
    h.setPlaces([a]);
    const before = h.anchorOf("a")!;
    expect(before).toEqual(anchor(a, PLACEMARKS.fallbackGroundM)); // the fallback until tiles answer
    const cam = cameraOver(a, 400);
    h.update(cam);
    h.pick(0, 0, cam); // caches a sphere…
    expect(h.mesh.boundingSphere).not.toBeNull();
    h.resnap(); // nothing answered yet — nothing moves, nothing is invalidated
    expect(h.mesh.boundingSphere).not.toBeNull();
    ground = GROUND_M;
    h.resnap();
    expect(h.mesh.boundingSphere).toBeNull(); // …the anchors moved — the stale sphere must go
    const after = h.anchorOf("a")!;
    expect(after).not.toEqual(before);
    expect(after[0]).toBeCloseTo(anchor(a)[0], 6);
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBe(a);
    // Grounded places are not re-asked (the cheap low-cadence contract).
    let asks = 0;
    const { h: h2 } = attach(() => (asks++, GROUND_M));
    h2.setPlaces([a]);
    const asked = asks;
    h2.resnap();
    expect(asks).toBe(asked);
    h2.dispose();
    h.dispose();
  });

  it("a pick after rows changed but before a frame does not read a stale sphere", () => {
    const { h } = attach();
    const a = spot("a");
    const cam = cameraOver(a, 400);
    h.setPlaces([]);
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBeNull(); // the empty-sphere cache the trap is about
    h.setPlaces([a]);
    h.update(cam);
    expect(h.pick(0, 0, cam)).toBe(a);
    h.dispose();
  });
});

describe("placeMarkers — the orchestrator wiring + the shared glyph (source)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const ORCH = read("src/components/globe/StylizedTiles.ts");

  it("a click on a pin does the CLOCK first (timeMs → setTime, else goLive) and then the FULL-pose jump (the ruling 2026-10-22h)", () => {
    expect(ORCH).toMatch(/const jumpToPlace = \(p: PlaceListItem\): void => \{\s*const t = useTimeStore\.getState\(\);\s*if \(p\.timeMs !== null\) t\.setTime\(p\.timeMs\);\s*else t\.goLive\(\);\s*useCameraStore\.getState\(\)\.requestFpvJump\(\{/);
    expect(ORCH).toMatch(/requestFpvJump\(\{[^}]*latDeg: p\.latDeg,[^}]*lonDeg: p\.lonDeg,[^}]*eyeM: p\.eyeM,[^}]*headingDeg: p\.headingDeg,[^}]*pitchDeg: p\.pitchDeg,[^}]*fovDeg: p\.fovDeg,/s);
    // The pick hands the FULL row to the jump — no lat/lon-only spot type survives.
    expect(ORCH).toMatch(/const hit = placeMarkers\.pick\(ndcX, ndcY, camera\);\s*if \(!hit\) return false;\s*jumpToPlace\(hit\);/);
    expect(read("src/components/globe/scene/placeMarkers.ts")).toMatch(/export type PlaceMarkerSpot = PlaceListItem;/);
    expect(read("src/components/globe/scene/placeMarkers.ts")).not.toMatch(/mesh\.raycast = \(\) => \{\}/);
  });

  it("the orbit click rung sits BEFORE the facade pick, the FPV tap rung between the sky marker and the FIND ghost, the hover step before the facade hover", () => {
    const orbitRung = ORCH.indexOf("if (tryPlaceMarkerClick(ndcX, ndcY)) return;");
    // The orbit click's facade pick is the LAST one with these args (F6's `tryFacadePeekTap` picks the same way earlier).
    const facadePick = ORCH.lastIndexOf("const fid = facadeMarkers.pick(ndcX, ndcY, camera);");
    expect(orbitRung).toBeGreaterThan(0);
    expect(facadePick).toBeGreaterThan(orbitRung);
    expect(ORCH).toMatch(/!trySkyMarkerClick\(ndcX, ndcY\) && !tryPlaceMarkerClick\(ndcX, ndcY\) && !tryFacadePeekTap\(ndcX, ndcY\) && !tryFindGhostClick\(ndcX, ndcY\)/);
    expect(ORCH).toMatch(/stepPlaceHover\(\);\s*stepFacadeHover\(\);/);
    // The facade hover stands down while a pin is hovered; the pin hover leaves the cursor alone.
    expect(ORCH).toMatch(/fac\.menu === null && Number\.isFinite\(hoverX\) && placeHoverId === null/);
    expect((ORCH.match(/!skyHoverKind && placeHoverId === null\) dom\.style\.cursor = ""/g) ?? []).length).toBe(2);
    // The store subscription is identity-guarded (the store also writes `onMap` / `loaded`).
    expect(ORCH).toMatch(/if \(s\.places === _prevPlaces\) return;\s*_prevPlaces = s\.places;\s*placeMarkers\.setPlaces\(s\.places\);/);
    // The DEV seam the harness reads.
    expect(ORCH).toMatch(/places: \(\) => \(\{\s*markers: placeMarkers\.count\(\),\s*hovered: placeMarkers\.hovered\(\),/);
  });

  it("one glyph, four seats: the controls leaf's path is the camera panel's MY SPOT, the map window's re-centre and the /m MY LOC cell", () => {
    const glyph = read("src/components/controls/PinGlyph.tsx");
    const path = /export const PIN_GLYPH_PATH = "([^"]+)";/.exec(glyph)?.[1];
    expect(path).toBe("M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5 12.5s6.5-7.9 6.5-12.5A6.5 6.5 0 0 0 12 2.5z");
    expect(glyph).toMatch(/cx: 12, cy: 9, r: 2\.3/);
    expect(read("src/components/panels/CameraTiltPanel.tsx")).toContain(`d="${path}"`);
    expect(read("src/components/panels/MapWindow.tsx")).toContain(`d="${path}"`);
    expect(read("src/components/panels/MapWindow.tsx")).toMatch(/new Path2D\(PIN_GLYPH_PATH\)/); // the 2D map's places wear it too
    const sa = read("src/components/mobile/SceneActions.tsx");
    expect(sa).toMatch(/<PinGlyph className="m-myloc__icon" pinClassName="m-myloc__pin" dotClassName="m-myloc__dot" \/>/);
    expect(sa).not.toMatch(/"MY LOC"|LOCATING…" :/); // the words ride aria-label now (the docblock may still say MY LOCATION)
    // The GL marker draws the same anatomy on its canvas: the head's arcs at (12, 9) r 6.5, the dot r 2.3.
    const pm = read("src/components/globe/scene/placeMarkers.ts");
    expect(pm).toMatch(/ctx\.arc\(12, 9, 6\.5, -Math\.PI \/ 2, Math\.PI, true\)/);
    expect(pm).toMatch(/ctx\.arc\(12, 9, 2\.3, 0, Math\.PI \* 2\)/);
  });
});
