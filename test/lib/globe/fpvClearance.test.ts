import { describe, expect, it } from "vitest";
import {
  boxClearance,
  solidsFromColumn,
  stepStickyEye,
  type BoxVerdict,
  type ColumnHit,
  type EyeState,
  type EyeStep,
} from "../../../src/lib/globe/fpvClearance";

const top = (hM: number): ColumnHit => ({ hM, up: true });
const under = (hM: number): ColumnHit => ({ hM, up: false });
const BODY = 1.7;
const HEAD = 0.3;
const STEP = 0.35;
const box = (eyeM: number, centre: ColumnHit[], ...corners: ColumnHit[][]) =>
  boxClearance([centre, ...corners], { eyeM, bodyM: BODY, headM: HEAD });

describe("solidsFromColumn — the crossings fold into solids, highest first (owner 2026-09-22 FPV item 3)", () => {
  it("an extruded building (a roof, no floor) is a solid standing on the ground", () => {
    expect(solidsFromColumn([top(130)])).toEqual([{ loM: -Infinity, hiM: 130 }]);
  });
  it("a bridge deck is a thin slab: top + underside", () => {
    expect(solidsFromColumn([under(105), top(105.4)])).toEqual([{ loM: 105, hiM: 105.4 }]);
  });
  it("a three-storey car park is three slabs; a floor's up-face inside a solid does not split it", () => {
    const s = solidsFromColumn([top(110), under(109.7), top(107), under(106.7), top(104), under(103.7), top(100.2)]);
    expect(s).toEqual([
      { loM: 109.7, hiM: 110 },
      { loM: 106.7, hiM: 107 },
      { loM: 103.7, hiM: 104 },
      { loM: -Infinity, hiM: 100.2 },
    ]);
    expect(solidsFromColumn([top(130), top(115), under(100)])).toEqual([{ loM: 100, hiM: 130 }]);
  });
  it("order of arrival does not matter; junk heights are dropped; a stray underside is ignored", () => {
    expect(solidsFromColumn([under(105), top(105.4)])).toEqual(solidsFromColumn([top(105.4), under(105)]));
    expect(solidsFromColumn([top(NaN), under(Infinity), top(120)])).toEqual([{ loM: -Infinity, hiM: 120 }]);
    expect(solidsFromColumn([under(90)])).toEqual([]);
  });
});

describe("boxClearance — the box against the solids (owner 2026-10-13: a human-sized box, sticky)", () => {
  it("walking into a building at street level: the centre is inside — climb onto the roof", () => {
    expect(box(101.7, [top(130)])).toMatchObject({ inside: true, climbToM: 130, wallTopM: null });
  });
  it("hovering 50 m over a roof: not inside; the roof is the landing floor", () => {
    expect(box(150, [top(130)])).toMatchObject({ inside: false, floorM: 130, ceilingM: null });
  });
  it("under a bridge deck: not inside; the deck's underside is the ceiling, the ground the floor", () => {
    expect(box(101.7, [top(105.4), under(105)])).toMatchObject({ inside: false, floorM: null, ceilingM: 105 });
  });
  it("the head touching a deck from below is NOT inside (open intervals) — the ceiling clamp owns it", () => {
    // head = 102 + 0.3 = 102.3 = the deck's underside
    expect(box(102, [top(102.7), under(102.3)])).toMatchObject({ inside: false, ceilingM: 102.3 });
  });
  it("a corner inside a wall the centre is not in: wallTopM = that solid's top", () => {
    expect(box(101.7, [], [top(130)])).toMatchObject({ inside: false, wallTopM: 130, floorM: null });
  });
  it("the centre's climb outranks a corner's wall", () => {
    expect(box(101.7, [top(120)], [top(130)])).toMatchObject({ inside: true, climbToM: 120, wallTopM: null });
  });
  it("the landing floor is the highest top under ANY part of the footprint", () => {
    expect(box(150, [top(110)], [top(125)], [])).toMatchObject({ floorM: 125 });
  });
  it("a kerb the feet are in is inside (a step up); one just under the feet is the floor", () => {
    expect(box(101.7, [top(100.2)])).toMatchObject({ inside: true, climbToM: 100.2 });
    expect(box(101.7, [top(99.8)])).toMatchObject({ inside: false, floorM: 99.8 });
  });
});

// --- the per-frame authority ---------------------------------------------------------------------
const DT = 1000 / 60;
const IN = { standM: BODY, headM: HEAD, stepM: STEP, dtMs: DT, climbTauMs: 160, climbMinRateMps: 3, fallTauMs: 200 };
const none: BoxVerdict = { inside: false, climbToM: null, wallTopM: null, floorM: null, ceilingM: null };
const eyeAbs = (base: number, s: EyeState) => (s.refAbsM ?? base) + s.eyeM;

