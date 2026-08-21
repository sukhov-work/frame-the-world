/**
 * LocationFinder (Phase 5.5 S1; SKY mode added 2026-08-03, ASTRO ENGINE phase A) — one search
 * window, two worlds:
 *
 *   EARTH — "fly me there": city / street / sight / zip. Free-provider contract
 *   (lib/geo/geocode): Photon autocompletes while typing (debounced, biased to the camera's view
 *   focus); Enter without a highlighted row re-asks Nominatim (better global ranking + zips —
 *   allowed on explicit submit only). Picking a result posts a one-shot FlyRequest into
 *   store/camera; the globe orchestrator turns it into the same cinematic flight a placed photo
 *   gets. Results are OSM data → attribution line in the list.
 *
 *   SKY — "track that object" (phase B, 2026-08-10): planets · IAU-named stars · Messier + the
 *   full OpenNGC (common names fuzzy, NGC/IC ids via the pattern branch) · 88 constellations ·
 *   ~950 MPC comets · bright asteroids — all against `lib/sky/catalog` (LAZY — the first SKY
 *   keystroke pays the chunk, the boot never does). A local miss falls through, DEBOUNCED, to
 *   SIMBAD TAP (fixed objects, client-direct) or `/api/sbdb` (small bodies) — both localStorage
 *   cached. Picking a result swaps the tracked target in store/sky: the marker moves, the
 *   TARGET panel re-badges, windows re-scan.
 *
 * Keyboard: ↑/↓ move, Enter picks (or submits on EARTH), Escape closes then clears.
 */

import { useEffect, useRef, useState } from "react";
import { arrivalAltM, nominatimSearch, photonSearch, type GeocodeHit } from "../../lib/geo/geocode";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { aimAtSkyFromSearch } from "../../store/skyAim";
import { sceneTimeMs } from "../../store/time";
import { targetAzAlt } from "../../lib/ephemeris/targets";
import {
  kindGlyph,
  looksLikeSmallBody,
  normalizeSky,
  type SkyIndexEntry,
} from "../../lib/sky/searchIndex";
import { SEARCH } from "../globe/tuning";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/location-finder.css";
import "../../styles/tips.css";

type Status = "idle" | "loading" | "ready" | "error";
type Mode = "earth" | "sky";

/** Catalog ids like "m1" match from 2 chars; place names keep the fair-use 3. */
const SKY_MIN_QUERY_LEN = 2;

// The catalog chunk loads once per session, on the first SKY interaction (lazy by contract —
// see lib/sky/catalog.ts; a static import here would drag it into the boot chunk).
let catalogPromise: Promise<typeof import("../../lib/sky/catalog")> | null = null;
const loadCatalog = () => (catalogPromise ??= import("../../lib/sky/catalog"));

