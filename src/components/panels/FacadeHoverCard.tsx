import { facadeRowById, useFacadesStore, type FacadeHover } from "../../store/facades";
import { facadePoseLine, type FacadeListItem, type FacadeWorldItem } from "../../lib/wix/facadeRecords";
import "../../styles/facade-markers.css";

/**
 * FacadeHoverCard — the COMPACT preview floating above a hovered saved-facade marker (T183, owner
 * ask 2026-10-22): the thumb, the title, the pose line (+ the H-FOV). The PinHoverCard twin, cut
 * smaller. The orchestrator mirrors the hovered marker id + its apex's projected screen point into
 * `useFacadesStore.hover` at low cadence (`_syncHover`); the card is pointer-events-none chrome —
 * presses still belong to the globe (the right-click / long-press opens FacadeMarkerMenu).
 * Top-level island, position fixed — never inside a backdrop-filtered ancestor (the .ct-pinpop rule).
 */
export function FacadeHoverCardView({
  hover,
  item,
}: {
  hover: FacadeHover | null;
  item: FacadeListItem | FacadeWorldItem | null;
}) {
  if (!hover || !item) return null;
  const thumb = item.thumbUrl ?? item.displayUrl;
  return (
    <div
      className="fhover"
      style={{ left: hover.screen.x, top: hover.screen.y }}
      aria-hidden="true"
      data-facade-hover={item.id}
    >
      {thumb && <img className="fhover__thumb" src={thumb} alt="" loading="lazy" />}
      <div className="fhover__body">
        <div className="fhover__title">{item.title || "UNTITLED"}</div>
        <div className="fhover__meta">{facadePoseLine(item)}</div>
        {item.hFovDeg > 0 && <div className="fhover__meta">H-FOV {Math.round(item.hFovDeg)}°</div>}
      </div>
    </div>
  );
}

export default function FacadeHoverCard() {
  const hover = useFacadesStore((s) => s.hover);
  // Subscribing to the lists keeps the card honest when the row changes (an UPDATE) or goes (REMOVE).
  const mine = useFacadesStore((s) => s.mine);
  const world = useFacadesStore((s) => s.world);
  const item = hover ? facadeRowById({ mine, world }, hover.id) : null;
  return <FacadeHoverCardView hover={hover} item={item} />;
}
