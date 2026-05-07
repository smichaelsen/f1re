# Items + Pickups

## Completed

### Pickup boxes
- 8 pickups per track, 3.5s respawn after collection.
- Player triggers items via SPACE; AI triggers on a random 1–5s delay after pickup.
- Spinning AI keeps its `useItemAt` timer; `useItem` clears both `itemSlot` and `useItemAt`.

### Items
- **Boost** — 1.6× speed for 2s.
- **Missile** — homing, locks on enemies in 220-unit radius.
- **Oil slick** — drop behind, spins anyone who hits it.
- **Shield** — consumes one incoming hit.

### Shield visibility
- Pulsing cyan ring (`Car.SHIELD_COLOR = 0x88ccff`) drawn around any car with `shielded = true`. Sin-based alpha pulse (0.45–0.85), 26px radius, drawn on a per-car `shieldRing` Graphics owned by `Car`.
- `Car.spin(seconds)` returns `boolean` — `false` when the hit was absorbed by the shield. Existing missile + oil collision paths consume the return.
- `RaceScene.spawnShieldFlash(car)` plays a one-shot expanding cyan ring (r 18→56, alpha 1→0, stroke 4→1, ease cubic-out, 380ms) at the car position; player gets a "BLOCKED!" HUD flash.
- `uiCam.ignore(g)` applied to the runtime flash graphics so it lives in the world, not the HUD layer.

## Open Questions
- None active.

## Next Up
- None planned.
