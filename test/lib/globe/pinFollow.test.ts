/**
 * Owner order 2026-09-30 — THE PIN FOLLOWS THE WALKER. The settle rule runs for real; the
 * orchestrator's re-base is source-pinned (the repo idiom — `fpvTransitions2026-09-22.test.ts`),
 * and the behaviour itself is the browser twin `scripts/verify-followups-2026-09-30.mjs` (the pin
 * lands on the eye, the eye does not move, a long-press still places a point elsewhere).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FPV } from "../../../src/components/globe/tuning";
import { pinFollowDue } from "../../../src/lib/globe/pinFollow";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const ORCH = read("src/components/globe/StylizedTiles.ts");

describe("pinFollowDue — the pin moves when the walk has SETTLED, never per frame", () => {
  const due = (walkM: number, idleMs: number) => pinFollowDue(walkM, idleMs, FPV.pinFollowMinM, FPV.pinFollowSettleMs);

  it("waits for the walker to stand still", () => {
    expect(due(12, 0)).toBe(false); // mid-stride
    expect(due(12, FPV.pinFollowSettleMs - 1)).toBe(false);
    expect(due(12, FPV.pinFollowSettleMs)).toBe(true);
    expect(due(12, 60_000)).toBe(true);
  });

  it("ignores a walk that went nowhere (float dust, a brushed stick)", () => {
    expect(due(0, 60_000)).toBe(false);
    expect(due(FPV.pinFollowMinM / 2, 60_000)).toBe(false);
    expect(due(FPV.pinFollowMinM, 60_000)).toBe(true);
  });

  it("never fires on garbage", () => {
    expect(due(Number.NaN, 60_000)).toBe(false);
    expect(due(5, Number.NaN)).toBe(false);
  });

  it("the settle is short enough to feel immediate and long enough to ride out a re-grip", () => {
    expect(FPV.pinFollowSettleMs).toBeGreaterThanOrEqual(200);
    expect(FPV.pinFollowSettleMs).toBeLessThanOrEqual(1000);
    expect(FPV.pinFollowMinM).toBeGreaterThan(0);
    expect(FPV.pinFollowMinM).toBeLessThan(1);
  });
});

describe("the orchestrator's re-base (source-pinned)", () => {
  const follow = ORCH.slice(ORCH.indexOf("const followPinToEye = () => {"), ORCH.indexOf("const stepFpvPose = () => {"));

  it("exists, and takes the ground point under the eye — the eye minus every vertical term", () => {
    expect(follow.length).toBeGreaterThan(100);
    expect(follow).toMatch(/copy\(camera\.position\)\.addScaledVector\(_fpvUpGeo, -\(fpvEyeM \+ fpvMeshLiftM\)\)/);
  });

  it("seeds the pin's ground and claims the key BEFORE the store write (no re-sample from nothing, no pin-change re-seat)", () => {
    const write = follow.indexOf("setTempPin(");
    expect(write).toBeGreaterThan(0);
    for (const seed of ["tempPinKey = key", "tempPinAppliedM = g.altM", "tempPinSampled = true", "fpvPinKey = key"]) {
      const at = follow.indexOf(seed);
      expect(at, seed).toBeGreaterThan(0);
      expect(at, `${seed} must precede the store write`).toBeLessThan(write);
    }
    expect(follow.slice(write)).toMatch(/reseatTempBasis\(pinP\)/);
  });

  it("KEEPS the mesh floor (the same column) — only a pin placed elsewhere resets it", () => {
    expect(follow.replace(/\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(/fpvMeshFloorAbsM|fpvMeshLiftM = 0/);
    const reseat = ORCH.slice(ORCH.indexOf("if (pinKey !== fpvPinKey) {"), ORCH.indexOf("camera.position.copy(pinP).addScaledVector(_tempUp0, fpvEyeM);"));
    expect(reseat).toMatch(/reseatTempBasis\(pinP\);\s*fpvMeshFloorAbsM = null;/);
  });

  it("fires for a TEMP pin only, from the settle rule, after this frame's final look", () => {
    const at = ORCH.indexOf("followPinToEye();");
    const trigger = ORCH.slice(ORCH.lastIndexOf("camera.updateMatrixWorld();", at), at);
    expect(trigger).toMatch(/if \(keysOn \|\| stickOn\) fpvWalkLastInputMs = now;/);
    expect(trigger).toMatch(/fpvKind === "temp" &&\s*pinFollowDue\(fpvWalkOffset\.length\(\), now - fpvWalkLastInputMs, FPV\.pinFollowMinM, FPV\.pinFollowSettleMs\)/);
    // A photo's point is its placement: nothing here may write one.
    expect(follow).not.toMatch(/useUploadStore|placement/);
  });
});
