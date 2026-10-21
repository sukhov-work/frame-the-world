import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  attachPhotoProjector,
  projectorMatrix,
  projectorOptics,
} from "../../../src/components/globe/scene/photoProjector";
import { FRUSTUM, PHOTO_PROJECT } from "../../../src/components/globe/tuning";
import { verticalFovDeg } from "../../../src/lib/decode/sensors";
import { frustumGeometry, type FrustumGeometry } from "../../../src/lib/geo/frustum";
import type { Vec3 } from "../../../src/lib/geo/projection";

/**
 * photoProjector (the photo flow (b), 2026-10-18 — PHOTO_PROJECT): the projector camera is built from
 * the SAME frustum geometry the placed-photo wireframe draws, so the projected rectangle IS the drawn
 * plane. Pinned here: the optics round-trip frustumGeometry, the far-face corners land on the uv
 * corners, and the RTC claim (view-space route is float32-safe at ECEF, the world-space one is not)
 * is machine-checked rather than asserted in a comment.
 */

type Pose = { pitch: number; roll: number; hFov: number; aspect: number; alt: number };
const POSES: Pose[] = [
  { pitch: 0, roll: 0, hFov: 73.7, aspect: 1.5, alt: 1.7 },
  { pitch: -16, roll: 7, hFov: 45, aspect: 1.333, alt: 96 },
  { pitch: 30, roll: 0, hFov: 120, aspect: 0.75, alt: 1.7 }, // portrait
  { pitch: -16, roll: 0, hFov: 73.7, aspect: 0.75, alt: 96 },
  { pitch: 30, roll: 7, hFov: 45, aspect: 1.5, alt: 96 },
];
const geomFor = (p: Pose): FrustumGeometry =>
  frustumGeometry({
    latDeg: 48.4647, // the gps-heading fixture pose (Dnipro)
    lonDeg: 35.0462,
    altM: p.alt,
    headingDeg: 214,
    pitchDeg: p.pitch,
    rollDeg: p.roll,
    hFovDeg: p.hFov,
    vFovDeg: verticalFovDeg(p.hFov, p.aspect),
    planeDistM: FRUSTUM.planeDistM,
  });
const label = (p: Pose) => `pitch ${p.pitch} roll ${p.roll} hFov ${p.hFov} aspect ${p.aspect} alt ${p.alt}`;

/** M × [p, 1] in float64 → [x, y, z, w]. */
const apply4 = (m: ArrayLike<number>, p: Vec3): [number, number, number, number] => {
  const e = m; // column-major
  return [
    e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12],
    e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13],
    e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14],
    e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15],
  ];
};
/** The same product with every operand and every partial result rounded to float32 — a GPU `mat4 * vec4`. */
const apply4f32 = (m: ArrayLike<number>, p: Vec3): [number, number, number, number] => {
  const r = Math.fround;
  const q = [r(p[0]), r(p[1]), r(p[2])];
  const row = (i: number) =>
    r(r(r(r(r(m[i]) * q[0]) + r(r(m[i + 4]) * q[1])) + r(r(m[i + 8]) * q[2])) + r(m[i + 12]));
  return [row(0), row(1), row(2), row(3)];
};
const uvOf = (c: [number, number, number, number]) => [c[0] / c[3], c[1] / c[3], c[2] / c[3]];

describe("projectorOptics — round-trips frustumGeometry (the photo flow (b), 2026-10-18)", () => {
  for (const p of POSES) {
    it(`recovers vFov, aspect and the plane distance (${label(p)})`, () => {
      const o = projectorOptics(geomFor(p));
      expect(Math.abs(o.vFovDeg - verticalFovDeg(p.hFov, p.aspect))).toBeLessThan(1e-6);
      expect(Math.abs(o.aspect - p.aspect)).toBeLessThan(1e-9);
      expect(Math.abs(o.planeDistM - FRUSTUM.planeDistM)).toBeLessThan(1e-6);
    });
  }
});

