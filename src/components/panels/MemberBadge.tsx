import { useEffect, useState } from "react";
import { loginUrl, memberLabel, returnHereUrl, signOut, useMemberStore } from "../../store/member";
import { memberHasActivePlan, startPlanUpgrade } from "../../lib/wix/planUpgrade";
import "../../styles/member-badge.css";
import "../../styles/tips.css";

/**
 * Nav member badge (Phase 5) — the "Sign in" slot in the top nav. Anonymous (and while the
 * session is still resolving) it is a plain link to the managed Wix login; signed in it shows
 * the member label + a sign-out button. Sign-out was a real form POST to the managed logout
 * route until 2026-09-18 — the live host's CSRF origin check refuses every form POST (the
 * adapter's `http:` request origin; `pages/api/signout.ts`), so it is the shared `signOut()`
 * now: a JSON fetch, then a top-level navigation down the same logout redirect chain.
 *
 * Phase 6.9 (owner: premium must be OBVIOUSLY buyable): a free member also gets a persistent
 * UPGRADE chip → the Wix-hosted plan checkout (lib/wix/planUpgrade). The plan check runs once
 * per mount in the member's own identity; premium members never see the chip.
 */
export default function MemberBadge() {
  const phase = useMemberStore((s) => s.phase);
  const member = useMemberStore((s) => s.member);
  const refresh = useMemberStore((s) => s.refresh);
  // null = plan state unknown (checking) — render nothing rather than flash the chip.
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (phase !== "member") return;
    let stale = false;
    void memberHasActivePlan().then((v) => {
      if (!stale) setHasPlan(v);
    });
    return () => {
      stale = true;
    };
  }, [phase]);

  const upgrade = async () => {
    if (upgrading) return;
    setUpgrading(true);
    setUpgradeError(null);
    try {
      await startPlanUpgrade(returnHereUrl()); // navigates away on success
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : String(e));
      setUpgrading(false);
    }
  };

  if (phase === "member") {
    return (
      <span className="mb">
        {hasPlan === false && (
          <button
            className="mb-upgrade tip"
            disabled={upgrading}
            data-tip={
              upgradeError
                ? `UPGRADE FAILED — ${upgradeError.toUpperCase()}`
                : `PREMIUM: 1000 PIN SLOTS (FREE HOLDS 100).`
            }
            data-tip-pos="down"
            onClick={() => void upgrade()}
          >
            {upgrading ? "OPENING…" : "UPGRADE"}
          </button>
        )}
        <span className="mb-name" title={member?.loginEmail ?? undefined}>
          {memberLabel(member)}
        </span>
        <button
          type="button"
          className="mb-out"
          disabled={signingOut === "busy"}
          onClick={() => {
            setSigningOut("busy");
            signOut().catch(() => setSigningOut("error"));
          }}
        >
          {signingOut === "busy"
            ? "Signing out…"
            : signingOut === "error"
              ? "Sign out — retry"
              : "Sign out"}
        </button>
      </span>
    );
  }

  return (
    <a
      className="mb-in"
      href={loginUrl("/")}
      // returnTo resolves at CLICK time so the #p= pose hash (mirrored after this render) rides along.
      onClick={(e) => {
        e.preventDefault();
        window.location.href = loginUrl(returnHereUrl());
      }}
    >
      Sign in
    </a>
  );
}
