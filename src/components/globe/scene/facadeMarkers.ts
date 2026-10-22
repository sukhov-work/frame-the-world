import * as THREE from "three";
import type { FrustumGeometry } from "../../../lib/geo/frustum";
import { facadeFrustumGeometry } from "../../../lib/globe/facadeResidency";
import { tokens } from "../../../lib/theme/tokens";
import type { FacadeWorldItem } from "../../../lib/wix/facadeRecords";
import { FRUSTUM, PHOTO_PROJECT } from "../tuning";

/**
 * FACADE MARKERS (the photo flow (b), F3 residency — T169 / T171, 2026-10-21; the CAMERA-ICON
 * billboards + hover since 2026-10-22, T178 / T183 — owner: "bigger, nicer handles and highlights
 * to placed texture pins so they are easily spottable … nice simple camera icons"): every saved
 * facade photo in the world read is a screen-aligned quad at its apex carrying a camera glyph
 * (a canvas-drawn icon, white on a dark halo — no icon library exists in this repo), tinted the
 * accent, the LIFTED accent while it holds a projector slot, and WHITE + `markerHoverScale`
 * larger while hovered (eased with `markerHoverEaseTauMs`, the pins' S4 feel). ONE InstancedMesh
 * (the Pins idiom): an angular-constant scale clamped to [`markerMinM`, `markerMaxM`],
 * `depthTest: false` + `depthWrite: false` (a signal through the buildings, never a hole in one —
 * the places' posture), `frustumCulled: false` (instances span a city), the raycast ENABLED for
 * the click / hover / right-click (the orchestrator picks through `pick`), and
 * `boundingSphere = null` after EVERY instance write — the T126 / Phase-5 trap: three caches the
 * sphere on the first raycast, GlobeControls raycasts the scene before any row lands, and a stale
 * empty sphere makes every later pick miss.
 *
 * THE BILLBOARD IS IN THE MATRIX, NOT THE SHADER: each instance composes (apex − camera, the
 * CAMERA's world quaternion, the scale) — a plain MeshBasicMaterial draws it and the stock
 * InstancedMesh raycast sees the same quad the eye does (a shader billboard would leave the
 * raycast testing an edge-on plane). The recompose runs when the camera moved > 1 m, turned,
 * the rows changed, or a hover is easing.
 *
 * PRECISION (the Pins lesson): the mesh is anchored AT THE CAMERA of the last rebuild with instance
 * translations relative to it — the large ECEF cancellation happens on the CPU in float64 through
 * `modelViewMatrix`, so a 6.4e6 m apex does not crawl in float32.
 *
 * STORE-FREE (the scene fence): rows are pushed (`setRows`), residency is pushed (`setResident`),
 * the row under edit is pushed (`setHidden`), the hover is pushed (`setHover`). The frustum of
 * each row is cached by id (`facadeFrustumGeometry`) and handed up through `rowGeometry` — the
 * projector's slots and the planner read the same numbers the marker is placed by.
 */

/** Rows one marker mesh can draw ("hundreds per city, maybe thousands" — the cover caps the read). */
export const FACADE_MARKER_CAP = 1000;

