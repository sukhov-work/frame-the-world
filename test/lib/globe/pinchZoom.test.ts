import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIB_ZOOM_K, libraryDeltaForLog, pinchLogDelta } from "../../../src/lib/globe/pinchZoom";
import { CONTROLS } from "../../../src/components/globe/tuning";

/**
 * THE FINGER-PROPORTIONAL PINCH (owner 2026-09-16). The conversion leans on two library facts
 * (how the touch pinch accumulates, how `_updateZoom` spends it) — both source-pinned here so a
 * bump of `3d-tiles-renderer` that changes either fails loudly instead of silently changing
 * the phone's zoom feel.
 */

const LIB = "node_modules/3d-tiles-renderer/src/three/renderer/controls/";
const env = readFileSync(`${LIB}EnvironmentControls.js`, "utf8");
const tracker = readFileSync(`${LIB}PointerTracker.js`, "utf8");

/** The library's multiply, transcribed: dist · (1 − zoomDelta · zoomSpeed · K). */
const libFactor = (zoomDelta: number, zoomSpeed: number) => 1 - zoomDelta * zoomSpeed * LIB_ZOOM_K;

describe("pinchZoom — the 0.4.28 shapes it converts between", () => {
  it("the touch pinch accumulates a PIXEL delta and _updateZoom spends it as dist·zoomSpeed·0.0025", () => {
    expect(env).toMatch(/const pointerDist = pointerTracker\.getTouchPointerDistance\(\);/);
    expect(env).toMatch(
      /const previousDist = pointerTracker\.getPreviousTouchPointerDistance\(\);\s*this\.zoomDelta \+= pointerDist - previousDist;/,
    );
    // …and `previousPositions` move ONCE per frame (updateFrame at the end of update()) — the
    // reason the orchestrator reads the two tracker distances instead of that per-event sum.
    expect(tracker).toMatch(/updateFrame\(\) \{[\s\S]{0,400}previousPositions\[ id \]\.copy\( pointerPositions\[ id \] \)/);
    expect(env).toMatch(/this\.pointerTracker\.updateFrame\(\);/);
    const zoom = env.slice(env.indexOf("_updateZoom() {"));
    expect(zoom).toMatch(/scale = scale \* dist \* zoomSpeed \* 0\.0025;/);
    expect(zoom).toMatch(/scale = scale \* Math\.max\( dist - minDistance, 0 \) \* zoomSpeed \* 0\.0025;/);
    expect(LIB_ZOOM_K).toBe(0.0025);
    // …and the tracker exposes the live finger distance the orchestrator reads pre-update.
    expect(tracker).toMatch(/getTouchPointerDistance\( pointerPositions = this\.pointerPositions \) \{/);
    expect(tracker).toMatch(/getPreviousTouchPointerDistance\(\) \{/);

    // ZOOM is state 3 (the orchestrator compares `zc.state === 3`).
    expect(env).toMatch(/const ZOOM = 3;/);
  });

  it("the tunable exists and is a calm-but-live exponent", () => {
    expect(CONTROLS.pinchZoomGain).toBeGreaterThan(0);
    expect(CONTROLS.pinchZoomGain).toBeLessThanOrEqual(1);
  });
});

describe("pinchLogDelta — the frame's finger ratio from the tracker's two distances", () => {
  it("spreading 120 → 220 px is ln(220/120) × gain; pinching back is its negative", () => {
    expect(pinchLogDelta(220, 120, 1)).toBeCloseTo(Math.log(220 / 120), 12);
    expect(pinchLogDelta(120, 220, 1)).toBeCloseTo(-Math.log(220 / 120), 12);
    expect(pinchLogDelta(220, 120, 0.5)).toBeCloseTo(0.5 * Math.log(220 / 120), 12);
  });

  it("the SAME 100 px of spread means more from a narrow start — the runaway the pixel path had", () => {
    const wide = pinchLogDelta(250, 150, 1);
    const narrow = pinchLogDelta(160, 60, 1);
    expect(narrow).toBeGreaterThan(wide);
    // …and the pixel path would have zoomed both by the identical factor exp(−100·5·K).
    expect(libFactor(100, 5)).toBeCloseTo(libFactor(100, 5), 12);
  });

  it("is event-rate independent: one frame's ratio does not care how many events built it", () => {
    // The stock sum for two events in a frame: (d1 − d0) + (d2 − d0) — 1.5× the true spread.
    const d0 = 120;
    const d1 = 123;
    const d2 = 126;
    expect(d1 - d0 + (d2 - d0)).toBe(1.5 * (d2 - d0));
    // The tracker pair sees the frame's true ratio whatever the event count.
    expect(pinchLogDelta(d2, d0, 1)).toBeCloseTo(Math.log(126 / 120), 12);
  });

  it("degenerate pairs are 0, never NaN or ±∞", () => {
    expect(pinchLogDelta(0, 10, 1)).toBe(0);
    expect(pinchLogDelta(50, 0, 1)).toBe(0);
    expect(pinchLogDelta(50, -3, 1)).toBe(0);
    expect(pinchLogDelta(50, 50, 1)).toBe(0);
    expect(pinchLogDelta(50, Number.NaN, 1)).toBe(0);
  });
});

describe("libraryDeltaForLog — the linear delta whose library multiply equals exp(−log)", () => {
  it("round-trips through the library's own factor at any braked zoomSpeed", () => {
    for (const zs of [5, 1.75, 4.25]) {
      for (const l of [0.3, -0.3, 0.05, -1.2, 0.9]) {
        expect(libFactor(libraryDeltaForLog(l, zs), zs)).toBeCloseTo(Math.exp(-l), 12);
      }
    }
  });

  it("a whole pinch applied frame by frame lands the camera at (d0/d1)^gain of its distance", () => {
    // 120 → 240 px at gain 0.75 over 40 frames of 3 px, the brake wandering per frame — the
    // camera→ground distance must end at (120/240)^0.75 whatever the per-frame zoomSpeed was.
    let dist = 1000;
    let d = 120;
    for (let f = 0; f < 40; f++) {
      const dNow = d + 3;
      const zs = 4.25 + 0.5 * Math.sin(f); // a braked, drifting zoomSpeed
      const logStep = pinchLogDelta(dNow, d, 0.75);
      dist *= libFactor(libraryDeltaForLog(logStep, zs), zs);
      d = dNow;
    }
    expect(d).toBe(240);
    expect(dist).toBeCloseTo(1000 * (120 / 240) ** 0.75, 9);
  });

  it("is inert for a zero step or a non-positive speed", () => {
    expect(libraryDeltaForLog(0, 5)).toBe(0);
    expect(libraryDeltaForLog(0.5, 0)).toBe(0);
  });
});
