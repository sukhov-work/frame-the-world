import { useEffect } from "react";
import { loginUrl, memberLabel, useMemberStore } from "../../store/member";
import "../../styles/member-badge.css";

/**
 * Nav member badge (Phase 5) — the "Sign in" slot in the top nav. Anonymous (and while the
 * session is still resolving) it is a plain link to the managed Wix login; signed in it shows
 * the member label + a sign-out button (a real form POST so the browser follows the logout
 * redirect chain natively).
 */
export default function MemberBadge() {
  const phase = useMemberStore((s) => s.phase);
  const member = useMemberStore((s) => s.member);
  const refresh = useMemberStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (phase === "member") {
    return (
      <span className="mb">
        <span className="mb-name" title={member?.loginEmail ?? undefined}>
          {memberLabel(member)}
        </span>
        <form method="post" action="/api/auth/logout" className="mb-form">
          <button type="submit" className="mb-out">
            Sign out
          </button>
        </form>
      </span>
    );
  }

  const returnTo = typeof window !== "undefined" ? window.location.pathname : "/";
  return (
    <a className="mb-in" href={loginUrl(returnTo)}>
      Sign in
    </a>
  );
}
