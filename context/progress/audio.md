# Audio

Listener-relative positional audio. Player car is the listener; every sound source has a world coordinate and attenuates with distance.

## Completed

### Audio bus + positional model
- `src/audio/AudioBus.ts` owns a shared `AudioContext` (module-level singleton) + per-bus master `GainNode`. Per-scene instance.
- Falloff: inverse-square `gain = 1 / (1 + (d / refDistance)^2)` with hard cutoff at `maxDistance`. Defaults `refDistance = 200`, `maxDistance = 1500`, master gain `0.35`.
- `PositionalSource` interface: `getPosition()`, `setPositionalGain(g)`, `dispose()`. Anything that wants positional audio implements it and registers via `bus.add(source)`.
- Listener position updated per frame from the player car. Player ends up at distance 0 → gain 1.0, dominates the mix.

### Engine sound (sample-based)
- Source: `public/audio/engine.wav` — `loop_0.wav` from [Racing Car Engine Sound Loops by domasx2 on OpenGameArt](https://opengameart.org/content/racing-car-engine-sound-loops). License: CC0 (public domain). 75 KB, mono, 44.1 kHz, pre-trimmed for seamless looping.
- Loaded once in `BootScene.preload` via `this.load.audio("engine", "audio/engine.wav")`. Phaser's WebAudio backend decodes it into an `AudioBuffer` and stores it in `cache.audio`. `RaceScene.setupAudio` reads the buffer once and passes it to every `EngineSound` instance.
- `src/audio/EngineSound.ts`: looping `AudioBufferSourceNode` → lowpass `BiquadFilterNode` → voice gain → positional gain → bus master. Each car owns its own source node (cheap; the buffer is shared across all of them).
- `setRevs(t)` drives `playbackRate` (idle 0.6 → top 1.85, with overshoot up to ~2.16 during boost), filter cutoff (600 → 8000 Hz), and voice gain (idle 0.05 → peak 0.32) together. Uses `setTargetAtTime` with τ ≈ 50–80 ms to avoid zipper noise on rapid speed changes.
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

## Open Questions
- Top-down racing has no front/rear distinction; should we add stereo panning from the listener-relative angle? Cheap to add (`StereoPannerNode` per source) and would help locate cars on either side. Not in scope for this pass.
- Engine timbre is the same sample for every car — all cars sound identical. Could pick from `loop_0..loop_5` per car for a bit of variety, or jitter `idleRate` slightly at race start.
- `idleRate`/`topRate` defaults (0.6 / 1.85) are eyeballed. May need tuning once the user has driven a few laps with the new sample.
- AudioContext autoplay policy: relies on the user gesture from the START button on `MenuScene`. If the context comes back suspended (browser tab background → foreground), gain still sets but no sound plays. Defensive `ctx.resume()` happens in `AudioBus` constructor; revisit if users report silence.

## Next Up
- Wall-hit thump + tire skid chirp (one-shot positional sources). Reuses the same bus + falloff plumbing.
- Item pickup chime, missile launch, oil drop, shield block — also one-shot positional, mostly UI-side latency tolerant.
- Optional: stereo panning per source for left/right localisation.
