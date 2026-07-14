import type * as THREE from "three";
import { MINIMAP, VECTOR } from "../tuning";
import { ecefToGeodetic } from "../../../lib/geo/projection";
import { useMiniMapStore, type MiniMapFill, type MiniMapLine, type MiniMapScene } from "../../../store/minimap";
import type { VectorTilesHandle } from "./vectorTiles";

/**
 * FPV mini-map feed (owner 2026-07-14) — the globe-side owner of the small square 2D map.
 * Reuses the SHARED MVT source (scene/vectorTiles.ts — one fetch/parse per z14 tile already
 * feeds street names + the vector web), so entering FPV usually costs zero new network.
 *
 * Two mirror channels into store/minimap (the planFeed cadence discipline — never 60 fps):
 *  • FEATURES (slow): when the parse version changes or the viewer walks MINIMAP.rebuildDistM
 *    from the last origin, clip every road/waterway/water/green/building feature to a
 *    (clipK × patchM) box around the viewer and project lon/lat → local metres via the
 *    equirectangular tangent at the origin (sub-centimetre over these distances).
 *  • POSE (fast, MINIMAP.poseEveryFrames): the viewer's east/north offset from that origin +
 *    the view heading — the panel pans its canvas between feature rebuilds.
 * Outside FPV both mirrors null once (the panel unmounts) and the feed goes idle.
 */

export interface MinimapFeedHandle {
  update(ctx: {
    fpvActive: boolean;
    /** Walked FPV eye (ECEF m) — camera.position while FPV is active. */
    eyeEcef: THREE.Vector3;
    /** Compass heading of the view centre (deg). */
    headingDeg: number;
  }): void;
  dispose(): void;
}

const DEG = Math.PI / 180;
/** Metres per degree of latitude (spherical mean — plenty at patch scale). */
const M_PER_DEG_LAT = 111_320;

export function attachMinimapFeed(opts: { vtiles: VectorTilesHandle }): MinimapFeedHandle {
  let frame = 0;
  let originLatDeg = NaN;
  let originLonDeg = NaN;
  let builtVersion = -1;
  let active = false;

  const store = () => useMiniMapStore.getState();

  const project = (lonDeg: number, latDeg: number, kLon: number): [number, number] => [
    (lonDeg - originLonDeg) * kLon,
    (latDeg - originLatDeg) * M_PER_DEG_LAT,
  ];

  /** Clip a projected polyline to the square [-half, half]² keeping simple in/out splits —
   *  features are small vs the box, so a coarse per-vertex filter with bridging keeps every
   *  crossing segment (the panel's canvas clip handles exact edges). */
  const clipLine = (pts: [number, number][], half: number): Float32Array[] => {
    const parts: Float32Array[] = [];
    let cur: number[] = [];
    const inside = (p: [number, number]) => Math.abs(p[0]) <= half && Math.abs(p[1]) <= half;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pIn = inside(p);
      const prev = i > 0 ? pts[i - 1] : null;
      if (pIn) {
        if (cur.length === 0 && prev && !inside(prev)) cur.push(prev[0], prev[1]); // entry bridge
        cur.push(p[0], p[1]);
      } else if (cur.length > 0) {
        cur.push(p[0], p[1]); // exit bridge
        if (cur.length >= 4) parts.push(Float32Array.from(cur));
        cur = [];
      }
    }
    if (cur.length >= 4) parts.push(Float32Array.from(cur));
    return parts;
  };

  const buildScene = (latDeg: number, lonDeg: number): MiniMapScene => {
    originLatDeg = latDeg;
    originLonDeg = lonDeg;
    const kLon = M_PER_DEG_LAT * Math.cos(latDeg * DEG);
    const half = MINIMAP.patchM * MINIMAP.clipK * 0.5;
    const lines: MiniMapLine[] = [];
    const fills: MiniMapFill[] = [];
    for (const tile of opts.vtiles.tiles().values()) {
      if (typeof tile === "string") continue;
      for (const line of tile.lines) {
        if (line.tunnel) continue; // invisible in the world → invisible on the map
        const widthM =
          line.kind === "road"
            ? (VECTOR.roadWidthM[line.cls] ?? 0)
            : (VECTOR.waterwayWidthM[line.cls] ?? 3);
        if (widthM <= 0) continue;
        for (const part of line.lines) {
          const projected = part.map(([lon, lat]) => project(lon, lat, kLon));
          for (const pts of clipLine(projected, half)) {
            lines.push({ widthM, kind: line.kind, bridge: line.bridge, pts });
          }
        }
      }
      for (const poly of tile.polys) {
        for (const rings of poly.polys) {
          const outer = rings[0];
          if (!outer || outer.length < 3) continue;
          const projected = outer.map(([lon, lat]) => project(lon, lat, kLon));
          // Keep rings that touch the box at all (cheap reject); the canvas clips exactly.
          let touches = false;
          for (const p of projected) {
            if (Math.abs(p[0]) <= half && Math.abs(p[1]) <= half) {
              touches = true;
              break;
            }
          }
          if (!touches) continue;
          const flat = new Float32Array(projected.length * 2);
          for (let i = 0; i < projected.length; i++) {
            flat[i * 2] = projected[i][0];
            flat[i * 2 + 1] = projected[i][1];
          }
          fills.push({ kind: poly.kind, pts: flat });
        }
      }
    }
    return { originLatDeg: latDeg, originLonDeg: lonDeg, lines, fills };
  };

  return {
    update(ctx) {
      frame++;
      if (!ctx.fpvActive) {
        if (active) {
          active = false;
          builtVersion = -1;
          originLatDeg = NaN;
          store()._syncScene(null);
          store()._syncPose(null);
        }
        return;
      }
      if (frame % MINIMAP.poseEveryFrames !== 0) return;
      const eye = ecefToGeodetic([ctx.eyeEcef.x, ctx.eyeEcef.y, ctx.eyeEcef.z]);
      if (!active) {
        active = true;
        store()._syncPatchM(MINIMAP.patchM);
      }
      opts.vtiles.ensureRing(eye.latDeg, eye.lonDeg, MINIMAP.ring);
      const kLon = M_PER_DEG_LAT * Math.cos(eye.latDeg * DEG);
      const dxM = Number.isNaN(originLonDeg) ? Infinity : (eye.lonDeg - originLonDeg) * kLon;
      const dyM = Number.isNaN(originLatDeg) ? Infinity : (eye.latDeg - originLatDeg) * M_PER_DEG_LAT;
      const walked = Math.hypot(dxM, dyM);
      if (builtVersion !== opts.vtiles.version() || walked > MINIMAP.rebuildDistM) {
        builtVersion = opts.vtiles.version();
        store()._syncScene(buildScene(eye.latDeg, eye.lonDeg));
        store()._syncPose({ dxM: 0, dyM: 0, headingDeg: ctx.headingDeg });
        return;
      }
      store()._syncPose({ dxM, dyM, headingDeg: ctx.headingDeg });
    },
    dispose() {
      store()._syncScene(null);
      store()._syncPose(null);
    },
  };
}
