import { useCameraStore, type FpvBodyMarker } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { aimAtSky } from "../../store/skyAim";
import { sceneTimeMs } from "../../store/time";
import { nextRiseAzimuth } from "../../lib/ephemeris/dayArc";
import { bodyTarget } from "../../lib/ephemeris/targets";
import "../../styles/fpv-hud.css";
import "../../styles/tips.css";

/**
 * SkyGotoChips — the off-frame GOTO edge chips (extracted from FpvHud 2026-08-19b so /m can
 * mount them too, owner item: "quick way to bring the followed object into view"). One chip
 * per body (☀ / ☾ / the tracked target's glyph+designation) floating at the frame edge,
 * arrow pointing toward the body; click steers the camera through the shared aim idiom
 * (store/skyAim — FPV glides the look, orbit resolves heading/tilt).
 *
 * Below-horizon (owner 2026-08-19b, TRACKED TARGET only — ☀/☾ keep hiding, or every night
 * would pin a sun chip to the screen edge): the chip stays, dimmed, and the click aims at
 * the azimuth where the target next RISES (lib/ephemeris nextRiseAzimuth, computed on click
 * — never per frame; no rise in 48 h falls back to the current azimuth at the horizon).
 *
 * Data flow: the orchestrator's stepFpvHudAndSkyMarkers writes the `skyMarkers` mirror in
 * EVERY mode (sun/moon gated by SKY guides, target by sky.visible — an UNFOLLOWED target
 * has no chip); this island only consumes it. Desktop mounts it inside FpvHud (all modes,
 * the S6 rule); /m mounts it in MobileShell while FPV is live (the 2D map has no sky).
 */

export default function SkyGotoChips() {
  const markers = useCameraStore((s) => s.skyMarkers);
  const fpvLive = useCameraStore((s) => s.fpvHud !== null || s.tempFpv);
  // /m mounts this island page-wide (the MiniMap fence-exemption precedent) but shows chips
  // only while FPV is live — the 2D map is a nadir view with no sky to point into.
  if (typeof document !== "undefined" && document.body.classList.contains("m") && !fpvLive)
    return null;
  if (!markers) return null;
  return (
    <>
      {markers.sun && <BodyChip marker={markers.sun} glyph="☀" kind="sun" />}
      {markers.moon && <BodyChip marker={markers.moon} glyph="☾" kind="moon" />}
      {markers.target && (
        <BodyChip
          marker={markers.target}
          glyph={markers.target.glyph}
          kind="target"
          label={markers.target.label}
          // The chip is the marker's off-screen surrogate — on desktop clicking it also
          // fronts the TARGET panel, like clicking the marker itself (phase C). On /m the
          // sheet would cover the view the user just asked to see — aim only.
          onAim={() => {
            if (!document.body.classList.contains("m")) useSkyStore.getState().setOpen(true);
          }}
        />
      )}
    </>
  );
}

/** Edge chip pointing toward an off-frame body — clamped to a margin box inside the viewport.
 *  Clicking it brings the body into view via the shared aim idiom (store/skyAim — owner
 *  2026-07-14; extracted phase C): FPV glides the look, orbit resolves into heading/tilt glide
 *  targets. The tracked sky target renders the same chip with its kind glyph + designation
 *  (phase C, owner feedback #4). */
function BodyChip({
  marker,
  glyph,
  kind,
  label,
  onAim,
}: {
  marker: FpvBodyMarker;
  glyph: string;
  kind: "sun" | "moon" | "target";
  /** Designation text after the glyph (tracked target only — ☀/☾ speak for themselves). */
  label?: string;
  /** Extra action on click (the target chip fronts its panel). */
  onAim?: () => void;
}) {
  // Sun/moon hide below the horizon as always; the TRACKED target keeps a dimmed chip whose
  // click looks at its next-rise azimuth (owner 2026-08-19b).
  if (marker.inFrame || (!marker.up && kind !== "target")) return null;
  const down = !marker.up;
  // Screen-plane direction: store y is up, screen y is down.
  const sx = marker.dirX;
  const sy = -marker.dirY;
  const margin = 64;
  const halfW = window.innerWidth / 2 - margin;
  const halfH = window.innerHeight / 2 - margin;
  const k = Math.min(
    Math.abs(sx) > 1e-6 ? halfW / Math.abs(sx) : Infinity,
    Math.abs(sy) > 1e-6 ? halfH / Math.abs(sy) : Infinity,
  );
  const x = window.innerWidth / 2 + sx * k;
  let y = window.innerHeight / 2 + sy * k;
  // /m: the bottom edge belongs to the peek/dock/tab stack and the walk joystick — lift the
  // clamp so a downward chip floats above the chrome instead of underneath it.
  if (document.body.classList.contains("m")) {
    y = Math.min(y, window.innerHeight - 190);
  }
  const angleDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
  const name = label ?? kind;

  const aim = () => {
    if (down) {
      // Below the horizon: look where it next rises (computed HERE, on click — a 48 h
      // ephemeris scan has no place in a frame loop). No rise → its azimuth at the horizon.
      const cam = useCameraStore.getState();
      const at = cam.camGeo ?? { latDeg: cam.focusLatDeg, lonDeg: cam.focusLonDeg };
      const target = kind === "target" ? useSkyStore.getState().target : bodyTarget(kind);
      const rise = nextRiseAzimuth(target, sceneTimeMs(), at.latDeg, at.lonDeg);
      aimAtSky(rise?.azDeg ?? marker.azDeg, 0);
    } else {
      aimAtSky(marker.azDeg, marker.altDeg);
    }
    onAim?.();
  };

  return (
    <button
      type="button"
      className={`fh-chip fh-chip--${kind}${down ? " fh-chip--down" : ""} tip`}
      style={{ left: x, top: y }}
      onClick={aim}
      data-tip={down ? "BELOW HORIZON — LOOK WHERE IT RISES NEXT" : "BRING IT INTO VIEW"}
      data-tip-pos="down"
      aria-label={
        down
          ? `${name} is below the horizon — click to look where it rises next`
          : `${name} is off-frame at ${Math.round(marker.azDeg)}° — click to look at it`
      }
    >
      <span className="fh-chip__glyph">{glyph}</span>
      {label && <span className="fh-chip__label">{label}</span>}
      <span className="fh-chip__arrow" style={{ transform: `rotate(${angleDeg}deg)` }}>
        ➤
      </span>
    </button>
  );
}
