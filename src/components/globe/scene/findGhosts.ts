import * as THREE from "three";
import { FINDGHOSTS, SKY, SKY_TARGET } from "../tuning";
import { tokens } from "../../../lib/theme/tokens";
import { findHitColor } from "../../../lib/theme/findPalette";
import { formatStandingLabel } from "../../../lib/format/readout";
import { azAltToEnu, sampleDayArc, type DayArc } from "../../../lib/ephemeris/dayArc";
import { bodyStatesAt } from "../../../lib/ephemeris/bodies";
import { enuBasis } from "../../../lib/geo/projection";
import type { FindGhost } from "../../../store/find";
import { glf } from "./glsl";

/**
 * FIND v2 ghost projections (owner rework 2026-08-14, restyled same session — "circles too
 * fat"): every standing the FIND panel found, projected into the live sky at once. Each hit is
 * now THREE coordinated layers, all in the hit's identity colour where colour = identity:
 *   • a HAIRLINE broken ring (the SKY.hoverRing quad-gap grammar — the house slick-marking
 *     style) in the per-hit palette colour;
 *   • inside it, a semi-transparent ACCURATE body picture — the sun as a limb-darkened warm
 *     disc, the moon as the LROC texture phase-lit for THAT hit's instant (per-instance
 *     world sun-dir, billboard-space sphere normals — the real impostor's lighting math);
 *     the GC keeps a slim diamond + core dot (the core is a region, not a disc);
 *   • the body's SKY PATH for the hit's local day (sampleDayArc), drawn as a faint polyline
 *     in the same identity colour — hover (row or canvas) boosts that hit's path.
 * Opacity everywhere = date ramp × the engine's visibility score — near, actually-visible
 * standings speak; far/washed ones whisper. Alpha-blended + depth-free + camera-anchored on
 * the impostor shell (the skyGhosts/dayArcs grammar); paths use the dayArcs unit-dir +
 * group-scale trick so far-plane changes never rebuild geometry. Day arcs are CACHED per
 * (body, day) — scrubbing minutes re-uses them; the cache clears on anchor moves.
 *
 * Data arrives as a plain mirror from store/find (the panel computes — this module only draws
 * + angular-hit-tests); `pick()` returns the standing under a ray so the orchestrator can jump
 * time onto it (faded ghosts are click-transparent).
 */
export interface FindGhostsHandle {
  mesh: THREE.InstancedMesh;
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** The observer the store mirror was computed from; null hides everything. */
    anchor: { latDeg: number; lonDeg: number } | null;
    /** The panel-mirrored standings (capped at FIND_GHOST_CAP by the writer). */
    ghosts: readonly FindGhost[];
    /** Panel open — the whole overlay fades with it. */
    visible: boolean;
    /** Row-hover + canvas-hover keys — either pulses its ghost + brightens its path. */
    hoverKeys: readonly (string | null)[];
    /** LIVE world directions of the real bodies (unit) — same-body ghosts inside the
     *  now-gap are skipped so a marker never bites the real disc. */
    sunDirW: THREE.Vector3;
    moonDirW: THREE.Vector3;
    dtMs: number;
  }): void;
  /** The standing whose marker the (unit, world) ray direction hits — nearest wins; ghosts
   *  faded below the sky-aware findPickFloor are transparent to hover and clicks. padK
   *  scales the hit radius (ORCH.touchHitPadK on coarse pointers — a fingertip's arc). */
  pick(rayDir: THREE.Vector3, padK?: number): FindGhost | null;
  dispose(): void;
}

const MAX = FINDGHOSTS.maxGhosts;
const DAY_MS = 86_400_000;

/** Sky-aware interactivity floor (CPU-twin discipline): the minimum effective alpha at which
 *  a ghost responds to hover/clicks, blended by the observer's sun altitude. A hairline ring
 *  on a night sky reads clearly at alphas the day sky swallows — a flat floor left visible
 *  twilight standings mouse-dead (owner 2026-08-14 night-6). */
export function findPickFloor(sunAltDeg: number): number {
  const t = THREE.MathUtils.smoothstep(
    sunAltDeg,
    FINDGHOSTS.pickSunAltLoDeg,
    FINDGHOSTS.pickSunAltHiDeg,
  );
  return (
    FINDGHOSTS.pickMinAlphaNight + (FINDGHOSTS.pickMinAlphaDay - FINDGHOSTS.pickMinAlphaNight) * t
  );
}

