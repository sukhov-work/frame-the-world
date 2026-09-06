import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { OutputShader } from "three/addons/shaders/OutputShader.js";
import { createResolvedComposer } from "../../../src/components/globe/scene/resolvedComposer";
import { ScaledBloomPass } from "../../../src/components/globe/scene/scaledBloom";
import { FUSED_OUTPUT_FRAGMENT, FusedOutputPass } from "../../../src/components/globe/scene/fusedOutput";
import { BLOOM } from "../../../src/components/globe/tuning";

/**
 * T80-h — THE FUSED BLOOM PATH (`scene/scaledBloom.ts` `deferBlend` + `scene/fusedOutput.ts`).
 *
 * What is pinned, and why each pin is load-bearing:
 *  1. The library body the deferred-blend `render()` was copied from — a three bump that changes
 *     the chain must fail HERE, not drift silently behind the copy.
 *  2. Deferred = the same twelve draws into the same targets, minus exactly the thirteenth (the
 *     full-resolution blend into the read buffer). Not "fewer draws" — the SAME draws.
 *  3. The fused output shader is the library's `OutputShader` with exactly two edits, and the
 *     off-state material IS the library's (same object the base class built).
 *  4. On the fused chain no draw ever binds the single-sample buffer (contract C7).
 *  5. The GlobeCanvas lockstep (C2') has one writer for all four levers, and T99's redundant
 *     `composer.setPixelRatio` is gone from the boot block.
 */

const root = join(__dirname, "..", "..", "..");
const jsm = (f: string) => readFileSync(join(root, "node_modules", "three", "examples", "jsm", f), "utf8");
const GLOBE_CANVAS = readFileSync(join(root, "src/components/globe/GlobeCanvas.tsx"), "utf8");
const SCALED_BLOOM = readFileSync(join(root, "src/components/globe/scene/scaledBloom.ts"), "utf8");

const W = 320;
const H = 200;
const SAMPLES = 4;

/** The recording renderer from `resolvedComposer.test.ts`, with the clear-colour plumbing bloom uses. */
function fakeRenderer() {
  const draws: Array<{ target: THREE.WebGLRenderTarget | null; material: string }> = [];
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
      const m = (obj as THREE.Mesh).material as THREE.Material | undefined;
      draws.push({ target: bound, material: obj.name || m?.name || obj.type });
    },
  };
  return r as unknown as THREE.WebGLRenderer & { draws: typeof draws };
}

const bloomOf = () => {
  const b = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
  b.setSize(W, H);
  return b;
};

// ─── 1. the library body the copy was made from ──────────────────────────────────────────────

