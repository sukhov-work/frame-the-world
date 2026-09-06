import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import {
  createResolvedComposer,
  MsaaResolvePass,
  PinnedComposer,
} from "../../../src/components/globe/scene/resolvedComposer";
import { ScaledBloomPass } from "../../../src/components/globe/scene/scaledBloom";

/**
 * T80 direction g — the composer's BUFFER CONTRACT.
 *
 * The lever is not a shader and not a number: it is which render target each pass reads and
 * writes. So this file pins the contract the way `scaledBloom.test.ts` pins the pass — against
 * the real three 0.185 classes, driven by a recording fake renderer, with the LIBRARY SURFACE the
 * design leans on asserted separately so a three bump fails here rather than shipping a chain
 * that quietly resolves twice again.
 *
 * The three load-bearing library facts:
 *  1. `EffectComposer` reads `pass.needsSwap` AFTER calling `pass.render` — which is what lets
 *     `MsaaResolvePass` decide per frame whether it is needed.
 *  2. `RenderPass` and `UnrealBloomPass` both declare `needsSwap === false` — but `OutputPass`
 *     inherits the base `needsSwap === true` and swaps on its way to the screen. That is ONE swap
 *     per frame, which corrects T77 gap 4: `renderTarget1` is not a dead buffer, it is the scene
 *     target on every other frame, and the composer pays for two full-size MSAA buffers.
 *  3. `EffectComposer` carries its read/write pointers ACROSS frames, so that odd swap alternates
 *     the pair — harmless with two identical buffers, fatal with an asymmetric pair.
 */

const root = join(__dirname, "..", "..", "..");
const jsm = (f: string) => readFileSync(join(root, "node_modules", "three", "examples", "jsm", f), "utf8");
const GLOBE_CANVAS = readFileSync(join(root, "src/components/globe/GlobeCanvas.tsx"), "utf8");

const W = 320;
const H = 200;
const SAMPLES = 4;

/** A recording stand-in for `WebGLRenderer`: every draw is logged with the target bound at the time. */
function fakeRenderer() {
  const draws: Array<{ target: THREE.WebGLRenderTarget | null; what: string }> = [];
  let bound: THREE.WebGLRenderTarget | null = null;
  const r = {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    toneMapping: THREE.NeutralToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    state: { buffers: { stencil: { setTest: () => {}, setFunc: () => {} } } },
    draws,
    getPixelRatio: () => 1,
    getSize: (v: THREE.Vector2) => v.set(W, H),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(W, H),
    getRenderTarget: () => bound,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      bound = t;
    },
    clear: () => {},
    clearDepth: () => {},
    getClearColor: (c: THREE.Color) => c.set(0x000000),
    getClearAlpha: () => 0,
    setClearColor: () => {},
    setClearAlpha: () => {},
    render: (obj: THREE.Object3D) => {
      draws.push({ target: bound, what: obj.name || obj.type });
    },
  };
  return r as unknown as THREE.WebGLRenderer & { draws: typeof draws };
}

/** A `GTAOPass`-shaped stand-in: reads the read buffer, writes the write buffer, and SWAPS. */
class SwappingPass extends Pass {
  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    _readBuffer: THREE.WebGLRenderTarget,
  ): void {
    renderer.setRenderTarget(writeBuffer);
    renderer.render(new THREE.Object3D(), new THREE.Camera());
  }
}

const sceneAndCamera = () => {
  const scene = new THREE.Scene();
  scene.name = "SCENE";
  return { scene, camera: new THREE.PerspectiveCamera() };
};

