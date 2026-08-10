/**
 * Plan feed (Pass 3 WS4 + Dnipro enrichment Slice 5) — the scene-side owner of the horizon
 * profile and the planner chips. Composes the three pure libs:
 *   `lib/geo/horizonProfile` (bins + terrain march) · `lib/geo/occlusion` (building-edge and
 *   tree-canopy sweeps over the STREAMED tile groups) · `lib/ephemeris/planner` (almanac chips
 *   + skyline crossings), and mirrors results into `store/plan` for the PlanPanel.
 *
 * Anchoring: the placed photo's frustum apex wins (the photographer's eye — WS4's natural ray
 * origin); a temp-pin FPV eye is next; otherwise the view focus gets almanac chips only (no eye
 * → no skyline). A photo/FPV anchor triggers a TIME-SLICED profile build: a few terrain bins +
 * a few meshes per frame (PLAN.terrainBinsPerFrame/meshesPerFrame), so no frame pays for the
 * whole sweep — the reseatSamplesPerFrame idiom.
 *
 * The WS4 LOD caveat is structural here: sweeps see only currently-streamed cells, so the
 * profile is built once per anchor from what's loaded, reports honest per-bin coverage, and
 * claims nothing beyond PLAN.trustRadiusM. Inside the enriched bbox the OSM mask is
 * fragment-level clipping — clipped-away OSM mass still exists CPU-side, so OSM sweeps reject
 * vertices inside the same `bboxClipPrismEcef` planes the shader clips with.
 */

import * as THREE from "three";
import { GOLDEN, PLAN } from "../tuning";
import {
  dayEvents,
  moonPhaseEvents,
  skylineState,
  targetSkylineState,
  type PlanBody,
  type PlanEvent,
  type PlanObserver,
  type SkylineState,
} from "../../../lib/ephemeris/planner";
import { horizontal } from "../../../lib/ephemeris/bodies";
import { targetAzAlt, targetShortName, type SkyTarget } from "../../../lib/ephemeris/targets";
import { kindGlyph } from "../../../lib/sky/searchIndex";
import { localDayWindow } from "../../../lib/ephemeris/dayArc";
import {
  createProfile,
  horizonDipDeg,
  marchTerrainBin,
  profileCoverage,
  sampleProfile,
  type HorizonProfile,
  type SilhouetteFrame,
} from "../../../lib/geo/horizonProfile";
import { sweepMeshEdges, sweepTreeInstances } from "../../../lib/geo/occlusion";
import { clampGroundM } from "../../../lib/geo/terrain";
import { ecefToGeodetic, enuBasis } from "../../../lib/geo/projection";
import { bboxClipPrismEcef, type EcefPlane, type GeoBbox } from "../../../lib/globe/enrichedMask";
import {
  usePlanStore,
  type PlanAnchorKind,
  type PlanBodyState,
  type PlanTargetState,
} from "../../../store/plan";
import { useSkyStore } from "../../../store/sky";

export interface PlanFeedHandle {
  update(ctx: PlanFeedCtx): void;
  /** The cached skyline sampler (deg → deg) — null until a build completes. Future consumers
   *  (the dayArcs skyline fold) read this instead of re-sweeping. */
  profileSample(): ((azDeg: number) => number) | null;
  /** Drop the current anchor so the next update() re-anchors and rebuilds the profile — the
   *  orchestrator calls this once after the per-building re-seat writes settle (a ready profile
   *  built over pre-seat geometry must not keep answering skyline questions). */
  invalidate(): void;
  /** DEV introspection for window.__globe. */
  debug(): {
    anchorKind: PlanAnchorKind | null;
    building: boolean;
    coverage: number;
    binAltDeg: number[] | null;
  };
  dispose(): void;
}

export interface PlanFeedCtx {
  sceneMs: number;
  /** Placed photo apex (ECEF m) — priority anchor. */
  photoApex: readonly [number, number, number] | null;
  /** FPV eye (ECEF m) while FPV is active without a placed photo. */
  fpvEye: THREE.Vector3 | null;
  fpvEyeAboveGroundM: number;
  /** View focus — the chips-only fallback anchor. */
  focusLatDeg: number;
  focusLonDeg: number;
}

