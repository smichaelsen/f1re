# Items + Pickups

## Completed

### Pickup boxes
- 8 pickups per track, 3.5s respawn after collection.
- Player triggers items via SPACE; AI triggers on a random 1–5s delay after pickup.
- Spinning AI keeps its `useItemAt` timer; `useItem` shifts the front item off the queue and clears `useItemAt`.

### Inventory (FIFO, 2 slots)
- `Car.items: string[]` — oldest at index 0, newest at the end. Capacity `ITEM_INVENTORY_SIZE = 2` enforced at pickup time. Cars at capacity skip the box (it stays active for others).
- `useItem(car)` shifts the front item (`items.shift()`) and fires its effect. AI scheduling: pickup sets `useItemAt` only when the AI was empty; `useItem` reschedules a fresh 1–5s timer if items remain in the queue, so AI doesn't fire its whole inventory on the same frame.
- HUD shows the queue as two slot boxes (rounded rects, dark fill, faint white stroke). Front-of-queue ("about to use") icon rendered big inside the primary slot; next item rendered smaller in the secondary slot offset up-left so it reads as "behind it". The empty boxes always render so capacity reads even when the inventory is empty. Both icons use the in-world appearance for each item (red+orange dot for missile, cyan+white for seeker, black blob for oil, cyan ring for shield, double-chevron for boost since it has no in-world sprite). Helpers in `src/ui/ItemIcon.ts`; slot bg drawn by `drawSlotBg` in `Hud.ts`; the diff-and-redraw is in `Hud.setItem`. Depth ordering bottom→top: secondary bg → secondary icon → primary bg → primary icon, so the primary slot occludes the secondary's overlap region. DRS HUD line moved from y=170 to y=235 to clear the icon stack.

### Items
- **Boost** — 1.6× speed for 2s.
- **Missile** — homing, locks on enemies in 220-unit radius.
- **Seeker** — spawns 24px ahead on the centerline, follows the racing line at 700u/s until any non-owner enters a 140-unit lock radius, then homes in (one-way transition, same 4.5 rad/s turn cap as missile). 9s lifetime. Visual: cyan core + white halo. Same hit effect as missile (spin 1.2, shield-aware).
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
