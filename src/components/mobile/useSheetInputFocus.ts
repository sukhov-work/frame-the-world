import { useLayoutEffect, type RefObject } from "react";

/**
 * Focus an input that lives inside a sliding `/m` SHEET, without the iOS dark-screen trap
 * (owner QA 2026-08-21 → extracted by audit #3 A1-9, 2026-08-22).
 *
 * THE TRAP. A sheet mounts at `translateY(100%)` and slides in over `m-sheet-in` (400 ms). If
 * an input inside it takes focus during that window — React's `autoFocus` fires on commit,
 * which is exactly then — iOS Safari scrolls the LAYOUT viewport to reveal an element that is
 * still off-screen. The user is left staring at a dark scrim with a keyboard up until they tap.
 * Android only resizes the VISUAL viewport, which is why this reads as "fine on Android".
 *
 * THE FIX, in three parts, all load-bearing:
 *  1. focus in the SAME discrete-event commit, so the user activation still carries and the
 *     keyboard opens at all — hence `useLayoutEffect`, not a timeout;
 *  2. `{ preventScroll: true }`, so the focus itself cannot scroll the layout viewport;
 *  3. pin `scrollY` at 0 across the slide-in AND the keyboard settle — a rAF, a timeout past
 *     the 400 ms animation, and every `visualViewport` resize. The `/m` shell is a 100dvh app
 *     surface, so layout `scrollY` must always be 0 and the reset can never misfire.
 *
 * A1-9 found the same trap still armed in two SIBLINGS of the fixed one: `SceneActions`'s SAVE
 * VIEW name field used React `autoFocus` inside the same sheet, and `MobileSearch`'s mode
 * switch re-focused with a bare `focus()`. Both go through here now.
 *
 * @param ref    the input to focus
 * @param active pass `false` to skip (e.g. the element is conditionally rendered by a parent
 *               that always calls the hook — hooks cannot be conditional).
 */
export function useSheetInputFocus(
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  useLayoutEffect(() => {
    if (!active) return;
    focusInSheet(ref.current);
    const reset = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const raf = requestAnimationFrame(reset);
    const timer = window.setTimeout(reset, 550); // m-sheet-in is 400ms; the keyboard lags it
    window.visualViewport?.addEventListener("resize", reset);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.visualViewport?.removeEventListener("resize", reset);
    };
  }, [ref, active]);
}

/**
 * The imperative half — for a RE-focus that happens after mount (a mode switch, a clear
 * button). Same `preventScroll` rule: the sheet may still be animating, and a bare `focus()`
 * re-arms the trap. Safe with `null`.
 */
export function focusInSheet(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}
