/**
 * THE aim anchor — one ladder, three radar surfaces (audit #3 A1-6 / A2-1 → T36, 2026-08-22).
 *
 * The radar bands, the rise/set spokes, the direction lines and the focal cone are all seated on
 * a single geodetic point: "the eye this planning instrument is about". It shipped as three
 * hand-written ladders that had DIVERGED, which two audit tracks found independently:
 *
 *   GL fan   (StylizedTiles.stepAimCones): placement → tempPin → view focus
 *   chart    (panels/MapWindow):           (fpv ? camGeo) → tempPin → camGeo → view focus
 *   mini-map (panels/MiniMap):             camGeo
 *
 * Two real defects fell out of the chart's copy:
 *   • **no placed-photo rung** — a placed photo owns the GL radar but not the chart's, so the
 *     two instruments disagreed about the same shot;
 *   • **a bare `camGeo` rung ahead of the focus** — `camGeo` is the camera NADIR, not a viewer,
 *     so outside FPV the chart seated its radar kilometres from the view focus at any tilt, and
 *     the `focusLatDeg` tail below it became dead code.
 * The refutation ("you can only see the chart while FPV is live, so the outside-FPV rungs never
 * run") was ATTEMPTED AND FAILED: the orchestrator's only `setMapWindowOpen(false)` is the
 * Escape handler, so leaving FPV by any other route keeps the chart open and the divergence live.
 *
 * The unified ladder below is each surface's own shipped behaviour where the owner ruled on it,
 * and the GL contract everywhere else:
 *
 *   1. **FPV live → the walked eye (`camGeo`)** — owner QA 2026-08-21 item 1: while you are
 *      standing in the scene, radar, cone and eye dot are ONE point and never detach. Inert on
 *      the GL fan (it is `enabled: !fpvActive`) and the only rung the mini-map ever reaches
 *      (it mounts only inside FPV) — so this rung unifies rather than changes those two.
 *   2. **a PLACED photo** — the shot being planned outranks a scratch pin (the GL rule).
 *   3. **the temp pin** — owner batch #6 item 1: outside FPV a placed point owns the radar.
 *   4. **the view focus** — what the camera is actually looking at. Never the nadir.
 *
 * Pure: no three, no DOM, no stores. Callers pass mirrors they already hold.
 */

export interface GeoPoint {
  latDeg: number;
  lonDeg: number;
}

export interface AimAnchorSources {
  /** Is an FPV session live on this surface? (`fpvActive` in the orchestrator, `cam.fpvHud` in
   *  the panels — the store mirror of the same latch.) */
  fpvActive: boolean;
  /** The live viewer ground point. NOTE: this is the camera NADIR outside FPV — it is only a
   *  viewer while `fpvActive`, which is why it appears at exactly one rung. */
  camGeo: GeoPoint | null;
  /** The placed photo's ground point — pass `null` unless the upload phase is `"placed"`. */
  placement: GeoPoint | null;
  /** The scratch pin (double-click / long-press). */
  tempPin: GeoPoint | null;
  /** The point the camera looks at on the globe. Always defined, so the ladder always lands. */
  focus: GeoPoint;
}

export function aimAnchorFor(s: AimAnchorSources): GeoPoint {
  return (s.fpvActive ? s.camGeo : null) ?? s.placement ?? s.tempPin ?? s.focus;
}
