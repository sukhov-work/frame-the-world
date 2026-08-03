import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { DAYARC, SKY_TARGET } from "../tuning";
import {
  dayFraction,
  sampleTargetArc,
  azAltToEnu,
  type SkyArc,
} from "../../../lib/ephemeris/dayArc";
import type { SkyTarget } from "../../../lib/ephemeris/targets";
import { enuBasis } from "../../../lib/geo/projection";
import { horizonFade, makeArcMaterial, pointDirs } from "./dayArcs";

/**
 * Tracked sky-target trajectory (ASTRO ENGINE phase C, owner ask 2026-08-03 — the arc the comet
 * always deserved): the target's az/alt path across the observer's local solar day, drawn with
 * the day-arc grammar (`scene/dayArcs.ts` — shared material/melt/basis helpers) in the accent
 * colour so it reads as the marker's own line. Hour ticks mark the local hours; the past half
 * dims behind the scene-time split. Alpha-blended and depth-free like the sun/moon arcs: it is
 * a PLANNING overlay — it must read at noon (when the marker itself is night-gated away), and
 * the analytic per-vertex horizon melt owns occlusion.
 *
 * The observer is the SAME eye the TargetPanel prints numbers for (the plan anchor when standing
 * somewhere, else the view focus), and the sampler is `targetAzAlt` via `sampleTargetArc` — one
 * target, one ephemeris; the marker sits ON its trail because both ride the same impostor
 * distance function. Rebuilds only on target swap, anchor moves past a deadband (an orbit pan
 * would otherwise re-run ~170 ephemeris calls per frame), or the scene time leaving the sampled
 * day. Gated by SHOW && TRAIL (store/sky, both persisted view prefs).
 */
export interface SkyTrailHandle {
  group: THREE.Group;
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Scene time (ms) — drives the past/future split and the day-window rebuild check. */
    sceneMs: number;
    /** The tracked target — the SAME object the marker follows (they can never disagree). */
    target: SkyTarget;
    /** The observer the arc is sampled for (the panel's eye); null hides the trail. */
    anchor: { latDeg: number; lonDeg: number } | null;
    /** SHOW && TRAIL (store/sky). */
    visible: boolean;
    dtMs: number;
  }): void;
  dispose(): void;
}

export function attachSkyTrail(scene: THREE.Scene): SkyTrailHandle {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const lineMaterial = makeArcMaterial(tokens.accent, 1);
  const tickMaterial = makeArcMaterial(tokens.accent, DAYARC.tickAlphaGain);
  const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry(), tickMaterial);
  for (const obj of [line, ticks]) {
    obj.raycast = () => {};
    obj.frustumCulled = false; // camera-anchored; re-placed every frame like the impostors
    obj.renderOrder = 10; // depth-free overlay draws after the world (per-object, like dayArcs)
    group.add(obj);
  }

  let arc: SkyArc | null = null;
  let arcTargetId = "";
  let anchorLat = NaN;
  let anchorLon = NaN;
  let fade = 0;

  function rebuild(target: SkyTarget, latDeg: number, lonDeg: number, sceneMs: number) {
    const basis = enuBasis(latDeg, lonDeg);
    arc = sampleTargetArc(target, sceneMs, latDeg, lonDeg, {
      stepMin: DAYARC.stepMin,
      tickEveryH: DAYARC.tickEveryH,
    });
    arcTargetId = target.id;
    const show = arc.everUp;
    line.visible = show;
    ticks.visible = show;
    if (!show) return; // the target never clears this horizon today — nothing to draw

    const linePos = pointDirs(arc.points, basis, (p) => azAltToEnu(p.azDeg, p.altDeg));
    const lineT = new Float32Array(arc.points.map((p) => p.t01));
    const lineF = new Float32Array(arc.points.map((p) => horizonFade(p.altDeg)));
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    line.geometry.setAttribute("aT01", new THREE.BufferAttribute(lineT, 1));
    line.geometry.setAttribute("aFade", new THREE.BufferAttribute(lineF, 1));

    // Each hour tick is a short segment along the local vertical through the arc point.
    const tickPts = arc.hourTicks.flatMap((p) => [
      { ...p, altDeg: p.altDeg - DAYARC.tickHalfDeg },
      { ...p, altDeg: p.altDeg + DAYARC.tickHalfDeg },
    ]);
    const tickPos = pointDirs(tickPts, basis, (p) => azAltToEnu(p.azDeg, p.altDeg));
    const tickT = new Float32Array(tickPts.map((p) => p.t01));
    const tickF = new Float32Array(
      arc.hourTicks.flatMap((p) => {
        const f = horizonFade(p.altDeg);
        return [f, f];
      }),
    );
    ticks.geometry.dispose();
    ticks.geometry = new THREE.BufferGeometry();
    ticks.geometry.setAttribute("position", new THREE.BufferAttribute(tickPos, 3));
    ticks.geometry.setAttribute("aT01", new THREE.BufferAttribute(tickT, 1));
    ticks.geometry.setAttribute("aFade", new THREE.BufferAttribute(tickF, 1));
  }

  return {
    group,
    update({ camera, sceneMs, target, anchor, visible, dtMs }) {
      const want = visible && anchor !== null;
      const targetFade = want ? 1 : 0;
      fade += (targetFade - fade) * (1 - Math.exp(-dtMs / DAYARC.fadeTauMs));
      if (fade < 0.01 && !want) {
        group.visible = false;
        return;
      }
      if (want && anchor) {
        const moved =
          Math.abs(anchor.latDeg - anchorLat) > SKY_TARGET.trailRebuildMinDeg ||
          Math.abs(anchor.lonDeg - anchorLon) > SKY_TARGET.trailRebuildMinDeg;
        const dayCrossed = !arc || sceneMs < arc.startMs || sceneMs >= arc.endMs;
        if (moved || dayCrossed || target.id !== arcTargetId) {
          anchorLat = anchor.latDeg;
          anchorLon = anchor.lonDeg;
          rebuild(target, anchorLat, anchorLon, sceneMs);
        }
      }
      group.visible = true;
      // Same distance function as the marker impostor — the marker sits ON its trail.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY_TARGET.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );
      group.position.copy(camera.position);
      group.scale.setScalar(d);
      if (arc) {
        const now01 = dayFraction(arc, sceneMs);
        lineMaterial.uniforms.uNow01.value = now01;
        tickMaterial.uniforms.uNow01.value = now01;
        lineMaterial.uniforms.uFade.value = fade;
        tickMaterial.uniforms.uFade.value = fade;
      }
    },
    dispose() {
      line.geometry.dispose();
      ticks.geometry.dispose();
      lineMaterial.dispose();
      tickMaterial.dispose();
      scene.remove(group);
    },
  };
}
