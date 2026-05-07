# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Phase 1 — Surface system shipped. Polishing visuals + race-flow correctness.

## Current Goal

- Adopt the Six-File Context Methodology and use it to drive future units.

## Completed

### Engine + bootstrap
- Phaser 3 + TypeScript + Vite scaffold (port 5273 dev, 4273 preview).
- BootScene generates car + pickup textures procedurally.
- MenuScene with car select (RED/BLUE/YELLOW/GREEN) + track select + START + INSPECT.
- RaceScene state machine: countdown → racing → finished. ESC always returns to menu.

### Physics + collisions
- Top-down arcade physics (throttle, brake, steer, grip, drag, boost, spin, shield).
- OBB collision: corner-sampled wall push-back (4 corners, worst-overflow normal).
- OBB car-vs-car collision via SAT (2 axes per car, MTV separation, impulse along normal). Bounding-circle broad-phase.

### Tracks (data-driven)
- Track JSON schema versions 1 (no runoff) and 2 (per-side runoff + polygon patches).
- `parseTrackData` validator with descriptive errors.
- `Track.fromData(scene, data)` builds the track. No engine-coded tracks anymore.
- `scripts/gen-tracks.mjs` produces oval, stadium, temple-of-speed.
- Three tracks shipping:
  - **Oval** (v1, zero runoff, walls at edge — sweeping bends).
  - **Stadium** (v2, 90/50 grass runoff with a gravel patch on one corner — long straights, 4 corners). Start at index 4 (mid top straight).
  - **Temple of Speed** (v1, Monza-shaped, scaled 2× for chicane resolution, 282 points). Start at index 26 (mid main straight).

### Surface system (Phase 1 of the runoff plan)
- Surface enum: `asphalt`, `grass`, `gravel`. Catalog `SURFACE_PARAMS` with drag, grip, color.
- `Track.probe(x, y)` returns `{ distance, nx, ny, side }` (side = `outside | inside`).
- `Track.surfaceAt(x, y)` resolves asphalt → patch → default runoff per side.
- `Track.wallOffset(side)` = `asphaltHalf + runoff[side].width`.
- Polygon patches auto-categorized as outside/inside by centroid; rendered in correct paint order so they show.
- Per-frame surface feel: `RaceScene.surfaceFeel(car)` averages 4 corners, passes `{ drag, grip }` to `car.update`.
- `applyTrackBounds` uses `wallOffset(probe.side)` per corner.

### Track render
- Concentric runoff bands per side (offset-loop fills).
- Polygon patches over the runoff band.
- Dark wall stripes at runoff outer edges (4px).
- White track-edge lines at both asphalt edges (2px), drawn over walls so they're always visible.
- Apex kerbs (red/white) auto-detected from curvature, drawn last over inside white line at corners.
- Centerline dashes, start/finish checker stripe, world grass background.

### Lap tracking
- Lap completion fires on CP0 cross (the actual finish line), not on the previous checkpoint.
- `nextCheckpoint = 1` set at GO so the start position doesn't double-count.
- Position progress formula: `lap × N + (nextCheckpoint - 1 + N) % N`.
- Checkpoint zone widened: `outsideHalf` and `insideHalf` based on `wallOffset` + 10 margin (was symmetric `width + 20`, which missed wide-runoff cars).

### Pickups + items
- 8 pickups per track, 3.5s respawn.
- Items: `boost`, `missile` (homing), `oil`, `shield`.
- Player triggers via SPACE; AI triggers on random 1–5s delay after pickup.
- Spinning AI keeps its timer; useItem clears both `itemSlot` and `useItemAt`.

### Race flow + results
- Race continues after first car finishes; finished cars idle (NO_INPUT) but stay in the world.
- Lapped cars finish on next CP0 crossing after the winner.
- Results overlay: compact bottom-right while player still racing → flips to full center "RACE OVER" once player finishes.
- Format: P1 absolute total time; P2..PN interval to car ahead (`+s.cc` or `+m:ss.cc` for time, `+N LAP(S)` for lap-down).
- Best lap per car shown in full mode. Monospace font for column alignment. Panel auto-sizes to text.

