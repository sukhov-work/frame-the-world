import { describe, expect, it } from "vitest";
import {
  LEG_NAMES,
  RIG_IDENTITY,
  armOptions,
  assertRigKeys,
  legKey,
  parseArms,
  parseRigJson,
  selectLegs,
} from "../../scripts/lib/shadowArms.mjs";

/**
 * THE SHADOW A/B's ARGUMENT ALGEBRA (`scripts/lib/shadowArms.mjs`, T77 slice A-rest 2026-09-06).
 *
 * `verify-temporal-stability --arms` runs every leg once per arm ON ONE BOOT — the only way an
 * N-way shadow A/B is affordable, because the city pose streams ~3,300 ground tiles and takes
 * ~90 s to go quiet. That economy buys back a whole class of silent wrongness, and this file is
 * where it is paid for. All three failures below produce a run that FINISHES and PRINTS NUMBERS:
 *
 *  • **Arm bleed.** `__globe.shadowRig()` is a live seam. Merging arm N over the engine's current
 *    state leaves arm N−1's levers on, so `{"cascades":false}` poisons every arm after it and the
 *    ladder-off number is reported for arms that were supposed to have the ladder.
 *  • **A key the engine ignores.** The seam takes an override only when the key is PRESENT
 *    (`if ("cascades" in opts)`), so `{"cascade":false}` writes nothing and the arm reports the
 *    stock picture under an A/B label — a "check that could not fail" (audit #3 C11/C16 class).
 *  • **A leg key that collides.** Rows are stored as `<arm>/<leg>`; `stock` keeps the BARE leg
 *    name so a run made with `--arms` is still comparable to every run stored before the flag.
 *
 * Mutation that makes this RED: merge an arm over anything but the identity, accept an unknown
 * option key, let `stock` be redefined, or prefix the stock arm's leg keys.
 */

describe("the rig identity — the shipped render path", () => {
  it("every writable lever is null (null = take the tier's value)", () => {
    expect(Object.values(RIG_IDENTITY).every((v) => v === null)).toBe(true);
  });

  it("names exactly the five levers the engine seam accepts", () => {
    // The engine's `shadowRig(opts)` reads these five and nothing else; if a sixth is added to
    // `StylizedTiles.ts` and not here, `armOptions` stops clearing it between arms.
    expect(Object.keys(RIG_IDENTITY).sort()).toEqual(
      ["biasTexels", "cascades", "keySnapTexels", "moveTexels", "normalBiasTexels"].sort(),
    );
  });

  it("is frozen, so an arm cannot mutate the base every other arm is built from", () => {
    expect(Object.isFrozen(RIG_IDENTITY)).toBe(true);
  });
});

describe("armOptions — no arm inherits the arm before it", () => {
  it("carries every key, so a lever the previous arm set is explicitly turned back off", () => {
    expect(armOptions(null, { cascades: false })).toEqual({
      keySnapTexels: null,
      moveTexels: null,
      biasTexels: null,
      normalBiasTexels: null,
      cascades: false,
    });
  });

  it("THE BLEED CASE: arm B's write clears arm A's lever", () => {
    const a = armOptions(null, { cascades: false });
    const b = armOptions(null, { biasTexels: 0.5 });
    expect(a.cascades).toBe(false);
    // Not `undefined` — an absent key is exactly what the engine ignores, so it would leave the
    // cascades off through arm B.
    expect(b.cascades).toBeNull();
    expect(b.biasTexels).toBe(0.5);
  });

  it("layers the run-wide --rig / --rig-json UNDER the arm, and the arm wins on a shared key", () => {
    const o = armOptions({ keySnapTexels: 0, moveTexels: 0, biasTexels: 0.3 }, { biasTexels: 0.5 });
    expect(o.keySnapTexels).toBe(0);
    expect(o.moveTexels).toBe(0);
    expect(o.biasTexels).toBe(0.5);
  });

  it("the same arm spec always produces the same write, whatever ran before it", () => {
    const first = armOptions({ moveTexels: 1 }, { cascades: false });
    armOptions({ moveTexels: 1 }, { biasTexels: 9 });
    const again = armOptions({ moveTexels: 1 }, { cascades: false });
    expect(again).toEqual(first);
  });

  it("does not mutate the identity or the run-wide options it was handed", () => {
    const runWide = { biasTexels: 0.3 };
    armOptions(runWide, { cascades: false });
    expect(runWide).toEqual({ biasTexels: 0.3 });
    expect(RIG_IDENTITY.cascades).toBeNull();
  });
});

describe("unknown option keys are a hard error (the engine would ignore them)", () => {
  it("rejects a near-miss key", () => {
    expect(() => assertRigKeys({ cascade: false }, "--arms.x")).toThrow(/unknown shadowRig option "cascade"/);
  });

  it("POSITIVE CONTROL: every real key passes", () => {
    expect(() => assertRigKeys({ ...RIG_IDENTITY }, "--rig-json")).not.toThrow();
  });

  it("--rig-json parses, validates, and treats an absent flag as no override", () => {
    expect(parseRigJson(null)).toBeNull();
    expect(parseRigJson("")).toBeNull();
    expect(parseRigJson('{"biasTexels":0.5}')).toEqual({ biasTexels: 0.5 });
    expect(() => parseRigJson('{"bias":0.5}')).toThrow(/unknown shadowRig option/);
    expect(() => parseRigJson("[1,2]")).toThrow(/expected a JSON object/);
  });
});

describe("parseArms — stock is implicit, first, and never a write", () => {
  it("with no flag the run is exactly the stock arm", () => {
    expect(parseArms(null)).toEqual([{ name: "stock", opts: null }]);
  });

  it("stock stays FIRST so the un-overridden numbers are measured before any write", () => {
    const arms = parseArms('{"ladderOff":{"cascades":false},"a1-05":{"biasTexels":0.5}}');
    expect(arms.map((a) => a.name)).toEqual(["stock", "ladderOff", "a1-05"]);
    expect(arms[0].opts).toBeNull();
  });

  it("rejects a redefinition of stock, a name with a slash, and a bad option key", () => {
    expect(() => parseArms('{"stock":{"cascades":false}}')).toThrow(/implicit no-write arm/);
    expect(() => parseArms('{"a/b":{"cascades":false}}')).toThrow(/may not contain/);
    expect(() => parseArms('{"x":{"cascades ":false}}')).toThrow(/unknown shadowRig option/);
    expect(() => parseArms("[]")).toThrow(/expected a JSON object/);
  });
});

describe("selectLegs / legKey — the stored keys stay comparable across runs", () => {
  it("no flag runs all four legs, in the harness's own order", () => {
    expect(selectLegs(null)).toEqual([...LEG_NAMES]);
  });

  it("a subset keeps LEG_NAMES order, not the order they were typed in", () => {
    expect(selectLegs("scrub4x,control")).toEqual(["control", "scrub4x"]);
    expect(selectLegs(" control , scrub ")).toEqual(["control", "scrub"]);
  });

  it("an unknown leg is a hard error — it can never widen the set", () => {
    expect(() => selectLegs("control,pann")).toThrow(/unknown leg "pann"/);
    expect(() => selectLegs(",")).toThrow(/no legs named/);
  });

  it("stock legs keep their BARE names; an arm's are namespaced", () => {
    expect(legKey("stock", "scrub")).toBe("scrub");
    expect(legKey("ladderOff", "scrub")).toBe("ladderOff/scrub");
  });
});