describe("T80-h — the UnrealBloomPass render body the deferred blend reproduces (three 0.185)", () => {
  const src = jsm("postprocessing/UnrealBloomPass.js");
  const start = src.indexOf("// 1. Extract Bright Areas");
  const end = src.indexOf("// Blend it additively over the input texture");
  const body = src.slice(start, end);

  it("the two anchors exist and bound the twelve chain draws", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // the high pass, the H/V loop over nMips, the composite — the exact shape the copy has
    expect(body).toContain("renderer.setRenderTarget( this.renderTargetBright );");
    expect(body).toContain("for ( let i = 0; i < this.nMips; i ++ ) {");
    expect(body).toContain("renderer.setRenderTarget( this.renderTargetsHorizontal[ i ] );");
    expect(body).toContain("renderer.setRenderTarget( this.renderTargetsVertical[ i ] );");
    expect(body).toContain("renderer.setRenderTarget( this.renderTargetsHorizontal[ 0 ] );");
    expect(body.match(/this\._fsQuad\.render\( renderer \);/g)!.length).toBe(4); // bright, H, V, composite
  });

  it("the body is byte-for-byte the text `scaledBloom.ts` was derived from (re-derive the copy on a three bump)", () => {
    // Whitespace-normalised so an editor reformat of node_modules cannot trip it; anything else can.
    const norm = body.replace(/\s+/g, " ").trim();
    const digest = createHash("sha256").update(norm).digest("hex");
    expect({ digest, hint: "UnrealBloomPass.js changed between 'Extract Bright Areas' and 'Blend it additively' — re-derive ScaledBloomPass.render's deferred branch, then update this digest" })
      .toEqual({ digest: "6fa0233789092e685176ce71611428faa3a190137d7e2b947e754c23934e4899", hint: expect.any(String) });
  });

  it("the blend the copy omits is the library's only full-resolution draw, additive, into readBuffer", () => {
    const blend = src.slice(end);
    expect(blend).toContain("this._fsQuad.material = this.blendMaterial;");
    expect(blend).toContain("renderer.setRenderTarget( readBuffer );");
    expect(src).toContain("blending: AdditiveBlending,");
    expect(src).toContain("premultipliedAlpha: true,");
  });

  it("our copy really is a copy: the deferred branch names every library field the body touches", () => {
    for (const needle of [
      "renderTargetBright",
      "separableBlurMaterials[i]",
      "renderTargetsHorizontal[i]",
      "renderTargetsVertical[i]",
      "compositeMaterial",
      "renderTargetsHorizontal[0]",
      '"luminosityThreshold"',
      '"bloomStrength"',
      '"bloomRadius"',
      '"bloomTintColors"',
    ]) {
      expect(SCALED_BLOOM, needle).toContain(needle);
    }
    // …and does NOT reach for the blend material — that is the whole point of the branch.
    const branch = SCALED_BLOOM.slice(SCALED_BLOOM.indexOf("if (!this.deferBlend) {"));
    expect(branch).not.toMatch(/blendMaterial|copyUniforms/);
  });
});

// ─── 2. deferred = the same twelve draws, minus the thirteenth ───────────────────────────────

describe("T80-h — `deferBlend` skips exactly the blend", () => {
  const drawsFor = (defer: boolean) => {
    const r = fakeRenderer();
    const read = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: SAMPLES });
    const write = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
    const b = bloomOf();
    b.deferBlend = defer;
    b.render(r, write, read, 0, false);
    return { r, b, read, write, draws: r.draws };
  };

  it("stock (deferBlend false): thirteen draws, the last into readBuffer — the library's own render", () => {
    const { draws, read } = drawsFor(false);
    expect(draws.length).toBe(13);
    expect(draws.at(-1)!.target).toBe(read);
  });

  it("deferred: the SAME first twelve draws into the SAME targets, and no thirteenth", () => {
    const stock = drawsFor(false);
    const deferred = drawsFor(true);
    expect(deferred.draws.length).toBe(12);
    // pairwise: same target ROLE per draw (bright, H0, V0, …, composite → H0)
    const role = (b: ScaledBloomPass, t: THREE.WebGLRenderTarget | null) => {
      if (t === b.renderTargetBright) return "bright";
      const h = b.renderTargetsHorizontal.indexOf(t as THREE.WebGLRenderTarget);
      if (h >= 0) return `H${h}`;
      const v = b.renderTargetsVertical.indexOf(t as THREE.WebGLRenderTarget);
      if (v >= 0) return `V${v}`;
      return t === null ? "screen" : "other";
    };
    const stockRoles = stock.draws.slice(0, 12).map((d) => role(stock.b, d.target));
    const deferredRoles = deferred.draws.map((d) => role(deferred.b, d.target));
    expect(deferredRoles).toEqual(stockRoles);
    expect(deferredRoles).toEqual(["bright", "H0", "V0", "H1", "V1", "H2", "V2", "H3", "V3", "H4", "V4", "H0"]);
    // and the read buffer was never written — no full-resolution draw at all
    expect(deferred.draws.some((d) => d.target === deferred.read)).toBe(false);
    expect(deferred.draws.some((d) => d.target === deferred.write)).toBe(false);
  });

  it("`bloomTexture` is the composite the blend would have drawn (mip-0 horizontal target)", () => {
    const b = bloomOf();
    expect(b.bloomTexture).toBe(b.renderTargetsHorizontal[0].texture);
    expect(b.renderTargetsHorizontal[0].width).toBe(Math.round(W / 2));
    expect(b.renderTargetsHorizontal[0].height).toBe(Math.round(H / 2));
  });

  it("the renderer state the library saves/restores is restored on the deferred branch too", () => {
    const r = fakeRenderer();
    r.autoClear = true;
    const b = bloomOf();
    b.deferBlend = true;
    b.render(r, new THREE.WebGLRenderTarget(W, H), new THREE.WebGLRenderTarget(W, H), 0, false);
    expect(r.autoClear).toBe(true);
  });

  it("deferBlend defaults OFF — the identity law: a fresh pass is the stock pass", () => {
    expect(new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9).deferBlend).toBe(false);
  });
});

