import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { COMET, SKY_TARGET } from "../tuning";
import type { TargetKind } from "../../../lib/ephemeris/targets";
import { DITHER_GLSL, glf } from "./glsl";
import { HORIZON_FADE_GLSL, horizonBandSin, horizonTerms } from "./sky";

/**
 * Sky-target tracer (ASTRO ENGINE phase A, 2026-08-03) — the 10P comet tracer of 2026-08-02
 * generalised to ANY tracked SkyTarget, rendered with the SAME machinery as the sun and the
 * moon: a camera-anchored impostor at `camera.far × SKY_TARGET.impostorFarFrac` (clamped into
 * the live near/far band — the load-bearing sun/moon lesson), depth-tested against the real
 * terrain and buildings, sliced by the shared analytic true-horizon fade.
 *
 * ONE additive billboard, three body treatments switched by a uniform (kind → mode):
 *   · COMET   — soft coma + anti-sunward fanning tail (the shipped 10P look, verbatim)
 *   · POINT   — star-like core + halo for planets / stars / asteroids, gain from magnitude
 *   · ELLIPSE — soft ellipse at the object's REAL major/minor arcmin + position angle for
 *               galaxies / nebulae / clusters (the `apparent` field is why it exists)
 * plus the house marker: a BROKEN hairline ring + four axis ticks (owner spec 2026-08-03 —
 * "thin and subtle, the sky must be visible through it"), radius widened per-target so it
 * frames an extended object instead of cutting through it.
 *
 * HONESTY (the SKY_TARGET tuning contract): most of these bodies would be sub-pixel at true
 * angular size — the point/coma marks are an INSTRUMENT OVERLAY at stylized size and gain.
 * The DIRECTION, the horizon slice, the ellipse extents/orientation and every panel number are
 * the real ephemeris/catalog. The tick-mask trap from the comet session carries over: tick width
 * is PERPENDICULAR distance to the nearest axis, never an angular wedge.
 */
export interface SkyTargetHandle {
  mesh: THREE.Mesh;
  /** Angular click radius (deg of sky) around the tracked direction — the CURRENT ring radius
   *  (it widens for extended objects) plus a little slack; the phase-C marker-click hit test. */
  hitRadiusDeg(): number;
  /** Post-update hover boost (qol3 hover affordance): multiplies THIS FRAME's additive gains
   *  (uAmp/uMarkFade/uBodyFade) — update() reassigns them every frame, so the orchestrator
   *  must call this immediately after update(). k = 0 is a no-op. */
  hoverBoost(k: number): void;
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Geodetic camera altitude (m) — the orchestrator's shared sample (tunables contract). */
    alt: number;
    /** Unit direction TO the target (world/ECEF). */
    dir: THREE.Vector3;
    /** Unit anti-sunward direction at the target (world/ECEF) — comets only, else null. */
    tailDir: THREE.Vector3 | null;
    /** Unit direction TO the sun (world/ECEF) — drives the night gate AND the planet-disc
     *  phase lighting (phase D). */
    sunDir: THREE.Vector3;
    kind: TargetKind;
    /** Predicted visual magnitude — drives the point/ellipse gain (null = adopt a faint floor). */
    magnitude: number | null;
    /** Real apparent extents for DSOs — null renders the point treatment. */
    apparent: { majorArcmin: number; minorArcmin: number; paDeg: number } | null;
    /** True apparent diameter (arcsec) — engine bodies only; selects the phase-lit disc
     *  treatment for planets (phase D). */
    angularDiamArcsec: number | null;
    /** Ring-plane normal (world/ECEF, unit) — Saturn only; orients the ring ellipse. */
    ringPoleDir: THREE.Vector3 | null;
    /** Master toggle (store/sky, persisted view pref). */
    visible: boolean;
    /** Highlight reticle — also lifts a daylight floor so the tracer stays findable by day. */
    highlight: boolean;
  }): void;
  dispose(): void;
}

/** Billboard half-extent in degrees of sky — everything below is a fraction of it. Sized by the
 *  comet tail (the largest treatment); M31's 1.6° semi-major also fits with ring headroom. */
