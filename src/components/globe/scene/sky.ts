import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import {
  eclipseDaylightK,
  type LunarEclipseState,
  type SolarEclipseState,
} from "../../../lib/ephemeris/eclipse";
import { ATMOSPHERE, ECLIPSE, SKY, WGS84_A, WGS84_B } from "../tuning";
import { bandCurve } from "../../../lib/globe/lightBands";
import { solarChroma } from "../../../lib/globe/duskLight";
import { DITHER_GLSL, glf, impostorEdgeWindowGlsl } from "./glsl";

/**
 * Sky bodies — the sun and the moon at their ASTRONOMICALLY CORRECT positions (lib/ephemeris,
 * ADR D6), rendered as camera-anchored impostors so they survive GlobeControls' dynamic far plane:
 * each frame both bodies sit along their true direction at `camera.far × SKY.impostorFarFrac`,
 * scaled to their TRUE apparent angular size (sun ≈ 0.53°, moon ≈ 0.5° discs). Depth testing stays
 * ON, so the earth/terrain/buildings occlude them correctly at the horizon.
 *
 *  • Sun — additive HDR disc + tight shader halo; the wide soft glow comes from the bloom pass
 *    (the core is pushed over BLOOM.threshold via SKY.sunIntensity).
 *  • Moon — NASA LROC colour map on a sphere lit IN-SHADER by the real sun direction, so the
 *    phase (terminator on the lunar disc) is astronomically correct for free. A faint earthshine
 *    floor keeps the dark limb readable. Texture centre (lon 0 = near side) is aimed at Earth.
 *  • Moonlight — a cool DirectionalLight whose intensity follows the K&S-1991 phase curve
 *    (lib/ephemeris/moonlight: quarter ≈ 9% of full), so full-moon nights light the buildings
 *    and everything dimmer than gibbous reads honestly faint.
 *
 * Tunables: SKY. Colours: tokens.sunCore / sunGlow / moonlight (D14).
 */
export interface SkyHandle {
  sunMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  moonLight: THREE.DirectionalLight;
  /** Per-frame: re-anchor both impostors (camera + far plane move every frame). */
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Geodetic camera altitude (m) — the orchestrator's shared sample (tunables contract:
     *  modules never re-derive it). Drives the horizon fade band width. */
    alt: number;
    /** Unit direction TO the sun (world/ECEF). */
    sunDir: THREE.Vector3;
    /** Moon centre in world/ECEF metres (true position — direction is derived per-camera). */
    moonPos: THREE.Vector3;
    /** True apparent angular radii (rad) from the ephemeris distances. */
    sunAngRad: number;
    moonAngRad: number;
    /** ULTRA (owner taste pass, 2026-08-27c): drive the disc from `SKY.discLevelCurve` + the
     *  opacity ramp instead of the shipped additive-only extinction. `false` (the default) is the
     *  disc exactly as it shipped — `uSolid` 0 makes the premultiplied blend degenerate to the
     *  addition it replaced, and `uCoreTint` stays white. */
    ultraDisc?: boolean;
    /** K&S-1991 phase-scaled lunar intensity 0..1 (`lib/ephemeris/moonlight`, 1 = full moon) —
     *  drives the moonlight key. The orchestrator passes 0 while the shadow rig impersonates
     *  the moon (S5 source switch), so the night key is never doubled. */
    moonIntensity: number;
    /** Solar-eclipse state for THIS camera, from the orchestrator's `stepEclipse` — derived from
     *  the very `sunDir` / `moonPos` / radii passed here, so the carved silhouette and the world
     *  darkness are guaranteed to be the same event. It arrives pre-computed only because the key
     *  light is stepped BEFORE the sky bodies and must not read a frame-old eclipse. */
    solar: SolarEclipseState;
    /** Earth-shadow state from the orchestrator's ONE ephemeris sample (`lunarEclipseFromState`).
     *  Geocentric by nature — the Earth's shadow belongs to the Earth, not to the observer — so
     *  unlike the SOLAR case there is nothing camera-relative to re-derive here. */
    lunar: LunarEclipseState;
  }): void;
  /** Hover affordance (qol3): per-frame ABSOLUTE brightness lift — uIntensity/uBrightness are
   *  write-once uniforms, so the setter re-derives them from the SKY constants (idempotent;
   *  never compounds). k = eased 0..1 hover × ORCH.skyHoverGain, per body. Round 3 (owner
   *  2026-08-14 "a bit more distinct — maybe a very faint small frame"): the lift also breathes
   *  in a hairline broken ring just outside the hovered disc (the reticle grammar at hover
   *  scale) — call AFTER update() (it reads the freshly-anchored body positions + camera). */
  setHoverGlow(sunK: number, moonK: number): void;
  dispose(): void;
}

// Horizon occlusion — the impostors sit at a FAKE camera-anchored distance, so the depth buffer
// CANNOT occlude them against the planet (the limb is usually farther than the impostor; that was
// the "moon clipping through the earth" bug). Each fragment compares its view ray's elevation
// sine against the TRUE ellipsoid horizon (with dip) and fades across an ANGULAR band — so a
// setting body slices gradually behind the real horizon line at street level AND melts into the
// limb haze from orbit (owner 2026-07-15; the old closest-approach metric band collapsed to a
// razor cut at 0° elevation in FPV — see SKY.horizonFadeStreetDeg provenance).
//
// Space is ELLIPSOID-SCALED (x,y ÷ a, z ÷ b → the ellipsoid becomes the unit sphere): tangency
// is preserved exactly by the linear map, so the horizon is exact; angle distortion ≤ the
// flattening (~0.3%), invisible. The horizon terms (uHorizonUp = scaled-space up, uSinHor =
// horizon elevation sine incl. dip, uHorizonBandSin = band width) are computed per frame on the
// CPU in float64 — float32 shader math near r ≈ 1 would make the dip noisy at low eye heights.
export const HORIZON_FADE_GLSL = /* glsl */ `
      uniform vec3 uHorizonUp;
      uniform float uSinHor;
      uniform float uHorizonBandSin;
      float horizonFade(vec3 worldPos) {
        vec3 dW = worldPos - cameraPosition;
        vec3 Ds = normalize(vec3(dW.xy, dW.z * ${glf(WGS84_A / WGS84_B)}));
        return smoothstep(uSinHor, uSinHor + uHorizonBandSin, dot(Ds, uHorizonUp));
      }`;

