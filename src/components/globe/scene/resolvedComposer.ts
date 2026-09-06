import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

/**
 * T80 direction g — GIVE BLOOM A NON-MSAA SOURCE.  (`scene/resolvedComposer.ts`)
 * T80-h — then TAKE THE BLEND INTO THE OUTPUT DRAW (`scene/fusedOutput.ts`, `BLOOM.path`).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT — what a caller owes this module. Every line is machine-checked by
 * `test/components/globe/resolvedComposer.test.ts` (+ `fusedBloom.test.ts` for C2'/C7); the
 * live caller is `GlobeCanvas.tsx`.
 *
 *  C1  PASS ORDER. `resolvePass` goes AFTER the pass that renders the scene and BEFORE the bloom:
 *
 *          RenderPass → [GTAOPass] → MsaaResolvePass → ScaledBloomPass → FusedOutputPass
 *
 *      Anything inserted ahead of the resolve must be a full-screen pass that SWAPS (GTAO is the
 *      only live one). It then writes the single-sample buffer itself and the resolve stands down
 *      — see C5. Anything inserted AFTER the resolve reads and writes single-sample buffers.
 *
 *  C2  LOCKSTEP. `resolvePass.enabled` must follow `bloomPass.enabled`. With bloom off the copy
 *      buys nothing (nothing blends afterwards) and the chain must degenerate to exactly the
 *      pre-T80g one — the profile every phone and tier `low` runs. `GlobeCanvas` keeps ONE writer
 *      of `bloomPass.enabled` (`setBloomEnabled`) so the two cannot drift.
 *
 *  C2' THE PATH (T80-h). The same writer sets FOUR things from `bloomPass.enabled` and the live
 *      path (`__quality.bloomPath()` ?? `BLOOM.path`), and nothing else touches any of them:
 *
 *          path       resolvePass.enabled   bloomPass.deferBlend   outputPass bloom input
 *          "msaa"     false                 false                  null   (stock output draw)
 *          "resolved" bloom on              false                  null
 *          "fused"    false                 bloom on               bloom on ? bloomTexture : null
 *
 *      Bloom OFF is the same row on every path: false / false / null — the pre-T80g off-state.
 *
 *  C7  FUSED = NO FULL-RESOLUTION WORK AFTER GEOMETRY. On the "fused" path the frame binds the
 *      MSAA scene target (RenderPass), the bloom's own half-and-smaller targets, and the screen —
 *      never `resolvedTarget`. The output draw samples `sceneTarget.texture` (three's one resolve,
 *      done in the RenderPass epilogue) and the bloom's mip-0 composite, adds them, tone-maps.
 *
 *  C3  SIZE. `composer.setSize(logicalW, logicalH)` after a resize, a DPR-changing tier apply and
 *      a context restore — it resizes BOTH buffers and each keeps its own `samples`. Never resize
 *      `sceneTarget` / `resolvedTarget` directly.
 *
 *  C4  TEARDOWN. `composer.dispose()` frees the two buffers (they ARE `renderTarget1/2`) and the
 *      composer's internal copy pass — never the passes. `resolvePass.dispose()` is the caller's.
 *
 *  C5  IDEMPOTENCE + DEGENERACY, both free: the resolve draws nothing and does not swap when the
 *      read buffer is already single-sample. That covers an earlier swapping pass (GTAO) AND a
 *      hypothetical `samples: 0` scene target, with no flag to keep in sync.
 *
 *  C6  THE PICTURE IS UNCHANGED. The bloom composite is a per-PIXEL quantity, identical across a
 *      pixel's four samples, so `resolve(sample_i + bloom) == resolve(sample_i) + bloom`. Only the
 *      ORDER of the resolve and the add moves; no tone map and no colour-space encode happens
 *      anywhere in here (both live in `OutputPass`, which still reads the last buffer in the
 *      chain). The residual is half-float rounding — `scripts/probe-bloom-path.mjs` measures it
 *      against its own noise floor (zero under a T94 frozen frame). The fused path removes one
 *      MORE rounding (the blend's half-float store) and is otherwise the same arithmetic — see
 *      `scene/fusedOutput.ts`.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * THE COST THIS EXISTS TO REMOVE (measured, `rendering/MEASUREMENTS_2026-09-05.md` §14.4: bloom is
 * 13.1 ms of the 25.2 ms FPV frame at `high`, DPR 2, 3200×1900, and halving the whole mip chain
 * recovered only 1.6 of it). The stock chain is
 *
 *     RenderPass (needsSwap false) → UnrealBloomPass (needsSwap false) → OutputPass (to screen)
 *
 * over a pair of 4× MSAA HalfFloat buffers, of which only that frame's READ buffer is touched:
 *
 *  1. `RenderPass` renders the scene into the READ buffer (`RenderPass.js:95,156`). Both
 *     `FullScreenQuad` and `RenderPass` go through `renderer.render()`, whose epilogue resolves a
 *     bound multisample target (`three/src/renderers/WebGLRenderer.js:1763-1769` →
 *     `WebGLTextures.updateMultisampleRenderTarget`), so the scene lands in `readBuffer.texture`
 *     — RESOLVE #1, the one that pays for MSAA.
 *  2. The bloom's high pass samples that resolved texture and runs its 12 half-and-smaller draws.
 *  3. The final blend (`UnrealBloomPass.js:351-368`) draws a FULL-RESOLUTION additive quad back
 *     into `readBuffer` — a read-modify-write of all FOUR samples of every pixel — and that
 *     `renderer.render()` call resolves the whole target again: RESOLVE #2.
 *  4. `OutputPass` samples the second resolve and tone-maps to screen.
 *
 * Steps 3 and 4 are what the mip scale could not touch. At 3200×1900 RGBA16F one full-resolution
 * surface is ~49 MB, so the blend moves ~194 MB in and ~194 MB out and the second resolve reads
 * another ~194 MB. Adding the bloom AFTER the resolve is the same picture (C6) for a quarter of
 * the bandwidth: one ~49 MB copy in and out, then a single-sample blend.
 *
 * THE SHAPE HERE. The composer keeps its two buffers but they stop being interchangeable:
 *
 *   | buffer          | samples | depth | written by                        | read by             |
 *   |-----------------|---------|-------|-----------------------------------|---------------------|
 *   | `renderTarget2` | 4 (MSAA)| yes   | `RenderPass` (the scene)          | the resolve only    |
 *   | `renderTarget1` | 0       | NO    | `MsaaResolvePass`, then the bloom | bloom, `OutputPass` |
 *
 * TWO BUFFER FLAGS, BOTH FREE, BOTH PART OF THE SAME LEVER:
 *
 *  - `resolvedTarget.depthBuffer = false`. Every pass that writes it — the resolve, the bloom's
 *    blend (`UnrealBloomPass.js:192-193`), GTAO's copy/blend materials (`GTAOPass.js:195-196,
 *    210-211`) — is `depthTest: false, depthWrite: false`. A full-resolution depth renderbuffer
 *    that nothing can read is pure VRAM.
 *  - `sceneTarget.resolveDepthBuffer = false`. Nothing samples the scene target's depth: it has no
 *    `depthTexture`, and `GTAOPass` is constructed WITHOUT a g-buffer so it renders its own depth
 *    into its own target (`GTAOPass.js:304-321`). three then drops `DEPTH_BUFFER_BIT` from the
 *    resolve blit and INVALIDATES the depth attachments afterwards (`three.module.js:13328`,
 *    `13355-13363`) — on a tiler that is a depth store per frame that never happens.
 *
 * T77 GAP 4, CORRECTED. The audit expected `renderTarget1` to be allocated and never rendered
 * into, because both passes ahead of `OutputPass` declare `needsSwap === false`. It is not:
 * `OutputPass` inherits the base `needsSwap === true` and swaps on its way to the screen, so the
 * stock chain swaps once per frame and the two buffers ALTERNATE — `renderTarget1` is the scene
 * target on every other frame. Both are therefore fully allocated, both at 4× MSAA HalfFloat
 * (~243 MB each at 3200×1900 DPR 2: the multisample store plus its resolve texture). Pinning the
 * roles and making `renderTarget1` single-sample takes it to ~49 MB — a ~195 MB VRAM saving, so
 * this is a jetsam lever for T83 as well as a bandwidth one. And with bloom OFF (every phone,
 * tier `low`) the resolve is off with it, nothing ever binds `resolvedTarget`, and three allocates
 * a render target lazily on its first bind — so there it costs nothing at all.
 *
 * TWO INVARIANTS MAKE IT SAFE.
 *
 * (a) **The roles are PINNED per frame** (`PinnedComposer`). Stock `EffectComposer` carries its
 *     read/write pointers ACROSS frames, so a chain with an odd number of swaps alternates the
 *     pair every frame. That is harmless when both buffers are identical and fatal here — on
 *     every other frame the scene would render into the single-sample buffer and the picture
 *     would silently lose its antialiasing.
 *
 * (b) **The resolve is idempotent** (`MsaaResolvePass`, C5).
 */

