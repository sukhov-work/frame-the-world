import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { DAYARC, SKY } from "../tuning";
import {
  dayFraction,
  sampleDayArc,
  azAltToEnu,
  type DayArc,
  type DayArcPoint,
} from "../../../lib/ephemeris/dayArc";
import { enuBasis } from "../../../lib/geo/projection";
import { glf } from "./glsl";

/**
 * FPV planning overlays (Phase 5.5 S6, §Item 4): the sun's and moon's day-arc polylines for the
 * FPV anchor — az/alt sampled across the scene-local solar day (lib/ephemeris/dayArc), converted
 * to ECEF directions on the anchor's ENU basis and drawn CAMERA-ANCHORED at the sky-impostor
 * distance, so the rendered sun/moon discs sit exactly ON their arcs (same distance function,
 * same ephemeris). Hour ticks mark the local hours; the past half of the day dims behind the
 * scene-time split (a per-vertex compare against uNow01 — scrubbing never rebuilds geometry).
 *
 * Occlusion is ANALYTIC like the impostors': each vertex fades through the horizon band by its
 * own altitude at the anchor (below-horizon points melt out across DAYARC.horizonFade*Deg) and
 * the material skips the depth test entirely — a planning overlay reads THROUGH the ghosted
 * skyline; the fake camera-anchored distance would make depth occlusion lie anyway.
 *
 * The polylines rebuild only when the anchor moves or scene time leaves the sampled day —
 * ~300 ephemeris calls per rebuild, entry/day-cross only, never per frame.
 */
export interface DayArcsHandle {
  group: THREE.Group;
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Scene time (ms) — drives the past/future split and the day-window rebuild check. */
    sceneMs: number;
    /** FPV anchor (deg); null = not in FPV → the overlay eases out and hides. */
    anchor: { latDeg: number; lonDeg: number } | null;
    dtMs: number;
  }): void;
  dispose(): void;
}

/** Line/tick material — alpha-blended (NOT additive: an additive stroke vanishes against the
 *  bright day sky — browser-bisected; the planning arc must read at noon too, PhotoPills-style),
 *  depth-free; alpha = past/future split × horizon fade. */
