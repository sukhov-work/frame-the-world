/**
 * Rendered-terrain height sanity clamp (extracted in the pre-S7 refactor, B6).
 *
 * Quantized-mesh terrain tiles return NEGATIVE elevations while loading / on coarse LOD, and there
 * is no real ground above Everest — so EVERY consumer of a live `heightAt` sample clamps it to
 * `[0, MAX_TERRAIN_M]` (clamp-only-upward). Unclamped, an arrival sinks to its lookAt floor and an
 * underground camera unloads the whole tileset (DECISIONS § Traps & Gotchas / "Negative heightAt
 * garbage"). This was inline at ~7 orchestrator call sites before; one tested helper now owns it.
 */

/** Everest-plausible ceiling (m above the ellipsoid) — coarse-tile garbage never exceeds real ground. */
export const MAX_TERRAIN_M = 9_000;

/** Clamp a raw terrain-height sample to a plausible `[0, MAX_TERRAIN_M]` range (clamp-only-upward). */
export function clampGroundM(heightM: number): number {
  return Math.min(Math.max(heightM, 0), MAX_TERRAIN_M);
}

/**
 * Normalize a LIVE sampler answer for consumers that latch "resolved" ground (2026-08-13 audit A1).
 * `real` means "safe to stop re-sampling": a missing sample falls back, and an out-of-range finite
 * sample is loading-phase / coarse-LOD garbage — usable after the clamp for placement, but NOT real,
 * so a resnap loop keeps refining it until the tile answer lands in range.
 */
export function sampleGroundM(
  raw: number | null | undefined,
  fallbackM: number,
): { h: number; real: boolean } {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) {
    return { h: fallbackM, real: false };
  }
  const clamped = clampGroundM(raw);
  return { h: clamped, real: clamped === raw };
}

/**
 * A GROUND SEAT (T195, 2026-10-24): the height a consumer stood its anchor on, whether that answer
 * was real (`sampleGroundM`'s latch), and the DEPTH of the terrain tile it came from (`-1` unknown —
 * a plain `heightAt` sampler, or a raycast whose tile depth was not stamped).
 *
 * Why the depth: `real` only says the answer was in range — a coarse tile answers in range too, and a
 * seat latched on it stays wrong after the camera descends and the tile refines (the saved-place pins
 * stood 4–9 m above the street after a 60 km boot, drifting by parallax in orbit and floating in
 * FPV — the owner's T195). `refineGroundSeat` is the rule a low-cadence resnap applies to EVERY
 * anchor, grounded or not: an unreal seat takes any finite answer; a real seat moves only to a
 * STRICTLY DEEPER (finer) tile — a coarser answer after the fine tile was disposed (the camera left)
 * never regresses it, and an equal-depth re-ask is the same raycast on the same tile.
 */
export interface GroundSeat {
  /** The seated ground height (m above the ellipsoid; clamped). */
  h: number;
  /** `sampleGroundM`'s latch — false while the answer is missing or out of range. */
  real: boolean;
  /** The terrain tile depth the answer came from; `-1` = unknown. */
  depth: number;
}

/**
 * Apply one sampler answer to a seat. `sample` is `{ h, depth }` (the ground module's `sampleAt`), a
 * bare height (a `heightAt` sampler — depth unknown), or null / undefined (no tile yet).
 * Returns the seat to hold and whether its height MOVED (the caller re-places its anchor on `moved`).
 */
export function refineGroundSeat(
  prev: GroundSeat | null,
  sample: { h: number; depth: number } | number | null | undefined,
  fallbackM: number,
): { seat: GroundSeat; moved: boolean } {
  const raw = typeof sample === "number" ? sample : sample?.h;
  const depth = typeof sample === "object" && sample !== null && Number.isFinite(sample.depth) ? sample.depth : -1;
  const { h, real } = sampleGroundM(raw, fallbackM);
  if (prev === null) return { seat: { h, real, depth: real ? depth : -1 }, moved: true };
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return { seat: prev, moved: false }; // no tile — hold
  if (prev.real && depth <= prev.depth) return { seat: prev, moved: false }; // a coarser / equal tile never moves a real seat
  if (prev.real && !real) return { seat: prev, moved: false }; // deeper but out of range — garbage, hold
  return { seat: { h, real, depth: real ? depth : -1 }, moved: h !== prev.h || real !== prev.real };
}
