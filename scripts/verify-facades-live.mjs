// LIVE verification of the facade-photo PERSISTENCE flow (PHOTO PROJECTION F2) and its RESIDENCY
// read (F3) against a DEPLOYED site — the live site by default. API-level, with the test member's
// session cookie (the verify-live-deletes recipe); NO `window.__*` DEV seams (a production build has
// none). Why it exists: `auth.elevate` reads answer WDE0027 under `wix dev` (platform-side, 2026-10),
// so the persistence half can only be seen working on the live host.
//
//   0  GET /api/ping → 200 (the canary — nothing else runs without it)
//   1  signed out: GET / POST / DELETE /api/facades → 401
//   2  the member session (TEST_MEMBER_* / WIX_CLIENT_ID from .env.local — never printed)
//   3  POST /api/facades without displayFileId → 400 naming the field
//   4  upload the fixture twice (display + thumb): POST /api/upload-url kind "facade" → PUT ?filename=
//   5  POST /api/facades (409 FILE_NOT_READY retried) → { facadeId, facade } · wixstatic displayUrl ·
//      poseSource EXIF · PRIVATE
//   6  GET /api/facades (MY FACADES) lists it
//   7  GET /api/facades?cells=<gh5 of the pose> lists it (C6-slim row) · a far cell does not
//   8  PATCH lon + 0.0002 / title → the new lon · poseSource MANUAL · GET reflects it
//   9  (optional, FTW_LIVE_DOM=1 + a CDP Chrome on FTW_CDP_PORT, default 9333) the deployed UI:
//      MENU → MY CONTENT → TEXTURES row → OPEN → the saved panel (UPDATE + DELETE) → screenshot
//  10  DELETE (JSON content type) → { deleted: true } · again → 404 · GET no longer lists it
//
// Usage: node scripts/verify-facades-live.mjs
//   env FTW_SITE_URL (default https://www.plux.today) · FTW_LIVE_DOM=1 · FTW_CDP_PORT (9333)
// CLEANUP: every row created is DELETEd — leg 10, else the finally, else (a throw / Ctrl-C) a
// synchronous curl from the prepended crash handlers. Leftover "live verify facade*" rows of the
// member (an earlier crashed run) are removed in the finally too. Uploaded media of a save that
// never produced a row cannot be removed from here (no media-delete endpoint) — they are reported.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const APP = (process.env.FTW_SITE_URL || "https://www.plux.today").replace(/\/$/, "");
const DOM = process.env.FTW_LIVE_DOM === "1";
const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const SHOTS = "verify-shots/facades-live";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const TITLE = "live verify facade";
const TITLE2 = "live verify facade 2";
const PROBE_TITLE_RE = /^live verify facade( 2)?$/;
const POSE = {
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 87.55,
  altitudeM: null,
  headingDeg: 25,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69.3903,
  fovEstimated: false,
  textureWidth: 1600,
  textureHeight: 1200,
};
console.log(`target ${APP}${DOM ? ` · DOM leg on :${PORT}` : ""}`);

// --- the geohash (src/lib/geo/geohash.ts encodeGeohash, copied — scripts are plain .mjs) ---------
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function encodeGeohash(lat, lon, precision) {
  let idx = 0, bit = 0, evenBit = true, hash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx *= 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx *= 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}
const GH5 = encodeGeohash(POSE.lat, POSE.lon, 5);
const FAR_GH5 = encodeGeohash(-33.8688, 151.2093, 5); // Sydney — a cell the probe row is not in

