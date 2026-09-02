import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BuildingEditChip, {
  BuildingEditChipView,
  BuildingEditMenu,
  OP_KEY,
  OP_LABEL,
  opOriginal,
  opReadout,
  SyncPill,
  SYNC_RESULT_MS,
  syncButtonState,
  type BuildingEditActions,
  type SyncButtonState,
} from "../../src/components/panels/BuildingEditChip";
import { useBldgEditStore, type BldgEditArmed, type BldgEditMenu as MenuAt } from "../../src/store/bldgEdit";
import { useBldgSyncStore } from "../../src/store/bldgSync";
import { IDENTITY_TRANSFORM } from "../../src/lib/globe/featureTransform";

// MESH SUITE MS2 — the chip renders every op's current vs original, a ↺ only where that op is
// edited, and keeps the two hooks the U8 browser harness drives: `.bldg-edit-chip` and
// `.bec-reset` (verify-bldg-override.mjs clicks the latter through the store's requestReset).
// MS3 — the SYNC button (sign-in gated), the origin badge, the menu's SYNC item and the pill.
// The VIEWS take the state as props: zustand 5 serves a store hook its INITIAL state under
// renderToStaticMarkup, so the island itself can only be asserted disarmed here.

const noop = () => {};
const actions: BuildingEditActions = {
  setOp: noop,
  requestRevert: noop,
  requestReset: noop,
  requestDisarm: noop,
  closeMenu: noop,
  requestSync: noop,
  signIn: noop,
};
const HIDDEN: SyncButtonState = { kind: "hidden" };
const view = (a: BldgEditArmed, menu: MenuAt | null = null, sync: SyncButtonState = HIDDEN) =>
  renderToStaticMarkup(createElement(BuildingEditChipView, { armed: a, menu, sync, actions }));

const armed = (over: Partial<BldgEditArmed> = {}): BldgEditArmed => ({
  featureId: 7,
  cellUri: "cell-10-10.glb",
  originalHeightM: 24.5,
  liveHeightM: 24.5,
  deltaM: 0,
  dragging: false,
  overridden: false,
  op: "extrude",
  committed: { ...IDENTITY_TRANSFORM },
  live: { ...IDENTITY_TRANSFORM },
  origin: "none",
  ...over,
});
const render = () => renderToStaticMarkup(createElement(BuildingEditChip));

