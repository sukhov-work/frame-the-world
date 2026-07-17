import { useEffect, useState } from "react";
import { useMemberStore } from "../../store/member";
import { useUploadStore } from "../../store/upload";
import { usePinsStore } from "../../store/pins";
import { useCameraStore } from "../../store/camera";
import { useTimeStore } from "../../store/time";
import { deletePhotoRecord } from "../../lib/save/uploadMedia";
import type { PhotoListItem } from "../../lib/wix/pinRecords";
import type { PlaceListItem } from "../../lib/wix/placeRecords";
import { focalFromVerticalFov } from "../../lib/decode/sensors";
import { formatFocal } from "../../lib/format/readout";
import { formatPrice } from "../../lib/market/listing";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/my-pins.css";
import "../../styles/tips.css";

/**
 * MY PINS — the rudimentary owner list in the top nav (Phase 5.1), a stand-in until the
 * proper gallery phase. Members only (the Photos collection is admin-read; the list comes
 * from the elevated GET /api/photos, owner-filtered). Fetches fresh on every open.
 *
 * PLACES tab (owner 2026-07-15): saved photo-less first-person viewpoints — the `#f=` pose
 * + optional pinned scene time. A row click jumps straight into that FPV (requestFpvJump →
 * the orchestrator re-enters the temp-pin FPV through the exact share-link path).
 *
 * SALES tab (Phase 6.9): the member's for-sale listings + a PAID-order count each — the first
 * client consumer of GET /api/listings. Display-only rows (the pin itself opens from MY PINS).
 */

