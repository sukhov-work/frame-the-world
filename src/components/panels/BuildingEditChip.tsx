import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BLDG_EDIT_OPS,
  opIsEdited,
  useBldgEditStore,
  type BldgEditArmed,
  type BldgEditMenu,
  type BldgEditOp,
  type BldgEditOrigin,
} from "../../store/bldgEdit";
import { useBldgSyncStore, type BldgSyncResult } from "../../store/bldgSync";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import type { FeatureTransform } from "../../lib/globe/featureTransform";
import { formatDims } from "../../lib/format/readout";
import "../../styles/building-edit.css";

/**
 * Building edit chip (U8, owner 2026-08-18; MESH SUITE MS2 2026-09-02; MS3 2026-09-02) — the
 * readout + controls while a building is armed in FPV. Top-level island in BOTH shells
 * (index.astro + m.astro — the SkyContextMenu precedent; never imports from components/mobile/**).
 * Reads the orchestrator's deadband `armed` mirror (store/bldgEdit); writes back only REQUESTS
 * (the op to switch to, per-op revert, RESET ALL, DONE, SYNC). The per-frame numbers pinned to
 * the building itself are the orchestrator-owned DOM label (scene/bldgEditLabel.ts) — this chip
 * is the stable HUD anchor.
 *
 * MS2 shape (owner: "modified AND original values always visible; revert per-op and revert-all"):
 * an op strip (MOVE G · ROTATE R · SCALE S · EXTRUDE E), one row per op with its CURRENT value,
 * its ORIGINAL, and a ↺ when that op is edited, then RESET ALL. The same ops are offered by the
 * context menu below (right-click desktop / long-press glass), anchored at the press point.
 *
 * MS3 (owner: "login required to sync, all meshes synced at once"): the chip foot grows the SYNC
 * button (sign-in gated — the /api/building-overrides POST is member-only), the op strip an
 * ORIGIN badge (SHARED · UNSYNCED · SYNCED), the menu a SYNC item; and while NOTHING is armed but
 * edits are pending, the island renders a small standalone PILL in the same slot so the pending
 * edits are never hidden behind "arm a building first".
 */

export const OP_LABEL: Record<BldgEditOp, string> = {
  move: "MOVE",
  rotate: "ROTATE",
  scale: "SCALE",
  extrude: "EXTRUDE",
};
export const OP_KEY: Record<BldgEditOp, string> = { move: "G", rotate: "R", scale: "S", extrude: "E" };
const OP_GLYPH: Record<BldgEditOp, string> = { move: "↔", rotate: "↻", scale: "⤢", extrude: "↕" };

/** MS3: the origin badge copy (null = no badge — the original building). */
export const ORIGIN_LABEL: Record<BldgEditOrigin, string | null> = {
  none: null,
  shared: "SHARED",
  dirty: "UNSYNCED",
  synced: "SYNCED",
};
const ORIGIN_TITLE: Record<BldgEditOrigin, string> = {
  none: "",
  shared: "Someone shared this edit. Your changes replace it for everyone once you SYNC.",
  dirty: "Your edit is saved in this browser only. SYNC shares it with everyone.",
  synced: "Your edit is shared with everyone.",
};

/** MS3: what the SYNC button says about the re-bake caveat and the rules — one sentence each. */
export const SYNC_TITLE =
  "Share your pending building edits with everyone (sign-in required; the last person to sync a building wins). " +
  "Shared edits key to the building's OSM id, so most survive a city re-bake; one whose building changed shape can still be dropped.";

const sg = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

/** One op's CURRENT value as the chip prints it. The yaw is shown in COMPASS sense (clockwise
 *  from above = the negative of the row's three-sense `rotDeg`); heights as U8 printed them.
 *  MS5b (owner 2026-09-02j): the SCALE row leads with the current footprint in METRES
 *  (`footprintM` × the live scale — the HEIGHT row's precedent) and keeps the factors beside it. */
export function opReadout(
  op: BldgEditOp,
  t: FeatureTransform,
  originalHeightM: number,
  footprintM?: readonly [number, number] | null,
): string {
  switch (op) {
    case "move":
      return `${sg(t.tE)} E · ${sg(t.tN)} N · ↑${t.tU.toFixed(1)} m`;
    case "rotate":
      return `${sg(-t.rotDeg)}° cw`;
    case "scale":
      return footprintM
        ? `${formatDims([footprintM[0] * t.sx, footprintM[1] * t.sz])} (${t.sx.toFixed(2)} × ${t.sz.toFixed(2)})`
        : `${t.sx.toFixed(2)} × ${t.sz.toFixed(2)}`;
    case "extrude":
      return `${(originalHeightM * t.sy).toFixed(1)} m (${sg(originalHeightM * (t.sy - 1))})`;
  }
}

