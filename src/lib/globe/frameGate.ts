/**
 * RC21 — on-demand render for the MAIN view (RENDERING CHARTER Group E; last charter row).
 *
 * WHAT IT MAY SKIP, AND WHAT IT MAY NOT. Only `composer.render()` and the /m PiP blit. The 2026-08-26
 * recon established that `tilesHandle.update()` has to run on EVERY frame regardless — the whole
 * 55-step chain and all three `tiles.update()` calls — because that is where streaming, LOD, the
 * per-cell terrain re-seat and every eased uniform are stepped. So this slice buys **GPU time and
 * power, not CPU**. Anywhere that claim gets repeated, it must be repeated in that form.
 *
 * WHY A HEARTBEAT AND NOT A PREDICATE. The same recon mapped **40+ independent per-frame
 * visual-change sources across 20 files**, ~14 of them asymptotic eases with NO snap — they
 * approach their target forever and never arrive. No predicate over that surface can be both cheap
 * and complete, and the cost of a false negative here is not a stale inset (RC19's failure mode) but
 * a FROZEN GLOBE. So the predicate is not the safety mechanism: `maxStaleMs` is. Every source the
 * epsilons cannot see is stale for at most one heartbeat instead of forever, which turns any miss
 * into a low frame rate rather than a freeze. This is `pipCache.ts`'s shape deliberately reused —
 * see that module for the argument in its original setting.
 *
 * THE SETTLE WINDOW is the one thing this adds over the PiP predicate, and it exists precisely for
 * the no-snap eases. Any change keeps the renderer at FULL rate for a further `restMs`, so an ease
 * kicked off by a camera move, a tier step or a chip flip is drawn every frame while it converges,
 * and the gate can only engage once the scene has been quiet for longer than the ease takes to
 * become invisible. `restMs` is therefore sized off the repo's own settling convention — assert
 * after ≥6.2τ — against the slowest eased uniform, not picked for feel.
 *
 * DEFAULT OFF. `GATE.enabled` is `false`, and with it false this returns `true` unconditionally,
 * which is byte-for-byte today's every-frame loop. Flipping the default is a RISK decision (a false
 * negative is a frozen globe), not a look decision, so it is left as an owner call and wants a full
 * ULTRA-timelapse soak first. `maxStaleMs: 0` is the same rollback by a second route; both are
 * locked by unit tests rather than asserted in a comment.
 *
 * Pure, three-free, DOM-free → unit-tested. The apply site (GlobeCanvas) owns the loop.
 */

import type { PipPose } from "./pipCache";

/** The main-view gate's knobs. Mirrors `PipDeltaCfg` plus the two RC21-only fields. */
export interface FrameGateCfg {
  /** Master seam. `false` ⇒ always render — today's loop, byte for byte. */
  enabled: boolean;
  /** Hard refresh cadence (ms). `0` ⇒ always render (the documented rollback). */
  maxStaleMs: number;
  /** How long the scene must have been unchanged before the gate may engage (ms). */
  restMs: number;
  posEpsM: number;
  basisEps: number;
  projEps: number;
  sunDirEps: number;
}

function unit(v: readonly [number, number, number]): [number, number, number] {
  const L = Math.hypot(v[0], v[1], v[2]);
  return L > 0 ? [v[0] / L, v[1] / L, v[2] / L] : [0, 0, 0];
}

/**
 * Has the camera pose or the sun direction moved past the epsilons? Split out from the gate so the
 * caller can use it to drive the settle clock: "the pose changed" is what resets `stillMs`, and
 * that has to be answerable without also consulting the heartbeat.
 *
 * The sun is compared as a DIRECTION, for the same reason as in `pipCache`: the key light is parked
 * kilometres out and ULTRA swaps `SHADOWS.lightDistM` by nearly an order of magnitude, so a raw
 * position compare would report a view change when the shading is identical.
 */
export function framePoseChanged(prev: PipPose, next: PipPose, cfg: FrameGateCfg): boolean {
  for (let i = 0; i < 16; i++) {
    // 12/13/14 are the translation column (metres); everything else is the dimensionless basis.
    const eps = i >= 12 && i <= 14 ? cfg.posEpsM : cfg.basisEps;
    if (Math.abs(next.view[i] - prev.view[i]) > eps) return true;
  }
  for (let i = 0; i < 16; i++) {
    if (Math.abs(next.proj[i] - prev.proj[i]) > cfg.projEps) return true;
  }
  const a = unit(prev.sun);
  const b = unit(next.sun);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a[i] - b[i]) > cfg.sunDirEps) return true;
  }
  return false;
}

/**
 * Should this frame draw?
 *
 * @param prev     pose at the last DRAWN frame, or `null` before the first one
 * @param next     this frame's pose
 * @param ageMs    ms since the last DRAWN frame — drives the heartbeat
 * @param stillMs  ms since the scene last changed (pose or `dirty`) — drives the settle window
 * @param dirty    an explicit invalidation raised since the last draw, for the visual changes the
 *                 epsilons structurally cannot see (tier applies, the bloom-gate flip, the ULTRA
 *                 chip). Everything NOT wired to this is covered by `maxStaleMs` alone — which is
 *                 the design, not a gap, but it is the reason `maxStaleMs` may not be raised
 *                 casually.
 *
 * Ordered so that every "always render" route short-circuits before any epsilon work.
 */
export function frameNeedsRender(
  prev: PipPose | null,
  next: PipPose,
  ageMs: number,
  stillMs: number,
  dirty: boolean,
  cfg: FrameGateCfg,
): boolean {
  if (!cfg.enabled) return true; // the default, and the seam's off-state
  if (cfg.maxStaleMs <= 0) return true; // the rollback knob
  if (prev === null) return true; // nothing cached yet
  if (dirty) return true; // an explicit invalidation
  if (ageMs >= cfg.maxStaleMs) return true; // the heartbeat — the actual safety net
  if (framePoseChanged(prev, next, cfg)) return true;
  return stillMs >= cfg.restMs ? false : true; // still inside the settle window ⇒ keep drawing
}
