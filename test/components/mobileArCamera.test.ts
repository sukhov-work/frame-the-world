import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FpvControls, { AR_COPY, ArLookToggle } from "../../src/components/mobile/FpvControls";
import ArCameraOverlay, { AR_CAL_COPY } from "../../src/components/mobile/ArCameraOverlay";
import { heldLongEnough } from "../../src/components/controls/useLongPress";
import { useCameraStore, type ArLookState } from "../../src/store/camera";
import { AR_CALIB_IDENTITY, AR_CALIB_KEY } from "../../src/lib/sensors/arCalibration";
import { FPV, ORCH as ORCH_TUNING } from "../../src/components/globe/tuning";

/**
 * AR CAMERA OVERLAY + VISUAL CALIBRATION (owner order 2026-09-19) — the store seam, the chips and
 * the source contracts. `renderToStaticMarkup` over the live store (the `mobileArLook.test.ts`
 * idiom; no DOM in this repo's vitest — the stream, the gestures and the pixels are the browser
 * harness's and the owner's phone's).
 *
 * Mutations that make these RED: a calibration that survives CANCEL or does not survive CONFIRM;
 * a CONFIRM that persists the DRAG as if it were the bias (the engine answers the bias); RESET
 * leaving the stored record; the CAM chip offered without AR; the long press sneaking a second
 * permission call in; the ALIGN / seed forgetting to subtract the drag; the feed seated above the
 * FPV instruments or the pad below the canvas.
 */

const BOOT = { ...useCameraStore.getState() };
const render = (el: Parameters<typeof createElement>[0]) => {
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  return renderToStaticMarkup(createElement(el as never));
};
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const LIVE: ArLookState = { rung: "android-absolute", compassAccuracyDeg: null, compassAgeMs: Infinity, samples: 9, stale: false, headingDeg: 45, pitchDeg: 2, declinationDeg: 8.58 };

function fakeStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

beforeEach(() => {
  useCameraStore.setState({ ...BOOT, arCalibration: { ...AR_CALIB_IDENTITY } }, true);
});
afterEach(() => vi.unstubAllGlobals());

