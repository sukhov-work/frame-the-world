import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { AIMCONES } from "../tuning";
import { fractureRunsBySkyline, sampleAimDay, type AimDay } from "../../../lib/ephemeris/azSector";
import { bodyTarget, targetAzAlt, type SkyTarget } from "../../../lib/ephemeris/targets";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";
import { sampleBins } from "../../../lib/geo/horizonProfile";
import { clampGroundM } from "../../../lib/geo/terrain";

/**
 * Map direction lines + visibility cones (UPLIFT U4, owner point 3): from the plan anchor,
 * three azimuth systems — tracked target (accent) / sun (sunGlow) / moon (moonlight) — each a
 * direction line at the CURRENT azimuth plus a ground sector sweeping the body's rise→set
 * azimuths across the scene-local solar day. The sector splits at scene time: swept-already =
 * inert textSecondary grey, still-to-come = the body's own ink for sun/moon (sunGlow /
 * moonDial — owner item 17, 2026-08-21b) and timeFuture blue for the target — a per-vertex
 * aT01 vs uNow01 shader compare (the dayArcs grammar), so scrubbing never rebuilds geometry.
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
 *
 * Batch #4 S2 (owner item 9, 2026-08-21): the three systems are CONCENTRIC ANNULAR BANDS
 * (AIMCONES.bandSun inner ring / bandMoon ring above it / bandTarget clipped at the outer
 * circle) — non-overlapping by construction, so the old compact/emphasized radius scaling is
 * retired; emphasis now gates FILL + keeps the tap-to-focus semantics. Sun/moon dials cap at
 * their OWN band's outer radius; the target ray keeps rayLenK. A small `N` marker sits on the
 * rim (the 2D map rotates everywhere now — the radar carries its own north).
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
    /** Shell-aware presence band (m) — desktop rides the tight AIMCONES.desktop* band,
     *  /m the wide one (owner 2026-08-19b). */
    band: { fullAltM: number; topAltM: number };
    /** False in FPV (the viewfinder stays clean — streetNames/vectors rule). */
    enabled: boolean;
    /** The tracked sky target (store/sky mirror — pushed, never read here). */
    target: SkyTarget;
    /** Per-body AIM flags + the emphasized system (store/sky mirror). */
    aim: { target: boolean; sun: boolean; moon: boolean; focus: AimKey };
    /** /m shell (orchestrator-pushed environment fact — batch #5 item 2): 20% smaller radius
     *  + the sun/moon bands pulled inward (bandFor's mobile variant). */
    mobile: boolean;
    /** Skyline profile bins for THIS anchor's eye (owner QA 2026-08-21 item 3), or null —
     *  the orchestrator resolves store/plan.profileBins behind the AIMCONES.skylineGuardM
     *  anchor-match rule; when present, band fills/rims FRACTURE where the body is occluded
     *  (fractureRunsBySkyline). Array identity is the rebuild key — planFeed mirrors a fresh
     *  array once per completed build. */
    skylineBins: readonly number[] | null;
    dtMs: number;
  }): void;
  dispose(): void;
}

/** Sector material — past/future COLOUR split (the dayArcs split is alpha-only). Past is
 *  NEUTRAL light grey, not amber (owner 2026-08-18: amber read as a day/night claim — the
 *  swept segment is inert history, so it wears the inert text grey). The future half wears
 *  `futureHex` — per-body via bandFutureInk (owner item 17); the split itself stays the
 *  step(uNow01, vT) compare, only the colour differs per body. */
