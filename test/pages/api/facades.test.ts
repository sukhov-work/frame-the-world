import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FACADE_PAGE, facadeRecord, parseSaveFacadeBody, type FacadePose } from "../../../src/lib/wix/facadeRecords";

/**
 * T190 (owner ruling 2026-10-22g): the facade WORLD read is PUBLIC — every visitor, signed OUT,
 * streams every member's textures (unmoderated; REMOVED withheld); the row never carries the member
 * id. MINE (`?skip=`), POST, PATCH and DELETE stay owner-gated. The route runs against a recording
 * Wix Data query builder (the `signOut.test.ts` route-test idiom: `elevate` is the identity, the
 * member session a mock).
 */

const chain: string[][] = [];
let rows: Record<string, unknown>[] = [];
let findThrows = false;
const builder = () => {
  const b: Record<string, unknown> = {};
  for (const m of ["hasSome", "eq", "ne", "ascending", "descending", "limit", "skip"]) {
    b[m] = (...a: unknown[]) => {
      chain.push([m, ...a.map((x) => (Array.isArray(x) ? x.join("|") : String(x)))]);
      return b;
    };
  }
  b.find = async () => {
    if (findThrows) throw new Error("boom");
    return { items: rows, hasNext: () => false };
  };
  b.count = async () => 0;
  return b;
};
vi.mock("@wix/data", () => ({ items: { query: () => builder(), get: async () => null } }));
vi.mock("@wix/essentials", () => ({ auth: { elevate: (f: unknown) => f } }));
const getCurrentMember = vi.fn();
vi.mock("@wix/members", () => ({ members: { getCurrentMember: (...a: unknown[]) => getCurrentMember(...a) } }));
vi.mock("@wix/media", () => ({ files: { getFileDescriptor: async () => null, deleteFiles: async () => ({}) } }));

