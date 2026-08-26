import * as THREE from "three";

import { AERIAL_MIN_M } from "../../../lib/geo/bestSpotTypes";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";
import { clampGroundM, sampleGroundM } from "../../../lib/geo/terrain";
import { cssFontFamily } from "../../../lib/theme/cssInk";
import {
  HEAT_LUT_SIZE,
  buildHeatLut,
  heatRampById,
  spotQualityGl,
  type HeatStop,
} from "../../../lib/theme/heatPalette";
import { tokens } from "../../../lib/theme/tokens";
import { BESTSPOT, PLACEMARKS } from "../tuning";
import { glf } from "./glsl";
import { worldPerPx } from "./streetNames";
import { easeFade, makeTangentGroup, presenceForAlt, seatTangentGroup } from "./tangentOverlay";

/**
 * BEST SPOT — the GL sheet (SPEC_V2 §6, slice S4).
 *
 * WHAT IT IS. One terrain-conforming heat sheet laid on the ENU tangent plane at the disc centre:
 * every solved cell's composite score painted through the INFERNO ramp, iso-score contours, the
 * UNMAPPED boundary, the plumb line + scale spoke + altitude chip that say how HIGH the sheet is,
 * and the top-K rank markers. It is a reading of the GROUND — "where should I stand for this
 * sunrise" — not an instrument overlay.
 *
 * WHY THE DEPTH CHOICE IS WHAT IT IS (§6.10, and it is the one decision that fixes everything
 * else). The sheet is `depthTest: true`, `depthWrite: false`, `renderOrder 4` — NOT the depth-free
 * planning band at 9 (`tangentOverlay.OVERLAY_RENDER_ORDER`, shared by aimCones/focalCone/dayArcs).
 *  · Depth-TESTED, because a building must OCCLUDE the sheet. A cell inside a footprint is a cell
 *    the solver scored as `A_hard = 0`; drawing the wash through the roof would paint scores onto
 *    surfaces nobody can stand on. That is also why the sheet does NOT follow `streetNames` /
 *    `vectorFeatures` in dropping `depthTest` on the flat 2D chart: those are MAP INK, this is a
 *    ground reading.
 *  · Therefore NOT renderOrder 9: a depth-tested surface dropped into the depth-free band sorts by
 *    camera distance against `depthTest:false` siblings and flickers against the radar. 4 (sheet)
 *    and 5 (plumb + markers) also put the radar and the focal cone OVER the sheet, which is the
 *    right hierarchy — they are the instrument, this is the terrain reading.
 *  · `polygonOffset -4/-4` (the `vectorFeatures` ribbon value −3, plus one) keeps it above the
 *    ribbons it shares the ground plane with.
 *
 * THE TWO STRUCTURAL MOVES (§6.2, §6.4) — both change the material's SHAPE, not its constants:
 *
 *  (i) THE VEIL / INK SPLIT. `premultipliedAlpha = true` + `NormalBlending` sets
 *      `glBlendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, …)` (`three.module.js:10286`), and a raw
 *      `ShaderMaterial` that does NOT `#include <premultiplied_alpha_fragment>` writes
 *      `gl_FragColor` exactly as authored (`:465` is the only place three multiplies). So
 *      `gl_FragColor = vec4(ink * aInk, aVeil)` composites as `ink*aInk + ground*(1 - aVeil)` with
 *      **two independent alphas**: `aInk` is how strong the colour is, `aVeil` is how much of the
 *      map is suppressed. Measured through the real pipeline over the real (satellite) basemap:
 *      the map stays 70 % visible at the worst cell and 88 % at the best, and working-band
 *      discrimination is 2.1–2.5× the single-alpha curve on every backdrop.
 *
 * (ii) ONE RG8 `DataTexture`, `LinearFilter`, ORDINAL `.g`. `fwidth` on a `NearestFilter` sample is
 *      0 inside a texel and huge at its edge — blocky isolines — so `LinearFilter` is mandatory,
 *      which in turn forces `.g` to be ORDINAL (4 evenly-spaced levels) so that interpolation can
 *      only ever land between two ADJACENT classes. `.g` also closes an open design item: AERIAL is
 *      a property of the SHEET, not of a cell (the whole sheet is at one altitude, so
 *      `sheetAltM >= AERIAL_MIN_M` switches the chip/legend to DRONE rules); the only per-cell
 *      aerial fact is `groundReachable`, which is its own level.
 *
 * HONESTY. UNKNOWN cells are drawn COMPLETELY UNTOUCHED (`aInk = aVeil = 0`) — not dimmed, not
 * tinted; untouched is the only honest rendering of "we did not look", and its boundary is a
 * two-tone dotted stroke instead of a colour. INACCESSIBLE is a plain dim with NO hue. Neither ever
 * wears a ramp colour. The disc rim dissolves through `smoothstep` and carries no outline circle:
 * the disc edge is a compute-budget artefact, not a finding.
 *
 * ALLOCATE ONCE. The score texture (601², the ULTRA-≤300 m maximum), the 64×64-quad conforming
 * grid, the plumb bars and the marker instances are allocated at attach and REWRITTEN IN PLACE —
 * the `focalCone` lesson (it used to dispose and reallocate two BufferGeometries every frame the
 * aim stick was held). `renderOrder` is set per OBJECT: a Group's renderOrder does not propagate.
 *
 * The orchestrator owns the gate. FPV renders NOTHING (owner R2) and `/m` renders nothing until a
 * later slice; both arrive here as plain booleans on `update(ctx)`.
 */

// ---------------------------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------------------------

/**
 * The solver's published field. PRODUCER: `src/lib/geo/bestSpotSolver.ts` (slice S3c) — this
 * declaration is a deliberate local twin so the two slices could land in parallel; a later slice
 * collapses the duplicate and imports the producer's type directly.
 *
 * ONE COUPLING TO WATCH when that happens: `.r` is quantised by the PRODUCER over
 * `[displayLo, displayHi]` and de-quantised HERE over the same window, read from
 * `tuning.BESTSPOT`. The solver currently carries its own `DISPLAY_LO` / `DISPLAY_HI` copies, so
 * the two must be collapsed to the tuning block or a taste pass on `displayLo` silently shifts
 * every contour by the difference.
 */
export interface BestSpotFieldPack {
  /** Odd square grid; `nx === ny === n`. */
  n: number;
  cellM: number;
  centreLatDeg: number;
  centreLonDeg: number;
  /** Terrain height (m above the ELLIPSOID) at the disc centre. */
  centreGroundM: number;
  radiusM: number;
  /** Sheet height above LOCAL GROUND (m) = `eyeM + liftM`. */
  sheetAltM: number;
  /**
   * `n * n * 2`, row-major, row 0 = SOUTH edge, x ascending EAST.
   *  · `.r` = score remapped into `[displayLo, displayHi]`, quantised — i.e. the DISPLAY t.
   *  · `.g` = ORDINAL standability, 4 levels: 0 UNKNOWN · 85 INACCESSIBLE ·
   *    170 SCORED-not-groundReachable · 255 SCORED-reachable.
   */
  rg8: Uint8Array;
  /** 65 (64 quads). */
  conformN: number;
  /** `conformN²` ground heights (m above the ELLIPSOID), row 0 = SOUTH. */
  conformM: Float32Array | null;
  coverage: number;
  unmappedFrac: number;
  minReachM: number;
  scoringHash: string;
}

/** One top-K marker. A structural subset of `store/bestSpot.BestSpotSpot` (the row ↔ marker join
 *  shape) — the module never imports the store (`fences.test.ts`: scene modules are PUSHED data). */
export interface BestSpotSheetMarker {
  /** `${col}:${row}` in the solved grid — the same key `hoverKey` carries. */
  key: string;
  /** 1..`BESTSPOT.topK`, rendered as the digit in the marker core. */
  rank: number;
  latDeg: number;
  lonDeg: number;
  /** ABSOLUTE composite 0..1. Drives the marker's VIVIDNESS through `displayT` — never its hue. */
  score: number;
  /** `score ÷ the shortlist's best`, 0..1. Drives the marker's HUE through `HEAT_SPOTS`. Computed
   *  by the FEED (it is the only place that holds all eight at once) so this module never
   *  renormalises anything it was handed. */
  quality: number;
}

/** What `BestSpotSheetHandle.pickMarker` answers — the shortlist row under a canvas pointer, plus
 *  where it sits on screen so the hover tip can be anchored to it. */
export interface BestSpotMarkerHit {
  key: string;
  rank: number;
  /** The marker CENTRE in NDC, i.e. what the caller converts with its own `ndcToClient`. */
  ndcX: number;
  ndcY: number;
}

