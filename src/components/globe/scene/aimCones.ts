import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { AIMCONES } from "../tuning";
import { sampleAimDay, type AimDay } from "../../../lib/ephemeris/azSector";
import { bodyTarget, targetAzAlt, type SkyTarget } from "../../../lib/ephemeris/targets";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";

/**
 * Map direction lines + visibility cones (UPLIFT U4, owner point 3): from the plan anchor,
 * three azimuth systems — tracked target (accent) / sun (sunGlow) / moon (moonlight) — each a
 * direction line at the CURRENT azimuth plus a ground sector sweeping the body's rise→set
 * azimuths across the scene-local solar day. The sector splits at scene time: swept-already =
 * tokens.warn amber, still-to-come = tokens.timeFuture blue — a per-vertex aT01 vs uNow01
 * shader compare (the dayArcs grammar), so scrubbing never rebuilds geometry.
 *
 * Geometry lives in a UNIT circle on the anchor's ENU tangent plane (x=east, y=north, z=up);
 * the group matrix carries the ECEF anchor + basis × eased radius (the vectorFeatures float32
 * lesson: local frame in the geometry, planetary magnitude in the matrix). Zoom adaption is a
 * matrix rescale, never a rebuild. Rebuilds happen only on anchor-move past the deadband /
 * day-cross / target-swap — ~145 ephemeris calls per body, the dayArcs budget.
 *
 * Depth-free like the day arcs (renderOrder 9, no depth test): a flat metre-scale sector
 * cannot follow terrain relief, and a planning overlay reads THROUGH the world — which also
 * makes the flat-map MAP-INK behaviour automatic. Alpha-blended, NEVER additive (S6).
 * One body is EMPHASIZED (full radius + glassy fill); the others render compact (rim-only at
 * AIMCONES.compactK) — the owner's "don't overload the map" ruling.
 */

type AimKey = "target" | "sun" | "moon";

export interface AimConesHandle {
  group: THREE.Group;
  update(ctx: {
    /** Scene time (ms) — past/future split + day-window rebuild check. */
    sceneMs: number;
    /** The plan anchor / view-focus eye (deg); null hides the overlay. */
    anchor: { latDeg: number; lonDeg: number } | null;
    /** Geodetic camera altitude (m) — presence band + zoom-adaptive radius. */
    alt: number;
    /** False in FPV (the viewfinder stays clean — streetNames/vectors rule). */
    enabled: boolean;
    /** The tracked sky target (store/sky mirror — pushed, never read here). */
    target: SkyTarget;
    /** Per-body AIM flags + the emphasized system (store/sky mirror). */
    aim: { target: boolean; sun: boolean; moon: boolean; focus: AimKey };
    dtMs: number;
  }): void;
  dispose(): void;
}

/** Sector material — past/future COLOUR split (the dayArcs split is alpha-only). Past is
 *  NEUTRAL light grey, not amber (owner 2026-08-18: amber read as a day/night claim — the
 *  swept segment is inert history, so it wears the inert text grey). */
function makeSectorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // planning overlay reads through the world (module doc)
    side: THREE.DoubleSide, // the tangent plane is seen from either hemisphere of tilt
    uniforms: {
      uPast: { value: new THREE.Color(tokens.textSecondary) },
      uFuture: { value: new THREE.Color(tokens.timeFuture) },
      uNow01: { value: 0 },
      uAlpha: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aT01;
      varying float vT;
      void main() {
        vT = aT01;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPast;
      uniform vec3 uFuture;
      uniform float uNow01;
      uniform float uAlpha;
      varying float vT;
      void main() {
        vec3 c = mix(uPast, uFuture, step(uNow01, vT));
        if (uAlpha < 0.003) discard;
        gl_FragColor = vec4(c, uAlpha);
        #include <colorspace_fragment>
      }`,
  });
}

/** Direction-line material — flat body-identity colour with a runtime alpha (paling). */
function makeLineMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() {
        if (uAlpha < 0.003) discard;
        gl_FragColor = vec4(uColor, uAlpha);
        #include <colorspace_fragment>
      }`,
  });
}

