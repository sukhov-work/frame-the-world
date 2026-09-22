/**
 * Owner order 2026-09-22 — the FPV / minimap block:
 *  (1) every FPV / minimap transition is the instant cut, the cinematic sweep kept behind a
 *      hidden toggle (FLIGHT.smoothTransitions · the `smoothFlights` pref · `__globe.smoothFlights`);
 *  (2) a jump / an entry / an exit KEEPS the focal, the exact pitch / yaw and the altitude —
 *      no defaults (the carry + the pre-entry orbit pose);
 *  (3) the mesh clearance kill switch + its wiring;
 *  (4) `/m` boots the whole planet even when a `#p=` hash hands over an orbital altitude.
 * Pure engine legs run for real; the orchestrator's wiring is source-pinned (the repo idiom —
 * `mobileArCamera.test.ts` "the engine contract"), the behaviour itself is the browser twin
 * `scripts/verify-fpv-carry-2026-09-22.mjs`.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { createFlight } from "../../../src/components/globe/flight";
import { FLIGHT, FPV, MOBILE2D } from "../../../src/components/globe/tuning";
import { sanitizeViewPrefs } from "../../../src/lib/prefs";
import { smoothFlightsBootOn } from "../../../src/lib/globe/smoothFlightsBoot";
import { WGS84_A, WGS84_B } from "../../../src/lib/geo/projection";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const ORCH = read("src/components/globe/StylizedTiles.ts");

const makeCamera = () => {
  const cam = new THREE.PerspectiveCamera(60, 1, 1, 1e9);
  cam.position.set(WGS84_A + 1_000_000, 0, 0);
  cam.lookAt(0, 0, 0);
  return cam;
};
const target = () => ({
  position: new THREE.Vector3(WGS84_A + 500, 1000, 0),
  lookAt: new THREE.Vector3(WGS84_A, 0, 0),
});

describe("(1) instant transitions — the cut is the default, the sweep is the hidden toggle", () => {
  it("FLIGHT.smoothTransitions is OFF (the owner's 2026-09-22 rule)", () => {
    expect(FLIGHT.smoothTransitions).toBe(false);
  });

  it("with smooth() false, start() lands the camera on the target the same call — nothing is in flight", () => {
    const cam = makeCamera();
    const flight = createFlight(cam, { wgs84A: WGS84_A, wgs84B: WGS84_B, smooth: () => false });
    const tgt = target();
    flight.start(tgt);
    expect(flight.active()).toBe(false);
    expect(cam.position.distanceTo(tgt.position)).toBeCloseTo(0, 6);
    expect(flight.update(performance.now() + 100)).toBe(false); // nothing to advance
  });

  it("smooth() is read LIVE per start — a seam flip takes the next flight", () => {
    let smooth = false;
    const flight = createFlight(makeCamera(), { wgs84A: WGS84_A, wgs84B: WGS84_B, smooth: () => smooth });
    flight.start(target());
    expect(flight.active()).toBe(false);
    smooth = true;
    flight.start(target());
    expect(flight.active()).toBe(true);
  });

  it("a `cinematic` start keeps its sweep under the cut rule; reduced motion still cuts it", () => {
    const sweep = createFlight(makeCamera(), { wgs84A: WGS84_A, wgs84B: WGS84_B, smooth: () => false });
    sweep.start(target(), { cinematic: true });
    expect(sweep.active()).toBe(true);
    const rm = createFlight(makeCamera(), { reduceMotion: true, wgs84A: WGS84_A, wgs84B: WGS84_B, smooth: () => true });
    rm.start(target(), { cinematic: true });
    expect(rm.active()).toBe(false);
  });

  it("no smooth() at all = the sweep (the older unit tests' flights are untouched)", () => {
    const flight = createFlight(makeCamera(), { wgs84A: WGS84_A, wgs84B: WGS84_B });
    flight.start(target());
    expect(flight.active()).toBe(true);
  });

  it("the hidden pref is a plain opt-in read (no `rearmed` resurrection) with a boot reader", () => {
    expect(sanitizeViewPrefs({ smoothFlights: true }).smoothFlights).toBe(true);
    expect(sanitizeViewPrefs({ smoothFlights: false }).smoothFlights).toBe(false);
    expect("smoothFlights" in sanitizeViewPrefs({})).toBe(false);
    expect(sanitizeViewPrefs({ smoothFlights: "yes" }).smoothFlights).toBeUndefined();
    expect(smoothFlightsBootOn()).toBe(false); // no localStorage under vitest → default OFF
    const prefs = read("src/lib/prefs.ts");
    expect(prefs).toMatch(/if \(typeof r\.smoothFlights === "boolean"\) out\.smoothFlights = r\.smoothFlights;/);
  });

  it("the orchestrator resolves seam → tunable ‖ pref, hands it to the ONE flight engine, and snaps the lens once per transition", () => {
    expect(ORCH).toMatch(/const smoothFlights = \(\) => smoothFlightsOverride \?\? \(FLIGHT\.smoothTransitions \|\| smoothFlightsPref\);/);
    expect(ORCH).toMatch(/createFlight\(camera, \{ reduceMotion, wgs84A: WGS84_A, wgs84B: WGS84_B, smooth: smoothFlights \}\)/);
    expect(ORCH).toMatch(/smoothFlights: \(on\?: boolean\) => \{/); // the DEV seam
    expect((ORCH.match(/fovSnapPending = true;/g) ?? []).length).toBe(3); // photo entry · temp entry · exit
    expect(ORCH).toMatch(/if \(fovSnapPending\) \{\s*fovSnapPending = false;\s*if \(!smoothFlights\(\) && camera\.fov !== fovTargetDeg\)/);
  });
});

describe("(2) the pose is KEPT across jumps, entries and exits — no defaults", () => {
  it("a point jump is lat/lon only: the map window (desktop), MY LOCATION, the /m ▲ 3D hold", () => {
    const mw = read("src/components/panels/MapWindow.tsx");
    // standing in FPV the point is a PIN MOVE (rigid, instant); outside FPV a carried point jump
    expect(mw).toMatch(/if \(cam\.tempFpv && cam\.tempPin\) \{\s*cam\.setTempPin\(\{ latDeg: at\.latDeg, lonDeg: at\.lonDeg \}\);\s*\} else \{\s*cam\.requestFpvJump\(\{ latDeg: at\.latDeg, lonDeg: at\.lonDeg \}\);/);
    expect(mw).not.toMatch(/eyeM: FRUSTUM\.eyeHeightM/);
    const ml = read("src/components/panels/MyLocation.tsx");
    expect(ml).toMatch(/requestFpvJump\(\{\s*latDeg: pos\.coords\.latitude,\s*lonDeg: pos\.coords\.longitude,\s*\}\)/);
    expect(ml).not.toMatch(/headingDeg: 0|pitchDeg: 0/);
    const sa = read("src/components/mobile/SceneActions.tsx");
    expect(sa).toMatch(/cam\.requestFpvJump\(\{ latDeg: cam\.focusLatDeg, lonDeg: cam\.focusLonDeg \}\);/);
    expect(sa).not.toMatch(/lastFpvFovDeg/);
  });

  it("a saved place / a share still brings the FULL pose (a place IS a pose)", () => {
    for (const f of ["src/components/mobile/MobilePlaces.tsx", "src/components/panels/MyPins.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/requestFpvJump\(\{[^}]*eyeM: p\.eyeM,[^}]*headingDeg: p\.headingDeg,[^}]*pitchDeg: p\.pitchDeg,[^}]*fovDeg: p\.fovDeg,/s);
    }
  });

  it("the entry fills every missing field from the carry (then the planned view, then the defaults)", () => {
    expect(ORCH).toMatch(/let fpvCarry: \{ eyeM: number; pitchDeg: number; fovDeg: number \} \| null = null;/);
    expect(ORCH).toMatch(/fpvEyeM =\s*share\?\.eyeM != null\s*\? THREE\.MathUtils\.clamp\(share\.eyeM, 0\.5, FPV\.tempEyeMaxM\)\s*: \(fpvCarry\?\.eyeM \?\? FRUSTUM\.eyeHeightM\);/);
    expect(ORCH).toMatch(/const entryPitchDeg = share\?\.pitchDeg \?\? fpvCarry\?\.pitchDeg \?\? null;/);
    expect(ORCH).toMatch(/: \(fpvCarry\?\.fovDeg \?\? FPV\.tempFovDeg\);/);
    expect(ORCH).toMatch(/const entryHeadingDeg = share\?\.headingDeg \?\? planEntry\?\.headingDeg \?\? null;/);
  });

  it("the exit records the carry and leaves at the PRE-ENTRY orbit pose over where the viewer stands", () => {
    expect(ORCH).toMatch(/let preFpvOrbit: \{ altAboveGroundM: number; tiltDeg: number; fovDeg: number; mapMode: "2d" \| "3d" \} \| null = null;/);
    expect(ORCH).toMatch(/fpvCarry = \{\s*eyeM: fpvEyeM,/);
    expect(ORCH).toMatch(/fovTargetDeg = back \? back\.fovDeg : POSE\.fovDeg;/);
    expect(ORCH).toMatch(/altAboveGroundM: back \? back\.altAboveGroundM : FLIGHT\.arrivalAltAboveGroundM,\s*tiltDeg: back \? back\.tiltDeg : FLIGHT\.arrivalTiltDeg,/);
    expect(ORCH).toMatch(/back \? back\.altAboveGroundM : MOBILE2D\.exitAltAboveGroundM,/);
    // the walk is part of "the current position"
    expect(ORCH).toMatch(/wasTemp && pinOut && fpvWalkOffset\.lengthSq\(\) > 0\s*\? pinOut\.clone\(\)\.add\(fpvWalkOffset\)/);
    // /m: entered from the 3D map → the 3D pose comes back, else the 2D chart as before
    expect(ORCH).toMatch(/if \(isMobileShell && !\(back && back\.mapMode === "3d"\)\) \{/);
    // the pre-entry pose is captured on a FRESH entry only (the pins-visibility guard's twin)
    expect(ORCH).toMatch(/if \(!wasFpvActive\) \{[\s\S]{0,1200}preFpvOrbit = \{/);
  });
});

describe("(3) the mesh clearance — on by default, one column, a kill switch and a DEV seam", () => {
  it("the tunables", () => {
    expect(FPV.meshClearance).toBe(true);
    expect(FPV.meshColumnUpM).toBeGreaterThanOrEqual(300); // the lift 300 m rail (2026-09-19) fits under it
    expect(FPV.meshColumnDownM).toBeGreaterThan(0);
    expect(FPV.meshStepM).toBeGreaterThan(0);
    expect(FPV.meshStepM).toBeLessThan(1);
    expect(FPV.meshColumnIdleEveryFrames).toBeGreaterThan(1);
    expect(FPV.meshFloorEaseTauMs).toBeGreaterThan(0);
  });

  it("the orchestrator casts both legs against the buildings, the enriched cells and the models — never the terrain — and classifies by face normal", () => {
    expect(ORCH).toMatch(/_colTargets\.push\(buildings\.tiles\.group\);\s*if \(enriched\) _colTargets\.push\(enriched\.tiles\.group\);\s*_colTargets\.push\(userModels\.occluderRoot\(\)\);/);
    expect(ORCH).not.toMatch(/_colTargets\.push\(ground\./);
    expect(ORCH).toMatch(/_colN\.copy\(h\.face\.normal\)\.applyMatrix3\(_colNm\)\.normalize\(\);/);
    expect(ORCH).toMatch(/if \(upDot === null \|\| Math\.abs\(upDot\) < 0\.3\) continue; \/\/ a wall is not a crossing/);
    expect(ORCH).toMatch(/if \(fpvKind === "temp"\) stepFpvMeshFloor\(\);/);
    // inside → the feet onto the top, the standing eye height — a snap; the descent eased
    expect(ORCH).toMatch(/if \(v\.inside\) \{[\s\S]{0,400}fpvEyeM = FRUSTUM\.eyeHeightM;/);
    expect(ORCH).toMatch(/else fpvMeshLiftM = seatStep\(fpvMeshLiftM, liftTarget, easeK\(dtMs, FPV\.meshFloorEaseTauMs\)\);/);
    // the kill switch and its live twin
    expect(ORCH).toMatch(/const on = fpvMeshClearanceOn \?\? FPV\.meshClearance;/);
    expect(ORCH).toMatch(/fpvClearance: \(on\?: boolean\) => \{/);
    // a fresh column on entry and on a pin change
    expect((ORCH.match(/fpvMeshFloorAbsM = null;/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("(4) /m boots the whole planet for an orbital #p= hash (owner bug 2026-09-22)", () => {
  it("the threshold sits between the desktop's 1,100 km LEO and the planet, under the planet", () => {
    expect(MOBILE2D.hashPlanetFromAltM).toBeLessThanOrEqual(1_100_000);
    expect(MOBILE2D.hashPlanetFromAltM).toBeGreaterThan(100_000);
    expect(MOBILE2D.bootAltM).toBeGreaterThan(MOBILE2D.hashPlanetFromAltM);
  });
  it("the boot reads it on the mobile shell only, keeps the hash's focus, lands nadir on the 2D chart", () => {
    expect(ORCH).toMatch(/document\.body\.classList\.contains\("m"\) &&\s*urlPose !== null &&\s*urlPose\.altM >= MOBILE2D\.hashPlanetFromAltM;/);
    expect(ORCH).toMatch(/mobilePlanetHash \? MOBILE2D\.bootAltM : urlPose\.altM,\s*mobilePlanetHash \? 0 : urlPose\.tiltDeg,/);
    expect(ORCH).toMatch(/if \(urlPose && !mobilePlanetHash && urlPose\.tiltDeg >= CONTROLS\.twoDMaxTiltDeg\)/);
  });
});
