import { beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_EDIT_OPS,
  modelOpIsEdited,
  restingEdit,
  revertModelOp,
  useModelEditStore,
  type ModelEditArmed,
} from "../../src/store/modelEdit";

// MESH SUITE MS5 — the armed-model store: the bldgEdit twin (mirror + request one-shots), the
// per-op edited test and the per-op revert, with MOVE owning a placement that has no original.

const armed = (): ModelEditArmed => ({
  id: "m1",
  title: "Kiosk",
  mine: true,
  lat: 48.4647,
  lon: 35.0462,
  sizeM: 12,
  sizeM3: [12, 8, 4],
  dragging: false,
  overridden: false,
  op: "move",
  committed: { rotDeg: 0, scale: 1, liftM: 0 },
  live: { rotDeg: 0, scale: 1, liftM: 0, tE: 0, tN: 0 },
  saving: false,
  saveError: null,
});

describe("store/modelEdit", () => {
  beforeEach(() => {
    useModelEditStore.setState({ armed: null, op: "move", revertRequest: null, menu: null, disarmRequest: false });
  });

  it("has exactly three ops — no extrude", () => {
    expect(MODEL_EDIT_OPS).toEqual(["move", "rotate", "scale"]);
  });

  it("mirrors the armed model, and a disarm resets the ask to MOVE and closes the menu", () => {
    const s = useModelEditStore.getState();
    s._syncArmed(armed());
    s.setOp("scale");
    s._setMenu({ screenX: 10, screenY: 20 });
    expect(useModelEditStore.getState().armed?.id).toBe("m1");
    expect(useModelEditStore.getState().op).toBe("scale");
    expect(useModelEditStore.getState().menu).toEqual({ screenX: 10, screenY: 20 });
    s._syncArmed(null);
    expect(useModelEditStore.getState()).toMatchObject({ armed: null, op: "move", menu: null });
  });

  it("carries the request one-shots and consumes them", () => {
    const s = useModelEditStore.getState();
    s.requestRevert("rotate");
    expect(useModelEditStore.getState().revertRequest).toBe("rotate");
    s._consumeRevertRequest();
    expect(useModelEditStore.getState().revertRequest).toBeNull();
    s.requestReset();
    expect(useModelEditStore.getState().revertRequest).toBe("all");
    s.requestDisarm();
    expect(useModelEditStore.getState().disarmRequest).toBe(true);
    s._consumeDisarmRequest();
    expect(useModelEditStore.getState().disarmRequest).toBe(false);
    s._setMenu({ screenX: 1, screenY: 2 });
    s.closeMenu();
    expect(useModelEditStore.getState().menu).toBeNull();
  });

  it("MS7 — MOVE owns the lift: edited when off the ground, its revert lands the model, RESET ALL zeroes it too", () => {
    const sunk = { rotDeg: 30, scale: 1.5, liftM: -2 };
    expect(modelOpIsEdited("move", sunk)).toBe(true);
    expect(modelOpIsEdited("move", { rotDeg: 0, scale: 1, liftM: 0.005 })).toBe(false); // under the 1 cm eps
    expect(revertModelOp(sunk, "move")).toEqual({ rotDeg: 30, scale: 1.5, liftM: 0 });
    expect(revertModelOp(sunk, "rotate")).toEqual({ rotDeg: 0, scale: 1.5, liftM: -2 }); // the lift survives another op's ↺
    expect(revertModelOp(sunk, "all")).toEqual({ rotDeg: 0, scale: 1, liftM: 0 });
    expect(restingEdit(sunk)).toEqual({ rotDeg: 30, scale: 1.5, liftM: -2, tE: 0, tN: 0 });
  });

  it("knows which op is edited (MOVE only through the lift) and reverts per op or all", () => {
    const t = { rotDeg: 30, scale: 1.5, liftM: 0 };
    expect(modelOpIsEdited("move", t)).toBe(false);
    expect(modelOpIsEdited("rotate", t)).toBe(true);
    expect(modelOpIsEdited("scale", t)).toBe(true);
    expect(modelOpIsEdited("rotate", { rotDeg: 0.01, scale: 1, liftM: 0 })).toBe(false);
    expect(modelOpIsEdited("scale", { rotDeg: 0, scale: 1.001, liftM: 0 })).toBe(false);
    expect(revertModelOp(t, "rotate")).toEqual({ rotDeg: 0, scale: 1.5, liftM: 0 });
    expect(revertModelOp(t, "scale")).toEqual({ rotDeg: 30, scale: 1, liftM: 0 });
    expect(revertModelOp(t, "move")).toEqual(t);
    expect(revertModelOp(t, "all")).toEqual({ rotDeg: 0, scale: 1, liftM: 0 });
    expect(restingEdit(t)).toEqual({ rotDeg: 30, scale: 1.5, liftM: 0, tE: 0, tN: 0 });
  });
});
