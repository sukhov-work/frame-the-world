import * as THREE from "three";
import type { FrustumGeometry } from "../../../lib/geo/frustum";
import { facadeFrustumGeometry } from "../../../lib/globe/facadeResidency";
import { tokens } from "../../../lib/theme/tokens";
import type { FacadeWorldItem } from "../../../lib/wix/facadeRecords";
import { FRUSTUM, PHOTO_PROJECT } from "../tuning";

/**
 * FACADE MARKERS (the photo flow (b), F3 residency — T169 / T171, 2026-10-21): every saved facade
 * photo in the world read is a small glyph at its apex — a cone pointing where the camera looked —
 * until it earns a projector slot (then it is tinted brighter; the photo itself is the projector's).
 * ONE InstancedMesh (the Pins idiom): an angular-constant scale clamped to [`markerMinM`,
 * `markerMaxM`], `depthWrite: false` (a signal, never a hole in a building), `frustumCulled: false`
 * (instances span a city), the raycast ENABLED for the click (the orchestrator picks through
 * `pick`), and `boundingSphere = null` after EVERY instance write — the T126 / Phase-5 trap: three
 * caches the sphere on the first raycast, GlobeControls raycasts the scene before any row lands,
 * and a stale empty sphere makes every later pick miss.
 *
 * PRECISION (the Pins lesson): the mesh is anchored AT THE CAMERA of the last rebuild with instance
 * translations relative to it — the large ECEF cancellation happens on the CPU in float64 through
 * `modelViewMatrix`, so a 6.4e6 m apex does not crawl in float32. Between rebuilds the world
 * position (mesh + instance) stays exact; the rebuild runs when the camera moved > 1 m (the scale
 * is distance-dependent) or the rows changed.
 *
 * STORE-FREE (the scene fence): rows are pushed (`setRows`), residency is pushed (`setResident`),
 * the row under edit is pushed (`setHidden`). The frustum of each row is cached by id
 * (`facadeFrustumGeometry`) and handed up through `rowGeometry` — the projector's slots and the
 * planner read the same numbers the marker is placed by.
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
  count(): { total: number; drawn: number; resident: number };
  setVisible(on: boolean): void;
  dispose(): void;
}

interface Entry {
  row: FacadeWorldItem;
  geom: FrustumGeometry;
  apex: THREE.Vector3;
  quat: THREE.Quaternion;
}

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
  opts: { planeDistM?: number; fallbackAspect?: number } = {},
): FacadeMarkersHandle {
  const planeDistM = opts.planeDistM ?? FRUSTUM.planeDistM;
  const fallbackAspect = opts.fallbackAspect ?? FRUSTUM.fallbackAspect;
  const cap = FACADE_MARKER_CAP;

  // A unit cone whose tip points along local −Z — three's own camera convention (a camera looks
  // down −Z; `right × up = −forward`, so a basis with +Z = forward is LEFT-handed and its
  // quaternion garbage — caught by the scale test). The stock cone grows along +Y; −90° about X
  // maps +Y onto −Z. Centred at the apex, so the marker reads as "a camera here, looking that way".
  const geometry = new THREE.ConeGeometry(0.45, 1, 8, 1).rotateX(-Math.PI / 2);
  // White material × per-instance colour (three multiplies `diffuse` by `instanceColor`): the
  // accent for a marker, a lightened accent for a resident one.
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = "facadeMarkers";
  scene.add(mesh);

  const colorMarker = new THREE.Color(tokens.accent);
  // No `accentHi` token exists (tokens.ts 2026-10-21): the resident tint is the accent lifted
  // toward white — the pins' rim idiom, kept off the token sheet until design names one.
  const colorResident = new THREE.Color(tokens.accent).lerp(new THREE.Color(0xffffff), 0.45);

  const entries = new Map<string, Entry>();
  /** The drawn rows in instance order (index = instanceId). */
  let order: string[] = [];
  let pushed: readonly FacadeWorldItem[] = [];
  let residentSet = new Set<string>();
  let hiddenId: string | null = null;
  let dirty = true;
  let shown = true;

  const _m = new THREE.Matrix4();
  const _basis = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  const invalidateBounds = () => {
    mesh.boundingSphere = null; // the trap in the header — after EVERY instance write
  };

  const makeEntry = (row: FacadeWorldItem): Entry => {
    const geom = facadeFrustumGeometry(row, planeDistM, fallbackAspect);
    _x.set(geom.right[0], geom.right[1], geom.right[2]);
    _y.set(geom.up[0], geom.up[1], geom.up[2]);
    _z.set(-geom.forward[0], -geom.forward[1], -geom.forward[2]);
    _basis.makeBasis(_x, _y, _z); // local +X right, +Y up, −Z forward (the cone's tip) — right-handed
    return {
      row,
      geom,
      apex: new THREE.Vector3(geom.apex[0], geom.apex[1], geom.apex[2]),
      quat: new THREE.Quaternion().setFromRotationMatrix(_basis),
    };
  };

  const tint = (i: number, id: string) => {
    mesh.setColorAt(i, residentSet.has(id) ? colorResident : colorMarker);
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
          else entries.set(row.id, makeEntry(row));
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
      for (let i = 0; i < order.length; i++) tint(i, order[i]);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      // The scale is distance-dependent, so a static camera needs no per-frame work (the Pins
      // idiom: rebuild when the camera moved > 1 m or the rows changed).
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      if (!dirty && !camMoved) return;
      _camLast.copy(camera.position);
      dirty = false;
      // Anchor the mesh AT the camera (the precision note in the header): instance translations
      // become camera-relative and stay float32-exact near the viewer.
      mesh.position.copy(camera.position);
      for (let i = 0; i < order.length; i++) {
        const e = entries.get(order[i]);
        if (!e) continue;
        const distM = camera.position.distanceTo(e.apex);
        const scale = THREE.MathUtils.clamp(distM * PHOTO_PROJECT.markerAngularSize, PHOTO_PROJECT.markerMinM, PHOTO_PROJECT.markerMaxM);
        _s.setScalar(scale);
        _m.compose(_p.subVectors(e.apex, camera.position), e.quat, _s);
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
      entries.clear();
      order = [];
    },
  };
}
