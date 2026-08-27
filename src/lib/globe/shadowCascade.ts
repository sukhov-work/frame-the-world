/**
 * SHADOW CASCADES — the pure half (owner defect 1, 2026-08-27).
 *
 * THE MEASURED DEFECT. One ortho box cannot hold a mountain view. `lib/globe/shadowFit` frames
 * the ONE shipped box on the view, but its half-extent is capped (`ULTRA.maxBoundsM` 18 km), and
 * `__globe.ultraLook()` at the owner's own poses reports how far short that falls:
 *
 *   | pose (ULTRA, browser-measured 2026-08-27) | viewFitM | boundsM | covered |
 *   |---|---|---|---|
 *   | Fuji, 5.2 km, 84° tilt   | 148,757 m |  18,000 m | 24 % |
 *   | Fuji, 15 km, 68° tilt    | 427,828 m |  18,000 m |  8 % |
 *   | mountains, 3.5 km, dusk  | 100,163 m |  18,000 m | 35 % |
 *
 * Everything past the box renders fully lit (three r185 `shadowmap_pars_fragment` returns 1.0
 * outside `[0,1]`), with a straight cut where the box ends — the "cropped, sliced, hollow" edges
 * and the "gap" in Mount Fuji's own shadow. The charter anticipated exactly this: RC4 shipped the
 * view fit and left "full visible-frustum fit … in reserve — build only if shots after RC4 still
 * show hard shadow edges inside the frame". They do.
 *
 * WHY THIS IS NOT `three/examples/jsm/csm`. That rejection (`ULTRA_ARCHITECTURE` §10) stands on
 * its own facts and none of them have changed: `CSM.setupMaterial()` ASSIGNS `onBeforeCompile`,
 * which would clobber the buildings' 15-uniform fill injection and the ground's explicitly-chained
 * one, and it reaches none of the ~19 raw `ShaderMaterial`s. What this module does instead is take
 * the one behaviour of that library we actually need — several ortho boxes at several scales — and
 * get it from three's OWN shadow pipeline, with no material surgery at all:
 *
 *   · each extra cascade is a plain `DirectionalLight` at `intensity = 0`, so it contributes no
 *     light to any lit material and only ever writes a depth map;
 *   · the ground receives through `ShadowMaterial` twins, and `getShadowMask()`
 *     (`shadowmask_pars_fragment.glsl.js`) MULTIPLIES every directional shadow mask with no
 *     cascade dispatch. §10 lists that as a reason CSM could not work here; for nested boxes it is
 *     precisely the mechanism — a fragment outside a cascade's box gets 1.0 from it, so the
 *     product is the UNION of the cascades and a coarse cascade can only ever add shadow that a
 *     finer one agrees with.
 *
 * That union semantics is what makes the arrangement safe. Every cascade is centred so that its
 * box CONTAINS the eye, so the boxes are strictly nested and no gap between them is possible; the
 * coarse ones are biased generously (bias and normal offset both scale with their own texel size),
 * which errs toward LIT — and erring toward lit is invisible wherever a finer cascade covers the
 * same ground.
 *
 * Cascade 0 is not modelled here. It is the existing `sunLight` rig, byte-for-byte, including its
 * view fit, its light distance and its metres-derived bias — the cascades added by this module sit
 * strictly OUTSIDE it. Nothing about the street-level look changes.
 *
 * Pure, three-free, DOM-free. `test/lib/globe/shadowCascade.test.ts` pins the nesting, the
 * quantisation and the "no caster behind the light" invariant.
 */

export interface CascadeProfile {
  /** Furthest view distance (m) this cascade is sized to cover. */
  readonly reachM: number;
  /** Hard cap on the half-extent (m). */
  readonly maxBoundsM: number;
  /** Shadow-map edge (px). Latched at renderer construction — three ignores a later write. */
  readonly mapPx: number;
  /** PCF disk radius (texels). */
  readonly radius: number;
  /** Quantum (m) the half-extent is rounded UP to, so the box only ever moves in steps. */
  readonly quantM: number;
  /** Depth bias, in TEXELS of this cascade's own map (see `biasM` below). */
  readonly biasTexels: number;
  /** World normal offset, in TEXELS of this cascade's own map. */
  readonly normalBiasTexels: number;
}

export interface CascadeFit {
  /** Ortho half-extent (m) — quantized, clamped, and never smaller than the previous cascade. */
  halfExtentM: number;
  /** How far (m) the light stands off the box centre along the key direction. */
  lightDistM: number;
  /** Shadow-camera near/far (m). */
  nearM: number;
  farM: number;
  /** `light.shadow.bias` — three's unit is a FRACTION of near→far, so it is derived, never authored. */
  bias: number;
  /** `light.shadow.normalBias` (world metres). */
  normalBiasM: number;
  /** Depth bias expressed back in metres — what the DEV probe reports, so the number is readable. */
  biasM: number;
  /** The price paid, published rather than assumed. */
  metresPerTexel: number;
}

/** Round `v` UP to a multiple of `q` (q ≤ 0 → no quantisation). */
function quantizeUp(v: number, q: number): number {
  return q > 0 ? Math.ceil(v / q) * q : v;
}