/** One op's ORIGINAL (the baked building) as the chip prints it — the SCALE original is the
 *  mapped footprint in metres when known (MS5b). */
export function opOriginal(op: BldgEditOp, originalHeightM: number, footprintM?: readonly [number, number] | null): string {
  switch (op) {
    case "move":
      return "0.0 E · 0.0 N · ↑0.0 m";
    case "rotate":
      return "0.0° cw";
    case "scale":
      return footprintM ? formatDims(footprintM) : "1.00 × 1.00";
    case "extrude":
      return `${originalHeightM.toFixed(1)} m`;
  }
}

/** MS3: the SYNC affordance's inputs — plain data so the state machine below is unit-testable. */
export interface SyncViewModel {
  /** Pending rows (edits + pending resets). */
  dirty: number;
  member: "member" | "anonymous" | "unknown";
  syncing: boolean;
  result: BldgSyncResult | null;
  /** Injected clock (tests); defaults to Date.now(). */
  nowMs?: number;
}

export type SyncButtonState =
  | { kind: "hidden" }
  | { kind: "sync"; label: string }
  | { kind: "signin"; label: string }
  | { kind: "busy"; label: string }
  | { kind: "done"; label: string }
  | { kind: "retry"; label: string };

/** How long a push's outcome stays on the button before it falls back to the pending count. */
export const SYNC_RESULT_MS = 4000;

/** The SYNC button's state machine (MS3). Order matters: a push in flight beats everything, a
 *  fresh outcome beats the pending count, sign-in beats a retry, nothing pending hides it. */
export function syncButtonState(vm: SyncViewModel): SyncButtonState {
  if (vm.syncing) return { kind: "busy", label: "SYNCING…" };
  const now = vm.nowMs ?? Date.now();
  const fresh = vm.result !== null && now - vm.result.atMs < SYNC_RESULT_MS ? vm.result : null;
  if (fresh?.kind === "synced") return { kind: "done", label: `✓ SYNCED ${fresh.upserted + fresh.removed}` };
  if (vm.dirty === 0) return fresh?.kind === "nothing" ? { kind: "done", label: "✓ IN SYNC" } : { kind: "hidden" };
  if (vm.member === "anonymous" || fresh?.kind === "signed-out")
    return { kind: "signin", label: `SIGN IN TO SYNC ${vm.dirty}` };
  if (fresh?.kind === "failed" || fresh?.kind === "rejected")
    return { kind: "retry", label: `SYNC FAILED · RETRY ${vm.dirty}` };
  return { kind: "sync", label: `⇅ SYNC ${vm.dirty}` };
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
  /** MS3: push the pending edits (the orchestrator gates on the member session). */
  requestSync(): void;
  /** MS3: the sign-in round-trip (returns to this exact view; the pending rows wait in storage). */
  signIn(): void;
}

/** MS3: re-render once a fresh push outcome expires, so the button falls back to the count. */
function useResultExpiry(result: BldgSyncResult | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!result) return;
    const left = SYNC_RESULT_MS - (Date.now() - result.atMs);
    if (left <= 0) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), left + 20);
    return () => window.clearTimeout(id);
  }, [result]);
  return tick;
}

export default function BuildingEditChip() {
  const armed = useBldgEditStore((s) => s.armed);
  const menu = useBldgEditStore((s) => s.menu);
  const setOp = useBldgEditStore((s) => s.setOp);
  const requestRevert = useBldgEditStore((s) => s.requestRevert);
  const requestReset = useBldgEditStore((s) => s.requestReset);
  const requestDisarm = useBldgEditStore((s) => s.requestDisarm);
  const closeMenu = useBldgEditStore((s) => s.closeMenu);
  const dirty = useBldgSyncStore((s) => s.dirty);
  const syncing = useBldgSyncStore((s) => s.syncing);
  const result = useBldgSyncStore((s) => s.result);
  const requestSync = useBldgSyncStore((s) => s.requestSync);
  const memberPhase = useMemberStore((s) => s.phase);
  const refreshMember = useMemberStore((s) => s.refresh);
  useResultExpiry(result);
  // Resolve the session once there is something to sync (MemberBadge does it on desktop; /m's
  // account sheet only when opened — the pill must not say SIGN IN to a signed-in member).
  useEffect(() => {
    if (dirty > 0 && memberPhase === "unknown") void refreshMember();
  }, [dirty, memberPhase, refreshMember]);
  const member = memberPhase === "member" ? "member" : memberPhase === "anonymous" ? "anonymous" : "unknown";
  const sync = syncButtonState({ dirty, member, syncing, result });
  const actions: BuildingEditActions = {
    setOp,
    requestRevert,
    requestReset,
    requestDisarm,
    closeMenu,
    requestSync,
    signIn: () => {
      window.location.href = loginUrl(returnHereUrl());
    },
  };
  if (!armed) return sync.kind === "hidden" ? null : <SyncPill sync={sync} actions={actions} />;
  return <BuildingEditChipView armed={armed} menu={menu} sync={sync} actions={actions} />;
}

