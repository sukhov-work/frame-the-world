import { useEffect, useState } from "react";
import { loginUrl, memberLabel, returnHereUrl, signOut, useMemberStore } from "../../store/member";
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
  // The SIGN OUT row's own state: the JSON round-trip takes a beat, and a failed one must say so
  // instead of leaving a member staring at a menu that did nothing.
  const [out, setOut] = useState<"idle" | "busy" | "error">("idle");

  const cls = `m-chip m-chip--account${menuItem ? " m-menu__item" : ""}`;
  const role = menuItem ? "menuitem" : undefined;
  if (phase === "member") {
    return (
      <>
        <button type="button" className={cls} role={role} aria-label="My places" onClick={onOpenPlaces}>
          ◎ {memberLabel(member)}
          {menuItem && <span className="m-menu__hint">MY PLACES</span>}
        </button>
        {menuItem && (
          // audit #4 F4 (2026-09-17): /m had no sign-out — a phone member had to leave for the
          // desktop shell. Owner bug 2026-09-18: the first cut was a real form POST to the managed
          // logout route, which the live host's CSRF origin check refuses ("Cross-site POST form
          // submissions are forbidden" — `pages/api/signout.ts` has the why). Now the shared
          // `signOut()`: JSON fetch → top-level navigation down the same logout chain.
          <button
            type="button"
            className="m-chip m-menu__item"
            role="menuitem"
            disabled={out === "busy"}
            onClick={() => {
              setOut("busy");
              signOut().catch(() => setOut("error"));
            }}
          >
            {out === "busy" ? "SIGNING OUT…" : out === "error" ? "SIGN OUT — RETRY" : "SIGN OUT"}
            <span className="m-menu__hint">{out === "error" ? "IT DID NOT GO THROUGH" : "THIS DEVICE"}</span>
          </button>
        )}
      </>
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

