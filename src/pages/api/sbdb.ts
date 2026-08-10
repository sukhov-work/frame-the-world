import type { APIRoute } from "astro";
import { json } from "../../lib/api/http";

/**
 * GET /api/sbdb — thin pass-through to JPL's Small-Body Database API (ASTRO ENGINE phase A).
 *
 * WHY IT EXISTS: JPL's APIs send NO `Access-Control-Allow-Origin` header (verified 2026-08-03;
 * OPTIONS → 405), so the browser cannot call them directly — while SIMBAD/VizieR do send `*`
 * and stay client-side. This route RELAYS JSON and computes nothing (C1-clean: the client does
 * the propagation with the elements it gets back). First outbound-fetch route in the repo.
 *
 * Contract: `?sstr=<designation>` (e.g. `10P`, `2024 YR4`, `433`) — the one SBDB lookup the
 * astro engine needs (phase B wires it into the SKY search's long-tail fallback). The upstream
 * query is rebuilt from an allowlist, never spliced from the raw query string.
 */

const UPSTREAM = "https://ssd-api.jpl.nasa.gov/sbdb.api";
/** Upstream params a client may set — anything else is dropped. `phys-par` pulls H/G (and the
 *  comet M1/K1) — SBDB omits physical parameters by default (browser-caught 2026-08-10). */
const ALLOWED = new Set(["sstr", "full-prec", "phys-par"]);
const UPSTREAM_TIMEOUT_MS = 8_000;

export const GET: APIRoute = async ({ url }) => {
  const sstr = url.searchParams.get("sstr")?.trim() ?? "";
  if (!sstr || sstr.length > 64) {
    return json({ error: "BAD_REQUEST", message: "pass ?sstr=<small-body designation>" }, 400);
  }
  const upstream = new URL(UPSTREAM);
  for (const [k, v] of url.searchParams) if (ALLOWED.has(k)) upstream.searchParams.set(k, v);

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    // SBDB answers 300 for ambiguous designations (a match LIST) and 404 for no match — both
    // are meaningful JSON for the client, so they relay as 200 payloads with the code inside.
    const body = await res.json().catch(() => null);
    if (body == null) {
      return json({ error: "UPSTREAM_FAILED", message: "sbdb returned non-JSON" }, 502);
    }
    return json({ status: res.status, body });
  } catch (e) {
    console.error("[sbdb:proxy]", e);
    return json({ error: "UPSTREAM_FAILED", message: "sbdb unreachable or timed out" }, 502);
  }
};
