import Phaser from "phaser";
import type { CarConfig } from "../types";

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  useItem: boolean;
  /**
   * Manual DRS activation pulse. The InputReader sets this to true on the press edge of the
   * DRS key/button; RaceScene consumes it inside an active DRS zone if `Car.drsAvailable`
   * is true and the player's mode is "manual". Held state is irrelevant — only the edge
   * counts. Auto mode ignores this entirely.
   */
  useDrs: boolean;
}

export interface SurfaceFeel {
  drag: number;
  // 0..1 target multiplier on baseline grip from the surface under the car.
  // 1.0 = asphalt; lower values depress car.gripFactor.
  gripFactor: number;
}

export const DEFAULT_CAR: CarConfig = {
  maxSpeed: 360,
  accel: 280,
  brake: 520,
  reverseSpeed: 120,
  turnRate: 2.5,
  grip: 1.0,
  drag: 0.6,
  offTrackDrag: 3.5,
  bodyColor: 0xe10600,
};

const DEFAULT_FEEL: SurfaceFeel = { drag: 0.6, gripFactor: 1.0 };

// Asphalt-baseline lateral grip exponent. Final grip = BASE_GRIP * cfg.grip * car.gripFactor.
const BASE_GRIP = 4.0;
// Time, in seconds, to recover from gripFactor 0 → 1 once the depressing condition (e.g. grass) is removed.
const GRIP_RECOVERY_SEC = 1.0;

export const SHIELD_COLOR = 0x88ccff;

// DRS effect strengths. Top-speed gets a small bump and drag is shaved on top of the
// surface-driven drag. Both stack with item boost; AI uses the same numbers. Tuned subtle —
// the gain should feel like a trailing chase advantage, not a second boost item.
export const DRS_TOP_SPEED_MULT = 1.06;
export const DRS_DRAG_MULT = 0.88;

export class Car {
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.Sprite;
  shieldRing: Phaser.GameObjects.Graphics;
  vx = 0;
  vy = 0;
  heading = 0;
  config: CarConfig;
  onTrack = true;
  boostTimer = 0;
  spinTimer = 0;
  shielded = false;
  // Slipstream multiplier applied to accel + max speed. 1.0 = no draft. Set per-frame by RaceScene.
  draft = 1.0;
  // Throttle the audio layer should treat as "commanded right now". Set by RaceScene
  // alongside (or in lieu of) the physics input — it survives the countdown freeze so
  // the engine can rev on the grid without affecting movement.
  audioThrottle = 0;
  // 0..1 multiplier on baseline grip. Snaps down when a surface or event requests a penalty;
  // recovers linearly toward 1 over GRIP_RECOVERY_SEC. Drives lateral traction in update().
  gripFactor = 1;
  // FIFO inventory: oldest item at index 0, newest at the end. Use consumes from the front.
  // Capacity is enforced by RaceScene at pickup time (currently 2).
  items: string[] = [];
  useItemAt: number | null = null;

  // DRS state. `drsAvailable` is set when the car crosses a detection point within DRS_GAP_MS of
  // the previous crosser; cleared at the next detection point or zone end after activation.
  // `drsActive` is the live effect flag — set when the car activates DRS inside a zone, cleared
  // by RaceScene on lift, brake, or zone exit.
  drsAvailable = false;
  drsActive = false;

  name: string;
  isPlayer: boolean;
  // 0 = P1, 1 = P2 in 2-player mode; null for AI. Lets HUD flashes/results disambiguate the two humans.
  playerIndex: number | null = null;
  lap = 0;
  nextCheckpoint = 0;
  // Wall-clock time of the last checkpoint advance. Used by the auto-unstuck watchdog —
  // any car that hasn't progressed in 60s gets teleported back to its last gate. Set to
  // `raceStartedAt` on the GO! transition and updated whenever `nextCheckpoint` ticks.
  lastCheckpointMs = 0;
  bestLapMs: number | null = null;
  currentLapStartMs = 0;
  finishedAtMs: number | null = null;

