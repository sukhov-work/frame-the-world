import { useEffect, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { usePinsStore } from "../../store/pins";
import { mobileShellHash, parseFpvHash, parsePoseHash } from "../../lib/geo/urlPose";
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
  // A shared/reloaded `#p=` pose (or `#f=` FPV view, owner 2026-07-14) skips the landing
  // entirely — the globe boots AT that view (StylizedTiles reads the same hash); showing the
  // welcome would arm Explore over it.
  const [visible, setVisible] = useState(
    () =>
      typeof location === "undefined" ||
      (parsePoseHash(location.hash) === null && parseFpvHash(location.hash) === null),
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
        <span className="wl-eyebrow">EVERY FRAME HAS ITS MOMENT</span>
        {/* Brand launch (owner 2026-08-19): the Plux wordmark replaces the old hero headline.
            The h1 keeps the page's accessible name — the image alt carries it. */}
        <h1 className="wl-title">
          <img
            className="wl-logo"
            src="/logo/plux-wordmark.webp"
            alt="Plux — plan the shot where the world will take it"
            width="1200"
            height="489"
          />
        </h1>
        <p className="wl-sub">
          Stand anywhere on a living globe — real streets, real skyline, the real sun, moon and
          stars. Scrub time, frame the sky, and find the day everything lines up.
        </p>
        {/* Planning/exploration lead (owner 2026-08-14: upload = last priority, a side
            gimmick) — EXPLORE carries the primary weight; upload rides along as the ghost. */}
        <div className="wl-actions">
          <button type="button" className="wl-btn wl-btn--primary" onClick={() => setVisible(false)}>
            EXPLORE THE GLOBE <span aria-hidden="true">→</span>
          </button>
          {/* Owner 2026-08-15c: a big escape hatch to /m for phones the auto-detect missed
              (reliable detection already redirects — this button is the belt). Batch #5
              item 6: carry the pose if one exists (welcome-active suppresses the mirror, so
              usually there is none and the plain /m default boot is right). */}
          <a
            className="wl-btn wl-btn--ghost"
            href="/m"
            onClick={(e) => {
              const h = mobileShellHash(window.location.hash);
              if (!h) return;
              e.preventDefault();
              window.location.href = "/m" + h;
            }}
          >
            MOBILE VERSION
          </a>
          {/* Guide track G1: first-run discoverability — dismiss into the scene with the
              GUIDE panel open (Guide.tsx's delegated data-open-guide listener). */}
          <button
            type="button"
            className="wl-btn wl-btn--ghost"
            data-open-guide
            onClick={() => {
              // Reading the guide over a touring camera is noise — arrive on a still globe.
              useCameraStore.getState().setExplore(false);
              setVisible(false);
            }}
          >
            HOW IT WORKS
          </button>
          <button
            type="button"
            className="wl-btn wl-btn--ghost"
            data-open-upload
            onClick={() => {
              useCameraStore.getState().setExplore(false);
              setVisible(false);
            }}
          >
            UPLOAD A PHOTO
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
