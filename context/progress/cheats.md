# Cheats

Hidden cheat menu unlocked by typing a code on the main menu. Persisted across sessions.

## Status

Shipped:
- `src/scenes/MenuCheats.ts` — load/save for `f1re.cheats`. Schema: `{ unlocked, diamondArmor, offRoadWheels, mazeSpin, hammerTime, deathmatch }`. Unknown fields fall back to defaults; corrupted JSON falls back to all-false.
- Unlock code `CHEATZPLS` typed on the main view flips `unlocked = true`. Detection: rolling 9-char A-Z buffer in `MenuScene.feedCheatBuffer`. Only listens while `view === "main"` and no name input is focused. A "CHEATS UNLOCKED" banner flashes at the top of the screen for ~1.6s.
- Pink CHEATS link sits below SETTINGS in the top-right of the main view (only rendered when `unlocked`). Opens a new `cheats` view alongside the existing `settings` and `fastestLaps` views.
- Cheats view is intentionally name-only — no sub-text. Toggles persist immediately on click.
- DISABLE CHEATS link below DONE clears every toggle, flips `unlocked` back to false, and bounces to the main view — re-locks the menu until the user re-types CHEATZPLS.
- `RaceScene.init` accepts a `cheats` payload; `MenuScene.start` only forwards it when `unlocked` is true. AI never benefits from cheats.

## Cheat effects

- **DIAMOND ARMOR** — `RaceScene.runRacing` sets `human.shielded = true; human.shieldExpiresAt = 0` every frame for every human. With `shieldExpiresAt = 0`, `Car.updateShieldRing` takes the no-expiry branch — no blink, no auto-drop. `Car.spin()` still consumes the shield on each hit, but it gets restored before the next physics frame so the car never actually spins.
- **OFF ROAD WHEELS** — `RaceScene.surfaceFeel` short-circuits to asphalt feel (`SURFACE_PARAMS.asphalt`) when `car.isPlayer && cheats.offRoadWheels`. Off-track corner sampling is skipped entirely for cheating humans.
- **MAZESPIN** — In the human-input loop, when `input.useItem` is pressed and `human.items.length === 0`, push a `"seeker"` item before calling `ItemSystem.useItem`. Re-uses the existing seeker pipeline (lock radius, homing, expiry).
- **HAMMERTIME** — Multiplies a human car's `config.maxSpeed` by `HAMMER_TIME_TOP_SPEED_MULT` (1.30) at construction. Only affects the absolute cap — accel and grip stay stock so launch/cornering feel unchanged. Stacks multiplicatively with boost (1.6×), DRS top-speed mult (1.06×), and draft.
- **DEATHMATCH** — `Car.dead` flag (generic, not cheat-coupled) gates throttle accel in `Car.update` when set; brake, steering, drag, and momentum still work. `ItemSystem` calls a new `onSpin(car)` callback whenever `Car.spin()` actually applies (shielded hits don't fire it). RaceScene's onSpin handler flips `car.dead = true` when the cheat is active. Race-end check: in deathmatch, when every car is `dead || finishedAtMs != null`, RaceScene seals dead-but-unfinished cars with `finishedAtMs = now` so the existing standings + results pipeline runs. `rankedCars`'s progress-based primary sort gives a sensible ranking by how far each car got before dying. The unstuck watchdog also early-returns for dead cars so they don't get teleported back to a gate they can't drive away from.

## Fastest-laps interaction

Cheat-armed races never write to the fastest-laps board. `RaceScene.updateLapTracking` gates the `recordFastestLap` call on `!this.anyCheatActive()`, which checks all five cheat flags (the `unlocked` flag alone doesn't suppress recording — it just means the menu is reachable). The gate covers all cars in the race, including AI, so a player can't farm a "clean AI" record on a cheat-armed run.
