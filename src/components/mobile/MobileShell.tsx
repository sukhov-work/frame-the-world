/**
 * MobileShell — the /m chrome (MOBILE_PLAN §3; M1 = the planning loop). The safe-area status
 * strip (M0) + the bottom chrome column (target peek · twilight-banded time dock · tab bar) +
 * the SCENE action chips + the PLAN / SEARCH / TARGET bottom sheets.
 *
 * Discipline (MOBILE_PLAN §2): this shell consumes stores + `lib/**` ONLY — it never imports
 * desktop panels, and desktop never imports from `components/mobile/**` (the two-shell drift
 * guard, fenced by test/components/mobileFence.test.ts). Heavy sky/catalog modules stay
 * dynamic-import-only (lazyContract.test.ts walks all of src/). Sheets render as siblings of
 * the fixed chrome with the backdrop-filter on the sheet surface only (the S2
 * containing-block rule carries to mobile).
 */

import { useState } from "react";
import { useSkyStore } from "../../store/sky";
import { useCameraStore } from "../../store/camera";
import MobileTimeDock from "./MobileTimeDock";
import TabBar, { type MobileTab } from "./TabBar";
import Sheet from "./Sheet";
import MobileAccount from "./MobileAccount";
import MobileSearch from "./MobileSearch";
import PlanSheet from "./PlanSheet";
import FindSheet from "./FindSheet";
import GuideSheet from "./GuideSheet";
import TargetSheet from "./TargetSheet";
import TargetPeek from "./TargetPeek";
import SceneActions from "./SceneActions";
import FpvControls from "./FpvControls";
import { AimJoystick } from "../controls/Joystick";
import "../../styles/mobile/chrome.css";

type SheetId = "plan" | "find" | "search" | "target" | "guide" | null;

export default function MobileShell() {
  const [sheet, setSheet] = useState<SheetId>(null);
  const target = useSkyStore((s) => s.target);
  // FPV touch instruments (M2): tempFpv flips instantly on LOOK FROM HERE (joystick usable
  // from the first frame); the fpvHud mirror covers any FPV kind and lingers a beat on exit.
  const tempFpv = useCameraStore((s) => s.tempFpv);
  const fpvOn = useCameraStore((s) => s.fpvHud !== null) || tempFpv;

  const activeTab: MobileTab =
    sheet === "plan" || sheet === "find" || sheet === "search" ? sheet : "scene";
  const onTab = (t: MobileTab) => setSheet(t === "scene" ? null : t);

  return (
    <>
      <div className="m-status">
        <span className="m-title">
          <img className="m-title__mark" src="/logo/plux-mark.png" alt="" width="96" height="96" />
          Plux
        </span>
        <span className="m-status__right">
          {/* owner 2026-08-15: login + MY PLACES one tap from the strip (list = SEARCH sheet) */}
          <MobileAccount onOpenPlaces={() => setSheet("search")} />
          {/* Scene-time readout moved into the bottom dock (owner batch #4 item 12). */}
          {/* Guide track G1 (owner 2026-08-15): the same guideContent both shells render. */}
          <button className="m-chip" onClick={() => setSheet("guide")}>
            GUIDE
          </button>
          {/* ?d=1 persists the desktop preference — without it the index auto-detect
              (owner 2026-08-15c) would bounce a phone straight back to /m. Batch #5 item 6:
              the pose hash resolves at CLICK time (the MobileAccount returnTo idiom) so the
              desktop boots at this exact view — it honors #p=/#f= as-is, no transform. */}
          <a
            className="m-chip"
            href="/?d=1"
            onClick={(e) => {
              if (!window.location.hash) return; // plain boot — keep the no-JS href semantics
              e.preventDefault();
              window.location.href = "/?d=1" + window.location.hash;
            }}
          >
            DESKTOP
          </a>
        </span>
      </div>
      <SceneActions onOpenPlaces={() => setSheet("search")} />
      {fpvOn && <FpvControls />}
      {/* AIM joystick (owner batch #4 item 11 → batch #6 item 4): steers the planned shot
          (heading + focal cone) on the 2D/3D map surface AND, in FPV, the live camera — one
          instance, seated just above the WALK stick while it exists (the minimap-corner
          instance is desktop-only now; body.mw-open's z-24 rung keeps both sticks over the
          fullscreen map, so the aim stick survives the /m "minimap mode" too). */}
      <AimJoystick variant={fpvOn ? "fpv" : "map"} />
      <div className="m-bottom">
        <TargetPeek onOpen={() => setSheet("target")} />
        <MobileTimeDock />
        <TabBar active={activeTab} onSelect={onTab} />
      </div>
      {sheet === "plan" && (
        <Sheet title="LIGHT PLANNER" onClose={() => setSheet(null)}>
          <PlanSheet />
        </Sheet>
      )}
      {sheet === "search" && (
        <Sheet title="SEARCH" full onClose={() => setSheet(null)}>
          <MobileSearch onFly={() => setSheet(null)} onTrack={() => setSheet("target")} />
        </Sheet>
      )}
      {sheet === "target" && (
        <Sheet title={target.name.toUpperCase()} onClose={() => setSheet(null)}>
          <TargetSheet onClose={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet === "guide" && (
        <Sheet title="GUIDE" full onClose={() => setSheet(null)}>
          <GuideSheet />
        </Sheet>
      )}
      {/* ALWAYS mounted (owner 2026-08-15c): the FIND scan + ghost mirror live in its hooks —
          collapsing the sheet must NOT clear the in-frame standings (the Pixel bug). */}
      <FindSheet open={sheet === "find"} onClose={() => setSheet(null)} />
    </>
  );
}
