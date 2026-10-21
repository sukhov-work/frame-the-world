import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { facadeRowById, useFacadesStore, type FacadeMenu } from "../../store/facades";
import { useFacadePhotoStore } from "../../store/facadePhoto";
import { isFacadeSaveBusy, useFacadeSaveStore } from "../../store/facadeSave";
import type { FacadeListItem, FacadeWorldItem } from "../../lib/wix/facadeRecords";
import "../../styles/facade-markers.css";

/**
 * FacadeMarkerMenu — the saved-facade marker's context menu (T178, owner ask 2026-10-22):
 * right-click (desktop) / long-press (/m) a marker → EDIT · REMOVE. EDIT re-opens the row in the
 * facade editor (`openSaved` — the member's OWN row only; a world-only row is "not yours");
 * REMOVE is two-press (the FacadePhotoFlow DELETE_CONFIRM_MS idiom: the first press arms
 * "SURE? REMOVE", auto-disarms after 4 s, the second deletes via `deleteFacadeById`).
 * Fed by the orchestrator's marker pick (`useFacadesStore._setMenu` — a static press point);
 * dismissed by Escape, any press outside the card (the canvas included), or any action.
 * The SkyContextMenu / ModelEditMenu cut: top-level island, fixed, viewport-clamped. Never
 * imports from components/mobile/** (the two-shell fence).
 */

/** The armed REMOVE disarms itself after this (the FacadePhotoFlow DELETE_CONFIRM_MS twin). */
export const REMOVE_CONFIRM_MS = 4000;

export interface FacadeMarkerMenuActions {
  edit: () => void;
  remove: () => void;
}

export function FacadeMarkerMenuView({
  menu,
  item,
  own,
  armed,
  busy = false,
  actions,
  cardRef,
}: {
  menu: FacadeMenu | null;
  item: FacadeListItem | FacadeWorldItem | null;
  /** The row is in the member's `mine` (EDIT / REMOVE are the owner's). */
  own: boolean;
  armed: boolean;
  /** A facade write is in flight — REMOVE waits (the B15 one-op-at-a-time invariant). */
  busy?: boolean;
  actions: FacadeMarkerMenuActions;
  cardRef?: Ref<HTMLDivElement>;
}) {
  if (!menu || !item) return null;
  const title = item.title || "UNTITLED";
  return (
    <div
      ref={cardRef}
      className="fmenu"
      role="menu"
      aria-label={`${title} actions`}
      data-facade-menu={item.id}
      style={{ left: menu.screenX, top: menu.screenY }}
    >
      <div className="fmenu__head">
        <span className="fmenu__name">{title}</span>
      </div>
      <button
        type="button"
        className="fmenu__item"
        role="menuitem"
        data-act="edit"
        disabled={!own}
        title={own ? undefined : "not yours"}
        onClick={actions.edit}
      >
        EDIT
      </button>
      <button
        type="button"
        className={`fmenu__item fmenu__item--danger${armed ? " is-armed" : ""}`}
        role="menuitem"
        data-act="remove"
        disabled={!own || busy}
        title={own ? undefined : "not yours"}
        onClick={actions.remove}
      >
        {armed ? "SURE? REMOVE" : "REMOVE"}
      </button>
    </div>
  );
}

export default function FacadeMarkerMenu() {
  const menu = useFacadesStore((s) => s.menu);
  const mine = useFacadesStore((s) => s.mine);
  const world = useFacadesStore((s) => s.world);
  const closeMenu = useFacadesStore((s) => s.closeMenu);
  const busy = useFacadeSaveStore((s) => isFacadeSaveBusy(s.phase));
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const item = menu ? facadeRowById({ mine, world }, menu.id) : null;
  const ownItem = menu ? (mine.find((m) => m.id === menu.id) ?? null) : null;

  // A new open (another marker, or the same one re-pressed) starts disarmed.
  useEffect(() => setArmed(false), [menu]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), REMOVE_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // Viewport clamp (the SkyContextMenu M3c idiom): measure after layout, nudge back inside via
  // margins with an 8px pad; re-runs (and resets) per open.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !menu) return;
    el.style.marginLeft = "0px";
    el.style.marginTop = "0px";
    const r = el.getBoundingClientRect();
    const pad = 8;
    const dx = Math.max(pad - r.left, Math.min(0, window.innerWidth - pad - r.right));
    const dy = Math.max(pad - r.top, Math.min(0, window.innerHeight - pad - r.bottom));
    if (dx !== 0) el.style.marginLeft = `${Math.round(dx)}px`;
    if (dy !== 0) el.style.marginTop = `${Math.round(dy)}px`;
  }, [menu]);

  // Escape / click-away while open — capture, so a press on the canvas closes it too (the
  // orchestrator may also close it on a canvas press; closing twice is harmless).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".fmenu")) closeMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menu, closeMenu]);

  // A row that vanished under the open menu (removed elsewhere, signed out) closes it.
  useEffect(() => {
    if (menu && !item) closeMenu();
  }, [menu, item, closeMenu]);

  const actions: FacadeMarkerMenuActions = {
    edit: () => {
      if (!ownItem) return;
      useFacadePhotoStore.getState().openSaved(ownItem);
      closeMenu();
    },
    remove: () => {
      if (!ownItem) return;
      if (!armed) {
        setArmed(true);
        return;
      }
      setArmed(false);
      void useFacadeSaveStore.getState().deleteFacadeById(ownItem.id);
      closeMenu();
    },
  };

  return (
    <FacadeMarkerMenuView
      menu={menu}
      item={item}
      own={ownItem !== null}
      armed={armed}
      busy={busy}
      actions={actions}
      cardRef={cardRef}
    />
  );
}
