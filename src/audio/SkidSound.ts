import type { AudioBus, PositionalSource } from "./AudioBus";

export interface SkidSoundConfig {
  peakGain: number;
}

const DEFAULTS: SkidSoundConfig = {
  peakGain: 0.28,
};

const VOICE_RAMP_TAU = 0.04;
const POS_RAMP_TAU = 0.08;

export class SkidSound implements PositionalSource {
  private readonly bus: AudioBus;
  private readonly config: SkidSoundConfig;
  private readonly source: AudioBufferSourceNode;
  private readonly voiceGain: GainNode;
  private readonly positionalGain: GainNode;
  private x = 0;
  private y = 0;
  private started = false;
  private disposed = false;

  constructor(bus: AudioBus, buffer: AudioBuffer, config: Partial<SkidSoundConfig> = {}) {
    this.bus = bus;
    this.config = { ...DEFAULTS, ...config };
    const ctx = bus.ctx;

    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;

    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0;

    this.positionalGain = ctx.createGain();
    this.positionalGain.gain.value = 0;

    this.source.connect(this.voiceGain);
    this.voiceGain.connect(this.positionalGain);
    this.positionalGain.connect(bus.destination());
  }

  start() {
    if (this.started || this.disposed) return;
    this.source.start();
    this.started = true;
  }

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  // intensity: 0..1 — how audible the skid should be right now.
  setIntensity(intensity: number) {
    if (this.disposed) return;
    const t = Math.max(0, Math.min(1, intensity));
    const target = this.config.peakGain * t;
    const ctx = this.bus.ctx;
    this.voiceGain.gain.setTargetAtTime(target, ctx.currentTime, VOICE_RAMP_TAU);
  }

  getPosition() {
    return { x: this.x, y: this.y };
  }

  setPositionalGain(g: number) {
    if (this.disposed) return;
    const ctx = this.bus.ctx;
    this.positionalGain.gain.setTargetAtTime(g, ctx.currentTime, POS_RAMP_TAU);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.started) {
      try { this.source.stop(); } catch { /* already stopped */ }
    }
    this.source.disconnect();
    this.voiceGain.disconnect();
    this.positionalGain.disconnect();
  }
}
