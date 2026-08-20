#!/usr/bin/env node
// Seed the DEMO_CONTENT_SEED.md set — 27 public-domain/CC0 "impossible nature" photos — as
// PUBLIC, LISTED pins owned by yevhens@wix.com, spread across the globe.
//
// Usage: wix dev on :4321, then
//   ~/.nvm/versions/node/v24.10.0/bin/node scripts/seed-demo-pins.mjs [--dry-run] [--only 1,5-8]
// (Node ≥22 required — global fetch/WebSocket; the default node 20 here fails.)
//
// Path per entry (mimics the app's own save flow, DEMO_CONTENT_SEED.md §Seeding plan):
//   download (serial, descriptive UA — Wikimedia 429s bare clients)
//   → preview ≤2048px JPEG via macOS `sips` (no sharp dep in this repo)
//   → upload preview (single PUT) + original (TUS — originals ALWAYS ride the resumable path,
//     matching src/lib/save/uploadMedia.ts) as the TEST member (media is app-owned; upload-url
//     only gates on "any member")
//   → POST /api/dev-seed (DEV-only route): elevated insert with ownerMemberId = yevhens@wix.com
//     (Google-auth member — no password to log in with) + listing at the entry's price.
// Idempotent: entries whose title already exists on the owner's pins are skipped.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createClient, OAuthStrategy } from "@wix/sdk";

const APP = "http://localhost:4321";
// Domain cutover 2026-08-19: www.plux.today is the primary (the old wix-site-host URL
// 301s site-wide). FTW_SITE_URL env overrides the origin when needed.
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const _envB2 = readFileSync(".env.local", "utf-8");
const TEST_MEMBER = {
  email: _envB2.match(/^TEST_MEMBER_EMAIL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
  password: _envB2.match(/^TEST_MEMBER_PASSWORD=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ""),
}; // audit B2 (2026-08-13): credential moved out of git — lives in gitignored .env.local
if (!TEST_MEMBER.email || !TEST_MEMBER.password)
  throw new Error("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD missing from .env.local (audit B2)");
const OWNER_EMAIL = "yevhens@wix.com";
const UA = "FrameTheWorldDemoSeed/1.0 (hackathon demo content; contact: yevhens@wix.com)";
const CACHE = ".seed-cache";
const PREVIEW_EDGE = 2048;
const DRY = process.argv.includes("--dry-run");
const only = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return null;
  const set = new Set();
  for (const part of process.argv[i + 1].split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let n = a; n <= (b ?? a); n++) set.add(n);
  }
  return set;
})();

