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
export default function MobileAccount({ onOpenPlaces }: { onOpenPlaces: () => void }) {
  const phase = useMemberStore((s) => s.phase);
  const member = useMemberStore((s) => s.member);
  const refresh = useMemberStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (phase === "member") {
    return (
      <button
        type="button"
        className="m-chip m-chip--account"
        aria-label="My places"
        onClick={onOpenPlaces}
      >
        ◎ {memberLabel(member)}
      </button>
    );
  }
  return (
    <a
      className="m-chip m-chip--account"
      href={loginUrl("/m")}
      // returnTo resolves at CLICK time so the pose hash (mirrored after render) rides along.
      onClick={(e) => {
        e.preventDefault();
        window.location.href = loginUrl(returnHereUrl());
      }}
    >
      SIGN IN
    </a>
  );
}
