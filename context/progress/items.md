# Items + Pickups

## Completed

### Pickup boxes
- 8 pickups per track, 3.5s respawn after collection.
- Player triggers items via SPACE; AI triggers via skill-jittered utility check (see "AI item intelligence" below).
- Spinning AI keeps its `useItemAt` timer; `useItem` shifts the front item off the queue and clears `useItemAt`.

### AI item intelligence
Each AI scores the front-of-queue item in [0, 1] for "fit right now" and rolls a per-recheck Bernoulli that combines fit, time-toward-patience, and a small floor. Hard yes/no gates were replaced because they let leaders hold "leader-unfriendly" items (e.g. seekers — no rival ahead) for the full patience window and blocked items behind them in the queue.

**Probability model.** Per recheck (`AI_ITEM_RECHECK_MS=250`):
```
tFrac = clamp((now − pickupAt) / patience, 0, 1)
p = clamp(AI_FIRE_P_FLOOR + score * AI_FIRE_W_SCORE + tFrac * AI_FIRE_W_TIME, 0, 1)
fire if Math.random() < p
```
Defaults: `AI_FIRE_P_FLOOR=0.05`, `AI_FIRE_W_SCORE=0.8`, `AI_FIRE_W_TIME=0.5`. A perfect-fit item (score≈1) fires near-immediately (~1 recheck); a moderate-fit item (score≈0.5) fires within ~2 rechecks; a poor-fit item (score≈0) starts at the 0.05 floor and ramps via the time term, force-fired at patience expiry. A utility may also return `null` ("do not fire under any circumstances right now" — already boosting, already shielded), which bypasses the draw and slips the recheck.

**Patience cap (live, force-fire at expiry).**
- Default: `AI_ITEM_PATIENCE_MS=8000` from pickup.
- Inventory full (`items.length >= ITEM_INVENTORY_SIZE`): `AI_ITEM_PATIENCE_FULL_MS=3000`. Slot pressure: better to spend now than miss the next pickup.
- Shield: `AI_SHIELD_PATIENCE_MS=1500`. Held shields protect from surprises; missed shields don't — the asymmetry favours always firing.

**Initial scheduling window** (gates the *first* eval).
- Shield: 300–1200ms.
- Other items: 1000–5000ms.

**Skill noise model (frozen per item-instance).** When an item enters an AI's inventory, a `{r1, r2, r3, pickupAt}` record is pushed onto `AISkillState.itemNoise[]` parallel to `Car.items[]` and shifted on consume. Each evaluator wires the `[-1, 1]` rolls to its own judgement values (range estimate, perceived bearing, threshold) so noise on different axes is uncorrelated. Sampling once per pickup reads as a frozen "this AI judged this missile this way" decision; per-tick variance comes from the Bernoulli draw, not re-rolled noise.

**Skill→noise scale.** `factor = (1 − skill)²` (skill ∈ [0.4, 1.0] → factor ∈ [0, 0.36]). Quadratic so a 0.7-skill AI is still mostly sharp (factor 0.09) and only the bottom of the range visibly fumbles.

**Per-item score** (skill noise still perturbs threshold inputs):
- **Boost** — `null` if already boosting. Else `curvScore × speedScore`. `curvScore = 1 − maxCurv / (2 × jittered AI_BOOST_CURVATURE_MAX)` over the next `AI_BOOST_SCAN_DIST=400`px of racing line. `speedScore = (speed − 0.7×speedFloor) / (0.3×speedFloor)` clamped, where `speedFloor = jittered AI_BOOST_SPEED_FRAC × maxSpeed`.
- **Missile** — nearest non-owner. `rangeScore = 1 − effD / (1.5 × AI_MISSILE_RANGE)`, `effD = trueD × (1 + r1 × factor × 0.3)`. `bearingScore = (dot − aheadGate) / (1 − aheadGate)`, `dot = cos(perceived bearing − heading)`, perceived bearing perturbed by `r2 × factor × 0.4` rad, `aheadGate = AI_MISSILE_AHEAD_DOT − r3 × factor × 0.3`. Score = `rangeScore × bearingScore`.
- **Seeker** — `aheadScore × curvScore`. `aheadScore = 1` if any rival up-track on race progress, else `clamp(0.15 + max(0, r1) × factor × 0.5)` — leaders still fire stochastically. `curvScore = 1 − localK / (2 × jittered AI_SEEKER_CURVATURE_MAX)`.
- **Oil** — closest rival behind on race progress. Score = `1 − effD / (1.5 × AI_OIL_BEHIND_RANGE)`, `effD = chaserD × (1 + r1 × factor × 0.3)`. Score 0 if no chaser (last-place AIs eventually force-fire on time term).
- **Shield** — `null` if already shielded, else `1`. Eagerness is the design intent. AI does NOT peek at other drivers' inventories; held items are private.

