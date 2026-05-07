# AI Driving

How the AI cars drive.

## Completed
- Pure-pursuit centerline following: each AI picks a centerline point a few ahead and steers toward it.
- AI brakes scaled by speed when the angle delta to the target is high (`wantSlow` triggers throttle 0.4 + brake 0.3).
- 3 AI cars per race (player + 3 others), each with `maxSpeed` jittered to ~85–95% of `DEFAULT_CAR.maxSpeed` so they're not all identical.

## Open Questions
- AI follows the centerline strictly; no racing-line offset. Tracks with sharp corners have AI hugging the inside instead of using a wide line.
- AI uses items on a random 1–5s delay after pickup, not based on tactical opportunity.

## Next Up
- **Better AI** — racing-line offset (not pure centerline), corner brake-points, item awareness.