### Inspector
- InspectScene: read-only track viewer.
- Pan-drag, wheel-zoom-to-cursor, +/-/fit on-screen buttons.
- Two-camera split (world + UI) so HUD doesn't scale with world zoom.
- Shows centerline points (yellow) with index labels (every Nth), checkpoint markers (cyan) with CP labels and ★ on finish.
- Track cycler ([ / ]), point/checkpoint visibility toggles (1 / 2), fit (0), ESC to menu.
- Live cursor coords readout (top-right).

### Cars
- F1-style open-wheel sprite (44×20): rounded chassis, 4 corner wheels with silver hubs, sidepods, cockpit + helmet, front/rear wings.
- 4 colour variants generated procedurally.

### Temple of Speed — Roggia + Ascari arc-based
- Replaced the sin-wave centerlines for Variante della Roggia and Variante Ascari with three-arc shapes (30°-60°-30° for Roggia, 60°-120°-60° for Ascari). Both return to the original line so no downstream geometry changes were needed.
- Reason: at high peakOff, `Track.offsetLoop` produced self-intersecting offset polygons, which the canvas renders with even-odd fill rule → the visible X-shaped wall + runoff artifacts. Arcs have constant local curvature, so adjacent perpendicular offsets fan out cleanly without crossing.
- Sin-wave-shaped chicane gravel patches removed (geometry no longer matches). Outside-arc gravel can be re-added later for Roggia/Ascari individually.

### Temple of Speed — Prima Variante + runoff
- Schema bump: temple-of-speed v1 → v2 with default grass runoff (outside 80, inside 30).
- Prima Variante rebuilt as a real three-arc Monza-style chicane: ~90° right (R=48) → 5u straight → ~135° left (R=48) → 20u straight → smooth ~45° right (R=248.55). Sum of angle deltas = 0; chicane returns to y=500 so the post-T3 straight lines up with the start-finish straight. Connector + Curva Grande remain at original positions.
- Sin-wave `chicane()` retained for Variante della Roggia and Variante Ascari (sharper peakOff=130 to force the chicane drive); Variante del Rettifilo no longer uses it.
- Gravel patches: outside arc-1 (T1 entry), outside arc-2 (T2 escape, the main one); plus chicane-apex gravel for Roggia + Ascari, and outside arcs for Curva Grande, Lesmo 1, Parabolica.
- Helpers in `scripts/gen-tracks.mjs`: `arcOutsidePatch(cx, cy, r, asphaltHalf, runoff, a0, a1, ...)` (annular sector) and `chicaneApexInsidePatch(...)` (sin-wave inside-cut).

### Shield visibility
- Pulsing cyan ring (`Car.SHIELD_COLOR = 0x88ccff`) drawn around any car with `shielded = true`. Sin-based alpha pulse (0.45–0.85), 26px radius, drawn on a per-car `shieldRing` Graphics owned by `Car`.
- `Car.spin(seconds)` now returns `boolean` — `false` when the hit was absorbed by the shield. Existing missile + oil collision paths consume the return.
- `RaceScene.spawnShieldFlash(car)` plays a one-shot expanding cyan ring (r 18→56, alpha 1→0, stroke 4→1, ease cubic-out, 380ms) at the car position; player gets a "BLOCKED!" HUD flash.
- `uiCam.ignore(g)` applied to the runtime flash graphics so it lives in the world, not the HUD layer.

### Camera polish
- World camera zoom dropped from 0.9 → 0.85 for a wider preview of the upcoming track.
- Velocity look-ahead via `cameras.main.setFollowOffset(-vx*k, -vy*k)` per racing frame, with `k = 0.35` and a `±220` clamp so spin doesn't whip the camera. Phaser's existing 0.12 lerp on `startFollow` smooths the offset transition.
- Two-camera split applied in `RaceScene` (mirrors the inspector pattern): a dedicated `uiCam` renders only HUD elements; the world camera ignores them. HUD elements no longer scale with world zoom.
- `Hud` now exposes its game objects via `hud.objects` so the scene can wire the ignore lists in one place.
- Runtime-spawned world graphics (`fireMissile`, `dropOil`) call `uiCam.ignore(g)` at creation so the UI camera stays HUD-only.