// The curated set — DEMO_CONTENT_SEED.md (24 distinct + 3 same-site pads). Titles ≤120 chars
// (parseSavePinBody clamp). Prices cycle €5/7.5/10/12.5/15 (owner: varied, retunable in UI).
const wm = (p) => `https://upload.wikimedia.org/wikipedia/commons/${p}`;
const SET = [
  { n: 1, title: "Blood Falls — a five-story fall of blood-red iron brine seeping from Taylor Glacier", lat: -77.717, lon: 162.267, url: wm("f/f5/Blood_Falls_by_Peter_Rejcek.jpg") },
  { n: 2, title: "Deadvlei — 900-year-old dead camelthorn trees on white clay under orange dunes", lat: -24.7476, lon: 15.2909, url: wm("7/7f/Deadvlei%2C_Sossusvlei_%28Unsplash%29.jpg") },
  { n: 3, title: "Salar de Uyuni — the flooded salt flat as a perfect sky mirror", lat: -20.4955, lon: -67.0303, url: wm("f/f9/Uyuni_Salt_Lake_%28Salar_de_Uyuni%29%2C_Bolivia%2C_12-2022_1.jpg") },
  { n: 4, title: "Zhangye Danxia — striped rainbow sandstone mountains", lat: 38.94, lon: 100.13, url: wm("9/98/Danxia-landform-1562852.jpg") },
  { n: 5, title: "Arher dunes — a white sand wall climbing from the turquoise sea onto black cliffs", lat: 12.54, lon: 54.46, url: wm("8/8b/Socotra_-Ar%27ar.JPG") },
  { n: 6, title: "Moeraki Boulders — cracked dragon eggs scattered down a misty beach", lat: -45.3455, lon: 170.8264, url: wm("5/51/Textured_boulders_%28Moeraki_Boulders%29.jpg") },
  { n: 7, title: "Lençóis Maranhenses — turquoise rain lagoons cradled in white dunes", lat: -2.49, lon: -43.13, url: wm("3/39/Lagoon_in_sanddunes%2C_Len%C3%A7%C3%B3is_Maranhenses.jpg") },
  { n: 8, title: "Light pillars — ice-crystal beams shooting from streetlights into a frozen night sky", lat: 51.337, lon: 26.602, url: wm("a/ae/%D0%A1%D0%BE%D0%BB%D0%BD%D0%B5%D1%87%D0%BD%D1%8B%D0%B5_%D1%81%D1%82%D0%BE%D0%BB%D0%B1%D1%8B_%D0%BD%D0%BE%D1%87%D1%8C%D1%8E_%D0%B2_%D0%B3._%D0%A1%D0%B0%D1%80%D0%BD%D1%8B_%28%D0%A3%D0%BA%D1%80%D0%B0%D0%B8%D0%BD%D0%B0%29.jpg") },
  { n: 9, title: "Starling murmuration — a living smoke-cloud shape-shifting over the sea at dusk", lat: 50.8189, lon: -0.1366, url: wm("6/6e/Starlings_near_Albion_groyne%2C_Brighton_2025-02-27.jpg") },
  { n: 10, title: "Sailing stone — a rock at the end of its self-carved track on a cracked dry lakebed", lat: 36.681, lon: -117.563, url: wm("6/6d/Sailing_Stone_%283979385396%29.jpg") },
  { n: 11, title: "Milky Way over Grand Prismatic Spring — the rainbow hot spring under the galaxy", lat: 44.525, lon: -110.838, url: "https://live.staticflickr.com/2873/33668265111_c536de3bb7_o.jpg" },
  { n: 12, title: "Dumbo octopus at 4,000 m — translucent and ear-finned, photographed by an ROV", lat: 18.7, lon: -67.4, url: "https://oceanexplorer.noaa.gov/wp-content/uploads/2020/10/20201106-hires.jpg" },
  { n: 13, title: "Aurora australis and the Milky Way over the South Pole observatory", lat: -89.997, lon: 139.27, url: wm("0/00/Aurora_australis_and_Milky_Way_seen_over_NOAA_Atmospheric_Research_Observatory_at_South_Pole_Station_%2819771223522%29.jpg") },
  { n: 14, title: "Fly Geyser — a geothermal accident in psychedelic thermophile reds and greens", lat: 40.859, lon: -119.332, url: wm("0/00/Fly_geyser_in_nevada_%282%29.jpg") },
  { n: 15, title: "Mareel — sea water glowing electric turquoise under a harbor jetty", lat: 58.3053, lon: 11.4203, url: wm("1/11/Mareel_-_Bioluminescence_in_Norra_Grundsund_harbor_1.jpg") },
  { n: 16, title: "Steaming Kamchatka volcano — rust-streaked snowfields on a fumarole cone", lat: 53.26, lon: 158.84, url: wm("c/c1/Volcano_in_Kamchatka_in_Russia_-_2785499.jpg") },
  { n: 17, title: "Giant's Causeway — hexagonal basalt tiling that reads as man-made", lat: 55.2402, lon: -6.5115, url: wm("d/d8/Giant%27s_Causeway_Basalt_Columns.jpg") },
  { n: 18, title: "Pamukkale — white travertine terrace pools spilling down a hillside", lat: 37.9238, lon: 29.1238, url: wm("b/b2/Pamukkale_travertenleri_%284%29.jpg") },
  { n: 19, title: "White Sands — blinding gypsum dunes that read as snow in a desert", lat: 32.82, lon: -106.28, url: "https://live.staticflickr.com/65535/32852214697_8682f110c2_o.jpg" },
  { n: 20, title: "Big Red — a huge opaque blood-red deep-sea jellyfish at 1,134 m", lat: 25.5, lon: -170.5, url: "https://oceanexplorer.noaa.gov/wp-content/uploads/2025/08/dive05-big-red-jelly.jpg" },
  { n: 21, title: "Mammatus clouds — ominous globular pouches over a weather-radar dome", lat: 35.23, lon: -97.46, url: wm("8/87/Mamatus_clouds_-_NOAA.jpg") },
  { n: 22, title: "Nacreous clouds — mother-of-pearl iridescence in a winter stratosphere", lat: 57.275, lon: -2.41, url: wm("a/ac/Nacreous_clouds%2C_Aberdeenshire%2C_UK._9_December_2012..JPG") },
  { n: 23, title: "Red crab migration — the ground itself appears to crawl", lat: -10.5029, lon: 105.6742, url: wm("f/fe/Gecarcoidea_natalis_248252577.jpg") },
  { n: 24, title: "A 22° halo, sun dog and parhelic circle over the South Pole dome", lat: -89.997, lon: 139.27, url: wm("d/d0/Halo_and_sun_dog_-_NOAA.jpg") },
  // Same-site pad frames (25–27) — Special:FilePath resolves a Commons page name to its file.
  { n: 25, title: "Deadvlei — a lone camelthorn against the dune wall", lat: -24.7472, lon: 15.2879, url: "https://commons.wikimedia.org/wiki/Special:FilePath/Deadvlei_Hiking_Trail%2C_Namibia_(Unsplash_jTJ9-4ESzU4).jpg" },
  { n: 26, title: "Grand Prismatic Spring from the air — rainbow rings in a steaming eye", lat: 44.5252, lon: -110.8385, url: "https://live.staticflickr.com/65535/47006411034_285d40816f_o.jpg" },
  { n: 27, title: "Deadvlei — petrified in time (panorama)", lat: -24.748, lon: 15.292, url: "https://commons.wikimedia.org/wiki/Special:FilePath/Petrified_In_Time_(200653949).jpeg" },
];
const PRICES = [5, 7.5, 10, 12.5, 15];

