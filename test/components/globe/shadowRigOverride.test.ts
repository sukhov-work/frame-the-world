import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHADOWS, ULTRA } from "../../../src/components/globe/tuning";
import { RIG_IDENTITY } from "../../../scripts/lib/shadowArms.mjs";

/**
 * THE SHADOW-RIG A/B SEAM IS DEFAULT-OFF (T77 slice A-rest, 2026-09-06).
 *
 * `__globe.shadowRig({ biasTexels, normalBiasTexels, cascades, … })` exists so the three browser
 * experiments this slice hands the main session — A1's parked texel bias, the cascade-ladder-off
 * arm, and lever 12's refresh attribution — cost one flag each instead of a tuning edit plus a
 * ~90 s re-boot per arm. A live A/B seam inside the render loop is worth exactly as much as the
 * proof that it changes NOTHING until someone writes to it, and that proof is structural:
 *
 *  • **The writer is DEV-only.** It lives inside the `import.meta.env.DEV` block that also owns
 *    `window.__globe`, so a production bundle has no way to set an override at all — the reads
 *    below are then provably constant `null`.
 *  • **Every read restores the tier value on `null`.** The four numeric levers are read as
 *    `_rigOverride.x ?? (ultraOn ? ULTRA… : SHADOWS…)` and the ladder gate as
 *    `_rigOverride.cascades !== false`. A read in any other shape — a truthiness test, a `||`, a
 *    default swapped to the left of the `??` — could make the unset seam change the picture, and
 *    the scan below is written to catch that rather than to spot-check the two known sites.
 *  • **The tunables the seam overrides are still at their shipped values.** A1 is PARKED at 0
 *    texels on both profiles (DECISIONS 2026-09-06h: with the rig re-rendering every frame, 0.5
 *    texels RAISED the Everest scrub churn 0.077 → 0.141), and the ULTRA ladder still ships two
 *    cascades. An experiment flag must never become a shipped default by drift.
 *
 * Mutation that makes this RED: move `shadowRig` out of the DEV block, read an override in any
 * other shape, add a sixth lever to the engine without adding it to the harness's `RIG_IDENTITY`
 * (or the reverse), or bake an experiment's value into `tuning.ts`.
 */

const root = join(__dirname, "..", "..", "..");
const ORCH = join(root, "src", "components", "globe", "StylizedTiles.ts");
const raw = readFileSync(ORCH, "utf8");
// The verifyHarness idiom: strip comments before matching, but never the `//` of a URL scheme.
// Without this the fence trips on its own explanatory prose (the cascade site's comment quotes
// `_rigOverride.cascades === false`).
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:\\])\/\/[^\n]*/g, "");

describe("shadowRig overrides — the declaration is the identity", () => {
  const decl = src.match(/const _rigOverride:[\s\S]*?\} = \{([\s\S]*?)\};/);

  it("the record exists and is found by the probe (zero-result validation)", () => {
    expect(decl).not.toBeNull();
  });

  it("every declared lever initialises to null", () => {
    const init = decl![1];
    const fields = [...init.matchAll(/(\w+)\s*:\s*([^,\n]+),/g)].map((m) => [m[1], m[2].trim()]);
    expect(fields.length).toBeGreaterThan(0);
    for (const [name, value] of fields) expect(`${name}=${value}`).toBe(`${name}=null`);
  });

  it("the engine's levers are EXACTLY the harness's RIG_IDENTITY keys", () => {
    // Both directions matter: a lever the engine grew but the harness does not know about is one
    // `armOptions` never clears between arms (arm bleed); a lever the harness sends and the engine
    // dropped is a write that silently does nothing.
    const fields = [...decl![1].matchAll(/(\w+)\s*:\s*[^,\n]+,/g)].map((m) => m[1]).sort();
    expect(fields).toEqual(Object.keys(RIG_IDENTITY).sort());
  });
});

