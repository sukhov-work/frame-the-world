import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { tokens } from "../../lib/theme/tokens";
import { AO, BLOOM, POSE, QUALITY, RENDERER, SHADOWS, SUN, ULTRA } from "./tuning";
import {
  detectDeviceTier,
  makeGovernor,
  type DeviceCaps,
  type QualityTier,
} from "../../lib/globe/quality";
import { ultraBootSnapshot } from "../../lib/globe/ultraBoot";

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
    // Touch-primary device (phone/tablet) — caps the tier at `mid` (phones pass STRONG_GPU with
    // defaulted memory signals but can't carry the `high` VRAM budget; MOBILE_PLAN M0).
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
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
    // A coarse-pointer device is ALSO capped at `mid` for the same frame-time-can't-see-memory
    // reason (a phone sustaining 60 fps at LEO would otherwise be promoted into the 8k/dpr-2
    // budget it can't hold at city zoom; MOBILE_PLAN M0).
    const ceiling: QualityTier =
      deviceTier === "low" ? "low" : deviceCaps.coarsePointer ? "mid" : "high";
    // #5 iOS lean profile (batch #4 S3): on ANY coarse-pointer device the renderer levers are
    // additionally clamped to QUALITY.leanMobile (DPR 1.25 / bloom off / shadow 1024) — heat and
    // jetsam pressure, not frame time, are what kill phone sessions, and the governor can't see
    // either. Tile knobs stay per-tier; desktop is untouched (byte-identical `high` rule).
    const lean = deviceCaps.coarsePointer;
    const leanDprCap = lean ? QUALITY.leanMobile.dprCap : Infinity;
    // QA-7b (owner 2026-08-21f): on the /m 2D CHART the lean cap relaxes to dprCap2d — the
    // flat map has bloom/GTAO/shadow twins off already, so the heat budget goes to crispness.
    // Tracked from TilesHandle.mapFlat() in the tick (the bloom-gate seam); applyTier reads
    // the latch so a governor step mid-chart keeps the raised cap. Judged on device (T1).
    let flatForDpr = false;
    const leanDprCapNow = () =>
      lean ? (flatForDpr ? QUALITY.leanMobile.dprCap2d : QUALITY.leanMobile.dprCap) : Infinity;
    const tierBloom = (t: QualityTier) =>
      QUALITY.tiers[t].bloom && !(lean && !QUALITY.leanMobile.bloom);
    // Floor: a CONFIRMED-strong device (detected `high`) never collapses to `low` — it sheds DPR/bloom/
    // tiles down to `mid` for frame rate but keeps the core look (bloom + shadows). An M3 Pro governed
    // to `low` at retina DPR was reading as broken (owner-confirmed: no shadows, no bloom). Unknown/weak
    // devices (mid/low detection) may still bottom out.
    const floor: QualityTier = deviceTier === "high" ? "mid" : "low";
    const governor = makeGovernor(deviceTier, QUALITY.governor, ceiling, floor);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY.tiers[deviceTier].dprCap, leanDprCap),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral (Khronos PBR-Neutral) tames the key light's highlight clipping WITHOUT desaturating the
    // cyan accent + additive atmosphere rim the way ACES/AgX would.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = RENDERER.toneMappingExposure;
    // ULTRA (T45 S5) — the ONE construction-time read of the chip, taken from the PERSISTED pref
    // rather than the store, because the shadow rig is built before any island has mounted.
    // `ULTRA_PLAN.md` §2 sanctions exactly two paths for an ULTRA lever and forbids a third:
    // edge-applied through `QUALITY.ultraDesktop`, or read from the pref at BOOT. Map size and
    // `shadowMap.enabled` are the boot ones — three latches the depth target on first render and
    // ignores a later `mapSize` write, and flipping `shadowMap.enabled` live recompiles every
    // material in the scene. Everything else on the rig (radius, bias, normal bias, bounds,
    // light distance) is a live uniform and is edge-applied by the orchestrator instead.
    // The gate is folded inside `ultraBootOn()` — desktop shell AND fine pointer, the same two
    // terms as the orchestrator's `hqAllowed`.
    // RC26: the SNAPSHOT, so the ULT chip and the rig cannot disagree about what was built.
    const ultraBoot = ultraBootSnapshot();
    // Sun shadows (city scale). Default PCFShadowMap — r185 deprecated PCFSoft (hardware PCF is
    // already 4-tap), and VSM would drag the huge receiver tile meshes into the depth pass.
    // Gated by the quality tier (off on `low`; the orchestrator still gates castShadow by altitude).
    // ULTRA overrides that tier gate deliberately: the chip's whole premise is "maximum quality
    // regardless of measured performance", and a user who clicked it on a weak box asked for this.
    renderer.shadowMap.enabled = QUALITY.tiers[deviceTier].shadowsEnabled || ultraBoot;

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
    // Lean profile caps the shadow map (heat lever) — shadows themselves stay tier-gated ON.
    // ULTRA raises the edge to ULTRA.shadowMapSize (8192² ≈ 0.39 m/texel over the street-level
    // 1.6 km half-extent, vs 0.78 m at 4096²). THE CLAMP IS LOAD-BEARING: three silently mutates
    // `shadow.mapSize` DOWN when it exceeds maxTextureSize, so an unclamped request would leave
    // the tuning constant and the live rig disagreeing — clamp here and the two always match.
    // Cost note: a directional shadow target allocates an RGBA8 colour attachment AND a D24 depth
    // texture, so 8192² is ~512 MiB, not the ~268 MB a depth-only reading suggests. That is the
    // largest single cost on this track and the reason it only became shippable once the owner
    // lifted the frame-rate ceiling (2026-08-22j). Rollback knob: ULTRA.shadowMapSize.
    const shadowPx = Math.min(
      ultraBoot ? ULTRA.shadowMapSize : QUALITY.tiers[deviceTier].shadowMapSize,
      lean ? QUALITY.leanMobile.shadowMapSize : Infinity,
      renderer.capabilities.maxTextureSize,
    );
    sun.shadow.mapSize.set(shadowPx, shadowPx);
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
    // HELD IN A VARIABLE and handed to the orchestrator (was an inline `scene.add(new …)`) so
    // ULTRA S10 can track it to the ephemeris — see audit gap #16: three reads a HemisphereLight's
    // direction from its WORLD POSITION, and this light has never had one set, so its "sky" has
    // always pointed along ECEF +Y. On a globe that is correct on exactly one meridian and
    // progressively inverted everywhere else — the sky/ground ambient split is upside-down over
    // half the planet. The orchestrator re-seats it onto the local up at the view focus, and
    // restores this exact construction state when the chip goes off.
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(tokens.landHi),
      new THREE.Color(tokens.water),
      SUN.hemiIntensity,
    );
    scene.add(hemi);

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
    bloomPass.enabled = tierBloom(deviceTier); // off on `low` + lean mobile (12 fullscreen draws)
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
      const dpr = Math.min(window.devicePixelRatio, s.dprCap, leanDprCapNow());
      // U2/A9: only touch the renderer + composer when the EFFECTIVE DPR actually changes —
      // composer.setSize reallocates every render target, and tier flips between caps that
      // resolve to the same DPR (e.g. devicePixelRatio 1 under caps 1.5/1.25) paid it for nothing.
      if (renderer.getPixelRatio() !== dpr) {
        renderer.setPixelRatio(dpr);
        composer.setPixelRatio(dpr);
        composer.setSize(window.innerWidth, window.innerHeight); // realloc the composer targets at the new DPR
      }
      bloomPass.enabled = tierBloom(t);
      // Shadows follow the DEVICE tier (capability), NOT the runtime governor. Shadows are a core
      // aesthetic, not a frame-rate-degradable lever like DPR/bloom/tile-detail — so the governor must
      // NOT switch them off. BUG (owner-confirmed 2026-07-13): the frame governor throttled an M3 Pro all
      // the way to `low`, and `low.shadowsEnabled=false` killed the entire shadow pass (tier 'low' →
      // renderer.shadowMap.enabled false → hasShadowMap false → not a single cast shadow at any time/zoom,
      // even though sun.castShadow was true and 14/14 buildings + 32 ground twins were set up). Enable +
      // size are set once from `deviceTier` (line ~90 + the rig at init); the governor only sheds DPR,
      // bloom, and tile detail below. A device DETECTED as low (genuinely weak) still gets no shadows.
      tilesHandle?.setQualityTier(t); // building/ground error targets, LRU caps, vector/street budgets
      updateAoEnabled(); // AO is high-tier only
      tierLog.push({ atMs: Math.round(performance.now()), tier: t }); // U2 probe (bounded)
      if (tierLog.length > 50) tierLog.shift();
    };
    // U2/A9: a governor tier change is NEVER applied mid-FPV — the composer-target realloc + the
    // three LRU re-caps are exactly the "full re-render" moment. It parks here and lands on the
    // first non-FPV frame. The DEV force() applies immediately (verification tool) and clears it.
    let pendingTier: QualityTier | null = null;
    // ULTRA HQ (owner 2026-08-22h): the pin's LAST-SEEN state, so the tick only acts on edges.
    // Note it deliberately overrides `ceiling` too — that cap exists because frame time cannot
    // see memory pressure, and ULTRA's entire premise is "regardless of machine performance".
    // It is reachable only by an explicit desktop click on a fine-pointer device.
    let ultraPinned = false;
    const tierLog: Array<{ atMs: number; tier: QualityTier }> = []; // U2 instrumentation (DEV probe)
    if (import.meta.env.DEV)
      window.__quality = {
        get tier() {
          return activeTier;
        },
        get pendingTier() {
          return pendingTier; // U2: a deferred governor step waiting for FPV exit
        },
        tierLog,
        deviceTier,
        deviceCaps,
        governor,
        ao: gtaoPass, // R1 GTAOPass (null unless AO.enabled) — live-tune radius/intensity here
        force: (t: QualityTier) => {
          pendingTier = null;
          governor.force(t);
          applyTier(t);
        },
      };

    // --- optional real OSM-buildings globe (ion token gated; dynamic import) ---
    let tilesHandle: {
      update: () => void;
      setQualityTier: (t: QualityTier) => void;
      fpvActive: () => boolean; // U2/A9: governor tier steps defer while FPV owns the camera
      mapFlat: () => boolean; // 2026-08-18e: flat-map engine treatment → bloom off
      ultraPin: () => boolean; // owner 2026-08-22h: ULTRA HQ — desktop gate already folded in
      pipRect: () => { x: number; y: number; w: number; h: number } | null; // batch #5 item 3
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
            hemiLight: hemi, // ULTRA S10 — ephemeris-tracked ambient (audit gap #16)
            qualityTier: activeTier, // start the tile knobs at the detected device tier (WS1)
            // Mobile texture tier (MOBILE_PLAN M0): phones report maxTextureSize ≥ 8192, so GPU
            // capability alone can't gate the ~280 MB of 8k swaps — the coarse-pointer signal does.
            allow8k: !deviceCaps.coarsePointer,
            aoControl, // R1 altitude gate (undefined unless AO.enabled)
          });
        })
        .catch((e) => console.warn("[globe] tiles disabled:", e));
    }

    // DEV introspection (QA-7b verify; REGISTERED + de-cast by audit #3 A2-5): the governed
    // tier, the EFFECTIVE DPR and both flat latches. LIVE GETTERS on purpose — the old shape
    // was written inside applyTier, so on a shell where the flat flip does not re-apply the
    // tier (desktop: `lean` is false) every field went stale at the last governor step. Named
    // `leanFlat2d` because that is exactly what it is: the coarse-pointer-only latch that
    // gates QUALITY.leanMobile.dprCap2d, permanently false on desktop. `mapFlat` is the
    // engine's real flat-chart latch on EVERY shell, so a desktop check can still fail.
    // Declared in global.d.ts; must sit after `tilesHandle` (its getter closes over it).
    if (import.meta.env.DEV)
      window.__globeQuality = {
        get tier() {
          return activeTier;
        },
        get dpr() {
          return renderer.getPixelRatio();
        },
        get leanFlat2d() {
          return flatForDpr;
        },
        get mapFlat() {
          return tilesHandle?.mapFlat() ?? false;
        },
        get ultra() {
          return ultraPinned;
        },
        ultraBoot,
        // Read back from the LIGHT, not from tuning: three clamps mapSize down to
        // maxTextureSize, so this is what the GPU actually holds.
        get shadowMapPx() {
          return sun.shadow.mapSize.x;
        },
        lean: !!lean,
      };

    // --- resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      composer.setSize(window.innerWidth, window.innerHeight); // logical px — composer applies DPR
    };
    onResize();
    window.addEventListener("resize", onResize);

    // --- #5 WebGL context loss (batch #4 S3) — the iOS jetsam/heat path. three's own handlers
    // already preventDefault() the lost event (restorable) and re-init GL state on restore; the
    // app half is (1) STOP driving the dead context — composer.render against a lost context
    // burns CPU on a tab iOS is already punishing — and (2) realloc the composer chain on
    // restore (scene resources re-upload lazily through three's reset managers; the composer's
    // HalfFloat/MSAA target realloc rides the same setSize precedent as applyTier/onResize).
    let ctxLost = false;
    const onCtxLost = (e: Event) => {
      e.preventDefault(); // idempotent with three's handler — keeps the context restorable
      ctxLost = true;
    };
    const onCtxRestored = () => {
      ctxLost = false;
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    canvas.addEventListener("webglcontextlost", onCtxLost);
    canvas.addEventListener("webglcontextrestored", onCtxRestored);

    // --- animation loop: slow cinematic auto-rotation (respects reduced motion) ---
    let raf = 0;
    let lastGovMs = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // #5: never render a LOST context, and skip work on a hidden page (most browsers stop
      // rAF when hidden, but iOS Safari still delivers throttled frames — each one heat).
      // Re-seat the governor clock while skipping so the first live frame doesn't read the
      // whole background gap as one giant frame time and shed a tier for nothing.
      if (ctxLost || document.hidden) {
        lastGovMs = performance.now();
        return;
      }
      // Adaptive-quality governor: smoothed frame time steps the tier down under load / back up
      // with headroom. No-op on capable hardware (frame time stays under budget → never fires).
      const nowMs = performance.now();
      const gov = governor.step(nowMs - lastGovMs);
      lastGovMs = nowMs;
      // U2/A9: park a governor step while FPV owns the camera; land it on the first non-FPV
      // frame (repeat steps while parked just overwrite — only the latest tier matters).
      // ULTRA HQ (owner 2026-08-22h) — the TIER half. `governor.force()` alone is not enough:
      // it only moves the index and resets hysteresis, so on a machine that actually hurts
      // (the whole point of the feature) the next over-budget streak walks the tier straight
      // back down. So the governor keeps STEPPING — its EMA and hitch probes stay honest — and
      // only its results are dropped while pinned. The OFF edge is an EXPLICIT re-seat to the
      // device tier, never a hope that `changed` fires again: a suppressed governor can sit at
      // its floor with nothing left to change.
      const ultraNow = tilesHandle?.ultraPin() ?? false;
      if (ultraNow !== ultraPinned) {
        ultraPinned = ultraNow;
        if (!ultraPinned) governor.force(deviceTier);
        pendingTier = ultraPinned ? "high" : deviceTier;
      } else if (gov.changed && !ultraPinned) {
        pendingTier = gov.tier;
      }
      if (pendingTier !== null && !(tilesHandle?.fpvActive() ?? false)) {
        applyTier(pendingTier);
        pendingTier = null;
      }
      if (tilesHandle) {
        tilesHandle.update();
      } else if (!reduceMotion) {
        globe.rotation.y += 0.0006; // ~0.03 deg/frame idle rotation
      }
      // Flat-map bloom gate (owner 2026-08-18/18e): the chart has nothing to bloom — skip the
      // ~12 fullscreen draws while the engine runs the flat treatment (/m 2D map, or desktop
      // nadir below CONTROLS.mapFlatMaxAltM — the LEO flagship keeps its atmosphere bloom).
      const flatNow = tilesHandle?.mapFlat() ?? false;
      bloomPass.enabled = tierBloom(activeTier) && !flatNow;
      // QA-7b: the lean DPR cap follows the chart latch — re-apply the tier on a flip (the
      // A9 guard inside applyTier makes it a no-op unless the EFFECTIVE DPR really changes).
      if (lean && flatNow !== flatForDpr) {
        flatForDpr = flatNow;
        applyTier(activeTier);
      }
      composer.render();
      // Batch #5 item 3 — /m PiP: one scissored pass renders the WHOLE view scaled into the
      // map window's hole. The .mw-pip box is sized in EQUAL vw/dvh fractions, so its aspect
      // equals the viewport's — same camera, no projection swap, a true miniature (the old
      // punched hole showed a 1:1 screen crop). Direct renderer.render to the backbuffer:
      // tone map + sRGB apply natively there, and bloom is already off on /m (leanMobile),
      // so the look matches the main pass. setViewport/setScissor take CSS px (three applies
      // the pixel ratio itself); GL origin is bottom-left, hence the Y flip.
      const pip = tilesHandle?.pipRect() ?? null;
      if (pip) {
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        renderer.setScissorTest(true);
        renderer.setScissor(pip.x, vpH - (pip.y + pip.h), pip.w, pip.h);
        renderer.setViewport(pip.x, vpH - (pip.y + pip.h), pip.w, pip.h);
        // audit #3 A2-2 / T38: three re-renders the SHADOW MAP on every `render()` unless
        // `shadowMap.autoUpdate` is off, and `mid` (the coarse-pointer ceiling) has shadows on —
        // so this second pass was paying a full 1024² depth pass per frame for a shadow map the
        // composer pass rendered microseconds ago from the SAME camera and the SAME light. Skip
        // it and restore, so nothing else in the app inherits the flag.
        const shadowAuto = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        renderer.render(scene, camera);
        renderer.shadowMap.autoUpdate = shadowAuto;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, vpW, vpH); // the composer's passes read this next frame
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
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
