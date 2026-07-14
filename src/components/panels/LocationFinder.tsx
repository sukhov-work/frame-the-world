/**
 * LocationFinder (Phase 5.5 S1) — "fly me there" search: city / street / sight / zip.
 *
 * Free-provider contract (lib/geo/geocode): Photon autocompletes while typing (debounced,
 * biased to the camera's view focus); Enter without a highlighted row re-asks Nominatim
 * (better global ranking + zips — allowed on explicit submit only). Picking a result posts a
 * one-shot FlyRequest into store/camera; the globe orchestrator turns it into the same
 * cinematic flight a placed photo gets. Results are OSM data → attribution line in the list.
 *
 * Keyboard: ↑/↓ move, Enter picks (or submits), Escape closes then clears.
 */

import { useEffect, useRef, useState } from "react";
import { arrivalAltM, nominatimSearch, photonSearch, type GeocodeHit } from "../../lib/geo/geocode";
import { useCameraStore } from "../../store/camera";
import { SEARCH } from "../globe/tuning";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/location-finder.css";
import "../../styles/tips.css";

type Status = "idle" | "loading" | "ready" | "error";

export default function LocationFinder() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = usePanelDrag("search");

  const cancelPending = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
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

  // Debounced autocomplete (Photon) — fair-use requires the debounce; bias = camera focus.
  const onInput = (value: string) => {
    setQuery(value);
    cancelPending();
    if (value.trim().length < SEARCH.minQueryLen) {
      setHits([]);
      setActive(-1);
      setStatus("idle");
      setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      const { focusLatDeg, focusLonDeg } = useCameraStore.getState();
      void runSearch((signal) =>
        photonSearch(value.trim(), { latDeg: focusLatDeg, lonDeg: focusLonDeg }, signal),
      );
    }, SEARCH.debounceMs);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length > 0) {
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length > 0) {
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      if (open && active >= 0 && hits[active]) {
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

  return (
    <div className="lf" ref={rootRef} style={drag.style} role="search" aria-label="Find a location on the globe">
      <DragGrip drag={drag} label="Move the location search" tipPos="down" />
      {/* Inputs render no ::after — the wrapper span anchors the hover tip (tips.css). */}
      <span
        className="tip tip-wrap"
        data-tip="SEARCH ANY PLACE — ENTER FLIES THERE. RESULTS AS YOU TYPE."
        data-tip-pos="down"
      >
        <input
          className="lf-input"
          type="text"
          placeholder="FIND A PLACE — city · street · sight · zip"
          value={query}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search for a place"
          aria-expanded={open}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => hits.length > 0 && setOpen(true)}
        />
      </span>
      {open && (
        <div className="lf-drop" role="listbox" aria-label="Search results">
          {status === "loading" && <div className="lf-note">SEARCHING…</div>}
          {status === "error" && <div className="lf-note">SEARCH UNAVAILABLE — TRY AGAIN</div>}
          {status === "ready" && hits.length === 0 && (
            <div className="lf-note">NO MATCHES — PRESS ENTER FOR A DEEPER SEARCH</div>
          )}
          {hits.map((h, i) => (
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
          <div className="lf-credit">© OpenStreetMap contributors</div>
        </div>
      )}
    </div>
  );
}
