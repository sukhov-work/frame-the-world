import { useEffect, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { usePinsStore } from "../../store/pins";
import { parsePoseHash } from "../../lib/geo/urlPose";
import "../../styles/welcome.css";

/**
 * Welcome — the landing state (owner mockup 2026-07-11, replaces the old hero banner). While
 * visible: the working chrome (time scrub, camera controls, scene clock, finder, explore chip)
 * hides via `body.welcome-active` CSS, and the globe runs the EXPLORE ambient journey as the
 * living backdrop. Any click on the globe dismisses it and brings the full UI back (the canvas
 * pointerdown also exits the journey via the orchestrator's noteInteract — by design); the
 * UPLOAD button dismisses into the upload flow (it carries data-open-upload — UploadFlow's
 * document-level delegate opens the overlay); EXPLORE THE GLOBE dismisses but lets the
 * journey keep flying.
 */
export default function Welcome() {
  // A shared/reloaded `#p=` pose skips the landing entirely — the globe boots AT that view
  // (StylizedTiles reads the same hash); showing the welcome would arm Explore over it.
  const [visible, setVisible] = useState(
    () => typeof location === "undefined" || parsePoseHash(location.hash) === null,
  );
  const pinCount = usePinsStore((s) => s.pins.length);

  // The journey backdrop: armed on mount, and the body class hides the working chrome.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add("welcome-active");
    useCameraStore.getState().setExplore(true);
    return () => document.body.classList.remove("welcome-active");
  }, [visible]);

  // Any direct touch of the globe dismisses the welcome (the same gesture already exits the
  // journey and hands the camera back — one motion, no extra rules).
  useEffect(() => {
    if (!visible) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) setVisible(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="wl" role="region" aria-label="Welcome">
      <div className="wl-copy">
        <span className="wl-eyebrow">EVERY PHOTOGRAPH HAS COORDINATES</span>
        <h1 className="wl-title">
          See your photographs where the&nbsp;world took&nbsp;them.
        </h1>
        <p className="wl-sub">
          Upload a RAW. We read its metadata and place your exact camera — position, heading,
          focal length — on a living globe.
        </p>
        <div className="wl-actions">
          <button
            type="button"
            className="wl-btn wl-btn--primary"
            data-open-upload
            onClick={() => {
              useCameraStore.getState().setExplore(false);
              setVisible(false);
            }}
          >
            UPLOAD A PHOTO
          </button>
          <button type="button" className="wl-btn wl-btn--ghost" onClick={() => setVisible(false)}>
            EXPLORE THE GLOBE <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <span className="wl-hint wl-hint--left">SCROLL OR DRAG TO ORBIT</span>
      {pinCount > 0 && (
        <span className="wl-hint wl-hint--right">
          {pinCount} {pinCount === 1 ? "FRAME" : "FRAMES"} ON THE GLOBE
        </span>
      )}
    </div>
  );
}
