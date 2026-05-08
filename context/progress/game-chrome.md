# Game Chrome — Menus, Overlays, Cars Sprite, Camera, Inspector

Everything outside the track + physics + items: the framing, the HUD, the menus, the post-race UI, the spectator tooling.

## Completed

### Engine + bootstrap
- Phaser 3 + TypeScript + Vite scaffold (port 5273 dev, 4273 preview).
- BootScene generates car + pickup textures procedurally.
- MenuScene split into two views: **main** (team carousel + track + START RACE + SETTINGS + INSPECT) and **settings** (DIFFICULTY / LAPS 1-10 / OPPONENTS 1-9 / DONE). `setView()` toggles visibility of `mainObjects` / `settingsObjects` arrays; ESC backs out of settings. Defaults: laps 3, opponents 5. Difficulty maps to `DIFFICULTIES` table (perfRange for accel/grip/maxSpeed, skillRange for AI aim quality); RaceScene reads the settings from init data.
- Camera is bounded to a fixed `CONTENT_HEIGHT` (800) so wheel events scroll the menu vertically when the viewport is shorter. The bottom hint text uses `setScrollFactor(0)` so it stays pinned at the viewport bottom.
- RaceScene state machine: countdown → racing → finished. ESC always returns to menu.

### Cars sprite
- F1-style open-wheel sprite (44×20): rounded chassis, 4 corner wheels with silver hubs, sidepods, cockpit + helmet, front + rear wings.
- **Two-tone livery + design variant.** Each car has a `{ primary, secondary, variant }` livery (raw hex). Variants: `nose` (secondary fills the nose cone), `sidepods` (top + bottom edge stripes on the chassis), `spine` (centerline stripe nose → engine cover), `wingtips` (secondary on the front + rear wing stripes).
- Textures generated lazily in `src/entities/CarSprite.ts`: `ensureCarTexture(scene, livery)` builds key `car_<primaryHex>_<secondaryHex>_<variant>` on first use and caches it. BootScene no longer pre-bakes per-color textures.

