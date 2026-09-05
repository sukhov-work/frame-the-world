#!/usr/bin/env node
/**
 * T77 step 1b — the MODEL RAMP for the phone baseline (2026-09-05).
 * `rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` §A.4 / §B "the kill ramp": the Mac seeds
 * N resident user models around the Dnipro FPV eye, the phone reloads and reads, N steps up
 * until Safari's jetsam kill. No browser on this side — plain `fetch` against the DEV-only
 * `/api/dev-seed` route (row-only rows at ONE realistic textured GLB; no member session needed).
 *
 *   node scripts/t77-model-ramp.mjs status            # rows this journal holds + the world read
 *   node scripts/t77-model-ramp.mjs to 6              # seed UP TO 6 journaled rows (adds the difference)
 *   node scripts/t77-model-ramp.mjs to 12             # …then 12, 24, 36 — one call per checklist step
 *   node scripts/t77-model-ramp.mjs clear             # remove EVERY journaled row (run this before the
 *                                                     #  window ends — the Wix world is PRODUCTION)
 *   options: --journal <path> (default verify-shots/perf/ramp-seeds.json) · --dev http://localhost:4321
 *            · --owner <member email> · --glb <https GLB url> (a stored static.wixstatic.com URL
 *            makes the numbers about the CDN; the default is the Khronos DamagedHelmet raw URL)
 *
 * The journal survives a crash: `clear` reads it, never memory. Residency caps that shape what a
 * step measures: MODELS.maxResident 24 and triBudget 1.5 M (`tuning.ts`) — past 24 resident the
 * phone reports `skipped`, and the kill ramp is then about the LRU + textures, not the models.
 * Placements: a ring 20–60 m around the eye, the same law `verify-perf-baseline.mjs` uses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// The app's OWN geohash encoder (Node ≥ 22.6 strips the types) — never a transcribed cell: the
// first draft of this file carried a hand-copied `u8vx7` for the eye; the encoder says `ub8gt`.
import { encodeGeohash } from "../src/lib/geo/geohash.ts";

const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const DEV = opt("--dev", "http://localhost:4321");
const OWNER_EMAIL = opt("--owner", "yevhens@wix.com");
const JOURNAL = opt("--journal", "verify-shots/perf/ramp-seeds.json");
const GLB = {
  url: opt("--glb", "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb"),
  glbBytes: 3_773_916,
  tris: 15_452,
  meshes: 1,
  textures: 5,
  bbox: [2, 2, 2],
};
const EYE = { lat: 48.4647, lon: 35.0462 };
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

mkdirSync(dirname(JOURNAL), { recursive: true });
const load = () => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : { ids: [] });
const save = (j) => writeFileSync(JOURNAL, JSON.stringify(j, null, 2));

const placement = (i, N) => {
  const bearing = ((360 * i) / Math.max(1, N) + 15) * (Math.PI / 180);
  const r = 20 + 40 * (((i * 7) % Math.max(1, N)) / Math.max(1, N));
  return {
    lat: EYE.lat + (r * Math.cos(bearing)) / 111_320,
    lon: EYE.lon + (r * Math.sin(bearing)) / (111_320 * Math.cos((EYE.lat * Math.PI) / 180)),
  };
};
const seedOne = async (i, N) => {
  const { lat, lon } = placement(i, N);
  const r = await fetch(`${DEV}/api/dev-seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "model",
      ownerEmail: OWNER_EMAIL,
      model: {
        fileId: `plux-t77-ramp-${STAMP}-${i}.glb`,
        thumbnailFileId: null,
        title: `T77 ramp ${i}`,
        fileName: null,
        sourceFormat: "glb",
        rawBytes: null,
        glbBytes: GLB.glbBytes,
        tris: GLB.tris,
        meshes: GLB.meshes,
        textures: GLB.textures,
        decimatedFromTris: null,
        bbox: GLB.bbox,
        lat,
        lon,
        url: GLB.url,
      },
    }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !body?.modelId) throw new Error(`dev-seed row ${i} → HTTP ${r.status} ${JSON.stringify(body)}`);
  return body.modelId;
};
const EYE_CELL = encodeGeohash(EYE.lat, EYE.lon, 5);
const worldRead = async () => {
  // The public world read the phone's page itself performs (no session): the p5 cell of the eye.
  const r = await fetch(`${DEV}/api/world-models?cells=${EYE_CELL}`).catch(() => null);
  if (!r) return null;
  const b = await r.json().catch(() => null);
  return b?.models ? b.models.length : null;
};

const j = load();
let code = 0;
if (cmd === "status") {
  console.log(`journal ${JOURNAL}: ${j.ids.length} row(s)`);
  const w = await worldRead();
  console.log(`world read (cells=${EYE_CELL} — the eye's p5 cell): ${w === null ? "unreachable (is wix dev up?)" : `${w} model row(s)`}`);
} else if (cmd === "to") {
  const N = Number(args[1]);
  if (!Number.isFinite(N) || N < 0) throw new Error("usage: to <N>");
  const start = j.ids.length;
  for (let i = start; i < N; i++) {
    const id = await seedOne(i, N);
    j.ids.push(id);
    save(j);
    console.log(`seeded ${i + 1}/${N}  ${id}`);
  }
  if (start >= N) console.log(`journal already holds ${start} ≥ ${N} rows — nothing added (use clear to shrink)`);
  console.log(`\nNOW on the phone: reload the pose, wait 20 s, read the Memory instrument + the console snapshot (checklist §B).`);
  console.log(`Wix Data reads lag writes ~1 s — reload after this prints.`);
} else if (cmd === "clear") {
  let removed = 0;
  const failed = [];
  for (const id of j.ids) {
    const r = await fetch(`${DEV}/api/dev-seed?kind=model&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const b = await r.json().catch(() => null);
    if (b?.deleted === true) removed++;
    else failed.push(id);
  }
  j.ids = failed;
  save(j);
  console.log(`removed ${removed} row(s); ${failed.length} still journaled${failed.length ? ` — retry: ${failed.join(", ")}` : ""}`);
  if (failed.length) code = 1;
} else {
  console.error(`unknown command "${cmd}" — status | to <N> | clear`);
  code = 2;
}
process.exitCode = code;
