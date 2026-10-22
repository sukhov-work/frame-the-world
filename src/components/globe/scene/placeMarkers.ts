import * as THREE from "three";
import { geodeticToEcef } from "../../../lib/geo/projection";
import { sampleGroundM } from "../../../lib/geo/terrain";
import { tokens } from "../../../lib/theme/tokens";
import type { PlaceListItem } from "../../../lib/wix/placeRecords";
import { PLACEMARKS } from "../tuning";

/**
 * placeMarkers — MY PLACES on the GL globe (owner 2026-08-19b: "expected a dot per saved place
 * on the map"; T189, owner 2026-10-22g: "rework my saved places pins on map to look like location
 * icon … be a bit bigger and highlightable"): the member's saved views as LOCATION-PIN billboards —
 * the camera panel's MY SPOT glyph (an outline pin with a dot, `CameraTiltPanel`'s SVG) drawn on a
 * canvas, lavender (`tokens.pinLavender` — "yours but dormant"), WHITE + `markerHoverScale` larger
 * while hovered (eased with `markerHoverEaseTauMs`, the pins' S4 feel). The scene twin of the 2D
 * map window's canvas layer (MapWindow draws the same pin).
 *
 * THE IDIOM IS `scene/facadeMarkers.ts` (T178 / T183): ONE InstancedMesh, the billboard IN THE
 * MATRIX (each instance composes (ground point − camera, the CAMERA's quaternion, the scale) — a
 * plain MeshBasicMaterial draws it and the stock raycast sees the same quad the eye does), an
 * angular-constant scale clamped to [`markerMinM`, `markerMaxM`], `depthTest: false` + `depthWrite:
 * false` (a wayfinding overlay reads THROUGH buildings and terrain like the aim overlay), the far
 * hemisphere culled CPU-side (scale 0 — a depth-free quad must not shine through the planet from
 * orbit), `frustumCulled: false` (instances span the planet), the raycast ENABLED for the click /
 * hover (the orchestrator picks through `pick`, which hands back the FULL place row — the ruling
 * 2026-10-22h: a click JUMPS INTO FPV at the saved viewpoint, clock first), and `boundingSphere =
 * null` after EVERY instance write (the T126 / Phase-5 trap: three caches the sphere on the first
 * raycast; a stale sphere makes every later pick miss).
 *
 * THE PIN STANDS ON ITS POINT: the unit quad is translated up so its origin is the glyph's TIP
 * (`PLACE_PIN_TIP_FRAC` of the quad's height above the bottom edge — the halo's margin), and the
 * instance origin is the ground point (+ `liftM`): the head rises above the place, the point marks
 * it. The facade markers centre theirs (an apex floats).
 *
 * PRECISION: the same anchor-at-the-camera layout as Pins — ECEF instance translations are
 * camera-relative so the float32 large×large cancellation happens on the CPU in float64.
 *
 * STORE-FREE (the scene fence): rows are pushed (`setPlaces`), visibility (`setVisible`) and the
 * hover (`setHover`) are pushed; the terrain is asked through `terrainHeightAt` (the Pins resnap
 * idiom — a place placed before its tiles answered re-asks at a low cadence).
 */

/** The spot a marker stands at IS the saved place — the full row rides along for the jump. */
export type PlaceMarkerSpot = PlaceListItem;

/** The glyph's tip sits this fraction of the quad's height above its bottom edge (the halo's margin
 *  — `markerIconOutlinePx / 2 + 3` px of the 128-px canvas). */
export const PLACE_PIN_TIP_FRAC = (PLACEMARKS.markerIconOutlinePx / 2 + 3) / 128;

export interface PlaceMarkersHandle {
  /** The pickable draw — exposed for the orchestrator's raycast list; `pick` is the house path. */
  mesh: THREE.InstancedMesh;
  setPlaces(spots: readonly PlaceMarkerSpot[]): void;
  update(camera: THREE.PerspectiveCamera): void;
  /** Master visibility (the PLC / LAYERS "MY PLACES" chips via store/places.onMap). */
  setVisible(on: boolean): void;
  /** Re-ask the terrain for ground height (cheap, low cadence — the Pins idiom). */
  resnap(): void;
  /** The place under an NDC point (−1..1) — the FULL row — or null. */
  pick(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera): PlaceMarkerSpot | null;
  /** The hovered place (null = none) — eases up + brightens over the next frames. */
  setHover(id: string | null): void;
  hovered(): string | null;
  /** The ground anchor (ECEF m, lifted) of a place, or null when unknown. */
  anchorOf(id: string): [number, number, number] | null;
  /** DEV seam: the drawn quad's side (m) for a place after the last recompose, or null. */
  scaleOf(id: string): number | null;
  count(): { total: number; drawn: number };
  dispose(): void;
}

