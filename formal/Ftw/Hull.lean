/-
  Ftw.Hull — THE ARCHITECTURAL KEYSTONE of BEST SPOT, proved rather than sampled.

  Mirrors `src/lib/geo/horizonSweep.ts`. The claim the whole feature rests on, quoted from
  `horizonSweep.ts:12-17`:

      "THE HULL IS INDEPENDENT OF EYE HEIGHT AND OF SCENE TIME."

  It is what makes the altitude slider and the time scrubber live: they re-QUERY the resident hulls
  instead of rebuilding them (browser-measured: a 2→400 m lift drag builds ZERO hulls). Today that
  claim is pinned by a random-DSM brute-force diff and a 5-lift monotonicity spot-check — i.e. by
  sampling. Here it is a theorem.

  The setup, from `horizonSweep.ts:19-33`:

      tan(alt) = ( h_t − (g_c + L) − D²·drop ) / D          drop = (1−k)/(2R),  D = s_t − s_c
      tan(alt) = ( zs[t] − q_c ) / D  +  2·drop·s_c
        where  zs[t] = h_t − drop·s_t²        <- the curvature-folded surface (finding F4)
               q_c   = g_c − drop·s_c² + L    <- THE ONLY PLACE THE EYE APPEARS

  Writing `g_q(s) = (zs(s) − q) / (s − s_c)` — the slope from the eye point `(s_c, q)` to a
  candidate setter — the two theorems below are the mathematical content of, respectively,
  `hullBuilds === 0` and the `break` at `horizonSweep.ts:580`.
-/
import Mathlib.Analysis.SpecialFunctions.Pow.Real

namespace Ftw

/-! ## 1. Finding F4 — the curvature fold, and why the eye appears exactly once

`buildHulls` subtracts `drop · s²` from every sample ONCE, at build time. This identity is what
licenses that: after folding, the eye height `L` survives only inside the single scalar `q_c`. -/

/-- **The curvature-folding identity.** The raw tangent (left) and the folded form the code
    actually evaluates (right) are equal for every sample, every eye height and every curvature.

    Read the right-hand side carefully: `h - d·st²` is `zs[t]`, built once and cached; the eye `L`
    occurs only inside `g - d·sc² + L`, i.e. `q_c`. That is the entire reason a lift change is a
    re-query and not a rebuild. -/
theorem hull_fold (h g L d st sc : ℝ) (hne : st ≠ sc) :
    (h - (g + L) - (st - sc) ^ 2 * d) / (st - sc)
      = ((h - d * st ^ 2) - (g - d * sc ^ 2 + L)) / (st - sc) + 2 * d * sc := by
  have hs : st - sc ≠ 0 := sub_ne_zero_of_ne hne
  field_simp
  ring

/-! ## 2. The eye-independence of the hull

`g_q(s) = (zs(s) − q) / (s − s_c)`. A sample that lies BELOW the chord joining two others is never
the maximiser of `g_q` — **for any q whatsoever**. So the set of samples that can ever be the
setter is the upper convex hull of the folded surface, and it does not depend on the eye.

This is the theorem behind `RayHulls` being cached across the whole altitude slider. -/

/-- The slope from the eye point `(sc, q)` to the folded sample `(s, z)`. -/
noncomputable def slope (sc q s z : ℝ) : ℝ := (z - q) / (s - sc)

/-- **A sample below the chord is never the setter, at ANY eye height.**

    If `(si, Zi)` lies on or below the segment joining `(sj, Zj)` and `(sk, Zk)` — that is, `si` is
    the convex combination `λ·sj + (1−λ)·sk` and `Zi ≤ λ·Zj + (1−λ)·Zk` — then for every eye height
    `q`, the slope to `i` is dominated by the slope to one of `j`, `k`.

    Therefore the maximiser always lies on the upper convex hull, the hull is a function of the
    folded surface alone, and `q` may vary freely without invalidating it. -/
