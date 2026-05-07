# AI Driving

How the AI cars drive.

## Completed
- Racing-line following (replaces strict centerline): each `Track` runs an iterative minimum-curvature solver at construction (200 iters of Laplacian relaxation in lateral-offset space, 22px wall margin) and exposes `racingLine: TrackPoint[]` + `racingLineOffsets: number[]`. AI's pure-pursuit aim point is the racing-line index, not the centerline. Skill aim-offset still stacks on top.
- **Per-track overrides** via optional `racingLineOverrides.hints: { index, offset, strength? }[]` in track JSON. Hints act as soft constraints inside the solver loop (`(1 - strength) × unconstrained + strength × hint.offset`, clamped to corridor). Positive offset = inside (toward loop centroid). No track currently authors hints.
- **Inspector toggle `3`** renders the racing line as a cyan polyline + faint arrows from each centerline point to its racing-line offset. Useful for spotting corners that need hints.
- Pure-pursuit aim with lookahead 4 along centerline indices (still indexed by closest centerline point to the AI).
- AI brakes scaled by speed when the angle delta to the target is high (`wantSlow` triggers throttle 0.4 + brake 0.3).
- 3 AI cars per race (player + 3 others). At race start each gets independent multipliers in `[0.92, 1.02]` on `maxSpeed`, `accel`, and `grip` (≈ ±5%, subtle). `cfg.grip` is a multiplier on `feel.grip`; baseline = 1.0 (player unchanged).
- Per-AI skill (∈ [0.4, 1.0], assigned at race start, internal-only). Skill drives a perpendicular aim offset off the centerline target: max offset = halfWidth × (0.05 + (1 − skill) × 0.5), sampled with a triangular distribution (biased toward 0), random sign. Offset is held for one ~6-point centerline chunk before resampling, so deviations look like a line drift rather than jitter. State lives in `RaceScene.aiSkill` (Map keyed by Car).

## Open Questions
- Racing line is *geometric* (minimum curvature), not *speed-optimal* (no late-apex bias for long straights). Probably fine for arcade, revisit if it feels off.
- Hint indices are tied to centerline point indices and shift if `gen-tracks.mjs` regenerates the centerline. Hand-authored tracks (current state) — not a problem yet.
- On continuously curved tracks (e.g., Oval), the geometric line collapses toward the inside wall along the entire loop. Expected behaviour but may want a per-track override mechanism for "minimum offset deviation" if it looks bad.
- AI uses items on a random 1–5s delay after pickup, not based on tactical opportunity.

## Next Up
- **Better AI** — racing-line offset (not pure centerline), corner brake-points (skill should also modulate brake point timing/jitter), item awareness.
