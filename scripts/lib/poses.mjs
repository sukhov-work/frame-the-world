/**
 * THE POSE CATALOGUE — the one shared list of views every visual / perf harness must cover.
 *
 * WHY IT EXISTS (owner complaint, 2026-09-06): every performance and visual session so far
 * measured "very contained bland views, often without any details or in dull spots and angles".
 * `scripts/verify-perf-baseline.mjs:136-142` is the evidence — five poses, four of them a 700 m
 * orbit or a 1.7 m eye over the same block of Dnipro, none of them a view the owner would ever
 * frame. A harness that only ever boots those cannot see the defects that live in the complex
 * horizon, in the descent, in the long lens, or five minutes either side of sunset.
 *
 * So the owner supplied the poses himself, out of his real use of the instrument, and they are
 * reproduced here VERBATIM — the hash strings below are exactly the strings he read off the
 * address bar. Nothing in this file is invented except (a) the two derived variants he asked for
 * (`everest-orbit-52`, the tilt his original frame used, next to the tilt-73 he prefers) and
 * (b) the `t` pinned onto the descent leg, which he gave without one (see `dnipro-descent`).
 *
 * DEPENDENCY-FREE BY CONSTRUCTION: this module is imported by `scripts/verify-visual-sweep.mjs`
 * (a Node CDP harness) and by `test/scripts/poses.test.ts` (vitest, node environment). It must
 * import nothing — not even from `src/` — so that a catalogue edit can never break a build.
 *
 * ── The grammar (`.claude/conventions/contracts.md` §1 · `src/lib/geo/urlPose.ts:38-119`) ──────
 *   `#p=<lat 5dp>,<lon 5dp>,<camAltM>,<heading 1dp>,<tilt 1dp 0–88>`   orbit pose
 *   `#f=<lat 6dp>,<lon 6dp>,<eyeM 1dp GROUND-RELATIVE>,<heading>,<pitch ±89>,<fov 1–120>`  FPV
 *   `&t=<utcMs>` rides either form. A link WITHOUT `t` opens on the real clock — which is why
 *   every catalogue entry carries one: a sweep that reads live time is not comparable to itself.
 *
 * ── Shape of an entry ─────────────────────────────────────────────────────────────────────────
 *   id      stable, kebab-case; the artefact filename and the golden-set key. NEVER renamed.
 *   kind    "orbit" | "fpv" | "m" — decides the boot assertions (an fpv pose must reach
 *           `__globe.fpv().active`; `m` is the `/m` mobile shell and wants touch emulation).
 *   tags    free vocabulary for `--tags`: region, look, and what the pose STRESSES.
 *   hash    the pose hash, verbatim, including `&t=` where the owner's link carried one.
 *   t       the pinned instant (ms). Mirrors the `&t=` inside `hash` when there is one; when
 *           `hash` carries none, `poseUrl()` appends this — never a live clock.
 *   path    the page the hash rides ("/" everywhere but `legacy-m`, which is the `/m` shell).
 *   leg     an optional MULTI-FRAME script (descent / zoomSweep / timeSweep). A pose with a leg
 *           still has a single boot pose (`hash`); the leg says what to do after arrival.
 *   region  "dnipro" | "everest" — the two worlds these poses live in.
 *   note    why the owner chose it / what it is expected to expose. Read this before "fixing" a
 *           pose that looks wrong: a hard pose is the point.
 */

/** The default dev origin. `wix dev` serves the `window.__*` seams; a release build does not. */
export const DEV_ORIGIN = "http://localhost:4321";

/**
 * The descent leg's pinned instant. The owner gave the two descent hashes without a `t`, and a
 * live clock would make two runs of the same leg incomparable (and, run at night, black). This
 * reuses the daylight Dnipro instant from his own `dnipro-fpv-south` frame
 * (1788701556919 = 2026-09-06T13:32:36.919Z) so the descent lands on a lit city.
 */
const T_DESCENT = 1788701556919;

/**
 * The everest sunset A/B stops. The owner's band is 1788696500000 … 1788697900000 (sun elevation
 * ≈ +3.5° → −1°) in ~8 steps, and his two reference frames — t=1788697093370 (+1.63°) and
 * t=1788697486657 (+0.36°) — must be sampled EXACTLY. So the 200 s grid is walked and the two
 * grid points nearest his frames are REPLACED by them (deltas 6.6 s and 13.3 s, i.e. well under
 * one grid step): eight stops, two of them the owner's own instants, no duplicates.
 */