describe("T80g — the three 0.185 surface the buffer contract leans on", () => {
  it("EffectComposer reads `needsSwap` AFTER pass.render, so a pass may decide it per frame", () => {
    const src = jsm("postprocessing/EffectComposer.js");
    const body = src.slice(src.indexOf("render( deltaTime ) {"));
    const call = body.indexOf("pass.render( this.renderer, this.writeBuffer, this.readBuffer");
    const flag = body.indexOf("if ( pass.needsSwap )");
    expect(call).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(call);
  });

  it("GAP 4, CORRECTED: RenderPass and UnrealBloomPass never swap — but OutputPass DOES, so the "
    + "stock chain ALTERNATES and BOTH full-size MSAA buffers are live", () => {
    expect(jsm("postprocessing/RenderPass.js")).toMatch(/this\.needsSwap = false;/);
    expect(jsm("postprocessing/UnrealBloomPass.js")).toMatch(/this\.needsSwap = false;/);
    // `OutputPass extends Pass` and never overrides the base `needsSwap = true` — so it swaps
    // even though it rendered to SCREEN. One swap per frame, and `renderTarget1` is the scene
    // target on every other frame. The T77 audit's "rt1 is allocated and never rendered into"
    // is FALSE for this chain: the composer pays for two full-size 4x MSAA HalfFloat buffers.
    expect(jsm("postprocessing/OutputPass.js")).not.toMatch(/needsSwap/);
    expect(new OutputPass().needsSwap).toBe(true);
    const r = fakeRenderer();
    const { scene, camera } = sceneAndCamera();
    const stock = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: SAMPLES }),
    );
    stock.addPass(new RenderPass(scene, camera));
    stock.addPass(new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9));
    stock.addPass(new OutputPass());
    const rt1 = stock.renderTarget1;
    const rt2 = stock.renderTarget2;
    stock.render(0);
    stock.render(0);
    const sceneTargets = r.draws.filter((d) => d.what === "SCENE").map((d) => d.target);
    expect(sceneTargets).toEqual([rt2, rt1]);
    expect(rt1.samples).toBe(SAMPLES); // both buffers are the expensive kind
    expect(rt2.samples).toBe(SAMPLES);
  });
});

