import { useEffect, useMemo, useState } from "react";
import InfoDot from "../ui/InfoDot";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useCameraStore } from "../../store/camera";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import {
  ELEMENTS_TRUST_DAYS,
  targetAzAlt,
  targetShortName,
  type SkyTarget,
  type TargetState,
} from "../../lib/ephemeris/targets";
import {
  closestApproach,
  jdTdbFromUtcMs,
  KM_PER_AU,
  nextPerihelionMs,
  perihelionMs,
  visibilityClass,
} from "../../lib/ephemeris/comet";
import { targetWindows, type TargetWindow } from "../../lib/ephemeris/planner";
import { subjectDistanceForDiscMatch } from "../../lib/geo/sizeDistance";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { cardinal } from "../../lib/format/readout";
import "../../styles/target-panel.css";
import "../../styles/tips.css";

/**
 * Sky-target panel (ASTRO ENGINE phase A, 2026-08-03 — generalises the 2026-08-02 CometPanel).
 * The card is the instrument face of `lib/ephemeris/targets.ts`: where the tracked target is
 * RIGHT NOW from the current anchor, what it is (a typed per-kind card), and the next dark-sky
 * windows to actually go out and look — every window button pins scene time so the globe flies
 * its own sky to that instant. The SKY search (LocationFinder) swaps the tracked target; 10P is
 * the standing default guest.
 *
 * Honesty contract carried from the comet session: every magnitude is a MODEL and the footnote
 * names which one; the sky marker is an instrument overlay at stylized size — its direction,
 * the DSO ellipse extents and every number here are the real ephemeris/catalog.
 */

const two = (n: number) => String(n).padStart(2, "0");

/** RA in hours/minutes — the form you dial into a mount. */
function raLabel(raDeg: number): string {
  const h = raDeg / 15;
  const hh = Math.floor(h);
  const mm = (h - hh) * 60;
  return `${two(hh)}h ${mm.toFixed(1)}m`;
}

function decLabel(decDeg: number): string {
  const sign = decDeg < 0 ? "−" : "+";
  const a = Math.abs(decDeg);
  const d = Math.floor(a);
  return `${sign}${two(d)}° ${two(Math.round((a - d) * 60))}′`;
}

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Session quality → a 4-step bar (the score is altitude × moon interference × duration). */
function stars(score: number): string {
  const n = Math.max(1, Math.min(4, Math.round(score * 4)));
  return "★".repeat(n) + "☆".repeat(4 - n);
}

/** Pill label — glyph + the shortest honest designation ("☄ 10P" · "◉ MARS" · "❍ M31"). */
function pillLabel(target: SkyTarget): string {
  return `${kindGlyph(target.kind)} ${targetShortName(target).toUpperCase()}`;
}

/** The per-kind magnitude footnote — the model label the honesty contract requires. */
function magnitudeNote(state: TargetState): string {
  switch (state.magnitudeModel) {
    case "observed":
      return "BRIGHTNESS FROM THE OBSERVED LIGHT CURVE (COBS VISUAL/WIDE-FIELD REPORTS). COMET MAGNITUDES SCATTER ~±1 BETWEEN OBSERVERS — A BIG COMA READS BRIGHTER IN BINOCULARS THAN IN A LONG SCOPE.";
    case "jpl":
      return "OUTSIDE THE OBSERVED LIGHT CURVE'S WINDOW — SHOWING JPL'S M1/K1 MODEL, WHICH IS FIT TO CCD APERTURE PHOTOMETRY AND RUNS SYSTEMATICALLY FAINT FOR AN EXTENDED COMA.";
    case "engine":
      return "BRIGHTNESS FROM THE PLANETARY MAGNITUDE MODEL (ASTRONOMY-ENGINE) — GOOD TO ~0.1 MAG.";
    case "catalog":
      return "CATALOG MAGNITUDE (INTEGRATED) — AN EXTENDED OBJECT'S LIGHT IS SPREAD OVER ITS WHOLE AREA, SO IT READS FAINTER IN THE EYEPIECE THAN A STAR OF THE SAME NUMBER.";
    case "hg":
      return "BRIGHTNESS FROM THE IAU (H,G) ASTEROID PHASE LAW (BOWELL 1989) — TYPICALLY GOOD TO ~0.3 MAG; THE OPPOSITION SURGE IS MODELLED.";
  }
}

