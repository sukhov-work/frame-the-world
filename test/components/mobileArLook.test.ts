import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FpvControls, {
  AR_COPY,
  AR_NOTE_MS,
  ArLookToggle,
  arAnnouncement,
  arNoteKey,
  arRungLine,
} from "../../src/components/mobile/FpvControls";
import { useCameraStore, type ArLookState } from "../../src/store/camera";
import { FPV } from "../../src/components/globe/tuning";

/**
 * AR LOOK-AROUND (owner order 2026-09-07g) — the mobile toggle, its copy and the store seam.
 * Rendering is `renderToStaticMarkup` with the live store mirrored onto zustand's server snapshot
 * (the `bestSpotPanel.test.ts` idiom; this repo's vitest has no DOM).
 *
 * Mutations that make these RED: the permission call moved out of the tap handler or behind an
 * `await`; the denied copy sending the user to a Settings switch iOS removed in 13; the toggle
 * persisted into the view prefs; `arLook` writable at 60 fps through a React path; the drag or
 * the aim stick's heading left live while AR aims.
 */

const BOOT = { ...useCameraStore.getState() };
const render = (el: Parameters<typeof createElement>[0]) => {
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  return renderToStaticMarkup(createElement(el as never));
};
const SRC = readFileSync(join(process.cwd(), "src/components/mobile/FpvControls.tsx"), "utf8");
const ORCH = readFileSync(join(process.cwd(), "src/components/globe/StylizedTiles.ts"), "utf8");

beforeEach(() => {
  useCameraStore.setState(BOOT, true);
});

describe("store seam — request band + engine mirror, per-session", () => {
  it("boots OFF, toggles, and the ALIGN request is a monotone epoch", () => {
    const s = useCameraStore.getState();
    expect(s.arLook).toBe(false);
    expect(s.arAlignEpoch).toBe(0);
    expect(s.arLookState).toBeNull();
    s.setArLook(true);
    expect(useCameraStore.getState().arLook).toBe(true);
    s.requestArAlign();
    s.requestArAlign();
    expect(useCameraStore.getState().arAlignEpoch).toBe(2);
    const st: ArLookState = { rung: "ios-compass", compassAccuracyDeg: 4, compassAgeMs: 0, samples: 10, stale: false, headingDeg: 90, pitchDeg: 0, declinationDeg: 8.6 };
    s._syncArLook(st);
    expect(useCameraStore.getState().arLookState).toEqual(st);
  });

  it("is NOT persisted — a persisted 'on' could never re-ask iOS for the gesture-gated permission", () => {
    const prefs = readFileSync(join(process.cwd(), "src/lib/prefs.ts"), "utf8");
    expect(prefs).not.toMatch(/arLook/);
    const store = readFileSync(join(process.cwd(), "src/store/camera.ts"), "utf8");
    // the setter is a plain set — no saveViewPref beside it
    expect(store).toMatch(/setArLook: \(on\) => set\(\{ arLook: on \}\)/);
  });
});

