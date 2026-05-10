import Phaser from "phaser";
import { Car } from "../entities/Car";
import { AudioBus } from "./AudioBus";
import { EngineSound } from "./EngineSound";
import { SkidSound } from "./SkidSound";

const SKID_SPEED_FLOOR = 80;
const SKID_LATERAL_FLOOR = 70;
const SKID_RATIO_FLOOR = 0.30;
const SKID_RATIO_RANGE = 0.25;
const ENGINE_FADE_MS = 3000;

export class RaceAudioController {
  private audioBus: AudioBus | null = null;
  private engines = new Map<Car, EngineSound>();
  private skids = new Map<Car, SkidSound>();

  constructor(
    private scene: Phaser.Scene,
    private cars: readonly Car[],
  ) {
    this.setup();
  }

  private setup(): void {
    const engineBuf = this.scene.cache.audio.get("engine") as AudioBuffer | undefined;
    if (!engineBuf) return;
    const skidBuf = this.scene.cache.audio.get("skid") as AudioBuffer | undefined;
    this.audioBus = new AudioBus();
    for (const car of this.cars) {
      const engine = new EngineSound(this.audioBus, engineBuf);
      engine.setPosition(car.x, car.y);
      engine.start();
      this.audioBus.add(engine);
      this.engines.set(car, engine);
      if (skidBuf) {
        const skid = new SkidSound(this.audioBus, skidBuf);
        skid.setPosition(car.x, car.y);
        skid.start();
        this.audioBus.add(skid);
        this.skids.set(car, skid);
      }
    }
  }

  dispose(): void {
    if (!this.audioBus) return;
    this.audioBus.dispose();
    this.audioBus = null;
    this.engines.clear();
    this.skids.clear();
  }

  // Live audio bus, or null when no engine sample was loaded. Callers that route positional sfx
  // (item launches, wall thumps, pickup chimes) reach through this getter.
  bus(): AudioBus | null {
    return this.audioBus;
  }

  // Mute / unmute the whole bus for pause. Engines + skids keep looping in the background;
  // only the master gain is ramped to 0 so resume can pick up exactly where it left off.
  setMuted(muted: boolean): void {
    this.audioBus?.setMuted(muted);
  }

  update(humans: readonly Car[], racing: boolean): void {
    if (!this.audioBus) return;
    const now = this.scene.time.now;
    // 1P: single listener at the player. 2P: both humans listen, each contributing 50/50
    // to every source's mix — same falloff curve, just summed and averaged.
    this.audioBus.setListeners(humans.map((h) => ({ x: h.x, y: h.y })));
    for (const car of this.cars) {
      const engine = this.engines.get(car);
      if (engine) {
        engine.setPosition(car.x, car.y);
        engine.setRevs(this.revsTargetFor(car));
        engine.setFade(this.engineFadeFor(car, now));
      }
      const skid = this.skids.get(car);
      if (skid) {
        skid.setPosition(car.x, car.y);
        skid.setIntensity(this.skidIntensityFor(car, racing));
      }
    }
    this.audioBus.update();
  }

  // Slip-driven skid level. Gated on three things so steady cornering stays
  // silent: minimum speed, an absolute lateral-velocity floor, and a slip *ratio*
  // (lateral/total) — real skids have the lateral component as a meaningful share
  // of the velocity, not just a high lateral number reached by going fast in a turn.
  // Multiplied by the same finished-fade as the engine so finished cars don't keep screeching.
  // Also called by RaceFx to gate skid mark stamps so visual + audio agree.
  skidIntensityFor(car: Car, racing: boolean): number {
    if (!racing) return 0;
    if (car.speed < SKID_SPEED_FLOOR) return 0;
    const lateral = car.lateralSpeed;
    if (lateral < SKID_LATERAL_FLOOR) return 0;
    const ratio = lateral / car.speed;
    const slip = Math.max(0, ratio - SKID_RATIO_FLOOR) / SKID_RATIO_RANGE;
    const fade = this.engineFadeFor(car, this.scene.time.now);
    return Math.min(1, slip) * fade;
  }

  private revsTargetFor(car: Car): number {
    const speedNorm = car.config.maxSpeed > 0
      ? Math.min(1.4, car.speed / car.config.maxSpeed)
      : 0;
    const throttleNorm = car.audioThrottle;
    const base = Math.max(speedNorm, throttleNorm * 0.7);
    const boost = car.boostTimer > 0 ? 0.15 : 0;
    return 0.08 + base + boost;
  }

  private engineFadeFor(car: Car, now: number): number {
    if (car.finishedAtMs == null) return 1;
    const elapsed = now - car.finishedAtMs;
    return Math.max(0, 1 - elapsed / ENGINE_FADE_MS);
  }
}
