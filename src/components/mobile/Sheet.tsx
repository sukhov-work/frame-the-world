/**
 * Sheet (M1) — the bottom-sheet container every mobile surface rides in (MOBILE_PLAN §3:
 * "chrome = bottom tab bar + swipeable bottom sheets; never fixed side panels"). The head is
 * the drag handle: pull down past the dismiss threshold to close; the scrim tap closes too.
 *
 * S2 containing-block discipline: the backdrop-filter sits on the sheet SURFACE only — no
 * position:fixed element ever lives under a filtered ancestor (m-sheetroot is the fixed layer
 * and carries no filter).
 *
 * THE KEYBOARD LIFT (owner 2026-10-10, Pixel + iPhone: "the keyboard obscures the actual
 * dialog and input … hard to even understand that something is hiding behind the keyboard").
 * A sheet sits at the BOTTOM of the layout viewport — exactly where the soft keyboard lands.
 * iOS Safari and Android Chrome (its `resizes-visual` default since 108) shrink only the
 * VISUAL viewport, so a bottom-anchored fixed element simply disappears under the keys. Every
 * non-full sheet now rides `bottom: <inset>` — the layout viewport's bottom minus the visual
 * viewport's bottom (`keyboardInsetPx`), re-read on every visualViewport resize / scroll AND
 * polled through every focus change (iOS Safari 26 on the real iPhone sent no resize at all —
 * the farm, 2026-10-10) — clamped so its head never leaves the screen (`sheetLiftPx`). A `full` sheet (SEARCH, GUIDE)
 * keeps its input at the TOP and never lifts. The lift is a `bottom` offset, never a transform:
 * the slide-in animation and the drag both own `transform`. Where a browser resizes the LAYOUT
 * viewport instead, `innerHeight` shrinks with it and the inset reads 0 — no double lift.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import "../../styles/mobile/chrome.css";

const DISMISS_DY_PX = 90;
/** The sheet's head must stay at least this far below the top edge when lifted — the status
 *  strip's band, so a tall sheet over a tall keyboard never pushes its title off the glass. */
export const SHEET_TOP_GUARD_PX = 56;

/**
 * How many CSS px of the layout viewport's bottom the soft keyboard covers — the layout
 * viewport (`innerHeight`, which the fixed sheet root is sized to) minus the visual viewport's
 * bottom edge (`height + offsetTop`). 0 when no keyboard is up, and 0 where the browser resized
 * the layout viewport instead (innerHeight shrank with it). Pure.
 */
export function keyboardInsetPx(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - vvHeight - vvOffsetTop));
}

/**
 * How far a sheet of `sheetHeight` may rise for `insetPx` of keyboard: the inset, but never so
 * far that its head leaves the screen — `innerHeight − sheetHeight − topGuardPx` is the room
 * above it. Never negative. Pure.
 */
export function sheetLiftPx(
  insetPx: number,
  innerHeight: number,
  sheetHeight: number,
  topGuardPx: number,
): number {
  return Math.max(0, Math.min(insetPx, innerHeight - sheetHeight - topGuardPx));
}

/** The focus-driven poll (ms between reads, and how long a burst runs): iOS Safari 26 on the real
 *  iPhone 17 Pro (the Device Farm, 2026-10-10) shrank the visual viewport by 310 px for the
 *  keyboard and NO `resize` reached the listener — the sheet stayed under the keys. The keyboard
 *  follows FOCUS, so a focus change (and the mount — SAVE VIEW focuses its field on open) polls
 *  the viewport through the keyboard's animation; 2.5 s covers a slow one, 120 ms reads smooth. */
export const KEYBOARD_POLL_MS = 120;
export const KEYBOARD_POLL_FOR_MS = 2500;

/** The live lift (CSS px) for a mounted sheet — 0 until a keyboard shrinks the visual viewport. */
function useKeyboardLift(active: boolean, sheetRef: RefObject<HTMLElement | null>): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => {
      const inset = keyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop);
      const h = sheetRef.current?.offsetHeight ?? 0;
      setLift(sheetLiftPx(inset, window.innerHeight, h, SHEET_TOP_GUARD_PX));
    };
    // The events where a browser sends them…
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    // …and the poll where it does not (iOS Safari 26, measured on the farm): a burst of reads after
    // every focus change in the document and one at mount, each burst self-limiting.
    let timer = 0;
    let until = 0;
    const poll = () => {
      measure();
      timer = performance.now() < until ? window.setTimeout(poll, KEYBOARD_POLL_MS) : 0;
    };
    const burst = () => {
      until = performance.now() + KEYBOARD_POLL_FOR_MS;
      if (!timer) timer = window.setTimeout(poll, KEYBOARD_POLL_MS);
    };
    document.addEventListener("focusin", burst);
    document.addEventListener("focusout", burst);
    measure();
    burst();
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", burst);
      document.removeEventListener("focusout", burst);
      if (timer) window.clearTimeout(timer);
    };
  }, [active, sheetRef]);
  return lift;
}

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Near-full-height variant (search — the keyboard eats the lower half). */
  full?: boolean;
  /** Ride above the soft keyboard (the docblock's lift). Default: every sheet that is not
   *  `full` — a full sheet's input lives at its top and the lift would only push its head off. */
  keyboardLift?: boolean;
  children: ReactNode;
}

export default function Sheet({
  title,
  onClose,
  full = false,
  keyboardLift = !full,
  children,
}: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ id: number; startY: number } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const lift = useKeyboardLift(keyboardLift, sheetRef);

  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = { id: e.pointerId, startY: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers (tests) have no capture */
    }
  };
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    setDragY(Math.max(0, e.clientY - dragRef.current.startY));
  };
  const onHandleEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    dragRef.current = null;
    if (dy > DISMISS_DY_PX) onClose();
    else setDragY(0);
  };

  // The lift is `bottom` and the drag is `transform` — two properties, no fight.
  const style: CSSProperties = {};
  if (lift > 0) style.bottom = lift;
  if (dragY > 0) {
    style.transform = `translateY(${dragY}px)`;
    style.transition = "none";
  }

  return (
    <div className="m-sheetroot">
      <div className="m-scrim" onPointerDown={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={`m-sheet${full ? " m-sheet--full" : ""}${lift > 0 ? " m-sheet--lifted" : ""}`}
        role="dialog"
        aria-label={title}
        data-lift={lift > 0 ? lift : undefined}
        style={Object.keys(style).length > 0 ? style : undefined}
      >
        <div
          className="m-sheet__head"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleEnd}
          onPointerCancel={onHandleEnd}
        >
          <span className="m-sheet__grab" aria-hidden="true" />
          <span className="m-sheet__title">{title}</span>
          <button type="button" className="m-sheet__x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="m-sheet__body">{children}</div>
      </section>
    </div>
  );
}
