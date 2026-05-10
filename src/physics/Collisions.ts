import { Car } from "../entities/Car";
import { Track } from "../entities/Track";
import { AudioBus } from "../audio/AudioBus";
import { playWallThumpSfx } from "../audio/ItemSfx";
import { RaceFx } from "../race/RaceFx";

// Wall impact thresholds. Sparks + thump only above SPARK_VN_THRESHOLD so the constant
// wall-hugging contact when a car drifts along a wall doesn't fire effects every frame.
const SPARK_VN_THRESHOLD = 60;
// Wall response: low restitution (cars don't bounce dramatically) plus tangential scrub
// (lose some along-wall speed). Tuned for arcade feel — high enough that scraping a wall costs
// time, low enough that it doesn't yank the car to a stop.
const WALL_RESTITUTION = 0.35;
const WALL_TANGENTIAL_SCRUB = 0.9;
// Car-vs-car: split MTV 50/50, normal-direction impulse with this coefficient.
const CAR_IMPULSE_COEFF = 0.8;

// Push the car back inside the wall envelope and reflect its velocity. Probes each OBB corner,
// resolves on the worst-penetrating corner only — single-axis fixes per frame keep the car from
// jittering in tight runoff geometry. Emits a spark burst + wall-thump when the impact is real
// (above the threshold); silent grazes pass through.
export function applyTrackBounds(
  car: Car,
  track: Track,
  fx: RaceFx,
  audioBus: AudioBus | null,
): void {
  const half = track.width / 2;

  car.onTrack = track.probe(car.x, car.y).distance <= half;

  let worstOverflow = 0;
  let worstNx = 0;
  let worstNy = 0;
  let worstHitX = 0;
  let worstHitY = 0;
  for (const c of car.corners()) {
    const probe = track.probe(c.x, c.y);
    const wallAt = track.wallOffset(probe.side, probe.index);
    const overflow = probe.distance - wallAt;
    if (overflow > worstOverflow) {
      worstOverflow = overflow;
      worstNx = probe.nx;
      worstNy = probe.ny;
      worstHitX = c.x;
      worstHitY = c.y;
    }
  }

  if (worstOverflow <= 0) return;

  car.sprite.x -= worstNx * worstOverflow;
  car.sprite.y -= worstNy * worstOverflow;

  const vn = car.vx * worstNx + car.vy * worstNy;
  if (vn <= 0) return;

  const tx = -worstNy;
  const ty = worstNx;
  const vt = car.vx * tx + car.vy * ty;
  const newVn = -vn * WALL_RESTITUTION;
  const newVt = vt * WALL_TANGENTIAL_SCRUB;
  car.vx = worstNx * newVn + tx * newVt;
  car.vy = worstNy * newVn + ty * newVt;

  if (vn <= SPARK_VN_THRESHOLD) return;

  // Push the emit point slightly off the wall so sparks don't visually clip into it.
  const hx = worstHitX - worstNx * 2;
  const hy = worstHitY - worstNy * 2;
  const count = Math.min(20, Math.round(vn / 18));
  fx.sparkBurst(hx, hy, count);
  if (audioBus) {
    // Map vn 60 → ~0, vn 360 → 1. Same threshold as sparks so visual + audio agree.
    const intensity = Math.min(1, (vn - SPARK_VN_THRESHOLD) / 300);
    playWallThumpSfx(audioBus, hx, hy, intensity);
  }
}

// All-pairs car-vs-car SAT collision resolution. Broad-phase: bounding-circle reject. Narrow:
// minimum-translation OBB. Resolution: split overlap 50/50, normal-direction impulse only when
// closing.
export function handleCarCollisions(cars: readonly Car[]): void {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const broad = a.halfLength + b.halfLength;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy > broad * broad) continue;

      const mtv = obbOverlap(a, b);
      if (!mtv) continue;

      const halfOverlap = mtv.overlap / 2;
      a.sprite.x -= mtv.nx * halfOverlap;
      a.sprite.y -= mtv.ny * halfOverlap;
      b.sprite.x += mtv.nx * halfOverlap;
      b.sprite.y += mtv.ny * halfOverlap;

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * mtv.nx + rvy * mtv.ny;
      if (vn < 0) {
        const impulse = -vn * CAR_IMPULSE_COEFF;
        a.vx -= mtv.nx * impulse;
        a.vy -= mtv.ny * impulse;
        b.vx += mtv.nx * impulse;
        b.vy += mtv.ny * impulse;
      }
    }
  }
}

function obbOverlap(
  a: Car,
  b: Car,
): { nx: number; ny: number; overlap: number } | null {
  const aAxes = [
    { x: Math.cos(a.heading), y: Math.sin(a.heading) },
    { x: -Math.sin(a.heading), y: Math.cos(a.heading) },
  ];
  const bAxes = [
    { x: Math.cos(b.heading), y: Math.sin(b.heading) },
    { x: -Math.sin(b.heading), y: Math.cos(b.heading) },
  ];
  const axes = [...aAxes, ...bAxes];
  const aCorners = a.corners();
  const bCorners = b.corners();

  let minOverlap = Infinity;
  let mtvNx = 0;
  let mtvNy = 0;

  for (const axis of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const c of aCorners) {
      const p = c.x * axis.x + c.y * axis.y;
      if (p < aMin) aMin = p;
      if (p > aMax) aMax = p;
    }
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const c of bCorners) {
      const p = c.x * axis.x + c.y * axis.y;
      if (p < bMin) bMin = p;
      if (p > bMax) bMax = p;
    }
    const overlap = Math.min(aMax - bMin, bMax - aMin);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const aCenterProj = a.x * axis.x + a.y * axis.y;
      const bCenterProj = b.x * axis.x + b.y * axis.y;
      const sign = bCenterProj > aCenterProj ? 1 : -1;
      mtvNx = axis.x * sign;
      mtvNy = axis.y * sign;
    }
  }

  return { nx: mtvNx, ny: mtvNy, overlap: minOverlap };
}
