# DRS

Per-zone Drag Reduction System. Detection points evaluate gap; cars within a 1s window of the prior crosser get DRS for the next zone. Activation is auto (timed) or manual (button) per player; AI always uses auto with skill jitter.

## Completed

### Schema (TrackData.ts)
- Optional `drs?: { zones: { detectionIndex, startIndex, endIndex }[] }` on `TrackData`. All three are centerline indices. Validation requires `detectionIndex !== startIndex` and `endIndex` to come after `startIndex` along the loop direction (computed via arc distance from `detectionIndex`, so wrap-around zones are valid). No version bump — DRS is optional and the v2 parser ignores tracks that omit it.

### Runtime gates (Track.ts)
- New `Gate` interface (perpendicular line across the track at a centerline index) shared by `CheckpointZone` and DRS gates. `Track.gateHit(gate, x, y)` is the shared band-test (≤30px tangentially, between outsideHalf/insideHalf normally).
- `track.drsZones: DrsZoneRuntime[]` — each entry exposes `detection`, `start`, `end` Gates plus the source indices for inspector rendering.
- `Track.makeGate(idx, label)` builds a Gate from a centerline index with the same outside/inside half-widths used by checkpoints.

### Car effect (Car.ts)
- `Car.drsAvailable` (eligible for activation in current zone) and `Car.drsActive` (effect on now). RaceScene owns the state machine; Car only renders the effect.
- `DRS_TOP_SPEED_MULT = 1.06` raises max-speed cap; `DRS_DRAG_MULT = 0.88` reduces drag by 12%. Tuned subtle: DRS is meant to feel like a trailing chase advantage, not a second boost item — the earlier 1.15× / 0.70× tune dominated races. Still stacks with item boost (1.6×).

### Input bindings (InputSource.ts + DrsMode.ts)
- New `CarInput.useDrs: boolean` (press-edge pulse). Keyboard schemes: arrows → SHIFT, WASD → Q. Phaser KeyCodes don't expose left/right shift separately, so the per-scheme split uses Q (left of WASD, P1 reach) and SHIFT (P2 reach) which don't collide. Gamepad: button 5 (R shoulder / RB / Switch R), with per-pad press-edge tracking like the existing east-button item key.
- `1P readAuto` accepts both Q and SHIFT so single-player keyboard users get both bindings.
- Per-player auto/manual mode persisted as `f1re.drs.mode` in localStorage. Defaults: `{ p1: "auto", p2: "auto" }`.

### Engine (RaceScene.ts)
- Per-frame, per-active-car: `updateDrsForCar(car, input, now)` runs after `car.update + applyTrackBounds`.
- Gate edge detection: per car keeps `prevTouching: boolean[]` indexed `zoneIdx*3 + (0|1|2)`. On `was-not-touching → is-touching` we fire one of three handlers.
- **Detection cross**: append `{ car, t: now, lap: car.lap }` to the per-zone log. Look up most recent prior crosser of *same zone, same lap, different car*. If gap ∈ (0, 1000ms] AND `drsEnabled`, set `drsAvailable = true` for that zone. Lap matching prevents lapped/lapping cars from contaminating the gap.
- **Zone start**: if `drsAvailable && availableForZoneIdx === zoneIdx`, mark `insideZoneIdx`. Auto mode → schedule activation `now + drsAutoActivationDelay(car)`. Manual → wait for `useDrs` press.
- **Zone end**: clear all DRS state for this car (active/available/scheduled/insideZoneIdx).
- Activation timer fires when `now >= scheduledActivateAt`. Manual press sets `drsActive = true` directly inside zone. Lift-cancel: `throttle === 0 || brake > 0` clears `drsActive` (without clearing eligibility — manual press can re-arm in the same zone).
- AI auto-delay: `200 + (1-skill)*600 + uniform(-200, +200)` ms. Higher skill → faster reaction, with some jitter so AI cars don't all activate simultaneously.

### Scene-wide enable
- `drsEnabled` flips to true the first time any car's `lap` counter reaches 1 (i.e. leader completes lap 1). One-shot `flashAll("DRS ENABLED")` broadcast on all human HUDs at the same moment. Skipped entirely on tracks without DRS data so the flash isn't shown for nothing.
- Detection crossings before enable are still logged so first post-enable lookups have prior records to match against.

