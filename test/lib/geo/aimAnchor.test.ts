import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aimAnchorFor, type AimAnchorSources } from "../../../src/lib/geo/aimAnchor";

/**
 * AUDIT #3 A1-6 / A2-1 → T36 — the radar anchor ladder, hoisted 2026-08-22.
 *
 * Found INDEPENDENTLY by two audit tracks, and the refutation attempt FAILED. Three surfaces
 * carried three hand-written ladders; the chart's had lost the placed-photo rung and gained a
 * bare `camGeo` (the camera NADIR) ahead of the view focus.
 *
 * Mutation that makes these RED: reorder the `??` chain in `lib/geo/aimAnchor.ts`, drop the
 * `fpvActive` gate on `camGeo` (the nadir bug returns), or re-inline a ladder at any of the
 * three call sites (the last block scans for that).
 */

const CAM = { latDeg: 48.4647, lonDeg: 35.0462 }; // camera nadir / walked eye
const PHOTO = { latDeg: 51.75, lonDeg: -0.336 }; // a placed photo (St Albans)
const PIN = { latDeg: 50.45, lonDeg: 30.523 }; // a scratch pin (Kyiv)
const FOCUS = { latDeg: 0, lonDeg: 0 }; // the view focus

const sources = (o: Partial<AimAnchorSources> = {}): AimAnchorSources => ({
  fpvActive: false,
  camGeo: null,
  placement: null,
  tempPin: null,
  focus: FOCUS,
  ...o,
});

describe("aimAnchorFor — one ladder, three radar surfaces (T36)", () => {
  it("FPV live: the WALKED EYE wins over everything (owner QA 2026-08-21 item 1)", () => {
    expect(
      aimAnchorFor(sources({ fpvActive: true, camGeo: CAM, placement: PHOTO, tempPin: PIN })),
    ).toBe(CAM);
  });

  it("outside FPV a PLACED PHOTO owns the radar — the rung the chart was missing", () => {
    expect(aimAnchorFor(sources({ camGeo: CAM, placement: PHOTO, tempPin: PIN }))).toBe(PHOTO);
  });

  it("then the temp pin (owner batch #6 item 1)", () => {
    expect(aimAnchorFor(sources({ camGeo: CAM, tempPin: PIN }))).toBe(PIN);
  });

  it("THE BUG: outside FPV the camera NADIR never wins — the view focus does", () => {
    // This is the whole finding. `camGeo` is the camera's own ground point, kilometres from
    // the focus at any tilt; the chart used to seat its radar there and the focus tail below
    // it was unreachable.
    expect(aimAnchorFor(sources({ camGeo: CAM }))).toBe(FOCUS);
    expect(aimAnchorFor(sources({ camGeo: CAM }))).not.toBe(CAM);
  });

  it("the focus always lands the ladder (no null result to guard against)", () => {
    expect(aimAnchorFor(sources())).toBe(FOCUS);
  });

  it("an FPV session with no camGeo mirror yet still falls through the rest of the ladder", () => {
    expect(aimAnchorFor(sources({ fpvActive: true, camGeo: null, tempPin: PIN }))).toBe(PIN);
  });

  it("BEHAVIOUR-IDENTITY for the GL fan: it is enabled only when !fpvActive", () => {
    // The GL fan's old ladder was `placement ?? tempPin ?? focus`. Since rung 1 cannot fire on
    // a surface gated `enabled: !fpvActive`, the hoist must be a no-op there for every input.
    for (const placement of [null, PHOTO])
      for (const tempPin of [null, PIN])
        for (const camGeo of [null, CAM]) {
          const s = sources({ fpvActive: false, camGeo, placement, tempPin });
          expect(aimAnchorFor(s)).toBe(placement ?? tempPin ?? FOCUS);
        }
  });
});

describe("no surface keeps a private copy of the ladder", () => {
  const root = join(__dirname, "..", "..", "..");
  const SURFACES: [string, string][] = [
    ["src/components/globe", "StylizedTiles.ts"],
    ["src/components/panels", "MapWindow.tsx"],
    ["src/components/panels", "MiniMap.tsx"],
  ];

  it("all three radar surfaces import aimAnchorFor", () => {
    for (const [dir, file] of SURFACES) {
      const src = readFileSync(join(root, dir, file), "utf8");
      expect({ file, imports: /import \{ aimAnchorFor \} from/.test(src) }).toEqual({
        file,
        imports: true,
      });
    }
  });

  it("…and none of them re-inlines a `?? camGeo ??`-style chain", () => {
    // The exact shape of the drift: a `??` chain that reaches camGeo/tempPin/placement outside
    // an aimAnchorFor(...) call. Scanning for the nadir rung specifically keeps this cheap.
    const badRung = /\?\?\s*(cam(Now)?\.camGeo|camGeo)\s*\?\?/;
    for (const [dir, file] of SURFACES) {
      const src = readFileSync(join(root, dir, file), "utf8");
      expect({ file, drifted: badRung.test(src) }).toEqual({ file, drifted: false });
    }
    // POSITIVE CONTROL: the probe CAN match the shape it is looking for.
    expect(badRung.test("const a = x ?? camNow.camGeo ?? y;")).toBe(true);
  });
});
