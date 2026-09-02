import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ModelEditChip, {
  MODEL_OP_KEY,
  MODEL_OP_LABEL,
  ModelEditChipView,
  ModelEditMenu,
  modelOpOriginal,
  modelOpReadout,
  type ModelEditActions,
} from "../../src/components/panels/ModelEditChip";
import { useModelEditStore, type ModelEditArmed } from "../../src/store/modelEdit";
import type { BldgEditMenu as MenuAt } from "../../src/store/bldgEdit";

// MESH SUITE MS5 — the model chip: three ops (no extrude), current vs original per op, a ↺ only
// where that op is edited (MOVE never), the save badge, the menu; the same `.bldg-edit-chip` /
// `.bec-*` chrome as the building chip but a `data-kind="model"` root so a harness can tell
// them apart. Views take the state as props (zustand 5 serves a hook its INITIAL state under
// renderToStaticMarkup).

const noop = () => {};
const actions: ModelEditActions = { setOp: noop, requestRevert: noop, requestReset: noop, requestDisarm: noop, closeMenu: noop };
const armed = (over: Partial<ModelEditArmed> = {}): ModelEditArmed => ({
  id: "m1",
  title: "Kiosk",
  mine: true,
  lat: 48.4647,
  lon: 35.0462,
  sizeM: 12.4,
  dragging: false,
  overridden: false,
  op: "move",
  committed: { rotDeg: 0, scale: 1 },
  live: { rotDeg: 0, scale: 1, tE: 0, tN: 0 },
  saving: false,
  saveError: null,
  ...over,
});
const view = (a: ModelEditArmed, menu: MenuAt | null = null) =>
  renderToStaticMarkup(createElement(ModelEditChipView, { armed: a, menu, actions }));

describe("ModelEditChip (MS5)", () => {
  beforeEach(() => {
    useModelEditStore.setState({ armed: null, op: "move", revertRequest: null, menu: null, disarmRequest: false });
  });

  it("renders nothing while nothing is armed (the island)", () => {
    expect(renderToStaticMarkup(createElement(ModelEditChip))).toBe("");
  });

  it("prints every op's current vs original and marks the model root as a model", () => {
    const html = view(armed({ committed: { rotDeg: 30, scale: 1.5 }, live: { rotDeg: 30, scale: 1.5, tE: 0, tN: 0 }, overridden: true }));
    expect(html).toContain('data-kind="model"');
    expect(html).toContain("48.46470, 35.04620");
    expect(html).toContain("-30.0° cw");
    expect(html).toContain("1.50×");
    expect(html).toContain("was where you dropped it");
    expect(html).toContain("was 0.0° cw");
    expect(html).toContain("was 1.00×");
    expect(html).not.toContain("EXTRUDE");
    expect(html).toContain("YOURS");
    // A ↺ for the two edited ops, never for MOVE; RESET ALL in the foot.
    expect((html.match(/class="bec-revert" data-op="/g) ?? []).length).toBe(2);
    expect(html).not.toContain('class="bec-revert" data-op="move"');
    expect(html).toContain("RESET ALL");
    expect(html).toContain("bec-reset");
    for (const op of ["move", "rotate", "scale"] as const) {
      expect(html).toContain(`<kbd>${MODEL_OP_KEY[op]}</kbd>`);
      expect(html).toContain(MODEL_OP_LABEL[op]);
    }
  });

  it("shows the drag offset on MOVE while dragging and hides the reverts", () => {
    const html = view(armed({ dragging: true, live: { rotDeg: 0, scale: 1, tE: 3.2, tN: -1 }, committed: { rotDeg: 10, scale: 1 }, overridden: true }));
    expect(html).toContain("is-dragging");
    expect(html).toContain("+3.2 E · -1.0 N");
    expect(html).not.toContain('class="bec-revert" data-op=');
    expect(html).not.toContain("RESET ALL");
  });

  it("the save badge reports an in-flight PATCH and a failure", () => {
    expect(view(armed({ saving: true }))).toContain("SAVING…");
    expect(view(armed({ saveError: "SAVE FAILED" }))).toContain("SAVE FAILED");
  });

  it("the menu carries the title, the size, the ops, REVERT ALL when edited, and DONE", () => {
    const menu = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed({ overridden: true }), menu: { screenX: 10, screenY: 20 }, actions }));
    expect(menu).toContain("MODEL · KIOSK");
    expect(menu).toContain("12.4 m");
    expect(menu).toContain('data-act="revert-all"');
    expect(menu).toContain('data-act="done"');
    expect(menu).toContain('data-op="rotate"');
    expect(menu).not.toContain('data-op="extrude"');
    expect(menu).toContain("left:10px");
    const clean = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed(), menu: { screenX: 0, screenY: 0 }, actions }));
    expect(clean).not.toContain('data-act="revert-all"');
  });

  it("readouts are pure", () => {
    expect(modelOpReadout("rotate", { rotDeg: -45, scale: 1, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("+45.0° cw");
    expect(modelOpReadout("scale", { rotDeg: 0, scale: 0.5, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("0.50×");
    expect(modelOpOriginal("scale")).toBe("1.00×");
  });
});
