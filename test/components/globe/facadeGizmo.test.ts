import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { frustumGeometry } from "../../../src/lib/geo/frustum";
import { dot, enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";
import { offsetGeodetic } from "../../../src/lib/models/modelPlacement";
import type { FacadeDragStart, FacadePoseWrite } from "../../../src/lib/globe/facadePose";
import {
  attachFacadeGizmo,
  type FacadeGizmoPose,
} from "../../../src/components/globe/scene/facadeGizmo";

// FACADE F1 (2026-10-21) — the scene module driven headlessly (real three objects, no renderer —
// the userModels precedent): the SIGN PIN against `frustumGeometry`, scene membership, the
// re-seat, the ORBIT raycast guard (negative + the positive control), three end-to-end drags
// through the fed-pointer API (move / rotate / scale), cancel, and disposal.

const LAT = 48.46;
const LON = 35.04;
const GROUND = 100;
const ABOVE = 30;
const APEX = geodeticToEcef(LAT, LON, GROUND + ABOVE);

const poseAt = (over: Partial<FacadeGizmoPose> = {}): FacadeGizmoPose => ({
  apex: APEX,
  lat: LAT,
  lon: LON,
  aboveGroundM: ABOVE,
  headingDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 60,
  ...over,
});

/** A camera 50 m south + 40 m above the apex looking at it, ENU up — east is screen-right. */
const makeCamera = () => {
  const b = enuBasis(LAT, LON);
  const cam = new THREE.PerspectiveCamera(60, 4 / 3, 1, 100_000);
  const apex = new THREE.Vector3(APEX[0], APEX[1], APEX[2]);
  const up = new THREE.Vector3(b.up[0], b.up[1], b.up[2]);
  const north = new THREE.Vector3(b.north[0], b.north[1], b.north[2]);
  cam.position.copy(apex).addScaledVector(north, -50).addScaledVector(up, 40);
  cam.up.copy(up);
  cam.lookAt(apex);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
};

const RECT = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
const toNdc = (p: { x: number; y: number }) => ({
  x: ((p.x - RECT.left) / RECT.width) * 2 - 1,
  y: -(((p.y - RECT.top) / RECT.height) * 2 - 1),
});

const harness = () => {
  const scene = new THREE.Scene();
  const camera = makeCamera();
  const changes: FacadePoseWrite[] = [];
  const commits: Array<{ write: FacadePoseWrite | null; start: FacadeDragStart }> = [];
  const g = attachFacadeGizmo(scene, camera, {
    onChange: (w) => changes.push(w),
    onCommit: (w, s) => commits.push({ write: w, start: s }),
  });
  return { scene, camera, g, changes, commits };
};

const isUnder = (o: THREE.Object3D, root: THREE.Object3D) => {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p === root) return true;
    p = p.parent;
  }
  return false;
};

type Axes = { forward: number[]; up: number[]; right: number[] };
const axesOf = (g: ReturnType<typeof attachFacadeGizmo>) => g.debug().bodyAxes as Axes;
const v3 = (a: number[]) => [a[0], a[1], a[2]] as const;

