import { describe, expect, it } from "vitest";
import { glf, glf3 } from "../../../src/components/globe/scene/glsl";

/** C3 (audit-2): every tuning value injected into every shader passes through glf — GLSL ES
 *  rejects bare ints (`float x = 2;`), so the formatting edge cases are load-bearing. */
describe("glf — GLSL ES float literal formatting", () => {
  it("appends .0 to integers", () => {
    expect(glf(2)).toBe("2.0");
    expect(glf(0)).toBe("0.0");
    expect(glf(-3)).toBe("-3.0");
  });

  it("passes decimals through untouched", () => {
    expect(glf(0.35)).toBe("0.35");
    expect(glf(-0.003)).toBe("-0.003");
  });

  it("exponent notation survives as a valid GLSL float (has an exponent part)", () => {
    expect(glf(1e-7)).toBe("1e-7"); // String(1e-7) → "1e-7", valid GLSL ES: digits e sign digits
    expect(glf(1e21)).toBe("1e+21");
  });

  it("every output parses back to the input value", () => {
    for (const n of [2, 0.35, 1e-7, -0.003, 9000, 1e21]) {
      expect(Number(glf(n))).toBe(n);
    }
  });
});

describe("glf3 — vec3 literal", () => {
  it("formats each component with the glf rules", () => {
    expect(glf3([1, 2, 0.5])).toBe("vec3(1.0, 2.0, 0.5)");
  });
});
