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
const actions: ModelEditActions = { setOp: noop, requestRevert: noop, requestReset: noop, requestDisarm: noop, closeMenu: noop, requestUndo: noop, requestDrop: noop };
const armed = (over: Partial<ModelEditArmed> = {}): ModelEditArmed => ({
  id: "m1",
  title: "Kiosk",
  mine: true,
  lat: 48.4647,
  lon: 35.0462,
  sizeM: 12.4,
  sizeM3: [12.4, 8, 3.5],
  dragging: false,
  overridden: false,
  op: "move",
  committed: { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 },
  live: { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 },
  saving: false,
  saveError: null,
  undoable: 0,
  sessionEdited: false,
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
    const html = view(armed({ committed: { rotDeg: 30, sx: 1.5, sy: 1.5, sz: 1.5, liftM: 0, pitchDeg: 0, rollDeg: 0 }, live: { rotDeg: 30, sx: 1.5, sy: 1.5, sz: 1.5, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, overridden: true }));
    expect(html).toContain('data-kind="model"');
    expect(html).toContain("48.46470, 35.04620");
    expect(html).toContain("-30.0° cw");
    expect(html).toContain("18.6 × 12.0 × 5.25 m (1.50×)"); // MS5b: metres first, the factor beside
    expect(html).toContain("was where you dropped it");
    expect(html).toContain("was 0.0° cw");
    expect(html).toContain("was 12.4 × 8.00 × 3.50 m");
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
    // T128: a model widened on X alone — the SCALE row is per axis (metres w·sx, the triple),
    // and a single off-1 axis still lights the row's ↺.
    const wide = view(
      armed({
        committed: { rotDeg: 0, sx: 2, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 },
        live: { rotDeg: 0, sx: 2, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 },
        overridden: true,
      }),
    );
    expect(wide).toContain("24.8 × 8.00 × 3.50 m (2.00 × 1.00 × 1.00)");
    expect(wide).toContain('class="bec-revert" data-op="scale"');
    expect(wide).not.toContain('class="bec-revert" data-op="rotate"');
  });

  it("shows the drag offset on MOVE while dragging and hides the reverts", () => {
    const html = view(armed({ dragging: true, live: { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 3.2, tN: -1 }, committed: { rotDeg: 10, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0 }, overridden: true }));
    expect(html).toContain("is-dragging");
    expect(html).toContain("+3.2 E · -1.0 N");
    expect(html).not.toContain('class="bec-revert" data-op=');
    expect(html).not.toContain("RESET ALL");
  });

  it("the save badge reports an in-flight PATCH and a failure", () => {
    expect(view(armed({ saving: true }))).toContain("SAVING…");
    expect(view(armed({ saveError: "SAVE FAILED" }))).toContain("SAVE FAILED");
  });

  it("MS6: another member's model wears the SHARED badge (the MS3 word) and says so in the menu head", () => {
    const own = view(armed());
    expect(own).toContain('data-origin="mine"');
    expect(own).toContain("YOURS");
    const theirs = view(armed({ mine: false }));
    expect(theirs).toContain('data-origin="shared"');
    expect(theirs).toContain("SHARED");
    expect(theirs).not.toContain("YOURS");
    const menu = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed({ mine: false }), menu: { screenX: 0, screenY: 0 }, actions }));
    expect(menu).toContain("· shared");
    const ownMenu = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed(), menu: { screenX: 0, screenY: 0 }, actions }));
    expect(ownMenu).not.toContain("· shared");
  });

  it("the menu carries the title, the size, the ops, REVERT ALL when edited, and DONE", () => {
    const menu = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed({ overridden: true }), menu: { screenX: 10, screenY: 20 }, actions }));
    expect(menu).toContain("MODEL · KIOSK");
    expect(menu).toContain("12.4 × 8.00 × 3.50 m"); // MS5b: the size triple at the committed scale
    expect(menu).toContain('data-act="revert-all"');
    expect(menu).toContain('data-act="done"');
    expect(menu).toContain('data-op="rotate"');
    expect(menu).not.toContain('data-op="extrude"');
    expect(menu).toContain("left:10px");
    const clean = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed(), menu: { screenX: 0, screenY: 0 }, actions }));
    expect(clean).not.toContain('data-act="revert-all"');
  });

  it("readouts are pure", () => {
    expect(modelOpReadout("rotate", { rotDeg: -45, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("+45.0° cw");
    // MS8: the pitch / roll print beside the yaw only when the model is tilted; the original says upright.
    expect(modelOpReadout("rotate", { rotDeg: -45, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 30, rollDeg: -2.5, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe(
      "+45.0° cw · pitch +30.0° · roll -2.5°",
    );
    expect(modelOpReadout("rotate", { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0.01, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("0.0° cw");
    expect(modelOpOriginal("rotate")).toBe("0.0° cw, upright");
    expect(modelOpReadout("scale", { rotDeg: 0, sx: 0.5, sy: 0.5, sz: 0.5, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("0.50×");
    expect(modelOpOriginal("scale")).toBe("1.00×");
    // MS5b: the size triple × the scale, w × d × h.
    expect(modelOpReadout("scale", { rotDeg: 0, sx: 2, sy: 2, sz: 2, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0, sizeM3: [3, 5, 4] })).toBe("6.00 × 10.0 × 8.00 m (2.00×)");
    expect(modelOpOriginal("scale", [3, 5, 4])).toBe("3.00 × 5.00 × 4.00 m");
    // T128: per axis — the metres scale each on their own axis (w·sx, d·sz, h·sy) and the factor
    // becomes the triple in the SAME order (sx × sz × sy) once the axes disagree; with no size
    // the triple stands alone.
    expect(modelOpReadout("scale", { rotDeg: 0, sx: 1.5, sy: 2, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0, sizeM3: [3, 5, 4] })).toBe(
      "4.50 × 5.00 × 8.00 m (1.50 × 1.00 × 2.00)",
    );
    expect(modelOpReadout("scale", { rotDeg: 0, sx: 2, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("2.00 × 1.00 × 1.00");
    expect(modelOpReadout("scale", { rotDeg: 0, sx: 2.004, sy: 2, sz: 1.996, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 0, lon: 0 })).toBe("2.00×"); // inside the eps: one factor
    // MS7: the MOVE row carries the lift whenever the model is off the ground — at rest and mid-drag.
    expect(modelOpReadout("move", { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 0, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 48.4647, lon: 35.0462 })).toBe("48.46470, 35.04620");
    expect(modelOpReadout("move", { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -2.5, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, { lat: 48.4647, lon: 35.0462 })).toBe("48.46470, 35.04620 · ↑-2.5 m");
    expect(modelOpReadout("move", { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: 3, pitchDeg: 0, rollDeg: 0, tE: 3.2, tN: -1 }, { lat: 0, lon: 0 })).toBe("+3.2 E · -1.0 N · ↑+3.0 m");
    expect(modelOpOriginal("move")).toBe("where you dropped it, on the ground");
  });

  it("MS7 — a sunk model lights the MOVE row's ↺ (the lift is MOVE's revertable seat)", () => {
    const html = view(armed({ committed: { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -1.5, pitchDeg: 0, rollDeg: 0 }, live: { rotDeg: 0, sx: 1, sy: 1, sz: 1, liftM: -1.5, pitchDeg: 0, rollDeg: 0, tE: 0, tN: 0 }, overridden: true }));
    expect(html).toContain('class="bec-row is-on is-edited" data-op="move"');
    expect(html).toContain("↑-1.5 m");
    expect(html).toContain("RESET ALL");
  });
});

describe("ModelEditChip — T126 UNDO + DROP SESSION", () => {
  it("the foot shows ↶ UNDO / DROP SESSION from the armed mirror — hidden mid-drag and while a PATCH is in flight", () => {
    expect(view(armed())).not.toContain('data-act="undo"');
    const html = view(armed({ undoable: 1, sessionEdited: true }));
    expect(html).toContain('class="bec-undo" data-act="undo"');
    expect(html).toContain("Undo the last edit on this model (Ctrl+Z)");
    expect(html).toContain('class="bec-drop" data-act="drop-session"');
    expect(view(armed({ undoable: 1, sessionEdited: true, dragging: true }))).not.toContain('data-act="undo"');
    expect(view(armed({ undoable: 1, sessionEdited: true, saving: true }))).not.toContain('data-act="drop-session"');
  });
  it("the menu offers UNDO / DROP SESSION and DROP ALL when other meshes carry session edits", () => {
    const menuAt = { screenX: 10, screenY: 20 };
    const one = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed({ undoable: 1, sessionEdited: true }), menu: menuAt, actions, sessionEdits: 1 }));
    expect(one).toContain('data-act="undo"');
    expect(one).toContain('data-act="drop-session"');
    expect(one).not.toContain('data-act="drop-all"');
    const many = renderToStaticMarkup(createElement(ModelEditMenu, { armed: armed({ undoable: 1, sessionEdited: true }), menu: menuAt, actions, sessionEdits: 4 }));
    expect(many).toContain("DROP ALL SESSION EDITS · 4");
  });
});
