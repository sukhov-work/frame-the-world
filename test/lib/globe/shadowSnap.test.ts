import { describe, expect, it } from "vitest";
import { cascadeNeedsRender, texelSizeM } from "../../../src/lib/globe/shadowCascade";
import {
  keySwingQuantumRad,
  rigDemandDriven,
  rigUpDegenerate,
  snapCentreDelta,
  swingTexels,
  type Vec3,
} from "../../../src/lib/globe/shadowSnap";
import { SHADOWS, ULTRA, WGS84_A } from "../../../src/components/globe/tuning";

/**
 * T77 slice A2 (2026-09-06) — the shimmer measurement's arithmetic half.
 *
 * The property under test is the one the measurement is actually about: WHERE THE TEXEL GRID
 * LANDS. `MEASUREMENTS_2026-09-05.md` §8 shows 8–19 % of the shadow mask flipping every frame at a
 * FROZEN camera, 62–75 % of it isolated pixels, while the true shadow edge moves ~0.0009 texel —
 * so what is being re-rasterised is an unchanged scene from a moving sub-texel offset. These tests
 * pin the two things that stop it: a grid that lands on the same world-anchored lattice every
 * time, and a swing quantum that is honestly worth the texels it claims.
 *
 * Everything runs at ECEF magnitudes (|p| ≈ 6.4e6 m) ON PURPOSE. That is the regime the fix exists
 * for — float32's ULP there is 0.5 m, i.e. ~0.2 of a 2.44 m texel, which is the same order as the
 * artefact — so a test at unit scale would pass while proving nothing about the shipped rig.
 */

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * three's basis, re-derived here INDEPENDENTLY of the module under test — `Matrix4.lookAt(eye,
 * target, up)` as `Object3D.lookAt` calls it from `LightShadow.updateMatrices`. If the module ever
 * builds a different frame from three's, these tests go red, which is the point: a snap onto the
 * wrong lattice is worse than no snap (it moves the map without stabilising it).
 */
function lookAtBasis(lightPos: Vec3, target: Vec3, up: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = norm(sub(lightPos, target));
  const x = norm(cross(up, z));
  return { x, y: cross(z, x), z };
}

/** ECEF up (the +Y three's OrthographicCamera is constructed with) — the shipped rig's `up`. */
const ECEF_Y: Vec3 = [0, 1, 0];
/** A Dnipro-ish ground point at |p| = WGS84_A, so every projection carries the real magnitudes. */
const FOCUS: Vec3 = scale(norm([0.5772, 0.4046, 0.7093]), WGS84_A);
/** A mid-afternoon key direction, deliberately not aligned with any axis. */
const KEY: Vec3 = norm([0.3117, -0.4988, 0.8085]);

const rig = (halfM: number, distM: number, key: Vec3 = KEY) => ({
  lightPos: add(FOCUS, scale(key, distM)),
  target: FOCUS,
  halfM,
});

/** The ladder the shipped profiles actually span: base 4096², ULTRA 8192², both boxes. */
const LADDER: Array<{ name: string; halfM: number; mapPx: number; distM: number }> = [
  { name: "base street", halfM: SHADOWS.boundsM, mapPx: SHADOWS.mapSize, distM: SHADOWS.lightDistM },
  { name: "base capped", halfM: SHADOWS.maxBoundsM, mapPx: SHADOWS.mapSize, distM: SHADOWS.lightDistM },
  { name: "ultra city", halfM: 13_760, mapPx: ULTRA.shadowMapSize, distM: ULTRA.lightDistM },
  { name: "ultra capped", halfM: ULTRA.maxBoundsM, mapPx: ULTRA.shadowMapSize, distM: ULTRA.lightDistM },
];

describe("snapCentreDelta — the light-plane texel lattice, in float64 at ECEF scale", () => {
  it("lands the light's in-plane projection on integer multiples of the texel width", () => {
    for (const L of LADDER) {
      const { lightPos, target, halfM } = rig(L.halfM, L.distM);
      const d = snapCentreDelta(lightPos, target, ECEF_Y, halfM, L.mapPx);
      const snapped = add(lightPos, d);
      // The basis is unchanged by a JOINT move, so it may be taken before or after.
      const b = lookAtBasis(lightPos, target, ECEF_Y);
      const w = texelSizeM(halfM, L.mapPx);
      for (const axis of [b.x, b.y] as const) {
        const k = dot(snapped, axis) / w;
        // The tolerance is stated in float64 ULPs at the ellipsoid radius (1 ULP ≈ 1.42e-9 m),
        // because that is what actually bounds it: reconstructing `lightPos + Δ` and re-projecting
        // costs a couple of roundings and the measured worst case over this ladder is 1.2 ULP.
        // Still ~4×10⁸ finer than the 0.5 m float32 ULP the artefact lives in, which is the whole
        // reason the snap is done here in JS numbers rather than in a shader.
        expect(Math.abs(k - Math.round(k)) * w, `${L.name} residual`).toBeLessThan(
          4 * Number.EPSILON * WGS84_A,
        );
      }
    }
  });

  it("is PURELY IN-PLANE: Δ·ẑ is zero, so a joint move cannot rotate the key", () => {
    for (const L of LADDER) {
      const { lightPos, target, halfM } = rig(L.halfM, L.distM);
      const d = snapCentreDelta(lightPos, target, ECEF_Y, halfM, L.mapPx);
      const b = lookAtBasis(lightPos, target, ECEF_Y);
      expect(Math.abs(dot(d, b.z)), `${L.name}`).toBeLessThan(1e-9);
      // …and therefore the light→target distance survives the snap, which is what lets the caller
      // keep the near/far it derived from that distance one block earlier.
      const before = Math.hypot(...sub(lightPos, target));
      const after = Math.hypot(...sub(add(lightPos, d), add(target, d)));
      expect(Math.abs(after - before)).toBeLessThan(1e-9);
    }
  });

  it("is IDEMPOTENT — snapping an already-snapped rig moves it nowhere", () => {
    for (const L of LADDER) {
      const { lightPos, target, halfM } = rig(L.halfM, L.distM);
      const d1 = snapCentreDelta(lightPos, target, ECEF_Y, halfM, L.mapPx);
      const d2 = snapCentreDelta(add(lightPos, d1), add(target, d1), ECEF_Y, halfM, L.mapPx);
      expect(Math.hypot(...d2), `${L.name}`).toBeLessThan(1e-9);
    }
  });

  it("a translation by exactly k texels leaves the lattice invariant (the whole point)", () => {
    // This is the property the centre snap exists to deliver: walking the box by whole texels must
    // not change the offset the map is rasterised from. Move light AND target together (so the
    // basis is identical) by an integer number of texels along each in-plane axis.
    for (const L of LADDER) {
      const { lightPos, target, halfM } = rig(L.halfM, L.distM);
      const b = lookAtBasis(lightPos, target, ECEF_Y);
      const w = texelSizeM(halfM, L.mapPx);
      const d0 = snapCentreDelta(lightPos, target, ECEF_Y, halfM, L.mapPx);
      for (const k of [1, 7, -13, 1_000]) {
        const shift = add(scale(b.x, k * w), scale(b.y, -k * w));
        const d1 = snapCentreDelta(add(lightPos, shift), add(target, shift), ECEF_Y, halfM, L.mapPx);
        expect(Math.hypot(...sub(d1, d0)), `${L.name} k=${k}`).toBeLessThan(1e-9);
      }
    }
  });

  it("a DEGENERATE up returns a zero delta rather than a sign-flipping basis", () => {
    // `up` parallel to the key: `up × ẑ` collapses, and three's own lookAt papers over it by
    // nudging the target. Snapping onto a basis that is about to flip 180° would move the map
    // without stabilising it, so the honest answer is "no snap this frame". With the shipped ECEF
    // +Y up this is the subsolar point near 0°N 90°E and its antipode — the reason A3's
    // `SHADOWS.rigLocalUp` exists.
    const { lightPos, target, halfM } = rig(SHADOWS.boundsM, SHADOWS.lightDistM);
    const alongKey = norm(sub(lightPos, target));
    expect(snapCentreDelta(lightPos, target, alongKey, halfM, SHADOWS.mapSize)).toEqual([0, 0, 0]);
    // …and a light sitting on its own target has no basis at all.
    expect(snapCentreDelta(FOCUS, FOCUS, ECEF_Y, halfM, SHADOWS.mapSize)).toEqual([0, 0, 0]);
  });
});

describe("swingTexels / keySwingQuantumRad — the rotation half", () => {
  it("the quantum really is worth the texels it claims, over the shipped ladder", () => {
    // The contract the wiring depends on: a swing of `keySwingQuantumRad(t, M)` displaces the box
    // CORNER (r_max = b√2) by no more than `t` texels of width 2b/M.
    for (const t of [0.25, 0.5, 1, 2, 4]) {
      for (const L of LADDER) {
        const q = keySwingQuantumRad(t, L.mapPx);
        const arc = q * L.halfM * Math.SQRT2;
        expect(arc, `${L.name} t=${t}`).toBeLessThanOrEqual(t * texelSizeM(L.halfM, L.mapPx) + 1e-12);
        // …and it is the exact inverse of the forward measure, or the two would disagree about
        // what "one texel of swing" means.
        expect(swingTexels(q, L.halfM, L.mapPx)).toBeCloseTo(t, 9);
      }
    }
  });

  it("the crawl is a property of the MAP, not of the box — which is why one quantum serves both", () => {
    // The half-extent cancels: same swing, same texels, at 1.6 km and at 18 km.
    const a = swingTexels(1e-4, SHADOWS.boundsM, SHADOWS.mapSize);
    const b = swingTexels(1e-4, ULTRA.maxBoundsM, SHADOWS.mapSize);
    expect(a).toBeCloseTo(b, 12);
    // Doubling the map doubles the crawl (finer texels, more of them crossed per degree) — the
    // reason the 8192² ULTRA rig shimmers harder than the 4096² base rig for the same sun.
    expect(swingTexels(1e-4, SHADOWS.boundsM, 8192) / a).toBeCloseTo(2, 12);
  });

  it("the MEASURED harness rate reproduces §8's 0.29 texel/frame at the base rig", () => {
    // 0.0082°/frame at b = 5,000 m / 4096² — the number that says the flips are re-rasterisation
    // and not motion (the true shadow edge moves ~0.0009 texel over the same step). The audit
    // quotes it at the box EDGE; this measure takes the CORNER, which is √2 further out, so the
    // two agree exactly once that factor is named rather than hidden.
    const perFrameRad = (0.0082 * Math.PI) / 180;
    expect(swingTexels(perFrameRad, 5_000, 4096) / Math.SQRT2).toBeCloseTo(0.29, 2);
    expect(swingTexels(perFrameRad, 5_000, 4096)).toBeCloseTo(0.41, 2);
  });

  it("0 texels is the IDENTITY, not an infinitely tight quantum", () => {
    expect(keySwingQuantumRad(0, 4096)).toBe(0);
    expect(keySwingQuantumRad(-1, 4096)).toBe(0);
  });
});

describe("the off-edge — both quanta 0 is the shipped path", () => {
  it("rigDemandDriven is false at the identity and true as soon as either quantum opens", () => {
    expect(rigDemandDriven(0, 0)).toBe(false);
    expect(rigDemandDriven(1, 0)).toBe(true);
    expect(rigDemandDriven(0, 1)).toBe(true);
    // THE SHIPPED DEFAULTS — re-pointed by owner ruling 3 (2026-09-06i), not relaxed. A2 landed
    // ULTRA-first (base 0/0, the identity) while the one-texel cadence was still an experiment;
    // the owner then ruled that the cadence IS the look — "a one-texel step every ~1.2 s at real
    // time instead of per-frame re-rasterisation" — so both profiles now ship 1/1 and the BASE
    // rig is demand-driven too. The identity is still reachable (`rigDemandDriven(0, 0)` above),
    // which is what keeps the A/B honest; it is simply no longer what `SHADOWS` carries.
    expect(rigDemandDriven(SHADOWS.rigKeySnapTexels, SHADOWS.rigMoveTexels)).toBe(true);
    expect(rigDemandDriven(ULTRA.shadowRigKeySnapTexels, ULTRA.shadowRigMoveTexels)).toBe(true);
    expect(SHADOWS.rigKeySnapTexels).toBe(ULTRA.shadowRigKeySnapTexels);
    expect(SHADOWS.rigMoveTexels).toBe(ULTRA.shadowRigMoveTexels);
  });

  it("with both quanta 0 the shared predicate refreshes on ANY drift or ANY swing", () => {
    // Why the gate above is needed at all: at zero quanta the predicate is true whenever anything
    // moved, but on a frame where NOTHING moved it falls through to the staleness net and answers
    // false — which is not what three does. The identity therefore has to be the flag, not the
    // predicate.
    const base = {
      halfExtentM: 5_000,
      appliedHalfExtentM: 5_000,
      centreDriftM: 0,
      keySwingRad: 0,
      epoch: 3,
      appliedEpoch: 3,
      ageMs: 0,
      moveFrac: 0,
      swingRad: 0,
      maxStaleMs: SHADOWS.rigMaxStaleMs,
    };
    expect(cascadeNeedsRender({ ...base, centreDriftM: 1e-9 })).toBe(true);
    expect(cascadeNeedsRender({ ...base, keySwingRad: 1e-12 })).toBe(true);
    expect(cascadeNeedsRender({ ...base, epoch: 4 })).toBe(true);
    expect(cascadeNeedsRender({ ...base, appliedHalfExtentM: 0 })).toBe(true);
    // …and the one frame that proves the point.
    expect(cascadeNeedsRender(base)).toBe(false);
    expect(cascadeNeedsRender({ ...base, ageMs: SHADOWS.rigMaxStaleMs })).toBe(true);
  });

  it("the wiring's moveFrac conversion: 1 texel of drift trips the predicate, 0.9 does not", () => {
    // The shared predicate takes the move quantum as a fraction of the half-extent; the rig block
    // feeds it `(moveTexels × mPerTexel) / halfExtentM`. Pin the round trip so a future edit to
    // either side cannot silently change what "1 texel" means.
    const halfExtentM = 13_760;
    const mPerTexel = texelSizeM(halfExtentM, ULTRA.shadowMapSize);
    const moveFrac = (1 * mPerTexel) / halfExtentM;
    const base = {
      halfExtentM,
      appliedHalfExtentM: halfExtentM,
      keySwingRad: 0,
      epoch: 1,
      appliedEpoch: 1,
      ageMs: 0,
      moveFrac,
      swingRad: keySwingQuantumRad(1, ULTRA.shadowMapSize),
      maxStaleMs: SHADOWS.rigMaxStaleMs,
    };
    expect(cascadeNeedsRender({ ...base, centreDriftM: mPerTexel * 0.9 })).toBe(false);
    expect(cascadeNeedsRender({ ...base, centreDriftM: mPerTexel * 1.01 })).toBe(true);
  });
});

describe("rigUpDegenerate — A3's fallback trigger", () => {
  it("fires only when the key is within ~8° of the requested up", () => {
    expect(rigUpDegenerate(0)).toBe(false); // key on the horizon: the healthy case
    expect(rigUpDegenerate(0.9)).toBe(false);
    expect(rigUpDegenerate(0.99)).toBe(true); // exactly at the bound — closed, not open
    expect(rigUpDegenerate(0.995)).toBe(true);
    expect(rigUpDegenerate(-0.995)).toBe(true); // ANTIPARALLEL is just as degenerate
    expect(rigUpDegenerate(Number.NaN)).toBe(true); // a NaN dot must never build a basis
  });
});