theorem below_chord_never_sets
    {sc sj sk si Zj Zk Zi q lam : ℝ}
    (hsc : sc < sj) (hjk : sj < sk)
    (hlam0 : 0 ≤ lam) (hlam1 : lam ≤ 1)
    (hsi : si = lam * sj + (1 - lam) * sk)
    (hZi : Zi ≤ lam * Zj + (1 - lam) * Zk) :
    slope sc q si Zi ≤ max (slope sc q sj Zj) (slope sc q sk Zk) := by
  have ha : 0 < sj - sc := by linarith
  have hb : 0 < sk - sc := by linarith
  -- the interpolated abscissa sits strictly to the right of the eye
  have hd : si - sc = lam * (sj - sc) + (1 - lam) * (sk - sc) := by rw [hsi]; ring
  have hdpos : 0 < si - sc := by
    rw [hd]
    have h1 : 0 ≤ lam * (sj - sc) := mul_nonneg hlam0 ha.le
    have h2 : 0 ≤ (1 - lam) * (sk - sc) := mul_nonneg (by linarith) hb.le
    rcases lt_or_ge lam 1 with h | h
    · nlinarith
    · have : lam = 1 := le_antisymm hlam1 h
      subst this; nlinarith
  set M := max (slope sc q sj Zj) (slope sc q sk Zk) with hM
  -- each endpoint's height is bounded by M times its own lever arm
  have hj : Zj - q ≤ (sj - sc) * M := by
    have : slope sc q sj Zj ≤ M := le_max_left _ _
    rw [slope, div_le_iff₀ ha] at this
    linarith
  have hk : Zk - q ≤ (sk - sc) * M := by
    have : slope sc q sk Zk ≤ M := le_max_right _ _
    rw [slope, div_le_iff₀ hb] at this
    linarith
  rw [slope, div_le_iff₀ hdpos, hd]
  have h1 : lam * (Zj - q) ≤ lam * ((sj - sc) * M) := mul_le_mul_of_nonneg_left hj hlam0
  have h2 : (1 - lam) * (Zk - q) ≤ (1 - lam) * ((sk - sc) * M) :=
    mul_le_mul_of_nonneg_left hk (by linarith)
  nlinarith

/-! ## 3. The setter moves monotonically OUTWARD as the eye rises

`horizonSweep.ts:558-561` justifies both the `break` in `queryRay` and the binary peak search in
`sweepAzimuth` with: *"the slope sequence over hull vertices is UNIMODAL … the same fact is why the
maximiser moves monotonically outward as the eye rises."*

`horizonSweep.test.ts:368` samples that at five lifts. Here is the underlying two-vertex fact. -/

/-- **Once the farther sample wins, it keeps winning as the eye rises.**

    For `sc < si < sj` and `q ≤ q'`: if sample `j` (the farther one) already matches or beats `i`
    at eye height `q`, it still does at every higher eye `q'`.

    The reason is that the comparison is a THRESHOLD in `q`: cross-multiplying,
    `i ≤ j ⟺ Zi·(sj−sc) − Zj·(si−sc) ≤ q·((sj−sc) − (si−sc))`, and the bracket on the right is
    strictly positive, so the right-hand side increases with `q` and the inequality, once true,
    stays true. Preference can therefore flip at most once, and only outward. -/
theorem setter_moves_outward
    {sc si sj Zi Zj q q' : ℝ}
    (hsc : sc < si) (hij : si < sj) (hq : q ≤ q')
    (hwin : slope sc q si Zi ≤ slope sc q sj Zj) :
    slope sc q' si Zi ≤ slope sc q' sj Zj := by
  have ha : 0 < si - sc := by linarith
  have hb : 0 < sj - sc := by linarith
  rw [slope, slope, div_le_div_iff₀ ha hb] at hwin
  rw [slope, slope, div_le_div_iff₀ ha hb]
  -- hwin :  (Zi - q) * (sj - sc) ≤ (Zj - q) * (si - sc)
  -- goal  :  (Zi - q') * (sj - sc) ≤ (Zj - q') * (si - sc)
  -- the difference between the two is  (q' - q) * ((sj - sc) - (si - sc)) ≥ 0
  nlinarith [mul_nonneg (by linarith : (0:ℝ) ≤ q' - q) (by linarith : (0:ℝ) ≤ sj - si)]

/-- The same fact stated as the code uses it: the division-free comparison at
    `horizonSweep.ts:366` / `:856`. Cross-multiplication is valid because both lever arms are
    strictly positive, which is guaranteed by the eye sitting strictly inside the ray. -/
theorem slope_le_iff_cross
    {sc si sj Zi Zj q : ℝ} (hsc : sc < si) (hij : si < sj) :
    slope sc q si Zi ≤ slope sc q sj Zj ↔ (Zi - q) * (sj - sc) ≤ (Zj - q) * (si - sc) := by
  have ha : 0 < si - sc := by linarith
  have hb : 0 < sj - sc := by linarith
  rw [slope, slope, div_le_div_iff₀ ha hb]

end Ftw
