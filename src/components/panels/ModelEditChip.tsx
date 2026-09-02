import { useEffect, useLayoutEffect, useRef } from "react";
import type { BldgEditMenu } from "../../store/bldgEdit";
import {
  MODEL_EDIT_OPS,
  modelOpIsEdited,
  useModelEditStore,
  type ModelEditArmed,
  type ModelEditOp,
} from "../../store/modelEdit";
import type { ModelEdit } from "../../lib/models/modelPlacement";
import { formatDims } from "../../lib/format/readout";
import "../../styles/building-edit.css";

/**
 * Model edit chip (MESH SUITE MS5, 2026-09-02) — the readout + controls while an uploaded model
 * is armed in FPV (MS6: any signed-in member arms any model — the badge says YOURS or SHARED,
 * the MS3 word for "the world's"): the BuildingEditChip's twin on the same CSS
 * (`.bldg-edit-chip` / `.bec-*` / `.bldg-menu`), kept a separate island so the building chip,
 * its harness and the U8 UX stay byte-identical. Desktop-only mount (index.astro): models have
 * no /m entry. Reads the orchestrator's deadband `armed` mirror (store/modelEdit); writes back
 * only REQUESTS (the op to switch to, per-op revert, RESET ALL, DONE).
 *
 * Three ops: MOVE (the placement — a drag's east/north offset folds into new coordinates on
 * release; there is no "original" to revert to), ROTATE (yaw) and SCALE (uniform). No lift: a
 * model always stands on the terrain (MESH_SUITE_PLAN §10).
 */

export const MODEL_OP_LABEL: Record<ModelEditOp, string> = { move: "MOVE", rotate: "ROTATE", scale: "SCALE" };
export const MODEL_OP_KEY: Record<ModelEditOp, string> = { move: "G", rotate: "R", scale: "S" };
const MODEL_OP_GLYPH: Record<ModelEditOp, string> = { move: "↔", rotate: "↻", scale: "⤢" };

const sg = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

/** The origin badge's one-line titles (MS6): the MS3 register — SHARED is the world's. */
export const MODEL_ORIGIN_TITLE = {
  mine: "Your model — edits save to your account as you release a handle.",
  shared: "Another member placed this model. Your edits replace its spot, turn and size for everyone as you release a handle.",
} as const;

/** One op's CURRENT value as the chip prints it. MOVE shows the drag offset while dragging,
 *  else the placement; the yaw is COMPASS sense (clockwise from above = −rotDeg). MS5b (owner
 *  2026-09-02j): the SCALE row leads with the current size in METRES (`sizeM3` × the live
 *  scale, `w × d × h`) and keeps the factor beside it. */
export function modelOpReadout(
  op: ModelEditOp,
  live: ModelEdit,
  armed: { lat: number; lon: number; sizeM3?: readonly [number, number, number] | null },
): string {
  switch (op) {
    case "move":
      return Math.abs(live.tE) >= 0.05 || Math.abs(live.tN) >= 0.05
        ? `${sg(live.tE)} E · ${sg(live.tN)} N`
        : `${armed.lat.toFixed(5)}, ${armed.lon.toFixed(5)}`;
    case "rotate":
      return `${sg(-live.rotDeg)}° cw`;
    case "scale":
      return armed.sizeM3
        ? `${formatDims(armed.sizeM3.map((v) => v * live.scale))} (${live.scale.toFixed(2)}×)`
        : `${live.scale.toFixed(2)}×`;
  }
}

/** One op's ORIGINAL (the upload) as the chip prints it — the SCALE original is the upload's
 *  size in metres when known (MS5b). */
export function modelOpOriginal(op: ModelEditOp, sizeM3?: readonly [number, number, number] | null): string {
  switch (op) {
    case "move":
      return "where you dropped it";
    case "rotate":
      return "0.0° cw";
    case "scale":
      return sizeM3 ? formatDims(sizeM3) : "1.00×";
  }
}

/** What the chip and the menu write back — the store's request actions, passed as props so the
 *  views are pure (zustand 5 renders a store hook's INITIAL state under renderToStaticMarkup). */
export interface ModelEditActions {
  setOp(op: ModelEditOp): void;
  requestRevert(which: ModelEditOp | "all"): void;
  requestReset(): void;
  requestDisarm(): void;
  closeMenu(): void;
}

