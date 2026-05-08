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

export class AudioBus {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly sources: PositionalSource[] = [];
  private listenerX = 0;
  private listenerY = 0;
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
    this.listenerX = x;
    this.listenerY = y;
  }

  add(source: PositionalSource) {
    this.sources.push(source);
  }

  // Positional gain at a fixed point, sampled now. For one-shot sounds that don't
  // need per-frame tracking — they fire-and-forget at trigger-time gain.
  instantaneousGain(x: number, y: number): number {
    const { refDistance, maxDistance } = this.config;
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dSq = dx * dx + dy * dy;
    if (dSq >= maxDistance * maxDistance) return 0;
    return 1 / (1 + dSq / (refDistance * refDistance));
  }

  update() {
    const { refDistance, maxDistance } = this.config;
    const refSq = refDistance * refDistance;
    const maxSq = maxDistance * maxDistance;
    for (const s of this.sources) {
      const p = s.getPosition();
      const dx = p.x - this.listenerX;
      const dy = p.y - this.listenerY;
      const dSq = dx * dx + dy * dy;
      let gain: number;
      if (dSq >= maxSq) {
        gain = 0;
      } else {
        gain = 1 / (1 + dSq / refSq);
      }
      s.setPositionalGain(gain);
    }
  }

  dispose() {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
    this.master.disconnect();
  }
}
