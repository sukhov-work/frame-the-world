import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FREEZE_PARTS,
  frameFreezeState,
  frameHeld,
  frameNow,
  noteFrameHold,
  registerFrameClock,
  setFrameFrozen,
  __resetFrameFreeze,
} from "../../../src/lib/globe/frameFreeze";

/**
 * THE DETERMINISTIC-CAPTURE SEAM (T77 / T94) — the unit half of the gate.
 *
 * The browser half is `verify-visual-sweep --freeze`'s own per-pose self-check (shoot the frozen
 * frame twice, two rAF apart, diff at threshold 0). What a browser cannot cheaply prove is the
 * property the whole seam rests on: that a build which NEVER calls `freezeFrame` is the same
 * program it was before the seam existed. That is what this file pins, alongside the freeze/thaw
 * contract the harness depends on.
 *
 * Three groups, and each one is a mutation target:
 *  • **the OFF path** — `frameNow()` IS `performance.now()`, `frameHeld()` is false for every
 *    part, and the consumer idiom (`frameHeld("clock") ? 0 : dt`) falls straight through.
 *    Mutation that turns it RED: make `frameNow()` return a cached/rounded/offset value.
 *  • **the freeze contract** — the clock is pinned, holds are attributable, and a thaw RESUMES
 *    (skew) rather than replaying the freeze as one giant frame. Mutation: bank the skew on a
 *    `{ clock: false }` freeze (the bug this file caught) and the clock steps backwards.
 *  • **the wiring fence** — the per-frame clocks in the render path really do read the seam.
 *    Mutation: put `performance.now()` back into any reveal-clock line and the fence fires.
 *
 * `performance.now()` is a Node global, so this runs in the repo's default node environment with
 * no jsdom. Timing assertions use busy-waits (never timers) and generous slack: they assert the
 * DIRECTION and the ORDER of magnitude of the skew, never a wall-clock value.
 */

/** Spin until `performance.now()` has advanced by `ms`. A timer would hand the event loop back
 *  and make the "was the clock held" question a question about the scheduler instead. */
function burn(ms: number): void {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    /* spin */
  }
}

afterEach(() => {
  // Module state outlives a case — a leaked freeze would make every later test lie.
  __resetFrameFreeze();
});

describe("frame freeze — the OFF state is the production path", () => {
  it("frameNow() IS performance.now(), bracketed by two real reads", () => {
    // The strongest statement a unit test can make about "the same expression, not an equivalent
    // one": the value has to land inside a bracket that no cached, rounded or offset clock could.
    const before = performance.now();
    const seam = frameNow();
    const after = performance.now();
    expect(seam).toBeGreaterThanOrEqual(before);
    expect(seam).toBeLessThanOrEqual(after);
  });

  it("frameNow() keeps advancing — it is not a latched value", () => {
    const a = frameNow();
    burn(3);
    expect(frameNow()).toBeGreaterThan(a);
  });

  it("nothing is held, so every guarded contribution takes its normal branch", () => {
    for (const part of FREEZE_PARTS) expect(frameHeld(part)).toBe(false);
    const s = frameFreezeState();
    expect(s.frozen).toBe(false);
    expect(s.skewMs).toBe(0);
    expect(s.held).toEqual([]);
  });

  it("noteFrameHold is inert while thawed — a stray call cannot forge a hold", () => {
    noteFrameHold("someone.called.this.by.mistake");
    expect(frameFreezeState().held).toEqual([]);
  });

  it("the consumer idiom falls through unchanged (the orchestrator's dtMs line)", () => {
    // `StylizedTiles.stepFrameTiming`, verbatim in shape. OFF, it must be the plain clamp.
    const CAP = 100;
    const last = frameNow();
    burn(4);
    const now = frameNow();
    const dtMs = frameHeld("clock") ? 0 : Math.min(now - last, CAP);
    expect(dtMs).toBe(Math.min(now - last, CAP));
    expect(dtMs).toBeGreaterThan(0);
  });

  it("the reveal-clock idiom advances (uNowMs would still dither)", () => {
    const a = frameNow(); // uNowMs.value = frameNow()
    burn(3);
    expect(frameNow()).toBeGreaterThan(a);
  });

  it("a thaw on a never-frozen seam writes nothing", () => {
    const before = frameFreezeState();
    const out = setFrameFrozen(false);
    expect(out.frozen).toBe(false);
    expect(out.skewMs).toBe(0);
    expect(frameFreezeState()).toEqual(before);
    // …and the clock is still the identity afterwards (the dispose path's only call).
    const lo = performance.now();
    const seam = frameNow();
    expect(seam).toBeGreaterThanOrEqual(lo);
    expect(seam).toBeLessThanOrEqual(performance.now());
  });
});

