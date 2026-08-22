import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AIMCONES } from "../../../src/components/globe/tuning";
import { bandFor, bandFutureInk } from "../../../src/lib/geo/radarBands";
import { tokens } from "../../../src/lib/theme/tokens";

/**
 * AUDIT #3 A1-7 → T35 — the radar band model, extracted 2026-08-22.
 *
 * `bandFor` shipped as THREE hand-maintained copies (scene/aimCones, panels/MapWindow,
 * panels/MiniMap) and `bandFutureInk` as two, with NO cross-file fence — Track E's jscpd only
 * saw the 29-line tip. The values were in step by luck and discipline; nothing enforced it.
 *
 * Mutation that makes these RED: re-declare `bandFor` in either panel (the source fence at the
 * bottom), or change a band in tuning without the model following (the value block at the top).
 */

const KEYS = ["target", "sun", "moon"] as const;

describe("bandFor — one allocation, three surfaces (T35)", () => {
  it("maps each body to its tunable band, desktop and /m", () => {
    expect(bandFor("moon")).toBe(AIMCONES.bandMoon);
    expect(bandFor("sun")).toBe(AIMCONES.bandSun);
    expect(bandFor("target")).toBe(AIMCONES.bandTarget);
    expect(bandFor("moon", true)).toBe(AIMCONES.bandMoonMobile);
    expect(bandFor("sun", true)).toBe(AIMCONES.bandSunMobile);
    expect(bandFor("target", true)).toBe(AIMCONES.bandTargetMobile);
  });

  it("desktop defaults when `mobile` is omitted (the GL fan's call shape)", () => {
    for (const k of KEYS) expect(bandFor(k)).toEqual(bandFor(k, false));
  });

  it("the stack is ORDERED and NON-OVERLAPPING on both shells (batch #6 compaction)", () => {
    // moon innermost → sun → target, each band's outer below the next band's inner. This is
    // what retired the compact/emphasis radius scaling, so it is a structural invariant.
    for (const mobile of [false, true]) {
      const [moonIn, moonOut] = bandFor("moon", mobile);
      const [sunIn, sunOut] = bandFor("sun", mobile);
      const [tgtIn, tgtOut] = bandFor("target", mobile);
      expect(moonIn).toBeLessThan(moonOut);
      expect(moonOut).toBeLessThanOrEqual(sunIn);
      expect(sunIn).toBeLessThan(sunOut);
      expect(sunOut).toBeLessThanOrEqual(tgtIn);
      expect(tgtIn).toBeLessThan(tgtOut);
      expect(tgtOut).toBeLessThanOrEqual(1); // inside the unit rim
    }
  });

  it("/m pulls the WHOLE stack inward (owner batch #5 item 2)", () => {
    for (const k of KEYS) {
      expect(bandFor(k, true)[0]).toBeLessThan(bandFor(k, false)[0]);
      expect(bandFor(k, true)[1]).toBeLessThan(bandFor(k, false)[1]);
    }
  });
});

describe("bandFutureInk — the per-body future colour (owner item 17)", () => {
  it("sun/moon wear their own ink; the target keeps the scrubber future-blue", () => {
    expect(bandFutureInk("sun")).toBe(tokens.sunGlow);
    expect(bandFutureInk("moon")).toBe(tokens.moonDial);
    expect(bandFutureInk("target")).toBe(tokens.timeFuture);
  });

  it("…and all three are distinct from the inert PAST grey", () => {
    for (const k of KEYS) expect(bandFutureInk(k)).not.toBe(tokens.textSecondary);
    expect(new Set(KEYS.map(bandFutureInk)).size).toBe(3);
  });

  it("the target ink equals the CSS token the mini-map used to read (no value drift)", () => {
    const css = readFileSync(
      join(__dirname, "..", "..", "..", "src", "styles", "tokens.css"),
      "utf8",
    );
    const m = css.match(/--color-time-future:\s*(#[0-9a-fA-F]{6})/);
    expect(m).not.toBeNull();
    // MiniMap resolved this one body's ink from CSS while the other two came off the GL bridge;
    // the extraction moved it to the bridge, so pin that the two sources agree.
    expect(m![1].toLowerCase()).toBe(tokens.timeFuture.toLowerCase());
  });
});

describe("no radar surface keeps a private copy of the band model", () => {
  const root = join(__dirname, "..", "..", "..");
  const SURFACES: [string, string][] = [
    ["src/components/globe/scene", "aimCones.ts"],
    ["src/components/panels", "MapWindow.tsx"],
    ["src/components/panels", "MiniMap.tsx"],
  ];
  // The shape of the drift: reading a band tunable directly instead of going through bandFor.
  const rawBand = /AIMCONES\.band(Sun|Moon|Target)(Mobile)?\b/;
  /** Comments legitimately NAME the tunables (aimCones' docblock describes the ring order), so
   *  the fence probes CODE only — a probe that fired on prose would just get the prose edited. */
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("all three import from lib/geo/radarBands and none reads AIMCONES.band* directly", () => {
    for (const [dir, file] of SURFACES) {
      const src = readFileSync(join(root, dir, file), "utf8");
      expect({ file, imports: /from "[^"]*lib\/geo\/radarBands"/.test(src) }).toEqual({
        file,
        imports: true,
      });
      expect({ file, raw: rawBand.test(code(src)) }).toEqual({ file, raw: false });
    }
  });

  it("POSITIVE CONTROL: the probes can match", () => {
    expect(rawBand.test(code("const x = AIMCONES.bandSunMobile;"))).toBe(true);
    expect(rawBand.test(code("const x = AIMCONES.bandTarget;"))).toBe(true);
    // …and the model itself is where the raw reads legitimately live.
    expect(rawBand.test(code(readFileSync(join(root, "src/lib/geo/radarBands.ts"), "utf8")))).toBe(
      true,
    );
    // The stripper must not eat code: a raw read that FOLLOWS a comment still trips the fence.
    expect(rawBand.test(code("// see AIMCONES.bandSun\nconst x = AIMCONES.bandSun;"))).toBe(true);
    // …and must genuinely remove prose, or the fence above passes for the wrong reason.
    expect(rawBand.test(code("/* AIMCONES.bandSun inner ring */"))).toBe(false);
  });
});