**Teammate awareness.** Cars carry a `teamId` (set by `RaceScene` on construction from the team-pool draw). Three utilities apply a friendly-fire penalty `AI_TEAMMATE_PENALTY = 0.15` to the final score when the relevant target is a teammate:
- **Missile** — penalty when the *nearest car* (the missile's actual lock target) is a teammate.
- **Seeker** — penalty when the *closest up-track car* is a teammate (the one most likely to enter the seeker's 140u lock radius first). Additionally, "rival ahead" no longer counts teammates, so a leader whose only car ahead is a teammate falls back to the leader-baseline score instead of the rivalAhead=1 score.
- **Oil** — penalty when the *closest chaser behind* is a teammate (the one who eats the slick).
Penalty is multiplicative on the score, not a hard veto: patience cap and time-ramp can still force-fire if no other use shows up before expiry. Set to 0.15 — strong enough that a teammate-only target is functionally a "wait" decision in normal play, soft enough that a desperate AI eventually fires.

Race-progress comparison uses `lap × loopLen + centerlineCumS[probe.index]` with modular wrap; "ahead" means dProg ∈ (20, loopLen/2).

### Inventory (FIFO, 2 slots)
- `Car.items: string[]` — oldest at index 0, newest at the end. Capacity `ITEM_INVENTORY_SIZE = 2` enforced at pickup time. Cars at capacity skip the box (it stays active for others).
- `useItem(car)` shifts the front item (`items.shift()`) and fires its effect. AI scheduling: pickup sets `useItemAt` only when the AI was empty; `useItem` reschedules a fresh 1–5s timer if items remain in the queue, so AI doesn't fire its whole inventory on the same frame.
- HUD shows the queue as two slot boxes (rounded rects, dark fill, faint white stroke). Front-of-queue ("about to use") icon rendered big inside the primary slot; next item rendered smaller in the secondary slot offset up-left so it reads as "behind it". The empty boxes always render so capacity reads even when the inventory is empty. Both icons use the in-world appearance for each item (red+orange dot for missile, cyan+white for seeker, black blob for oil, cyan ring for shield, double-chevron for boost since it has no in-world sprite). Helpers in `src/ui/ItemIcon.ts`; slot bg drawn by `drawSlotBg` in `Hud.ts`; the diff-and-redraw is in `Hud.setItem`. Depth ordering bottom→top: secondary bg → secondary icon → primary bg → primary icon, so the primary slot occludes the secondary's overlap region. DRS HUD line moved from y=170 to y=235 to clear the icon stack.

### Items
- **Boost** — 1.6× speed for 2s.
- **Missile** — homing, locks on enemies in 220-unit radius.
- **Seeker** — spawns 24px ahead on the centerline, follows the racing line at 700u/s until any non-owner enters a 140-unit lock radius, then homes in (one-way transition, same 4.5 rad/s turn cap as missile). 9s lifetime. Visual: cyan core + white halo. Same hit effect as missile (spin 1.2, shield-aware).
- **Oil slick** — drop behind, spins anyone who hits it.
- **Shield** — consumes one incoming hit. 15s lifetime (`SHIELD_DURATION_MS`); ring blinks twice in the final 1.5s (`SHIELD_BLINK_WINDOW_MS`, 4 on/off phases) then expires unused. Pickup resets the timer; `spin()` consumption clears `shieldExpiresAt`.

### Shield visibility
- Pulsing cyan ring (`Car.SHIELD_COLOR = 0x88ccff`) drawn around any car with `shielded = true`. Sin-based alpha pulse (0.45–0.85), 26px radius, drawn on a per-car `shieldRing` Graphics owned by `Car`.
- `Car.spin(seconds)` returns `boolean` — `false` when the hit was absorbed by the shield. Existing missile + oil collision paths consume the return.
- `ItemSystem.spawnShieldFlash(car)` plays a one-shot expanding cyan ring (r 18→56, alpha 1→0, stroke 4→1, ease cubic-out, 380ms) at the car position; player gets a "BLOCKED!" HUD flash via the `flashFor` callback wired by `RaceScene`.
- `uiCam.ignore(g)` applied to the runtime flash graphics so it lives in the world, not the HUD layer.

### Module structure
All pickup, missile, seeker, oil-slick, shield-flash, and `useItem` logic lives in `src/race/ItemSystem.ts`. `RaceScene` constructs it once after `uiCam` exists, calls `spawn()` once, then `update(dt, now)` per frame and `useItem(car)` on player/AI fire. Constructor takes `scene`, `track`, `uiCam`, `cars`, `aiDriver`, an `audioBus` getter (nullable, set later), and a `flashFor(car, text, ms)` callback so HUD routing stays in the scene.

## Open Questions
- None active.

## Next Up
- None planned.