export interface FacadeMarkersHandle {
  /** The pickable draw — exposed for the orchestrator's raycast list; `pick` is the house path. */
  mesh: THREE.InstancedMesh;
  /** The world rows (the store's `world`, pushed by the orchestrator). Unchanged rows keep their
   *  cached geometry; a moved / re-aimed row is rebuilt; absent rows leave. */
  setRows(rows: readonly FacadeWorldItem[]): void;
  /** The rows holding a projector slot — tinted brighter. */
  setResident(ids: readonly string[]): void;
  /** The row under edit: not drawn, not a candidate (`rows()` omits it); null = none. */
  setHidden(id: string | null): void;
  /** The cached frustum of a row (hidden or not), or null when unknown. */
  rowGeometry(id: string): FrustumGeometry | null;
  /** The CANDIDATE rows — every row but the hidden one, in the pushed order (duplicate ids folded). */
  rows(): readonly FacadeWorldItem[];
  /** The apex (ECEF m) of a row, or null when unknown. */
  apexOf(id: string): [number, number, number] | null;
  /** Per frame: the scale recompose, only when the camera moved > 1 m or the rows changed. */
  update(camera: THREE.PerspectiveCamera): void;
  /** The marker under an NDC point (−1..1), or null. */
  pick(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera): string | null;
  /** T183: the hovered row (null = none) — eases up + brightens over the next frames. */
  setHover(id: string | null): void;
  hovered(): string | null;
  /** DEV seam: the drawn quad's side (m) for a row after the last recompose, or null. */
  scaleOf(id: string): number | null;
  count(): { total: number; drawn: number; resident: number };
  setVisible(on: boolean): void;
  dispose(): void;
}

interface Entry {
  row: FacadeWorldItem;
  geom: FrustumGeometry;
  apex: THREE.Vector3;
  /** The hover ease 0..1 (the pins' `hoverAmt`). */
  hoverAmt: number;
}

/** The camera glyph: a 128-px canvas — a rounded body, a lens ring, a viewfinder bump — white on
 *  a dark halo (`markerIconOutlinePx`). Null where no 2D canvas exists (vitest / SSR): the quad
 *  then draws as a plain tinted square, which the tests never look at. */
export function drawCameraIcon(size = 128): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const u = size / 128;
  const body = (): void => {
    ctx.beginPath();
    ctx.roundRect(18 * u, 40 * u, 92 * u, 60 * u, 12 * u);
    ctx.closePath();
    ctx.roundRect(44 * u, 26 * u, 40 * u, 18 * u, 5 * u); // the viewfinder bump
  };
  // The halo: the body stroked wide and dark (reads on the sky and on stone alike).
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(8, 12, 20, 0.85)";
  ctx.lineWidth = PHOTO_PROJECT.markerIconOutlinePx * u;
  body();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  body();
  ctx.fill();
  // The lens: a dark ring with a white iris.
  ctx.beginPath();
  ctx.arc(64 * u, 70 * u, 19 * u, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 12, 20, 0.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64 * u, 70 * u, 11 * u, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64 * u, 70 * u, 5 * u, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 12, 20, 0.9)";
  ctx.fill();
  return canvas;
}

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The pose fields the cached frustum depends on — a row with the same values keeps its cache. */
function samePose(a: FacadeWorldItem, b: FacadeWorldItem): boolean {
  return (
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.apexAltM === b.apexAltM &&
    a.headingDeg === b.headingDeg &&
    a.pitchDeg === b.pitchDeg &&
    a.rollDeg === b.rollDeg &&
    a.hFovDeg === b.hFovDeg &&
    a.textureWidth === b.textureWidth &&
    a.textureHeight === b.textureHeight
  );
}

