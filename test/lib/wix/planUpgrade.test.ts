import { describe, expect, it } from "vitest";
import { pickUpgradePlan } from "../../../src/lib/wix/planUpgrade";

describe("pickUpgradePlan", () => {
  it("prefers the primary public plan", () => {
    const plans = [
      { _id: "a", primary: false },
      { _id: "b", primary: true },
      { _id: "c" },
    ];
    expect(pickUpgradePlan(plans)?._id).toBe("b");
  });

  it("falls back to the first plan when none is primary", () => {
    const plans: Array<{ _id: string; primary?: boolean }> = [{ _id: "a" }, { _id: "b" }];
    expect(pickUpgradePlan(plans)?._id).toBe("a");
  });

  it("returns null for an empty list (site without a configured plan)", () => {
    expect(pickUpgradePlan([])).toBeNull();
  });
});
