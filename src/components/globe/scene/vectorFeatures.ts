import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { geodeticToEcef } from "../../../lib/geo/projection";
import { clampGroundM } from "../../../lib/geo/terrain";
import { VECTOR } from "../tuning";
import { tileLocalToLonLat, type VectorTilesHandle } from "./vectorTiles";

/**
 * Vector feature web (S7 feedback batch) — roads / rivers / water / green as GL geometry, so
 * "street vs river vs bridge" finally reads at close zoom over the dark drape. Consumes the
 * SAME parsed OpenFreeMap z14 tiles as the street names (scene/vectorTiles.ts — one fetch, two
 * layers). Everything is map INK (tokens.vec*, unlit, constant colour), dimmed at night by a
 * sun-elevation factor from the orchestrator so it never glows against the dark side.
 *
 * Geometry: per tile, features convert lon/lat → a LOCAL tangent frame at the tile centre
 * (float32-safe: local coords ≤ ~3.5 km; the ECEF magnitude lives in mesh.matrix — the
 * PhotoFrustum lesson). Roads/waterways are RIBBONS with real widths in metres (LineSegments
 * are stuck at 1 px); water/green polygons triangulate via ShapeUtils. Vertices seat on the
 * rendered terrain through a lazy N×N height lattice per tile (bilinear between samples,
 * amortized raycasts) — flat at ellipsoid-0 until the lattice fills, then ONE rebuild.
 * Bridges get a lift + the brightest ink; tunnels are skipped (invisible IRL).
 */
export interface VectorFeaturesHandle {
  update(opts: {
    alt: number;
    focusLatDeg: number;
    focusLonDeg: number;
    /** sin(sun elevation) at the view focus — drives the night dim. */
    sunElevSin: number;
    /** False hides the layer (FPV, welcome…) without dropping the builds. */
    enabled: boolean;
    /** Flat-map mode (nadir 2D, owner 2026-08-18): ribbons/fills skip the depth test — the
     *  refining terrain can never slice through them ("ugly clipping"; the 6×6 lattice + 1.5 m
     *  lift cannot track LOD between knots) — and the night dim stands down (the 2D map is a
     *  planning chart; unreadable ink at night defeated it). Oblique 3D keeps both. */
    mapFlat: boolean;
  }): void;
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): the per-frame terrain-lattice raycast budget
   *  (VECTOR.latticeBudgetPerFrame on `high`; fewer on weaker tiers → less CPU/GC at street level;
   *  tiles just seat a little slower). */
  setLatticeBudget(n: number): void;
  dispose(): void;
}

/** Presence of the web at a camera altitude (pure — unit-tested). */
export function vectorPresence(alt: number): number {
  return Math.min(1, Math.max(0, (VECTOR.topAltM - alt) / (VECTOR.topAltM - VECTOR.fullAltM)));
}

/** Night dim over sin(sun elevation) — twin of the grade's day gate (pure — unit-tested). */
export function nightDimFor(sunElevSin: number): number {
  const t = Math.min(1, Math.max(0, (sunElevSin - -0.12) / (0.05 - -0.12)));
  const s = t * t * (3 - 2 * t);
  return VECTOR.nightDim + (1 - VECTOR.nightDim) * s;
}

/** Flat-map near-ground ink fade: 1 at/above hiAltM, down to the floor at/below loAltM — at
 *  street zoom the sharpened imagery carries the detail and full-strength ink covered exactly
 *  what the owner reads (kerbs, parking). Pure — unit-tested. */
export function flatNearFade(alt: number): number {
  const t = Math.min(
    1,
    Math.max(
      0,
      (alt - VECTOR.flatNearFadeLoAltM) / (VECTOR.flatNearFadeHiAltM - VECTOR.flatNearFadeLoAltM),
    ),
  );
  return VECTOR.flatNearFadeFloor + (1 - VECTOR.flatNearFadeFloor) * t;
}

/** Ribbon strip for a 2D polyline (local tangent metres): per-vertex averaged directions,
 *  ±width/2 offsets, 2 triangles per segment. Returns null for degenerate lines
 *  (pure — unit-tested). */
