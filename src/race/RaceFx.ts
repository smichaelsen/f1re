import Phaser from "phaser";
import { Car } from "../entities/Car";
import { Track } from "../entities/Track";
import { SkidMarks } from "../entities/SkidMarks";
import { DustParticles } from "../entities/DustParticles";
import { SparkParticles } from "../entities/SparkParticles";
import { DrsAirflow } from "../entities/DrsAirflow";

const SKID_ALPHA_PER_FRAME = 0.06;
const DUST_SPEED_FLOOR = 60;
const DRS_AIRFLOW_SPEED_FLOOR = 260;
// Margin generous enough to cover walls + any off-track skid drift before the bounds clip kicks in.
const SKID_BOUNDS_MARGIN = 200;

export class RaceFx {
  private skidMarks: SkidMarks;
  private dust: DustParticles;
  private sparks: SparkParticles;
  private drsAirflow: DrsAirflow;
  private drsAirflowParity = false;

  constructor(scene: Phaser.Scene, private track: Track) {
    this.skidMarks = createSkidMarks(scene, track);
    this.dust = new DustParticles(scene);
    this.sparks = new SparkParticles(scene);
    this.drsAirflow = new DrsAirflow(scene);
  }

  // Tick all per-frame particle systems. No-op when not actively racing — particles freeze
  // during countdown and post-race so finished cars don't keep dropping skid marks.
  update(
    dt: number,
    cars: readonly Car[],
    racing: boolean,
    getSkidIntensity: (car: Car) => number,
  ): void {
    if (!racing) return;
    this.updateSkidMarks(dt, cars, getSkidIntensity);
    this.updateDust(cars);
    this.updateDrsAirflow(cars);
  }

  sparkBurst(x: number, y: number, count: number): void {
    this.sparks.burst(x, y, count);
  }

  // Drop a stamp at each of the car's 4 OBB corners while it's actually skidding.
  // Reuses the audio gate (slip ratio + speed/lateral floors) so straight-line driving, even on
  // grass, leaves no marks; only real sliding does. Per-frame alpha is normalized to dt*60 so
  // 30fps and 60fps build up at the same rate per second.
  private updateSkidMarks(
    dt: number,
    cars: readonly Car[],
    getSkidIntensity: (car: Car) => number,
  ): void {
    const dtScale = Math.min(2, dt * 60);
    // First pass: pick the cars that are actually skidding so we can skip the batch entirely
    // when nothing is sliding (very common — saves the render-target bind/unbind cost).
    const skidders: { car: Car; alpha: number }[] = [];
    for (const car of cars) {
      const intensity = getSkidIntensity(car);
      if (intensity <= 0) continue;
      skidders.push({ car, alpha: SKID_ALPHA_PER_FRAME * intensity * dtScale });
    }
    if (skidders.length === 0) return;
    this.skidMarks.beginFrame();
    for (const s of skidders) {
      for (const c of s.car.corners()) {
        this.skidMarks.drawAt(c.x, c.y, s.car.heading, s.alpha);
      }
    }
    this.skidMarks.endFrame();
  }

  // Probe each car's two rear corners. Whenever a rear corner is on a non-asphalt surface
  // and the car is moving fast enough to actually kick up dirt, emit one dust puff there.
  // Per-frame emission means the visual density auto-scales with frame rate for a moment, but
  // the puffs themselves have absolute lifespans so the cloud size is bounded.
  private updateDust(cars: readonly Car[]): void {
    for (const car of cars) {
      if (car.speed < DUST_SPEED_FLOOR) continue;
      const corners = car.corners();
      // corners() order is [rear-left, front-left, front-right, rear-right] in body local space.
      const rearCorners = [corners[0], corners[3]];
      for (const c of rearCorners) {
        const surf = this.track.surfaceAt(c.x, c.y);
        if (surf === "asphalt") continue;
        this.dust.emitAt(c.x, c.y, 1);
      }
    }
  }

  // For each car with drsActive AND speed above the floor, spawn a single airflow streak behind
  // the rear wing each frame, alternating left/right rear corners so the trail reads as twin
  // streaks without doubling the per-frame particle count. Tuned subtle — DRS shouldn't visually
  // dominate the screen, just hint at the slipstream.
  private updateDrsAirflow(cars: readonly Car[]): void {
    this.drsAirflowParity = !this.drsAirflowParity;
    const sideSign = this.drsAirflowParity ? 1 : -1;
    for (const car of cars) {
      if (!car.drsActive) continue;
      if (car.speed < DRS_AIRFLOW_SPEED_FLOOR) continue;
      const fx = Math.cos(car.heading);
      const fy = Math.sin(car.heading);
      const rearX = car.x - fx * (car.halfLength - 2);
      const rearY = car.y - fy * (car.halfLength - 2);
      const lateral = car.halfWidth * 0.5 * sideSign;
      const lx = -fy * lateral;
      const ly = fx * lateral;
      this.drsAirflow.emitAt(rearX + lx, rearY + ly, -fx, -fy);
    }
  }
}

function createSkidMarks(scene: Phaser.Scene, track: Track): SkidMarks {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of track.centerline) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return new SkidMarks(scene, {
    x: minX - SKID_BOUNDS_MARGIN,
    y: minY - SKID_BOUNDS_MARGIN,
    width: maxX - minX + SKID_BOUNDS_MARGIN * 2,
    height: maxY - minY + SKID_BOUNDS_MARGIN * 2,
  });
}
