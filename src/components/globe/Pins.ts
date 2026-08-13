import * as THREE from "three";
import { geodeticToEcef } from "../../lib/geo/projection";
import { sampleGroundM } from "../../lib/geo/terrain";
import {
  clusterLayout,
  hash01,
  pinHueIndex,
  proximityFactor,
  ringRadiusM,
  trueBlend,
  type ClusterLayout,
} from "../../lib/pins/appearance";
import { tokens } from "../../lib/theme/tokens";
import type { PublicPin } from "../../store/pins";
import { PINS } from "./tuning";
import { glf } from "./scene/glsl";

/**
 * Pins — public pins on the shared globe (Phase 5; look reworked Phase 5.5 S4, §Item 6).
 *
 * Each pin is three instanced draws sharing one angular-constant head radius (`size`):
 *   • STEM — thin cylinder from the ground, vertex-alpha fading to the base;
 *   • HEAD — floating sphere: semi-transparent core, fresnel rim, per-instance shimmer
 *     (phase + rate hashed from the pin id — calm breathing, never a blink);
 *   • FLARE — additive camera-facing cross sprite, visible only at the shimmer's peaks.
 * Per-author hue: hash(authorName) → the token pin palette (lib/pins/appearance); stems/heads/
 * flares share the instance colour. Colocated pins (one gh6 cell) de-cluster ADAPTIVELY by
 * camera→cluster distance (owner 2026-07-11 — pins stay vertical, no lean): FAR = one marker
 * (hover names the count, click dives); MID = a min-separation ring (screen-constant, world
 * radius shrinks with zoom) blending to TRUE coordinates once real separation suffices;
 * NEAR = folded onto the truthful coordinates, stem-height stagger keeping identical-spot
 * pins selectable. A SELECTED pin eases to its truth at any range.
 *
 * Picking: the HEADS keep their default raycast (stems + flares are raycast-noop decorations) —
 * the orchestrator raycasts them for the click fly-to AND the S4 hover (enlarge + HTML card).
 * Terrain: stems root at `ground + liftM`; ground height comes from terrainHeightAt (Cesium
 * World Terrain raycast) and re-resolves lazily as tiles refine (same idea as frustum.resnap).
 *
 * PRECISION (owner-reported flicker at close zoom): ECEF coordinates are ~6.4e6 m, and both
 * the view matrix and instance translations upload as float32 — a large×large cancellation on
 * the GPU quantises at ~0.5 m, which CRAWLS as the camera moves (the PhotoFrustum lesson).
 * Fix: every matrix rebuild anchors all three meshes AT THE CAMERA (mesh.position = camera)
 * with instance translations relative to it — the large cancellation then happens on the CPU
 * in float64 (modelViewMatrix), and the shaders use the modelViewMatrix path exclusively.
 */

export interface PinsHandle {
  /** The pickable draw (heads) — kept name `mesh` so orchestrator picking stays unchanged. */
  mesh: THREE.InstancedMesh;
  setPins(pins: PublicPin[]): void;
  update(camera: THREE.PerspectiveCamera): void;
  /** Master visibility (owner 2026-07-15, PIN chip / FPV declutter). Hidden pins also stop
   *  picking — update() re-sets mesh.visible per frame, so this flag is the ONE gate. */
  setVisible(on: boolean): void;
  /** Re-ask the terrain for ground height under the pins (cheap, call at low cadence). */
  resnap(): void;
  /** The pin under the pointer ray, or null. */
  pick(raycaster: THREE.Raycaster): PublicPin | null;
  /** Pulse-highlight one pin for PINS.highlightMs (post-save landing beacon); null clears. */
  setHighlight(pinId: string | null): void;
  /** Hover state (S4): the hovered pin eases up hoverScale× and glows; null clears. */
  setHover(pinId: string | null): void;
  /** Selected pin (the orchestrator mirrors viewingPinId): eases to its TRUE location. */
  setSelected(pinId: string | null): void;
  /** Cluster info for a pin: member count + whether it currently renders collapsed. */
  clusterState(pinId: string): { count: number; collapsed: boolean } | null;
  /** World position of the hovered pin's head centre (for the HTML card anchor), or null. */
  hoverAnchor(out: THREE.Vector3): THREE.Vector3 | null;
  dispose(): void;
}