/** The location-pin glyph — the MY SPOT SVG (`M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5
 *  12.5s6.5-7.9 6.5-12.5A6.5 6.5 0 0 0 12 2.5z` + the (12, 9) r 2.3 dot) on a 128-px canvas: a
 *  dark halo, a white body (the instance tint colours it), the dot punched dark; the pin fills the
 *  canvas height with the tip `PLACE_PIN_TIP_FRAC` above the bottom. Null where no 2D canvas
 *  exists (vitest / SSR): the quad then draws as a plain tinted square. */
export function drawPlacePinIcon(size = 128): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // The SVG spans x 5.5..18.5 (13 units) and y 2.5..21.5 (19 units) on its 24-grid; the margin
  // keeps the halo inside the canvas; the pin is scaled to the full height and centred.
  const margin = PLACE_PIN_TIP_FRAC * size;
  const k = (size - 2 * margin) / 19;
  const ox = (size - 13 * k) / 2 - 5.5 * k;
  const oy = margin - 2.5 * k;
  ctx.setTransform(k, 0, 0, k, ox, oy);
  const pin = (): void => {
    ctx.beginPath();
    ctx.moveTo(12, 2.5);
    ctx.arc(12, 9, 6.5, -Math.PI / 2, Math.PI, true); // the head's left half, top → left
    ctx.bezierCurveTo(5.5, 13.6, 12, 21.5, 12, 21.5); // down to the tip
    ctx.bezierCurveTo(12, 21.5, 18.5, 13.6, 18.5, 9); // and back up the right side
    ctx.arc(12, 9, 6.5, 0, -Math.PI / 2, true); // the head's right half, right → top
    ctx.closePath();
  };
  // The halo: the body stroked wide and dark (reads on the sky and on stone alike).
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(8, 12, 20, 0.85)";
  ctx.lineWidth = (PLACEMARKS.markerIconOutlinePx * (size / 128)) / k;
  pin();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  pin();
  ctx.fill();
  // The dot, punched dark.
  ctx.beginPath();
  ctx.arc(12, 9, 2.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 12, 20, 0.9)";
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function attachPlaceMarkers(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
  } = {},
): PlaceMarkersHandle {
  const cap = PLACEMARKS.maxRender;

  // A unit quad, screen-aligned per instance by the CAMERA's quaternion in the instance matrix
  // (the header's raycast note); the glyph rides it as a map. The origin is the glyph's TIP.
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0.5 - PLACE_PIN_TIP_FRAC, 0);
  const icon = drawPlacePinIcon();
  const map = icon ? new THREE.CanvasTexture(icon) : null;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  // White material × per-instance colour (three multiplies `diffuse` by `instanceColor`): the
  // lavender for a place, white while hovered.
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map,
    transparent: true,
    opacity: PLACEMARKS.alpha,
    alphaTest: 0.02,
    depthTest: false, // wayfinding overlay — reads through the world (far side CPU-culled)
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the whole planet
  mesh.renderOrder = 3;
  mesh.name = "placeMarkers";
  scene.add(mesh);

  const colorPlace = new THREE.Color(tokens.pinLavender);
  const colorHover = new THREE.Color(0xffffff);
  const _tint = new THREE.Color();

  let spots: PlaceMarkerSpot[] = []; // the drawn rows (instance order; capped)
  let total = 0; // the pushed count (before the cap)
  const positions: THREE.Vector3[] = []; // marker anchor (ground + liftM), ECEF
  const grounded: boolean[] = []; // true once real terrain height answered (resnap idiom)
  /** The hover ease 0..1 per place id (the pins' `hoverAmt`) — survives a re-push. */
  const hoverAmt = new Map<string, number>();
  let hoverId: string | null = null;
  let hoverEasing = false;
  let lastTickMs = nowMs();

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _camQuatLast = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  const _ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let dirty = true;
  let shown = true;

  const invalidateBounds = () => {
    mesh.boundingSphere = null; // the trap in the header — after EVERY instance write
  };

  const place = (i: number) => {
    const s = spots[i];
    const { h, real } = sampleGroundM(opts.terrainHeightAt?.(s.latDeg, s.lonDeg), PLACEMARKS.fallbackGroundM);
    const [x, y, z] = geodeticToEcef(s.latDeg, s.lonDeg, h + PLACEMARKS.liftM);
    (positions[i] ??= new THREE.Vector3()).set(x, y, z);
    grounded[i] = real;
  };

  /** The tint: lavender blended to white by the hover ease. */
  const tint = (i: number) => {
    const amt = hoverAmt.get(spots[i].id) ?? 0;
    if (amt > 0) mesh.setColorAt(i, _tint.copy(colorPlace).lerp(colorHover, amt));
    else mesh.setColorAt(i, colorPlace);
  };
  const retint = () => {
    for (let i = 0; i < spots.length; i++) tint(i);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const indexOf = (id: string): number => {
    for (let i = 0; i < spots.length; i++) if (spots[i].id === id) return i;
    return -1;
  };

  return {
    mesh,

    setPlaces(next: readonly PlaceMarkerSpot[]) {
      total = next.length;
      spots = next.slice(0, cap);
      positions.length = spots.length;
      grounded.length = spots.length;
      const seen = new Set<string>();
      for (let i = 0; i < spots.length; i++) {
        place(i);
        seen.add(spots[i].id);
      }
      for (const id of [...hoverAmt.keys()]) if (!seen.has(id)) hoverAmt.delete(id);
      if (hoverId !== null && !seen.has(hoverId)) hoverId = null;
      mesh.count = spots.length;
      retint();
      dirty = true;
      invalidateBounds();
    },

    update(camera: THREE.PerspectiveCamera) {
      if (spots.length === 0 || !shown) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      // The hover ease: every amt runs toward 1 (the hovered) or 0, the pins' exponential tau;
      // while any is moving the matrices + tints recompose each frame.
      if (hoverEasing) {
        const t = nowMs();
        const dt = Math.max(0, Math.min(100, t - lastTickMs));
        lastTickMs = t;
        const k = 1 - Math.exp(-dt / Math.max(1, PLACEMARKS.markerHoverEaseTauMs));
        let moving = false;
        for (let i = 0; i < spots.length; i++) {
          const id = spots[i].id;
          const target = id === hoverId ? 1 : 0;
          const cur = hoverAmt.get(id) ?? 0;
          if (cur === target) continue;
          const next = cur + (target - cur) * k;
          const settled = Math.abs(next - target) < 0.005 ? target : next;
          if (settled === 0) hoverAmt.delete(id);
          else hoverAmt.set(id, settled);
          if (settled !== target) moving = true;
        }
        hoverEasing = moving;
        retint();
        dirty = true;
      }
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      const camTurned = !_camQuatLast.equals(camera.quaternion);
      if (!dirty && !camMoved && !camTurned) return;
      _camLast.copy(camera.position);
      _camQuatLast.copy(camera.quaternion);
      dirty = false;

      // Anchor AT the camera (precision note) — instance translations are camera-relative.
      mesh.position.copy(camera.position);
      for (let i = 0; i < spots.length; i++) {
        const p = positions[i];
        // Far-hemisphere cull: a depth-free overlay must not shine through the planet.
        _up.copy(p).normalize();
        const facing = _up.dot(_toCam.subVectors(camera.position, p).normalize()) > 0;
        const size = facing
          ? THREE.MathUtils.clamp(
              camera.position.distanceTo(p) * PLACEMARKS.markerAngularSize,
              PLACEMARKS.markerMinM,
              PLACEMARKS.markerMaxM,
            ) *
            (1 + (PLACEMARKS.markerHoverScale - 1) * (hoverAmt.get(spots[i].id) ?? 0))
          : 0; // scale 0 → degenerate quad, nothing rasterises, nothing picks
        _m.compose(_p.subVectors(p, camera.position), camera.quaternion, _s.setScalar(size));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      invalidateBounds(); // scales changed — see the header's trap note
    },

    setVisible(on: boolean) {
      if (on === shown) return;
      shown = on;
      if (on) dirty = true; // matrices went stale while hidden
    },

    resnap() {
      let changed = false;
      for (let i = 0; i < spots.length; i++) {
        if (grounded[i]) continue;
        place(i);
        if (grounded[i]) changed = true;
      }
      if (changed) {
        dirty = true;
        invalidateBounds(); // the anchors moved — a pick before the next frame must not read the old sphere
      }
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
      return id !== undefined && id < spots.length ? spots[id] : null;
    },

    setHover(id) {
      if (id === hoverId) return;
      hoverId = id !== null && indexOf(id) >= 0 ? id : null;
      hoverEasing = true; // the ease runs in `update` until every amt has settled
      lastTickMs = nowMs();
    },

    hovered() {
      return hoverId;
    },

    anchorOf(id) {
      const i = indexOf(id);
      if (i < 0) return null;
      const p = positions[i];
      return [p.x, p.y, p.z];
    },

    scaleOf(id) {
      const i = indexOf(id);
      if (i < 0 || i >= mesh.count) return null;
      mesh.getMatrixAt(i, _m);
      // The x column's length — `decompose()` reports a scale of 1 for a culled (all-zero) instance.
      const te = _m.elements;
      return Math.hypot(te[0], te[1], te[2]);
    },

    count() {
      return { total, drawn: spots.length };
    },

    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      map?.dispose();
      hoverAmt.clear();
    },
  };
}
