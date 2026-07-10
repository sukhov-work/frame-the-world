import { useEffect, useState } from "react";
import { useMemberStore } from "../../store/member";
import { useUploadStore } from "../../store/upload";
import type { PhotoListItem } from "../../lib/wix/pinRecords";
import "../../styles/my-pins.css";

/**
 * MY PINS — the rudimentary owner list in the top nav (Phase 5.1), a stand-in until the
 * proper gallery phase. Members only (the Photos collection is admin-read; the list comes
 * from the elevated GET /api/photos, owner-filtered). Fetches fresh on every open.
 */
export default function MyPins() {
  const memberPhase = useMemberStore((s) => s.phase);
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhotos(null);
    setError(null);
    let stale = false;
    fetch("/api/photos")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!stale) setPhotos(j.photos ?? []);
      })
      .catch((e) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (memberPhase !== "member") return null;

  const captureLabel = (p: PhotoListItem): string => {
    const stamp = p.capturedAt ?? p.createdAt;
    return stamp ? stamp.slice(0, 16).replace("T", " · ") : "";
  };

  // Re-open a saved pin as the placed camera view (frustum + detail panel + flight). The
  // owner's own record carries the EXACT location + full pose.
  const openPin = (p: PhotoListItem) => {
    if (p.lat === null || p.lon === null) return; // nothing to place without a location
    useUploadStore.getState().openSavedPin({ ...p, pinId: p.id, lat: p.lat, lon: p.lon });
    setOpen(false);
  };

  return (
    <span className="mp">
      <button className="mp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        My pins
      </button>
      {open && (
        <div className="mp-panel" role="dialog" aria-label="My uploaded photos">
          <header className="mp-head">
            <span className="mp-title">
              MY PINS{photos ? ` · ${photos.length}` : ""}
            </span>
            <button className="mp-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          {error && <div className="mp-note mp-note--warn">COULD NOT LOAD — {error.toUpperCase()}</div>}
          {!error && photos === null && <div className="mp-note">LOADING…</div>}
          {!error && photos?.length === 0 && (
            <div className="mp-note">No pins yet — upload a photo and SAVE PIN.</div>
          )}
          {!error && photos && photos.length > 0 && (
            <ul className="mp-list">
              {photos.map((p) => (
                <li key={p.id}>
                  <button
                    className="mp-item"
                    title="Open on the globe"
                    onClick={() => openPin(p)}
                  >
                    {p.previewUrl ? (
                      <img className="mp-thumb" src={p.previewUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="mp-thumb mp-thumb--empty" aria-hidden="true" />
                    )}
                    <span className="mp-meta">
                      <span className="mp-name" title={p.title}>
                        {p.title}
                      </span>
                      <span className="mp-sub">{captureLabel(p)}</span>
                    </span>
                    <span className={`mp-badge${p.isPublic ? " is-public" : ""}`}>
                      {p.isPublic ? (p.publicPrecision ?? "public").toUpperCase() : "PRIVATE"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