describe("frame freeze — frozen", () => {
  it("pins the clock: two reads across real elapsed time are identical", () => {
    setFrameFrozen(true);
    const a = frameNow();
    burn(8);
    expect(frameNow()).toBe(a);
  });

  it("holds every part by default", () => {
    const s = setFrameFrozen(true);
    for (const part of FREEZE_PARTS) expect(frameHeld(part)).toBe(true);
    expect(s.frozen).toBe(true);
    expect(s.parts).toEqual({ clock: true, streaming: true, shadow: true });
  });

  it("names the registered clocks in `held`, and forgets them on unregister", () => {
    const unreg = registerFrameClock("test.reveal");
    expect(setFrameFrozen(true).held).toContain("clock:test.reveal");
    expect(frameFreezeState().clocks).toContain("test.reveal");
    setFrameFrozen(false);
    unreg();
    expect(setFrameFrozen(true).held).not.toContain("clock:test.reveal");
  });

  it("records the holds modules report, and a thaw RETURNS what was held (the proof)", () => {
    setFrameFrozen(true);
    if (frameHeld("streaming")) noteFrameHold("ground.stream");
    if (frameHeld("shadow")) noteFrameHold("shadow.rig");
    expect(frameFreezeState().held).toEqual(["ground.stream", "shadow.rig"]);
    const out = setFrameFrozen(false);
    expect(out.frozen).toBe(false);
    expect(out.held).toEqual(["ground.stream", "shadow.rig"]);
    // …and the next freeze starts from an empty ledger, not the last one's.
    expect(setFrameFrozen(true).held).toEqual([]);
  });

  it("holds the dt-driven eases at exactly zero (every ease becomes an identity)", () => {
    const last = frameNow();
    setFrameFrozen(true);
    burn(6);
    const dtMs = frameHeld("clock") ? 0 : Math.min(frameNow() - last, 100);
    expect(dtMs).toBe(0);
    // `x += (target - x) * easeK(0, tau)` with easeK(0, ·) = 0 — the value cannot move.
    let x = 0.25;
    x += (1 - x) * (1 - Math.exp(-dtMs / 400));
    expect(x).toBe(0.25);
  });
});

describe("frame freeze — the thaw resumes, it does not replay", () => {
  it("skews by the time spent frozen: no forward jump on release", () => {
    const FROZEN_MS = 60;
    const before = frameNow();
    setFrameFrozen(true);
    burn(FROZEN_MS);
    setFrameFrozen(false);
    const after = frameNow();
    expect(after).toBeGreaterThanOrEqual(before); // monotone — never steps backwards
    // The whole freeze must have been subtracted. Only the loop's own overhead may survive, so
    // assert the direction with wide slack rather than a wall-clock value.
    expect(after - before).toBeLessThan(FROZEN_MS * 0.75);
    expect(frameFreezeState().skewMs).toBeGreaterThanOrEqual(FROZEN_MS * 0.75);
  });

  it("re-arming does not move the held clock (freeze twice is idempotent on the value)", () => {
    setFrameFrozen(true);
    const first = frameNow();
    burn(8);
    setFrameFrozen(true); // re-arm: banks the elapsed freeze, then pins the new instant
    expect(frameNow()).toBe(first);
    expect(frameHeld("clock")).toBe(true);
  });

  it("thawing twice is a no-op — the skew is banked once", () => {
    setFrameFrozen(true);
    burn(6);
    const skew = setFrameFrozen(false).skewMs;
    burn(6);
    const again = setFrameFrozen(false);
    expect(again.frozen).toBe(false);
    expect(again.skewMs).toBe(skew);
    expect(frameFreezeState().skewMs).toBe(skew);
  });

  it("the clock still advances after a thaw", () => {
    setFrameFrozen(true);
    burn(4);
    setFrameFrozen(false);
    const a = frameNow();
    burn(3);
    expect(frameNow()).toBeGreaterThan(a);
  });
});

describe("frame freeze — partial freezes attribute a residual", () => {
  it("{ clock: false } leaves the clock running and holds the other two", () => {
    const s = setFrameFrozen(true, { clock: false });
    expect(s.parts).toEqual({ clock: false, streaming: true, shadow: true });
    expect(frameHeld("clock")).toBe(false);
    expect(frameHeld("streaming")).toBe(true);
    expect(frameHeld("shadow")).toBe(true);
    const a = frameNow();
    burn(4);
    expect(frameNow()).toBeGreaterThan(a);
    expect(s.held.some((h) => h.startsWith("clock:"))).toBe(false);
  });

  it("a clock-less freeze banks NO skew — releasing it must not step time backwards", () => {
    // The regression this pins: banking the freeze duration unconditionally made `frameNow()`
    // jump BACK by the whole hold on release, i.e. a negative dtMs in every ease — from the one
    // seam whose contract is that it does not disturb them.
    const FROZEN_MS = 40;
    const before = frameNow();
    setFrameFrozen(true, { clock: false });
    burn(FROZEN_MS);
    const during = frameNow();
    setFrameFrozen(false);
    const after = frameNow();
    expect(during).toBeGreaterThanOrEqual(before + FROZEN_MS * 0.75);
    expect(after).toBeGreaterThanOrEqual(during);
    expect(frameFreezeState().skewMs).toBe(0);
  });

  it("{ shadow: false } is the rig-attribution run", () => {
    setFrameFrozen(true, { shadow: false });
    expect(frameHeld("shadow")).toBe(false);
    expect(frameHeld("clock")).toBe(true);
    expect(frameHeld("streaming")).toBe(true);
  });

  it("FREEZE_PARTS is the whole parts record — a new part cannot be added unreported", () => {
    const parts = setFrameFrozen(true).parts;
    expect([...FREEZE_PARTS].sort()).toEqual(Object.keys(parts).sort());
  });
});