describe("createResolvedComposer — the buffer contract", () => {
  it("rt2 is the MSAA scene buffer, rt1 the single-sample resolve, and the pointers start pinned", () => {
    const r = fakeRenderer();
    const { composer, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    expect(composer.renderTarget2).toBe(sceneTarget);
    expect(composer.renderTarget1).toBe(resolvedTarget);
    expect(composer.readBuffer).toBe(sceneTarget);
    expect(composer.writeBuffer).toBe(resolvedTarget);
    expect(sceneTarget.samples).toBe(SAMPLES);
    expect(resolvedTarget.samples).toBe(0);
    expect(sceneTarget.texture.type).toBe(THREE.HalfFloatType);
    expect(resolvedTarget.texture.type).toBe(THREE.HalfFloatType);
    expect([sceneTarget.width, sceneTarget.height]).toEqual([W, H]);
    expect([resolvedTarget.width, resolvedTarget.height]).toEqual([W, H]);
  });

  it("setSize resizes both and each buffer KEEPS its sample count", () => {
    const r = fakeRenderer();
    const { composer, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    composer.setPixelRatio(2);
    composer.setSize(100, 50);
    expect([sceneTarget.width, sceneTarget.height]).toEqual([200, 100]);
    expect([resolvedTarget.width, resolvedTarget.height]).toEqual([200, 100]);
    expect(sceneTarget.samples).toBe(SAMPLES);
    expect(resolvedTarget.samples).toBe(0);
  });

  it("the two DEPTH flags: the resolve has no depth buffer, the scene's depth is never resolved", () => {
    // Both are pure jetsam levers and neither can move a pixel — every pass that writes the
    // resolved target is `depthTest:false, depthWrite:false`, and nothing samples the scene
    // target's depth (it has no depthTexture, and GTAOPass renders its own g-buffer).
    const r = fakeRenderer();
    const { composer, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    expect(resolvedTarget.depthBuffer).toBe(false);
    expect(sceneTarget.depthBuffer).toBe(true); // the scene render itself still needs depth
    expect(sceneTarget.resolveDepthBuffer).toBe(false);
    // POSITIVE CONTROL: three's defaults really are the other way round, so these assertions are
    // about THIS factory and not about a library default that would satisfy them for free.
    const stock = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: SAMPLES });
    expect(stock.depthBuffer).toBe(true);
    expect(stock.resolveDepthBuffer).toBe(true);
    // …and a resize must not quietly hand the flags back (setSize disposes and re-allocates).
    composer.setSize(100, 50);
    expect(resolvedTarget.depthBuffer).toBe(false);
    expect(sceneTarget.resolveDepthBuffer).toBe(false);
  });

  it("with bloom OFF nothing ever binds the resolved target — it costs a phone nothing", () => {
    // three allocates a render target lazily, on its first bind. Bloom is off on every coarse
    // pointer and on tier `low` (QUALITY.leanMobile.bloom), the resolve is off with it (the
    // lockstep), and the chain degenerates to the pre-T80g scene → OutputPass. If this ever
    // starts binding the buffer, T83's jetsam budget silently grows a full-resolution surface.
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    const { scene, camera } = sceneAndCamera();
    const bloom = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(resolvePass);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    bloom.enabled = false;
    resolvePass.enabled = false; // the lockstep, as GlobeCanvas's setBloomEnabled writes it
    composer.render(0);
    composer.render(0);
    expect(r.draws.map((d) => d.target)).toEqual([sceneTarget, null, sceneTarget, null]);
    expect(r.draws.some((d) => d.target === resolvedTarget)).toBe(false);
    const out = composer.passes.at(-1) as OutputPass;
    expect(out.uniforms.tDiffuse.value).toBe(sceneTarget.texture); // MSAA straight to the screen
  });

  it("the roles stay PINNED across frames even though the resolve swaps (PinnedComposer)", () => {
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    const { scene, camera } = sceneAndCamera();
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(resolvePass);
    composer.addPass(new OutputPass());
    composer.render(0);
    composer.render(0);
    composer.render(0);
    const sceneTargets = r.draws.filter((d) => d.what === "SCENE").map((d) => d.target);
    expect(sceneTargets).toHaveLength(3);
    expect(new Set(sceneTargets).size).toBe(1);
    expect(sceneTargets[0]).toBe(sceneTarget);
    // …and every frame ended with OutputPass reading the RESOLVE, never the MSAA buffer.
    // (OutputPass swaps on its way out, which is exactly what the pin exists to absorb.)
    const out = composer.passes.at(-1) as OutputPass;
    expect(out.uniforms.tDiffuse.value).toBe(resolvedTarget.texture);
  });

  it("PinnedComposer is an EffectComposer whose render re-seats the pointers before the chain", () => {
    const r = fakeRenderer();
    const { composer, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    expect(composer).toBeInstanceOf(EffectComposer);
    expect(composer).toBeInstanceOf(PinnedComposer);
    composer.readBuffer = resolvedTarget; // whatever the previous frame left
    composer.writeBuffer = sceneTarget;
    composer.render(0);
    expect(composer.readBuffer).toBe(sceneTarget);
    expect(composer.writeBuffer).toBe(resolvedTarget);
  });
});

describe("MsaaResolvePass", () => {
  it("is a bit-exact copy: NoBlending, no depth interaction, no tone map, opacity 1", () => {
    const p = new MsaaResolvePass();
    expect(p.material.blending).toBe(THREE.NoBlending);
    expect(p.material.depthTest).toBe(false);
    expect(p.material.depthWrite).toBe(false);
    expect(p.material.toneMapped).toBe(false);
    expect(p.uniforms.opacity.value).toBe(1);
    // `opacity * texel` — and nothing else. No tone-map or colour-space chunk to change a value.
    expect(p.material.fragmentShader).toMatch(/gl_FragColor = opacity \* texel;/);
    expect(p.material.fragmentShader).not.toMatch(/tonemapping|colorspace/i);
  });

  it("draws into the write buffer and SWAPS when handed a multisampled read buffer", () => {
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    resolvePass.render(r, resolvedTarget, sceneTarget);
    expect(resolvePass.needsSwap).toBe(true);
    expect(r.draws).toHaveLength(1);
    expect(r.draws[0].target).toBe(resolvedTarget);
    expect(resolvePass.uniforms.tDiffuse.value).toBe(sceneTarget.texture);
    expect(composer.renderTarget1).toBe(resolvedTarget); // untouched by the pass
  });

  it("stands DOWN — no draw, no swap — when the read buffer is already single-sample", () => {
    const r = fakeRenderer();
    const { resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    resolvePass.render(r, sceneTarget, resolvedTarget);
    expect(resolvePass.needsSwap).toBe(false);
    expect(r.draws).toHaveLength(0);
  });

  it("a swapping pass ahead of it (the GTAO shape) makes it stand down inside a real chain", () => {
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    const { scene, camera } = sceneAndCamera();
    const bloom = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(resolvePass);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.insertPass(new SwappingPass(), 1); // AO's slot
    composer.render(0);
    expect(resolvePass.needsSwap).toBe(false);
    // The scene still went to MSAA; the bloom still blended into the single-sample buffer.
    expect(r.draws.find((d) => d.what === "SCENE")!.target).toBe(sceneTarget);
    expect(r.draws.at(-2)!.target).toBe(resolvedTarget); // the bloom blend (OutputPass is last, to screen)
    expect(r.draws.at(-1)!.target).toBe(null);
  });
});

describe("T80g — the lever itself: where the bloom's full-resolution blend lands", () => {
  /** Build the shipped chain and return the target of the bloom's final additive blend. */
  function blendTarget(resolveEnabled: boolean) {
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    const { scene, camera } = sceneAndCamera();
    const bloom = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(resolvePass);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    resolvePass.enabled = resolveEnabled;
    composer.render(0);
    const draws = r.draws;
    // The chain's last two draws are the bloom's blend and the OutputPass (to screen).
    return {
      scene: draws.find((d) => d.what === "SCENE")!.target,
      blend: draws.at(-2)!.target,
      screen: draws.at(-1)!.target,
      sceneTarget,
      resolvedTarget,
      output: composer.passes.at(-1) as OutputPass,
    };
  }

  it("ON (the ship default): the scene is MSAA, the blend and OutputPass work on the resolve", () => {
    const t = blendTarget(true);
    expect(t.scene).toBe(t.sceneTarget);
    expect(t.blend).toBe(t.resolvedTarget);
    expect(t.blend!.samples).toBe(0); // the whole point: one sample per pixel, one resolve per frame
    expect(t.screen).toBe(null);
    expect(t.output.uniforms.tDiffuse.value).toBe(t.resolvedTarget.texture);
  });

  it("OFF (`__quality.bloomPath('msaa')` / bloom disabled): exactly the pre-T80g chain", () => {
    const t = blendTarget(false);
    expect(t.scene).toBe(t.sceneTarget);
    expect(t.blend).toBe(t.sceneTarget); // full-res additive into the 4× MSAA buffer, as before
    expect(t.blend!.samples).toBe(SAMPLES);
    expect(t.output.uniforms.tDiffuse.value).toBe(t.sceneTarget.texture);
  });

  it("the identity levers T80 shipped are untouched: ScaledBloomPass at scale 1 forwards setSize", () => {
    const r = fakeRenderer();
    const { composer, resolvePass } = createResolvedComposer(r, W, H, SAMPLES);
    const bloom = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    const stock = new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    composer.addPass(resolvePass);
    composer.addPass(bloom);
    composer.setPixelRatio(1.5);
    composer.setSize(853, 480); // a NON-INTEGER effective size — the case a `round(w*1)` would move
    stock.setSize(853 * 1.5, 480 * 1.5);
    expect(bloom.scale).toBe(1);
    expect([bloom.renderTargetBright.width, bloom.renderTargetBright.height]).toEqual([
      stock.renderTargetBright.width,
      stock.renderTargetBright.height,
    ]);
  });
});

/**
 * The CALLER's half of the contract (`scene/resolvedComposer.ts` C1–C4). These are source fences
 * on `GlobeCanvas.tsx` in the repo's established idiom (the T80 `setScale` fence in
 * `fences.test.ts`): the wiring they pin has no unit-testable runtime surface — GlobeCanvas is a
 * `client:only` React island holding a live WebGL context — but every one of them is a silent,
 * expensive failure if it drifts.
 */
describe("T80g — the GlobeCanvas wiring (contract C1–C4)", () => {
  it("C2 LOCKSTEP: `setBloomEnabled` is the ONLY writer of bloomPass.enabled and resolvePass.enabled", () => {
    // RED if a later edit writes `bloomPass.enabled = …` directly again: the resolve would stay
    // on with bloom off (a full-resolution copy for nothing on exactly the devices T83 is about),
    // or — worse — stay off with bloom on, which silently reverts the whole lever.
    const writes = (name: string) =>
      [...GLOBE_CANVAS.matchAll(new RegExp(`${name}\\.enabled\\s*=(?!=)`, "g"))].length;
    expect(writes("bloomPass")).toBe(1);
    expect(writes("resolvePass")).toBe(1);
    // …and that one writer really is the closure, holding both in one statement pair.
    // T80-h widened the closure to four levers (C2'); `fusedBloom.test.ts` pins the whole body —
    // here only the T80-g half: the resolve follows the READ-BACK flag and the live path.
    expect(GLOBE_CANVAS).toMatch(
      /const setBloomEnabled = \(on: boolean\) => \{\s*bloomPass\.enabled = on;\s*const path = bloomPathNow\(\);\s*resolvePass\.enabled = bloomPass\.enabled && path === "resolved";/,
    );
    // POSITIVE CONTROL: the probe can match a direct write (it is `!==` that must NOT count).
    expect(/bloomPass\.enabled\s*=(?!=)/.test("bloomPass.enabled = true")).toBe(true);
    expect(/bloomPass\.enabled\s*=(?!=)/.test("if (bloomPass.enabled !== bloomWas)")).toBe(false);
    // Every site that used to assign now routes through it: boot, the tier apply, the tick.
    expect([...GLOBE_CANVAS.matchAll(/setBloomEnabled\(/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("C1 ORDER: RenderPass → [GTAO @ 1] → resolve → bloom → FusedOutputPass (T80-h: the output subclass)", () => {
    const at = (needle: string) => {
      const i = GLOBE_CANVAS.indexOf(needle);
      expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const render = at("composer.addPass(new RenderPass(scene, camera));");
    const resolve = at("composer.addPass(resolvePass);");
    const bloom = at("composer.addPass(bloomPass);");
    const output = at("composer.addPass(outputPass);"); // T80-h: `new FusedOutputPass()`, an OutputPass by inheritance
    expect(render).toBeLessThan(resolve);
    expect(resolve).toBeLessThan(bloom);
    expect(bloom).toBeLessThan(output);
    // GTAO goes in at index 1 — BEFORE the resolve, which then stands down on its own because
    // GTAO swaps and hands it a single-sample read buffer (C5). Order, not a flag, keeps it true.
    expect(GLOBE_CANVAS).toMatch(/composer\.insertPass\(gtaoPass, 1\);/);
  });

  it("C4 TEARDOWN: the resolve pass is disposed by us, the buffers by the composer, no orphan target", () => {
    const teardown = GLOBE_CANVAS.slice(GLOBE_CANVAS.lastIndexOf("return () => {"));
    expect(teardown).toMatch(/resolvePass\.dispose\(\);/);
    expect(teardown).toMatch(/composer\.dispose\(\);/);
    // The pre-T80g standalone `composeTarget` is gone everywhere — a surviving reference would be
    // a render target that nothing resizes and nothing frees.
    expect(GLOBE_CANVAS).not.toMatch(/composeTarget/);
    expect(GLOBE_CANVAS).not.toMatch(/new EffectComposer\(/);
  });

  it("the /m PiP is untouched: its own HalfFloat target, blitted AFTER the composed frame", () => {
    const start = GLOBE_CANVAS.indexOf("const pip = tilesHandle?.pipRect()");
    const end = GLOBE_CANVAS.indexOf("// DEBUG HUD — close the draw bracket", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = GLOBE_CANVAS.slice(start, end);
    // It renders the scene into a target it owns and blits that — it never read a composer buffer
    // before T80g and must not start now (the miniature would inherit the MSAA/resolve split).
    expect(block).toMatch(/pipRT = new THREE\.WebGLRenderTarget\(want\.w, want\.h, \{ type: THREE\.HalfFloatType \}\)/);
    for (const forbidden of ["sceneTarget", "resolvedTarget", "resolvePass", "composer."]) {
      expect({ forbidden, hit: block.includes(forbidden) }).toEqual({ forbidden, hit: false });
    }
    // …and the blit still lands on top of the composed frame, not before it.
    expect(GLOBE_CANVAS.indexOf("composer.render();")).toBeLessThan(start);
  });

  it("the DEV seams survive: bloomScale (T80) and bloomPath (T80g), both reading LIVE state", () => {
    expect(GLOBE_CANVAS).toMatch(/bloomScale: \(s\?: number \| null\) => \{/);
    expect(GLOBE_CANVAS).toMatch(/bloomPath: \(p\?: BloomPath \| null\) => \{/); // T80-h: "msaa" | "resolved" | "fused" (`tuning.ts`)
    // The A/B's proof-of-fire fields come off the live targets and the live pass, never off the
    // request — a seam that echoed its argument would report a pass for a lever that never fired.
    for (const field of [
      "resolveEnabled: resolvePass.enabled",
      "sceneSamples: sceneTarget.samples",
      "resolvedSamples: resolvedTarget.samples",
    ]) {
      expect(GLOBE_CANVAS).toContain(field);
    }
  });
});
