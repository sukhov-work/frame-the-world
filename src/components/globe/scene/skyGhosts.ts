import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { GHOSTS, SKY_TARGET } from "../tuning";
import { azAltToEnu } from "../../../lib/ephemeris/dayArc";
import { targetAzAlt, type SkyTarget } from "../../../lib/ephemeris/targets";
import { enuBasis } from "../../../lib/geo/projection";
import { glf } from "./glsl";

/**
 * Temporal ghost copies of the tracked body (QoL-2, owner 2026-08-14): the target rendered as
 * soft disc billboards at scene time ± k·step (symmetric, user-set count/step — store/sky),
 * opacity falling with temporal distance, the past side dimmed under the future. With a small
 * scrub the chain slides along the trajectory — the body's path reads PRECISELY against the
 * real surroundings (skyline, buildings), which is the whole point: framing a sunset or a
 * moonrise over a landmark without leaving FPV.
 *
 * Grammar: the skyTrail sibling — same observer (plan anchor else view focus), same impostor
 * distance (the marker/ghosts/trail all sit on one sky shell), alpha-blended + depth-free
 * (additive vanishes against the day sky — the S6 lesson), per-ghost analytic horizon melt,
 * rebuilds deadbanded (a scrub step or an anchor move — never per frame). ONE InstancedMesh,
 * per-instance alpha/scale; billboard orientation follows the camera every frame (cheap: ≤16).
 *
 * Sun/moon ghosts render at the body's TRUE apparent size (they became trackable targets the
 * same session — `bodyTarget`), everything else at the GHOSTS.minDiscDeg readable floor.
 */
export interface SkyGhostsHandle {
  mesh: THREE.InstancedMesh;
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Scene time (ms) — the chain centre. */
    sceneMs: number;
    /** The tracked target — the SAME object the marker/trail follow. */
    target: SkyTarget;
    /** The observer (the panel's eye); null hides the ghosts. */
    anchor: { latDeg: number; lonDeg: number } | null;
    /** SHOW && GHOSTS (store/sky). */
    visible: boolean;
    /** Ghost copies per direction (store/sky, clamped ≤ GHOSTS.maxPerSide). */
    countPerSide: number;
    /** Minutes between copies (store/sky). */
    stepMin: number;
    dtMs: number;
  }): void;
  dispose(): void;
}

const MAX_INSTANCES = GHOSTS.maxPerSide * 2;

interface GhostSample {
  /** Unit ENU direction (east, north, up). */
  enu: [number, number, number];
  /** Altitude (deg) — drives the horizon melt. */
  altDeg: number;
  /** Signed step index (−count..−1, +1..+count). */
  k: number;
}