describe("the SIGN PIN — the rig body's −Z / +Y / +X are the frustum's forward / up / right", () => {
  const triples: Array<[number, number, number]> = [
    [0, 0, 0],
    [90, 0, 0],
    [200, 20, 0],
    [45, -10, 15],
    [315, 30, -20],
  ];
  for (const [h, p, r] of triples) {
    it(`heading ${h} / pitch ${p} / roll ${r}`, () => {
      const { g } = harness();
      g.setPose(poseAt({ headingDeg: h, pitchDeg: p, rollDeg: r }));
      const ax = axesOf(g);
      const f = frustumGeometry({
        latDeg: LAT,
        lonDeg: LON,
        altM: GROUND + ABOVE,
        headingDeg: h,
        pitchDeg: p,
        rollDeg: r,
        hFovDeg: 60,
        vFovDeg: 40,
        planeDistM: 10,
      });
      expect(dot(v3(ax.forward), f.forward)).toBeGreaterThan(0.999999);
      expect(dot(v3(ax.up), f.up)).toBeGreaterThan(0.999999);
      expect(dot(v3(ax.right), f.right)).toBeGreaterThan(0.999999);
      const fp = g.debug().framePos as number[];
      expect(fp[0]).toBeCloseTo(f.apex[0], 6);
      expect(fp[1]).toBeCloseTo(f.apex[1], 6);
      expect(fp[2]).toBeCloseTo(f.apex[2], 6);
      g.dispose();
    });
  }
  it("POSITIVE CONTROL: a heading with the wrong sign does NOT match", () => {
    const { g } = harness();
    g.setPose(poseAt({ headingDeg: 90 }));
    const f = frustumGeometry({ latDeg: LAT, lonDeg: LON, altM: GROUND + ABOVE, headingDeg: -90, hFovDeg: 60, vFovDeg: 40, planeDistM: 10 });
    expect(dot(v3(axesOf(g).forward), f.forward)).toBeLessThan(-0.999);
    g.dispose();
  });
});

describe("scene membership — the rig + the helper are scene children exactly while attached", () => {
  it("setPose alone attaches nothing; setOp attaches; none / a null pose detach", () => {
    const { scene, g } = harness();
    expect(scene.children.length).toBe(0);
    g.setPose(poseAt());
    expect(g.attached).toBe(false);
    expect(g.inScene).toBe(false);
    expect(scene.children.length).toBe(0);

    g.setOp("move");
    expect(g.op).toBe("move");
    expect(g.attached).toBe(true);
    expect(g.inScene).toBe(true);
    expect(scene.children).toContain(g.helperRoot());
    expect(scene.children.some((c) => c.name === "facadeGizmoFrame")).toBe(true);

    g.setOp("rotate");
    expect(g.attached).toBe(true);
    expect(g.inScene).toBe(true);

    g.setOp("none");
    expect(g.attached).toBe(false);
    expect(g.inScene).toBe(false);
    expect(scene.children.length).toBe(0);

    g.setOp("scale");
    expect(g.attached).toBe(true);
    g.setPose(null);
    expect(g.attached).toBe(false);
    expect(scene.children.length).toBe(0);
    // The op is remembered: a pose coming back re-attaches without a second setOp.
    g.setPose(poseAt());
    expect(g.attached).toBe(true);
    expect(g.op).toBe("scale");
    g.dispose();
  });

  it("setPose re-seats the frame at the new apex with the anchor at rest and the body at scale 1", () => {
    const { g } = harness();
    g.setOp("move");
    g.setPose(poseAt());
    const moved = offsetGeodetic(LAT, LON, 20, 0);
    const apex2 = geodeticToEcef(moved.latDeg, moved.lonDeg, GROUND + ABOVE);
    g.setPose(poseAt({ apex: apex2, lat: moved.latDeg, lon: moved.lonDeg, headingDeg: 30 }));
    const d = g.debug();
    expect(d.framePos).toEqual([apex2[0], apex2[1], apex2[2]]);
    expect(d.anchorPos).toEqual([0, 0, 0]);
    expect(d.bodyScale).toEqual([1, 1, 1]);
    expect(dot(v3((d.bodyAxes as Axes).forward), frustumGeometry({ latDeg: moved.latDeg, lonDeg: moved.lonDeg, altM: GROUND + ABOVE, headingDeg: 30, hFovDeg: 60, vFovDeg: 40, planeDistM: 10 }).forward)).toBeGreaterThan(0.999999);
    g.dispose();
  });
});

