import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { geodeticToEcef } from "../../../lib/geo/projection";
import { clampGroundM } from "../../../lib/geo/terrain";
import { STREETS } from "../tuning";
import type { StreetLabelFeat, VectorTilesHandle } from "./vectorTiles";

/**
 * Street names v3 (S7 feedback batch) — GL labels PINNED TO THE GROUND MESH.
 *
 * The v2 DOM pool moved labels by JS style writes every 3rd frame while the mesh re-rendered at
 * 60 Hz — the owner read that as "very laggy, jumping around, lagging behind the mesh". v3 kills
 * the cadence gap structurally: each street name is a canvas-textured quad LYING ON the rendered
 * terrain, rotated along its street in the local tangent plane. The GPU projects it with the
 * same matrices in the same composer frame as the terrain — it cannot lag or jump by
 * construction. Type size is WORLD metres (road paint): it scales optically with zoom.
 *
 * Float32 safety: the quad geometry is a unit plane (local coords ≤ 0.5); the ECEF magnitude
 * lives only in mesh.matrix, and three computes modelViewMatrix per mesh on the CPU in float64 —
 * the PhotoFrustum lesson (apex-relative geometry), not the instanced-attribute trap (Pins).
 *
 * Selection (dedupe by name → rank order → WORLD-space min separation) is bookkeeping at a slow
 * cadence; between selections nothing is repositioned in screen space — labels are simply part
 * of the scene. The upright flip (text readable from either side of the street) and the lazy
 * terrain re-seat are the only per-frame writes, both eased/hysteresis-guarded.
 */
export interface StreetNamesHandle {
  update(opts: {
    camera: THREE.PerspectiveCamera;
    alt: number;
    /** View-focus geodetic mirrors (low cadence is fine — tiles are ~2.4 km wide). */
    focusLatDeg: number;
    focusLonDeg: number;
    /** False hides the layer (FPV, welcome…) without dropping the tile cache. */
    enabled: boolean;
  }): void;
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): cap the simultaneous label budget on weaker
   *  tiers (STREETS.maxVisible on `high`; fewer on mid/low → fewer textures + selection work). */
  setMaxVisible(n: number): void;
  dispose(): void;
}

/** Presence of the street layer at a camera altitude: 0 at/above topAltM, 1 at/below fullAltM,
 *  linear between; stays on all the way to the street (pure — unit-tested). */
export function streetPresence(alt: number): number {
  return Math.min(1, Math.max(0, (STREETS.topAltM - alt) / (STREETS.topAltM - STREETS.fullAltM)));
}

/** Painted-text cap height (m) for a class rank — majors read larger (pure — unit-tested). */
export function textHeightM(rank: number): number {
  return rank <= 2 ? STREETS.textHeightM[0] : rank <= 4 ? STREETS.textHeightM[1] : STREETS.textHeightM[2];
}

/** Upright flip with hysteresis: given the dot of the CURRENTLY RENDERED text-up with the
 *  camera's tangent direction, toggle only once it points clearly away — the dead band keeps
 *  labels from flickering when the camera rides the street axis (pure — unit-tested). */
export function uprightFlip(dotEffUpToCam: number, flipped: boolean): boolean {
  return dotEffUpToCam < -STREETS.flipHysteresis ? !flipped : flipped;
}

interface LabelEntry {
  feat: StreetLabelFeat;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  /** World width/height of the quad (m). */
  w: number;
  h: number;
  /** ENU-ish basis at the anchor (along = street dir in tangent plane, side = in-plane up). */
  along: THREE.Vector3;
  side: THREE.Vector3;
  up: THREE.Vector3;
  anchor: THREE.Vector3; // ECEF at current groundM
  groundM: number | null; // null = unseated (ellipsoid 0 until terrain answers)
  easeToM: number | null; // re-seat target (eased, never snapped)
  lastSampleFrame: number;
  flipped: boolean;
  opacity: number; // F3: current eased opacity (starts 0 → fades in)
  dying: boolean; // F3: de-selected — fade to 0 then drop (revived if re-selected)
}

const _v = new THREE.Vector3();
const _toCam = new THREE.Vector3();

