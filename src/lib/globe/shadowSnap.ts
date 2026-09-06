/**
 * SHADOW RIG STABILITY — the pure half of T77 slice A2 (the texel grid, in float64).
 *
 * THE MEASURED DEFECT (T77 MEASURE, `rendering/MEASUREMENTS_2026-09-05.md` §8). With the CAMERA
 * FROZEN and only the sun scrubbed 2,000 scene-ms per frame, 8–19 % of the screen-space shadow
 * mask flips EVERY frame at the shipped poses (FPV base churn p50 **0.185**, city ULTRA 0.116,
 * Everest 0.077), and 62–75 % of those flips are ISOLATED pixels. The frozen-sun control leg is
 * bit-identical (max churn 0.00000 over 239 frames), so the metric has no noise floor and the
 * churn is real. Two facts locate it:
 *
 *  · **It is not the shadow moving.** 0.0082° of sun per frame moves a true shadow edge ~0.0009
 *    texel at the base rig's 2.44 m/texel — three orders of magnitude below one pixel of flip.
 *  · **It is not the box.** `fitShadowBox` is a pure function of `(altM, viewDistM, profile)`;
 *    the sun is not an input, and every stored leg reports `boundsSteps` 0 at a frozen camera.
 *
 * What actually moves is the LIGHT-SPACE BASIS. `sunLight.position` is re-placed along the sun
 * direction every frame (`StylizedTiles.ts` sun/moon arms), three's `LightShadow.updateMatrices`
 * then does `shadowCamera.lookAt(target)` (`LightShadow.js:206-213`), and the whole texel grid
 * re-projects: at the box edge (b = 5,000 m, 4096², w = 2.44 m) that same 0.0082° sweeps the grid
 * **0.29 texel per frame**. Every flipped pixel is a re-rasterisation of an unchanged scene from a
 * new sub-texel offset — plus the float32 shadow-coordinate rounding at ECEF magnitudes (~0.2–0.4
 * texel), which is why the flips are speckle rather than an edge.
 *
 * This module is the arithmetic that lets the rig STOP re-projecting. Two quanta and one snap:
 *
 *  1. `keySwingQuantumRad` — how far the key direction may swing before the grid has moved a
 *     texel worth caring about. Below it the light is not re-placed at all, so the basis, the
 *     matrix and the map all stay exactly as they were rendered.
 *  2. `snapCentreDelta` — when the rig DOES refresh, land it on a world-anchored texel lattice, so
 *     the offset the map is rasterised from is reproducible instead of arbitrary. This is the
 *     classic centre snap, done in the LIGHT'S OWN frame.
 *  3. `rigDemandDriven` — the off-edge. Both quanta at 0 is the identity (today's behaviour), and
 *     the identity must not merely *behave* like the shipped rig, it must take the shipped code
 *     path: `shadow.autoUpdate` back to `true`, no demand record consulted.
 *
 * WHY FLOAT64, STATED BECAUSE IT IS THE WHOLE REASON THIS IS A MODULE. The snap divides a world
 * coordinate (~6.4e6 m at the ellipsoid) by a texel width (~2.4 m) and rounds — ~2.6e6, which
 * float64 holds exactly and float32 does not resolve at all (its ULP at 6.4e6 is 0.5 m ≈ 0.2
 * texel, i.e. the very quantity being snapped away). Doing this on the CPU in JS numbers is the
 * fix; doing it in a shader would reintroduce the error it removes.
 *
 * Pure, three-free, DOM-free — `test/lib/globe/shadowSnap.test.ts` pins the lattice, the
 * in-plane-ness of the delta, idempotence, and the swing ladder.
 */

import { texelSizeM } from "./shadowCascade";

/** A world-space vector as plain numbers — `shadowCascade`/`shadowFit` are three-free and so is this. */
export type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

/**
 * How far (in TEXELS of this rig's own map) the projected grid sweeps when the key direction
 * turns by `dThetaRad`.
 *
 * Taken at the worst point in the box — its corner, `r_max = half·√2` from the centre — because
 * that is where a rotation displaces the most and therefore where the crawl is first visible.
 * Arc ÷ texel width: `(half·√2·dθ) / (2·half/mapPx)`. **The half-extent cancels**, which is the
 * non-obvious and useful part: the rotation crawl is a property of the MAP RESOLUTION alone, so
 * one swing quantum is correct for the street-level box and the 18 km one alike. It is also why
 * the 8192² ULTRA map crawls exactly twice as fast as the 4096² base map for the same sun — more
 * texels means finer texels means more of them cross per degree.
 */
export function swingTexels(dThetaRad: number, _halfM: number, mapPx: number): number {
  return (Math.abs(dThetaRad) * Math.SQRT2 * Math.max(1, mapPx)) / 2;
}

