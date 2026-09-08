import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import RateEncoder, { encoderRate } from "../../src/components/controls/RateEncoder";
import { stepRateValue } from "../../src/components/controls/useRateIntegrator";
import { BESTSPOT, CONTROLS } from "../../src/components/globe/tuning";

/**
 * THE SHEET-ALTITUDE ENCODER (owner 2026-09-08b): the spring-centred RATE control from the
 * desktop's 3D map deck, in the shared tier, driving BEST SPOT's lift on BOTH shells through a
 * per-frame integrator. What must never regress: the feel (expo curve, eased coast-out), the
 * exponential step with its floor (the log slider's character), the clamp, and that both
 * consumers use it with the desktop ALTITUDE encoder's own numbers.
 */

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const cfg = { baseM: BESTSPOT.liftEncoderBaseM, min: BESTSPOT.eyeM, max: BESTSPOT.liftMaxM };

describe("encoderRate — the expo curve", () => {
  it("is fine near centre, full at the ends, odd, and clamped", () => {
    expect(encoderRate(0, 1.1, 2.2)).toBe(0);
    expect(encoderRate(1, 1.1, 2.2)).toBeCloseTo(1.1);
    expect(encoderRate(-1, 1.1, 2.2)).toBeCloseTo(-1.1);
    expect(encoderRate(0.5, 1.1, 2.2)).toBeCloseTo(1.1 * 0.5 ** 2.2);
    expect(encoderRate(0.5, 1.1, 2.2)).toBeLessThan(0.55); // expo: half deflection < half rate
    expect(encoderRate(-0.5, 1.1, 2.2)).toBeCloseTo(-encoderRate(0.5, 1.1, 2.2));
    expect(encoderRate(3, 1.1, 2.2)).toBeCloseTo(1.1);
  });
});

describe("stepRateValue — the integrator's frame", () => {
  it("eases the commanded rate in (never a step), and steps exponentially with a floor", () => {
    const r1 = stepRateValue(BESTSPOT.eyeM, { applied: 0 }, 1.1, 16, cfg);
    expect(r1.applied).toBeGreaterThan(0);
    expect(r1.applied).toBeLessThan(1.1); // eased, not applied whole
    expect(r1.value).toBeGreaterThan(BESTSPOT.eyeM);
    // at 1.7 m the step rides the FLOOR (baseM), so a sheet at eye level gets airborne
    const expected = BESTSPOT.eyeM + (r1.applied * 16 / 1000) * BESTSPOT.liftEncoderBaseM;
    expect(r1.value).toBeCloseTo(expected, 9);
    // high up the same rate moves proportionally more — the log character
    const hi = stepRateValue(200, { applied: 1 }, 1, 16, cfg);
    const lo = stepRateValue(20, { applied: 1 }, 1, 16, cfg);
    expect(hi.value - 200).toBeCloseTo((lo.value - 20) * 10, 6);
  });

  it("clamps to [eye, liftMax] and holds still inside the deadband", () => {
    expect(stepRateValue(BESTSPOT.liftMaxM, { applied: 1 }, 1, 100, cfg).value).toBe(BESTSPOT.liftMaxM);
    expect(stepRateValue(BESTSPOT.eyeM, { applied: -1 }, -1, 100, cfg).value).toBe(BESTSPOT.eyeM);
    const still = stepRateValue(50, { applied: 0 }, 0, 16, cfg);
    expect(still.value).toBe(50);
  });

  it("release COASTS out along the ease and then parks — never stops dead, never runs forever", () => {
    let s = { applied: 1.0 };
    let v = 30;
    let frames = 0;
    let firstDelta = 0;
    for (;;) {
      const r = stepRateValue(v, s, null, 16, cfg);
      if (frames === 0) firstDelta = r.value - v;
      frames++;
      v = r.value;
      s = { applied: r.applied };
      if (!r.moving) break;
      if (frames > 600) throw new Error("the coast never parked");
    }
    expect(firstDelta).toBeGreaterThan(0); // the first released frame still moves
    expect(frames).toBeGreaterThan(5); // …and it takes a few frames (τ ≈ 140 ms)
    expect(frames).toBeLessThan(200);
    expect(s.applied).toBe(0);
    // τ is the orchestrator's: e-fold in rateEaseTauMs
    const one = stepRateValue(30, { applied: 1 }, null, CONTROLS.rateEaseTauMs, cfg);
    expect(one.applied).toBeCloseTo(Math.exp(-1), 6);
  });
});

