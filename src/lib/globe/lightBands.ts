/**
 * ULTRA light transport — the twilight-band light model (T45 §2, owner 2026-08-22i).
 *
 * WHY THIS EXISTS. The scene's entire day/night response hung off ONE line —
 * `dayK = smoothstep(EARTH.termBand[0], EARTH.termBand[1], sunUpDot)` (scene/imageryGround.ts) —
 * a smoothstep over a DOT PRODUCT with no physical meaning at its band edges, spanning ~9.2° of
 * solar elevation. That is the owner's "naive and linear": the whole day→night transition is one
 * blend across ~37 minutes at mid latitudes, and every other light term (ambient fill, haze,
 * exposure, the hemisphere fill) either rides it or ignores the sun entirely.
 *
 * Under ULTRA that ramp is replaced by BAND-ANCHORED curves evaluated at the same per-fragment
 * sin(solar elevation), whose knots are the thresholds this app's ephemeris layer ALREADY uses
 * for the planner and the scrubber's light bands (`lib/ephemeris/twilight.ts` — golden +6/−4,
 * civil −6, nautical −12, astronomical −18). One vocabulary for "what light is it" across the
 * planner, the scrubber and the renderer, and a transition with STRUCTURE instead of one blend.
 *
 * Pure, three-free, DOM-free → unit-tested. The GLSL twin is EMITTED from the same tables by
 * `bandCurveGlsl`, so shader and JS cannot drift — `test/lib/globe/lightBands.test.ts` parses the
 * emitted GLSL and asserts it evaluates identically to `bandCurve` across the whole domain.
 *
 * INTERPOLATION SPACE. Anchors are authored in DEGREES (the physical vocabulary, so the table
 * reads against the almanac) and evaluated in SIN(elevation) — which is exactly what both the
 * shader (`dot(up, sunDir)`) and the orchestrator (`sunDirW.dot(_focusUp)`) already hold, and
 * what avoids an `asin` per fragment. Anchor VALUES are therefore hit exactly at their anchor
 * elevations; only the shape BETWEEN two knots differs from a degree-space interpolation, and
 * over a 6° band that difference is under 0.01 of a dayK unit.
 *
 * OFF-STATE. Nothing here runs unless the ULTRA chip is on: the shader mixes the legacy ramp
 * toward these curves by a uniform seeded 0, and `mix(a, b, 0.0)` is exactly `a`.
 */

/** One point of a response curve: the value at a given SUN ELEVATION (deg, airless/geometric — the
 *  same convention as `lib/ephemeris/twilight.ts`, which is airless by contract). */
export interface LightAnchor {
  readonly elevDeg: number;
  readonly v: number;
}

const DEG = Math.PI / 180;

/** sin() of an anchor elevation — the evaluation-space coordinate. */
function sinDeg(deg: number): number {
  return Math.sin(deg * DEG);
}

/** GLSL's `smoothstep(e0, e1, x)`, exactly (clamped Hermite). Kept private so the JS fold and the
 *  emitted GLSL fold are provably the same expression. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluate an anchor table at `sinElev`.
 *
 * The table is authored HIGH→LOW elevation (day first, night last) and evaluated as a FOLD from
 * the lowest anchor upward:
 *
 *     v = v_lowest;  for each segment (lo → hi):  v = mix(v, v_hi, smoothstep(sLo, sHi, s))
 *
 * That fold is exact — below the lowest anchor every smoothstep is 0 and `v` stays at the night
 * value; inside a segment every LOWER segment has already saturated to its own upper anchor and
 * every HIGHER one is still 0, so exactly one blend is live; above the highest anchor everything
 * has saturated. It is written as a fold rather than a search precisely so the GLSL twin can be
 * straight-line branchless code with the identical arithmetic.
 *
 * Monotone whenever the table is monotone (each step is a convex blend of the running value and
 * the next anchor), so a curve can never overshoot its own endpoints — the property that keeps
 * `dayK` inside [0,1] without a clamp.
 */
export function bandCurve(anchors: readonly LightAnchor[], sinElev: number): number {
  if (anchors.length === 0) return 0;
  const s = Math.min(1, Math.max(-1, sinElev));
  let v = anchors[anchors.length - 1].v;
  for (let i = anchors.length - 1; i > 0; i--) {
    const lo = anchors[i];
    const hi = anchors[i - 1];
    const t = smoothstep(sinDeg(lo.elevDeg), sinDeg(hi.elevDeg), s);
    v = v + (hi.v - v) * t;
  }
  return v;
}

/**
 * Emit the GLSL twin of `bandCurve` for one table, as a named `float fn(float s)`.
 *
 * The emitted body is the SAME fold in the same order with the same constants (`sin(elevDeg)`
 * baked at emit time), so the two implementations agree to float precision by construction
 * rather than by review. Every literal goes through `glf`-style formatting inline — a GLSL ES
 * `float` may not be initialised from an int literal.
 */