/** Per-vertex horizon melt for the paths (the dayArcs recipe on the FINDGHOSTS band). */
function pathFade(altDeg: number): number {
  const lo = FINDGHOSTS.horizonFadeLoDeg;
  const hi = FINDGHOSTS.horizonFadeHiDeg;
  const t = THREE.MathUtils.clamp((altDeg - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

interface Inst {
  ghost: FindGhost;
  /** Unit world direction (ENU → ECEF via the anchor basis) — static per rebuild. */
  dir: THREE.Vector3;
  /** Marker angular radius (rad) — ring outer / diamond half-diagonal. */
  markRad: number;
  /** 0 = sun, 1 = moon, 2 = target (the shader's picture selector; diamond+core marker). */
  kind: number;
  /** World unit dir TOWARD the sun at the HIT's instant — the moon picture's phase light. */
  litW: THREE.Vector3 | null;
  /** Static alpha factors (date ramp × visibility) — melt/hover/fade applied per frame. */
  baseAlpha: number;
  /** In-sky tag `dd.mm` (moon: `dd.mm · NN%`) — static per rebuild. */
  label: string;
  /** Identity colour hex — the label wears the ring's colour. */
  colorHex: string;
}

export function attachFindGhosts(scene: THREE.Scene): FindGhostsHandle {
  // ── In-sky standing labels (owner 2026-08-14): a subtle `dd.mm` (moon: `dd.mm · NN%`) beside
  //    each ghost ring, in the hit's identity colour. DOM layer, NOT GL text (the skyNames/
  //    geoLabels discipline — design fonts survive); pooled divs, transform-only per-frame
  //    writes; opacity rides the ghost's own effective alpha, so labels melt/fade/pulse with
  //    their rings. Screen-space de-clutter: the dense two-branch corridor at long focals would
  //    stack every label on one spot — nearest dates win, the hovered ghost's label always shows.
  const labelLayer = document.createElement("div");
  labelLayer.className = "sky-names"; // welcome.css hides the same chrome family
  labelLayer.setAttribute("aria-hidden", "true");
  labelLayer.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;";
  document.body.appendChild(labelLayer);
  const labelPool: HTMLDivElement[] = [];
  const labelEl = (i: number): HTMLDivElement => {
    while (labelPool.length <= i) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:0;top:0;white-space:nowrap;display:none;" +
        "font:500 0.52rem var(--font-ui,sans-serif);letter-spacing:0.14em;" +
        `text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg};`;
      labelLayer.appendChild(el);
      labelPool.push(el);
    }
    return labelPool[i];
  };
  const hideLabelsFrom = (i: number) => {
    for (let k = i; k < labelPool.length; k++) labelPool[k].style.display = "none";
  };

  const uFade = { value: 0 };
  const moonTex = new THREE.TextureLoader().load(SKY.moonTexture);
  moonTex.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uFade,
      uMap: { value: moonTex },
      uSunCore: { value: new THREE.Color(tokens.sunCore) },
      uSunGlow: { value: new THREE.Color(tokens.sunGlow) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false, // planning overlay — the analytic horizon melt owns occlusion (dayArcs)
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute vec3 aColor;
      attribute float aKind;
      attribute vec3 aLitDir;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vKind;
      varying vec3 vLit;
      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        vColor = aColor;
        vKind = aKind;
        vLit = aLitDir;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      uniform sampler2D uMap;
      uniform vec3 uSunCore;
      uniform vec3 uSunGlow;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vKind;
      varying vec3 vLit;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        // The body picture occupies its TRUE fraction of the ring quad (limb at dr = 1).
        vec2 q = p * ${glf(FINDGHOSTS.ringRadFrac)};
        float dr = length(q);
        // Sample unconditionally (no texture reads inside non-uniform branches).
        vec3 albedo = texture2D(uMap, q * 0.5 + 0.5).rgb;

        // Identity ring — broken hairline, the SKY.hoverRing quad-gap grammar, hit colour.
        float quad = abs(fract(atan(p.y, p.x) * ${glf(2 / Math.PI)} + 0.5) - 0.5) * 2.0;
        float arc = smoothstep(${glf(FINDGHOSTS.ringGapFrac)}, ${glf(FINDGHOSTS.ringGapFrac + 0.12)}, quad);
        float ringA = min(1.0, smoothstep(${glf(FINDGHOSTS.ringWidthN)}, 0.0,
          abs(r - ${glf(1 - FINDGHOSTS.ringWidthN * 1.5)})) * arc * ${glf(FINDGHOSTS.ringAlphaGain)});
        vec3 ringC = vColor;

        // GC: slim diamond outline + core dot replace the ring+picture pair.
        float dia = smoothstep(${glf(FINDGHOSTS.ringWidthN * 1.6)}, 0.0,
          abs(abs(p.x) + abs(p.y) - 0.85));
        float core = 1.0 - smoothstep(${glf(FINDGHOSTS.coreDotFrac * 0.6)}, ${glf(FINDGHOSTS.coreDotFrac)}, r);
        float gc = step(1.5, vKind);
        ringA = mix(ringA, max(dia, core * 0.9), gc);

        // The semi-transparent accurate picture (sun/moon only).
        float disc = (1.0 - smoothstep(0.92, 1.0, dr)) * (1.0 - gc);
        vec3 bodyC;
        if (vKind < 0.5) {
          // Sun: warm limb-darkened disc (the impostor's look, translucent, bloom-free).
          bodyC = mix(uSunCore, uSunGlow, smoothstep(0.55, 1.0, dr)) * mix(1.0, 0.75, smoothstep(0.0, 1.0, dr));
        } else {
          // Moon: billboard-space sphere normal lit by the HIT-time sun dir — real phase.
          vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
          float lit = smoothstep(-0.06, 0.18, dot(n, normalize(vLit)));
          bodyC = albedo * (${glf(FINDGHOSTS.earthshine)} + ${glf(1 - FINDGHOSTS.earthshine)} * lit);
        }
        float bodyA = disc * ${glf(FINDGHOSTS.bodyAlpha)};

        // Ring over picture (standard over-composite, un-premultiplied out for NormalBlending).
        float aOut = ringA + bodyA * (1.0 - ringA);
        if (aOut < 0.012) discard;
        vec3 cOut = (ringC * ringA + bodyC * bodyA * (1.0 - ringA)) / max(aOut, 1e-4);
        gl_FragColor = vec4(cOut, aOut * vAlpha * uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX);
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  const litAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  litAttr.setUsage(THREE.DynamicDrawUsage); // camera-frame lighting — rewritten per frame
  mesh.geometry.setAttribute("aAlpha", alphaAttr);
  mesh.geometry.setAttribute("aColor", colorAttr);
  mesh.geometry.setAttribute("aKind", kindAttr);
  mesh.geometry.setAttribute("aLitDir", litAttr);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false; // camera-anchored — stale bounds must never cull it
  mesh.raycast = () => {}; // picking is ANGULAR via pick() (the pickSkyBody discipline)
  mesh.renderOrder = 10; // depth-free overlay draws after the world (the dayArcs discipline)
  scene.add(mesh);

  // ── Per-hit sky paths — the dayArcs unit-dir + group-scale trick, ONE LineSegments. ────────
  const uPathFade = { value: 0 };
  const uHotIdx = { value: -5 };
  const pathMat = new THREE.ShaderMaterial({
    uniforms: { uFade: uPathFade, uHotIdx },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      attribute float aA;
      attribute vec3 aColor;
      attribute float aIdx;
      varying float vA;
      varying vec3 vC;
      varying float vI;
      void main() {
        vA = aA;
        vC = aColor;
        vI = aIdx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      uniform float uHotIdx;
      varying float vA;
      varying vec3 vC;
      varying float vI;
      void main() {
        float hot = mix(1.0, ${glf(FINDGHOSTS.pathHotBoost)}, step(abs(vI - uHotIdx), 0.5));
        float a = min(0.95, vA * hot) * uFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vC, a);
        #include <colorspace_fragment>
      }`,
  });
  const pathGroup = new THREE.Group();
  const pathLines = new THREE.LineSegments(new THREE.BufferGeometry(), pathMat);
  pathLines.raycast = () => {};
  pathLines.frustumCulled = false;
  pathLines.renderOrder = 10;
  pathGroup.add(pathLines);
  pathGroup.visible = false;
  scene.add(pathGroup);

  /** Day-arc cache — scrubbing minutes shifts every hit's utcMs inside the SAME local day;
   *  the arc for that day is identical, so key by (body, utc-day bucket). */
  const arcCache = new Map<string, DayArc>();
  const cachedArc = (body: "sun" | "moon", utcMs: number, lat: number, lon: number): DayArc => {
    const key = `${body}|${Math.floor(utcMs / DAY_MS)}`;
    let arc = arcCache.get(key);
    if (!arc) {
      arc = sampleDayArc(body, utcMs, lat, lon, {
        stepMin: FINDGHOSTS.pathStepMin,
        tickEveryH: 24, // ticks unused — coarsest legal cadence
      });
      if (arcCache.size >= FINDGHOSTS.pathCacheMax)
        arcCache.delete(arcCache.keys().next().value as string);
      arcCache.set(key, arc);
    }
    return arc;
  };

  let insts: Inst[] = [];
  /** Effective per-instance alpha of the LAST frame (melt/hover folded) — the pick gate. */
  let effAlpha: number[] = [];
  /** Last frame's sky-aware interactivity floor (findPickFloor at the observer's sun alt). */
  let pickFloor: number = FINDGHOSTS.pickMinAlphaDay;
  let builtGhosts: readonly FindGhost[] | null = null;
  let builtAnchorKey = "";
  let fade = 0;
  const _c = new THREE.Color();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _lit = new THREE.Vector3();
  const _scale = new THREE.Vector3();
  const _view = new THREE.Vector3();
  const _ndc = new THREE.Vector3();
  /** Reused per-frame label candidates/accepted (the geoLabels no-churn discipline). */
  const _labelCand: { inst: Inst; x: number; y: number; a: number; hot: boolean }[] = [];
  const _labelAcc: { x: number; y: number }[] = [];

  function rebuildPaths(anchor: { latDeg: number; lonDeg: number }) {
    const basis = enuBasis(anchor.latDeg, anchor.lonDeg);
    const pos: number[] = [];
    const col: number[] = [];
    const al: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < insts.length; i++) {
      const s = insts[i];
      if (s.ghost.body === "target") continue; // generic targets get no day-arc path
      const arc = cachedArc(s.ghost.body, s.ghost.utcMs, anchor.latDeg, anchor.lonDeg);
      if (!arc.everUp) continue;
      _c.set(findHitColor(s.ghost.colorIdx).gl);
      const aBase = s.baseAlpha * FINDGHOSTS.pathAlphaK;
      const pts = arc.points;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const fa = pathFade(a.altDeg);
        const fb = pathFade(b.altDeg);
        if (fa <= 0 && fb <= 0) continue; // fully melted segment
        for (const [pnt, f] of [
          [a, fa],
          [b, fb],
        ] as const) {
          const e = azAltToEnu(pnt.azDeg, pnt.altDeg);
          pos.push(
            e[0] * basis.east[0] + e[1] * basis.north[0] + e[2] * basis.up[0],
            e[0] * basis.east[1] + e[1] * basis.north[1] + e[2] * basis.up[1],
            e[0] * basis.east[2] + e[1] * basis.north[2] + e[2] * basis.up[2],
          );
          col.push(_c.r, _c.g, _c.b);
          al.push(aBase * f);
          idx.push(i);
        }
      }
    }
    pathLines.geometry.dispose();
    pathLines.geometry = new THREE.BufferGeometry();
    pathLines.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    pathLines.geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(col), 3));
    pathLines.geometry.setAttribute("aA", new THREE.BufferAttribute(new Float32Array(al), 1));
    pathLines.geometry.setAttribute("aIdx", new THREE.BufferAttribute(new Float32Array(idx), 1));
  }

  function rebuild(anchor: { latDeg: number; lonDeg: number }, ghosts: readonly FindGhost[]) {
    const basis = enuBasis(anchor.latDeg, anchor.lonDeg);
    insts = [];
    for (const g of ghosts.slice(0, MAX)) {
      const enu = azAltToEnu(g.azDeg, g.altDeg);
      const dir = new THREE.Vector3(
        enu[0] * basis.east[0] + enu[1] * basis.north[0] + enu[2] * basis.up[0],
        enu[0] * basis.east[1] + enu[1] * basis.north[1] + enu[2] * basis.up[1],
        enu[0] * basis.east[2] + enu[1] * basis.north[2] + enu[2] * basis.up[2],
      );
      const isGc = g.body === "target"; // historic name — the tuned diamond marker path
      const discRad = (Math.max(g.discDeg, FINDGHOSTS.minDiscDeg) * Math.PI) / 360;
      const markRad = isGc
        ? ((FINDGHOSTS.gcMarkDeg * Math.PI) / 360) * FINDGHOSTS.ringRadFrac
        : discRad * FINDGHOSTS.ringRadFrac;
      const ramp =
        FINDGHOSTS.alphaNear + (FINDGHOSTS.alphaFar - FINDGHOSTS.alphaNear) * g.tNorm;
      // The moon picture's phase light: world sun dir at the HIT's instant (geocentric —
      // the sun is far enough that topocentric parallax is invisible at marker scale).
      let litW: THREE.Vector3 | null = null;
      if (g.body === "moon") {
        const st = bodyStatesAt(g.utcMs);
        litW = new THREE.Vector3(st.sunDir[0], st.sunDir[1], st.sunDir[2]);
      }
      const colorHex = findHitColor(g.colorIdx).gl;
      insts.push({
        ghost: g,
        dir,
        markRad,
        kind: isGc ? 2 : g.body === "moon" ? 1 : 0,
        litW,
        baseAlpha: ramp * g.visibility,
        label: formatStandingLabel(g.utcMs, g.body === "moon" ? g.illum : undefined),
        colorHex,
      });
      const i = insts.length - 1;
      _c.set(colorHex);
      colorAttr.setXYZ(i, _c.r, _c.g, _c.b);
      kindAttr.setX(i, insts[i].kind);
    }
    colorAttr.needsUpdate = true;
    kindAttr.needsUpdate = true;
    effAlpha = insts.map(() => 0);
    rebuildPaths(anchor);
  }

  return {
    mesh,
    update({ camera, anchor, ghosts, visible, hoverKeys, sunDirW, moonDirW, dtMs }) {
      const want = visible && anchor !== null && ghosts.length > 0;
      const targetFade = want ? 1 : 0;
      fade += (targetFade - fade) * (1 - Math.exp(-dtMs / FINDGHOSTS.fadeTauMs));
      if (fade < 0.01 && !want) {
        mesh.visible = false;
        pathGroup.visible = false;
        hideLabelsFrom(0);
        return;
      }
      if (want && anchor) {
        const anchorKey = `${anchor.latDeg.toFixed(3)}|${anchor.lonDeg.toFixed(3)}`;
        // The mirror is replaced wholesale by the panel — identity IS the rebuild key.
        if (ghosts !== builtGhosts || anchorKey !== builtAnchorKey) {
          if (anchorKey !== builtAnchorKey) arcCache.clear();
          builtGhosts = ghosts;
          builtAnchorKey = anchorKey;
          rebuild(anchor, ghosts);
        }
      }
      if (insts.length === 0) {
        mesh.visible = fade >= 0.01;
        pathGroup.visible = false;
        mesh.count = 0;
        hideLabelsFrom(0);
        return;
      }
      mesh.visible = true;
      pathGroup.visible = true;
      // The frame's interactivity floor: sun altitude at the OBSERVER (geocentric up).
      pickFloor = findPickFloor(
        THREE.MathUtils.radToDeg(
          Math.asin(THREE.MathUtils.clamp(sunDirW.dot(_view.copy(camera.position).normalize()), -1, 1)),
        ),
      );
      // The marker/trail/ghosts sky shell — FIND markers sit with everything else.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY_TARGET.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );
      _q.copy(camera.quaternion); // billboards
      _qInv.copy(camera.quaternion).invert(); // world → billboard space (the moon phase light)
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pxPerRad = vh / 2 / Math.tan((camera.fov * Math.PI) / 360);
      _labelCand.length = 0;
      let hotIdx = -5;
      for (let i = 0; i < insts.length; i++) {
        const s = insts[i];
        // Same-body now-gap: the marker must never bite the LIVE disc (tomorrow's sun is ~0.3°
        // from today's) — melt the ghost instead of overdrawing the body.
        let nowGap = 1;
        const bodyDir = s.ghost.body === "sun" ? sunDirW : s.ghost.body === "moon" ? moonDirW : null;
        if (bodyDir) {
          const gapRad = 2 * s.markRad * FINDGHOSTS.nowGapDiscs;
          nowGap = s.dir.angleTo(bodyDir) < gapRad ? 0 : 1;
        }
        const melt = THREE.MathUtils.smoothstep(
          s.ghost.altDeg,
          FINDGHOSTS.horizonFadeLoDeg,
          FINDGHOSTS.horizonFadeHiDeg,
        );
        const hovered = hoverKeys.includes(s.ghost.key);
        if (hovered) hotIdx = i;
        const alpha = Math.min(
          0.95,
          s.baseAlpha * melt * nowGap * (hovered ? FINDGHOSTS.hoverBoost : 1),
        );
        effAlpha[i] = alpha * fade;
        alphaAttr.setX(i, alpha);
        if (s.litW) {
          _lit.copy(s.litW).applyQuaternion(_qInv);
          litAttr.setXYZ(i, _lit.x, _lit.y, _lit.z);
        } else {
          litAttr.setXYZ(i, 0, 0, 1);
        }
        const size = 2 * Math.tan(s.markRad) * d * (hovered ? FINDGHOSTS.hoverScale : 1);
        _pos.copy(camera.position).addScaledVector(s.dir, d);
        _m.compose(_pos, _q, _scale.setScalar(size));
        mesh.setMatrixAt(i, _m);
        // Label candidate: in front of the camera, on screen, INTERACTIVE (the sky-aware
        // pick floor) — hoverable ⇒ labeled, one economy for ring, mouse and text.
        const labelA = effAlpha[i] * FINDGHOSTS.labelAlphaK;
        if (effAlpha[i] >= pickFloor) {
          _view.copy(_pos).applyMatrix4(camera.matrixWorldInverse);
          if (_view.z < 0) {
            _ndc.copy(_pos).project(camera);
            if (Math.abs(_ndc.x) <= 1.02 && Math.abs(_ndc.y) <= 1.02) {
              const ringPx = Math.tan(s.markRad) * (hovered ? FINDGHOSTS.hoverScale : 1) * pxPerRad;
              _labelCand.push({
                inst: s,
                x: (_ndc.x * 0.5 + 0.5) * vw + ringPx + FINDGHOSTS.labelPadPx,
                y: (-_ndc.y * 0.5 + 0.5) * vh,
                a: labelA,
                hot: hovered,
              });
            }
          }
        }
      }
      // De-clutter + write: hovered first (it must never lose its tag), then date order.
      _labelCand.sort((a, b) => Number(b.hot) - Number(a.hot));
      _labelAcc.length = 0;
      let shown = 0;
      const minSep2 = FINDGHOSTS.labelMinSepPx * FINDGHOSTS.labelMinSepPx;
      for (const c of _labelCand) {
        let clear = true;
        for (const p of _labelAcc) {
          const dx = p.x - c.x;
          const dy = p.y - c.y;
          if (dx * dx + dy * dy < minSep2) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        _labelAcc.push({ x: c.x, y: c.y });
        const el = labelEl(shown++);
        if (el.dataset.k !== c.inst.ghost.key) {
          el.dataset.k = c.inst.ghost.key;
          el.textContent = c.inst.label;
          el.style.color = c.inst.colorHex;
        }
        el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(0, -50%)`;
        // Display lift: rides the ghost's alpha but never drops below reading brightness —
        // 0.52rem text vanishes at the raw twilight alphas the ring itself survives.
        el.style.opacity = String(
          Math.min(0.95, FINDGHOSTS.labelLiftA + c.a * (0.95 - FINDGHOSTS.labelLiftA)),
        );
        el.style.display = "block";
      }
      hideLabelsFrom(shown);
      mesh.count = insts.length;
      mesh.instanceMatrix.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      litAttr.needsUpdate = true;
      uFade.value = fade;
      // Paths ride the dayArcs anchoring trick: unit dirs scaled to the impostor shell.
      pathGroup.position.copy(camera.position);
      pathGroup.scale.setScalar(d);
      uPathFade.value = fade;
      uHotIdx.value = hotIdx;
    },
    pick(rayDir, padK = 1) {
      if (!mesh.visible) return null;
      let best: FindGhost | null = null;
      let bestDot = -1;
      for (let i = 0; i < insts.length; i++) {
        if (effAlpha[i] < pickFloor) continue;
        const s = insts[i];
        // Hit radius: the marker itself plus a small pad — a thin ring needs a forgiving click.
        const hitRad = s.markRad * 1.6 * padK;
        const dot = rayDir.dot(s.dir);
        if (dot >= Math.cos(hitRad) && dot > bestDot) {
          best = s.ghost;
          bestDot = dot;
        }
      }
      return best;
    },
    dispose() {
      labelLayer.remove();
      mesh.geometry.dispose();
      material.dispose();
      moonTex.dispose();
      pathLines.geometry.dispose();
      pathMat.dispose();
      scene.remove(pathGroup);
      scene.remove(mesh);
    },
  };
}
