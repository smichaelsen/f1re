# Code Standards

## General

- Keep modules small and single-purpose. A scene file owns its scene; an entity file owns one entity type; a UI file owns one UI surface.
- Fix root causes, do not layer workarounds. If a checkpoint trigger is too narrow, widen the check — don't sprinkle special cases at call sites.
- Don't combine unrelated system boundaries in one change. Track-rendering changes don't belong in the same edit as lap-tracking logic.
- Default to no comments. Add one only when the *why* is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug.
- Don't write code for hypothetical future features. Build what the spec asks for.
- No backwards-compatibility shims for things that were never released. Just change the code.

## TypeScript

- Strict mode is required (`"strict": true` in `tsconfig.json`). Don't relax it.
- Avoid `any`. Prefer narrow interfaces (`CarInput`, `SurfaceFeel`, `TrackData`, `ProbeResult`).
- Validate unknown external input at the boundary. JSON loaded from disk is validated by `parseTrackData` before being trusted; nothing else parses raw track data.
- Re-export shared types from the file that owns them (e.g., `Track.ts` re-exports `TrackPoint` from `TrackData.ts`).
- Use union literal types for finite domains (`CarColor`, `TrackKey`, `Surface`, `RaceState`).
- `TaskCreate`-style runtime constants (`ITEMS`, `ALL_COLORS`) live as `const` arrays at module top; their type is derived (`(typeof ITEMS)[number]`).

## Phaser Conventions

- One `Phaser.Scene` subclass per file in `src/scenes/`. The constructor calls `super("SceneKey")` with a stable string key.
- Scene lifecycle order: `init(data)` (read params from `scene.start`), `preload()` (load assets), `create()` (build world), `update(time, deltaMs)` (per-frame).
- Reset all scene-level mutable state at the top of `create()` so `scene.restart()` and `scene.start(key, data)` don't accumulate ghost state.
- Cross-scene state passes via `scene.start("Key", data)` and is read in `init(data)`. Don't reach into another scene's instance from outside.
- Always use Phaser's loader (`this.load.json`, etc.) to fetch external resources. Never `fetch()` directly.
- Use `Phaser.Math` helpers (`Clamp`, `Distance.Between`, `Angle.Wrap`, `FloatBetween`, `Between`) where they fit; don't reimplement.
- `Phaser.Input.Keyboard.JustDown(key)` for one-shot key edges; `cursors.up?.isDown` for held-input polling.

## Game Loop and Physics

- Pass `dt = deltaMs / 1000` (seconds) into entity `update(dt, ...)` methods. Never use raw `deltaMs` for physics math.
- Physics integration is explicit Euler. Drag and grip are exponential decays (`Math.exp(-k * dt)`), never linear-per-frame.
- Velocity update first, position update last (`sprite.x += vx * dt`).
- Wall and car-vs-car collision resolution runs **after** `car.update(dt, ...)`, every frame, for every car, while the race is active.
- Surface lookup (`surfaceFeel`) reads the current world state to compute `{ drag, grip }`; inject it into `car.update` rather than letting the car probe the world itself.

## Track Data

- All track shape and surface decisions live in JSON under `public/tracks/`. Engine code never embeds track-specific values.
- The `parseTrackData` validator must accept all known versions and reject malformed input with a descriptive `TrackDataError`.
- Versions: bump `version` when the schema gains required fields. Keep older versions parseable by defaulting new fields.
- Surface params (`drag`, `grip`, `color`) live centrally in `SURFACE_PARAMS`, not at call sites.

## File Organization

- `src/main.ts` — game bootstrap only.
- `src/scenes/` — one file per Phaser scene. Scene-specific helpers can live alongside as private methods or local functions.
- `src/entities/` — gameplay objects (`Car`, `Track`) and their data (`TrackData`). No scene imports here.
- `src/ui/` — view-only HUD/UI surfaces that take state and render it.
- `src/types.ts` — small shared types only. Avoid letting it grow into a junk drawer; prefer co-locating types with their owning module.
- `public/` — static assets served as-is (track JSON, future images).
- `scripts/` — Node-only build/generate helpers, never imported by the game.

## Styling and Colours

- All canvas colours are 24-bit hex literals (`0xRRGGBB`). Alpha is a separate float arg.
- Surface colours come from `SURFACE_PARAMS`. World grass, walls, and track edge lines have named constants in `Track.ts`. One-off graphics (a single overlay tint) may use inline hex.
- HUD CSS-style colours (`#rrggbb`) are inline in `Phaser.Types.GameObjects.Text.TextStyle` objects. Reuse the `HUD_STYLE` / `LABEL_STYLE` patterns where one already exists.

## Error Handling

- Validate at boundaries (`parseTrackData`); trust internal invariants thereafter.
- Throw `TrackDataError` (or other named errors) with messages that name the problematic field. Don't return null/undefined for "bad input".
- Don't swallow errors with `try/catch { }`. If you catch, you do something with it.

## Naming

- Types and classes in PascalCase: `Car`, `Track`, `TrackData`, `RaceScene`, `SurfaceFeel`.
- Functions, methods, variables in camelCase: `surfaceAt`, `applyTrackBounds`, `nextCheckpoint`.
- Constants and enums in SCREAMING_SNAKE_CASE: `TOTAL_LAPS`, `SURFACE_PARAMS`, `WORLD_GRASS`, `ALL_COLORS`.
- File names match the dominant export: `Car.ts` exports `Car`; `Hud.ts` exports `Hud`.

## Build / Tooling

- `npm run dev` — Vite dev server on port 5273 (with hot reload).
- `npm run build` — `tsc` (type-check) then `vite build` (bundle to `dist/`).
- `npm run preview` — serves the production build on Vite's preview port.
- A change is "done" only when `npm run build` succeeds (type errors and bundling).