export function attachSkyGhosts(scene: THREE.Scene): SkyGhostsHandle {
  const uColor = { value: new THREE.Color(tokens.accent) };
  const uFade = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor, uFade },
    transparent: true,
    depthWrite: false,
    depthTest: false, // planning overlay — the analytic horizon melt owns occlusion (dayArcs)
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        // Soft-edged disc with a faint solid core — reads as a translucent body, not a blob.
        float edge = 1.0 - smoothstep(${glf(1 - GHOSTS.edgeSoftness)}, 1.0, r);
        gl_FragColor = vec4(uColor, edge * vAlpha * uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX_INSTANCES);
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);
  mesh.geometry.setAttribute("aAlpha", alphaAttr);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false; // camera-anchored — stale bounds must never cull it
  mesh.raycast = () => {};
  mesh.renderOrder = 10; // depth-free overlay draws after the world (the dayArcs discipline)
  scene.add(mesh);

  let samples: GhostSample[] = [];
  let sampledMs = NaN;
  let sampledKey = "";
  let discRad = (GHOSTS.minDiscDeg * Math.PI) / 360; // half-angle, rad
  let fade = 0;
  let basis: ReturnType<typeof enuBasis> | null = null;

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _scale = new THREE.Vector3();

  function resample(
    target: SkyTarget,
    anchor: { latDeg: number; lonDeg: number },
    sceneMs: number,
    countPerSide: number,
    stepMin: number,
  ) {
    basis = enuBasis(anchor.latDeg, anchor.lonDeg);
    const n = Math.max(1, Math.min(GHOSTS.maxPerSide, Math.round(countPerSide)));
    const stepMs = Math.max(1, Math.round(stepMin)) * 60_000;
    // True apparent size where the target knows one (sun/moon/planets), floored for points.
    const st = target.stateAt(sceneMs);
    const trueRad = st.angularDiamArcsec ? (st.angularDiamArcsec / 3600 / 2) * (Math.PI / 180) : 0;
    discRad = Math.max(trueRad, (GHOSTS.minDiscDeg * Math.PI) / 360);
    // The real body owns "now" AND its own disc (owner 2026-08-14 round 3): at small steps the
    // k=±1 ghosts land ON the moon's disc and their alpha blend visibly dims a bite out of it —
    // skip any ghost whose centre is within nowGapDiscs disc-DIAMETERS of the now direction.
    const p0 = targetAzAlt(target, sceneMs, anchor.latDeg, anchor.lonDeg);
    const now = azAltToEnu(p0.azDeg, p0.altDeg);
    const minSepCos = Math.cos(2 * discRad * GHOSTS.nowGapDiscs);
    samples = [];
    for (let k = -n; k <= n; k++) {
      if (k === 0) continue;
      const p = targetAzAlt(target, sceneMs + k * stepMs, anchor.latDeg, anchor.lonDeg);
      if (p.altDeg < GHOSTS.horizonFadeLoDeg) continue; // fully melted — skip the instance
      const enu = azAltToEnu(p.azDeg, p.altDeg);
      if (enu[0] * now[0] + enu[1] * now[1] + enu[2] * now[2] > minSepCos) continue; // on the disc
      samples.push({ enu, altDeg: p.altDeg, k });
    }
    // Body-coded colour (D14 tokens): the sun warm, the moon cool, everything else accent.
    uColor.value.set(
      target.kind === "sun" ? tokens.sunGlow : target.kind === "moon" ? tokens.moonlight : tokens.accent,
    );
    sampledMs = sceneMs;
  }

  return {
    mesh,
    update({ camera, sceneMs, target, anchor, visible, countPerSide, stepMin, dtMs }) {
      const want = visible && anchor !== null;
      const targetFade = want ? 1 : 0;
      fade += (targetFade - fade) * (1 - Math.exp(-dtMs / GHOSTS.fadeTauMs));
      if (fade < 0.01 && !want) {
        mesh.visible = false;
        return;
      }
      if (want && anchor) {
        // Rebuild key: target/anchor/knobs — plus the scene-time quantum (scrubbing slides the
        // chain; a paused scene costs zero ephemeris calls).
        const key = `${target.id}|${anchor.latDeg.toFixed(3)}|${anchor.lonDeg.toFixed(3)}|${countPerSide}|${stepMin}`;
        if (key !== sampledKey || Math.abs(sceneMs - sampledMs) >= GHOSTS.resampleMs) {
          sampledKey = key;
          resample(target, anchor, sceneMs, countPerSide, stepMin);
        }
      }
      if (!basis || samples.length === 0) {
        mesh.visible = fade >= 0.01;
        mesh.count = 0;
        return;
      }
      mesh.visible = true;
      // The marker/trail sky shell: same impostor distance — ghosts sit ON the trail.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY_TARGET.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );
      const size = 2 * Math.tan(discRad) * d; // world size of the disc plane at distance d
      _q.copy(camera.quaternion); // billboards
      _scale.setScalar(size);
      const n = samples.length;
      const maxK = samples.reduce((m, s) => Math.max(m, Math.abs(s.k)), 1);
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        // ENU → world via the anchor basis (the dayArcs pointDirs math, one point at a time).
        _dir.set(
          s.enu[0] * basis.east[0] + s.enu[1] * basis.north[0] + s.enu[2] * basis.up[0],
          s.enu[0] * basis.east[1] + s.enu[1] * basis.north[1] + s.enu[2] * basis.up[1],
          s.enu[0] * basis.east[2] + s.enu[1] * basis.north[2] + s.enu[2] * basis.up[2],
        );
        _pos.copy(camera.position).addScaledVector(_dir, d);
        _m.compose(_pos, _q, _scale);
        mesh.setMatrixAt(i, _m);
        // Temporal ramp: near neighbours loudest, the chain tail whispers; past side dimmed.
        const ramp =
          GHOSTS.alphaNear +
          (GHOSTS.alphaFar - GHOSTS.alphaNear) * ((Math.abs(s.k) - 1) / Math.max(1, maxK - 1));
        const past = s.k < 0 ? GHOSTS.pastDim : 1;
        const melt = THREE.MathUtils.smoothstep(
          s.altDeg,
          GHOSTS.horizonFadeLoDeg,
          GHOSTS.horizonFadeHiDeg,
        );
        alphaAttr.setX(i, ramp * past * melt);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      uFade.value = fade;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