/** Per-frame CPU horizon terms (float64) shared by every sky consumer of HORIZON_FADE_GLSL —
 *  scene/stars reuses it for the star/Milky-Way fade. Returns the scaled-space up + horizon sine. */
export function horizonTerms(
  camPos: { x: number; y: number; z: number },
  outUp: THREE.Vector3,
): number {
  const ox = camPos.x / WGS84_A;
  const oy = camPos.y / WGS84_A;
  const oz = camPos.z / WGS84_B;
  const r = Math.sqrt(ox * ox + oy * oy + oz * oz);
  outUp.set(ox / r, oy / r, oz / r);
  // Camera at/under the surface (transient during flights) → horizon at the horizontal.
  const rSafe = Math.max(r, 1);
  return -Math.sqrt(Math.max(rSafe * rSafe - 1, 0)) / rSafe;
}

/** Angular band width (sine units) for the current altitude: street slice ↔ orbit melt. */
export function horizonBandSin(altM: number): number {
  const t = THREE.MathUtils.smoothstep(altM, SKY.horizonFadeAltLoM, SKY.horizonFadeAltHiM);
  const deg = SKY.horizonFadeStreetDeg + (SKY.horizonFadeOrbitDeg - SKY.horizonFadeStreetDeg) * t;
  return Math.sin(THREE.MathUtils.degToRad(deg));
}

/**
 * CPU twin of the moon fragment's premultiplied two-arm mix (scalar albedo) — testable maths
 * for the qol3 day-moon fix (the horizonTerms/skyBudget twin precedent). Premultiplied output:
 * the blend is `src.rgb + dst.rgb·(1−src.a)`, so
 *  • day arm (uDaySky→1): alpha 0 + rgb = albedo·lit·brightness·dayGain — the disc can only ADD
 *    light over the sky. The old NormalBlending day arm lerped a DARK albedo colour over a
 *    BRIGHT sky at alpha = lit·gain, which DARKENED every mid-lit pixel (the owner's abrupt
 *    dark-crescent screenshots, 2026-08-14): a physically-backwards regime — the real daytime
 *    moon is sky + reflected sunlight, never a shadow on the sky.
 *  • night arm (uDaySky→0): alpha = fade + rgb = albedo·(earthshine + lit·brightness)·fade —
 *    byte-identical to the previous opaque star-occluding disc.
 */
export function moonDiscArms(
  lit: number,
  albedo: number,
  daySky: number,
  fade: number,
): { rgb: number; alpha: number } {
  const nightRgb = albedo * (SKY.moonEarthshine + lit * SKY.moonBrightness);
  const dayRgb = albedo * lit * SKY.moonBrightness * SKY.moonDayAddGain;
  const aNight = fade * (1 - daySky);
  return { rgb: nightRgb * aNight + dayRgb * daySky * fade, alpha: aNight };
}

/**
 * CPU twin of the SUN disc's two arms (owner taste pass, 2026-08-27c) — the sibling of
 * `moonDiscArms`, and it exists for the same reason: the blend is premultiplied, so "how bright"
 * and "how opaque" are two different numbers and getting them out of step is invisible in review.
 *
 * THE AXIS IS NOT THE MOON'S. The moon switches DAY (additive) ↔ NIGHT (opaque) on one scalar.
 * The sun does not need a day/night switch — it needs a BRIGHT-AND-ADDITIVE ↔ DIM-AND-SOLID one,
 * because the defect was that an additive impostor has no dim-but-solid state at all: its result
 * is literally `disc + sky`, so dimming it and dissolving it into the sky are the same operation.
 *
 *  · `cover` is the GEOMETRIC coverage — the disc mask × the carved lunar silhouette × the horizon
 *    fade. Every geometric mask lives in it exactly once, so rgb and alpha cannot disagree. This
 *    is what stops the fix punching a black hole: under premultiplied "over" a fragment with
 *    rgb = 0 and a = 1 is BLACK, not invisible, so a mask applied to colour alone (as all four
 *    were, correctly, under addition) would show as a dark bite at the eclipse silhouette and at
 *    the setting limb.
 *  · `level` is the authored radiance (`SKY.discLevelCurve` × `sunIntensity`, hover-liftable).
 *  · `solid` is 0 at high sun — so alpha is 0, `DST' = rgb + DST·1`, and the premultiplied path
 *    degenerates EXACTLY to the addition that shipped.
 *  · the halo contributes to rgb ONLY. It has no compact support (`exp()` to 7 disc radii), so an
 *    alpha derived from total brightness would make ~14 solar diameters of sky partly opaque.
 */
export function sunDiscArms(
  cover: number,
  level: number,
  solid: number,
  halo: number,
): { rgb: number; alpha: number } {
  const alpha = cover * solid;
  return { rgb: level * cover + halo, alpha };
}