function makeSectorMaterial(futureHex: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // planning overlay reads through the world (module doc)
    side: THREE.DoubleSide, // the tangent plane is seen from either hemisphere of tilt
    uniforms: {
      uPast: { value: new THREE.Color(tokens.textSecondary) },
      uFuture: { value: new THREE.Color(futureHex) },
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

/** Per-body annular band [inner, outer] as unit-radius fractions (pure — unit-tested; the
 *  MapWindow canvas twin + minimap radar consume the SAME allocation, one geometry model).
 *  On /m the sun/moon rings sit ~20% closer to the centre (owner batch #5 item 2). */
export function bandFor(
  key: "target" | "sun" | "moon",
  mobile = false,
): readonly [number, number] {
  return key === "sun"
    ? mobile
      ? AIMCONES.bandSunMobile
      : AIMCONES.bandSun
    : key === "moon"
      ? mobile
        ? AIMCONES.bandMoonMobile
        : AIMCONES.bandMoon
      : mobile
        ? AIMCONES.bandTargetMobile
        : AIMCONES.bandTarget;
}

/** Band FUTURE ink per body (owner item 17, 2026-08-21b): the sun/moon bands wear their BODY
 *  colour on the still-to-come part (sunGlow / moonDial silver) against the shared inert-grey
 *  past; the target band keeps the scrubber future-blue. Pure — unit-tested; the MapWindow
 *  canvas twin + minimap radar apply the SAME rule (per-body ink is already on their models). */
export function bandFutureInk(key: "target" | "sun" | "moon"): string {
  return key === "sun" ? tokens.sunGlow : key === "moon" ? tokens.moonDial : tokens.timeFuture;
}

/**
 * Terrain-seat ease (pure twin — tested). A null probe keeps the last seat; the FIRST finite
 * sample SNAPS (NaN prev = unseeded); later samples ease with time-constant `tauMs`. The raw
 * probe is clamped to `[0, MAX_TERRAIN_M]` BEFORE it can seat or steer the ease — terrain.ts
 * mandates the clamp for EVERY live heightAt consumer: one coarse-LOD negative would otherwise
 * snap the circle underground and the ease would retain it (audit-2 A1).
 */
export function easeSeatM(
  prevM: number,
  probe: number | null,
  dtMs: number,
  tauMs: number,
): number {
  if (probe === null) return prevM;
  const h = clampGroundM(probe);
  return Number.isNaN(prevM) ? h : prevM + (h - prevM) * (1 - Math.exp(-dtMs / tauMs));
}

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
    const fanMat = makeSectorMaterial(bandFutureInk(key));
    const rimMat = makeSectorMaterial(bandFutureInk(key));
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
      emphEased: 0, // eased 0..1 emphasis (fill gate) — band radii are fixed since S2
    };
  });

  // Small `N` north marker just past the outer circle at az 0 (owner addendum 2026-08-21 —
  // the 2D map rotates everywhere now, so the radar carries its own north). One 64px canvas
  // raster (the streetNames idiom, --font-ui resolved at attach), muted ink — an orientation
  // hint, not a signal. Lies on the tangent plane like the bands (top-down is the radar's
  // home view); alpha rides the whole-overlay fade in update().
  const uiFont =
    (typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim()
      : "") || "system-ui, sans-serif";
  const nCanvas = document.createElement("canvas");
  nCanvas.width = 64;
  nCanvas.height = 64;
  const nCtx = nCanvas.getContext("2d")!;
  nCtx.font = `600 44px ${uiFont}`;
  nCtx.textAlign = "center";
  nCtx.textBaseline = "middle";
  nCtx.fillStyle = tokens.textSecondary;
  nCtx.fillText("N", 32, 34);
  const nTexture = new THREE.CanvasTexture(nCanvas);
  nTexture.colorSpace = THREE.SRGBColorSpace;
  const northMat = new THREE.MeshBasicMaterial({
    map: nTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const north = new THREE.Mesh(
    new THREE.PlaneGeometry(AIMCONES.northSizeK, AIMCONES.northSizeK),
    northMat,
  );
  north.position.set(0, AIMCONES.northOffsetK, 0);
  north.raycast = () => {};
  north.frustumCulled = false;
  north.renderOrder = 9;
  group.add(north);

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

  /** Rebuild one body's sector from its aim day — an ANNULAR band strip between the body's
   *  own [inner, outer] radii (batch #4 S2) + outer-rim arc, per-vertex t01. */
  // /m flag, mirrored from the update ctx (static per shell — geometry built once is honest).
  let mobileNow = false;
  // Skyline bins mirrored from the ctx (rebuild-keyed on array identity) — fills/rims
  // fracture into visibility sub-runs; the rise/set spokes + direction line stay whole
  // (they mark the horizon boundary and the live bearing, not clear sky).
  let skylineNow: readonly number[] | null = null;

  function rebuildBody(b: (typeof bodies)[number], day: AimDay) {
    b.day = day;
    const [rIn, rOut] = bandFor(b.key, mobileNow);
    const t01 = (ms: number) => (ms - day.startMs) / (day.endMs - day.startMs);
    const fanPos: number[] = [];
    const fanT: number[] = [];
    const rimPos: number[] = [];
    const rimT: number[] = [];
    const bins = skylineNow;
    const visRuns = fractureRunsBySkyline(day.runs, bins ? (az) => sampleBins(bins, az) : null);
    for (const run of visRuns) {
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i];
        const c = run[i + 1];
        const ax = Math.sin(a.azDeg * DEG);
        const ay = Math.cos(a.azDeg * DEG);
        const cx = Math.sin(c.azDeg * DEG);
        const cy = Math.cos(c.azDeg * DEG);
        const ta = t01(a.utcMs);
        const tc = t01(c.utcMs);
        // Two triangles per wedge between the inner and outer arcs; each vertex keeps its own
        // sample's t01 (inner + outer share it), so the shader's now-split cuts the straddling
        // wedge radially — the old fan-centre-midpoint trick is unnecessary on a strip.
        fanPos.push(ax * rIn, ay * rIn, 0, ax * rOut, ay * rOut, 0, cx * rOut, cy * rOut, 0);
        fanT.push(ta, ta, tc);
        fanPos.push(ax * rIn, ay * rIn, 0, cx * rOut, cy * rOut, 0, cx * rIn, cy * rIn, 0);
        fanT.push(ta, tc, tc);
        rimPos.push(ax * rOut, ay * rOut, 0, cx * rOut, cy * rOut, 0);
        rimT.push(ta, tc);
      }
    }
    // Radial edges close the band at each run's rise/set azimuth (a rim arc alone floats).
    // BODY-IDENTITY coloured, own geometry (owner 2026-08-18): these spokes ARE the body's
    // visibility boundary — sun rise/set wears sunGlow, moon wears the dial silver — so they
    // must not ride the past/future split the rim arcs carry. A ring has no rise/set — none.
    // Since S2 they span the band (inner→outer), not centre→rim.
    const edgePos: number[] = [];
    if (day.kind !== "ring") {
      for (const run of day.runs) {
        if (run.length < 2) continue;
        for (const s of [run[0], run[run.length - 1]]) {
          const sx = Math.sin(s.azDeg * DEG);
          const sy = Math.cos(s.azDeg * DEG);
          edgePos.push(sx * rIn, sy * rIn, 0, sx * rOut, sy * rOut, 0);
        }
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
    update({ sceneMs, anchor, alt, band, enabled, target, aim, mobile, skylineBins, dtMs }) {
      mobileNow = mobile;
      const anyOn = aim.target || aim.sun || aim.moon;
      const presence =
        alt >= band.topAltM
          ? 0
          : alt <= band.fullAltM
            ? 1
            : 1 - (alt - band.fullAltM) / (band.topAltM - band.fullAltM);
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
        // Skyline arrival/expiry refractures the bands (owner QA 2026-08-21 item 3) — array
        // identity is the key: planFeed mirrors one fresh array per completed build.
        const skylineChanged = skylineBins !== skylineNow;
        if (moved || dayCrossed || swapped || skylineChanged) {
          anchorLat = anchor.latDeg;
          anchorLon = anchor.lonDeg;
          builtTargetId = target.id;
          skylineNow = skylineBins;
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

        // Terrain seat — eased like the temp pin (first CLAMPED sample snaps; a null probe
        // keeps the last seat; an unseeded null sits at the ellipsoid until tiles answer).
        // Probes the LIVE anchor: the deadband quantizes only the EPHEMERIS, never the seat
        // (a 0.02° stale seat is ~2 km of visible offset — browser-caught 2026-08-18).
        groundM = easeSeatM(
          groundM,
          opts.terrainHeightAt(anchor.latDeg, anchor.lonDeg),
          dtMs,
          AIMCONES.fadeTauMs,
        );

        // Zoom-adaptive radius — RAW, never eased (owner 2026-08-18: the circle must resize in
        // lockstep with the wheel/pinch; the clamp is continuous in alt, so direct application
        // is smooth by construction — the old 180 ms ease read as the overlay trailing the zoom).
        radius =
          Math.min(AIMCONES.radiusMaxM, Math.max(AIMCONES.radiusMinM, alt * AIMCONES.radiusAltK)) *
          (mobile ? AIMCONES.mobileRadiusK : 1); // batch #5 item 2 — /m radar reads 20% smaller

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
      // N rides just past the OUTERMOST band (batch #6: the target band compacted off the
      // unit rim — a fixed unit-1.09 seat would float detached from the ink).
      north.position.y = bandFor("target", mobile)[1] * AIMCONES.northOffsetK;
      northMat.opacity = AIMCONES.rimAlpha * overlayA;
      for (const b of bodies) {
        const on = aim[b.key];
        b.holder.visible = on;
        if (!on || !b.day) continue;
        const emphasized = aim.focus === b.key;
        // Bands sit at FIXED concentric radii (S2) — emphasis breathes the FILL only, eased
        // with the same time constant as the old scale swap (a focus tap still breathes).
        b.emphEased += ((emphasized ? 1 : 0) - b.emphEased) * (1 - Math.exp(-dtMs / AIMCONES.emphTauMs));

        const now01 = Math.min(
          1,
          Math.max(0, (sceneMs - b.day.startMs) / (b.day.endMs - b.day.startMs)),
        );
        b.fanMat.uniforms.uNow01.value = now01;
        b.rimMat.uniforms.uNow01.value = now01;
        // Fill NEVER rests at zero (owner batch #5 item 1: the strips read as empty) — every
        // band wears the fillAlphaRest wash; emphasis breathes it up to fillAlpha.
        b.fanMat.uniforms.uAlpha.value =
          (AIMCONES.fillAlphaRest + (AIMCONES.fillAlpha - AIMCONES.fillAlphaRest) * b.emphEased) *
          overlayA;
        b.rimMat.uniforms.uAlpha.value = AIMCONES.rimAlpha * overlayA;
        b.edgesMat.uniforms.uAlpha.value = AIMCONES.rimAlpha * overlayA;

        // Direction line: current azimuth + below-horizon paling (3 ephemeris calls/frame —
        // the sky marker's own budget). The TARGET line is the tracking RAY (owner batch #4
        // item 6, 2026-08-21): it reads far past the rim so distant landmarks can be lined up
        // against it. Sun/moon dials cap EXACTLY at their own band's outer radius (owner S2 —
        // the ×1.18 focused overshoot is retired with the radius scaling).
        const nowPos = targetAzAlt(targetFor(b.key, target), sceneMs, anchorLat, anchorLon);
        b.line.rotation.z = -nowPos.azDeg * DEG;
        b.line.scale.y = b.key === "target" ? AIMCONES.rayLenK : bandFor(b.key, mobile)[1];
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
      north.geometry.dispose();
      northMat.dispose();
      nTexture.dispose();
      opts.scene.remove(group);
    },
  };
}
