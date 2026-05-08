import type { AudioBus } from "./AudioBus";

// Synthetic one-shot SFX for item usage and impacts. Same pattern as PickupChime:
// fire-and-forget, positional gain sampled once at trigger time, nodes self-disconnect.

let noiseBufferCache: { ctx: AudioContext; buf: AudioBuffer } | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCache.ctx === ctx) return noiseBufferCache.buf;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBufferCache = { ctx, buf };
  return buf;
}

function startSfx(bus: AudioBus, x: number, y: number): { ctx: AudioContext; out: GainNode; now: number; posGain: number } | null {
  const posGain = bus.instantaneousGain(x, y);
  if (posGain <= 0) return null;
  const ctx = bus.ctx;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(bus.destination());
  return { ctx, out, now: ctx.currentTime, posGain };
}

// Boost — quick rising whoosh: filtered noise + saw sweep upward.
export function playBoostSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.setValueAtTime(180, now);
  saw.frequency.exponentialRampToValueAtTime(720, now + 0.32);
  saw.connect(out);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.Q.value = 0.9;
  noiseFilter.frequency.setValueAtTime(400, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(2400, now + 0.32);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.6;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(out);

  const peak = 0.42 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.025);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

  const stopAt = now + 0.4;
  saw.start(now);
  noise.start(now);
  saw.stop(stopAt);
  noise.stop(stopAt);
  saw.onended = () => {
    saw.disconnect();
    noise.disconnect();
    noiseFilter.disconnect();
    noiseGain.disconnect();
    out.disconnect();
  };
}

// Missile launch — aggressive downward saw sweep with crackle.
export function playMissileLaunchSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.setValueAtTime(880, now);
  saw.frequency.exponentialRampToValueAtTime(180, now + 0.22);
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.7;
  saw.connect(sawGain);
  sawGain.connect(out);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5;
  noise.connect(hp);
  hp.connect(noiseGain);
  noiseGain.connect(out);

  const peak = 0.5 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.01);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  const stopAt = now + 0.3;
  saw.start(now);
  noise.start(now);
  saw.stop(stopAt);
  noise.stop(stopAt);
  saw.onended = () => {
    saw.disconnect();
    sawGain.disconnect();
    noise.disconnect();
    hp.disconnect();
    noiseGain.disconnect();
    out.disconnect();
  };
}

// Seeker launch — sci-fi rising chirp: square sweep with sine harmonic.
export function playSeekerLaunchSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const sq = ctx.createOscillator();
  sq.type = "square";
  sq.frequency.setValueAtTime(520, now);
  sq.frequency.exponentialRampToValueAtTime(1800, now + 0.22);
  const sqGain = ctx.createGain();
  sqGain.gain.value = 0.35;
  sq.connect(sqGain);
  sqGain.connect(out);

  const sine = ctx.createOscillator();
  sine.type = "sine";
  sine.frequency.setValueAtTime(1040, now);
  sine.frequency.exponentialRampToValueAtTime(3600, now + 0.22);
  const sineGain = ctx.createGain();
  sineGain.gain.value = 0.5;
  sine.connect(sineGain);
  sineGain.connect(out);

  const peak = 0.4 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.015);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

  const stopAt = now + 0.28;
  sq.start(now);
  sine.start(now);
  sq.stop(stopAt);
  sine.stop(stopAt);
  sq.onended = () => {
    sq.disconnect();
    sqGain.disconnect();
    sine.disconnect();
    sineGain.disconnect();
    out.disconnect();
  };
}

// Oil drop — short wet splat: lowpassed noise burst with a low thud.
export function playOilDropSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(800, now);
  lp.frequency.exponentialRampToValueAtTime(180, now + 0.18);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.7;
  noise.connect(lp);
  lp.connect(noiseGain);
  noiseGain.connect(out);

  const thud = ctx.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(120, now);
  thud.frequency.exponentialRampToValueAtTime(60, now + 0.16);
  const thudGain = ctx.createGain();
  thudGain.gain.value = 0.5;
  thud.connect(thudGain);
  thudGain.connect(out);

  const peak = 0.45 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.008);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  const stopAt = now + 0.22;
  noise.start(now);
  thud.start(now);
  noise.stop(stopAt);
  thud.stop(stopAt);
  noise.onended = () => {
    noise.disconnect();
    lp.disconnect();
    noiseGain.disconnect();
    thud.disconnect();
    thudGain.disconnect();
    out.disconnect();
  };
}

