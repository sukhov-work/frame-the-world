/**
 * Resolved design-token cache for the 2D CANVAS surfaces (audit #3 A1-11 / T38, 2026-08-22).
 *
 * A 2D canvas cannot take `var(--color-accent)` as a fill style — it needs a concrete colour
 * string — so the minimap radar and the expanded chart both resolved their ink with
 * `getComputedStyle(canvas).getPropertyValue(...)` INSIDE their paint. `getComputedStyle` on a
 * live element forces a style recalculation, and the two surfaces repaint at ~20 Hz with 8 and 4
 * lookups respectively: ~320 forced style reads a second for values that never change.
 *
 * Every token this cache serves is declared on `:root` in `styles/tokens.css`, so the resolved
 * value is document-global — keying the cache on the property name alone is correct, and the
 * element argument only picks the document to resolve against. `lib/theme/tokens.ts` (the GL
 * bridge) carries the same palette as literals, but the canvas surfaces deliberately read the
 * CSS so DOM chrome and canvas ink cannot drift; this keeps that property and drops the cost.
 *
 * This is the `scene/streetNames` idiom (it resolves `--font-ui` once at attach) generalised so
 * both radars share ONE cache, with the invalidation seam streetNames never needed.
 */

const cache = new Map<string, string>();

/**
 * Drop every resolved value. NOTHING in the app calls this today — there is no theme switcher
 * and `tokens.css` ships one `:root` block — but a cache with no invalidation path is exactly
 * how a future theme flip would ship a stale-ink bug, so the seam exists and is named. Any code
 * that swaps a stylesheet or flips a theme attribute must call it.
 */
export function invalidateCssInk(): void {
  cache.clear();
}

/** Number of tokens currently memoised — the positive control for the cache's own tests. */
export function cssInkSize(): number {
  return cache.size;
}

/**
 * Resolve a `--custom-property` against `el`'s document once and reuse it forever (until
 * `invalidateCssInk`). `fallback` covers SSR/jsdom and a property that resolves empty — an
 * empty fill style silently paints black, so callers that need a visible stroke pass one.
 */
export function cssInk(el: Element, name: string, fallback = ""): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const raw =
    typeof getComputedStyle === "function" ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  const value = raw || fallback;
  cache.set(name, value);
  return value;
}

/** The resolved UI font family, for `ctx.font` (a canvas font string can't hold a `var()`). */
export function cssFontFamily(el: Element, fallback = "sans-serif"): string {
  const hit = cache.get("@font-family");
  if (hit !== undefined) return hit;
  const raw = typeof getComputedStyle === "function" ? getComputedStyle(el).fontFamily : "";
  const value = raw || fallback;
  cache.set("@font-family", value);
  return value;
}