### Methodology
- Adopted Six-File Context Methodology. Six context files written under `context/`. `CLAUDE.md` entry point at root.

## In Progress

- None.

## Next Up

- (User to decide.) Candidate units, ordered by impact:
  1. **Phase 2 of runoff system** — per-segment wall positions / per-segment runoff so we can build a Monaco-style track with walls right at the asphalt edge in places, runoff in others.
  2. **Game-feel pass** — tire skid marks on grass, dust particles, sparks on wall hits, simple Howler audio (engine, hit, item).
  3. **Better AI** — racing-line offset (not pure centerline), corner brake-points, item awareness.
  4. **Sectors + sector times** — split each track into S1/S2/S3 with per-sector best-time tracking.
  5. **Car catalog** — beyond colour: `accel`, `topSpeed`, `grip` profiles per car with pick at menu.

## Open Questions

- **Runoff color contrast** — grass runoff (`0x3d8a3d`) is only slightly lighter than world grass (`0x2a6f2a`). Visible but subtle. Bump for more pop, or keep subtle?
- **Apex kerb threshold** — currently 35th-percentile of absolute curvature. Works on 3 tracks but per-track tuning (or absolute threshold) may be needed if we add tracks where this misbehaves.
- **R restart guard** — R restarts immediately when results panel is showing. No "hold to confirm". Is that fine or should it confirm?
- **Look-ahead tuning** — `k = 0.35`, clamp `±220`, zoom `0.85`. Should be felt in real driving on each track; numbers may want a per-track or speed-curve tweak (e.g., non-linear scaling so it's gentle at low speed and stronger at top speed).
- **UI cam resize** — `uiCam` is created at the current `scale.width/height` and not re-sized on window resize. Acceptable for now; revisit if the canvas can resize in normal play.

## Architecture Decisions

- **Track JSON is the source of truth for geometry + surfaces.** Engine code never embeds track-specific values. New tracks ship as JSON + one `MenuScene.TRACKS` entry.
- **Two schema versions kept simultaneously.** v1 (no runoff) loads with zero-width runoff (= walls at asphalt edge, current Oval/Temple behavior). v2 adds `runoff` and `patches`. Bumping the schema is a planned event, not a drive-by.
- **Surface params live centrally** in `SURFACE_PARAMS`, not at call sites. Adding a surface = one entry there + JSON support.
- **OBB collision was deliberately chosen over circles** for both walls and car-vs-car. Cars aren't round; circles produced visibly wrong results. SAT for car-vs-car keeps the door open for varied car sizes later.
- **Lap counter increments on CP0 cross only.** Earlier code incremented on the *transition* away from CP(N-1) — that fired one segment-spacing before the actual finish line and was the cause of "race ends before the line" reports.
- **Two-camera split is the pattern for any UI that must not scale with world zoom.** Applied to InspectScene and RaceScene. The `Hud` class owns its `objects` array so the scene can wire main/ui camera ignore lists in one place; runtime-spawned world graphics opt out of the UI cam at creation.
- **Camera follow uses `setFollowOffset` for velocity look-ahead** rather than a custom follower. Phaser's lerp smooths the per-frame offset jumps, so a clamp on the offset is sufficient to prevent whip during spin.
- **No persistence, no network, no third-party UI library.** Stays a single-page client-only app. Revisit only if a multiplayer or accounts feature gets prioritized.

## Session Notes

- Static build is served at `http://localhost:4273` (via `vite preview`). Dev server with hot reload runs at `http://localhost:5273` (`vite dev`). When operating in the file system, the user plays the static build to avoid hot-reload glitches.
- `window.__game` is exposed in `src/main.ts` for in-browser debugging (e.g., `window.__game.scene.scenes.find(s => s.scene.key === 'RaceScene').cameras.main.setZoom(...)`). Production code paths must not depend on it.
- Caveman mode often active in chat — keep code/commits/security writing as normal prose, terse only in conversation per the global rule.
