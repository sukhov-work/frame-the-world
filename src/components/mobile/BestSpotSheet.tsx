/**
 * BestSpotSheet (owner order 2026-09-07g) — BEST SPOT, the heatmap, as the FIFTH bottom-row tab
 * on /m: WHERE TO STAND for this sunrise / sunset / moonrise / moonset. The desktop behaviour
 * (`panels/BestSpotPanel.tsx`, SPEC_V2 §6.9) WITHOUT the ULTRA options — no 1 m tier, no
 * per-cell REFINE — in the /m sheet idiom rather than a port of the 928-line window.
 *
 * SHARED, NOT COPIED. The store (`store/bestSpot`), the solver worker, the GL sheet and the
 * shortlist markers are the desktop's own; what this file adds is the SURFACE. Every honesty
 * line, label and readout comes from `controls/bestSpotCopy.ts` — the one tier both shells may
 * import (`mobileFence.test.ts` rule 3) — so the phone can never print a claim the desktop does
 * not, or vice versa. **Delete a status line and the picture starts lying** (§8): the ladder is
 * all here, three lines inline and the other five one tap away, labelled as caveats.
 *
 * THE FIND IDIOM. MobileShell mounts this component UNCONDITIONALLY and only the <Sheet> chrome
 * follows the tab: `bestSpot.open` is STICKY on /m — the first visit opens the window in the
 * store, collapsing the sheet leaves it open, so an ARMED heatmap survives the sheet closing and
 * the user pans the map with the field and the eight markers on it (the whole point of the tab).
 * Page teardown is the only `setOpen(false)`. `setOpen` is never called on collapse because it
 * resets the arming switch in BOTH directions (owner item 4) — that reset is right for the
 * desktop's segmented toggle and wrong for a tab.
 *
 * TOUCH, NOT HOVER. There is no `hoverKey` here; the sheet's cell outline follows the SELECTED
 * row, and the canvas tip that floats beside a hovered marker has no phone twin — a marker TAP
 * selects + previews (the engine's `tryBestSpotMarkerClick`, shared), and ✕ EXIT VIEW ends the
 * preview through the same watcher Escape does on desktop.
 *
 * Fences that bind: this file imports react + stores + `lib/**` + `controls/**` + `globe/tuning`
 * + styles only; it never names ULTRA (`fences.test.ts` pins that against the whole `mobile/**`
 * tree, with the desktop panel as the positive control).
 */

import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import {
  shortlistQuality,
  useBestSpotStore,
  type BestSpotSpot,
} from "../../store/bestSpot";
import { useCameraStore } from "../../store/camera";
import InstrumentSlider from "../controls/InstrumentSlider";
import {
  bestSpotStatusEntries,
  type BestSpotStatusKey,
  CONTACT_LABEL,
  CONTACT_WHY,
  distLabel,
  KIND_OPTIONS,
  leadLabel,
  pending,
  shortlistReady,
  bestSpotProgress,
  spotNoteLine,
  terrainOnlyLine,
  TRACK_NULL_LINES,
} from "../controls/bestSpotCopy";
import { BESTSPOT } from "../globe/tuning";
import { HEAT_SPOTS, heatRampById, spotQualityCss } from "../../lib/theme/heatPalette";
import { AERIAL_MIN_M } from "../../lib/geo/bestSpotTypes";
import { cardinal } from "../../lib/format/readout";
import "../../styles/upload-flow.css"; // the .uf-slider grammar controls/InstrumentSlider renders
import "../../styles/mobile/chrome.css";

/** Which of §8's ladder lines stay INLINE on the phone (BY KEY, never by index); the rest sit
 *  behind the caveats toggle. These three are the ones a reader acts on — how much is unmapped,
 *  at what pitch the obstruction was solved, how far the evidence reaches; the other five
 *  qualify them. */
const INLINE_STATUS_KEYS: readonly BestSpotStatusKey[] = ["unmapped", "obstruction", "reach"];

/**
 * One shortlist row — HOOK-FREE on purpose, the desktop `SpotRow` contract: the fence calls it as
 * a plain function and invokes `onSelect` / `onGo` / `onLook` off the returned tree (vitest here
 * has no DOM). No REFINE on the phone (ULTRA is desktop-only); everything else is the same row.
 *
 * §3.5 is non-negotiable here too: the ABSOLUTE score prints beside the relative bar.
 */
