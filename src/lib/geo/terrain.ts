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