describe("store seam — the working copy, CONFIRM / RESET / CANCEL", () => {
  it("boots off and uncalibrated; entering calibration opens a draft whose yaw (the DRAG) starts at 0", () => {
    const s = useCameraStore.getState();
    expect(s.arCam).toBe("off");
    expect(s.arCalDraft).toBeNull();
    useCameraStore.setState({ arCalibration: { ...AR_CALIB_IDENTITY, yawDeg: 6, pitchDeg: 1, camLongFovDeg: 66, savedAtMs: 5 } });
    s.setArCam("calibrate");
    expect(useCameraStore.getState().arCalDraft).toMatchObject({ yawDeg: 0, pitchDeg: 1, camLongFovDeg: 66 });
    s.setArCam("view");
    expect(useCameraStore.getState().arCalDraft).toBeNull(); // leaving any way but CONFIRM drops it
  });

  it("gesture steps move only the draft", () => {
    const s = useCameraStore.getState();
    s.stepArCalDraft({ dYawDeg: 3 }); // no draft → nothing
    expect(useCameraStore.getState().arCalDraft).toBeNull();
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: -3, dPitchDeg: 1.5, spread: 1.1 });
    const d = useCameraStore.getState().arCalDraft!;
    expect(d).toMatchObject({ yawDeg: -3, pitchDeg: 1.5 });
    expect("rollDeg" in d).toBe(false); // roll left the record 2026-09-22
    expect(d.camLongFovDeg).toBeGreaterThan(AR_CALIB_IDENTITY.camLongFovDeg); // a pinch OUT widens the estimate
    expect(useCameraStore.getState().arCalibration).toEqual(AR_CALIB_IDENTITY);
  });

  it("CONFIRM with live sensors only bumps the epoch — the ENGINE answers the bias, and THAT is what persists", () => {
    const m = fakeStorage();
    const s = useCameraStore.getState();
    s.setArLook(true);
    s._syncArLook(LIVE);
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: -4, dPitchDeg: 2 });
    s.confirmArCalibration();
    expect(useCameraStore.getState().arCalCommitEpoch).toBe(1);
    expect(useCameraStore.getState().arCalDraft).not.toBeNull(); // still open until the engine answers
    expect(m.has(AR_CALIB_KEY)).toBe(false);
    // the trim had 1.2° of unconverged residual: the bias is −5.2, not the −4 that was dragged
    s._onArCalibrated(-5.2);
    const c = useCameraStore.getState();
    expect(c.arCalibration).toMatchObject({ yawDeg: -5.2, pitchDeg: 2 });
    expect(c.arCalibration.savedAtMs).toBeGreaterThan(0);
    expect(c.arCalDraft).toBeNull();
    expect(c.arCam).toBe("view"); // the feed stays up so the result can be judged
    expect(JSON.parse(m.get(AR_CALIB_KEY)!)).toMatchObject({ yawDeg: -5.2, pitchDeg: 2 });
  });

  it("a relative rung answers null: the drag was an ALIGN by eye — the stored yaw stays, pitch / FOV still save", () => {
    fakeStorage();
    const s = useCameraStore.getState();
    useCameraStore.setState({ arCalibration: { ...AR_CALIB_IDENTITY, yawDeg: 7, savedAtMs: 1 } });
    s._syncArLook({ ...LIVE, rung: "relative-aligned" });
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: 30, dPitchDeg: -1 });
    s.confirmArCalibration();
    s._onArCalibrated(null);
    expect(useCameraStore.getState().arCalibration).toMatchObject({ yawDeg: 7, pitchDeg: -1 });
  });

  it("CONFIRM without live sensors folds the drag into the stored bias itself (no engine to ask)", () => {
    fakeStorage();
    const s = useCameraStore.getState();
    useCameraStore.setState({ arCalibration: { ...AR_CALIB_IDENTITY, yawDeg: 2, savedAtMs: 1 } });
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: 3 });
    s.confirmArCalibration();
    expect(useCameraStore.getState().arCalCommitEpoch).toBe(0);
    expect(useCameraStore.getState().arCalibration.yawDeg).toBe(5);
    expect(useCameraStore.getState().arCalDraft).toBeNull();
  });

  it("RESET forgets the stored calibration (and zeroes the draft, staying in the mode); CANCEL changes nothing stored", () => {
    const m = fakeStorage();
    const s = useCameraStore.getState();
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: 3 });
    s._onArCalibrated(3);
    expect(m.has(AR_CALIB_KEY)).toBe(true);
    s.setArCam("calibrate");
    s.stepArCalDraft({ dYawDeg: 9 });
    s.cancelArCalibration();
    expect(useCameraStore.getState().arCalibration.yawDeg).toBe(3);
    expect(useCameraStore.getState().arCam).toBe("view");
    s.setArCam("calibrate");
    s.resetArCalibration();
    expect(m.has(AR_CALIB_KEY)).toBe(false);
    expect(useCameraStore.getState().arCalibration).toEqual(AR_CALIB_IDENTITY);
    expect(useCameraStore.getState().arCalDraft).toEqual(AR_CALIB_IDENTITY);
    expect(useCameraStore.getState().arCam).toBe("calibrate");
  });
});

