import { Car } from "../entities/Car";
import { Track } from "../entities/Track";
import { type PositionRow } from "../ui/Hud";

// Race-order ranking. Primary key is cumulative progress (laps × cps + crossed-this-lap), so a
// lapped car can never out-rank a car that has actually completed more checkpoints — even if the
// lapped car gets `finishedAtMs` set first by the winner-already-finished branch. Tiebreakers, in
// order: finished cars beat active cars at the same progress (winner edges out a still-rolling car
// on the same lap), earlier finish wins between two finished cars at the same progress, and
// distance-to-next-checkpoint resolves two active cars sharing the same gate.
export function rankedCars(cars: readonly Car[], track: Track): Car[] {
  const ncp = track.checkpoints.length;
  const rows = cars.map((c) => {
    const crossedThisLap = (c.nextCheckpoint - 1 + ncp) % ncp;
    const progress = c.lap * ncp + crossedThisLap;
    const cp = track.checkpoints[c.nextCheckpoint];
    const distToNext = Math.hypot(c.x - cp.x, c.y - cp.y);
    return { car: c, progress, distToNext };
  });
  rows.sort((a, b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    if (a.car.finishedAtMs != null && b.car.finishedAtMs != null) {
      return a.car.finishedAtMs - b.car.finishedAtMs;
    }
    if (a.car.finishedAtMs != null) return -1;
    if (b.car.finishedAtMs != null) return 1;
    return a.distToNext - b.distToNext;
  });
  return rows.map((r) => r.car);
}

// Leaderboard-icon spin on weapon hit: two full turns, ease-out so it whips then settles.
// Two whole turns means the icon lands back at rotation 0 when the animation completes.
const HIT_SPIN_MS = 1200;
const HIT_SPIN_TURNS = 2;

function hitSpinRotation(car: Car): number {
  if (car.hitSpinStartMs < 0) return 0;
  const t = (car.scene.time.now - car.hitSpinStartMs) / HIT_SPIN_MS;
  if (t >= 1) return 0;
  const ease = 1 - Math.pow(1 - t, 3);
  return ease * HIT_SPIN_TURNS * Math.PI * 2;
}

export function computePositions(cars: readonly Car[], track: Track): PositionRow[] {
  return rankedCars(cars, track).map((car, i) => ({
    pos: i + 1,
    name: car.name,
    isPlayer: car.isPlayer,
    lapsDone: car.lap,
    finished: car.finishedAtMs != null,
    textureKey: car.sprite.texture.key,
    iconRotation: hitSpinRotation(car),
  }));
}

// Mm:ss.cs gap formatter; drops the leading `0:` when under one minute. Used for the +N.NN gap
// column in the results panel.
export function formatGap(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  if (m === 0) return `${s}.${cs.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
