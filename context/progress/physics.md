# Physics + Collisions + Lap Tracking

Driving model, collisions, race-flow timing.

## Completed

### Driving model
- Top-down arcade physics: throttle, brake, steer, grip, drag, boost, spin, shield.
- Per-frame surface feel: `RaceScene.surfaceFeel(car)` reads the surface under each of the 4 corners and passes `{ drag, gripFactor }` to `car.update`. Both `drag` and `gripFactor` are **averaged** across the 4 corners — penalties scale linearly with corner count (1 corner on grass → 25% of grass's penalty, 2 → 50%, 4 → 100%).
- **Subtle slipstream/draft.** `Car.draft` (default 1.0) multiplies accel and max speed. `RaceScene.computeDraft(car)` runs each frame: a chasing car within 20–110u behind a leader, ≤22u lateral, with heading dot ≥ 0.7, and speed ≥ 60 gets up to a +5% bump that ramps linearly with proximity and falls off with lateral offset. Tuned to be felt only on long straights when actually tucked into another car's wake.

### Grip-recovery model
- `Car.gripFactor` ∈ [0..1] is a persistent multiplier on the car's traction. It scales **lateral grip, throttle accel, and brake force** together — same factor on all three, since the underlying physical limit is tire-to-surface friction in every direction. Final lateral exponent = `BASE_GRIP (4.0) × cfg.grip × car.gripFactor`; throttle and brake are multiplied by `gripFactor` directly.
- Each frame in `Car.update`, surface feel acts as an **instantaneous floor**: if `feel.gripFactor < car.gripFactor` it snaps down. Otherwise it recovers linearly toward 1.0 at `dt / GRIP_RECOVERY_SEC` (1.0 s full-recovery time).
- `Car.requestGripPenalty(target)` is the public hook for any system to depress grip with the same recovery curve (e.g. wall hits, oil-edge clip, off-track recovery flair). Penalties only stack downward — calling with a higher target is a no-op.
- Surfaces tune `SurfaceParams.gripFactor` rather than absolute grip values: asphalt 1.00, grass 0.15, gravel 0.25. Drag stays instantaneous (no recovery). Grass: drag 1.2 (slight slowdown), gripFactor 0.15 (massive handling + accel + brake hit, recovers over 1 s).

### Collisions
- OBB wall collision: corner-sampled push-back (4 corners; the worst-overflow normal is used).
- OBB car-vs-car via SAT: 2 axes per car, MTV separation, impulse along normal (coefficient 0.8). Bounding-circle broad-phase.

### Lap tracking
- Lap completion fires on CP0 cross (the actual finish line), not on the previous checkpoint.
- `nextCheckpoint = 1` set at GO so the start position doesn't double-count.
- Position progress formula: `lap × N + (nextCheckpoint - 1 + N) % N`.
- Checkpoint zone widened: `outsideHalf` and `insideHalf` based on `wallOffset` + 10 margin (was symmetric `width + 20`, which missed wide-runoff cars).

## Architecture Decisions
- **Surface affects grip via a recovering floor, not a per-frame value.** Earlier model passed `feel.grip` straight into the lateral exponent — leaving grass restored full grip on the next frame. The recovering-floor model gives a 1-second tail where the car slides after a corner-cut, and generalizes to any event that wants a transient grip drop (`Car.requestGripPenalty(target)`). Drag stays per-frame because slow-down on grass should feel immediate, not laggy.
- **OBB collision was deliberately chosen over circles** for both walls and car-vs-car. Cars aren't round; circles produced visibly wrong results. SAT for car-vs-car keeps the door open for varied car sizes later.
- **Lap counter increments on CP0 cross only.** Earlier code incremented on the *transition* away from CP(N-1) — that fired one segment-spacing before the actual finish line and was the cause of "race ends before the line" reports.
- **The countdown freezes physics-affecting input.** During `state === 'countdown'`, every car receives `NO_INPUT` and `applyTrackBounds` is not called.
- **Cars cannot leave the drivable area.** `applyTrackBounds` runs after every `car.update()` for every car, every frame, while the race is active.

## Open Questions
- None active.

## Next Up
- None planned.
