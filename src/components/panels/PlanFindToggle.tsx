import { useBestSpotStore } from "../../store/bestSpot";
import { useFindStore } from "../../store/find";
import { usePlanStore } from "../../store/plan";
import "../../styles/plan-find-toggle.css";
import "../../styles/tips.css";

/**
 * PLAN / FIND IN FRAME / BEST SPOT segmented toggle (owner 2026-08-15; third segment BESTSPOT S5,
 * `SPEC_V2 §6.9`) — the planning pills left the floating left column and became ONE switch beside
 * the Plux wordmark: they were already mutually exclusive (opening one closed the others), so
 * separate buttons carried no state a single toggle can't. The three stores keep owning their own
 * `open`; exclusivity is enforced here at click time (FindPanel keeps its reactive belt for any
 * other opener). The window itself is PlanPanel / FindPanel / BestSpotPanel — all three mount at
 * the SAME left-column spot under the SAME "planfind" drag/resize session key, so to the user it is
 * one window whose content switches.
 */

export type PlanFindSeg = "plan" | "find" | "bestSpot";

/**
 * The mutual-exclusion rule, lifted out of the component so it is testable without a DOM (vitest
 * here has neither jsdom nor testing-library): the picked segment TOGGLES, the other two close
 * unconditionally. Written as "close all three, then toggle the one" rather than as a per-arm
 * pairing — with three faces the pairwise form is six statements and one of them is always the one
 * somebody forgets, which is how two windows end up open on the same spot.
 *
 * Reads `open` through `getState()` rather than through the render's subscription so the rule holds
 * for any caller, not just for a click that happened to re-render first.
 */
export function pickPlanFindSeg(which: PlanFindSeg): void {
  const plan = usePlanStore.getState();
  const find = useFindStore.getState();
  const bestSpot = useBestSpotStore.getState();
  const wasOpen = { plan: plan.open, find: find.open, bestSpot: bestSpot.open }[which];
  plan.setOpen(false);
  find.setOpen(false);
  bestSpot.setOpen(false);
  if (which === "plan") plan.setOpen(!wasOpen);
  else if (which === "find") find.setOpen(!wasOpen);
  else bestSpot.setOpen(!wasOpen);
}

export default function PlanFindToggle() {
  const planOpen = usePlanStore((s) => s.open);
  const findOpen = useFindStore((s) => s.open);
  const bestSpotOpen = useBestSpotStore((s) => s.open);

  return (
    <div className="pft" role="group" aria-label="Planning window">
      <button
        type="button"
        className={`pft-seg tip${planOpen ? " is-on" : ""}`}
        aria-pressed={planOpen}
        data-tip="WHEN IS THE LIGHT RIGHT — HERE."
        data-tip-pos="down"
        onClick={() => pickPlanFindSeg("plan")}
      >
        ☀ PLAN
      </button>
      <button
        type="button"
        className={`pft-seg tip${findOpen ? " is-on" : ""}`}
        aria-pressed={findOpen}
        data-tip="WHICH COMING DAYS PUT THE SUN / MOON / CORE IN THIS FRAME."
        data-tip-pos="down"
        onClick={() => pickPlanFindSeg("find")}
      >
        ⌖ FIND<span className="pft-ext">&nbsp;IN&nbsp;FRAME</span>
      </button>
      <button
        type="button"
        className={`pft-seg tip${bestSpotOpen ? " is-on" : ""}`}
        aria-pressed={bestSpotOpen}
        data-tip="WHERE TO STAND FOR THIS SUNRISE / SUNSET / MOONRISE / MOONSET."
        data-tip-pos="down"
        onClick={() => pickPlanFindSeg("bestSpot")}
      >
        ◎ BEST SPOT
      </button>
    </div>
  );
}
