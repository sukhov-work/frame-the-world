/**
 * THE PIN FOLLOWS THE WALKER (owner 2026-09-30). In a temp-pin first-person view the walker used
 * to leave the pin behind: the chart showed a dot for the eye and a ring for the pin at the point
 * the walk started from, and the only way to bring the pin along was a long-press near (never
 * exactly on) where one stood. The pin now moves onto the eye — when the walk SETTLES, not per
 * frame: a pin change is a store write every subscriber repaints on.
 *
 * The rule, pure so it can be pinned without a browser: the eye has left the pin by at least
 * `minM` (horizontal metres — dust and a brushed stick are not a walk) AND no walk input has
 * arrived for `settleMs`. The orchestrator (`StylizedTiles.followPinToEye`) owns the re-base.
 */
export function pinFollowDue(walkM: number, idleMs: number, minM: number, settleMs: number): boolean {
  if (!Number.isFinite(walkM) || !Number.isFinite(idleMs)) return false;
  return walkM >= minM && idleMs >= settleMs;
}