const SPAN_DEG = Math.max(
  COMET.tailLenDeg,
  SKY_TARGET.reticleRadDeg * 1.35,
  COMET.comaAngRadDeg * COMET.comaGlowExtent,
);
const COMA_N = COMET.comaAngRadDeg / SPAN_DEG;
const TAIL_LEN_N = COMET.tailLenDeg / SPAN_DEG;
const TAIL_WIDTH_N = COMET.tailWidthDeg / SPAN_DEG;
const RING_W_N = (SKY_TARGET.reticleRadDeg * SKY_TARGET.reticleWidthFrac) / SPAN_DEG;
const POINT_N = SKY_TARGET.pointCoreDeg / SPAN_DEG;

/** Additive gain from magnitude — a linear ramp, NOT a photometric flux law: a mag −4 Venus at
 *  true flux ratio would be 10⁷× Pluto and unrenderable. Overlay grammar, floor kept visible. */
function pointAmp(magnitude: number | null): number {
  if (magnitude == null) return 0.35;
  return THREE.MathUtils.clamp(1.05 - 0.07 * magnitude, 0.12, 1.5);
}

export function attachSkyTarget(scene: THREE.Scene): SkyTargetHandle {
  const uniforms = {
    uComa: { value: new THREE.Color(tokens.cometComa) },
    uTail: { value: new THREE.Color(tokens.cometTail) },
    uBody: { value: new THREE.Color(tokens.star) },
    uMark: { value: new THREE.Color(tokens.accent) },
    /** 0 = comet · 1 = point · 2 = ellipse. */
    uMode: { value: 1 },
    /** Point/ellipse additive gain (magnitude-derived). */
    uAmp: { value: 1 },
    /** Ring radius + tick outer radius, normalized to the billboard half-extent. */
    uRingRadN: { value: SKY_TARGET.reticleRadDeg / SPAN_DEG },
    uTickOutN: {
      value: (SKY_TARGET.reticleRadDeg * (1 + SKY_TARGET.reticleTickFrac)) / SPAN_DEG,
    },
    /** Ellipse: (a⁻², b⁻², cos rot, sin rot) in normalized plane units. */
    uEllipse: { value: new THREE.Vector4(1, 1, 1, 0) },
    /** Planet disc angular radius, normalized to the billboard half-extent (phase D). */
    uDiscRadN: { value: 0.1 },
    /** Sun direction in billboard-local coords — phase-lights the disc (the moon's grammar). */
    uSunLocal: { value: new THREE.Vector3(0, 0, 1) },
    /** Saturn ring: (cos, sin) rotating the plane so +q.y runs along the projected pole,
     *  z = SIGNED sin(ring opening B) (sign picks which arm passes in front), w = enable. */
    uRing: { value: new THREE.Vector4(1, 0, 0, 0) },
    /** Coma/tail/point presence (night gate, no floor — a body lost in daylight is not there). */
    uBodyFade: { value: 0 },
    /** Reticle presence (night gate lifted by COMET.highlightDayFloor; 0 = highlight off). */
    uMarkFade: { value: 0 },
    uHorizonUp: { value: new THREE.Vector3(0, 0, 1) },
    uSinHor: { value: 0 },
    uHorizonBandSin: { value: horizonBandSin(0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uComa;
      uniform vec3 uTail;
      uniform vec3 uBody;
      uniform vec3 uMark;
      uniform float uMode;
      uniform float uAmp;
      uniform float uRingRadN;
      uniform float uTickOutN;
      uniform vec4 uEllipse;
      uniform float uDiscRadN;
      uniform vec3 uSunLocal;
      uniform vec4 uRing;
      uniform float uBodyFade;
      uniform float uMarkFade;
      varying vec2 vUv;
      varying vec3 vW;
      ${HORIZON_FADE_GLSL}
      void main() {
        // Plane space: p in [-1,1]². Comet: +X = the projected anti-sunward (tail) direction.
        // Ellipse: +Y = projected celestial north, rot carries the position angle.
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);

        vec3 body = vec3(0.0);
        if (uMode < 0.5) {
          // --- comet: soft core + halo, fanning anti-sunward wedge (the shipped 10P look) ----
          float core = 1.0 - smoothstep(${glf(COMA_N * 0.55)}, ${glf(COMA_N)}, r);
          float halo = exp(-max(r - ${glf(COMA_N)}, 0.0) / ${glf(COMA_N * 1.7)});
          float coma = (core + halo * 0.55) * ${glf(COMET.comaIntensity)};
          float t = clamp(p.x / ${glf(TAIL_LEN_N)}, 0.0, 1.0);
          float w = ${glf(TAIL_WIDTH_N)} * (0.35 + 0.65 * t);        // real dust tails fan out
          float lateral = exp(-(p.y * p.y) / (w * w) * 2.5);
          float axial = pow(1.0 - t, 1.5) * step(0.0, p.x) * step(p.x, ${glf(TAIL_LEN_N)});
          float tail = lateral * axial * ${glf(COMET.tailIntensity)};
          body = uComa * coma + uTail * tail;
        } else if (uMode < 1.5) {
          // --- point body: star-like core + exponential halo, gain from magnitude ------------
          float core = 1.0 - smoothstep(${glf(POINT_N * 0.55)}, ${glf(POINT_N)}, r);
          float halo = exp(-max(r - ${glf(POINT_N)}, 0.0) / ${glf(POINT_N * 2.2)});
          body = uBody * (core + halo * 0.5) * uAmp;
        } else if (uMode < 2.5) {
          // --- extended object: soft ellipse at REAL apparent extents + position angle -------
          vec2 q = vec2(
            p.x * uEllipse.z + p.y * uEllipse.w,
            -p.x * uEllipse.w + p.y * uEllipse.z
          );
          float e2 = q.x * q.x * uEllipse.x + q.y * q.y * uEllipse.y;
          float ell = exp(-e2 * 1.8);
          float core = 1.0 - smoothstep(${glf(POINT_N * 0.4)}, ${glf(POINT_N * 0.8)}, r);
          body = uBody * (ell + core * 0.5) * uAmp;
        } else {
          // --- planet: disc phase-lit by the REAL sun (the moon's lambert on a billboard) ----
          // Fake sphere normal from the in-plane coords; uSunLocal is the world sun direction
          // expressed in the billboard basis (+Y = projected celestial north), so the
          // terminator's shape AND orientation are the true phase geometry.
          vec2 pd = p / uDiscRadN;
          float rd = length(pd);
          float inDisc = 1.0 - smoothstep(0.92, 1.0, rd);
          vec3 n = vec3(pd, sqrt(max(1.0 - dot(pd, pd), 0.0)));
          float lit = pow(max(dot(n, normalize(uSunLocal)), 0.0), 0.8);
          body = uBody * inDisc * (0.04 + lit) * uAmp;
          if (uRing.w > 0.5) {
            // Saturn's ring band: a flat annulus in the ring plane, projected = ellipse squashed
            // by |sin B| along the projected pole (+q.y). Radii in planet radii are physical
            // (C-ring inner 1.24 → A-ring outer 2.27, Cassini division at ~1.95).
            vec2 q = vec2(p.x * uRing.x - p.y * uRing.y, p.x * uRing.y + p.y * uRing.x);
            float squash = max(abs(uRing.z), 0.06);
            float rr = length(vec2(q.x, q.y / squash)) / uDiscRadN;
            float band = smoothstep(1.16, 1.32, rr) * (1.0 - smoothstep(2.05, 2.35, rr));
            band *= 1.0 - 0.45 * smoothstep(1.88, 1.95, rr) * (1.0 - smoothstep(1.99, 2.06, rr));
            // The arm on the pole's camera side passes BEHIND the disc — mask it there.
            float behind = step(0.0, q.y * uRing.z) * (1.0 - smoothstep(0.98, 1.0, rd));
            body += uBody * band * (1.0 - behind) * uAmp * ${glf(SKY_TARGET.ringGain)};
          }
        }

        // --- highlight reticle: BROKEN hairline ring + four axis ticks (house marker spec) ---
        float a = atan(p.y, p.x);
        float quad = abs(fract(a * ${glf(2.0 / Math.PI)} + 0.5) - 0.5) * 2.0; // 0 on axis → 1 at 45°
        float arc = smoothstep(${glf(SKY_TARGET.reticleGapFrac)}, ${glf(SKY_TARGET.reticleGapFrac + 0.12)}, quad);
        float ringBand = smoothstep(${glf(RING_W_N)}, 0.0, abs(r - uRingRadN));
        float ring = ringBand * arc;
        // Ticks live IN the gaps (on the axes), pointing outward from the ring. Width is the
        // PERPENDICULAR distance to the nearest axis — an angular wedge is constant-arc and drew
        // blobs at this radius (comet session trap).
        float axisDist = min(abs(p.x), abs(p.y));
        float tickAng = smoothstep(${glf(RING_W_N)}, 0.0, axisDist);
        float tickRad =
          smoothstep(uRingRadN, uRingRadN + ${glf(RING_W_N * 2.0)}, r) *
          (1.0 - smoothstep(uTickOutN - ${glf(RING_W_N * 2.0)}, uTickOutN, r));
        float mark = (ring + tickAng * tickRad) * ${glf(SKY_TARGET.reticleIntensity)};

        float hf = horizonFade(vW);
        vec3 color = body * uBodyFade * hf + uMark * mark * uMarkFade * hf;
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, 1.0); // additive: rgb carries everything
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false; // re-anchored every frame — stale bounds must never cull it
  // No mesh raycast — the billboard is far bigger than the visible mark and would steal ground
  // clicks. Clicking the marker goes through the ANGULAR hit test instead (hitRadiusDeg + the
  // tracked direction, in the orchestrator's pointer-up), phase C.
  mesh.raycast = () => {};
  mesh.visible = false;
  scene.add(mesh);

  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _north = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const NORTH = new THREE.Vector3(0, 0, 1); // ECEF celestial-pole side for the PA reference
  let currentRingRadDeg: number = SKY_TARGET.reticleRadDeg; // tracks the per-target widening

  return {
    mesh,
    hitRadiusDeg: () => currentRingRadDeg * SKY_TARGET.clickSlack,
    hoverBoost(k) {
      if (k <= 0 || !mesh.visible) return;
      uniforms.uAmp.value *= 1 + k;
      uniforms.uMarkFade.value = Math.min(uniforms.uMarkFade.value * (1 + k), 1);
      uniforms.uBodyFade.value = Math.min(uniforms.uBodyFade.value * (1 + k), 1);
    },
    update({
      camera,
      alt,
      dir,
      tailDir,
      sunDir,
      kind,
      magnitude,
      apparent,
      angularDiamArcsec,
      ringPoleDir,
      visible,
      highlight,
    }) {
      if (!visible) {
        mesh.visible = false;
        return;
      }
      // Night gate — the star-field's grammar over sin(sun elevation) AT THE CAMERA.
      _up.copy(camera.position).normalize();
      const sunEl = sunDir.dot(_up);
      const night = THREE.MathUtils.clamp(
        (SKY_TARGET.nightVisStartSin - sunEl) /
          (SKY_TARGET.nightVisStartSin - SKY_TARGET.nightVisFullSin),
        0,
        1,
      );
      const markFade = highlight ? Math.max(night, SKY_TARGET.highlightDayFloor) : 0;
      mesh.visible = night > 0.01 || markFade > 0.01;
      if (!mesh.visible) return;
      uniforms.uBodyFade.value = night;
      uniforms.uMarkFade.value = markFade;

      // Treatment: comet look for comets; phase-lit disc for planets (phase D); real-extent
      // ellipse for DSOs that carry one; point otherwise. Gains are magnitude-derived (overlay
      // grammar — see the header note).
      const isComet = kind === "comet";
      const isPlanet = !isComet && kind === "planet" && angularDiamArcsec != null;
      const isEllipse = !isComet && !isPlanet && apparent != null && apparent.majorArcmin > 6;
      uniforms.uMode.value = isComet ? 0 : isPlanet ? 3 : isEllipse ? 2 : 1;
      uniforms.uAmp.value = isEllipse
        ? Math.max(0.25, pointAmp(magnitude) * 0.9)
        : pointAmp(magnitude);

      // Ring widens to frame an extended object instead of slicing through it.
      let ringRadDeg: number = SKY_TARGET.reticleRadDeg;
      if (isEllipse && apparent) {
        const majDeg = Math.min(apparent.majorArcmin / 60, SPAN_DEG * 1.2);
        const minDeg = Math.min(apparent.minorArcmin / 60, majDeg);
        ringRadDeg = Math.min(Math.max(ringRadDeg, (majDeg / 2) * 1.35), SPAN_DEG / 1.3);
        const aN = Math.max(majDeg / 2 / SPAN_DEG, POINT_N);
        const bN = Math.max(minDeg / 2 / SPAN_DEG, POINT_N * 0.6);
        const rot = THREE.MathUtils.degToRad(apparent.paDeg);
        uniforms.uEllipse.value.set(1 / (aN * aN), 1 / (bN * bN), Math.cos(rot), Math.sin(rot));
      }
      currentRingRadDeg = ringRadDeg;
      uniforms.uRingRadN.value = ringRadDeg / SPAN_DEG;
      uniforms.uTickOutN.value = (ringRadDeg * (1 + SKY_TARGET.reticleTickFrac)) / SPAN_DEG;

      // Shared true-horizon terms (float64 on the CPU — see scene/sky.ts).
      uniforms.uSinHor.value = horizonTerms(camera.position, uniforms.uHorizonUp.value);
      uniforms.uHorizonBandSin.value = horizonBandSin(alt);

      // Impostor distance: the sun/moon clamp — GlobeControls refits near/far every frame and an
      // unclamped 0.5·far anchor near-plane-clips when looking away from the earth.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY_TARGET.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );
      mesh.position.copy(camera.position).addScaledVector(dir, d);
      mesh.scale.setScalar(d * Math.tan(THREE.MathUtils.degToRad(SPAN_DEG)));

      // Billboard + in-plane roll: +Z toward the camera. Comets roll +X onto the projected tail
      // (a real tail always points anti-sunward); extended objects roll +Y onto projected
      // celestial north so the position angle is measured from the right reference; points take
      // camera-up (roll is invisible on a radial glow).
      _z.copy(dir).negate();
      if (isComet && tailDir) {
        _x.copy(tailDir).addScaledVector(dir, -tailDir.dot(dir));
        if (_x.lengthSq() < 1e-8) _x.copy(camera.up).addScaledVector(dir, -camera.up.dot(dir));
        _x.normalize();
        _y.crossVectors(_z, _x);
      } else {
        _north.copy(NORTH).addScaledVector(dir, -NORTH.dot(dir));
        if (_north.lengthSq() < 1e-8)
          _north.copy(camera.up).addScaledVector(dir, -camera.up.dot(dir));
        _y.copy(_north).normalize();
        _x.crossVectors(_y, _z);
      }
      _basis.makeBasis(_x, _y, _z);
      mesh.quaternion.setFromRotationMatrix(_basis);

      // Planet disc + ring uniforms — AFTER the basis: uSunLocal/uRing live in billboard space.
      if (isPlanet) {
        const discRadDeg = Math.max(
          angularDiamArcsec / 3600 / 2,
          SKY_TARGET.planetDiscMinDeg,
        );
        uniforms.uDiscRadN.value = discRadDeg / SPAN_DEG;
        // A disc reads best framed, not sliced: widen the reticle past the ring band when the
        // (floored) disc approaches it — same move the DSO ellipse makes.
        const discRingDeg = Math.max(
          SKY_TARGET.reticleRadDeg,
          discRadDeg * (ringPoleDir ? 2.6 : 1.6),
        );
        currentRingRadDeg = discRingDeg;
        uniforms.uRingRadN.value = discRingDeg / SPAN_DEG;
        uniforms.uTickOutN.value = (discRingDeg * (1 + SKY_TARGET.reticleTickFrac)) / SPAN_DEG;
        (uniforms.uSunLocal.value as THREE.Vector3).set(
          sunDir.dot(_x),
          sunDir.dot(_y),
          sunDir.dot(_z),
        );
        if (ringPoleDir) {
          const px = ringPoleDir.dot(_x);
          const py = ringPoleDir.dot(_y);
          const pz = ringPoleDir.dot(_z);
          const L = Math.hypot(px, py);
          // Rotate so +q.y runs along the projected pole; z = signed sin(B) (opening + which
          // arm crosses in front); degenerate face-on projection defaults the axes.
          (uniforms.uRing.value as THREE.Vector4).set(
            L > 1e-6 ? py / L : 1,
            L > 1e-6 ? px / L : 0,
            pz,
            1,
          );
        } else {
          (uniforms.uRing.value as THREE.Vector4).w = 0;
        }
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
