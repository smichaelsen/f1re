# Game Chrome — Menus, Overlays, Cars Sprite, Camera, Inspector

Everything outside the track + physics + items: the framing, the HUD, the menus, the post-race UI, the spectator tooling.

## Completed

### Engine + bootstrap
- Phaser 3 + TypeScript + Vite scaffold (port 5273 dev, 4273 preview).
- BootScene generates car + pickup textures procedurally.
- MenuScene with car select (RED/BLUE/YELLOW/GREEN) + track select + difficulty (EASY/NORMAL/HARD) + laps (1-10) + opponents (1-7) counters + START + INSPECT. Difficulty maps to `DIFFICULTIES` table (perfRange for accel/grip/maxSpeed, skillRange for AI aim quality); RaceScene reads the settings from init data.
- RaceScene state machine: countdown → racing → finished. ESC always returns to menu.

### Cars sprite
- F1-style open-wheel sprite (44×20): rounded chassis, 4 corner wheels with silver hubs, sidepods, cockpit + helmet, front + rear wings.
- 4 colour variants generated procedurally.

### Race flow + results
- Race continues after the first car finishes; finished cars idle (`NO_INPUT`) but stay in the world.
- Lapped cars finish on the next CP0 crossing after the winner.
- Results overlay: compact bottom-right while the player is still racing → flips to a full center "RACE OVER" once the player finishes.
- Format: P1 absolute total time; P2..PN interval to the car ahead (`+s.cc` or `+m:ss.cc` for time, `+N LAP(S)` for lap-down).
- Best lap per car shown in full mode. Monospace font for column alignment. Panel auto-sizes to text.

### Inspector
- InspectScene: read-only track viewer.
- Pan-drag, wheel-zoom-to-cursor, +/-/fit on-screen buttons.
- Two-camera split (world + UI) so the HUD doesn't scale with world zoom.
- Shows centerline points (yellow) with index labels (every Nth), checkpoint markers (cyan) with CP labels and ★ on finish.
- Track cycler ([ / ]), point/checkpoint visibility toggles (1 / 2), fit (0), ESC to menu.
- Live cursor-coord readout (top-right).

### Camera polish (race)
- World camera zoom dropped from 0.9 → 0.85 for a wider preview of the upcoming track.
- Velocity look-ahead via `cameras.main.setFollowOffset(-vx*k, -vy*k)` per racing frame, with `k = 0.35` and a `±220` clamp so spin doesn't whip the camera. Phaser's existing 0.12 lerp on `startFollow` smooths the offset transition.
- Two-camera split applied in `RaceScene` (mirrors the inspector pattern): a dedicated `uiCam` renders only HUD elements; the world camera ignores them. HUD elements no longer scale with world zoom.
- `Hud` exposes its game objects via `hud.objects` so the scene can wire the ignore lists in one place.
- Runtime-spawned world graphics (`fireMissile`, `dropOil`) call `uiCam.ignore(g)` at creation so the UI camera stays HUD-only.

## Architecture Decisions
- **Two-camera split is the pattern for any UI that must not scale with world zoom.** Applied to InspectScene and RaceScene. The `Hud` class owns its `objects` array so the scene can wire main/UI camera ignore lists in one place; runtime-spawned world graphics opt out of the UI cam at creation.
- **Camera follow uses `setFollowOffset` for velocity look-ahead** rather than a custom follower. Phaser's lerp smooths the per-frame offset jumps, so a clamp on the offset is sufficient to prevent whip during spin.
- **The `Hud` is purely a view of game state.** It never owns gameplay state, never decides race outcomes; it only reflects what the scene tells it.

## Open Questions
- **R restart guard** — R restarts immediately when the results panel is showing. No "hold to confirm". Is that fine or should it confirm?
- **Look-ahead tuning** — `k = 0.35`, clamp `±220`, zoom `0.85`. Should be felt in real driving on each track; numbers may want a per-track or speed-curve tweak (e.g., non-linear scaling so it's gentle at low speed and stronger at top speed).
- **UI cam resize** — `uiCam` is created at the current `scale.width`/`scale.height` and is not re-sized on window resize. Acceptable for now; revisit if the canvas can resize in normal play.

## Next Up
- None planned.