describe("stepStickyEye — descending onto a roof lands ON it; no re-base bounce (the 2026-10-13 defect)", () => {
  it("THE BOUNCE: a slow descent used to throw the eye up by the roof height the frame the feet came within stepM — now the eye never moves up", () => {
    const base = 71.22; // the terrain under the pin
    const roof = 91.22; // a 20 m box
    let s: EyeState = { eyeM: 24, floorAbsM: null, refAbsM: null }; // hovering 4 m over the roof, terrain-referenced
    const v: BoxVerdict = { ...none, floorM: roof };
    let maxUp = 0;
    let prev = eyeAbs(base, s);
    for (let f = 0; f < 200; f++) {
      s = { ...s, eyeM: Math.max(BODY, s.eyeM - 0.05) }; // the encoder descends 5 cm per frame
      s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: v });
      const e = eyeAbs(base, s);
      maxUp = Math.max(maxUp, e - prev);
      prev = e;
    }
    expect(maxUp).toBeLessThan(0.051); // never an upward jump beyond the landing's own sub-step correction
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 6); // standing on the roof
    expect(s.floorAbsM).toBe(roof);
    expect(s.eyeM).toBe(BODY);
  });
  it("a FAST descent (7 m per frame) lands exactly on the roof: the clamp, not an overshoot-and-snap", () => {
    const base = 71.22, roof = 91.22;
    let s: EyeState = { eyeM: 60, floorAbsM: null, refAbsM: null };
    const v: BoxVerdict = { ...none, floorM: roof };
    let minAbs = Infinity;
    for (let f = 0; f < 30; f++) {
      s = { ...s, eyeM: Math.max(BODY, s.eyeM - 7) };
      s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: v });
      minAbs = Math.min(minAbs, eyeAbs(base, s));
    }
    expect(minAbs).toBeCloseTo(roof + BODY, 6); // the feet never went below the roof
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 6);
  });
  it("standing on the roof the encoder cannot push the eye below it; ascending lifts it at once", () => {
    const base = 71.22, roof = 91.22;
    let s: EyeState = { eyeM: BODY, floorAbsM: roof, refAbsM: roof };
    const v: BoxVerdict = { ...none, floorM: roof };
    s = stepStickyEye({ ...s, eyeM: BODY }, { ...IN, baseAbsM: base, verdict: v });
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 6);
    s = stepStickyEye({ ...s, eyeM: BODY + 0.5 }, { ...IN, baseAbsM: base, verdict: v });
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY + 0.5, 6); // no pin, no lag
  });
});

describe("stepStickyEye — the floor reference changes without moving a HOVERING eye (the elevator + the dip)", () => {
  it("hovering 30 m over roof A and walking over a taller roof B: the eye stays put (was: +height of B)", () => {
    const base = 70, A = 90, B = 110;
    let s: EyeState = { eyeM: 30, floorAbsM: A, refAbsM: A }; // eye = 120
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, floorM: B } });
    expect(eyeAbs(base, s)).toBeCloseTo(120, 6);
    expect(s.floorAbsM).toBe(B);
    expect(s.eyeM).toBeCloseTo(10, 6);
  });
  it("hovering over a roof, the roof passes out of the column's reach: the eye stays put (was: a 20 m eased dip)", () => {
    const base = 70, roof = 90;
    let s: EyeState = { eyeM: 450, floorAbsM: roof, refAbsM: roof }; // eye = 540
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: none });
    expect(eyeAbs(base, s)).toBeCloseTo(540, 6);
    expect(s.floorAbsM).toBeNull();
    expect(s.refAbsM).toBeNull();
    expect(s.eyeM).toBeCloseTo(470, 6);
  });
  it("hovering over the terrain, a roof appears under the feet: the eye stays put, re-referenced to the roof", () => {
    const base = 70, roof = 90;
    let s: EyeState = { eyeM: 50, floorAbsM: null, refAbsM: null }; // eye = 120
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, floorM: roof } });
    expect(eyeAbs(base, s)).toBeCloseTo(120, 6);
    expect(s.floorAbsM).toBe(roof);
    expect(s.eyeM).toBeCloseTo(30, 6);
  });
  it("the terrain moving under a standing mesh walker (a tile refine) does not move the eye", () => {
    const roof = 90;
    let s: EyeState = { eyeM: BODY, floorAbsM: roof, refAbsM: roof };
    s = stepStickyEye(s, { ...IN, baseAbsM: 72, verdict: { ...none, floorM: roof } }); // the terrain rose 2 m
    expect(eyeAbs(72, s)).toBeCloseTo(roof + BODY, 6);
    expect(s.refAbsM).toBe(roof);
  });
});

