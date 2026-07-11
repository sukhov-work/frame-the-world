/**
 * Camera pose + optics fields shared by every pin shape (B9). The same 11 nullable fields appear on
 * the private Photos row (SavePinBody), the owner list row (PhotoListItem), the public row's client
 * shape (PublicPin) and a re-opened saved-pin view (SavedPinView, as `Partial`). Orientation/optics
 * are NOT location — C6 governs coordinates only, so these travel on public records too.
 */
export interface CameraPoseOptics {
  altitudeM: number | null;
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  focalLengthMm: number | null;
  hFovDeg: number | null;
  textureWidth: number | null;
  textureHeight: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
}
