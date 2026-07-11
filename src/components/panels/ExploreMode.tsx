import { useEffect } from "react";
import { useCameraStore } from "../../store/camera";
import { useUploadStore } from "../../store/upload";
import "../../styles/explore-mode.css";

/**
 * ExploreMode — arms the ambient pin journey (Phase 5.5 S4, §Item 11) from any element carrying
 * `data-explore` (the nav link — same binding idiom as UploadFlow's data-open-upload) and shows
 * the one-line status chip while it runs. The globe orchestrator's cruise (globe/explore.ts)
 * owns the camera; ANY canvas interaction / Escape / the chip's ✕ exits.
 *
 * Entry is polite: it never yanks the camera out of an active upload session — only a resting
 * globe (idle, or viewing a saved pin, which it deselects) starts the journey. Entering also
 * unwinds FPV/temp-pin state so the cruise starts from a clean orbit pose.
 */
export default function ExploreMode() {
  const active = useCameraStore((s) => s.exploreActive);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const trigger = (e.target as Element | null)?.closest?.("[data-explore]");
      if (!trigger) return;
      e.preventDefault();
      const cam = useCameraStore.getState();
      if (cam.exploreActive) {
        cam.setExplore(false);
        return;
      }
      const up = useUploadStore.getState();
      const viewingSaved = up.phase === "placed" && up.viewingPinId !== null;
      if (up.phase !== "idle" && !viewingSaved) return; // mid-upload — don't steal the camera
      if (viewingSaved) up.clear();
      if (up.viewMode === "fpv") up.setViewMode("orbit");
      cam.setTempFpv(false);
      cam.setTempPin(null);
      cam.clearAllTargets();
      cam.setExplore(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Mirror the mode onto the static nav link (Astro chrome) for the accent treatment.
  useEffect(() => {
    const link = document.querySelector("[data-explore]");
    link?.classList.toggle("is-exploring", active);
    return () => link?.classList.remove("is-exploring");
  }, [active]);

  if (!active) return null;
  return (
    <button
      type="button"
      className="explore-chip"
      onClick={() => useCameraStore.getState().setExplore(false)}
      title="Exit the ambient journey"
    >
      ◉ EXPLORING · PIN TO PIN
      <span className="explore-chip__hint"> — touch the globe or ESC to exit</span>
    </button>
  );
}
