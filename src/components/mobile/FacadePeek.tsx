import { facadeRowById, useFacadesStore, type FacadePeek as FacadePeekState } from "../../store/facades";
import { useCameraStore } from "../../store/camera";
import { facadePoseLine, type FacadeListItem, type FacadeWorldItem } from "../../lib/wix/facadeRecords";
import "../../styles/mobile/chrome.css";

/**
 * FacadePeek — the /m TAP PEEK on a saved-facade marker (F6, owner 2026-10-22g: "no editing /
 * uploading on mobile, just be able to view on map"). The orchestrator mirrors the tapped row id +
 * the FPV pose at its apex into `useFacadesStore.peek` (`_setPeek`); this row — the TargetPeek's
 * seat, above the time dock — shows the thumb, the title and the pose line, and offers LOOK FROM
 * HERE (`requestFpvJump` at the apex — the T186 entry the desktop's OPEN makes) and ✕. Nothing
 * here edits: no gizmo, no chip, no menu, no MINE (the mobile fence — stores + lib only).
 */
export function FacadePeekView({
  peek,
  item,
  onLook,
  onClose,
}: {
  peek: FacadePeekState | null;
  item: FacadeListItem | FacadeWorldItem | null;
  onLook: () => void;
  onClose: () => void;
}) {
  if (!peek || !item) return null;
  const thumb = item.thumbUrl ?? item.displayUrl;
  return (
    <div className="m-fpeek" role="group" aria-label={`Texture: ${item.title || "untitled"}`} data-facade-peek={item.id}>
      {thumb && <img className="m-fpeek__thumb" src={thumb} alt="" loading="lazy" />}
      <div className="m-fpeek__body">
        <div className="m-fpeek__title">{item.title || "UNTITLED"}</div>
        <div className="m-fpeek__meta">
          {facadePoseLine(item)}
          {item.hFovDeg > 0 ? ` · ${Math.round(item.hFovDeg)}°` : ""}
        </div>
      </div>
      <button type="button" className="m-fpeek__look" data-act="look" onClick={onLook} aria-label="Look from where this photo was taken">
        ◎ LOOK
      </button>
      <button type="button" className="m-fpeek__close" data-act="close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  );
}

export default function FacadePeek() {
  const peek = useFacadesStore((s) => s.peek);
  const world = useFacadesStore((s) => s.world);
  const mine = useFacadesStore((s) => s.mine);
  const closePeek = useFacadesStore((s) => s.closePeek);
  const item = peek ? facadeRowById({ mine, world }, peek.id) : null;
  const onLook = () => {
    if (!peek) return;
    useCameraStore.getState().requestFpvJump(peek.jump);
    closePeek();
  };
  return <FacadePeekView peek={peek} item={item} onLook={onLook} onClose={closePeek} />;
}