function WindowRow({ w, onJump }: { w: TargetWindow; onJump: (ms: number) => void }) {
  const moonNote =
    w.moonAltDeg <= 0
      ? "no moon"
      : `moon ${Math.round(w.moonAltDeg)}° ${Math.round(w.moonIllum * 100)}%`;
  return (
    <button
      type="button"
      className="tp-win"
      onClick={() => onJump(w.peakMs)}
      title="Jump scene time to the best moment of this window"
    >
      <span className="tp-win__date">{dateLabel(w.startMs)}</span>
      <span className="tp-win__span">
        {clockLabel(w.startMs)}–{clockLabel(w.endMs)}
      </span>
      <span className="tp-win__score">{stars(w.score)}</span>
      <span className="tp-win__peak">
        PEAK {clockLabel(w.peakMs)} · {w.peakAltDeg.toFixed(1)}° {cardinal(w.peakAzDeg)} · {moonNote}
      </span>
    </button>
  );
}

/** The comet-only apparition block: perihelion badge chips + orbit/object facts. */
function CometFacts({ target, onJump }: { target: SkyTarget; onJump: (ms: number) => void }) {
  const profile = target.facts.kind === "comet" ? target.facts.profile : null;
  const apparition = useMemo(() => {
    if (!profile) return null;
    const periMs = perihelionMs(profile);
    return {
      periMs,
      next: nextPerihelionMs(profile),
      close: closestApproach(periMs, 45, profile),
    };
  }, [profile]);
  if (!profile || !apparition) return null;
  const el = profile.elements;
  return (
    <>
      <div className="tp-chips">
        <button
          type="button"
          className="tp-chip"
          onClick={() => onJump(apparition.periMs)}
          title="Jump scene time"
        >
          <span className="tp-chip__kind">PERIHELION</span>
          <span>
            {dateLabel(apparition.periMs)} {clockLabel(apparition.periMs)}
          </span>
        </button>
        <button
          type="button"
          className="tp-chip"
          onClick={() => onJump(apparition.close.utcMs)}
          title="Jump scene time"
        >
          <span className="tp-chip__kind">CLOSEST</span>
          <span>
            {dateLabel(apparition.close.utcMs)} · {apparition.close.distanceAu.toFixed(3)} au
          </span>
        </button>
      </div>
      <div className="tp-section">THE OBJECT</div>
      <div className="tp-facts">
        {profile.family.toUpperCase()}
        {Number.isFinite(el.periodDays) && <> · PERIOD {(el.periodDays / 365.25).toFixed(2)} YR</>}
        {" "}· q {el.qAu.toFixed(3)} AU
        {el.e < 1 && <> · Q {(el.aAu * (1 + el.e)).toFixed(2)} AU</>}
        {el.e >= 1 && <> · e {el.e.toFixed(4)} (OPEN ORBIT)</>}
        {" "}· i {el.iDeg.toFixed(1)}°
      </div>
      {(profile.nucleusKm != null || profile.rotationHours != null || profile.discovery) && (
        <div className="tp-facts">
          {profile.nucleusKm != null && <>NUCLEUS ≈{profile.nucleusKm} KM · </>}
          {profile.rotationHours != null && <>ROTATION {profile.rotationHours} H · </>}
          {profile.discovery && <>DISCOVERED {profile.discovery.toUpperCase()}</>}
        </div>
      )}
      {apparition.next != null && (
        <div className="tp-facts">
          NEXT PERIHELION {new Date(apparition.next).toISOString().slice(0, 10)}
        </div>
      )}
    </>
  );
}