describe("stepStickyEye — STANDING feet follow the floor: off a roof edge is a fall, a kerb a step", () => {
  it("walking off a roof edge while standing: an eased descent to the ground, never an instant drop", () => {
    const base = 70, roof = 90;
    let s: EyeState = { eyeM: BODY, floorAbsM: roof, refAbsM: roof };
    const e0 = eyeAbs(base, s);
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: none });
    expect(s.floorAbsM).toBeNull();
    expect(eyeAbs(base, s)).toBeLessThan(e0);
    expect(eyeAbs(base, s)).toBeGreaterThan(e0 - 3); // eased: τ 200 ms moves ~8 % of 20 m in one frame
    for (let f = 0; f < 120; f++) s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: none });
    expect(eyeAbs(base, s)).toBeCloseTo(base + BODY, 3);
  });
  it("walking from a high roof onto a lower one: the feet settle on the lower roof", () => {
    const base = 70, A = 90, B = 85;
    let s: EyeState = { eyeM: BODY, floorAbsM: A, refAbsM: A };
    for (let f = 0; f < 120; f++) s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, floorM: B } });
    expect(eyeAbs(base, s)).toBeCloseTo(B + BODY, 3);
    expect(s.floorAbsM).toBe(B);
  });
  it("a top below the terrain under the feet is buried — the terrain stays the floor", () => {
    const base = 70;
    let s: EyeState = { eyeM: BODY, floorAbsM: null, refAbsM: null };
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, floorM: 60 } });
    expect(s.floorAbsM).toBeNull();
    expect(eyeAbs(base, s)).toBeCloseTo(base + BODY, 6);
  });
});

describe("stepStickyEye — inside → climb (a glide, not a snap); a wall ahead blocks the walk and climbs", () => {
  it("inside a 30 m building: the lift glides up to the roof over several frames, then stands", () => {
    const base = 70, roof = 100;
    const s0: EyeState = { eyeM: BODY, floorAbsM: null, refAbsM: null };
    const v: BoxVerdict = { ...none, inside: true, climbToM: roof };
    const r1 = stepStickyEye(s0, { ...IN, baseAbsM: base, verdict: v });
    expect(r1.climbing).toBe(true);
    expect(r1.floorAbsM).toBe(roof);
    expect(eyeAbs(base, r1)).toBeGreaterThan(base + BODY + 1); // moving, fast
    expect(eyeAbs(base, r1)).toBeLessThan(roof + BODY); // not there yet — a glide
    let s: EyeStep = r1;
    let frames = 1;
    while (s.climbing && frames < 300) {
      s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: v });
      frames++;
    }
    expect(s.climbing).toBe(false);
    expect(frames).toBeLessThan(90); // under 1.5 s for 30 m
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 6);
    expect(s.standing).toBe(true);
  });
  it("a short kerb inside the feet is cleared in one frame (the floor rate)", () => {
    const base = 70;
    const s = stepStickyEye({ eyeM: BODY, floorAbsM: null, refAbsM: null }, { ...IN, baseAbsM: base, verdict: { ...none, inside: true, climbToM: 70.04 } });
    expect(s.climbing).toBe(false);
    expect(eyeAbs(base, s)).toBeCloseTo(70.04 + BODY, 6);
  });
  it("a wall in the box's footprint: the walk is blocked, the eye climbs toward the wall's top, and lands on it", () => {
    const base = 70, roof = 82;
    const s0: EyeState = { eyeM: BODY, floorAbsM: null, refAbsM: null };
    const wall: BoxVerdict = { ...none, wallTopM: roof };
    const r1 = stepStickyEye(s0, { ...IN, baseAbsM: base, verdict: wall });
    expect(r1.blockedWalk).toBe(true);
    expect(r1.climbing).toBe(true);
    expect(eyeAbs(base, r1)).toBeGreaterThan(base + BODY);
    let s: EyeStep = r1;
    for (let f = 0; f < 120 && s.climbing; f++) s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: wall });
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 3); // the feet at the wall's top
    // the step is now accepted: the box is over the roof and the centre column sees it under the feet
    s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, floorM: roof } });
    expect(s.blockedWalk).toBe(false);
    expect(s.floorAbsM).toBe(roof);
    expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 3);
    expect(s.standing).toBe(true);
  });
});

describe("stepStickyEye — the wall climb HOLDS at the top edge once reached (the latch; no sawtooth)", () => {
  it("a wall verdict whose top the feet have reached keeps the reference there frame after frame", () => {
    const base = 70, roof = 90;
    let s = stepStickyEye({ eyeM: BODY, floorAbsM: null, refAbsM: roof }, { ...IN, baseAbsM: base, verdict: { ...none, wallTopM: roof } });
    for (let f = 0; f < 30; f++) {
      s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: { ...none, wallTopM: roof } });
      expect(eyeAbs(base, s)).toBeCloseTo(roof + BODY, 6);
      expect(s.blockedWalk).toBe(true);
      expect(s.climbing).toBe(false);
    }
  });
});

