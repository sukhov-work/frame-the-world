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
 * - Images: pre-compressed webp under public/guide/, shot by scripts/shoot-guide.mjs.
 *   Desktop frames are 720 px wide (some are cropped taller or shorter); /m frames are
 *   360×783. Declare the real `w`/`h` on every entry — the integrity test reads the webp
 *   header and fails on a mismatch, so a re-shoot that changes a crop cannot drift.
 *   EVERY path also goes into scripts/warm-prod-assets.mjs — a release resets the asset
 *   edge cache cold (the 2026-07-16 outage lesson).
 * - `where` lines name the entry point per shell; omit `mobile` for desktop-only surfaces.
 */

type GuideShell = "desktop" | "mobile";

export interface GuideMedia {
  /** Path under public/, e.g. "/guide/fpv.webp". */
  src: string;
  /** Instructional caption — tells the reader what to look at, not what the image is. */
  caption?: string;
  /** Which shell the shot shows; mobile shots render narrower (portrait). */
  shell?: GuideShell;
  /**
   * Intrinsic pixel size, so a lazy image reserves its box instead of shifting the text
   * under it. Six distinct sizes ship, which is why this is per-media and not a per-shell
   * CSS ratio. Asserted against the file header by guideContent.test.ts — a re-shoot that
   * changes a size fails loudly instead of drifting.
   */
  w?: number;
  h?: number;
}

interface GuideWhere {
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
  /**
   * An UNORDERED enumeration — the controls on a deck, the chips in a stack. Renders as a
   * `<ul>`. Use it wherever the alternative is a colon followed by ten commas: those lists
   * are not sequential, so they must never be pushed into `steps` (which renders `<ol>` and
   * promises an order that does not exist).
   */
  list?: string[];
  /** Numbered steps, one action each. */
  steps?: string[];
  /** The one gotcha worth knowing — rendered as a distinct callout line. */
  tip?: string;
  /**
   * Search-only aliases: the word a reader types that appears nowhere in the copy — a
   * synonym, a glyph's name, a platform ("android"), a photographer's word ("shutter").
   * NOT rendered anywhere.
   *
   * Fenced BEHAVIOURALLY by guideSearchGolden.test.ts, not lexically: an alias must actually
   * reach the topic that declares it, no alias may be claimed by more than two topics, and
   * none may make an unanswerable query answerable. Adding a generic word here will turn the
   * suite red rather than quietly widen the topic's reach.
   */
  keys?: string[];
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
  /**
   * The reading ROUTE this goal opens, in order. `route[0]` is always `target`, so every
   * existing consumer keeps working; renderers that understand routes draw a
   * `STEP n OF m · <next> →` footer. 3–5 ids. Every id is validated by guideContent.test.ts.
   */
  route?: string[];
}

/**
 * `route` = the reading path the goal opens, `route[0] === target` always (2026-08-22g).
 * Four rows were added in the same pass: nothing used to route into the TIME or PHONE
 * chapters at all, and the two new topics needed a door.
 */
export const GUIDE_GOALS: GuideGoal[] = [
  {
    goal: "Catch the moon inside my composition",
    target: "find",
    route: ["find", "fpv-enter", "find-concept", "find-chips", "find-jump"],
  },
  {
    goal: "Line up a sunset over this skyline",
    target: "find-sunsets",
    route: ["find-sunsets", "fpv-enter", "fpv-focal", "trust-airless"],
  },
  {
    goal: "Read when the light is right at a spot",
    target: "plan",
    route: ["plan", "move-pin", "plan-verdicts", "plan-today", "save-ics"],
  },
  {
    goal: "Score the ground around me for where to stand",
    target: "bestspot",
    route: ["bestspot", "spot-open", "spot-read", "spot-shortlist", "spot-actions"],
  },
  {
    goal: "Watch an eclipse before it happens",
    target: "target-eclipses",
    route: ["target-eclipses", "target-search", "target-eclipse-scene", "time-scrub"],
  },
  {
    goal: "Scout a location before I go",
    target: "fpv",
    route: ["fpv", "fpv-enter", "fpv-walk", "fpv-focal", "fpv-map"],
  },
  {
    goal: "See what stands in the sky right now",
    target: "target",
    route: ["target", "target-search", "target-card", "target-toggles", "target-radar"],
  },
  {
    goal: "Plan a meteor-shower night",
    target: "plan-meteors",
    route: ["plan-meteors", "target-search", "time-bands"],
  },
  {
    goal: "See which way the sun will travel",
    target: "target-radar",
    route: ["target-radar", "fpv-cone", "fpv-map-gestures"],
  },
  {
    goal: "Correct a building that looks wrong",
    target: "fpv-height",
    route: ["fpv-height", "fpv-enter", "plan-verdicts"],
  },
  {
    goal: "Share an exact view and moment",
    target: "save",
    route: ["save", "save-links", "save-place", "save-places", "save-onmap"],
  },
  {
    goal: "Put my photo on the globe",
    target: "photo",
    route: ["photo", "photo-upload", "photo-align", "photo-fpv", "photo-pins"],
  },
  {
    goal: "Move the scene to another moment",
    target: "time",
    route: ["time", "time-scrub", "time-bands", "time-inputs", "time-events"],
  },
  {
    goal: "Work one-handed on my phone",
    target: "mobile",
    route: ["mobile", "mobile-map", "mobile-layout", "mobile-chips", "mobile-gestures"],
  },
  {
    goal: "Wander and see what other people framed",
    target: "start-explore",
    route: ["start-explore", "photo-pins", "move-orbit"],
  },
  {
    goal: "Drive the whole thing from the keyboard",
    target: "keys",
    route: ["keys", "fpv-walk", "time-scrub"],
  },
];