export function ribbonStrip(
  pts: { x: number; y: number; z: number }[],
  widthM: number,
): { positions: number[]; indices: number[] } | null {
  const n = pts.length;
  if (n < 2 || widthM <= 0) return null;
  const dirs: { x: number; y: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const l = Math.hypot(dx, dy);
    dirs.push(l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 });
  }
  const positions: number[] = [];
  const half = widthM / 2;
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(n - 2, i)];
    let vx = a.x + b.x;
    let vy = a.y + b.y;
    const vl = Math.hypot(vx, vy);
    if (vl > 1e-9) {
      vx /= vl;
      vy /= vl;
    } else {
      vx = b.x;
      vy = b.y;
    }
    const px = -vy;
    const py = vx;
    positions.push(
      pts[i].x + px * half, pts[i].y + py * half, pts[i].z,
      pts[i].x - px * half, pts[i].y - py * half, pts[i].z,
    );
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const k = i * 2;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  return { positions, indices };
}

/** Bilinear lookup in an N×N lattice over the unit square (NaN slots fall back to 0). Pure. */
export function bilinearHeight(lattice: Float32Array, n: number, u: number, v: number): number {
  const cu = Math.min(1, Math.max(0, u)) * (n - 1);
  const cv = Math.min(1, Math.max(0, v)) * (n - 1);
  const i0 = Math.floor(cu);
  const j0 = Math.floor(cv);
  const i1 = Math.min(n - 1, i0 + 1);
  const j1 = Math.min(n - 1, j0 + 1);
  const fu = cu - i0;
  const fv = cv - j0;
  const g = (i: number, j: number) => {
    const h = lattice[j * n + i];
    return Number.isNaN(h) ? 0 : h;
  };
  return (
    g(i0, j0) * (1 - fu) * (1 - fv) +
    g(i1, j0) * fu * (1 - fv) +
    g(i0, j1) * (1 - fu) * fv +
    g(i1, j1) * fu * fv
  );
}

const MAJOR_ROADS = new Set(["motorway", "trunk", "primary"]);

interface TileBuild {
  key: string;
  built: boolean; // geometry attempted at least once (a feature-empty tile stays built)
  fills: THREE.Mesh | null;
  ribbons: THREE.Mesh | null;
  lattice: Float32Array;
  latticeCursor: number; // next slot to sample
  latticeDone: boolean;
  builtWithLattice: boolean;
  /** Lattice re-sample in flight (terrain refined under a built tile); the old geometry stays
   *  up until the fresh lattice lands — rebuild only on real drift, never a blink. */
  refreshing: boolean;
  prevLattice: Float32Array | null;
  /** Pre-build stability gate: two consecutive lattice passes must agree within refreshEpsM
   *  before the FIRST build — a tile built from mid-refinement coarse heights lands metres
   *  under the final terrain and reads as missing/flickering water. */
  verified: boolean;
  /** Tile centre (deg) — the eviction distance key. */
  cLat: number;
  cLon: number;
  // tile geographic bounds (for lattice sample points + bilinear u/v)
  nwLon: number;
  nwLat: number;
  seLon: number;
  seLat: number;
  anchor: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  up: THREE.Vector3;
}

