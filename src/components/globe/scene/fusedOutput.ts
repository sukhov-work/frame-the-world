import * as THREE from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { OutputShader } from "three/addons/shaders/OutputShader.js";
import type { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * T80-h — `OutputPass` that ADDS THE BLOOM inside the one full-screen draw the chain already pays
 * for.  (`scene/fusedOutput.ts`; the other half is `ScaledBloomPass.deferBlend`.)
 *
 * WHAT IT REPLACES. Stock `UnrealBloomPass` ends with a full-resolution additive draw of its
 * mip-0 composite into the read buffer (`UnrealBloomPass.js:353-368`), and `OutputPass` then reads
 * that buffer to tone-map and encode to screen. T80-g moved the blend off the MSAA buffer (one
 * full-resolution copy + one single-sample blend); this pass removes both: the bloom composite
 * is sampled by the output shader itself and added to the scene sample BEFORE the tone map, so
 * the chain's post-geometry work is the twelve half-and-smaller chain draws and this one screen
 * draw. No single-sample buffer is bound, so the composer's `resolvedTarget` is never allocated.
 *
 * THE SHADER IS THE LIBRARY'S, WITH ONE LINE CHANGED. `FUSED_OUTPUT_FRAGMENT` is
 * `OutputShader.fragmentShader` with `uniform sampler2D tBloom;` declared and the first statement
 * `gl_FragColor = texture2D( tDiffuse, vUv );` replaced by the sum of the two samples. Everything
 * after — the tone-map dispatch on the renderer's `toneMapping` define, `sRGBTransferOETF` — is
 * untouched and still owned by the base class's `render()`, which rebuilds the defines on the
 * ACTIVE material whenever the renderer's colour space or tone mapping changes. Both `.replace()`
 * anchors are asserted at module load: a three bump that renames either throws at boot rather
 * than shipping a pass that silently forgot the bloom.
 *
 * THE ARITHMETIC IS THE STOCK BLEND'S. The library's blend material is `CopyShader` at opacity 1
 * with `premultipliedAlpha: true, blending: AdditiveBlending` — three sets
 * `gl.blendFuncSeparate(ONE, ONE, ONE, ONE)` for that pair, i.e. `dst.rgba += src.rgba`, where
 * `src` is the bilinear sample of the mip-0 composite at the full-screen triangle's `vUv`. This
 * pass samples the same texture, at the same `vUv` of the same `FullScreenQuad` geometry, and adds
 * all four channels; the only difference is that the sum is not rounded to half float on its way
 * to the tone map. The residual is therefore ≤ 1 code at 8-bit output on the few pixels where
 * that rounding flipped a quantum — `scripts/probe-bloom-path.mjs --paths` measures it against
 * a frozen frame (T94), so the noise floor of that comparison is zero.
 *
 * THE OFF-STATE IS THE STOCK PASS. Two materials live here: the base class's own (`_plain`,
 * built from `OutputShader` verbatim) and the fused one. `setBloomTexture(null)` makes `_plain`
 * the active material, so with bloom off (tier `low`, every lean phone, `bloomOff` in the perf
 * harness) the screen draw is byte-for-byte the library's — no extra texture fetch, no `× 0`
 * arithmetic on a stale composite. Switching materials nulls the base's define cache so the next
 * `render()` rebuilds the tone-map defines on whichever material is now active; a switch is a
 * tier event, not a frame event, so the recompile is paid once.
 *
 * WHO WRITES IT. Only `GlobeCanvas`'s `setBloomEnabled` — the one writer of `bloomPass.enabled`,
 * `resolvePass.enabled`, `bloomPass.deferBlend` and this pass's bloom input, so the four can never
 * disagree about which chain is running (`resolvedComposer.ts` C2', machine-checked).
 */

const TBLOOM_DECL_ANCHOR = "uniform sampler2D tDiffuse;";
const TBLOOM_SAMPLE_ANCHOR = "gl_FragColor = texture2D( tDiffuse, vUv );";

function fusedFragment(): string {
  const src = OutputShader.fragmentShader;
  if (!src.includes(TBLOOM_DECL_ANCHOR) || !src.includes(TBLOOM_SAMPLE_ANCHOR)) {
    throw new Error(
      "FusedOutputPass: three's OutputShader no longer carries the two anchors the fused bloom add " +
        "is spliced at — re-derive scene/fusedOutput.ts against the installed three before booting.",
    );
  }
  return src
    .replace(TBLOOM_DECL_ANCHOR, `${TBLOOM_DECL_ANCHOR}\n\t\tuniform sampler2D tBloom;`)
    .replace(TBLOOM_SAMPLE_ANCHOR, "gl_FragColor = texture2D( tDiffuse, vUv ) + texture2D( tBloom, vUv );");
}

/** The fused fragment source — exported so the contract test can diff it against the library's. */
export const FUSED_OUTPUT_FRAGMENT = fusedFragment();

/** The base class's fields the material switch has to touch and `@types/three` does not declare. */
type OutputInternals = {
  _fsQuad: FullScreenQuad;
  _outputColorSpace: unknown;
  _toneMapping: unknown;
};

export class FusedOutputPass extends OutputPass {
  /** The library's own material — the off-state, byte-for-byte `OutputShader`. */
  private readonly _plain: THREE.RawShaderMaterial;
  /** `OutputShader` + `tBloom`, compiled on first use. */
  private readonly _fused: THREE.RawShaderMaterial;
  private _bloom: THREE.Texture | null = null;

  constructor() {
    super();
    this._plain = this.material;
    this._fused = new THREE.RawShaderMaterial({
      name: "FusedOutputShader",
      uniforms: {
        ...THREE.UniformsUtils.clone(OutputShader.uniforms),
        tBloom: { value: null },
      },
      vertexShader: OutputShader.vertexShader,
      fragmentShader: FUSED_OUTPUT_FRAGMENT,
    });
  }

  /** The bloom composite currently added on screen — `null` means the stock output draw. */
  get bloomTexture(): THREE.Texture | null {
    return this._bloom;
  }

  /**
   * Add `tex` (the bloom pass's mip-0 composite, `ScaledBloomPass.bloomTexture`) on screen, or
   * `null` to draw the stock output. Idempotent; a material switch only happens when the on/off
   * state actually changes.
   */
  setBloomTexture(tex: THREE.Texture | null): void {
    if (tex === this._bloom) return;
    this._bloom = tex;
    const want = tex ? this._fused : this._plain;
    if (want !== this.material) {
      const self = this as unknown as OutputInternals;
      this.material = want;
      this.uniforms = want.uniforms; // the base `render()` writes tDiffuse/toneMappingExposure here
      self._fsQuad.material = want;
      // Force the base to rebuild the tone-map / colour-space defines ON THE NEW MATERIAL.
      self._outputColorSpace = null;
      self._toneMapping = null;
    }
    if (tex) this._fused.uniforms.tBloom.value = tex;
  }

  dispose(): void {
    // The base disposes the ACTIVE material and the quad; the other material is ours to free.
    super.dispose();
    (this.material === this._plain ? this._fused : this._plain).dispose();
  }
}