### Teams
- 11 teams in `src/entities/Team.ts`, each a 2026 F1 nod (`Scuderia Rosso`, `Silver Star`, `Rampage Racing`, `Papaya GP`, `Verde Sport`, `Alpha Bleu`, `Crown Royal`, `Forge Racing`, `Vorsprung Racing`, `Liberty Speed`, `Junior Bulls`). Each team owns `{ id, name, short, primary, secondary }`.
- AI cars draw teams from a shuffled pool capped at 2 per team (player counts toward the cap), so HUD names need at most `PAP` / `PAP2`. Player picks their team in the menu. Random `variant` per car.
- Opponent count: 1 – 9. With 11 teams × 2-per-cap (minus the player's team), the pool is always large enough to fill the grid.
- Menu uses a generic `src/ui/Carousel.ts` (single visible card, ‹/› arrows, `n / N` indicator) — designed to be reused for tracks once that list grows.

### Race flow + results
- **Grid lineup.** All cars (player included) start at staggered grid slots **before** the start/finish line. `RaceScene.startGridSlot(index)` walks `40 + index * 40` units back along the centerline from `startIndex` and offsets ±30 laterally on alternating sides. Player gets slot 0 (pole), AIs fill slots `1..opponentCount`. Geometry comes from `gridSlotBehindStart` so the lineup stays on-track even where the start straight curves.
- Race continues after the first car finishes; finished cars idle (`NO_INPUT`) but stay in the world.
- Lapped cars finish on the next CP0 crossing after the winner.
- Results overlay: compact bottom-right while the player is still racing → flips to a full center "RACE OVER" once the player finishes.
- Format: P1 absolute total time; P2..PN interval to the car ahead (`+s.cc` or `+m:ss.cc` for time, `+N LAP(S)` for lap-down).
- Best lap per car shown in full mode. Monospace font for column alignment. Panel auto-sizes to text.
- **AI name disambiguation.** When >3 opponents force a colour to repeat, the second/third instance gets a numeric suffix (`BLU`, `BLU2`, `BLU3`). Position panel and results both keyed off `Car` refs, not names — `RaceScene.rankedCars()` is the single source of truth for race order; `computePositions()` and `showResults()` both derive from it.

### Inspector
- InspectScene: read-only track viewer.
- Pan-drag, wheel-zoom-to-cursor, +/-/fit on-screen buttons.
- Two-camera split (world + UI) so the HUD doesn't scale with world zoom.
- Shows centerline points (yellow) with index labels (every Nth), checkpoint markers (cyan) with CP labels and ★ on finish.
- Track cycler ([ / ]), point/checkpoint visibility toggles (1 / 2), fit (0), ESC to menu.
- Live cursor-coord readout (top-right).
- **Path-segment URL routing.** `/inspect/<trackKey>` loads the scene + track directly; query string `?z=&x=&y=` carries zoom + view-center so reload restores the exact view. `src/router.ts` parses + writes via `history.pushState`/`replaceState`; URL syncs are debounced (250ms). Track cycle pushes a new entry; ESC pushes `/`; browser back/forward routes via a global `popstate` listener in `main.ts` that stops/starts scenes. `BootScene.create` reads the URL once on boot and starts the right scene. Phaser's loader gets `baseURL: import.meta.env.BASE_URL` so asset paths resolve absolutely under any URL depth.
- **Control points overlay (key `5`).** When the track JSON includes a `controlPoints: [{x, y, label?}]` array, the inspector renders a magenta marker per point. Text is only drawn for points that supply an explicit `label` — index-only points stay clean. Today only Champions' Wall emits them (the spline is built from explicit Catmull-Rom controls); formula-driven tracks omit the field and the toggle is a no-op for them.
- **Toggle persistence.** All five toggle states (1 points / 2 checkpoints / 3 racing line / 4 reference / 5 control points) are read from `localStorage[f1re.inspect.toggles]` in `init()` and written on every flip. Storage failures (private mode, quota) fall back to defaults silently.

### Touch controls (race)
- `src/ui/TouchControls.ts` mirrors the `Hud` pattern: scene-local view module, exposes `objects` so `RaceScene` wires the two-camera ignore lists in one place.
- Activation: `isTouchDevice()` checks `'ontouchstart' in window`, `navigator.maxTouchPoints`, and `(pointer: coarse)`. When false, the module is dormant — no graphics added, no input registered.
- Pads: bottom-left ◀ ▶ (steer), bottom-right vertical stack ★ item / ▼ brake / ▲ throttle. Semi-transparent dark fill, white stroke; alpha bumps when pressed.
- Multi-touch: `RaceScene` calls `input.addPointer(3)` (5 total). Each frame `TouchControls.update()` walks `input.manager.pointers`, hit-tests each active pointer against every zone (circle test), and sets per-zone booleans. Item is edge-triggered (rising-edge consumed by `consumeUseItem()`).
- Input combine: `runRacing` ORs keyboard + touch state per axis so hybrid devices work. ESC/R remain keyboard-only for now.
- Landscape gate: pure CSS media query in `index.html` swaps `#game` for a `#rotate-prompt` overlay when `(pointer: coarse)` AND (orientation: portrait OR width<700 OR height<360).

### Camera polish (race)
- World camera zoom dropped from 0.9 → 0.85 for a wider preview of the upcoming track.
- Velocity look-ahead via `cameras.main.setFollowOffset(-vx*k, -vy*k)` per racing frame, with `k = 0.35` and a `±220` clamp so spin doesn't whip the camera. Phaser's existing 0.12 lerp on `startFollow` smooths the offset transition.
- Two-camera split applied in `RaceScene` (mirrors the inspector pattern): a dedicated `uiCam` renders only HUD elements; the world camera ignores them. HUD elements no longer scale with world zoom.
- `Hud` exposes its game objects via `hud.objects` so the scene can wire the ignore lists in one place.
- Runtime-spawned world graphics (`fireMissile`, `dropOil`) call `uiCam.ignore(g)` at creation so the UI camera stays HUD-only.

## Architecture Decisions
- **Two-camera split is the pattern for any UI that must not scale with world zoom.** Applied to InspectScene and RaceScene. The `Hud` and `TouchControls` classes own an `objects` array so the scene can wire main/UI camera ignore lists in one place; runtime-spawned world graphics opt out of the UI cam at creation.
- **Touch detection happens once per scene create.** `TouchControls.active` is set in the constructor from `isTouchDevice()` and never recomputed. A device that toggles input mode mid-race is unsupported (extremely rare; would just need a scene restart).
- **Camera follow uses `setFollowOffset` for velocity look-ahead** rather than a custom follower. Phaser's lerp smooths the per-frame offset jumps, so a clamp on the offset is sufficient to prevent whip during spin.
- **The `Hud` is purely a view of game state.** It never owns gameplay state, never decides race outcomes; it only reflects what the scene tells it.

## Open Questions
- **R restart guard** — R restarts immediately when the results panel is showing. No "hold to confirm". Is that fine or should it confirm?
- **Look-ahead tuning** — `k = 0.35`, clamp `±220`, zoom `0.85`. Should be felt in real driving on each track; numbers may want a per-track or speed-curve tweak (e.g., non-linear scaling so it's gentle at low speed and stronger at top speed).
- **UI cam resize** — `uiCam` is created at the current `scale.width`/`scale.height` and is not re-sized on window resize. Acceptable for now; revisit if the canvas can resize in normal play.

## Next Up
- None planned.