/** Shared shimmer curve (head + flare stay in sync): slow sine, phase + rate from the seed. */
const SHIMMER_GLSL = /* glsl */ `
  float shimmer(float seed, float t) {
    float rate = ${glf(PINS.shimmerSpeed)} * (0.75 + 0.5 * fract(seed * 7.13));
    return 0.5 + 0.5 * sin(t * rate + seed * 6.2831853);
  }`;

export function attachPins(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
  } = {},
): PinsHandle {
  const cap = PINS.maxRender;

  // Per-instance data shared by the three draws: colour (author hue) + seed (shimmer phase).
  // Own explicit attributes — no reliance on three's instanceColor define dance.
  const colorArr = new Float32Array(cap * 3);
  const seedArr = new Float32Array(cap);
  const hoverArr = new Float32Array(cap); // eased hover amount, mirrored for the head shader
  const makeInstanced = (geometry: THREE.BufferGeometry) => {
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colorArr, 3));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seedArr, 1));
    return geometry;
  };

  const uTime = { value: 0 }; // ONE clock, referenced by head + flare materials

  // --- HEAD: sphere, semi-transparent core + fresnel rim + shimmer. The pickable draw.
  //     Hover (aHover, eased): brighten + solidify (alpha rest → hover level) — the enlarge
  //     happens in the instance matrix, in place. --------------------------------------------
  const headGeometry = makeInstanced(new THREE.SphereGeometry(1, 16, 12));
  headGeometry.setAttribute("aHover", new THREE.InstancedBufferAttribute(hoverArr, 1));
  const headMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false, // a translucent signal — never punches holes into the ground/buildings
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSeed;
      attribute float aHover;
      varying vec3 vColor;
      varying float vSeed;
      varying float vHover;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vColor = aColor;
        vSeed = aSeed;
        vHover = aHover;
        // modelViewMatrix path ONLY — the large ECEF cancellation already happened on the CPU
        // in float64 (mesh anchored at the camera); mixing modelMatrix/viewMatrix here would
        // reintroduce the float32 jitter this layout exists to kill.
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        vNormalV = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vSeed;
      varying float vHover;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      uniform float uTime;
      ${SHIMMER_GLSL}
      void main() {
        vec3 V = normalize(-vPosV); // view space: the camera sits at the origin
        float fres = pow(1.0 - abs(dot(normalize(vNormalV), V)), ${glf(PINS.headRimPow)});
        float s = shimmer(vSeed, uTime);
        float glow = 1.0 + ${glf(PINS.shimmerAmp)} * (s * 2.0 - 1.0);
        glow *= 1.0 + ${glf(PINS.hoverBrighten)} * vHover; // hover: brighten…
        float rim = fres * ${glf(PINS.headRimGain)};
        // Core keeps the author hue; the rim brightens toward white so the edge reads fine.
        vec3 color = (vColor + rim * mix(vColor, vec3(1.0), 0.55)) * glow;
        // …and solidify: rest alpha is airy, hover restores the full presence.
        float coreA = mix(${glf(PINS.headCoreAlpha)}, ${glf(PINS.headCoreAlphaHover)}, vHover);
        float alpha = clamp(coreA * glow + rim, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
      }`,
  });
  const heads = new THREE.InstancedMesh(headGeometry, headMaterial, cap);
  heads.count = 0;
  heads.frustumCulled = false; // instances span the whole planet
  heads.renderOrder = 1;
  scene.add(heads);

  // --- STEM: thin unit cylinder (base at origin, +Y up), vertex-alpha fade to the ground. ----
  const stemGeometry = makeInstanced(
    new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
  );
  const stemMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // a 6-gon tube this thin must not vanish edge-on
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor;
      varying float vY;
      void main() {
        vColor = aColor;
        vY = position.y; // 0 at the base, 1 at the top (pre-translated unit cylinder)
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vY;
      void main() {
        float alpha = ${glf(PINS.stemTopAlpha)} * vY * vY; // quadratic fade into the ground
        gl_FragColor = vec4(vColor * 0.85, alpha);
      }`,
  });
  const stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, cap);
  stems.count = 0;
  stems.frustumCulled = false;
  stems.raycast = () => {}; // decoration — the heads are the pick target
  stems.renderOrder = 0;
  scene.add(stems);

  // --- FLARE: additive billboard cross, gated to the shimmer peaks (same curve as the head).
  const flareGeometry = makeInstanced(new THREE.PlaneGeometry(2, 2));
  const flareMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vSeed;
      varying vec2 vUvC;
      void main() {
        vColor = aColor;
        vSeed = aSeed;
        vUvC = position.xy; // plane spans [-1, 1]²
        // Billboard in VIEW space (modelViewMatrix path — see the precision note): the quad
        // corners offset along the view axes directly, at the instance's uniform scale.
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scale = length(vec3(instanceMatrix[0]));
        gl_Position = projectionMatrix * vec4(centre.xyz + vec3(position.xy * scale, 0.0), 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vSeed;
      varying vec2 vUvC;
      uniform float uTime;
      ${SHIMMER_GLSL}
      void main() {
        float s = shimmer(vSeed, uTime);
        float peak = smoothstep(${glf(PINS.flareThreshold)}, 1.0, s);
        if (peak <= 0.001) discard;
        float ax = abs(vUvC.x);
        float ay = abs(vUvC.y);
        // Two soft arms + a tight core — the classic star-flare, kept calm.
        float armH = pow(max(0.0, 1.0 - ax), 3.0) * pow(max(0.0, 1.0 - ay * 7.0), 2.0);
        float armV = pow(max(0.0, 1.0 - ay), 3.0) * pow(max(0.0, 1.0 - ax * 7.0), 2.0);
        float core = pow(max(0.0, 1.0 - length(vUvC) * 2.4), 3.0);
        float c = (armH + armV) * 0.85 + core * 1.4;
        float a = c * peak * ${glf(PINS.flareGain)};
        gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.4) * a, a);
      }`,
  });
  const flares = new THREE.InstancedMesh(flareGeometry, flareMaterial, cap);
  flares.count = 0;
  flares.frustumCulled = false;
  flares.raycast = () => {};
  flares.renderOrder = 2;
  scene.add(flares);

  const meshes = [stems, heads, flares];

  let pins: PublicPin[] = [];
  const positions: THREE.Vector3[] = []; // TRUE stem base (ground + liftM), ECEF
  const displayed: THREE.Vector3[] = []; // per-frame render position (adaptive de-cluster)
  const visArr = new Float32Array(cap); // per-frame visibility (0 hides a collapsed member)
  const grounded: boolean[] = []; // true once real terrain height answered for this pin
  let layout: ClusterLayout = {
    stagger01: [],
    offsetE: [],
    offsetN: [],
    clusterOf: [],
    clusters: [],
  };
  let idToIndex = new Map<string, number>();
  let clusterMinSep: number[] = []; // min pairwise TRUE separation per cluster (m)
  let clusterSpreadLast = new Float32Array(0); // last frame's spread per cluster (0 = collapsed)

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qI = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _color = new THREE.Color();
  let dirty = true;
  let shown = true; // master visibility (PIN chip) — gates rendering AND picking
  let lastNow = performance.now();

  // Post-save pulse (Phase 5.5 S3): the highlighted pin breathes for PINS.highlightMs.
  let highlightId: string | null = null;
  let highlightIdx = -1;
  let highlightUntil = 0;
  const highlightScale = (now: number): number => {
    if (highlightIdx < 0 || now >= highlightUntil) return 1;
    const fade = Math.min(1, (highlightUntil - now) / 1500); // ease the pulse out, not a cut
    const wave = Math.sin((now / PINS.highlightPeriodMs) * Math.PI * 2);
    return 1 + PINS.highlightPulseAmp * fade * (0.5 + 0.5 * wave);
  };

  // Hover (S4): per-pin eased amount so the enlarge breathes in AND back out.
  let hoverIdx = -1;
  const hoverAmt = new Float32Array(cap);
  let hoverAnimating = false;

  // Selection (adaptive de-cluster): the selected pin eases toward its TRUE location.
  let selectedId: string | null = null;
  const selAmt = new Float32Array(cap);
  let selAnimating = false;

  // Clamp + no-latch (2026-08-13 audit A1): an out-of-range sample is coarse-LOD garbage — placed
  // clamped but kept `real:false` so resnap() re-resolves it as tiles refine (never latched).
  const groundHeight = (pin: PublicPin): { h: number; real: boolean } =>
    sampleGroundM(opts.terrainHeightAt?.(pin.lat, pin.lon), PINS.fallbackGroundM);

  const _east = new THREE.Vector3();
  const _north = new THREE.Vector3();
  const _centroid = new THREE.Vector3();
  const placePin = (i: number) => {
    const pin = pins[i];
    const { h, real } = groundHeight(pin);
    // The anchor is TRUTHFUL — exactly the pin's coordinates. The adaptive de-cluster only
    // ever moves the per-frame DISPLAYED copy: the frustum apex matches this point.
    const [x, y, z] = geodeticToEcef(pin.lat, pin.lon, h + PINS.liftM);
    (positions[i] ??= new THREE.Vector3()).set(x, y, z);
    (displayed[i] ??= new THREE.Vector3()).copy(positions[i]);
    grounded[i] = real;
  };

  /** Min pairwise TRUE separation per cluster (m) — the truth-handover signal. */
  const computeClusterSeps = () => {
    clusterMinSep = layout.clusters.map((members) => {
      let min = Infinity;
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          min = Math.min(min, positions[members[a]].distanceTo(positions[members[b]]));
        }
      }
      return Number.isFinite(min) ? min : 0;
    });
  };

  const invalidateBounds = () => {
    // TRAP: three caches InstancedMesh.boundingSphere on first raycast — GlobeControls
    // raycasts the scene BEFORE pins load (count 0 → EMPTY sphere), and a stale empty
    // sphere makes every later pick return nothing. Invalidate whenever instances change.
    heads.boundingSphere = null;
  };

  /** Stem world height (m) for pin i at head radius `size` — ONE derivation (matrices + anchor).
   *  The MIN clamp is stagger-scaled: a flat floor levelled every low-slot stem at street zoom
   *  (browser-caught: two merged heads coincided exactly), defeating the select-by-height merge. */
  const stemHeightM = (i: number, size: number): number => {
    const s = layout.stagger01[i] ?? 0.5;
    return THREE.MathUtils.clamp(
      size * (PINS.stemBaseFactor + PINS.stemSpreadFactor * s),
      PINS.stemMinM * (1 + s),
      PINS.stemMaxM,
    );
  };

  /** Head radius (m) at a render position — the ONE angular-size derivation. */
  const headSizeM = (p: THREE.Vector3, camera: THREE.PerspectiveCamera): number =>
    THREE.MathUtils.clamp(
      camera.position.distanceTo(p) * PINS.angularSize,
      PINS.minSizeM,
      PINS.maxSizeM,
    );

  return {
    mesh: heads,

    setPins(next: PublicPin[]) {
      pins = next.slice(0, PINS.maxRender);
      positions.length = pins.length;
      displayed.length = pins.length;
      grounded.length = pins.length;
      layout = clusterLayout(pins);
      idToIndex = new Map(pins.map((p, i) => [p.id, i]));
      for (let i = 0; i < pins.length; i++) {
        placePin(i);
        seedArr[i] = hash01(pins[i].id);
        const hue = pinHueIndex(pins[i].authorName, PINS.hueWeights, PINS.hueSalt);
        _color.set(tokens[PINS.hueTokens[hue] as keyof typeof tokens]);
        colorArr[i * 3] = _color.r;
        colorArr[i * 3 + 1] = _color.g;
        colorArr[i * 3 + 2] = _color.b;
      }
      computeClusterSeps();
      clusterSpreadLast = new Float32Array(layout.clusters.length);
      for (const g of [headGeometry, stemGeometry, flareGeometry]) {
        (g.getAttribute("aColor") as THREE.InstancedBufferAttribute).needsUpdate = true;
        (g.getAttribute("aSeed") as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
      for (const m of meshes) m.count = pins.length;
      highlightIdx = highlightId ? pins.findIndex((p) => p.id === highlightId) : -1;
      hoverIdx = -1; // indices moved — the next hover pick re-establishes it
      hoverAmt.fill(0);
      selAmt.fill(0); // the ease re-approaches if the selected pin survived the swap
      dirty = true;
      invalidateBounds();
    },

    update(camera: THREE.PerspectiveCamera) {
      const now = performance.now();
      const dtMs = Math.min(now - lastNow, 100);
      lastNow = now;
      uTime.value = now / 1000; // shimmer/flare clock — runs even when matrices are static
      if (pins.length === 0 || !shown) {
        for (const m of meshes) m.visible = false;
        return; // hidden: skip ALL per-frame matrix work too
      }
      for (const m of meshes) m.visible = true;

      // Hover + selection ease: the hovered pin breathes toward 1 (and back), the selected
      // pin walks toward its TRUE location (and back on deselect).
      const kh = 1 - Math.exp(-dtMs / PINS.hoverEaseTauMs);
      const ks = 1 - Math.exp(-dtMs / PINS.selectEaseTauMs);
      const selIdx = selectedId ? (idToIndex.get(selectedId) ?? -1) : -1;
      hoverAnimating = false;
      selAnimating = false;
      for (let i = 0; i < pins.length; i++) {
        const target = i === hoverIdx ? 1 : 0;
        const next = hoverAmt[i] + (target - hoverAmt[i]) * kh;
        hoverAmt[i] = Math.abs(next - target) < 0.004 ? target : next;
        if (hoverAmt[i] !== target) hoverAnimating = true;
        const sTarget = i === selIdx ? 1 : 0;
        const sNext = selAmt[i] + (sTarget - selAmt[i]) * ks;
        selAmt[i] = Math.abs(sNext - sTarget) < 0.004 ? sTarget : sNext;
        if (selAmt[i] !== sTarget) selAnimating = true;
      }

      const pulsing = highlightIdx >= 0 && now < highlightUntil;
      // Matrices only rebuild when the camera actually moved (or the pin set changed) — the
      // scale AND the adaptive de-cluster are distance-dependent, so a static camera needs no
      // per-frame work. Active pulse / hover / selection eases keep the rebuild running.
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      if (!dirty && !camMoved && !pulsing && !hoverAnimating && !selAnimating) return;
      _camLast.copy(camera.position);
      dirty = pulsing || hoverAnimating || selAnimating; // one settle pass after the last frame

      // --- Adaptive de-cluster (owner 2026-07-11): resolve every pin's DISPLAYED position +
      //     visibility for THIS camera. Solo pins sit at truth; cluster members collapse to
      //     one marker far out, spread on a min-separation ring mid-band, and blend to truth
      //     as real separation / the merge band / selection demand. -------------------------
      for (let i = 0; i < pins.length; i++) {
        displayed[i].copy(positions[i]);
        visArr[i] = 1;
      }
      for (let c = 0; c < layout.clusters.length; c++) {
        const members = layout.clusters[c];
        _centroid.set(0, 0, 0);
        for (const m of members) _centroid.add(positions[m]);
        _centroid.divideScalar(members.length);
        const dist = camera.position.distanceTo(_centroid);
        const sizeC = THREE.MathUtils.clamp(
          dist * PINS.angularSize,
          PINS.minSizeM,
          PINS.maxSizeM,
        );
        const sepM = PINS.clusterSepFrac * sizeC;
        const spread = proximityFactor(dist, PINS.clusterSpreadFullDistM, PINS.clusterSingleDistM);
        const merge = proximityFactor(dist, PINS.clusterMergeDistM, PINS.clusterMergeStartDistM);
        const wTrue = trueBlend(clusterMinSep[c], sepM);
        const ringR = ringRadiusM(members.length, sepM) * spread;
        clusterSpreadLast[c] = spread;
        _up.copy(_centroid).normalize();
        _east.set(-_centroid.y, _centroid.x, 0); // Z × up — degenerate only exactly at the poles
        if (_east.lengthSq() < 1e-9) _east.set(1, 0, 0);
        else _east.normalize();
        _north.crossVectors(_up, _east);
        for (const m of members) {
          const d = displayed[m]
            .copy(_centroid)
            .addScaledVector(_east, layout.offsetE[m] * ringR)
            .addScaledVector(_north, layout.offsetN[m] * ringR);
          // Truth handover: real separation suffices (wTrue), the near-ground merge folds the
          // ring onto exact coordinates, and a selected pin always walks home.
          d.lerp(positions[m], Math.max(wTrue, merge, selAmt[m]));
          // Collapsed range shows ONE representative; a selected member stays visible.
          visArr[m] = m === members[0] ? 1 : Math.max(spread, selAmt[m]);
        }
      }

      // Anchor the meshes AT the camera (precision note in the header): instance translations
      // become camera-relative and stay float32-exact near the viewer.
      for (const m of meshes) m.position.copy(camera.position);
      for (let i = 0; i < pins.length; i++) {
        const p = displayed[i];
        const vis = visArr[i];
        // LAYOUT (stem height + head centre) always uses the BASE size: hover/pulse must
        // grow the head IN PLACE. Scaling the layout moved the head out from under the
        // cursor → hover dropped → it fell back → the pin bounced (owner-reported).
        const size = headSizeM(p, camera) * vis; // vis: whole pin grows in / hides at 0
        const stemH = stemHeightM(i, size);
        let headScale = size;
        if (i === highlightIdx) headScale *= highlightScale(now);
        headScale *= 1 + (PINS.hoverScale - 1) * hoverAmt[i];
        hoverArr[i] = hoverAmt[i]; // shader brighten/solidify rides the same ease
        _up.copy(p).normalize();
        _q.setFromUnitVectors(_Y, _up);
        // Stem: base at the displayed anchor, thin needle up the local vertical.
        _s.set(size * PINS.stemWidthFrac, stemH, size * PINS.stemWidthFrac);
        _m.compose(_p.subVectors(p, camera.position), _q, _s);
        stems.setMatrixAt(i, _m);
        // Head: floats headGapFrac × size above the stem top.
        _p.addScaledVector(_up, stemH + size * (PINS.headGapFrac + 1));
        _s.setScalar(headScale);
        _m.compose(_p, _q, _s);
        heads.setMatrixAt(i, _m);
        // Flare: same centre, bigger quad (billboarded in the shader — rotation irrelevant).
        _s.setScalar(headScale * PINS.flareSizeFactor);
        _m.compose(_p, _qI, _s);
        flares.setMatrixAt(i, _m);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      (headGeometry.getAttribute("aHover") as THREE.InstancedBufferAttribute).needsUpdate = true;
      invalidateBounds(); // scales changed — see the setPins trap note
    },

    resnap() {
      // Re-resolve ground height for pins that never got a real terrain answer (tiles refine
      // over time). Real answers are kept — terrain height is stable once resolved.
      let changed = false;
      for (let i = 0; i < pins.length; i++) {
        if (grounded[i]) continue;
        const before = positions[i].y;
        placePin(i);
        if (positions[i].y !== before || grounded[i]) changed = true;
      }
      if (changed) {
        computeClusterSeps(); // anchors moved — refresh the truth-handover signal
        dirty = true;
      }
    },

    setVisible(on: boolean) {
      if (on === shown) return;
      shown = on;
      // Matrices went stale while hidden (update() early-returned) — force a rebuild pass.
      if (on) dirty = true;
    },

    pick(raycaster: THREE.Raycaster): PublicPin | null {
      if (!shown || heads.count === 0) return null; // hidden pins are unpickable (click + hover)
      const hits = raycaster.intersectObject(heads, false);
      const id = hits[0]?.instanceId;
      return id !== undefined && id < pins.length ? pins[id] : null;
    },

    setHighlight(pinId: string | null) {
      if (pinId === highlightId && pinId !== null) return; // already pulsing this pin
      highlightId = pinId;
      highlightIdx = pinId ? pins.findIndex((p) => p.id === pinId) : -1;
      highlightUntil = pinId ? performance.now() + PINS.highlightMs : 0;
      dirty = true;
    },

    setHover(pinId: string | null) {
      const idx = pinId ? pins.findIndex((p) => p.id === pinId) : -1;
      if (idx === hoverIdx) return;
      hoverIdx = idx;
      dirty = true; // the ease loop takes it from here
    },

    setSelected(pinId: string | null) {
      if (pinId === selectedId) return;
      selectedId = pinId;
      dirty = true; // the selection ease walks the pin to its truth (and back)
    },

    clusterState(pinId: string) {
      const i = idToIndex.get(pinId);
      if (i === undefined) return null;
      const c = layout.clusterOf[i] ?? -1;
      if (c < 0) return { count: 1, collapsed: false };
      return {
        count: layout.clusters[c].length,
        collapsed: clusterSpreadLast[c] < 0.02,
      };
    },

    hoverAnchor(out: THREE.Vector3): THREE.Vector3 | null {
      if (hoverIdx < 0 || hoverIdx >= pins.length) return null;
      // Instance matrices are camera-relative (precision anchor) — add the mesh anchor back.
      heads.getMatrixAt(hoverIdx, _m);
      return out.setFromMatrixPosition(_m).add(heads.position);
    },

    dispose() {
      for (const m of meshes) scene.remove(m);
      headGeometry.dispose();
      stemGeometry.dispose();
      flareGeometry.dispose();
      headMaterial.dispose();
      stemMaterial.dispose();
      flareMaterial.dispose();
    },
  };
}