### HUD (Hud.ts)
- New `drsText` slot below `itemText`. Three states: off (empty), available (`"DRS  <key> to deploy"` in cyan, or `"DRS  auto"` in auto mode), active (`"DRS ACTIVE"` in bright cyan).
- Position labels: P1 hint shows `Q` (WASD scheme companion to SPACE-item), P2 shows `SHIFT` (arrows scheme companion to ENTER-item). 1P uses Q label since `readAuto` accepts both.

### Settings UI (MenuScene.ts)
- New "DRS — P1" / "DRS — P2" toggle rows below PLAYERS counter in the settings view. Two-button auto/manual picker per player; same selected-state highlighting as the difficulty buttons. P2 row hidden in 1P. `CONTENT_HEIGHT` bumped to 1080 for the extra rows. Selection persists via `saveDrsModes` on click; passed to `RaceScene` via init data on race start.

### Inspector overlay (InspectScene.ts)
- New persisted toggle `showDrs` (key `6`). Renders the cyan zone span as an 8px stroke along the centerline from `startIndex` to `endIndex` (wraps), magenta detection gate, cyan start/end gates, and labels `D{n}` / `DRS{n}`.

### Visual feedback (DrsAirflow.ts)
- Wavy "~" particle (10px tilde glyph generated once via `Graphics.generateTexture`) emitted once per frame at the car's rear OBB face while `drsActive` AND `speed >= 260`. Sides alternate per frame (parity toggle) so the trail reads as twin streaks without doubling per-frame particle count. Direction = car's reverse heading with ±11° spread; per-particle rotation matches direction so the squiggle aligns with airflow. Subtle scale (0.55→0.25) and alpha (0.35→0) so the effect hints at slipstream rather than dominating the frame.

### Sample data
- `stadium.json` ships with two DRS zones — top straight (det=74, start=0, end=5) and bottom straight (det=34, start=40, end=45). The other tracks are DRS-less for now. The grid sits at `startIndex=4` between zone 1's start (0) and end (5) gates; edge detection only fires on band-enter, so cars at rest at race start don't spuriously trigger.

## Architecture Decisions
- **Detection logging is unconditional.** Pre-`drsEnabled` crossings still write to the log even though they can't grant DRS, so the first post-enable lap has prior records on the same `car.lap` to match against. Without this, the first detection cross post-enable would always come up empty.
- **Lap matching, not absolute time matching.** The "most recent prior crosser" lookup filters by `record.lap === chaser.lap`. A leader's lap-2 crossing being more recent than a chaser's lap-1 crossing is not a 1s gap — it's nearly a full lap. Same-lap matching is the only honest definition of "gap to car ahead at the detection line".
- **Lift cancels DRS but doesn't clear eligibility.** Once a chaser earns DRS at detection, dropping throttle mid-zone shuts off the effect but leaves `drsAvailable` set so manual mode can re-engage. Auto mode does NOT auto-rearm after a lift — only one auto-activation per zone entry, otherwise the user gets surprise DRS every time they touch the brake.
- **Effect bound to a `gate-enter` edge, not a centerline-index cursor.** Each car independently edge-detects all 3 gates of all zones every frame. Cheap (a few `gateHit` calls per car-frame), avoids the bookkeeping of "which zone is next for this car". Wrap-around and arbitrary zone counts are handled implicitly.
- **Track JSON owns DRS geometry; engine code owns the rules.** Same split as checkpoints / surfaces — adding or moving a zone never touches `RaceScene` or `Car`.

## Open Questions
- AI delay is the same constants on every track, regardless of how short the zone is. On very short zones (Stadium right/left straights are only ~150 units) a low-skill AI's 800ms delay could miss most of the zone. Tune per-track or cap at zone-length / typical-speed.
- The chaser-on-different-lap edge case (rare in 4-car arcade races) currently makes them ineligible silently. F1 uses position rather than lap matching — could revisit if races get long enough that lapping is common.
- Detection records grow unbounded over the race (small — ~1 per car per zone per lap, so ~36 records per zone over a 3-lap race with 4 cars). Trim to last N entries if races get long, but not needed at current scale.

## Next Up
- Add DRS data to `temple-of-speed` (Monza-shaped — 3 long straights would map nicely).
- Per-track tuning of AI delay constants if zones differ wildly in length.
