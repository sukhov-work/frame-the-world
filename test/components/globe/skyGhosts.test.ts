import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { attachSkyGhosts } from "../../../src/components/globe/scene/skyGhosts";
import { GHOSTS } from "../../../src/components/globe/tuning";
import { azAltToEnu } from "../../../src/lib/ephemeris/dayArc";
import { bodyTarget, targetAzAlt } from "../../../src/lib/ephemeris/targets";

/** Owner bug 2026-08-15: at 1–2 min stepping the FIRST sun/moon ghost sat 3–4 steps out — the
 *  old nowGapDiscs=1.2 exclusion cone (1.2 disc-DIAMETERS around the live body) ate the k=±1…3
 *  neighbours (diurnal drift ≈ 0.25°/min vs a 0.53° disc), which also read as a wrong count.
 *  These tests drive the real InstancedMesh headlessly (no GL until render) and pin:
 *  count semantics = N PER SIDE, the k=±1 survivors at 1-min steps, and the 15/side ceiling. */

// Midsummer Dnipro late morning — the sun ~60° high, so every ±k·step sample stays well above
// the horizon melt and the ONLY instance-dropping force under test is the now-gap cone.
const NOON = Date.UTC(2026, 5, 21, 9, 30);
const DNIPRO = { latDeg: 48.45, lonDeg: 35.0 };

function ghostCountFor(countPerSide: number, stepMin: number): number {
  const scene = new THREE.Scene();
  const handle = attachSkyGhosts(scene);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e7);
  handle.update({
    camera,
    sceneMs: NOON,
    target: bodyTarget("sun"),
    anchor: DNIPRO,
    visible: true,
    countPerSide,
    stepMin,
    dtMs: 60_000, // ≫ fadeTauMs — fade lands at ~1 in one step
  });
  const n = handle.mesh.count;
  handle.dispose();
  return n;
}

describe("skyGhosts count + first-step survival", () => {
  it("count N renders N ghosts PER SIDE (2N total) at a coarse step", () => {
    expect(ghostCountFor(3, 10)).toBe(6);
  });

  it("REGRESSION: 1-min stepping keeps the k=±1 neighbours — no fat first gap", () => {
    // Old 1.2-diameter cone: 0–2 of these 6 survived; the chain started at k=±3…4.
    expect(ghostCountFor(3, 1)).toBe(6);
    expect(ghostCountFor(1, 1)).toBe(2);
  });

  it("ceiling is 15 per side = 30 discs", () => {
    expect(GHOSTS.maxPerSide).toBe(15);
    expect(ghostCountFor(99, 10)).toBe(30);
  });

  it("the now-gap cone sits BELOW one minute of solar drift (the bug's arithmetic)", () => {
    // The guard may only drop a near-concentric ghost — never a stepping sun/moon one.
    const p0 = targetAzAlt(bodyTarget("sun"), NOON, DNIPRO.latDeg, DNIPRO.lonDeg);
    const p1 = targetAzAlt(bodyTarget("sun"), NOON + 60_000, DNIPRO.latDeg, DNIPRO.lonDeg);
    const a = azAltToEnu(p0.azDeg, p0.altDeg);
    const b = azAltToEnu(p1.azDeg, p1.altDeg);
    const sepRad = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const st = bodyTarget("sun").stateAt(NOON);
    const discRad = ((st.angularDiamArcsec ?? 0) / 3600 / 2) * (Math.PI / 180);
    expect(2 * discRad * GHOSTS.nowGapDiscs).toBeLessThan(sepRad);
  });
});
