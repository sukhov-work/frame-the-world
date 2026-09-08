/**
 * twistTracker — the two-finger TWIST on the globe canvas (owner 2026-09-08b), pure and
 * three-free so the DOM-less vitest pins it.
 *
 * WHY THIS EXISTS. `3d-tiles-renderer`'s `EnvironmentControls` classifies a two-finger touch
 * gesture ONCE, on its first move past ~2 px·DPR, as either ZOOM (the separation changed) or
 * ROTATE (the MIDPOINT translated — a parallel drag), and it never measures the angle between the
 * fingers (`PointerTracker` has no `atan2`). A rigid twist — two fingers turning about their own
 * midpoint — moves neither the separation nor the midpoint, so the library sits in WAITING and
 * nothing happens; a human twist drifts a little, lands in ZOOM (5× amplified by the repo's
 * `zoomSpeed`) or in ROTATE, whose azimuth is `−(midpoint drift)` — the orbit convention, which
 * reads INVERTED against the fingers. That is the owner's Pixel report verbatim: unresponsive,
 * zooms instead, or turns the wrong way.
 *
 * WHAT THIS DOES. Tracks the touch pointers on the canvas, and while exactly two are down
 * accumulates the UNWRAPPED inter-pointer angle since the pair formed (screen space, y-down:
 * clockwise-positive). Past `armRad` of accumulated twist the gesture is ARMED and the
 * orchestrator's `stepTouchTwist` applies the angle 1:1 about the library's own pivot (the
 * midpoint's ground hit — the library raycasts it when the second finger lands) with the
 * world-follows-fingers sign, and cancels the library's midpoint-drift azimuth for the same
 * frame. The first `take()` after arming returns the whole accumulated angle, so the map
 * catches up to the fingers instead of trailing them by the threshold (the MapWindow chart's
 * absolute-angle idiom, `MapWindow.tsx` item 4b). Pinch and twist COMPOSE: the library keeps
 * the zoom, this owns the heading.
 */

export interface TwistTracker {
  /** A pointer landed. Non-touch pointers are ignored (a mouse cannot twist). */
  down(id: number, x: number, y: number, pointerType: string): void;
  move(id: number, x: number, y: number): void;
  /** A pointer lifted or was cancelled. Returns true when the gesture that just ENDED had armed —
   *  the caller zeroes the library's rotation inertia so no midpoint-drift coast follows. */
  up(id: number): boolean;
  /** Angle (rad, clockwise-positive) accumulated since the last take; 0 unless armed. */
  take(): number;
  /** Two touch pointers down and the twist has passed the arming threshold. */
  live(): boolean;
  /** Two touch pointers down (armed or not). */
  pairDown(): boolean;
  reset(): void;
}

/** Wrap an angle delta to (−π, π]. */
export function wrapDelta(d: number): number {
  let w = d;
  while (w > Math.PI) w -= 2 * Math.PI;
  while (w <= -Math.PI) w += 2 * Math.PI;
  return w;
}

export function createTwistTracker(armRad: number): TwistTracker {
  const pts = new Map<number, { x: number; y: number }>();
  let pair: [number, number] | null = null;
  let lastAngle = 0;
  let accum = 0; // unwrapped twist since the pair formed
  let taken = 0; // delivered through take()
  let armed = false;

  const angle = (): number => {
    const a = pts.get(pair![0])!;
    const b = pts.get(pair![1])!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const begin = (): void => {
    const ids = [...pts.keys()];
    pair = [ids[0], ids[1]];
    lastAngle = angle();
    accum = 0;
    taken = 0;
    armed = false;
  };
  const end = (): boolean => {
    const was = armed;
    pair = null;
    accum = 0;
    taken = 0;
    armed = false;
    return was;
  };

  return {
    down(id, x, y, pointerType) {
      if (pointerType !== "touch") return;
      pts.set(id, { x, y });
      if (pts.size === 2) begin();
      else if (pts.size > 2) end(); // three fingers is not a twist; the library resets too
    },
    move(id, x, y) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      if (!pair || (id !== pair[0] && id !== pair[1])) return;
      const a = angle();
      accum += wrapDelta(a - lastAngle);
      lastAngle = a;
      if (!armed && Math.abs(accum) >= armRad) armed = true;
    },
    up(id) {
      if (!pts.delete(id)) return false;
      if (pair && (id === pair[0] || id === pair[1])) return end();
      if (pts.size === 2) begin(); // a third finger left: the remaining two start fresh
      return false;
    },
    take() {
      if (!armed) return 0;
      const d = accum - taken;
      taken = accum;
      return d;
    },
    live: () => armed && pair !== null,
    pairDown: () => pair !== null,
    reset() {
      pts.clear();
      end();
    },
  };
}