interface BuildState {
  profile: HorizonProfile;
  frame: SilhouetteFrame;
  obs: PlanObserver;
  /** Terrain-march progress (bin index); done when === azBins. */
  terrainBin: number;
  /** Mesh sweep worklist — collected once after the terrain phase. */
  meshes: THREE.Object3D[] | null;
  meshIdx: number;
  ready: boolean;
}

const DAY_MS = 86_400_000;

export function attachPlanFeed(opts: {
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
  buildingsGroup: THREE.Object3D;
  enrichedGroup: THREE.Object3D | null;
  /** Set exactly when the enriched tileset is active — enables the OSM-mask vertex rejection. */
  maskBbox: GeoBbox | null;
}): PlanFeedHandle {
  const { terrainHeightAt, buildingsGroup, enrichedGroup } = opts;
  const rejectPlanes: EcefPlane[] | null = opts.maskBbox
    ? bboxClipPrismEcef(opts.maskBbox)
    : null;

  const heightAt = (latDeg: number, lonDeg: number): number | null => {
    const h = terrainHeightAt(latDeg, lonDeg);
    return h == null ? null : clampGroundM(h);
  };

  let anchorKind: PlanAnchorKind | null = null;
  const anchorEcef = new THREE.Vector3();
  let build: BuildState | null = null;

  // Chips cache — recomputed when the anchor or its local solar day changes.
  let chipsKey = "";
  let chips: PlanEvent[] = [];

  // Skyline crossing scans — throttled (a scrubber drag re-scans ~1×/s, not per pointermove).
  let scanBaseMs = NaN;
  let lastScanRealMs = -Infinity;
  let scanSun: SkylineState | null = null;
  let scanMoon: SkylineState | null = null;
  // Tracked-target scan (phase E) — invalidated by target swaps as well as time scrubs.
  let scanTarget: SkylineState | null = null;
  let scanTargetId = "";

  let frameCount = 0;
  let lastMirrorSig = "";

  const _v = new THREE.Vector3();
  const _sphere = new THREE.Sphere();

  const startBuild = (kind: PlanAnchorKind, eye: THREE.Vector3, eyeAboveGroundM: number) => {
    anchorKind = kind;
    anchorEcef.copy(eye);
    const geo = ecefToGeodetic([eye.x, eye.y, eye.z]);
    const groundM = heightAt(geo.latDeg, geo.lonDeg);
    const eyeAbove =
      eyeAboveGroundM > 0
        ? eyeAboveGroundM
        : groundM != null
          ? Math.max(0, geo.altM - groundM)
          : PLAN.eyeHeightM;
    const basis = enuBasis(geo.latDeg, geo.lonDeg);
    build = {
      profile: createProfile(PLAN.azBins, horizonDipDeg(eyeAbove, PLAN.refractionK)),
      frame: {
        originEcef: [eye.x, eye.y, eye.z],
        east: basis.east,
        north: basis.north,
        up: basis.up,
        refractionK: PLAN.refractionK,
      },
      obs: {
        latDeg: geo.latDeg,
        lonDeg: geo.lonDeg,
        groundAltM: groundM ?? Math.max(0, geo.altM - eyeAbove),
        eyeAboveGroundM: eyeAbove,
      },
      terrainBin: 0,
      meshes: null,
      meshIdx: 0,
      ready: false,
    };
    scanSun = null;
    scanMoon = null;
    scanTarget = null;
    scanTargetId = "";
    scanBaseMs = NaN;
  };

  /** Collect the sweep worklist: plain meshes + instanced trees from both tile groups. The
   *  per-mesh distance cull happens lazily in the sweep slice (bounding spheres are computed
   *  there, bounded per frame). */
  const collectMeshes = (): THREE.Object3D[] => {
    const list: THREE.Object3D[] = [];
    const visit = (root: THREE.Object3D | null) => {
      root?.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) list.push(c);
      });
    };
    visit(buildingsGroup);
    visit(enrichedGroup);
    return list;
  };

  /** Positions of a geometry as a plain stride-3 float array. The fast path reads `.array`
   *  directly; interleaved, normalized or non-float32 attributes (quantized b3dm pipelines)
   *  go through getX/getY/getZ, which apply the normalization the raw array would skip. */
  const positionsOf = (geom: THREE.BufferGeometry): ArrayLike<number> | null => {
    const attr = geom.getAttribute("position");
    if (!attr) return null;
    const direct =
      !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
      !attr.normalized &&
      (attr as THREE.BufferAttribute).array instanceof Float32Array;
    if (direct) return (attr as THREE.BufferAttribute).array as ArrayLike<number>;
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      out[i * 3] = attr.getX(i);
      out[i * 3 + 1] = attr.getY(i);
      out[i * 3 + 2] = attr.getZ(i);
    }
    return out;
  };

  const sweepSlice = (b: BuildState) => {
    if (!b.meshes) {
      b.meshes = collectMeshes();
      b.meshIdx = 0;
    }
    let swept = 0;
    while (b.meshIdx < b.meshes.length && swept < PLAN.meshesPerFrame) {
      const obj = b.meshes[b.meshIdx++];
      const mesh = obj as THREE.Mesh;
      // Tiles stream: a cell may have been LRU-disposed mid-build.
      if (!mesh.parent || !mesh.geometry) continue;
      const geom = mesh.geometry;
      if (!geom.boundingSphere) geom.computeBoundingSphere();
      if (!geom.boundingSphere) continue;
      _sphere.copy(geom.boundingSphere).applyMatrix4(mesh.matrixWorld);
      _v.set(b.frame.originEcef[0], b.frame.originEcef[1], b.frame.originEcef[2]);
      if (_sphere.center.distanceTo(_v) - _sphere.radius > PLAN.trustRadiusM) continue;
      swept++;
      const inst = mesh as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        // Slice-3 trees (the only instancing in the tile groups). Their raycast is nooped —
        // the sweep reads the TRS directly, which is also why this needs no un-nooping.
        sweepTreeInstances(
          b.profile,
          b.frame,
          inst.instanceMatrix.array as ArrayLike<number>,
          inst.count,
          mesh.matrixWorld.elements,
          { trustRadiusM: PLAN.trustRadiusM },
        );
        continue;
      }
      const positions = positionsOf(geom);
      if (!positions) continue;
      // Only OSM geometry carries the mask rejection — the enriched set OWNS the bbox interior.
      const isEnriched = enrichedGroup
        ? ((): boolean => {
            let p: THREE.Object3D | null = mesh;
            while (p) {
              if (p === enrichedGroup) return true;
              p = p.parent;
            }
            return false;
          })()
        : false;
      sweepMeshEdges(b.profile, b.frame, positions, geom.index?.array ?? null, mesh.matrixWorld.elements, {
        trustRadiusM: PLAN.trustRadiusM,
        rejectPlanes: isEnriched ? null : rejectPlanes,
      });
    }
    if (b.meshIdx >= b.meshes.length) b.ready = true;
  };

  const stepBuild = (b: BuildState) => {
    if (b.terrainBin < PLAN.azBins) {
      const binWidth = 360 / PLAN.azBins;
      const anchor = {
        latDeg: b.obs.latDeg,
        lonDeg: b.obs.lonDeg,
        eyeAltM: b.obs.groundAltM + b.obs.eyeAboveGroundM,
      };
      for (let i = 0; i < PLAN.terrainBinsPerFrame && b.terrainBin < PLAN.azBins; i++) {
        marchTerrainBin(b.profile, anchor, (b.terrainBin + 0.5) * binWidth, heightAt, {
          minRangeM: PLAN.terrainMinM,
          maxRangeM: PLAN.terrainMaxM,
          stepGrowth: PLAN.terrainGrowth,
          refractionK: PLAN.refractionK,
        });
        b.terrainBin++;
      }
      return;
    }
    if (!b.ready) sweepSlice(b);
  };

  const bodyState = (body: PlanBody, b: BuildState, sceneMs: number, scan: SkylineState | null): PlanBodyState => {
    const pos = horizontal(body, sceneMs, b.obs.latDeg, b.obs.lonDeg);
    const skylineAltDeg = sampleProfile(b.profile, pos.azDeg);
    return {
      blockedNow: pos.altDeg < skylineAltDeg,
      azDeg: pos.azDeg,
      altDeg: pos.altDeg,
      skylineAltDeg,
      nextClearMs: scan?.nextClearMs ?? null,
      nextBlockMs: scan?.nextBlockMs ?? null,
    };
  };

  /** The tracked target's row (phase E) — same shape as sun/moon plus identity, through the SAME
   *  `targetAzAlt` face the marker/trail/panel read. */
  const targetState = (
    t: SkyTarget,
    b: BuildState,
    sceneMs: number,
    scan: SkylineState | null,
  ): PlanTargetState => {
    const pos = targetAzAlt(
      t,
      sceneMs,
      b.obs.latDeg,
      b.obs.lonDeg,
      b.obs.groundAltM + b.obs.eyeAboveGroundM,
    );
    const skylineAltDeg = sampleProfile(b.profile, pos.azDeg);
    return {
      id: t.id,
      label: targetShortName(t).toUpperCase(),
      glyph: kindGlyph(t.kind),
      blockedNow: pos.altDeg < skylineAltDeg,
      azDeg: pos.azDeg,
      altDeg: pos.altDeg,
      skylineAltDeg,
      nextClearMs: scan?.nextClearMs ?? null,
      nextBlockMs: scan?.nextBlockMs ?? null,
    };
  };

  const update = (ctx: PlanFeedCtx) => {
    frameCount++;

    // ── Resolve the anchor (photo apex > FPV eye > focus) and (re)start builds ──────────────
    if (ctx.photoApex) {
      _v.set(ctx.photoApex[0], ctx.photoApex[1], ctx.photoApex[2]);
      // Eye height derives from apex-altitude − terrain (0 sentinel) — ctx.fpvEyeAboveGroundM
      // can hold a STALE last-FPV value while orbiting a placed photo.
      if (anchorKind !== "photo" || _v.distanceTo(anchorEcef) > PLAN.rebuildDistM)
        startBuild("photo", _v, 0);
    } else if (ctx.fpvEye) {
      if (anchorKind !== "fpv" || ctx.fpvEye.distanceTo(anchorEcef) > PLAN.rebuildDistM)
        startBuild("fpv", ctx.fpvEye, ctx.fpvEyeAboveGroundM);
    } else if (anchorKind !== "focus") {
      anchorKind = "focus";
      build = null;
      scanSun = null;
      scanMoon = null;
      scanTarget = null;
      scanTargetId = "";
    }

    if (build && !build.ready) stepBuild(build);

    // ── Mirrors at low cadence (the camera-mirror idiom — never 60 fps) ──────────────────────
    if (frameCount % PLAN.mirrorEveryFrames !== 1) return;
    // Focus-anchored chips are computed only while the panel is open — the LEO idle drift moves
    // the focus forever, and a closed panel must not pay finder calls for it. Photo/FPV anchors
    // keep their mirrors warm (opening the panel then shows the verdict instantly).
    if (!build && !usePlanStore.getState().open) return;

    // Quantize the focus (~5.5 km) so drift doesn't churn the chip recompute key — event times
    // move by seconds over that distance, far under chip granularity.
    const qLat = Math.round(ctx.focusLatDeg * 20) / 20;
    const qLon = Math.round(ctx.focusLonDeg * 20) / 20;
    const obs: PlanObserver = build
      ? build.obs
      : {
          latDeg: qLat,
          lonDeg: qLon,
          groundAltM: heightAt(qLat, qLon) ?? 0,
          eyeAboveGroundM: PLAN.eyeHeightM,
        };

    // Chips: recompute when the anchor moved or the local solar day changed.
    const window = localDayWindow(ctx.sceneMs, obs.lonDeg);
    const key = `${anchorKind}:${obs.latDeg.toFixed(3)}:${obs.lonDeg.toFixed(3)}:${window.startMs}`;
    if (key !== chipsKey) {
      chipsKey = key;
      chips = [...dayEvents(ctx.sceneMs, obs, GOLDEN), ...moonPhaseEvents(ctx.sceneMs, obs)];
    }

    // The tracked target rides the skyline verdicts only while its SHOW chip is on — the same
    // per-slot gate the FPV edge chip uses (a hidden target must not haunt the planner).
    const sky = useSkyStore.getState();
    const tracked = sky.visible ? sky.target : null;

    // Skyline crossing scans (profile ready only) — refreshed when scene time out-scrubs them
    // or (target slot) when the tracked target itself swaps.
    if (build?.ready) {
      const nowReal = performance.now();
      const stale =
        Number.isNaN(scanBaseMs) ||
        Math.abs(ctx.sceneMs - scanBaseMs) > PLAN.scanStaleMs ||
        (tracked?.id ?? "") !== scanTargetId;
      if (stale && nowReal - lastScanRealMs > PLAN.scanThrottleMs) {
        lastScanRealMs = nowReal;
        scanBaseMs = ctx.sceneMs;
        const profileFn = (azDeg: number) => sampleProfile(build!.profile, azDeg);
        const scanOpts = { horizonDays: PLAN.scanHorizonDays, scanStepMin: PLAN.scanStepMin };
        scanSun = skylineState("sun", ctx.sceneMs, build.obs, profileFn, scanOpts);
        scanMoon = skylineState("moon", ctx.sceneMs, build.obs, profileFn, scanOpts);
        scanTargetId = tracked?.id ?? "";
        scanTarget = tracked
          ? targetSkylineState(tracked, ctx.sceneMs, build.obs, profileFn, scanOpts)
          : null;
      }
    }

    const sun = build?.ready ? bodyState("sun", build, ctx.sceneMs, scanSun) : null;
    const moon = build?.ready ? bodyState("moon", build, ctx.sceneMs, scanMoon) : null;
    const target =
      build?.ready && tracked
        ? targetState(tracked, build, ctx.sceneMs, tracked.id === scanTargetId ? scanTarget : null)
        : null;
    const coverage = build?.ready ? profileCoverage(build.profile) : 0;

    // Skip the store write when nothing the panel renders changed (float fields quantized).
    const sig =
      `${key}|${chips.length}|${build?.ready ? 1 : 0}|${coverage.toFixed(2)}|` +
      `${sun ? `${sun.blockedNow}:${sun.azDeg.toFixed(1)}:${sun.altDeg.toFixed(1)}:${sun.nextClearMs}:${sun.nextBlockMs}` : "-"}|` +
      `${moon ? `${moon.blockedNow}:${moon.azDeg.toFixed(1)}:${moon.altDeg.toFixed(1)}:${moon.nextClearMs}:${moon.nextBlockMs}` : "-"}|` +
      `${target ? `${target.id}:${target.blockedNow}:${target.azDeg.toFixed(1)}:${target.altDeg.toFixed(1)}:${target.nextClearMs}:${target.nextBlockMs}` : "-"}|` +
      `${Math.floor(ctx.sceneMs / DAY_MS)}`;
    if (sig === lastMirrorSig) return;
    lastMirrorSig = sig;

    usePlanStore.getState()._syncPlan({
      anchor: { kind: anchorKind ?? "focus", latDeg: obs.latDeg, lonDeg: obs.lonDeg },
      events: chips,
      profileReady: build?.ready ?? false,
      profileCoverage: coverage,
      trustRadiusM: PLAN.trustRadiusM,
      sun,
      moon,
      target,
    });
  };

  return {
    update,
    profileSample: () =>
      build?.ready ? (azDeg: number) => sampleProfile(build!.profile, azDeg) : null,
    invalidate() {
      anchorKind = null; // the next update() re-resolves the anchor → startBuild from scratch
    },
    debug: () => ({
      anchorKind,
      building: !!build && !build.ready,
      coverage: build ? profileCoverage(build.profile) : 0,
      binAltDeg: build ? Array.from(build.profile.altDeg) : null,
    }),
    dispose() {
      build = null;
      usePlanStore.getState()._syncPlan({
        anchor: null,
        events: [],
        profileReady: false,
        profileCoverage: 0,
        sun: null,
        moon: null,
        target: null,
      });
    },
  };
}
