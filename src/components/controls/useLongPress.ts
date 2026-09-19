/**
 * useLongPress (2026-09-19; backlog T145's hook) — ONE long-press for touch chips, in the shape
 * `mobile/TargetPeek.tsx` hardened on real phones: a timer fires it WHILE the finger is still down
 * (the feedback users expect), and the RELEASE re-judges it by the events' own timestamps — a
 * main thread too busy to run the timer (a streaming globe) must not turn a 700 ms hold into a tap.
 *
 * `onLongPress(source)` answers whether it HANDLED the press. That is what lets one chip do two
 * things with one gesture: an action that needs a USER ACTIVATION (iOS gates
 * `DeviceOrientationEvent.requestPermission()` on the gesture's own stack — a timer callback is
 * not one) declines the `"timer"` call by returning false and takes the `"release"` call instead.
 * The release verdict for a finger is taken on `touchend` — the event WebKit has always counted as
 * a user gesture — and on `pointerup` for every other pointer.
 *
 * After a handled press the trailing click is swallowed (Android fires it on lift, iOS may not;
 * the swallow expires on its own so the NEXT tap can never vanish — the TabBar's 900 ms twin).
 * A `controls/**` leaf: react + `globe/tuning` only (`mobileFence` rule 3).
 */

import { useEffect, useRef } from "react";
import { ORCH } from "../globe/tuning";

export type LongPressSource = "timer" | "release";

/** The release verdict, pure: held at least `ms` by the events' own clocks. */
export function heldLongEnough(downAtMs: number | null, upAtMs: number, ms: number = ORCH.longPressMs): boolean {
  return downAtMs !== null && Number.isFinite(upAtMs) && upAtMs - downAtMs >= ms;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
  onContextMenu: (e: React.SyntheticEvent) => void;
  /** Wrap the chip's own click: a click that trails a handled long press is swallowed. */
  onClick: (tap: () => void) => () => void;
}

export function useLongPress(onLongPress: (source: LongPressSource) => boolean): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const handled = useRef(false);
  const downAt = useRef<number | null>(null);
  const downPos = useRef({ x: 0, y: 0 });
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelTimer, []);

  const fire = (source: LongPressSource) => {
    if (handled.current) return; // the timer and the release both saw it — once is enough
    if (!cb.current(source)) return; // declined (e.g. needs a user activation) — the release may still take it
    handled.current = true;
    try {
      navigator.vibrate?.(12); // a tiny haptic tick where the platform has one; never load-bearing
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      handled.current = false;
    }, 900);
  };
  const release = (upAtMs: number) => {
    cancelTimer();
    if (heldLongEnough(downAt.current, upAtMs)) fire("release");
    downAt.current = null;
  };

  return {
    onPointerDown: (e) => {
      handled.current = false; // any new press forgets a swallowed click
      downAt.current = e.timeStamp;
      downPos.current = { x: e.clientX, y: e.clientY };
      cancelTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (downAt.current !== null) fire("timer");
      }, ORCH.longPressMs);
    },
    onPointerMove: (e) => {
      if (downAt.current === null) return;
      if (Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) > ORCH.clickDragPx) {
        cancelTimer();
        downAt.current = null;
      }
    },
    // A finger's verdict is `touchend`'s (the WebKit user gesture); every other pointer's is here.
    onPointerUp: (e) => {
      if (e.pointerType !== "touch") release(e.timeStamp);
      else cancelTimer();
    },
    onPointerCancel: () => {
      cancelTimer();
      downAt.current = null;
    },
    onTouchEnd: (e) => release(e.timeStamp),
    onContextMenu: (e) => e.preventDefault(), // the long press is OURS, not the browser's callout
    onClick: (tap) => () => {
      if (handled.current) {
        handled.current = false;
        return;
      }
      tap();
    },
  };
}
