import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ASTERISMS, GATES, MILKYWAY, STARS, WGS84_A, WGS84_B } from "../tuning";
import {
  bvToRgb,
  magToBright,
  magToSize,
  milkyWayBandSegments,
  milkyWayField,
  parseStarCatalog,
} from "../../../lib/ephemeris/stars";
import {
  asterismSegments,
  figureSegmentsByAbbr,
  type AsterismsAsset,
  type ConstellationFiguresAsset,
} from "../../../lib/ephemeris/asterisms";
import { DITHER_GLSL, glf } from "./glsl";
import { horizonBandSin, horizonTerms } from "./sky";

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
  /** U2/A11: refresh the captured uDpr (gl_PointSize scale) after a governor DPR change. */
  setDpr(dpr: number): void;
  /** Per-frame: visibility gate, camera-follow, altitude fade, twinkle clock, sidereal rotation. */
  update(ctx: {
    alt: number;
    camera: THREE.PerspectiveCamera;
    elapsedS: number;
    reduceMotion: boolean;
    /** Greenwich apparent sidereal time (rad) from the current ephemeris sample. */
    gastRad: number;
    /** Sun direction (ECEF, unit) from the current ephemeris sample — gates the night sky. */
    sunDir: THREE.Vector3;
    /** Solar-eclipse daylight REMAINING, 0..1 (1 = no eclipse). Totality genuinely brings out the
     *  bright stars and planets: the sky drops to roughly deep-twilight luminance for a couple of
     *  minutes. Defaulted so every other caller and the tests are unaffected. */
    eclipseK?: number;
    /** Show the asterism figures (S6 follow-up: an FPV planning layer — the caller gates it
     *  by FPV + the SKY toggle; the stars' own altitude/night fade still applies on top). */
    asterisms?: boolean;
    /** IAU abbreviation of the TRACKED constellation (phase B) — its figure renders in accent
     *  regardless of the asterisms chip; null/undefined hides the highlight. */
    constellation?: string | null;
    /** Milky-Way band guide (Phase 8a P2) — galactic equator + ±edge circles; the caller gates
     *  it by "GALACTIC CENTRE is the tracked target AND SHOW is on" (constellation precedent). */
    mwBand?: boolean;
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
  /** Per-star RGB tint (phase D star colour) — omitted = all-white (token colour unchanged). */
  aTint?: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const count = aSize.length;
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute("aBright", new THREE.BufferAttribute(aBright, 1));
  geometry.setAttribute(
    "aTint",
    new THREE.BufferAttribute(aTint ?? new Float32Array(count * 3).fill(1), 3),
  );
  return geometry;
}

/** Additive round-point star material (shared shape for the catalog stars + the Milky Way band —
 *  look constants are baked per-instance via glf). */
function makeStarMaterial(opts: {
  color: string;
  alpha: number;
  twinkleBase: number;
  twinkleAmp: number;
  dpr: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uTime: { value: 0 },
      uDpr: { value: opts.dpr },
      uFade: { value: 1 }, // altitude/night fade so stars leave cleanly (no bleed over the ground)
      // True-horizon fade (owner 2026-07-15, scene/sky twin): terrain depth-occludes most
      // sub-horizon stars, but the untiled gap past the loaded ground would leak them — and
      // the sun/moon now slice exactly at the true horizon, so the stars must match.
      uHorizonUp: { value: new THREE.Vector3(0, 0, 1) },
      uSinHor: { value: -1 }, // fade OFF until the first update (everything above "horizon")
      uHorizonBandSin: { value: horizonBandSin(0) },
      // Atmospheric extinction floor (MILKYWAY.extinction*, owner 2026-07-15 "embed"): 1 =
      // inert (the catalog stars keep their punch); stars.update writes the altitude-scaled
      // floor ONLY on the diffuse Milky Way layers.
      uExtFloor: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aBright;
      attribute vec3 aTint;
      uniform float uTime;
      uniform float uDpr;
      uniform vec3 uHorizonUp;
      uniform float uSinHor;
      uniform float uHorizonBandSin;
      uniform float uExtFloor;
      varying float vB;
      varying vec3 vTint;
      void main() {
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // Per-star true-horizon fade (ellipsoid-scaled space — see scene/sky.ts) + the low-sky
        // extinction ramp (dim through the thick air column over the first degrees of altitude).
        vec3 dW = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        vec3 Ds = normalize(vec3(dW.xy, dW.z * ${glf(WGS84_A / WGS84_B)}));
        float sinEl = dot(Ds, uHorizonUp);
        float hFade = smoothstep(uSinHor, uSinHor + uHorizonBandSin, sinEl);
        float ext = mix(uExtFloor, 1.0, smoothstep(uSinHor, uSinHor + ${glf(Math.sin((MILKYWAY.extinctionBandDeg * Math.PI) / 180))}, sinEl));
        vB = (${glf(opts.twinkleBase)} + ${glf(opts.twinkleAmp)} * sin(uTime * ${glf(STARS.twinkleSpeed)} + aPhase)) * aBright * hFade * ext;   // subtle twinkle × magnitude
        gl_PointSize = aSize * uDpr;                  // screen-space (no attenuation)
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying float vB;
      varying vec3 vTint;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d) * vB * ${glf(opts.alpha)} * uFade;
        gl_FragColor = vec4(uColor * vTint * a, a);
        #include <colorspace_fragment>
      }`,
  });
}

export function attachStars(
  scene: THREE.Scene,
  opts: {
    dpr: number;
    /** Mobile texture tier (MOBILE_PLAN M0): false loads the 2k milky-way haze bake instead of
     *  the 8192×4096 original (~134 MB VRAM, mips off). Default true (desktop unchanged). */
    allow8k?: boolean;
  },
): StarsHandle {
  let geometry = proceduralGeometry();
  const material = makeStarMaterial({
    color: tokens.star,
    alpha: STARS.alpha,
    twinkleBase: STARS.twinkleBase,
    twinkleAmp: STARS.twinkleAmp,
    dpr: opts.dpr,
  });
  const points = new THREE.Points(geometry, material);
  points.raycast = () => {};
  scene.add(points);

  // Milky Way — a faint procedural band about the REAL galactic plane (J2000), added as a CHILD
  // of the star sphere so the −GAST sidereal rotation + camera-follow + scale apply for free.
  const mw = milkyWayField(MILKYWAY);
  const mwPhase = new Float32Array(MILKYWAY.count);
  for (let i = 0; i < MILKYWAY.count; i++) mwPhase[i] = Math.random() * Math.PI * 2;
  const mwGeometry = buildGeometry(mw.positions, mw.size, mwPhase, mw.bright);
  const mwMaterial = makeStarMaterial({
    color: tokens.milkyWay,
    alpha: MILKYWAY.alpha,
    twinkleBase: 1 - MILKYWAY.twinkleAmp,
    twinkleAmp: MILKYWAY.twinkleAmp,
    dpr: opts.dpr,
  });
  const mwPoints = new THREE.Points(mwGeometry, mwMaterial);
  mwPoints.raycast = () => {};
  points.add(mwPoints);

  // Milky Way HAZE (owner 2026-07-15 realism pass) — the NASA SVS Deep Star Maps 2020
  // Milky-Way-only layer on an inward-facing sphere, another CHILD of the star sphere (same
  // −GAST rotation + camera-follow + scale ⇒ automatic alignment with the BSC5 stars in the
  // shared J2000 frame). Sampled per-fragment dir→RA/Dec: object-space position IS the
  // equatorial direction, so no geometry-UV pole pinch; RepeatWrapping + no mips ⇒ no seam at
  // the RA wrap. Additive, riding the same uFade + true-horizon fade as the stars.
  const hazeTex = new THREE.TextureLoader().load(
    opts.allow8k === false ? MILKYWAY.hazeTexture2k : MILKYWAY.hazeTexture,
  );
  hazeTex.colorSpace = THREE.SRGBColorSpace;
  hazeTex.wrapS = THREE.RepeatWrapping;
  hazeTex.wrapT = THREE.ClampToEdgeWrapping;
  hazeTex.generateMipmaps = false;
  hazeTex.minFilter = THREE.LinearFilter;
  const hazeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: hazeTex },
      uGain: { value: MILKYWAY.hazeGain },
      uFade: { value: 1 },
      uHorizonUp: { value: new THREE.Vector3(0, 0, 1) },
      uSinHor: { value: -1 },
      uHorizonBandSin: { value: horizonBandSin(0) },
      uExtFloor: { value: MILKYWAY.extinctionFloor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying vec3 vW;
      void main() {
        vDir = position; // unit sphere in the star group's J2000 equatorial frame
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uGain;
      uniform float uFade;
      uniform vec3 uHorizonUp;
      uniform float uSinHor;
      uniform float uHorizonBandSin;
      uniform float uExtFloor;
      varying vec3 vDir;
      varying vec3 vW;
      void main() {
        vec3 d = normalize(vDir);
        // Plate carrée in J2000: RA 0h centred, RA increasing LEFT (SVS sky convention) —
        // u = 0.5 − RA/2π (RepeatWrapping absorbs the wrap), v = 0.5 + dec/π.
        float dec = asin(clamp(d.z, -1.0, 1.0));
        float ra = atan(d.y, d.x);
        vec2 uv = vec2(0.5 - ra / ${glf(2 * Math.PI)}, 0.5 + dec / ${glf(Math.PI)});
        // True-horizon slice (scene/sky twin) + low-sky extinction (MILKYWAY.extinction* —
        // the band dims through the thick air column and melts into the horizon haze).
        vec3 dW = vW - cameraPosition;
        vec3 Ds = normalize(vec3(dW.xy, dW.z * ${glf(WGS84_A / WGS84_B)}));
        float sinEl = dot(Ds, uHorizonUp);
        float hFade = smoothstep(uSinHor, uSinHor + uHorizonBandSin, sinEl);
        float ext = mix(uExtFloor, 1.0, smoothstep(uSinHor, uSinHor + ${glf(Math.sin((MILKYWAY.extinctionBandDeg * Math.PI) / 180))}, sinEl));
        vec3 color = texture2D(uMap, uv).rgb * uGain * uFade * hFade * ext;
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, 1.0); // additive: rgb carries everything
        #include <colorspace_fragment>
      }`,
  });
  const hazeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), hazeMaterial);
  hazeMesh.raycast = () => {};
  hazeMesh.frustumCulled = false; // the camera lives at the sphere's centre
  points.add(hazeMesh);

  // Asterism figures (Phase 5.5 S6, §Item 4) — ~20 famous d3-celestial figures as another CHILD
  // of the star sphere: unit J2000 directions inherit −GAST + camera-follow + scale + the
  // visibility gate for free. Fetched async like the catalog; absent until (unless) it lands.
  const asterismGeometry = new THREE.BufferGeometry();
  const asterismMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.star),
    transparent: true,
    opacity: 0, // driven per-frame: fade × ASTERISMS.alpha
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const asterismLines = new THREE.LineSegments(asterismGeometry, asterismMaterial);
  asterismLines.raycast = () => {};
  asterismLines.visible = false; // gated per-frame: asset loaded AND the caller wants them
  let asterismsLoaded = false;
  points.add(asterismLines);

  // Tracked-constellation highlight (phase B) — ONE figure from the full-88 asset, accent
  // coloured, another star-sphere child. The asset fetches lazily on the FIRST tracked
  // constellation (never at boot); per-figure segment arrays are prebuilt once.
  const figureGeometry = new THREE.BufferGeometry();
  const figureMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.accent),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const figureLines = new THREE.LineSegments(figureGeometry, figureMaterial);
  figureLines.raycast = () => {};
  figureLines.visible = false;
  points.add(figureLines);

  // Milky-Way band guide (Phase 8a P2) — the galactic equator + ±bandEdgeDeg small-circles as
  // two more star-sphere children (equator brighter than the edges). Pure math, built once at
  // attach — no fetch. Guide semantics like the asterisms: opacity = fade × alpha only (none of
  // the diffuse layers' fovK/day dimming). Precession is not applied on the star sphere (≤0.3°
  // at 2026 — invisible at ±12° band width; the precessed GC reticle may sit that far off b=0).
  const makeBandLines = (latitudes: readonly number[], alpha: () => number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(milkyWayBandSegments(MILKYWAY.bandStepDeg, latitudes).positions, 3),
    );
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(tokens.milkyWay),
      transparent: true,
      opacity: 0, // driven per-frame: fade × alpha()
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.raycast = () => {};
    lines.visible = false;
    points.add(lines);
    return { geometry, material, lines, alpha };
  };
  const mwBandCore = makeBandLines([0], () => MILKYWAY.bandAlpha);
  const mwBandEdges = makeBandLines(
    [MILKYWAY.bandEdgeDeg, -MILKYWAY.bandEdgeDeg],
    () => MILKYWAY.bandEdgeAlpha,
  );
  let figuresByAbbr: Map<string, Float32Array> | null = null;
  let figuresPromise: Promise<void> | null = null;
  let figureAbbrShown = "";
  const loadFigures = () => {
    figuresPromise ??= fetch(ASTERISMS.figuresUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((asset: ConstellationFiguresAsset) => {
        if (disposed) return;
        figuresByAbbr = figureSegmentsByAbbr(asset);
      })
      .catch((e) => {
        console.warn("[globe] constellation figures unavailable — marker only:", e);
        figuresPromise = null; // a later track retries
      });
  };

  // Real catalog swap — async; the procedural field covers the gap. A failed fetch (offline dev)
  // just keeps the fallback and says so once.
  let disposed = false;
  fetch(ASTERISMS.url)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    })
    .then((asset: AsterismsAsset) => {
      if (disposed) return;
      const segs = asterismSegments(asset);
      asterismGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(segs.positions, 3),
      );
      asterismsLoaded = true;
    })
    .catch((e) => console.warn("[globe] asterisms unavailable — stars only:", e));
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
      // Per-star B−V tint (phase D): catalog colour blended toward the flat token colour by
      // STARS.bvTintAmount — the classic Orion contrast (blue Rigel / orange Betelgeuse) at
      // stylized strength. Sentinel B−V (bvToRgb → white) leaves those stars untinted.
      const aTint = new Float32Array(cat.count * 3);
      const k = STARS.bvTintAmount;
      for (let i = 0; i < cat.count; i++) {
        aSize[i] = magToSize(cat.vmag[i], STARS);
        aBright[i] = magToBright(cat.vmag[i], STARS);
        aPhase[i] = Math.random() * Math.PI * 2;
        const [tr, tg, tb] = bvToRgb(cat.bv[i]);
        aTint[i * 3] = 1 + k * (tr - 1);
        aTint[i * 3 + 1] = 1 + k * (tg - 1);
        aTint[i * 3 + 2] = 1 + k * (tb - 1);
      }
      const next = buildGeometry(cat.positions, aSize, aPhase, aBright, aTint);
      points.geometry = next;
      geometry.dispose();
      geometry = next;
    })
    .catch((e) => console.warn("[globe] star catalog unavailable — procedural fallback:", e));

  const _camUp = new THREE.Vector3();

  return {
    points,
    /** U2/A11: uDpr scales gl_PointSize — it was captured ONCE at attach, so a governor DPR shed
     *  (or restore) left star/MW point sizes computed for the old pixel ratio. The orchestrator
     *  refreshes it on every tier change (the haze layer is size-free — no uniform there). */
    setDpr(dpr: number) {
      material.uniforms.uDpr.value = dpr;
      mwMaterial.uniforms.uDpr.value = dpr;
    },
    update({
      alt,
      camera,
      elapsedS,
      reduceMotion,
      gastRad,
      sunDir,
      eclipseK: ctxEclipseK = 1,
      asterisms = false,
      constellation = null,
      mwBand = false,
    }) {
      // Two ways in: the high-altitude backdrop (space always has stars), OR a night sky at any
      // altitude — below the altitude band the stars now fade in as the sun sets at the camera
      // (owner 2026-07-10: "at night stars must be visible at low altitudes").
      const altFade = THREE.MathUtils.clamp(
        (alt - GATES.starFadeBottom) / GATES.starFadeSpan,
        0,
        1,
      );
      _camUp.copy(camera.position).normalize();
      const sunEl = sunDir.dot(_camUp); // sin(sun elevation) at the camera
      const nightFade = THREE.MathUtils.clamp(
        (STARS.nightVisStartSin - sunEl) / (STARS.nightVisStartSin - STARS.nightVisFullSin),
        0,
        1,
      );
      // Orbit-tier day fade (2026-07-17 orbital-grade pass): the altitude path ("space always
      // has stars") dims over the daylit hemisphere — an exposure holding a sunlit Earth kills
      // the sky. dayK = 0 whenever the sun is at/below the horizon at the camera, so the
      // night-side and low-altitude night paths are untouched.
      const dayK = THREE.MathUtils.clamp(
        (sunEl - STARS.dayDimStartSin) / (STARS.dayDimFullSin - STARS.dayDimStartSin),
        0,
        1,
      );
      // Eclipse reveal. It MUST be folded in before the hard gate below: at the Burgos repro the
      // sun is well up, so `fade` is exactly 0 and `update` returns before writing a single
      // uniform — anything hung downstream of that would be unreachable. The ramp reuses the
      // module's own night curve rather than inventing a second one: an eclipse that has taken
      // (1 − eclipseK) of the daylight reveals stars as if the sun had sunk that far.
      const eclipseFade =
        ctxEclipseK >= 1
          ? 0
          : THREE.MathUtils.clamp(
              (1 - ctxEclipseK - STARS.eclipseRevealStart) /
                (1 - STARS.eclipseRevealStart),
              0,
              1,
            ) * STARS.eclipseRevealMax;
      const fade = Math.max(
        altFade * (1 - dayK * (1 - STARS.dayDimFloor)),
        nightFade,
        eclipseFade,
      );
      const visible = fade > 0.01;
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
      material.uniforms.uFade.value = fade;
      // Diffuse Milky Way layers attenuate at long focal lengths (MILKYWAY.narrowFov*): the
      // magnified 4k haze reads as soft blobs at 250–300 mm and the procedural sparkle points
      // would pose as fake stars among the real BSC5 ones. The catalog stars stay full.
      const fovK =
        MILKYWAY.narrowFovFloor +
        (1 - MILKYWAY.narrowFovFloor) *
          THREE.MathUtils.smoothstep(camera.fov, MILKYWAY.narrowFovLoDeg, MILKYWAY.narrowFovHiDeg);
      // The Milky Way dims all the way out over the day side (haze over a daylit planet reads
      // as sensor noise); catalog stars above kept their dayDimFloor.
      const mwDayK = 1 - dayK * (1 - STARS.mwDayFloor);
      mwMaterial.uniforms.uFade.value = fade * fovK * mwDayK;
      hazeMaterial.uniforms.uFade.value = fade * fovK * mwDayK;
      // Extinction is atmosphere-bound: full at ground level, gone by orbit (the floor lifts
      // to 1 with altitude). Catalog stars keep their default inert floor — punch preserved.
      const extFloor =
        MILKYWAY.extinctionFloor +
        (1 - MILKYWAY.extinctionFloor) *
          THREE.MathUtils.smoothstep(alt, MILKYWAY.extAltLoM, MILKYWAY.extAltHiM);
      mwMaterial.uniforms.uExtFloor.value = extFloor;
      hazeMaterial.uniforms.uExtFloor.value = extFloor;
      // True-horizon fade terms (scene/sky twin — CPU float64): stars + the haze sphere sink
      // at the same line the sun/moon impostors do.
      const sinHor = horizonTerms(camera.position, material.uniforms.uHorizonUp.value);
      const bandSin = horizonBandSin(alt);
      for (const m of [material, mwMaterial, hazeMaterial]) {
        (m.uniforms.uHorizonUp.value as THREE.Vector3).copy(material.uniforms.uHorizonUp.value);
        m.uniforms.uSinHor.value = sinHor;
        m.uniforms.uHorizonBandSin.value = bandSin;
      }
      asterismLines.visible = asterismsLoaded && asterisms;
      asterismMaterial.opacity = fade * ASTERISMS.alpha;
      for (const band of [mwBandCore, mwBandEdges]) {
        band.lines.visible = mwBand;
        band.material.opacity = fade * band.alpha();
      }
      // Tracked-constellation figure — lazy asset, one-figure geometry swap on target change.
      const wantAbbr = constellation ?? "";
      if (wantAbbr && !figuresByAbbr) loadFigures();
      if (figuresByAbbr && wantAbbr !== figureAbbrShown) {
        figureAbbrShown = wantAbbr;
        const segs = wantAbbr ? figuresByAbbr.get(wantAbbr) : undefined;
        if (segs) figureGeometry.setAttribute("position", new THREE.BufferAttribute(segs, 3));
      }
      figureLines.visible =
        !!wantAbbr && !!figuresByAbbr?.has(wantAbbr) && figureAbbrShown === wantAbbr;
      figureMaterial.opacity = fade * ASTERISMS.highlightAlpha;
      if (!reduceMotion) {
        material.uniforms.uTime.value = elapsedS;
        mwMaterial.uniforms.uTime.value = elapsedS;
      }
    },
    dispose() {
      disposed = true;
      geometry.dispose();
      material.dispose();
      mwGeometry.dispose();
      mwMaterial.dispose();
      hazeMesh.geometry.dispose();
      hazeMaterial.dispose();
      hazeTex.dispose();
      asterismGeometry.dispose();
      asterismMaterial.dispose();
      figureGeometry.dispose();
      figureMaterial.dispose();
      for (const band of [mwBandCore, mwBandEdges]) {
        band.geometry.dispose();
        band.material.dispose();
      }
      scene.remove(points);
    },
  };
}
