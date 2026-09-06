import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ScaledBloomPass } from "../../../src/components/globe/scene/scaledBloom";

/**
 * T80 — `ScaledBloomPass`, the per-tier bloom RESOLUTION.
 *
 * Two things are pinned here, in the `pluxGlobeControls.test.ts` idiom.
 *
 * (1) THE LIBRARY SURFACE the subclass leans on (three 0.185 `UnrealBloomPass.js`). The whole
 *     lever exists because the constructor's `resolution` is inert and `setSize` re-derives the
 *     chain — if a three bump changes that shape, this fails HERE rather than shipping a bloom
 *     that silently ignores its tier.
 * (2) THE IDENTITY LAW: at scale 1 the subclass IS the stock pass, checked against a real stock
 *     instance on a NON-INTEGER size — the case where a `round(w × 1)` implementation would drift
 *     and an integer-only test would never notice.
 *
 * Construction is CPU-only: `WebGLRenderTarget`, `ShaderMaterial` and `FullScreenQuad` allocate
 * no GL until something renders them, so this runs in the repo's node environment with no mocks.
 */

const root = join(__dirname, "..", "..", "..");
const LIB = readFileSync(
  join(root, "node_modules", "three", "examples", "jsm", "postprocessing", "UnrealBloomPass.js"),
  "utf8",
);

/** A pass's full geometry: the bright extract plus every horizontal/vertical mip pair. */
function shape(p: UnrealBloomPass) {
  return {
    bright: [p.renderTargetBright.width, p.renderTargetBright.height],
    h: p.renderTargetsHorizontal.map((t) => [t.width, t.height]),
    v: p.renderTargetsVertical.map((t) => [t.width, t.height]),
    invSize: p.separableBlurMaterials.map((m) => {
      const s = m.uniforms.invSize.value as THREE.Vector2;
      return [s.x, s.y];
    }),
  };
}

const stock = () =>
  new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.4, 0.5, 0.9);
const scaled = () =>
  new ScaledBloomPass(new THREE.Vector2(1280, 720), 0.4, 0.5, 0.9);

describe("ScaledBloomPass — the library surface it scales is still what three 0.185 shipped", () => {
  it("the constructor's `resolution` sizes the chain ONCE and setSize re-derives it from its own arguments", () => {
    // The premise of the whole lever: `composer.setSize` → `pass.setSize(w, h)` re-sizes every
    // target from THOSE numbers, so the constructor value cannot survive the first frame and a
    // scale can only live inside `setSize`.
    expect(LIB).toMatch(/this\.nMips = 5;/);
    expect(LIB).toMatch(/let resx = Math\.round\( this\.resolution\.x \/ 2 \);/);
    const setSize = LIB.slice(LIB.indexOf("setSize( width, height ) {"));
    expect(setSize.slice(0, 400)).toMatch(/let resx = Math\.round\( width \/ 2 \);/);
    expect(setSize.slice(0, 400)).toMatch(/let resy = Math\.round\( height \/ 2 \);/);
    expect(setSize.slice(0, 800)).toMatch(/this\.renderTargetBright\.setSize\( resx, resy \);/);
    // The five kernels are fixed in TEXELS of their own mip — which is why a scaled chain keeps
    // the glow's shape and reach and only softens its finest detail.
    expect(LIB).toMatch(/const kernelSizeArray = \[ 6, 10, 14, 18, 22 \];/);
  });

  it("only the final additive blend touches the full-res readBuffer — the 12 cheap draws are the chain", () => {
    // The cost claim the tier table's comments rest on. The blend material is additive and the
    // one draw bound to `readBuffer`; everything before it renders into the mip targets.
    expect(LIB).toMatch(/blending: AdditiveBlending,/);
    const render = LIB.slice(LIB.indexOf("render( renderer, writeBuffer, readBuffer"));
    const blend = render.slice(render.indexOf("this._fsQuad.material = this.blendMaterial;"));
    expect(blend).toMatch(/renderer\.setRenderTarget\( readBuffer \);/);
    // POSITIVE CONTROL: the slice really is the blend tail, not an empty string.
    expect(blend).toMatch(/this\.copyUniforms\[ 'tDiffuse' \]\.value = this\.renderTargetsHorizontal\[ 0 \]\.texture;/);
    // …and the mip loop before it binds only the pass's own targets.
    const loop = render.slice(render.indexOf("for ( let i = 0; i < this.nMips; i ++ )"));
    expect(loop.slice(0, 900)).toMatch(/renderer\.setRenderTarget\( this\.renderTargetsHorizontal\[ i \] \);/);
    expect(loop.slice(0, 900)).toMatch(/renderer\.setRenderTarget\( this\.renderTargetsVertical\[ i \] \);/);
  });
});

