import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { tokens } from "../../lib/theme/tokens";
import { AO, BLOOM, POSE, QUALITY, RENDERER, SHADOWS, SUN } from "./tuning";
import {
  detectDeviceTier,
  makeGovernor,
  type DeviceCaps,
  type QualityTier,
} from "../../lib/globe/quality";

/** Read the device's rendering capabilities for the initial quality tier (RENDERING_QUALITY_PASS
 *  WS1). Browser-only (GL context + navigator) — the tier DECISION is the pure `detectDeviceTier`. */
function readDeviceCaps(renderer: THREE.WebGLRenderer): DeviceCaps {
  const gl = renderer.getContext();
  let rendererString: string | undefined;
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) rendererString = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
  } catch {
    // privacy-hardened browsers block the extension → undefined → detectDeviceTier falls to `mid`
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    rendererString,
    deviceMemoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    maxTextureSize: renderer.capabilities.maxTextureSize,
  };
}

/**
 * GlobeCanvas — the signature scene (PROJECT_SEED §2; ADR D1/D12).
 * A `client:only="react"` island — NEVER SSR WebGL (constraint C4).
 *
 * Phase 1 "hello globe": a self-contained, procedural STYLIZED globe that always renders —
 * slowly rotating at a cinematic low-earth-orbit angle over a restrained starfield. When
 * `PUBLIC_CESIUM_ION_TOKEN` is set, the real Cesium OSM Buildings globe (ion asset 96188) +
 * GlobeControls is loaded on top via a dynamic import of ./StylizedTiles (so the base build never
 * depends on the tiles path). Colours come from the GL token bridge (tokens.ts) — D14.
 *
 * Verification tier: BUILD/type only here. The visual result is browser-only — verify in `wix dev`
 * (mem:project/dev_environment).
 */
