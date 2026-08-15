/**
 * TabBar (M1) — the bottom navigation of the /m shell (MOBILE_PLAN §3). SCENE is the base
 * layer (closes any sheet); PLAN / SEARCH open their sheets. Safe-area padded (the only
 * consumer of env(safe-area-inset-bottom) in the shell — chrome.css).
 */

import "../../styles/mobile/chrome.css";

export type MobileTab = "scene" | "plan" | "find" | "search";

const TABS: Array<{ id: MobileTab; glyph: string; label: string }> = [
  { id: "scene", glyph: "◉", label: "SCENE" },
  { id: "plan", glyph: "☀", label: "PLAN" },
  // FIND IN FRAME promoted to a first-class tab (owner 2026-08-15c — ease of access).
  { id: "find", glyph: "⌖", label: "FIND" },
  { id: "search", glyph: "⌕", label: "SEARCH" },
];

export default function TabBar({
  active,
  onSelect,
}: {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
}) {
  return (
    <nav className="m-tabs" aria-label="Mobile navigation">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`m-tab${active === t.id ? " m-tab--on" : ""}`}
          aria-pressed={active === t.id}
          onClick={() => onSelect(t.id)}
        >
          <span className="m-tab__glyph" aria-hidden="true">
            {t.glyph}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
