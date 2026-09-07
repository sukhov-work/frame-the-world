import { describe, expect, it } from "vitest";
import { circDiffDeg, poseFromEuler } from "../../../src/lib/sensors/deviceOrientation";
import {
  ORIENTATION_LADDER_DEFAULTS,
  OrientationLadder,
  type RawOrientationSample,
} from "../../../src/lib/sensors/orientationLadder";

/**
 * The AR degradation ladder (owner order 2026-09-07g) — every rung driven by SYNTHETIC samples
 * shaped exactly like the browser's, with the platform premises the 2026-09-07 research pinned:
 * Android's absolute frame is MAGNETIC north; iOS's α is relative to an arbitrary frame and its
 * compass is the top edge's magnetic heading; nothing carries declination.
 */

const DECL = 8.58; // Dnipro, 2026-09-07 (WMM2025)
const near = (a: number, b: number, tol = 1e-6) => Math.abs(circDiffDeg(a, b)) < tol;

/** A phone in the AR pose facing TRUE heading `h` with pitch `p`, expressed in a frame whose north
 *  is rotated `frameYawDeg` from magnetic north (0 = magnetic ENU, i.e. Android absolute). */
function euler(headingTrueDeg: number, pitchDeg: number, frameYawDeg: number) {
  const headingMag = headingTrueDeg - DECL;
  // rear camera heading h ⇒ α = −h (γ = 0), and pitch p ⇒ β = 90 + p
  return { alphaDeg: ((-(headingMag - frameYawDeg)) % 360 + 360) % 360, betaDeg: 90 + pitchDeg, gammaDeg: 0 };
}

const sample = (tMs: number, e: { alphaDeg: number; betaDeg: number; gammaDeg: number }, over: Partial<RawOrientationSample> = {}): RawOrientationSample => ({
  tMs,
  ...e,
  absolute: false,
  ...over,
});

describe("rung 1 — android-absolute", () => {
  it("heading = the pose's magnetic yaw + declination; pitch passes through; no offset", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const aim = L.push(sample(0, euler(90, -5, 0), { absolute: true }))!;
    expect(aim.rung).toBe("android-absolute");
    expect(near(aim.headingDeg, 90, 1e-4)).toBe(true);
    expect(aim.pitchDeg).toBeCloseTo(-5, 6);
    expect(aim.yawOffsetDeg).toBe(0);
  });

  it("relative samples are IGNORED while an absolute stream is live (Chromium fires both)", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    L.push(sample(0, euler(90, 0, 0), { absolute: true }));
    // a relative sample 100 ms later, in some arbitrary frame — must not move the aim
    const held = L.push(sample(100, euler(200, 0, 137)))!;
    expect(held.rung).toBe("android-absolute");
    expect(near(held.headingDeg, 90, 1e-4)).toBe(true);
    // …and after the hold window a relative sample IS taken (the absolute stream died)
    const later = L.push(sample(100 + ORIENTATION_LADDER_DEFAULTS.absoluteHoldMs + 1, euler(200, 0, 137)))!;
    expect(later.rung).not.toBe("android-absolute");
  });
});

describe("rung 2 — ios-compass: the yaw offset is learned while the top edge has a ground heading", () => {
  const FRAME = 137; // the arbitrary yaw of WebKit's xArbitraryZVertical frame

  /** The compass field WebKit would attach: the top edge's MAGNETIC heading + an accuracy. */
  const compassOf = (e: { alphaDeg: number; betaDeg: number; gammaDeg: number }, accuracy = 5) => {
    const p = poseFromEuler(e.alphaDeg, e.betaDeg, e.gammaDeg);
    return { compassHeadingDeg: ((p.topHeadingDeg + FRAME) % 360 + 360) % 360, compassAccuracyDeg: accuracy };
  };

  it("a tilted phone (top edge on the ground) fixes north; upright the offset HOLDS and the gyro carries", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    // Tilted 45° up from flat (β = 45): the top edge has a strong ground heading — the compass lands.
    const tilted = euler(120, -45, FRAME);
    const a1 = L.push(sample(0, tilted, compassOf(tilted)))!;
    expect(a1.rung).toBe("ios-compass");
    expect(near(a1.headingDeg, 120, 1e-3)).toBe(true);
    expect(a1.compassAgeMs).toBe(0);
    // Now UPRIGHT (β = 90): the top edge points at the sky — the compass sample must be ignored
    // (its heading is ill-conditioned) and the learned offset must carry the relative attitude.
    const upright = euler(200, 0, FRAME);
    const bogus = { compassHeadingDeg: 33, compassAccuracyDeg: 5 }; // whatever Core Location says here
    const a2 = L.push(sample(1000, upright, bogus))!;
    expect(a2.rung).toBe("ios-compass");
    expect(near(a2.headingDeg, 200, 1e-3)).toBe(true);
    expect(a2.compassAgeMs).toBe(1000);
    expect(a2.yawOffsetDeg).toBeCloseTo(a1.yawOffsetDeg, 6);
  });

  it("an invalid or coarse compass never lands (accuracy < 0, or above the ceiling, or the 0/−1 combo)", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const tilted = euler(120, -45, FRAME);
    for (const acc of [-1, 40, 999]) {
      const a = L.push(sample(0, tilted, { ...compassOf(tilted), compassAccuracyDeg: acc }))!;
      expect(a.rung).toBe("relative-unaligned");
      expect(a.compassAgeMs).toBe(Infinity);
    }
    const a = L.push(sample(0, tilted, { compassHeadingDeg: 0, compassAccuracyDeg: -1 }))!;
    expect(a.rung).toBe("relative-unaligned");
  });

  it("gyro drift is re-absorbed: the offset EMA follows the compass when the phone dips again", () => {
    const L = new OrientationLadder({ declinationDeg: DECL, compassOffsetTauMs: 100 });
    const tilted = euler(120, -45, FRAME);
    L.push(sample(0, tilted, compassOf(tilted)));
    // 10 minutes later the gyro has drifted 6°: the relative frame reads as if yawed by FRAME − 6,
    // while the compass (magnetic, no drift) still reports the true top heading.
    const drifted = euler(120, -45, FRAME - 6);
    let aim = L.aim()!;
    for (let i = 1; i <= 40; i++) aim = L.push(sample(600_000 + i * 50, drifted, compassOf(tilted)))!;
    expect(near(aim.headingDeg, 120, 0.05)).toBe(true); // the drift is gone
  });
});

