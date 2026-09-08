/**
 * REAL-GLASS single-finger input for the Pixel over adb (2026-09-08c) — the phone tier of the CDP
 * `Input.dispatchTouchEvent` recipe the harnesses use on the house Chrome.
 *
 * WHY. On the owner's Pixel 6 Pro (Android 16, Chrome 152) CDP touch injection is a MIRAGE: with
 * Chrome not the focused window `Input.dispatchTouchEvent` never answers (90 s), and with it
 * focused the command returns but the page sees only the synthesized `mousedown` + `click` — no
 * `pointerdown`, no `touchstart` (measured 2026-09-08c: a listener saw `[mousedown 200,393]`,
 * `[click]` from CDP, and `[pointerdown 200,400 touch]`, `[touchstart]`, … from `adb shell input
 * tap`). `Input.synthesizeTapGesture` / `synthesizePinchGesture` hang; `sendevent` on
 * `/dev/input/event3` is refused (SELinux, the shell user). So the ONLY real touch a harness can
 * put on the glass is `adb shell input` — `tap`, `swipe` (a long press = a swipe of zero length
 * with a duration), `motionevent DOWN / MOVE / UP` — and it is SINGLE-POINTER by construction.
 * Two-finger gestures (T120's twist, the pinch, T129's two-finger pan) have NO injection path on
 * the phone; their device tier is the owner's thumb. Single-finger legs (T127's stray tap and
 * drag, the tab long press, the chips, the encoder) run here at DPR 3.5 for real.
 *
 * COORDINATES. CSS px of the page → device px: `x · dpr`, `(y + toolbarCss) · dpr`, where the
 * toolbar offset (the status bar + Chrome's URL bar, 340 device px = 97.1 CSS px on the Pixel) is
 * CALIBRATED by one real tap read back through a `pointerdown` listener — never assumed.
 *
 * Usage (a harness with a CDP `session` on the phone tab):
 *   const glass = await createAdbInput(session);      // one calibration tap at the page's centre
 *   await glass.tap(x, y); await glass.longPress(x, y, 700); await glass.drag([[x0, y0], …]);
 */
import { execFileSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", ["shell", ...args], { encoding: "utf8", timeout: 30_000 });

export async function createAdbInput(session, { calibrate = true } = {}) {
  let dpr = 3.5;
  let offY = 97.1; // CSS px — the Pixel 6 Pro's status bar + Chrome toolbar; overwritten below
  let offX = 0;
  const toDev = (x, y) => [Math.round((x + offX) * dpr), Math.round((y + offY) * dpr)];

  const tap = async (x, y) => {
    const [dx, dy] = toDev(x, y);
    adb("input", "tap", String(dx), String(dy));
    await sleep(150);
  };
  /** `input swipe` with zero travel and a duration = a real long press. */
  const longPress = async (x, y, holdMs = 700) => {
    const [dx, dy] = toDev(x, y);
    adb("input", "swipe", String(dx), String(dy), String(dx), String(dy), String(holdMs));
    await sleep(250);
  };
  /** A straight swipe (one `input swipe`, `durationMs` long). */
  const swipe = async (x0, y0, x1, y1, durationMs = 200) => {
    const [ax, ay] = toDev(x0, y0);
    const [bx, by] = toDev(x1, y1);
    adb("input", "swipe", String(ax), String(ay), String(bx), String(by), String(durationMs));
    await sleep(250);
  };
  /** A polyline drag through CSS points via `input motionevent` (DOWN, MOVEs, UP) — one adb call
   *  per event (~10-20 ms each), so a 10-point drag is a slow human drag. */
  const drag = async (pts, { holdBeforeMs = 40 } = {}) => {
    const [x0, y0] = toDev(pts[0][0], pts[0][1]);
    adb("input", "motionevent", "DOWN", String(x0), String(y0));
    await sleep(holdBeforeMs);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = toDev(pts[i][0], pts[i][1]);
      adb("input", "motionevent", "MOVE", String(x), String(y));
    }
    const [xe, ye] = toDev(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    adb("input", "motionevent", "UP", String(xe), String(ye));
    await sleep(250);
  };
  /** A quick double tap (two `input tap`s inside the double-tap window). */
  const doubleTap = async (x, y, gapMs = 90) => {
    const [dx, dy] = toDev(x, y);
    adb("input", "tap", String(dx), String(dy));
    await sleep(gapMs);
    adb("input", "tap", String(dx), String(dy));
    await sleep(300);
  };

  let calibration = null;
  if (calibrate) {
    dpr = Number(await session.evalJs("devicePixelRatio")) || dpr;
    const vw = Number(await session.evalJs("innerWidth")) || 411;
    const vh = Number(await session.evalJs("innerHeight")) || 770;
    await session.evalJs(
      `(() => { window.__adbCal = null; window.addEventListener("pointerdown", (e) => { window.__adbCal = { x: e.clientX, y: e.clientY, type: e.pointerType }; }, { capture: true, once: true }); return true; })()`,
    );
    // one real tap at the page's centre, using the default offset; the residual corrects it
    const cx = vw / 2;
    const cy = vh / 2;
    const [dx, dy] = toDev(cx, cy);
    adb("input", "tap", String(dx), String(dy));
    await sleep(500);
    const cal = JSON.parse(await session.evalJs("JSON.stringify(window.__adbCal)"));
    if (!cal) throw new Error("adb input calibration: the page saw no pointerdown from `input tap` (is Chrome the focused window, the screen on and unlocked?)");
    offX += cx - cal.x;
    offY += cy - cal.y;
    calibration = { dpr, offX, offY, landed: cal, aimed: [cx, cy] };
  }
  return { tap, longPress, swipe, drag, doubleTap, toDev, calibration };
}
