import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSON_WRITE_HEADERS, jsonWriteInit } from "../../../src/lib/api/dataFetch";
import { deleteListing, deleteModelRecord, deletePhotoRecord } from "../../../src/lib/save/uploadMedia";

/**
 * EVERY `/api` WRITE CARRIES A JSON CONTENT TYPE — body or not (owner bug 2026-09-19: "couldn't
 * delete some user model").
 *
 * Astro's `checkOrigin` middleware passes a non-safe request only when it has a NON-form content
 * type OR `Origin === url.origin`; the live host's adapter gives Astro an `http:` URL, so the
 * origins never match (the 2026-09-18 sign-out root cause). A body-less `fetch(url, { method:
 * "DELETE" })` has NO content type → `403 Cross-site DELETE form submissions are forbidden` before
 * the route runs. Measured live 2026-09-19: bare DELETE /api/models → 403; with the header → the
 * route answers. `wix dev` never runs the check, so only this fence — not a harness — can hold it.
 */

afterEach(() => vi.unstubAllGlobals());

describe("jsonWriteInit", () => {
  it("a body-less write still declares application/json and sends no body", () => {
    const init = jsonWriteInit("DELETE");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect("body" in init).toBe(false);
    expect(Object.isFrozen(JSON_WRITE_HEADERS)).toBe(true);
    (init.headers as Record<string, string>)["X-Probe"] = "1"; // a fresh object per call — never the frozen one
  });

  it("a write with a body serializes it", () => {
    expect(jsonWriteInit("PATCH", { id: "a", tU: 300 })).toEqual({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"id":"a","tU":300}',
    });
  });
});

describe("the delete wires — what actually leaves the browser", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = () => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ deleted: true, mediaDeleted: true, unlisted: true, quota: { used: 0, limit: 1 } }), { status: 200 });
      }),
    );
  };

  it("models, photos and listings: DELETE + Content-Type: application/json, no body", async () => {
    stub();
    await deleteModelRecord("m 1");
    await deletePhotoRecord("p1");
    await deleteListing("p1");
    expect(calls.map((c) => c.url)).toEqual(["/api/models?id=m%201", "/api/photos?id=p1", "/api/listings?photoId=p1"]);
    for (const c of calls) {
      expect(c.init.method).toBe("DELETE");
      expect(new Headers(c.init.headers).get("content-type")).toBe("application/json");
      expect(c.init.body).toBeUndefined();
    }
  });
});

describe("the fence — no client write to /api goes out without a JSON content type", () => {
  const SRC = join(__dirname, "../../../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (relative(SRC, p) === join("pages", "api")) continue; // the server side of the wire
        walk(p);
      } else if (/\.(ts|tsx|astro)$/.test(name)) files.push(p);
    }
  };
  walk(SRC);

  it("the probe can match (zero-result validation): the scan sees the known write sites", () => {
    const hits = files.filter((f) => /fetch\(\s*[`"']\/api\//.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it("every `fetch(\"/api/…\", { method: <write> … })` names Content-Type or goes through jsonWriteInit", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const re = /fetch\(\s*[`"']\/api\//g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        // The call's own text: up to the statement's end (a generous, bounded window).
        const call = text.slice(m.index, m.index + 600).split(/;\s*\n/)[0];
        const write = /method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(call);
        if (write && !/Content-Type/i.test(call)) offenders.push(`${relative(SRC, f)} @${m.index}: ${call.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no bare `{ method: \"DELETE\" }` init anywhere in the client", () => {
    const offenders = files.filter((f) => /\{\s*method:\s*["']DELETE["']\s*\}/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
