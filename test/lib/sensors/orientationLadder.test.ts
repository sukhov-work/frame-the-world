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

// ── 2026-09-19 — GYRO-LED, COMPASS-TRIMMED (the owner's "it drifts each time you move the phone
//    from side to side"); the visual calibration's yaw as a compass BIAS ─────────────────────────

describe("rung 1, gyro-led — Chromium's relative stream drives, the absolute one only trims", () => {
  const FRAME = 213; // the game-rotation-vector frame's arbitrary yaw

  /** Both Chromium streams at 60 Hz for a true-heading function; `absHeading` is what the
   *  magnetometer-fused stream CLAIMS (lagging / bent), the relative stream is the gyro's truth. */
  function run(L: OrientationLadder, fromMs: number, ms: number, trueHeading: (t: number) => number, absHeading: (t: number) => number, relative = true) {
    let worst = 0;
    let last = L.aim();
    for (let t = fromMs; t <= fromMs + ms; t += 16) {
      if (relative) L.push(sample(t, euler(trueHeading(t), 0, FRAME)));
      last = L.push(sample(t + 3, euler(absHeading(t), 0, 0), { absolute: true }));
      if (last) worst = Math.max(worst, Math.abs(circDiffDeg(last.headingDeg, trueHeading(t))));
    }
    return { worst, last: last! };
  }

  it("pairs the streams on the first frame: same heading as the absolute stream, now `fused`", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const { last, worst } = run(L, 0, 500, () => 90, () => 90);
    expect(last.rung).toBe("android-absolute"); // the chip's copy is unchanged
    expect(last.fused).toBe(true);
    expect(worst).toBeLessThan(1e-3);
  });

  it("THE SWING: a compass that lags 400 ms drags a direct view ~20° off; the gyro-led view stays put — and comes back to where it started", () => {
    // ±60° side to side, 2.4 s per cycle (peak ≈ 157°/s), five cycles, then held still at the start.
    const swing = (t: number) => 100 + 60 * Math.sin((2 * Math.PI * t) / 2400);
    // a first-order lag of the true heading (τ 400 ms), integrated at the sample cadence
    const lagged = (() => {
      let y = 100;
      let tPrev = 0;
      return (t: number) => {
        const k = 1 - Math.exp(-(t - tPrev) / 400);
        tPrev = t;
        y += (swing(t) - y) * k;
        return y;
      };
    })();
    const direct = new OrientationLadder({ declinationDeg: DECL });
    const dLag = lagged;
    const dRes = run(direct, 0, 12_000, swing, dLag, false);
    expect(dRes.last.fused).toBe(false);
    expect(dRes.worst).toBeGreaterThan(15); // what the owner sees today

    const fused = new OrientationLadder({ declinationDeg: DECL });
    run(fused, -3000, 2984, () => 100, () => 100); // three quiet seconds: acquire + settle
    const lag2 = (() => {
      let y = 100;
      let tPrev = 0;
      return (t: number) => {
        const k = 1 - Math.exp(-Math.max(0, t - tPrev) / 400);
        tPrev = t;
        y += (swing(t) - y) * k;
        return y;
      };
    })();
    const fRes = run(fused, 0, 12_000, swing, lag2);
    expect(fRes.last.fused).toBe(true);
    expect(fRes.worst).toBeLessThan(1); // the swing never reaches the view
    // …and after the swing, held still where it began, the heading is where it began.
    const after = run(fused, 12_016, 3000, () => 100, (t) => lag2(t));
    expect(Math.abs(circDiffDeg(after.last.headingDeg, 100))).toBeLessThan(0.5);
  });

  it("the relative stream dying falls back to the direct rung; the absolute stream dying leaves the gyro carrying", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    run(L, 0, 1000, () => 90, () => 90);
    // only absolute samples from here on
    let a = L.aim()!;
    for (let t = 1016; t < 2500; t += 16) a = L.push(sample(t, euler(140, 0, 0), { absolute: true }))!;
    expect(a.fused).toBe(false);
    expect(near(a.headingDeg, 140, 1e-3)).toBe(true);
    // …a fresh ladder: fused, then ONLY relative samples — north is kept, the gyro carries
    const M = new OrientationLadder({ declinationDeg: DECL });
    run(M, 0, 1000, () => 90, () => 90);
    let b = M.aim()!;
    for (let t = 1016; t < 1016 + ORIENTATION_LADDER_DEFAULTS.absoluteHoldMs + 600; t += 16) b = M.push(sample(t, euler(200, 5, FRAME)))!;
    expect(b.rung).toBe("ios-compass"); // "a compass offset is known, the gyro carries" — the same state iOS is in upright
    expect(near(b.headingDeg, 200, 1e-3)).toBe(true);
  });
});