/**
 * The inverse: the key-direction swing (rad) worth `texels` of grid motion at the box corner.
 * `texels ≤ 0` returns 0 — the "follow the sun every frame" identity, and the caller reads that 0
 * as "not demand-driven" rather than as "an infinitely tight quantum".
 */
export function keySwingQuantumRad(texels: number, mapPx: number): number {
  if (!(texels > 0)) return 0;
  return (texels * Math.SQRT2) / Math.max(1, mapPx);
}

/**
 * The world-space delta that puts the shadow rig on a world-anchored texel lattice.
 *
 * The basis is three's, not ours — `Matrix4.lookAt(eye, target, up)` as `Object3D.lookAt` calls it
 * from `LightShadow.updateMatrices`, so the grid this snaps to is the grid the depth pass will
 * actually rasterise into:
 *
 *   ẑ = normalize(lightPos − target) · x̂ = normalize(up × ẑ) · ŷ = ẑ × x̂
 *
 * The shadow camera sits AT `lightPos`, so light-space coordinates are measured from there and one
 * texel is `w = 2·half/mapPx` wide in both in-plane axes. Rounding `lightPos·x̂` and `lightPos·ŷ`
 * to multiples of `w` anchors the lattice to the WORLD ORIGIN — a reference that does not move
 * when the camera does, which is the property that makes two refreshes at the same pose produce
 * the same rasterisation instead of two arbitrary sub-texel offsets.
 *
 * The returned delta is applied to the light AND its target together, by contract: it is purely
 * in-plane (`Δ·ẑ = 0` by construction, pinned by the test), so moving both leaves the DIRECTION
 * untouched and slides the box sideways by whole texels. Moving only the light would rotate the
 * key — a shadow that swings when the camera walks.
 *
 * DEGENERATE `up`. When `up` is parallel to the key direction, `up × ẑ` collapses and the basis is
 * undefined; three's own `lookAt` papers over it by nudging the target. Here the honest answer is
 * a **zero delta**: no snap this frame, rather than a snap onto a basis that will flip 180° as the
 * cross product changes sign. With the default ECEF +Y up that is the subsolar point near 0°N 90°E
 * (and its antipode) — rare, real, and the reason A3's `SHADOWS.rigLocalUp` exists at all.
 */
export function snapCentreDelta(
  lightPos: Vec3,
  target: Vec3,
  up: Vec3,
  halfM: number,
  mapPx: number,
): Vec3 {
  const zRaw: Vec3 = [lightPos[0] - target[0], lightPos[1] - target[1], lightPos[2] - target[2]];
  const zLen = len(zRaw);
  if (!(zLen > 0)) return [0, 0, 0]; // light sitting on its own target — no basis at all
  const z: Vec3 = [zRaw[0] / zLen, zRaw[1] / zLen, zRaw[2] / zLen];
  const xRaw = cross(up, z);
  const xLen = len(xRaw);
  // ~1e-9 of a unit cross is ~0.00000006° of separation; below it the basis is noise.
  if (!(xLen > 1e-9)) return [0, 0, 0];
  const x: Vec3 = [xRaw[0] / xLen, xRaw[1] / xLen, xRaw[2] / xLen];
  const y = cross(z, x); // unit by construction (z ⟂ x, both unit)
  const w = texelSizeM(halfM, mapPx);
  if (!(w > 0)) return [0, 0, 0];
  const px = dot(lightPos, x);
  const py = dot(lightPos, y);
  const dx = Math.round(px / w) * w - px;
  const dy = Math.round(py / w) * w - py;
  return [dx * x[0] + dy * y[0], dx * x[1] + dy * y[1], dx * x[2] + dy * y[2]];
}

/**
 * Is the rig demand-driven at all?
 *
 * The off-edge, and it is deliberately a named predicate rather than an inline `> 0`: the law this
 * slice ships under is that `high` stays byte-identical unless the owner rules otherwise, so BOTH
 * quanta at 0 must put `sunLight.shadow.autoUpdate` back to `true` and take three's shipped
 * every-frame path — not merely produce a refresh predicate that happens to answer true. A rig
 * left on the demand path with a zero quantum would still differ from the identity on the one
 * frame where nothing at all moved (the predicate would fall through to the staleness net).
 */
export function rigDemandDriven(keySnapTexels: number, moveTexels: number): boolean {
  return keySnapTexels > 0 || moveTexels > 0;
}

/**
 * A3 — is the requested rig `up` too close to the key direction to build a basis from?
 *
 * `shadow.camera.up` is what three's `lookAt` crosses with the light direction, so an `up` within
 * `maxAbsDot` of parallel gives a degenerate (and sign-unstable) x̂. The caller falls back to local
 * north. Expressed on the DOT rather than on an angle because the caller already has
 * `sunDirW · focusUp` in hand — the same number every ULTRA band curve is keyed on.
 */
export function rigUpDegenerate(keyDotUp: number, maxAbsDot = 0.99): boolean {
  return !(Math.abs(keyDotUp) < maxAbsDot);
}