export function attachStreetNames(opts: {
  scene: THREE.Scene;
  vtiles: VectorTilesHandle;
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
  maxAniso?: number;
}): StreetNamesHandle {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 3;
  opts.scene.add(group);

  // The design type reaches the canvas through the resolved CSS var (canvas needs a concrete
  // font string — var() doesn't resolve in 2D canvas font).
  const uiFont =
    (typeof getComputedStyle === "function"
      ? getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim()
      : "") || "sans-serif";

  const geometry = new THREE.PlaneGeometry(1, 1); // shared; scaled per label via matrix basis

  // One texture per street NAME, kept while the label is live (labels churn slowly; textures
  // for dropped labels are disposed with their entry).
  const makeTexture = (name: string, major: boolean) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const pad = Math.ceil(STREETS.canvasPx * 0.45);
    ctx.font = `600 ${STREETS.canvasPx}px ${uiFont}`;
    const tw = Math.ceil(ctx.measureText(name).width);
    canvas.width = Math.max(2, tw + pad * 2);
    canvas.height = Math.ceil(STREETS.canvasPx * 1.5);
    // (canvas resize resets state)
    ctx.font = `600 ${STREETS.canvasPx}px ${uiFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Soft dark halo (the DOM labels' text-shadow, in-texture) so names read on any ground.
    ctx.shadowColor = tokens.bg;
    ctx.shadowBlur = STREETS.canvasPx * 0.22;
    ctx.fillStyle = major ? tokens.textPrimary : tokens.textSecondary;
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 0;
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, opts.maxAniso ?? 1);
    return { texture, aspect: canvas.width / canvas.height };
  };

  const live = new Map<string, LabelEntry>(); // keyed by street name
  const bestByName = new Map<string, StreetLabelFeat>();
  let frame = 0;
  let lastVersion = -1;
  let reseatCursor = 0;
  let maxVisibleOverride: number = STREETS.maxVisible; // WS1: lowered on weaker tiers via setMaxVisible

  const buildEntry = (feat: StreetLabelFeat): LabelEntry => {
    const { texture, aspect } = makeTexture(feat.name, feat.rank <= 2);
    const h = textHeightM(feat.rank);
    const w = h * aspect;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 3;
    mesh.raycast = () => {}; // map ink — never a pick target
    // Tangent basis at the anchor (geodetic up from lat/lon; street direction from the B point).
    const latRad = (feat.latDeg * Math.PI) / 180;
    const lonRad = (feat.lonDeg * Math.PI) / 180;
    const up = new THREE.Vector3(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad),
    );
    const anchor = new THREE.Vector3(...geodeticToEcef(feat.latDeg, feat.lonDeg, 0));
    // FRESH vector per entry — `along` is stored on the entry, so it must never alias a module
    // temp (the shared-_v aliasing corrupted every basis once the temp was reused; found live).
    const along = new THREE.Vector3(...geodeticToEcef(feat.bLatDeg, feat.bLonDeg, 0)).sub(anchor);
    along.addScaledVector(up, -along.dot(up)); // project into tangent plane
    if (along.lengthSq() < 1e-12) along.set(-Math.sin(lonRad), Math.cos(lonRad), 0); // east fallback
    along.normalize();
    const side = new THREE.Vector3().crossVectors(up, along).normalize();
    const entry: LabelEntry = {
      feat,
      mesh,
      material,
      texture,
      w,
      h,
      along,
      side,
      up,
      anchor,
      groundM: null,
      easeToM: null,
      lastSampleFrame: -1,
      flipped: false,
      opacity: 0,
      dying: false,
    };
    applyMatrix(entry);
    group.add(mesh);
    return entry;
  };

  const _mAlong = new THREE.Vector3();
  const _mSide = new THREE.Vector3();
  const applyMatrix = (e: LabelEntry) => {
    const sign = e.flipped ? -1 : 1;
    _mAlong.copy(e.along).multiplyScalar(e.w * sign);
    _mSide.copy(e.side).multiplyScalar(e.h * sign);
    // Quad plane: local X = along (scaled to width), local Y = in-plane up, local Z = normal.
    e.mesh.matrix.makeBasis(_mAlong, _mSide, e.up);
    e.mesh.matrix.setPosition(e.anchor);
    e.mesh.matrixWorldNeedsUpdate = true;
  };

  const seatEntry = (e: LabelEntry, m: number) => {
    e.groundM = m;
    e.anchor.set(...geodeticToEcef(e.feat.latDeg, e.feat.lonDeg, m + STREETS.liftM));
    applyMatrix(e);
  };

  const dropEntry = (name: string, e: LabelEntry) => {
    group.remove(e.mesh);
    e.material.dispose();
    e.texture.dispose();
    live.delete(name);
  };

  const runSelection = () => {
    // One label per street NAME across the neighborhood — best class, then longest segment.
    bestByName.clear();
    for (const entry of opts.vtiles.tiles().values()) {
      if (typeof entry === "string") continue;
      for (const label of entry.labels) {
        const prev = bestByName.get(label.name);
        if (
          !prev ||
          label.rank < prev.rank ||
          (label.rank === prev.rank && label.lineLen > prev.lineLen)
        ) {
          bestByName.set(label.name, label);
        }
      }
    }
    const candidates = [...bestByName.values()].sort(
      (a, b) => a.rank - b.rank || b.lineLen - a.lineLen,
    );
    // WORLD-space min separation in rank order (stable under camera motion — no screen reshuffle).
    const accepted: StreetLabelFeat[] = [];
    const minSepSq = STREETS.minSepM * STREETS.minSepM;
    const anchors: THREE.Vector3[] = [];
    for (const c of candidates) {
      const p = _v.set(...geodeticToEcef(c.latDeg, c.lonDeg, 0)).clone();
      let clear = true;
      for (const a of anchors) {
        if (a.distanceToSquared(p) < minSepSq) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      anchors.push(p);
      accepted.push(c);
      if (accepted.length >= maxVisibleOverride) break;
    }
    const keep = new Set(accepted.map((c) => c.name));
    // F3: don't drop instantly — mark unkept labels dying (they ease to 0 then remove in the
    // per-frame loop), and REVIVE a dying label that got re-selected before it faded out.
    for (const [, e] of live) {
      if (!keep.has(e.feat.name)) e.dying = true;
    }
    for (const c of accepted) {
      const e = live.get(c.name);
      if (e) e.dying = false;
      else live.set(c.name, buildEntry(c));
    }
  };

  return {
    update({ camera, alt, focusLatDeg, focusLonDeg, enabled }) {
      frame++;
      const presence = enabled ? streetPresence(alt) : 0;
      group.visible = presence > 0.01;
      if (!group.visible) return;
      // Keep the focus neighborhood fetched (fire-and-forget; the shared cache absorbs repeats).
      opts.vtiles.ensureRing(focusLatDeg, focusLonDeg, STREETS.ring);
      // Selection: on tile-cache change or the slow cadence — never per frame.
      const v = opts.vtiles.version();
      if (v !== lastVersion || frame % STREETS.selectEveryFrames === 0) {
        lastVersion = v;
        runSelection();
      }
      // Per-frame: opacity fade, lazy terrain seat (eased), upright flip (hysteresis).
      const entries = [...live.values()];
      // Amortized terrain (re-)seat: 2 raycasts per frame, round-robin; unseated labels and
      // labels whose sample is older than reseatEveryFrames get re-sampled.
      for (let k = 0; k < 2 && entries.length > 0; k++) {
        const e = entries[reseatCursor++ % entries.length];
        if (e.groundM !== null && frame - e.lastSampleFrame < STREETS.reseatEveryFrames) continue;
        const sampled = opts.terrainHeightAt(e.feat.latDeg, e.feat.lonDeg);
        if (sampled !== null) {
          e.lastSampleFrame = frame;
          const m = clampGroundM(sampled);
          if (e.groundM === null) seatEntry(e, m);
          else if (Math.abs(m - e.groundM) >= STREETS.reseatEpsM) e.easeToM = m;
        }
      }
      for (const e of entries) {
        // Ease a re-seat (terrain refined under the label) — pinned means no snapping either.
        if (e.easeToM !== null && e.groundM !== null) {
          const next = e.groundM + (e.easeToM - e.groundM) * 0.15;
          seatEntry(e, Math.abs(next - e.easeToM) < 0.05 ? e.easeToM : next);
          if (e.groundM === e.easeToM) e.easeToM = null;
        }
        // Upright flip: text-up (side) should have a positive component toward the camera.
        _toCam.copy(camera.position).sub(e.anchor);
        _toCam.addScaledVector(e.up, -_toCam.dot(e.up)); // tangent component only
        const len = _toCam.length();
        const dot = len > 1e-6 ? e.side.dot(_toCam) / len : 1;
        const flipped = uprightFlip(dot * (e.flipped ? -1 : 1), e.flipped);
        if (flipped !== e.flipped) {
          e.flipped = flipped;
          applyMatrix(e);
        }
        // F3: ease opacity toward the target (0 while dying) — fade IN new labels, fade OUT
        // before removal, instead of snapping on the selection cadence.
        const target = e.dying ? 0 : presence * (e.feat.rank <= 2 ? 0.92 : 0.7);
        e.opacity += (target - e.opacity) * STREETS.labelFadeLerp;
        e.material.opacity = e.opacity;
        if (e.dying && e.opacity < 0.01) dropEntry(e.feat.name, e);
      }
    },
    setMaxVisible(n) {
      maxVisibleOverride = Math.max(1, Math.floor(n));
    },
    dispose() {
      for (const [name, e] of [...live]) dropEntry(name, e);
      geometry.dispose();
      opts.scene.remove(group);
    },
  };
}