describe("ScaledBloomPass — the identity law at scale 1", () => {
  it("a NON-INTEGER size produces a chain identical to the stock pass, target for target", () => {
    // 2560.5 × 1440.5 is the case that separates "forwards the arguments" from "computes
    // round(w × 1)": the library's own `round(w / 2)` sees 1280.25 in one implementation and
    // 1280 in the other, and every mip below inherits the difference.
    const a = scaled();
    const b = stock();
    a.setSize(2560.5, 1440.5);
    b.setSize(2560.5, 1440.5);
    expect(a.scale).toBe(1);
    expect(shape(a)).toEqual(shape(b));
    // Named explicitly so a failure says WHICH half drifted.
    expect([a.renderTargetBright.width, a.renderTargetBright.height]).toEqual([
      b.renderTargetBright.width,
      b.renderTargetBright.height,
    ]);
    expect(a.renderTargetsHorizontal).toHaveLength(5);
    expect(a.renderTargetsVertical).toHaveLength(5);
    expect(a.nMips).toBe(5);
    for (let i = 0; i < a.nMips; i++) {
      const ah = a.separableBlurMaterials[i].uniforms.invSize.value as THREE.Vector2;
      const bh = b.separableBlurMaterials[i].uniforms.invSize.value as THREE.Vector2;
      expect([ah.x, ah.y]).toEqual([bh.x, bh.y]);
    }
  });

  it("integer sizes match too, and re-seating the same size is stable", () => {
    const a = scaled();
    const b = stock();
    a.setSize(1920, 1080);
    b.setSize(1920, 1080);
    expect(shape(a)).toEqual(shape(b));
    a.setSize(1920, 1080);
    expect(shape(a)).toEqual(shape(b));
  });
});

describe("ScaledBloomPass — a scale below 1", () => {
  it("0.5 gives exactly the chain the stock pass would build at half the size", () => {
    const a = scaled();
    a.setScale(0.5);
    a.setSize(2560, 1440);
    const b = stock();
    b.setSize(1280, 720); // what `super.setSize` is handed at 0.5
    expect(shape(a)).toEqual(shape(b));
    // …and that really is HALF, not the same chain: the bright extract is a quarter of the pixels.
    const full = stock();
    full.setSize(2560, 1440);
    expect(a.renderTargetBright.width * 2).toBe(full.renderTargetBright.width);
    expect(a.renderTargetBright.height * 2).toBe(full.renderTargetBright.height);
    for (let i = 0; i < a.nMips; i++) {
      expect(a.renderTargetsHorizontal[i].width).toBeLessThan(full.renderTargetsHorizontal[i].width);
      expect(a.renderTargetsVertical[i].height).toBeLessThan(full.renderTargetsVertical[i].height);
    }
  });

  it("the order of setScale and setSize does not matter (a scale set before the first size waits for it)", () => {
    const before = scaled();
    before.setScale(0.5);
    before.setSize(2560, 1440);
    const after = scaled();
    after.setSize(2560, 1440);
    after.setScale(0.5); // re-drives setSize from the stored logical size, not a scaled copy
    expect(shape(after)).toEqual(shape(before));
    // The stored size is the LOGICAL one: scaling twice must not compound.
    after.setScale(1);
    const plain = scaled();
    plain.setSize(2560, 1440);
    expect(shape(after)).toEqual(shape(plain));
  });
});

describe("ScaledBloomPass — the max(4, …) clamp", () => {
  it("a 320×200 viewport at the shipped 0.5 keeps every mip at least 1 px", () => {
    const p = scaled();
    p.setScale(0.5);
    p.setSize(320, 200);
    for (const t of [...p.renderTargetsHorizontal, ...p.renderTargetsVertical, p.renderTargetBright]) {
      expect(t.width).toBeGreaterThanOrEqual(1);
      expect(t.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("POSITIVE CONTROL: without the floor the chain would collapse — the clamp is what holds it", () => {
    // A scale small enough that `round(320 × s)` is 0: the bright extract would be 0 px wide and
    // every `invSize` uniform would be Infinity. The clamp pins `super.setSize` at 4×4 instead.
    const p = scaled();
    p.setScale(0.001);
    p.setSize(320, 200);
    expect(Math.round(320 * 0.001)).toBe(0); // the value the clamp replaced
    expect([p.renderTargetBright.width, p.renderTargetBright.height]).toEqual([2, 2]); // round(4/2)
    for (const t of [...p.renderTargetsHorizontal, ...p.renderTargetsVertical]) {
      expect(t.width).toBeGreaterThanOrEqual(1);
      expect(t.height).toBeGreaterThanOrEqual(1);
    }
    for (const m of p.separableBlurMaterials) {
      const s = m.uniforms.invSize.value as THREE.Vector2;
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });
});

describe("ScaledBloomPass — setScale is idempotent", () => {
  it("setting the same scale twice re-sizes nothing (six render targets are not re-seated)", () => {
    const p = scaled();
    p.setSize(2560, 1440);
    const spy = vi.spyOn(p, "setSize");
    p.setScale(0.5);
    expect(spy).toHaveBeenCalledTimes(1); // changed → re-drives the chain
    const at05 = shape(p);
    p.setScale(0.5);
    expect(spy).toHaveBeenCalledTimes(1); // unchanged → short-circuits
    expect(shape(p)).toEqual(at05);
    expect(p.scale).toBe(0.5);
    p.setScale(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(p.scale).toBe(1);
    spy.mockRestore();
  });

  it("setScale(1) on a never-sized pass is a pure no-op (the boot order GlobeCanvas uses)", () => {
    // `bloomPass.setScale(bloomScaleForTier(...))` runs at construction, before the composer's
    // first `setSize`. On `high` that value is 1 — it must not touch anything.
    const p = scaled();
    const spy = vi.spyOn(p, "setSize");
    p.setScale(1);
    expect(spy).not.toHaveBeenCalled();
    expect(p.scale).toBe(1);
    spy.mockRestore();
  });
});