// ─── 3. the fused output shader ──────────────────────────────────────────────────────────────

describe("T80-h — FusedOutputPass is `OutputShader` with exactly two edits", () => {
  it("undoing the two edits gives back the library fragment byte-for-byte", () => {
    const undone = FUSED_OUTPUT_FRAGMENT.replace("uniform sampler2D tDiffuse;\n\t\tuniform sampler2D tBloom;", "uniform sampler2D tDiffuse;").replace(
      "gl_FragColor = texture2D( tDiffuse, vUv ) + texture2D( tBloom, vUv );",
      "gl_FragColor = texture2D( tDiffuse, vUv );",
    );
    expect(undone).toBe(OutputShader.fragmentShader);
    expect(FUSED_OUTPUT_FRAGMENT).not.toBe(OutputShader.fragmentShader);
  });

  it("the add happens BEFORE the tone map and the sRGB encode (linear-light sum, as the stock blend)", () => {
    const add = FUSED_OUTPUT_FRAGMENT.indexOf("+ texture2D( tBloom, vUv )");
    const tm = FUSED_OUTPUT_FRAGMENT.indexOf("#ifdef LINEAR_TONE_MAPPING");
    const srgb = FUSED_OUTPUT_FRAGMENT.indexOf("#ifdef SRGB_TRANSFER");
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(tm);
    expect(tm).toBeLessThan(srgb);
    // all four channels are added, as `blendFunc(ONE, ONE)` on the stock blend adds them
    expect(FUSED_OUTPUT_FRAGMENT).toContain("gl_FragColor = texture2D( tDiffuse, vUv ) + texture2D( tBloom, vUv );");
  });

  it("the off-state material IS the base class's own (same object, stock shader, stock name)", () => {
    const p = new FusedOutputPass();
    const plain = p.material;
    expect(plain.fragmentShader).toBe(OutputShader.fragmentShader);
    expect(plain.name).toBe("OutputShader");
    expect(p.bloomTexture).toBe(null);
    // an OutputPass by inheritance — the composer treats it as the output (isOutputPass)
    expect(p).toBeInstanceOf(OutputPass);
    expect(p.isOutputPass).toBe(true);
  });

  it("setBloomTexture(tex) switches to the fused material and binds tBloom; (null) restores the SAME plain object", () => {
    const p = new FusedOutputPass();
    const plain = p.material;
    const tex = new THREE.Texture();
    p.setBloomTexture(tex);
    expect(p.material).not.toBe(plain);
    expect(p.material.name).toBe("FusedOutputShader");
    expect(p.material.fragmentShader).toBe(FUSED_OUTPUT_FRAGMENT);
    expect(p.uniforms).toBe(p.material.uniforms); // the base render() writes tDiffuse through this
    expect(p.uniforms.tBloom.value).toBe(tex);
    expect(p.bloomTexture).toBe(tex);
    p.setBloomTexture(null);
    expect(p.material).toBe(plain);
    expect(p.uniforms).toBe(plain.uniforms);
    expect(p.bloomTexture).toBe(null);
  });

  it("the base render() rebuilds the tone-map defines on WHICHEVER material is active after a switch", () => {
    const r = fakeRenderer();
    const p = new FusedOutputPass();
    const read = new THREE.WebGLRenderTarget(W, H);
    p.renderToScreen = true;
    p.render(r, read, read, 0, false); // plain, first frame → defines built on plain
    const plain = p.material;
    expect(plain.defines).toMatchObject({ NEUTRAL_TONE_MAPPING: "", SRGB_TRANSFER: "" });
    p.setBloomTexture(new THREE.Texture());
    expect(p.material.defines ?? {}).not.toHaveProperty("NEUTRAL_TONE_MAPPING"); // not yet — built lazily
    p.render(r, read, read, 0, false); // fused, first frame → defines built on fused
    expect(p.material.defines).toMatchObject({ NEUTRAL_TONE_MAPPING: "", SRGB_TRANSFER: "" });
    expect(p.uniforms.tDiffuse.value).toBe(read.texture);
    // …and back: the cache was nulled again, so the plain material is refreshed rather than trusted
    p.setBloomTexture(null);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    p.render(r, read, read, 0, false);
    expect(plain.defines).toMatchObject({ ACES_FILMIC_TONE_MAPPING: "" });
    expect(plain.defines).not.toHaveProperty("NEUTRAL_TONE_MAPPING");
  });

  it("dispose() frees BOTH materials (the base frees only the active one)", () => {
    const p = new FusedOutputPass();
    const plain = p.material;
    p.setBloomTexture(new THREE.Texture());
    const fused = p.material;
    let freed = 0;
    plain.addEventListener("dispose", () => freed++);
    fused.addEventListener("dispose", () => freed++);
    p.dispose();
    expect(freed).toBe(2);
  });
});