export interface BestSpotSheetCtx {
  camera: THREE.PerspectiveCamera;
  /** Geodetic camera altitude (m) — computed ONCE per frame by the orchestrator. */
  altM: number;
  /** Viewport height in CSS px — the `worldPerPx` denominator. */
  viewportHPx: number;
  /** Viewport width in CSS px. Only the marker PICK needs it: NDC x and y carry different pixel
   *  scales, so a hit test in NDC alone is an ellipse on a non-square canvas. */
  viewportWPx: number;
  dtMs: number;
  /** The BEST SPOT feature itself is on. */
  enabled: boolean;
  /** FPV is active — owner R2: the sheet renders NOTHING in FPV, on any shell. */
  fpvActive: boolean;
  /** `/m` (or coarse-pointer) shell — §6.10 (C): nothing renders until a later slice. */
  mobileShell: boolean;
  /** The solved field; `null` = nothing solved yet. Object IDENTITY drives the rebuild. */
  field: BestSpotFieldPack | null;
  markers: readonly BestSpotSheetMarker[];
  /** `store/bestSpot.hoverKey` — stamps a 1-cell outline through ONE uniform, no re-upload. */
  hoverKey: string | null;
  /** `store/bestSpot.selectedKey` — the row the user PICKED (owner item 1). Distinct from hover:
   *  it outlives the pointer, so it gets its own eased channel and its own bright rim rather than
   *  borrowing the hover's. */
  selectedKey: string | null;
  /** The event's contact azimuth (deg, 0 = north) — the scale spoke's bearing. */
  contactAzDeg: number;
}

export interface BestSpotSheetHandle {
  group: THREE.Group;
  update(ctx: BestSpotSheetCtx): void;
  /**
   * **S4's done-check, read off the LIVE objects.** (`SPEC_V2 §7 S4`: *"read the LIVE material and
   * scene graph"*, the `__globe.ultraLook` lesson.)
   *
   * It exists because none of S4's contract was reachable from a browser before: `window.__globe`
   * exposes no `scene`, so a verify script could not `traverse` to the sheet, and every one of the
   * seven assertions was being made in vitest against a CONSTRUCTOR ARGUMENT — which is a statement
   * about the code that built the material, not about the material three is drawing with. Anything
   * that mutated it afterwards (a quality tier, a look pass, a colour-space migration) would go
   * unnoticed at exactly the altitude where it matters.
   *
   * `maxVeil` is computed from the LIVE score texture through the fragment shader's own expression
   * (`known · mix(veilMax, aVeilS, scored)`) at `k = 1`, i.e. the geometric worst case before the
   * rim falloff and the fade scale it down — so it is an upper bound on what any pixel can sample,
   * not a spot reading.
   */
  debug(): BestSpotSheetDebug;
  /**
   * The shortlist marker under a canvas pointer (NDC), or null — owner batch 2026-08-26 item 3's
   * hit test, and the reason it lives HERE rather than in a raycaster.
   *
   * `THREE.Raycaster` cannot answer this: every object in this group carries `raycast = () => {}`
   * (they are decoration and GlobeControls must never pick them), and even without that, the marker
   * is billboarded IN THE VERTEX SHADER — an InstancedMesh raycast would test the un-billboarded
   * plane lying flat on the tangent basis and miss by the whole tilt. So the pick reproduces the
   * shader's own arithmetic instead: `writeMarkers` records each live instance's projected NDC
   * centre and its projected radius through the SAME view-space offset the vertex shader applies,
   * and this compares in PIXELS (NDC x and y are not the same scale on a wide canvas).
   *
   * Returns null whenever nothing is drawn — a disarmed disc, FPV, `/m`, or an altitude past the
   * presence band — because the honest answer to "what is under the pointer" is then "nothing".
   */
  pickMarker(ndcX: number, ndcY: number): BestSpotMarkerHit | null;
  dispose(): void;
}

/** What `BestSpotSheetHandle.debug()` answers — every field a LIVE object, never a constant. */
export interface BestSpotSheetDebug {
  visible: boolean;
  /** `uFade × presenceForAlt`, the alpha the whole group is drawn at this frame. */
  fade: number;
  material: {
    depthTest: boolean;
    depthWrite: boolean;
    transparent: boolean;
    premultipliedAlpha: boolean;
    /** `THREE.NormalBlending` is 1 — echoed as the number the renderer reads. */
    blending: number;
    polygonOffset: boolean;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
  };
  scoreTex: {
    /** Allocated edge in texels — `SCORE_TEX_N`, i.e. the largest grid the tier ladder reaches. */
    width: number;
    height: number;
    /** `""` is `THREE.NoColorSpace`: this texture is DATA, not colour. */
    colorSpace: string;
    magFilter: number;
    minFilter: number;
    generateMipmaps: boolean;
    unpackAlignment: number;
  };
  lutTex: { width: number; colorSpace: string; magFilter: number; minFilter: number };
  /** `renderOrder` per CHILD — a Group's does not propagate, which is the trap §6.10 names. */
  renderOrder: { name: string; renderOrder: number; frustumCulled: boolean }[];
  /** The grid the sheet is currently painting, straight off the material's uniforms. */
  uniforms: { gridN: number; cellM: number; radiusM: number; fade: number };
  /** Upper bound on `aVeil` over the LIVE texture, at `k = 1` — §6.2's ceiling. */
  maxVeil: number;
  /** How many texels of the live texture are in each ordinal `.g` class — the §6.4 census, read
   *  off the bytes the GPU is sampling rather than off the store's mirror of the worker's count. */
  gClasses: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (the unit-tested surface)
// ---------------------------------------------------------------------------------------------

/**
 * Score texture edge. Allocate ONCE at the largest grid the tier ladder can reach — and the
 * largest grid is at the SMALLEST radius, which is the trap: 1 m at the ULTRA radius cap is
 * 601² = 361,201 cells, while 3 m at 500 m is only 335² = 112,225. Derived from the two tunables
 * that bound it so an `ultraMaxRadiusM` change cannot silently under-allocate.
 */
export const SCORE_TEX_N = (2 * BESTSPOT.ultraMaxRadiusM) / BESTSPOT.ultraCellM + 1;

/** Vertices per side of the terrain-conforming grid (64 quads) — the producer's `CONFORM_N`. */
export const CONFORM_N = 65;

/** The 4 ORDINAL standability levels carried by `.g`. Ordinal is the whole point: linear filtering
 *  between two texels can only land BETWEEN ADJACENT CLASSES, which is the 1–2 cell uncertainty
 *  ribbon the spec asks to be drawn rather than hidden. */
export const STAND_UNKNOWN = 0;
export const STAND_INACCESSIBLE = 1;
export const STAND_SCORED_AIR = 2;
export const STAND_SCORED_GROUND = 3;
const STAND_LEVELS = 4;

/** Class boundaries on the normalised `.g` axis: the MIDPOINTS between adjacent levels
 *  (1/6, 1/2, 5/6). Structural — a function of the level count, not a taste knob. */
export const STAND_THRESHOLDS: readonly number[] = [0, 1, 2].map((k) => (k + 0.5) / (STAND_LEVELS - 1));

/** Decode one sampled `.g` (0..1) to its ordinal class. Pure. */
export function standClassOf(g01: number): number {
  if (g01 < STAND_THRESHOLDS[0]) return STAND_UNKNOWN;
  if (g01 < STAND_THRESHOLDS[1]) return STAND_INACCESSIBLE;
  if (g01 < STAND_THRESHOLDS[2]) return STAND_SCORED_AIR;
  return STAND_SCORED_GROUND;
}

/** The byte a producer writes for an ordinal level (0 / 85 / 170 / 255). Pure. */
export function standByte(level: number): number {
  return Math.round((level / (STAND_LEVELS - 1)) * 255);
}

/** DISPLAY normalisation: absolute score → ramp t, clamped. THE knob that absorbs any scoring
 *  change without a re-tune of the look. Pure. */
export function displayT(score: number): number {
  const { displayLo, displayHi } = BESTSPOT;
  return Math.min(1, Math.max(0, (score - displayLo) / (displayHi - displayLo)));
}

/** INK alpha — how strong the heat colour is. Gamma > 1 holds the low end down so the top-K stand
 *  out of the wash. Pure; reproduces §6.2's table at s = 0.15/0.45/0.65/0.85/0.95. */
export function inkAlpha(score: number): number {
  const { inkMin, inkMax, inkGamma } = BESTSPOT;
  return inkMin + (inkMax - inkMin) * Math.pow(displayT(score), inkGamma);
}

/** VEIL alpha — how much of the MAP is suppressed. Linear, INDEPENDENT of ink, and falling with
 *  score: the better the cell, the more of the map you keep. Pure. */
export function veilAlpha(score: number): number {
  const { veilMin, veilMax } = BESTSPOT;
  return veilMax - (veilMax - veilMin) * displayT(score);
}

/** The radius-derived presence band (§6.10): full below `fullAltK × R`, gone at `topAltK × R` —
 *  which for R = 300 m is 2,400 / 4,200 m, i.e. exactly where one 3 m cell measures ~1 px. Pure. */
export function presenceBand(radiusM: number): { fullAltM: number; topAltM: number } {
  return { fullAltM: BESTSPOT.fullAltK * radiusM, topAltM: BESTSPOT.topAltK * radiusM };
}

/**
 * THE NADIR PROOF (§6.7). The plumb line alone degenerates at the app's near-nadir default: with θ
 * the camera tilt from nadir, a vertical metre projects as `sin θ` — at tilt 5° a 3 m sheet is
 * 0.4 px of line, invisible. The SCALE SPOKE is the fix: a horizontal segment of length exactly
 * `sheetAltM` laid flat on the map, which projects as `sqrt(cos²θ·cos²Δ + sin²Δ) ≥ cos θ` at
 * relative bearing Δ. Their max is therefore `≥ max(sin θ, cos θ) ≥ 1/√2 = 0.7071` at EVERY tilt
 * and EVERY relative azimuth — the reading can never vanish. Pure; returns METRES of projected
 * length per `sheetAltM` metres of height.
 */
export function projectedLen(sheetAltM: number, tiltDeg: number, dAzDeg: number): number {
  const th = (tiltDeg * Math.PI) / 180;
  const dz = (dAzDeg * Math.PI) / 180;
  const vertical = Math.abs(Math.sin(th));
  const spoke = Math.sqrt(
    Math.cos(th) * Math.cos(th) * Math.cos(dz) * Math.cos(dz) + Math.sin(dz) * Math.sin(dz),
  );
  return sheetAltM * Math.max(vertical, spoke);
}

/**
 * Altitude-chip cap height in WORLD metres for a given metres-per-px — the `streetNames`
 * `labelScaleFor` recipe, so the chip is a constant `chipCapPx` on screen at every zoom (NOT the
 * `PLACEMARKS.angularSize` clamp, which gives ~8.6 px at the natural nadir altitude — too small
 * for two lines). The clamp reuses the sheet-ALTITUDE range as its guard: both bounds are inert
 * inside the presence band (measured 8.2–38 m of cap height across it) and exist only so a
 * degenerate `worldPerPx` cannot produce a zero-area or planet-sized quad. Pure.
 */
export function chipCapM(wpp: number): number {
  return Math.min(BESTSPOT.liftMaxM, Math.max(BESTSPOT.liftMinM, wpp * BESTSPOT.chipCapPx));
}

/** `1.7 m` / `12 m` / `400 m` — one decimal below 10 m, whole metres above (a chip is read at a
 *  glance, and 12.3 m of drone altitude is a false precision). Pure. */
export function formatAltM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}