const DISPLAY_ID = "166a86_0f3c6f1a9d2e4b7c8a1d2e3f4a5b6c7d~mv2.jpg";
const URLS = { displayUrl: `https://static.wixstatic.com/media/${DISPLAY_ID}`, thumbUrl: null };
const pose: FacadePose = {
  lat: 48.4647, lon: 35.0462, apexAltM: 112.4, altitudeM: 96, headingDeg: 214, pitchDeg: 4, rollDeg: 0.5,
  focalLengthMm: 6.86, hFovDeg: 69.4, fovEstimated: false, textureWidth: 4032, textureHeight: 3024,
};
const body = { ...pose, title: "a facade", strength: 0.9, ownLight: 0.4, rangeM: 450, originalFileId: "166a86_11112222333344445555666677778888.arw", displayFileId: DISPLAY_ID, thumbFileId: "166a86_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d~mv2.jpg", targetFeatureIds: [], alignment: {}, exifPose: pose };
const storedRow = (id: string, owner: string): Record<string, unknown> => {
  const p = parseSaveFacadeBody(body);
  if ("error" in p) throw new Error(p.error);
  return { ...facadeRecord(p.body, owner, URLS), _id: id, _createdDate: new Date("2026-10-21T10:00:00Z"), _updatedDate: new Date("2026-10-21T10:00:00Z") };
};
const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, json?: unknown) => {
  const route = await import("../../../src/pages/api/facades");
  const request = new Request(`https://www.plux.today${url}`, { method, headers: { "Content-Type": "application/json" }, body: json === undefined ? undefined : JSON.stringify(json) });
  const res = await (route[method] as unknown as (ctx: { request: Request; url: URL }) => Promise<Response>)({ request, url: new URL(request.url) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/facades?cells= — the PUBLIC world read (T190)", () => {
  beforeEach(() => {
    chain.length = 0;
    rows = [];
    findThrows = false;
    getCurrentMember.mockReset();
    getCurrentMember.mockRejectedValue(new Error("anonymous")); // the SDK throws for a visitor
  });

  it("signed OUT: 200 with EVERY member's rows — no member call, no owner filter, REMOVED withheld, the slim row", async () => {
    rows = [storedRow("f1", "member-A"), storedRow("f2", "member-B"), { ...storedRow("f3", "member-C"), moderation: "REMOVED" }];
    const r = await call("GET", "/api/facades?cells=u8vx1,u8vx2");
    expect(r.status).toBe(200);
    expect(getCurrentMember).not.toHaveBeenCalled();
    const ids = (r.json.facades as { id: string }[]).map((f) => f.id);
    expect(ids).toEqual(["f1", "f2", "f3"]); // the REMOVED filter is the QUERY's (`ne`), not a post-filter — the chain proves it
    expect(r.json.complete).toBe(true);
    expect(chain).toEqual([["hasSome", "gh5", "u8vx1|u8vx2"], ["ne", "moderation", "REMOVED"], ["ascending", "_createdDate"], ["limit", String(FACADE_PAGE)]]);
    expect(chain.some((c) => c[0] === "eq" && c[1] === "ownerMemberId")).toBe(false);
    for (const f of r.json.facades as Record<string, unknown>[]) {
      for (const k of ["ownerMemberId", "displayFileId", "thumbFileId", "originalFileId", "geohash9", "gh5", "isPublic", "moderation"]) expect(f).not.toHaveProperty(k);
      expect(f.displayUrl).toBe(URLS.displayUrl);
      expect(f.hFovDeg).toBe(69.4);
    }
  });

  it("signed IN: the same public answer — the member's id never reaches the world query", async () => {
    getCurrentMember.mockResolvedValue({ member: { _id: "member-A" } });
    rows = [storedRow("f1", "member-A"), storedRow("f2", "member-B")];
    const r = await call("GET", "/api/facades?cells=u8vx1");
    expect(r.status).toBe(200);
    expect((r.json.facades as { id: string }[]).map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(chain.some((c) => c[0] === "eq")).toBe(false);
  });

  it("a bad cells list → 400; a query failure → 502 LIST_FAILED", async () => {
    expect((await call("GET", "/api/facades?cells=")).status).toBe(400);
    expect((await call("GET", "/api/facades?cells=ZZ")).status).toBe(400);
    findThrows = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call("GET", "/api/facades?cells=u8vx1");
    expect(r.status).toBe(502);
    expect(r.json.error).toBe("LIST_FAILED");
    err.mockRestore();
  });

  it("MINE (`?skip=` / no cells) stays owner-gated: 401 signed out; the owner filter signed in", async () => {
    const anon = await call("GET", "/api/facades");
    expect(anon.status).toBe(401);
    expect(anon.json.error).toBe("SIGNED_OUT");
    getCurrentMember.mockResolvedValue({ member: { _id: "member-A" } });
    rows = [storedRow("f1", "member-A")];
    const mine = await call("GET", "/api/facades?skip=0");
    expect(mine.status).toBe(200);
    expect(chain).toContainEqual(["eq", "ownerMemberId", "member-A"]);
    expect((mine.json.facades as Record<string, unknown>[])[0]).toMatchObject({ id: "f1", poseSource: "EXIF" });
  });

  it("the writes stay owner-gated: POST / PATCH / DELETE → 401 signed out", async () => {
    expect((await call("POST", "/api/facades", body)).status).toBe(401);
    expect((await call("PATCH", "/api/facades", { facadeId: "f1", title: "x" })).status).toBe(401);
    expect((await call("DELETE", "/api/facades?id=f1")).status).toBe(401);
  });
});

describe("T190 — the source fences", () => {
  const root = join(__dirname, "../../..");
  const read = (f: string) => readFileSync(join(root, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("the route's world branch runs BEFORE the member check and never filters by owner", () => {
    const src = read("src/pages/api/facades.ts");
    const get = src.slice(src.indexOf("export const GET"), src.indexOf("export const POST"));
    const world = get.slice(0, get.indexOf("parseSkip("));
    expect(world).toContain('url.searchParams.get("cells")');
    expect(world).not.toContain("ownerMemberId");
    expect(world.indexOf("auth.elevate(items.query)")).toBeLessThan(world.indexOf("requireMember()"));
    expect(world).toContain('.ne("moderation", "REMOVED")');
    const mine = get.slice(get.indexOf("parseSkip("));
    expect(mine).toContain('.eq("ownerMemberId", member._id)');
  });

  it("the store reads the world with no member gate and keeps it across a sign-out", () => {
    const src = read("src/store/facades.ts");
    const report = src.slice(src.indexOf("reportViewport: ("), src.indexOf("refresh: ("));
    expect(report).not.toContain("isMember()");
    const seam = src.slice(src.indexOf("useMemberStore.subscribe("), src.indexOf("export function _resetFacadesStore"));
    expect(seam).not.toMatch(/world: \[\]/);
    expect(seam).toMatch(/mine: \[\], minePhase: "anonymous", editingId: null/);
  });

  it("the orchestrator asks for the world only where the markers exist (no read amplification on /m)", () => {
    const src = read("src/components/globe/StylizedTiles.ts");
    const i = src.indexOf("useFacadesStore.getState().reportViewport(");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i - 400, i)).toContain("if (facadeMarkers) {");
  });
});