export function attachVectorFeatures(opts: {
  scene: THREE.Scene;
  vtiles: VectorTilesHandle;
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
  tileZ: number;
}): VectorFeaturesHandle {
  const group = new THREE.Group();
  group.visible = false;
  opts.scene.add(group);

  const fillMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ribbonMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const colRoadMajor = new THREE.Color(tokens.vecRoadMajor);
  const colRoadMinor = new THREE.Color(tokens.vecRoadMinor);
  const colWater = new THREE.Color(tokens.vecWater);
  const colGreen = new THREE.Color(tokens.vecGreen);
  const colBridge = new THREE.Color(tokens.vecBridge);

  const builds = new Map<string, TileBuild>();

  const startBuild = (key: string, tx: number, ty: number): TileBuild => {
    const nw = tileLocalToLonLat(opts.tileZ, tx, ty, 1, 0, 0);
    const se = tileLocalToLonLat(opts.tileZ, tx, ty, 1, 1, 1);
    const cLat = (nw.latDeg + se.latDeg) / 2;
    const cLon = (nw.lonDeg + se.lonDeg) / 2;
    const latRad = (cLat * Math.PI) / 180;
    const lonRad = (cLon * Math.PI) / 180;
    const up = new THREE.Vector3(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad),
    );
    const east = new THREE.Vector3(-Math.sin(lonRad), Math.cos(lonRad), 0);
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const lattice = new Float32Array(VECTOR.latticeN * VECTOR.latticeN).fill(Number.NaN);
    return {
      key,
      built: false,
      fills: null,
      ribbons: null,
      lattice,
      latticeCursor: 0,
      latticeDone: false,
      builtWithLattice: false,
      refreshing: false,
      prevLattice: null,
      verified: false,
      cLat,
      cLon: cLon,
      nwLon: nw.lonDeg,
      nwLat: nw.latDeg,
      seLon: se.lonDeg,
      seLat: se.latDeg,
      anchor: new THREE.Vector3(...geodeticToEcef(cLat, cLon, 0)),
      east,
      north,
      up,
    };
  };

  const _p = new THREE.Vector3();
  const toLocal = (b: TileBuild, lonDeg: number, latDeg: number, h: number) => {
    _p.set(...geodeticToEcef(latDeg, lonDeg, h)).sub(b.anchor);
    return { x: _p.dot(b.east), y: _p.dot(b.north), z: _p.dot(b.up) };
  };
  const heightAtLonLat = (b: TileBuild, lonDeg: number, latDeg: number) => {
    if (!b.latticeDone && b.latticeCursor === 0) return 0; // nothing sampled yet — flat build
    const u = (lonDeg - b.nwLon) / (b.seLon - b.nwLon);
    const v = (latDeg - b.nwLat) / (b.seLat - b.nwLat);
    return bilinearHeight(b.lattice, VECTOR.latticeN, u, v);
  };

  const disposeMesh = (m: THREE.Mesh | null) => {
    if (!m) return;
    group.remove(m);
    m.geometry.dispose();
  };

  const buildTileGeometry = (b: TileBuild) => {
    const parsed = opts.vtiles.tiles().get(b.key);
    if (typeof parsed === "string" || !parsed) return;
    disposeMesh(b.fills);
    disposeMesh(b.ribbons);
    // --- fills: water + green polygons (ShapeUtils ear-cut, holes supported) -----------------
    const fPos: number[] = [];
    const fCol: number[] = [];
    const fIdx: number[] = [];
    for (const poly of parsed.polys) {
      if (poly.kind === "building") continue; // mini-map-only kind — the 3D web has REAL buildings
      const color = poly.kind === "water" ? colWater : colGreen;
      const fillLift = poly.kind === "water" ? VECTOR.liftWaterM : VECTOR.liftFillM;
      for (const rings of poly.polys) {
        const contour = rings[0].map(([lon, lat]) => new THREE.Vector2(lon, lat));
        const holes = rings.slice(1).map((r) => r.map(([lon, lat]) => new THREE.Vector2(lon, lat)));
        // Drop the MVT closing vertex (ShapeUtils expects open rings).
        if (contour.length > 1 && contour[0].equals(contour[contour.length - 1])) contour.pop();
        for (const h of holes) {
          if (h.length > 1 && h[0].equals(h[h.length - 1])) h.pop();
        }
        if (contour.length < 3) continue;
        let tris: number[][];
        try {
          tris = THREE.ShapeUtils.triangulateShape(contour, holes);
        } catch {
          continue; // a degenerate ring must never kill the layer
        }
        const base = fPos.length / 3;
        const push = (pt: THREE.Vector2) => {
          const h = heightAtLonLat(b, pt.x, pt.y) + fillLift;
          const l = toLocal(b, pt.x, pt.y, h);
          fPos.push(l.x, l.y, l.z);
          fCol.push(color.r, color.g, color.b);
        };
        contour.forEach(push);
        holes.forEach((h) => h.forEach(push));
        for (const t of tris) fIdx.push(base + t[0], base + t[1], base + t[2]);
      }
    }
    // --- ribbons: roads + waterways (real widths in metres) ----------------------------------
    const rPos: number[] = [];
    const rCol: number[] = [];
    const rIdx: number[] = [];
    for (const line of parsed.lines) {
      if (line.tunnel) continue;
      const widthM =
        line.kind === "waterway"
          ? (VECTOR.waterwayWidthM[line.cls] ?? VECTOR.waterwayWidthM.stream)
          : (VECTOR.roadWidthM[line.cls] ?? 0);
      if (widthM <= 0) continue;
      const color =
        line.kind === "waterway"
          ? colWater
          : line.bridge
            ? colBridge
            : MAJOR_ROADS.has(line.cls)
              ? colRoadMajor
              : colRoadMinor;
      const lift = VECTOR.liftRoadM + (line.bridge ? VECTOR.bridgeLiftM : 0);
      for (const part of line.lines) {
        const pts = part.map(([lon, lat]) => {
          const h = heightAtLonLat(b, lon, lat) + lift;
          return toLocal(b, lon, lat, h);
        });
        const strip = ribbonStrip(pts, widthM);
        if (!strip) continue;
        const base = rPos.length / 3;
        rPos.push(...strip.positions);
        for (let i = 0; i < strip.positions.length / 3; i++) rCol.push(color.r, color.g, color.b);
        for (const i of strip.indices) rIdx.push(base + i);
      }
    }
    const makeMesh = (
      pos: number[],
      col: number[],
      idx: number[],
      mat: THREE.Material,
      order: number,
    ): THREE.Mesh | null => {
      if (idx.length === 0) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(b.east, b.north, b.up);
      mesh.matrix.setPosition(b.anchor);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.renderOrder = order;
      mesh.raycast = () => {}; // map ink — never a pick target
      group.add(mesh);
      return mesh;
    };
    b.fills = makeMesh(fPos, fCol, fIdx, fillMat, 1);
    b.ribbons = makeMesh(rPos, rCol, rIdx, ribbonMat, 2);
    b.built = true;
    b.builtWithLattice = b.latticeDone;
  };

  const dropBuild = (key: string) => {
    const b = builds.get(key);
    if (!b) return;
    disposeMesh(b.fills);
    disposeMesh(b.ribbons);
    builds.delete(key);
  };

  let frame = 0;
  let refreshCursor = 0;
  let latticeBudgetOverride: number = VECTOR.latticeBudgetPerFrame; // WS1: lowered on weaker tiers
  let flatApplied = false; // mapFlat depth-test state currently on the materials

  return {
    update({ alt, focusLatDeg, focusLonDeg, sunElevSin, enabled, mapFlat }) {
      frame++;
      const presence = enabled ? vectorPresence(alt) : 0;
      group.visible = presence > 0.01;
      if (!group.visible) return;
      if (mapFlat !== flatApplied) {
        // Flat-map depth gate (owner 2026-08-18): at nadir the web is pure map ink — depth
        // testing against the refining terrain only ever CUTS it, never correctly occludes.
        flatApplied = mapFlat;
        fillMat.depthTest = !mapFlat;
        ribbonMat.depthTest = !mapFlat;
      }
      const ring = alt > VECTOR.ringFarAltM ? VECTOR.ringFar : VECTOR.ringNear;
      opts.vtiles.ensureRing(focusLatDeg, focusLonDeg, ring);
      // Active set = parsed tiles in the ring (+1 margin). Builds OUTSIDE it PERSIST — dropping
      // them on ring exit popped river tiles in and out on every pan/focus wobble (S7 feedback
      // #2). Eviction is by focus distance, only past VECTOR.maxBuilds, further below.
      const wanted = new Set<string>();
      {
        const n = 2 ** opts.tileZ;
        const latRad = (focusLatDeg * Math.PI) / 180;
        const fx = Math.floor(((focusLonDeg + 180) / 360) * n);
        const fy = Math.floor(
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
        );
        for (const [key, entry] of opts.vtiles.tiles()) {
          if (typeof entry === "string") continue;
          const [tx, ty] = key.split("/").map(Number);
          if (Math.abs(tx - fx) <= ring + 1 && Math.abs(ty - fy) <= ring + 1) wanted.add(key);
        }
      }
      // Lattice sampling budget (amortized raycasts against the rendered terrain).
      let latticeBudget = latticeBudgetOverride;
      // Build budget (geometry builds are a few ms each).
      let buildBudget = VECTOR.buildBudgetPerFrame;
      for (const key of wanted) {
        let b = builds.get(key);
        if (!b) {
          const parsed = opts.vtiles.tiles().get(key);
          if (typeof parsed === "string" || !parsed) continue;
          b = startBuild(key, parsed.tx, parsed.ty);
          builds.set(key, b);
        }
        // Fill the lattice a few samples at a time. A null sample means no terrain tile under
        // that knot — which happens PERMANENTLY for knots outside the camera frustum (tiles
        // exist only in-frustum, the S2 lesson), so the cursor SKIPS them (NaN) instead of
        // stalling the whole tile; at the end of the pass the gaps take the mean of the
        // answered knots (a part-visible river tile still builds) and the periodic refresh
        // converges them once the camera actually looks there.
        const nL = VECTOR.latticeN;
        while (!b.latticeDone && latticeBudget > 0) {
          const i = b.latticeCursor % nL;
          const j = Math.floor(b.latticeCursor / nL);
          const lon = b.nwLon + ((b.seLon - b.nwLon) * i) / (nL - 1);
          const lat = b.nwLat + ((b.seLat - b.nwLat) * j) / (nL - 1);
          const sampled = opts.terrainHeightAt(lat, lon);
          latticeBudget--;
          b.lattice[j * nL + i] = sampled === null ? Number.NaN : clampGroundM(sampled);
          b.latticeCursor++;
          if (b.latticeCursor >= nL * nL) {
            let sum = 0;
            let count = 0;
            for (const h of b.lattice) {
              if (!Number.isNaN(h)) {
                sum += h;
                count++;
              }
            }
            if (count === 0) {
              b.latticeCursor = 0; // nothing answered at all — the terrain isn't there yet
            } else {
              const mean = sum / count;
              for (let k = 0; k < b.lattice.length; k++) {
                if (Number.isNaN(b.lattice[k])) b.lattice[k] = mean;
              }
              b.latticeDone = true;
            }
          }
        }
        // A comparison pass just landed (pre-build verification OR post-build refresh):
        // the old geometry stayed up the whole time — no blink either way.
        if (b.refreshing && b.latticeDone) {
          b.refreshing = false;
          let maxD = 0;
          if (b.prevLattice) {
            for (let k = 0; k < b.lattice.length; k++) {
              const d = Math.abs(b.lattice[k] - b.prevLattice[k]);
              if (Number.isFinite(d) && d > maxD) maxD = d;
            }
          }
          b.prevLattice = null;
          if (!b.built) b.verified = maxD < VECTOR.refreshEpsM; // stable → safe to build
          else if (maxD >= VECTOR.refreshEpsM) b.builtWithLattice = false; // drifted → reseat
        }
        // Pre-build verification: immediately re-run the lattice and require agreement — while
        // the terrain is still refining under the tile the passes disagree and the build waits.
        if (b.latticeDone && !b.built && !b.verified && !b.refreshing) {
          b.prevLattice = b.lattice.slice();
          b.latticeCursor = 0;
          b.latticeDone = false;
          b.refreshing = true;
        }
        // Build ONLY once the lattice is ready AND stable (the S7-feedback flat pre-build at
        // ellipsoid-0 flashed at the wrong height; a coarse-LOD build sank under the refined
        // terrain) — tiles appear once, seated right, and stay.
        if (buildBudget > 0 && b.latticeDone && b.verified && (!b.built || !b.builtWithLattice)) {
          buildTileGeometry(b);
          buildBudget--;
        }
      }
      // Terrain refines under built tiles as the camera descends — cycle ONE tile at a time
      // through a lattice re-sample so fills converge onto the final ground without churn.
      if (frame % VECTOR.refreshEveryFrames === 0) {
        const candidates = [...builds.values()].filter(
          (b) =>
            wanted.has(b.key) &&
            b.built &&
            b.latticeDone &&
            !b.refreshing &&
            typeof opts.vtiles.tiles().get(b.key) === "object", // source data still cached
        );
        if (candidates.length > 0) {
          const b = candidates[refreshCursor++ % candidates.length];
          b.prevLattice = b.lattice.slice();
          b.latticeCursor = 0;
          b.latticeDone = false;
          b.refreshing = true;
        }
      }
      // Eviction: past the cap, drop the builds farthest from the focus (never active-ring ones).
      if (builds.size > VECTOR.maxBuilds) {
        const excess = [...builds.values()]
          .filter((b) => !wanted.has(b.key))
          .sort(
            (x, y) =>
              (y.cLat - focusLatDeg) ** 2 + (y.cLon - focusLonDeg) ** 2 -
              ((x.cLat - focusLatDeg) ** 2 + (x.cLon - focusLonDeg) ** 2),
          );
        for (const b of excess) {
          if (builds.size <= VECTOR.maxBuilds) break;
          dropBuild(b.key);
        }
      }
      // Flat map: the imagery is the map — fills drop to a whisper, ribbons to light ink
      // (owner 2026-08-18b); 3D keeps the full stylized web over the dark drape.
      const dim = mapFlat ? flatNearFade(alt) : nightDimFor(sunElevSin);
      fillMat.opacity = presence * dim * VECTOR.fillOpacity * (mapFlat ? VECTOR.flatFillK : 1);
      ribbonMat.opacity = presence * dim * VECTOR.lineOpacity * (mapFlat ? VECTOR.flatLineK : 1);
    },
    setLatticeBudget(n) {
      latticeBudgetOverride = Math.max(1, Math.floor(n));
    },
    dispose() {
      for (const key of [...builds.keys()]) dropBuild(key);
      fillMat.dispose();
      ribbonMat.dispose();
      opts.scene.remove(group);
    },
  };
}
