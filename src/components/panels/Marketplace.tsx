import { useEffect, useState } from "react";
import { useUploadStore } from "../../store/upload";
import type { PublicPin } from "../../store/pins";
import { formatPrice } from "../../lib/market/listing";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/marketplace.css";
import "../../styles/tips.css";

/**
 * MARKETPLACE — the buyer-facing browse panel (Phase 6.9, owner ruling 2026-07-17): a separate,
 * well-defined top-right nav button opening a floating list of ALL for-sale pins. Rows come from
 * the public GET /api/market (PublicPins where productId is set — C6-safe, reduced precision);
 * clicking one flies to the pin exactly like a globe pin click (openSavedPin → placed camera
 * view + detail panel with BUY). Works signed-out — checkout asks for identity later.
 *
 * Also hosts the post-checkout acknowledgment: a completed hosted checkout returns with
 * ?purchased=1 (store/market.ts thankYouPageUrl) → a transient toast, then the param is
 * stripped so a reload/share doesn't re-announce it.
 *
 * Top-level `client:only` island (the S2 containing-block trap: position:fixed panels never sit
 * inside a backdrop-filtered ancestor). The panel body + fetch are gated behind `open`, so the
 * boot cost is one small button (the 2026-07-16 parallel-boot-chunk lesson).
 */
export default function Marketplace() {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<PublicPin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState(false);
  const drag = usePanelDrag("marketplace");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPins(null);
    let stale = false;
    fetch("/api/market")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!stale) setPins(j.pins ?? []);
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

  // Post-checkout acknowledgment (?purchased=1 from the thank-you redirect). Strip the param —
  // keep the #p= pose hash — so the toast fires once, then auto-dismiss.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("purchased") !== "1") return;
    url.searchParams.delete("purchased");
    history.replaceState(null, "", url.toString());
    setPurchased(true);
    const t = setTimeout(() => setPurchased(false), 12_000);
    return () => clearTimeout(t);
  }, []);

  const openPin = (p: PublicPin) => {
    // Same call the globe pin click makes — placed camera view + detail panel (BUY seam armed
    // via the listing fields riding on the PublicPin shape).
    useUploadStore.getState().openSavedPin({ ...p, pinId: p.id });
    setOpen(false);
  };

  return (
    <span className="mk">
      <button
        className="mk-toggle tip"
        aria-expanded={open}
        data-tip="PHOTOS FOR SALE ACROSS THE GLOBE — BUY THE FULL-RES ORIGINAL."
        data-tip-pos="down"
        onClick={() => setOpen((o) => !o)}
      >
        Marketplace
      </button>
      {purchased && (
        <div className="mk-toast" role="status">
          ORDER PLACED ✓ — THE DOWNLOAD LINK ARRIVES BY EMAIL ONCE PAYMENT IS CONFIRMED
        </div>
      )}
      {open && (
        <div className="mk-panel" style={drag.style} role="dialog" aria-label="Marketplace">
          <DragGrip drag={drag} label="Move the marketplace" tipPos="left" />
          {/* Scrolling lives on the INNER wrapper — an overflow root would clip the drag grip's
              outside-the-window tab (the uniform-handles rule, owner 2026-07-14). */}
          <div className="mk-scroll">
            <header className="mk-head">
              <span className="mk-title">FOR SALE{pins ? ` · ${pins.length}` : ""}</span>
              <button className="mk-close" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            {error && <div className="mk-note mk-note--warn">COULD NOT LOAD — {error.toUpperCase()}</div>}
            {!error && pins === null && <div className="mk-note">LOADING…</div>}
            {!error && pins?.length === 0 && (
              <div className="mk-note">Nothing for sale yet — check back soon.</div>
            )}
            {!error && pins && pins.length > 0 && (
              <ul className="mk-list">
                {pins.map((p) => (
                  <li key={p.id} className="mk-row">
                    <button className="mk-item" title="Fly to this pin" onClick={() => openPin(p)}>
                      {p.previewUrl ? (
                        <img className="mk-thumb" src={p.previewUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="mk-thumb mk-thumb--empty" aria-hidden="true" />
                      )}
                      <span className="mk-meta">
                        <span className="mk-name" title={p.title}>
                          {p.title}
                        </span>
                        <span className="mk-sub">{p.authorName ?? "—"}</span>
                      </span>
                      <span className="mk-price">{formatPrice(p.priceAmount, p.currency)}</span>
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