// ---- member session (mem:patterns/members-pins recipe — same as verify-phase69.mjs) ----------
async function mintMemberCookie() {
  const env = readFileSync(".env.local", "utf-8");
  const clientId = env.match(/^WIX_CLIENT_ID=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!clientId) throw new Error("WIX_CLIENT_ID missing from .env.local");
  const client = createClient({ auth: OAuthStrategy({ clientId }) });
  const login = await client.auth.login(TEST_MEMBER);
  if (login.loginState !== "SUCCESS") throw new Error(`login state ${login.loginState}`);
  const REDIRECT = `${APP}/api/auth/callback`;
  const oauthData = client.auth.generateOAuthData(REDIRECT, `${APP}/`);
  const authorizeUrl =
    `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
    `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
    `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
  const authRes = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = authRes.headers.get("location");
  if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
  const code = new URL(loc).searchParams.get("code");
  const state = new URL(loc).searchParams.get("state");
  const tokens = await client.auth.getMemberTokens(code, state, oauthData);
  return `wixSession=${encodeURIComponent(JSON.stringify({ clientId, tokens }))}`;
}

let cookie = null;
const api = async (path, method = "GET", body) => {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// ---- media helpers ---------------------------------------------------------------------------
async function download(entry) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${String(entry.n).padStart(2, "0")}.jpg`);
  if (existsSync(file) && statSync(file).size > 10_000) return file;
  const res = await fetch(entry.url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000) throw new Error(`suspiciously small download (${buf.length} B)`);
  writeFileSync(file, buf);
  return file;
}

function makePreview(file, n) {
  const out = join(CACHE, `${String(n).padStart(2, "0")}-preview.jpg`);
  if (existsSync(out) && statSync(out).size > 5_000) return out;
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", String(PREVIEW_EDGE), file, "--out", out], { stdio: "pipe" });
  return out;
}

function imageDims(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf-8" });
  const w = Number(out.match(/pixelWidth: (\d+)/)?.[1]);
  const h = Number(out.match(/pixelHeight: (\d+)/)?.[1]);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : { w: null, h: null };
}