const EVEREST_AB_STOPS = [
  1788696500000, // +3.5° — the "still clearly day" end of the band
  1788696700000,
  1788696900000,
  1788697093370, // OWNER FRAME A — sun elevation +1.63°
  1788697300000,
  1788697486657, // OWNER FRAME B — sun elevation +0.36°
  1788697700000,
  1788697900000, // −1° — the sun is under the horizon; afterglow only
];

/**
 * The FPV zoom sweep's stops. At fov 7.2° (≈200 mm on full frame) the horizon is walked in 45°
 * steps. There is NO FPV look setter on the `window.__globe` seam — the block at
 * `src/components/globe/StylizedTiles.ts:3385-3561` exposes `fpv()` as a pure READ
 * (`active/kind/yawDeg/pitchDeg/fovDeg/…`) and nothing that writes yaw — so the harness re-boots
 * the `#f=` hash per stop, bouncing through about:blank. Verified 2026-09-06.
 */
const ZOOM_SWEEP_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/** @typedef {"orbit"|"fpv"|"m"} PoseKind */

/** The catalogue. Order is the sweep order; ids are the contract. */
export const POSES = [
  // ── 1. The DESCENT (the owner's №1 ask) ────────────────────────────────────────────────────
  {
    id: "dnipro-descent",
    kind: "orbit",
    tags: ["descent", "dnipro", "stress"],
    // START: 31.8 km over Dnipro, tilt 29.3° — a whole-region frame with the horizon in it.
    hash: "#p=48.45875,35.06812,31794,16.8,29.3",
    t: T_DESCENT,
    path: "/",
    region: "dnipro",
    leg: {
      type: "descent",
      /** The arrival pose, as an END hash (verbatim from the owner) and as its parsed fields. */
      endHash: "#p=48.45741,35.05653,1550,35.9,54.9",
      end: { latDeg: 48.45741, lonDeg: 35.05653, altM: 1550, headingDeg: 35.9, tiltDeg: 54.9 },
      /** Screenshot cadence during the flight (ms) and the cap on how many frames are kept. */
      shotEveryMs: 700,
      maxShots: 40,
      /**
       * Keep sampling at least this long after the flight reports settled, and then until the
       * tile streams go quiet. MEASURED 2026-09-06: at +6 s the arrival was still pulling ~660
       * queued tiles with the city-wide seat residual swinging 0.08 → 30 m and 2,400 features
       * moving per frame — i.e. the interesting part of a descent happens AFTER the flight ends,
       * and a fixed 6 s window cut the leg off inside it.
       */
      afterArrivalS: 8,
      /** Hard cap on the whole leg, so a stalled flight (or a city that never settles) cannot
       *  eat the run. Reached = reported (`quietAtEnd: false`), never a hang. */
      maxLegS: 60,
    },
    note:
      "31.8 km → 1.55 km over the same city block, arriving at tilt 54.9°. The one pose that " +
      "crosses EVERY tile LOD boundary in one continuous motion: ground + building streams, the " +
      "terrain-epoch re-seat, the shadow cascades and the governor all change regime mid-flight. " +
      "Sampled per frame, not per settle — the hitches live in the transition, not at the ends.",
  },

  // ── 2. The city, from above and behind ──────────────────────────────────────────────────────
  {
    id: "dnipro-cityscape",
    kind: "orbit",
    tags: ["orbit", "dnipro", "golden"],
    hash: "#p=48.46008,35.07720,553,276.7,74.9&t=1788707940553",
    t: 1788707940553,
    path: "/",
    region: "dnipro",
    note:
      "553 m, tilt 74.9°, looking west (heading 276.7°) at 2026-09-06T15:19Z. The owner's " +
      "reference CITYSCAPE: dense enriched buildings filling the lower frame with a real skyline " +
      "and a lit horizon behind them. The pose the old `city` legacy pose was pretending to be.",
  },

  // ── 3–5. Street level ───────────────────────────────────────────────────────────────────────
  {
    id: "dnipro-fpv-west-sunset",
    kind: "fpv",
    tags: ["fpv", "dnipro", "sunset"],
    hash: "#f=48.464627,35.064907,90.4,266.5,-14.9,55.0&t=1788710616407",
    t: 1788710616407,
    path: "/",
    region: "dnipro",
    note:
      "90 m up, looking west and 14.9° down into the city at 2026-09-06T16:03Z — the low sun is " +
      "roughly behind the frame centre, so this is the pose where bloom, the exposure ramp and " +
      "the building shadows are all doing their hardest work at once.",
  },
  {
    id: "dnipro-fpv-south",
    kind: "fpv",
    tags: ["fpv", "dnipro", "day"],
    hash: "#f=48.467806,35.071753,91.1,164.9,-16.1,55.0&t=1788701556919",
    t: 1788701556919,
    path: "/",
    region: "dnipro",
    note:
      "The daylight twin of the sunset frame: same height, opposite bearing (164.9°, south), " +
      "13:32Z. Flat midday light — the control view where a defect cannot hide behind a mood.",
  },
  {
    id: "dnipro-fpv-zoom-sweep",
    kind: "fpv",
    tags: ["fpv", "zoomSweep", "dnipro"],
    // The BASE hash — heading 98.0° is stop index 2's neighbour; the leg overrides heading.
    hash: "#f=48.467808,35.071753,45.1,98.0,-1.4,7.2&t=1788701556919",
    t: 1788701556919,
    path: "/",
    region: "dnipro",
    leg: {
      type: "zoomSweep",
      /** Every stop keeps the base's lat/lon/eye/pitch/fov and only turns the head. */
      headings: ZOOM_SWEEP_HEADINGS,
      base: { latDeg: 48.467808, lonDeg: 35.071753, eyeM: 45.1, pitchDeg: -1.4, fovDeg: 7.2 },
      /** Seconds to let the long lens finish streaming before the frame is kept. */
      settleS: 4,
      /**
       * "reboot" — the `#f=` hash is re-navigated per stop through about:blank. Chosen because
       * `window.__globe` has no FPV look WRITER (only the `fpv()` reader); see the module note.
       */
      drive: "reboot",
    },
    note:
      "fov 7.2° ≈ a 200 mm lens at 45 m, pitch −1.4° (dead level), turned right around the " +
      "horizon in 45° steps. A long lens magnifies EVERYTHING the wide poses average away: tile " +
      "LOD seams, building-seat residuals, terrain stair-stepping, and the far-plane haze ramp.",
  },

  // ── 6. Everest, the complex horizon ─────────────────────────────────────────────────────────
  {
    id: "everest-orbit-52",
    kind: "orbit",
    tags: ["orbit", "mountains"],
    hash: "#p=28.02649,86.91012,21828,147.2,52.0&t=1788695783060",
    t: 1788695783060,
    path: "/",
    region: "everest",
    note:
      "The owner's ORIGINAL Everest frame — same point, same instant, tilt 52°. Kept beside the " +
      "73° variant because the pair is the A/B: what the extra 21° of tilt costs and reveals.",
  },
  {
    id: "everest-orbit-73",
    kind: "orbit",
    tags: ["orbit", "mountains"],
    hash: "#p=28.02649,86.91012,21828,147.2,73.0&t=1788695783060",
    t: 1788695783060,
    path: "/",
    region: "everest",
    note:
      "21.8 km over the Khumbu, heading 147.2°, tilt 73° — the owner's ruling: at 73° the " +
      "COMPLEX HORIZON is in frame (ridge on ridge, real occlusion, the atmosphere doing depth) " +
      "where at 52° it is not. This is the mountains pose future sweeps must use.",
  },
  {
    id: "everest-fpv-sunset",
    kind: "fpv",
    tags: ["fpv", "mountains", "sunset"],
    hash: "#f=27.989179,86.925144,27.6,272.4,-6.7,37.6&t=1788697611555",
    t: 1788697611555,
    path: "/",
    region: "everest",
    note:
      "27.6 m above the glacier, looking west (272.4°) into the setting sun at a 37.6° fov, " +
      "12:26Z. Terrain-only — no buildings — so every artefact in frame belongs to the ground " +
      "renderer, the sky dome, the shadow cascades or the tone map.",
  },
  {
    id: "everest-fpv-sunset-ab",
    kind: "fpv",
    tags: ["fpv", "mountains", "timeSweep"],
    // The owner's A/B base carries NO `t` — the leg supplies every instant.
    hash: "#f=27.989179,86.925144,27.6,276.7,-1.9,42.0",
    t: EVEREST_AB_STOPS[0],
    path: "/",
    region: "everest",
    leg: {
      type: "timeSweep",
      stops: EVEREST_AB_STOPS,
      /** The two instants that MUST be in `stops` — asserted by the catalogue test. */
      ownerFrames: [1788697093370, 1788697486657],
      /** Seconds to let the light re-solve after `setTime` before the frame is kept. */
      settleS: 2,
      /**
       * "timeStore" — driven by `window.__timeStore.getState().setTime(ms)`
       * (`src/store/time.ts:32,60` · published at `StylizedTiles.ts:3857`), so the whole sweep
       * runs inside ONE boot and every stop shares an identical tile/geometry state. Only the
       * light moves — which is the entire point of the A/B.
       */
      drive: "timeStore",
      /**
       * Snapshot keys to keep per stop. Matched as a case-insensitive SUBSTRING against every
       * flattened `__debugFeed.snapshot()` key (`<provider>.<key>`, `debugFeed.ts:228`), so a
       * provider that gains a light field is picked up without editing this list.
       * Known hits today: `ultra.sunElevDeg` `ultra.exposure` `ultra.keyLevel` `ultra.skyLevel`
       * `ultra.afterglow` `ultra.dayMix` `ultra.dark` `ultra.shadow.*` `ultra.cas1.*`
       * `astro.sunElevDeg` `astro.moonElevDeg` (`StylizedTiles.ts:3977-4048`).
       */
      lightKeys: ["shadow", "key", "sun", "exposure", "hemi", "dusk", "light", "sky", "afterglow", "cas"],
    },
    note:
      "The SUNSET DIAGNOSIS leg. Same frame, eight instants across sun elevation +3.5° → −1°, " +
      "two of them the owner's own reference frames. Everything that changes between stops is " +
      "the lighting solution, so the per-stop light snapshot IS the diagnosis.",
  },

  // ── 9. The legacy five — kept so a sweep can be compared against the old baseline ────────────
  // Verbatim from `scripts/verify-perf-baseline.mjs:132-141` (T_FPV=1787133600000,
  // T_ULTRA=Date.UTC(2026,7,21,9,40)=1787305200000, T_M=1787313600000).
  {
    id: "legacy-fpv-eye",
    kind: "fpv",
    tags: ["legacy", "fpv", "dnipro"],
    hash: "#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000",
    t: 1787133600000,
    path: "/",
    region: "dnipro",
    note: "verify-usermodels EYE — 1.7 m eye, the model-ramp pose. Legacy baseline continuity only.",
  },
  {
    id: "legacy-orbit",
    kind: "orbit",
    tags: ["legacy", "orbit", "dnipro"],
    hash: "#p=48.4647,35.0462,700,25,40&t=1787133600000",
    t: 1787133600000,
    path: "/",
    region: "dnipro",
    note: "verify-usermodels ORBIT — 700 m, tilt 40°. The pose the model ramp orbits.",
  },
  {
    id: "legacy-city",
    kind: "orbit",
    tags: ["legacy", "orbit", "dnipro"],
    // tilt 300 is VERBATIM and out of the documented 0–88 band: `parsePoseHash` CLAMPS it to 88
    // (`urlPose.ts:71`), which is what makes this a near-horizontal 900 m view ~26 km back. Kept
    // exactly as `verify-perf-baseline.mjs:139` wrote it — the clamp is the contract under test.
    hash: "#p=48.464,35.046,900,74,300&t=1787305200000",
    t: 1787305200000,
    path: "/",
    region: "dnipro",
    note:
      "verify-ultra DNIPRO. Tilt 300 → clamped to 88 on parse; the resulting view stands ~26 km " +
      "back from the city, which is why nothing user-placed is ever resident here.",
  },
  {
    id: "legacy-everest",
    kind: "orbit",
    tags: ["legacy", "orbit", "mountains"],
    hash: "#p=27.87,86.83,11500,76,35&t=1787305200000",
    t: 1787305200000,
    path: "/",
    region: "everest",
    note: "verify-ultra EVEREST — 11.5 km, tilt 35°. The owner's tilt-73 pose replaces it.",
  },
  {
    id: "legacy-m",
    kind: "m",
    tags: ["legacy", "mobile", "dnipro"],
    hash: "#p=48.4640,35.0460,220,0,0",
    t: 1787313600000,
    path: "/m",
    region: "dnipro",
    note:
      "verify-qaslice-cab — the `/m` mobile shell at 390×844 @3, touch on. Boots into the 2D " +
      "map by owner rule, so its frame is a chart, not a globe.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Structural regexes for the two hash forms (`contracts.md` §1). Numbers only — the value
 *  RANGES are the parser's business (`urlPose.ts` clamps rather than rejects, which is why
 *  `legacy-city` can legally carry tilt 300). */
export const POSE_HASH_RE = /^#p=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:&t=(\d{1,15}))?$/;
export const FPV_HASH_RE = /^#f=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:&t=(\d{1,15}))?$/;

/** Parse a catalogue hash into `{ form, nums, t }`, or null when it is not one of the two forms.
 *  Pure — the catalogue test's grammar gate, and the harness's descent/zoom-sweep field source. */
export function parseHash(hash) {
  const p = POSE_HASH_RE.exec(hash ?? "");
  if (p) {
    return {
      form: "p",
      nums: p.slice(1, 6).map(Number),
      t: p[6] === undefined ? null : Number(p[6]),
      fields: {
        latDeg: Number(p[1]),
        lonDeg: Number(p[2]),
        altM: Number(p[3]),
        headingDeg: Number(p[4]),
        tiltDeg: Number(p[5]),
      },
    };
  }
  const f = FPV_HASH_RE.exec(hash ?? "");
  if (f) {
    return {
      form: "f",
      nums: f.slice(1, 7).map(Number),
      t: f[7] === undefined ? null : Number(f[7]),
      fields: {
        latDeg: Number(f[1]),
        lonDeg: Number(f[2]),
        eyeM: Number(f[3]),
        headingDeg: Number(f[4]),
        pitchDeg: Number(f[5]),
        fovDeg: Number(f[6]),
      },
    };
  }
  return null;
}

/** Compose an FPV hash from fields + an instant (the zoom sweep's per-stop URL). Mirrors
 *  `formatFpvHash` (`urlPose.ts:110-119`) — same precisions, so a round trip is byte-stable. */
export function fpvHash({ latDeg, lonDeg, eyeM, headingDeg, pitchDeg, fovDeg }, timeMs) {
  const base =
    `#f=${latDeg.toFixed(6)},${lonDeg.toFixed(6)},${eyeM.toFixed(1)},` +
    `${headingDeg.toFixed(1)},${pitchDeg.toFixed(1)},${fovDeg.toFixed(1)}`;
  return timeMs === null || timeMs === undefined ? base : `${base}&t=${Math.round(timeMs)}`;
}

/**
 * The URL a harness navigates for a pose.
 *
 * `dev` is the origin (default `http://localhost:4321`). `ultra` is accepted and INTENTIONALLY
 * does not touch the URL: ULTRA is a persisted boot pref (`ftw:view-prefs:v1`.ultraQuality —
 * `verify-perf-baseline.mjs:358-367`), latched at construction, with no URL form. It is echoed
 * back on the returned object so a caller can key artefacts on it without re-threading the flag.
 *
 * The pinned `t` is appended only when the verbatim hash does not already carry one — never a
 * live clock, so two runs of the same pose are comparable.
 */
export function poseUrl(pose, { dev = DEV_ORIGIN, ultra = false, timeMs } = {}) {
  const t = timeMs === undefined ? pose.t : timeMs;
  let hash = pose.hash;
  if (t !== null && t !== undefined) {
    hash = /&t=\d/.test(hash) && timeMs === undefined ? hash : `${hash.split("&t=")[0]}&t=${Math.round(t)}`;
  }
  return { url: `${dev}${pose.path ?? "/"}${hash}`, hash, t: t ?? null, ultra: !!ultra };
}

/** Every pose carrying `tag` (exact, case-insensitive). */
export function byTag(tag) {
  const want = String(tag).toLowerCase();
  return POSES.filter((p) => p.tags.some((x) => x.toLowerCase() === want));
}

/** One pose by id, or null. */
export function byId(id) {
  return POSES.find((p) => p.id === id) ?? null;
}

/** Every tag in the catalogue, sorted — the `--tags` help text. */
export function allTags() {
  return [...new Set(POSES.flatMap((p) => p.tags))].sort();
}

/** The poses a `--ids`/`--tags` selection resolves to, in catalogue order and de-duplicated.
 *  An unknown id is returned in `missing` rather than silently dropped — a typo'd `--ids` that
 *  quietly ran zero poses and exited 0 is exactly the vacuous pass the harness fence forbids. */
export function select({ ids, tags } = {}) {
  if (!ids?.length && !tags?.length) return { poses: [...POSES], missing: [] };
  const want = new Set();
  const missing = [];
  for (const id of ids ?? []) {
    if (byId(id)) want.add(id);
    else missing.push(id);
  }
  for (const tag of tags ?? []) {
    const hit = byTag(tag);
    if (hit.length === 0) missing.push(`#${tag}`);
    for (const p of hit) want.add(p.id);
  }
  return { poses: POSES.filter((p) => want.has(p.id)), missing };
}