function makeArcMaterial(color: string, alphaGain: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // analytic horizon fade owns occlusion (see module doc)
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uNow01: { value: 0 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aT01;
      attribute float aFade;
      varying float vT;
      varying float vF;
      void main() {
        vT = aT01;
        vF = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uNow01;
      uniform float uFade;
      varying float vT;
      varying float vF;
      void main() {
        float split = mix(${glf(DAYARC.alphaPast)}, ${glf(DAYARC.alphaFuture)}, step(uNow01, vT));
        float a = split * vF * uFade * ${glf(alphaGain)};
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
}

/** Per-vertex horizon melt — the arc dives visibly through rise/set instead of being clipped. */
function horizonFade(altDeg: number): number {
  const lo = DAYARC.horizonFadeLoDeg;
  const hi = DAYARC.horizonFadeHiDeg;
  const t = THREE.MathUtils.clamp((altDeg - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t); // smoothstep
}

export function attachDayArcs(scene: THREE.Scene): DayArcsHandle {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const bodies = (["sun", "moon"] as const).map((body) => {
    const color = body === "sun" ? tokens.sunGlow : tokens.moonlight;
    const lineMaterial = makeArcMaterial(color, 1);
    const tickMaterial = makeArcMaterial(color, DAYARC.tickAlphaGain);
    const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
    const ticks = new THREE.LineSegments(new THREE.BufferGeometry(), tickMaterial);
    for (const obj of [line, ticks]) {
      obj.raycast = () => {};
      obj.frustumCulled = false; // camera-anchored; re-placed every frame like the impostors
      obj.renderOrder = 10; // depth-free overlay draws after the world (per-object — a Group's renderOrder does NOT propagate)
      group.add(obj);
    }
    return { body, line, ticks, lineMaterial, tickMaterial, arc: null as DayArc | null };
  });

  let anchorLat = NaN;
  let anchorLon = NaN;
  let fade = 0;

  /** ENU→ECEF direction for one sampled point on the anchor's basis. */
  function pointDirs(
    points: readonly DayArcPoint[],
    basis: ReturnType<typeof enuBasis>,
    toXyz: (p: DayArcPoint) => readonly [number, number, number],
  ): Float32Array {
    const out = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const [e, n, u] = toXyz(points[i]);
      out[i * 3] = e * basis.east[0] + n * basis.north[0] + u * basis.up[0];
      out[i * 3 + 1] = e * basis.east[1] + n * basis.north[1] + u * basis.up[1];
      out[i * 3 + 2] = e * basis.east[2] + n * basis.north[2] + u * basis.up[2];
    }
    return out;
  }

  function rebuild(latDeg: number, lonDeg: number, sceneMs: number) {
    const basis = enuBasis(latDeg, lonDeg);
    for (const b of bodies) {
      const arc = sampleDayArc(b.body, sceneMs, latDeg, lonDeg, {
        stepMin: DAYARC.stepMin,
        tickEveryH: DAYARC.tickEveryH,
      });
      b.arc = arc;
      const show = arc.everUp;
      b.line.visible = show;
      b.ticks.visible = show;
      if (!show) continue;

      const linePos = pointDirs(arc.points, basis, (p) => azAltToEnu(p.azDeg, p.altDeg));
      const lineT = new Float32Array(arc.points.map((p) => p.t01));
      const lineF = new Float32Array(arc.points.map((p) => horizonFade(p.altDeg)));
      b.line.geometry.dispose();
      b.line.geometry = new THREE.BufferGeometry();
      b.line.geometry.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
      b.line.geometry.setAttribute("aT01", new THREE.BufferAttribute(lineT, 1));
      b.line.geometry.setAttribute("aFade", new THREE.BufferAttribute(lineF, 1));

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
      b.ticks.geometry.dispose();
      b.ticks.geometry = new THREE.BufferGeometry();
      b.ticks.geometry.setAttribute("position", new THREE.BufferAttribute(tickPos, 3));
      b.ticks.geometry.setAttribute("aT01", new THREE.BufferAttribute(tickT, 1));
      b.ticks.geometry.setAttribute("aFade", new THREE.BufferAttribute(tickF, 1));
    }
  }

  return {
    group,
    update({ camera, sceneMs, anchor, dtMs }) {
      const target = anchor ? 1 : 0;
      fade += (target - fade) * (1 - Math.exp(-dtMs / DAYARC.fadeTauMs));
      if (fade < 0.01 && !anchor) {
        group.visible = false;
        return;
      }
      if (anchor) {
        const moved =
          Math.abs(anchor.latDeg - anchorLat) > 1e-7 ||
          Math.abs(anchor.lonDeg - anchorLon) > 1e-7;
        const arc0 = bodies[0].arc;
        const dayCrossed = !arc0 || sceneMs < arc0.startMs || sceneMs >= arc0.endMs;
        if (moved || dayCrossed) {
          anchorLat = anchor.latDeg;
          anchorLon = anchor.lonDeg;
          rebuild(anchorLat, anchorLon, sceneMs);
        }
      }
      group.visible = true;
      // Same distance function as the sky impostors — the discs sit ON their arcs.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );
      group.position.copy(camera.position);
      group.scale.setScalar(d);
      for (const b of bodies) {
        if (!b.arc) continue;
        const now01 = dayFraction(b.arc, sceneMs);
        b.lineMaterial.uniforms.uNow01.value = now01;
        b.tickMaterial.uniforms.uNow01.value = now01;
        b.lineMaterial.uniforms.uFade.value = fade;
        b.tickMaterial.uniforms.uFade.value = fade;
      }
    },
    dispose() {
      for (const b of bodies) {
        b.line.geometry.dispose();
        b.ticks.geometry.dispose();
        b.lineMaterial.dispose();
        b.tickMaterial.dispose();
      }
      scene.remove(group);
    },
  };
}