describe("the toggle — permission from the tap, copy that matches the platforms", () => {
  it("renders OFF with the compass glyph and no note; ON with the rung line", () => {
    const off = render(ArLookToggle);
    expect(off).toMatch(/m-arbtn" aria-pressed="false"/);
    expect(off).toMatch(/aria-pressed="false"[^>]*>AR<\/button>/); // the two letters, no emoji (owner 2026-09-08b)
    expect(off).not.toContain("m-arnote");
    useCameraStore.getState().setArLook(true);
    useCameraStore.getState()._syncArLook({ rung: "android-absolute", compassAccuracyDeg: null, compassAgeMs: Infinity, samples: 3, stale: false, headingDeg: 45, pitchDeg: 2, declinationDeg: 8.58 });
    const on = render(ArLookToggle);
    expect(on).toMatch(/m-arbtn m-arbtn--on" aria-pressed="true"/);
    expect(on).toContain("COMPASS · TRUE NORTH (+8.6° DECLINATION)");
    expect(on).not.toContain("ALIGN");
  });

  it("offers ALIGN only on the relative rungs, and says why when the sensors go quiet", () => {
    useCameraStore.getState().setArLook(true);
    const base: ArLookState = { rung: "relative-unaligned", compassAccuracyDeg: null, compassAgeMs: Infinity, samples: 3, stale: false, headingDeg: 0, pitchDeg: 0, declinationDeg: 0 };
    useCameraStore.getState()._syncArLook(base);
    let html = render(ArLookToggle);
    expect(html).toContain("⌖ ALIGN");
    expect(html).toContain("GYRO ONLY — FACE WHERE THE VIEW LOOKS AND TAP ALIGN");
    useCameraStore.getState()._syncArLook({ ...base, rung: "relative-aligned" });
    html = render(ArLookToggle);
    expect(html).toContain("⌖ ALIGN");
    expect(html).toContain("GYRO · ALIGNED");
    useCameraStore.getState()._syncArLook({ ...base, rung: "ios-compass", stale: true });
    html = render(ArLookToggle);
    expect(html).not.toContain("⌖ ALIGN");
    expect(html).toContain(AR_COPY.stale);
    expect(arRungLine({ ...base, rung: "ios-compass", compassAgeMs: 90_000 })).toContain("TILT THE PHONE DOWN");
  });

  it("FpvControls seats the toggle as the FIRST cell of the right-rail altitude column (owner 2026-09-08b)", () => {
    const html = render(FpvControls);
    expect(html).toContain("WALK");
    const col = html.slice(html.indexOf('class="m-altcol"'));
    expect(col).toContain("m-arbtn");
    // AR above ⤒ above ⤓ — one column of three 44 px cells
    expect(col.indexOf("m-arbtn")).toBeLessThan(col.indexOf("⤒"));
    expect(col.indexOf("⤒")).toBeLessThan(col.indexOf("⤓"));
    // the chip is the altitude nudges' size, and the column publishes three cells to the map window
    const css = readFileSync(join(process.cwd(), "src/styles/mobile/fpv.css"), "utf8");
    const arbtn = css.slice(css.indexOf(".m-arbtn {"), css.indexOf(".m-arbtn__glyph"));
    expect(arbtn).toMatch(/width: 44px;/);
    expect(arbtn).toMatch(/height: 44px;/);
    expect(css).toMatch(/--m-altcol-h: 148px;/);
    // the note floats ABOVE the column (absolute) — the A1-2 box never grows while a note is up
    const float = css.slice(css.indexOf(".m-arfloat {"), css.indexOf(".m-arbtn {"));
    expect(float).toMatch(/position: absolute;/);
    expect(float).toMatch(/bottom: calc\(100% \+ 6px\);/);
    expect(css).not.toMatch(/\.m-arwrap \{[^}]*position: fixed/);
  });

  describe("the bubble clears (owner 2026-09-08b) — re-shown only on rung · stale transitions", () => {
    const base: ArLookState = { rung: "android-absolute", compassAccuracyDeg: null, compassAgeMs: Infinity, samples: 3, stale: false, headingDeg: 45, pitchDeg: 2, declinationDeg: 8.58 };

    it("the key moves on the rung and the stale flag — never on heading, pitch or samples", () => {
      const k = arNoteKey(true, base);
      expect(arNoteKey(true, { ...base, headingDeg: 46, pitchDeg: -3, samples: 400, compassAgeMs: 0 })).toBe(k);
      expect(arNoteKey(true, { ...base, stale: true })).not.toBe(k);
      expect(arNoteKey(true, { ...base, rung: "ios-compass" })).not.toBe(k);
      expect(arNoteKey(true, { ...base, rung: "relative-unaligned" })).not.toBe(k);
      expect(arNoteKey(false, base)).toBe("off");
      expect(arNoteKey(true, null)).toBe("on");
    });

    it("a rung line is TRANSIENT; going stale is STICKY (an action the user must take); off clears", () => {
      expect(arAnnouncement(true, base)).toEqual({ text: arRungLine(base), sticky: false, defer: false });
      expect(arAnnouncement(true, { ...base, rung: "relative-unaligned" })).toEqual({
        text: "GYRO ONLY — FACE WHERE THE VIEW LOOKS AND TAP ALIGN",
        sticky: false,
        defer: false,
      });
      // the sensors DYING (samples seen) is said at once; stale BEFORE any sample waits behind the
      // armed hint (the first HUD tick can precede the phone's first sample)
      expect(arAnnouncement(true, { ...base, stale: true })).toEqual({ text: AR_COPY.stale, sticky: true, defer: false });
      expect(arAnnouncement(true, { ...base, stale: true, samples: 0 })).toEqual({ text: AR_COPY.stale, sticky: true, defer: true });
      expect(arAnnouncement(true, null)).toBeNull();
      expect(arAnnouncement(false, base)).toBe("clear");
      expect(AR_NOTE_MS).toBe(3500);
    });

    it("the component wires the contract: the effect keys on arNoteKey, transient notes time out, the tap clears", () => {
      const toggle = SRC.slice(SRC.indexOf("export function ArLookToggle()"));
      expect(toggle).toMatch(/const key = arNoteKey\(on, state\);\s*if \(key === lastKey\.current\) return;/);
      expect(toggle).toMatch(/window\.setTimeout\(\(\) => setNote\(null\), AR_NOTE_MS\)/);
      // the rung line is NEVER derived in render any more — only a note reaches the bubble
      expect(toggle).toMatch(/const line = note \?\? "";/);
      expect(toggle).not.toMatch(/note \?\? \(on \? arRungLine/);
      // switching off clears the bubble
      const tap = toggle.slice(toggle.indexOf("const onTap = () => {"), toggle.indexOf("const relative ="));
      expect(tap).toMatch(/cam\.setArLook\(false\);\s*clearNote\(\);/);
    });
  });

  it("the permission call runs SYNCHRONOUSLY inside the tap — nothing awaited before it", () => {
    const handler = SRC.slice(SRC.indexOf("const onTap = () => {"), SRC.indexOf("const relative ="));
    expect(handler).toMatch(/requestPermission\(\)/);
    expect(handler).not.toMatch(/await/); // WebKit's processingUserGesture is a stack property
    expect(handler).not.toMatch(/setTimeout|requestAnimationFrame|\.then\([^)]*requestPermission/);
    // the ONLY caller is the tap handler — never a mount effect (never ask at page load)
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code.match(/requestPermission\(\)/g)?.length).toBe(1);
    expect(code).not.toMatch(/useEffect\([^)]*requestPermission/);
  });

  it("the denied copy names the real iOS recovery (no Settings switch since iOS 13), and HTTP", () => {
    expect(AR_COPY.denied).toMatch(/QUIT AND REOPENED/);
    expect(AR_COPY.denied).toMatch(/CLEAR HISTORY AND WEBSITE DATA/);
    expect(AR_COPY.denied).toMatch(/HTTP/);
    expect(AR_COPY.denied).not.toMatch(/MOTION & ORIENTATION ACCESS/); // the removed switch
  });
});

describe("the engine contract — the phone IS the look while its aim is live", () => {
  it("stepArLook runs between the TRACKING lock and the pose; the aim outranks the lock", () => {
    const chain = ORCH.slice(ORCH.indexOf("stepSkyTrack(); // 8.5"), ORCH.indexOf("stepFpvPose();", ORCH.indexOf("stepSkyTrack(); // 8.5")));
    expect(chain).toMatch(/stepArLook\(\)/);
    expect(ORCH).toMatch(/const skyLook = arAim \?\? skyTrackAim \?\? camNow\.skyLook;/);
    expect(ORCH).toMatch(/arAim\s*\?\s*FPV\.arLookEaseTauMs/);
  });

  it("the look-drag and the aim stick's heading stand down while the aim is live; the pinch does not", () => {
    expect(ORCH).toMatch(/if \(!arLook\.live\(\)\) \{\s*fpvYaw -= \(e\.clientX - fpvLastX\) \* k;\s*fpvPitch \+= \(e\.clientY - fpvLastY\) \* k;/);
    expect(ORCH).toMatch(/if \(!arLook\.live\(\)\) fpvYaw \+= THREE\.MathUtils\.degToRad\(\(appliedHeadingRate \* dtMs\) \/ 1000\);/);
    // the pinch-FOV path is untouched (it precedes the drag in the same handler and never names AR)
    const pinch = ORCH.slice(ORCH.indexOf("fpvPinchStartFov = fovTargetDeg;"), ORCH.indexOf("if (fpvDragId !== e.pointerId) return;"));
    expect(pinch).not.toMatch(/arLook/);
  });

  it("the sensors detach with the scene, and the tunables exist with sane ranges", () => {
    expect(ORCH).toMatch(/arLook\.dispose\(\)/);
    expect(FPV.arLookEaseTauMs).toBeGreaterThan(0);
    expect(FPV.arLookEaseTauMs).toBeLessThan(FPV.skyLookEaseTauMs); // the phone must not lag like a chip click
    expect(FPV.arSampleStaleMs).toBeGreaterThanOrEqual(500);
    expect(FPV.arCompassMinTopHoriz).toBeGreaterThan(0);
    expect(FPV.arCompassMinTopHoriz).toBeLessThan(1);
    expect(FPV.arDeadbandDeg).toBeLessThan(1);
  });
});