/**
 * Fit one cascade around an eye that sits at the box centre.
 *
 * `minHalfM` is the previous cascade's half-extent: this one must strictly contain it, or the two
 * would cover the same ground at a coarser resolution for nothing. `reliefM` is how far terrain
 * may reach above or below the box centre (Everest is 8.85 km, so 9 km covers the planet).
 *
 * THE INVARIANT THE LIGHT DISTANCE EXISTS FOR: `lightDist = half + relief + clear`, which puts the
 * shadow camera's near plane exactly `clear` metres in front of the FURTHEST-FORWARD caster the
 * box can hold. Without it a grazing sun on a 250 km box would sit BELOW distant terrain — that
 * terrain would fall behind the near plane and vanish from the depth pass, which is the silent
 * failure `ULTRA.lightDistM` 60 km was raised to avoid at 18 km and which comes straight back at
 * cascade scale. An ortho shadow camera pays nothing for distance except depth precision, and D24
 * over the widest range here still resolves ~3 cm.
 */
export function fitCascade(
  viewDistM: number,
  minHalfM: number,
  reliefM: number,
  clearM: number,
  p: CascadeProfile,
): CascadeFit {
  const floor = Math.max(minHalfM, 1);
  const want = Math.min(Math.max(viewDistM, floor), p.reachM);
  const halfExtentM = Math.max(floor, Math.min(quantizeUp(want, p.quantM), p.maxBoundsM));
  const relief = Math.max(reliefM, 0);
  const clear = Math.max(clearM, 1);
  const lightDistM = halfExtentM + relief + clear;
  const nearM = clear;
  const farM = lightDistM + halfExtentM + relief;
  const metresPerTexel = (2 * halfExtentM) / Math.max(1, p.mapPx);
  const biasM = p.biasTexels * metresPerTexel;
  return {
    halfExtentM,
    lightDistM,
    nearM,
    farM,
    // three adds this to `shadowCoord.z` AFTER the divide and an ortho shadow matrix maps to [0,1]
    // LINEARLY in view depth (`LightShadow.js:227-232`), so the unit is a fraction of near→far and
    // it silently rescales whenever the range moves. Authored in texels, derived here — the same
    // discipline `ULTRA.shadowBiasM` established for cascade 0.
    bias: -biasM / Math.max(1, farM - nearM),
    normalBiasM: p.normalBiasTexels * metresPerTexel,
    biasM,
    metresPerTexel,
  };
}

/**
 * Fit the whole ladder outside cascade 0.
 *
 * `half0M` is cascade 0's live half-extent, so the ladder re-nests itself as the shipped rig
 * breathes with altitude. A cascade whose fit lands at or under the one before it is DROPPED
 * (`null`), which is what makes a street-level view — where cascade 0 already covers everything —
 * cost no extra depth pass at all.
 */
export function fitCascades(
  viewDistM: number,
  half0M: number,
  reliefM: number,
  clearM: number,
  profiles: readonly CascadeProfile[],
): Array<CascadeFit | null> {
  const out: Array<CascadeFit | null> = [];
  let prev = half0M;
  for (const p of profiles) {
    // The drop test reads the COVERAGE THIS CASCADE IS NEEDED FOR, not the extent it would be
    // quantized up to. Testing the extent instead keeps a redundant cascade alive whenever the
    // quantum happens to round it past the previous box — a wasted depth pass over the whole
    // visible tile set, at street level, where the near rig already covers everything.
    const needM = Math.min(viewDistM, p.reachM);
    if (needM <= prev * 1.05) {
      out.push(null);
      continue;
    }
    const fit = fitCascade(viewDistM, prev, reliefM, clearM, p);
    out.push(fit);
    prev = fit.halfExtentM;
  }
  return out;
}

/**
 * Should a cascade re-render this frame?
 *
 * Cascade maps are big and mostly static, so they run with `shadow.autoUpdate = false` and are
 * refreshed on demand (`WebGLShadowMap.js:170` skips a shadow whose `autoUpdate` is false and
 * whose `needsUpdate` is false — before `updateMatrices`, so a skipped cascade keeps a shadow
 * matrix that still matches the map it rendered). Four triggers, and the last is a safety net in
 * the shape RC21's frame gate already uses: a missed trigger can only ever cost staleness bounded
 * by `maxStaleMs`, never a permanently frozen shadow.
 */
export function cascadeNeedsRender(args: {
  /** Fitted half-extent now vs the one the live map was rendered with. */
  halfExtentM: number;
  appliedHalfExtentM: number;
  /** How far (m) the eye has moved from the centre the live map was rendered around. */
  centreDriftM: number;
  /** How far (rad) the key direction has swung since the live map was rendered. */
  keySwingRad: number;
  /** Terrain streaming epoch — new tiles are new casters. */
  epoch: number;
  appliedEpoch: number;
  ageMs: number;
  moveFrac: number;
  swingRad: number;
  maxStaleMs: number;
}): boolean {
  if (args.appliedHalfExtentM <= 0) return true; // never rendered
  if (args.halfExtentM !== args.appliedHalfExtentM) return true;
  if (args.epoch !== args.appliedEpoch) return true;
  if (args.centreDriftM > args.halfExtentM * args.moveFrac) return true;
  if (args.keySwingRad > args.swingRad) return true;
  return args.ageMs >= args.maxStaleMs;
}
