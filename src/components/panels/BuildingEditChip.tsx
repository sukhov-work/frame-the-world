import { useBldgEditStore } from "../../store/bldgEdit";
import "../../styles/building-edit.css";

/**
 * U8 building height edit chip (owner 2026-08-18) — the Δ height + RESET readout while a
 * building is armed in FPV. Top-level island in BOTH shells (index.astro + m.astro — the
 * SkyContextMenu precedent; never imports from components/mobile/**). Reads the orchestrator's
 * deadband `armed` mirror (store/bldgEdit); writes exactly one thing back: the RESET one-shot.
 * The per-frame numbers pinned to the building itself are the orchestrator-owned DOM label
 * (scene/bldgEditLabel.ts) — this chip is the stable HUD anchor + the interactive surface.
 */
export default function BuildingEditChip() {
  const armed = useBldgEditStore((s) => s.armed);
  const requestReset = useBldgEditStore((s) => s.requestReset);
  if (!armed) return null;
  const sign = armed.deltaM >= 0 ? "+" : "";
  return (
    <div className={`bldg-edit-chip${armed.dragging ? " is-dragging" : ""}`} role="status">
      <span className="bec-title">HEIGHT</span>
      <span className="bec-delta">
        {sign}
        {armed.deltaM.toFixed(1)} m
      </span>
      <span className="bec-range">
        {armed.originalHeightM.toFixed(1)} → {armed.liveHeightM.toFixed(1)} m
      </span>
      {armed.overridden && !armed.dragging && (
        <button type="button" className="bec-reset" onClick={requestReset}>
          RESET
        </button>
      )}
      <span className="bec-hint bec-hint--desktop">drag ↑↓ · dbl-click re-target · Esc done</span>
      <span className="bec-hint bec-hint--m">drag ↑↓ · double-tap re-target · tap away done</span>
    </div>
  );
}
