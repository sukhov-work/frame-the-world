/**
 * Sheet (M1) — the bottom-sheet container every mobile surface rides in (MOBILE_PLAN §3:
 * "chrome = bottom tab bar + swipeable bottom sheets; never fixed side panels"). The head is
 * the drag handle: pull down past the dismiss threshold to close; the scrim tap closes too.
 *
 * S2 containing-block discipline: the backdrop-filter sits on the sheet SURFACE only — no
 * position:fixed element ever lives under a filtered ancestor (m-sheetroot is the fixed layer
 * and carries no filter).
 */

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import "../../styles/mobile/chrome.css";

const DISMISS_DY_PX = 90;

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Near-full-height variant (search — the keyboard eats the lower half). */
  full?: boolean;
  children: ReactNode;
}

export default function Sheet({ title, onClose, full = false, children }: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ id: number; startY: number } | null>(null);

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

  return (
    <div className="m-sheetroot">
      <div className="m-scrim" onPointerDown={onClose} aria-hidden="true" />
      <section
        className={`m-sheet${full ? " m-sheet--full" : ""}`}
        role="dialog"
        aria-label={title}
        style={
          dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined
        }
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
