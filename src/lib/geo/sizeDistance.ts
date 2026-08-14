// Sun/moon size→distance (QoL-3 R9, PLANNING_QOL_PLAN §1.1, owner 2026-08-14): the telephoto-
// alignment essence — how far from a subject must the camera stand for the body's disc to span
// it (and the inverse). Pure small-angle-free trig on the TRUE apparent diameter.

/** Distance (m) at which a subject of `subjectHeightM` exactly spans a disc of
 *  `angularDiamRad` — stand HERE and the moon rises exactly behind the subject's height. */
export function subjectDistanceForDiscMatch(
  subjectHeightM: number,
  angularDiamRad: number,
): number {
  return subjectHeightM / (2 * Math.tan(angularDiamRad / 2));
}

/** Subject height (m) the disc spans when the camera stands `distanceM` away. */
export function subjectHeightMatchingDisc(distanceM: number, angularDiamRad: number): number {
  return 2 * distanceM * Math.tan(angularDiamRad / 2);
}
