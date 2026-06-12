# Track: Montmeló

Barcelona-Catalunya-shaped track (2023 no-chicane layout — the fast T13/T14 final corners, no Mickey-Mouse chicane). Named after the town the real circuit sits in, staying clear of trademarks.

## Completed
- **Machine-traced centerline.** Unlike Champions' Wall (hand-traced control points), the control points were extracted programmatically by `scripts/trace-overlay.py`: it masks the sector-colored racing line (red/cyan/yellow) out of the reference map PNG, keeps connected components ≥ 400 px (the line is split by finish-line marks and DRS dashes; legend swatches are dropped via a bottom-region filter), clusters pixels into 7-px grid cells, orders the centroids by nearest-neighbor walk, applies a window-5 moving average, and emits an ordered loop.
- The traced loop (1692 px points) was oriented clockwise (real driving direction), rotated so index 0 sits at the checkered finish mark (image px 1377, 732), and arc-length-resampled to **120 evenly spaced control points** (~202 world units apart). Image is 1920×1035 at scale 4 centered on origin: world = ((px − 960) × 4, (py − 517.5) × 4).
- `scripts/tracks/montmelo.mjs` runs the control points through `catmullRomLoop(ctrl, 3)` → 360 centerline points.
- Validation: min 3-point circumradius **110** (above half-width 70), **zero** self-intersections.
- Width 140, gravel outside runoff 90, grass inside 50 (Barcelona is a gravel-trap circuit), 12 checkpoints, startIndex 0 on the main straight heading west.
- Two real-world DRS zones: back straight after T9 (detection idx 219, zone 227→256) and main straight (detection idx 263 before the final corner, zone 6→57). Anchor indices computed in the track module via `idxAtPx()` (nearest centerline point to a reference-image pixel).
- Reference overlay `public/inspect-overlays/montmelo.png` (gitignored; Wikimedia Commons "2023 F1 CourseLayout Spain.svg" rendered at 1920 px), `referenceOverlay` scale 4 alpha 0.4.
- Registered in `MenuScene.TRACKS` + `TrackKey` union. Verified in inspector: asphalt centerline sits on the map's colored line around the whole lap (esses, T10–T12 stadium loop, final corners, finish at the checkered mark). Race smoke-tested: loads, AI drives off cleanly.

## Architecture Decisions
- **Machine tracing over hand tracing.** When the reference map draws the racing line in distinct flat colors, color-masking + nearest-neighbor walk gives a denser, more faithful centerline in minutes than hand-reading pixel coordinates. `scripts/trace-overlay.py` is reusable for any map with a flat-colored line; hand-tracing stays the fallback for noisy/aerial references.
- **Even resampling at ~200 world-unit spacing** keeps Catmull-Rom faithful: tight corners automatically get several control points because spacing is arc-length-based, so no per-corner hand-tuning was needed (cf. Champions' Wall "4–5 points per tight corner" rule — satisfied implicitly).

## Open Questions
- No `racingLineOverrides` hints yet — the auto-solver line hasn't been reviewed corner-by-corner (T10 entry and T5 are candidates if AI runs wide).
- No surface patches; gravel runoff is uniform. Real Barcelona has asphalt runoff at T1/T2 and big gravel at T4/T9.

## Next Up
- Watch a few AI laps and add racing-line hints where the solver pins an inside edge.
- Differentiate runoff per segment (asphalt at T1, deeper gravel at T4/T9).
