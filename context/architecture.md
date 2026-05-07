# Architecture Context

## Stack

| Layer       | Technology                       | Role                                                    |
| ----------- | -------------------------------- | ------------------------------------------------------- |
| Game engine | Phaser 3.80                      | Scene graph, render loop, input, scaling, asset loader  |
| Language    | TypeScript 5 (strict)            | All game code, type-safe scene/entity contracts         |
| Bundler     | Vite 5                           | Dev server (port 5273), production build, static output |
| Runtime     | Node 22 (build), browser (run)   | Build + serve only; gameplay runs entirely client-side  |
| Track data  | JSON in `public/tracks/`         | Source of truth for track geometry + surfaces           |
| Track gen   | `scripts/gen-tracks.mjs`         | One-off Node script that writes track JSON files        |
| Hosting     | Any static host (file/CDN)       | No backend; `dist/` is fully self-contained             |

## System Boundaries

- `src/main.ts` — game bootstrap: Phaser config, scene registration, exposes `window.__game` for debugging.
- `src/scenes/BootScene.ts` — runs once: procedurally generates car + pickup textures, transitions to `MenuScene`.
- `src/scenes/MenuScene.ts` — title, car select, track select, START / INSPECT buttons. Owns the `TrackKey` and `CarColor` unions and the `TRACKS` list.
- `src/scenes/RaceScene.ts` — owns the race: countdown → racing → finished state machine, player input, AI driving, pickups, weapons, lap tracking, OBB collisions, results overlay. Reads track JSON from cache, builds the `Track`, drives `Car` instances each frame. Uses a two-camera split: world camera at zoom 0.85 follows the player with velocity look-ahead via `setFollowOffset`; `uiCam` renders only `Hud.objects`. Runtime-spawned world graphics (missiles, oil) call `uiCam.ignore(g)` at creation.
- `src/scenes/InspectScene.ts` — read-only track viewer: two-camera split (world + UI), pan/zoom, point + checkpoint overlays.
- `src/entities/Track.ts` — track rendering (concentric runoff bands, wall stripes, white edge lines, apex kerbs, dashes, start stripe), centerline probe with side + nearest-index, surface lookup, wall offsets (per-point when supplied), checkpoint geometry. `offsetLoopVarying(side)` builds the runoff outer edge using per-point widths; `offsetLoop(offset)` is still used for asphalt-edge geometry where width is uniform.
- `src/entities/TrackData.ts` — JSON schema (versions 1 & 2), parser/validator (`parseTrackData`), surface catalog (`SURFACE_PARAMS`). `RunoffSide.width` accepts either a number (uniform along the loop) or a number array (per-centerline-point widths; values wrap if shorter).
- `src/entities/Car.ts` — car physics (throttle, brake, steer, grip, drag, boost, spin, shield), OBB corner geometry, sprite + heading. Owns a `shieldRing` Graphics that's drawn each frame whenever `shielded = true`. `spin()` returns `false` when the hit was absorbed by the shield.
- `src/ui/Hud.ts` — scene-local HUD: speed/lap/time/best/item readouts, position panel, countdown, message flash, results overlay (compact corner mode + full center mode). Exposes `objects: GameObject[]` so the host scene can wire two-camera ignore lists in one place.
- `src/types.ts` — small shared types (`CarConfig`, `Vec2`, etc.).
- `public/tracks/*.json` — track data files, loaded via Phaser's JSON loader at scene start.
- `scripts/gen-tracks.mjs` — one-off Node script that procedurally generates the 3 track JSONs from formulas; never run by the game.

## Storage Model

- **In-memory only at runtime.** No persistence between sessions, no localStorage.
- **Track JSON** in `public/tracks/`: source of truth for geometry, surfaces, runoff, patches. Loaded by Phaser's JSON cache, parsed by `parseTrackData`, instantiated as `Track`.
- **Procedural textures** generated in `BootScene.preload` (cars, pickups). Live in Phaser's texture cache.
- **No external assets** today. No images, no audio, no fonts beyond `system-ui` / `ui-monospace`.