export default function GlobeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // antialias:false — the EffectComposer's MSAA HalfFloat target owns AA; the only draw to the
    // default framebuffer is OutputPass's fullscreen triangle (no internal edges to smooth), so a
    // multisampled default backbuffer would be pure VRAM waste (RENDERING_QUALITY_PASS WS1/P1).
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    // Adaptive quality (RENDERING_QUALITY_PASS WS1 — the keystone): pick a device tier, then a
    // runtime governor steps it from smoothed frame time. `high` == the pre-pass constants, so a
    // capable machine (e.g. the author's M3 Pro) is byte-identical to before; only weaker hardware
    // ever degrades. The governor is a no-op whenever the frame time stays under budget.
    const deviceCaps = readDeviceCaps(renderer);
    const deviceTier = detectDeviceTier(deviceCaps);
    let activeTier: QualityTier = deviceTier;
    // Ceiling: a `low` detection (weak GPU / ≤4 GB / software) is CAPPED — frame time can't see
    // memory pressure, so we never let it climb into the high LRU/8k-texture budget. `mid` (unknown
    // hardware, or a capable machine whose GPU string is privacy-blocked) may climb to `high` when
    // it sustains the headroom — this is what keeps a hidden-string M3 Pro from being stuck at mid.
    const ceiling: QualityTier = deviceTier === "low" ? "low" : "high";
    const governor = makeGovernor(deviceTier, QUALITY.governor, ceiling);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY.tiers[deviceTier].dprCap),
    );
    renderer.setClearColor(new THREE.Color(tokens.bg), 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral (Khronos PBR-Neutral) tames the key light's highlight clipping WITHOUT desaturating the
    // cyan accent + additive atmosphere rim the way ACES/AgX would.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = RENDERER.toneMappingExposure;
    // Sun shadows (city scale). Default PCFShadowMap — r185 deprecated PCFSoft (hardware PCF is
    // already 4-tap), and VSM would drag the huge receiver tile meshes into the depth pass.
    // Gated by the quality tier (off on `low`; the orchestrator still gates castShadow by altitude).
    renderer.shadowMap.enabled = QUALITY.tiers[deviceTier].shadowsEnabled;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (import.meta.env.DEV) window.__renderer = renderer;

    const scene = new THREE.Scene();
    // The space backdrop MUST be scene.background, not the renderer clear color (S5 §Item 15 —
    // THE "navy night sky" root cause): setClearColor converts to the renderer's OUTPUT space
    // (sRGB) because no render target is bound at setup, and EffectComposer runs autoClear-off,
    // so RenderPass's raw renderer.clear() dumped those sRGB-encoded values into the LINEAR
    // HalfFloat buffer. OutputPass then treated them as linear — PBR-Neutral's black offset ate
    // the red channel and the sRGB encode boosted the rest: #05070B rendered as (8,26,45) navy
    // across every empty sky pixel (measured; the math reproduces it exactly). scene.background
    // is converted per-render-target inside renderer.render (linear into the composer's buffer,
    // sRGB when rendering direct) and force-clears over the stale GL state in both paths.
    scene.background = new THREE.Color(tokens.bg);
    const camera = new THREE.PerspectiveCamera(
      POSE.fovDeg,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    camera.position.set(0, 1.05, 3.4); // cinematic LEO angle, slightly above the equator
    camera.lookAt(0, 0, 0);

    // --- stylized globe (procedural; the guaranteed Phase-1 hero) ---
    const globe = new THREE.Group();
    globe.rotation.z = THREE.MathUtils.degToRad(23.4); // axial tilt for the cinematic pose
    scene.add(globe);

    const R = 1;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 96),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(tokens.land),
        roughness: 0.95,
        metalness: 0.0,
      }),
    );
    globe.add(earth);

    // subtle graticule for the "premium instrument" feel
    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.001, 48, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(tokens.landHi),
        wireframe: true,
        transparent: true,
        opacity: 0.06,
      }),
    );
    globe.add(grid);

    // atmosphere rim (accent-tinted, additive, back side)
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 96, 96),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(tokens.accent),
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    globe.add(atmosphere);

    // --- restrained starfield backdrop ---
    const starCount = 1500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 40 + Math.random() * 30;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      starPos[i * 3 + 2] = r * Math.cos(ph);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.08,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
      }),
    );
    scene.add(stars);

    // --- lighting: sun-like key + hemisphere fill ---
    // NOTE: the real-Earth base ellipsoid is a self-lit ShaderMaterial (scene/baseEarth) and ignores
    // these lights; they exist to light the OSM building tiles. SUN.direction is the ONE sun constant
    // shared with the earth/ground shaders, so the building shading always agrees with the terminator.
    const sun = new THREE.DirectionalLight(0xffffff, SUN.keyIntensity);
    sun.position.set(...SUN.direction);
    scene.add(sun);
    scene.add(sun.target); // target must live in the scene for its matrixWorld to update (three docs)
    // Tight orthographic shadow camera — refit to the view focus each frame by the orchestrator.
    // castShadow stays OFF until the orchestrator gates it on (low altitude + sun above horizon).
    sun.castShadow = false;
    sun.shadow.mapSize.set(
      QUALITY.tiers[deviceTier].shadowMapSize,
      QUALITY.tiers[deviceTier].shadowMapSize,
    );
    sun.shadow.camera.left = -SHADOWS.boundsM;
    sun.shadow.camera.right = SHADOWS.boundsM;
    sun.shadow.camera.top = SHADOWS.boundsM;
    sun.shadow.camera.bottom = -SHADOWS.boundsM;
    sun.shadow.camera.near = SHADOWS.lightDistM - SHADOWS.depthMarginM;
    sun.shadow.camera.far = SHADOWS.lightDistM + SHADOWS.depthMarginM;
    sun.shadow.bias = SHADOWS.bias;
    sun.shadow.normalBias = SHADOWS.normalBias; // world-metres — absorbs float32 quantisation at ECEF scale
    sun.shadow.radius = SHADOWS.radius;
    sun.shadow.camera.updateProjectionMatrix();
    // Hemisphere fill so night-side buildings aren't pure black (AmbientLight(water) was ~0).
    scene.add(
      new THREE.HemisphereLight(
        new THREE.Color(tokens.landHi),
        new THREE.Color(tokens.water),
        SUN.hemiIntensity,
      ),
    );

    // --- soft bloom composer: RenderPass → UnrealBloom → OutputPass (tone map + sRGB move to the
    //     OutputPass; the renderer's own settings are read by it, so they stay untouched above).
    //     Custom HalfFloat target keeps HDR (sun disc >1 blooms) + MSAA (edge lines would alias). --
    const rtSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const composeTarget = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, {
      type: THREE.HalfFloatType,
      samples: BLOOM.msaaSamples,
    });
    const composer = new EffectComposer(renderer, composeTarget);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    bloomPass.enabled = QUALITY.tiers[deviceTier].bloom; // off on `low` (12 fullscreen draws)
    // DEV-only introspection (same pattern as __renderer/__globe): browser verification can
    // toggle passes / read bloom uniforms without reaching into this closure.
    if (import.meta.env.DEV) window.__composer = composer;

    // R1 ambient occlusion (RENDERING_QUALITY_PASS): GTAOPass after RenderPass, before bloom.
    // Constructed ONLY when AO.enabled (DEFAULT OFF → zero VRAM/cost on every machine); then gated
    // by tier (high) AND altitude (aoControl, set by the orchestrator from the camera altitude —
    // city/street only). Its own GBuffer prepass is a full extra scene render, which is why it is
    // high-tier + low-altitude only. Tune the look in wix dev via window.__quality.ao.
    let gtaoPass: GTAOPass | null = null;
    let aoAltActive = false;
    const updateAoEnabled = () => {
      if (gtaoPass) gtaoPass.enabled = activeTier === "high" && aoAltActive;
    };
    const aoControl = AO.enabled
      ? {
          setAltActive: (active: boolean) => {
            if (active !== aoAltActive) {
              aoAltActive = active;
              updateAoEnabled();
            }
          },
        }
      : undefined;
    if (AO.enabled) {
      const aoSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      gtaoPass = new GTAOPass(scene, camera, aoSize.x, aoSize.y);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      gtaoPass.blendIntensity = AO.intensity;
      gtaoPass.updateGtaoMaterial({
        radius: AO.radiusM, // WORLD/view metres — screenSpaceRadius stays false (fixed physical size)
        scale: AO.scale,
        samples: AO.samples,
        screenSpaceRadius: false,
      });
      // Crude skylight tint: three ships no AO-colour setter, so patch the GTAOBlendShader's ONE
      // composite line to darken occluded pixels TOWARD tokens.skyHorizon (the blend is a multiply,
      // so it can only darken toward the hue — a cool cast in the creases). Guarded: if three's
      // shader source ever drifts, skip the patch (AO stays neutral gray) — never compile a break.
      const bm = gtaoPass.blendMaterial;
      const aoBlendLine = "gl_FragColor = vec4(mix(vec3(1.), texel.rgb, intensity), texel.a);";
      if (bm.fragmentShader.includes(aoBlendLine)) {
        bm.uniforms.uFtwHorizon = { value: new THREE.Color(tokens.skyHorizon) };
        bm.uniforms.uFtwTint = { value: AO.horizonTint };
        bm.fragmentShader = bm.fragmentShader
          .replace(
            "uniform float intensity;",
            "uniform float intensity;\nuniform vec3 uFtwHorizon;\nuniform float uFtwTint;",
          )
          .replace(
            aoBlendLine,
            "vec3 ftwAoRgb = mix(vec3(1.), texel.rgb, intensity);\n" +
              "float ftwOcc = (1.0 - texel.r) * intensity;\n" +
              "ftwAoRgb *= mix(vec3(1.0), uFtwHorizon, uFtwTint * ftwOcc);\n" +
              "gl_FragColor = vec4(ftwAoRgb, texel.a);",
          );
        bm.needsUpdate = true;
      } else if (import.meta.env.DEV) {
        console.warn("[globe] GTAO horizon tint skipped — GTAOBlendShader source changed");
      }
      gtaoPass.enabled = false; // gated on at runtime by tier + altitude
      composer.insertPass(gtaoPass, 1); // after RenderPass(0), before UnrealBloomPass
    }

    // Apply a quality tier's renderer-level levers (DPR / bloom / shadows) + the tile knobs (via
    // the tiles handle) + the AO tier gate. Called by the governor on a tier change; `high` == the
    // pre-pass state so a strong machine never sees any of this.
    const applyTier = (t: QualityTier) => {
      activeTier = t;
      const s = QUALITY.tiers[t];
      const dpr = Math.min(window.devicePixelRatio, s.dprCap);
      renderer.setPixelRatio(dpr);
      composer.setPixelRatio(dpr);
      composer.setSize(window.innerWidth, window.innerHeight); // realloc the composer targets at the new DPR
      bloomPass.enabled = s.bloom;
      renderer.shadowMap.enabled = s.shadowsEnabled;
      if (s.shadowsEnabled && sun.shadow.mapSize.width !== s.shadowMapSize) {
        sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null; // force three to rebuild the depth target at the new size
      }
      tilesHandle?.setQualityTier(t); // building/ground error targets, LRU caps, vector/street budgets
      updateAoEnabled(); // AO is high-tier only
    };
    if (import.meta.env.DEV)
      window.__quality = {
        get tier() {
          return activeTier;
        },
        deviceTier,
        deviceCaps,
        governor,
        ao: gtaoPass, // R1 GTAOPass (null unless AO.enabled) — live-tune radius/intensity here
        force: (t: QualityTier) => {
          governor.force(t);
          applyTier(t);
        },
      };

    // --- optional real OSM-buildings globe (ion token gated; dynamic import) ---
    let tilesHandle: {
      update: () => void;
      setQualityTier: (t: QualityTier) => void;
      dispose: () => void;
    } | null = null;
    const ionToken = import.meta.env.PUBLIC_CESIUM_ION_TOKEN as string | undefined;
    if (ionToken) {
      import("./StylizedTiles")
        .then(({ attachStylizedTiles }) => {
          // the real Earth replaces the procedural placeholder (different world scale)
          globe.visible = false;
          stars.visible = false;
          tilesHandle = attachStylizedTiles({
            scene,
            camera,
            renderer,
            ionToken,
            reduceMotion,
            sunLight: sun,
            qualityTier: activeTier, // start the tile knobs at the detected device tier (WS1)
            aoControl, // R1 altitude gate (undefined unless AO.enabled)
          });
        })
        .catch((e) => console.warn("[globe] tiles disabled:", e));
    }

    // --- resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      composer.setSize(window.innerWidth, window.innerHeight); // logical px — composer applies DPR
    };
    onResize();
    window.addEventListener("resize", onResize);

    // --- animation loop: slow cinematic auto-rotation (respects reduced motion) ---
    let raf = 0;
    let lastGovMs = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // Adaptive-quality governor: smoothed frame time steps the tier down under load / back up
      // with headroom. No-op on capable hardware (frame time stays under budget → never fires).
      const nowMs = performance.now();
      const gov = governor.step(nowMs - lastGovMs);
      lastGovMs = nowMs;
      if (gov.changed) applyTier(gov.tier);
      if (tilesHandle) {
        tilesHandle.update();
      } else if (!reduceMotion) {
        globe.rotation.y += 0.0006; // ~0.03 deg/frame idle rotation
      }
      composer.render();
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      tilesHandle?.dispose();
      earth.geometry.dispose();
      (earth.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      starGeo.dispose();
      (stars.material as THREE.Material).dispose();
      bloomPass.dispose();
      composer.dispose();
      composeTarget.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="globe-canvas"
      aria-label="Interactive 3D globe"
    />
  );
}
