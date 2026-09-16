import { useEffect } from "react";
import { loginUrl, memberLabel, returnHereUrl, useMemberStore } from "../../store/member";
import "../../styles/mobile/chrome.css";

/**
 * Status-strip account chip (owner 2026-08-15 — "/m needs easy login + my places"). Anonymous
 * → SIGN IN via the managed Wix hosted login; returnTo resolves at CLICK time so the mirrored
 * `#f=`/`#p=` pose hash (incl. `&t=` scene time) rides the round trip and the visitor lands
 * back in the exact view they left — the MemberBadge discipline. Signed in → the member label
 * opens MY PLACES (the SEARCH sheet hosts the list while its box is idle). Fence-legal: this
 * consumes store/member only, never the desktop panel (mobileFence.test.ts).
 */
export default function MobileAccount({
  onOpenPlaces,
  menuItem = false,
}: {
  onOpenPlaces: () => void;
  /** Owner 2026-09-16: rendered as a row of the PLUX logo menu (a full-width item with a hint)
   *  instead of a strip chip. The member refresh and the returnTo idiom are unchanged. */
  menuItem?: boolean;
}) {
  const phase = useMemberStore((s) => s.phase);
  const member = useMemberStore((s) => s.member);
  const refresh = useMemberStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cls = `m-chip m-chip--account${menuItem ? " m-menu__item" : ""}`;
  const role = menuItem ? "menuitem" : undefined;
  if (phase === "member") {
    return (
      <button type="button" className={cls} role={role} aria-label="My places" onClick={onOpenPlaces}>
        ◎ {memberLabel(member)}
        {menuItem && <span className="m-menu__hint">MY PLACES</span>}
      </button>
    );
  }
  return (
    <a
      className={cls}
      role={role}
      href={loginUrl("/m")}
      // returnTo resolves at CLICK time so the pose hash (mirrored after render) rides along.
      onClick={(e) => {
        e.preventDefault();
        window.location.href = loginUrl(returnHereUrl());
      }}
    >
      SIGN IN
      {menuItem && <span className="m-menu__hint">SAVE &amp; SYNC PLACES</span>}
    </a>
  );
}

