import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * The library fields the deferred-blend `render()` touches that `@types/three` leaves undeclared
 * or untyped (`highPassUniforms: object`). They are the class's own instance fields
 * (`UnrealBloomPass.js:78-202`), read through this view rather than `any`.
 */
type BloomInternals = {
  _oldClearColor: THREE.Color;
  _oldClearAlpha: number;
  _fsQuad: FullScreenQuad;
  highPassUniforms: Record<string, THREE.IUniform>;
  separableBlurMaterials: THREE.ShaderMaterial[];
  compositeMaterial: THREE.ShaderMaterial;
};
/** `UnrealBloomPass.BlurDirectionX/Y` — statics the library defines and the types omit. */
const BlurDirection = UnrealBloomPass as unknown as { BlurDirectionX: THREE.Vector2; BlurDirectionY: THREE.Vector2 };

/**
 * T80 — `UnrealBloomPass` with a per-tier RESOLUTION SCALE on its mip chain, and (T80-h) a
 * DEFERRED BLEND that hands the composite to `FusedOutputPass` instead of drawing it.
 *
 * WHAT THE LIBRARY DOES (three 0.185, `UnrealBloomPass.js`). The `resolution` handed to the
 * constructor sizes the targets once and is then dead: `EffectComposer.setSize` calls
 * `pass.setSize(width, height)` on every pass, and `UnrealBloomPass.setSize` re-derives the whole
 * chain from THOSE arguments — `resx = round(width / 2)`, `resy = round(height / 2)` for the
 * bright extract, then five horizontal/vertical pairs halving down from there, each pair's
 * `invSize` uniform rewritten to `1/resx, 1/resy`. GlobeCanvas calls `composer.setSize` at boot,
 * on every resize, on a DPR-changing tier apply and on context restore, so the constructor value
 * never survives the first frame. A scale can therefore only live INSIDE `setSize`.
 *
 * WHAT THE SCALE BUYS. The pass draws 13 fullscreen quads and clears 12 targets. Exactly one of
 * those draws — the final additive blend — writes into the full-resolution read buffer; the other
 * twelve run on the chain this scale governs, and they ALREADY start at half resolution (the
 * bright target is `round(w/2) × round(h/2)`). At 0.5 the whole chain costs about a quarter of
 * the fill, and because the blur radii are expressed in TEXELS of each mip the glow keeps its
 * shape and reach: only its finest detail softens. Measured (`MEASUREMENTS_2026-09-05.md` §14.4):
 * the whole twelve-draw chain is worth ≈2 ms at `high`, DPR 2 — the scale is a `mid`/lean lever,
 * not the desktop one.
 *
 * THE IDENTITY LAW, and why the short-circuit is structural. **At scale 1 this class is the stock
 * pass.** `setSize` forwards its arguments to `super.setSize` UNTOUCHED — it does not compute
 * `Math.round(width * 1)` and rely on that being a no-op. The distinction is real: the composer
 * multiplies logical pixels by the pixel ratio, so a retina DPR on an odd viewport hands this a
 * NON-INTEGER width, and `round(w * 1)` would quietly move it before the library's own `round(w/2)`
 * ever saw it. `high` is byte-identical to before T80 by construction, not by arithmetic luck —
 * which is the quality pass's whole safety property (`lib/globe/quality.ts`). The resolver that
 * decides which tier gets which scale is `bloomScaleForTier`, and it returns the literal 1 for
 * `high` through its own branch for the same reason.
 *
 * The `max(4, …)` clamp keeps the FIFTH mip at least one pixel on a small viewport: the chain
 * halves four times, so a bright target under 4 px would round a mip to zero and hand the blur
 * material an `invSize` of Infinity.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * T80-h — THE DEFERRED BLEND (`deferBlend`). With it on, `render()` runs the library's twelve
 * chain draws — the high pass, the five H/V blur pairs, the composite into
 * `renderTargetsHorizontal[0]` — and then STOPS: the thirteenth draw, the full-resolution
 * additive blend into `readBuffer`, is not issued. `bloomTexture` exposes the composite, and
 * `FusedOutputPass` (`scene/fusedOutput.ts`) adds it to the scene sample inside the one
 * full-screen draw the chain already pays for (tone map + sRGB). Together with the resolve pass
 * standing down (`GlobeCanvas` C2') that removes BOTH full-resolution draws T80-g's chain still
 * carried — the copy into the single-sample buffer and the blend — and the single-sample buffer
 * is never bound, so three never allocates it.
 *
 * The picture: identical arithmetic, minus one half-float rounding. The stock blend is
 * `gl.blendFunc(ONE, ONE)` on a HalfFloat target (`dst.rgba += bloom.rgba`, bilinear sample of the
 * same mip-0 composite at the same `vUv` of the same full-screen triangle), followed by
 * `OutputPass` reading that sum; the fused output reads the same two textures at the same `vUv`
 * and adds them in fp32 before tone mapping. `scripts/probe-bloom-path.mjs --paths` measures the
 * residual against a frozen frame (T94), so the noise floor is zero.
 *
 * WHY `render()` IS COPIED, and how the copy is kept honest. The library's blend cannot be
 * suppressed from outside: a `visible = false` blend material still issues the
 * `renderer.render()` into the MSAA read buffer, and three resolves the multisample store in that
 * call's epilogue whether or not anything was drawn — the exact second resolve this lever exists
 * to remove. So the chain's twelve draws are reproduced here, draw for draw, from
 * `UnrealBloomPass.js:306-349`. `test/components/globe/fusedBloom.test.ts` pins the library's
 * `render()` body between its "Extract Bright Areas" and "Blend it additively" comments to the
 * exact text this copy was made from — a three bump that changes the chain turns that test red
 * before the copy can drift. With `deferBlend` off (the default and every off-state), `render()`
 * is the library's own — the identity law holds for the blend exactly as it does for the scale.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
export class ScaledBloomPass extends UnrealBloomPass {
  /** The live scale. 1 means "be the stock pass" — see the identity law above. */
  private _s = 1;
  /** The last size the composer asked for, in the units it asked in (never the scaled ones), so
   *  a later `setScale` can re-drive `setSize` from the truth rather than from a scaled copy. */
  private _w: number | null = null;
  private _h: number | null = null;
  /**
   * T80-h: skip the thirteenth draw and leave the composite in `bloomTexture` for
   * `FusedOutputPass`. Written ONLY by `GlobeCanvas`'s `setBloomEnabled` (the one writer), in
   * lockstep with the resolve pass and the output pass's bloom input.
   */
  deferBlend = false;

  setSize(width: number, height: number): void {
    this._w = width;
    this._h = height;
    // The EXACT off-state: the arguments are forwarded, not recomputed.
    if (this._s === 1) {
      super.setSize(width, height);
      return;
    }
    super.setSize(
      Math.max(4, Math.round(width * this._s)),
      Math.max(4, Math.round(height * this._s)),
    );
  }

  /** The live scale (DBG + the `__quality.bloomScale` A/B seam read this, never a mirror). */
  get scale(): number {
    return this._s;
  }

  /**
   * Set the scale. A no-op when unchanged — re-driving `setSize` re-allocates six render targets,
   * and the tier apply path calls this on every governor step whether or not the tier moved.
   * Before the first `setSize` there is nothing to resize, so the new scale simply waits for it.
   */
  setScale(s: number): void {
    if (s === this._s) return;
    this._s = s;
    if (this._w !== null && this._h !== null) this.setSize(this._w, this._h);
  }

  /**
   * The composite the library's final blend would have drawn: `renderTargetsHorizontal[0]`, at
   * mip-0 resolution (`round(w/2) × round(h/2)` of the pass's size), RGBA16F, linear-filtered.
   * Meaningful after a `render()` with `deferBlend` on; `FusedOutputPass` samples it at `vUv`.
   */
  get bloomTexture(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime?: number,
    maskActive?: boolean,
  ): void {
    if (!this.deferBlend) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime as number, maskActive as boolean);
      return;
    }
    // ── The library's chain, draws 1–12 (`UnrealBloomPass.js:283-349`), minus the blend. ──────
    // Field names below are the library's own (`_oldClearColor`, `_fsQuad`, `highPassUniforms`,
    // `separableBlurMaterials`, `compositeMaterial`), read through the typed view above.
    const lib = this as unknown as BloomInternals;
    renderer.getClearColor(lib._oldClearColor);
    lib._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    if (maskActive) renderer.state.buffers.stencil.setTest(false);

    // 1. Extract Bright Areas
    lib.highPassUniforms["tDiffuse"].value = readBuffer.texture;
    lib.highPassUniforms["luminosityThreshold"].value = this.threshold;
    lib._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    lib._fsQuad.render(renderer);

    // 2. Blur All the mips progressively
    let inputRenderTarget = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      lib._fsQuad.material = lib.separableBlurMaterials[i];
      lib.separableBlurMaterials[i].uniforms["colorTexture"].value = inputRenderTarget.texture;
      lib.separableBlurMaterials[i].uniforms["direction"].value = BlurDirection.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      lib._fsQuad.render(renderer);

      lib.separableBlurMaterials[i].uniforms["colorTexture"].value = this.renderTargetsHorizontal[i].texture;
      lib.separableBlurMaterials[i].uniforms["direction"].value = BlurDirection.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      lib._fsQuad.render(renderer);

      inputRenderTarget = this.renderTargetsVertical[i];
    }

    // Composite All the mips
    lib._fsQuad.material = lib.compositeMaterial;
    lib.compositeMaterial.uniforms["bloomStrength"].value = this.strength;
    lib.compositeMaterial.uniforms["bloomRadius"].value = this.radius;
    lib.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    lib._fsQuad.render(renderer);

    // (The library's "Blend it additively over the input texture" draw is deliberately NOT here —
    // `FusedOutputPass` performs the add. The stencil test the library re-enables before its blend
    // is restored all the same, so a masked chain leaves the state as it found it.)
    if (maskActive) renderer.state.buffers.stencil.setTest(true);

    // Restore renderer settings
    renderer.setClearColor(lib._oldClearColor, lib._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}