describe("stepStickyEye — rising into an underside stops under it (sticky), never teleports onto the deck", () => {
  it("THE FROM-BELOW BOUNCE: the head reaches a deck's underside — the eye stops 0.3 m under it", () => {
    const base = 70, lo = 76, hi = 76.4;
    let s: EyeState = { eyeM: BODY, floorAbsM: null, refAbsM: null };
    const v: BoxVerdict = { ...none, ceilingM: lo };
    let maxAbs = 0;
    for (let f = 0; f < 200; f++) {
      s = { ...s, eyeM: s.eyeM + 0.2 }; // ascending 20 cm per frame
      s = stepStickyEye(s, { ...IN, baseAbsM: base, verdict: v });
      maxAbs = Math.max(maxAbs, eyeAbs(base, s));
    }
    expect(maxAbs).toBeLessThanOrEqual(lo - HEAD + 1e-6);
    expect(eyeAbs(base, s)).toBeCloseTo(lo - HEAD, 6);
    expect(s.floorAbsM).toBeNull(); // never lifted onto the deck (hi)
    void hi;
  });
  it("the ceiling clamp never pushes the eye below the standing height (a 1.5 m crawl space)", () => {
    const base = 70;
    const s = stepStickyEye({ eyeM: BODY, floorAbsM: null, refAbsM: null }, { ...IN, baseAbsM: base, verdict: { ...none, ceilingM: base + 1.5 } });
    expect(s.eyeM).toBe(BODY);
  });
});

describe("boxClearance — the SWEEP while walking (a step cannot cross a wall at any speed)", () => {
  it("not in a solid before the step, in it after: a WALL, not inside — whatever the step length", () => {
    const v = boxClearance([[top(130)], [top(130)], []], { eyeM: 101.7, bodyM: BODY, headM: HEAD, preStepHits: [] });
    expect(v).toMatchObject({ inside: false, wallTopM: 130 });
  });
  it("already in the solid before the step: inside (climb from within), the wall rule stands down", () => {
    const v = boxClearance([[top(130)], [], []], { eyeM: 101.7, bodyM: BODY, headM: HEAD, preStepHits: [top(130)] });
    expect(v).toMatchObject({ inside: true, climbToM: 130, wallTopM: null });
  });
  it("walking off a roof edge as the feet drop: the pre-step column is still over the roof, the post-step one is not — neither inside nor a wall", () => {
    // the feet at 129 (falling), the pre-step centre over the 130 m roof, the post-step centre past the edge
    const v = boxClearance([[], [], []], { eyeM: 130.7, bodyM: BODY, headM: HEAD, preStepHits: [top(130)] });
    expect(v).toMatchObject({ inside: false, wallTopM: null, floorM: null });
  });
  it("a corner alone entering a kerb ahead is a wall whose top is the kerb (the climb is a step)", () => {
    const v = boxClearance([[], [top(100.4)], []], { eyeM: 101.7, bodyM: BODY, headM: HEAD, preStepHits: [] });
    expect(v).toMatchObject({ inside: false, wallTopM: 100.4 });
  });
});

describe("boxClearance / stepStickyEye — the head band and the climb's start (the slab sawtooth)", () => {
  it("a solid only the head pokes into from below is a CEILING, not inside (the encoder overshoots a step)", () => {
    // eye 101.8, head 102.1; the slab 102.0–102.4: the head is 0.1 m in, the body is not
    expect(box(101.8, [top(102.4), under(102.0)])).toMatchObject({ inside: false, ceilingM: 102.0 });
  });
  it("…and the clamp then holds the eye 0.3 m under it on the same frame", () => {
    const s = stepStickyEye({ eyeM: 31.8, floorAbsM: null, refAbsM: null }, { ...IN, baseAbsM: 70, verdict: { ...none, ceilingM: 102.0 } });
    expect(70 + s.eyeM).toBeCloseTo(101.7, 6);
  });
  it("a hovering eye that enters a solid climbs from where it is, never from the terrain", () => {
    const s = stepStickyEye({ eyeM: 12, floorAbsM: null, refAbsM: null }, { ...IN, baseAbsM: 70, verdict: { ...none, inside: true, climbToM: 100 } });
    expect(eyeAbs(70, s)).toBeGreaterThan(82); // was 71.7 + one glide step
    expect(eyeAbs(70, s)).toBeLessThan(101.7);
  });
});