export function bandCurveGlsl(fnName: string, anchors: readonly LightAnchor[]): string {
  const f = (n: number): string => {
    // Enough digits to round-trip a float64 through the shader source, and always a decimal
    // point / exponent so GLSL ES accepts it as a float literal.
    const s = n.toPrecision(9);
    return /[.e]/i.test(s) ? s : `${s}.0`;
  };
  if (anchors.length === 0) return `float ${fnName}(float s) { return 0.0; }`;
  const lines: string[] = [`  float v = ${f(anchors[anchors.length - 1].v)};`];
  for (let i = anchors.length - 1; i > 0; i--) {
    const lo = anchors[i];
    const hi = anchors[i - 1];
    lines.push(
      `  v = mix(v, ${f(hi.v)}, smoothstep(${f(sinDeg(lo.elevDeg))}, ${f(sinDeg(hi.elevDeg))}, s));`,
    );
  }
  lines.push("  return v;");
  return `float ${fnName}(float s) {\n${lines.join("\n")}\n}`;
}

/**
 * Blend weights over a descending list of ELEVATION stops — the palette ramp behind the haze /
 * ambient tint (S4/S10). Exactly two adjacent weights are non-zero and they always sum to 1, so a
 * consumer can lerp N palette colours without normalising and without a colour ever "leaking" in
 * from a band three stops away. Same smoothstep + sin-space convention as `bandCurve`.
 */
export function rampWeights(stopsDeg: readonly number[], sinElev: number): number[] {
  const n = stopsDeg.length;
  const w = new Array<number>(n).fill(0);
  if (n === 0) return w;
  const s = Math.min(1, Math.max(-1, sinElev));
  if (n === 1 || s >= sinDeg(stopsDeg[0])) {
    w[0] = 1;
    return w;
  }
  for (let i = 1; i < n; i++) {
    if (s >= sinDeg(stopsDeg[i])) {
      const t = smoothstep(sinDeg(stopsDeg[i]), sinDeg(stopsDeg[i - 1]), s);
      w[i - 1] = t;
      w[i] = 1 - t;
      return w;
    }
  }
  w[n - 1] = 1;
  return w;
}

/** The four response curves + the tint ramp that make up one ULTRA light state. Injected from
 *  `tuning.ULTRA` — this module owns the MATH, tuning owns the NUMBERS (the repo convention). */
export interface UltraLightCfg {
  /** Ground/building day factor — replaces the `EARTH.termBand` smoothstep. */
  readonly dayCurve: readonly LightAnchor[];
  /** `renderer.toneMappingExposure` multiplier — the camera opening up as the sun goes down. */
  readonly exposureCurve: readonly LightAnchor[];
  /** HemisphereLight intensity multiplier. */
  readonly hemiCurve: readonly LightAnchor[];
  /** Aerial-perspective strength. */
  readonly hazeCurve: readonly LightAnchor[];
  /** Palette-ramp stops (deg): day / golden / blue / night anchors for haze + ambient tint. */
  readonly tintStopsDeg: readonly number[];
}

/** One evaluated light state. All scalars, all consumer-agnostic — the caller maps `tint` onto
 *  whatever palette colours it owns (three.Color lerping stays out of this three-free module). */
export interface UltraLightSample {
  dayK: number;
  exposureK: number;
  hemiK: number;
  hazeK: number;
  /** One weight per `tintStopsDeg` entry; sums to 1, at most two non-zero. */
  tint: number[];
}

/** Evaluate every ULTRA light response at one sin(solar elevation). Cheap enough to call per
 *  frame (four folds of ≤8 terms); the orchestrator calls it once and pushes the results. */
export function ultraLightAt(cfg: UltraLightCfg, sinElev: number): UltraLightSample {
  return {
    dayK: bandCurve(cfg.dayCurve, sinElev),
    exposureK: bandCurve(cfg.exposureCurve, sinElev),
    hemiK: bandCurve(cfg.hemiCurve, sinElev),
    hazeK: bandCurve(cfg.hazeCurve, sinElev),
    tint: rampWeights(cfg.tintStopsDeg, sinElev),
  };
}

/**
 * Frame-rate-independent easing coefficient for a low-pass toward a target: `v += (target − v) * k`.
 *
 * Every ULTRA light term that is written per frame (exposure, haze strength, the photographic
 * de-grade) eases through this rather than snapping — a per-frame exposure JUMP reads as a
 * flicker, which is the one way this feature could make a timelapse look worse instead of better.
 * Same `1 − exp(−dt/τ)` form the ground reveal and the dark-drape crossfade already use; shared
 * here so the ULTRA terms cannot drift from that idiom. `dtMs` is clamped so a background-tab
 * gap (or a devtools pause) resolves to a single full step instead of a negative/NaN coefficient.
 */
export function easeK(dtMs: number, tauMs: number): number {
  if (!(tauMs > 0)) return 1;
  const dt = Math.min(Math.max(dtMs, 0), 250);
  return 1 - Math.exp(-dt / tauMs);
}
