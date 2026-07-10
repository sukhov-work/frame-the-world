import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { GATES, STARS, WGS84_A } from "../tuning";
import { magToBright, magToSize, parseStarCatalog } from "../../../lib/ephemeris/stars";
import { glf } from "./glsl";

/**
 * Star-field — additive round soft stars with a subtle twinkle. Built on a UNIT sphere; each frame
 * it is re-centred on the camera and scaled to sit just behind Earth's near surface but INSIDE
 * GlobeControls' dynamic far plane (a fixed celestial sphere would be frustum-clipped away, which
 * is why stars were previously invisible). Tunables: STARS + GATES.
 *
 * Phase 4 (ADR D6): positions are the REAL Yale Bright Star Catalog (packed asset built by
 * `scripts/build-star-catalog.mjs`; layout contract in `lib/ephemeris/stars.ts`), baked in the
 * J2000 equatorial frame and rotated by −GAST about +Z per ephemeris sample (`update({gastRad})`)
 * so constellations sit correctly over the earth for the scene time — Polaris stays over the
 * north pole for free. Size/alpha follow the Pogson flux law (softened — see magToSize/magToBright).
 * Until the catalog fetch resolves (or if it fails offline) the old procedural random field
 * renders — honest degradation, never a blank sky.
 */
export interface StarsHandle {
  points: THREE.Points;
  /** Per-frame: visibility gate, camera-follow, altitude fade, twinkle clock, sidereal rotation. */
  update(ctx: {
    alt: number;
    camera: THREE.PerspectiveCamera;
    elapsedS: number;
    reduceMotion: boolean;
    /** Greenwich apparent sidereal time (rad) from the current ephemeris sample. */
    gastRad: number;
  }): void;
  dispose(): void;
}

/** Procedural fallback attributes (pre-catalog / fetch-failure): random sphere, random sizes. */
function proceduralGeometry(): THREE.BufferGeometry {
  const starPos = new Float32Array(STARS.count * 3);
  const aSize = new Float32Array(STARS.count);
  const aPhase = new Float32Array(STARS.count);
  const aBright = new Float32Array(STARS.count).fill(1);
  for (let i = 0; i < STARS.count; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = Math.sin(ph) * Math.sin(th);
    starPos[i * 3 + 2] = Math.cos(ph);
    const m = Math.random();
    aSize[i] = m * m * STARS.sizeSpread + STARS.sizeBase; // a few bright, many faint (px, pre-DPR)
    aPhase[i] = Math.random() * Math.PI * 2;
  }
  return buildGeometry(starPos, aSize, aPhase, aBright);
}

function buildGeometry(
  pos: Float32Array,
  aSize: Float32Array,
  aPhase: Float32Array,
  aBright: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute("aBright", new THREE.BufferAttribute(aBright, 1));
  return geometry;
}

export function attachStars(scene: THREE.Scene, opts: { dpr: number }): StarsHandle {
  let geometry = proceduralGeometry();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(tokens.star) },
      uTime: { value: 0 },
      uDpr: { value: opts.dpr },
      uFade: { value: 1 }, // altitude fade so stars leave cleanly on descent (no bleed over the ground)
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aBright;
      uniform float uTime;
      uniform float uDpr;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vB = (${glf(STARS.twinkleBase)} + ${glf(STARS.twinkleAmp)} * sin(uTime * ${glf(STARS.twinkleSpeed)} + aPhase)) * aBright;   // subtle twinkle × magnitude
        gl_PointSize = aSize * uDpr;                  // screen-space (no attenuation)
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying float vB;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d) * vB * ${glf(STARS.alpha)} * uFade;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.raycast = () => {};
  scene.add(points);

  // Real catalog swap — async; the procedural field covers the gap. A failed fetch (offline dev)
  // just keeps the fallback and says so once.
  let disposed = false;
  fetch(STARS.catalogUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      if (disposed) return;
      const cat = parseStarCatalog(buf);
      const aSize = new Float32Array(cat.count);
      const aPhase = new Float32Array(cat.count);
      const aBright = new Float32Array(cat.count);
      for (let i = 0; i < cat.count; i++) {
        aSize[i] = magToSize(cat.vmag[i], STARS);
        aBright[i] = magToBright(cat.vmag[i], STARS);
        aPhase[i] = Math.random() * Math.PI * 2;
      }
      const next = buildGeometry(cat.positions, aSize, aPhase, aBright);
      points.geometry = next;
      geometry.dispose();
      geometry = next;
    })
    .catch((e) => console.warn("[globe] star catalog unavailable — procedural fallback:", e));

  return {
    points,
    update({ alt, camera, elapsedS, reduceMotion, gastRad }) {
      // Stars are the high-altitude backdrop; visible from LEO, fading out on final descent so
      // they leave cleanly before the ground fills the view (no bleed over the near surface).
      const visible = alt > GATES.starFadeBottom;
      points.visible = visible;
      if (!visible) return;
      // Sidereal orientation: catalog positions are equatorial (x → RA 0h); −GAST about +Z maps
      // them to ECEF so each star stands over its correct longitude for the scene time. (The
      // procedural fallback is rotation-invariant — applying it there is harmless.)
      points.rotation.z = -gastRad;
      // Keep the star sphere centred on the camera, scaled to sit beyond the farthest visible
      // ground (the limb tangent distance — NOT the nadir altitude: from an oblique LEO POV the
      // slant range to terrain far exceeds alt, and an alt-scaled sphere puts star specks IN
      // FRONT of the ground). Clamped inside GlobeControls' dynamic far plane so it isn't culled.
      const limbDist = Math.sqrt(alt * (2 * WGS84_A + alt));
      points.position.copy(camera.position);
      points.scale.setScalar(Math.min(STARS.limbMargin * limbDist, camera.far * STARS.farClamp));
      material.uniforms.uFade.value = Math.min(1, (alt - GATES.starFadeBottom) / GATES.starFadeSpan);
      if (!reduceMotion) material.uniforms.uTime.value = elapsedS;
    },
    dispose() {
      disposed = true;
      geometry.dispose();
      material.dispose();
      scene.remove(points);
    },
  };
}
