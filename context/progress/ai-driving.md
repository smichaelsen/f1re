# AI Driving

How the AI cars drive.

## Completed
- Pure-pursuit centerline following: each AI picks a centerline point a few ahead and steers toward it.
- AI brakes scaled by speed when the angle delta to the target is high (`wantSlow` triggers throttle 0.4 + brake 0.3).
- 3 AI cars per race (player + 3 others). At race start each gets independent multipliers in `[0.92, 1.02]` on `maxSpeed`, `accel`, and `grip` (≈ ±5%, subtle). `cfg.grip` is a multiplier on `feel.grip`; baseline = 1.0 (player unchanged).
- Per-AI skill (∈ [0.4, 1.0], assigned at race start, internal-only). Skill drives a perpendicular aim offset off the centerline target: max offset = halfWidth × (0.05 + (1 − skill) × 0.5), sampled with a triangular distribution (biased toward 0), random sign. Offset is held for one ~6-point centerline chunk before resampling, so deviations look like a line drift rather than jitter. State lives in `RaceScene.aiSkill` (Map keyed by Car).

## Open Questions
- AI follows the centerline strictly; no racing-line offset. Tracks with sharp corners have AI hugging the inside instead of using a wide line.
- AI uses items on a random 1–5s delay after pickup, not based on tactical opportunity.

## Next Up
- **Better AI** — racing-line offset (not pure centerline), corner brake-points (skill should also modulate brake point timing/jitter), item awareness.
