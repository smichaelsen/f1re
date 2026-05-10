import { Car } from "../entities/Car";
import { Track } from "../entities/Track";
import { type PositionRow } from "../ui/Hud";

// Race-order ranking. Active cars sort by progress (laps × cps + crossed-this-lap), tiebreaking
// on distance to the next checkpoint so two cars on the same checkpoint resolve smoothly. Finished
// cars sort ahead of active ones, themselves ranked by lap count then finish time — handles
// lapped cars finishing later.
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
    if (a.car.finishedAtMs != null && b.car.finishedAtMs != null) {
      if (a.car.lap !== b.car.lap) return b.car.lap - a.car.lap;
      return a.car.finishedAtMs - b.car.finishedAtMs;
    }
    if (a.car.finishedAtMs != null) return -1;
    if (b.car.finishedAtMs != null) return 1;
    if (b.progress !== a.progress) return b.progress - a.progress;
    return a.distToNext - b.distToNext;
  });
  return rows.map((r) => r.car);
}

export function computePositions(cars: readonly Car[], track: Track): PositionRow[] {
  return rankedCars(cars, track).map((car, i) => ({
    pos: i + 1,
    name: car.name,
    isPlayer: car.isPlayer,
    lapsDone: car.lap,
    finished: car.finishedAtMs != null,
    textureKey: car.sprite.texture.key,
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
