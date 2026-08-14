import { describe, expect, it } from "vitest";
import {
  FIND_PALETTE,
  findHitColor,
  findStandingColorIdx,
} from "../../../src/lib/theme/findPalette";
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

describe("findStandingColorIdx (identity glued to the date, owner 2026-08-14)", () => {
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 7, 14, 16, 47);

  it("is a pure function of (body, utc day) — neighbours entering/leaving cannot recolour it", () => {
    expect(findStandingColorIdx("sun", t0)).toBe(findStandingColorIdx("sun", t0 + 3_600_000));
    expect(findStandingColorIdx("sun", t0)).not.toBe(findStandingColorIdx("sun", t0 + DAY));
  });

  it("adjacent days land on adjacent wheel slots (warm/cool interleave preserved)", () => {
    const a = findStandingColorIdx("sun", t0);
    expect(findStandingColorIdx("sun", t0 + DAY)).toBe(a + 1);
  });

  it("two bodies on the SAME day wear different colours", () => {
    const n = FIND_PALETTE.length;
    const sun = ((findStandingColorIdx("sun", t0) % n) + n) % n;
    const moon = ((findStandingColorIdx("moon", t0) % n) + n) % n;
    const gc = ((findStandingColorIdx("gc", t0) % n) + n) % n;
    expect(new Set([sun, moon, gc]).size).toBe(3);
  });
});
