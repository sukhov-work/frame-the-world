/**
 * MobileSearch (M1) — the /m search sheet: EARTH (fly there) | SKY (track it). Consumes the
 * SAME libs as the desktop LocationFinder (lib/geo/geocode · lib/sky) but never the panel —
 * the two-shell drift guard. Provider contract carried over: Photon autocompletes debounced +
 * biased to the camera focus; Nominatim on explicit submit only; results carry the OSM/ODbL
 * attribution. The sky catalog stays dynamic-import-only (lazyContract.test.ts).
 *
 * M1 scope note: the desktop's SIMBAD//api/sbdb long-tail fallback is NOT wired here yet —
 * the local index (planets · stars · Messier/NGC · comets · asteroids · constellations)
 * covers the planning loop; the long tail rides a later M-phase.
 */

import { useEffect, useRef, useState } from "react";
import {
  arrivalAltM,
  nominatimSearch,
  photonSearch,
  type GeocodeHit,
} from "../../lib/geo/geocode";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { aimAtSkyFromSearch } from "../../store/skyAim";
import { sceneTimeMs } from "../../store/time";
import { targetAzAlt } from "../../lib/ephemeris/targets";
import { kindGlyph, type SkyIndexEntry } from "../../lib/sky/searchIndex";
import { SEARCH } from "../globe/tuning";
import MobilePlaces from "./MobilePlaces";
import "../../styles/mobile/chrome.css";

type Status = "idle" | "loading" | "ready" | "error";
type Mode = "earth" | "sky";

/** Catalog ids like "m1" match from 2 chars; place names keep the fair-use 3. */
const SKY_MIN_QUERY_LEN = 2;

// One catalog chunk per session, loaded on the first SKY interaction (lazy by contract).
let catalogPromise: Promise<typeof import("../../lib/sky/catalog")> | null = null;
const loadCatalog = () => (catalogPromise ??= import("../../lib/sky/catalog"));

