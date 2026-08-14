import { describe, expect, it } from "vitest";
import { FIND_PALETTE, findHitColor } from "../../../src/lib/theme/findPalette";
import { tokens } from "../../../src/lib/theme/tokens";

describe("FIND_PALETTE (v2 per-hit colours)", () => {
  it("every entry is distinct on both faces (css var + gl hex)", () => {
    expect(new Set(FIND_PALETTE.map((c) => c.gl)).size).toBe(FIND_PALETTE.length);
    expect(new Set(FIND_PALETTE.map((c) => c.css)).size).toBe(FIND_PALETTE.length);
  });

  it("never wears the real bodies' colours (anti-confusion contract)", () => {
    for (const c of FIND_PALETTE) {
      expect(c.gl).not.toBe(tokens.sunCore);
      expect(c.gl).not.toBe(tokens.sunGlow);
      expect(c.gl).not.toBe(tokens.moonlight);
    }
  });

  it("cycles safely for any index", () => {
    expect(findHitColor(0)).toBe(FIND_PALETTE[0]);
    expect(findHitColor(FIND_PALETTE.length)).toBe(FIND_PALETTE[0]);
    expect(findHitColor(FIND_PALETTE.length * 3 + 2)).toBe(FIND_PALETTE[2]);
    expect(findHitColor(-1)).toBe(FIND_PALETTE[FIND_PALETTE.length - 1]);
  });
});