describe("frame freeze — the render path really reads the seam (static fence)", () => {
  const root = join(__dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const GLOBE = "src/components/globe";

  it("every module the seam touches imports it", () => {
    const wired = [
      `${GLOBE}/StylizedTiles.ts`,
      `${GLOBE}/GlobeCanvas.tsx`,
      `${GLOBE}/Pins.ts`,
      `${GLOBE}/flight.ts`,
      `${GLOBE}/scene/buildings.ts`,
      `${GLOBE}/scene/enrichedBuildings.ts`,
      `${GLOBE}/scene/imageryGround.ts`,
    ];
    const missing = wired.filter((f) => !/globe\/frameFreeze"/.test(read(f)));
    expect(missing).toEqual([]);
  });

  it("the F1 building-reveal clocks are stamped from the seam, never the raw clock", () => {
    // `uNowMs` drives the screen-door dither. A raw `performance.now()` here is exactly the
    // 30 %-of-pixels noise floor T94 exists to remove.
    for (const f of [`${GLOBE}/scene/buildings.ts`, `${GLOBE}/scene/enrichedBuildings.ts`]) {
      const src = read(f);
      expect(src, f).toMatch(/uNowMs\.value = frameNow\(\);/);
      expect(src, f).not.toMatch(/uNowMs\.value = performance\.now\(\)/);
    }
  });

  it("the ground reveal, the pin shimmer and the orchestrator dt read the seam", () => {
    expect(read(`${GLOBE}/scene/imageryGround.ts`)).toMatch(/const now = frameNow\(\);/);
    expect(read(`${GLOBE}/Pins.ts`)).toMatch(/const now = frameNow\(\);/);
    const orch = read(`${GLOBE}/StylizedTiles.ts`);
    expect(orch).toMatch(/now = frameNow\(\);/);
    expect(orch).toMatch(/dtMs = frameHeld\("clock"\) \? 0 :/);
  });

  it("streaming, the shadow rig, scene time and the tier governor are all guarded", () => {
    const orch = read(`${GLOBE}/StylizedTiles.ts`);
    // Every hold the seam claims must exist as a real branch, or `held` reports a fiction.
    for (const id of ["shadow.rig", "shadow.cascades", "scene.time"]) {
      expect(orch, id).toContain(`noteFrameHold("${id}")`);
    }
    for (const f of [
      `${GLOBE}/scene/buildings.ts`,
      `${GLOBE}/scene/enrichedBuildings.ts`,
      `${GLOBE}/scene/imageryGround.ts`,
    ]) {
      expect(read(f), f).toMatch(/if \(frameHeld\("streaming"\)\) \{/);
    }
    // A tier demote re-DPRs the whole frame — it must not land mid-capture.
    expect(read(`${GLOBE}/GlobeCanvas.tsx`)).toMatch(
      /pendingTier !== null && !frameHeld\("clock"\)/,
    );
  });

  it("the freezeFrame handle is DEV-only — a shipped build cannot arm the seam", () => {
    const orch = read(`${GLOBE}/StylizedTiles.ts`);
    const globeIdx = orch.indexOf("window.__globe = {");
    expect(globeIdx).toBeGreaterThan(-1);
    expect((orch.match(/window\.__globe = \{/g) ?? []).length).toBe(1); // one seam, one guard
    const devIdx = orch.lastIndexOf("if (import.meta.env.DEV) {", globeIdx);
    expect(devIdx).toBeGreaterThan(-1);
    expect(globeIdx - devIdx).toBeLessThan(120); // the guard immediately precedes the seam
    const freezeIdx = orch.indexOf("freezeFrame: (on?: boolean");
    expect(freezeIdx).toBeGreaterThan(globeIdx);
    // `setFrameFrozen(true)` may be reached ONLY through that DEV-only handle.
    for (const m of orch.matchAll(/setFrameFrozen\(([^)]*)\)/g)) {
      if (m.index !== undefined && m.index > freezeIdx - 400 && m.index < freezeIdx + 400) continue;
      expect(m[1], `setFrameFrozen(${m[1]}) outside the DEV seam`).toMatch(/^false/);
    }
  });

  it("the visual sweep wires --freeze end to end", () => {
    const sweep = read("scripts/verify-visual-sweep.mjs");
    expect(sweep).toMatch(/const FREEZE = flag\("--no-freeze"\)/); // parsed
    expect(sweep).toMatch(/GOLDEN \|\| !!COMPARE/); // …and on by default for a pixel run
    expect(sweep).toMatch(/g\.freezeFrame\(true\)/); // sent to the page
    expect(sweep).toMatch(/g\.freezeFrame\(false\)/); // …and released
    expect(sweep).toMatch(/frozen frame is byte-identical two rAF apart/); // the self-check gate
  });
});
