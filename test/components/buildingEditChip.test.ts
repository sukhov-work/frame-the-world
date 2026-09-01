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
  type BuildingEditActions,
} from "../../src/components/panels/BuildingEditChip";
import { useBldgEditStore, type BldgEditArmed, type BldgEditMenu as MenuAt } from "../../src/store/bldgEdit";
import { IDENTITY_TRANSFORM } from "../../src/lib/globe/featureTransform";

// MESH SUITE MS2 — the chip renders every op's current vs original, a ↺ only where that op is
// edited, and keeps the two hooks the U8 browser harness drives: `.bldg-edit-chip` and
// `.bec-reset` (verify-bldg-override.mjs clicks the latter through the store's requestReset).
// The VIEWS take the state as props: zustand 5 serves a store hook its INITIAL state under
// renderToStaticMarkup, so the island itself can only be asserted disarmed here.

const noop = () => {};
const actions: BuildingEditActions = {
  setOp: noop,
  requestRevert: noop,
  requestReset: noop,
  requestDisarm: noop,
  closeMenu: noop,
};
const view = (a: BldgEditArmed, menu: MenuAt | null = null) =>
  renderToStaticMarkup(createElement(BuildingEditChipView, { armed: a, menu, actions }));

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
  ...over,
});
const render = () => renderToStaticMarkup(createElement(BuildingEditChip));

describe("BuildingEditChip (MS2)", () => {
  beforeEach(() => {
    useBldgEditStore.setState({ armed: null, op: "extrude", revertRequest: null, menu: null, disarmRequest: false });
  });

  it("renders nothing while disarmed", () => {
    expect(render()).toBe("");
  });

  it("fresh arm: four op tabs with their keys, four rows at the original, no ↺, no RESET", () => {
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

  it("while dragging the reverts and RESET hide (U8: never mid-gesture) and the chip lights up", () => {
    const committed = { ...IDENTITY_TRANSFORM, sx: 1.5 };
    const html = view(armed({ committed, live: committed, overridden: true, dragging: true, op: "scale" }));
    expect(html).toContain('class="bldg-edit-chip is-dragging"');
    expect(html).not.toContain('class="bec-revert"');
    expect(html).not.toContain("bec-reset");
  });

  it("the context menu renders the ops, REVERT ALL only when edited, and DONE at the press point", () => {
    const a = armed({ overridden: true, committed: { ...IDENTITY_TRANSFORM, sy: 2 } });
    const html = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: a, menu: { screenX: 640, screenY: 480 }, actions }),
    );
    expect(html).toContain('class="bldg-menu"');
    expect(html).toContain("left:640px;top:480px");
    for (const op of ["move", "rotate", "scale", "extrude"]) expect(html).toContain(`data-op="${op}"`);
    expect(html).toContain('data-act="revert-all"');
    expect(html).toContain('data-act="done"');
    const plain = renderToStaticMarkup(
      createElement(BuildingEditMenu, { armed: armed(), menu: { screenX: 1, screenY: 2 }, actions }),
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
