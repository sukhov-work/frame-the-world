import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { tokens } from "../../lib/theme/tokens";
import { AO, BLOOM, GATE, PIP, POSE, QUALITY, RENDERER, SHADOWS, SUN, ULTRA } from "./tuning";
import {
  pipCapture,
  pipNeedsRender,
  pipRtSizePx,
  type PipPose,
} from "../../lib/globe/pipCache";
import { frameNeedsRender, framePoseChanged } from "../../lib/globe/frameGate";
import {
  detectDeviceTier,
  makeGovernor,
  planTierApply,
  type DeviceCaps,
  type QualityTier,
} from "../../lib/globe/quality";
import { ultraBootSnapshot } from "../../lib/globe/ultraBoot";
import {
  debugFeedActive,
  debugPush,
  publishDebugFeedSeam,
  registerDebugProvider,
  setDebugFeedActive,
} from "../../lib/globe/debugFeed";
import { debugHudBootOn } from "../../lib/globe/debugBoot";
import { createGpuTimer } from "../../lib/globe/debugGpuTimer";

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
    // The tier whose RENDERER levers are live (DPR, bloom, the AO gate, the composite base).
    // Every existing reader of `activeTier` is a renderer lever or an attach-time seed, so this
    // is the right authority for all of them — but note the narrowed meaning: anything that
    // means "how much detail is currently streaming" must read `tileTier`, not this.
    let activeTier: QualityTier = deviceTier;
    // RC18 — the tier whose TILE levers are live. Equal to `activeTier` except while a governor
    // promote's renderer half is parked inside FPV; FPV exit re-unifies them by construction
    // (planTierApply returns both halves for every non-FPV call, including equal tiers).
    let tileTier: QualityTier = deviceTier;
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

    // DEBUG HUD (owner 2026-09-01) — `renderer.info` is read by NOTHING else in the app
    // (grep-verified at ship), so the HUD owns its reset policy: autoReset would zero the
    // counters at the START of every `render()` call, leaving only the LAST pass's numbers
    // (this frame has up to three: shadow map, composer chain, PiP). With autoReset off the
    // tick resets once per rAF just before the draw block, so calls/triangles are whole-frame
    // truth. The GPU timer is the EXT_disjoint_timer_query ring — `supported: false` on
    // Firefox/Safari, and the HUD shows "—" there rather than a fake number.
    renderer.info.autoReset = false;
    const gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);

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

    // --- SHADOW CASCADES (owner defect 1, 2026-08-27) — the boxes OUTSIDE the rig above. --------
    //
    // Construction-time for the same reason `shadowMapSize` is: three latches a shadow's depth
    // target on first render and ignores a later `mapSize` write, and adding a light changes
    // `NUM_DIR_LIGHTS`/`NUM_DIR_LIGHT_SHADOWS` — a full scene recompile. So the ladder is built
    // here, from the same `ultraBootSnapshot()` the shadow rig reads, and a mid-session chip flip
    // gets the same honest "reload for the full shadow rig" state RC26 already surfaces.
    //
    // THREE PROPERTIES THIS BLOCK IS RESPONSIBLE FOR, all source-verified against three 0.185.0:
    //
    //  1. ORDER. `WebGLLights.setup` indexes `state.directionalShadow[]` by a light's position
    //     among ALL directional lights but then truncates the array to `numDirectionalShadows`
    //     (`WebGLLights.js:295-305,459-465`). A non-casting directional light placed BEFORE a
    //     casting one therefore silently drops the caster's shadow. The cascades go in
    //     immediately after `sun`, and the only other directional light in the scene — the
    //     moonlight in `scene/sky.ts` — is added later still, by the orchestrator. The
    //     orchestrator additionally never lets a cascade cast while `sun` is not (see
    //     `stepShadowCascades`); the reverse is safe and is how a chip-off flip lands.
    //  2. NO LIGHT. `intensity = 0` makes `uniforms.color` exactly black
    //     (`WebGLLights.js:281`), so a cascade cannot brighten any lit material. It exists only to
    //     own a depth map, which `getShadowMask()` then multiplies into the ground's
    //     `ShadowMaterial` twins regardless of intensity — the mechanism the whole design rests on.
    //  3. THROTTLED. `autoUpdate = false` means a cascade re-renders only when the orchestrator
    //     sets `needsUpdate` (`WebGLShadowMap.js:170`). That skip happens BEFORE
    //     `shadow.updateMatrices`, so a skipped cascade keeps a shadow matrix that still matches
    //     the map it rendered — which is why the orchestrator must not move the light on a frame
    //     it does not also refresh.
    const shadowCascades: THREE.DirectionalLight[] = [];
    if (ultraBoot) {
      for (const c of ULTRA.cascades) {
        const px = Math.min(c.mapPx, renderer.capabilities.maxTextureSize);
        const cl = new THREE.DirectionalLight(0xffffff, 0);
        cl.castShadow = false; // the orchestrator gates it, in lockstep with `sun`
        cl.shadow.autoUpdate = false;
        cl.shadow.mapSize.set(px, px);
        cl.shadow.radius = c.radius;
        // Seeded so the very first `updateProjectionMatrix` has a sane box even if a frame
        // renders before the orchestrator's first fit; the real numbers arrive per refresh.
        cl.shadow.camera.left = -c.reachM;
        cl.shadow.camera.right = c.reachM;
        cl.shadow.camera.top = c.reachM;
        cl.shadow.camera.bottom = -c.reachM;
        cl.shadow.camera.near = ULTRA.cascadeLightClearM;
        cl.shadow.camera.far = 4 * c.reachM;
        cl.shadow.camera.updateProjectionMatrix();
        scene.add(cl);
        scene.add(cl.target);
        shadowCascades.push(cl);
      }
    }

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

    // --- RC19: the /m PiP's cached second pass ------------------------------------------------
    // The miniature keeps being PAINTED every frame (composer.render overwrites the rect, so a
    // skipped paint flickers); only the SCENE RENDER behind it is cached.
    //
    // THE COLOUR PATH, and the one place the banked design was wrong. three gives a material
    // `NoToneMapping` whenever a render target is bound (`WebGLPrograms.js:178-186`:
    // `if (material.toneMapped) { if (currentRenderTarget === null || isXRRenderTarget) … }`),
    // and the output encode into an RT is `ColorManagement.workingColorSpace` — identity
    // (`WebGLRenderer.js:2342`). So the RT can only ever hold RAW LINEAR HDR, and this blit to the
    // DEFAULT framebuffer is the only remaining place `NeutralToneMapping` can be applied:
    // `toneMapped` must stay TRUE. Setting it false — as the banked note said — would ship an
    // untone-mapped, clipping miniature. `map.colorSpace` is LinearSRGB so the sampler does not
    // decode, and the canvas's own `colorspace_fragment` then gives exactly ONE sRGB encode,
    // which is the same single-encode path the main composer chain takes.
    let pipRT: THREE.WebGLRenderTarget | null = null;
    let pipSeen: PipPose | null = null;
    let pipDrawnMs = 0;
    let pipRenders = 0;
    let pipBlits = 0;

    // --- RC21 on-demand render (charter Group E; lib/globe/frameGate.ts) ------------------------
    // SHIPS OFF (`GATE.enabled === false`) — see the tuning block for why the default flip is an
    // owner call. `gateDirty` starts true so the very first frame always draws.
    //
    // WHAT `markGateDirty` COVERS, and what it does not. It is wired to the visual changes that
    // happen WITHOUT the camera or the sun moving and that GlobeCanvas can see locally: a tier
    // apply, the bloom/flat-chart gate flip, the ULTRA chip, a resize, a context restore.
    // Everything else — tile streaming, the drape crossfade, `uTime` twinkle, every eased uniform
    // stepped inside StylizedTiles — is covered by `GATE.maxStaleMs` and by nothing else. That is
    // the design (a predicate over 40+ sources in 20 files cannot be both cheap and complete), but
    // it is also exactly why the heartbeat may not be raised casually.
    let gateSeen: PipPose | null = null; // pose at the last DRAWN frame
    let gateDrawnMs = 0; // when that frame was drawn
    let gateQuietSinceMs = 0; // when the scene last changed — drives the settle window
    let gateDirty = true;
    let gateDraws = 0;
    let gateSkips = 0;
    const markGateDirty = () => {
      gateDirty = true;
    };
    // DEV A/B seam, same shape as `pipStaleOverrideMs`: flip `enabled` from the console/harness so
    // a soak can measure one page with the gate on and off without a rebuild. In prod the DEV
    // branch is statically eliminated and `GATE` is read directly — so the shipped default is the
    // frozen constant, not a mutable.
    let gateEnabledOverride: boolean = GATE.enabled;
    let gateStaleOverrideMs: number = GATE.maxStaleMs;
    const gateCfg = () =>
      import.meta.env.DEV
        ? { ...GATE, enabled: gateEnabledOverride, maxStaleMs: gateStaleOverrideMs }
        : GATE;
    const pipMat = new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    // Shares three's module-level fullscreen triangle with the bloom/output/GTAO passes — which
    // is exactly why `pipQuad.dispose()` is NEVER called: `FullScreenQuad.dispose()` disposes
    // that SHARED geometry (`Pass.js`), and every other pass would lose its geometry with it.
    const pipQuad = new FullScreenQuad(pipMat);
    // DEV A/B seam. `maxStaleMs` is writable from the console/harness so the charter's
    // "main-loop ms drop measured" is a real before/after on ONE page rather than a claim:
    // set 0 (== the pre-RC19 every-frame pass), measure, restore, measure. In prod the DEV
    // branch is statically eliminated and `PIP` is read directly.
    let pipStaleOverrideMs: number = PIP.maxStaleMs;
    const pipCfg = () =>
      import.meta.env.DEV ? { ...PIP, maxStaleMs: pipStaleOverrideMs } : PIP;
    if (import.meta.env.DEV)
      window.__pipCache = {
        get active() {
          return pipRT !== null;
        },
        get renders() {
          return pipRenders;
        },
        get blits() {
          return pipBlits;
        },
        get rtPx() {
          return pipRT ? ([pipRT.width, pipRT.height] as [number, number]) : null;
        },
        get maxStaleMs() {
          return pipStaleOverrideMs;
        },
        set maxStaleMs(v: number) {
          pipStaleOverrideMs = v;
        },
      };

    // RC21 DEV seam. `enabled` is writable so a soak can flip the gate on ONE page, hold an ULTRA
    // timelapse, and prove no ease sticks — then flip it back and compare. `draws`/`skips` are
    // CUMULATIVE SINCE PAGE LOAD: sample them TWICE and difference, never once (RC11's leg read a
    // 9.8 % memo rate off a single sample of a counter that reads 87 % at two minutes).
    if (import.meta.env.DEV)
      window.__frameGate = {
        get enabled() {
          return gateEnabledOverride;
        },
        set enabled(v: boolean) {
          gateEnabledOverride = v;
          // Re-arm on every flip: turning the gate OFF must not leave a stale cached pose behind,
          // and turning it ON must draw once before it is allowed to skip.
          gateSeen = null;
          gateDirty = true;
        },
        get draws() {
          return gateDraws;
        },
        get skips() {
          return gateSkips;
        },
        get maxStaleMs() {
          return gateStaleOverrideMs;
        },
        set maxStaleMs(v: number) {
          gateStaleOverrideMs = v;
        },
        get restMs() {
          return GATE.restMs;
        },
      };

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

    // RC18 — the RENDERER half of a tier change: DPR (→ composer-target realloc), bloom, the AO
    // tier gate, and the tiles handle's own deferred levers (the composite-resolution base + the
    // two DPR mirrors). This half ALWAYS parks while FPV owns the camera; `high` == the pre-pass
    // state so a strong machine never sees any of it.
    const applyTierRenderer = (t: QualityTier) => {
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
      // RC18: the DEFERRED tile-side levers only — the composite-resolution base (a raise is a
      // fresh-instance overlay rebuild) and the two DPR mirrors, which read the pixel ratio the
      // block above may have just changed. The detail levers land through applyTierTiles.
      tilesHandle?.setQualityTierDeferred(t);
      updateAoEnabled(); // AO is high-tier only
      tierLog.push({ atMs: Math.round(performance.now()), tier: t }); // U2 probe (bounded)
      if (tierLog.length > 50) tierLog.shift();
    };
    // RC18 — the TILE half: error targets, LRU cap/floor pairs, queue caps, foveation, and the
    // street/vector budgets. Safe to land mid-FPV on a PROMOTE (it only ever lowers an error
    // target and raises a cap), which is the whole point of the split.
    const applyTierTiles = (t: QualityTier) => {
      tileTier = t;
      tilesHandle?.setQualityTierTiles(t);
    };
    /** Both halves, renderer FIRST — the deferred half contains the DPR mirrors, which must read
     *  the pixel ratio the renderer half has already written. */
    const applyTier = (t: QualityTier) => {
      applyTierRenderer(t);
      applyTierTiles(t);
    };
    // U2/A9 + RC18: a governor tier change's RENDERER half is never applied mid-FPV — the
    // composer-target realloc and the drape-composite rebuild are exactly the "full re-render"
    // moment. It parks here and lands on the first non-FPV frame; a PROMOTE's tile half does not
    // wait for that (planTierApply). The DEV force() applies BOTH immediately (it is the
    // verification tool and must keep its pre-RC18 meaning) and clears the slot.
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
          return pendingTier; // U2/RC18: the RENDERER half waiting for FPV exit
        },
        get tileTier() {
          // RC18: read the ENGINE's own value, never this closure's copy — a transcribed mirror
          // is the class of probe that goes stale and reports a pass (audit #3 A2-5).
          return tilesHandle?.tileTier() ?? tileTier;
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
        // RC18: `force` deliberately BYPASSES the deferral (it is the verification tool and every
        // existing verify script depends on it landing immediately), so it cannot exercise the
        // split. This routes through `pendingTier` instead — the only way a browser check can
        // watch a promote land its tile half inside FPV.
        governorPromote: (t: QualityTier) => {
          governor.force(t);
          pendingTier = t;
        },
      };

    // --- optional real OSM-buildings globe (ion token gated; dynamic import) ---
    let tilesHandle: {
      update: () => void;
      setQualityTier: (t: QualityTier) => void;
      setQualityTierTiles: (t: QualityTier) => void; // RC18 — the FPV-safe half
      setQualityTierDeferred: (t: QualityTier) => void; // RC18 — the parked half
      tileTier: () => QualityTier; // RC18 — the engine's own tile-tier authority
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
            // Owner defect 1 — the boxes outside the one rig. Empty unless ULTRA booted on.
            shadowCascades,
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
          return activeTier; // RC18: the RENDERER tier
        },
        get tileTier() {
          // RC18: the TILE tier. Diverges from `tier` only while a split promote's renderer half
          // is parked in FPV — that divergence IS the feature, so it has to be observable.
          return tilesHandle?.tileTier() ?? tileTier;
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

    // DEBUG HUD (owner 2026-09-01) — the canvas-side provider: quality/governor/gate/PiP
    // state, polled by the DebugPanel at its own cadence (≤4 Hz), NEVER per frame. Unlike the
    // `window.__*` seams above this is NOT DEV-gated — the ULT precedent: compiled everywhere,
    // read only while the DBG chip is on. Every value is a plain field read; the cumulative
    // counters (gateDraws/gateSkips, pipRenders/pipBlits, hitchCount) are differenced into
    // rates PANEL-side (the RC11 single-sample rule).
    const unregCanvasDbg = registerDebugProvider("canvas", () => ({
      tier: activeTier,
      tileTier: tilesHandle?.tileTier() ?? tileTier,
      pendingTier,
      deviceTier,
      dpr: renderer.getPixelRatio(),
      devicePixelRatio: window.devicePixelRatio,
      bloom: bloomPass.enabled,
      gtao: gtaoPass ? gtaoPass.enabled : null,
      shadowsOn: renderer.shadowMap.enabled,
      shadowMapPx: sun.shadow.mapSize.x,
      lean: !!lean,
      leanFlat2d: flatForDpr,
      mapFlat: tilesHandle?.mapFlat() ?? false,
      fpvActive: tilesHandle?.fpvActive() ?? false,
      ultra: ultraPinned,
      ultraBoot,
      emaMs: governor.emaMs(),
      hitches: governor.hitchCount(),
      budgetMs: QUALITY.governor.budgetMs,
      restoreMs: QUALITY.governor.restoreMs,
      tierChanges: tierLog.length,
      lastTierChange: tierLog.length
        ? `${tierLog[tierLog.length - 1].tier} @ ${(tierLog[tierLog.length - 1].atMs / 1000).toFixed(1)}s`
        : null,
      gateEnabled: gateCfg().enabled,
      gateDraws,
      gateSkips,
      gateQuietAgeMs: Math.round(performance.now() - gateQuietSinceMs),
      gateRestMs: GATE.restMs,
      pipActive: pipRT !== null,
      pipRenders,
      pipBlits,
      pipRtPx: pipRT ? `${pipRT.width}×${pipRT.height}` : null,
      ctxLost,
      hidden: document.hidden,
      gpuTimer: gpuTimer.supported,
      infoGeometries: renderer.info.memory.geometries,
      infoTextures: renderer.info.memory.textures,
      infoPrograms: renderer.info.programs?.length ?? null,
    }));
    // The static half — read once at mount (a getParameter call can force a GPU sync, so
    // none of these may sit on a poll path, let alone a frame).
    const glCtx = renderer.getContext();
    const glAttrs = glCtx.getContextAttributes();
    const caps = renderer.capabilities;
    const systemSnap = {
      gpu: deviceCaps.rendererString ?? "(blocked)",
      cores: deviceCaps.cores ?? null,
      deviceMemoryGB: deviceCaps.deviceMemoryGB ?? null,
      coarsePointer: deviceCaps.coarsePointer,
      maxTextureSize: caps.maxTextureSize,
      maxCubemapSize: caps.maxCubemapSize,
      maxTextures: caps.maxTextures,
      maxSamples: caps.maxSamples,
      msaaSamples: caps.samples,
      precision: caps.precision,
      antialiasCtx: glAttrs?.antialias ?? null,
      powerPreference: glAttrs?.powerPreference ?? null,
      logDepth: caps.logarithmicDepthBuffer,
    };
    const unregSystemDbg = registerDebugProvider("system", () => systemSnap);
    // T77 MEASURE (2026-09-05) — the runtime-gated READ seam for shells that never mount the
    // panel (/m, coarse pointers, a release build): the `debugHud` pref, read once at boot the
    // way `ultraBootSnapshot()` reads the chip, activates the feed and publishes
    // `window.__debugFeed`. On the desktop shell DebugPanel's mount does the same — idempotent.
    if (debugHudBootOn()) {
      setDebugFeedActive(true);
      publishDebugFeedSeam(true);
    }

    // --- resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      composer.setSize(window.innerWidth, window.innerHeight); // logical px — composer applies DPR
      markGateDirty(); // RC21: a resized backbuffer holds nothing to re-present
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
      // RC21: a restored context has a blank backbuffer — there is no previous frame to re-present,
      // so the gate MUST NOT be allowed to skip the first one. Same reason as the resize hook.
      gateSeen = null;
      markGateDirty();
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
      // DEBUG HUD — dt rides the governor's own clock read (zero extra cost), and it is pushed
      // BEFORE the frame gate so a skipped frame still counts: with the gate on, sampling only
      // drawn frames would read 200 fps on a globe drawing 5.
      const dbgOn = debugFeedActive();
      if (dbgOn) debugPush("frame.dt", nowMs - lastGovMs);
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
        markGateDirty(); // RC21: the chip repaints the whole look with the camera parked
        if (!ultraPinned) governor.force(deviceTier);
        pendingTier = ultraPinned ? "high" : deviceTier;
      } else if (gov.changed && !ultraPinned) {
        pendingTier = gov.tier;
      }
      // RC18 — the split. `planTierApply` is the pure decision: outside FPV both halves land and
      // the slot clears (which is ALSO what re-unifies a pair that diverged during the leg); a
      // promote inside FPV lands its tile half and KEEPS the slot, so the renderer half still
      // arrives on exit; a demote inside FPV parks whole.
      if (pendingTier !== null) {
        const plan = planTierApply(
          pendingTier,
          tileTier,
          tilesHandle?.fpvActive() ?? false,
          QUALITY.leverSplit.livePromoteInFpv,
        );
        // Renderer first, for the same reason `applyTier` orders it that way: the deferred half
        // carries the DPR mirrors, which must read the pixel ratio it has just written.
        if (plan.renderer !== null) applyTierRenderer(plan.renderer);
        if (plan.tiles !== null) applyTierTiles(plan.tiles);
        if (plan.renderer !== null || plan.tiles !== null) markGateDirty(); // RC21
        pendingTier = plan.pending;
      }
      if (tilesHandle) {
        // DEBUG HUD — the orchestrator bracket. This is the half RC21's gate can never skip
        // (`update()` runs every frame by design), so it is the number that explains a slow
        // frame the draw bracket can't.
        if (dbgOn) {
          const t0 = performance.now();
          tilesHandle.update();
          debugPush("frame.cpu", performance.now() - t0);
        } else {
          tilesHandle.update();
        }
      } else if (!reduceMotion) {
        globe.rotation.y += 0.0006; // ~0.03 deg/frame idle rotation
      }
      // Flat-map bloom gate (owner 2026-08-18/18e): the chart has nothing to bloom — skip the
      // ~12 fullscreen draws while the engine runs the flat treatment (/m 2D map, or desktop
      // nadir below CONTROLS.mapFlatMaxAltM — the LEO flagship keeps its atmosphere bloom).
      const flatNow = tilesHandle?.mapFlat() ?? false;
      const bloomWas = bloomPass.enabled;
      bloomPass.enabled = tierBloom(activeTier) && !flatNow;
      if (bloomPass.enabled !== bloomWas) markGateDirty(); // RC21: ~12 fullscreen draws appear/vanish
      // QA-7b: the lean DPR cap follows the chart latch — re-apply the tier on a flip (the
      // A9 guard inside applyTierRenderer makes it a no-op unless the EFFECTIVE DPR really
      // changes). RC18: the RENDERER half only. The flip is a pure DPR event, and the old
      // whole-tier re-apply re-wrote every tile lever to the value it already held — and kicked
      // the ground renderer's UpdateOnChangePlugin — on EVERY 2D↔FPV leg of a lean session.
      if (lean && flatNow !== flatForDpr) {
        flatForDpr = flatNow;
        applyTierRenderer(activeTier);
        markGateDirty(); // RC21: a DPR change repaints everything without moving the camera
      }

      // RC21 — the gate. Note what is ABOVE this line and therefore never skipped: the governor
      // step, the tier apply, and `tilesHandle.update()` (the whole 55-step chain). Only the two
      // GPU draws below are conditional, which is why this buys GPU and power and NOT CPU.
      //
      // Skipping `composer.render()` and then blitting the PiP would draw into an undefined
      // backbuffer — with `preserveDrawingBuffer: false` the buffer's contents are only guaranteed
      // while the frame is untouched. So the two skip together, always; the PiP block below is
      // inside the same branch on purpose.
      const gateNow = gateCfg();
      const gatePose: PipPose = {
        view: camera.matrixWorld.elements,
        proj: camera.projectionMatrix.elements,
        sun: [
          sun.position.x - sun.target.position.x,
          sun.position.y - sun.target.position.y,
          sun.position.z - sun.target.position.z,
        ],
      };
      // The settle clock: any change — pose or explicit — restarts it, so an ease kicked off by
      // that change is drawn at full rate for the whole `restMs` window while it converges.
      if (gateSeen === null || gateDirty || framePoseChanged(gateSeen, gatePose, gateNow)) {
        gateQuietSinceMs = nowMs;
      }
      const drawFrame = frameNeedsRender(
        gateSeen,
        gatePose,
        nowMs - gateDrawnMs,
        nowMs - gateQuietSinceMs,
        gateDirty,
        gateNow,
      );
      if (!drawFrame) {
        gateSkips++;
        return;
      }
      gateDraws++;
      gateSeen = pipCapture(gatePose);
      gateDrawnMs = nowMs;
      gateDirty = false;
      // DEBUG HUD — the draw bracket opens here so it covers the shadow pass (inside
      // composer.render), the composer chain AND the PiP pass/blit below. info.reset() runs
      // unconditionally (4 assignments) so the counters never accumulate unboundedly while the
      // HUD is closed; pushes are gated.
      renderer.info.reset();
      const dbgDrawT0 = dbgOn ? performance.now() : 0;
      if (dbgOn) gpuTimer.begin();
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
        // setViewport takes CSS px and multiplies by the pixel ratio internally, so this is the
        // exact drawing-buffer footprint the old scissored pass covered — the blit is 1:1.
        const want = pipRtSizePx(pip, renderer.getPixelRatio());
        if (!pipRT) {
          pipRT = new THREE.WebGLRenderTarget(want.w, want.h, { type: THREE.HalfFloatType });
          pipMat.map = pipRT.texture;
          pipMat.map.colorSpace = THREE.LinearSRGBColorSpace;
          pipMat.needsUpdate = true;
          pipSeen = null;
        } else if (pipRT.width !== want.w || pipRT.height !== want.h) {
          pipRT.setSize(want.w, want.h); // realloc — rare: the rect write is deadbanded to >0.5px
          pipSeen = null;
        }
        const pose: PipPose = {
          view: camera.matrixWorld.elements,
          proj: camera.projectionMatrix.elements,
          sun: [
            sun.position.x - sun.target.position.x,
            sun.position.y - sun.target.position.y,
            sun.position.z - sun.target.position.z,
          ],
        };
        if (pipNeedsRender(pipSeen, pose, nowMs - pipDrawnMs, pipCfg())) {
          // audit #3 A2-2 / T38: three re-renders the SHADOW MAP on every `render()` unless
          // `shadowMap.autoUpdate` is off, and `mid` (the coarse-pointer ceiling) has shadows on —
          // so this second pass was paying a full 1024² depth pass per frame for a shadow map the
          // composer pass rendered microseconds ago from the SAME camera and the SAME light. Skip
          // it and restore, so nothing else in the app inherits the flag.
          const shadowAuto = renderer.shadowMap.autoUpdate;
          renderer.shadowMap.autoUpdate = false;
          renderer.setRenderTarget(pipRT);
          renderer.render(scene, camera);
          renderer.shadowMap.autoUpdate = shadowAuto;
          // MANDATORY, and the sharpest edge on this slice: EffectComposer restores whatever was
          // bound when it started. Leave the PiP target bound and the WHOLE APP renders into a
          // ~370 px texture on the next frame.
          renderer.setRenderTarget(null);
          pipSeen = pipCapture(pose);
          pipDrawnMs = nowMs;
          pipRenders++;
        }
        // The blit — EVERY frame the PiP is up. This is the anti-flicker half: it is what makes
        // caching the scene render possible at all.
        const autoClear = renderer.autoClear;
        renderer.autoClear = false; // the quad covers the whole scissor rect; a clear is waste
        renderer.setScissorTest(true);
        renderer.setScissor(pip.x, vpH - (pip.y + pip.h), pip.w, pip.h);
        renderer.setViewport(pip.x, vpH - (pip.y + pip.h), pip.w, pip.h);
        pipQuad.render(renderer);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, vpW, vpH); // the composer's passes read this next frame
        renderer.autoClear = autoClear;
        pipBlits++;
      } else if (pipRT) {
        // Map window closed → hand the VRAM back. Steady state off /m is zero extra cost.
        pipRT.dispose();
        pipRT = null;
        pipMat.map = null;
        pipSeen = null;
      }
      // DEBUG HUD — close the draw bracket: whole-frame submit ms, whole-frame draw-call and
      // triangle counts (reset ran just before composer.render), and the async GPU-time
      // harvest (a result is 1–5 frames old; the series is honest about that in its note).
      if (dbgOn) {
        gpuTimer.end();
        debugPush("frame.draw", performance.now() - dbgDrawT0);
        debugPush("frame.calls", renderer.info.render.calls);
        debugPush("frame.tris", renderer.info.render.triangles);
        const gpuMs = gpuTimer.poll();
        if (gpuMs !== null) debugPush("frame.gpu", gpuMs);
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
      unregCanvasDbg();
      unregSystemDbg();
      gpuTimer.dispose();
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
      // RC19. NOT `pipQuad.dispose()` — that disposes three's MODULE-LEVEL fullscreen triangle,
      // which bloom, output and GTAO all draw with. The triangle is a page-lifetime singleton by
      // three's own design; only the target and the material are ours to free.
      pipRT?.dispose();
      pipMat.dispose();
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