export function attachFacadeMarkers(
  scene: THREE.Scene,
  opts: {
    planeDistM?: number;
    fallbackAspect?: number;
    /** F6 (2026-10-23): the marker's angular size (rad of the frame) — the lean tier's touch-target
     *  class (`PHOTO_PROJECT_LEAN.markerAngularSize`); absent = `PHOTO_PROJECT.markerAngularSize`. */
    markerAngularSize?: number;
  } = {},
): FacadeMarkersHandle {
  const planeDistM = opts.planeDistM ?? FRUSTUM.planeDistM;
  const fallbackAspect = opts.fallbackAspect ?? FRUSTUM.fallbackAspect;
  const markerAngularSize = opts.markerAngularSize ?? PHOTO_PROJECT.markerAngularSize;
  const cap = FACADE_MARKER_CAP;

  // A unit quad, screen-aligned per instance by the CAMERA's quaternion in the instance matrix
  // (the header's raycast note); the icon rides it as a map. Centred on the apex.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const icon = drawCameraIcon();
  const map = icon ? new THREE.CanvasTexture(icon) : null;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  // White material × per-instance colour (three multiplies `diffuse` by `instanceColor`): the
  // accent for a marker, a lightened accent for a resident one, white while hovered.
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map,
    transparent: true,
    opacity: 0.95,
    alphaTest: 0.02,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3; // above the places' dots and the pins
  mesh.name = "facadeMarkers";
  scene.add(mesh);

  const colorMarker = new THREE.Color(tokens.accent);
  // No `accentHi` token exists (tokens.ts 2026-10-21): the resident tint is the accent lifted
  // toward white — the pins' rim idiom, kept off the token sheet until design names one.
  const colorResident = new THREE.Color(tokens.accent).lerp(new THREE.Color(0xffffff), 0.45);
  const colorHover = new THREE.Color(0xffffff);
  const _tint = new THREE.Color();

  const entries = new Map<string, Entry>();
  /** The drawn rows in instance order (index = instanceId). */
  let order: string[] = [];
  let pushed: readonly FacadeWorldItem[] = [];
  let residentSet = new Set<string>();
  let hiddenId: string | null = null;
  let hoverId: string | null = null;
  let hoverEasing = false;
  let lastTickMs = nowMs();
  let dirty = true;
  let shown = true;

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _camQuatLast = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  const _ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  const invalidateBounds = () => {
    mesh.boundingSphere = null; // the trap in the header — after EVERY instance write
  };

  const makeEntry = (row: FacadeWorldItem, prev?: Entry): Entry => {
    const geom = facadeFrustumGeometry(row, planeDistM, fallbackAspect);
    return {
      row,
      geom,
      apex: new THREE.Vector3(geom.apex[0], geom.apex[1], geom.apex[2]),
      hoverAmt: prev?.hoverAmt ?? 0,
    };
  };

  /** The tint: the base (accent / lifted accent) blended to white by the hover ease. */
  const tint = (i: number, id: string) => {
    const base = residentSet.has(id) ? colorResident : colorMarker;
    const amt = entries.get(id)?.hoverAmt ?? 0;
    if (amt > 0) mesh.setColorAt(i, _tint.copy(base).lerp(colorHover, amt));
    else mesh.setColorAt(i, base);
  };
  const retint = () => {
    for (let i = 0; i < order.length; i++) tint(i, order[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  /** The instance list from the pushed rows minus the hidden one; colours follow. */
  const rebuildOrder = () => {
    order = [];
    for (const row of pushed) {
      if (row.id === hiddenId || !entries.has(row.id)) continue;
      if (order.length >= cap) break;
      order.push(row.id);
    }
    for (let i = 0; i < order.length; i++) tint(i, order[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = order.length;
    dirty = true;
    invalidateBounds();
  };

  return {
    mesh,

    setRows(rows) {
      const seen = new Set<string>();
      const unique: FacadeWorldItem[] = [];
      for (const row of rows) {
        if (seen.has(row.id)) continue; // a duplicate id draws once (the first wins)
        seen.add(row.id);
        unique.push(row);
        const e = entries.get(row.id);
        if (!e) entries.set(row.id, makeEntry(row));
        else if (e.row !== row) {
          if (samePose(e.row, row)) e.row = row; // title / urls / params changed — the cache stands
          else entries.set(row.id, makeEntry(row, e));
        }
      }
      pushed = unique;
      for (const id of [...entries.keys()]) if (!seen.has(id)) entries.delete(id);
      rebuildOrder();
    },

    setResident(ids) {
      const next = new Set(ids);
      let changed = next.size !== residentSet.size;
      if (!changed) for (const id of next) if (!residentSet.has(id)) { changed = true; break; }
      if (!changed) return;
      residentSet = next;
      retint();
    },

    setHover(id) {
      if (id === hoverId) return;
      hoverId = id;
      hoverEasing = true; // the ease runs in `update` until every amt has settled
      lastTickMs = nowMs();
    },

    hovered() {
      return hoverId;
    },

    scaleOf(id) {
      const i = order.indexOf(id);
      if (i < 0 || i >= mesh.count) return null;
      mesh.getMatrixAt(i, _m);
      _m.decompose(_p, _q, _s);
      return _s.x;
    },

    setHidden(id) {
      if (id === hiddenId) return;
      hiddenId = id;
      rebuildOrder();
    },

    rowGeometry(id) {
      return entries.get(id)?.geom ?? null;
    },

    rows() {
      if (hiddenId === null) return pushed;
      return pushed.filter((r) => r.id !== hiddenId);
    },

    apexOf(id) {
      const e = entries.get(id);
      return e ? [e.apex.x, e.apex.y, e.apex.z] : null;
    },

    update(camera) {
      if (order.length === 0 || !shown) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      // The hover ease (T183): every entry's amt runs toward 1 (the hovered) or 0, the pins'
      // exponential tau; while any is moving the matrices + tints recompose each frame.
      if (hoverEasing) {
        const t = nowMs();
        const dt = Math.max(0, Math.min(100, t - lastTickMs));
        lastTickMs = t;
        const k = 1 - Math.exp(-dt / Math.max(1, PHOTO_PROJECT.markerHoverEaseTauMs));
        let moving = false;
        for (const [id, e] of entries) {
          const target = id === hoverId ? 1 : 0;
          if (e.hoverAmt === target) continue;
          const next = e.hoverAmt + (target - e.hoverAmt) * k;
          e.hoverAmt = Math.abs(next - target) < 0.005 ? target : next;
          if (e.hoverAmt !== target) moving = true;
        }
        hoverEasing = moving;
        retint();
        dirty = true;
      }
      // The scale is distance-dependent and the quad is camera-aligned, so a static camera needs
      // no per-frame work (the Pins idiom: rebuild when the camera moved > 1 m, turned, or the
      // rows / hover changed).
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      const camTurned = !_camQuatLast.equals(camera.quaternion);
      if (!dirty && !camMoved && !camTurned) return;
      _camLast.copy(camera.position);
      _camQuatLast.copy(camera.quaternion);
      dirty = false;
      // Anchor the mesh AT the camera (the precision note in the header): instance translations
      // become camera-relative and stay float32-exact near the viewer.
      mesh.position.copy(camera.position);
      for (let i = 0; i < order.length; i++) {
        const e = entries.get(order[i]);
        if (!e) continue;
        const distM = camera.position.distanceTo(e.apex);
        const scale =
          THREE.MathUtils.clamp(distM * markerAngularSize, PHOTO_PROJECT.markerMinM, PHOTO_PROJECT.markerMaxM) *
          (1 + (PHOTO_PROJECT.markerHoverScale - 1) * e.hoverAmt);
        _s.setScalar(scale);
        _m.compose(_p.subVectors(e.apex, camera.position), camera.quaternion, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      invalidateBounds(); // scales changed — see the header's trap note
    },

    pick(ndcX, ndcY, camera) {
      if (!shown || mesh.count === 0) return null; // hidden markers are unpickable
      _ndc.set(ndcX, ndcY);
      raycaster.setFromCamera(_ndc, camera);
      // The anchor moved with the last rebuild — the world matrix must say so before the ray
      // (the renderer refreshes it per frame; a click between frames, or a test, must not wait).
      mesh.updateMatrixWorld(true);
      const hits = raycaster.intersectObject(mesh, false);
      const id = hits[0]?.instanceId;
      return id !== undefined && id < order.length ? order[id] : null;
    },

    count() {
      let resident = 0;
      for (const id of residentSet) if (entries.has(id)) resident++;
      return { total: entries.size, drawn: order.length, resident };
    },

    setVisible(on) {
      if (on === shown) return;
      shown = on;
      if (on) dirty = true; // matrices went stale while hidden — force a rebuild pass
    },

    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      map?.dispose();
      entries.clear();
      order = [];
    },
  };
}