/** One GET /api/listings row (the endpoint's response shape). */
interface SalesRow {
  photoId: string;
  title: string;
  previewUrl: string | null;
  productId: string;
  priceAmount: number | null;
  currency: string | null;
  soldCount: number;
}
export default function MyPins() {
  const memberPhase = useMemberStore((s) => s.phase);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pins" | "places" | "sales">("pins");
  const [photos, setPhotos] = useState<PhotoListItem[] | null>(null);
  const [places, setPlaces] = useState<PlaceListItem[] | null>(null);
  const [sales, setSales] = useState<SalesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const drag = usePanelDrag("my-pins");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setArmedDeleteId(null);
    let stale = false;
    if (tab === "pins") {
      setPhotos(null);
      fetch("/api/photos")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => {
          if (!stale) setPhotos(j.photos ?? []);
        })
        .catch((e) => {
          if (!stale) setError(e instanceof Error ? e.message : String(e));
        });
    } else if (tab === "places") {
      setPlaces(null);
      fetch("/api/places")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => {
          if (!stale) setPlaces(j.places ?? []);
        })
        .catch((e) => {
          if (!stale) setError(e instanceof Error ? e.message : String(e));
        });
    } else {
      setSales(null);
      fetch("/api/listings")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => {
          if (!stale) setSales(j.listings ?? []);
        })
        .catch((e) => {
          if (!stale) setError(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      stale = true;
    };
  }, [open, tab]);

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
  // owner's own record carries the EXACT location + full pose; ownPhotoId unlocks the
  // UPDATE / RE-PLACE / DELETE actions in the panel (Phase 5.5 S3).
  const openPin = (p: PhotoListItem) => {
    if (p.lat === null || p.lon === null) return; // nothing to place without a location
    useUploadStore.getState().openSavedPin({
      ...p,
      pinId: p.id,
      lat: p.lat,
      lon: p.lon,
      ownPhotoId: p.id,
    });
    setOpen(false);
  };

  // Jump into a saved place: reproduce the saved scene time (pinned instant or live wall
  // clock), then post the one-shot FPV pose request — the orchestrator flies there and
  // stands in the exact viewpoint (same reconstruction as a shared #f= link).
  const jumpToPlace = (p: PlaceListItem) => {
    const t = useTimeStore.getState();
    if (p.timeMs != null) t.setTime(p.timeMs);
    else t.goLive();
    useCameraStore.getState().requestFpvJump({
      latDeg: p.latDeg,
      lonDeg: p.lonDeg,
      eyeM: p.eyeM,
      headingDeg: p.headingDeg,
      pitchDeg: p.pitchDeg,
      fovDeg: p.fovDeg,
    });
    setOpen(false);
  };

  // Row delete: first press arms ("SURE?"), second deletes — records + media server-side,
  // then the local list and the globe pins refresh (the carried re-query follow-up).
  const deletePin = async (p: PhotoListItem) => {
    if (armedDeleteId !== p.id) {
      setArmedDeleteId(p.id);
      return;
    }
    setArmedDeleteId(null);
    setDeletingId(p.id);
    try {
      await deletePhotoRecord(p.id);
      setPhotos((list) => (list ? list.filter((x) => x.id !== p.id) : list));
      usePinsStore.getState().refresh();
      const u = useUploadStore.getState();
      if (u.ownPhotoId === p.id) u.clear(); // the deleted pin was in view
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const deletePlace = async (p: PlaceListItem) => {
    if (armedDeleteId !== p.id) {
      setArmedDeleteId(p.id);
      return;
    }
    setArmedDeleteId(null);
    setDeletingId(p.id);
    try {
      const r = await fetch(`/api/places?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlaces((list) => (list ? list.filter((x) => x.id !== p.id) : list));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const placeLabel = (p: PlaceListItem): string => {
    const focal = formatFocal(focalFromVerticalFov(p.fovDeg));
    const coords = `${p.latDeg.toFixed(4)}°, ${p.lonDeg.toFixed(4)}°`;
    return p.timeMs != null ? `${coords} · ${focal} · ⏱` : `${coords} · ${focal}`;
  };

  const count = tab === "pins" ? photos?.length : tab === "places" ? places?.length : sales?.length;

  return (
    <span className="mp">
      <button
        className="mp-toggle tip"
        aria-expanded={open}
        data-tip="YOUR SAVED PINS & PLACES — CLICK ONE TO FLY THERE."
        data-tip-pos="down"
        onClick={() => setOpen((o) => !o)}
      >
        My pins
      </button>
      {open && (
        <div className="mp-panel" style={drag.style} role="dialog" aria-label="My pins and places">
          <DragGrip drag={drag} label="Move the pins list" tipPos="left" />
          {/* Scrolling lives on this INNER wrapper: an overflow root would clip the drag
              grip's outside-the-window tab (owner 2026-07-14 uniform handles). */}
          <div className="mp-scroll">
          <header className="mp-head">
            <div className="mp-tabs" role="tablist">
              <button
                className={`mp-tab${tab === "pins" ? " is-active" : ""}`}
                role="tab"
                aria-selected={tab === "pins"}
                onClick={() => setTab("pins")}
              >
                MY PINS{tab === "pins" && count != null ? ` · ${count}` : ""}
              </button>
              <button
                className={`mp-tab${tab === "places" ? " is-active" : ""}`}
                role="tab"
                aria-selected={tab === "places"}
                onClick={() => setTab("places")}
              >
                PLACES{tab === "places" && count != null ? ` · ${count}` : ""}
              </button>
              <button
                className={`mp-tab${tab === "sales" ? " is-active" : ""}`}
                role="tab"
                aria-selected={tab === "sales"}
                onClick={() => setTab("sales")}
              >
                SALES{tab === "sales" && count != null ? ` · ${count}` : ""}
              </button>
            </div>
            <button className="mp-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          {error && <div className="mp-note mp-note--warn">COULD NOT LOAD — {error.toUpperCase()}</div>}
          {!error && tab === "pins" && photos === null && <div className="mp-note">LOADING…</div>}
          {!error && tab === "pins" && photos?.length === 0 && (
            <div className="mp-note">No pins yet — upload a photo and SAVE PIN.</div>
          )}
          {!error && tab === "pins" && photos && photos.length > 0 && (
            <ul className="mp-list">
              {photos.map((p) => (
                <li key={p.id} className="mp-row">
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
                    <span className="mp-badges">
                      {p.productId && (
                        <span className="mp-badge mp-badge--sale" title="Listed for sale">
                          {formatPrice(p.priceAmount, p.currency)}
                        </span>
                      )}
                      <span className={`mp-badge${p.isPublic ? " is-public" : ""}`}>
                        {p.isPublic ? (p.publicPrecision ?? "public").toUpperCase() : "PRIVATE"}
                      </span>
                    </span>
                  </button>
                  <button
                    className={`mp-del${armedDeleteId === p.id ? " is-armed" : ""}`}
                    title={armedDeleteId === p.id ? "Press again to delete" : "Delete this pin"}
                    aria-label={`Delete pin ${p.title}`}
                    disabled={deletingId !== null}
                    onClick={() => void deletePin(p)}
                  >
                    {deletingId === p.id ? "…" : armedDeleteId === p.id ? "SURE?" : "✕"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!error && tab === "sales" && sales === null && <div className="mp-note">LOADING…</div>}
          {!error && tab === "sales" && sales?.length === 0 && (
            <div className="mp-note">
              Nothing for sale yet — open one of your public pins and SELL THIS PHOTO.
            </div>
          )}
          {!error && tab === "sales" && sales && sales.length > 0 && (
            <ul className="mp-list">
              {sales.map((s) => (
                <li key={s.photoId} className="mp-row">
                  <div className="mp-item mp-item--static">
                    {s.previewUrl ? (
                      <img className="mp-thumb" src={s.previewUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="mp-thumb mp-thumb--empty" aria-hidden="true" />
                    )}
                    <span className="mp-meta">
                      <span className="mp-name" title={s.title}>
                        {s.title}
                      </span>
                      <span className="mp-sub">
                        {s.soldCount > 0 ? `${s.soldCount} SOLD · PAYOUT VIA SITE OWNER` : "NO SALES YET"}
                      </span>
                    </span>
                    <span className="mp-badges">
                      <span className="mp-badge mp-badge--sale">
                        {formatPrice(s.priceAmount, s.currency)}
                      </span>
                      {s.soldCount > 0 && (
                        <span className="mp-badge is-public" title="Paid orders">
                          {s.soldCount} SOLD
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!error && tab === "places" && places === null && <div className="mp-note">LOADING…</div>}
          {!error && tab === "places" && places?.length === 0 && (
            <div className="mp-note">
              No places yet — stand in a view (double-click the ground, LOOK FROM HERE) and
              SAVE PLACE on the camera deck.
            </div>
          )}
          {!error && tab === "places" && places && places.length > 0 && (
            <ul className="mp-list">
              {places.map((p) => (
                <li key={p.id} className="mp-row">
                  <button
                    className="mp-item"
                    title="Jump into this viewpoint"
                    onClick={() => jumpToPlace(p)}
                  >
                    <span className="mp-thumb mp-thumb--place" aria-hidden="true">◎</span>
                    <span className="mp-meta">
                      <span className="mp-name" title={p.title}>
                        {p.title}
                      </span>
                      <span className="mp-sub">{placeLabel(p)}</span>
                    </span>
                  </button>
                  <button
                    className={`mp-del${armedDeleteId === p.id ? " is-armed" : ""}`}
                    title={armedDeleteId === p.id ? "Press again to delete" : "Delete this place"}
                    aria-label={`Delete place ${p.title}`}
                    disabled={deletingId !== null}
                    onClick={() => void deletePlace(p)}
                  >
                    {deletingId === p.id ? "…" : armedDeleteId === p.id ? "SURE?" : "✕"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      )}
    </span>
  );
}
