/**
 * FAQ content — the sections the floating FAQ panel (Faq.tsx) renders. Kept as a plain data
 * file so copy edits never touch panel logic. Images are pre-compressed webp under
 * `public/faq/` (added to scripts/warm-prod-assets.mjs — every release resets the asset edge
 * cache cold, the 2026-07-16 outage lesson). An absent `image` renders a text-only section.
 */

export interface FaqSection {
  id: string;
  title: string;
  body: string;
  /** Path under public/, e.g. "/faq/upload.webp". */
  image?: string;
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "upload",
    title: "Upload a photo — RAW to globe",
    image: "/faq/upload.webp",
    body:
      "Drop a camera file — RAW (ARW, CR3, DNG, NEF…), HEIC or JPEG. Everything decodes in " +
      "your browser; nothing uploads until you choose to save. EXIF supplies the where and " +
      "when — GPS, capture time, focal length, sensor — and the photo is projected as a " +
      "camera frustum standing at its real capture spot. No GPS in the file? Double-click " +
      "anywhere on the globe and upload from there.",
  },
  {
    id: "nudge",
    title: "Nudge to align",
    image: "/faq/nudge.webp",
    body:
      "Cameras rarely record which way they pointed. Use the sliders — heading, pitch, " +
      "altitude, focal — to nudge the projected frame until it locks onto the real 3D " +
      "buildings and terrain. The field of view derives live from focal length × sensor " +
      "width, and every tweak re-projects in real time.",
  },
  {
    id: "time",
    title: "Time scrubbing & the real sky",
    image: "/faq/time.webp",
    body:
      "The scene runs on real ephemeris: sun, moon, 9,000 catalog stars and the Milky Way sit " +
      "at their true positions for the scene time. Scrub ±12 hours or pick any date — golden " +
      "hour, the terminator, city lights and moon phase all follow. Pin the clock to your " +
      "photo's capture time to study the light it was made in.",
  },
  {
    id: "fpv",
    title: "Standing in the photographer's boots",
    image: "/faq/fpv.webp",
    body:
      "VIEW FROM CAMERA puts you at the exact eyepoint, at the photo's own field of view — " +
      "drag to look around, scroll to change focal. Turn on the sky guides to overlay the " +
      "sun and moon day-arcs for that spot: plan tomorrow evening's shot from inside " +
      "today's frame.",
  },
  {
    id: "pins",
    title: "Pins, places & sharing",
    image: "/faq/pins.webp",
    body:
      "Sign in to save pins — 100 on the free tier. Make a pin public and it joins the " +
      "shared globe for everyone. The address bar carries the exact camera pose (#p=…): " +
      "copy the URL to share any view, pin or photo alignment exactly as you see it.",
  },
  {
    id: "market",
    title: "Marketplace & premium",
    image: "/faq/market.webp",
    body:
      "Any public pin with a stored original can be listed for sale at your price. Buyers " +
      "pay through the site's checkout and receive a secure 30-day download link for the " +
      "full-resolution original once payment is confirmed. Premium (a one-time upgrade) " +
      "raises your pin quota from 100 to 1,000.",
  },
  {
    id: "privacy",
    title: "Location privacy",
    body:
      "Wartime-aware by design: a public pin publishes reduced precision by default — the " +
      "centre of its ~1 km cell, or just the city. Exact GPS never leaves your private " +
      "record unless you explicitly opt that pin into exact placement. Originals stay " +
      "private; only a completed purchase delivers one.",
  },
];