const DEG = Math.PI / 180;

export function attachAimCones(opts: {
  scene: THREE.Scene;
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
}): AimConesHandle {
  const group = new THREE.Group();
  group.visible = false;
  group.matrixAutoUpdate = false;
  opts.scene.add(group);

  const bodies = (
    [
      // Moon wears the DIAL silver, not scene moonlight — tokens.moonDial exists exactly so the
      // moon's aim ink cannot be mistaken for the textSecondary past-sector grey (owner
      // 2026-08-18); the sun keeps its warm sunGlow, the tracked target the signal accent.
      { key: "target" as AimKey, color: tokens.accent },
      { key: "sun" as AimKey, color: tokens.sunGlow },
      { key: "moon" as AimKey, color: tokens.moonDial },
    ] as const
  ).map(({ key, color }) => {
    const holder = new THREE.Group(); // per-body compact/emphasized scale lives here
    group.add(holder);
    const fanMat = makeSectorMaterial();
    const rimMat = makeSectorMaterial();
    const edgesMat = makeLineMaterial(color); // rise/set radial spokes — BODY identity colour
    const lineMat = makeLineMaterial(color);
    const fan = new THREE.Mesh(new THREE.BufferGeometry(), fanMat);
    const rim = new THREE.LineSegments(new THREE.BufferGeometry(), rimMat);
    const edges = new THREE.LineSegments(new THREE.BufferGeometry(), edgesMat);
    // UNIT-length quad along +north (tip exactly at the rim radius); rotation.z = −az swings
    // it to the compass bearing, and scale.y stretches ONLY the focused body's line past the
    // rim (owner 2026-08-18: non-focused lines end exactly at their circle). Local scale
    // applies before the rotation in the matrix, so the stretch rides the line's own axis.
    const w = AIMCONES.lineHalfWidthK;
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-w, 0, 0, w, 0, 0, w, 1, 0, -w, 0, 0, w, 1, 0, -w, 1, 0]),
        3,
      ),
    );
    const line = new THREE.Mesh(lineGeom, lineMat);
    for (const obj of [fan, rim, edges, line]) {
      obj.raycast = () => {};
      obj.frustumCulled = false; // unit geometry under a scaled matrix — bounds would lie
      obj.renderOrder = 9; // depth-free ink under the sky overlays (10); per-object (Group renderOrder does not propagate)
      holder.add(obj);
    }
    return {
      key,
      holder,
      fan,
      rim,
      edges,
      line,
      fanMat,
      rimMat,
      edgesMat,
      lineMat,
      day: null as AimDay | null,
      emphasisScale: 1,
    };
  });

  let anchorLat = NaN;
  let anchorLon = NaN;
  let builtTargetId = "";
  let fade = 0;
  let radius = 0; // m — raw zoom function, recomputed every frame (see the update() note)
  let groundM = Number.NaN; // eased terrain seat at the anchor (NaN = unseeded)
  const _ecef = new THREE.Vector3();
  const _e = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _u = new THREE.Vector3();

  const targetFor = (key: AimKey, tracked: SkyTarget): SkyTarget =>
    key === "target" ? tracked : bodyTarget(key);

  /** Rebuild one body's sector from its aim day — unit-circle fan + rim with per-vertex t01. */
  function rebuildBody(b: (typeof bodies)[number], day: AimDay) {
    b.day = day;
    const t01 = (ms: number) => (ms - day.startMs) / (day.endMs - day.startMs);
    const fanPos: number[] = [];
    const fanT: number[] = [];
    const rimPos: number[] = [];
    const rimT: number[] = [];
    for (const run of day.runs) {
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i];
        const c = run[i + 1];
        const ax = Math.sin(a.azDeg * DEG);
        const ay = Math.cos(a.azDeg * DEG);
        const cx = Math.sin(c.azDeg * DEG);
        const cy = Math.cos(c.azDeg * DEG);
        const ta = t01(a.utcMs);
        const tc = t01(c.utcMs);
        // Per-wedge centre copy: its t01 is the wedge midpoint, so the shader's now-split
        // cuts the one straddling wedge roughly radially instead of smearing the whole fan.
        fanPos.push(0, 0, 0, ax, ay, 0, cx, cy, 0);
        fanT.push((ta + tc) / 2, ta, tc);
        rimPos.push(ax, ay, 0, cx, cy, 0);
        rimT.push(ta, tc);
      }
    }
    // Radial edges close the wedge at each run's rise/set azimuth (a rim arc alone floats).
    // BODY-IDENTITY coloured, own geometry (owner 2026-08-18): these spokes ARE the body's
    // visibility boundary — sun rise/set wears sunGlow, moon wears the dial silver — so they
    // must not ride the past/future split the rim arcs carry. A ring has no rise/set — none.
    const edgePos: number[] = [];
    if (day.kind !== "ring") {
      for (const run of day.runs) {
        if (run.length < 2) continue;
        const first = run[0];
        const last = run[run.length - 1];
        edgePos.push(0, 0, 0, Math.sin(first.azDeg * DEG), Math.cos(first.azDeg * DEG), 0);
        edgePos.push(0, 0, 0, Math.sin(last.azDeg * DEG), Math.cos(last.azDeg * DEG), 0);
      }
    }
    b.edges.geometry.dispose();
    b.edges.geometry = new THREE.BufferGeometry();
    b.edges.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgePos), 3));
    b.fan.geometry.dispose();
    b.fan.geometry = new THREE.BufferGeometry();
    b.fan.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fanPos), 3));
    b.fan.geometry.setAttribute("aT01", new THREE.BufferAttribute(new Float32Array(fanT), 1));
    b.rim.geometry.dispose();
    b.rim.geometry = new THREE.BufferGeometry();
    b.rim.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rimPos), 3));
    b.rim.geometry.setAttribute("aT01", new THREE.BufferAttribute(new Float32Array(rimT), 1));
  }

  return {
    group,
    update({ sceneMs, anchor, alt, enabled, target, aim, dtMs }) {
      const anyOn = aim.target || aim.sun || aim.moon;
      const presence =
        alt >= AIMCONES.topAltM
          ? 0
          : alt <= AIMCONES.fullAltM
            ? 1
            : 1 - (alt - AIMCONES.fullAltM) / (AIMCONES.topAltM - AIMCONES.fullAltM);
      const want = enabled && anyOn && anchor !== null && presence > 0;
      fade += ((want ? 1 : 0) - fade) * (1 - Math.exp(-dtMs / AIMCONES.fadeTauMs));
      if (fade < 0.01 && !want) {
        group.visible = false;
        return;
      }
      if (anchor) {
        // Rebuild gate: coarse anchor deadband (the focus anchor pans continuously in orbit),
        // day-cross, target swap.
        const moved =
          Math.abs(anchor.latDeg - anchorLat) > AIMCONES.anchorEpsDeg ||
          Math.abs(anchor.lonDeg - anchorLon) > AIMCONES.anchorEpsDeg;
        const day0 = bodies[0].day;
        const dayCrossed = !day0 || sceneMs < day0.startMs || sceneMs >= day0.endMs;
        const swapped = builtTargetId !== target.id;
        if (moved || dayCrossed || swapped) {
          anchorLat = anchor.latDeg;
          anchorLon = anchor.lonDeg;
          builtTargetId = target.id;
          groundM = Number.NaN; // re-seat at the new anchor
          for (const b of bodies) {
            rebuildBody(
              b,
              sampleAimDay(
                targetFor(b.key, target),
                sceneMs,
                anchorLat,
                anchorLon,
                AIMCONES.stepMin,
              ),
            );
          }
        }

        // Terrain seat — eased like the temp pin (first sample snaps; a null probe keeps the
        // last seat; an unseeded null sits at the ellipsoid until tiles answer). Probes the
        // LIVE anchor: the deadband quantizes only the EPHEMERIS, never the seat (a 0.02°
        // stale seat is ~2 km of visible offset — browser-caught 2026-08-18).
        const probe = opts.terrainHeightAt(anchor.latDeg, anchor.lonDeg);
        if (probe !== null) {
          groundM = Number.isNaN(groundM)
            ? probe
            : groundM + (probe - groundM) * (1 - Math.exp(-dtMs / AIMCONES.fadeTauMs));
        }

        // Zoom-adaptive radius — RAW, never eased (owner 2026-08-18: the circle must resize in
        // lockstep with the wheel/pinch; the clamp is continuous in alt, so direct application
        // is smooth by construction — the old 180 ms ease read as the overlay trailing the zoom).
        radius = Math.min(
          AIMCONES.radiusMaxM,
          Math.max(AIMCONES.radiusMinM, alt * AIMCONES.radiusAltK),
        );

        // Seat the group at the LIVE anchor — only the az curves ride the rebuild deadband
        // (azimuths barely move over 2 km; the seat visibly does).
        const basis = enuBasis(anchor.latDeg, anchor.lonDeg);
        const [x, y, z] = geodeticToEcef(
          anchor.latDeg,
          anchor.lonDeg,
          Number.isNaN(groundM) ? 0 : groundM,
        );
        _e.set(basis.east[0], basis.east[1], basis.east[2]).multiplyScalar(radius);
        _n.set(basis.north[0], basis.north[1], basis.north[2]).multiplyScalar(radius);
        _u.set(basis.up[0], basis.up[1], basis.up[2]).multiplyScalar(radius);
        group.matrix.makeBasis(_e, _n, _u).setPosition(_ecef.set(x, y, z));
      }
      group.visible = true;

      const overlayA = fade * presence;
      for (const b of bodies) {
        const on = aim[b.key];
        b.holder.visible = on;
        if (!on || !b.day) continue;
        const emphasized = aim.focus === b.key;
        // Compact systems shrink to compactK and drop their fill — eased, never a pop.
        const wantScale = emphasized ? 1 : AIMCONES.compactK;
        b.emphasisScale += (wantScale - b.emphasisScale) * (1 - Math.exp(-dtMs / AIMCONES.radiusTauMs));
        b.holder.scale.setScalar(b.emphasisScale);

        const now01 = Math.min(
          1,
          Math.max(0, (sceneMs - b.day.startMs) / (b.day.endMs - b.day.startMs)),
        );
        b.fanMat.uniforms.uNow01.value = now01;
        b.rimMat.uniforms.uNow01.value = now01;
        // Fill rides the SAME eased emphasis scale — a focus swap breathes, never pops.
        const emphK = Math.max(
          0,
          (b.emphasisScale - AIMCONES.compactK) / (1 - AIMCONES.compactK),
        );
        b.fanMat.uniforms.uAlpha.value = AIMCONES.fillAlpha * overlayA * emphK;
        b.rimMat.uniforms.uAlpha.value = AIMCONES.rimAlpha * overlayA;
        b.edgesMat.uniforms.uAlpha.value = AIMCONES.rimAlpha * overlayA;

        // Direction line: current azimuth + below-horizon paling (3 ephemeris calls/frame —
        // the sky marker's own budget). Only the FOCUSED body's line reads past the rim;
        // the others end exactly at their circle (rides the same emphasis ease — no pop).
        const nowPos = targetAzAlt(targetFor(b.key, target), sceneMs, anchorLat, anchorLon);
        b.line.rotation.z = -nowPos.azDeg * DEG;
        b.line.scale.y = 1 + (AIMCONES.lineLenK - 1) * emphK;
        b.lineMat.uniforms.uAlpha.value =
          (nowPos.altDeg > 0 ? AIMCONES.lineAlpha : AIMCONES.lineAlphaDown) * overlayA;
      }
    },
    dispose() {
      for (const b of bodies) {
        b.fan.geometry.dispose();
        b.rim.geometry.dispose();
        b.edges.geometry.dispose();
        b.line.geometry.dispose();
        b.fanMat.dispose();
        b.rimMat.dispose();
        b.edgesMat.dispose();
        b.lineMat.dispose();
      }
      opts.scene.remove(group);
    },
  };
}
