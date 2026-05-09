# Game Chrome — Menus, Overlays, Cars Sprite, Camera, Inspector

Everything outside the track + physics + items: the framing, the HUD, the menus, the post-race UI, the spectator tooling.

## Completed

### Engine + bootstrap
- Phaser 3 + TypeScript + Vite scaffold (port 5273 dev, 4273 preview).
- BootScene generates car + pickup textures procedurally.
- MenuScene split into two views: **main** (team carousel + track + START RACE + SETTINGS + INSPECT) and **settings** (DIFFICULTY / LAPS 1-10 / OPPONENTS 1-9 / PLAYERS 1-2 / NAME inputs / DRS modes / camera mode / DONE). `setView()` toggles visibility of `mainObjects` / `settingsObjects` arrays; ESC backs out of settings. Defaults: laps 3, opponents 5, players 1, name1 `PLAYER 1`, name2 `PLAYER 2`. Difficulty maps to `DIFFICULTIES` table (perfRange for accel/grip/maxSpeed, skillRange for AI aim quality); RaceScene reads the settings from init data.
- **Player name inputs.** A small in-canvas text input (`src/ui/TextInput.ts`) renders a clickable bg + monospace text + blinking caret. Click focuses; outside click / ENTER / ESC blurs (empty value falls back to default on blur). MenuScene routes a global `keydown` listener through both inputs (consumed events skip the menu hotkeys), and an `pointerdown` listener bounds-checks each focused input to detect outside clicks. Inputs are gated to `view==='settings'`; visibility/layout split (`NAME` centered in 1P, `P1 NAME` / `P2 NAME` flanking in 2P) lives in `applyPlayersLayout`. Allowed chars are `A-Z 0-9 space`; lowercase auto-uppercases; max length 8. Persisted alongside the rest of `MenuPrefs`.
- **Menu prefs persistence.** All seven menu selections (track, difficulty, P1 team, P2 team, laps, opponents, players) are stored in `localStorage["f1re.menu.prefs"]` via `src/scenes/MenuPrefs.ts`. `loadMenuPrefs()` runs at the top of `MenuScene.create()` *before* view-building so initial carousel/highlight state matches the loaded values. Every change site (carousel `onChange`, track / difficulty button click, all three counters) calls `savePrefs()` after mutating state, so the file is rewritten on every interaction. Loader validates each field against the live enums (`TRACK_KEYS`, `DIFFICULTIES_VALID`, `TEAMS`, range-clamped numbers, `1|2` for players) — unknown / removed values fall back to defaults instead of corrupting state. Input assignments (`f1re.input.assignments`) and DRS modes (`f1re.drs.mode`) keep their own keys; menu prefs deliberately don't subsume them so each domain stays self-contained.
- Camera is bounded to a fixed `CONTENT_HEIGHT` (800) so wheel events scroll the menu vertically when the viewport is shorter. The bottom hint text uses `setScrollFactor(0)` so it stays pinned at the viewport bottom.
- RaceScene state machine: countdown → racing → finished. ESC always returns to menu.

### Cars sprite
- F1-style open-wheel sprite (44×20): rounded chassis, 4 corner wheels with silver hubs, sidepods, cockpit + helmet, front + rear wings.
- **Two-tone livery + design variant.** Each car has a `{ primary, secondary, variant }` livery (raw hex). Variants: `nose` (secondary fills the nose cone), `sidepods` (top + bottom edge stripes on the chassis), `spine` (centerline stripe nose → engine cover), `wingtips` (secondary on the front + rear wing stripes).
- Textures generated lazily in `src/entities/CarSprite.ts`: `ensureCarTexture(scene, livery)` builds key `car_<primaryHex>_<secondaryHex>_<variant>` on first use and caches it. BootScene no longer pre-bakes per-color textures.

