/**
 * Pointer client-px ↔ WebGL NDC conversions (extracted in the pre-S7 refactor, B6).
 *
 * The globe orchestrator turns pointer events into normalized device coordinates for raycasting,
 * and projects world points back to client px to float HTML cards next to them. Both directions
 * lived inline at ~6 call sites. Pure — takes a DOMRect-like `{ left, top, width, height }`.
 *
 * NDC: x, y ∈ [-1, 1], origin at the viewport CENTRE, +y UP (WebGL convention — note the y flip vs
 * client px, where +y is DOWN).
 */

/** The rectangle fields we need from a `DOMRect` (so callers can pass a `getBoundingClientRect()`). */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pointer client px → NDC `[x, y]` (y flipped: client +y down → NDC +y up). */
export function clientToNdc(clientX: number, clientY: number, rect: ViewRect): [number, number] {
  return [
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  ];
}

/** NDC `[x, y]` → rounded client px `{ x, y }` (inverse of `clientToNdc`). */
export function ndcToClient(ndcX: number, ndcY: number, rect: ViewRect): { x: number; y: number } {
  return {
    x: Math.round(rect.left + ((ndcX + 1) / 2) * rect.width),
    y: Math.round(rect.top + ((1 - ndcY) / 2) * rect.height),
  };
}
