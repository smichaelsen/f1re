# Audio

Listener-relative positional audio. Player car is the listener; every sound source has a world coordinate and attenuates with distance.

## Completed

### Audio bus + positional model
- `src/audio/AudioBus.ts` owns a shared `AudioContext` (module-level singleton) + per-bus master `GainNode`. Per-scene instance.
- Falloff: inverse-square `gain = 1 / (1 + (d / refDistance)^2)` with hard cutoff at `maxDistance`. Defaults `refDistance = 200`, `maxDistance = 1500`, master gain `0.35`.
- `PositionalSource` interface: `getPosition()`, `setPositionalGain(g)`, `dispose()`. Anything that wants positional audio implements it and registers via `bus.add(source)`.
- **Multiple listeners.** `bus.setListeners([{x, y}, ...])` accepts N listener positions. Per-source gain = `(1/N) × Σ falloff(d_i)` — each listener contributes equally to the mix regardless of which is closer. 1P passes a single listener (legacy behaviour). 2P passes both humans, so a sound right next to P1 plays at ~0.5 instead of 1.0 — that 50/50 trade-off is intentional so neither player loses spatial awareness when the action splits. `setListener(x, y)` is the 1-listener shortcut.

### Engine sound (sample-based)
- Source: `public/audio/engine.wav` — `loop_0.wav` from [Racing Car Engine Sound Loops by domasx2 on OpenGameArt](https://opengameart.org/content/racing-car-engine-sound-loops). License: CC0 (public domain). 75 KB, mono, 44.1 kHz, pre-trimmed for seamless looping.
- Loaded once in `BootScene.preload` via `this.load.audio("engine", "audio/engine.wav")`. Phaser's WebAudio backend decodes it into an `AudioBuffer` and stores it in `cache.audio`. `RaceScene.setupAudio` reads the buffer once and passes it to every `EngineSound` instance.
- `src/audio/EngineSound.ts`: looping `AudioBufferSourceNode` → lowpass `BiquadFilterNode` → voice gain → positional gain → bus master. Each car owns its own source node (cheap; the buffer is shared across all of them).
- `setRevs(t)` drives `playbackRate` (idle 0.6 → top 2.3, with overshoot up to ~2.73 during boost), filter cutoff (600 → 12000 Hz), and voice gain (idle 0.05 → peak 0.32) together. Uses `setTargetAtTime` with τ ≈ 50–80 ms to avoid zipper noise on rapid speed changes.
- `setFade(f)` is a 0..1 multiplier on voice gain, used to ramp engines down to silence after a car finishes the race.
- One engine per car. Engines start at scene `create()` and idle through the countdown.

### RaceScene wiring
- `RaceScene` owns the `AudioBus` and a `Map<Car, EngineSound>`. Built in `create()`, disposed on `SHUTDOWN`/`DESTROY` so `scene.restart()` and ESC-to-menu don't leak nodes.
- Per-frame `updateAudio()` sets the listener to the player position, updates each engine's position, calls `setRevs` + `setFade`, and finally `bus.update()` to refresh the per-source positional gain.

### "Revs" model
- `Car.audioThrottle: number` is what the audio layer reads as the throttle commanded right now. It's set alongside (or in lieu of) the physics input — during the countdown, physics receives `NO_INPUT`, but the player's `audioThrottle` still tracks the UP arrow so the engine revs on the grid without the car moving. AI cars stay at `audioThrottle = 0` during countdown.
- `RaceScene.revsTargetFor(car)` formula: `0.08 (idle) + max(speedNorm, throttleNorm * 0.7) + (boostTimer > 0 ? 0.15 : 0)`. Held throttle on the grid → ~0.78 revs → loud mid-pitch rev. Speed alone with no throttle (coasting) → speed-driven revs without an extra "load" term, so the car sounds quieter on lift-off than under power. Active boost → +0.15 on top, audible as both pitch lift and louder voice.
- `RaceScene.engineFadeFor(car, now)`: `1` while the car is still racing; once `finishedAtMs` is set, decays linearly from 1 → 0 over 3 s. Multiplies voice gain in `EngineSound`, so a finished car's engine fades to silence even though `revs` is still tracking its decaying speed.

## Architecture Decisions
- **Sample over procedural for engine timbre.** Initial cut was procedural (sawtooth pair + filter sweep). Realism gap was too large to close with synthesis alone. Swapped to a CC0 looping sample driven by `playbackRate` from revs. The bus + positional gain + revs/fade plumbing did not change — only the node graph inside `EngineSound` did.
- **Buffer is loaded via Phaser's loader, played through our own `AudioContext`.** Phaser decodes the WAV into an `AudioBuffer`; per Web Audio spec, buffers are portable across contexts on the same page, so our `AudioBus` context can play it without sharing a context with Phaser's `SoundManager`.
- **Single shared `AudioContext`.** Re-creating a context per scene leaks (browsers cap concurrent contexts and don't promptly GC them). The context survives scene transitions; only the bus + sources are disposed.
- **Bus drives gain, source owns its node graph.** Sources connect their final node to `bus.destination()` and let the bus call `setPositionalGain` each frame. This keeps the falloff curve in one place and lets each source build whatever node graph it needs upstream.

### Tire skid (sample-based)
- Source: `public/audio/skid.wav` — `tires_squal_loop.wav` from [Car Tire Squeal Skid Loop by Tom Haigh (audible-edge), submitted by qubodup, on OpenGameArt](https://opengameart.org/content/car-tire-squeal-skid-loop). License: **CC-BY 3.0** (attribution required). 864 KB, mono, 96 kHz, 3-second seamless loop.
- Loaded in `BootScene.preload` via `this.load.audio("skid", "audio/skid.wav")`.
- `src/audio/SkidSound.ts`: looping `AudioBufferSourceNode` → voice gain → positional gain → bus master. One source per car (same per-car ownership pattern as `EngineSound`).
- `RaceScene.skidIntensityFor(car)` drives the voice gain. Three-stage gate so steady cornering stays silent: silent if `speed < 80` or `lateralSpeed < 70`; otherwise intensity ramps linearly from 0 → 1 across `slipRatio = lateralSpeed / speed` in `[0.30, 0.55]`. Multiplied by `engineFadeFor` so finished cars don't keep screeching. `Car.lateralSpeed` is a getter returning `|−vx·sin(h) + vy·cos(h)|`. The ratio gate is the key tuning knob — real skids have lateral velocity as a meaningful share of total, not just a high lateral number reached by going fast through a turn.
- Voice peak gain `0.28` (slightly under the engine's 0.32 peak so it sits just below the engine in the mix).
- Attribution shown in `MenuScene` settings view (Audio Credits block).

### Pickup chime (synthetic)
- `src/audio/PickupChime.ts` exports `playPickupChime(bus, x, y)`. Two-osc rising chime, ~180 ms, fire-and-forget.
- Triangle 880→1320 Hz + sine 1760→2640 Hz (sparkle harmonic at 0.35 voice gain). Linear attack 12 ms, exponential decay to silence by 180 ms.
- Positional gain sampled once at trigger time via `AudioBus.instantaneousGain(x, y)` — no per-frame tracking; the chime is too short for listener movement to matter. Nodes self-disconnect on `onended`.
- Triggered in `RaceScene.updatePickups` at the moment a *human* car collects a pickup, played at the pickup's world position. AI pickups are silent — the chime is direct feedback for the player who grabbed the box, not a positional cue about distant traffic. (In 2P, either human triggers it; the position-based listener mix takes care of localising the chime to whichever player picked up.)

### Item + hit SFX (synthetic)
- `src/audio/ItemSfx.ts` exports eight one-shots, each fire-and-forget with positional gain sampled at trigger time. Same node-graph and self-disconnect pattern as `PickupChime`. A shared `noiseBuffer(ctx)` cache provides a 600 ms white-noise `AudioBuffer` reused across calls (created once per `AudioContext`).
- **Activation sounds** (triggered in `RaceScene.useItem`, played at the firing car's position):
  - `playBoostSfx` — saw 180→720 Hz + bandpassed noise sweep, ~360 ms.
  - `playMissileLaunchSfx` — aggressive saw 880→180 Hz + highpassed noise crackle, ~280 ms.
  - `playSeekerLaunchSfx` — sci-fi square+sine sweep 520→1800 Hz / 1040→3600 Hz, ~260 ms.
  - `playOilDropSfx` — lowpassed noise burst (800→180 Hz) + 120→60 Hz sub thud, ~200 ms.
  - `playShieldUpSfx` — triangle stepped C5→G5→D6→G6 + C7→G7 sparkle, ~420 ms.
- **Impact sounds** (triggered at car position when `Car.spin()` returns truthy, i.e. the hit landed):
  - `playExplosionSfx` — noise burst with 2400→180 Hz lowpass sweep + 160→45 Hz sub. Used for missile and seeker hits.
  - `playSpinoutSfx` — saw 640→120 Hz + sine 220→80 Hz descending slide. Used for oil-slick hits.
- **Block ping** (`playShieldBlockSfx`): 2200 Hz + 3300 Hz sine pair, ~220 ms. Played from `RaceScene.spawnShieldFlash` so all three blocked-hit paths (missile, seeker, oil) share it. Pairs with the cyan ring visual.
- Voice peaks chosen so impacts (0.6) sit above launches (~0.4–0.5) and blocks (0.5), keeping the mix ducked under the engine voice peak (0.32 *positional*, 0.35 master).

### Wall-hit thump (synthetic)
- `playWallThumpSfx(bus, x, y, intensity)` in `src/audio/ItemSfx.ts`. Sub sine (90→50 Hz at low intensity, 60→35 Hz at high intensity) + lowpassed noise body (1400→220 Hz). ~240 ms total. Same fire-and-forget node graph as the other one-shots.
- Caller passes `intensity ∈ [0, 1]`. Peak gain = `(0.32 + 0.32 × intensity) × posGain`, so glancing taps stay quiet and full crashes hit hard. Intensity also lowers the sub's start/end frequencies, giving heavy hits more low-end weight.
- Triggered in `RaceScene.applyTrackBounds` next to the spark burst, gated by the same `vn > 60` threshold so wall-hugging contact stays silent. Intensity = `min(1, (vn − 60) / 300)` — vn 60 → 0, vn 360+ → 1. Same threshold + emit point as sparks, so the visual flash and audio thump are co-located in time and space.

## Open Questions
- Top-down racing has no front/rear distinction; should we add stereo panning from the listener-relative angle? Cheap to add (`StereoPannerNode` per source) and would help locate cars on either side. Not in scope for this pass.
- Engine timbre is the same sample for every car — all cars sound identical. Could pick from `loop_0..loop_5` per car for a bit of variety, or jitter `idleRate` slightly at race start.
- `idleRate`/`topRate` defaults (0.6 / 2.3) are eyeballed. May need tuning once the user has driven a few laps with the new sample.
- AudioContext autoplay policy: relies on the user gesture from the START button on `MenuScene`. If the context comes back suspended (browser tab background → foreground), gain still sets but no sound plays. Defensive `ctx.resume()` happens in `AudioBus` constructor; revisit if users report silence.
- Skid intensity gating (speed≥40, lateralSpeed≥30, range 50) is eyeballed. Tune after a few laps on each track — Oval's continuous bend may want a higher floor so steady-state cornering doesn't whisper-skid.

## Next Up
- None. Audio considered done for now.