describe("the chips — CAM above AR, only while AR is on; hold AR to calibrate", () => {
  it("AR off: no CAM chip. AR on: CAM sits ABOVE AR in the same wrap, off until tapped", () => {
    expect(render(ArLookToggle)).not.toContain("m-cambtn");
    useCameraStore.getState().setArLook(true);
    useCameraStore.getState()._syncArLook(LIVE);
    const html = render(ArLookToggle);
    expect(html).toMatch(/m-cambtn" aria-pressed="false"/);
    expect(html.indexOf("m-cambtn")).toBeLessThan(html.indexOf('class="m-arbtn'));
    useCameraStore.getState().setArCam("view");
    expect(render(ArLookToggle)).toMatch(/m-cambtn m-cambtn--on" aria-pressed="true"/);
  });

  it("a stored calibration marks the AR chip by ATTRIBUTE — its pinned markup (two letters, no child) is untouched", () => {
    expect(render(ArLookToggle)).not.toContain("data-cal");
    useCameraStore.setState({ arCalibration: { ...AR_CALIB_IDENTITY, yawDeg: 2, savedAtMs: 9 } });
    const html = render(ArLookToggle);
    expect(html).toContain('data-cal="1"');
    expect(html).toMatch(/>AR<\/button>/);
  });

  it("the armed hint teaches the hold; the long press judges by the events' own clocks", () => {
    expect(AR_COPY.holdHint).toMatch(/HOLD AR/);
    expect(heldLongEnough(1000, 1000 + ORCH_TUNING.longPressMs)).toBe(true);
    expect(heldLongEnough(1000, 1000 + ORCH_TUNING.longPressMs - 1)).toBe(false);
    expect(heldLongEnough(null, 9e9)).toBe(false); // moved / never armed
  });

  it("the long press adds NO permission call and no timer inside the tap's slice (iOS: the gesture's own stack)", () => {
    const src = read("src/components/mobile/FpvControls.tsx");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code.match(/requestPermission\(\)/g)?.length).toBe(1);
    const tap = src.slice(src.indexOf("const onTap = () => {"), src.indexOf("const relative ="));
    expect(tap).not.toMatch(/setTimeout|await|useLongPress/);
    // the timer's call is declined while AR is off — only the RELEASE (a user activation) may ask
    expect(src).toMatch(/if \(source === "timer"\) return false;/);
    // the release verdict for a finger is touchend's — the event WebKit has always counted
    const hook = read("src/components/controls/useLongPress.ts");
    expect(hook).toMatch(/onTouchEnd: \(e\) => release\(e\.timeStamp\)/);
    expect(hook).toMatch(/if \(e\.pointerType !== "touch"\) release\(e\.timeStamp\);/);
  });
});

describe("the overlay — renders only while AR + CAM are on; calibration adds the pad and the three round cells", () => {
  it("off → nothing; view → the feed + the vertical mix slider, no pad; calibrate → pad, cross, CONFIRM / RESET / CANCEL", () => {
    expect(render(ArCameraOverlay)).toBe("");
    useCameraStore.getState().setArCam("view");
    expect(render(ArCameraOverlay)).toBe(""); // CAM without AR is a picture that does not follow the phone
    useCameraStore.getState().setArLook(true);
    let html = render(ArCameraOverlay);
    expect(html).toMatch(/<video[^>]*class="m-arcam__video"/);
    expect(html).toMatch(/playsInline=""|playsinline=""/);
    expect(html).toMatch(/muted=""/);
    expect(html).toContain('type="range"');
    expect(html).toMatch(/class="m-arcal__mixv"/); // the slider stands on the right rail in BOTH modes
    expect(html).toMatch(/aria-orientation="vertical"/);
    expect(html).toContain("NOT CALIBRATED — HOLD AR");
    expect(html).not.toContain("m-arcal__pad");
    expect(html).not.toContain("m-arcal__actions");
    useCameraStore.getState().setArCam("calibrate");
    html = render(ArCameraOverlay);
    expect(html).toContain("m-arcal__pad");
    expect(html).toContain("m-arcal__cross");
    // the verdict column: three ROUND cells (the .m-act--icon idiom), CONFIRM LAST = the bottom cell,
    // nearest the AIM stick (owner 2026-09-25 item 2), each a data-act
    const acts = [...html.matchAll(/data-act="(ar-cal-[a-z]+)"/g)].map((m) => m[1]);
    expect(acts).toEqual(["ar-cal-cancel", "ar-cal-reset", "ar-cal-confirm"]);
    expect(html.match(/m-act m-act--icon/g)?.length).toBe(3);
    expect(html).toContain(AR_CAL_COPY.title);
    // ONE row: the readout beside the title — yaw · pitch · the lens; no ROLL, no memo text
    expect(html).toMatch(/YAW \+0\.0° · PITCH \+0\.0° · \d+ mm/);
    expect(html).not.toMatch(/ROLL|LANDMARK|TWIST/);
    expect("how" in AR_CAL_COPY).toBe(false);
  });

  it("the layout (owner 2026-09-22 item 1): the row's right edge relaxes to the folded mini-map while calibrating; the column and the slider are fixed seats off the rail's tokens", () => {
    const css = read("src/styles/mobile/ar-camera.css");
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
    expect(block(".m-arcal")).toMatch(/flex-direction: row;/);
    expect(block(".m-arcal--on")).toMatch(/right: calc\(3\.9rem \+ env\(safe-area-inset-right\)\);/);
    // the verdict column: left rail, its bottom 12 px above the AIM stick's top (10rem + 120px + 110px — the stick's 1 px border counts; 10rem since the 2026-09-25 tab row)
    expect(block(".m-arcal__actions")).toMatch(/position: fixed;/);
    expect(block(".m-arcal__actions")).toMatch(/left: calc\(1rem \+ env\(safe-area-inset-left\)\);/);
    expect(block(".m-arcal__actions")).toMatch(/bottom: calc\(10rem \+ 120px \+ 110px \+ 12px \+ env\(safe-area-inset-bottom\)\);/);
    expect(block(".m-arcal__actions")).toMatch(/flex-direction: column;/);
    expect(read("src/styles/mobile/fpv.css")).toMatch(/\.m-joy--aim-fpv \{\s*bottom: calc\(10rem \+ 120px \+ env\(safe-area-inset-bottom\)\);/);
    // the slider: right rail, just above the column (its bottom = the column's published top + 8 px)
    expect(block(".m-arcal__mixv")).toMatch(/bottom: calc\(var\(--m-altcol-bottom\) \+ var\(--m-altcol-h, 148px\) \+ 8px \+ env\(safe-area-inset-bottom\)\);/);
    expect(block(".m-arcal__mixin")).toMatch(/rotate\(-90deg\)/);
    // the rung-note float clears the slider
    expect(css).toMatch(/body\.m:has\(\.m-arcal__mixv\) \.m-arfloat \{\s*bottom: calc\(100% \+ 8px \+ var\(--m-armix-h, 96px\) \+ 6px\);/);
    // 2026-09-25: the slider reads the mini-map as RENDERED — folded to its puck (always while calibrating) the card's 134 px becomes 46
    expect(css).toMatch(/body\.m:has\(\.m-arcal__mixv\):has\(\.mm--collapsed\) \{\s*--m-armix-h: max\(\s*52px,\s*min\(\s*128px,\s*calc\(\s*100dvh - 2\.9rem - 46px - 8px/);
    // …and ⌖ ALIGN stacks above the column while it is up (three cells + three gaps)
    expect(css).toMatch(/body\.m:has\(\.m-arcal__actions\) \.m-aralign \{\s*bottom: calc\(10rem \+ 120px \+ 110px \+ 12px \+ 156px \+ env\(safe-area-inset-bottom\)\);/);
    // the fullscreen map hides every piece of the overlay
    expect(css).toMatch(/body\.mw-open \.m-arcal__mixv,\s*body\.mw-open \.m-arcal__actions,/);
  });

  it("the mini-map folds to its puck while calibrating (item 1e) and comes back as the user left it", () => {
    const mm = read("src/components/panels/MiniMap.tsx");
    expect(mm).toMatch(/const calibrating = useCameraStore\(\(s\) => s\.arCam === "calibrate"\);/);
    expect(mm).toMatch(/const collapsed = userCollapsed \|\| calibrating;/);
    expect(mm).toMatch(/onClick=\{\(\) => setCollapsed\(!userCollapsed\)\}/);
  });

  it("FpvControls mounts it (FPV-only: exiting the view stops the camera)", () => {
    useCameraStore.getState().setArLook(true);
    useCameraStore.getState().setArCam("view");
    expect(render(FpvControls)).toContain("m-arcam__video");
  });

  it("the stack: feed z 1 (over the canvas, under the scene's z 2 labels) · pad z 5 · FPV chrome z 10 · panel z 11", () => {
    const css = read("src/styles/mobile/ar-camera.css");
    const z = (sel: string) => Number(/z-index:\s*(\d+)/.exec(css.slice(css.indexOf(`${sel} {`)))![1]);
    expect(z(".m-arcam")).toBe(1);
    expect(z(".m-arcal__pad")).toBe(5);
    expect(z(".m-arcal")).toBe(11);
    expect(css.slice(css.indexOf(".m-arcam {"), css.indexOf(".m-arcam__video"))).toMatch(/pointer-events: none;/);
    // four cells while CAM exists — the A1-2 contract the map window's ◉ RE-CENTRE reads
    expect(css).toMatch(/body\.m:has\(\.m-altcol \.m-cambtn\) \{\s*--m-altcol-h: 200px;/);
    expect(read("src/styles/mobile/fpv.css")).toMatch(/--m-altcol-h: 148px;/);
  });
});

describe("the engine contract — calibration goes IN on update(ctx), the bias comes OUT through a pushed writer", () => {
  const ORCH = read("src/components/globe/StylizedTiles.ts");
  const AR = read("src/components/globe/scene/arLook.ts");

  it("the orchestrator pushes the stored bias, the pitch, the live drag and the commit epoch; never a store import in the scene module", () => {
    expect(ORCH).toMatch(/calBiasYawDeg: camNow\.arCalibration\.yawDeg,/);
    expect(ORCH).toMatch(/calDraftYawDeg: camNow\.arCalDraft \? camNow\.arCalDraft\.yawDeg : 0,/);
    expect(ORCH).toMatch(/calCommitEpoch: camNow\.arCalCommitEpoch,/);
    expect(ORCH).toMatch(/calibrated: \(biasYawDeg\) => useCameraStore\.getState\(\)\._onArCalibrated\(biasYawDeg\)/);
    expect(AR).not.toMatch(/^import \{[^}]*\} from "[^"]*store\//m); // type-only store imports are the fence's allowance
  });

  it("the seed and ⌖ ALIGN subtract the drag from the camera heading (it already carries it)", () => {
    expect(AR).toMatch(/ladder\.align\(wrapDeg360\(lastCameraHeading - calDraftYaw\), false\)/);
    expect(AR).toMatch(/ladder\.align\(wrapDeg360\(ctx\.cameraHeadingDeg - calDraftYaw\), true\)/);
  });

  it("the stored yaw is a compass BIAS inside the ladder; CONFIRM zeroes this frame's drag before the aim is read", () => {
    expect(AR).toMatch(/ladder\.setUserBias\(ctx\.calBiasYawDeg\);/);
    const commit = AR.slice(AR.indexOf("if (ctx.calCommitEpoch !== seenCommitEpoch)"), AR.indexOf("const raw = ladder.aim();"));
    expect(commit).toMatch(/ladder\.commitCalibration\(calDraftYaw, performance\.now\(\)\)/);
    expect(commit).toMatch(/calDraftYaw = 0;\s*opts\.calibrated\(bias\);/);
  });

  it("the per-frame channel carries the roll and the live FOV; the tunables are sane", () => {
    expect(ORCH).toMatch(/writeArFrame\(\s*\{ live: on && arLook\.live\(\), rollDeg: arLook\.roll\(\), vFovDeg: camera\.fov,/);
    expect(FPV.arCompassOffsetTauMs).toBeGreaterThanOrEqual(4000); // gyro-led: the compass only trims
    expect(FPV.arTrimMaxRateDegPerS).toBeLessThanOrEqual(2);
    expect(FPV.arTrimFreezeRateDegPerS).toBeGreaterThan(FPV.arTrimMaxRateDegPerS);
    expect(FPV.arCamOpacityMin).toBeLessThan(FPV.arCamOpacity);
    expect(FPV.arCamOpacity).toBeLessThan(FPV.arCamOpacityMax);
    expect(FPV.arCamIdealWidthPx * FPV.arCamIdealHeightPx).toBeLessThanOrEqual(1280 * 720); // memory beside WebGL on iOS
  });
});
