/-
  Ftw.Score — the BEST SPOT per-cell composition, as a theorem rather than a golden table.

  Mirrors `src/lib/geo/bestSpotMetric.ts:1168-1191` (`cellScore`) and its fused twin
  `src/lib/geo/bestSpotSolver.ts:1607` (`composeScores`):

      S = A_hard · A_soft^e · M_eff · G(V) · ( Σ_k w_k·T_k / Σ_k w_k )

  What is proved here is the part that is a statement about REAL NUMBERS, and therefore the part a
  test can only ever sample. Deliberately NOT here: anything depending on IEEE-754 rounding, on the
  DEM raster, or on the ephemeris. Those stay pinned by vitest + the browser gate.

  THE POINT OF THIS FILE. Writing the composition down as a theorem forces its hypotheses into the
  open, and two of them turned out to be UNENFORCED in the shipped sanitizer — see
  `weights_nonneg_is_necessary` and `confBound_is_necessary`.
-/
import Mathlib.Analysis.SpecialFunctions.Exp
import Mathlib.Analysis.SpecialFunctions.Pow.Real

namespace Ftw

/-! ## 1. `clamp01` — `bestSpotMetric.ts:184` -/

/-- `clamp01 x = x > 0 ? (x < 1 ? x : 1) : 0`. (The NaN branch is an IEEE fact, not a real one.) -/
noncomputable def clamp01 (x : ℝ) : ℝ := max 0 (min 1 x)

theorem clamp01_nonneg (x : ℝ) : 0 ≤ clamp01 x := le_max_left _ _

theorem clamp01_le_one (x : ℝ) : clamp01 x ≤ 1 := max_le zero_le_one (min_le_left _ _)

theorem clamp01_mem (x : ℝ) : clamp01 x ∈ Set.Icc (0 : ℝ) 1 :=
  ⟨clamp01_nonneg x, clamp01_le_one x⟩

/-- `clamp01` is the identity on [0,1] — the property that lets the code clamp defensively at every
    seam without changing an already-valid value. -/
theorem clamp01_id_of_mem {x : ℝ} (h0 : 0 ≤ x) (h1 : x ≤ 1) : clamp01 x = x := by
  unfold clamp01
  rw [min_eq_right h1, max_eq_right h0]

theorem clamp01_monotone : Monotone clamp01 := fun _ _ h =>
  max_le_max le_rfl (min_le_min le_rfl h)

/-! ## 2. The preference blend — the claim the GL colour ramp rests on

`bestSpotMetric.ts:1182`:  `preference = wTotal > 0 ? wDotT / wTotal : 0`

The shipped weights are `{v 0.15, l 0.30, p 0.25, f 0.30}` and they are NOT required to sum to 1 —
normalising by `Σw` is what stops an owner's `__globe.bestSpotTuning` patch from inflating `S` past
1. That normalisation is exactly what makes the theorem below true. -/

/-- The 4-term preference blend, in the record's own insertion order (v, l, p, f). -/
noncomputable def preference (wv wl wp wf tv tl tp tf : ℝ) : ℝ :=
  (wv * tv + wl * tl + wp * tp + wf * tf) / (wv + wl + wp + wf)

/-- **The blend is bounded in [0,1].** Hypotheses: every weight NON-NEGATIVE, not all vanishing,
    every term already in [0,1]. All three are load-bearing — see §2b. -/
theorem preference_mem_Icc
    {wv wl wp wf tv tl tp tf : ℝ}
    (hv : 0 ≤ wv) (hl : 0 ≤ wl) (hp : 0 ≤ wp) (hf : 0 ≤ wf)
    (hpos : 0 < wv + wl + wp + wf)
    (htv0 : 0 ≤ tv) (htv1 : tv ≤ 1) (htl0 : 0 ≤ tl) (htl1 : tl ≤ 1)
    (htp0 : 0 ≤ tp) (htp1 : tp ≤ 1) (htf0 : 0 ≤ tf) (htf1 : tf ≤ 1) :
    0 ≤ preference wv wl wp wf tv tl tp tf ∧ preference wv wl wp wf tv tl tp tf ≤ 1 := by
  unfold preference
  have hnum : 0 ≤ wv * tv + wl * tl + wp * tp + wf * tf := by
    have h1 := mul_nonneg hv htv0
    have h2 := mul_nonneg hl htl0
    have h3 := mul_nonneg hp htp0
    have h4 := mul_nonneg hf htf0
    linarith
  refine ⟨div_nonneg hnum hpos.le, ?_⟩
  rw [div_le_one hpos]
  nlinarith [mul_nonneg hv htv0, mul_nonneg hl htl0, mul_nonneg hp htp0, mul_nonneg hf htf0]

/-- **The blend is monotone in the framing term** (identical for the other three by symmetry).
    This is what makes `S` usable as a RANKING, which is the whole product. -/