## Auth and Access Model

- No auth, no users, no network. The game is fully client-side.
- "Player" means whoever has the keyboard. Single seat.

## Game Loop Model

- Phaser owns the requestAnimationFrame loop (`type: Phaser.AUTO`).
- Each scene's `update(time, deltaMs)` runs once per frame at vsync.
- `RaceScene.update` dispatches to one of two paths based on `state`:
  - `countdown`: ticks the countdown HUD; cars get `NO_INPUT`; no physics-affecting work.
  - `racing` / post-finish: per-frame physics, AI, item ticks, pickups, missile/oil sims, lap tracking, OBB collision resolution, race-end check, HUD update.
- ESC and R are checked at the top of `update`, regardless of state.

## Surface System

- Surfaces are an enum: `asphalt | grass | gravel`.
- `SURFACE_PARAMS[surface]` returns `{ drag, grip, color }`.
- Per-track default runoff `runoff: { outside: { surface, width }, inside: { surface, width } }` defines the wall offset per side: `wall = asphaltHalf + runoff.width`.
- Polygon patches (`patches: [{ surface, polygon }]`) override the default surface inside their polygon, but **do not** change wall position.
- Each frame, `RaceScene.surfaceFeel(car)` samples surface at all 4 OBB corners and averages drag + grip; the result is passed into `Car.update`.

## OBB Collision Model

- Each `Car` has `halfLength = 18`, `halfWidth = 9` and computes 4 world-space corners per query via `corners()`.
- Wall: `applyTrackBounds` probes each corner, finds the worst-penetrating one beyond `wallOffset(side)`, pushes the car back along that normal, reflects velocity (restitution 0.35, tangential scrub 0.9).
- Car-vs-car: `obbOverlap(a, b)` runs SAT on 4 axes (2 per car), returns minimum-translation vector + normal. Cars are split 50/50 along MTV; impulse along normal (coefficient 0.8). Broad-phase: bounding-circle pre-check.

## Lap Tracking Model

- Each car tracks `lap`, `nextCheckpoint`, `currentLapStartMs`, `bestLapMs`, `finishedAtMs`.
- At GO, all cars get `nextCheckpoint = 1` (they're standing on CP0; the start counts as already-crossed).
- A `cp.checkpointHit(car.x, car.y)` trigger advances `nextCheckpoint`; only when the *just-hit* checkpoint was CP0 does `lap++` fire.
- Race ends for a car when `lap >= TOTAL_LAPS` OR another car has already finished (lapped cars finish on next CP0 cross).
- Race scene ends (`state = 'finished'`) only when all cars have finished.

## Invariants

1. **Track JSON is the source of truth for geometry and surfaces.** No track shape, runoff width, or surface decision lives in code; engine code reads `Track` instances built from validated JSON.
2. **Physics is deterministic per frame given inputs.** `Car.update(dt, input, feel)` has no random behavior, no time-of-day branching. Randomness lives in pickup spawn, item assignment, AI item-use timer.
3. **The countdown freezes physics-affecting input.** During `state === 'countdown'`, every car receives `NO_INPUT` and `applyTrackBounds` is not called.
4. **Lap counter increments only on a CP0 crossing.** Never on any other checkpoint, never on time elapsed, never on distance.
5. **Cars cannot leave the drivable area.** `applyTrackBounds` runs after every `car.update()` for every car, every frame, while the race is active.
6. **Adding a track is data, not code.** New tracks are JSON files in `public/tracks/` + an entry in `MenuScene.TRACKS`. The engine has no track-specific code paths.
7. **One scene owns the gameplay state at a time.** Cross-scene state passes via `scene.start(key, data)` and `init(data)`. Don't reach into another scene's instance from outside.
8. **The `Hud` is purely a view of game state.** It never owns gameplay state, never decides race outcomes; it only reflects what the scene tells it.
9. **`window.__game` is for debugging only.** Production code paths must not depend on it.