  halfLength = 18;
  halfWidth = 9;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    name: string,
    isPlayer: boolean,
    config = DEFAULT_CAR,
  ) {
    this.scene = scene;
    this.config = config;
    this.name = name;
    this.isPlayer = isPlayer;
    this.sprite = scene.add.sprite(x, y, textureKey);
    this.sprite.setDepth(10);
    this.shieldRing = scene.add.graphics();
    this.shieldRing.setDepth(11);
    this.shieldRing.setVisible(false);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get lateralSpeed() {
    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    return Math.abs(-this.vx * fy + this.vy * fx);
  }

  corners(): { x: number; y: number }[] {
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const hl = this.halfLength;
    const hw = this.halfWidth;
    const local: [number, number][] = [
      [-hl, -hw],
      [hl, -hw],
      [hl, hw],
      [-hl, hw],
    ];
    return local.map(([lx, ly]) => ({
      x: this.x + lx * cos - ly * sin,
      y: this.y + lx * sin + ly * cos,
    }));
  }

  update(dt: number, input: CarInput, feel: SurfaceFeel = DEFAULT_FEEL) {
    const cfg = this.config;

    // Surface acts as an instantaneous floor on gripFactor; recovery is linear over GRIP_RECOVERY_SEC.
    if (feel.gripFactor < this.gripFactor) {
      this.gripFactor = feel.gripFactor;
    } else {
      this.gripFactor = Math.min(1, this.gripFactor + dt / GRIP_RECOVERY_SEC);
    }

    if (this.spinTimer > 0) {
      this.spinTimer -= dt;
      this.heading += dt * 12;
      this.vx *= Math.pow(0.2, dt);
      this.vy *= Math.pow(0.2, dt);
    } else {
      const speed = this.speed;
      const steerEffect = Phaser.Math.Clamp(speed / 80, 0, 1);
      this.heading += input.steer * cfg.turnRate * steerEffect * dt;

      const fx = Math.cos(this.heading);
      const fy = Math.sin(this.heading);

      const boost = this.boostTimer > 0 ? 1.6 : 1.0;
      const drsTop = this.drsActive ? DRS_TOP_SPEED_MULT : 1.0;
      // gripFactor gates longitudinal traction too: throttle and brake both rely on tire-to-surface friction,
      // so a low-grip surface (grass / fresh recovery) loses acceleration and braking authority together.
      const traction = this.gripFactor;
      if (input.throttle > 0) {
        this.vx += fx * cfg.accel * input.throttle * boost * this.draft * traction * dt;
        this.vy += fy * cfg.accel * input.throttle * boost * this.draft * traction * dt;
      }
      if (input.brake > 0) {
        const forwardDot = this.vx * fx + this.vy * fy;
        if (forwardDot > 0) {
          const decel = cfg.brake * input.brake * traction * dt;
          const sp = this.speed;
          const reduce = Math.min(decel, sp);
          this.vx -= (this.vx / sp) * reduce;
          this.vy -= (this.vy / sp) * reduce;
        } else {
          this.vx -= fx * cfg.accel * 0.5 * traction * dt;
          this.vy -= fy * cfg.accel * 0.5 * traction * dt;
        }
      }

      const forwardSpeed = this.vx * fx + this.vy * fy;
      const lateralX = this.vx - fx * forwardSpeed;
      const lateralY = this.vy - fy * forwardSpeed;
      const gripDecay = Math.exp(-BASE_GRIP * cfg.grip * this.gripFactor * dt);
      this.vx -= lateralX * (1 - gripDecay);
      this.vy -= lateralY * (1 - gripDecay);

      const dragK = this.drsActive ? feel.drag * DRS_DRAG_MULT : feel.drag;
      const dragFactor = Math.exp(-dragK * dt);
      this.vx *= dragFactor;
      this.vy *= dragFactor;

      const maxV = cfg.maxSpeed * boost * drsTop * this.draft;
      const sp = this.speed;
      if (sp > maxV) {
        this.vx = (this.vx / sp) * maxV;
        this.vy = (this.vy / sp) * maxV;
      }
    }

    if (this.boostTimer > 0) this.boostTimer -= dt;

    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
    this.sprite.rotation = this.heading;

    this.updateShieldRing();
  }

  private updateShieldRing() {
    const g = this.shieldRing;
    if (!this.shielded) {
      if (g.visible) g.setVisible(false);
      return;
    }
    if (!g.visible) g.setVisible(true);
    const now = this.scene.time.now;
    const pulse = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(now / 180));
    g.clear();
    g.lineStyle(3, SHIELD_COLOR, pulse);
    g.strokeCircle(0, 0, 26);
    g.setPosition(this.x, this.y);
  }

  applyImpulse(ix: number, iy: number) {
    this.vx += ix;
    this.vy += iy;
  }

  // Lower the car's grip floor toward `target` (0..1). Recovery toward 1 happens automatically over GRIP_RECOVERY_SEC.
  // No-op if `target` is already above current gripFactor (penalties only stack downward).
  requestGripPenalty(target: number) {
    const clamped = Math.max(0, Math.min(1, target));
    if (clamped < this.gripFactor) this.gripFactor = clamped;
  }

  spin(seconds = 1.0): boolean {
    if (this.shielded) {
      this.shielded = false;
      return false;
    }
    this.spinTimer = seconds;
    return true;
  }

  giveBoost(seconds = 2.0) {
    this.boostTimer = Math.max(this.boostTimer, seconds);
  }
}
