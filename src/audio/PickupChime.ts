import type { AudioBus } from "./AudioBus";

// Two-osc rising chime, ~180ms, fire-and-forget. Positional gain sampled at
// trigger time; nothing to track per frame.
export function playPickupChime(bus: AudioBus, x: number, y: number) {
  const ctx = bus.ctx;
  const posGain = bus.instantaneousGain(x, y);
  if (posGain <= 0) return;

  const now = ctx.currentTime;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(bus.destination());

  const o1 = ctx.createOscillator();
  o1.type = "triangle";
  o1.frequency.setValueAtTime(880, now);            // A5
  o1.frequency.exponentialRampToValueAtTime(1320, now + 0.08); // E6 lift
  o1.connect(out);

  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(1760, now);           // A6 (sparkle)
  o2.frequency.exponentialRampToValueAtTime(2640, now + 0.08);
  const o2Gain = ctx.createGain();
  o2Gain.gain.value = 0.35;
  o2.connect(o2Gain);
  o2Gain.connect(out);

  const peak = 0.55 * posGain;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(peak, now + 0.012);
  out.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  const stopAt = now + 0.2;
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