/** The chip's lines: the sheet altitude, plus the DRONE badge — the ONLY place owner R1's aerial
 *  semantics become visible in the scene, and it is a property of the SHEET, not of a cell. Pure. */
export function chipLines(sheetAltM: number): readonly string[] {
  return sheetAltM >= AERIAL_MIN_M ? [formatAltM(sheetAltM), "▲ DRONE"] : [formatAltM(sheetAltM)];
}

/** `"col:row"` → cell coordinates, or `null`. The row ↔ marker join key, parsed once per frame so
 *  the hover outline costs ONE uniform write and no texture re-upload. Pure. */
export function parseCellKey(key: string | null): { col: number; row: number } | null {
  if (!key) return null;
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

/** The heat LUT as RGBA bytes. `buildHeatLut` emits RGB triplets, and three 0.185 has no
 *  `RGBFormat` upload path for byte data — the alpha lane is padding, never read by the shader. */
export function heatLutRgba(stops: readonly HeatStop[]): Uint8Array {
  const rgb = buildHeatLut(stops);
  const out = new Uint8Array(HEAT_LUT_SIZE * 4);
  for (let i = 0; i < HEAT_LUT_SIZE; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Textures + materials (the configuration surface the done-check reads)
// ---------------------------------------------------------------------------------------------

/**
 * The ONE score texture. RG8, allocated at `SCORE_TEX_N²` and never reallocated.
 *  · `LinearFilter` on BOTH filters — mandatory, see the module doc: `NearestFilter` makes every
 *    `fwidth` in the fragment blocky and is otherwise completely invisible.
 *  · `NoColorSpace` — this is DATA. (The LUT beside it is `SRGBColorSpace` because that one is a
 *    COLOUR. Swapping the two is a previously-shipped bug class here.)
 *  · `unpackAlignment = 1` — a 601-wide RG8 row is 1,202 bytes, which is NOT a multiple of the
 *    GL default alignment of 4, so a 4-aligned upload reads every row two bytes short and shears
 *    the whole field. (`DataTexture` already defaults to 1; it is written out because the failure
 *    is silent and looks like a solver bug.)
 *  · No mipmaps, no update ranges: three hard-codes `componentStride = 4` in its ranged-upload
 *    path (`three.module.js:11804`, "only RGBA supported"), so a partial upload on RG8 silently
 *    scrambles rows. `needsUpdate = true` alone takes the full-surface `texSubImage2D` branch.
 *  · Row 0 is the SOUTH edge, matching the pack. `UNPACK_FLIP_Y` does not apply to typed-array
 *    uploads, so row order is a DATA question and the shader's `v` axis is built to agree.
 */
export function makeScoreTexture(): THREE.DataTexture {
  const data = new Uint8Array(SCORE_TEX_N * SCORE_TEX_N * 2);
  const tex = new THREE.DataTexture(
    data,
    SCORE_TEX_N,
    SCORE_TEX_N,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** The ramp LUT: 256×1 RGBA8 tagged `SRGBColorSpace`, so WebGL2 allocates it `SRGB8_ALPHA8` and
 *  the sampler hands the shader LINEAR light (`three.module.js:11239`) — which is what the
 *  composer's HalfFloat target blends in, with tone mapping applied once at `OutputPass`. */
export function makeHeatLutTexture(stops: readonly HeatStop[]): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    heatLutRgba(stops),
    HEAT_LUT_SIZE,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Premultiplied source-over onto an accumulator. Every surface in this module writes
 *  PREMULTIPLIED ink, so layering halo → core → wash is one function used identically three
 *  times. Structural (the composite algebra), never a tunable. */
const OVER_GLSL = /* glsl */ `
  void over(inout vec3 rgb, inout float a, vec3 srcRgb, float srcA) {
    rgb = srcRgb * srcA + rgb * (1.0 - srcA);
    a = srcA + a * (1.0 - srcA);
  }`;

/** Distance IN PIXELS to the nearest isoline of `v`, and a `wPx`-wide stroke around a pixel
 *  distance. `fwidth` makes both quantities SCREEN-space, so a contour is 1.4 px at 200 m and at
 *  3 km and the far half of an oblique view thins itself. */
const STROKE_GLSL = /* glsl */ `
  float isoPx(float v, float stepV) {
    float q = v / stepV;
    return abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-6);
  }
  float band(float px, float wPx) {
    return 1.0 - smoothstep(wPx * 0.5 - 0.5, wPx * 0.5 + 0.5, px);
  }`;

/**
 * The sheet + contours: ONE material, ONE draw call, `renderOrder 4`.
 *
 * The old WebGL1 shader-derivative opt-in is deliberately absent: that `Material` field no longer
 * exists in three 0.185, the renderer is WebGL2-only (`three.module.js:16386` — no WebGL1
 * fallback), and every `ShaderMaterial` is compiled as GLSL ES 3.00 with a compatibility prelude
 * (`:7039`), where `fwidth` / `dFdx` are core. `bestSpotSheet.test.ts` fences it.
 */
export function makeSheetMaterial(scoreTex: THREE.Texture, lutTex: THREE.Texture): THREE.ShaderMaterial {
  const B = BESTSPOT;
  return new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true, // the VEIL/INK split — see the module doc
    blending: THREE.NormalBlending,
    depthTest: true, // a ground reading: buildings must occlude it
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: B.polygonOffset[0],
    polygonOffsetUnits: B.polygonOffset[1],
    uniforms: {
      uScore: { value: scoreTex },
      uLut: { value: lutTex },
      uGridN: { value: 1 },
      uCellM: { value: 1 },
      uRadiusM: { value: 1 },
      uFade: { value: 0 },
      uWorldPerPx: { value: 1 },
      uHoverCell: { value: new THREE.Vector2(-1, -1) },
      uInkHalo: { value: new THREE.Color(tokens.bg) },
      uInkContour: { value: new THREE.Color(tokens.textPrimary) },
      uInkDash: { value: new THREE.Color(tokens.textSecondary) },
      uInkHover: { value: new THREE.Color(tokens.accent) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScore;
      uniform sampler2D uLut;
      uniform float uGridN;
      uniform float uCellM;
      uniform float uRadiusM;
      uniform float uFade;
      uniform float uWorldPerPx;
      uniform vec2 uHoverCell;
      uniform vec3 uInkHalo;
      uniform vec3 uInkContour;
      uniform vec3 uInkDash;
      uniform vec3 uInkHover;
      varying vec3 vLocal;
${OVER_GLSL}
${STROKE_GLSL}
      void main() {
        // --- rim falloff (§6.5). smoothstep, not linear: a linear ramp leaves a C1 kink that
        // reads as a faint ring, which is the exact artefact this exists to kill. It multiplies
        // the ink, the veil AND every stroke by the SAME factor — a stroke that outlives its fill
        // reads as a UI ring rather than as data. There is no rim outline circle at all: the
        // falloff IS the boundary, and the disc edge is a compute budget, not a finding.
        float rr = length(vLocal.xy) / max(uRadiusM, 1.0);
        float k = (1.0 - smoothstep(${glf(1 - BESTSPOT.rimFrac)}, 1.0, rr)) * uFade;
        if (k < 0.004) discard;

        // Continuous CELL coordinate: integer values land on cell CENTRES, so the +0.5 texel
        // offset makes LinearFilter interpolate between neighbouring cell centres exactly.
        vec2 cellF = vLocal.xy / max(uCellM, 1e-3) + (uGridN - 1.0) * 0.5;
        vec2 uv = (cellF + 0.5) / ${glf(SCORE_TEX_N)};
        vec2 rg = texture2D(uScore, uv).rg;

        float t = clamp(rg.r, 0.0, 1.0);
        float score = ${glf(BESTSPOT.displayLo)} + t * ${glf(BESTSPOT.displayHi - BESTSPOT.displayLo)};
        float g = rg.g;

        // --- ORDINAL standability, anti-aliased on the interpolated axis. No edge-detect taps:
        // the class boundary IS the level set of the channel we already sampled.
        float gw = max(fwidth(g), 1e-6);
        float known = smoothstep(${glf(STAND_THRESHOLDS[0])} - gw, ${glf(STAND_THRESHOLDS[0])} + gw, g);
        float scored = smoothstep(${glf(STAND_THRESHOLDS[1])} - gw, ${glf(STAND_THRESHOLDS[1])} + gw, g);

        // UNKNOWN -> both alphas 0: the map is drawn completely untouched, which is the only
        // honest rendering of "we did not look". INACCESSIBLE -> a plain dim at veilMax, NO hue.
        float aInkS = ${glf(BESTSPOT.inkMin)} + ${glf(BESTSPOT.inkMax - BESTSPOT.inkMin)} * pow(t, ${glf(BESTSPOT.inkGamma)});
        float aVeilS = ${glf(BESTSPOT.veilMax)} - ${glf(BESTSPOT.veilMax - BESTSPOT.veilMin)} * t;
        float aInk = known * scored * aInkS * k;
        float aVeil = known * mix(${glf(BESTSPOT.veilMax)}, aVeilS, scored) * k;

        vec3 rgb = texture2D(uLut, vec2(t, 0.5)).rgb * aInk;
        float a = aVeil;

        // --- iso-score contours on the ABSOLUTE score. The boundary carries the reading: over
        // bright ground ink-vs-ground collapses to 1.38:1 while ink-vs-HALO holds at 3.81:1, so
        // the halo is what keeps the line legible — the same reason streetNames draws twice.
        // The DENSITY DROPOUT is mandatory: at a building flank the score jumps ~0.55 over ~3
        // cells, which is 5 isolines inside ~15 px, and the flanks read as moire without it.
        float dens = fwidth(score) / ${glf(BESTSPOT.contourStep)};
        float legible = 1.0 - smoothstep(${glf(BESTSPOT.densFadeLo)}, ${glf(BESTSPOT.densFadeHi)}, dens);
        float cGate = known * scored * legible * k;
        float cPx = isoPx(score, ${glf(BESTSPOT.contourStep)});
        float iso = floor(score / ${glf(BESTSPOT.contourStep)} + 0.5) * ${glf(BESTSPOT.contourStep)};
        float major = max(
          1.0 - step(${glf(BESTSPOT.contourStep * 0.1)}, abs(iso - ${glf(BESTSPOT.contourMajors[0])})),
          1.0 - step(${glf(BESTSPOT.contourStep * 0.1)}, abs(iso - ${glf(BESTSPOT.contourMajors[1])})));
        float coreW = ${glf(BESTSPOT.coreWidthPx)} * mix(1.0, ${glf(BESTSPOT.majorWidthK)}, major);
        // The halo keeps a CONSTANT margin around the core rather than scaling with it, so a major
        // is a thicker line in the same outline, not a fatter blob.
        float haloW = coreW + ${glf(BESTSPOT.haloWidthPx - BESTSPOT.coreWidthPx)};
        over(rgb, a, uInkHalo, band(cPx, haloW) * ${glf(BESTSPOT.haloAlpha)} * cGate);
        over(rgb, a, uInkContour,
             band(cPx, coreW) * (${glf(BESTSPOT.coreAlpha)} + ${glf(BESTSPOT.majorAlphaBoost)} * major) * cGate);

        // --- the UNMAPPED boundary: a TWO-TONE dotted stroke. A single-colour dash provably
        // fails, and it fails on COMPLEMENTARY backdrops for the two candidate inks, which is
        // exactly why the halo pair works everywhere.
        float gdPx = abs(g - ${glf(STAND_THRESHOLDS[0])}) / gw;
        // Dash phase from ARC LENGTH along the boundary, so the dashes do not crawl as the camera
        // moves. The boundary tangent is perpendicular to the WORLD gradient of g, recovered from
        // the screen derivatives of g and of the local ENU position by one 2x2 solve — no extra
        // texture taps.
        vec2 dpx = dFdx(vLocal.xy);
        vec2 dpy = dFdy(vLocal.xy);
        float gx = dFdx(g);
        float gy = dFdy(g);
        float det = dpx.x * dpy.y - dpx.y * dpy.x;
        float safeDet = abs(det) < 1e-12 ? 1e-12 : det;
        vec2 gradW = vec2(dpy.y * gx - dpx.y * gy, dpx.x * gy - dpy.x * gx) / safeDet;
        vec2 tanW = normalize(vec2(-gradW.y, gradW.x) + 1e-9);
        float ph = fract(dot(vLocal.xy, tanW) / max(uWorldPerPx, 1e-4) / ${glf(BESTSPOT.unknownDashPx)});
        float aaPh = 0.5 / ${glf(BESTSPOT.unknownDashPx)};
        float half0 = ${glf(BESTSPOT.unknownDuty * 0.5)};
        float dash = 1.0 - smoothstep(half0 - aaPh, half0 + aaPh, abs(ph - half0));
        over(rgb, a, uInkHalo, band(gdPx, ${glf(BESTSPOT.haloWidthPx)}) * ${glf(BESTSPOT.haloAlpha)} * dash * k);
        // S3d: the UNMAPPED dash now has its OWN alpha (BESTSPOT.dashCoreAlpha 0.90) instead of
        // borrowing the contour's coreAlpha 0.95 — see that key's docstring for why the two differ.
        // (No backticks in here: this block is inside a JS template literal.)
        over(rgb, a, uInkDash, band(gdPx, ${glf(BESTSPOT.coreWidthPx)}) * ${glf(BESTSPOT.dashCoreAlpha)} * dash * k);

        // --- hovered cell: a 1-cell accent outline stamped through ONE uniform, no re-upload.
        vec2 hd = abs(cellF - uHoverCell);
        float e = max(hd.x, hd.y);
        float ePx = abs(e - 0.5) / max(fwidth(e), 1e-6);
        over(rgb, a, uInkHover,
             band(ePx, ${glf(BESTSPOT.coreWidthPx * BESTSPOT.majorWidthK)})
             * ${glf(BESTSPOT.coreAlpha)} * step(0.0, uHoverCell.x) * k);

        if (a < 0.004 && max(max(rgb.r, rgb.g), rgb.b) < 0.004) discard;
        gl_FragColor = vec4(rgb, a);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Plumb line + ground tick + scale spoke: ONE material over ONE geometry whose halo bars are all
 * written BEFORE the core bars, so the two-tone stroke composites in submission order inside a
 * single draw call rather than depending on three's transparent sort (which cannot separate two
 * coincident objects). Ink and alpha ride per-vertex attributes.
 */
export function makePlumbMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aInk;
      attribute float aAlpha;
      varying vec3 vInk;
      varying float vAlpha;
      void main() {
        vInk = aInk;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vInk;
      varying float vAlpha;
      void main() {
        float a = vAlpha * uFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vInk * a, a);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Top-K markers: the `placeMarkers` ring+core billboard VERBATIM (the same annulus and core
 * smoothsteps), with four deliberate changes.
 *  · `depthTest: true` — the sheet is depth-tested, so a depth-free marker would shine through the
 *    buildings the sheet respects.
 *  · A `tokens.bg` outer halo ring, one band wider on both sides, entirely inside the quad.
 *  · **COLOUR IS QUALITY** (owner batch 2026-08-26, item 2 — this SUPERSEDES the shipped rule that
 *    colour was identity). It used to be `tokens.accent` for all eight, on the argument that the
 *    sheet beneath already encodes the score. The owner's finding is that eight identical cyan
 *    rings carry no ranking at a glance, and re-using the sheet's own INFERNO would be worse still:
 *    a marker painted its own cell's colour is invisible against that cell, and the whole shortlist
 *    lives in INFERNO's near-black foot in a real disc. So the ring takes a per-instance tint from
 *    `HEAT_SPOTS` (a separate, always-bright, lightness-monotone scale) keyed on SHORTLIST-RELATIVE
 *    quality, and its INK STRENGTH from the ABSOLUTE display t — hue says "which of these eight",
 *    vividness says "…and are any of them actually good". The rank digit still carries identity.
 *  · **The digit atlas is neutral ink, not accent.** With a coloured ring the glyph can no longer
 *    borrow the ring's hue (one atlas serves all eight instances), so it is drawn in
 *    `tokens.textPrimary` on its own `tokens.bg` halo — legible over every stop of the ramp.
 * The verbatim core dot survives as the no-atlas fallback (SSR / headless), so the anatomy
 * degrades to the shipped one rather than to nothing.
 *
 * SELECTION (item 1) is the fourth channel and it reuses the anatomy rather than adding geometry:
 * a selected marker's OUTER HALO flips from `tokens.bg` to `tokens.accent` — a bright rim where
 * every other marker has a dark one — and it is scaled by `selectRadiusK`. There is no room for a
 * further annulus (the quad spans [-1,1] and the halo already reaches r = 1.00 on the axes), and a
 * ring drawn inside would cut through the digit's own square.
 */
export function makeMarkerMaterial(digits: THREE.Texture | null): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uHalo: { value: new THREE.Color(tokens.bg) },
      // The SELECTED marker's rim. Accent survives here and only here: it is now a STATE ink
      // ("this is the one you picked"), which is what the token is reserved for, rather than the
      // shortlist's identity colour.
      uSelectRim: { value: new THREE.Color(tokens.accent) },
      uDigits: { value: digits },
      uHasDigits: { value: digits ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aRank;
      attribute float aHover;
      attribute float aSelect;
      attribute vec3 aTint;
      attribute float aVivid;
      varying vec2 vUvC;
      varying float vRank;
      varying float vHover;
      varying float vSelect;
      varying vec3 vTint;
      varying float vVivid;
      void main() {
        vUvC = position.xy; // plane spans [-1, 1]^2
        vRank = aRank;
        vHover = aHover;
        vSelect = aSelect;
        vTint = aTint;
        vVivid = aVivid;
        // Billboard in VIEW space (the Pins flare recipe, via placeMarkers): the centre keeps its
        // own view-space depth, so the marker is depth-tested where it actually stands.
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scale = length(vec3(instanceMatrix[0]));
        gl_Position = projectionMatrix * vec4(centre.xyz + vec3(position.xy * scale, 0.0), 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHalo;
      uniform vec3 uSelectRim;
      uniform sampler2D uDigits;
      uniform float uHasDigits;
      varying vec2 vUvC;
      varying float vRank;
      varying float vHover;
      varying float vSelect;
      varying vec3 vTint;
      varying float vVivid;
${OVER_GLSL}
      void main() {
        float r = length(vUvC);
        float ring = smoothstep(0.98, 0.90, r) * smoothstep(0.68, 0.78, r);
        float core = 1.0 - smoothstep(0.22, 0.32, r);
        float halo = smoothstep(1.00, 0.86, r) * smoothstep(0.62, 0.76, r);
        // ABSOLUTE reading first (the floor a bad disc cannot climb out of), THEN the two
        // attention states lift it to full — a hovered or selected marker is always readable.
        float base = ${glf(PLACEMARKS.alpha)} * mix(${glf(BESTSPOT.markerDimK)}, 1.0, clamp(vVivid, 0.0, 1.0));
        float ink = mix(base, 1.0, max(vHover, vSelect));
        vec3 rimInk = mix(uHalo, uSelectRim, clamp(vSelect, 0.0, 1.0));
        float rimA = mix(${glf(BESTSPOT.haloAlpha)}, ${glf(BESTSPOT.coreAlpha)}, clamp(vSelect, 0.0, 1.0));
        vec2 gUv = vUvC + 0.5;
        float inG = step(0.0, gUv.x) * step(gUv.x, 1.0) * step(0.0, gUv.y) * step(gUv.y, 1.0);
        vec4 d = texture2D(uDigits, vec2((gUv.x + vRank) / ${glf(BESTSPOT.topK)}, gUv.y));
        vec3 rgb = vec3(0.0);
        float a = 0.0;
        over(rgb, a, rimInk, halo * rimA);
        over(rgb, a, vTint, max(ring, core * (1.0 - uHasDigits)) * ink);
        over(rgb, a, d.rgb, d.a * inG * uHasDigits * ink);
        if (a < 0.004) discard;
        gl_FragColor = vec4(rgb, a);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------------------------
// Canvas rasters (browser-only — the module is a `client:only` island, but its scene graph is
// unit-tested headlessly, where a 2D canvas does not exist)
// ---------------------------------------------------------------------------------------------

const CANVAS_CELL_PX = 64;
const CANVAS_FONT_PX = 40;
/** The `streetNames` halo recipe: a soft dark shadow, then `fillText` TWICE so the glyph sits on
 *  its own halo. `aimCones`' N marker has neither the halo nor the anisotropy — this is the UNION
 *  of the two shipped recipes, which is what a chip read over a hot sheet cell needs. */
const CANVAS_HALO_K = 0.22;

function canvas2d(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
): void {
  ctx.shadowColor = tokens.bg;
  ctx.shadowBlur = CANVAS_FONT_PX * CANVAS_HALO_K;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
}

/** The shared 8-glyph rank atlas: one `CANVAS_CELL_PX` column per rank, NEUTRAL ink on its own
 *  halo. One texture for all eight markers — the alternative is eight canvases per solve, and it
 *  is also why the glyph cannot wear the ring's per-instance tint: `textPrimary` on a `bg` halo is
 *  the one ink that stays legible across every stop of `HEAT_SPOTS`. */
function makeDigitAtlas(font: string, maxAniso: number): THREE.CanvasTexture | null {
  const ctx = canvas2d(CANVAS_CELL_PX * BESTSPOT.topK, CANVAS_CELL_PX);
  if (!ctx) return null;
  ctx.font = `600 ${CANVAS_FONT_PX}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < BESTSPOT.topK; i++) {
    drawHaloText(
      ctx,
      String(i + 1),
      i * CANVAS_CELL_PX + CANVAS_CELL_PX / 2,
      CANVAS_CELL_PX / 2,
      tokens.textPrimary,
    );
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

/** The altitude chip raster. Returns the texture plus its aspect, so the quad can be sized from a
 *  cap height in world metres the way `streetNames` sizes a label. */
function makeChipTexture(
  lines: readonly string[],
  font: string,
  maxAniso: number,
): { texture: THREE.CanvasTexture; aspect: number; capK: number } | null {
  const h = CANVAS_CELL_PX * lines.length;
  const probe = canvas2d(2, 2);
  if (!probe) return null;
  probe.font = `600 ${CANVAS_FONT_PX}px ${font}`;
  const w = Math.max(
    CANVAS_CELL_PX * 2,
    Math.ceil(Math.max(...lines.map((l) => probe.measureText(l).width)) + CANVAS_FONT_PX),
  );
  const ctx = canvas2d(w, h);
  if (!ctx) return null;
  ctx.font = `600 ${CANVAS_FONT_PX}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i++) {
    // The DRONE badge is the second line and the only warn-coloured ink in the scene.
    const fill = i === 0 ? tokens.textPrimary : tokens.warn;
    drawHaloText(ctx, lines[i], w / 2, CANVAS_CELL_PX * (i + 0.5), fill);
  }
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAniso);
  return { texture, aspect: w / h, capK: h / CANVAS_FONT_PX };
}

// ---------------------------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------------------------

/** Bars per plumb group (plumb line + 4 tick arms + scale spoke), each drawn twice (halo, core). */
const PLUMB_BARS = 6;
const VERTS_PER_BAR = 6;

/** Module scratch — one seat per frame, and allocating vectors inside the frame step is exactly
 *  the waste the tangent-overlay extraction is about. */
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _f = new THREE.Vector3();

export function attachBestSpotSheet(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
    maxAniso?: number;
  } = {},
): BestSpotSheetHandle {
  const maxAniso = opts.maxAniso ?? 1;
  const font = typeof document !== "undefined" ? cssFontFamily(document.documentElement) : "sans-serif";

  const group = makeTangentGroup(scene);

  // --- the sheet: 64x64 quads, allocated ONCE and rewritten in place.
  const scoreTex = makeScoreTexture();
  const scoreData = scoreTex.image.data as Uint8Array;
  const lutTex = makeHeatLutTexture(heatRampById(BESTSPOT.rampId));
  const sheetMat = makeSheetMaterial(scoreTex, lutTex);
  const sheetPos = new Float32Array(CONFORM_N * CONFORM_N * 3);
  const sheetAttr = new THREE.BufferAttribute(sheetPos, 3).setUsage(THREE.DynamicDrawUsage);
  const sheetGeo = new THREE.BufferGeometry().setAttribute("position", sheetAttr);
  {
    const idx = new Uint16Array((CONFORM_N - 1) * (CONFORM_N - 1) * 6);
    let o = 0;
    for (let j = 0; j < CONFORM_N - 1; j++) {
      for (let i = 0; i < CONFORM_N - 1; i++) {
        const a = j * CONFORM_N + i;
        idx[o++] = a;
        idx[o++] = a + 1;
        idx[o++] = a + CONFORM_N + 1;
        idx[o++] = a;
        idx[o++] = a + CONFORM_N + 1;
        idx[o++] = a + CONFORM_N;
      }
    }
    sheetGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.name = "bestSpotSheet";
  sheet.renderOrder = BESTSPOT.renderOrder;

  // --- plumb line + ground tick + scale spoke.
  const plumbMat = makePlumbMaterial();
  const plumbCount = PLUMB_BARS * 2 * VERTS_PER_BAR;
  const plumbPos = new Float32Array(plumbCount * 3);
  const plumbInk = new Float32Array(plumbCount * 3);
  const plumbAlpha = new Float32Array(plumbCount);
  const plumbPosAttr = new THREE.BufferAttribute(plumbPos, 3).setUsage(THREE.DynamicDrawUsage);
  const plumbGeo = new THREE.BufferGeometry()
    .setAttribute("position", plumbPosAttr)
    .setAttribute("aInk", new THREE.BufferAttribute(plumbInk, 3))
    .setAttribute("aAlpha", new THREE.BufferAttribute(plumbAlpha, 1));
  {
    // Ink and alpha are FIXED per vertex: the first half of the buffer is halo, the second core.
    const haloInk = new THREE.Color(tokens.bg);
    const coreInk = new THREE.Color(tokens.accent);
    const half = PLUMB_BARS * VERTS_PER_BAR;
    for (let i = 0; i < plumbCount; i++) {
      const c = i < half ? haloInk : coreInk;
      plumbInk[i * 3] = c.r;
      plumbInk[i * 3 + 1] = c.g;
      plumbInk[i * 3 + 2] = c.b;
      plumbAlpha[i] = i < half ? BESTSPOT.haloAlpha : PLACEMARKS.alpha;
    }
  }
  const plumb = new THREE.Mesh(plumbGeo, plumbMat);
  plumb.name = "bestSpotPlumb";
  plumb.renderOrder = BESTSPOT.markerRenderOrder;

  // --- top-K markers.
  const digits = makeDigitAtlas(font, maxAniso);
  const markerMat = makeMarkerMaterial(digits);
  const markerGeo = new THREE.PlaneGeometry(2, 2);
  const markerRank = new THREE.InstancedBufferAttribute(new Float32Array(BESTSPOT.topK), 1);
  const markerHover = new THREE.InstancedBufferAttribute(new Float32Array(BESTSPOT.topK), 1);
  const markerSelect = new THREE.InstancedBufferAttribute(new Float32Array(BESTSPOT.topK), 1);
  const markerTint = new THREE.InstancedBufferAttribute(new Float32Array(BESTSPOT.topK * 3), 3);
  const markerVivid = new THREE.InstancedBufferAttribute(new Float32Array(BESTSPOT.topK), 1);
  markerGeo.setAttribute("aRank", markerRank);
  markerGeo.setAttribute("aHover", markerHover);
  markerGeo.setAttribute("aSelect", markerSelect);
  markerGeo.setAttribute("aTint", markerTint);
  markerGeo.setAttribute("aVivid", markerVivid);
  const markers = new THREE.InstancedMesh(markerGeo, markerMat, BESTSPOT.topK);
  markers.name = "bestSpotMarkers";
  markers.renderOrder = BESTSPOT.markerRenderOrder;
  markers.count = 0;

  // --- the billboarded altitude chip.
  const chipGeo = new THREE.PlaneGeometry(1, 1);
  const chipMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false, // a label must not be eaten by the building it stands beside (§6.7)
    side: THREE.DoubleSide,
  });
  const chip = new THREE.Mesh(chipGeo, chipMat);
  chip.name = "bestSpotChip";
  chip.renderOrder = BESTSPOT.markerRenderOrder;
  chip.matrixAutoUpdate = false;
  chip.visible = false;
  let chipAspect = 1;
  let chipCapK = 1;
  let chipText = "";

  for (const obj of [sheet, plumb, markers, chip]) {
    obj.raycast = () => {}; // decoration — GlobeControls never picks it
    obj.frustumCulled = false; // local geometry under a planetary matrix; bounds would lie
    group.add(obj);
  }

  // --- closure state
  let built: BestSpotFieldPack | null = null;
  let builtMarkers: readonly BestSpotSheetMarker[] = [];
  let fade = 0;
  let basis = enuBasis(0, 0);
  let centre: readonly [number, number, number] = [0, 0, 0];
  const hoverEase = new Float32Array(BESTSPOT.topK);
  const selectEase = new Float32Array(BESTSPOT.topK);
  const camLocal = new THREE.Vector3();

  // --- the marker PICK ledger (item 3). Written by `writeMarkers` from the SAME view-space offset
  //     the vertex shader billboards with, so what is hit-tested is what is drawn. `pickCount` is
  //     0 whenever nothing is on screen, which is what makes `pickMarker` fail closed.
  const pickNdc = new Float32Array(BESTSPOT.topK * 2);
  const pickRadNdcX = new Float32Array(BESTSPOT.topK);
  const pickKeys: string[] = [];
  const pickRanks = new Float32Array(BESTSPOT.topK);
  let pickCount = 0;
  let pickWPx = 1;
  let pickHPx = 1;
  const _mv = new THREE.Vector3();
  const _mvEdge = new THREE.Vector3();
  const _spotInk = new THREE.Color();

  /** Rewrite the conforming grid + re-upload the field. Never disposes, never reallocates. */
  function rebuild(pack: BestSpotFieldPack): void {
    // FOOTPRINT. The conform lattice is documented as "spanning the disc bbox"; the sheet reads
    // that as the FIELD's own footprint, `n * cellM`, not `2 * radiusM`. That is the only reading
    // under which the score texture and the conforming mesh share ONE footprint, which is what
    // makes the fragment's cell↔texel mapping exact rather than off by half a cell. (`n` is
    // `oddSpanCells(radiusM, cellM)`, so the two differ by less than one cell anyway.)
    const spanM = pack.n * pack.cellM;
    const seatM = clampGroundM(pack.centreGroundM);
    const conform = pack.conformM && pack.conformN === CONFORM_N ? pack.conformM : null;
    for (let j = 0; j < CONFORM_N; j++) {
      for (let i = 0; i < CONFORM_N; i++) {
        const o = (j * CONFORM_N + i) * 3;
        sheetPos[o] = (i / (CONFORM_N - 1) - 0.5) * spanM; // east
        sheetPos[o + 1] = (j / (CONFORM_N - 1) - 0.5) * spanM; // north (row 0 = SOUTH)
        // Local up is relative to the SEAT, so the float32 attribute carries tens of metres
        // rather than millions — the ECEF cancellation stays on the CPU, in float64.
        sheetPos[o + 2] = conform ? clampGroundM(conform[j * CONFORM_N + i]) - seatM : 0;
      }
    }
    sheetAttr.needsUpdate = true;

    // FULL-SURFACE upload only. Clearing first is what keeps the LinearFilter tap at the last live
    // row/column from bleeding a previous, larger solve back into the new one.
    scoreData.fill(0);
    const stride = SCORE_TEX_N * 2;
    for (let j = 0; j < pack.n; j++) {
      scoreData.set(pack.rg8.subarray(j * pack.n * 2, (j + 1) * pack.n * 2), j * stride);
    }
    scoreTex.needsUpdate = true;

    sheetMat.uniforms.uGridN.value = pack.n;
    sheetMat.uniforms.uCellM.value = pack.cellM;
    sheetMat.uniforms.uRadiusM.value = pack.radiusM;

    basis = enuBasis(pack.centreLatDeg, pack.centreLonDeg);
    centre = geodeticToEcef(pack.centreLatDeg, pack.centreLonDeg, seatM);
    seatTangentGroup(group, pack.centreLatDeg, pack.centreLonDeg, seatM, 1);
    built = pack;
  }

  /** ECEF → the group's local ENU metres (the group matrix is an orthonormal basis at scale 1). */
  function toLocal(p: readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
    const dx = p[0] - centre[0];
    const dy = p[1] - centre[1];
    const dz = p[2] - centre[2];
    return out.set(
      dx * basis.east[0] + dy * basis.east[1] + dz * basis.east[2],
      dx * basis.north[0] + dy * basis.north[1] + dz * basis.north[2],
      dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2],
    );
  }

  /** One bar A→B of half-width `w` along the in-plane normal `n`, as two triangles. */
  function writeBar(
    slot: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    nx: number,
    ny: number,
    w: number,
  ): void {
    const ox = nx * w;
    const oy = ny * w;
    const p = [
      [ax - ox, ay - oy, az],
      [bx - ox, by - oy, bz],
      [bx + ox, by + oy, bz],
      [ax + ox, ay + oy, az],
    ];
    const tri = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const o = (slot * VERTS_PER_BAR + i) * 3;
      plumbPos[o] = p[tri[i]][0];
      plumbPos[o + 1] = p[tri[i]][1];
      plumbPos[o + 2] = p[tri[i]][2];
    }
  }

  /** Rewrite the plumb group for this frame's screen scale, view azimuth and contact bearing. */
  function writePlumb(sheetAltM: number, wpp: number, contactAzDeg: number, camLocal: THREE.Vector3): void {
    // The plumb quad faces the camera: its width axis is the in-plane perpendicular to the
    // horizontal view direction, so the line keeps a constant screen width at any heading.
    const hx = camLocal.x;
    const hy = camLocal.y;
    const hl = Math.hypot(hx, hy) || 1;
    const px = -hy / hl;
    const py = hx / hl;
    const az = (contactAzDeg * Math.PI) / 180;
    const sx = Math.sin(az); // 0 deg = north, clockwise
    const sy = Math.cos(az);
    const armM = BESTSPOT.tickArmPx * wpp;
    // Half-widths in world metres. The halo keeps the SAME constant margin around the core as the
    // contour halo does, so the whole module has one stroke grammar.
    const wCore = BESTSPOT.plumbHalfWidthPx * wpp;
    const wHalo = (BESTSPOT.plumbHalfWidthPx + (BESTSPOT.haloWidthPx - BESTSPOT.coreWidthPx) * 0.5) * wpp;
    for (let pass = 0; pass < 2; pass++) {
      const w = pass === 0 ? wHalo : wCore;
      const b = pass * PLUMB_BARS;
      writeBar(b, 0, 0, 0, 0, 0, sheetAltM, px, py, w); // the vertical
      writeBar(b + 1, 0, 0, 0, armM, 0, 0, 0, 1, w); // ground tick, 4 arms
      writeBar(b + 2, 0, 0, 0, -armM, 0, 0, 0, 1, w);
      writeBar(b + 3, 0, 0, 0, 0, armM, 0, 1, 0, w);
      writeBar(b + 4, 0, 0, 0, 0, -armM, 0, 1, 0, w);
      // THE SCALE SPOKE — a horizontal segment of length exactly `sheetAltM` in ground metres on
      // the contact bearing. A literal scale bar: the sheet is this high, and this is what that
      // height looks like laid flat on the map you are reading. It is what survives at nadir.
      writeBar(b + 5, 0, 0, 0, sx * sheetAltM, sy * sheetAltM, 0, -sy, sx, w);
    }
    plumbPosAttr.needsUpdate = true;
  }

  /** Re-raster the chip only when its TEXT changes (an altitude drag re-rasters at most once per
   *  displayed value, never per frame). */
  function syncChip(sheetAltM: number): void {
    const lines = chipLines(sheetAltM);
    const text = lines.join("\n");
    if (text === chipText) return;
    chipText = text;
    const made = makeChipTexture(lines, font, maxAniso);
    if (!made) return;
    chipMat.map?.dispose();
    chipMat.map = made.texture;
    chipMat.needsUpdate = true;
    chipAspect = made.aspect;
    chipCapK = made.capK;
  }

  /** Place the chip: at the top of the plumb line once that line is long enough to hang a label
   *  on, otherwise just outboard of the ground tick along the spoke. ONE `lerp` on a smoothstep,
   *  so it SLIDES rather than jumps. The threshold is the chip's own cap height, which is the
   *  honest version of a tilt threshold: at a 1.7 m sheet the "top of the line" is under a pixel
   *  above its base at ANY tilt, so a tilt-only rule would put the chip on top of the tick. */
  function placeChip(
    sheetAltM: number,
    wpp: number,
    contactAzDeg: number,
    camLocal: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
  ): void {
    const capM = chipCapM(wpp);
    const dx = camLocal.x;
    const dy = camLocal.y;
    const dz = camLocal.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const sinTilt = Math.hypot(dx, dy) / len;
    const plumbPx = (sinTilt * sheetAltM) / Math.max(wpp, 1e-6);
    const capPx = BESTSPOT.chipCapPx;
    const tt = Math.min(1, Math.max(0, (plumbPx - capPx) / capPx));
    const slide = tt * tt * (3 - 2 * tt); // smoothstep
    const az = (contactAzDeg * Math.PI) / 180;
    // The nadir seat: outboard of the tick along the spoke by the arm plus half a cap height.
    const outM = (BESTSPOT.tickArmPx + BESTSPOT.chipCapPx * 0.5) * wpp;
    const nx = Math.sin(az) * outM;
    const ny = Math.cos(az) * outM;
    const cx = nx * (1 - slide);
    const cy = ny * (1 - slide);
    const cz = (sheetAltM + capM) * slide;

    // Screen-aligned billboard: the camera's world right/up expressed in the group's local ENU.
    const e = camera.matrixWorld.elements;
    const rW: readonly [number, number, number] = [e[0], e[1], e[2]];
    const uW: readonly [number, number, number] = [e[4], e[5], e[6]];
    const dot = (v: readonly [number, number, number], b: readonly [number, number, number]) =>
      v[0] * b[0] + v[1] * b[1] + v[2] * b[2];
    const rx = dot(rW, basis.east);
    const ry = dot(rW, basis.north);
    const rz = dot(rW, basis.up);
    const ux = dot(uW, basis.east);
    const uy = dot(uW, basis.north);
    const uz = dot(uW, basis.up);
    const hM = capM * chipCapK;
    const wM = hM * chipAspect;
    const right = _v.set(rx, ry, rz).normalize().multiplyScalar(wM);
    const up = _s.set(ux, uy, uz).normalize().multiplyScalar(hM);
    chip.matrix.makeBasis(right, up, _f.crossVectors(right, up).normalize()).setPosition(cx, cy, cz);
    chip.visible = true;
  }

  /**
   * Seat the top-K instances: angular-constant size (the `placeMarkers` clamp), hover AND selection
   * easing on ring alpha and radius, the rank digit, the quality tint — and the pick ledger.
   *
   * The two attention channels compose MULTIPLICATIVELY on radius rather than by `max`: a marker
   * that is both selected and hovered has to answer the hover, or the pointer stops meaning
   * anything the moment a row is picked.
   */
  function writeMarkers(
    list: readonly BestSpotSheetMarker[],
    pack: BestSpotFieldPack,
    camLocal: THREE.Vector3,
    hoverKey: string | null,
    selectedKey: string | null,
    camera: THREE.PerspectiveCamera,
    dtMs: number,
  ): void {
    const n = Math.min(list.length, BESTSPOT.topK);
    const was = markers.count;
    markers.count = n;
    pickCount = 0;
    if (n === 0) {
      if (was !== 0) markers.instanceMatrix.needsUpdate = true;
      return; // the coarse rungs paint the sheet with the top-K still greyed (`RANKING…`)
    }
    for (let i = 0; i < n; i++) {
      const spot = list[i];
      const { h } = sampleGroundM(
        opts.terrainHeightAt?.(spot.latDeg, spot.lonDeg),
        clampGroundM(pack.centreGroundM),
      );
      const ecef = geodeticToEcef(spot.latDeg, spot.lonDeg, h + pack.sheetAltM);
      toLocal(ecef, _v);
      const k = 1 - Math.exp(-dtMs / BESTSPOT.hoverEaseTauMs);
      const wantHover = hoverKey !== null && hoverKey === spot.key ? 1 : 0;
      const wantSel = selectedKey !== null && selectedKey === spot.key ? 1 : 0;
      hoverEase[i] += (wantHover - hoverEase[i]) * k;
      selectEase[i] += (wantSel - selectEase[i]) * k;
      markerHover.array[i] = hoverEase[i];
      markerSelect.array[i] = selectEase[i];
      markerRank.array[i] = Math.min(BESTSPOT.topK, Math.max(1, spot.rank)) - 1;
      // HUE from shortlist-relative quality (always a visible range across the eight), INK from the
      // absolute display t (an all-bad disc reads as all-bad). Two facts, two channels, and the
      // panel row prints the absolute number beside the same swatch.
      // `spotQualityGl` INTERPOLATES between adjacent stops rather than snapping to the nearest of
      // five, and that is a measured requirement: a real Dnipro shortlist spans `score ÷ best`
      // 1.000 → 0.802, which snapping collapsed onto TWO stops — six identical markers and two
      // identical markers, most of the way back to the one flat colour this replaced. It is also
      // the one door the DOM swatch goes through (`spotQualityCss`), in the same sRGB space.
      //
      // It absorbs a non-finite `quality` itself: a NaN in a vertex attribute is a silently BLACK
      // marker, so an upstream divide-by-an-empty-shortlist would present as "they disappeared".
      _spotInk.set(spotQualityGl(spot.quality));
      markerTint.array[i * 3] = _spotInk.r;
      markerTint.array[i * 3 + 1] = _spotInk.g;
      markerTint.array[i * 3 + 2] = _spotInk.b;
      markerVivid.array[i] = Number.isFinite(spot.score) ? displayT(spot.score) : 0;
      const dist = _v.distanceTo(camLocal);
      const size =
        Math.min(
          PLACEMARKS.maxSizeM,
          Math.max(PLACEMARKS.minSizeM, dist * PLACEMARKS.angularSize),
        ) *
        (1 + (BESTSPOT.hoverRadiusK - 1) * hoverEase[i]) *
        (1 + (BESTSPOT.selectRadiusK - 1) * selectEase[i]);
      _m.compose(_v, _q, _s.setScalar(size));
      markers.setMatrixAt(i, _m);

      // --- the pick ledger, through the vertex shader's own arithmetic: the centre goes to VIEW
      // space, the edge is that centre offset by `size` along view X (which is exactly what the
      // billboard does), and both are projected. World space here IS ECEF (that is what `toLocal`
      // consumes), so the marker's own `ecef` is the world position — no dependence on whether the
      // tangent group's `matrixWorld` has been refreshed this frame.
      //
      // `z < 0` is the in-front test in a right-handed view basis. A marker behind the eye MUST be
      // skipped: projection folds it back onto the screen and would make dead ground clickable.
      _mv.set(ecef[0], ecef[1], ecef[2]).applyMatrix4(camera.matrixWorldInverse);
      if (_mv.z < 0) {
        _mvEdge.set(_mv.x + size, _mv.y, _mv.z).applyMatrix4(camera.projectionMatrix);
        _mv.applyMatrix4(camera.projectionMatrix);
        const j = pickCount++;
        pickNdc[j * 2] = _mv.x;
        pickNdc[j * 2 + 1] = _mv.y;
        pickRadNdcX[j] = Math.abs(_mvEdge.x - _mv.x);
        pickKeys[j] = spot.key;
        pickRanks[j] = spot.rank;
      }
    }
    markers.instanceMatrix.needsUpdate = true;
    markerRank.needsUpdate = true;
    markerHover.needsUpdate = true;
    markerSelect.needsUpdate = true;
    markerTint.needsUpdate = true;
    markerVivid.needsUpdate = true;
  }

  return {
    group,

    update(ctx: BestSpotSheetCtx) {
      // Owner R2 (FPV renders nothing) and §6.10 (C) (`/m` renders nothing yet) arrive as plain
      // booleans; the POLICY that composes them lives at the orchestrator's read.
      const want = ctx.enabled && !ctx.fpvActive && !ctx.mobileShell && ctx.field !== null;
      fade = easeFade(fade, want, ctx.dtMs, BESTSPOT.fadeTauMs);
      const pack = ctx.field;
      // FAIL CLOSED on every early return: with nothing drawn there is nothing to hit, and a stale
      // ledger would keep answering `pickMarker` after the disc was disarmed or FPV took the view.
      if (!pack) {
        group.visible = false;
        pickCount = 0;
        return;
      }
      const presence = presenceForAlt(ctx.altM, presenceBand(pack.radiusM));
      const a = fade * presence;
      if (a < 0.01) {
        group.visible = false;
        pickCount = 0;
        return;
      }
      group.visible = true;
      pickWPx = Math.max(1, ctx.viewportWPx);
      pickHPx = Math.max(1, ctx.viewportHPx);

      if (pack !== built) rebuild(pack);

      const wpp = worldPerPx(ctx.altM, ctx.camera.fov, ctx.viewportHPx);
      toLocal([ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z], camLocal);

      sheetMat.uniforms.uFade.value = a;
      sheetMat.uniforms.uWorldPerPx.value = wpp;
      const hover = parseCellKey(ctx.hoverKey);
      (sheetMat.uniforms.uHoverCell.value as THREE.Vector2).set(
        hover ? hover.col : -1,
        hover ? hover.row : -1,
      );

      plumbMat.uniforms.uFade.value = a;
      writePlumb(pack.sheetAltM, wpp, ctx.contactAzDeg, camLocal);
      syncChip(pack.sheetAltM);
      chipMat.opacity = a;
      if (chipMat.map) placeChip(pack.sheetAltM, wpp, ctx.contactAzDeg, camLocal, ctx.camera);

      if (ctx.markers !== builtMarkers) {
        builtMarkers = ctx.markers;
        hoverEase.fill(0);
        // The SELECT ease is reset with it: instance i is a different cell after a re-solve, so a
        // carried-over ease would light the wrong marker for one tau (~180 ms) — the same reason
        // the hover ease has always been cleared here.
        selectEase.fill(0);
      }
      writeMarkers(
        ctx.markers,
        pack,
        camLocal,
        ctx.hoverKey,
        ctx.selectedKey,
        ctx.camera,
        ctx.dtMs,
      );
    },

    pickMarker(ndcX, ndcY) {
      if (!group.visible || pickCount === 0) return null;
      // PIXELS, not NDC: on a 16:9 canvas one NDC unit is 1.78× wider than it is tall, so an
      // NDC-space distance test is an ellipse and a marker is easier to hit from the side.
      const px = (ndcX * pickWPx) / 2;
      const py = (ndcY * pickHPx) / 2;
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < pickCount; i++) {
        const mx = (pickNdc[i * 2] * pickWPx) / 2;
        const my = (pickNdc[i * 2 + 1] * pickHPx) / 2;
        const d = Math.hypot(px - mx, py - my);
        // The drawn RING is what the eye aims at, so the hit disc is the marker's own radius plus
        // a fixed pad — at planning altitudes `PLACEMARKS.minSizeM` is only a few px across.
        if (d <= (pickRadNdcX[i] * pickWPx) / 2 + BESTSPOT.markerPickPadPx && d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI < 0) return null;
      return {
        key: pickKeys[bestI],
        rank: pickRanks[bestI],
        ndcX: pickNdc[bestI * 2],
        ndcY: pickNdc[bestI * 2 + 1],
      };
    },

    debug() {
      // The fragment's own expression, over the bytes the GPU is sampling. Only texels inside the
      // solved grid are considered: `rebuild` zero-fills the rest, and a zeroed texel is UNKNOWN
      // (`known = 0 → aVeil = 0`), so including them would only ever dilute the maximum.
      const n = built ? built.n : 0;
      const stride = SCORE_TEX_N * 2;
      const gClasses: Record<string, number> = {};
      let maxVeil = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const o = j * stride + i * 2;
          const t = scoreData[o] / 255;
          const g = scoreData[o + 1] / 255;
          const key = String(scoreData[o + 1]);
          gClasses[key] = (gClasses[key] ?? 0) + 1;
          const known = g < STAND_THRESHOLDS[0] ? 0 : 1;
          const scored = g < STAND_THRESHOLDS[1] ? 0 : 1;
          const aVeilS = BESTSPOT.veilMax - (BESTSPOT.veilMax - BESTSPOT.veilMin) * t;
          const aVeil = known * (scored ? aVeilS : BESTSPOT.veilMax);
          if (aVeil > maxVeil) maxVeil = aVeil;
        }
      }
      return {
        visible: group.visible,
        fade,
        material: {
          depthTest: sheetMat.depthTest,
          depthWrite: sheetMat.depthWrite,
          transparent: sheetMat.transparent,
          premultipliedAlpha: sheetMat.premultipliedAlpha,
          blending: sheetMat.blending as number,
          polygonOffset: sheetMat.polygonOffset,
          polygonOffsetFactor: sheetMat.polygonOffsetFactor,
          polygonOffsetUnits: sheetMat.polygonOffsetUnits,
        },
        scoreTex: {
          width: scoreTex.image.width,
          height: scoreTex.image.height,
          colorSpace: scoreTex.colorSpace,
          magFilter: scoreTex.magFilter as number,
          minFilter: scoreTex.minFilter as number,
          generateMipmaps: scoreTex.generateMipmaps,
          unpackAlignment: scoreTex.unpackAlignment,
        },
        lutTex: {
          width: lutTex.image.width,
          colorSpace: lutTex.colorSpace,
          magFilter: lutTex.magFilter as number,
          minFilter: lutTex.minFilter as number,
        },
        renderOrder: [sheet, plumb, markers, chip].map((o) => ({
          name: o.name,
          renderOrder: o.renderOrder,
          frustumCulled: o.frustumCulled,
        })),
        uniforms: {
          gridN: sheetMat.uniforms.uGridN.value as number,
          cellM: sheetMat.uniforms.uCellM.value as number,
          radiusM: sheetMat.uniforms.uRadiusM.value as number,
          fade: sheetMat.uniforms.uFade.value as number,
        },
        maxVeil,
        gClasses,
      };
    },

    dispose() {
      sheetGeo.dispose();
      sheetMat.dispose();
      scoreTex.dispose();
      lutTex.dispose();
      plumbGeo.dispose();
      plumbMat.dispose();
      markerGeo.dispose();
      markerMat.dispose();
      digits?.dispose();
      chipGeo.dispose();
      chipMat.map?.dispose();
      chipMat.dispose();
      scene.remove(group);
    },
  };
}
