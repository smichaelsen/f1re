export interface PositionalSource {
  getPosition(): { x: number; y: number };
  setPositionalGain(g: number): void;
  dispose(): void;
}

let sharedContext: AudioContext | null = null;

function getSharedContext(): AudioContext {
  if (!sharedContext) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctx();
  }
  return sharedContext;
}

export interface AudioBusConfig {
  refDistance: number;
  maxDistance: number;
  masterGain: number;
}

const DEFAULTS: AudioBusConfig = {
  refDistance: 200,
  maxDistance: 1500,
  masterGain: 0.35,
};

export interface ListenerPos { x: number; y: number; }

export class AudioBus {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly sources: PositionalSource[] = [];
  // Multiple listeners enable local 2-player mixing: each source's gain is the average
  // of the per-listener falloff gains. With one listener, the average is the single value
  // (no behavioural change vs. the old single-listener API).
  private listeners: ListenerPos[] = [{ x: 0, y: 0 }];
  readonly config: AudioBusConfig;

  constructor(config: Partial<AudioBusConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.ctx = getSharedContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.config.masterGain;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  destination(): AudioNode {
    return this.master;
  }

  setListener(x: number, y: number) {
    this.listeners = [{ x, y }];
  }

  setListeners(positions: ListenerPos[]) {
    if (positions.length === 0) return;
    // Take a defensive copy so callers can mutate their own arrays freely.
    this.listeners = positions.map((p) => ({ x: p.x, y: p.y }));
  }

  add(source: PositionalSource) {
    this.sources.push(source);
  }

  private gainFor(x: number, y: number): number {
    const { refDistance, maxDistance } = this.config;
    const refSq = refDistance * refDistance;
    const maxSq = maxDistance * maxDistance;
    let sum = 0;
    for (const l of this.listeners) {
      const dx = x - l.x;
      const dy = y - l.y;
      const dSq = dx * dx + dy * dy;
      if (dSq >= maxSq) continue;
      sum += 1 / (1 + dSq / refSq);
    }
    // 50/50 mix: each listener contributes equally regardless of which is closer.
    // With N listeners this generalises to a 1/N weighting per listener.
    return sum / this.listeners.length;
  }

  // Positional gain at a fixed point, sampled now. For one-shot sounds that don't
  // need per-frame tracking — they fire-and-forget at trigger-time gain.
  instantaneousGain(x: number, y: number): number {
    return this.gainFor(x, y);
  }

  update() {
    for (const s of this.sources) {
      const p = s.getPosition();
      s.setPositionalGain(this.gainFor(p.x, p.y));
    }
  }

  // Ramp the master gain to silence (or back to the config default) for pause-style mutes.
  // setTargetAtTime over a short tau avoids click artifacts on toggle. Looping engine and
  // skid sources keep playing in the background; only their audible output is silenced.
  setMuted(muted: boolean) {
    const target = muted ? 0 : this.config.masterGain;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  dispose() {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
    this.master.disconnect();
  }
}