describe("the ORBIT trap — guardRaycast: the attached plane + pickers are invisible to a scene-wide ray", () => {
  const rayToApex = (camera: THREE.PerspectiveCamera) => {
    const rc = new THREE.Raycaster();
    const dir = new THREE.Vector3(APEX[0], APEX[1], APEX[2]).sub(camera.position).normalize();
    rc.set(camera.position.clone(), dir);
    return rc;
  };
  for (const op of ["move", "rotate", "scale"] as const) {
    it(`${op}: no helper hit outside feeding; the POSITIVE CONTROL (feeding forced) hits`, () => {
      const { scene, camera, g } = harness();
      g.setPose(poseAt());
      g.setOp(op);
      expect(g.inScene).toBe(true);
      const rc = rayToApex(camera);
      const hitsOff = rc.intersectObject(scene, true).filter((h) => isUnder(h.object, g.helperRoot()));
      expect(hitsOff.length).toBe(0);
      g._setFeeding(true);
      const hitsOn = rc.intersectObject(scene, true).filter((h) => isUnder(h.object, g.helperRoot()));
      expect(hitsOn.length).toBeGreaterThan(0);
      g._setFeeding(false);
      expect(rc.intersectObject(scene, true).filter((h) => isUnder(h.object, g.helperRoot())).length).toBe(0);
      g.dispose();
    });
  }
  it("…and the module's own hover still sees the handles (the gate opens around a fed pointer)", () => {
    const { g } = harness();
    g.setPose(poseAt());
    g.setOp("move");
    const px = g.handleScreenPx("X", RECT);
    expect(px).not.toBeNull();
    const ndc = toNdc(px!);
    expect(g.hover(ndc.x, ndc.y)).toBe(true);
    expect(g.axis).toBe("X");
    expect(g.hover(0.95, 0.95)).toBe(false); // the corner of the screen — nothing there
    expect(g.axis).toBeNull();
    g.dispose();
  });
});

