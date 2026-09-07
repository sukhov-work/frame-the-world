import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { AIMCONES, PLAN } from "../../../src/components/globe/tuning";
import { attachPlanFeed } from "../../../src/components/globe/scene/planFeed";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";
import { usePlanStore } from "../../../src/store/plan";

/**
 * OCCLUSION AUDIT 2026-09-07c — the plan feed's occluder set and its refresh rules, driven
 * headlessly (real three objects, no renderer; the `bestSpotFeed.test` precedent).
 *
 * Three defects this file keeps dead, each found by the audit and each visible to the owner as
 * a radar band / scrubber trace / FIND verdict that ignored something on screen:
 *  · a USER MODEL placed in front of the eye occluded nothing (`collectMeshes` walked only the
 *    two tile groups);
 *  · a tile that streamed in AFTER the sweep passed its azimuth never entered the profile until
 *    the eye moved 25 m (no streaming epoch — `bestSpotFeed` had fixed the same hole for itself
 *    on 2026-08-24);
 *  · every rebuild blanked the published profile for the 1–3 s the sliced sweep takes, so the
 *    fix above would have made the radar flicker on every arrival — the carry policy.
 */

const LAT = 48.4647;
const LON = 35.0462;
const GROUND_M = 100;
const EYE_ABOVE = 1.7;
const T0 = Date.UTC(2026, 8, 6, 12, 0);

/** ECEF eye at the FPV height over flat ground, offset `eastM` from the reference point. */
const eyeAt = (eastM = 0): THREE.Vector3 => {
  const b = enuBasis(LAT, LON);
  const p = geodeticToEcef(LAT, LON, GROUND_M + EYE_ABOVE);
  return new THREE.Vector3(
    p[0] + b.east[0] * eastM,
    p[1] + b.east[1] * eastM,
    p[2] + b.east[2] * eastM,
  );
};

/** A 10 × 20 × 2 m wall standing on the ground `eastM` metres east of the reference point —
 *  its top subtends atan(18.3 / 50) ≈ 20° at the eye when `eastM` = 50. Local axes → ENU. */
const wallAt = (eastM: number): THREE.Mesh => {
  const b = enuBasis(LAT, LON);
  const base = geodeticToEcef(LAT, LON, GROUND_M);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 2), new THREE.MeshBasicMaterial());
  const east = new THREE.Vector3(...b.east);
  const north = new THREE.Vector3(...b.north);
  const up = new THREE.Vector3(...b.up);
  const m = new THREE.Matrix4().makeBasis(north, up, east); // X → north, Y → up, Z → east
  m.setPosition(
    base[0] + b.east[0] * eastM + b.up[0] * 10,
    base[1] + b.east[1] * eastM + b.up[1] * 10,
    base[2] + b.east[2] * eastM + b.up[2] * 10,
  );
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(m);
  return mesh;
};

const AZ_EAST_BIN = Math.floor(90 / (360 / PLAN.azBins));
const AZ_WEST_BIN = Math.floor(270 / (360 / PLAN.azBins));

interface Rig {
  feed: ReturnType<typeof attachPlanFeed>;
  buildings: THREE.Group;
  models: THREE.Group;
  epochs: { terrainEpoch: number; builtEpoch: number; modelsEpoch: number };
  eye: THREE.Vector3;
  /** Run `n` frames of the feed at the current eye/epochs. */
  frames(n: number): void;
  /** Frames until the current build completes (bounded). */
  settle(): number;
}

