/-
  Ftw — machine-checked specifications for the load-bearing math of Frame the World.

  Scope: the parts of BEST SPOT (the observability heatmap) whose correctness is an
  ALGEBRAIC claim rather than a numerical one. Anything that depends on IEEE-754
  rounding, on a DEM raster, or on the ephemeris is deliberately OUT of scope here —
  those are pinned by the vitest golden tables and the browser harness instead.

  See `.claude/claude-docs/FORMAL_VERIFICATION.md` for what belongs here and why.
-/
import Ftw.Score
import Ftw.Hull