// --- the wire, timed --------------------------------------------------------------------------
let cookieVal = null;
const timings = [];
/** fetch APP+path; JSON content type on every write (the jsonWriteInit rule — a bare DELETE 403s live). */
async function api(method, path, { body, auth = true } = {}) {
  const headers = { Origin: APP };
  if (method !== "GET") headers["Content-Type"] = "application/json";
  if (auth && cookieVal) headers.Cookie = `wixSession=${cookieVal}`;
  const t0 = Date.now();
  const res = await fetch(APP + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const ms = Date.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const line = `${method} ${path.split("?")[0]}${path.includes("?") ? "?…" : ""}${auth && cookieVal ? "" : " (signed out)"} → ${res.status} · ${ms} ms`;
  timings.push(line);
  console.log(`      ${line}`);
  return { status: res.status, json, text: text.slice(0, 200), ms };
}

// --- the member session (the verify-live-deletes / verify-modelupload recipe) ----------------------
async function mintMember() {
  const env = readFileSync(".env.local", "utf-8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const clientId = get("WIX_CLIENT_ID");
  const email = get("TEST_MEMBER_EMAIL");
  const password = get("TEST_MEMBER_PASSWORD");
  if (!clientId || !email || !password) throw new Error("WIX_CLIENT_ID / TEST_MEMBER_* missing from .env.local");
  const client = createClient({ auth: OAuthStrategy({ clientId }) });
  const login = await client.auth.login({ email, password });
  if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
  const REDIRECT = `${APP}/api/auth/callback`;
  const oauthData = client.auth.generateOAuthData(REDIRECT, APP + "/");
  const authorizeUrl =
    `${APP}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
    `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
    `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
  const authRes = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = authRes.headers.get("location");
  if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
  const u = new URL(loc);
  const tokens = await client.auth.getMemberTokens(u.searchParams.get("code"), u.searchParams.get("state"), oauthData);
  cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens }));
  return tokens.refreshToken.role;
}

// --- CLEANUP of the created row ------------------------------------------------------------------
let createdId = null;
let cleanupNote = "no row created";
const orphanFiles = [];
/** SYNCHRONOUS delete over curl — the only kind that completes inside a crash handler before
 *  verify-cdp-cleanup's finishVerify exits. JSON content type: the live origin check 403s a bare DELETE. */
const syncDeleteCreated = (why) => {
  if (!createdId || !cookieVal) return;
  const r = spawnSync(
    "curl",
    ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "DELETE",
      "-H", `Cookie: wixSession=${cookieVal}`, "-H", "Content-Type: application/json", "-H", `Origin: ${APP}`,
      `${APP}/api/facades?id=${encodeURIComponent(createdId)}`],
    { timeout: 20_000, encoding: "utf8" },
  );
  const code = (r.stdout ?? "").trim();
  console.error(`cleanup (${why}): DELETE ${createdId} → ${code || r.error?.message || "no answer"}`);
  if (code === "200" || code === "404") createdId = null;
};
// PREPENDED so they run before the cleanup module's own handlers (which exit once the targets close).
process.prependListener("uncaughtException", () => syncDeleteCreated("uncaughtException"));
process.prependListener("unhandledRejection", () => syncDeleteCreated("unhandledRejection"));
process.on("SIGINT", () => {
  syncDeleteCreated("SIGINT");
  void finishVerify(130);
});

// --- the leg runner ------------------------------------------------------------------------------
const results = [];
let aborted = null;
const runLeg = async (id, name, fn, { needs = () => null } = {}) => {
  const why = aborted ?? needs();
  if (why) {
    results.push({ id, name, pass: false, detail: `not run — ${why}` });
    console.log(`FAIL [${id}] ${name} — not run (${why})`);
    return null;
  }
  console.log(`…    [${id}] ${name}`);
  try {
    const r = await fn();
    results.push({ id, name, ...r });
    console.log(`${r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL"} [${id}] ${name}${r.detail ? ` — ${r.detail}` : ""}`);
    return r;
  } catch (e) {
    results.push({ id, name, pass: false, detail: `threw: ${e?.message ?? e}` });
    console.log(`FAIL [${id}] ${name} — threw: ${e?.message ?? e}`);
    return { pass: false };
  }
};
const fmt = (fails, ok) => (fails.length ? fails.join(" · ") : ok);
/** T188 — the facade chip's rendered state: rect, computed visibility, what the point at its centre hits. */
const CHIP_PROBE = `(() => { const c = document.querySelector("[data-facade-chip]"); if (!c) return { present: false };
  const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
  // The chip ROOT annotates (pointer-events none — the buttons opt back in), so the hit test aims at
  // the MOVE button's centre: the element there must be that button (or inside it).
  const b = c.querySelector('.bec-op[data-op="move"]') ?? c; const br = b.getBoundingClientRect();
  const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  const covered = !!top && !b.contains(top);
  const path = (el) => { const out = []; for (let e = el; e && e !== document.body && out.length < 4; e = e.parentElement) out.push(e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "")); return out.join(" < "); };
  const ops = [...c.querySelectorAll(".bec-op")].map((b) => b.dataset.op + (b.getAttribute("aria-selected") === "true" ? "*" : ""));
  return { present: true, rect: [r.left, r.top, r.width, r.height].map(Math.round), vw: innerWidth, vh: innerHeight, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, covered, over: covered ? path(top) : null, ops }; })()`;
const near = (a, b, eps) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
/** Poll a predicate (the Wix Data list read can lag the write). */
const poll = async (fn, tries = 10, everyMs = 1000) => {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last.ok) return last;
    await sleep(everyMs);
  }
  return last;
};
const listMine = async () => (await api("GET", "/api/facades")).json?.facades ?? null;

