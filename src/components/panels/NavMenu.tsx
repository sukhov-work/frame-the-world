/**
 * NavMenu — the desktop topnav's collapsed MENU (owner 2026-10-22, T180). A small black pill with
 * a sandwich icon, LEFT of the PLAN / FIND IN FRAME / BEST SPOT toggle (the `.pft` look, twinned
 * in `nav-menu.css` — this island never reads `store/bestSpot`).
 *
 * The dropdown itself is NOT rendered here: a React island cannot wrap other Astro islands, and
 * the rows ARE islands (MyPins, Marketplace, Guide, MemberBadge) plus three static links. So
 * index.astro renders the container (`div.topnav-menu[data-nav-menu]`) around them, and this
 * island only flips its `is-open` class.
 *
 * WHY a class and NOT the `hidden` attribute: MyPins / Marketplace / Guide render their own
 * position:fixed windows INSIDE their island span, i.e. inside this container. `hidden`
 * (display:none) would take an opened window down with the menu the moment the row click
 * closes it. The closed container is `visibility: hidden` instead, and the windows opt back in
 * (`[role="dialog"]` / `[role="status"]` → visible — index.astro's scoped style).
 *
 * Dismissal twins the /m shell's title menu (MobileShell — never imported: the mobile fence):
 * Escape, a capture pointerdown outside both the button and the container, and any row click.
 */

import { useEffect, useRef, useState, type Ref } from "react";
import "../../styles/nav-menu.css";
import "../../styles/tips.css";

/** The container's hook in index.astro — the one coupling between the island and the page. */
export const NAV_MENU_SELECTOR = "[data-nav-menu]";
/** The container's id (the button's `aria-controls`). */
export const NAV_MENU_ID = "topnav-menu";

const menuEl = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.querySelector<HTMLElement>(NAV_MENU_SELECTOR);

/**
 * A click inside the container closes the menu when it lands on a ROW (a link or a button), but
 * never when it lands inside a window the rows opened (their `[role="dialog"]` lives in here too).
 */
export function isRowClick(target: Element | null): boolean {
  if (!target?.closest) return false;
  if (target.closest('[role="dialog"]')) return false;
  return !!target.closest("a, button");
}

/** The three-bar sandwich glyph — inline SVG, currentColor. */
function SandwichIcon() {
  return (
    <svg className="nm-icon" viewBox="0 0 14 10" width="14" height="10" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="14" height="1.6" rx="0.8" />
      <rect x="0" y="4.2" width="14" height="1.6" rx="0.8" />
      <rect x="0" y="8.4" width="14" height="1.6" rx="0.8" />
    </svg>
  );
}

/** The pure button view (statically renderable — the tests' seam). */
export function NavMenuButton({
  open,
  onToggle,
  buttonRef,
}: {
  open: boolean;
  onToggle?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="nm">
      <button
        ref={buttonRef}
        type="button"
        className={`nm-btn tip${open ? " is-on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={NAV_MENU_ID}
        aria-label="PLUX menu — explore, mobile, docs, my content, marketplace, guide, account"
        data-tip="EXPLORE · MOBILE · DOCS · MY CONTENT · GUIDE · ACCOUNT"
        data-tip-pos="down"
        onClick={onToggle}
      >
        <SandwichIcon />
        <span className="nm-label">MENU</span>
      </button>
    </div>
  );
}

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The container is page markup — reflect the state onto it.
  useEffect(() => {
    menuEl()?.classList.toggle("is-open", open);
  }, [open]);

  // Row clicks close the menu (the click itself still reaches the row's own handler first —
  // this listens on the container in the bubble phase).
  useEffect(() => {
    const menu = menuEl();
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (isRowClick(e.target as Element | null)) setOpen(false);
    };
    menu.addEventListener("click", onClick);
    return () => menu.removeEventListener("click", onClick);
  }, []);

  // While open: Escape + a capture pointerdown outside the button and the container.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (buttonRef.current?.contains(t)) return; // the button toggles itself
      if (menuEl()?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return <NavMenuButton open={open} onToggle={() => setOpen((o) => !o)} buttonRef={buttonRef} />;
}