/** MS3: the SYNC button (chip foot + pill share it). */
export function SyncButton({
  sync,
  actions,
  className = "bec-sync",
}: {
  sync: SyncButtonState;
  actions: Pick<BuildingEditActions, "requestSync" | "signIn">;
  className?: string;
}) {
  if (sync.kind === "hidden") return null;
  const onClick =
    sync.kind === "signin" ? actions.signIn : sync.kind === "sync" || sync.kind === "retry" ? actions.requestSync : undefined;
  return (
    <button
      type="button"
      className={`${className} ${className}--${sync.kind}`}
      data-sync={sync.kind}
      title={SYNC_TITLE}
      disabled={onClick === undefined}
      onClick={onClick}
    >
      {sync.label}
    </button>
  );
}

/** MS3: nothing armed, edits pending — the standalone pill in the chip's slot (both shells). */
export function SyncPill({ sync, actions }: { sync: SyncButtonState; actions: Pick<BuildingEditActions, "requestSync" | "signIn"> }) {
  return (
    <div className="bldg-sync-pill" role="status">
      <span className="bldg-sync-pill__k">BUILDING EDITS</span>
      <SyncButton sync={sync} actions={actions} />
    </div>
  );
}

export function BuildingEditChipView({
  armed,
  menu,
  sync,
  actions,
}: {
  armed: BldgEditArmed;
  menu: BldgEditMenu | null;
  sync: SyncButtonState;
  actions: BuildingEditActions;
}) {
  const { setOp, requestRevert, requestReset } = actions;
  const spatial = armed.op !== "extrude";
  const originLabel = ORIGIN_LABEL[armed.origin];
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
          {originLabel && (
            <span className="bec-origin" data-origin={armed.origin} title={ORIGIN_TITLE[armed.origin]}>
              {originLabel}
            </span>
          )}
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
                <span className="bec-v">{opReadout(op, armed.live, armed.originalHeightM, armed.footprintM)}</span>
                <span className="bec-was">was {opOriginal(op, armed.originalHeightM, armed.footprintM)}</span>
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
          {!armed.dragging && <SyncButton sync={sync} actions={actions} />}
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
      {menu && <BuildingEditMenu armed={armed} menu={menu} sync={sync} actions={actions} />}
    </>
  );
}

/** The building context menu (right-click desktop / long-press glass): the ops, REVERT ALL,
 *  SYNC (MS3), DONE. The `.skymenu` cut — a static press point, the card floats up-right of it
 *  (so a long-press finger's release lands outside it), viewport-clamped after layout, closed by
 *  a press elsewhere. Canvas presses are the orchestrator's (it closes the menu itself and tells
 *  a "close the menu" tap from a tap-away); Escape is its rung too. */
export function BuildingEditMenu({
  armed,
  menu,
  sync,
  actions,
}: {
  armed: BldgEditArmed;
  menu: BldgEditMenu;
  sync: SyncButtonState;
  actions: BuildingEditActions;
}) {
  const { setOp, closeMenu, requestReset, requestDisarm, requestSync, signIn } = actions;
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

  const originLabel = ORIGIN_LABEL[armed.origin];
  const syncable = sync.kind === "sync" || sync.kind === "retry" || sync.kind === "signin";
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
          {armed.originalHeightM.toFixed(1)} m
          {originLabel ? ` · ${originLabel.toLowerCase()}` : armed.overridden ? " · edited" : ""}
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
      {syncable && (
        <button
          type="button"
          role="menuitem"
          className="bldg-menu__item"
          data-act="sync"
          data-sync={sync.kind}
          title={SYNC_TITLE}
          onClick={() => {
            if (sync.kind === "signin") signIn();
            else requestSync();
            closeMenu();
          }}
        >
          ⇅ {sync.kind === "signin" ? sync.label : sync.label.replace(/^⇅ /, "")}
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