export const GUIDE_CHAPTERS: GuideChapter[] = [
  // ————————————————————————————————————————————————————————— START HERE
  {
    id: "start",
    title: "START HERE",
    lead:
      "Plux is a planning instrument: a 3D Earth with real terrain, buildings and sky, " +
      "driven by real astronomy. Stand anywhere, frame a view, and read when the sun, the " +
      "moon or any sky target will stand inside it.",
    media: {
      src: "/guide/welcome.webp",
      w: 720,
      h: 450,
      caption: "The landing screen. Any click on the globe drops you into the instrument.",
      shell: "desktop",
    },
    topics: [
      {
        id: "start-loop",
        title: "The planning loop",
        keys: ["workflow", "how to", "getting started", "basics", "first steps"],
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
        keys: ["desktop", "phone", "which shell", "android", "tablet", "ipad"],
        body:
          "The desktop shell at / carries every feature. The phone shell at /m carries the " +
          "full planning loop — sheets and touch controls instead of panels. Phones land on " +
          "/m automatically; the DESKTOP chip switches back and remembers the choice. Your " +
          "tracked target, your toggles AND your POSE carry across shells — switch while " +
          "standing somewhere and you arrive at the same place, looking the same way.",
        tip:
          "The phone leaves out photo upload, the marketplace, [[bestspot|BEST SPOT]], the " +
          "Milky-Way season card, the meteor card and calendar export.",
      },
      {
        id: "start-real",
        title: "What is real here",
        keys: ["accuracy", "real", "data", "source", "true"],
        body:
          "Terrain and buildings come from real map data. The sun, the moon, planets and " +
          "9,000 catalog stars sit at their true positions for the scene time, computed to " +
          "about an arcminute. When a panel says the moon clears your skyline at 21:14, " +
          "that is a measurement, not an illustration. Limits worth knowing live in " +
          "[[trust]].",
      },
      {
        id: "start-explore",
        title: "Explore — the ambient tour",
        where: { desktop: "Explore, in the nav" },
        keys: ["tour", "ambient", "journey", "slideshow", "browse"],
        body:
          "Explore flies the globe from one public photo pin to the next by itself, so you " +
          "can see what other people have framed without searching for anything. Touch the " +
          "globe or press Escape to take the camera back. It refuses to start while an " +
          "upload is in progress.",
        tip: "While the tour runs, a chip reads ◉ EXPLORING · PIN TO PIN.",
      },
      {
        id: "keys",
        title: "Keyboard map",
        where: { desktop: "Anywhere on the desktop shell" },
        keys: ["shortcut", "shortcuts", "hotkey", "hotkeys", "wasd", "spacebar", "escape", "esc"],
        body:
          "The desktop shell answers the keyboard nearly everywhere, and first-person view " +
          "prints its own reminder in the corner of the HUD.",
        list: [
          "WASD or the arrow keys — walk, in [[fpv|first-person view]].",
          "Shift — stride, at triple speed. Option/Alt — creep, at half.",
          "Space — rise. Shift+Space — sink.",
          "Escape — unwind one layer: the sky menu, then a building edit, then the MAP " +
            "window, then Explore, then the view itself.",
          "On the time rail: ← and → step 10 minutes, Home and End jump 6 hours.",
          "In the search box: ↓ and ↑ walk the suggestions, Enter takes one, Escape " +
            "dismisses them.",
        ],
        tip:
          "Every knob and slider on the desktop deck is a keyboard control too — focus one " +
          "and the arrow keys drive it.",
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
      w: 720,
      h: 450,
      caption:
        "Orbit view over Dnipro. Camera deck bottom-right with its four-column toggle grid, " +
        "search top-centre, the planned focal cone and direction radar drawn on the ground, " +
        "time rail along the bottom.",
      shell: "desktop",
    },
    topics: [
      {
        id: "move-orbit",
        title: "Fly the globe",
        where: { desktop: "The globe itself", mobile: "The globe itself" },
        body:
          "On /m the shell starts as a flat 2D chart, and the ▲ 3D chip is the only way up " +
          "into the globe ([[mobile-map]]).",
        steps: [
          "Drag to orbit.",
          "Scroll or pinch to zoom.",
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
          desktop: "Search bar in the top nav · the EARTH tab",
          mobile: "SEARCH tab · EARTH",
        },
        keys: ["geocode", "address", "city", "town", "location", "goto"],
        steps: [
          "Switch the search to EARTH — it opens on SKY.",
          "Type a place name — suggestions appear as you type.",
          "Press Enter for a deeper search when the suggestions miss.",
          "Walk the suggestions with ↓ and ↑, or press Escape to dismiss them.",
          "Click a result — the camera flies there.",
        ],
        tip:
          "The empty field tells you what it wants: SKY offers examples like m31 · moon · " +
          "orion, EARTH a place name. On /m the field takes focus the moment the sheet opens.",
      },
      {
        id: "move-pin",
        title: "Drop a planning pin",
        where: {
          desktop: "Double-click the ground",
          mobile: "Long-press the ground",
        },
        body:
          "The pin seats [[target-radar|the aim radar]] and [[fpv-cone|the focal cone]] — " +
          "the camera aims from it. On desktop a small popup opens beside the new pin " +
          "carrying ◎ LOOK FROM HERE, which is how you [[fpv-enter|stand on it]], and " +
          "↑ UPLOAD HERE for a photo with no GPS. [[plan|PLAN]] reads the light where you " +
          "STAND, not at the pin — take ◎ LOOK FROM HERE for the verdict there.",
        tip: "On /m, ✕ CLEAR PIN removes it.",
      },
      {
        id: "move-deck",
        title: "The camera deck",
        where: { desktop: "Bottom-right stack" },
        keys: ["toggles", "layers", "compass", "bearing", "north", "satellite", "imagery"],
        body:
          "Eleven toggles and the compass rose, over four columns. The deck compacts in " +
          "first-person view to what matters there.",
        list: [
          "The compass rose — click it to face north.",
          "3D / 2D — the chip shows the mode it switches to.",
          "☀☾ — the sun and moon sky guides.",
          "SAT — satellite imagery on the ground.",
          "PIN — everyone's public [[photo-pins|photo pins]].",
          "BLD — the 3D buildings; the best model for where you look loads on its own " +
            "([[trust-detail|where that is deepest]]).",
          "MDL — everyone's uploaded [[fpv-models|3D models]]; amber where they crowd an area.",
          "AIM — [[target-radar|the direction radar]].",
          "PLC — [[save-onmap|your saved places on the map]].",
          "VEC — the road, river and park ink over the ground.",
          "ULT — [[move-ultra|the experimental quality mode]].",
          "DBG — a live engine-metrics window for the curious: frame times, tile " +
            "streaming, shadows, sky positions. Read-only, desktop-only.",
        ],
        tip:
          "The knobs change with the mode: CAM TILT above the row, ROTATE and ZOOM below " +
          "it in orbit; ALTITUDE, FOCAL ZOOM and BUILDINGS in first-person view.",
      },
      {
        id: "move-ultra",
        title: "ULT — the experimental quality mode",
        where: { desktop: "ULT, on the camera deck" },
        keys: ["quality", "ultra", "hq", "frame rate", "detail"],
        body:
          "The scene normally sheds detail to hold a frame rate on whatever machine it finds. " +
          "ULT pins quality to its maximum whatever that costs, and pushes building, label and " +
          "vector detail past the usual ceiling. It is experimental, desktop-only, off by " +
          "default, and it will make a slower machine work hard.",
        tip:
          "Flipping it mid-session moves everything except the shadow rig: the big shadow map is " +
          "built once at page load, so reload to get that half.",
      },
      {
        id: "move-minimap",
        title: "The mini-map",
        where: { desktop: "Bottom-left (first-person view)", mobile: "Top-right" },
        keys: ["minimap", "mini map", "inset", "chart", "puck"],
        body:
          "A small chart of where you stand, your view drawn as a translucent cone. " +
          "Click the map itself to open [[fpv-map|the full MAP window]]. On /m, tap its " +
          "edge button to collapse it to a folded-map puck when it covers the view. The " +
          "[[target-radar|direction radar]] and [[fpv-cone|your focal cone]] draw on it too, " +
          "and the [[move-aimstick|AIM stick]] sits in its corner on desktop.",
      },
      {
        id: "move-aimstick",
        title: "The AIM stick",
        where: {
          desktop: "Corner of the mini-map",
          mobile: "Left rail — above the walk stick in first-person view",
        },
        keys: ["joystick", "stick", "pad", "thumbstick", "heading", "focal", "mm"],
        body:
          "A round stick that aims the SHOT, not the walk. Push left or right to swing the " +
          "heading; push up to go telephoto, down to go wide. It reads out the focal length " +
          "in millimetres under the pad ([[fpv-focal-axes|why two numbers]]), and " +
          "[[fpv-cone|the cone]] follows it live on every surface. Inside first-person view " +
          "it steers the real camera; outside, the plan.",
        tip:
          "It is a RATE control, like the desktop encoder knobs: how far you push sets how " +
          "fast it turns, and letting go eases to a stop rather than snapping.",
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
      w: 720,
      h: 450,
      caption:
        "Standing at street level. The HUD reads position, ground, focal, heading, pitch and " +
        "eye height; the mini-map carries the radar and the AIM stick; the compact deck stays " +
        "bottom-right; the moon's day arc crosses the sky.",
      shell: "desktop",
    },
    topics: [
      {
        id: "fpv-enter",
        title: "Enter first-person view",
        where: {
          desktop: "Double-click the ground, or My spot in the nav",
          mobile: "◎ LOOK FROM HERE chip",
        },
        keys: ["street level", "eye height", "ground level", "my spot"],
        steps: [
          "Double-click where you want to stand — a [[move-pin|pin]] drops there.",
          "Press ◎ LOOK FROM HERE in the popup beside it — you land at eye height, " +
            "looking along the horizon.",
          "On /m, tap 🧭 MY LOC to fly the chart to your device fix.",
          "Then tap the ◎ LOOK FROM HERE chip it arms.",
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
        keys: ["wasd", "arrows", "joystick", "strafe", "run", "rise", "sink", "altitude"],
        steps: [
          "Drag to look around.",
          "Walk with WASD or the arrow keys.",
          "Hold Shift to stride at triple speed, Option/Alt to creep at half.",
          "Hold Space to rise, Shift+Space to sink — a short tap nudges by a centimetre.",
          "Drag the deck's ALTITUDE encoder right to rise, left to descend.",
          "On /m, use the ⤒ and ⤓ pads on the right rail to rise and sink.",
        ],
        tip: "On /m the joystick keeps walking while your other finger drags the view.",
        media: [
          {
            src: "/guide/fpv-m.webp",
            w: 360,
            h: 783,
            caption:
              "Touch controls on /m: the AIM stick above the WALK stick on the left rail, " +
              "rise and sink pads on the right, the HUD row under the status strip, the " +
              "mini-map with its radar, and the tracked target's row above the dock.",
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
        keys: ["zoom", "lens", "telephoto", "wide", "mm", "millimetres", "focal length"],
        body:
          "The frame zooms from a wide 80° down to a 2.75° super-telephoto. Zoom changes " +
          "what fits the frame — and with it every [[find|FIND]] answer.",
      },
      {
        id: "fpv-focal-axes",
        title: "Why two focal numbers",
        where: {
          desktop: "FOCAL on the HUD card · mm under the AIM stick",
          mobile: "FOCAL in the HUD row · mm under the AIM stick",
        },
        keys: ["35mm equivalent", "full frame", "sensor", "crop", "aspect", "portrait"],
        body:
          "Two readouts describe one view, and they measure different edges of the frame. " +
          "The HUD's FOCAL is the 35 mm equivalent across the frame's HEIGHT; the AIM " +
          "stick's mm footer is the equivalent across its WIDTH. On a 3:2 frame they agree. " +
          "On a tall phone frame the HUD reads much shorter, because a tall frame is wide in " +
          "one axis and narrow in the other. Read the one that matches how you crop.",
        tip: "Same view, two edges. Neither number is a correction of the other.",
      },
      {
        id: "fpv-cone",
        title: "The focal cone",
        keys: ["wedge", "frustum", "field of view", "fov", "coverage"],
        where: {
          desktop: "On the map, the mini-map and the globe",
          mobile: "Same three surfaces",
        },
        body:
          "A rose-coloured wedge drawn from where you stand, exactly as wide as your frame. " +
          "Inside first-person view it mirrors the live camera; outside it, it draws the shot " +
          "you are PLANNING — the heading and focal length the [[move-aimstick|AIM stick]] " +
          "sets. It reads through the world rather than over it, so buildings stay legible " +
          "under it. Widen the focal and the wedge opens; go telephoto and it narrows to a line.",
        tip:
          "The plan is seeded from boot, so the cone is ready the moment you drop near the " +
          "ground — like the radar it draws below about 10 km on desktop, and only while AIM is on.",
      },
      {
        id: "fpv-hud",
        title: "Read the HUD",
        where: {
          desktop: "Bottom-left card, under the mini-map",
          mobile: "Compact row at the top, under the status strip",
        },
        keys: ["readout", "overlay", "telemetry", "coordinates", "elevation", "bearing"],
        body:
          "The card reads out where you stand and how you are looking, and it prints the " +
          "keyboard reminder along its foot. Edge chips point toward the sun, the moon and " +
          "your target when they sit outside the frame; a tracked target's chip stays on " +
          "below the horizon, dimmed, and clicking it looks where the target rises next. " +
          "On /m the row keeps FOCAL, HDG, PITCH and EYE, and the edge chips ride along.",
        list: [
          "Position, with a COPY button.",
          "GROUND — the terrain height under your feet.",
          "FOCAL — the [[fpv-focal-axes|35 mm equivalent]] for the frame's height.",
          "HEADING, PITCH and EYE — your aim and how far above the ground you stand.",
          "☀ SUN and ☾ MOON — where each of them stands right now.",
        ],
      },
      {
        id: "fpv-map",
        title: "The MAP window",
        keys: ["fullscreen map", "expand", "big map", "chart"],
        where: { desktop: "Click the mini-map", mobile: "Tap the mini-map" },
        body:
          "The mini-map expands to a big flat chart of the area around you — a centred " +
          "window on desktop, fullscreen on /m — and it follows you as you walk. On desktop, double-click to stand somewhere else; on " +
          "/m, long-press to drop a point and stay on the map. Drag the chart and it holds " +
          "where you put it — tap ◉ to come back to yourself.",
        tip:
          "On /m the walk joystick keeps working over the fullscreen map. On desktop, " +
          "Esc closes the map first, then exits the view.",
      },
      {
        id: "fpv-map-controls",
        title: "Controls on the MAP",
        where: {
          desktop: "Top row of the map window",
          mobile: "Pills top-left · live view and ◉ down the right",
        },
        body:
          "The top row carries the title, + and −, and on desktop ✕ MINI-MAP. To its right on " +
          "/m sits a live 3D window onto where you stand — tap it to go back there. Under that, " +
          "the round ◉ button: muted while the chart is following you, lit once you have " +
          "explored away. The time strip keeps working along the bottom, so you can scrub the " +
          "sky without closing the map.",
        keys: ["re-centre", "recentre", "recenter", "centre", "center", "follow", "pan"],
        steps: [
          "Drag the chart anywhere — it stays where you put it.",
          "Watch ◉ light up: the map is telling you it has stopped following.",
          "Tap ◉ to centre on yourself again and hand the follow back.",
          "On /m, walk with the joystick — it keeps working over the fullscreen map.",
          "Tap the live 3D window, or press Esc on desktop, to leave the map.",
        ],
        tip:
          "Closing and reopening the map also hands the follow back — ◉ is the way to do it " +
          "without losing your place.",
        media: [
          {
            src: "/guide/fpv-map.webp",
            w: 360,
            h: 783,
            caption:
              "The expanded MAP on /m: MAP and ± pills top-left, the live 3D window top-right, " +
              "the lit ◉ on the right edge after a pan, AIM over WALK on the left rail, your " +
              "focal cone and radar drawn on the chart, and the time strip above the credit line.",
            shell: "mobile",
          },
        ],
      },
      {
        id: "fpv-map-gestures",
        title: "Turn and zoom the MAP",
        where: { desktop: "Wheel · drag", mobile: "Two fingers" },
        keys: ["twist", "rotate", "pinch", "zoom"],
        body:
          "Two fingers TWIST the chart to any bearing — N on the radar rim turns with it, so " +
          "you always know which way is north. The pinch is continuous rather than stepped: " +
          "the chart scales smoothly between levels instead of jumping. On desktop the wheel " +
          "steps whole levels and a drag pans. Tap a body's direction line on the chart to " +
          "make that body the emphasized one in [[target-radar|the radar]].",
        tip:
          "While the chart is turned, the walk stick works SCREEN-relative: push up and you " +
          "walk toward the top of the map, whatever bearing that is on the ground.",
      },
      {
        id: "fpv-height",
        title: "Fix a building's height",
        where: {
          desktop: "Double-click a building (first-person view)",
          mobile: "Double-tap a building",
        },
        body:
          "Map data gets heights wrong; your eyes know better. One drag rescales a building " +
          "between a tenth and ten times its CURRENT height, and repeated edits compound with " +
          "no ceiling. Right-click the armed building (hold it on /m) for the rest of the suite: " +
          "MOVE (up to 100 m per drag from where it stands), ROTATE and SCALE its footprint (a " +
          "tenth to ten times per drag, shown in metres) with a three-axis gizmo, and revert one " +
          "op or all of them. A building carried far from its own map cell can blink out at the " +
          "edge of the view — bring it back or accept it. Edits re-measure every " +
          "[[plan-verdicts|skyline verdict]].",
        keys: ["height", "scale", "rescale", "too short", "too tall", "wrong height", "osm", "sync", "gizmo", "move building", "rotate building"],
        steps: [
          "Double-click a building — it arms with a highlight.",
          "Drag up or down to rescale it — a translucent ghost previews the new height over " +
            "the solid original.",
          "Read the pinned label: the live height, with \"↳ was\" the mapped one.",
          "Right-click it for MOVE / ROTATE / SCALE; the chip lists every op's current and " +
            "original value with a ↺ each — RESET ALL restores the mapped building.",
          "Press SYNC (sign in first) to share your edits with everyone — buildings other " +
            "people edited carry a fainter tint, and hovering one tells you what changed.",
          "Click away, tap away on /m, or press Esc when done.",
        ],
        tip:
          "Unsynced edits live only in this browser; synced ones reach every visitor (last sync " +
          "wins), keyed to the building's map id — most survive a re-bake, one whose shape " +
          "changed can still drop.",
      },
      {
        id: "fpv-models",
        title: "Place your own 3D model",
        where: { desktop: "UPLOAD → drop a GLB, OBJ or FBX" },
        body:
          "Drop a 3D model in the UPLOAD window and it is checked, trimmed to budget and stored " +
          "as a public GLB. Start from a temporary pin's UPLOAD HERE and it stands there at once; " +
          "otherwise press PLACE ON GLOBE and click the ground. In first-person view, right-click " +
          "any model — yours or another member's — for MOVE, ROTATE and SCALE, the same gizmo as " +
          "[[fpv-height|a building edit]]: one drag resizes it between a tenth and ten times its " +
          "current size, repeated edits compound, the SCALE row shows its size in metres, and the " +
          "last edit wins for everyone. ROTATE's green ring turns it and its red and blue rings tip " +
          "and bank it, so a model that arrived on its side stands up. It stands on the terrain until " +
          "MOVE's green arrow lifts or sinks it — it can never sink out of sight, even flipped, and " +
          "[[my-models|your own list]] resets it.",
        keys: ["3d model", "glb", "obj", "fbx", "upload model", "place model", "custom model", "mdl"],
        steps: [
          "Open UPLOAD and drop a .glb, .gltf, .obj or .fbx — textures and a .mtl ride along.",
          "Read the CHECK card: triangles, textures and the guessed source units; pick another unit if the size looks wrong.",
          "Press UPLOAD MODEL (sign in first).",
          "Press PLACE ON GLOBE and click where it should stand.",
          "Enter first-person view near it and right-click it to move, turn, tip, resize, lift or sink it.",
          "Toggle MDL on the camera deck to hide every custom model.",
        ],
        tip:
          "The deck's MDL chip turns amber where models crowd an area — the ones the frame budget " +
          "cannot afford are skipped, nearest first.",
      },
      {
        id: "my-models",
        title: "Manage your models",
        where: { desktop: "MY PINS panel · MODELS tab" },
        keys: ["my models", "rename model", "hide model", "delete model", "models list", "my uploads", "goto model", "reset model"],
        body:
          "Every model you stored is listed under MY PINS · MODELS with its size, its triangle count " +
          "and a badge when another member has edited it. Click a row or GOTO to stand beside the " +
          "model in first-person view, or click an unplaced row to place it. RESET puts a model back " +
          "as uploaded — turn, tilt, size and ground seat — where it stands, even one sunk or lifted by " +
          "someone else. The pencil renames it, HIDE withdraws it from the world and SHOW brings it " +
          "back, and a second press on ✕ deletes it for good. A hidden or deleted model leaves the " +
          "world, not the link — the file itself stays public by URL.",
        steps: [
          "Open MY PINS in the top bar and pick the MODELS tab.",
          "Click a row or GOTO to stand beside the model, or click an unplaced row to give it a spot.",
          "Press RESET to undo every turn, tilt, resize and lift at once.",
          "Press the pencil, type a new name and hit Enter.",
          "Press HIDE to take it out of the world; SHOW returns it.",
          "Press ✕ twice to delete it.",
        ],
        tip:
          "Any signed-in member can move, turn or resize your model in first-person view — the row's " +
          "EDITED badge tells you when someone did.",
      },
      {
        id: "fpv-exit",
        title: "Exit",
        keys: ["leave", "quit", "back", "escape", "exit"],
        where: { desktop: "EXIT LOOK, or press Escape", mobile: "✕ EXIT VIEW chip" },
        body:
          "On desktop you return to the orbit camera above the same spot; on /m you land " +
          "on the flat 2D map, north-up over it.",
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
      w: 640,
      h: 128,
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
        keys: ["scrub", "timeline", "playhead", "cursor", "now", "clock"],
        steps: [
          "Drag the rail — time slides under the fixed centre cursor.",
          "Drag left to go into the future.",
          "Double-click the middle, or press NOW, to return to the present.",
        ],
        tip:
          "Cursor colour tells the state: teal = LIVE, amber = pinned in the past, blue = " +
          "pinned in the future.",
      },
      {
        id: "time-bands",
        title: "Read the light bands",
        keys: ["golden hour", "blue hour", "twilight", "dusk", "dawn", "night", "curve"],
        body:
          "The rail is painted with the day's light, from daylight through to night. The " +
          "curves over it are sun and moon elevation; a tracked target adds its own trace, " +
          "drawn thick where it crosses your current frame. On desktop a tracked " +
          "[[plan-meteors|meteor shower]] adds a rate curve filling its active nights.",
        list: [
          "Daylight.",
          "Golden hour, then blue hour.",
          "Nautical and astronomical twilight.",
          "Night.",
        ],
      },
      {
        id: "time-events",
        title: "Step between events",
        keys: ["sunrise", "sunset", "moonrise", "moonset", "almanac", "next event"],
        body:
          "Tap the rail's outer edges to jump to the next or previous almanac event: " +
          "sunrise and sunset, the golden-hour edges, civil twilight, solar noon, moonrise, " +
          "moonset, moon culmination, and the next full and new moon.",
      },
      {
        id: "time-inputs",
        title: "Set an exact moment",
        where: {
          desktop: "Date and time inputs beside the rail",
          mobile: "Date jump + ◀ ▶ day steppers on the dock",
        },
        keys: ["date", "picker", "calendar", "exact time", "stepper"],
        body:
          "Pick any date, type an exact time, or step by day, hour and minute with the " +
          "◀ ▶ steppers. Focused, the rail answers the arrow keys too: ← and → move 10 " +
          "minutes, Home and End jump 6 hours. On /m the dock carries the same pair — your " +
          "phone's own date picker and its own time picker — so an exact moment takes two " +
          "taps instead of a scrub.",
      },
      {
        id: "time-play",
        title: "Play",
        where: { desktop: "▶ and the speed picker on the rail" },
        keys: ["playback", "speed", "fast forward", "animate", "timelapse"],
        body:
          "PLAY advances scene time at a chosen speed; fast-forward speeds read red. " +
          "Watch a whole night's sky motion in a minute.",
        tip: "PLAY is desktop-only — the /m dock carries the clock and the steppers instead.",
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
      w: 720,
      h: 450,
      caption:
        "The TARGET panel with the moon tracked: the object card, the GOTO · SHOW · MARK · " +
        "TRAIL row, GHOSTS and TRACK, FIND IN FRAME and UNFOLLOW — and the banded direction " +
        "radar on the ground below.",
      shell: "desktop",
    },
    topics: [
      {
        id: "target-search",
        title: "Pick a target",
        keys: ["find object", "catalog", "messier", "ngc", "comet", "asteroid"],
        where: {
          desktop: "Search panel · SKY tab",
          mobile: "SEARCH tab · SKY",
        },
        body:
          "Sun, moon, planets, 451 named stars, the constellations, Messier and NGC " +
          "objects, bright comets and asteroids, the Galactic Centre. Typos are fine, and " +
          "picking a result tracks it. Standing in the landscape ([[fpv]]) the camera also " +
          "turns to it when it is above the horizon; on the globe or the flat map nothing moves.",
      },
      {
        id: "target-card",
        title: "Read the object card",
        keys: ["magnitude", "altitude", "azimuth", "phase", "distance", "rise", "set"],
        where: { desktop: "TARGET panel, top-right", mobile: "Tap the target row above the dock" },
        body:
          "On desktop: altitude and azimuth, celestial coordinates, distance, magnitude with " +
          "a naked-eye verdict, phase and true disc size; on /m the card keeps the " +
          "essentials. NEXT SESSIONS lists the coming dark-sky windows — press one to pin " +
          "scene time to its peak. Track the sun or the moon and the card grows an " +
          "[[target-eclipses|ECLIPSES]] section. Rise and set jumps live in " +
          "[[target-menu|the sky menu]].",
      },
      {
        id: "target-eclipses",
        title: "Eclipses",
        where: {
          desktop: "ECLIPSES, in the TARGET panel — with the sun or the moon tracked",
          mobile: "The same section on the target sheet",
        },
        keys: ["eclipse", "totality", "annular", "obscuration", "umbra"],
        body:
          "Track the sun and the card lists the coming SOLAR eclipses as they will happen from " +
          "where you stand; track the moon and it lists the lunar ones. Five rows on desktop, " +
          "four on the phone. A NOW line appears above them whenever scene time is inside an " +
          "eclipse, reading the live phase and coverage. Press a row and scene time flies to " +
          "greatest eclipse.",
        list: [
          "The date, carrying its year — the eclipses ahead at one site can span decades.",
          "The phase: TOTAL, ANNULAR, PARTIAL or PENUMBRAL.",
          "How much of the disc is covered, and a dash for a penumbral one, which covers none.",
          "The clock time of greatest eclipse, and how high the body stands then.",
          "SETS MID-ECLIPSE, or BELOW HORIZON when it is not an event you can watch from here.",
        ],
        tip:
          "A solar eclipse is a different event a hundred kilometres away, so those rows are " +
          "computed for your anchor. A lunar one is the same for everyone on the night side.",
      },
      {
        id: "target-eclipse-scene",
        title: "What an eclipse does to the scene",
        keys: ["corona", "chromosphere", "blood moon", "darkening", "shadow"],
        body:
          "There is no eclipse toggle. The darkness comes from the same sun and moon positions " +
          "the scene already draws with, so flying scene time into one changes the light " +
          "everywhere at once. Daylight holds through the partial phases and collapses in the " +
          "last minute, the way a real one is experienced, and totality reads as a deep, strange " +
          "twilight rather than as night.",
        list: [
          "The corona appears only once the last sliver of the sun is covered, and never in an " +
            "annular eclipse, where the ring stays.",
          "A pink chromosphere hairline sits on the limb through totality.",
          "Stars come out over the final stretch — the bright ones only, because the sky is still " +
            "lit for hundreds of kilometres around.",
          "An eclipsed moon goes copper inside the Earth's shadow, brightest and most orange " +
            "along the shadow's edge.",
          "A penumbral eclipse is a faint dimming, as subtle here as it is overhead.",
        ],
        tip:
          "Press a totality on the [[target-eclipses|eclipse list]], stand under it in " +
          "[[fpv|first-person view]], then [[time-play|play]] the sequence.",
      },
      {
        id: "target-toggles",
        title: "The action row",
        where: { desktop: "Under the object card in the TARGET panel", mobile: "On the target sheet" },
        keys: ["goto", "show", "mark", "trail", "ghosts", "track", "pills", "buttons"],
        body:
          "One row of pills drives everything the tracked target draws. MARK, TRAIL and " +
          "GHOSTS need SHOW on — without a marker there is nothing to decorate.",
        list: [
          "GOTO — aim the camera at it; below the horizon it looks where it next rises. " +
            "Desktop only.",
          "SHOW — draw the marker.",
          "MARK — highlight it.",
          "TRAIL — draw its day-arc across the sky.",
          "GHOSTS — add its [[target-ghosts|time-ghost chain]].",
          "TRACK — [[target-track|lock the camera]] on it.",
        ],
      },
      {
        id: "target-ghosts",
        title: "Time ghosts",
        keys: ["ghosting", "time steps", "chain", "copies"],
        body:
          "GHOSTS ± N EVERY step surrounds the real body with translucent copies of " +
          "itself at fixed time steps — up to 15 per side, the past side dimmed. One " +
          "glance shows where it came from and where it goes next.",
      },
      {
        id: "target-track",
        title: "TRACK — the camera lock",
        keys: ["lock", "follow", "glue", "camera lock"],
        body:
          "With TRACK on, the camera stays glued to the target while time scrubs or " +
          "plays — while you stand in the landscape ([[fpv]]). On the globe or the flat map " +
          "the toggle only arms the lock for your next LOOK FROM HERE. A deliberate look-drag releases it, so the lock never fights your hand; " +
          "it also releases when the target sinks below the horizon.",
      },
      {
        id: "target-radar",
        title: "The direction radar",
        where: {
          desktop: "AIM on the camera deck",
          mobile: "∠ RADAR under ⊞ LAYERS",
        },
        body:
          "Concentric bands around where you stand — moon innermost, then sun, then your " +
          "target — each a rise→set ground sector with a direction line. The swept part " +
          "is grey; what is still to come wears the body's own ink (gold sun, silver " +
          "moon, blue target), split at scene time. N marks north on the rim, and a band " +
          "BREAKS where buildings or terrain hide that body. The sky menu's ∠ DIRECTION " +
          "rows toggle single bodies, and on the flat chart tapping a body's direction line " +
          "makes that body the emphasized one.",
        tip:
          "On desktop the radar appears below about 10 km of altitude — climb higher and it " +
          "stands down. On /m it draws smaller and the bands sit closer in, so it reads " +
          "against a phone screen without swallowing the map.",
      },
      {
        id: "target-menu",
        title: "The sky context menu",
        where: {
          desktop: "Right-click a body in the sky",
          mobile: "Long-press a body",
        },
        keys: ["right click", "context menu", "long press", "quick menu"],
        body:
          "The fastest path to everything a body can do. Active rows flip to DISABLE " +
          "TRACKING, DISABLE TRAIL and so on, and the moon's header shows its illuminated " +
          "percentage.",
        list: [
          "⌖ TRACK it — the row reads TARGET PANEL once it already is the target.",
          "⊕ TRACKING, ◌ MARK, ∿ TRAIL, ✧ GHOSTS — the same toggles as " +
            "[[target-toggles|the action row]] — plus ∠ SUN / MOON / TARGET DIRECTION, " +
            "which arms that one body's [[target-radar|radar band]].",
          "⌖ FIND IN FRAME — run a [[find|FIND]] scan on it.",
          "◎ AIM HERE — point the camera at it.",
          "Its rise and set — jump time to either; for the sun and the moon the camera turns there too.",
        ],
        media: [
          {
            src: "/guide/skymenu.webp",
            w: 720,
            h: 450,
            caption: "Right-click on the moon: quick toggles plus rise/set jumps.",
            shell: "desktop",
          },
        ],
      },
      {
        id: "target-unfollow",
        title: "UNFOLLOW",
        where: {
          desktop: "✕ UNFOLLOW under ⌖ FIND IN FRAME in the TARGET panel",
          mobile: "✕ UNFOLLOW on the target sheet",
        },
        keys: ["stop following", "clear target", "dismiss", "untrack", "drop"],
        body: "One press clears everything the target was drawing, and the camera is yours again.",
        list: [
          "Its marker in the sky.",
          "Its trail.",
          "Its line on [[target-radar|the radar]].",
          "The peek row above the dock.",
          "Its chip in [[find|FIND]].",
        ],
        tip:
          "Dismissal lasts the session — a reload brings the target back. Search or the " +
          "sky menu re-follows at any time.",
      },
      {
        id: "target-hover",
        title: "Names in the sky",
        keys: ["names", "labels", "identify", "what is that", "reticle"],
        body:
          "Hover the sun, the moon or your tracked target and it brightens under the " +
          "cursor. At night the stars name themselves too — star, asterism and " +
          "constellation. On /m, tap empty sky to reveal names for a couple of seconds.",
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
      w: 640,
      h: 700,
      caption:
        "The LIGHT PLANNER window: skyline verdicts on top, then the day's chronology, " +
        "moon calendar, meteors and star-exposure cards.",
      shell: "desktop",
    },
    topics: [
      {
        id: "plan-open",
        title: "Open it",
        keys: ["open plan", "window", "resize", "drag"],
        where: {
          desktop: "The ☀ PLAN · ⌖ FIND IN FRAME · ◎ BEST SPOT toggle beside the Plux wordmark",
          mobile: "PLAN tab",
        },
        body:
          "PLAN, [[find|FIND]] and [[bestspot|BEST SPOT]] are three faces of one window: drag it " +
          "by the grip, resize it by the ◢ corner, double-click the corner to reset, × to close. " +
          "It keeps its place and its size across every switch.",
      },
      {
        id: "plan-verdicts",
        title: "Skyline verdicts",
        keys: ["clear", "behind skyline", "blocked", "obstruction", "horizon"],
        body:
          "Sun, moon and target rows read CLEAR or BEHIND SKYLINE against the actual " +
          "horizon profile from where you stand, with the exact times they clear or hide. " +
          "A trust line reports how much skyline is mapped and to what distance.",
        tip:
          "Verdicts read from your feet in first-person view, or from a placed photo. " +
          "A planning pin alone gives none until you stand on it.",
      },
      {
        id: "plan-frame",
        title: "THIS FRAME · NEXT 36 H",
        where: { desktop: "Top card in PLAN", mobile: "PLAN sheet, first card" },
        keys: ["36h", "36 hours", "next 36", "crossing", "frame crossing"],
        body:
          "In first-person view only: when will each body next cross the frame you are " +
          "composing right now? Rows carry the crossing window, the light phase, a skyline " +
          "verdict and a jump chip; on desktop they also carry a calendar export.",
      },
      {
        id: "plan-today",
        title: "TODAY",
        keys: ["chronology", "day", "timeline", "events"],
        body:
          "The day's full chronology, midnight to midnight — rises, sets, twilights, " +
          "with light-phase dots. Click a row to jump time to it.",
      },
      {
        id: "plan-moon",
        title: "MOON · PHASES & DISTANCES",
        keys: ["phases", "supermoon", "perigee", "apogee", "disc size"],
        body:
          "Quarters, perigees and apogees ahead, each with its apparent disc size, and " +
          "supermoon rows starred. When the next supermoon falls past the end of the list, " +
          "a ★ SUPERMOON chip appears — click it to jump there.",
      },
      {
        id: "plan-npf",
        title: "SPOT STARS — sharp star exposure",
        keys: ["npf", "exposure", "shutter", "star trails", "sharp stars", "aperture"],
        body:
          "In first-person view, the card computes the longest exposure that keeps stars " +
          "as points (the NPF rule) for the exact patch of sky you frame. Enter your " +
          "aperture and pixel pitch; declination comes from the frame itself.",
      },
      {
        id: "plan-mw",
        title: "Milky-Way season",
        where: { desktop: "The MILKY WAY card in PLAN" },
        keys: ["milkyway", "galactic core", "galaxy", "core season", "dark sky"],
        body:
          "Per-night windows when the galactic core stands in dark sky, scored by " +
          "darkness against moon interference. Click a window to jump to its peak. " +
          "Tracking the Galactic Centre also draws the galactic-equator guide — a centre line " +
          "with two edge circles — over the Milky Way the sky already shows.",
        tip: "This card is desktop-only.",
      },
      {
        id: "plan-meteors",
        title: "METEORS — peak nights",
        keys: ["shower", "zhr", "perseids", "radiant", "hourly rate"],
        where: { desktop: "The METEORS card in PLAN" },
        body:
          "The METEORS · PEAK NIGHTS · NEXT 120D card scores each shower's maximum " +
          "against the moon: expected hourly rate, best hour, and how much moonlight washes " +
          "the night out. Search " +
          "a shower by name (☄ rows) and track it — the marker stands on the radiant, " +
          "THE SHOWER facts read ZHR and speed, and the [[time-bands|time rail]] fills " +
          "its nights with the rate curve.",
        tip:
          "The card lists coming maxima only — a shower past its peak has no row even " +
          "while it is still active.",
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
      w: 720,
      h: 450,
      caption:
        "FIND with the moon: the standings list on the left, each day projected into the " +
        "sky as a dated ring with that day's phase.",
      shell: "desktop",
    },
    topics: [
      {
        id: "find-concept",
        title: "The frame is the query",
        keys: ["query", "composition", "scan", "how find works"],
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
        keys: ["1w", "1m", "6m", "1y", "range", "chips", "week", "month", "year"],
        body:
          "One row of chips sets the question: the bodies on the left, the range on the " +
          "right. Your choices stick, and tracking the sun or the moon itself switches the " +
          "target chip off, because its own chip already covers it.",
        list: [
          "☀ SUN and ☾ MOON — moon alone is the default.",
          "Your tracked target — whatever the search or the sky menu follows: the " +
            "Milky-Way core, a comet, a nebula.",
          "Range: 1W, 1M, 6M, 1Y.",
        ],
      },
      {
        id: "find-standings",
        title: "Read the standings",
        keys: ["results", "list", "rows", "days", "score", "verdict"],
        body:
          "One row per qualifying day. Hover a row and its sky ring pulses; hover a ring " +
          "and its row lights up.",
        list: [
          "Its identity colour, matching its ring in the sky.",
          "The date.",
          "Where in the frame the body stands.",
          "A CLEAR or ✕ skyline verdict.",
          "A visibility score.",
        ],
      },
      {
        id: "find-ghosts",
        title: "Ghosts in the frame",
        keys: ["rings", "ghosting", "projection", "overlay", "preview"],
        body:
          "The first 24 listed days project into the sky as a small stack of marks; on " +
          "desktop, rows past that stay listed with a hollow swatch.",
        list: [
          "A hairline ring in the day's colour.",
          "A translucent picture of the body, wearing that day's real phase.",
          "Its day-arc path.",
          "A date label — the moon's adds its illuminated percentage.",
        ],
      },
      {
        id: "find-jump",
        title: "Click a day — time jumps, camera stays",
        keys: ["jump", "click a day", "time travel"],
        body:
          "Click a ring or a row: scene time jumps to that instant and the body becomes " +
          "the tracked target. The camera does not move — the real body arrives exactly " +
          "where its ghost stood, inside your unchanged composition.",
      },
      {
        id: "find-sunsets",
        title: "SUNSETS · IN FRAME",
        where: {
          desktop: "Below the standings in FIND",
          mobile: "SUNSETS IN FRAME, in the PLAN sheet",
        },
        keys: ["sunset", "sunrise", "golden hour", "drift", "solstice", "horizon"],
        body:
          "An event-anchored list: on which days does the sunset itself land inside the " +
          "frame? Chips switch SET, RISE and golden hour. Each row carries the exact time, " +
          "a skyline verdict and the drift in degrees per day along your skyline; on " +
          "desktop it also carries a calendar export.",
        tip:
          "Times are true almanac times. A season's sunsets walk along the horizon and " +
          "turn around at the solstices — dates far apart can share one spot.",
        media: [
          {
            src: "/guide/sunsets.webp",
            w: 320,
            h: 640,
            caption: "Sunset standings: date, time, verdict and per-day drift.",
            shell: "desktop",
          },
        ],
      },
      {
        id: "find-mobile",
        title: "FIND on the phone",
        keys: ["find tab", "phone", "fourth tab"],
        where: { mobile: "FIND tab — the third tab" },
        body:
          "The same scan at touch scale. Collapsing the sheet keeps the standings " +
          "projected in the frame, so you can compose against them full-screen.",
      },
    ],
  },

  // ————————————————————————————————————————————————————— WHERE TO STAND
  {
    id: "bestspot",
    title: "BEST SPOT",
    lead:
      "PLAN and FIND answer for the spot you are already on. BEST SPOT answers where to go " +
      "instead — pick a sunrise, sunset, moonrise or moonset, and every patch of ground around " +
      "you is scored for how good a place it is to watch it from.",
    topics: [
      {
        id: "spot-open",
        title: "Solve a disc",
        where: { desktop: "◎ BEST SPOT, beside the Plux wordmark" },
        keys: ["heatmap", "heat map", "where to stand", "best place", "disc"],
        body:
          "The window opens with the heatmap OFF and nothing being computed, so you can set the " +
          "event, the radius and the sheet height before anything is solved. ◎ HEATMAP is the " +
          "switch that starts the work. BEST SPOT is desktop only.",
        steps: [
          "Press ◎ BEST SPOT beside the Plux wordmark — it shares one window with [[plan|PLAN]] " +
            "and [[find|FIND]].",
          "Double-click the ground to set the disc centre, or stand somewhere in " +
            "[[fpv|first-person view]].",
          "Pick the event: ☀ SUNRISE, ☀ SUNSET, ☾ M.RISE or ☾ M.SET.",
          "Pick a radius — 100 m to 500 m, 300 m by default.",
          "Press ◎ HEATMAP — a coarse wash appears at once and sharpens over about a second.",
        ],
        tip:
          "Turned on before you have a centre, the chip reads ARMED — NO CENTRE. Drop the pin and " +
          "it solves.",
      },
      {
        id: "spot-read",
        title: "Read the wash",
        keys: ["colours", "ramp", "contours", "inferno", "hatch"],
        body:
          "Colour is the score: dark ground is a poor place to stand, bright ground a good one. " +
          "Contour lines run along equal scores, and the two the legend labels are drawn heavier. " +
          "A street-level disc in a city comes out mostly black, which is the true answer — at " +
          "eye height a skyline hides the event from nearly everywhere, and the eight markers are " +
          "what you came for.",
        list: [
          "The SCORE ramp — the absolute score, with its floor and ceiling printed at the ends.",
          "Contours — one line per step of score, thicker at the two labelled values.",
          "A moving dotted hatch — UNMAPPED. Nobody looked there, so it is left uncoloured.",
          "A flat dim with no hue — CAN'T STAND HERE: a roof, a wall, water.",
          "A rim that dissolves instead of ending on a line — the disc edge is a compute budget, " +
            "not a finding.",
        ],
        tip:
          "[INFERNO] swaps to [TURBO] and back. TURBO's brightest band sits mid-scale, so under " +
          "it the best spot comes out dark red.",
      },
      {
        id: "spot-markers",
        title: "The eight markers",
        keys: ["eight markers", "eight best", "ranked cells", "swatch"],
        body:
          "The eight best cells stand on the globe as numbered markers, kept at least 25 m apart " +
          "so they land on eight different places instead of eight cells of the same good patch. " +
          "Their colour carries two readings at once, and the MARKERS legend says which is which.",
        list: [
          "HUE spreads these eight across the whole ramp — #1 at the bright end, #8 at the dim " +
            "one — so close scores are still told apart.",
          "BRIGHTNESS is the absolute score, so eight faint markers mean eight poor spots, " +
            "however colourful they are.",
        ],
        tip:
          "Hover a marker and a tip opens at it with the same facts its row prints, so you can " +
          "read #4 without hunting the list for it.",
      },
      {
        id: "spot-shortlist",
        title: "Read the shortlist",
        keys: ["graze", "gap", "open horizon", "lead time", "rank"],
        body:
          "BEST SPOTS lists those eight as rows, and every row says why that cell earned its " +
          "place. The number beside the bar is the ABSOLUTE score; the bar is only that row " +
          "against the best of these eight, so a full bar on a poor disc is still a poor spot.",
        list: [
          "Its rank, and its absolute score.",
          "A bar — the score divided by the best score in this shortlist.",
          "How far away it is, and on what bearing.",
          "GRAZE, GAP or OPEN HORIZON — what the skyline does on the contact bearing.",
          "A lead like +3m20s — how far from the event instant that cell frames it best.",
        ],
        tip:
          "The list stays inert and reads RANKING… until the finest pass lands. A coarse pass " +
          "gets the field right but shuffles which eight cells come out on top.",
      },
      {
        id: "spot-actions",
        title: "GO, LOOK and REFINE",
        keys: ["go there", "refine", "select", "preview", "look from"],
        body:
          "Click a row to select it — its marker lights up on the globe and three actions appear " +
          "beside it. Selecting moves nothing on its own, because moving the centre re-solves the " +
          "disc and would destroy the list you are reading.",
        list: [
          "GO → moves the disc centre to that cell. This is the one action that re-solves the " +
            "heatmap.",
          "◎ LOOK stands you there in first person with the disc left where it is — ◎ BACK or " +
            "Escape returns.",
          "◠ REFINE re-solves that ONE cell's obstruction at 1 m and prints what it moved.",
        ],
        tip:
          "NO CHANGE at 1 m means the coarse pass was already right about that cell — the button " +
          "worked, the answer held.",
      },
      {
        id: "spot-altitude",
        title: "Lift the sheet",
        where: { desktop: "SHEET ALTITUDE, under the radius chips" },
        keys: ["drone", "aerial", "lift", "eye level"],
        body:
          "The sheet sits at eye height, 1.7 m, and the slider raises it to 400 m. At 5 m the " +
          "badge reads ▲ DRONE and the rules change: only the solid interiors of buildings stay " +
          "masked, because up there you are no longer walking. Double-click the slider to drop " +
          "back to eye level.",
        tip:
          "When a disc is too dark to read, a chip offers the lowest lift that clears the display " +
          "floor — that number is probed on your disc, never a preset.",
      },
      {
        id: "spot-honesty",
        title: "What the status lines admit",
        keys: ["coverage", "unmapped", "evidence", "provenance", "posting"],
        body:
          "Under the legend sits a block of status lines. Each names a limit of the evidence " +
          "rather than a property of the place, so you can tell how far the wash can be trusted.",
        list: [
          "How much of the disc is UNMAPPED, and the coverage figure.",
          "The cell size the obstruction was solved at, and the finer one the shortlist used.",
          "The terrain posting under this disc — usually far coarser than the cells drawn on it.",
          "That a vertical building edge resolves to about half a solar disc.",
          "That landcover edges carry a one-to-two-cell ribbon, because map lines are generalised.",
          "How far the evidence reaches, and that past it everything is unknown.",
          "Where the building heights came from — surveyed, or map-derived with class defaults — " +
            "and that the trees are modelled rather than surveyed.",
        ],
        tip:
          "There is no single resolution to quote. Obstruction, accessibility, terrain and " +
          "landcover each resolve at their own scale, and all four are printed.",
      },
      {
        id: "spot-limits",
        title: "When it refuses",
        keys: ["rural", "no buildings", "tropics", "nothing found", "warning"],
        body:
          "Some discs have no honest score, and the panel names the reason rather than painting " +
          "over the gap.",
        list: [
          "⚠ RURAL — TERRAIN ONLY: too few mapped buildings here, so the score is terrain alone.",
          "⚠ NO BUILDING GEOMETRY REACHED THIS DISC: the buildings are mapped but none arrived. " +
            "Turn the BLD toggle on, or wait for the tiles.",
          "⚠ NO RISE/SET SOLUTION AT THIS LATITUDE ON THIS DATE: a tropics case, where the " +
            "azimuth barely moves along the horizon.",
          "Nothing above the floor: try another event, a wider radius, or the lift.",
        ],
        tip:
          "That building warning names ▦ 3D DETAIL, which is the phone's label for the layer. On " +
          "the desktop deck beside this window, the same toggle is BLD.",
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
        keys: ["url", "share", "link", "address bar", "copy"],
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
        keys: ["bookmark", "viewpoint", "save view", "save place", "favourite"],
        body:
          "Saving bookmarks the full viewpoint, pinned time included. Both shells ask for " +
          "an optional name first. Leave it empty and desktop files it as \"Untitled " +
          "place\", while /m stamps it with the view and the moment.",
      },
      {
        id: "save-places",
        title: "Return to a place",
        where: {
          desktop: "MY PINS panel · PLACES tab",
          mobile: "▤ SAVED PLACES chip, or the SEARCH tab's idle list",
        },
        keys: ["my places", "saved", "bookmarks", "list", "delete"],
        body:
          "Tap a saved place and Plux restores the moment first, then the exact " +
          "viewpoint. Both lists sort nearest-first from where you stand. Deleting lives " +
          "on the desktop list.",
        tip:
          "There is no rename — a place keeps the name you gave it when you saved it, so " +
          "name it then.",
      },
      {
        id: "save-onmap",
        title: "Your places on the map",
        keys: ["markers", "dots", "places on map", "lavender"],
        where: {
          desktop: "PLC on the camera deck",
          mobile: "◎ MY PLACES under ⊞ LAYERS",
        },
        body:
          "Signed in, your saved views draw as lavender dots on the globe and on " +
          "[[fpv-map|the 2D map]] — a private constellation of viewpoints. New saves " +
          "appear at once; deleting removes them everywhere.",
      },
      {
        id: "save-ics",
        title: "Export to your calendar",
        where: { desktop: "The calendar chip on a PLAN or FIND row" },
        keys: ["ics", "calendar", "export", "reminder", "event", "download"],
        body:
          "Rows across [[plan|PLAN]] and [[find|FIND]] — frame crossings, moon events, " +
          "standings, sunsets — carry a calendar chip that downloads an .ics event for " +
          "that instant.",
        tip: "Calendar export is desktop-only; the /m rows jump time instead.",
      },
      {
        id: "save-signin",
        title: "Sign in",
        keys: ["login", "log in", "account", "sign up", "member", "register"],
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
      "Plux also projects real photographs. Drop in a camera file and it stands as a frame " +
      "at its true capture spot, with the scene rebuilt in the light it was made in.",
    media: {
      src: "/guide/upload.webp",
      w: 720,
      h: 673,
      caption:
        "The upload drop zone: the RAW and image formats it decodes, and the promise that " +
        "files stay private until you place them.",
      shell: "desktop",
    },
    topics: [
      {
        id: "photo-upload",
        title: "Upload",
        keys: ["exif", "raw", "arw", "cr3", "dng", "nef", "heic", "jpeg", "import", "decode"],
        where: { desktop: "Upload, in the nav" },
        body:
          "Drop a camera file — RAW (ARW, CR3, DNG, NEF…), HEIC or JPEG. Decoding happens " +
          "in your browser; nothing uploads until you choose to save. EXIF supplies the " +
          "where and when, and the photo rises as a camera frustum at its capture spot.",
        tip: "No GPS in the file? Press SET ON GLOBE, then click the capture spot.",
      },
      {
        id: "photo-align",
        title: "Align it",
        keys: ["heading", "pitch", "nudge", "calibrate", "opacity", "projection"],
        body:
          "Cameras rarely record which way they pointed. Swing heading and pitch on the " +
          "encoder knobs — push and hold to turn, let go and they ease to a stop — then pull " +
          "the focal and altitude sliders until the projected frame locks onto the real " +
          "terrain and buildings. Every change re-projects live, and PLANE ALPHA blends the " +
          "photo against the scene. Pin the clock to the capture time to study its light.",
      },
      {
        id: "photo-fpv",
        title: "Stand inside the shot",
        keys: ["view from camera", "eyepoint", "stand inside"],
        body:
          "VIEW FROM CAMERA enters [[fpv|first-person view]] at the photo's exact " +
          "eyepoint and focal length — then [[find|FIND]] and [[plan|PLAN]] answer for " +
          "that framing: when does the moon return to this composition?",
      },
      {
        id: "photo-pins",
        title: "Pins and publishing",
        keys: ["quota", "publish", "public", "private", "premium"],
        body:
          "Members save photo pins — 100 on the free tier, 1,000 with premium. A public " +
          "pin joins the shared globe for everyone; location precision is yours to choose " +
          "([[trust-privacy|privacy]]).",
      },
      {
        id: "photo-market",
        title: "Marketplace",
        where: { desktop: "Marketplace, in the nav" },
        keys: ["sell", "buy", "shop", "store", "price", "checkout", "market"],
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
      w: 360,
      h: 783,
      caption:
        "The /m shell on its flat chart: status strip on top, action chips and LAYERS on " +
        "the right, radar bearings on the map, target row, time dock and tabs at the bottom.",
      shell: "mobile",
    },
    topics: [
      {
        id: "mobile-map",
        title: "The flat chart",
        where: { mobile: "The shell starts here" },
        keys: ["2d", "flat", "north up", "android", "tablet", "ipad"],
        body:
          "/m boots as a flat, north-up 2D chart — faster and calmer for planning on a " +
          "phone. The ▲ 3D chip lifts it into the full 3D globe (long-press it to stand " +
          "straight into first-person view right where the chart is centred); ▼ 2D folds " +
          "it flat again. A two-finger drag TURNS the chart, and it keeps the bearing you " +
          "leave it on — to face north again, tap ▲ 3D then ▼ 2D. 🧭 MY LOC flies the " +
          "chart to your device fix and arms ◎ LOOK FROM HERE.",
        tip:
          "Buildings exist only in 3D — ▦ 3D DETAIL stands down while the chart is flat, " +
          "which is also why the chart shows satellite imagery as photographed and one zoom " +
          "level deeper than the globe.",
      },
      {
        id: "mobile-layout",
        title: "The layout",
        keys: ["strip", "dock", "tabs", "tab bar", "chrome", "status bar"],
        body: "Two strips carry the chrome, and the globe fills everything between them.",
        list: [
          "Top: the Plux mark, your account chip, a GUIDE chip and the DESKTOP switch.",
          "The tracked target row — tap it for the full card.",
          "The time dock — day steppers, the calendar, the scene-time clock and NOW.",
          "The SCENE · PLAN · FIND · SEARCH tabs.",
        ],
      },
      {
        id: "mobile-sheets",
        title: "Sheets",
        keys: ["bottom sheet", "drawer", "scrim", "close"],
        body:
          "Tabs open bottom sheets. Every one carries a ✕, a pull-down handle and a dark " +
          "scrim — any of the three closes it. SEARCH and GUIDE open near full height, " +
          "because a keyboard eats the lower half of the screen.",
      },
      {
        id: "mobile-chips",
        title: "Scene chips",
        keys: ["buttons", "right rail", "actions", "layers", "toggles"],
        body:
          "The right-edge stack adapts to what you are doing, so you only ever see the " +
          "chips that apply right now.",
        list: [
          "🧭 MY LOC — fly the chart to your device fix.",
          "▲ 3D / ▼ 2D — lift the chart into the globe, or fold it flat.",
          "◎ LOOK FROM HERE — [[fpv-enter|stand at the pin you dropped]].",
          "◎ SAVE VIEW and ▤ SAVED PLACES, for members. Signed out, ◎ SIGN IN TO SAVE " +
            "stands in their place.",
          "✕ CLEAR PIN and ✕ EXIT VIEW.",
          "A micro-compass with your altitude.",
        ],
        tip:
          "⊞ LAYERS expands to the left with ▦ 3D DETAIL, ◎ MY PLACES, ⌖ PHOTO PINS, " +
          "∠ RADAR and ▤ VECTOR. It stands down in first-person view.",
      },
      {
        id: "mobile-gestures",
        title: "Touch gestures",
        keys: ["long press", "tap", "pinch", "two finger", "double tap", "swipe"],
        // A REFERENCE, not a procedure — these were an <ol> promising an order that never
        // existed (G-B/G-H 2026-08-22g). As a list they also escape the 6-step cap, which is
        // what made the old copy cram three gestures into one line.
        list: [
          "Long-press the ground — a planning pin.",
          "Long-press a sky body — the context menu.",
          "Tap empty sky at night — names appear for a moment.",
          "Two-finger drag on the flat chart — turn the map.",
          "Long-press ▲ 3D — stand straight into first-person view, no pin needed.",
          "Long-press the full MAP — drop a point there, and the map stays open.",
          "In first-person view, the joystick walks and one finger looks.",
          "In first-person view, pinch zooms the focal length.",
          "In first-person view, double-tap a building to [[fpv-height|edit its height]].",
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
      "Real ephemeris, real skylines, and an honest label wherever a number is a model " +
      "rather than a measurement.",
    topics: [
      {
        id: "trust-accuracy",
        title: "How precise is it",
        keys: ["precision", "arcminute", "error", "how accurate", "model"],
        body:
          "Positions come from a professional ephemeris engine, accurate to about one " +
          "arcminute. Skyline verdicts measure the actual rendered terrain and buildings. " +
          "Sky markers draw at a readable size — the marker is stylized, the numbers " +
          "behind it are not. Comet and asteroid magnitudes are labelled as models: " +
          "brightness forecasting carries real uncertainty. Building heights you " +
          "[[fpv-height|edit]] apply only in your browser — verdicts then measure the " +
          "edited skyline.",
      },
      {
        id: "trust-detail",
        title: "Where the model goes deepest",
        keys: ["dnipro", "everest", "st albans"],
        body:
          "Buildings and terrain come from open map data everywhere on Earth, and three places " +
          "carry a purpose-built model on top of that: Dnipro, St Albans, and the Khumbu " +
          "around Everest. The first two get roof shapes and building parts, where elsewhere " +
          "a footprint is raised to its mapped height. Dnipro and Everest also carry their own " +
          "30 m elevation patch. The right model loads on its own when you fly there — there " +
          "is nothing to choose.",
        tip:
          "Everest is terrain only, and deliberately so: no building bake exists for the Khumbu. " +
          "Stand on the summit and read the light instead.",
      },
      {
        id: "trust-airless",
        title: "Printed times vs the drawn sky",
        keys: ["refraction", "almanac", "airless", "offset", "printed time"],
        body:
          "Event times are true almanac times, refraction included — trust them for the " +
          "field. The drawn scene is an airless sky by convention, so the rendered sunset " +
          "touches the horizon a few minutes before the printed time. The numbers are " +
          "right; the drawing is the instrument.",
      },
      {
        id: "trust-privacy",
        title: "Location privacy",
        keys: ["privacy", "gps", "location", "reduced precision", "geohash", "safety"],
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
