import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTwistTracker, wrapDelta } from "../../../src/lib/globe/twistTracker";
import { CONTROLS, MOBILE2D } from "../../../src/components/globe/tuning";

/**
 * THE TWO-FINGER TWIST (owner 2026-09-08b). The library has no twist (PointerTracker measures no
 * angle; its touch classifier is pinch-vs-parallel-drag, one-shot); this tracker is the repo's.
 * What must hold: touch only; arms past `twistArmDeg`; the first take catches the map up to the
 * fingers (1:1 from the gesture's start); unwraps across ±π; a third finger ends it; the ended
 * gesture reports whether it had armed (the inertia zero); the orchestrator applies it BEFORE
 * `controls.update()` with the world-follows-fingers sign and cancels the library's drift term.
 */

const ARM = (4 * Math.PI) / 180;
/** Two fingers on a circle of radius r about (cx, cy), at angle θ (rad) — the pure twist shape. */
const pair = (theta: number, r = 100, cx = 200, cy = 300) => [
  { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) },
  { x: cx - r * Math.cos(theta), y: cy - r * Math.sin(theta) },
];

describe("wrapDelta", () => {
  it("wraps to (−π, π]", () => {
    expect(wrapDelta(0.1)).toBeCloseTo(0.1);
    expect(wrapDelta(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1);
    expect(wrapDelta(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1);
    expect(wrapDelta(Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("createTwistTracker", () => {
  it("ignores a mouse, arms past the threshold, and the first take carries the whole angle", () => {
    const t = createTwistTracker(ARM);
    t.down(1, 0, 0, "mouse");
    t.down(2, 100, 0, "mouse");
    expect(t.pairDown()).toBe(false);
    t.reset();
    const [a, b] = pair(0);
    t.down(1, a.x, a.y, "touch");
    t.down(2, b.x, b.y, "touch");
    expect(t.pairDown()).toBe(true);
    expect(t.live()).toBe(false);
    // 2° — under the threshold: nothing to take, not live
    let [a2, b2] = pair((2 * Math.PI) / 180);
    t.move(1, a2.x, a2.y);
    t.move(2, b2.x, b2.y);
    expect(t.take()).toBe(0);
    expect(t.live()).toBe(false);
    // 5° — armed; the take is the WHOLE 5° (catch-up), then 0
    [a2, b2] = pair((5 * Math.PI) / 180);
    t.move(1, a2.x, a2.y);
    t.move(2, b2.x, b2.y);
    expect(t.live()).toBe(true);
    expect(t.take()).toBeCloseTo((5 * Math.PI) / 180, 9);
    expect(t.take()).toBe(0);
    // a further 10° clockwise (screen y-down: atan2 grows) → +10°
    [a2, b2] = pair((15 * Math.PI) / 180);
    t.move(1, a2.x, a2.y);
    t.move(2, b2.x, b2.y);
    expect(t.take()).toBeCloseTo((10 * Math.PI) / 180, 9);
    // lifting a finger of the pair ends it, and reports it had armed
    expect(t.up(1)).toBe(true);
    expect(t.pairDown()).toBe(false);
    expect(t.live()).toBe(false);
    expect(t.take()).toBe(0);
  });

  it("a pinch (separation only) never arms; a pure twist never depends on the radius", () => {
    const t = createTwistTracker(ARM);
    t.down(1, 100, 300, "touch");
    t.down(2, 300, 300, "touch");
    for (let i = 1; i <= 20; i++) {
      t.move(1, 100 - i * 5, 300);
      t.move(2, 300 + i * 5, 300);
    }
    expect(t.live()).toBe(false);
    expect(t.up(2)).toBe(false); // ended unarmed → no inertia zero needed
    // a twist of 30° at r = 40 and at r = 400 both read 30°
    for (const r of [40, 400]) {
      const s = createTwistTracker(ARM);
      let [a, b] = pair(0, r);
      s.down(1, a.x, a.y, "touch");
      s.down(2, b.x, b.y, "touch");
      [a, b] = pair((30 * Math.PI) / 180, r);
      s.move(1, a.x, a.y);
      s.move(2, b.x, b.y);
      expect(s.take()).toBeCloseTo((30 * Math.PI) / 180, 9);
    }
  });

  it("unwraps across ±π and accumulates a full turn in steps", () => {
    const t = createTwistTracker(ARM);
    let [a, b] = pair(3.0); // near +π
    t.down(1, a.x, a.y, "touch");
    t.down(2, b.x, b.y, "touch");
    let total = 0;
    for (let k = 1; k <= 36; k++) {
      [a, b] = pair(3.0 + k * (Math.PI / 18)); // 10° steps through the wrap
      t.move(1, a.x, a.y);
      t.move(2, b.x, b.y);
      total += t.take();
    }
    expect(total).toBeCloseTo(2 * Math.PI, 6);
  });

  it("a third finger ends the twist; when it leaves, the remaining two start fresh", () => {
    const t = createTwistTracker(ARM);
    let [a, b] = pair(0);
    t.down(1, a.x, a.y, "touch");
    t.down(2, b.x, b.y, "touch");
    [a, b] = pair((10 * Math.PI) / 180);
    t.move(1, a.x, a.y);
    t.move(2, b.x, b.y);
    expect(t.live()).toBe(true);
    t.down(3, 50, 50, "touch");
    expect(t.pairDown()).toBe(false);
    expect(t.take()).toBe(0);
    expect(t.up(3)).toBe(false);
    expect(t.pairDown()).toBe(true);
    expect(t.live()).toBe(false); // fresh: the earlier 10° is not carried
  });
});

describe("the orchestrator's twist step", () => {
  const src = readFileSync(join(process.cwd(), "src/components/globe/StylizedTiles.ts"), "utf8");

  it("runs BEFORE controls.update (pre-update centre delta), applies x = −Δ and cancels the library's drift azimuth", () => {
    expect(src).toMatch(/stepZoomBrakeAndEase\(\);\s*\n\s*stepTouchTwist\(\);[^\n]*\n\s*stepControlsUpdate\(\);/);
    const step = src.slice(src.indexOf("const stepTouchTwist = () => {"), src.indexOf("const stepControlsUpdate = () => {"));
    expect(step).toMatch(/let x = -d \* CONTROLS\.twistGain;/);
    expect(step).toMatch(/zc\.state === 2 \/\* ROTATE \*\/ && zc\.pointerTracker\.isPointerTouch\(\)/);
    // the library's drift azimuth cancelled exactly: Δx of the midpoint × 2π / clientHeight (T129 folded
    // `libX` into the `k` factor it shares with the altitude term — same quantity, same sign)
    expect(step).toMatch(/const k = \(2 \* Math\.PI\) \/ dom\.clientHeight;/);
    expect(step).toMatch(/x -= \(_twistC\.x - _twistP\.x\) \* k;/);
    expect(step).toMatch(/zc\._applyRotation\(x, y, zc\.pivotPoint\);/);
    // outside a 2D pan the step still stands down with no twist delta; FPV / a flight / disabled controls first
    expect(step).toMatch(/if \(fpvActive \|\| flight\.active\(\) \|\| !controls\.enabled\) return;/);
    expect(step).toMatch(/if \(d === 0 && !pan2d\) return;/);
    // T129: the 2D two-finger PAN — the altitude term cancelled too, the midpoint delta dragged on the pivot plane
    expect(step).toMatch(/MOBILE2D\.twoFingerPan && isMobileShell && useCameraStore\.getState\(\)\.mapMode === "2d"/);
    expect(step).toMatch(/if \(pan2d\) y = -\(_twistC\.y - _twistP\.y\) \* k;/);
    expect(step).toMatch(/_panPlane\.setFromNormalAndCoplanarPoint\(_panUp, zc\.pivotPoint\);/);
    expect(step).toMatch(/camera\.position\.add\(_panHit0\.sub\(_panHit1\)\);/);
  });

  it("an armed twist (or a 2D pan) that ends zeroes the library's rotation inertia; the 2D north lock stands down for a twist, never for a pan", () => {
    expect(src).toMatch(/if \(twist\.up\(e\.pointerId\) \|\| touchPan2dLive\) zc\.rotationInertia\.set\(0, 0\);/);
    const locks = src.slice(src.indexOf("const stepMobile2dLocks = () => {"), src.indexOf("const stepZoomGlide = () => {"));
    expect(locks).toMatch(/if \(\(touchRotate && !touchPan2dLive\) \|\| twistLive\) mobile2dFreeHeading = true;/);
    expect(locks).toMatch(/!mobile2dFreeHeading && !touchRotate && !twistLive/);
    expect(MOBILE2D.twoFingerPan).toBe(true);
    // the tunables exist
    expect(CONTROLS.twistArmDeg).toBe(4);
    expect(CONTROLS.twistGain).toBe(1);
    // the listeners are removed at teardown
    for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      expect(src).toMatch(new RegExp(`dom\\.removeEventListener\\("${ev}", onTwist(Down|Move|End)\\)`));
    }
  });
});
