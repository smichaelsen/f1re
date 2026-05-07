# Physics + Collisions + Lap Tracking

Driving model, collisions, race-flow timing.

## Completed

### Driving model
- Top-down arcade physics: throttle, brake, steer, grip, drag, boost, spin, shield.
- Per-frame surface feel: `RaceScene.surfaceFeel(car)` averages the surface under each of the 4 corners and passes `{ drag, grip }` to `car.update`.
- **Subtle slipstream/draft.** `Car.draft` (default 1.0) multiplies accel and max speed. `RaceScene.computeDraft(car)` runs each frame: a chasing car within 20–110u behind a leader, ≤22u lateral, with heading dot ≥ 0.7, and speed ≥ 60 gets up to a +5% bump that ramps linearly with proximity and falls off with lateral offset. Tuned to be felt only on long straights when actually tucked into another car's wake.

### Collisions
- OBB wall collision: corner-sampled push-back (4 corners; the worst-overflow normal is used).
- OBB car-vs-car via SAT: 2 axes per car, MTV separation, impulse along normal (coefficient 0.8). Bounding-circle broad-phase.

### Lap tracking
- Lap completion fires on CP0 cross (the actual finish line), not on the previous checkpoint.
- `nextCheckpoint = 1` set at GO so the start position doesn't double-count.
- Position progress formula: `lap × N + (nextCheckpoint - 1 + N) % N`.
- Checkpoint zone widened: `outsideHalf` and `insideHalf` based on `wallOffset` + 10 margin (was symmetric `width + 20`, which missed wide-runoff cars).

## Architecture Decisions
- **OBB collision was deliberately chosen over circles** for both walls and car-vs-car. Cars aren't round; circles produced visibly wrong results. SAT for car-vs-car keeps the door open for varied car sizes later.
- **Lap counter increments on CP0 cross only.** Earlier code incremented on the *transition* away from CP(N-1) — that fired one segment-spacing before the actual finish line and was the cause of "race ends before the line" reports.
- **The countdown freezes physics-affecting input.** During `state === 'countdown'`, every car receives `NO_INPUT` and `applyTrackBounds` is not called.
- **Cars cannot leave the drivable area.** `applyTrackBounds` runs after every `car.update()` for every car, every frame, while the race is active.

## Open Questions
- None active.

## Next Up
- None planned.
