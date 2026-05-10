# DRS

Per-zone Drag Reduction System. Detection points evaluate gap; cars within a 1s window of the prior crosser get DRS for the next zone. Activation is auto (timed) or manual (button) per player; AI always uses auto with skill jitter.

## Completed

### Schema (TrackData.ts)
- Optional `drs?: { detections: number[], zones: { startIndex, endIndex }[] }` on `TrackData`. Detections and zones are independent: detections are the centerline indices where the gap is measured, zones are activation windows where DRS can deploy. Multiple zones can sit between two detections — eligibility granted at one detection persists through every zone until the next detection cross. No version bump (DRS is optional; v2 parser ignores tracks that omit it).

### Runtime gates (Track.ts)
- New `Gate` interface (perpendicular line across the track at a centerline index) shared by `CheckpointZone` and DRS gates. `Track.gateHit(gate, x, y)` is the shared band-test (≤30px tangentially, between outsideHalf/insideHalf normally).
- `track.drsDetections: DrsDetectionRuntime[]` — one entry per detection point with its `Gate` and centerline index.
- `track.drsZones: DrsZoneRuntime[]` — `start`/`end` Gates plus indices for inspector rendering.
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
- Gate edge detection: per car keeps three boolean arrays — `prevDetTouching`, `prevStartTouching`, `prevEndTouching` — sized to the per-track detection / zone counts. On `was-not-touching → is-touching` we fire the corresponding handler.
- **Detection cross**: append `{ car, t: now }` to the per-detection log. Look up most recent prior crosser at this detection (other than self). If gap ∈ (0, 1000ms] AND `drsEnabled`, set `Car.drsAvailable = true`; otherwise clear it. Lap counter is intentionally NOT consulted — the gap is a physical time-difference at the line, so a leader lapping a backmarker who crossed 0.5s ago is genuinely 0.5s behind at the line and gets DRS to pass. Each detection cross overwrites the eligibility flag wholesale — "stays available until next detection point".
- **Zone start**: if `car.drsAvailable`, mark `insideZoneIdx`. Auto mode → schedule activation `now + drsAutoActivationDelay(car)`. Manual → wait for `useDrs` press.
- **Zone end**: clear `drsActive` only. `drsAvailable` deliberately persists so a chaser who's already qualified at the previous detection keeps eligibility through every zone until the next detection re-evaluates the gap.
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
- `stadium.json`: two detections (idx 74 in top-left arc, idx 34 in bottom-right arc), two zones (top straight 0→5, bottom straight 40→45). Each detection feeds the next straight's zone; eligibility resets per detection. The grid sits at `startIndex=4` between zone 1's start (0) and end (5) gates; edge detection only fires on band-enter, so cars at rest at race start don't spuriously trigger.
- `champions-wall.json`: one shared detection (idx 145, halfway between T9 and T10) feeds two zones — Zone 1 (T12 → shortly before T13, idx 190→198) and Zone 2 (halfway WoC↔checker → shortly before T1, idx 215→17 wrapping). One gap measurement on the back-straight approach grants eligibility for both zones in that lap (Spa-style).
- `temple-of-speed.json`: two detections / two zones. Detection 188 (mid Inter-Lesmo short straight) feeds Zone 1 (idx 218→240, second half of post-Lesmo back-straight to pre-Ascari). Detection 311 (just before Parabolica entry) feeds Zone 2 (idx 20→48, second half of start/finish straight to pre-Variante del Rettifilo). Zones intentionally short — long Monza straights mean even ~22-unit DRS windows produce big speed gains; full-length zones over-favoured the chaser in playtests.

## Architecture Decisions
- **Detection logging is unconditional.** Pre-`drsEnabled` crossings still write to the log even though they can't grant DRS, so the first post-enable lap has prior records on the same `car.lap` to match against. Without this, the first detection cross post-enable would always come up empty.
- **Absolute time-difference at the line, lap counter ignored.** Originally tried filtering by `record.lap === chaser.lap` to keep gap calculations within the same lap, but that broke the spec wording ("gap of 1s or less" — independent of lap) and rejected legitimate scenarios like a leader lapping a backmarker right at the line. The honest reading is: most-recent prior crosser at this detection, full stop. If they're physically 0.5s ahead at the line, gap = 0.5s, regardless of laps. This also handles lap-1 detection crossings cleanly — they just become the prior records that lap-2 chasers compare against.
- **Lift cancels DRS but doesn't clear eligibility.** Once a chaser earns DRS at detection, dropping throttle mid-zone shuts off the effect but leaves `drsAvailable` set so manual mode can re-engage. Auto mode does NOT auto-rearm after a lift — only one auto-activation per zone entry, otherwise the user gets surprise DRS every time they touch the brake.
- **Effect bound to a `gate-enter` edge, not a centerline-index cursor.** Each car independently edge-detects all 3 gates of all zones every frame. Cheap (a few `gateHit` calls per car-frame), avoids the bookkeeping of "which zone is next for this car". Wrap-around and arbitrary zone counts are handled implicitly.
- **Track JSON owns DRS geometry; engine code owns the rules.** Same split as checkpoints / surfaces — adding or moving a zone never touches `RaceScene` or `Car`.

## Open Questions
- AI delay is the same constants on every track, regardless of how short the zone is. On very short zones (Stadium right/left straights are only ~150 units) a low-skill AI's 800ms delay could miss most of the zone. Tune per-track or cap at zone-length / typical-speed.
- The chaser-on-different-lap edge case (rare in 4-car arcade races) currently makes them ineligible silently. F1 uses position rather than lap matching — could revisit if races get long enough that lapping is common.
- Detection records grow unbounded over the race (small — ~1 per car per zone per lap, so ~36 records per zone over a 3-lap race with 4 cars). Trim to last N entries if races get long, but not needed at current scale.

## Next Up
- Add DRS data to `oval` if desired (single sweeping straight pair could map to one zone each).
- Per-track tuning of AI delay constants if zones differ wildly in length.

## Architecture Decisions (continued)
- **Detections and zones are independent first-class data, not 1:1.** Originally each zone owned its own `detectionIndex`. That worked for "one detection feeds one zone" and could be coerced into "one detection feeds N zones" by duplicating `detectionIndex` per zone in JSON, but it diverged from the spec ("DRS available until *next* detection point") whenever a detection window contained 3+ zones — the engine only granted DRS to zones that explicitly listed the matching detection. Refactored to top-level `detections: number[]` plus `zones: { startIndex, endIndex }[]` independently; eligibility is a single `Car.drsAvailable` boolean rewritten at every detection cross. Single-detection-per-zone tracks (Stadium) and shared-detection tracks (Champions' Wall) now both fall out of the same model with no JSON duplication.
