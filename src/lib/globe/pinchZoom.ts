/**
 * THE FINGER-PROPORTIONAL PINCH (owner 2026-09-16: "pinch zoom ... should be almost linear and
 * natural with fingers proportional movement, i have a feeling that you use some multiplier").
 *
 * The feeling was right. `3d-tiles-renderer@0.4.28`'s touch pinch is a PIXEL delta: every
 * pointermove adds `pointerDist − previousDist` (CSS px) to `zoomDelta`, and `_updateZoom` then
 * moves the camera toward the pinch point by `zoomDelta · dist · zoomSpeed · 0.0025` — i.e. each
 * pixel of finger spread shrinks the camera→ground distance by a FIXED fraction (1.25 % at
 * `CONTROLS.zoomSpeed` 5) regardless of how far apart the fingers already are. Spreading from
 * 120 to 220 px zooms the /m 2D map ≈ 2.9× (the 0.85 brake) where a finger-glued map would
 * zoom 1.83×; from a 60 px start the same 100 px zooms the SAME 2.9× while the fingers asked
 * for 2.7× — the multiplier the owner felt, and the small-spread runaway on top of it.
 *
 * The fix keeps the library's mover and re-derives its input: each frame the orchestrator reads
 * the accumulated pixel delta, recovers the finger-distance RATIO it came from, and hands the
 * library exactly the linear delta that makes its multiply equal `(dPrev/dNow)^gain` — applied
 * THAT frame (never through the wheel's eased bank: `_updateZoom` drops whatever arrives after
 * the last finger lifts). Frame factors compose, so the whole gesture lands the camera→ground
 * distance at `(d0 / d1)^gain` — gain 1 = the map is glued to the fingers (iOS Maps), below 1 =
 * calmer than the fingers. Wheel/trackpad zoom keeps the old pixel path (a wheel has no finger
 * ratio); the FPV lens pinch is its own ratio-exact code.
 *
 * Pure and three-free; the shapes are source-pinned in `test/lib/globe/pinchZoom.test.ts`.
 */

/** The library's per-delta distance fraction (`EnvironmentControls._updateZoom`: `scale * dist *
 *  zoomSpeed * 0.0025`) — the ONE constant this conversion has to know. */
export const LIB_ZOOM_K = 0.0025;

/**
 * This frame's pinch as a LOG ratio from the tracker's OWN two distances: `dNowPx` = the live
 * finger distance, `dPrevPx` = the distance at the end of the previous frame
 * (`PointerTracker.getPreviousTouchPointerDistance` — `updateFrame()` copies current → previous
 * ONCE per `update()`, at its end). Positive = fingers spreading = zoom in. 0 for a degenerate
 * pair (a distance at or under zero — a coincident pair, or the frame before the pair formed).
 *
 * NOT the library's accumulated `zoomDelta`: that sum adds `dist − previousDist` per EVENT while
 * `previousDist` only moves per FRAME, so k touch events in one frame count the frame's spread
 * ~(k+1)/2 times over — on a 120 Hz phone rendering at 60 fps the stock pinch zooms ~1.5× more per
 * pixel than on a 60 Hz one (the twin read gain 1.02 for a 0.75 request through that sum). The
 * two tracker distances are frame-exact whatever the event rate.
 */
export function pinchLogDelta(dNowPx: number, dPrevPx: number, gain: number): number {
  if (!(dNowPx > 0) || !(dPrevPx > 0) || dNowPx === dPrevPx) return 0;
  return gain * Math.log(dNowPx / dPrevPx);
}

/**
 * The linear `zoomDelta` that makes the library's `dist · (1 − zoomDelta · zoomSpeed · K)` equal
 * `dist · exp(−logStep)` — so a banked log step lands as an EXACT distance ratio whatever the
 * frame's braked `zoomSpeed` is. Zoom-out (`logStep < 0`) falls out of the same identity with a
 * negative delta (the library's own sign convention).
 */
export function libraryDeltaForLog(logStep: number, zoomSpeed: number): number {
  if (logStep === 0 || !(zoomSpeed > 0)) return 0;
  return (1 - Math.exp(-logStep)) / (zoomSpeed * LIB_ZOOM_K);
}
