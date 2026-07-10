import { useEffect, useRef } from "react";
import * as THREE from "three";
import { tokens } from "../../lib/theme/tokens";
import { POSE, RENDERER, SUN } from "./tuning";

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

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
    renderer.setClearColor(new THREE.Color(tokens.bg), 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral (Khronos PBR-Neutral) tames the key light's highlight clipping WITHOUT desaturating the
    // cyan accent + additive atmosphere rim the way ACES/AgX would.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = RENDERER.toneMappingExposure;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const scene = new THREE.Scene();
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
    // Hemisphere fill so night-side buildings aren't pure black (AmbientLight(water) was ~0).
    scene.add(
      new THREE.HemisphereLight(
        new THREE.Color(tokens.landHi),
        new THREE.Color(tokens.water),
        SUN.hemiIntensity,
      ),
    );

    // --- optional real OSM-buildings globe (ion token gated; dynamic import) ---
    let tilesHandle: { update: () => void; dispose: () => void } | null = null;
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
          });
        })
        .catch((e) => console.warn("[globe] tiles disabled:", e));
    }

    // --- resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    onResize();
    window.addEventListener("resize", onResize);

    // --- animation loop: slow cinematic auto-rotation (respects reduced motion) ---
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (tilesHandle) {
        tilesHandle.update();
      } else if (!reduceMotion) {
        globe.rotation.y += 0.0006; // ~0.03 deg/frame idle rotation
      }
      renderer.render(scene, camera);
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