theorem preference_mono_f
    {wv wl wp wf tv tl tp : ℝ} (hf : 0 ≤ wf)
    (hpos : 0 < wv + wl + wp + wf)
    {tf tf' : ℝ} (h : tf ≤ tf') :
    preference wv wl wp wf tv tl tp tf ≤ preference wv wl wp wf tv tl tp tf' := by
  unfold preference
  have hnum : wv * tv + wl * tl + wp * tp + wf * tf
      ≤ wv * tv + wl * tl + wp * tp + wf * tf' := by
    nlinarith [mul_le_mul_of_nonneg_left h hf]
  exact div_le_div_of_nonneg_right hnum hpos.le

/-- **A uniform rescale of the weight vector leaves the blend unchanged.** This is the algebraic
    content of `bestSpotMetric.test.ts:1000` ("double the whole blend, identical score"), which
    currently pins it at exactly one scale factor. -/
theorem preference_scale_invariant
    {wv wl wp wf tv tl tp tf : ℝ} {c : ℝ} (hc : c ≠ 0) :
    preference (c*wv) (c*wl) (c*wp) (c*wf) tv tl tp tf
      = preference wv wl wp wf tv tl tp tf := by
  unfold preference
  rw [show c*wv*tv + c*wl*tl + c*wp*tp + c*wf*tf
        = c * (wv*tv + wl*tl + wp*tp + wf*tf) by ring,
      show c*wv + c*wl + c*wp + c*wf = c * (wv + wl + wp + wf) by ring]
  exact mul_div_mul_left _ _ hc

/-! ### 2b. THE HYPOTHESIS THAT IS NOT ENFORCED IN THE SHIPPED CODE

`weights.*` carries NO floor at zero: `clampLeaf` (`bestSpotScoring.ts`) has no `weights.*` case and
`clampResolved` never touches them, so `sanitizeScoringPatch({weights:{f:-1}})` survives — verified
executably: `weights = {v:0.15, l:0.30, p:0.25, f:-1}`, weight sum **-0.30000000000000004**. -/

/-- **`0 ≤ w` is necessary, not decorative.** With `wv = 2, wf = -1` (weight sum 1, so the
    degenerate `Σw ≤ 0` branch is NOT what is doing the work here) the blend strictly DECREASES as
    the framing term increases: a cell with a better silhouette ranks LOWER. -/
theorem weights_nonneg_is_necessary :
    preference 2 0 0 (-1) 0 0 0 1 < preference 2 0 0 (-1) 0 0 0 0 := by
  unfold preference; norm_num

/-- And `Σw = 0` is reachable too, where the code short-circuits `preference` to 0 — a
    discontinuity, not a limit. -/
theorem weights_sum_zero_is_reachable : (1 : ℝ) + 0 + 0 + (-1) = 0 := by norm_num

/-! ## 3. R7 — `M_eff`, the moon-worth floor (`bestSpotMetric.ts:1327`) -/

noncomputable def effectiveWorth (floor m : ℝ) : ℝ := floor + (1 - floor) * clamp01 m

/-- **R7 is exactly 1 for sun kinds, for EVERY floor.** Sun kinds have `worth = 1` by construction
    (`bestSpotTrack.ts:227`), so this is what guarantees the owner ruling "no sun number moved"
    holds across an owner-tunable `worth.effectiveFloor`. Over ℝ it is immediate; the shipped claim
    is the stronger IEEE-754 one, which stays pinned by vitest. -/
theorem effectiveWorth_one (floor : ℝ) : effectiveWorth floor 1 = 1 := by
  unfold effectiveWorth clamp01; norm_num

/-- `M_eff` never falls below the floor and never exceeds 1: bad moon nights DIM rather than
    VANISH, which is the entire content of ruling R7. -/
theorem effectiveWorth_mem {floor m : ℝ} (_h0 : 0 ≤ floor) (h1 : floor ≤ 1) :
    floor ≤ effectiveWorth floor m ∧ effectiveWorth floor m ≤ 1 := by
  unfold effectiveWorth
  have hc0 := clamp01_nonneg m
  have hc1 := clamp01_le_one m
  constructor <;> nlinarith

/-- …and it is monotone in the underlying worth, so raising the floor cannot RE-ORDER two nights. -/
theorem effectiveWorth_mono {floor : ℝ} (h1 : floor ≤ 1) {m m' : ℝ} (h : m ≤ m') :
    effectiveWorth floor m ≤ effectiveWorth floor m' := by
  unfold effectiveWorth
  have := clamp01_monotone h
  nlinarith

/-! ## 4. GRAZE — `F = 1 - exp(-τ / scale)` (`bestSpotMetric.ts:642`) -/

noncomputable def grazeFromTau (tau scale : ℝ) : ℝ := 1 - Real.exp (-(tau / scale))

/-- **F_graze lands in [0,1) for every non-negative τ** — it approaches saturation but never
    reaches it, which is exactly the property the replaced `F_sil` kernel lacked (it hit 1 for ANY
    built skyline the body's centre crossed, giving F ≈ P for almost every city cell, measured
    r² 0.997). -/