describe("BuildingEditChip (MS2)", () => {
  beforeEach(() => {
    useBldgEditStore.setState({ armed: null, op: "extrude", revertRequest: null, menu: null, disarmRequest: false });
    useBldgSyncStore.setState({ dirty: 0, syncing: false, result: null, syncRequest: false });
  });

  it("renders nothing while disarmed with nothing pending", () => {
    expect(render()).toBe("");
  });

  it("fresh arm: four op tabs with their keys, four rows at the original, no ↺, no RESET, no badge, no SYNC", () => {
    const html = view(armed());
    expect(html).toContain('class="bldg-edit-chip"');
    for (const op of ["move", "rotate", "scale", "extrude"] as const) {
      expect(html).toContain(`data-op="${op}"`);
      expect(html).toContain(`${OP_LABEL[op]}<kbd>${OP_KEY[op]}</kbd>`);
    }
    expect(html).toContain('class="bec-op is-on"'); // the extrude tab (U8 default) is lit
    expect(html.match(/class="bec-row( [^"]*)?"/g)?.length).toBe(4); // (not the .bec-rows grid)
    expect(html).not.toContain('class="bec-revert"');
    expect(html).not.toContain("bec-reset");
    expect(html).not.toContain("bec-origin");
    expect(html).not.toContain("bec-sync");
    expect(html).toContain("was 0.0 E · 0.0 N · ↑0.0 m");
    expect(html).toContain("was 24.5 m");
  });

  it("an edited op shows its current value, its original, and a ↺ — and RESET ALL appears", () => {
    const committed = { ...IDENTITY_TRANSFORM, rotDeg: 25, tE: 6, tN: -4 };
    const html = view(armed({ committed, live: committed, overridden: true, op: "rotate" }));
    expect(html).toContain("-25.0° cw"); // compass sense: three's +25 CCW is 25° clockwise NEGATIVE
    expect(html).toContain("+6.0 E · -4.0 N · ↑0.0 m");
    expect(html).toContain('class="bec-revert" data-op="rotate"');
    expect(html).toContain('class="bec-revert" data-op="move"');
    expect(html).not.toContain('class="bec-revert" data-op="scale"');
    expect(html).not.toContain('class="bec-revert" data-op="extrude"');
    expect(html).toContain('class="bec-reset"');
    expect(html).toContain("RESET ALL");
    expect(html).toContain("drag a handle"); // the spatial-op hint
  });

  it("while dragging the reverts, RESET and SYNC hide (U8: never mid-gesture) and the chip lights up", () => {
    const committed = { ...IDENTITY_TRANSFORM, sx: 1.5 };
    const html = view(armed({ committed, live: committed, overridden: true, dragging: true, op: "scale" }), null, {
      kind: "sync",
      label: "⇅ SYNC 1",
    });
    expect(html).toContain('class="bldg-edit-chip is-dragging"');
    expect(html).not.toContain('class="bec-revert"');
    expect(html).not.toContain("bec-reset");
    expect(html).not.toContain("bec-sync");
  });

  it("the context menu renders the ops, REVERT ALL only when edited, and DONE at the press point", () => {
    const a = armed({ overridden: true, committed: { ...IDENTITY_TRANSFORM, sy: 2 } });
    const html = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: a, menu: { screenX: 640, screenY: 480 }, sync: HIDDEN, actions }),
    );
    expect(html).toContain('class="bldg-menu"');
    expect(html).toContain("left:640px;top:480px");
    for (const op of ["move", "rotate", "scale", "extrude"]) expect(html).toContain(`data-op="${op}"`);
    expect(html).toContain('data-act="revert-all"');
    expect(html).toContain('data-act="done"');
    expect(html).not.toContain('data-act="sync"');
    const plain = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: armed(), menu: { screenX: 1, screenY: 2 }, sync: HIDDEN, actions }),
    );
    expect(plain).not.toContain('data-act="revert-all"');
    // The view renders the menu only while it is handed one.
    expect(view(a, { screenX: 10, screenY: 20 })).toContain('class="bldg-menu"');
    expect(view(a, null)).not.toContain('class="bldg-menu"');
  });

  it("opReadout / opOriginal print heights as U8 did and never a −0", () => {
    expect(opReadout("extrude", { ...IDENTITY_TRANSFORM, sy: 1.4 }, 24.5)).toBe("34.3 m (+9.8)");
    expect(opOriginal("extrude", 24.5)).toBe("24.5 m");
    expect(opReadout("rotate", IDENTITY_TRANSFORM, 1)).toBe("0.0° cw");
    expect(opReadout("scale", { ...IDENTITY_TRANSFORM, sx: 1.25, sz: 0.8 }, 1)).toBe("1.25 × 0.80");
    expect(opReadout("move", { ...IDENTITY_TRANSFORM, tE: -3.25, tN: 2, tU: 1.5 }, 1)).toBe("-3.3 E · +2.0 N · ↑1.5 m");
  });
});