/** The planet card: blurb + phase + true angular size. */
function PlanetFacts({ target, state }: { target: SkyTarget; state: TargetState }) {
  if (target.facts.kind !== "planet") return null;
  // R9 size→distance (QoL-3): the telephoto-alignment essence — how far the camera must stand
  // for the CURRENT disc to span a human / a building storey stack. Only meaningful for discs
  // you can compose against (sun/moon ≈ 1800″); planets are arcsecond specks.
  const diamRad =
    state.angularDiamArcsec != null && state.angularDiamArcsec > 300
      ? (state.angularDiamArcsec / 3600) * (Math.PI / 180)
      : null;
  const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} KM` : `${Math.round(m)} M`);
  return (
    <>
      <div className="tp-section">THE OBJECT</div>
      <div className="tp-facts">{target.facts.blurb}</div>
      <div className="tp-facts">
        {state.phaseFraction != null && <>PHASE {Math.round(state.phaseFraction * 100)}% · </>}
        {state.angularDiamArcsec != null && <>DISC {state.angularDiamArcsec.toFixed(1)}″ · </>}
        RADIUS {Math.round(target.facts.radiusKm).toLocaleString()} KM
      </div>
      {diamRad != null && (
        <div
          className="tp-facts"
          title="Stand this far from your subject and the disc exactly spans it (true current apparent size)"
        >
          SIZE→DIST · 1.8 M PERSON @ {fmtDist(subjectDistanceForDiscMatch(1.8, diamRad))} · 30 M
          TOWER @ {fmtDist(subjectDistanceForDiscMatch(30, diamRad))}
        </div>
      )}
    </>
  );
}

/** The DSO card: type + constellation + real extents + other names. */
function DsoFacts({ target }: { target: SkyTarget }) {
  if (target.facts.kind !== "dso") return null;
  const f = target.facts;
  const size = target.apparent
    ? `${target.apparent.majorArcmin.toFixed(0)}′ × ${target.apparent.minorArcmin.toFixed(0)}′`
    : null;
  return (
    <>
      <div className="tp-section">THE OBJECT</div>
      <div className="tp-facts">
        {f.typeLabel}
        {f.constellation ? ` · ${f.constellation.toUpperCase()}` : ""}
        {size ? ` · ${size}` : ""}
      </div>
      {f.names.length > 1 && (
        <div className="tp-facts">ALSO: {f.names.slice(1).join(" · ").toUpperCase()}</div>
      )}
      {f.dsoType === "Dup" && (
        <div className="tp-facts">
          IDENTIFICATION CONTESTED — OPENNGC FOLLOWS NED AND POINTS THIS ENTRY AT M101; THE
          POPULAR ALTERNATIVE IS NGC 5866.
        </div>
      )}
    </>
  );
}

/** The star card (phase B): WGSN designation + cross-catalog ids. */
function StarFacts({ target }: { target: SkyTarget }) {
  if (target.facts.kind !== "star") return null;
  const f = target.facts;
  const ids = [
    f.hr != null ? `HR ${f.hr}` : null,
    f.hip != null ? `HIP ${f.hip}` : null,
    f.hd != null ? `HD ${f.hd}` : null,
  ].filter(Boolean);
  return (
    <>
      <div className="tp-section">THE OBJECT</div>
      <div className="tp-facts">
        IAU-NAMED STAR
        {f.bayer ? ` · ${f.bayer.toUpperCase()}` : ` · ${f.designation.toUpperCase()}`}
        {f.constellation ? ` · ${f.constellation.toUpperCase()}` : ""}
      </div>
      {ids.length > 0 && <div className="tp-facts">{ids.join(" · ")}</div>}
    </>
  );
}

/** The asteroid card (phase B): H/G photometry + orbit shape + element honesty. */
function AsteroidFacts({ target, nowMs }: { target: SkyTarget; nowMs: number }) {
  if (target.facts.kind !== "asteroid") return null;
  const f = target.facts;
  const el = f.elements;
  const ageDays = Math.abs(jdTdbFromUtcMs(nowMs) - el.epochJdTdb);
  return (
    <>
      <div className="tp-section">THE OBJECT</div>
      <div className="tp-facts">
        {f.number != null ? `MPC ${f.number} · ` : ""}H {f.h.toFixed(2)} · G {f.g.toFixed(2)} · q{" "}
        {el.qAu.toFixed(3)} AU · Q {(el.aAu * (1 + el.e)).toFixed(2)} AU · i {el.iDeg.toFixed(1)}°
        {Number.isFinite(el.periodDays) && <> · PERIOD {(el.periodDays / 365.25).toFixed(2)} YR</>}
      </div>
      {ageDays > ELEMENTS_TRUST_DAYS && (
        <div className="tp-facts">
          ELEMENTS {Math.round(ageDays)} DAYS FROM THEIR EPOCH — TWO-BODY DRIFT SOFTENS THE
          POSITION THIS FAR OUT.
        </div>
      )}
    </>
  );
}

/** The constellation card (phase B): the marker tracks the figure's centre, not one object. */
function ConstellationFacts({ target }: { target: SkyTarget }) {
  if (target.facts.kind !== "constellation") return null;
  const f = target.facts;
  return (
    <>
      <div className="tp-section">THE CONSTELLATION</div>
      <div className="tp-facts">
        {f.abbr.toUpperCase()} · GENITIVE {f.genitive.toUpperCase()} · ONE OF THE 88 IAU
        CONSTELLATIONS
      </div>
      <div className="tp-facts">
        THE MARKER SITS AT THE FIGURE'S CENTRE — THE PATTERN SPANS TENS OF DEGREES AROUND IT,
        AND ITS FIGURE LIGHTS UP IN THE SKY WHILE TRACKED.
      </div>
    </>
  );
}

export default function TargetPanel() {
  const drag = usePanelDrag("target");
  const open = useSkyStore((s) => s.open);
  const setOpen = useSkyStore((s) => s.setOpen);
  const visible = useSkyStore((s) => s.visible);
  const setVisible = useSkyStore((s) => s.setVisible);
  const highlight = useSkyStore((s) => s.highlight);
  const setHighlight = useSkyStore((s) => s.setHighlight);
  const trail = useSkyStore((s) => s.trail);
  const setTrail = useSkyStore((s) => s.setTrail);
  const ghosts = useSkyStore((s) => s.ghosts);
  const setGhosts = useSkyStore((s) => s.setGhosts);
  const ghostCount = useSkyStore((s) => s.ghostCount);
  const setGhostCount = useSkyStore((s) => s.setGhostCount);
  const ghostStepMin = useSkyStore((s) => s.ghostStepMin);
  const setGhostStepMin = useSkyStore((s) => s.setGhostStepMin);
  const track = useSkyStore((s) => s.track);
  const setTrack = useSkyStore((s) => s.setTrack);
  const target = useSkyStore((s) => s.target);
  const setTime = useTimeStore((s) => s.setTime);
  const live = useTimeStore((s) => s.live);
  const pinnedMs = useTimeStore((s) => s.timeMs);
  const playRate = useTimeStore((s) => s.playRate);

  // The eye: the planner's anchor (a placed photo / the FPV viewer) when there is one, else the
  // live view focus — the same "where am I standing" the rest of the instrument uses.
  const anchor = usePlanStore((s) => s.anchor);
  // Skyline verdict for THIS target (phase E) — planFeed mirrors it only while a photo/FPV eye
  // has a ready profile; id-matched so a just-swapped target never wears the old verdict.
  const planTarget = usePlanStore((s) => s.target);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const latDeg = anchor?.latDeg ?? focusLat;
  const lonDeg = anchor?.lonDeg ?? focusLon;

  const [nowMs, setNowMs] = useState(() => sceneTimeMs());
  useEffect(() => {
    if (!live && playRate === null) {
      setNowMs(pinnedMs);
      return;
    }
    setNowMs(sceneTimeMs());
    const id = setInterval(() => setNowMs(sceneTimeMs()), playRate === null ? 1000 : 250);
    return () => clearInterval(id);
  }, [live, pinnedMs, playRate]);

  // Even the fastest target (the comet) crawls ~0.3°/day — a per-minute sample is far finer
  // than any readout needs.
  const minuteKey = Math.floor(nowMs / 60_000);
  const now = useMemo(() => {
    const t = minuteKey * 60_000;
    return targetAzAlt(target, t, latDeg, lonDeg);
  }, [minuteKey, latDeg, lonDeg, target]);

  // The forward scan is the expensive call (~10–20 ms) — only while the card is open, keyed to
  // the hour, the anchor AND the target so scrubbing minutes or nudging the camera never re-runs.
  const hourKey = Math.floor(nowMs / 3_600_000);
  const latKey = Math.round(latDeg * 20);
  const lonKey = Math.round(lonDeg * 20);
  const windows = useMemo(() => {
    if (!open) return [];
    return targetWindows(
      hourKey * 3_600_000,
      { latDeg: latKey / 20, lonDeg: lonKey / 20, groundAltM: 0, eyeAboveGroundM: 1.6 },
      target,
      { days: 8, stepMin: 15, limit: 5 },
    );
  }, [open, hourKey, latKey, lonKey, target]);

  const s = now.state;
  const upNow = now.altDeg > 0;
  const profile = target.facts.kind === "comet" ? target.facts.profile : null;
  const daysFromPeri = profile ? jdTdbFromUtcMs(nowMs) - profile.elements.tpJdTdb : null;
  const periBadge =
    daysFromPeri == null
      ? null
      : Math.abs(daysFromPeri) < 1
        ? "PERIHELION TODAY"
        : `PERIHELION T${daysFromPeri < 0 ? "−" : "+"}${Math.abs(daysFromPeri).toFixed(0)} d`;
  const elementsAgeDays = profile
    ? Math.abs(jdTdbFromUtcMs(nowMs) - profile.elements.epochJdTdb)
    : null;
  const stale = elementsAgeDays != null && elementsAgeDays > ELEMENTS_TRUST_DAYS;

  return (
    <div className="tp-root" style={drag.style}>
      <DragGrip drag={drag} label="Move the sky-target tracer" tipPos="left" />
      <button
        type="button"
        className={`tp-pill ${open ? "tp-pill--open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Toggle the sky-target tracer"
      >
        {pillLabel(target)}
      </button>
      {open && (
        <aside className="tp" aria-label={`Sky target tracer: ${target.name}`}>
          <div className="tp-head">
            <span className="tp-title">{target.name.toUpperCase()}</span>
            <span className="tp-anchor">{(anchor?.kind ?? "focus").toUpperCase()}</span>
            <InfoDot
              tip="A real celestial object, tracked with the same ephemeris that lights this globe. The sky marker sits on its true direction; the numbers are the real ones. Search the sky (SKY mode in the finder) to track something else. Window buttons pin scene time to the best moment of a dark-sky pass."
              pos="left"
            />
          </div>

          <div className="tp-scroll">
            <div className="tp-badges">
              {periBadge && <span className="tp-badge tp-badge--peri">{periBadge}</span>}
              <span className={`tp-badge ${upNow ? "tp-badge--up" : ""}`}>
                {upNow ? "ABOVE HORIZON" : "BELOW HORIZON"}
              </span>
              {upNow && planTarget?.id === target.id && (
                <span
                  className={`tp-badge ${planTarget.blockedNow ? "tp-badge--sky-blocked" : "tp-badge--up"}`}
                  title={`Local skyline at ${Math.round(planTarget.azDeg)}° is ${planTarget.skylineAltDeg.toFixed(1)}° (terrain + streamed buildings around the plan anchor)`}
                >
                  {planTarget.blockedNow ? "BEHIND SKYLINE" : "SKYLINE CLEAR"}
                </span>
              )}
            </div>

            <div className="tp-live">
              <div className="tp-live__row">
                <span className="tp-k">ALT</span>
                <span className="tp-v">{now.altDeg.toFixed(1)}°</span>
                <span className="tp-k">AZ</span>
                <span className="tp-v">
                  {Math.round(now.azDeg)}° {cardinal(now.azDeg)}
                </span>
              </div>
              <div className="tp-live__row">
                <span className="tp-k">MAG</span>
                <span className="tp-v">
                  {s.magnitude != null ? s.magnitude.toFixed(1) : "—"}
                  {s.magnitudeUncertainty != null && (
                    <span className="tp-pm"> ±{s.magnitudeUncertainty.toFixed(1)}</span>
                  )}
                </span>
                <span className="tp-k">ELONG</span>
                <span className="tp-v">{Math.round(s.elongationDeg)}°</span>
              </div>
              <div className="tp-live__row">
                <span className="tp-k">RA</span>
                <span className="tp-v">{raLabel(s.raDeg)}</span>
                <span className="tp-k">DEC</span>
                <span className="tp-v">{decLabel(s.decDeg)}</span>
              </div>
              {s.distanceAu != null && (
                <div className="tp-sub">
                  Δ {s.distanceAu.toFixed(3)} au (
                  {((s.distanceAu * KM_PER_AU) / 1e6).toFixed(1)} M km)
                  {s.sunDistanceAu != null && <> · r {s.sunDistanceAu.toFixed(3)} au</>}
                </div>
              )}
              {s.magnitude != null && <div className="tp-see">{visibilityClass(s.magnitude)}</div>}
            </div>

            <CometFacts target={target} onJump={setTime} />
            <PlanetFacts target={target} state={s} />
            <DsoFacts target={target} />
            <StarFacts target={target} />
            <AsteroidFacts target={target} nowMs={nowMs} />
            <ConstellationFacts target={target} />

            <div className="tp-section">NEXT SESSIONS · SUN &lt; −15° · TARGET &gt; 5°</div>
            {windows.length > 0 ? (
              windows.map((w) => <WindowRow key={w.startMs} w={w} onJump={setTime} />)
            ) : (
              <div className="tp-status">NO DARK-SKY PASS IN THE NEXT 8 NIGHTS HERE</div>
            )}

            {/* SHOW · MARK · TRAIL (phase C rename — "SKY" read as a mode, not a visibility). */}
            <div className="tp-toggles">
              <button
                type="button"
                className={`tp-toggle ${visible ? "tp-toggle--on" : ""}`}
                onClick={() => setVisible(!visible)}
                aria-pressed={visible}
                title="Render the tracked target in the sky"
              >
                SHOW
              </button>
              <button
                type="button"
                className={`tp-toggle ${highlight ? "tp-toggle--on" : ""}`}
                onClick={() => setHighlight(!highlight)}
                aria-pressed={highlight}
                disabled={!visible}
                title="Highlight reticle around the target"
              >
                MARK
              </button>
              <button
                type="button"
                className={`tp-toggle ${trail ? "tp-toggle--on" : ""}`}
                onClick={() => setTrail(!trail)}
                aria-pressed={trail}
                disabled={!visible}
                title="Projected trajectory across today's sky"
              >
                TRAIL
              </button>
              <button
                type="button"
                className={`tp-toggle ${ghosts ? "tp-toggle--on" : ""}`}
                onClick={() => setGhosts(!ghosts)}
                aria-pressed={ghosts}
                disabled={!visible}
                title="Ghost copies of the body at ± time steps — its path against the surroundings while you scrub"
              >
                GHOSTS
              </button>
              {/* TRACKING camera lock (owner 2026-08-15c) — FPV keeps the target centred.
                  Not gated on `visible`: the lock follows the ephemeris, not the render. */}
              <button
                type="button"
                className={`tp-toggle ${track ? "tp-toggle--on" : ""}`}
                onClick={() => setTrack(!track)}
                aria-pressed={track}
                title="Camera lock (LOOK mode): keep the target centred until released, a look-drag, or it sets below the horizon"
              >
                TRACK
              </button>
            </div>

            {/* Ghost-chain knobs (QoL-2, owner 2026-08-14): symmetric count each way + minutes
                between copies. Steppers, not sliders — discrete values, instrument grammar. */}
            {visible && ghosts && (
              <div className="tp-ghostrow">
                <span className="tp-ghostrow__label">±</span>
                <button
                  type="button"
                  className="tp-ghostbtn"
                  onClick={() => setGhostCount(ghostCount - 1)}
                  disabled={ghostCount <= 1}
                  aria-label="Fewer ghost copies"
                >
                  −
                </button>
                <span className="tp-ghostrow__value">{ghostCount}</span>
                <button
                  type="button"
                  className="tp-ghostbtn"
                  onClick={() => setGhostCount(ghostCount + 1)}
                  disabled={ghostCount >= 15}
                  aria-label="More ghost copies"
                >
                  +
                </button>
                <span className="tp-ghostrow__label">EVERY</span>
                <select
                  className="tp-ghostsel"
                  value={ghostStepMin}
                  onChange={(e) => setGhostStepMin(Number(e.target.value))}
                  aria-label="Minutes between ghost copies"
                >
                  {[1, 2, 5, 10, 15, 20, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} MIN
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="tp-note">
              {magnitudeNote(s)} THE SKY MARKER IS AN INSTRUMENT OVERLAY AT STYLIZED SIZE; ITS
              DIRECTION AND EVERY NUMBER HERE ARE THE REAL EPHEMERIS.
            </div>
            {stale && elementsAgeDays != null && (
              <div className="tp-note tp-note--warn">
                SCENE TIME IS {Math.round(elementsAgeDays)} D FROM THE BAKED ORBIT EPOCH —
                POSITION EXTRAPOLATED (ARCMINUTE CLASS).
              </div>
            )}
            <div className="tp-note tp-note--src">{target.source}</div>
          </div>
        </aside>
      )}
    </div>
  );
}