/**
 * One full-screen copy whose only job is to move an MSAA buffer's RESOLVED texture into a
 * single-sample buffer, so that everything downstream blends at one sample per pixel.
 *
 * It is a `ShaderPass(CopyShader)` — `gl_FragColor = opacity * texel` at `opacity` 1, a bit-exact
 * HalfFloat passthrough (no tone mapping and no colour-space encode: rendering into a target uses
 * the working colour space, and `CopyShader` includes neither chunk). `needsSwap` is decided per
 * frame INSIDE `render`, which is legal because `EffectComposer` reads the flag after the call
 * (`EffectComposer.js:237-239`).
 */
export class MsaaResolvePass extends ShaderPass {
  constructor() {
    super(CopyShader);
    // A full-screen overwrite: no blend, no depth interaction, no dependence on whatever the
    // target's depth buffer held from the previous frame — and the resolved target has none.
    this.material.blending = THREE.NoBlending;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.toneMapped = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime?: number,
    maskActive?: boolean,
  ): void {
    // Idempotence (invariant b / C5). A single-sample read buffer means some earlier full-screen
    // pass already did the resolve — copying it again would cost a full-resolution draw and change
    // which buffer the chain ends on. Draw nothing, and DO NOT swap.
    if (readBuffer.samples === 0) {
      this.needsSwap = false;
      return;
    }
    this.needsSwap = true;
    super.render(renderer, writeBuffer, readBuffer, deltaTime as number, maskActive as boolean);
  }
}

