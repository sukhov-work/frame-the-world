/**
 * GUIDE content — the single source both shells render (desktop Guide.tsx panel, /m
 * GuideSheet.tsx). Lives in lib/ because the mobile fence bans components/panels|ui imports
 * from components/mobile/** (mobileFence.test.ts) — libs are the shared surface.
 *
 * Rules for editing copy (guide track, owner order 2026-08-15):
 * - Every claim must match the LIVE UI — exact labels, exact gestures, exact numbers.
 *   The content-integrity test (test/lib/guide/guideContent.test.ts) enforces structure,
 *   crosslink targets, image existence and a banned-phrase lint; the live-UI match is
 *   verified in-browser per GUIDE_PLAN's done gates.
 * - Voice: action first, imperative, plain words. UI labels verbatim in CAPS as rendered.
 *   One idea per topic; related ideas are [[crosslinks]], not asides.
 * - Images: pre-compressed webp under public/guide/ (720 px wide desktop, 402 px portrait
 *   /m), EVERY path also added to scripts/warm-prod-assets.mjs — a release resets the asset
 *   edge cache cold (the 2026-07-16 outage lesson).
 * - `where` lines name the entry point per shell; omit `mobile` for desktop-only surfaces.
 */

export type GuideShell = "desktop" | "mobile";

export interface GuideMedia {
  /** Path under public/, e.g. "/guide/fpv.webp". */
  src: string;
  /** Instructional caption — tells the reader what to look at, not what the image is. */
  caption?: string;
  /** Which shell the shot shows; mobile shots render narrower (portrait). */
  shell?: GuideShell;
}

export interface GuideWhere {
  desktop?: string;
  mobile?: string;
}

export interface GuideTopic {
  id: string;
  title: string;
  /** Entry point per shell — rendered before the body ("where" beats "what"). */
  where?: GuideWhere;
  /** Short prose. May carry [[id]] / [[id|label]] crosslinks (lib/guide/inline.ts). */
  body?: string;
  /** Numbered steps, one action each. */
  steps?: string[];
  /** The one gotcha worth knowing — rendered as a distinct callout line. */
  tip?: string;
  media?: GuideMedia[];
}

export interface GuideChapter {
  id: string;
  title: string;
  /** 1–2 sentence chapter opener. */
  lead: string;
  media?: GuideMedia;
  topics: GuideTopic[];
}

/** The "I want to…" router shown at the guide's entry — goal → chapter/topic id. */
export interface GuideGoal {
  goal: string;
  target: string;
}

export const GUIDE_GOALS: GuideGoal[] = [
  { goal: "Catch the moon inside my composition", target: "find" },
  { goal: "Line up a sunset over this skyline", target: "find-sunsets" },
  { goal: "Read when the light is right at a spot", target: "plan" },
  { goal: "Scout a location before I go", target: "fpv" },
  { goal: "See what stands in the sky right now", target: "target" },
  { goal: "Share an exact view and moment", target: "save" },
  { goal: "Put my photo on the globe", target: "photo" },
];