### Teams
- 11 teams in `src/entities/Team.ts`, each a 2026 F1 nod (`Scuderia Rosso`, `Silver Star`, `Rampage Racing`, `Papaya GP`, `Verde Sport`, `Alpha Bleu`, `Crown Royal`, `Forge Racing`, `Vorsprung Racing`, `Liberty Speed`, `Junior Bulls`). Each team owns `{ id, name, short, primary, secondary, drivers: [string, string] }`. `drivers` are two surname-style strings ≤ 8 chars each; the AI uses them directly so HUD/results show e.g. `WHITNEY`, `BAILEY` instead of the old 3-letter team code.
- AI cars draw teams from a shuffled pool capped at 2 per team (player counts toward the cap). The first AI on a team picks `drivers[0]`, the second picks `drivers[1]` — no numeric suffixes anymore. Player picks their team in the menu. Random `variant` per car.
- Opponent count: 1 – 9. With 11 teams × 2-per-cap (minus the player's team), the pool is always large enough to fill the grid.
- Menu uses a generic `src/ui/Carousel.ts` (single visible card, ‹/› arrows, `n / N` indicator) — designed to be reused for tracks once that list grows.

### Race flow + results
- **Grid lineup.** All cars (player included) start at staggered grid slots **before** the start/finish line. `RaceScene.startGridSlot(index)` walks `40 + index * 40` units back along the centerline from `startIndex` and offsets ±30 laterally on alternating sides. Player gets slot 0 (pole), AIs fill slots `1..opponentCount`. Geometry comes from `gridSlotBehindStart` so the lineup stays on-track even where the start straight curves.
- Race continues after the first car finishes; finished cars idle (`NO_INPUT`) but stay in the world.
- Lapped cars finish on the next CP0 crossing after the winner.
- Results overlay: compact bottom-right while the player is still racing → flips to a full center "RACE OVER" once the player finishes.
- Format: P1 absolute total time; P2..PN interval to the car ahead (`+s.cc` or `+m:ss.cc` for time, `+N LAP(S)` for lap-down).
- Best lap per car shown in full mode. Monospace font for column alignment. Panel auto-sizes to text.
- **AI naming uses per-team driver names.** Each `Team.drivers[2]` slot maps to one of the up-to-2 AI seats per team — no numeric suffixes. Player names come from the new settings inputs (default `PLAYER 1` / `PLAYER 2`). Both AI and player names cap at 8 chars; `showResults` pads the name column to 8, `Hud.setPositions` interpolates the name unpadded so longer names just shift the lap tag right. Position panel and results stay keyed off `Car` refs (`rankedCars()` is the single source); names are display-only.

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

### Local 2-player mode (experimental — `multiplayer-local` branch)
- Settings: `PLAYERS (LOCAL)` counter (1–2). When 2 is selected the main view splits the team carousel into `P1 TEAM` / `P2 TEAM` side-by-side; `MenuScene.applyPlayersLayout()` repositions both whenever `players` changes or the view re-enters main.
- `Car.playerIndex: number | null` — 0 / 1 for humans, null for AI. AI is unchanged. `RaceScene.humans: Car[]` holds the active humans; `RaceScene.player` remains an alias for `humans[0]` so single-player code paths stay short.
- AI grid offset bumps with human count (`startGridSlot(humans.length + i)`), so 2P starts AI in slots 2..N rather than overlapping P2.
- **Controls.** 1P keeps arrow keys + Space (unchanged). 2P splits: P1 = WASD + Space, P2 = arrow keys + Enter. Touch controls always feed P0 (sharing one phone is not worth supporting).
- **Pad identity by index, not just id.** Two physically identical controllers (e.g. two Switch Pro Controllers) report the *same* `Gamepad.id` string. The InputSource model identifies pads by `(padIndex, padId)`: `sourcesEqual` matches on `padIndex`; `resolvePad` looks up by index first and falls back to id-match for OS-level reslotting between sessions. Persistence stores both fields and rejects pre-`padIndex` saves so the user re-binds cleanly. Without this, P1's binding shadows every other pad with the same id, so press-to-join for P2 silently does nothing.
- **Camera.** 1P keeps `startFollow` + per-frame `setFollowOffset` look-ahead. 2P drops follow entirely — `updateRaceCamera()` lerps zoom + center each frame to fit both humans (or the surviving one) plus a 280px margin, clamped to `[0.35, 0.85]`. Lerp uses `cam.midPoint` to read current center; computing it from `scrollX + width / (2 * zoom)` is wrong because Phaser's `scrollX = midX - cam.width/2` (no zoom factor) — that bug caused the camera to drift away from the target instead of converging.
- **HUD.** `Hud(scene, side: 'left' | 'right')`. Left HUD always exists and owns the shared overlays (countdown, results, position panel, broadcast slot). Right HUD only exists in 2P and shows P2's stats mirrored to the right edge. `Hud.update(multi)` flips the position panel to bottom-center in 2P so it doesn't collide with the P2 stats column. Per-player flashes (`BOOST!`, `MISSILE!`, `BLOCKED!`, `PERSONAL BEST`) route via `flashFor(car, ...)` keyed off `car.playerIndex` and render in each HUD's own `msgText` (offset to either side of center in 2P). Session-wide broadcasts (`FASTEST LAP <name>`, `DRS ENABLED`) route via `flashAll(...)` → `Hud.broadcast(...)`, which writes to a dedicated `broadcastText` owned only by the left HUD and rendered once at screen center (y ≈ 56, above the per-player flash slot at y=100). Before this split, broadcasts called `hud.flash` on both sides and showed up duplicated in 2P.
- **Missile targeting** changed from `ownerIsPlayer` boolean to a direct `owner: Car` ref. Missiles lock onto any non-owner car within range — humans can shoot each other in 2P (intentional).
- **Results.** Compact panel stays up while *any* human is still racing; flips to full `RACE OVER` only when all humans have finished. AI-only finishing doesn't trigger the full overlay anymore.
- **Audio.** Both humans are registered as bus listeners; each source's gain is averaged 50/50 across them (`AudioBus.setListeners`). A sound right next to one player still drops to ~0.5 in 2P — intentional, so neither player loses spatial awareness when the field splits.
- **Open question.** P1/P2 humans share their team's livery; the position panel reads e.g. `P3 P1 L2` which is mildly confusing because the position prefix and the player name both lead with "P". Could rename humans to `Y1`/`Y2` or use the team short code if it gets reported as a problem.

### Cockpit camera (1P-only, opt-in via settings)
- Settings row "CAMERA (1P ONLY)" with TOP-DOWN / COCKPIT toggle (`MenuScene.makeCockpitCamPicker`). Visible only when `players === 1`. Persisted in `MenuPrefs.cockpitCam` (default false).
- When enabled and `humans.length === 1`, `RaceScene.updateRaceCamera` skips the look-ahead `setFollowOffset` path and instead lerps `cam.setRotation` toward `-player.heading - π/2` so the player's heading always points up on screen. `cam.startFollow` still keeps the player centered; only rotation is custom.
- Lerp coefficient `dt * 4` (~0.25s time constant). Rubber-band feel was tuned away from `dt * 8` (felt nausea-inducing) and `dt * 3` (felt sluggish).
- **Spin disconnect.** While `player.spinTimer > 0` the rotation update is skipped — the camera holds its last pre-spin angle so missile/oil hits visibly spin the *car* on screen instead of dragging the world along. The lerp re-acquires the new heading on recovery.
- **Grid alignment.** `RaceScene.create` writes the rotation to its target value before the countdown so the player sees the world already aligned during "3 / 2 / 1 / GO".
- 2P forces `cockpitCam = false` even if the pref is on (gated in `RaceScene.init` and the `start()` payload). Split-screen rotated cameras are a follow-up design problem.
- HUD lives on `uiCam` so it stays screen-locked. Particles, skid marks, and runtime-spawned world graphics all live on the main camera and rotate with the scene.

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