async function uploadPreview(file, fileName) {
  const buf = readFileSync(file);
  const { status, json } = await api("/api/upload-url", "POST", {
    kind: "preview", fileName, mimeType: "image/jpeg", sizeBytes: buf.length,
  });
  if (status !== 200) throw new Error(`upload-url preview ${status}: ${JSON.stringify(json)}`);
  const res = await fetch(`${json.uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: buf,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`preview PUT ${res.status}`);
  const f = j?.file ?? j;
  return { fileId: f?.id ?? null, url: f?.url ?? null };
}

async function uploadOriginal(file, fileName) {
  const buf = readFileSync(file);
  const { status, json } = await api("/api/upload-url", "POST", {
    kind: "original", fileName, mimeType: "image/jpeg", sizeBytes: buf.length,
  });
  if (status !== 200) throw new Error(`upload-url original ${status}: ${JSON.stringify(json)}`);
  const { Upload } = await import("tus-js-client");
  await new Promise((resolve, reject) => {
    new Upload(buf, {
      endpoint: json.uploadUrl,
      metadata: { filename: fileName, contentType: "image/jpeg", token: json.uploadToken ?? "" },
      onError: reject,
      onSuccess: resolve,
    }).start();
  });
  const fin = await fetch(`${json.uploadUrl}/${json.uploadToken}?filename=${encodeURIComponent(fileName)}`, { method: "PUT" });
  const j = await fin.json().catch(() => ({}));
  if (!fin.ok) throw new Error(`original finalize ${fin.status}`);
  const d = j?.file ?? j;
  return { fileId: d?.id ?? null };
}

// ---- main ------------------------------------------------------------------------------------
const ping = await fetch(`${APP}/api/ping`).catch(() => null);
if (!ping?.ok) throw new Error("wix dev is not running on :4321");

const existing = await api(`/api/dev-seed?ownerEmail=${encodeURIComponent(OWNER_EMAIL)}`);
if (existing.status !== 200)
  throw new Error(`dev-seed GET ${existing.status}: ${JSON.stringify(existing.json)}`);
const have = new Set(existing.json.photos.map((p) => p.title));
console.log(`owner ${OWNER_EMAIL} → member ${existing.json.memberId}, ${have.size} pins already`);

cookie = await mintMemberCookie();
console.log("test-member session minted (upload URLs only)\n");

let done = 0, skipped = 0, failed = 0;
for (const entry of SET) {
  if (only && !only.has(entry.n)) continue;
  const tag = `#${entry.n} ${entry.title.slice(0, 56)}…`;
  if (have.has(entry.title)) { console.log(`SKIP  ${tag} (already seeded)`); skipped++; continue; }
  if (DRY) { console.log(`DRY   ${tag}`); continue; }
  try {
    const file = await download(entry);
    const preview = makePreview(file, entry.n);
    const { w, h } = imageDims(file);
    const sizeBytes = statSync(file).size;
    const base = `demo-${String(entry.n).padStart(2, "0")}-${entry.title.split(" — ")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
    const prev = await uploadPreview(preview, `${base}-preview.jpg`);
    const orig = await uploadOriginal(file, `${base}.jpg`);
    if (!prev.fileId || !orig.fileId) throw new Error("upload returned no file id");

    const price = PRICES[(entry.n - 1) % PRICES.length];
    const seeded = await api("/api/dev-seed", "POST", {
      ownerEmail: OWNER_EMAIL,
      priceAmount: price,
      pin: {
        title: entry.title,
        lat: entry.lat,
        lon: entry.lon,
        fovEstimated: false,
        capturedAt: null,
        textureWidth: w,
        textureHeight: h,
        fileName: `${base}.jpg`,
        fileSizeBytes: sizeBytes,
        originalFileId: orig.fileId,
        previewFileId: prev.fileId,
        previewUrl: prev.url,
        isPublic: true,
        precision: "exact", // world landmarks, not the owner's location — C6 governs the owner's GPS
      },
    });
    if (seeded.status !== 200 || !seeded.json.listing?.productId)
      throw new Error(`dev-seed ${seeded.status}: ${JSON.stringify(seeded.json)}`);
    console.log(`OK    ${tag} → pin ${seeded.json.photoId} · €${price} · ${(sizeBytes / 1e6).toFixed(1)} MB`);
    done++;
  } catch (e) {
    console.error(`FAIL  ${tag}: ${e?.message ?? e}`);
    failed++;
  }
}

const market = await api("/api/market");
console.log(`\nseeded ${done} · skipped ${skipped} · failed ${failed}`);
console.log(`market now lists ${market.json.pins?.length ?? "?"} pins`);
if (failed > 0) process.exit(1);