const rig = (withModels = true): Rig => {
  const buildings = new THREE.Group();
  const models = new THREE.Group();
  const feed = attachPlanFeed({
    terrainHeightAt: () => GROUND_M,
    buildingsGroup: buildings,
    enrichedGroup: null,
    maskBbox: null,
    userModelsGroup: withModels ? () => models : undefined,
  });
  const r: Rig = {
    feed,
    buildings,
    models,
    epochs: { terrainEpoch: 0, builtEpoch: 0, modelsEpoch: 0 },
    eye: eyeAt(0),
    frames(n) {
      for (let i = 0; i < n; i++) {
        buildings.updateMatrixWorld(true);
        models.updateMatrixWorld(true);
        feed.update({
          sceneMs: T0,
          photoApex: null,
          fpvEye: r.eye,
          fpvEyeAboveGroundM: EYE_ABOVE,
          focusLatDeg: LAT,
          focusLonDeg: LON,
          ...r.epochs,
        });
      }
    },
    settle() {
      let n = 0;
      r.frames(1);
      while (feed.debug().building && n < 2000) {
        r.frames(1);
        n++;
      }
      r.frames(PLAN.mirrorEveryFrames + 1); // let the store mirror land
      return n;
    },
  };
  return r;
};

beforeEach(() => {
  usePlanStore.getState()._syncPlan({
    anchor: null,
    events: [],
    profileReady: false,
    profileCoverage: 0,
    profileBins: null,
    sun: null,
    moon: null,
    target: null,
  });
});

describe("scene/planFeed — the occluder set (OCCLUSION 2026-09-07c)", () => {
  it("a user model in front of the eye raises the skyline at its azimuth — like a building, not like nothing", () => {
    const r = rig(true);
    r.models.add(wallAt(50));
    r.settle();
    const bins = r.feed.debug().binAltDeg!;
    expect(bins[AZ_EAST_BIN]).toBeGreaterThan(15); // atan(18.3/50) ≈ 20°, the bin takes the max
    expect(bins[AZ_WEST_BIN]).toBeLessThan(1); // flat ground: the dip only
    expect(usePlanStore.getState().profileBins?.[AZ_EAST_BIN]).toBeGreaterThan(15);
    r.feed.dispose();
  });

  it("without the models group the same wall is invisible — the regression the audit found", () => {
    const r = rig(false);
    r.models.add(wallAt(50));
    r.settle();
    expect(r.feed.debug().binAltDeg![AZ_EAST_BIN]).toBeLessThan(1);
    r.feed.dispose();
  });

  it("a hidden models group (the MDL chip off) sweeps nothing", () => {
    const r = rig(true);
    r.models.add(wallAt(50));
    r.models.visible = false;
    r.settle();
    expect(r.feed.debug().binAltDeg![AZ_EAST_BIN]).toBeLessThan(1);
    r.feed.dispose();
  });
});

