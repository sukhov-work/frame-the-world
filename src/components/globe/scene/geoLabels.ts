import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { geodeticToEcef } from "../../../lib/geo/projection";
import { LABELS } from "../tuning";

/**
 * Geo labels + country boundaries (Phase 5.5 S7b, §Item 2b) — the mid-zoom map layer.
 *
 * Natural Earth 50m data baked by scripts/build-ne-labels.mjs (public domain; credit in the DOM
 * line). Two halves, one altitude window (LABELS.minAltM..maxAltM with a fade ramp at each edge —
 * gone at LEO where the stylized base owns the view, gone at street level where the drape does):
 *
 *  • Boundaries — ONE LineSegments on the ellipsoid, lifted LABELS.boundaryLiftM so terrain never
 *    z-eats it. Graticule-family colour (D14 token), opacity = presence × boundaryOpacity.
 *  • Place labels — a DOM layer (position:fixed, pointer-events:none) owned by this module, NOT
 *    a React island: labels re-anchor at LABELS.syncEveryFrames cadence via direct style writes —
 *    zustand mirrors at 60 fps would churn, and GL sprite text would forfeit the design fonts.
 *    Selection per sync: scalerank gate widens as the camera descends (log-altitude lerp), near
 *    hemisphere + in-frame culls, then a screen-space min-separation pass in rank order (megacity
 *    beats town) capped at LABELS.maxVisible. The pool of divs is reused — no per-frame churn.
 *
 * Both assets fetch async (star-catalog idiom): the globe never waits, the layer just appears.
 */
export interface GeoLabelsHandle {
  update(opts: { camera: THREE.PerspectiveCamera; alt: number }): void;
  dispose(): void;
}

interface Place {
  name: string;
  rank: number;
  pos: THREE.Vector3; // ECEF at ground
}

/** Presence of the label window at a camera altitude: 0 outside LABELS.minAltM..maxAltM,
 *  ramping across fadeSpanM inside each edge (pure — unit-tested). */
export function labelPresence(alt: number): number {
  const lo = Math.min(1, Math.max(0, (alt - LABELS.minAltM) / LABELS.fadeSpanM));
  const hi = Math.min(1, Math.max(0, (LABELS.maxAltM - alt) / LABELS.fadeSpanM));
  return lo * hi;
}

/** Scalerank admitted at a camera altitude: majors-only (LABELS.rankAtMax) at the window top,
 *  every rank at/below rankFullAltM — lerped in LOG altitude so zoom feels linear (pure). */
export function rankAllowedAt(alt: number): number {
  const t = Math.min(
    1,
    Math.max(
      0,
      (Math.log(alt) - Math.log(LABELS.rankFullAltM)) /
        (Math.log(LABELS.maxAltM) - Math.log(LABELS.rankFullAltM)),
    ),
  );
  return 10 + (LABELS.rankAtMax - 10) * t;
}

