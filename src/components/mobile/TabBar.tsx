/**
 * TabBar (M1) — the bottom navigation of the /m shell (MOBILE_PLAN §3). SCENE is the base
 * layer (closes any sheet); PLAN / FIND / SEARCH / SPOT open their sheets. Safe-area padded (the
 * only consumer of env(safe-area-inset-bottom) in the shell — chrome.css).
 *
 * FIVE items since 2026-09-07g (BEST SPOT, right of SEARCH — owner order). Five glyph+label
 * cells share a 375 px row at ~69 px each; every label is ≤ 6 characters so none wraps or
 * shrinks (`SPOT`, not `BEST SPOT` — abbreviate before shrinking).
 *
 * LIVE + LONG PRESS (owner 2026-09-08b): a tab whose feature is WORKING (a frame scan running,
 * a heatmap armed) carries `.m-tab--live` — an accent dot on the glyph — whether or not its
 * sheet is showing; a long press (the ORCH shape: touch only, 500 ms, 6 px move-cancel, the
 * trailing click swallowed) hands the tab to `onLongPress` instead of selecting it. The
 * decisions are `tabLive.ts` (pure); this component only renders and gestures.
 */

import { useEffect, useRef } from "react";
import { ORCH } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

export type MobileTab = "scene" | "plan" | "find" | "search" | "spot";

const TABS: Array<{ id: MobileTab; glyph: string; label: string }> = [
  { id: "scene", glyph: "◉", label: "SCENE" },
  { id: "plan", glyph: "☀", label: "PLAN" },
  // FIND IN FRAME promoted to a first-class tab (owner 2026-08-15c — ease of access).
  { id: "find", glyph: "⌖", label: "FIND" },
  { id: "search", glyph: "⌕", label: "SEARCH" },
  // BEST SPOT — the heatmap (owner 2026-09-07g). ◎ is the desktop's own HEATMAP glyph.
  { id: "spot", glyph: "◎", label: "SPOT" },
];

export default function TabBar({
  active,
  onSelect,
  live,
  onLongPress,
}: {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  /** Tabs whose feature is working right now (`tabLive`) — rendered with the accent dot. */
  live?: Partial<Record<MobileTab, boolean>>;
  /** A long press on a tab (touch only); when absent the press is an ordinary tap. */
  onLongPress?: (tab: MobileTab) => void;
}) {
  // The ORCH long-press shape (SceneActions' MapModeChip twin): one timer for the row — two
  // fingers on two tabs is not a gesture anyone means.
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);
  const downPos = useRef({ x: 0, y: 0 });
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => cancelPress, []);
  const armPress = (tab: MobileTab, e: React.PointerEvent<HTMLButtonElement>) => {
    pressFired.current = false; // any new press (mouse too) forgets a swallowed click
    if (!onLongPress || e.pointerType !== "touch") return;
    downPos.current = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFired.current = true;
      onLongPress(tab);
      // Android fires the trailing click on lift, iOS may not — either way the swallow must not
      // outlive the gesture (the MapModeChip's 900 ms twin), or the NEXT tap would vanish.
      window.setTimeout(() => {
        pressFired.current = false;
      }, 900);
    }, ORCH.longPressMs);
  };
  const movePress = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pressTimer.current === null) return;
    const dx = e.clientX - downPos.current.x;
    const dy = e.clientY - downPos.current.y;
    if (Math.hypot(dx, dy) > ORCH.clickDragPx) cancelPress();
  };
  return (
    <nav className="m-tabs" aria-label="Mobile navigation">
      {TABS.map((t) => {
        const on = active === t.id;
        const isLive = live?.[t.id] === true;
        const holdable = onLongPress && (t.id === "find" || t.id === "spot");
        return (
          <button
            key={t.id}
            type="button"
            className={`m-tab${isLive ? " m-tab--live" : ""}${on ? " m-tab--on" : ""}`}
            aria-pressed={on}
            aria-label={
              holdable
                ? `${t.label}${isLive ? " — working; hold to switch off" : " — hold to switch on"}`
                : undefined
            }
            onPointerDown={(e) => armPress(t.id, e)}
            onPointerMove={movePress}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              // The long press already acted — the trailing click must not also select the tab.
              if (pressFired.current) {
                pressFired.current = false;
                return;
              }
              onSelect(t.id);
            }}
          >
            <span className="m-tab__glyph" aria-hidden="true">
              {t.glyph}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