describe("BuildingEditChip (MS3 — world sync)", () => {
  const t0 = 1_000_000;
  const res = (kind: "synced" | "nothing" | "signed-out" | "rejected" | "failed", atMs = t0, upserted = 2, removed = 1) => ({
    kind,
    upserted,
    removed,
    atMs,
  });

  it("syncButtonState: the state machine, in priority order", () => {
    const vm = { dirty: 3, member: "member" as const, syncing: false, result: null, nowMs: t0 };
    expect(syncButtonState(vm)).toEqual({ kind: "sync", label: "⇅ SYNC 3" });
    expect(syncButtonState({ ...vm, syncing: true })).toEqual({ kind: "busy", label: "SYNCING…" });
    expect(syncButtonState({ ...vm, member: "anonymous" })).toEqual({ kind: "signin", label: "SIGN IN TO SYNC 3" });
    expect(syncButtonState({ ...vm, member: "unknown" })).toEqual({ kind: "sync", label: "⇅ SYNC 3" }); // resolving — assume the best
    expect(syncButtonState({ ...vm, dirty: 0 })).toEqual({ kind: "hidden" });
    expect(syncButtonState({ ...vm, result: res("synced") })).toEqual({ kind: "done", label: "✓ SYNCED 3" });
    expect(syncButtonState({ ...vm, dirty: 0, result: res("synced") })).toEqual({ kind: "done", label: "✓ SYNCED 3" });
    expect(syncButtonState({ ...vm, dirty: 0, result: res("nothing") })).toEqual({ kind: "done", label: "✓ IN SYNC" });
    expect(syncButtonState({ ...vm, result: res("signed-out") })).toEqual({ kind: "signin", label: "SIGN IN TO SYNC 3" });
    expect(syncButtonState({ ...vm, result: res("failed") })).toEqual({ kind: "retry", label: "SYNC FAILED · RETRY 3" });
    expect(syncButtonState({ ...vm, result: res("rejected") })).toEqual({ kind: "retry", label: "SYNC FAILED · RETRY 3" });
    // An outcome expires: after SYNC_RESULT_MS the button is back to the pending count.
    expect(syncButtonState({ ...vm, result: res("failed"), nowMs: t0 + SYNC_RESULT_MS })).toEqual({ kind: "sync", label: "⇅ SYNC 3" });
    expect(syncButtonState({ ...vm, dirty: 0, result: res("synced"), nowMs: t0 + SYNC_RESULT_MS })).toEqual({ kind: "hidden" });
  });

  it("the chip foot carries the SYNC button and the op strip the origin badge", () => {
    const committed = { ...IDENTITY_TRANSFORM, sy: 2 };
    const html = view(armed({ committed, live: committed, overridden: true, origin: "dirty" }), null, { kind: "sync", label: "⇅ SYNC 2" });
    expect(html).toContain('class="bec-sync bec-sync--sync" data-sync="sync"');
    expect(html).toContain("⇅ SYNC 2");
    expect(html).toContain('class="bec-origin" data-origin="dirty"');
    expect(html).toContain("UNSYNCED");
    expect(view(armed({ committed, live: committed, overridden: true, origin: "shared" }))).toContain("SHARED");
    expect(view(armed({ committed, live: committed, overridden: true, origin: "synced" }))).toContain("SYNCED");
    const signin = view(armed(), null, { kind: "signin", label: "SIGN IN TO SYNC 2" });
    expect(signin).toContain('data-sync="signin"');
    expect(signin).toContain("SIGN IN TO SYNC 2");
    const busy = view(armed(), null, { kind: "busy", label: "SYNCING…" });
    expect(busy).toContain('data-sync="busy"');
    expect(busy).toContain("disabled");
  });

  it("the menu offers SYNC (or SIGN IN) only when something can be pushed, and names a shared edit in its head", () => {
    const a = armed({ overridden: true, committed: { ...IDENTITY_TRANSFORM, sy: 2 }, origin: "shared" });
    const html = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: a, menu: { screenX: 1, screenY: 2 }, sync: { kind: "sync", label: "⇅ SYNC 2" }, actions }),
    );
    expect(html).toContain('data-act="sync" data-sync="sync"');
    expect(html).toContain("⇅ SYNC 2");
    expect(html).toContain("24.5 m · shared");
    const signin = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: a, menu: { screenX: 1, screenY: 2 }, sync: { kind: "signin", label: "SIGN IN TO SYNC 2" }, actions }),
    );
    expect(signin).toContain("SIGN IN TO SYNC 2");
    const busy = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: a, menu: { screenX: 1, screenY: 2 }, sync: { kind: "busy", label: "SYNCING…" }, actions }),
    );
    expect(busy).not.toContain('data-act="sync"');
  });

  it("the standalone pill renders the SYNC button while nothing is armed", () => {
    const html = renderToStaticMarkup(createElement(SyncPill, { sync: { kind: "sync", label: "⇅ SYNC 4" }, actions }));
    expect(html).toContain('class="bldg-sync-pill"');
    expect(html).toContain("BUILDING EDITS");
    expect(html).toContain("⇅ SYNC 4");
  });
});
