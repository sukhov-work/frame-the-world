import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * T80 — `UnrealBloomPass` with a per-tier RESOLUTION SCALE on its mip chain.
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
 * WHAT IT BUYS. The pass draws 13 fullscreen quads and clears 12 targets. Exactly one of those
 * draws — the final additive blend — writes into the full-resolution MSAA read buffer; the other
 * twelve run on the chain this scale governs. At 0.5 the whole chain costs about a quarter of the
 * fill, and because the blur radii are expressed in TEXELS of each mip the glow keeps its shape
 * and reach: only its finest detail softens.
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
 */
export class ScaledBloomPass extends UnrealBloomPass {
  /** The live scale. 1 means "be the stock pass" — see the identity law above. */
  private _s = 1;
  /** The last size the composer asked for, in the units it asked in (never the scaled ones), so
   *  a later `setScale` can re-drive `setSize` from the truth rather than from a scaled copy. */
  private _w: number | null = null;
  private _h: number | null = null;

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
}
