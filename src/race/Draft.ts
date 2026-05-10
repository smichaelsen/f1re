import { Car } from "../entities/Car";

const ALONG_MIN = 20;
const ALONG_MAX = 220;
const LATERAL_MAX = 22;
const HEADING_DOT_MIN = 0.7;
const SPEED_FLOOR = 60;
const MAX_BONUS = 0.05;

// Subtle slipstream: when a car sits ~20-220u behind another car, roughly aligned and laterally
// close, give it a small accel + top-speed bump that ramps with proximity. Max effect at the
// close end of the range; zero at the edges or off-axis. Spinning cars don't draft (and don't
// punch a hole — the wake collapses).
export function computeDraft(car: Car, cars: readonly Car[]): number {
  if (car.spinTimer > 0 || car.speed < SPEED_FLOOR) return 1.0;
  const fx = Math.cos(car.heading);
  const fy = Math.sin(car.heading);
  let best = 1.0;
  for (const other of cars) {
    if (other === car) continue;
    if (other.spinTimer > 0) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const along = dx * fx + dy * fy;
    if (along < ALONG_MIN || along > ALONG_MAX) continue;
    const lat = Math.abs(-dx * fy + dy * fx);
    if (lat > LATERAL_MAX) continue;
    const headingDot = Math.cos(other.heading - car.heading);
    if (headingDot < HEADING_DOT_MIN) continue;
    // Linear ramp: zero at along=ALONG_MAX, peak at along=ALONG_MIN. Long stretch so a chasing
    // car feels the wake from several car lengths back, even if the bonus there is small.
    const proximity = 1 - (along - ALONG_MIN) / (ALONG_MAX - ALONG_MIN);
    const lateralFalloff = 1 - lat / LATERAL_MAX;
    const draft = 1.0 + MAX_BONUS * proximity * lateralFalloff;
    if (draft > best) best = draft;
  }
  return best;
}