describe("rungs 3 and 4 — relative: seed at arming, ALIGN on demand", () => {
  const FRAME = 291;

  it("unaligned: the first sample yields a heading in the arbitrary frame; align() makes it exact", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const a0 = L.push(sample(0, euler(45, 0, FRAME)))!;
    expect(a0.rung).toBe("relative-unaligned");
    // The engine seeds the offset from the camera's own heading at arming (explicit: false).
    L.align(45, false);
    expect(L.aim()!.rung).toBe("relative-unaligned"); // a seed is not an alignment the user made
    expect(near(L.aim()!.headingDeg, 45, 1e-6)).toBe(true);
    // Turning the phone 30° to the right turns the camera 30° to the right.
    const a1 = L.push(sample(100, euler(75, 10, FRAME)))!;
    expect(near(a1.headingDeg, 75, 1e-4)).toBe(true);
    expect(a1.pitchDeg).toBeCloseTo(10, 6);
    // The explicit ALIGN chip: "point the phone where the camera looks, tap" — the camera says 300.
    L.align(300, true);
    expect(L.aim()!.rung).toBe("relative-aligned");
    expect(near(L.aim()!.headingDeg, 300, 1e-6)).toBe(true);
    const a2 = L.push(sample(200, euler(85, 10, FRAME)))!; // +10° more
    expect(near(a2.headingDeg, 310, 1e-4)).toBe(true);
  });

  it("a compass fix later OVERRIDES an alignment (rung 2 outranks rung 3)", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    L.push(sample(0, euler(45, -45, FRAME)));
    L.align(10, true); // the user aligned wrongly by 35°
    const tilted = euler(45, -45, FRAME);
    const p = poseFromEuler(tilted.alphaDeg, tilted.betaDeg, tilted.gammaDeg);
    const compass = { compassHeadingDeg: ((p.topHeadingDeg + FRAME) % 360 + 360) % 360, compassAccuracyDeg: 3 };
    const a = L.push(sample(100, tilted, compass))!;
    expect(a.rung).toBe("ios-compass");
    expect(near(a.headingDeg, 45, 1e-3)).toBe(true);
  });

  it("reset() forgets everything; null / non-finite angles are rejected", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    L.push(sample(0, euler(45, 0, FRAME)));
    L.align(45, true);
    L.reset();
    expect(L.aim()).toBeNull();
    expect(L.push({ tMs: 0, alphaDeg: null, betaDeg: 0, gammaDeg: 0, absolute: false })).toBeNull();
    expect(L.push({ tMs: 0, alphaDeg: NaN, betaDeg: 0, gammaDeg: 0, absolute: false })).toBeNull();
    const a = L.push(sample(1, euler(45, 0, FRAME)))!;
    expect(a.rung).toBe("relative-unaligned");
    expect(a.yawOffsetDeg).toBe(0);
  });

  it("declination can be re-set as the pose moves (the WMM at the pin, not a constant)", () => {
    const L = new OrientationLadder({ declinationDeg: 0 });
    L.push(sample(0, euler(90, 0, 0), { absolute: true }));
    const before = L.aim()!.headingDeg;
    L.setDeclination(DECL);
    const after = L.push(sample(50, euler(90, 0, 0), { absolute: true }))!.headingDeg;
    expect(near(after - before, DECL, 1e-6)).toBe(true);
  });
});