export default function LocationFinder() {
  // SKY is the default mode (owner 2026-08-19, batch item 6) — the catalog stays lazy: it
  // warms on first input focus, not at mount (this island mounts on every page load).
  const [mode, setMode] = useState<Mode>("sky");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [skyHits, setSkyHits] = useState<SkyIndexEntry[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skyQueryRef = useRef(""); // latest SKY query — stale async results are dropped
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = usePanelDrag("search");

  const cancelPending = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    skyQueryRef.current = "";
  };

  const clearResults = () => {
    setHits([]);
    setSkyHits([]);
    setActive(-1);
    setStatus("idle");
    setOpen(false);
  };

  const runSearch = async (fn: (signal: AbortSignal) => Promise<GeocodeHit[]>) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStatus("loading");
    try {
      const result = await fn(ctl.signal);
      if (ctl.signal.aborted) return;
      setHits(result);
      setActive(result.length > 0 ? 0 : -1);
      setStatus("ready");
      setOpen(true);
    } catch (err) {
      if (ctl.signal.aborted) return; // superseded by a newer query — not an error
      console.warn("[search] geocoding failed:", err);
      setHits([]);
      setStatus("error");
      setOpen(true);
    }
  };

  const runSkySearch = (value: string) => {
    const q = value.trim();
    skyQueryRef.current = q;
    setStatus("loading");
    loadCatalog()
      .then(async (cat) => {
        if (skyQueryRef.current !== q) return; // superseded while the chunk loaded
        // Instant pass over the baked index; the OpenNGC binary joins on its first fetch.
        const instant = cat.searchSkyCatalog(q, SEARCH.limit);
        if (instant.length > 0) {
          setSkyHits(instant);
          setActive(0);
          setStatus("ready");
          setOpen(true);
        }
        const enriched = await cat.searchSkyEnriched(q, SEARCH.limit);
        if (skyQueryRef.current !== q) return;
        setSkyHits(enriched);
        setActive(enriched.length > 0 ? 0 : -1);
        setStatus("ready");
        setOpen(true);
        // Long tail (phase B): nothing local → one DEBOUNCED remote lookup. SIMBAD for fixed
        // objects (CORS *, courtesy-limited — never per keystroke), /api/sbdb for anything
        // that reads as a small-body designation. A designation-shaped query ALSO goes out
        // when the local rows are only near-misses ("2024 YR4" must not drown under the
        // C/2024 R4 typo family — browser-caught 2026-08-10).
        const exactLocal = enriched.some((e) => e.keys.includes(normalizeSky(q)));
        if (
          q.length >= 3 &&
          (enriched.length === 0 || (looksLikeSmallBody(q) && !exactLocal))
        )
          scheduleLongTail(q, enriched);
      })
      .catch((err) => {
        console.warn("[search] sky catalog failed to load:", err);
        setSkyHits([]);
        setStatus("error");
        setOpen(true);
      });
  };

  const scheduleLongTail = (q: string, baseRows: SkyIndexEntry[]) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      if (skyQueryRef.current !== q) return;
      setStatus("loading");
      try {
        const [{ resolveSbdb, sbdbIndexEntry }, { resolveSimbad, simbadIndexEntry }] =
          await Promise.all([import("../../lib/sky/sbdb"), import("../../lib/sky/simbad")]);
        const remote: SkyIndexEntry[] = [];
        if (looksLikeSmallBody(q)) {
          const hit = await resolveSbdb(q);
          if (hit) remote.push(sbdbIndexEntry(hit));
        } else {
          const o = await resolveSimbad(q);
          if (o) remote.push(simbadIndexEntry(o));
        }
        if (skyQueryRef.current !== q) return;
        // The resolved object leads; the local near-misses stay below it as suggestions.
        const ids = new Set(remote.map((e) => e.id));
        const rows = [...remote, ...baseRows.filter((e) => !ids.has(e.id))].slice(0, SEARCH.limit);
        setSkyHits(rows);
        setActive(rows.length > 0 ? 0 : -1);
        setStatus("ready");
        setOpen(true);
      } catch (err) {
        if (skyQueryRef.current !== q) return;
        console.warn("[search] sky long-tail lookup failed:", err);
        setStatus("ready"); // the local rows stand — a dead network is not an error state
        setOpen(true);
      }
    }, SEARCH.skyLongTailDebounceMs);
  };

  const minLen = (m: Mode) => (m === "sky" ? SKY_MIN_QUERY_LEN : SEARCH.minQueryLen);

  const onInput = (value: string, m: Mode = mode) => {
    setQuery(value);
    cancelPending();
    if (value.trim().length < minLen(m)) {
      clearResults();
      return;
    }
    if (m === "sky") {
      // Local index — no fair-use debounce needed; the only async is the one-time chunk load.
      runSkySearch(value);
      return;
    }
    // Debounced autocomplete (Photon) — fair-use requires the debounce; bias = camera focus.
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
    setActive(-1);
    setStatus("idle");
    setOpen(false);
    if (query.trim().length >= minLen(m)) onInput(query, m);
    if (m === "sky") void loadCatalog(); // warm the chunk even before the first keystroke
  };

  const fly = (hit: GeocodeHit) => {
    useCameraStore.getState().requestFly({
      latDeg: hit.latDeg,
      lonDeg: hit.lonDeg,
      altM: arrivalAltM(hit.spanDeg),
    });
    cancelPending();
    setOpen(false);
    setActive(-1);
    rootRef.current?.querySelector("input")?.blur();
  };

  const track = (entry: SkyIndexEntry) => {
    void loadCatalog().then(async (cat) => {
      const target = await cat.targetByIdAsync(entry.id);
      if (!target) return;
      const sky = useSkyStore.getState();
      sky.setTarget(target);
      if (!sky.visible) sky.setVisible(true); // tracking something you can't see helps no one
      sky.setOpen(true); // unfold the TARGET panel — it now fronts the picked object
      // Auto-aim (phase C, owner feedback #3): search-and-track should END with the object in
      // the frame when that is physically reasonable — i.e. it is above the horizon at the
      // current eye (the panel's anchor, else the view focus). Below it the camera stays put:
      // aiming at the ground helps no one; the panel's NEXT SESSIONS is the tool there.
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
    setOpen(false);
    setActive(-1);
    rootRef.current?.querySelector("input")?.blur();
  };

  const rowCount = mode === "sky" ? skyHits.length : hits.length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && rowCount > 0) {
      setActive((a) => (a + 1) % rowCount);
    } else if (e.key === "ArrowUp" && rowCount > 0) {
      setActive((a) => (a - 1 + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      if (mode === "sky") {
        if (open && active >= 0 && skyHits[active]) track(skyHits[active]);
      } else if (open && active >= 0 && hits[active]) {
        fly(hits[active]);
      } else if (query.trim().length >= SEARCH.minQueryLen) {
        // Explicit submit → Nominatim (autocomplete there is policy-forbidden; Enter is fine).
        cancelPending();
        void runSearch((signal) => nominatimSearch(query.trim(), signal));
      }
    } else if (e.key === "Escape") {
      if (open) {
        setOpen(false);
      } else {
        setQuery("");
        setHits([]);
        setSkyHits([]);
        setStatus("idle");
      }
      cancelPending();
    } else {
      return;
    }
    e.preventDefault();
  };

  // Click-away closes the dropdown; unmount aborts any in-flight request.
  useEffect(() => {
    const onDocDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      cancelPending();
    };
  }, []);

  const sky = mode === "sky";
  return (
    <div
      className="lf"
      ref={rootRef}
      style={drag.style}
      role="search"
      aria-label={sky ? "Find an object in the sky" : "Find a location on the globe"}
    >
      <DragGrip drag={drag} label="Move the search" tipPos="down" />
      <div className="lf-row">
        <div className="lf-mode" role="tablist" aria-label="Search mode">
          <button
            type="button"
            role="tab"
            aria-selected={!sky}
            className={`lf-mode__btn${!sky ? " lf-mode__btn--on" : ""}`}
            onClick={() => switchMode("earth")}
          >
            EARTH
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sky}
            className={`lf-mode__btn${sky ? " lf-mode__btn--on" : ""}`}
            onClick={() => switchMode("sky")}
          >
            SKY
          </button>
        </div>
        {/* Inputs render no ::after — the wrapper span anchors the hover tip (tips.css). */}
        <span
          className="tip tip-wrap lf-tipwrap"
          data-tip={
            sky
              ? "SEARCH THE SKY — PLANETS · STARS · NGC/IC · COMETS · ASTEROIDS · CONSTELLATIONS. ENTER TRACKS IT."
              : "SEARCH ANY PLACE — ENTER FLIES THERE. RESULTS AS YOU TYPE."
          }
          data-tip-pos="down"
        >
          <input
            className="lf-input"
            type="text"
            placeholder={
              sky
                ? "TYPE TO SEARCH — e.g. m31 · moon · orion · ngc 7000"
                : "TYPE TO SEARCH — e.g. city · street · sight · zip"
            }
            value={query}
            spellCheck={false}
            autoComplete="off"
            aria-label={sky ? "Search for a sky object" : "Search for a place"}
            aria-expanded={open}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              void loadCatalog(); // warm before the first SKY keystroke (sky-default)
              if (rowCount > 0) setOpen(true);
            }}
          />
        </span>
      </div>
      {open && (
        <div className="lf-drop" role="listbox" aria-label="Search results">
          {status === "loading" && <div className="lf-note">SEARCHING…</div>}
          {status === "error" && <div className="lf-note">SEARCH UNAVAILABLE — TRY AGAIN</div>}
          {status === "ready" && rowCount === 0 && (
            <div className="lf-note">
              {sky
                ? "NO MATCHES — TRY A CATALOG ID (M31, NGC 224) OR A NAME"
                : "NO MATCHES — PRESS ENTER FOR A DEEPER SEARCH"}
            </div>
          )}
          {sky
            ? skyHits.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`lf-hit${i === active ? " lf-hit--active" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => track(h)}
                >
                  <span className="lf-hit-name">
                    <span className="lf-hit-glyph">{kindGlyph(h.kind)}</span> {h.name}
                  </span>
                  <span className="lf-hit-detail">{h.detail}</span>
                </button>
              ))
            : hits.map((h, i) => (
                <button
                  key={`${h.latDeg},${h.lonDeg},${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`lf-hit${i === active ? " lf-hit--active" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => fly(h)}
                >
                  <span className="lf-hit-name">{h.name}</span>
                  {h.detail && <span className="lf-hit-detail">{h.detail}</span>}
                </button>
              ))}
          <div className="lf-credit">
            {sky
              ? "OpenNGC (CC-BY-SA) · IAU WGSN · MPC · JPL · SIMBAD/CDS · astronomy-engine"
              : "© OpenStreetMap contributors"}
          </div>
        </div>
      )}
    </div>
  );
}