export default function ModelEditChip() {
  const armed = useModelEditStore((s) => s.armed);
  const menu = useModelEditStore((s) => s.menu);
  const setOp = useModelEditStore((s) => s.setOp);
  const requestRevert = useModelEditStore((s) => s.requestRevert);
  const requestReset = useModelEditStore((s) => s.requestReset);
  const requestDisarm = useModelEditStore((s) => s.requestDisarm);
  const closeMenu = useModelEditStore((s) => s.closeMenu);
  if (!armed) return null;
  const actions: ModelEditActions = { setOp, requestRevert, requestReset, requestDisarm, closeMenu };
  return <ModelEditChipView armed={armed} menu={menu} actions={actions} />;
}

export function ModelEditChipView({
  armed,
  menu,
  actions,
}: {
  armed: ModelEditArmed;
  menu: BldgEditMenu | null;
  actions: ModelEditActions;
}) {
  const { setOp, requestRevert, requestReset } = actions;
  return (
    <>
      <div className={`bldg-edit-chip${armed.dragging ? " is-dragging" : ""}`} role="status" data-kind="model">
        <div className="bec-ops" role="tablist" aria-label="Model edit op">
          {MODEL_EDIT_OPS.map((op) => (
            <button
              key={op}
              type="button"
              role="tab"
              aria-selected={armed.op === op}
              className={`bec-op${armed.op === op ? " is-on" : ""}${modelOpIsEdited(op, armed.committed) ? " is-edited" : ""}`}
              data-op={op}
              onClick={() => setOp(op)}
            >
              {MODEL_OP_LABEL[op]}
              <kbd>{MODEL_OP_KEY[op]}</kbd>
            </button>
          ))}
          <span
            className="bec-origin"
            data-origin={armed.saving ? "saving" : armed.saveError ? "failed" : armed.mine ? "mine" : "shared"}
            title={armed.saveError ?? (armed.mine ? MODEL_ORIGIN_TITLE.mine : MODEL_ORIGIN_TITLE.shared)}
          >
            {armed.saving ? "SAVING…" : armed.saveError ? "SAVE FAILED" : armed.mine ? "YOURS" : "SHARED"}
          </span>
        </div>
        <div className="bec-rows">
          {MODEL_EDIT_OPS.map((op) => {
            const edited = modelOpIsEdited(op, armed.committed);
            return (
              <div
                key={op}
                className={`bec-row${armed.op === op ? " is-on" : ""}${edited ? " is-edited" : ""}`}
                data-op={op}
              >
                <span className="bec-k">{MODEL_OP_LABEL[op]}</span>
                <span className="bec-v">{modelOpReadout(op, armed.live, armed)}</span>
                <span className="bec-was">was {modelOpOriginal(op, armed.sizeM3)}</span>
                {edited && !armed.dragging ? (
                  <button
                    type="button"
                    className="bec-revert"
                    data-op={op}
                    title={`Revert ${MODEL_OP_LABEL[op].toLowerCase()}`}
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
          <span className="bec-hint bec-hint--desktop">drag a handle · ⇧ snap · right-click menu · Esc done</span>
          <span className="bec-hint bec-hint--m">drag a handle · hold for menu · tap away done</span>
        </div>
      </div>
      {menu && <ModelEditMenu armed={armed} menu={menu} actions={actions} />}
    </>
  );
}

/** The model context menu (right-click desktop / long-press glass): the ops, REVERT ALL, DONE —
 *  the BuildingEditMenu cut (a static press point, floats up-right, viewport-clamped, closed by a
 *  press elsewhere; canvas presses are the orchestrator's). */
export function ModelEditMenu({
  armed,
  menu,
  actions,
}: {
  armed: ModelEditArmed;
  menu: BldgEditMenu;
  actions: ModelEditActions;
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
      if (t?.closest?.(".bldg-menu")) return;
      if (t?.tagName === "CANVAS") return;
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
      aria-label="Model edit"
      data-kind="model"
      style={{ left: menu.screenX, top: menu.screenY }}
    >
      <div className="bldg-menu__head">
        <span className="bldg-menu__name">MODEL · {armed.title.toUpperCase()}</span>
        <span className="bldg-menu__pos">
          {armed.sizeM3
            ? formatDims(armed.sizeM3.map((v) => v * armed.committed.scale))
            : armed.sizeM !== null
              ? `${armed.sizeM.toFixed(1)} m`
              : armed.mine ? "yours" : "shared"}
          {armed.mine ? "" : " · shared"}
          {armed.overridden ? " · edited" : ""}
        </span>
      </div>
      {MODEL_EDIT_OPS.map((op) => (
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
          {MODEL_OP_GLYPH[op]} {MODEL_OP_LABEL[op]}
          <kbd>{MODEL_OP_KEY[op]}</kbd>
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