// ─── 4. the fused chain never binds the single-sample buffer (C7) ────────────────────────────

describe("T80-h — the fused chain (contract C7)", () => {
  function chain(path: "msaa" | "resolved" | "fused") {
    const r = fakeRenderer();
    const { composer, resolvePass, sceneTarget, resolvedTarget } = createResolvedComposer(r, W, H, SAMPLES);
    const scene = new THREE.Scene();
    scene.name = "SCENE";
    const bloom = new ScaledBloomPass(new THREE.Vector2(W, H), 0.4, 0.5, 0.9);
    const output = new FusedOutputPass();
    composer.addPass(new RenderPass(scene, new THREE.PerspectiveCamera()));
    composer.addPass(resolvePass);
    composer.addPass(bloom);
    composer.addPass(output);
    // C2' — the writer's table, replayed
    resolvePass.enabled = path === "resolved";
    bloom.deferBlend = path === "fused";
    output.setBloomTexture(bloom.deferBlend ? bloom.bloomTexture : null);
    composer.render(0);
    return { r, bloom, output, sceneTarget, resolvedTarget, draws: r.draws };
  }

  it("fused: the scene is MSAA, nothing binds resolvedTarget, the screen draw reads scene + bloom", () => {
    const t = chain("fused");
    expect(t.draws.find((d) => d.material === "SCENE")!.target).toBe(t.sceneTarget);
    expect(t.draws.some((d) => d.target === t.resolvedTarget)).toBe(false);
    expect(t.draws.at(-1)!.target).toBe(null);
    expect(t.output.material.name).toBe("FusedOutputShader");
    expect(t.output.uniforms.tDiffuse.value).toBe(t.sceneTarget.texture);
    expect(t.output.uniforms.tBloom.value).toBe(t.bloom.bloomTexture);
    // 1 scene + 12 chain + 1 screen; no copy, no blend
    expect(t.draws.length).toBe(14);
  });

  it("resolved (T80-g): the copy and the blend land on resolvedTarget, the output is the stock draw", () => {
    const t = chain("resolved");
    expect(t.draws.filter((d) => d.target === t.resolvedTarget).length).toBe(2); // copy + blend
    expect(t.output.material.name).toBe("OutputShader");
    expect(t.output.uniforms.tDiffuse.value).toBe(t.resolvedTarget.texture);
    expect(t.draws.length).toBe(16); // 1 + copy + 13 + 1
  });

  it("msaa (pre-T80g): the blend lands on the MSAA scene buffer, the output is the stock draw", () => {
    const t = chain("msaa");
    expect(t.draws.at(-2)!.target).toBe(t.sceneTarget);
    expect(t.output.material.name).toBe("OutputShader");
    expect(t.output.uniforms.tDiffuse.value).toBe(t.sceneTarget.texture);
    expect(t.draws.length).toBe(15);
  });

  it("the ship default is the fused path", () => {
    expect(BLOOM.path).toBe("fused");
  });
});