export default function MobileSearch({
  onFly,
  onTrack,
}: {
  /** A place was picked — the shell closes the sheet and lets the flight play. */
  onFly: () => void;
  /** A sky object is now tracked — the shell swaps to the TARGET sheet. */
  onTrack: () => void;
}) {
  // SKY is the default mode (owner 2026-08-19, batch item 6). This sheet mounts only when
  // the user opens search, so warming the catalog at mount keeps the lazy contract.
  const [mode, setMode] = useState<Mode>("sky");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [skyHits, setSkyHits] = useState<SkyIndexEntry[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skyQueryRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  const cancelPending = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    skyQueryRef.current = "";
  };
  useEffect(() => {
    void loadCatalog(); // sky-default: ready before the first keystroke
    return cancelPending;
  }, []);

  const runSearch = async (fn: (signal: AbortSignal) => Promise<GeocodeHit[]>) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStatus("loading");
    try {
      const result = await fn(ctl.signal);
      if (ctl.signal.aborted) return;
      setHits(result);
      setStatus("ready");
    } catch (err) {
      if (ctl.signal.aborted) return; // superseded — not an error
      console.warn("[m-search] geocoding failed:", err);
      setHits([]);
      setStatus("error");
    }
  };

  const runSkySearch = (value: string) => {
    const q = value.trim();
    skyQueryRef.current = q;
    setStatus("loading");
    loadCatalog()
      .then(async (cat) => {
        if (skyQueryRef.current !== q) return; // superseded while the chunk loaded
        const instant = cat.searchSkyCatalog(q, SEARCH.limit);
        if (instant.length > 0) {
          setSkyHits(instant);
          setStatus("ready");
        }
        const enriched = await cat.searchSkyEnriched(q, SEARCH.limit);
        if (skyQueryRef.current !== q) return;
        setSkyHits(enriched);
        setStatus("ready");
      })
      .catch((err) => {
        console.warn("[m-search] sky catalog failed to load:", err);
        setSkyHits([]);
        setStatus("error");
      });
  };

  const minLen = (m: Mode) => (m === "sky" ? SKY_MIN_QUERY_LEN : SEARCH.minQueryLen);

  const onInput = (value: string, m: Mode = mode) => {
    setQuery(value);
    cancelPending();
    if (value.trim().length < minLen(m)) {
      setHits([]);
      setSkyHits([]);
      setStatus("idle");
      return;
    }
    if (m === "sky") {
      runSkySearch(value);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      const { focusLatDeg, focusLonDeg } = useCameraStore.getState();
      void runSearch((signal) =>
        photonSearch(value.trim(), { latDeg: focusLatDeg, lonDeg: focusLonDeg }, signal),
      );
    }, SEARCH.debounceMs);
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    cancelPending();
    setHits([]);
    setSkyHits([]);
    setStatus("idle");
    if (query.trim().length >= minLen(m)) onInput(query, m);
    if (m === "sky") void loadCatalog(); // warm the chunk before the first keystroke
    inputRef.current?.focus();
  };

  const fly = (hit: GeocodeHit) => {
    useCameraStore.getState().requestFly({
      latDeg: hit.latDeg,
      lonDeg: hit.lonDeg,
      altM: arrivalAltM(hit.spanDeg),
    });
    cancelPending();
    onFly();
  };

  const track = (entry: SkyIndexEntry) => {
    void loadCatalog().then(async (cat) => {
      const target = await cat.targetByIdAsync(entry.id);
      if (!target) return;
      const sky = useSkyStore.getState();
      sky.setTarget(target);
      if (!sky.visible) sky.setVisible(true); // tracking something you can't see helps no one
      // Auto-aim (the LocationFinder discipline): end with the object in frame when it is
      // physically above the horizon at the current eye; below it the camera stays put.
      const cam = useCameraStore.getState();
      const anchor = usePlanStore.getState().anchor;
      const { azDeg, altDeg } = targetAzAlt(
        target,
        sceneTimeMs(),
        anchor?.latDeg ?? cam.focusLatDeg,
        anchor?.lonDeg ?? cam.focusLonDeg,
      );
      aimAtSkyFromSearch(azDeg, altDeg); // never re-aims a map view (owner 2026-08-18)
    });
    cancelPending();
    onTrack();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (mode === "earth" && query.trim().length >= SEARCH.minQueryLen) {
      // Explicit submit → Nominatim (autocomplete there is policy-forbidden; Enter is fine).
      cancelPending();
      void runSearch((signal) => nominatimSearch(query.trim(), signal));
    } else if (mode === "sky" && skyHits.length > 0) {
      track(skyHits[0]);
    }
    e.preventDefault();
  };

  const sky = mode === "sky";
  const rowCount = sky ? skyHits.length : hits.length;

  return (
    <div role="search" aria-label={sky ? "Find an object in the sky" : "Find a place"}>
      <div className="m-search__row">
        <div className="m-mode" role="tablist" aria-label="Search mode">
          <button
            type="button"
            role="tab"
            aria-selected={!sky}
            className={`m-mode__btn${!sky ? " m-mode__btn--on" : ""}`}
            onClick={() => switchMode("earth")}
          >
            EARTH
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sky}
            className={`m-mode__btn${sky ? " m-mode__btn--on" : ""}`}
            onClick={() => switchMode("sky")}
          >
            SKY
          </button>
        </div>
        <input
          ref={inputRef}
          className="m-input"
          type="text"
          placeholder={sky ? "m31 · vega · ngc 7000 · orion" : "city · street · sight"}
          value={query}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          aria-label={sky ? "Search for a sky object" : "Search for a place"}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {/* MY PLACES (owner 2026-08-15): the idle SEARCH sheet doubles as the saved-views list —
          typing swaps it for results, clearing brings it back. Jump closes the sheet (onFly). */}
      {query.trim().length === 0 && <MobilePlaces onJump={onFly} />}
      <div role="listbox" aria-label="Search results">
        {status === "loading" && <div className="m-status-line">SEARCHING…</div>}
        {status === "error" && <div className="m-status-line">SEARCH UNAVAILABLE — TRY AGAIN</div>}
        {status === "ready" && rowCount === 0 && (
          <div className="m-status-line">
            {sky
              ? "NO MATCHES — TRY A CATALOG ID (M31, NGC 224) OR A NAME"
              : "NO MATCHES — PRESS ENTER FOR A DEEPER SEARCH"}
          </div>
        )}
        {sky
          ? skyHits.map((h) => (
              <button key={h.id} type="button" role="option" className="m-hit" onClick={() => track(h)}>
                <span className="m-hit__name">
                  {kindGlyph(h.kind)} {h.name}
                </span>
                <span className="m-hit__detail">{h.detail}</span>
              </button>
            ))
          : hits.map((h, i) => (
              <button
                key={`${h.latDeg},${h.lonDeg},${i}`}
                type="button"
                role="option"
                className="m-hit"
                onClick={() => fly(h)}
              >
                <span className="m-hit__name">{h.name}</span>
                {h.detail && <span className="m-hit__detail">{h.detail}</span>}
              </button>
            ))}
        <div className="m-credit">
          {sky
            ? "OpenNGC (CC-BY-SA) · IAU WGSN · MPC · JPL · astronomy-engine"
            : "© OpenStreetMap contributors"}
        </div>
      </div>
    </div>
  );
}
