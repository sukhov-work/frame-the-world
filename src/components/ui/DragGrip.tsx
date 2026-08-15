import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TipPos } from "./InfoDot";
import "../../styles/drag-grip.css";
import "../../styles/tips.css";

/**
 * Panel drag primitive (owner 2026-07-14: "make all UI windows draggable"). One small ⠿ grip per
 * floating panel — a dedicated handle, NOT whole-surface dragging, so it can never steal a
 * pointerdown from the sliders/encoders/inputs that pointer-capture their own drags.
 *
 * Placement is UNIFORM (owner rework, same day): the tab floats just OUTSIDE the window above
 * its top-right corner (~10% of the panel width) and stays hidden until the panel is hovered
 * (drag-grip.css `:hover > .drag-grip`). Consequence: a panel that scrolls must keep overflow
 * on an INNER wrapper (.pd-scroll / .mp-scroll pattern) or the tab would be clipped.
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

  // Shared-key sync (owner 2026-08-15, the PLAN/FIND window): a SIBLING panel under the same
  // key writes the Map while this one sits closed-but-mounted (the null-render pattern keeps
  // hooks alive), so the mount-time initializer alone goes stale. Adopt on render — the legal
  // derived-state setState; same-key siblings never render simultaneously, so no ping-pong.
  const storedOffset = sessionOffsets.get(key);
  if (storedOffset && (storedOffset.x !== offset.x || storedOffset.y !== offset.y)) {
    setOffset(storedOffset);
  }

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

/** Session-scoped window sizes — the offsets' twin (owner 2026-08-15, the PLAN/FIND window):
 *  PLAN and FIND share ONE key, so the window keeps its user-set size across a mode switch. */
const sessionSizes = new Map<string, { w: number; h: number }>();

export interface PanelResize {
  /** Spread onto the WINDOW element — its CSS must read `--win-w`/`--win-h` (border-box px)
   *  as `width: var(--win-w, <default>); height: var(--win-h, auto);
   *  max-height: var(--win-h, <default cap>)` so a user resize also lifts the default cap. */
  style: CSSProperties;
  /** Spread onto the ResizeGrip (or any custom handle element). */
  grip: PanelDrag["grip"];
}

/** Window floors (px) — a resized window must stay a usable instrument. */
const MIN_WIN_W = 200;
const MIN_WIN_H = 130;

/** Corner-resize twin of usePanelDrag: same session-Map memory, same double-click reset, same
 *  pointer-capture tolerance. Emits border-box px as CSS vars; `null` size = the CSS default. */
export function usePanelResize(key: string): PanelResize {
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    () => sessionSizes.get(key) ?? null,
  );
  const start = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  // Shared-key sync — the usePanelDrag note applies verbatim (reset DELETES the entry,
  // so null-vs-null must count as equal).
  const stored = sessionSizes.get(key) ?? null;
  const stale =
    stored === null
      ? size !== null
      : size === null || stored.w !== size.w || stored.h !== size.h;
  if (stale) setSize(stored);

  const apply = (next: { w: number; h: number } | null) => {
    if (next) sessionSizes.set(key, next);
    else sessionSizes.delete(key);
    setSize(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const win = e.currentTarget.parentElement; // the window (the grip's parent, by contract)
    if (!win) return;
    const r = win.getBoundingClientRect();
    start.current = { px: e.clientX, py: e.clientY, w: r.width, h: r.height };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests) have no capturable id — the resize still works via move/up
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!start.current) return;
    const w = Math.min(
      Math.max(start.current.w + (e.clientX - start.current.px), MIN_WIN_W),
      window.innerWidth * 0.92,
    );
    const h = Math.min(
      Math.max(start.current.h + (e.clientY - start.current.py), MIN_WIN_H),
      window.innerHeight * 0.92,
    );
    apply({ w, h });
  };

  const endResize = (e: PointerEvent<HTMLElement>) => {
    start.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // never captured (synthetic pointer) — nothing to release
    }
  };

  return {
    style: size
      ? ({ "--win-w": `${size.w}px`, "--win-h": `${size.h}px` } as CSSProperties)
      : {},
    grip: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endResize,
      onPointerCancel: endResize,
      onDoubleClick: () => apply(null),
    },
  };
}

/** The corner handle — place as a DIRECT child of the WINDOW element carrying `resize.style`
 *  (the measure reads its parent; the reveal rule is `:hover > .resize-grip`). */
export function ResizeGrip({ resize, label }: { resize: PanelResize; label: string }) {
  return (
    <button
      type="button"
      className="resize-grip tip"
      aria-label={label}
      data-tip="DRAG TO RESIZE · DOUBLE-CLICK RESETS"
      data-tip-pos="up"
      {...resize.grip}
    >
      ◢
    </button>
  );
}

/** The visible handle — place as a DIRECT child of the panel root carrying `drag.style`
 *  (the clamp measures its parent, and the hover-reveal rule is `:hover > .drag-grip`).
 *  Placement is UNIFORM (owner 2026-07-14): a small tab just OUTSIDE the window above its
 *  top-right corner, hidden until the panel is hovered. Hosts that scroll must therefore keep
 *  overflow on an INNER wrapper — an overflow root would clip the overhanging tab. */
export default function DragGrip({
  drag,
  label,
  tipPos = "up",
}: {
  drag: PanelDrag;
  label: string;
  tipPos?: TipPos;
}) {
  return (
    <button
      type="button"
      className="drag-grip tip"
      aria-label={label}
      data-tip="DRAG TO MOVE · DOUBLE-CLICK RESETS"
      data-tip-pos={tipPos}
      {...drag.grip}
    >
      ⠿
    </button>
  );
}