// ─── 5. GlobeCanvas: the lockstep writer and the T99 boot fix ────────────────────────────────

describe("T80-h — the GlobeCanvas wiring (C2', T99)", () => {
  it("C2': ONE writer sets bloom enabled, the resolve, the deferred blend and the output's bloom input", () => {
    const writes = (re: RegExp) => [...GLOBE_CANVAS.matchAll(re)].length;
    expect(writes(/bloomPass\.enabled\s*=(?!=)/g)).toBe(1);
    expect(writes(/resolvePass\.enabled\s*=(?!=)/g)).toBe(1);
    expect(writes(/bloomPass\.deferBlend\s*=(?!=)/g)).toBe(1);
    expect(writes(/outputPass\.setBloomTexture\(/g)).toBe(1);
    expect(GLOBE_CANVAS).toMatch(
      /const setBloomEnabled = \(on: boolean\) => \{\s*bloomPass\.enabled = on;\s*const path = bloomPathNow\(\);\s*resolvePass\.enabled = bloomPass\.enabled && path === "resolved";\s*bloomPass\.deferBlend = bloomPass\.enabled && path === "fused";\s*outputPass\.setBloomTexture\(bloomPass\.deferBlend \? bloomPass\.bloomTexture : null\);\s*\};/,
    );
    // the default comes from the tunable, the pin from the DEV seam — nothing else
    expect(GLOBE_CANVAS).toContain("const bloomPathNow = (): BloomPath => devBloomPath ?? BLOOM.path;");
  });

  it("the output pass is the fused subclass, added last, and disposed at teardown", () => {
    expect(GLOBE_CANVAS).toContain("const outputPass = new FusedOutputPass();");
    expect(GLOBE_CANVAS).not.toMatch(/new OutputPass\(/);
    const bloom = GLOBE_CANVAS.indexOf("composer.addPass(bloomPass);");
    const output = GLOBE_CANVAS.indexOf("composer.addPass(outputPass);");
    expect(bloom).toBeGreaterThan(-1);
    expect(output).toBeGreaterThan(bloom);
    const teardown = GLOBE_CANVAS.slice(GLOBE_CANVAS.lastIndexOf("return () => {"));
    expect(teardown).toMatch(/outputPass\.dispose\(\);/);
  });

  it("the DEV seam reports the fused proof-of-fire off the live passes", () => {
    expect(GLOBE_CANVAS).toMatch(/bloomPath: \(p\?: BloomPath \| null\) => \{/);
    for (const field of ["deferBlend: bloomPass.deferBlend", "outputMaterial: outputPass.material.name", "outputBloomBound: outputPass.bloomTexture !== null"]) {
      expect(GLOBE_CANVAS).toContain(field);
    }
  });

  it("T99: no `composer.setPixelRatio()` in the boot block — the constructor took the ratio, onResize sizes", () => {
    const start = GLOBE_CANVAS.indexOf("createResolvedComposer(");
    const end = GLOBE_CANVAS.indexOf("composer.addPass(new RenderPass(scene, camera));");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(GLOBE_CANVAS.slice(start, end)).not.toMatch(/composer\.setPixelRatio\(/);
    // the tier apply keeps its (correct, post-onResize) call — this fence is about the boot only
    expect(GLOBE_CANVAS).toMatch(/composer\.setPixelRatio\(dpr\);\s*composer\.setSize\(window\.innerWidth, window\.innerHeight\);/);
  });
});
