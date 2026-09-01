import { beforeEach, describe, expect, it } from "vitest";
import {
  BLDG_EDIT_OPS,
  opIsEdited,
  revertOp,
  useBldgEditStore,
  type BldgEditArmed,
} from "../../src/store/bldgEdit";
import { IDENTITY_TRANSFORM, type FeatureTransform } from "../../src/lib/globe/featureTransform";

// MESH SUITE MS2 — the chip ⇄ orchestrator seam: requests are one-shots the frame service
// consumes, the applied op rides the mirror, and a disarm resets the session asks in ONE place.

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

describe("bldgEdit store (MS2 requests)", () => {
  beforeEach(() => {
    useBldgEditStore.setState({
      armed: null,
      op: "extrude",
      revertRequest: null,
      menu: null,
      disarmRequest: false,
    });
  });

  it("boots disarmed at EXTRUDE (the U8 default op) with no asks pending", () => {
    const s = useBldgEditStore.getState();
    expect(s.armed).toBeNull();
    expect(s.op).toBe("extrude");
    expect(s.revertRequest).toBeNull();
    expect(s.menu).toBeNull();
    expect(s.disarmRequest).toBe(false);
  });

  it("setOp is a plain ask; the orchestrator mirrors the APPLIED op on armed.op", () => {
    const s = useBldgEditStore.getState();
    s.setOp("move");
    expect(useBldgEditStore.getState().op).toBe("move");
    s._syncArmed(armed({ op: "move" }));
    expect(useBldgEditStore.getState().armed?.op).toBe("move");
  });

  it("revert one-shots: per-op, and RESET (U8 compat) = revert all; consumed explicitly", () => {
    const s = useBldgEditStore.getState();
    s.requestRevert("rotate");
    expect(useBldgEditStore.getState().revertRequest).toBe("rotate");
    s._consumeRevertRequest();
    expect(useBldgEditStore.getState().revertRequest).toBeNull();
    s.requestReset();
    expect(useBldgEditStore.getState().revertRequest).toBe("all");
  });

  it("the menu is a static point; DONE is a one-shot", () => {
    const s = useBldgEditStore.getState();
    s._setMenu({ screenX: 640, screenY: 480 });
    expect(useBldgEditStore.getState().menu).toEqual({ screenX: 640, screenY: 480 });
    s.closeMenu();
    expect(useBldgEditStore.getState().menu).toBeNull();
    s.requestDisarm();
    expect(useBldgEditStore.getState().disarmRequest).toBe(true);
    s._consumeDisarmRequest();
    expect(useBldgEditStore.getState().disarmRequest).toBe(false);
  });

  it("disarming resets the op ask to EXTRUDE and closes the menu — the next arm starts clean", () => {
    const s = useBldgEditStore.getState();
    s._syncArmed(armed({ op: "scale" }));
    s.setOp("scale");
    s._setMenu({ screenX: 1, screenY: 2 });
    s._syncArmed(null);
    const after = useBldgEditStore.getState();
    expect(after.armed).toBeNull();
    expect(after.op).toBe("extrude");
    expect(after.menu).toBeNull();
  });

  it("a re-sync while armed keeps the op ask (the mirror does not clobber the chip's tab)", () => {
    const s = useBldgEditStore.getState();
    s.setOp("rotate");
    s._syncArmed(armed({ op: "extrude" })); // the orchestrator has not applied it yet
    expect(useBldgEditStore.getState().op).toBe("rotate");
  });
});

describe("opIsEdited / revertOp (the op ↔ component ownership)", () => {
  const T: FeatureTransform = { sx: 1.2, sz: 1, sy: 1.4, rotDeg: 25, tE: 6, tN: -4, tU: 1.5 };

  it("each op owns exactly its components", () => {
    expect(opIsEdited("move", { ...IDENTITY_TRANSFORM, tU: 0.5 })).toBe(true);
    expect(opIsEdited("move", { ...IDENTITY_TRANSFORM, rotDeg: 10 })).toBe(false);
    expect(opIsEdited("rotate", { ...IDENTITY_TRANSFORM, rotDeg: 10 })).toBe(true);
    expect(opIsEdited("rotate", { ...IDENTITY_TRANSFORM, sx: 2 })).toBe(false);
    expect(opIsEdited("scale", { ...IDENTITY_TRANSFORM, sz: 1.1 })).toBe(true);
    expect(opIsEdited("scale", { ...IDENTITY_TRANSFORM, sy: 2 })).toBe(false);
    expect(opIsEdited("extrude", { ...IDENTITY_TRANSFORM, sy: 2 })).toBe(true);
    expect(opIsEdited("extrude", { ...IDENTITY_TRANSFORM, sx: 2 })).toBe(false);
  });

  it("sub-threshold gizmo noise is not an edit (the row neutrality thresholds)", () => {
    expect(opIsEdited("move", { ...IDENTITY_TRANSFORM, tE: 0.004 })).toBe(false);
    expect(opIsEdited("rotate", { ...IDENTITY_TRANSFORM, rotDeg: 0.04 })).toBe(false);
    expect(opIsEdited("scale", { ...IDENTITY_TRANSFORM, sx: 1.004 })).toBe(false);
  });

  it("revertOp restores ONE op's components and leaves the others (all = identity)", () => {
    expect(revertOp(T, "move")).toEqual({ ...T, tE: 0, tN: 0, tU: 0 });
    expect(revertOp(T, "rotate")).toEqual({ ...T, rotDeg: 0 });
    expect(revertOp(T, "scale")).toEqual({ ...T, sx: 1, sz: 1 });
    expect(revertOp(T, "extrude")).toEqual({ ...T, sy: 1 });
    expect(revertOp(T, "all")).toEqual({ ...IDENTITY_TRANSFORM });
    // Reverting every op one by one is the same as reverting all.
    let t = T;
    for (const op of BLDG_EDIT_OPS) t = revertOp(t, op);
    expect(t).toEqual({ ...IDENTITY_TRANSFORM });
  });
});