describe("end-to-end drags through the fed-pointer API", () => {
  it("MOVE along the X arrow: the write is a placement east of the start, the rest untouched", () => {
    const { g, changes, commits } = harness();
    g.setPose(poseAt());
    g.setOp("move");
    const ndc = toNdc(g.handleScreenPx("X", RECT)!);
    expect(g.hover(ndc.x, ndc.y)).toBe(true);
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    expect(g.dragging).toBe(true);
    expect(g.axis).toBe("X");
    // A pose pushed mid-drag is ignored — the drag owns the rig.
    g.setPose(poseAt({ headingDeg: 90 }));
    expect((g.debug().pose as FacadeGizmoPose).headingDeg).toBe(0);
    g.move(ndc.x + 0.05, ndc.y, false);
    expect(changes.length).toBeGreaterThan(0);
    const w = changes[changes.length - 1];
    expect(w.lon).toBeGreaterThan(LON);
    expect(w.lat).toBe(LAT);
    expect(w.altitudeM).toBe(ABOVE);
    expect(w.headingDeg).toBe(0);
    expect(w.pitchDeg).toBe(0);
    expect(w.rollDeg).toBe(0);
    expect(w.hFovDeg).toBe(60);
    // The handle trails the pointer at the GAINED value: the rig's anchor is the metres the
    // write moved — the same offsetGeodetic answer.
    const anchorPos = g.debug().anchorPos as number[];
    expect(anchorPos[0]).toBeGreaterThan(0);
    expect(anchorPos[1]).toBe(0);
    expect(anchorPos[2]).toBe(0);
    expect(w.lon).toBe(offsetGeodetic(LAT, LON, anchorPos[0], 0).lonDeg);
    // Less sensitive: three's raw position is the anchor's / gain — i.e. the raw drag was twice
    // the metres written (gain 0.5), and three's start stays at the origin (absolute from start).
    const dbg = g.debug();
    expect((dbg.positionStart as number[])[0]).toBe(0);
    const out = g.up();
    expect(out).toEqual(w);
    expect(g.dragging).toBe(false);
    expect(commits.length).toBe(1);
    expect(commits[0].write).toEqual(w);
    expect(commits[0].start).toEqual({ lat: LAT, lon: LON, aboveGroundM: ABOVE, headingDeg: 0, pitchDeg: 0, rollDeg: 0, hFovDeg: 60 });
    // The next setPose re-seats the rig at rest.
    g.setPose(poseAt({ lat: w.lat, lon: w.lon, apex: geodeticToEcef(w.lat, w.lon, GROUND + ABOVE) }));
    expect(g.debug().anchorPos).toEqual([0, 0, 0]);
    g.dispose();
  });

  it("MOVE along the Y arrow: the altitude as metres above the ground, from the press-time height", () => {
    const { g, changes } = harness();
    g.setPose(poseAt());
    g.setOp("move");
    // The hover-search idiom (the harness's): three's translate picker has a part on EACH side of
    // the axis and `handleScreenPx` reports the first — walk screen-UP from the origin until the
    // hover answers Y (the +Y part; the −Y part's line of sight crosses the Z picker).
    const origin = g.originPx(RECT)!;
    let ndc = toNdc(origin);
    let found = false;
    for (let dy = 2; dy <= 120 && !found; dy += 2) {
      ndc = toNdc({ x: origin.x, y: origin.y - dy });
      found = g.hover(ndc.x, ndc.y) && g.axis === "Y";
    }
    expect(found).toBe(true);
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    g.move(ndc.x, ndc.y + 0.05, false); // screen-up = world-up from a camera above-south
    const w = changes[changes.length - 1];
    expect(w.altitudeM).toBeGreaterThan(ABOVE);
    expect(w.altitudeM).toBeLessThanOrEqual(60);
    expect(w.lat).toBe(LAT);
    expect(w.lon).toBe(LON);
    // Far past the rail — the FLOOR (the ceiling needs a 60 m raw lift at gain 0.5, which this
    // camera's 30° half-FOV cannot reach on the vertical drag plane; a −0.9 NDC ray lands ~70 m
    // below the apex). The write is the ground, and the handle stops there (anchor Y = 0 − 30).
    g.move(ndc.x, ndc.y - 0.9, false);
    const floor = changes[changes.length - 1];
    expect(floor.altitudeM).toBe(0);
    expect((g.debug().anchorPos as number[])[1]).toBeCloseTo(-30, 9);
    g.up();
    g.dispose();
  });

  it("ROTATE on the Y ring of a pitched body: the heading changes, pitch and roll do not leak", () => {
    const { g, changes, commits } = harness();
    g.setPose(poseAt({ headingDeg: 0, pitchDeg: 20 }));
    g.setOp("rotate");
    // The hover-search idiom: three rings overlap on screen — take the first Y-ring point that
    // hovers as Y.
    const pts = g.ringPx("Y", RECT, 48);
    expect(pts.length).toBeGreaterThan(8);
    let i0 = -1;
    for (let i = 0; i < pts.length; i++) {
      const n = toNdc(pts[i]);
      if (g.hover(n.x, n.y) && g.axis === "Y") {
        i0 = i;
        break;
      }
    }
    expect(i0).toBeGreaterThanOrEqual(0);
    const a = toNdc(pts[i0]);
    expect(g.down(a.x, a.y)).toBe(true);
    expect(g.axis).toBe("Y");
    g.move(a.x + 0.06, a.y + 0.02, false);
    expect(changes.length).toBeGreaterThan(0);
    const w = changes[changes.length - 1];
    expect(w.headingDeg).not.toBe(0);
    expect(w.headingDeg).toBeGreaterThanOrEqual(0);
    expect(w.headingDeg).toBeLessThan(360);
    expect(Math.abs(w.pitchDeg - 20)).toBeLessThan(1e-6);
    expect(Math.abs(w.rollDeg)).toBeLessThan(1e-6);
    expect(w.lat).toBe(LAT);
    expect(w.lon).toBe(LON);
    expect(w.hFovDeg).toBe(60);
    expect(g.up()).toEqual(w);
    expect(commits[0].write).toEqual(w);
    g.dispose();
  });

  it("SCALE on an axis box: the H-FOV widens, the rig is scaled UNIFORMLY, nothing else moves", () => {
    const { g, changes } = harness();
    g.setPose(poseAt());
    g.setOp("scale");
    const px = g.handleScreenPx("X", RECT)!;
    const ndc = toNdc(px);
    expect(g.hover(ndc.x, ndc.y)).toBe(true);
    expect(g.axis).toBe("X");
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    // three's scale picker has a box on EACH side of the axis; "outward" is away from the origin
    // on whichever side `handleScreenPx` reported (a drag across the origin flips three's ratio
    // negative, which the law holds at the start FOV).
    const sgn = Math.sign(px.x - g.originPx(RECT)!.x) || 1;
    g.move(ndc.x + sgn * 0.1, ndc.y, false); // outward: the ratio > 1
    const w = changes[changes.length - 1];
    expect(w.hFovDeg).toBeGreaterThan(60);
    expect(w.hFovDeg).toBeLessThanOrEqual(120);
    expect(w.lat).toBe(LAT);
    expect(w.lon).toBe(LON);
    expect(w.headingDeg).toBe(0);
    expect(w.altitudeM).toBe(ABOVE);
    const s = g.debug().bodyScale as number[];
    expect(s[0]).toBeGreaterThan(1);
    expect(s[1]).toBeCloseTo(s[0], 12);
    expect(s[2]).toBeCloseTo(s[0], 12);
    // Inward: narrower than the start.
    g.move(ndc.x - sgn * 0.04, ndc.y, false);
    expect(changes[changes.length - 1].hFovDeg).toBeLessThan(60);
    g.up();
    g.dispose();
  });

  it("cancel: the rig snaps back to the start and the commit is null with the start", () => {
    const { g, changes, commits } = harness();
    g.setPose(poseAt());
    g.setOp("move");
    const ndc = toNdc(g.handleScreenPx("X", RECT)!);
    g.hover(ndc.x, ndc.y);
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    g.move(ndc.x + 0.05, ndc.y, false);
    expect(changes.length).toBeGreaterThan(0);
    expect((g.debug().anchorPos as number[])[0]).toBeGreaterThan(0);
    g.cancel();
    expect(g.dragging).toBe(false);
    expect(g.debug().anchorPos).toEqual([0, 0, 0]);
    expect(commits).toEqual([{ write: null, start: { lat: LAT, lon: LON, aboveGroundM: ABOVE, headingDeg: 0, pitchDeg: 0, rollDeg: 0, hFovDeg: 60 } }]);
    g.dispose();
  });

  it("an unmoved release commits null; a press off every handle claims nothing", () => {
    const { g, changes, commits } = harness();
    g.setPose(poseAt());
    g.setOp("move");
    expect(g.down(0.95, 0.95)).toBe(false);
    expect(g.dragging).toBe(false);
    const ndc = toNdc(g.handleScreenPx("X", RECT)!);
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    expect(g.up()).toBeNull();
    expect(changes.length).toBe(0);
    expect(commits.length).toBe(1);
    expect(commits[0].write).toBeNull();
    g.dispose();
  });

  it("setOp / setPose are refused under a live drag; down is refused unarmed", () => {
    const { g } = harness();
    expect(g.down(0, 0)).toBe(false);
    g.setPose(poseAt());
    expect(g.down(0, 0)).toBe(false); // op none
    g.setOp("move");
    const ndc = toNdc(g.handleScreenPx("X", RECT)!);
    expect(g.down(ndc.x, ndc.y)).toBe(true);
    g.setOp("rotate");
    expect(g.op).toBe("move");
    expect(g.attached).toBe(true);
    g.up();
    g.setOp("rotate");
    expect(g.op).toBe("rotate");
    g.dispose();
  });
});

describe("dispose leaves the scene clean", () => {
  it("mid-attach dispose removes the helper and the rig; nothing is attached", () => {
    const { scene, g } = harness();
    g.setPose(poseAt());
    g.setOp("rotate");
    expect(scene.children.length).toBe(2);
    g.dispose();
    expect(scene.children.length).toBe(0);
    expect(g.attached).toBe(false);
    expect(g.inScene).toBe(false);
    expect(g.op).toBe("none");
  });
});
