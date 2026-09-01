import { useEffect, useLayoutEffect, useRef } from "react";
import {
  BLDG_EDIT_OPS,
  opIsEdited,
  useBldgEditStore,
  type BldgEditArmed,
  type BldgEditMenu,
  type BldgEditOp,
} from "../../store/bldgEdit";
import type { FeatureTransform } from "../../lib/globe/featureTransform";
import "../../styles/building-edit.css";

/**
 * Building edit chip (U8, owner 2026-08-18; MESH SUITE MS2 2026-09-02) — the readout + controls
 * while a building is armed in FPV. Top-level island in BOTH shells (index.astro + m.astro — the
 * SkyContextMenu precedent; never imports from components/mobile/**). Reads the orchestrator's
 * deadband `armed` mirror (store/bldgEdit); writes back only REQUESTS (the op to switch to,
 * per-op revert, RESET ALL, DONE). The per-frame numbers pinned to the building itself are the
 * orchestrator-owned DOM label (scene/bldgEditLabel.ts) — this chip is the stable HUD anchor.
 *
 * MS2 shape (owner: "modified AND original values always visible; revert per-op and revert-all"):
 * an op strip (MOVE G · ROTATE R · SCALE S · EXTRUDE E), one row per op with its CURRENT value,
 * its ORIGINAL, and a ↺ when that op is edited, then RESET ALL. The same ops are offered by the
 * context menu below (right-click desktop / long-press glass), anchored at the press point.
 */

export const OP_LABEL: Record<BldgEditOp, string> = {
  move: "MOVE",
  rotate: "ROTATE",
  scale: "SCALE",
  extrude: "EXTRUDE",
};
export const OP_KEY: Record<BldgEditOp, string> = { move: "G", rotate: "R", scale: "S", extrude: "E" };
const OP_GLYPH: Record<BldgEditOp, string> = { move: "↔", rotate: "↻", scale: "⤢", extrude: "↕" };

const sg = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

/** One op's CURRENT value as the chip prints it. The yaw is shown in COMPASS sense (clockwise
 *  from above = the negative of the row's three-sense `rotDeg`); heights as U8 printed them. */
export function opReadout(op: BldgEditOp, t: FeatureTransform, originalHeightM: number): string {
  switch (op) {
    case "move":
      return `${sg(t.tE)} E · ${sg(t.tN)} N · ↑${t.tU.toFixed(1)} m`;
    case "rotate":
      return `${sg(-t.rotDeg)}° cw`;
    case "scale":
      return `${t.sx.toFixed(2)} × ${t.sz.toFixed(2)}`;
    case "extrude":
      return `${(originalHeightM * t.sy).toFixed(1)} m (${sg(originalHeightM * (t.sy - 1))})`;
  }
}

/** One op's ORIGINAL (the baked building) as the chip prints it. */
export function opOriginal(op: BldgEditOp, originalHeightM: number): string {
  switch (op) {
    case "move":
      return "0.0 E · 0.0 N · ↑0.0 m";
    case "rotate":
      return "0.0° cw";
    case "scale":
      return "1.00 × 1.00";
    case "extrude":
      return `${originalHeightM.toFixed(1)} m`;
  }
}

/** What the chip and the menu write back — the store's request actions, passed as props so the
 *  views are pure (zustand 5 renders a store hook's INITIAL state on the server, which is how a
 *  `renderToStaticMarkup` test would see an empty chip whatever the store holds). */
export interface BuildingEditActions {
  setOp(op: BldgEditOp): void;
  requestRevert(which: BldgEditOp | "all"): void;
  requestReset(): void;
  requestDisarm(): void;
  closeMenu(): void;
}

export default function BuildingEditChip() {
  const armed = useBldgEditStore((s) => s.armed);
  const menu = useBldgEditStore((s) => s.menu);
  const setOp = useBldgEditStore((s) => s.setOp);
  const requestRevert = useBldgEditStore((s) => s.requestRevert);
  const requestReset = useBldgEditStore((s) => s.requestReset);
  const requestDisarm = useBldgEditStore((s) => s.requestDisarm);
  const closeMenu = useBldgEditStore((s) => s.closeMenu);
  if (!armed) return null;
  return (
    <BuildingEditChipView
      armed={armed}
      menu={menu}
      actions={{ setOp, requestRevert, requestReset, requestDisarm, closeMenu }}
    />
  );
}

