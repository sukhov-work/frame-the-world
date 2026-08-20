import { useFindStore } from "../../store/find";
import { usePlanStore } from "../../store/plan";
import "../../styles/plan-find-toggle.css";
import "../../styles/tips.css";

/**
 * PLAN / FIND IN FRAME segmented toggle (owner 2026-08-15) — the two planning pills leave the
 * floating left column and become ONE switch beside the Plux wordmark: they were already
 * mutually exclusive (opening one closed the other), so two separate buttons carried no state
 * a single toggle can't. The stores keep owning `open`; exclusivity is enforced here at click
 * time (FindPanel keeps its reactive belt for any other opener). The window itself is
 * PlanPanel / FindPanel — both mount at the SAME left-column spot under the SAME "planfind"
 * drag/resize session key, so to the user it is one window whose content switches.
 */
export default function PlanFindToggle() {
  const planOpen = usePlanStore((s) => s.open);
  const findOpen = useFindStore((s) => s.open);

  const pick = (which: "plan" | "find") => {
    const plan = usePlanStore.getState();
    const find = useFindStore.getState();
    if (which === "plan") {
      find.setOpen(false);
      plan.setOpen(!planOpen);
    } else {
      plan.setOpen(false);
      find.setOpen(!findOpen);
    }
  };

  return (
    <div className="pft" role="group" aria-label="Planning window">
      <button
        type="button"
        className={`pft-seg tip${planOpen ? " is-on" : ""}`}
        aria-pressed={planOpen}
        data-tip="WHEN IS THE LIGHT RIGHT — HERE."
        data-tip-pos="down"
        onClick={() => pick("plan")}
      >
        ☀ PLAN
      </button>
      <button
        type="button"
        className={`pft-seg tip${findOpen ? " is-on" : ""}`}
        aria-pressed={findOpen}
        data-tip="WHICH COMING DAYS PUT THE SUN / MOON / CORE IN THIS FRAME."
        data-tip-pos="down"
        onClick={() => pick("find")}
      >
        ⌖ FIND<span className="pft-ext">&nbsp;IN&nbsp;FRAME</span>
      </button>
    </div>
  );
}
