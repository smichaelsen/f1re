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
- Surface enum: `asphalt`, `grass`, `gravel`. Catalog `SURFACE_PARAMS` with `drag`, `gripFactor` (0..1 multiplier on baseline), `color`.
- `Track.probe(x, y)` returns `{ distance, nx, ny, side, index }` (side = `outside | inside`; `index` is the closer endpoint of the closest centerline segment).
- `Track.surfaceAt(x, y)` resolves asphalt → patch → default runoff per side.
- Polygon patches auto-categorized as outside/inside by centroid; rendered in the correct paint order so they show.
- Per-frame surface feel: `RaceScene.surfaceFeel(car)` reads the surface under each of the 4 corners and passes `{ drag, gripFactor }` to `car.update`. Drag and gripFactor are both **averaged across corners** so the penalty scales linearly with how many wheels are off-asphalt. The car applies gripFactor as a recovering floor (see `progress/physics.md` → Grip-recovery model).

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

### Skid marks
- `src/entities/SkidMarks.ts` wraps a single `Phaser.GameObjects.RenderTexture` sized to the track's centerline bounding box + 200px margin. One offscreen `skidStamp` texture (8×4 dark ellipse at `0x111111`) is generated once via `Graphics.generateTexture`.
- Each frame `RaceScene.updateSkidMarks(dt)` walks the cars; for any car with `skidIntensityFor(car) > 0`, it stamps the dark blob at all 4 OBB corners. Per-frame alpha = `0.06 × intensity × min(2, dt × 60)` — frame-rate-normalized so 30fps and 60fps build up at the same per-second rate.
- **Batched stamps.** All stamps for a frame are wrapped in `RenderTexture.beginDraw()` / `batchDraw(...)` / `endDraw()`. Without batching, each `rt.draw` triggered its own framebuffer bind/unbind on WebGL — with 4 corners × multiple skidding cars per frame, the per-stamp render-target switches stalled the GPU pipeline noticeably. Batching collapses the whole frame's stamps into a single render-target bind. The scene also early-returns if no car is sliding, so non-skid frames pay zero RT cost.
- Marks are persistent (RT preserves prior draws) so repeated stamps in the same place darken via alpha accumulation. Out-of-bounds stamps are clipped at the SkidMarks layer so we never call `rt.draw` outside its rect.
- RT depth = 3: above the start/finish stripe + asphalt paint (depth 0–2), below pickups + cars + items.
- **The visual gate is the same as the audio gate** — `skidIntensityFor` requires speed ≥ 80, lateral ≥ 70, and slip ratio ≥ 0.30. Driving straight across grass produces no marks; a mid-corner slide on grass marks heavily because grass also depresses the car's gripFactor (see `progress/physics.md`), which lengthens slides.
- Helper stamp Sprite is `setVisible(false)` and exists only as a positionable/rotatable source for `RenderTexture.draw` — rotation is set to the car's heading per stamp so the blob aligns with the direction of travel.

### Inspector reference overlays
- Optional `referenceOverlay` field on `TrackData` (image path + center + scale + alpha + rotation) renders a semi-transparent map under the geometry in `InspectScene`. Toggle with key `4`.
- Inspector-only; never read by `RaceScene`. The image lives under `public/inspect-overlays/` which is gitignored — keeps potentially copyrighted source maps out of the repo while the schema field stays portable.
- Used by Champions' Wall (Montreal map). Pattern is reusable for any future real-world-inspired track.

## Next Up
- Demo / sample track that exercises per-segment runoff (e.g., a Monaco-shaped track).
