/**
 * Shared input instruments (batch #4 S2) — the ONE tier both shells may import (the mobile
 * fence, MOBILE_PLAN §2 rule 3): a leaf that consumes stores + lib/** + globe tunables ONLY,
 * so desktop and mobile stay byte-independent of EACH OTHER while sharing a stick whose feel
 * (expo γ, rate ceilings, knob travel) must never fork between shells. Enforced by
 * test/components/mobileFence.test.ts.
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { CONTROLS, FOCALCONE, FPV } from "../globe/tuning";
import { focalMmFromHFov, horizontalFovDeg, stickRate } from "../../lib/geo/plannedView";
import { formatFocal } from "../../lib/format/readout";
import "../../styles/mobile/fpv.css";

/** Knob travel radius as a fraction of the pad radius (the rim ring stays visible). */
const KNOB_TRAVEL = 0.72;

/** Analog thumb stick (parameterized batch #4 S2): raw unit-disc deflection out (screen
 *  convention — x right, y DOWN), null on release. Response curves are the CONSUMER's —
 *  this component only reports geometry. */
export function Joystick({
  onVector,
  label,
  ariaLabel,
  className,
  footer,
}: {
  onVector: (v: { x: number; y: number } | null) => void;
  label: string;
  ariaLabel: string;
  className?: string;
  /** Small readout on the pad's lower body (batch #6 item 3: the aim stick's focal mm). */
  footer?: string;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const emit = useRef(onVector);
  emit.current = onVector;

  // Release everything if the shell unmounts mid-hold (FPV exited under the thumb; the
  // orchestrator's exit branch is the second backstop).
  useEffect(() => () => emit.current(null), []);

  const apply = (e: React.PointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const r = rect.width / 2;
    let x = (e.clientX - (rect.left + r)) / r;
    let y = (e.clientY - (rect.top + r)) / r;
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    emit.current({ x, y });
    setKnob({ x: x * r * KNOB_TRAVEL, y: y * r * KNOB_TRAVEL });
  };
  const release = () => {
    dragId.current = null;
    emit.current(null);
    setKnob(null);
  };

  return (
    <div
      ref={padRef}
      className={`m-joy${className ? ` ${className}` : ""}`}
      role="application"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        dragId.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers (test dispatch) can't be captured — tracking still works */
        }
        apply(e);
      }}
      onPointerMove={(e) => {
        if (dragId.current === e.pointerId) apply(e);
      }}
      onPointerUp={(e) => {
        if (dragId.current === e.pointerId) release();
      }}
      onPointerCancel={(e) => {
        if (dragId.current === e.pointerId) release();
      }}
    >
      <span className="m-joy__label">{label}</span>
      <span
        className={`m-joy__knob${knob ? " m-joy__knob--live" : ""}`}
        style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
        aria-hidden="true"
      />
      {footer && (
        <span className="m-joy__footer" aria-hidden="true">
          {footer}
        </span>
      )}
    </div>
  );
}

/** AIM joystick (owner batch #4 item 11): left-right steers heading, up-down the focal
 *  (up = zoom in), desktop-encoder feel (expo γ 2.2, 45°/s + log-space 0.9/s ceilings).
 *  In FPV it writes the REAL camera's rate seams; outside it steers the PLANNED view
 *  (seeding it from the current view on first touch). Mounts (batch #6 item 4): desktop
 *  minimap card corner ("minimap") and the /m shell ("map" on the 2D/3D surface, "fpv"
 *  seated just above the walk stick). The pad's lower body carries the LIVE focal readout
 *  in mm — fpvHud when standing in the shot, else the planned view (item 3). */
export function AimJoystick({ variant }: { variant: "map" | "minimap" | "fpv" }) {
  const hFovNow = useCameraStore((s) =>
    s.fpvHud ? horizontalFovDeg(s.fpvHud.fovDeg, s.fpvHud.aspect) : (s.plannedView?.hFovDeg ?? null),
  );
  const onVector = (v: { x: number; y: number } | null) => {
    const cam = useCameraStore.getState();
    if (v === null) {
      cam.setPlannedRates(null);
      if (cam.fpvHud) {
        cam.setHeadingRate(null);
        cam.setFovRate(null);
      }
      return;
    }
    const hRate = stickRate(v.x, FOCALCONE.headingRateMaxDegPerS, CONTROLS.rateExpoGamma);
    const fRate = stickRate(-v.y, FOCALCONE.hFovRateMaxPerS, CONTROLS.rateExpoGamma);
    if (cam.fpvHud) {
      // Live camera — the existing FPV encoder seams (stepEncoderRates/stepFocalEncoder).
      cam.setPlannedRates(null);
      cam.setHeadingRate(hRate);
      cam.setFovRate(fRate);
    } else {
      if (!cam.plannedView) {
        // First touch with no plan yet: seed from the current view heading + the temp-FPV
        // default focal at the live viewport aspect (the jump-seed idiom).
        // ENGINE-ABSENT GUARD, kept deliberately (audit #3 A2-4/A1-12, dated 2026-08-22): since
        // the batch-#6 boot seed, `plannedView` is non-null by the first non-FPV orchestrator
        // frame and nothing ever writes null back, so this branch is unreachable in the shipped
        // configuration. It stays because a build without PUBLIC_CESIUM_ION_TOKEN never attaches
        // the orchestrator (the sticks still mount) and a `#f=` FPV boot defers the seed to the
        // first exit. The aspect comes from the window rather than `camera.aspect` because this
        // leaf has no camera — and GlobeCanvas.onResize sets `camera.aspect` to exactly this
        // ratio, so the two agree by construction.
        cam.setPlannedView({
          headingDeg: cam.headingDeg,
          hFovDeg: horizontalFovDeg(
            FPV.tempFovDeg,
            typeof window !== "undefined"
              ? window.innerWidth / Math.max(1, window.innerHeight)
              : 16 / 9,
          ),
        });
      }
      cam.setHeadingRate(null);
      cam.setFovRate(null);
      cam.setPlannedRates({ headingDegPerS: hRate, hFovPerS: fRate });
    }
  };
  return (
    <Joystick
      label="AIM"
      ariaLabel="Aim joystick — drag sideways to turn the shot heading, up and down to zoom the focal"
      className={`m-joy--aim m-joy--aim-${variant}`}
      onVector={onVector}
      footer={hFovNow !== null ? formatFocal(focalMmFromHFov(hFovNow)) : undefined}
    />
  );
}