describe("scene/planFeed — the streaming epochs re-sweep the same anchor after a quiet window", () => {
  it("a building tile landing after the sweep enters the profile once `builtEpoch` has been quiet for PLAN.streamQuietFrames", () => {
    const r = rig(true);
    r.settle();
    const before = usePlanStore.getState().profileBins!;
    expect(before[AZ_EAST_BIN]).toBeLessThan(1);
    // The tile lands: the orchestrator bumps builtEpoch on `load-model`.
    r.buildings.add(wallAt(50));
    r.epochs.builtEpoch++;
    r.frames(PLAN.streamQuietFrames - 5);
    // Not quiet long enough: nothing restarted, the published profile is the old one by identity.
    expect(r.feed.debug().building).toBe(false);
    expect(usePlanStore.getState().profileBins).toBe(before);
    r.frames(6);
    expect(r.feed.debug().building).toBe(true); // the re-sweep started at the SAME anchor
    expect(r.feed.debug().carried).toBe(true);
    expect(usePlanStore.getState().profileReady).toBe(true); // …and the old profile stays published
    expect(usePlanStore.getState().profileBins).toBe(before);
    r.settle();
    const after = usePlanStore.getState().profileBins!;
    expect(after).not.toBe(before); // a completed sweep is a new array (consumers key on identity)
    expect(after[AZ_EAST_BIN]).toBeGreaterThan(15);
    expect(r.feed.debug().carried).toBe(false);
    r.feed.dispose();
  });

  it("a change that lands during a build restarts it only once the stream is quiet again; one burst = one rebuild", () => {
    const r = rig(true);
    r.settle();
    r.buildings.add(wallAt(50));
    // A burst of arrivals, one per frame for 30 frames — every bump restarts the quiet clock.
    for (let i = 0; i < 30; i++) {
      r.epochs.builtEpoch++;
      r.frames(1);
    }
    expect(r.feed.debug().building).toBe(false);
    r.frames(PLAN.streamQuietFrames);
    expect(r.feed.debug().building).toBe(true);
    const started = r.feed.debug().epochs.changedFrame;
    r.settle();
    // No further change → no further rebuild: the epoch record is the burst's last frame.
    r.frames(PLAN.streamQuietFrames * 2);
    expect(r.feed.debug().building).toBe(false);
    expect(r.feed.debug().epochs.changedFrame).toBe(started);
    r.feed.dispose();
  });

  it("the terrain and user-model epochs are watched the same way", () => {
    const r = rig(true);
    r.settle();
    r.models.add(wallAt(50));
    r.epochs.modelsEpoch++;
    r.frames(PLAN.streamQuietFrames + 1);
    expect(r.feed.debug().building).toBe(true);
    r.settle();
    expect(usePlanStore.getState().profileBins![AZ_EAST_BIN]).toBeGreaterThan(15);
    r.epochs.terrainEpoch++;
    r.frames(PLAN.streamQuietFrames + 1);
    expect(r.feed.debug().building).toBe(true);
    r.feed.dispose();
  });
});

describe("scene/planFeed — the carry policy (the last complete profile through a rebuild)", () => {
  it("an eye step within PLAN.carryProfileDistM keeps the previous profile published; beyond it the mirror goes null", () => {
    const r = rig(true);
    r.buildings.add(wallAt(50));
    r.settle();
    const bins = usePlanStore.getState().profileBins!;
    // 30 m east: past rebuildDistM (25) → a rebuild; under carryProfileDistM (60) → carried.
    r.eye = eyeAt(30);
    r.frames(PLAN.mirrorEveryFrames + 1);
    expect(r.feed.debug().building).toBe(true);
    expect(r.feed.debug().carried).toBe(true);
    expect(usePlanStore.getState().profileReady).toBe(true);
    expect(usePlanStore.getState().profileBins).toBe(bins);
    expect(r.feed.profileSample()).not.toBeNull();
    r.settle();
    // 500 m east: a real move — null until the new sweep completes, exactly as before.
    r.eye = eyeAt(500);
    r.frames(PLAN.mirrorEveryFrames + 1);
    expect(r.feed.debug().building).toBe(true);
    expect(r.feed.debug().carried).toBe(false);
    expect(usePlanStore.getState().profileReady).toBe(false);
    expect(usePlanStore.getState().profileBins).toBeNull();
    expect(r.feed.profileSample()).toBeNull();
    r.settle();
    expect(usePlanStore.getState().profileReady).toBe(true);
    r.feed.dispose();
  });

  it("invalidate() (the enriched re-seat hook) rebuilds the same anchor under the carry policy", () => {
    const r = rig(true);
    r.settle();
    const bins = usePlanStore.getState().profileBins!;
    r.feed.invalidate();
    r.frames(1);
    expect(r.feed.debug().building).toBe(true);
    expect(r.feed.debug().carried).toBe(true);
    expect(usePlanStore.getState().profileBins).toBe(bins);
    r.feed.dispose();
  });

  it("the carry distance never exceeds the radars' own honesty bound (AIMCONES.skylineGuardM)", () => {
    expect(PLAN.carryProfileDistM).toBeLessThanOrEqual(AIMCONES.skylineGuardM);
    expect(PLAN.carryProfileDistM).toBeGreaterThan(PLAN.rebuildDistM);
  });
});
