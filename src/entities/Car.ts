import Phaser from "phaser";
import type { CarConfig } from "../types";

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  useItem: boolean;
}

export interface SurfaceFeel {
  drag: number;
  grip: number;
}

export const DEFAULT_CAR: CarConfig = {
  maxSpeed: 360,
  accel: 280,
  brake: 520,
  reverseSpeed: 120,
  turnRate: 3.2,
  grip: 1.0,
  drag: 0.6,
  offTrackDrag: 3.5,
  bodyColor: 0xe10600,
};

const DEFAULT_FEEL: SurfaceFeel = { drag: 0.6, grip: 4.0 };

export const SHIELD_COLOR = 0x88ccff;

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
  itemSlot: string | null = null;
  useItemAt: number | null = null;

  name: string;
  isPlayer: boolean;
  lap = 0;
  nextCheckpoint = 0;
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
      if (input.throttle > 0) {
        this.vx += fx * cfg.accel * input.throttle * boost * dt;
        this.vy += fy * cfg.accel * input.throttle * boost * dt;
      }
      if (input.brake > 0) {
        const forwardDot = this.vx * fx + this.vy * fy;
        if (forwardDot > 0) {
          const decel = cfg.brake * input.brake * dt;
          const sp = this.speed;
          const reduce = Math.min(decel, sp);
          this.vx -= (this.vx / sp) * reduce;
          this.vy -= (this.vy / sp) * reduce;
        } else {
          this.vx -= fx * cfg.accel * 0.5 * dt;
          this.vy -= fy * cfg.accel * 0.5 * dt;
        }
      }

      const forwardSpeed = this.vx * fx + this.vy * fy;
      const lateralX = this.vx - fx * forwardSpeed;
      const lateralY = this.vy - fy * forwardSpeed;
      const gripFactor = Math.exp(-feel.grip * cfg.grip * dt);
      this.vx -= lateralX * (1 - gripFactor);
      this.vy -= lateralY * (1 - gripFactor);

      const dragFactor = Math.exp(-feel.drag * dt);
      this.vx *= dragFactor;
      this.vy *= dragFactor;

      const maxV = cfg.maxSpeed * boost;
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