export const GUIDE_CHAPTERS: GuideChapter[] = [
  // ————————————————————————————————————————————————————————— START HERE
  {
    id: "start",
    title: "START HERE",
    lead:
      "Sidera is a planning instrument: a 3D Earth with real terrain, buildings and sky, " +
      "driven by real astronomy. Stand anywhere, frame a view, and read when the sun, the " +
      "moon or any sky target will stand inside it.",
    media: {
      src: "/guide/welcome.webp",
      caption: "The landing screen. Any click on the globe drops you into the instrument.",
      shell: "desktop",
    },
    topics: [
      {
        id: "start-loop",
        title: "The planning loop",
        body:
          "Most answers come from one loop: pick a spot, stand in it, command time, read " +
          "the panels.",
        steps: [
          "Fly to a place — search it or drag the globe ([[move]]).",
          "Stand in the landscape with LOOK FROM HERE ([[fpv]]).",
          "Frame your composition: look around, set the focal length.",
          "Scrub time or let [[find|FIND]] scan the calendar for you.",
          "Save the view and the moment ([[save]]).",
        ],
      },
      {
        id: "start-shells",
        title: "One app, two shells",
        body:
          "The desktop shell at / carries every feature. The phone shell at /m carries the " +
          "full planning loop — sheets and touch controls instead of panels. Phones land on " +
          "/m automatically; the DESKTOP chip switches back and remembers the choice. Your " +
          "tracked target and toggles carry across shells.",
        tip: "Photo upload and the marketplace stay desktop-only by design.",
      },
      {
        id: "start-real",
        title: "What is real here",
        body:
          "Terrain and buildings come from real map data. The sun, the moon, planets and " +
          "9,000 catalog stars sit at their true positions for the scene time, computed to " +
          "about an arcminute. When a panel says the moon clears your skyline at 21:14, " +
          "that is a measurement, not an illustration. Limits worth knowing live in " +
          "[[trust]].",
      },
    ],
  },

  // ————————————————————————————————————————————————— MOVE AROUND THE WORLD
  {
    id: "move",
    title: "MOVE AROUND",
    lead:
      "The globe is a free camera: from orbit down to a street. Getting somewhere is either " +
      "a drag or a search away.",
    media: {
      src: "/guide/orbit.webp",
      caption:
        "Orbit view. Camera deck bottom-right, search top-left, mini-map bottom-left, time " +
        "rail along the bottom.",
      shell: "desktop",
    },
    topics: [
      {
        id: "move-orbit",
        title: "Fly the globe",
        where: { desktop: "The globe itself", mobile: "The globe itself" },
        steps: [
          "Drag to orbit. Scroll or pinch to zoom.",
          "Zoom in far enough and buildings rise from the ground.",
        ],
        tip:
          "The orbit camera cannot tilt far above the horizon — to frame the high sky, " +
          "stand in [[fpv|first-person view]].",
      },
      {
        id: "move-search",
        title: "Jump to a place",
        where: {
          desktop: "Search bar in the top nav · EARTH",
          mobile: "SEARCH tab · EARTH",
        },
        steps: [
          "Type a place name — suggestions appear as you type.",
          "Press Enter for a deeper search when the suggestions miss.",
          "Click a result. The camera flies there.",
        ],
      },
      {
        id: "move-pin",
        title: "Drop a planning pin",
        where: {
          desktop: "Double-click the ground (this also stands you there)",
          mobile: "Long-press the ground",
        },
        body:
          "The pin is the anchor: [[plan|PLAN]] reads the light at the pin, and LOOK FROM " +
          "HERE stands you on it. On desktop, double-clicking drops the pin and enters " +
          "[[fpv|first-person view]] in one motion.",
        tip: "On /m, ✕ CLEAR PIN removes it.",
      },
      {
        id: "move-deck",
        title: "The camera deck",
        where: { desktop: "Bottom-right stack" },
        body:
          "Toggles for 2D/3D, day-night, satellite imagery (SAT), the pin (PIN) and " +
          "buildings (BLD), plus ALTITUDE, FOCAL ZOOM and BUILDINGS sliders and a compass. " +
          "In first-person view the deck compacts to what matters there.",
      },
      {
        id: "move-minimap",
        title: "The mini-map",
        where: { desktop: "Bottom-left", mobile: "Top-right" },
        body:
          "A small chart of where you stand and where you look. On /m, tap its edge button " +
          "to collapse it to a puck when it covers the view.",
      },
    ],
  },

  // ————————————————————————————————————————————————— STAND IN THE LANDSCAPE
  {
    id: "fpv",
    title: "STAND IN IT",
    lead:
      "First-person view puts a camera at eye height anywhere on Earth. The frame you " +
      "compose here is what every planning tool measures against.",
    media: {
      src: "/guide/fpv.webp",
      caption:
        "Standing at street level. HUD top-left reads position, focal, heading, pitch and " +
        "eye height; the compact deck stays bottom-right.",
      shell: "desktop",
    },
    topics: [
      {
        id: "fpv-enter",
        title: "Enter first-person view",
        where: {
          desktop: "Double-click the ground, or My spot in the nav",
          mobile: "◎ LOOK FROM HERE or 🧭 MY LOCATION chips",
        },
        steps: [
          "Double-click where you want to stand — the pin drops and you land at eye " +
            "height, looking along the horizon.",
          "From an existing [[move-pin|pin]], LOOK FROM HERE on the camera deck does the same.",
        ],
        tip:
          "My spot uses your device location and keeps it in the browser — it is never " +
          "uploaded or published.",
      },
      {
        id: "fpv-walk",
        title: "Walk and look",
        where: {
          desktop: "Keyboard + mouse",
          mobile: "Left-thumb joystick + one-finger drag",
        },
        steps: [
          "Drag to look around.",
          "Walk with WASD or the arrow keys. Hold Shift to stride, Option/Alt to creep.",
          "Hold Space to rise, Shift+Space to sink — a short tap nudges by a centimetre.",
        ],
        tip: "On /m the joystick keeps walking while your other finger drags the view.",
        media: [
          {
            src: "/guide/fpv-m.webp",
            caption: "Touch controls on /m: joystick bottom-left, rise/sink pads, HUD row.",
            shell: "mobile",
          },
        ],
      },
      {
        id: "fpv-focal",
        title: "Set the focal length",
        where: {
          desktop: "Scroll wheel, or the FOCAL ZOOM slider",
          mobile: "Two-finger pinch",
        },
        body:
          "The frame zooms from a wide 80° down to a 2.75° super-telephoto. Zoom changes " +
          "what fits the frame — and with it every [[find|FIND]] answer.",
      },
      {
        id: "fpv-hud",
        title: "Read the HUD",
        where: { desktop: "Top-left card", mobile: "Compact row above the dock" },
        body:
          "Position (with a COPY button), focal length, heading, pitch and eye height — " +
          "plus edge chips pointing toward the sun, the moon and your target when they sit " +
          "outside the frame.",
      },
      {
        id: "fpv-exit",
        title: "Exit",
        where: { desktop: "EXIT LOOK, or press Escape", mobile: "✕ EXIT VIEW chip" },
        body: "You return to the orbit camera above the same spot.",
      },
    ],
  },

  // ——————————————————————————————————————————————————————— COMMAND TIME
  {
    id: "time",
    title: "COMMAND TIME",
    lead:
      "Every light and sky answer depends on when. The rail along the bottom drives the " +
      "whole scene — light, shadows, stars, everything.",
    media: {
      src: "/guide/time.webp",
      caption:
        "The time rail: light bands behind, sun and moon elevation curves, the playhead " +
        "cursor in the centre. Teal cursor = LIVE.",
      shell: "desktop",
    },
    topics: [
      {
        id: "time-scrub",
        title: "Scrub",
        where: { desktop: "Time rail, bottom", mobile: "Time dock above the tab bar" },
        steps: [
          "Drag the rail. Time slides under the fixed centre cursor; drag left to go into the future.",
          "Double-click the middle — or press NOW — to return to the present.",
        ],
        tip:
          "Cursor colour tells the state: teal = LIVE, amber = pinned in the past, blue = " +
          "pinned in the future.",
      },
      {
        id: "time-bands",
        title: "Read the light bands",
        body:
          "The rail is painted with the day's light: daylight, golden hour, blue hour, " +
          "nautical and astronomical twilight, night. The curves are sun and moon " +
          "elevation; a tracked target adds its own trace — drawn thick where it crosses " +
          "your current frame.",
      },
      {
        id: "time-events",
        title: "Step between events",
        body:
          "Tap the rail's outer edges to jump to the next or previous almanac event — " +
          "sunrise, sunset, twilight starts and ends, moonrise, moonset.",
      },
      {
        id: "time-inputs",
        title: "Set an exact moment",
        where: { desktop: "Date and time inputs beside the rail", mobile: "Date jump on the dock" },
        body:
          "Pick any date, type an exact time, or step by day and hour with the ◀ ▶ " +
          "steppers. The rail also answers the arrow keys when focused.",
      },
      {
        id: "time-play",
        title: "Play",
        body:
          "PLAY advances scene time at a chosen speed; fast-forward speeds read red. " +
          "Watch a whole night's sky motion in a minute.",
      },
    ],
  },

  // —————————————————————————————————————————————————— TRACK A SKY TARGET
  {
    id: "target",
    title: "SKY TARGETS",
    lead:
      "Track one object — the moon, a planet, a star, a comet, a galaxy — and the whole " +
      "instrument organizes around it: its trace on the time rail, its verdicts in PLAN, " +
      "its standings in FIND.",
    media: {
      src: "/guide/target.webp",
      caption:
        "The TARGET panel with the moon tracked: object card, toggles, ghost chain across " +
        "the sky.",
      shell: "desktop",
    },
    topics: [
      {
        id: "target-search",
        title: "Pick a target",
        where: {
          desktop: "Search panel · SKY tab",
          mobile: "SEARCH tab · SKY",
        },
        body:
          "Sun, moon, planets, 451 named stars, the constellations, Messier and NGC " +
          "objects, bright comets and asteroids, the Galactic Centre. Typos are fine — " +
          "picking a result tracks it and aims the camera when it stands above the horizon.",
      },
      {
        id: "target-card",
        title: "Read the object card",
        where: { desktop: "TARGET panel, top-right", mobile: "Tap the target row above the dock" },
        body:
          "Altitude and azimuth, celestial coordinates, distance, magnitude with a " +
          "naked-eye verdict, phase and true disc size. NEXT SESSIONS lists the coming " +
          "dark-sky windows for it; rise and set chips jump time to those instants and aim " +
          "the camera at where it happens.",
      },
      {
        id: "target-toggles",
        title: "The five toggles",
        body:
          "SHOW draws the marker. MARK highlights it. TRAIL draws its day-arc across the " +
          "sky. GHOSTS adds its [[target-ghosts|time-ghost chain]]. TRACK locks the camera " +
          "on it.",
      },
      {
        id: "target-ghosts",
        title: "Time ghosts",
        body:
          "GHOSTS ± N EVERY step surrounds the real body with translucent copies of " +
          "itself at fixed time steps — up to 15 per side, the past side dimmed. One " +
          "glance shows where it came from and where it goes next.",
      },
      {
        id: "target-track",
        title: "TRACK — the camera lock",
        body:
          "With TRACK on, the camera stays glued to the target while time scrubs or " +
          "plays. A deliberate look-drag releases it, so the lock never fights your hand; " +
          "it also releases when the target sinks below the horizon.",
      },
      {
        id: "target-menu",
        title: "The sky context menu",
        where: {
          desktop: "Right-click a body in the sky",
          mobile: "Long-press a body",
        },
        body:
          "The fastest path to everything: ⌖ TRACK it, toggle ⊕ TRACKING, ◌ MARK, ∿ TRAIL " +
          "or ✧ GHOSTS, run ⌖ FIND IN FRAME, aim the camera, or jump to its rise or set. " +
          "The moon's header shows its illuminated percentage.",
        media: [
          {
            src: "/guide/skymenu.webp",
            caption: "Right-click on the moon: quick toggles plus rise/set jumps.",
            shell: "desktop",
          },
        ],
      },
      {
        id: "target-hover",
        title: "Names in the sky",
        body:
          "Hover a body for its name and a reticle ring; at night, stars answer with star, " +
          "asterism and constellation names. On /m, tap empty sky to reveal names for a " +
          "couple of seconds.",
      },
    ],
  },

  // ————————————————————————————————————————————————————— READ THE LIGHT
  {
    id: "plan",
    title: "PLAN",
    lead:
      "PLAN answers: what will the light do at this spot? It reads the sun, the moon and " +
      "your target against the real local skyline — terrain and buildings included.",
    media: {
      src: "/guide/plan.webp",
      caption:
        "The LIGHT PLANNER window: skyline verdicts on top, then the day's chronology, " +
        "moon calendar and star-exposure cards.",
      shell: "desktop",
    },
    topics: [
      {
        id: "plan-open",
        title: "Open it",
        where: {
          desktop: "PLAN | FIND IN FRAME toggle beside the Sidera wordmark",
          mobile: "PLAN tab",
        },
        body:
          "PLAN and [[find|FIND]] share one window: drag it by the grip, resize it by the " +
          "◢ corner, double-click the corner to reset, × to close. It keeps its place " +
          "across the switch.",
      },
      {
        id: "plan-verdicts",
        title: "Skyline verdicts",
        body:
          "Sun, moon and target rows read CLEAR or BEHIND SKYLINE against the actual " +
          "horizon profile from where you stand, with the exact times they clear or hide. " +
          "A trust line reports how much skyline is mapped and to what distance.",
        tip: "Verdicts are measured from the pin — or from your feet in first-person view.",
      },
      {
        id: "plan-frame",
        title: "THIS FRAME · NEXT 36 H",
        body:
          "In first-person view only: when will each body next cross the frame you are " +
          "composing right now? Rows carry the crossing window, the light phase, a skyline " +
          "verdict, a jump chip and a calendar export.",
      },
      {
        id: "plan-today",
        title: "TODAY",
        body:
          "The day's full chronology, midnight to midnight — rises, sets, twilights, " +
          "with light-phase dots. Click a row to jump time to it.",
      },
      {
        id: "plan-moon",
        title: "MOON · PHASES & DISTANCES",
        body:
          "Quarters, perigees and apogees ahead, each with disc size and distance; " +
          "supermoon rows are starred. NEXT SUPERMOON jumps straight to it.",
      },
      {
        id: "plan-npf",
        title: "SPOT STARS — sharp star exposure",
        body:
          "In first-person view, the card computes the longest exposure that keeps stars " +
          "as points (the NPF rule) for the exact patch of sky you frame. Enter your " +
          "aperture and pixel pitch; declination comes from the frame itself.",
      },
      {
        id: "plan-mw",
        title: "Milky-Way season",
        body:
          "Per-night windows when the galactic core stands in dark sky, scored by " +
          "darkness against moon interference. Click a window to jump to its peak. " +
          "Tracking the Galactic Centre also draws the Milky Way band in the sky.",
      },
    ],
  },

  // ———————————————————————————————————————————— SEARCH WITH YOUR FRAME
  {
    id: "find",
    title: "FIND IN FRAME",
    lead:
      "FIND turns planning around. Instead of asking where an object will be, compose a " +
      "frame and ask: on which days does it stand inside THIS view?",
    media: {
      src: "/guide/find.webp",
      caption:
        "FIND with the moon: the standings list on the left, each day projected into the " +
        "sky as a dated ring with that day's phase.",
      shell: "desktop",
    },
    topics: [
      {
        id: "find-concept",
        title: "The frame is the query",
        body:
          "FIND needs [[fpv|first-person view]] — the query is your composition itself. " +
          "Each coming day is tested at the scrubber's wall-clock hour against your live " +
          "frame, so both your aim and your zoom shape the answer: a wide 60° frame may " +
          "score dozens of days, a 3° telephoto a handful.",
        tip: "Scrub to a different hour and the whole scan re-asks the question there.",
      },
      {
        id: "find-chips",
        title: "Choose bodies and range",
        where: {
          desktop: "Chips at the top of the FIND window",
          mobile: "FIND tab · same chips",
        },
        body:
          "Body chips: ☀ sun, ☾ moon, ✦ galactic centre — moon alone is the default. " +
          "Range chips: 1W, 1M, 6M, 1Y. Your choices stick.",
      },
      {
        id: "find-standings",
        title: "Read the standings",
        body:
          "One row per qualifying day: its identity colour, the date, where in the frame " +
          "the body stands, a CLEAR or ✕ skyline verdict and a visibility score. Hover a " +
          "row and its sky ring pulses; hover a ring and its row lights up.",
      },
      {
        id: "find-ghosts",
        title: "Ghosts in the frame",
        body:
          "Every listed day projects into the sky: a hairline ring in the day's colour, a " +
          "translucent body picture with that day's real phase, its day-arc path, and a " +
          "small date label — the moon's adds its illuminated percentage.",
      },
      {
        id: "find-jump",
        title: "Click a day — time jumps, camera stays",
        body:
          "Click a ring or a row: scene time jumps to that instant and the body becomes " +
          "the tracked target. The camera does not move — the real body arrives exactly " +
          "where its ghost stood, inside your unchanged composition.",
      },
      {
        id: "find-sunsets",
        title: "SUNSETS · IN FRAME",
        body:
          "Below the standings, an event-anchored list: on which days does the sunset " +
          "itself land inside the frame? Chips switch SET, RISE and golden hour; each row " +
          "carries the exact time, a skyline verdict, the drift in degrees per day along " +
          "your skyline, and a calendar export.",
        tip:
          "Times are true almanac times. A season's sunsets walk along the horizon and " +
          "turn around at the solstices — dates far apart can share one spot.",
        media: [
          {
            src: "/guide/sunsets.webp",
            caption: "Sunset standings: date, time, verdict and per-day drift.",
            shell: "desktop",
          },
        ],
      },
      {
        id: "find-mobile",
        title: "FIND on the phone",
        where: { mobile: "FIND tab — the fourth tab" },
        body:
          "The same scan at touch scale. Collapsing the sheet keeps the standings " +
          "projected in the frame, so you can compose against them full-screen.",
      },
    ],
  },

  // ————————————————————————————————————————————————————— SAVE & SHARE
  {
    id: "save",
    title: "SAVE & SHARE",
    lead:
      "A plan is a place, a direction and a moment. All three travel in a link, and " +
      "members can keep them as saved places.",
    topics: [
      {
        id: "save-links",
        title: "Share a link",
        body:
          "The address bar always carries your exact camera pose — and the pinned time " +
          "when you scrubbed to one. Copy the URL and the recipient stands where you " +
          "stand, when you stand there. Links work on both shells.",
        tip: "LIVE time is never written into a link — only a pinned moment travels.",
      },
      {
        id: "save-place",
        title: "Save a viewpoint",
        where: {
          desktop: "◎ SAVE PLACE on the camera deck (first-person view, signed in)",
          mobile: "◎ SAVE VIEW chip",
        },
        body:
          "One press bookmarks the full viewpoint, pinned time included. On /m the view " +
          "names itself with a timestamp — no typing.",
      },
      {
        id: "save-places",
        title: "Return to a place",
        where: {
          desktop: "MY PINS panel · PLACES tab",
          mobile: "▤ SAVED PLACES chip, or the SEARCH tab's idle list",
        },
        body:
          "Tap a saved place and Sidera restores the moment first, then the exact " +
          "viewpoint. Renaming and deleting live on the desktop list.",
      },
      {
        id: "save-ics",
        title: "Export to your calendar",
        body:
          "Rows across [[plan|PLAN]] and [[find|FIND]] — frame crossings, moon events, " +
          "standings, sunsets — carry a calendar chip that downloads an .ics event for " +
          "that instant.",
      },
      {
        id: "save-signin",
        title: "Sign in",
        where: {
          desktop: "Sign in, top-right",
          mobile: "The chip in the status strip",
        },
        body:
          "Saving places and pins needs an account; browsing, planning and sharing links " +
          "do not. Signing in returns you to the exact view you left.",
      },
    ],
  },

  // —————————————————————————————————————————————————— PUT A PHOTO ON IT
  {
    id: "photo",
    title: "YOUR PHOTOS",
    lead:
      "Sidera also projects real photographs: a camera file becomes a standing frame at " +
      "its true capture spot, and the scene rebuilds the light it was made in.",
    media: {
      src: "/guide/upload.webp",
      caption: "A decoded RAW projected at its capture spot, frustum and image plane visible.",
      shell: "desktop",
    },
    topics: [
      {
        id: "photo-upload",
        title: "Upload",
        where: { desktop: "Upload, in the nav" },
        body:
          "Drop a camera file — RAW (ARW, CR3, DNG, NEF…), HEIC or JPEG. Decoding happens " +
          "in your browser; nothing uploads until you choose to save. EXIF supplies the " +
          "where and when, and the photo rises as a camera frustum at its capture spot.",
        tip: "No GPS in the file? Double-click the globe to place it by hand.",
      },
      {
        id: "photo-align",
        title: "Align it",
        body:
          "Cameras rarely record which way they pointed. Nudge heading, pitch, altitude " +
          "and focal until the projected frame locks onto the real terrain and buildings; " +
          "every slider re-projects live. A plane opacity slider blends photo against " +
          "scene. Pin the clock to the capture time to study its light.",
      },
      {
        id: "photo-fpv",
        title: "Stand inside the shot",
        body:
          "VIEW FROM CAMERA enters [[fpv|first-person view]] at the photo's exact " +
          "eyepoint and focal length — then [[find|FIND]] and [[plan|PLAN]] answer for " +
          "that framing: when does the moon return to this composition?",
      },
      {
        id: "photo-pins",
        title: "Pins and publishing",
        body:
          "Members save photo pins — 100 on the free tier, 1,000 with premium. A public " +
          "pin joins the shared globe for everyone; location precision is yours to choose " +
          "([[trust-privacy|privacy]]).",
      },
      {
        id: "photo-market",
        title: "Marketplace",
        where: { desktop: "Market, in the nav" },
        body:
          "A public pin with a stored original can be listed for sale at your price. " +
          "Buyers pay through the site checkout and receive a 30-day download link to the " +
          "full-resolution original.",
      },
    ],
  },

  // ——————————————————————————————————————————————————— THE PHONE SHELL
  {
    id: "mobile",
    title: "ON YOUR PHONE",
    lead:
      "The /m shell is the planning loop rebuilt for one hand: the globe stays full-bleed, " +
      "everything else is a chip, a dock or a sheet.",
    media: {
      src: "/guide/shell-m.webp",
      caption:
        "The /m shell: status strip on top, action chips on the right, target row, time " +
        "dock and tabs at the bottom.",
      shell: "mobile",
    },
    topics: [
      {
        id: "mobile-layout",
        title: "The layout",
        body:
          "Top strip: place, account, scene time, DESKTOP switch. Bottom, in order: the " +
          "tracked target row (tap it for the full card), the time dock, and the SCENE · " +
          "PLAN · FIND · SEARCH tabs.",
      },
      {
        id: "mobile-sheets",
        title: "Sheets",
        body:
          "Tabs open bottom sheets. Pull the handle down or tap the dark scrim to close " +
          "one. The FIND sheet covers the tab bar — leave it by the scrim.",
      },
      {
        id: "mobile-chips",
        title: "Scene chips",
        body:
          "The right-edge stack adapts to what you are doing: 🧭 MY LOCATION, ◎ LOOK FROM " +
          "HERE, ◎ SAVE VIEW, ▤ SAVED PLACES for members, ✕ CLEAR PIN, ✕ EXIT VIEW.",
      },
      {
        id: "mobile-gestures",
        title: "Touch gestures",
        steps: [
          "Long-press the ground — planning pin.",
          "Long-press a sky body — the context menu.",
          "Tap empty sky — reveal names for a moment.",
          "In first-person view: joystick walks, one finger looks, pinch zooms the focal.",
        ],
        tip: "While the walk controls are up, the screen stays awake.",
      },
    ],
  },

  // ——————————————————————————————————————————————— PRECISION & PRIVACY
  {
    id: "trust",
    title: "PRECISION",
    lead:
      "Sidera is built to be trusted: real ephemeris, real skylines, and honest labels " +
      "where a number is a model.",
    topics: [
      {
        id: "trust-accuracy",
        title: "How precise is it",
        body:
          "Positions come from a professional ephemeris engine, accurate to about one " +
          "arcminute. Skyline verdicts measure the actual rendered terrain and buildings. " +
          "Sky markers draw at a readable size — the marker is stylized, the numbers " +
          "behind it are not. Comet and asteroid magnitudes are labelled as models: " +
          "brightness forecasting carries real uncertainty.",
      },
      {
        id: "trust-airless",
        title: "Printed times vs the drawn sky",
        body:
          "Event times are true almanac times, refraction included — trust them for the " +
          "field. The drawn scene is an airless sky by convention, so the rendered sunset " +
          "touches the horizon a few minutes after the printed time. The numbers are " +
          "right; the drawing is the instrument.",
      },
      {
        id: "trust-privacy",
        title: "Location privacy",
        body:
          "Wartime-aware by design. A public pin publishes reduced precision by default — " +
          "the centre of its ~1 km cell, or only the city; exact GPS never leaves your " +
          "private record unless you opt that pin into exact placement. My spot geolocation " +
          "stays in your browser. Originals stay private; only a completed purchase " +
          "delivers one.",
      },
    ],
  },
];

/** Flat id → node lookup (chapters and topics). Built once at module load. */
export interface GuideNodeRef {
  chapterId: string;
  topicId?: string;
  title: string;
}

export const GUIDE_INDEX: ReadonlyMap<string, GuideNodeRef> = (() => {
  const map = new Map<string, GuideNodeRef>();
  for (const ch of GUIDE_CHAPTERS) {
    map.set(ch.id, { chapterId: ch.id, title: ch.title });
    for (const t of ch.topics) {
      map.set(t.id, { chapterId: ch.id, topicId: t.id, title: t.title });
    }
  }
  return map;
})();