describe("rung 2 — the iOS compass is only believed below vertical, and only slowly", () => {
  const FRAME = 137;
  const compassFor = (e: { alphaDeg: number; betaDeg: number; gammaDeg: number }) => {
    const p = poseFromEuler(e.alphaDeg, e.betaDeg, e.gammaDeg);
    return { compassHeadingDeg: ((p.topHeadingDeg + FRAME) % 360 + 360) % 360, compassAccuracyDeg: 5 };
  };

  it("tipped BACK past vertical (looking up at the sky) a compass sample is ignored — top-edge and camera headings are 180° apart there", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const up = euler(120, 45, FRAME); // β = 135: the top edge has a ground heading, the screen faces DOWN
    expect(poseFromEuler(up.alphaDeg, up.betaDeg, up.gammaDeg).topHoriz).toBeGreaterThan(0.35);
    const a = L.push(sample(0, up, compassFor(up)))!;
    expect(a.rung).toBe("relative-unaligned");
    expect(a.compassAgeMs).toBe(Infinity);
    // …the gate can be switched off (the device pass may prove Core Location consistent)
    const M = new OrientationLadder({ declinationDeg: DECL, compassMinScreenUp: -1 });
    expect(M.push(sample(0, up, compassFor(up)))!.rung).toBe("ios-compass");
  });

  it("a wrong compass for one second moves the view by less than the rate cap allows — not by the error", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const tilted = euler(120, -45, FRAME);
    const good = compassFor(tilted);
    let t = 0;
    for (; t < 3000; t += 16) L.push(sample(t, tilted, good));
    expect(near(L.aim()!.headingDeg, 120, 1e-3)).toBe(true);
    // a steel railing: the compass reads 12° off for a second
    const bent = { ...good, compassHeadingDeg: (good.compassHeadingDeg + 12) % 360 };
    for (; t < 4000; t += 16) L.push(sample(t, tilted, bent));
    expect(Math.abs(circDiffDeg(L.aim()!.headingDeg, 120))).toBeLessThan(1.6); // ≤ 1.5°/s × 1 s (it was ~8.6° under the 0.8 s EMA)
  });

  it("a sensor gap (the page slept, Core Motion re-seeded its frame) re-acquires on the next fix — no 25-second slew", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    const tilted = euler(120, -45, FRAME);
    for (let t = 0; t < 3000; t += 16) L.push(sample(t, tilted, compassFor(tilted)));
    // the frame is now somewhere else entirely
    const FRAME2 = 301;
    const e2 = euler(120, -45, FRAME2);
    const p2 = poseFromEuler(e2.alphaDeg, e2.betaDeg, e2.gammaDeg);
    const c2 = { compassHeadingDeg: ((p2.topHeadingDeg + FRAME2) % 360 + 360) % 360, compassAccuracyDeg: 5 };
    const a = L.push(sample(60_000, e2, c2))!;
    expect(near(a.headingDeg, 120, 1e-3)).toBe(true);
  });
});

describe("the visual calibration's yaw is a compass BIAS — it lives in the trim, never on the relative rungs", () => {
  it("direct absolute: the bias adds at once, RESET (0) takes it off at once", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    L.setUserBias(-4);
    expect(near(L.push(sample(0, euler(90, 0, 0), { absolute: true }))!.headingDeg, 86, 1e-4)).toBe(true);
    L.setUserBias(0);
    expect(near(L.aim()!.headingDeg, 90, 1e-4)).toBe(true);
    expect(L.userBiasDeg()).toBe(0);
  });

  it("CONFIRM on a compass rung answers the bias to persist and the view keeps the drag", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    for (let t = 0; t < 2000; t += 16) L.push(sample(t, euler(90, 0, 0), { absolute: true }));
    const bias = L.commitCalibration(3.5, 2000);
    expect(bias).toBeCloseTo(3.5, 6);
    expect(near(L.aim()!.headingDeg, 93.5, 1e-4)).toBe(true);
    for (let t = 2016; t < 12_000; t += 16) L.push(sample(t, euler(90, 0, 0), { absolute: true }));
    expect(near(L.aim()!.headingDeg, 93.5, 1e-3)).toBe(true); // it HOLDS
    // reset() (AR off → on) forgets what was learned, never the bias
    L.reset();
    expect(near(L.push(sample(20_000, euler(90, 0, 0), { absolute: true }))!.headingDeg, 93.5, 1e-4)).toBe(true);
  });

  it("a relative rung has no compass to bias: the stored bias does nothing, and CONFIRM is an ALIGN by eye (null = keep the stored bias)", () => {
    const L = new OrientationLadder({ declinationDeg: DECL });
    L.setUserBias(9);
    L.push(sample(0, euler(45, 0, 291)));
    L.align(45, false);
    expect(near(L.aim()!.headingDeg, 45, 1e-6)).toBe(true); // no +9
    expect(L.commitCalibration(-6, 10)).toBeNull();
    expect(L.aim()!.rung).toBe("relative-aligned");
    expect(near(L.aim()!.headingDeg, 39, 1e-6)).toBe(true);
    expect(L.userBiasDeg()).toBe(9);
  });
});