describe("projectorMatrix — the far-face corners land on the uv corners (the photo flow (b), 2026-10-18)", () => {
  const n = PHOTO_PROJECT.nearM;
  const f = PHOTO_PROJECT.farM;
  const d = FRUSTUM.planeDistM;
  // GL perspective at eye z = −d: ndc z = (f+n)/(f−n) − 2fn / ((f−n)·d), then the [0,1] bias.
  const z01 = ((f + n) / (f - n) - (2 * f * n) / ((f - n) * d)) * 0.5 + 0.5;
  const UV = [
    [0, 1], // TL
    [1, 1], // TR
    [1, 0], // BR
    [0, 0], // BL
  ];
  for (const p of POSES) {
    it(`TL→(0,1) TR→(1,1) BR→(1,0) BL→(0,0), all at the plane's window depth (${label(p)})`, () => {
      const g = geomFor(p);
      const m = projectorMatrix(g, n, f).elements;
      g.corners.forEach((c, i) => {
        const [u, v, z] = uvOf(apply4(m, c));
        expect(Math.abs(u - UV[i][0]), `corner ${i} u=${u}`).toBeLessThan(1e-6);
        expect(Math.abs(v - UV[i][1]), `corner ${i} v=${v}`).toBeLessThan(1e-6);
        expect(Math.abs(z - z01), `corner ${i} z=${z} want ${z01}`).toBeLessThan(1e-6);
      });
      expect(z01).toBeGreaterThan(0);
      expect(z01).toBeLessThan(1);
    });

    it(`w is the projector's eye depth: apex → 0, 10 m ahead → (0.5, 0.5) at w 10, 10 m behind → w −10 (${label(p)})`, () => {
      const g = geomFor(p);
      const m = projectorMatrix(g, n, f).elements;
      const at = (k: number): Vec3 => [g.apex[0] + k * g.forward[0], g.apex[1] + k * g.forward[1], g.apex[2] + k * g.forward[2]];
      expect(Math.abs(apply4(m, g.apex)[3])).toBeLessThan(1e-6);
      const ahead = apply4(m, at(10));
      expect(Math.abs(ahead[3] - 10)).toBeLessThan(1e-6);
      const [u, v] = uvOf(ahead);
      expect(Math.abs(u - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(v - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(apply4(m, at(-10))[3] + 10)).toBeLessThan(1e-6);
    });
  }
});

describe("the RTC claim — the view-space route is float32-safe at ECEF, the world-space one is not (2026-10-18)", () => {
  const g = geomFor(POSES[0]);
  const projVP = projectorMatrix(g, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM);
  const avg = (k: number) => (g.corners[0][k] + g.corners[1][k] + g.corners[2][k] + g.corners[3][k]) / 4;
  const centre: Vec3 = [avg(0), avg(1), avg(2)];
  // the viewer: 200 m from the apex (behind-left and above), looking at the far-face centre
  const off = new THREE.Vector3(...g.forward).multiplyScalar(-150)
    .add(new THREE.Vector3(...g.right).multiplyScalar(-120))
    .add(new THREE.Vector3(...g.up).multiplyScalar(40))
    .setLength(200);
  const camera = new THREE.PerspectiveCamera(50, 1.5, 1, 1e5);
  camera.position.set(g.apex[0], g.apex[1], g.apex[2]).add(off);
  camera.up.set(...g.up);
  camera.lookAt(...centre);
  camera.updateMatrixWorld(true);
  const A = new THREE.Matrix4().multiplyMatrices(projVP, camera.matrixWorld).elements;
  const toView = (c: Vec3): Vec3 => new THREE.Vector3(...c).applyMatrix4(camera.matrixWorldInverse).toArray() as Vec3;
  const UV = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  const errOf = (uvs: number[][]) => Math.max(...uvs.map((uv, i) => Math.hypot(uv[0] - UV[i][0], uv[1] - UV[i][1])));

  it("in float64 the view-space route equals the direct world-space one (1e-6 uv)", () => {
    expect(camera.position.distanceTo(new THREE.Vector3(...g.apex))).toBeCloseTo(200, 6);
    g.corners.forEach((c) => {
      const viaView = uvOf(apply4(A, toView(c)));
      const direct = uvOf(apply4(projVP.elements, c));
      expect(Math.abs(viaView[0] - direct[0])).toBeLessThan(1e-6);
      expect(Math.abs(viaView[1] - direct[1])).toBeLessThan(1e-6);
    });
  });

  it("in float32 the view-space error stays < 1e-4 uv while the ECEF world-space error exceeds it", () => {
    const viewErr = errOf(g.corners.map((c) => uvOf(apply4f32(A, toView(c)))));
    const worldErr = errOf(g.corners.map((c) => uvOf(apply4f32(projVP.elements, c))));
    const msg = `view-space float32 uv error ${viewErr.toExponential(3)} · world-space ${worldErr.toExponential(3)}`;
    expect(viewErr, msg).toBeLessThan(1e-4);
    expect(worldErr, msg).toBeGreaterThan(1e-4);
    expect(worldErr / Math.max(viewErr, 1e-12), msg).toBeGreaterThan(10);
  });
});

describe("attachPhotoProjector — the feed defaults (constructs without GL; the photo flow (b), 2026-10-18)", () => {
  const stubRenderer = { capabilities: { getMaxAnisotropy: () => 16 } } as unknown as THREE.WebGLRenderer;
  const attach = () => attachPhotoProjector(new THREE.Scene(), { renderer: stubRenderer, osmClipPlanes: null });

  it("starts off, with PHOTO_PROJECT defaults and no textures", () => {
    const h = attach();
    expect(h.feed.on).toBe(false);
    expect(h.feed.map).toBeNull();
    expect(h.feed.depth).toBeNull();
    expect(h.feed.k.toArray()).toEqual([PHOTO_PROJECT.strength, PHOTO_PROJECT.ownLight, 0, PHOTO_PROJECT.gain]);
    expect(h.feed.depthP.toArray()).toEqual([PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM, PHOTO_PROJECT.depthBiasM, PHOTO_PROJECT.depthBiasPerM]);
    expect(h.feed.facing.toArray()).toEqual([PHOTO_PROJECT.facingLo, PHOTO_PROJECT.facingHi, PHOTO_PROJECT.edgeFeather, PHOTO_PROJECT.rangeM]);
    const s = h.snapshot();
    expect(s).toMatchObject({ on: false, enabled: true, url: null, textureReady: false, textureSize: null, flipV: 0, depthRenders: 0, error: null });
    expect(s.depthSize).toEqual([PHOTO_PROJECT.depthMapPx, PHOTO_PROJECT.depthMapPx]);
    expect(s.strength).toBe(PHOTO_PROJECT.strength);
    expect(s.ownLight).toBe(PHOTO_PROJECT.ownLight);
    h.dispose();
  });

  it("setSource clamps strength and ownLight to [0, 1] (no url → no fetch)", () => {
    const h = attach();
    h.setSource({ url: null, enabled: true, strength: 1.7, ownLight: -0.3 });
    expect(h.feed.k.x).toBe(1);
    expect(h.feed.k.y).toBe(0);
    h.setSource({ url: null, enabled: true, strength: 0.42, ownLight: 0.9 });
    expect(h.feed.k.x).toBe(0.42);
    expect(h.feed.k.y).toBe(0.9);
    h.dispose();
  });

  it("update(null) — and a placed pose with no photo yet — leaves the feed off and renders no depth", () => {
    const h = attach();
    h.update(null, 0);
    expect(h.feed.on).toBe(false);
    h.update(geomFor(POSES[0]), 16); // no texture → no pass (a render here would throw on the stub)
    expect(h.feed.on).toBe(false);
    expect(h.snapshot().depthRenders).toBe(0);
    h.dispose();
  });
});
