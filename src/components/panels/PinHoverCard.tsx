import { usePinsStore } from "../../store/pins";
import { formatCaptureDateTime } from "../../lib/format/readout";
import { formatPrice } from "../../lib/market/listing";
import "../../styles/pin-hover.css";

/**
 * PinHoverCard — the small details card floating above a hovered public pin (Phase 5.5 S4,
 * §Item 6): title · authorName · capture date, with the previewUrl thumb (the carried pin
 * hover/preview follow-up lands here). A for-sale pin adds the price chip (Phase 6.9 buyer
 * discovery — the first marker a buyer meets before the detail panel's BUY). The orchestrator
 * mirrors the hovered pin + its head's projected screen position into the pins store at low
 * cadence; the card is pointer-events-none chrome — the CLICK still belongs to the globe (it
 * opens the pin as the placed camera view).
 * Same containing-block discipline as .ct-pinpop: fixed, never inside a filtered card.
 */
export default function PinHoverCard() {
  const pin = usePinsStore((s) => s.hoverPin);
  const screen = usePinsStore((s) => s.hoverScreen);
  const count = usePinsStore((s) => s.hoverCount);
  if (!pin || !screen) return null;
  return (
    <div className="pinhover" style={{ left: screen.x, top: screen.y }} aria-hidden="true">
      {pin.previewUrl && <img className="pinhover__thumb" src={pin.previewUrl} alt="" />}
      <div className="pinhover__body">
        {count > 1 ? (
          // A collapsed cluster (far range): name the count; the click dives to split it.
          <>
            <div className="pinhover__title">{count} PHOTOS HERE</div>
            <div className="pinhover__meta">CLICK TO ZOOM IN</div>
          </>
        ) : (
          <>
            <div className="pinhover__title">{pin.title}</div>
            <div className="pinhover__meta">
              {pin.authorName ?? "—"}
              {pin.capturedAt ? ` · ${formatCaptureDateTime(pin.capturedAt)}` : ""}
            </div>
            {pin.productId && pin.priceAmount != null && (
              <div className="pinhover__price">
                FOR SALE · {formatPrice(pin.priceAmount, pin.currency)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