// Shield up — three-tone ascending shimmer.
export function playShieldUpSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(523, now);                  // C5
  tone.frequency.setValueAtTime(784, now + 0.09);           // G5
  tone.frequency.setValueAtTime(1175, now + 0.18);          // D6
  tone.frequency.exponentialRampToValueAtTime(1568, now + 0.34); // G6 lift
  tone.connect(out);

  const shimmer = ctx.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.setValueAtTime(2093, now);              // C7 sparkle
  shimmer.frequency.exponentialRampToValueAtTime(3136, now + 0.34);
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.25;
  shimmer.connect(shimmerGain);
  shimmerGain.connect(out);

  const peak = 0.4 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.02);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

  const stopAt = now + 0.44;
  tone.start(now);
  shimmer.start(now);
  tone.stop(stopAt);
  shimmer.stop(stopAt);
  tone.onended = () => {
    tone.disconnect();
    shimmer.disconnect();
    shimmerGain.disconnect();
    out.disconnect();
  };
}

// Explosion — noise burst with lowpass sweep + sub thump. Used on missile/seeker hits.
export function playExplosionSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2400, now);
  lp.frequency.exponentialRampToValueAtTime(180, now + 0.32);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.9, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
  noise.connect(lp);
  lp.connect(noiseGain);
  noiseGain.connect(out);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(160, now);
  sub.frequency.exponentialRampToValueAtTime(45, now + 0.22);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.7, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  sub.connect(subGain);
  subGain.connect(out);

  const peak = 0.6 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.005);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

  const stopAt = now + 0.38;
  noise.start(now);
  sub.start(now);
  noise.stop(stopAt);
  sub.stop(stopAt);
  noise.onended = () => {
    noise.disconnect();
    lp.disconnect();
    noiseGain.disconnect();
    sub.disconnect();
    subGain.disconnect();
    out.disconnect();
  };
}

// Spinout — descending pitch slide for oil-slick spin.
export function playSpinoutSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.setValueAtTime(640, now);
  saw.frequency.exponentialRampToValueAtTime(120, now + 0.42);
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.55;
  saw.connect(sawGain);
  sawGain.connect(out);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(220, now);
  sub.frequency.exponentialRampToValueAtTime(80, now + 0.42);
  const subGain = ctx.createGain();
  subGain.gain.value = 0.4;
  sub.connect(subGain);
  subGain.connect(out);

  const peak = 0.42 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.015);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

  const stopAt = now + 0.48;
  saw.start(now);
  sub.start(now);
  saw.stop(stopAt);
  sub.stop(stopAt);
  saw.onended = () => {
    saw.disconnect();
    sawGain.disconnect();
    sub.disconnect();
    subGain.disconnect();
    out.disconnect();
  };
}

// Wall thump — low sub thud + lowpassed noise crunch when a car hits a wall.
// Caller passes `intensity` in [0, 1] derived from the impact's normal velocity, so soft
// scrapes are quiet and hard crashes are loud. Sub frequency also stretches with intensity
// so heavy hits sit lower than glancing taps.
export function playWallThumpSfx(bus: AudioBus, x: number, y: number, intensity: number) {
  const i = Math.max(0, Math.min(1, intensity));
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1400, now);
  lp.frequency.exponentialRampToValueAtTime(220, now + 0.2);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.7, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  noise.connect(lp);
  lp.connect(noiseGain);
  noiseGain.connect(out);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  const subStart = 90 - 30 * i;  // heavier hits start lower (90 → 60 Hz)
  const subEnd = 50 - 15 * i;    // and decay further (50 → 35 Hz)
  sub.frequency.setValueAtTime(subStart, now);
  sub.frequency.exponentialRampToValueAtTime(subEnd, now + 0.18);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.8, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  sub.connect(subGain);
  subGain.connect(out);

  const peak = (0.32 + 0.32 * i) * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.005);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

  const stopAt = now + 0.26;
  noise.start(now);
  sub.start(now);
  noise.stop(stopAt);
  sub.stop(stopAt);
  noise.onended = () => {
    noise.disconnect();
    lp.disconnect();
    noiseGain.disconnect();
    sub.disconnect();
    subGain.disconnect();
    out.disconnect();
  };
}

// Shield block — bright metallic two-tone ping when a hit is absorbed.
export function playShieldBlockSfx(bus: AudioBus, x: number, y: number) {
  const s = startSfx(bus, x, y);
  if (!s) return;
  const { ctx, out, now, posGain } = s;

  const o1 = ctx.createOscillator();
  o1.type = "sine";
  o1.frequency.setValueAtTime(2200, now);
  o1.connect(out);

  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(3300, now);
  const o2Gain = ctx.createGain();
  o2Gain.gain.value = 0.45;
  o2.connect(o2Gain);
  o2Gain.connect(out);

  const peak = 0.5 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.005);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  const stopAt = now + 0.24;
  o1.start(now);
  o2.start(now);
  o1.stop(stopAt);
  o2.stop(stopAt);
  o1.onended = () => {
    o1.disconnect();
    o2.disconnect();
    o2Gain.disconnect();
    out.disconnect();
  };
}
