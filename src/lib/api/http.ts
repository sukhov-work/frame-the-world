/**
 * Thin shared helpers for the app-defined API routes (B10). Kept minimal per C1 (heavy compute is
 * client-side): `json` is the uniform JSON Response builder every route repeated verbatim, and
 * `requireMember` centralizes the `getCurrentMember` try/catch each write route duplicated
 * (anonymous visitors reject it → the SDK throws, so treat any failure as "no member").
 *
 * Server-only — imported exclusively by `src/pages/api/*` (it pulls in @wix/members, which must
 * never reach the client bundle).
 */
import { members } from "@wix/members";

/** Uniform JSON Response. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The calling member (with `_id` narrowed to a definite string), or null for anonymous visitors.
 * `full: true` pulls profile fieldsets — nickname / loginEmail feed the denormalized authorName;
 * the id-only default is enough for the simple "is anyone signed in" gates.
 */
export async function requireMember(opts: { full?: boolean } = {}) {
  try {
    const { member } = await members.getCurrentMember(
      opts.full ? { fieldsets: ["FULL"] } : undefined,
    );
    // Spread to pin _id as a definite string — the SDK types it optional.
    return member?._id ? { ...member, _id: member._id } : null;
  } catch {
    return null; // anonymous visitors reject getCurrentMember (exact error shape varies)
  }
}
