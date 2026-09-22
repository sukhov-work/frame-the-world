/**
 * Camera-space direction → CSS-pixel screen point for a symmetric pinhole camera (owner order
 * 2026-09-22 item 3 — the AR guides drawn ABOVE the camera feed must land on the same pixel the
 * GL impostor would). Pure and three-free: the caller hands over the direction already rotated
 * into camera space (three's convention: the camera looks down −z, +y is up, +x is right).
 *
 * `tanHalfV` = tan(vFov / 2), `aspect` = W / H — the same pair `frameMarker` (lib/sky/frameMarker)
 * uses for the edge chips, so a body the chips call "in frame" projects inside the viewport here.
 * Unit-pinned in `test/lib/sky/screenProject.test.ts`.
 */
export interface ScreenPoint {
  /** CSS px from the viewport's top-left. */
  x: number;
  y: number;
  /** Inside the viewport (with the caller's margin). */
  inView: boolean;
  /** In FRONT of the camera (a direction behind it has no screen point — x/y are extrapolated). */
  front: boolean;
}

export function projectCameraDir(
  cx: number,
  cy: number,
  cz: number,
  tanHalfV: number,
  aspect: number,
  viewW: number,
  viewH: number,
  marginPx = 0,
  out: ScreenPoint = { x: 0, y: 0, inView: false, front: false },
): ScreenPoint {
  // Depth along the look axis; behind the camera the tangent flips sign, so keep the point on
  // the same side of the centre as the direction (the arcs then leave the screen the right way).
  const depth = -cz;
  const front = depth > 1e-6;
  const d = Math.max(Math.abs(depth), 1e-6);
  const nx = cx / d / (tanHalfV * aspect);
  const ny = cy / d / tanHalfV;
  out.x = ((nx + 1) / 2) * viewW;
  out.y = ((1 - ny) / 2) * viewH;
  out.front = front;
  out.inView =
    front && out.x >= -marginPx && out.x <= viewW + marginPx && out.y >= -marginPx && out.y <= viewH + marginPx;
  return out;
}
