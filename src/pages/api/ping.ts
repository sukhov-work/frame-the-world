// Release canary / health gate — the smallest app-defined route. Originally a spike that falsified the
// "app-defined POST routes 403 through the cloud adapter" fear; RETAINED as the pre-release gate: after
// `wix release`, `GET/POST /api/ping` must both 200 on the live URL before the save flow is trusted in
// production (see DECISIONS § Traps & Gotchas / Wix). GET is the control probe. Do NOT delete.
import type { APIRoute } from "astro";
import { json } from "../../lib/api/http";

export const GET: APIRoute = async () => json({ ok: true, method: "GET" });

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  return json({ ok: true, method: "POST", echo: body });
};
