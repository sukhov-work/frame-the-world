import * as THREE from "three";
import { frustumGeometry, type FrustumGeometry } from "../../lib/geo/frustum";
import { verticalFovDeg } from "../../lib/decode/sensors";
import { tokens } from "../../lib/theme/tokens";
import { derivedFov, useUploadStore } from "../../store/upload";
import { FRUSTUM } from "./tuning";

/**
 * PhotoFrustum — the placed photo as an oriented camera frustum + image plane at its capture
 * location (Phase 3, ADR D5 v1). Edge lines in the accent colour (signal, per the design system);
 * the image plane is the decoded photo itself at the frustum's far face.
 *
 * Subscribes to the upload store OUTSIDE React (zustand vanilla) — the globe is not a React island
 * child; slider changes re-project via a direct geometry update (<1 ms of math, no allocation on
 * the hot path beyond the rebuilt Float32 writes).
 *
 * Precision: vertices are stored RELATIVE to the apex and the group sits at the apex, so the
 * geometry keeps full float32 precision at ECEF magnitudes (same strategy the tiles use).
 */
export interface PhotoFrustumHandle {
  /** Current geometry, or null while nothing is placed. */
  current(): FrustumGeometry | null;
  dispose(): void;
}

export function attachPhotoFrustum(
  scene: THREE.Scene,
  opts: {
    /** Fired when a photo lands (place / click-to-place / re-place) — the orchestrator flies to it. */
    onPlaced?: (geom: FrustumGeometry) => void;
  } = {},
): PhotoFrustumHandle {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // 8 edges: apex→4 corners + the far-face quad = 16 vertices (LineSegments pairs).
  const linePositions = new Float32Array(16 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.accent),
    transparent: true,
    opacity: FRUSTUM.lineOpacity,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.raycast = () => {};
  group.add(lines);

  // Image plane: 4 corners, 2 triangles, photo texture.
  const planePositions = new Float32Array(4 * 3);
  const planeGeo = new THREE.BufferGeometry();
  planeGeo.setAttribute("position", new THREE.BufferAttribute(planePositions, 3));
  planeGeo.setAttribute(
    "uv",
    new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2), // TL, TR, BR, BL
  );
  planeGeo.setIndex([0, 3, 1, 1, 3, 2]); // front face toward -forward (the viewer behind the camera)
  const planeMat = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    toneMapped: false, // the photo shows its own colours, not the scene grade
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.raycast = () => {};
  group.add(plane);

  let texture: THREE.Texture | undefined;
  let textureUrl: string | undefined;
  let geom: FrustumGeometry | null = null;

  function setTexture(url: string | undefined): void {
    if (url === textureUrl) return;
    texture?.dispose();
    texture = undefined;
    textureUrl = url;
    if (!url) {
      planeMat.map = null;
      planeMat.needsUpdate = true;
      return;
    }
    texture = new THREE.TextureLoader().load(url, () => {
      planeMat.needsUpdate = true;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    planeMat.map = texture;
    planeMat.needsUpdate = true;
  }

  function rebuild(): void {
    const s = useUploadStore.getState();
    if (s.phase !== "placed" || !s.placement || !s.exif) {
      group.visible = false;
      geom = null;
      setTexture(undefined);
      return;
    }
    const aspect =
      s.textureWidth && s.textureHeight
        ? s.textureWidth / s.textureHeight
        : FRUSTUM.fallbackAspect;
    const hFovDeg = derivedFov(s.exif, s.params).hFovDeg;
    geom = frustumGeometry({
      latDeg: s.placement.latDeg,
      lonDeg: s.placement.lonDeg,
      altM: s.params.altitudeM ?? FRUSTUM.eyeHeightM,
      headingDeg: s.params.headingDeg ?? 0,
      pitchDeg: s.params.pitchDeg ?? 0,
      rollDeg: s.exif.rollDeg ?? 0,
      hFovDeg,
      vFovDeg: verticalFovDeg(hFovDeg, aspect),
      planeDistM: FRUSTUM.planeDistM,
    });
    // Group at the apex; vertices apex-relative (float32-safe at ECEF magnitudes).
    const [ax, ay, az] = geom.apex;
    group.position.set(ax, ay, az);
    const c = geom.corners.map(([x, y, z]) => [x - ax, y - ay, z - az]);
    let o = 0;
    for (const corner of c) {
      linePositions[o++] = 0; linePositions[o++] = 0; linePositions[o++] = 0;
      linePositions[o++] = corner[0]; linePositions[o++] = corner[1]; linePositions[o++] = corner[2];
    }
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      linePositions[o++] = a[0]; linePositions[o++] = a[1]; linePositions[o++] = a[2];
      linePositions[o++] = b[0]; linePositions[o++] = b[1]; linePositions[o++] = b[2];
    }
    for (let i = 0; i < 4; i++) {
      planePositions[i * 3] = c[i][0];
      planePositions[i * 3 + 1] = c[i][1];
      planePositions[i * 3 + 2] = c[i][2];
    }
    lineGeo.attributes.position.needsUpdate = true;
    planeGeo.attributes.position.needsUpdate = true;
    lineGeo.computeBoundingSphere();
    planeGeo.computeBoundingSphere();
    setTexture(s.previewUrl);
    group.visible = true;
  }

  // Vanilla subscription: re-project on any relevant change; announce landings for the flight.
  const unsubscribe = useUploadStore.subscribe((s, prev) => {
    const landed =
      s.phase === "placed" && (prev.phase !== "placed" || s.placement !== prev.placement);
    if (
      s.phase !== prev.phase ||
      s.placement !== prev.placement ||
      s.params !== prev.params ||
      s.previewUrl !== prev.previewUrl ||
      s.textureWidth !== prev.textureWidth ||
      s.textureHeight !== prev.textureHeight
    ) {
      rebuild();
    }
    if (landed && geom) opts.onPlaced?.(geom);
  });
  rebuild(); // pick up a pre-existing placed state (e.g. HMR re-attach)

  return {
    current: () => geom,
    dispose() {
      unsubscribe();
      texture?.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      planeGeo.dispose();
      planeMat.dispose();
      scene.remove(group);
    },
  };
}
