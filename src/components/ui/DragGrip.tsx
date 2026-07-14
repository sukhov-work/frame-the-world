import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TipPos } from "./InfoDot";
import "../../styles/drag-grip.css";
import "../../styles/tips.css";

/**
 * Panel drag primitive (owner 2026-07-14: "make all UI windows draggable"). One small ⠿ grip per
 * floating panel — a dedicated handle, NOT whole-surface dragging, so it can never steal a
 * pointerdown from the sliders/encoders/inputs that pointer-capture their own drags.
 *
 * Mechanics: the hook exposes a `style` carrying `--drag-x/--drag-y` custom properties; each
 * panel's CSS composes them into its OWN transform (`translateX(-50%) translate(var(--drag-x)…)`
 * for centred panels) — inline transforms would clobber those centering transforms. Offsets are
 * clamped so a panel always keeps a grabbable sliver on-screen, remembered per panel key for the
 * session (an FPV panel remounts on every entry), and reset by double-clicking the grip (the
 * repo's double-click-reset slider idiom). Pointer capture in try/catch — the Encoder's
 * synthetic-pointer tolerance.
 *
 * CONTAINING-BLOCK NOTE: the composed transform makes the panel root a containing block for
 * position:fixed descendants. Every wired panel was audited — their fixed satellites
 * (.ct-pinpop, the FpvHud edge chips) are SIBLINGS, and tips are ::after-absolute — safe.
 */

/** Session-scoped offsets: a remounting panel (FPV HUD, photo detail) keeps its dragged spot. */
const sessionOffsets = new Map<string, { x: number; y: number }>();

export interface PanelDrag {
  /** Spread onto the panel ROOT (the element whose CSS composes --drag-x/--drag-y). */
  style: CSSProperties;
  /** Spread onto the DragGrip (or any custom handle element). */
  grip: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
}

/** Minimum sliver (px) of the panel that must stay inside the viewport on each axis. */
const MIN_VISIBLE_PX = 48;

export function usePanelDrag(key: string): PanelDrag {
  const [offset, setOffset] = useState(() => sessionOffsets.get(key) ?? { x: 0, y: 0 });
  const start = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const apply = (next: { x: number; y: number }) => {
    sessionOffsets.set(key, next);
    setOffset(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    start.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests) have no capturable id — the drag still works via move/up
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!start.current) return;
    let x = start.current.ox + (e.clientX - start.current.px);
    let y = start.current.oy + (e.clientY - start.current.py);
    // Clamp against the panel root (the grip's parent, by contract) so the panel can never be
    // lost off-screen. The rect already includes the CURRENT offset — clamp in base space.
    const root = e.currentTarget.parentElement;
    if (root) {
      const r = root.getBoundingClientRect();
      const baseL = r.left - offset.x;
      const baseT = r.top - offset.y;
      x = Math.min(Math.max(x, MIN_VISIBLE_PX - baseL - r.width), window.innerWidth - MIN_VISIBLE_PX - baseL);
      y = Math.min(Math.max(y, 4 - baseT), window.innerHeight - MIN_VISIBLE_PX - baseT);
    }
    apply({ x, y });
  };

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    start.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // never captured (synthetic pointer) — nothing to release
    }
  };

  return {
    style: { "--drag-x": `${offset.x}px`, "--drag-y": `${offset.y}px` } as CSSProperties,
    grip: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: () => apply({ x: 0, y: 0 }),
    },
  };
}

/** The visible handle — place as a DIRECT child of the panel root carrying `drag.style`
 *  (the clamp measures its parent). */
export default function DragGrip({
  drag,
  label,
  tipPos = "up",
  inset = false,
  corner = "right",
}: {
  drag: PanelDrag;
  label: string;
  tipPos?: TipPos;
  /** Grip INSIDE the panel's top-right corner — for overflow:auto panels (photo detail,
   *  my-pins) where the default overhanging tab would be scroll-clipped. */
  inset?: boolean;
  /** Which top corner the grip docks to (left when the right corner hosts a close button). */
  corner?: "right" | "left";
}) {
  return (
    <button
      type="button"
      className={`drag-grip tip${inset ? " drag-grip--inset" : ""}${corner === "left" ? " drag-grip--left" : ""}`}
      aria-label={label}
      data-tip="DRAG TO MOVE · DOUBLE-CLICK RESETS"
      data-tip-pos={tipPos}
      {...drag.grip}
    >
      ⠿
    </button>
  );
}
