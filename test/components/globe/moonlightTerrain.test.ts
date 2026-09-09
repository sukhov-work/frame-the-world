import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND, SHADOWS, SKY, ULTRA } from "../../../src/components/globe/tuning";
import { moonPhaseIntensity } from "../../../src/lib/ephemeris/moonlight";
import { bandCurve } from "../../../src/lib/globe/lightBands";
import { tokens } from "../../../src/lib/theme/tokens";

/**
 * THE MOONLIGHT RETUNE (owner 2026-09-10b: "very bright washed out and milky white … should be
 * toned down and made much more contrasty and realistic"). A JS twin of the night half of the
 * ground grade (`scene/imageryGround.ts`, the `moonlit` / `ambient` / `shade` lines at deep
 * night under the LOOK), pinning the three properties the retune bought:
 *
 *   1. the picture is ALBEDO-CARRIED: forest, rock and snow separate (the old 0.7 flat fill
 *      painted them the same milky grey — the fill alone was brighter than any albedo term);
 *   2. it is ASPECT-CARRIED: a moon-facing slope is clearly brighter than an anti-moon one;
 *   3. it is DIM: full-moon rock stays far below its daytime self, and a new moon is not black.
 *
 * Deep night: dayK 0, night 1, skyLevel at its floor, directK 0 (so photoShade 0), photo 0 (the
 * 3D de-grade is gated on `night` — the fix), uFtwUltraLight 1 (the LOOK ships on the base rig).
 */

const moonCol = new THREE.Color(tokens.moonlight); // linear (three converts the hex on construction)
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

interface Night {
  albedo: number; // grey, linear
  nSMoon: number; // surface normal · moon direction
  nUpMoon: number; // geodetic up · moon direction
  phaseDeg: number; // K&S phase ANGLE: 0 full … 180 new
}

function nightTerrain({ albedo, nSMoon, nUpMoon, phaseDeg }: Night): THREE.Color {
  const skyLevel = bandCurve(ULTRA.skyLevelCurve, Math.sin((-40 * Math.PI) / 180)); // deep night
  const shade = GROUND.nightFloor * Math.max(skyLevel, GROUND.nightFloorSkyMin); // :718 twin, ultraLight 1
  const graded = albedo * GROUND.gain; // grey → desat/cast are identity
  const moonGlow = SKY.moonSceneGlow * moonPhaseIntensity(phaseDeg);
  const sheenK = Math.max(nSMoon, 0) * moonGlow * GROUND.moonSheenK;
  const moonUp = THREE.MathUtils.lerp(Math.max(nUpMoon, 0), Math.max(nSMoon, 0), GROUND.moonFillNormalK);
  const fillK = moonGlow * GROUND.moonFillK * moonUp;
  const out = new THREE.Color();
  out.r = graded * shade + graded * moonCol.r * sheenK + moonCol.r * fillK + moonCol.r * GROUND.ambientNightK;
  out.g = graded * shade + graded * moonCol.g * sheenK + moonCol.g * fillK + moonCol.g * GROUND.ambientNightK;
  out.b = graded * shade + graded * moonCol.b * sheenK + moonCol.b * fillK + moonCol.b * GROUND.ambientNightK;
  return out;
}

const FULL = 0; // phase angle 0 = full moon (K&S 1991)
const NEW = 180;
// a 30° slope facing the moon at 44° elevation vs the same slope facing away
const moonEl = (44 * Math.PI) / 180;
const facing = { nSMoon: Math.cos(moonEl - Math.PI / 6), nUpMoon: Math.sin(moonEl) };
const away = { nSMoon: Math.cos(moonEl + Math.PI / 6), nUpMoon: Math.sin(moonEl) };

describe("night terrain under the moon — the retune's three properties", () => {
  it("1. albedo carries the picture: snow / rock / forest separate by more than the old flat fill allowed", () => {
    const forest = lum(nightTerrain({ albedo: 0.05, ...facing, phaseDeg: FULL }));
    const rock = lum(nightTerrain({ albedo: 0.35, ...facing, phaseDeg: FULL }));
    const snow = lum(nightTerrain({ albedo: 0.9, ...facing, phaseDeg: FULL }));
    expect(rock / forest).toBeGreaterThan(1.8);
    expect(snow / rock).toBeGreaterThan(1.6);
  });

  it("2. aspect carries relief: a moon-facing slope reads clearly brighter than an anti-moon one", () => {
    // the albedo-scaled sheen is the relief maker, so a dark forest shows less of it than rock
    // or snow — that is the physics (its flat terms are most of what little light it returns)
    for (const [albedo, minRatio] of [
      [0.05, 1.4],
      [0.35, 1.7],
      [0.9, 1.8],
    ] as const) {
      const f = lum(nightTerrain({ albedo, ...facing, phaseDeg: FULL }));
      const a = lum(nightTerrain({ albedo, ...away, phaseDeg: FULL }));
      expect(f / a).toBeGreaterThan(minRatio);
    }
  });

  it("3. it is dim, and never black: full-moon rock sits far below a day rock; a new-moon forest still has a floor", () => {
    // the day grade for the same rock is `graded × shade(≈1)` = albedo × gain, before the day's
    // own ambient and photo de-grade lift it further — a CONSERVATIVE daytime reference
    const dayRock = 0.35 * GROUND.gain;
    const fullRock = lum(nightTerrain({ albedo: 0.35, ...facing, phaseDeg: FULL }));
    expect(fullRock).toBeLessThan(dayRock * 0.4);
    expect(fullRock).toBeGreaterThan(dayRock * 0.15); // …but a full moon still SHOWS the rock
    const newForest = lum(nightTerrain({ albedo: 0.05, ...away, phaseDeg: NEW }));
    expect(newForest).toBeGreaterThan(0.004); // the albedo floor + the ambient — a silhouette, not a hole
    expect(newForest).toBeLessThan(fullRock);
  });

  it("the flat fill no longer outweighs the albedo-scaled terms (the milky-mass signature)", () => {
    // at a full moon, on a moon-facing rock, the fill contributes less than sheen + floor together
    const moonGlow = SKY.moonSceneGlow * moonPhaseIntensity(FULL);
    const graded = 0.35 * GROUND.gain;
    const skyLevel = bandCurve(ULTRA.skyLevelCurve, Math.sin((-40 * Math.PI) / 180));
    const floor = graded * GROUND.nightFloor * Math.max(skyLevel, GROUND.nightFloorSkyMin);
    const sheen = graded * lum(moonCol) * facing.nSMoon * moonGlow * GROUND.moonSheenK;
    const moonUp = THREE.MathUtils.lerp(facing.nUpMoon, facing.nSMoon, GROUND.moonFillNormalK);
    const fill = lum(moonCol) * moonGlow * GROUND.moonFillK * moonUp;
    expect(fill).toBeLessThan(sheen + floor);
  });

  it("the tunables the retune rests on keep their shape", () => {
    expect(GROUND.nightFloorSkyMin).toBeGreaterThan(0.1);
    expect(GROUND.nightFloorSkyMin).toBeLessThan(0.5);
    expect(GROUND.moonFillK).toBeLessThan(0.15);
    expect(GROUND.moonFillNormalK).toBeGreaterThan(0.4);
    expect(SHADOWS.moonGroundOpacity).toBeGreaterThan(0.6);
    expect(SHADOWS.moonGroundOpacity).toBeLessThan(SHADOWS.groundOpacity + 1e-9);
  });
});
