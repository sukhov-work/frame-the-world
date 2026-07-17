/**
 * Premium plan purchase (Phase 6.9) — the owner ruled premium must be OBVIOUSLY buyable: the
 * quota-hit save error and the nav badge both funnel here. Client-side in the member's own
 * identity (never elevated), mirroring the marketplace buy flow in store/market.ts:
 * resolve the public plan → `createRedirectSession({ paidPlansCheckout })` → Wix-hosted checkout.
 * `preferences.maintainIdentity` defaults true, so the resulting plan order belongs to the
 * signed-in member — exactly what the server-side `hasActivePlan()` gate then sees as ACTIVE.
 * (Flow verified from @wix/auto_sdk_redirects_redirects typings + the create-redirect-session
 * doc, 2026-07-17 — paidPlansCheckout needs only { planId }; no pre-created checkout, unlike ecom.)
 */

/** Pick the plan the UPGRADE affordance sells: the primary public plan, else the first. */
export function pickUpgradePlan<T extends { primary?: boolean | null }>(plans: T[]): T | null {
  if (plans.length === 0) return null;
  return plans.find((p) => p.primary === true) ?? plans[0];
}

/**
 * Resolve the purchasable plan id via the ambient SDK. Public plans are visitor-readable
 * (PRICING_PLANS.READ_PUBLIC_PLANS) — the same no-elevate pattern as the buy flow's
 * createCheckout. queryPublicPlans is the API the paid-plans redirect doc itself points at.
 */
export async function fetchUpgradePlanId(): Promise<string | null> {
  const { plans } = await import("@wix/pricing-plans");
  const res = await plans.queryPublicPlans().find();
  const plan = pickUpgradePlan(res.items ?? []);
  return plan?._id ?? null;
}

/** True when the CALLING member holds any ACTIVE pricing-plan order (client twin of the
 *  endpoint gate in /api/photos — READ_OWN_ORDERS, member identity). Errors read as free. */
export async function memberHasActivePlan(): Promise<boolean> {
  try {
    const { orders } = await import("@wix/pricing-plans");
    const res = await orders.memberListOrders({ orderStatuses: ["ACTIVE"] });
    return (res.orders ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Send the signed-in member to the Wix-hosted plan checkout; returns to `returnTo` after. */
export async function startPlanUpgrade(returnTo: string): Promise<void> {
  const planId = await fetchUpgradePlanId();
  if (!planId) throw new Error("no public plan is configured on the site");
  const { redirects } = await import("@wix/redirects");
  // The redirects API rejects RELATIVE callback URLs ("INVALID URL FORMAT for postFlowUrl,
  // value /" — hit live 2026-07-17): returnHereUrl() hands back a path+hash (fine for the
  // managed login route), so absolutize against the current origin here.
  const postFlowUrl = new URL(returnTo, window.location.origin).toString();
  const { redirectSession } = await redirects.createRedirectSession({
    paidPlansCheckout: { planId },
    callbacks: { postFlowUrl },
  });
  const fullUrl = redirectSession?.fullUrl;
  if (!fullUrl) throw new Error("no redirect url from Wix");
  window.location.href = fullUrl;
}