export function BuildingEditChipView({
  armed,
  menu,
  actions,
}: {
  armed: BldgEditArmed;
  menu: BldgEditMenu | null;
  actions: BuildingEditActions;
}) {
  const { setOp, requestRevert, requestReset } = actions;
  const spatial = armed.op !== "extrude";
  return (
    <>
      <div className={`bldg-edit-chip${armed.dragging ? " is-dragging" : ""}`} role="status">
        <div className="bec-ops" role="tablist" aria-label="Building edit op">
          {BLDG_EDIT_OPS.map((op) => (
            <button
              key={op}
              type="button"
              role="tab"
              aria-selected={armed.op === op}
              className={`bec-op${armed.op === op ? " is-on" : ""}${opIsEdited(op, armed.committed) ? " is-edited" : ""}`}
              data-op={op}
              onClick={() => setOp(op)}
            >
              {OP_LABEL[op]}
              <kbd>{OP_KEY[op]}</kbd>
            </button>
          ))}
        </div>
        <div className="bec-rows">
          {BLDG_EDIT_OPS.map((op) => {
            const edited = opIsEdited(op, armed.committed);
            return (
              <div
                key={op}
                className={`bec-row${armed.op === op ? " is-on" : ""}${edited ? " is-edited" : ""}`}
                data-op={op}
              >
                <span className="bec-k">{op === "extrude" ? "HEIGHT" : OP_LABEL[op]}</span>
                <span className="bec-v">{opReadout(op, armed.live, armed.originalHeightM)}</span>
                <span className="bec-was">was {opOriginal(op, armed.originalHeightM)}</span>
                {edited && !armed.dragging ? (
                  <button
                    type="button"
                    className="bec-revert"
                    data-op={op}
                    title={`Revert ${OP_LABEL[op].toLowerCase()}`}
                    onClick={() => requestRevert(op)}
                  >
                    ↺
                  </button>
                ) : (
                  <span className="bec-revert bec-revert--void" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
        <div className="bec-foot">
          {armed.overridden && !armed.dragging && (
            <button type="button" className="bec-reset" onClick={requestReset}>
              RESET ALL
            </button>
          )}
          <span className="bec-hint bec-hint--desktop">
            {spatial
              ? "drag a handle · ⇧ snap · right-click menu · Esc done"
              : "drag ↑↓ · dbl-click re-target · Esc done"}
          </span>
          <span className="bec-hint bec-hint--m">
            {spatial ? "drag a handle · hold for menu · tap away done" : "drag ↑↓ · double-tap re-target · tap away done"}
          </span>
        </div>
      </div>
      {menu && <BuildingEditMenu armed={armed} menu={menu} actions={actions} />}
    </>
  );
}

/** The building context menu (right-click desktop / long-press glass): the ops, REVERT ALL,
 *  DONE. The `.skymenu` cut — a static press point, the card floats up-right of it (so a
 *  long-press finger's release lands outside it), viewport-clamped after layout, closed by a
 *  press elsewhere. Canvas presses are the orchestrator's (it closes the menu itself and tells
 *  a "close the menu" tap from a tap-away); Escape is its rung too. */
export function BuildingEditMenu({
  armed,
  menu,
  actions,
}: {
  armed: BldgEditArmed;
  menu: BldgEditMenu;
  actions: BuildingEditActions;
}) {
  const { setOp, closeMenu, requestReset, requestDisarm } = actions;
  const cardRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.marginLeft = "0px";
    el.style.marginTop = "0px";
    const r = el.getBoundingClientRect();
    const pad = 8;
    const dx = Math.max(pad - r.left, Math.min(0, window.innerWidth - pad - r.right));
    const dy = Math.max(pad - r.top, Math.min(0, window.innerHeight - pad - r.bottom));
    if (dx !== 0) el.style.marginLeft = `${Math.round(dx)}px`;
    if (dy !== 0) el.style.marginTop = `${Math.round(dy)}px`;
  }, [menu]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".bldg-menu")) return; // in-menu presses stay alive
      if (t?.tagName === "CANVAS") return; // the orchestrator owns canvas presses (see above)
      closeMenu();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [closeMenu]);

  return (
    <div
      ref={cardRef}
      className="bldg-menu"
      role="menu"
      aria-label="Building edit"
      style={{ left: menu.screenX, top: menu.screenY }}
    >
      <div className="bldg-menu__head">
        <span className="bldg-menu__name">BUILDING</span>
        <span className="bldg-menu__pos">
          {armed.originalHeightM.toFixed(1)} m{armed.overridden ? " · edited" : ""}
        </span>
      </div>
      {BLDG_EDIT_OPS.map((op) => (
        <button
          key={op}
          type="button"
          role="menuitem"
          className={`bldg-menu__item${armed.op === op ? " is-on" : ""}`}
          data-op={op}
          onClick={() => {
            setOp(op);
            closeMenu();
          }}
        >
          {OP_GLYPH[op]} {OP_LABEL[op]}
          <kbd>{OP_KEY[op]}</kbd>
        </button>
      ))}
      {armed.overridden && (
        <button
          type="button"
          role="menuitem"
          className="bldg-menu__item"
          data-act="revert-all"
          onClick={() => {
            requestReset();
            closeMenu();
          }}
        >
          ↺ REVERT ALL
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="bldg-menu__item"
        data-act="done"
        onClick={() => {
          requestDisarm();
          closeMenu();
        }}
      >
        ✓ DONE
      </button>
    </div>
  );
}
