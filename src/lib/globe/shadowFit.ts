/**
 * RC4 — fitting the ONE shadow ortho box to the VIEW (owner bug B4, 2026-08-25).
 *
 * The rig has always been altitude-adaptive: half-extent = `clamp(alt·K, boundsM, maxBoundsM)`,
 * centred on the screen-centre ellipsoid hit. The failure that produced the bug report is that
 * BOTH terms scale with altitude — the box grows with `alt·K` and the hit recedes with `alt/tan
 * (pitch)` at the same rate — so whether your own foreground is inside the box depends only on
 * PITCH, never on how high you are. Solving `alt/tan(pitch) ≤ alt·K` gives pitch ≥ 59° at the
 * base profile (K = 0.6) and ≥ 42° under ULTRA (K = 1.1). Below that the box sits entirely ahead
 * of you: the ground you are standing on renders fully lit, with a hard edge where the box
 * begins (three r185 `shadowmap_pars_fragment` returns lit outside [0,1]), and the lit patch
 * slides and resizes as you move — "shadows missing on part of the map".
 *
 * This module is the pure half of the fix: given the eye's altitude and how far down the look
 * the receivers actually run, it returns the half-extent and how far along the horizontal look
 * the box centre belongs. The caller supplies `viewDistM` (eye→ellipsoid-hit, or the geometric
 * horizon when the look ray misses) and applies `pushM` along the horizontal forward vector from
 * the eye's own ground point.
 *
 * Two properties the caller depends on and `test/lib/globe/shadowFit.test.ts` pins:
 *   · the near edge never falls behind the viewer — `pushM ≤ halfExtentM − boundsM/2`, so the
 *     eye is always inside the box, at every pitch and altitude;
 *   · the extent is monotone in both inputs and QUANTIZED, so `updateProjectionMatrix` (and the
 *     metres-derived ULTRA bias that rides the depth range) stay on the "only when it changed"
 *     path — an extent that moved every frame would both cost that work and make the shadow
 *     texels swim on every look-drag.
 */

export interface ShadowFitProfile {
  /** Minimum (street-level, crisp) half-extent — `SHADOWS.boundsM`. */
  boundsM: number;
  /** Metres of half-extent per metre of camera altitude — `SHADOWS`/`ULTRA.boundsAltK`. */
  boundsAltK: number;
  /** Cap on the half-extent — `SHADOWS`/`ULTRA.maxBoundsM`. */
  maxBoundsM: number;
  /** Weight on the view-distance term; 0 = the pre-RC4 altitude-only extent. */
  viewFitK: number;
  /** Quantum the extent above `boundsM` is rounded up to — `SHADOWS.boundsQuantM`. */
  quantM: number;
}

export interface ShadowFit {
  /** Ortho half-extent (m): quantized, clamped into [boundsM, maxBoundsM]. */
  halfExtentM: number;
  /** Distance along the HORIZONTAL look from the eye's ground point to the box centre (m). */
  pushM: number;
  /** The view distance the fit was derived from (m) — reported by `__globe.ultraLook`. */
  viewDistM: number;
}

/**
 * Geometric horizon distance (m) along the surface chord for an eye `altM` above a sphere of
 * radius `radiusM` — `sqrt(h(2R + h))`. Used when the centre ray misses the ellipsoid entirely:
 * a near-level look has receivers all the way out to the horizon and nowhere further, which is
 * exactly the case that used to disable the whole rig (the `!!focusHit` gate, RC3).
 */
export function horizonDistanceM(altM: number, radiusM: number): number {
  const h = Math.max(altM, 0);
  return Math.sqrt(h * (2 * radiusM + h));
}

export function fitShadowBox(
  altM: number,
  viewDistM: number,
  p: ShadowFitProfile,
): ShadowFit {
  const d = Math.max(viewDistM, 0);
  const margin = p.boundsM * 0.5; // how far behind the viewer the near edge sits
  // Enough to hold the whole [eye, focus] segment, or the altitude ramp, whichever is larger.
  const raw = Math.max(Math.max(altM, 0) * p.boundsAltK, p.viewFitK * d * 0.5 + margin);
  const over = Math.max(0, raw - p.boundsM);
  const quantized = p.boundsM + Math.ceil(over / p.quantM) * p.quantM;
  const halfExtentM = Math.min(Math.max(quantized, p.boundsM), Math.max(p.maxBoundsM, p.boundsM));
  // Uncapped, `halfExtentM − margin ≥ d/2`, so the push is the segment midpoint and the box
  // holds eye AND focus. Capped, the push runs out first and the eye keeps the near edge —
  // the foreground wins, which is the half of the frame the bug report was about. A cascade is
  // the only way to have both, and CSM is a standing rejection (ULTRA_ARCHITECTURE §10).
  const pushM = Math.max(0, Math.min(d * 0.5, halfExtentM - margin));
  return { halfExtentM, pushM, viewDistM: d };
}
