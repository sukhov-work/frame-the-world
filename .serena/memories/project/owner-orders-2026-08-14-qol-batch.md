# Owner orders 2026-08-14 (end of M2 session) — PhotoPills deep review + sun/moon/MW QoL batch

Standing orders for the NEXT session (recorded verbatim-faithful; no code landed this turn).
DECISIONS 2026-08-14 owner-orders line = twin. Supersedes the plain "8b next" ordering.

## 1. Research first — PhotoPills user-guide deep review
- Source: https://www.photopills.com/user-guide (feature-level pass; the 2026-08-11 research was
  competitor-level). Goal: **did we miss any amazing features** that translate nicely into the
  app WITHOUT overburdening/complicating it — "really nice intuitive ways to plan photo shots
  and seeing".
- Standing rule (owner, applies to EVERY feature): **beat PhotoPills, never blindly copy.**
- Fold research + existing plans (IMPLEMENTATION_PLAN §Phase 8 · MOBILE_PLAN §5/§6) into ONE
  re-prioritized plan.

## 2. PRIORITY RE-RULING
**Sun / Moon / Milky Way planning first.** All astro/DSO work comes ONLY after
(a) mobile support is fully solved and (b) the sun/moon/MW quality-of-life pass is done.
- P4 Find + P6 moon calendar = sun/moon/MW-aligned, stay early. P5 NPF serves MW exposure —
  placement decided by the research. DSO-leaning items (P10 sensor-frame on DSO targets,
  catalog depth) slide behind the QoL pass.

## 3. Feature batch (design UI/UX with the research)
1. **FPV "shoot-this-frame" suggestions** — for the CURRENT frame, show best suggestions when
   and what to shoot (sun/moon/MW). Plus search: **when will a given sky body be nearest a
   specified point/area** (see what makes best sense UX-wise; ties into P4 Find inversion).
2. **Time-scrubber v2** —
   - ALL band colours: golden hour, blue hour, twilights, day, night. (P1 bands day/civil/
     nautical/astro/night EXIST on dock+rail but owner reads them as night-only → contrast/
     palette fix is part of this. Owner referenced a screenshot that did not come through.)
   - PhotoPills-style charts on/around the rail — research their approach, then beat it;
     scrubber must stay convenient, intuitive, planning-readable.
   - **Visibility trace of the selected object in the context of the current frame** — FPV:
     the real framing; orbit: current screen position. FPV may carry additional info.
   - **12 h visible window, CONTINUOUS INFINITE drag both past and future** (replaces fixed
     ±12 h) **with actual hour ticks** (PhotoPills-style alignment of hours ↔ bands/graphs).
     Keep fast-forward, calendar, time-pick, NOW and all existing UX intact.
3. **Jump-into-FPV at my current location** — BOTH shells (desktop + mobile), one button:
   geolocation (most idiomatic browser API) → straight into temp-pin FPV (mobile 🧭 MY LOCATION
   today only pins + flies; desktop has nothing).
4. **Space bar = ascend with hold-acceleration** — longer press = faster gain, precision-
   controlled (never too fast). Scope ambiguity to resolve at design: FPV eye lift (likely,
   pairs the ⤒ nudge / encoder identity) vs orbit zoom.

Related: [[project/wip-2026-08-13-m2-fpv-touch]] [[project/wip-2026-08-11-mobile-design]]
[[project/wip-2026-08-13-slice7-phase8a]]