export function attachGeoLabels(scene: THREE.Scene): GeoLabelsHandle {
  // --- country boundaries (GL half) ----------------------------------------------------------
  const boundaryMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.graticule),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  let boundary: THREE.LineSegments | null = null;
  fetch(LABELS.boundariesUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
    .then((buf) => {
      // Layout (Float32): [partCount, …vertexCountPerPart, …(latDeg, lonDeg) per vertex].
      const f = new Float32Array(buf);
      const partCount = f[0];
      let read = 1 + partCount;
      let segVerts = 0;
      for (let p = 0; p < partCount; p++) segVerts += (f[1 + p] - 1) * 2;
      const positions = new Float32Array(segVerts * 3);
      let wIdx = 0;
      const put = (i: number) => {
        const [x, y, z] = geodeticToEcef(f[i], f[i + 1], LABELS.boundaryLiftM);
        positions[wIdx++] = x;
        positions[wIdx++] = y;
        positions[wIdx++] = z;
      };
      for (let p = 0; p < partCount; p++) {
        const count = f[1 + p];
        for (let v = 0; v < count - 1; v++) {
          put(read + v * 2);
          put(read + (v + 1) * 2);
        }
        read += count * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      boundary = new THREE.LineSegments(geo, boundaryMat);
      boundary.visible = false;
      boundary.raycast = () => {}; // decoration — never a controls pick target
      scene.add(boundary);
    })
    .catch((e) => console.warn("[globe] NE boundaries unavailable:", e));

  // --- place labels (DOM half) ----------------------------------------------------------------
  let places: Place[] = []; // sorted by scalerank ascending (baked order)
  fetch(LABELS.placesUrl)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { places: [string, number, number, number][] }) => {
      places = data.places.map(([name, rank, latDeg, lonDeg]) => {
        const [x, y, z] = geodeticToEcef(latDeg, lonDeg, 0);
        return { name, rank, pos: new THREE.Vector3(x, y, z) };
      });
    })
    .catch((e) => console.warn("[globe] NE places unavailable:", e));

  const layer = document.createElement("div");
  layer.className = "geo-labels"; // welcome.css hides it with the rest of the chrome
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;";
  document.body.appendChild(layer);
  const pool: HTMLDivElement[] = [];
  const poolEl = (i: number): HTMLDivElement => {
    while (pool.length <= i) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:0;top:0;white-space:nowrap;display:none;" +
        "font-family:var(--font-ui,sans-serif);text-transform:uppercase;" +
        `letter-spacing:0.14em;color:${tokens.textSecondary};` +
        `text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg};`;
      layer.appendChild(el);
      pool.push(el);
    }
    return pool[i];
  };
  const hideFrom = (i: number) => {
    for (let k = i; k < pool.length; k++) pool[k].style.display = "none";
  };

  let frame = 0;
  const _view = new THREE.Vector3();
  const _ndc = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  const accepted: { place: Place; x: number; y: number }[] = [];

  return {
    update({ camera, alt }) {
      const presence = labelPresence(alt);
      if (boundary) {
        boundaryMat.opacity = presence * LABELS.boundaryOpacity;
        boundary.visible = presence > 0.01;
      }
      if (frame++ % LABELS.syncEveryFrames !== 0) return;
      if (presence <= 0.01 || places.length === 0) {
        hideFrom(0);
        return;
      }
      // Scalerank gate: majors-only at the top of the window, every rank by rankFullAltM.
      const rankAllowed = rankAllowedAt(alt);
      accepted.length = 0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const place of places) {
        if (place.rank > rankAllowed) break; // sorted by rank — the rest are all finer
        // Near-hemisphere cull: the place's tangent plane must face the camera…
        _toCam.copy(camera.position).sub(place.pos);
        if (place.pos.dot(_toCam) <= 0) continue;
        // …and sit in FRONT of it (project() alone mirrors behind-camera points into frame).
        _view.copy(place.pos).applyMatrix4(camera.matrixWorldInverse);
        if (_view.z >= 0) continue;
        _ndc.copy(place.pos).project(camera);
        if (Math.abs(_ndc.x) > LABELS.ndcMargin || Math.abs(_ndc.y) > LABELS.ndcMargin) continue;
        const x = (_ndc.x * 0.5 + 0.5) * w;
        const y = (-_ndc.y * 0.5 + 0.5) * h;
        // Screen-space de-clutter in rank order: a megacity shades out the towns around it.
        let clear = true;
        for (const a of accepted) {
          const dx = a.x - x;
          const dy = a.y - y;
          if (dx * dx + dy * dy < LABELS.minSepPx * LABELS.minSepPx) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        accepted.push({ place, x, y });
        if (accepted.length >= LABELS.maxVisible) break;
      }
      for (let i = 0; i < accepted.length; i++) {
        const { place, x, y } = accepted[i];
        const el = poolEl(i);
        if (el.textContent !== place.name) el.textContent = place.name;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        // Rank-weighted type: megacities read a step larger and brighter — an instrument
        // hierarchy, not a poster.
        const major = place.rank <= 1;
        el.style.font = major ? "600 0.7rem var(--font-ui, sans-serif)" : "500 0.6rem var(--font-ui, sans-serif)";
        el.style.opacity = String(presence * (major ? 0.95 : place.rank <= 4 ? 0.78 : 0.6));
        el.style.display = "block";
      }
      hideFrom(accepted.length);
    },
    dispose() {
      layer.remove();
      if (boundary) {
        scene.remove(boundary);
        boundary.geometry.dispose();
      }
      boundaryMat.dispose();
    },
  };
}