describe("RateEncoder — the rendered instrument", () => {
  it("renders the .ct-enc rail with the ARIA rate contract and the centre tick", () => {
    const html = renderToStaticMarkup(
      createElement(RateEncoder, {
        label: "SHEET ALTITUDE",
        formatted: "1.7 m",
        maxRate: CONTROLS.zoomRateMaxPerS,
        expoGamma: CONTROLS.rateExpoGamma,
        onRate: () => {},
        ariaLabel: "Sheet altitude above the ground",
        badge: { text: "▲ DRONE", tone: "accent" },
      }),
    );
    expect(html).toContain('class="uf-slider ct-enc"');
    expect(html).toContain("ct-enc__centre");
    expect(html).toMatch(/role="slider"[^>]*aria-label="Sheet altitude above the ground"/);
    expect(html).toMatch(/aria-valuemin="-1"[^>]*aria-valuemax="1"[^>]*aria-valuenow="0"/);
    expect(html).toContain("uf-badge--accent");
    expect(html).toContain("1.7 m");
  });

  it("is ONE implementation: ui/Encoder is a typed door onto controls/RateEncoder, and the .ct-enc CSS rides upload-flow.css", () => {
    const ui = read("src/components/ui/Encoder.tsx");
    expect(ui).toMatch(/import RateEncoder from "\.\.\/controls\/RateEncoder"/);
    expect(ui).toMatch(/return <RateEncoder \{\.\.\.props\} \/>;/);
    expect(ui).not.toMatch(/useState|getBoundingClientRect/); // no second implementation
    const shared = read("src/styles/upload-flow.css");
    expect(shared).toMatch(/\.ct-enc__centre \{/);
    expect(shared).toMatch(/\.ct-enc\.is-live \.uf-slider__knob/);
    expect(read("src/styles/camera-tilt.css")).not.toMatch(/\.ct-enc__centre \{/);
    // the shared tier stays a leaf (mobileFence rule 3): react + styles + tunables only
    const enc = read("src/components/controls/RateEncoder.tsx");
    expect(enc).not.toMatch(/from "\.\.\/ui\//);
    expect(enc).not.toMatch(/from "\.\.\/panels\//);
  });

  it("BOTH shells drive the sheet altitude with it, at the desktop ALTITUDE encoder's numbers", () => {
    for (const f of ["src/components/panels/BestSpotPanel.tsx", "src/components/mobile/BestSpotSheet.tsx"]) {
      const src = read(f);
      const row = src.slice(src.indexOf("<RateEncoder"), src.indexOf("/>", src.indexOf("<RateEncoder")));
      expect(row, f).toMatch(/label="SHEET ALTITUDE"/);
      expect(row, f).toMatch(/maxRate=\{CONTROLS\.zoomRateMaxPerS\}/);
      expect(row, f).toMatch(/expoGamma=\{CONTROLS\.rateExpoGamma\}/);
      expect(row, f).toMatch(/onRate=\{onLiftRate\}/);
      expect(row, f).toMatch(/onReset=\{\(\) => setLiftM\(0\)\}/);
      expect(src, f).toMatch(
        /useRateIntegrator\(\s*\(\) => BESTSPOT\.eyeM \+ useBestSpotStore\.getState\(\)\.liftM,\s*\(v\) => useBestSpotStore\.getState\(\)\.setLiftM\(v - BESTSPOT\.eyeM\),\s*\{ baseM: BESTSPOT\.liftEncoderBaseM, min: BESTSPOT\.eyeM, max: BESTSPOT\.liftMaxM \},?\s*\)/,
      );
      // the absolute slider is gone from the altitude row (the TUNE weights may keep theirs)
      expect(row, f).not.toMatch(/InstrumentSlider/);
      // A HOOK: it must sit ABOVE the component's early return (the first cut sat below it and
      // React unmounted the whole /m shell on the first SPOT tap — "rendered more hooks").
      const earlyReturn = f.includes("mobile") ? "if (!open) return null;" : "if (!s.open) return null;";
      expect(src.indexOf(earlyReturn), f).toBeGreaterThan(0);
      expect(src.indexOf("useRateIntegrator("), f).toBeLessThan(src.indexOf(earlyReturn));
    }
    expect(read("src/components/mobile/BestSpotSheet.tsx")).not.toMatch(/InstrumentSlider/);
  });
});