const jpeg = readFileSync(FIXTURE);
const files = { display: null, thumb: null };
/** The save body (the buildSaveFacadeBody shape) for the fixture at POSE. */
const saveBody = (displayFileId, thumbFileId) => ({
  ...POSE,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  targetFeatureIds: [],
  alignment: {},
  title: TITLE,
  capturedAt: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  fileName: "facade-pattern.jpg",
  fileSizeBytes: jpeg.byteLength,
  originalFileId: null,
  ...(displayFileId === undefined ? {} : { displayFileId }),
  thumbFileId,
  exifPose: { ...POSE },
});

try {
  // ═══ 0 · THE CANARY ═══════════════════════════════════════════════════════════════════════════
  const canary = await runLeg(0, "GET /api/ping answers 200 (the canary)", async () => {
    const r = await api("GET", "/api/ping", { auth: false });
    return { pass: r.status === 200 && r.json?.ok === true, detail: `${r.status} ${r.text}` };
  });
  if (!canary?.pass) aborted = "the /api/ping canary failed";

  // ═══ 1 · SIGNED OUT ═══════════════════════════════════════════════════════════════════════════
  await runLeg(1, "signed out: GET / POST / DELETE /api/facades → 401", async () => {
    const fails = [];
    const g = await api("GET", "/api/facades", { auth: false });
    const p = await api("POST", "/api/facades", { auth: false, body: saveBody("probe_display_id~mv2.jpg", null) });
    const d = await api("DELETE", "/api/facades?id=plux-probe-nonexistent", { auth: false });
    for (const [k, r] of [["GET", g], ["POST", p], ["DELETE", d]])
      if (r.status !== 401 || r.json?.error !== "SIGNED_OUT") fails.push(`${k} → ${r.status} ${r.text}`);
    return { pass: fails.length === 0, detail: fmt(fails, "401 SIGNED_OUT ×3") };
  });

  // ═══ 2 · THE MEMBER ═══════════════════════════════════════════════════════════════════════════
  const member = await runLeg(2, "the member session is minted", async () => {
    const role = await mintMember();
    return { pass: typeof cookieVal === "string" && cookieVal.length > 0, detail: `role ${role}` };
  });
  const needMember = () => (member?.pass ? null : "no member session");

  // ═══ 3 · THE VALIDATOR ════════════════════════════════════════════════════════════════════════
  await runLeg(
    3,
    "POST /api/facades without displayFileId → 400 naming the field",
    async () => {
      const r = await api("POST", "/api/facades", { body: saveBody(undefined, null) });
      return {
        pass: r.status === 400 && r.json?.error === "BAD_REQUEST" && /displayFileId/.test(r.json?.message ?? ""),
        detail: `${r.status} ${r.json?.message ?? r.text}`,
      };
    },
    { needs: needMember },
  );

  // ═══ 4 · THE UPLOADS ══════════════════════════════════════════════════════════════════════════
  const uploadOne = async (label) => {
    const minted = await api("POST", "/api/upload-url", {
      body: { kind: "facade", fileName: "facade-pattern.jpg", mimeType: "image/jpeg", sizeBytes: jpeg.byteLength },
    });
    if (minted.status !== 200 || typeof minted.json?.uploadUrl !== "string")
      throw new Error(`${label}: upload-url → ${minted.status} ${minted.text}`);
    const name = typeof minted.json.fileName === "string" ? minted.json.fileName : "facade-pattern.jpg";
    const t0 = Date.now();
    const put = await fetch(`${minted.json.uploadUrl}?filename=${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: jpeg,
    });
    const j = await put.json().catch(() => ({}));
    const line = `PUT <wix upload url> (${label}) → ${put.status} · ${Date.now() - t0} ms`;
    timings.push(line);
    console.log(`      ${line}`);
    const file = j?.file ?? j;
    const id = file?.id ?? file?._id ?? null;
    if (!put.ok || typeof id !== "string") throw new Error(`${label}: PUT → ${put.status} ${JSON.stringify(j).slice(0, 160)}`);
    orphanFiles.push(id);
    return { id, url: file?.url ?? null, minted: name };
  };
  const up = await runLeg(
    4,
    "the fixture uploads twice (display + thumb) — upload-url kind facade → PUT",
    async () => {
      files.display = await uploadOne("display");
      files.thumb = await uploadOne("thumb");
      const fails = [];
      if (!/\.jpg$/.test(files.display.minted)) fails.push(`minted name ${files.display.minted}`);
      if (files.display.id === files.thumb.id) fails.push("display and thumb share an id");
      return { pass: fails.length === 0, detail: fmt(fails, `display ${files.display.id} · thumb ${files.thumb.id} · ${jpeg.byteLength} B`) };
    },
    { needs: needMember },
  );

  // ═══ 5 · THE SAVE ═════════════════════════════════════════════════════════════════════════════
  let saved = null;
  await runLeg(
    5,
    "POST /api/facades saves the row (409 FILE_NOT_READY retried)",
    async () => {
      let r;
      for (let i = 0; i < 12; i++) {
        r = await api("POST", "/api/facades", { body: saveBody(files.display.id, files.thumb.id) });
        if (!(r.status === 409 && r.json?.error === "FILE_NOT_READY")) break;
        await sleep(1500);
      }
      if (typeof r.json?.facadeId === "string") {
        createdId = r.json.facadeId;
        cleanupNote = `row ${createdId} created`;
        orphanFiles.length = 0; // the row owns the files now — its DELETE removes them
      }
      saved = r.json?.facade ?? null;
      const fails = [];
      if (r.status !== 200) fails.push(`${r.status} ${r.text}`);
      if (!createdId) fails.push("no facadeId");
      if (!saved) fails.push("no facade row in the answer");
      else {
        if (saved.id !== createdId) fails.push(`facade.id ${saved.id} ≠ facadeId`);
        if (!String(saved.displayUrl).startsWith("https://static.wixstatic.com/media/")) fails.push(`displayUrl ${saved.displayUrl}`);
        if (saved.thumbUrl !== null && !String(saved.thumbUrl).startsWith("https://static.wixstatic.com/media/")) fails.push(`thumbUrl ${saved.thumbUrl}`);
        if (saved.title !== TITLE) fails.push(`title ${saved.title}`);
        if (!near(saved.lat, POSE.lat, 1e-9) || !near(saved.lon, POSE.lon, 1e-9)) fails.push(`pose ${saved.lat},${saved.lon}`);
        if (!near(saved.hFovDeg, POSE.hFovDeg, 1e-9)) fails.push(`hFovDeg ${saved.hFovDeg}`);
        if (saved.poseSource !== "EXIF") fails.push(`poseSource ${saved.poseSource} (want EXIF — pose = exifPose)`);
        if (saved.isPublic !== false || saved.moderation !== "PRIVATE") fails.push(`isPublic ${saved.isPublic} moderation ${saved.moderation} (C6)`);
      }
      return {
        pass: fails.length === 0,
        detail: fmt(fails, `${createdId} · ${saved?.displayUrl?.slice(0, 60)}… · thumb ${saved?.thumbUrl ? "yes" : "no"} · EXIF · PRIVATE`),
      };
    },
    { needs: () => needMember() ?? (up?.pass ? null : "the uploads failed") },
  );
  const needRow = () => needMember() ?? (createdId ? null : "no row was created");

  // ═══ 6 · MY FACADES ═══════════════════════════════════════════════════════════════════════════
  await runLeg(
    6,
    "GET /api/facades (MY FACADES) lists the row",
    async () => {
      let hasNext;
      const r = await poll(async () => {
        const g = await api("GET", "/api/facades");
        hasNext = g.json?.hasNext;
        const row = (g.json?.facades ?? []).find((f) => f.id === createdId);
        return { ok: !!row, row, status: g.status };
      });
      const fails = [];
      if (!r.ok) fails.push(`not listed (HTTP ${r.status})`);
      if (typeof hasNext !== "boolean") fails.push(`hasNext ${hasNext}`);
      if (r.row && r.row.title !== TITLE) fails.push(`title ${r.row.title}`);
      return { pass: fails.length === 0, detail: fmt(fails, `listed · hasNext ${hasNext}`) };
    },
    { needs: needRow },
  );

  // ═══ 7 · RESIDENCY ════════════════════════════════════════════════════════════════════════════
  await runLeg(
    7,
    `GET /api/facades?cells=${GH5} (the residency read) lists the row; a far cell does not`,
    async () => {
      const fails = [];
      let complete;
      const r = await poll(async () => {
        const g = await api("GET", `/api/facades?cells=${GH5}`);
        complete = g.json?.complete;
        const row = (g.json?.facades ?? []).find((f) => f.id === createdId);
        return { ok: !!row, row, status: g.status };
      });
      if (!r.ok) fails.push(`not in ${GH5} (HTTP ${r.status})`);
      if (typeof complete !== "boolean") fails.push(`complete ${complete}`);
      if (r.row) {
        // C6: the world row is slim — no owner id, no file ids.
        for (const k of ["ownerMemberId", "displayFileId", "thumbFileId", "originalFileId"])
          if (k in r.row) fails.push(`world row carries ${k}`);
        if (!String(r.row.displayUrl).startsWith("https://static.wixstatic.com/media/")) fails.push(`displayUrl ${r.row.displayUrl}`);
      }
      const far = await api("GET", `/api/facades?cells=${FAR_GH5}`);
      if (far.status !== 200) fails.push(`far cell → ${far.status}`);
      else if ((far.json?.facades ?? []).some((f) => f.id === createdId)) fails.push(`the row leaks into ${FAR_GH5}`);
      return { pass: fails.length === 0, detail: fmt(fails, `in ${GH5} · complete ${complete} · slim · absent from ${FAR_GH5}`) };
    },
    { needs: needRow },
  );

  // ═══ 7b · T190 — THE PUBLIC WORLD READ (owner ruling 2026-10-22g) ═══════════════════════════
  // Signed OUT, `?cells=` answers 200 with EVERY member's rows: the probe row (another member's,
  // from the anonymous caller's view) AND at least one row the probe member does not own — the
  // owner's real textures (a synthetic row alone proves nothing about the owner filter). The cells
  // are the probe cell + its eight p5 neighbours (≈ 15 km square) unless FTW_OWNER_CELLS names them.
  await runLeg(
    "7b",
    "T190: GET /api/facades?cells= SIGNED OUT → 200 · the probe row · another member's rows · no owner id",
    async () => {
      const fails = [];
      const mineIds = new Set(((await listMine()) ?? []).map((f) => f.id));
      if (createdId) mineIds.add(createdId);
      const cells = process.env.FTW_OWNER_CELLS
        ? process.env.FTW_OWNER_CELLS.split(",").map((c) => c.trim()).filter(Boolean)
        : [...new Set([-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => encodeGeohash(POSE.lat + dy * 0.045, POSE.lon + dx * 0.07, 5))))];
      const anon = await api("GET", `/api/facades?cells=${cells.join(",")}`, { auth: false });
      if (anon.status !== 200) return { pass: false, detail: `signed out → ${anon.status} ${anon.text?.slice(0, 120)}` };
      const rows = anon.json?.facades ?? [];
      if (typeof anon.json?.complete !== "boolean") fails.push(`complete ${anon.json?.complete}`);
      if (createdId && !rows.some((f) => f.id === createdId)) fails.push("the probe row is not in the signed-out answer");
      const others = rows.filter((f) => !mineIds.has(f.id));
      if (others.length === 0) fails.push(`no row of another member in ${cells.join(",")} (set FTW_OWNER_CELLS to the owner's cells)`);
      for (const f of rows) {
        for (const k of ["ownerMemberId", "ownerId", "displayFileId", "thumbFileId", "originalFileId"]) if (k in f) fails.push(`row ${f.id} carries ${k}`);
        if (!String(f.displayUrl).startsWith("https://static.wixstatic.com/media/")) fails.push(`row ${f.id} displayUrl ${f.displayUrl}`);
      }
      // MINE stays gated: the list without cells is still 401 signed out (leg 1 proved it; re-assert here).
      const mine = await api("GET", "/api/facades", { auth: false });
      if (mine.status !== 401) fails.push(`MINE signed out → ${mine.status}`);
      return { pass: fails.length === 0, detail: fmt(fails, `${rows.length} rows signed out · ${others.length} of other members · ${cells.length} cells`) };
    },
    { needs: needRow },
  );

  // ═══ 8 · THE OWNER EDIT ═══════════════════════════════════════════════════════════════════════
  const newLon = POSE.lon + 0.0002;
  await runLeg(
    8,
    "PATCH lon + 0.0002 / title → the new lon, poseSource MANUAL, GET reflects it",
    async () => {
      const fails = [];
      const r = await api("PATCH", "/api/facades", { body: { facadeId: createdId, lon: newLon, title: TITLE2 } });
      const f = r.json?.facade;
      if (r.status !== 200 || r.json?.facadeId !== createdId) fails.push(`${r.status} ${r.text}`);
      if (!f || !near(f.lon, newLon, 1e-9)) fails.push(`answer lon ${f?.lon}`);
      if (f && f.title !== TITLE2) fails.push(`answer title ${f.title}`);
      if (f && f.poseSource !== "MANUAL") fails.push(`answer poseSource ${f.poseSource}`);
      if (f && !near(f.lat, POSE.lat, 1e-9)) fails.push(`lat moved ${f.lat}`);
      const g = await poll(async () => {
        const row = ((await listMine()) ?? []).find((x) => x.id === createdId);
        return { ok: !!row && near(row.lon, newLon, 1e-9) && row.title === TITLE2, row };
      });
      if (!g.ok) fails.push(`GET row ${g.row ? `lon ${g.row.lon} title ${g.row.title}` : "missing"}`);
      else if (g.row.poseSource !== "MANUAL") fails.push(`GET poseSource ${g.row.poseSource}`);
      return { pass: fails.length === 0, detail: fmt(fails, `lon ${newLon.toFixed(4)} · "${TITLE2}" · MANUAL · GET agrees`) };
    },
    { needs: needRow },
  );

  // ═══ 9 · THE DEPLOYED UI (optional) ═══════════════════════════════════════════════════════════
  if (!DOM) {
    results.push({ id: 9, name: "the deployed UI re-opens the saved row", pass: true, skip: true, detail: "FTW_LIVE_DOM≠1" });
    console.log("SKIP [9] the deployed UI — set FTW_LIVE_DOM=1 (and a CDP Chrome on FTW_CDP_PORT)");
  } else {
    await runLeg(
      9,
      "the deployed UI: MENU → MY CONTENT → TEXTURES → OPEN → the saved panel (UPDATE + DELETE)",
      async () => {
        const reachable = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);
        if (!reachable) return { pass: true, skip: true, detail: `no CDP Chrome on :${PORT}` };
        mkdirSync(SHOTS, { recursive: true });
        let target;
        try {
          target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
        } catch {
          target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
        }
        trackTarget(PORT, target.id);
        const s = await openSession(target);
        const fails = [];
        const shot = async (name) => {
          const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
          writeFileSync(`${SHOTS}/${name}`, Buffer.from(r.data, "base64"));
        };
        try {
          await s.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
          await s.send("Network.enable");
          // The cookie at the browser level (it may be httpOnly-equivalent server-side) — the live-deletes idiom.
          await s.send("Network.setCookie", {
            name: "wixSession", value: cookieVal, url: APP + "/", path: "/",
            ...(APP.startsWith("https://") ? { secure: true, sameSite: "None" } : {}),
          });
          // `?d=1` keeps the desktop shell. T179 / T180 (2026-10-22): the saved rows live under
          // MENU → MY CONTENT → TEXTURES (the `?facade=1` link + MY FACADES retired).
          await s.bootUrl(`${APP}/?d=1#p=48.4647,35.0462,1500,25,55.0`);
          const t0 = Date.now();
          await s.waitFor(`!!document.querySelector(".nm-btn") && !!document.querySelector(".mp-toggle")`, 90_000, "the Menu button + MY CONTENT");
          await s.evalJs(`document.querySelector(".nm-btn").click(), true`);
          await s.evalJs(`document.querySelector(".mp-toggle").click(), true`);
          await s.waitFor(`!!document.querySelector('.mp-tab[data-tab="textures"]')`, 15_000, "the TEXTURES tab");
          await s.evalJs(`document.querySelector('.mp-tab[data-tab="textures"]').click(), true`);
          const rowSel = `document.querySelector('[data-facade-row="${createdId}"]')`;
          await s.waitFor(`!!(${rowSel}) && (${rowSel}).textContent.includes(${JSON.stringify(TITLE2)})`, 45_000, "the MY CONTENT · TEXTURES row");
          await shot("01-my-content-textures.jpeg");
          await s.evalJs(`((${rowSel}).querySelector('[data-act="open"]') ?? (${rowSel})).click(), true`);
          await s.waitFor(
            `!!document.querySelector(".pd.ff-panel [data-facade-update]") && !!document.querySelector(".pd.ff-panel [data-facade-delete]")`,
            45_000,
            "the saved panel with UPDATE + DELETE",
          );
          await sleep(2500); // the flight to the pose
          await shot("02-saved-panel.jpeg");
          const panelText = await s.evalJs(`document.querySelector(".pd.ff-panel")?.textContent?.slice(0, 400) ?? ""`);
          if (!panelText) fails.push("the panel has no text");
          // T188 (owner 2026-10-22g — the re-ask of T175): the facade chip must be RENDERED after OPEN,
          // in orbit AND in FPV — geometry on screen + the element under its centre is the chip itself
          // (the `[hidden]` trap of 2026-08-13: a DOM node is not a visible one). Each op attaches
          // on a click (the DOM state — a production build has no `__globe`).
          const chipProbe = async (label) => {
            const c = await s.evalJs(CHIP_PROBE);
            if (!c.present) fails.push(`${label}: no [data-facade-chip] in the DOM`);
            else {
              if (c.rect[2] < 40 || c.rect[3] < 16) fails.push(`${label}: chip rect ${c.rect.join("×")}`);
              if (c.rect[1] < 0 || c.rect[1] + c.rect[3] > c.vh || c.rect[0] < 0 || c.rect[0] + c.rect[2] > c.vw) fails.push(`${label}: chip off-screen ${c.rect.join(",")} in ${c.vw}×${c.vh}`);
              if (c.display === "none" || c.visibility !== "visible" || Number(c.opacity) < 0.5) fails.push(`${label}: chip display ${c.display} / ${c.visibility} / opacity ${c.opacity}`);
              if (c.covered) fails.push(`${label}: chip covered by ${c.over}`);
            }
            return c;
          };
          const chipOrbit = await chipProbe("orbit");
          await shot("03-facade-chip-orbit.jpeg");
          if (chipOrbit.present) {
            await s.evalJs(`document.querySelector('[data-facade-chip] [data-op="move"]').click(), true`);
            const moved = await s.waitFor(`document.querySelector('[data-facade-chip] [data-op="move"]')?.getAttribute("aria-selected") === "true"`, 5_000, "MOVE selected").catch(() => null);
            if (moved === null) fails.push("orbit: MOVE did not select");
            await s.evalJs(`document.querySelector('[data-facade-chip] [data-op="none"]').click(), true`);
          }
          // FPV: boot the deployed shell straight into FPV (the `#f=` pose hash) and re-open the row —
          // T186 jumps the walker to the apex; the chip must be rendered there too.
          await s.bootUrl(`${APP}/?d=1#f=${POSE.lat},${POSE.lon},1.7,${POSE.headingDeg},0,60`);
          await s.waitFor(`!!document.querySelector(".nm-btn") && !!document.querySelector(".mp-toggle")`, 90_000, "the Menu button + MY CONTENT (FPV boot)");
          await s.evalJs(`document.querySelector(".nm-btn").click(), true`);
          await s.evalJs(`document.querySelector(".mp-toggle").click(), true`);
          await s.waitFor(`!!document.querySelector('.mp-tab[data-tab="textures"]')`, 15_000, "the TEXTURES tab (FPV)");
          await s.evalJs(`document.querySelector('.mp-tab[data-tab="textures"]').click(), true`);
          await s.waitFor(`!!(${rowSel})`, 45_000, "the MY CONTENT · TEXTURES row (FPV)");
          await s.evalJs(`((${rowSel}).querySelector('[data-act="open"]') ?? (${rowSel})).click(), true`);
          await s.waitFor(`!!document.querySelector(".pd.ff-panel [data-facade-update]")`, 45_000, "the saved panel (FPV)");
          await sleep(2500);
          const fpvOn = await s.evalJs(`!!document.querySelector(".fh")`);
          if (!fpvOn) fails.push("FPV: the HUD is not up after the #f= boot");
          const chipFpv = await chipProbe("fpv");
          await shot("04-facade-chip-fpv.jpeg");
          const chipLine = (c) => (c.present ? `rect ${c.rect.join("×")}${c.covered ? ` UNDER ${c.over}` : ""} ops ${c.ops.join("/")}` : "ABSENT");
          // T190 — SIGNED OUT, the deployed UI reads the world and PAINTS it: drop the cookie, boot
          // over the probe row's apex, wait for the world read to go out, then for the row's DISPLAY
          // photo to be fetched — the projector requests it only for a RESIDENT slot (in view, in
          // range, TEX on by default), which is the paint itself as far as a DOM walk can see.
          await s.send("Network.deleteCookies", { name: "wixSession", url: APP + "/" });
          // The globe streams hundreds of tiles — the resource-timing buffer (250) overflows long before
          // the world read goes out, so `performance.getEntriesByType` cannot see it (the first live run,
          // 2026-10-23). Record every fetch URL from the first script instead.
          await s.send("Page.addScriptToEvaluateOnNewDocument", {
            // Every caller shape (a string, a URL, a Request) lands as a string — one `undefined` in the list
            // would throw inside the `.some(u => u.includes(…))` wait and read as "never fired" (2026-10-23).
            source: "window.__ftwSeen = []; const __f0 = window.fetch.bind(window); window.fetch = (i, o) => { try { window.__ftwSeen.push(String(i && typeof i === 'object' && 'url' in i ? i.url : i)); } catch {} return __f0(i, o); };",
          });
          await s.bootUrl(`${APP}/?d=1#p=${POSE.lat},${POSE.lon},700,30,${POSE.headingDeg}`);
          await s.waitFor(`!!document.querySelector(".nm-btn")`, 90_000, "the shell (signed out)");
          const displayUrlTail = String(saved?.displayUrl ?? "").split("/media/")[1]?.slice(0, 40) ?? "__no-display-url__";
          const worldRead = await s
            .waitFor(`(window.__ftwSeen ?? []).some((u) => String(u).includes("/api/facades?cells=")) || performance.getEntriesByType("resource").some((e) => e.name.includes("/api/facades?cells="))`, 60_000, "the world read (signed out)")
            .catch(() => null);
          if (worldRead === null) fails.push("signed out: no /api/facades?cells= request went out");
          const anonRows = await s.evalJs(
            `fetch("/api/facades?cells=${GH5}", { credentials: "omit" }).then((r) => r.ok ? r.json() : { status: r.status }).then((j) => ({ status: j.status ?? 200, ids: (j.facades ?? []).map((f) => f.id) }))`,
          );
          if (anonRows.status !== 200) fails.push(`signed out in-page read → ${anonRows.status}`);
          else if (!anonRows.ids.includes(createdId)) fails.push("signed out in-page read lacks the probe row");
          const painted = await s
            .waitFor(`(window.__ftwSeen ?? []).some((u) => String(u).includes(${JSON.stringify(displayUrlTail)})) || performance.getEntriesByType("resource").some((e) => e.name.includes(${JSON.stringify(displayUrlTail)}))`, 60_000, "the display photo fetched (signed out)")
            .catch(() => null);
          if (painted === null) fails.push("signed out: the probe row's display photo was never fetched (not resident / not painted)");
          await shot("05-anonymous-world.jpeg");
          return { pass: fails.length === 0, detail: fmt(fails, `row → panel in ${Date.now() - t0} ms · chip orbit ${chipLine(chipOrbit)} · fpv ${chipLine(chipFpv)} · signed out: ${anonRows.ids?.length ?? 0} rows, photo fetched in ${painted} ms · shots ${SHOTS}/`) };
        } catch (e) {
          await shot("99-failure.jpeg").catch(() => {});
          throw e;
        } finally {
          await s.send("Network.deleteCookies", { name: "wixSession", url: APP + "/" }).catch(() => {});
          s.close();
        }
      },
      { needs: needRow },
    );
  }

  // ═══ 10 · THE DELETE ══════════════════════════════════════════════════════════════════════════
  await runLeg(
    10,
    "DELETE removes the row (JSON content type) · again → 404 · GET no longer lists it",
    async () => {
      const fails = [];
      const id = createdId;
      const d = await api("DELETE", `/api/facades?id=${encodeURIComponent(id)}`);
      if (d.status !== 200 || d.json?.deleted !== true) fails.push(`DELETE → ${d.status} ${d.text}`);
      else {
        createdId = null;
        cleanupNote = `row ${id} deleted by leg 10 (mediaDeleted ${d.json.mediaDeleted})`;
      }
      const again = await api("DELETE", `/api/facades?id=${encodeURIComponent(id)}`);
      if (again.status !== 404 || again.json?.error !== "NOT_FOUND") fails.push(`second DELETE → ${again.status} ${again.text}`);
      const gone = await poll(async () => {
        const list = await listMine();
        return { ok: Array.isArray(list) && !list.some((f) => f.id === id) };
      });
      if (!gone.ok) fails.push("GET /api/facades still lists it");
      const cell = await api("GET", `/api/facades?cells=${GH5}`);
      if ((cell.json?.facades ?? []).some((f) => f.id === id)) fails.push(`still resident in ${GH5}`);
      return { pass: fails.length === 0, detail: fmt(fails, `deleted · mediaDeleted ${d.json?.mediaDeleted} · 404 · gone from both reads`) };
    },
    { needs: needRow },
  );
} finally {
  if (cookieVal) {
    // The row this run created and leg 10 did not remove.
    if (createdId) {
      const r = await api("DELETE", `/api/facades?id=${encodeURIComponent(createdId)}`).catch(() => null);
      if (r && (r.status === 200 || r.status === 404)) {
        cleanupNote = `row ${createdId} deleted by the finally (DELETE ${r.status})`;
        createdId = null;
      } else {
        syncDeleteCreated("finally");
        cleanupNote = createdId ? `ROW LEFT BEHIND: ${createdId} (DELETE failed)` : "row deleted by the finally (curl)";
      }
    }
    // Belt and braces: probe rows an earlier crashed run left behind.
    const left = ((await listMine().catch(() => null)) ?? []).filter((f) => PROBE_TITLE_RE.test(f.title));
    for (const f of left) {
      const r = await api("DELETE", `/api/facades?id=${encodeURIComponent(f.id)}`).catch(() => null);
      console.log(`cleanup: removed a leftover probe row ${f.id} (${r?.status ?? "no answer"})`);
    }
  }
}

// --- summary -------------------------------------------------------------------------------------
const failures = results.filter((r) => !r.pass);
const skipped = results.filter((r) => r.skip);
console.log("\n── FACADES LIVE · SUMMARY ─────────────────────────────────────");
for (const r of results) console.log(`  ${r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.name}`);
console.log(`  ${results.length - failures.length - skipped.length}/${results.length - skipped.length} legs pass${skipped.length ? ` (${skipped.length} skipped)` : ""} · ${APP}`);
console.log("  timings:");
for (const t of timings) console.log(`    ${t}`);
console.log(`  cleanup: ${cleanupNote}`);
if (orphanFiles.length) console.log(`  media uploaded but never owned by a row (clear in the Media Manager): ${orphanFiles.join(", ")}`);
console.log("────────────────────────────────────────────────────────────────");
await finishVerify(failures.length || createdId ? 1 : 0);