export function MobileSpotRow({
  spot,
  relative,
  swatchCss,
  selected,
  previewing,
  onSelect,
  onGo,
  onLook,
}: {
  spot: BestSpotSpot;
  /** score ÷ the shortlist's best — the BAR. Never the number. */
  relative: number;
  swatchCss: string;
  /** The user PICKED this row — its marker is lit on the globe and the actions show. */
  selected: boolean;
  /** …and is currently standing at it in the FPV preview. */
  previewing: boolean;
  onSelect: (key: string | null) => void;
  /** The EXPLICIT travel action — the only thing that moves the disc centre. */
  onGo: (spot: BestSpotSpot) => void;
  onLook: (spot: BestSpotSpot) => void;
}) {
  const note = spotNoteLine(spot);
  return (
    <div className={`m-row m-bsp-row${selected ? " m-bsp-row--sel" : ""}`}>
      {/* A tap SELECTS (owner item 1) — nothing moves until GO. A second tap deselects. */}
      <button
        type="button"
        className="m-row__jump"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : spot.key)}
      >
        <span className="m-sw" style={{ background: swatchCss }} />
        <span className="m-row__time">#{spot.rank}</span>
        <span className="m-row__time">{spot.score.toFixed(2)}</span>
        <span className="m-bsp-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, relative)) * 100)}%` }} />
        </span>
        <span className="m-row__meta">{`${distLabel(spot.distM)} ${cardinal(spot.bearingDeg)}`}</span>
        <span className="m-row__kind">{CONTACT_LABEL[spot.contact]}</span>
        <span className="m-row__meta">{leadLabel(spot.leadMs)}</span>
      </button>
      {selected && (
        <div className="m-bsp-why">
          <div className="m-status-line">{CONTACT_WHY[spot.contact]}</div>
          {note && <div className="m-status-line">{note}</div>}
          <div className="m-bsp-acts">
            <button type="button" className="m-act m-act--accent" onClick={() => onGo(spot)}>
              GO → RE-CENTRE HERE
            </button>
            <button
              type="button"
              className={`m-act${previewing ? " m-act--accent" : ""}`}
              aria-pressed={previewing}
              onClick={() => onLook(spot)}
            >
              {previewing ? "◎ BACK" : "◎ LOOK FROM HERE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The four event pills — `☀ SUNRISE`, `☾ M.SET`… — the desktop `ChipRow` options in the /m
 *  `.m-toggle` grammar. Pure, so the fence can prove all four render and the picked one is on. */
export function kindPillLabel(o: (typeof KIND_OPTIONS)[number]): string {
  return `${o.label} ${o.kind}`;
}

export default function BestSpotSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // WHOLE-STATE read, deliberately (the desktop panel's reason): every field of this store is
  // rendered somewhere on an honesty surface, and the engine mirrors land at
  // `BESTSPOT.mirrorEveryFrames` cadence, never per frame.
  const s = useBestSpotStore();
  const tempPin = useCameraStore((c) => c.tempPin);
  const [moreOpen, setMoreOpen] = useState(false);

  // STICKY open (the FindSheet contract): the first visit opens the window in the store;
  // collapsing the sheet leaves it open so an armed disc survives. `setOpen(true)` is guarded —
  // it RESETS the arming switch, which is right on the desktop's segmented toggle and would
  // disarm the phone's heatmap on every re-visit here.
  useEffect(() => {
    if (open && !useBestSpotStore.getState().open) useBestSpotStore.getState().setOpen(true);
  }, [open]);
  // Page teardown only: close the window (which also disarms and releases the sheet).
  useEffect(
    () => () => {
      useBestSpotStore.getState().setOpen(false);
    },
    [],
  );

  // Collapsed renders nothing — every hook above stays alive (the sticky contract).
  if (!open) return null;

  const p = pending(s);
  // R2: the temp pin is a CENTRE SOURCE. Until the engine echoes the centre it actually solved
  // at, the request is the best the header can honestly show.
  const latDeg = p.centreLatDeg ?? tempPin?.latDeg ?? null;
  const lonDeg = p.centreLonDeg ?? tempPin?.lonDeg ?? null;
  const hasCentre = latDeg !== null && lonDeg !== null;

  const {
    heatmapOn,
    setHeatmapOn,
    selectedKey,
    setSelectedKey,
    kind,
    setKind,
    radiusM,
    setRadiusM,
    radiiM,
    liftM,
    setLiftM,
    topK,
    verdictCounts,
    tilesPending,
    ladderRung,
    gridCellM,
    cellM,
    suggestedLiftM,
    trackNull,
    terrainOnly,
    rampId,
  } = s;
  const ready = shortlistReady(s);
  const progress = bestSpotProgress(s);
  const bestScore = topK.length > 0 ? Math.max(...topK.map((t) => t.score)) : 1;
  const topKScores = topK.map((t) => t.score);
  const ladder = BESTSPOT.ladderCellsM;
  const rungFrac = ladder.length > 1 ? Math.min(1, Math.max(0, (ladderRung + 1) / ladder.length)) : 1;
  // SHEET ALTITUDE = the pedestrian eye + the lift (the desktop's settled reading; the rail starts
  // at `eyeM`, double-tap/reset returns to `liftM = 0`).
  const sheetAltM = BESTSPOT.eyeM + liftM;
  const selected = topK.find((t) => t.key === selectedKey) ?? null;
  const previewKey = p.previewKey ?? null;
  const statusEntries = bestSpotStatusEntries(s);
  const inlineLines = statusEntries.filter((e) => INLINE_STATUS_KEYS.includes(e.key)).map((e) => e.line);
  const moreLines = statusEntries.filter((e) => !INLINE_STATUS_KEYS.includes(e.key)).map((e) => e.line);

  /** A phone-only affordance: the disc centre at the MAP CENTRE (the camera's focus), so a user
   *  who is just looking at a place need not long-press it first. It is the same temp pin the
   *  long-press and MY LOC drop — one centre source, R2 unchanged. */
  const centreHere = () => {
    const cam = useCameraStore.getState();
    cam.setTempPin({ latDeg: cam.focusLatDeg, lonDeg: cam.focusLonDeg });
  };

  return (
    <Sheet title="BEST SPOT" onClose={onClose}>
      {/* THE SWITCH (owner item 4) — the window opens with it OFF; composing the request is free
          and ONE tap arms it. Deliberately enabled without a centre: arming first and then
          long-pressing the map is a legitimate order, and the line below says what is missing. */}
      <div className="m-bsp-head">
        <button
          type="button"
          className={`m-bsp-switch${heatmapOn ? " m-bsp-switch--on" : ""}`}
          aria-pressed={heatmapOn}
          onClick={() => setHeatmapOn(!heatmapOn)}
        >
          <span className="m-bsp-switch__glyph" aria-hidden="true">
            ◎
          </span>
          HEATMAP
          <span className="m-bsp-switch__state">
            {heatmapOn ? (hasCentre ? "ON" : "ARMED — NO CENTRE") : "OFF"}
          </span>
        </button>
        {/* T118 + owner order 2026-09-08 — the ONE status chip, the desktop's twin. */}
        {progress && (
          <span
            className="m-toggle m-bsp-progress"
            data-state={progress.key}
            data-busy={progress.key === "done" ? "0" : "1"}
            role="status"
            aria-live="polite"
          >
            {progress.key !== "done" && <i aria-hidden="true">◌</i>}
            {progress.label}
          </span>
        )}
        {tilesPending && <span className="m-toggle m-toggle--on">READING THE MAP</span>}
      </div>
      <div className="m-status-line">
        {hasCentre ? `CENTRE ${latDeg.toFixed(4)}, ${lonDeg.toFixed(4)}` : "NO CENTRE YET"}
        {heatmapOn ? " · THE FIELD STAYS ON THE MAP WHEN THIS SHEET CLOSES" : ""}
      </div>

      {!hasCentre && (
        <>
          <div className="m-status-line">
            LONG-PRESS THE MAP, USE 🧭 MY LOC, OR CENTRE THE DISC WHERE THE MAP IS LOOKING
          </div>
          <div className="m-chips">
            <button type="button" className="m-act m-act--accent" onClick={centreHere}>
              ◎ CENTRE HERE
            </button>
          </div>
        </>
      )}
      {!heatmapOn && (
        <div className="m-status-line">
          HEATMAP OFF — NOTHING IS BEING COMPUTED. SET THE EVENT, RADIUS AND ALTITUDE, THEN TURN IT
          ON.
        </div>
      )}
      {/* ITEM 3 — the preview is a MODE, and a mode with no visible state is a trap. The second
          clause is the promise the mechanism exists to keep. ✕ EXIT VIEW in the scene ends it too. */}
      {previewKey !== null && (
        <div className="m-status-line m-bsp-warn">
          {`◎ LOOKING FROM #${topK.find((t) => t.key === previewKey)?.rank ?? "?"} — THE DISC IS STILL CENTRED WHERE IT WAS, NOTHING IS BEING RE-SOLVED.`}
          <button
            type="button"
            className="m-act m-act--quiet"
            onClick={() => p.previewSpot?.(null)}
          >
            ◎ BACK
          </button>
        </div>
      )}

      <div className="m-section">EVENT</div>
      <div className="m-toggles">
        {KIND_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`m-toggle m-toggle--${o.tone}${kind === o.value ? " m-toggle--on" : ""}`}
            aria-pressed={kind === o.value}
            onClick={() => setKind(o.value)}
          >
            {kindPillLabel(o)}
          </button>
        ))}
      </div>
      {/* R7 — the moon multiplies but the FLOOR rises, so a bad night DIMS rather than vanishes. */}
      {(kind === "moonrise" || kind === "moonset") && (
        <div className="m-status-line">
          {p.moonWorth === undefined
            ? "☾ MOON WORTH NOT PUBLISHED YET"
            : `☾ THIS MOON IS WORTH ${p.moonWorth.toFixed(2)}`}
        </div>
      )}

      <div className="m-section">RADIUS (m)</div>
      <div className="m-toggles">
        {radiiM.map((r) => (
          <button
            key={r}
            type="button"
            className={`m-toggle${radiusM === r ? " m-toggle--on" : ""}`}
            aria-pressed={radiusM === r}
            onClick={() => setRadiusM(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <InstrumentSlider
        label="SHEET ALTITUDE"
        formatted={`${sheetAltM < 10 ? sheetAltM.toFixed(1) : Math.round(sheetAltM)} m`}
        value={sheetAltM}
        min={BESTSPOT.eyeM}
        max={BESTSPOT.liftMaxM}
        log
        // R1: at and above 5 m the DRONE rules take over (only solid interiors are masked).
        badge={sheetAltM >= AERIAL_MIN_M ? "▲ DRONE" : undefined}
        onChange={(v) => setLiftM(v - BESTSPOT.eyeM)}
        onReset={() => setLiftM(0)}
        ariaLabel="Sheet altitude above the ground"
      />
      {/* R6 — the lowest COMPUTED lift that clears the display floor; never a constant. */}
      {suggestedLiftM !== null && (
        <div className="m-chips">
          <button type="button" className="m-act" onClick={() => setLiftM(suggestedLiftM)}>
            {`NOTHING CLEARS THE SKYLINE AT EYE LEVEL — TRY ${Math.round(suggestedLiftM)} m`}
          </button>
        </div>
      )}

      {/* The legend: the ramp reads the ABSOLUTE score (display-normalised, the two contour majors
          heavier); the marker ramp reads the eight AGAINST EACH OTHER (owner item 2). Saying which
          is which is the cost of being allowed to renormalise. */}
      <div className="m-section">SCORE</div>
      <div
        className="m-bsp-ramp"
        style={{
          backgroundImage: `linear-gradient(to right, ${heatRampById(rampId)
            .map((stop) => stop.css)
            .join(", ")})`,
        }}
      />
      <div className="m-bsp-ticks">
        <span>{s.displayLo.toFixed(2)}</span>
        {BESTSPOT.contourMajors.map((m) => (
          <b key={m}>{m.toFixed(2)}</b>
        ))}
        <span>{s.displayHi.toFixed(2)}</span>
      </div>
      <div className="m-status-line">
        {`UNMAPPED — NOT SCORED${
          verdictCounts.total > 0 ? ` · ${verdictCounts.unknown.toLocaleString("en-US")}` : ""
        } · CAN'T STAND HERE${
          verdictCounts.total > 0 ? ` · ${verdictCounts.blocked.toLocaleString("en-US")}` : ""
        }`}
      </div>
      <div className="m-section">MARKERS · HUE SPREADS THE EIGHT, BRIGHTNESS IS ABSOLUTE</div>
      <div
        className="m-bsp-ramp"
        style={{
          backgroundImage: `linear-gradient(to right, ${HEAT_SPOTS.map((stop) => stop.css).join(", ")})`,
        }}
      />
      <div className="m-bsp-ticks">
        <span>#8</span>
        <span>#1</span>
      </div>

      {/* §8's ladder — three lines inline, the other five one tap away, and NAMED as caveats so
          the tap is not a "details" it is safe to skip. Warnings never fold. */}
      {inlineLines.map((line) => (
        <div className="m-status-line" key={line}>
          {line}
        </div>
      ))}
      <button
        type="button"
        className="m-bsp-more"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen(!moreOpen)}
      >
        {moreOpen ? "▾" : "▸"} {moreLines.length} MORE CAVEATS
      </button>
      {moreOpen &&
        moreLines.map((line) => (
          <div className="m-status-line" key={line}>
            {line}
          </div>
        ))}
      {terrainOnly && <div className="m-status-line m-bsp-warn">{terrainOnlyLine(s)}</div>}
      {trackNull &&
        TRACK_NULL_LINES.map((line) => (
          <div className="m-status-line m-bsp-warn" key={line}>
            {line}
          </div>
        ))}

      <div className="m-section">
        {`BEST SPOTS${ready ? "" : " · RANKING…"}${
          verdictCounts.total > 0
            ? ` · ${topK.length} OF ${verdictCounts.scored.toLocaleString("en-US")}`
            : ""
        }`}
      </div>
      {/* §2.3 state 2 — the determinate rung pip. The sheet is its own progress indicator. */}
      {!ready && (
        <>
          <span className="m-bsp-bar m-bsp-bar--rung" aria-hidden="true">
            <i style={{ width: `${Math.round(rungFrac * 100)}%` }} />
          </span>
          <div className="m-status-line">
            {`${ladder[0]} m → ${cellM} m${ladderRung >= 0 ? ` · NOW ${gridCellM} m` : ""}`}
          </div>
        </>
      )}
      <div className="m-rows" data-ranking={ready ? "0" : "1"}>
        {topK.map((spot) => (
          <MobileSpotRow
            key={spot.key}
            spot={spot}
            relative={spot.score / (bestScore || 1)}
            // The SAME two functions the GL marker goes through — the swatch IS its marker.
            swatchCss={spotQualityCss(shortlistQuality(spot.score, topKScores))}
            selected={selectedKey === spot.key}
            previewing={previewKey === spot.key}
            onSelect={setSelectedKey}
            // THE ONLY ACTION THAT MOVES THE DISC (item 1). Leave any preview FIRST: ending one
            // RESTORES the pin it borrowed, and a GO issued from inside it would be undone by that
            // restore a frame later. Both writes are synchronous — restore, then move.
            onGo={(hit) => {
              p.previewSpot?.(null);
              useCameraStore.getState().setTempPin({ latDeg: hit.latDeg, lonDeg: hit.lonDeg });
              onClose(); // the disc re-solves under the map — watch it, not the list
            }}
            onLook={(hit) => {
              p.previewSpot?.(previewKey === hit.key ? null : hit.key);
              if (previewKey !== hit.key) onClose(); // the preview is a VIEW — show it
            }}
          />
        ))}
        {ready && topK.length === 0 && (
          <div className="m-status-line">
            NOTHING IN THIS DISC SCORES ABOVE THE FLOOR — TRY ANOTHER EVENT, A WIDER RADIUS, OR THE
            LIFT
          </div>
        )}
      </div>
      {ready && topK.length > 0 && selected === null && (
        <div className="m-status-line">
          TAP A SPOT TO LIGHT IT ON THE MAP — THEN GO THERE OR LOOK FROM IT. TAPPING ITS MARKER ON
          THE MAP LOOKS FROM IT DIRECTLY.
        </div>
      )}
    </Sheet>
  );
}