/**
 * CPU twin of the sun's horizon-extinction factor (owner 2026-08-14: a setting sun should dim
 * "like the real atmosphere does"). `sunAltDeg` = sun altitude at the camera (deg); `skyK` =
 * the atmosphere-presence altitude fade (1 at street level, 0 in space — the moon dayK's
 * ATMOSPHERE.skyFullAlt/GoneAlt ramp): from orbit there is no air, so the factor relaxes to 1.
 * Smoothstep taste curve, NOT the airmass exponential — the real horizon sun is ~10⁻³ of its
 * zenith luminance, which would erase the disc and its bloom entirely (C2: beauty AND accuracy).
 */
export function sunExtinctionK(sunAltDeg: number, skyK: number): number {
  const t = THREE.MathUtils.smoothstep(sunAltDeg, 0, SKY.sunExtinctAltHiDeg);
  const air = SKY.sunExtinctFloor + (1 - SKY.sunExtinctFloor) * t;
  return 1 - skyK * (1 - air);
}

const IMPOSTOR_VERTEX_GLSL = /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`;

export function attachSky(scene: THREE.Scene): SkyHandle {
  // Horizon-fade terms — ONE set of uniform holders shared by both impostor materials (same
  // {value} object references: one CPU write per frame updates both shaders).
  const uHorizonUp = { value: new THREE.Vector3(0, 0, 1) };
  const uSinHor = { value: 0 };
  const uHorizonBandSin = { value: horizonBandSin(0) };

  // --- Sun: billboarded plane, additive; UV distance drives core disc + exp halo. -------------
  const sunUniforms = {
    uCore: { value: new THREE.Color(tokens.sunCore) },
    uGlow: { value: new THREE.Color(tokens.sunGlow) },
    // The disc's authored radiance: SKY.sunIntensity × the extinction level, hover-liftable.
    // (Was `uIntensity` × `uExtinct`; collapsed into one so `setHoverGlow` cannot fight the level
    // and so the bloom drive is a single readable number — see SKY.discLevelCurve.)
    uCoreLevel: { value: SKY.sunIntensity as number },
    // Reported by the DEV probe and by verify; kept as its own uniform so a harness can read the
    // LEVEL without inferring it back out of uCoreLevel.
    uExtinct: { value: 1 },
    /** Extinction chromaticity on the core — white at high sun (exactly), orange at dusk. */
    uCoreTint: { value: new THREE.Color(1, 1, 1) },
    /** 0 = the shipped pure-additive disc. 1 = a solid disc that REPLACES the sky it covers. */
    uSolid: { value: 0 },
    /** Halo scale — falls as level^SKY.haloExtinctPow, so the glow leaves before the core dims. */
    uHaloK: { value: 1 },
    // --- ECLIPSE (2026-08-22k). The moon has to be subtracted from the sun HERE, in the sun's own
    // fragment: the moon impostor cannot do it. During a solar eclipse the moon's near side is a
    // new moon (illuminated fraction ~8e-5), so its disc contributes no colour, and by day its
    // alpha is 0 by construction — it discards entirely. No render-order, depth or blend change on
    // the moon could occlude anything that is never drawn.
    //
    // Everything below is in SUN-DISC-RADIUS units, in the billboard's own plane. That is exact and
    // free: the plane is billboarded to the camera, so its local axes ARE camera right/up, and the
    // CPU can hand over the moon's offset as a plain vec2 (see update()). Working in the plane
    // rather than with world rays also keeps the precision where it is needed — these are
    // sub-arcminute separations, where `acos(dot)` of two near-parallel world directions is mush.
    uMoonOff: { value: new THREE.Vector2(1e4, 1e4) }, // moon centre, offset from the sun's
    uMoonR: { value: 1 }, // moon angular radius / sun angular radius
    uEclipse: { value: 0 }, // covered fraction of the sun's disc AREA, 0..1
    // The corona is Thomson-scattered PHOTOSPHERIC light, so it is near-white — much cooler than
    // the warm scattered-by-air halo that shares the token. Mixed once, at construction.
    uCorona: {
      value: new THREE.Color(tokens.sunGlow).lerp(new THREE.Color(0xffffff), ECLIPSE.coronaWhiteMix),
    },
    uChromo: { value: new THREE.Color(tokens.eclipseChromo) },
    uHorizonUp,
    uSinHor,
    uHorizonBandSin,
  };
  const sunMat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    transparent: true,
    depthWrite: false,
    // PREMULTIPLIED custom blend — the moon's triple (sky.ts, `moonMat`), verbatim and for the
    // same reason, but on a different axis (see `sunDiscArms`). `DST' = rgb + DST·(1 − a)`, so at
    // `uSolid = 0` (every frame with the chip off, and every frame above SKY.discSolidHiDeg) this
    // is ONE/ONE — byte-identical to the AdditiveBlending it replaces. Going solid is therefore a
    // strict superset of the shipped behaviour, provable at the blend equation rather than by
    // review.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: IMPOSTOR_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uGlow;
      uniform vec3 uCorona;
      uniform vec3 uChromo;
      uniform float uCoreLevel;
      uniform vec3 uCoreTint;
      uniform float uSolid;
      uniform float uHaloK;
      uniform vec2 uMoonOff;
      uniform float uMoonR;
      uniform float uEclipse;
      varying vec2 vUv;
      varying vec3 vW;
      ${HORIZON_FADE_GLSL}
      void main() {
        // p in disc-radius units: the plane spans sunGlowExtent disc radii, and because it is
        // billboarded its axes are camera right/up — the same frame uMoonOff arrives in.
        vec2 p = (vUv - 0.5) * 2.0 * ${glf(SKY.sunGlowExtent)};
        float r = length(p);
        // Quad-edge window (owner bug B2, 2026-08-25 — the square at totality). Closes to EXACTLY
        // zero at 0.98 × sunGlowExtent, inside the plane's inscribed radius; the corners (r up to
        // ~9.9) discard outright. Applied to the final colour at the bottom, AFTER the dither.
        float win = ${impostorEdgeWindowGlsl(SKY.sunQuadFade[0] * SKY.sunGlowExtent, SKY.sunQuadFade[1] * SKY.sunGlowExtent)};
        if (win <= 0.0) discard;
        // limb-darkened core disc (real suns are ~30% dimmer at the limb)
        float disc = 1.0 - smoothstep(0.9, 1.0, r);
        float limb = mix(1.0, 0.7, smoothstep(0.0, 1.0, r));
        // tight shader halo — the WIDE glow is the bloom pass's job. uHaloK leaves EARLIER than
        // the core dims (level^haloExtinctPow): "keep some brightness and very little glow".
        float halo = exp(-(max(r - 1.0, 0.0)) * 1.6) * ${glf(SKY.sunGlowGain)} * uHaloK;

        // --- the moon, subtracted. q is measured from the MOON's centre, in MOON radii. ---
        vec2 q = p - uMoonOff;
        float rm = length(q) / max(uMoonR, 1e-6);
        // The lunar limb is knife-sharp (no atmosphere) — this width is pure anti-aliasing.
        float occ = 1.0 - smoothstep(
          1.0 - ${glf(ECLIPSE.limbSoftFrac)}, 1.0 + ${glf(ECLIPSE.limbSoftFrac)}, rm);
        // The glare AROUND the sun is scattered photospheric light, so it fades with the
        // photosphere — but not to nothing: the rest of the sky stays lit.
        float haloK = mix(1.0, ${glf(ECLIPSE.haloAtTotality)}, uEclipse);
        // ONE geometric coverage scalar (taste pass 2026-08-27c). Under ADDITION every mask could
        // safely be applied to colour alone, because colour 0 already means invisible. Under
        // premultiplied "over" that is false — rgb 0 with a 1 is BLACK — so the disc mask, the
        // carved lunar silhouette and the horizon fade all live here exactly once and drive BOTH
        // arms. (win, the quad-edge window, is applied to both at the very bottom, after the
        // dither, so the B2 ordering note still holds.)
        float fade = horizonFade(vW);
        float cover = disc * (1.0 - occ) * fade;
        // OPAQUE ARM: the photosphere, premultiplied by its own coverage. limb (real suns are
        // ~30 % dimmer at the limb) stays on the COLOUR only — it is a radiance term, not a
        // coverage one, and folding it into alpha would make the disc's rim see-through.
        vec3 color = uCore * uCoreTint * uCoreLevel * cover * limb;
        // ADDITIVE ARM: the glow. rgb only — the halo has no compact support (it is still ~3e-3
        // at 5 disc radii, which is why the edge window exists), so an alpha built from total
        // brightness would make ~14 solar diameters of sky partly opaque.
        color += uGlow * halo * haloK * (1.0 - occ) * fade;
        float alpha = cover * uSolid;

        // --- corona + chromosphere, strictly inside totality. The corona is ~1e-6 of the disc,
        // so a single surviving sliver of photosphere would drown it; this ramp also keeps it out
        // of every ANNULAR eclipse, where the ring never leaves. ---
        float tot = smoothstep(
          ${glf(ECLIPSE.coronaOnCoverage[0])}, ${glf(ECLIPSE.coronaOnCoverage[1])}, uEclipse);
        if (tot > 0.0) {
          float x = max(rm, 1.0);
          float d = x - 1.0;
          // Two terms: a tight exponential at the limb and a long power-law for the streamers.
          float cor = exp(-d / ${glf(ECLIPSE.coronaInnerFalloff)})
                    + ${glf(ECLIPSE.coronaOuterGain)} * pow(x, -${glf(ECLIPSE.coronaOuterPow)});
          // Low-order angular structure so it is not a perfect annulus. Kept subtle on purpose —
          // a strongly modulated ring reads as a graphic rather than as plasma.
          float th = atan(q.y, q.x);
          float petal = 1.0 + ${glf(ECLIPSE.coronaPetalAmp)}
                      * (0.6 * sin(2.0 * th + 0.7) + 0.4 * sin(3.0 * th - 1.3));
          color += uCorona * cor * petal * tot * ${glf(ECLIPSE.coronaGain)} * (1.0 - occ) * fade;
          // The chromosphere: a hairline of hydrogen-alpha pink hugging the lunar limb.
          float chromo = smoothstep(${glf(ECLIPSE.chromoWidth)}, 0.0, abs(rm - 1.0));
          color += uChromo * chromo * tot * ${glf(ECLIPSE.chromoGain)} * fade;
        }
        ${DITHER_GLSL}
        // AFTER the dither, on purpose: the ±1/256 noise has to fade out with the signal. Gating
        // the dither instead would just move the straight edge onto the gate. Alpha rides the
        // window too, or the quad's rim would replace sky the colour has already stopped painting.
        color *= win;
        alpha *= win;
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat);
  sunMesh.frustumCulled = false; // re-anchored every frame — stale bounds must never cull it
  sunMesh.raycast = () => {};
  // The REAL body draws ABOVE the depth-free planning overlays (ghosts/trail/arcs/find rings,
  // all renderOrder 10) — owner 2026-08-15: ghosts sit BEHIND the disc, never wash it. Safe vs
  // the atmosphere dome: the day contribution is additive, and addition commutes.
  sunMesh.renderOrder = 11;
  scene.add(sunMesh);

  // --- Moon: sphere + LROC colour map, phase-lit by the real sun direction in-shader (scene
  //     lights would let the hemisphere fill wash out the dark limb). ---------------------------
  const moonTex = new THREE.TextureLoader().load(SKY.moonTexture);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moonUniforms = {
    uMap: { value: moonTex },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uBrightness: { value: SKY.moonBrightness as number }, // widened: setHoverGlow re-derives it
    uEarthshine: { value: SKY.moonEarthshine },
    // 0 night/space → 1 full daylight sky behind the disc (CPU per frame — see update()).
    // Under a solar eclipse this is ALSO scaled by the daylight loss, which is what turns the disc
    // opaque and dark exactly as fast as the sky behind it goes dark: one number, both effects,
    // and no new alpha arm to keep in sync with the tested CPU twin.
    uDaySky: { value: 0 },
    // --- LUNAR ECLIPSE (2026-08-22k): the Earth's shadow, drawn ON the disc. ---
    // The umbra is ~2.7 lunar radii across, so a partial umbral phase shows a CURVED bite, not a
    // straight terminator — the shape everyone recognises. Offsets/radii are in MOON RADII, in the
    // disc's own (y, z) basis (see the vDisc varying), so the fragment does one length() to know
    // exactly how deep into the shadow it sits.
    uUmbraOff: { value: new THREE.Vector2(1e4, 1e4) },
    uUmbraR: { value: 1 },
    uPenumbraR: { value: 1 },
    uUmbraOn: { value: 0 }, // 0 skips the whole branch on every ordinary night
    uUmbraTint: { value: new THREE.Color(tokens.eclipseUmbra) },
    uHorizonUp,
    uSinHor,
    uHorizonBandSin,
  };
  const moonMat = new THREE.ShaderMaterial({
    uniforms: moonUniforms,
    // Transparent so the horizon fade can dissolve the disc; depthTest ON (terrain/buildings
    // occlude a setting moon); depthWrite OFF (round 3, owner 2026-08-14) — the disc must never
    // place a depth wall in the sky: the additive dome draws after it, and ANY depth the disc
    // writes can depth-reject the dome on the disc's footprint during rapid FPV look-drags
    // (browser A/B over ~470 drag frames each: depthWrite on → dark frames at 0.13× sky
    // luminance; off → zero). Star occlusion needs no depth — the night arm's alpha (≈1 at
    // night) REPLACES the stars drawn before the disc, and by day the stars are gone. Known
    // cosmetic edge: a total solar eclipse would let the additive sun (drawn after) wash
    // through the disc — no depth wall is worth that trade.
    //
    // PREMULTIPLIED custom blend (qol3, owner 2026-08-14 round 2): ONE / ONE_MINUS_SRC_ALPHA lets
    // ONE material be additive by day (alpha 0 — the disc can only ADD light, so no camera pose
    // can render a crescent DARKER than the sky) and opaque by night (alpha = fade — occludes
    // stars). See moonDiscArms above (the tested CPU twin). Do NOT revert to NormalBlending: the
    // day arm's darker-than-sky lerp was the abrupt dark-crescent bug.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNw;
      varying vec3 vW;
      varying vec2 vDisc;
      void main() {
        vUv = uv;
        vNw = normalize(mat3(modelMatrix) * normal); // uniform scale — no normal-matrix needed
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        // The mesh's basis is built every frame as (toward-camera, north, north x toward-camera),
        // so object-space y/z ARE this fragment's offset across the visible disc, in units of the
        // moon's own angular radius. That is the frame the Earth-shadow uniforms arrive in.
        vDisc = position.yz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uBrightness;
      uniform float uEarthshine;
      uniform float uDaySky;
      uniform vec2 uUmbraOff;
      uniform float uUmbraR;
      uniform float uPenumbraR;
      uniform float uUmbraOn;
      uniform vec3 uUmbraTint;
      varying vec2 vUv;
      varying vec3 vNw;
      varying vec3 vW;
      varying vec2 vDisc;
      ${HORIZON_FADE_GLSL}
      void main() {
        float fade = horizonFade(vW);
        float lit = max(dot(normalize(vNw), normalize(uSunDir)), 0.0);
        // soften the terminator a touch (regolith scattering reads better than a hard lambert)
        lit = pow(lit, 0.8);
        vec3 albedo = texture2D(uMap, vUv).rgb;

        // --- Earth's shadow. Branch skipped entirely on every ordinary night. ---
        if (uUmbraOn > 0.0) {
          float dS = length(vDisc - uUmbraOff);
          float soft = ${glf(ECLIPSE.shadowSoftFrac)};
          float inUmb = 1.0 - smoothstep(uUmbraR - soft, uUmbraR + soft, dS);
          float inPen = 1.0 - smoothstep(uPenumbraR - soft, uPenumbraR + soft, dS);
          // Penumbra: a gentle gradient deepening toward the umbra. Real, and famously easy to
          // miss — astronomy-engine reports obscuration 0 for a purely penumbral eclipse, which is
          // exactly why the tint cannot be driven from that one scalar.
          float penK = clamp((uPenumbraR - dS) / max(uPenumbraR - uUmbraR, 1e-4), 0.0, 1.0);
          float pen = 1.0 - ${glf(ECLIPSE.penumbraDim)} * penK * inPen;
          // Umbra: deep, copper, and BRIGHTER toward its own edge — the outer umbra is lit by a
          // wider arc of refracting atmosphere, so the moon's limb nearest the shadow edge glows
          // markedly warmer. That gradient is what makes this read as an eclipse and not a filter.
          float edge = clamp(dS / max(uUmbraR, 1e-4), 0.0, 1.0);
          float umbK = ${glf(ECLIPSE.umbraLight)} * (1.0 + ${glf(ECLIPSE.umbraEdgeLift)} * edge * edge);
          albedo *= mix(pen, umbK, inUmb) * mix(vec3(1.0), uUmbraTint, inUmb);
        }
        // Two premultiplied arms mixed by uDaySky (CPU twin: moonDiscArms — keep in lockstep).
        // NIGHT: the classic opaque star-occluding disc. DAY: additive-only reflected sunlight —
        // the dark side IS the sky, and no mid-lit pixel can ever be darker than the sky behind
        // it (the abrupt dark-crescent bug, owner 2026-08-14 round 2).
        vec3 nightRgb = albedo * (uEarthshine + lit * uBrightness);
        vec3 dayRgb = albedo * lit * uBrightness * ${glf(SKY.moonDayAddGain)};
        float aNight = fade * (1.0 - uDaySky);
        vec3 color = nightRgb * aNight + dayRgb * (uDaySky * fade);
        float alpha = aNight;
        // Invisible either way → discard (cheap ROP skip; depthWrite is already OFF — round 3 —
        // so this is no longer load-bearing for the dome, just hygiene).
        if (max(max(color.r, color.g), color.b) < ${glf(SKY.moonAlphaDiscard)} &&
            alpha < ${glf(SKY.moonAlphaDiscard)}) discard;
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, alpha);
        // NO tonemapping_fragment here: OutputPass tone-maps the whole buffer once — a second
        // in-shader pass crushed the earthshine limb to (7,6,2) black (the measured dark disc).
        // Every other sky shader already includes colorspace_fragment only.
        #include <colorspace_fragment>
      }`,
  });
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), moonMat);
  moonMesh.frustumCulled = false;
  moonMesh.raycast = () => {};
  // Above the overlay tier (10) — the sunMesh note applies verbatim. Night arm: the opaque
  // disc now also replaces any ghost drawn behind it, which is exactly "ghosts BEHIND".
  // 12, not 11 (2026-08-22k): at an equal renderOrder three falls through to a depth sort, and
  // during an eclipse both impostors sit at the SAME anchor distance — their clip-space z differs
  // by ~1e-6 and the winner flips with camera aim. The occlusion no longer depends on this (the
  // sun carves itself), but the moon's opaque night arm must still land ON TOP of the sun's
  // residual halo deterministically, not on whichever way the sort tipped that frame.
  moonMesh.renderOrder = 12;
  scene.add(moonMesh);

  // --- Hover ring (qol3 round 3): a hairline broken ring that breathes in around the hovered
  //     sun/moon — the skyTarget reticle grammar (quad-gap arcs) at hover scale, additive so the
  //     sky stays visible through it. ONE billboard, repositioned by setHoverGlow each frame. ---
  const hoverUniforms = {
    uColor: { value: new THREE.Color(tokens.accent) },
    uFade: { value: 0 },
  };
  const hoverRingMat = new THREE.ShaderMaterial({
    uniforms: hoverUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: IMPOSTOR_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        // Broken hairline ring at r = 0.8 (the reticle's quad-gap mask — ticks-free, fainter).
        float quad = abs(fract(atan(p.y, p.x) * ${glf(2.0 / Math.PI)} + 0.5) - 0.5) * 2.0;
        float arc = smoothstep(${glf(SKY.hoverRingGapFrac)}, ${glf(SKY.hoverRingGapFrac + 0.12)}, quad);
        float ring = smoothstep(${glf(SKY.hoverRingWidthN)}, 0.0, abs(r - 0.8)) * arc;
        gl_FragColor = vec4(uColor * ring * uFade * ${glf(SKY.hoverRingGain)}, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const hoverRing = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), hoverRingMat);
  hoverRing.frustumCulled = false;
  hoverRing.raycast = () => {};
  hoverRing.visible = false;
  scene.add(hoverRing);
  let lastCamera: THREE.PerspectiveCamera | null = null;

  // --- Moonlight: cool fill that tracks the real moon direction + phase. -----------------------
  const moonLight = new THREE.DirectionalLight(
    new THREE.Color(tokens.moonlight),
    0, // set per-sample from the illuminated fraction
  );
  scene.add(moonLight);
  scene.add(moonLight.target);

  /** The per-frame disc level and hover lift, banked so `setHoverGlow` (called AFTER update) can
   *  re-derive `uCoreLevel` absolutely instead of compounding into it. */
  let discLevelNow = 1;
  let hoverSunK = 0;
  const _discTint = new THREE.Color();
  const _dir = new THREE.Vector3();
  const _pole = new THREE.Vector3(0, 0, 1); // ECEF +Z ≈ lunar north for a 0.5° disc
  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  // Eclipse scratch (no per-frame allocation): camera right/up for the sun-plane projection, the
  // sun→moon angular delta, and the moon→umbra delta.
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _delta = new THREE.Vector3();
  const _axis = new THREE.Vector3();

  return {
    sunMesh,
    moonMesh,
    moonLight,
    update({ camera, alt, sunDir, moonPos, sunAngRad, moonAngRad, moonIntensity, solar, lunar,
             ultraDisc = false }) {
      lastCamera = camera; // banked for setHoverGlow's ring billboard (called right after)
      // Horizon fade terms (float64 on the CPU — see HORIZON_FADE_GLSL): shared uniform holders,
      // one write covers the sun AND moon materials.
      uSinHor.value = horizonTerms(camera.position, uHorizonUp.value);
      uHorizonBandSin.value = horizonBandSin(alt);

      // GlobeControls refits near/far per frame — looking AWAY from the earth pushes near out to
      // thousands of km (it fits the terrain BEHIND the camera), so the impostor distance must be
      // clamped into the live [near, far] band or the bodies near-plane-clip out of the sky.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );

      // Shared sun-elevation / atmosphere-presence terms (uHorizonUp just refreshed above;
      // scaled-space up ≈ geodetic up to ~0.3%): the sun's horizon extinction AND the moon's
      // day-sky arm both read them — one derivation, two consumers.
      const sinSun = sunDir.dot(uHorizonUp.value);
      const skyK = 1 - THREE.MathUtils.smoothstep(alt, ATMOSPHERE.skyFullAlt, ATMOSPHERE.skyGoneAlt);

      // Sun: parallax-free — anchor along the direction from the camera.
      sunMesh.position.copy(camera.position).addScaledVector(sunDir, d);
      // plane half-extent covers the halo: disc radius × glow extent
      sunMesh.scale.setScalar(d * Math.tan(sunAngRad) * SKY.sunGlowExtent);
      sunMesh.quaternion.copy(camera.quaternion); // billboard
      // Horizon extinction (owner 2026-08-14): a setting sun dims like the real atmosphere.
      const sunAltDeg = Math.asin(THREE.MathUtils.clamp(sinSun, -1, 1)) * (180 / Math.PI);
      // THE DISC'S LEVEL (owner taste pass, 2026-08-27c).
      //
      // Baseline keeps `sunExtinctionK` untouched — it is a BASE feature (2026-08-14) applied on
      // every path, and moving it would change a frame nobody complained about. ULTRA swaps in an
      // authored curve, shaped the way the owner asked: start earlier (15° rather than 10°), fall
      // proportionally, and hold FLAT from 1° down so there is a stable "solid orange disk"
      // instead of a fade to nothing. `1 − skyK·(1 − level)` is `sunExtinctionK`'s own altitude
      // relaxation, reused verbatim — from orbit there is no air in the way, so the disc must go
      // back to full whichever curve is driving it.
      const discLevel = ultraDisc
        ? 1 - skyK * (1 - bandCurve(SKY.discLevelCurve, sinSun))
        : sunExtinctionK(sunAltDeg, skyK);
      sunUniforms.uExtinct.value = discLevel;
      discLevelNow = discLevel;
      sunUniforms.uCoreLevel.value = SKY.sunIntensity * discLevel * (1 + hoverSunK);
      // SOLIDITY. Exactly 0 at and above `discSolidHiDeg` — and therefore on every baseline frame
      // and every daytime ULTRA frame — which is what makes the premultiplied path a provable
      // superset of the additive one rather than a look change at noon.
      const solid = ultraDisc
        ? 1 - THREE.MathUtils.smoothstep(sunAltDeg, SKY.discSolidLoDeg, SKY.discSolidHiDeg)
        : 0;
      sunUniforms.uSolid.value = solid;
      // The glow leaves before the core dims: level^haloExtinctPow, and exactly 1 at high sun.
      sunUniforms.uHaloK.value = ultraDisc
        ? Math.pow(THREE.MathUtils.clamp(discLevel, 0, 1), SKY.haloExtinctPow)
        : 1;
      // CHROMA. `solarChroma` at 0° is (1.000, 0.212, 0.005) — multiplied into `sunCore` that is a
      // nearly monochromatic red with a dead blue channel, i.e. crimson, not the orange he asked
      // for. So it is floored per channel and mixed at `discChromaK`, and the mix rides `solid` so
      // the tint is EXACTLY white wherever the disc is still the shipped additive one.
      if (ultraDisc && solid > 0) {
        const ch = solarChroma(sunAltDeg);
        const f = SKY.discChromaFloor;
        _discTint.setRGB(
          Math.max(ch[0], f[0]),
          Math.max(ch[1], f[1]),
          Math.max(ch[2], f[2]),
        );
        sunUniforms.uCoreTint.value.setRGB(1, 1, 1).lerp(_discTint, SKY.discChromaK * solid);
      } else {
        sunUniforms.uCoreTint.value.setRGB(1, 1, 1);
      }

      // Moon: true position is finite (≈384,000 km) — derive the per-camera direction, then
      // anchor inside the far plane at the true apparent size.
      _dir.copy(moonPos).sub(camera.position).normalize();
      moonMesh.position.copy(camera.position).addScaledVector(_dir, d);
      moonMesh.scale.setScalar(d * Math.tan(moonAngRad));
      // Aim the texture's near side (+X of the sphere UV seam layout) at Earth, north up.
      _x.copy(_dir).negate(); // sphere +X (map centre, lon 0 = near side) → toward Earth/camera side
      _y.copy(_pole).addScaledVector(_x, -_pole.dot(_x)).normalize(); // orthonormal "north"
      _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      moonMesh.quaternion.setFromRotationMatrix(_m);
      moonUniforms.uSunDir.value.copy(sunDir);

      // --- SOLAR ECLIPSE. `solar` was derived by the orchestrator from these very vectors, so all
      // that happens here is projecting the moon onto the sun's billboard plane. The plane is
      // billboarded to the camera, so its local axes ARE camera right/up — the offset is two dot
      // products, exact to the small-angle chord (~1e-5 relative at these separations).
      //
      // The geometry only works because `_dir` is TOPOCENTRIC by construction while `sunDir` is
      // geocentric (solar parallax 8.6", ignorable). Lunar parallax is ~1° — the same size as the
      // entire phenomenon — so a geocentric separation reports NO eclipse during totality. ---
      _right.setFromMatrixColumn(camera.matrixWorld, 0); // camera right = the plane's local +X
      _up.setFromMatrixColumn(camera.matrixWorld, 1); // camera up      = the plane's local +Y
      _delta.copy(_dir).sub(sunDir); // chord between two unit vectors ≈ the angular offset
      const invSun = 1 / Math.max(sunAngRad, 1e-9);
      sunUniforms.uMoonOff.value.set(_delta.dot(_right) * invSun, _delta.dot(_up) * invSun);
      sunUniforms.uMoonR.value = moonAngRad * invSun;
      sunUniforms.uEclipse.value = solar.coverage;

      // Day-sky visibility for the dark-limb alpha (dark-disc fix, owner 2026-08-14): the SAME
      // sun-elevation ramp the atmosphere's dayK uses × the sky-regime altitude fade — the
      // disc's alpha story always matches the sky the dome paints behind it (sinSun/skyK are
      // the shared derivation above the sun anchor).
      //
      // × the eclipse's daylight loss (2026-08-22k). This ONE multiply is what turns the moon into
      // the "proper dark disc" the owner asked for, and it does it honestly: the disc goes opaque
      // at exactly the rate the sky behind it goes dark, because both read the same number. No
      // second alpha arm, so the tested CPU twin (moonDiscArms) needs no new parameter.
      const dayK = THREE.MathUtils.smoothstep(sinSun, ATMOSPHERE.skyDawnLo, ATMOSPHERE.skyDawnHi);
      moonUniforms.uDaySky.value =
        dayK *
        skyK *
        eclipseDaylightK(solar.coverage, ECLIPSE.daylightGamma, ECLIPSE.daylightFloor);

      // --- LUNAR ECLIPSE. The umbra is a geocentric object, so its offset arrives already
      // computed; all that is left is projecting it into the disc's own (y, z) basis and handing
      // the fragment three numbers in MOON RADII. ---
      const umbraOn = lunar.phase !== "none";
      moonUniforms.uUmbraOn.value = umbraOn ? 1 : 0;
      if (umbraOn) {
        const invMoon = 1 / Math.max(lunar.moonRadRad, 1e-9);
        // Both ends of the offset are GEOCENTRIC: the shadow axis (antisolar) and the moon's true
        // direction from the Earth's centre — moonPos IS that vector, so normalising it is the
        // whole derivation. (_dir is the topocentric anchor and must not be touched here; the
        // moonlight key still reads it below.)
        _axis.copy(moonPos).normalize();
        _delta.set(lunar.axisDir[0], lunar.axisDir[1], lunar.axisDir[2]).sub(_axis);
        // _y/_z span the disc plane; the ≤1° tilt between the geocentric and topocentric moon
        // directions foreshortens this by <0.02%, far under the umbra's own soft edge.
        moonUniforms.uUmbraOff.value.set(_delta.dot(_y) * invMoon, _delta.dot(_z) * invMoon);
        moonUniforms.uUmbraR.value = lunar.umbraRadRad * invMoon;
        moonUniforms.uPenumbraR.value = lunar.penumbraRadRad * invMoon;
      }

      // Moonlight follows the moon; intensity follows the K&S phase curve (quarter ≈ 9% of
      // full — physical relative scaling, calibrated at full moon by moonKeyIntensity).
      moonLight.position.copy(_dir).multiplyScalar(1e7);
      moonLight.target.position.set(0, 0, 0);
      moonLight.intensity = SKY.moonKeyIntensity * moonIntensity;
    },
    setHoverGlow(sunK, moonK) {
      // The lift rides the LEVEL, never `uSolid` — an already-opaque disc cannot get more opaque,
      // and tying the affordance to alpha would make hovering do nothing at dusk. Still ABSOLUTE
      // (re-derived from the banked per-frame level), so repeated calls cannot compound.
      hoverSunK = sunK;
      sunUniforms.uCoreLevel.value = SKY.sunIntensity * discLevelNow * (1 + sunK);
      moonUniforms.uBrightness.value = SKY.moonBrightness * (1 + moonK);
      // The faint frame: follow whichever body is (more) hovered; k is already eased upstream,
      // so the ring breathes in/out with the glow. Ring radius = disc radius × hoverRingRadFrac
      // (the ring lives at normalized r = 0.8 of the plane, hence the /0.8 scale map).
      const k = Math.max(sunK, moonK);
      if (k < 0.01 || !lastCamera) {
        hoverRing.visible = false;
        return;
      }
      const onSun = sunK >= moonK;
      const body = onSun ? sunMesh : moonMesh;
      // Sun plane spans sunGlowExtent disc radii; the moon sphere's scale IS its disc radius.
      const discR = onSun ? sunMesh.scale.x / SKY.sunGlowExtent : moonMesh.scale.x;
      hoverRing.visible = true;
      hoverRing.position.copy(body.position);
      hoverRing.scale.setScalar((discR * SKY.hoverRingRadFrac) / 0.8);
      hoverRing.quaternion.copy(lastCamera.quaternion);
      hoverUniforms.uFade.value = k;
    },
    dispose() {
      moonTex.dispose();
      sunMesh.geometry.dispose();
      sunMat.dispose();
      moonMesh.geometry.dispose();
      moonMat.dispose();
      hoverRing.geometry.dispose();
      hoverRingMat.dispose();
      scene.remove(hoverRing);
      scene.remove(sunMesh);
      scene.remove(moonMesh);
      scene.remove(moonLight.target);
      scene.remove(moonLight);
    },
  };
}
