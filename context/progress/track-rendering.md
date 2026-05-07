# Track Rendering + Surface System

How tracks are drawn from JSON, plus the surface lookup that drives physics.

## Completed

### Render
- Concentric runoff bands per side (offset-loop fills).
- Polygon patches over the runoff band.
- Dark wall stripes at runoff outer edges (4px).
- White track-edge lines at both asphalt edges (2px), drawn over walls so they're always visible.
- Apex kerbs (red/white) auto-detected from curvature, drawn last over the inside white line at corners. Sign of curvature picks the side per point, so chicane bends turning either way both get kerbs.
- Centerline dashes, start/finish checker stripe, world grass background.

### Surface system — Phase 1
- Surface enum: `asphalt`, `grass`, `gravel`. Catalog `SURFACE_PARAMS` with drag, grip, color.
- `Track.probe(x, y)` returns `{ distance, nx, ny, side, index }` (side = `outside | inside`; `index` is the closer endpoint of the closest centerline segment).
- `Track.surfaceAt(x, y)` resolves asphalt → patch → default runoff per side.
- Polygon patches auto-categorized as outside/inside by centroid; rendered in the correct paint order so they show.
- Per-frame surface feel: `RaceScene.surfaceFeel(car)` averages the surface under each of the 4 corners and passes `{ drag, grip }` to `car.update`.

### Surface system — Phase 2 (per-segment runoff width)
- `RunoffSide.width` accepts `number | number[]`. Number = uniform; array overrides per-centerline-point (values wrap if shorter).
- `Track.wallOffset(side, index?)` honors per-point widths when `index` is supplied; without it, returns the max width across the loop (legacy callers stay safe).
- `Track.offsetLoopVarying(side)` builds the runoff outer-edge polygon with per-point widths. The renderer uses it for runoff fills, walls, and the inside-grass mask. Asphalt edges still use `offsetLoop` because asphalt width is uniform.
- Backward compatible: existing v1 / v2 tracks with `width: number` render unchanged.
- Unlocks Monaco-style tracks where walls hug the asphalt at corners and runoff opens up on straights. Also resolves the offset-loop self-intersection issue at sharp curves (narrow runoff at sharp corners avoids the perpendicular crossings that produced the X-pattern artifact).

## Architecture Decisions
- **Track JSON is the source of truth for geometry + surfaces.** Engine code never embeds track-specific values. New tracks ship as JSON + one `MenuScene.TRACKS` entry.
- **Two schema versions kept simultaneously.** v1 (no runoff) loads with zero-width runoff (= walls at the asphalt edge, current Oval behavior). v2 adds `runoff` and `patches`. Bumping the schema is a planned event, not a drive-by.
- **Surface params live centrally** in `SURFACE_PARAMS`, not at call sites. Adding a surface = one entry there + JSON support.
- **Asphalt-edge geometry uses the fixed-offset path** (`offsetLoop`) since asphalt width is uniform across the loop. Runoff geometry uses `offsetLoopVarying` so it can respect per-point widths.

## Open Questions
- **Runoff color contrast** — grass runoff (`0x3d8a3d`) is only slightly lighter than world grass (`0x2a6f2a`). Visible but subtle. Bump for more pop, or keep subtle?
- **Apex kerb threshold** — currently 35th-percentile of absolute curvature. Works on 3 tracks but per-track tuning (or absolute threshold) may be needed if we add tracks where this misbehaves.

## Next Up
- Demo / sample track that exercises per-segment runoff (e.g., a Monaco-shaped track).
