// Spike route: falsifies the "app-defined POST routes 403 through the cloud adapter" risk
// reported in the official wix-headless skill (BACK_IN_STOCK.md) before the save flow is
// built on POST endpoints. GET is the control probe.
import type { APIRoute } from "astro";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async () => json({ ok: true, method: "GET" });

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  return json({ ok: true, method: "POST", echo: body });
};