theorem grazeFromTau_mem {tau scale : ℝ} (hs : 0 < scale) (ht : 0 ≤ tau) :
    0 ≤ grazeFromTau tau scale ∧ grazeFromTau tau scale < 1 := by
  unfold grazeFromTau
  have hdiv : 0 ≤ tau / scale := div_nonneg ht hs.le
  refine ⟨?_, ?_⟩
  · have : Real.exp (-(tau / scale)) ≤ 1 := Real.exp_le_one_iff.mpr (by linarith)
    linarith
  · have : 0 < Real.exp (-(tau / scale)) := Real.exp_pos _
    linarith

/-- **F_graze is strictly monotone in τ** — more grazing dwell is always a better framing score,
    which is what makes the τ accumulation meaningful as a ranking quantity. -/
theorem grazeFromTau_strictMono {scale : ℝ} (hs : 0 < scale) {t t' : ℝ} (h : t < t') :
    grazeFromTau t scale < grazeFromTau t' scale := by
  unfold grazeFromTau
  have hlt : t / scale < t' / scale := div_lt_div_of_pos_right h hs
  have : Real.exp (-(t' / scale)) < Real.exp (-(t / scale)) :=
    Real.exp_lt_exp.mpr (by linarith)
  linarith

/-- `τ = 0` ⇒ no framing credit at all. The kernel cannot manufacture signal from nothing. -/
theorem grazeFromTau_zero (scale : ℝ) : grazeFromTau 0 scale = 0 := by
  unfold grazeFromTau; simp

/-! ## 5. The `cut` factor — `max(4·f·(1-f), 1 - clamp01(δ/w))` (`bestSpotMetric.ts:603-608`) -/

/-- The AREA arm of `cut`. `4f(1-f)` peaks at exactly 1 when the disc is HALF-occulted — the
    grazing case the whole kernel exists to reward. -/
theorem area_arm_mem {f : ℝ} (h0 : 0 ≤ f) (h1 : f ≤ 1) :
    0 ≤ 4 * f * (1 - f) ∧ 4 * f * (1 - f) ≤ 1 := by
  constructor
  · nlinarith
  · nlinarith [sq_nonneg (2 * f - 1)]

/-- The area arm attains its maximum exactly at half-occultation. -/
theorem area_arm_peak : 4 * (1/2 : ℝ) * (1 - 1/2) = 1 := by norm_num

/-- **`cut ∈ [0,1]`** — the max of two arms, each in [0,1]. -/
theorem cut_mem {f delta width : ℝ} (h0 : 0 ≤ f) (h1 : f ≤ 1) :
    0 ≤ max (4 * f * (1 - f)) (1 - clamp01 (delta / width)) ∧
    max (4 * f * (1 - f)) (1 - clamp01 (delta / width)) ≤ 1 := by
  obtain ⟨ha0, ha1⟩ := area_arm_mem h0 h1
  have hc0 := clamp01_nonneg (delta / width)
  have hc1 := clamp01_le_one (delta / width)
  exact ⟨le_max_of_le_left ha0, max_le ha1 (by linarith)⟩

/-! ## 6. `confBound` — the OTHER unenforced hypothesis

`f = max(F_graze, F_gap)` is documented as `0..1` (`bestSpotTypes.ts:307`). `F_graze` is bounded
unconditionally (§4). `F_gap = notch.f · combineShoulderQuality(qL,qR)` with
`q = relief · conf[src] · depth`, and **`conf` is unclamped**: `clampResolved` bounds
`graze.conf.tree ≤ 0.6` and nothing else, so `sanitizeScoringPatch` admits
`graze.conf.terrain = 5` and `graze.conf.building = 2` — verified executably. -/

/-- **`F_gap ∈ [0,1]` requires `conf ≤ 1`.** With every factor in [0,1] the product is too. -/
theorem confBound {notchF relief conf depth : ℝ}
    (hn0 : 0 ≤ notchF) (hn1 : notchF ≤ 1) (hr0 : 0 ≤ relief) (hr1 : relief ≤ 1)
    (hc0 : 0 ≤ conf) (hc1 : conf ≤ 1) (hd0 : 0 ≤ depth) (hd1 : depth ≤ 1) :
    0 ≤ notchF * (relief * conf * depth) ∧ notchF * (relief * conf * depth) ≤ 1 := by
  constructor
  · positivity
  · nlinarith [mul_nonneg hr0 hc0, mul_nonneg (mul_nonneg hr0 hc0) hd0]

/-- **And without it the bound is FALSE.** `conf = 2` is reachable from a persisted user profile,
    and publishes `f = 1.6 > 1` on `CellScore.f`. -/
theorem confBound_is_necessary : ¬ ((1:ℝ) * (1 * 2 * (4/5)) ≤ 1) := by norm_num

end Ftw
