import type { AudioBus, PositionalSource } from "./AudioBus";

export interface EngineSoundConfig {
  idleRate: number;
  topRate: number;
  filterIdleHz: number;
  filterTopHz: number;
  idleGain: number;
  peakGain: number;
}

const DEFAULTS: EngineSoundConfig = {
  idleRate: 0.6,
  topRate: 1.85,
  filterIdleHz: 600,
  filterTopHz: 8000,
  idleGain: 0.05,
  peakGain: 0.32,
};

const PARAM_RAMP_TAU = 0.08;
const VOICE_RAMP_TAU = 0.05;

export class EngineSound implements PositionalSource {
  private readonly bus: AudioBus;
  private readonly config: EngineSoundConfig;
  private readonly source: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly voiceGain: GainNode;
  private readonly positionalGain: GainNode;
  private x = 0;
  private y = 0;
  private fade = 1;
  private lastRevs = 0;
  private started = false;
  private disposed = false;

  constructor(bus: AudioBus, buffer: AudioBuffer, config: Partial<EngineSoundConfig> = {}) {
    this.bus = bus;
    this.config = { ...DEFAULTS, ...config };
    const ctx = bus.ctx;

    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.playbackRate.value = this.config.idleRate;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.config.filterIdleHz;
    this.filter.Q.value = 0.7;

    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = this.config.idleGain;

    this.positionalGain = ctx.createGain();
    this.positionalGain.gain.value = 0;

    this.source.connect(this.filter);
    this.filter.connect(this.voiceGain);
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

  // revs: ~0..1 (idle..peak); up to ~1.25 lets boost overshoot top playback rate.
  setRevs(revs: number) {
    if (this.disposed) return;
    const t = Math.max(0, Math.min(1.25, revs));
    this.lastRevs = t;
    this.applyVoice();
    this.applyPitch(t);
  }

  setFade(f: number) {
    if (this.disposed) return;
    const next = Math.max(0, Math.min(1, f));
    if (next === this.fade) return;
    this.fade = next;
    this.applyVoice();
  }

  private applyPitch(revs: number) {
    const ctx = this.bus.ctx;
    const now = ctx.currentTime;
    const c = this.config;
    const rate = c.idleRate + (c.topRate - c.idleRate) * revs;
    const cutoff = c.filterIdleHz + (c.filterTopHz - c.filterIdleHz) * Math.min(1, revs);
    this.source.playbackRate.setTargetAtTime(rate, now, PARAM_RAMP_TAU);
    this.filter.frequency.setTargetAtTime(cutoff, now, PARAM_RAMP_TAU);
  }

  private applyVoice() {
    const ctx = this.bus.ctx;
    const c = this.config;
    const loadCurve = Math.min(1, this.lastRevs);
    const target = (c.idleGain + (c.peakGain - c.idleGain) * loadCurve) * this.fade;
    this.voiceGain.gain.setTargetAtTime(target, ctx.currentTime, VOICE_RAMP_TAU);
  }

  getPosition() {
    return { x: this.x, y: this.y };
  }

  setPositionalGain(g: number) {
    if (this.disposed) return;
    const ctx = this.bus.ctx;
    this.positionalGain.gain.setTargetAtTime(g, ctx.currentTime, PARAM_RAMP_TAU);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.started) {
      try { this.source.stop(); } catch { /* already stopped */ }
    }
    this.source.disconnect();
    this.filter.disconnect();
    this.voiceGain.disconnect();
    this.positionalGain.disconnect();
  }
}