describe("shadowRig overrides — the writer is DEV-only", () => {
  it("the setter sits inside the `import.meta.env.DEV` block that owns window.__globe", () => {
    const devAt = src.indexOf("if (import.meta.env.DEV) {");
    const globeAt = src.indexOf("window.__globe = {");
    const rigAt = src.indexOf("shadowRig: (opts?");
    // `window.__timeStore = useTimeStore` is the last statement of the same block, so a setter
    // before it is inside the block. (Positions, not brace matching — the block is ~550 lines.)
    const endAt = src.indexOf("window.__timeStore = useTimeStore");
    expect(devAt).toBeGreaterThan(-1);
    expect(rigAt).toBeGreaterThan(-1);
    expect(endAt).toBeGreaterThan(-1);
    expect(devAt).toBeLessThan(globeAt);
    expect(globeAt).toBeLessThan(rigAt);
    expect(rigAt).toBeLessThan(endAt);
  });

  it("nothing outside that block assigns an override", () => {
    const endAt = src.indexOf("window.__timeStore = useTimeStore");
    const after = src.slice(endAt);
    expect(after).not.toMatch(/_rigOverride\.\w+\s*=/);
  });
});

describe("shadowRig overrides — every read is null-restoring", () => {
  const ALLOWED = [
    /^\s*=(?!=)/, // the DEV setter:            `_rigOverride.x = …`
    /^\s*\?\?/, //   a null-restoring read:     `_rigOverride.x ?? (tier)`
    /^\s*!==\s*false/, // the ladder gate:      `_rigOverride.cascades !== false`
    /^\s*,/, //      a report field:            `biasTexelsOverride: _rigOverride.biasTexels,`
  ];

  it("there are reads to check (probe validated)", () => {
    expect([...src.matchAll(/_rigOverride\.(\w+)/g)].length).toBeGreaterThanOrEqual(9);
  });

  it("no override is read in a shape that could act while unset", () => {
    const offenders: string[] = [];
    for (const m of src.matchAll(/_rigOverride\.(\w+)/g)) {
      const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
      if (!ALLOWED.some((re) => re.test(tail))) offenders.push(`${m[0]}${tail.split("\n")[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: the probe rejects the shapes it exists to forbid, and passes the real two", () => {
    const tailOf = (s: string) => {
      const m = /_rigOverride\.(\w+)/.exec(s)!;
      return s.slice(m.index + m[0].length);
    };
    for (const bad of [
      "_rigOverride.cascades)", //         a truthiness test — `false` and `null` read the same
      "_rigOverride.biasTexels || 0.5", // `||` swallows a deliberate 0-texel arm
      "_rigOverride.cascades === true", // inverted: the UNSET seam would then drop the ladder
    ]) {
      expect(ALLOWED.some((re) => re.test(tailOf(bad)))).toBe(false);
    }
    expect(ALLOWED.some((re) => re.test(tailOf("_rigOverride.biasTexels ?? (ultraOn ? a : b)")))).toBe(true);
    expect(ALLOWED.some((re) => re.test(tailOf("_rigOverride.cascades !== false ? fits[i] : null")))).toBe(true);
  });

  it("a 0-texel override takes the SHIPPED literal arm, not a re-derivation", () => {
    // `biasT > 0 ? tb.bias : <the shipped literal>` — so `{"biasTexels":0}` reproduces the parked
    // state exactly rather than a `texelBias(0)` that merely looks equal.
    expect(src).toMatch(/biasT > 0\s*\n?\s*\?/);
    expect(src).toMatch(/nBiasT > 0 \?/);
  });
});

describe("the tunables the seam overrides are still shipped-state", () => {
  it("A1 stays PARKED at 0 texels on both profiles", () => {
    expect(SHADOWS.biasTexels).toBe(0);
    expect(SHADOWS.normalBiasTexels).toBe(0);
    expect(ULTRA.shadowBiasTexels).toBe(0);
    expect(ULTRA.shadowNormalBiasTexels).toBe(0);
  });

  it("the ULTRA ladder still ships its cascades (the A/B never became the default)", () => {
    expect(ULTRA.cascades.length).toBeGreaterThan(0);
  });
});