/**
 * `EffectComposer` with the buffer roles pinned at the top of every frame (invariant a).
 *
 * `renderTarget2` is always the MSAA scene target the first pass writes; `renderTarget1` is always
 * the single-sample resolve. Two assignments per frame buy determinism that the stock class does
 * not offer once any pass in the chain swaps.
 */
export class PinnedComposer extends EffectComposer {
  render(deltaTime?: number): void {
    this.readBuffer = this.renderTarget2;
    this.writeBuffer = this.renderTarget1;
    super.render(deltaTime as number);
  }
}

export type ResolvedComposer = {
  composer: PinnedComposer;
  resolvePass: MsaaResolvePass;
  /** The MSAA HalfFloat buffer the scene is rendered into (`composer.renderTarget2`). */
  sceneTarget: THREE.WebGLRenderTarget;
  /** The single-sample HalfFloat buffer bloom and OutputPass work on (`composer.renderTarget1`). */
  resolvedTarget: THREE.WebGLRenderTarget;
};

/**
 * Build the composer and its two buffers (the contract at the top of this file is the caller's
 * half of the deal).
 *
 * `EffectComposer` takes ONE target and clones it (`EffectComposer.js:79-81`), so the asymmetric
 * pair is assembled by handing it the single-sample buffer — which becomes
 * `renderTarget1`/`writeBuffer` — and then replacing the clone with the multisampled one. The
 * clone is disposed before it is ever bound, so it never costs a byte of VRAM.
 *
 * @param width   drawing-buffer width in px (the composer re-derives it on the first `setSize`)
 * @param height  drawing-buffer height in px
 * @param samples MSAA samples on the SCENE target (`BLOOM.msaaSamples`)
 */
export function createResolvedComposer(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  samples: number,
): ResolvedComposer {
  const resolvedTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false, // nothing downstream depth-tests — see the buffer-flags note above
  });
  resolvedTarget.texture.name = "PluxComposer.resolved";
  const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples,
    resolveDepthBuffer: false, // the scene's depth is never sampled — skip its resolve blit
  });
  sceneTarget.texture.name = "PluxComposer.sceneMsaa";

  const composer = new PinnedComposer(renderer, resolvedTarget);
  // The constructor's clone of the single-sample target is not wanted: rt2 is the scene buffer.
  composer.renderTarget2.dispose();
  composer.renderTarget2 = sceneTarget;
  composer.readBuffer = sceneTarget;

  return { composer, resolvePass: new MsaaResolvePass(), sceneTarget, resolvedTarget };
}
