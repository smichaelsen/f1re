import Phaser from "phaser";
import { Car, SHIELD_COLOR, SHIELD_DURATION_MS } from "../entities/Car";
import { Track } from "../entities/Track";
import { AudioBus } from "../audio/AudioBus";
import { playPickupChime } from "../audio/PickupChime";
import {
  playBoostSfx,
  playMissileLaunchSfx,
  playSeekerLaunchSfx,
  playOilDropSfx,
  playShieldUpSfx,
  playExplosionSfx,
  playSpinoutSfx,
  playShieldBlockSfx,
} from "../audio/ItemSfx";
import { AIDriver } from "../ai/AIDriver";
import { ITEM_INVENTORY_SIZE, randomItem, type Item } from "../entities/Items";

interface Pickup {
  sprite: Phaser.GameObjects.Sprite;
  active: boolean;
  respawnAt: number;
}

interface OilSlick {
  sprite: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  expiresAt: number;
}

interface Missile {
  sprite: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  // The car that fired this missile. Anyone *else* — humans or AI — is a valid target,
  // including the other human in 2P mode (player-on-player is intentional).
  owner: Car;
  expiresAt: number;
}

interface Seeker {
  sprite: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: Car;
  expiresAt: number;
  // While following the racing line: index of the next centerline node to steer toward.
  // Set to null on target lock — the seeker then homes in like a missile and never returns
  // to the centerline (one-way transition).
  nodeIdx: number | null;
}

// One pickup roughly every PICKUP_SPACING units of track, clamped to [PICKUP_MIN, PICKUP_MAX].
// Stadium with a fixed 8 felt overcrowded because the pickups bunch into the same corridor band
// on its short connecting arcs; scaling with arc length keeps density consistent across tracks.
const PICKUP_SPACING = 700;
const PICKUP_MIN = 4;
const PICKUP_MAX = 12;

const MISSILE_SPEED = 520;
const MISSILE_TURN_RATE = 4.5;
const MISSILE_LOCK_RANGE = 220;
const MISSILE_HIT_RADIUS = 22;
const MISSILE_LIFETIME_MS = 4000;

const SEEKER_SPEED = 700;
const SEEKER_LOCK_RADIUS = 140;
const SEEKER_NODE_ARRIVE_R2 = 144; // 12 px node-arrival threshold
const SEEKER_HIT_RADIUS = 22;
const SEEKER_LIFETIME_MS = 9000;

const OIL_HIT_RADIUS = 22;
const OIL_LIFETIME_MS = 12000;

const PICKUP_GRAB_RADIUS = 22;
const PICKUP_RESPAWN_MS = 1750;

export class ItemSystem {
  private pickups: Pickup[] = [];
  private oilSlicks: OilSlick[] = [];
  private missiles: Missile[] = [];
  private seekers: Seeker[] = [];

  constructor(
    private scene: Phaser.Scene,
    private track: Track,
    private uiCam: Phaser.Cameras.Scene2D.Camera,
    private cars: readonly Car[],
    private aiDriver: AIDriver,
    private getAudioBus: () => AudioBus | null,
    private flashFor: (car: Car, text: string, ms: number) => void,
  ) {}

  spawn(): void {
    const count = this.pickupCountForTrack();
    for (let i = 0; i < count; i++) {
      const sprite = this.scene.add.sprite(0, 0, "pickup").setDepth(5);
      this.uiCam.ignore(sprite);
      const pickup: Pickup = { sprite, active: true, respawnAt: 0 };
      this.pickups.push(pickup);
      this.scene.tweens.add({
        targets: sprite,
        scale: { from: 0.9, to: 1.15 },
        yoyo: true,
        repeat: -1,
        duration: 600,
      });
      this.relocatePickup(pickup);
    }
  }

  update(dt: number, now: number): void {
    this.updatePickups(now);
    this.updateOilSlicks(now);
    this.updateMissiles(dt, now);
    this.updateSeekers(dt, now);
  }

  // Shift every timestamp owned by ItemSystem forward by `dt` ms. Used by RaceScene's
  // pause-resume path so pickup respawns + projectile lifetimes don't all expire as if
  // the pause never happened.
  shiftTime(dt: number): void {
    for (const p of this.pickups) p.respawnAt += dt;
    for (const m of this.missiles) m.expiresAt += dt;
    for (const s of this.seekers) s.expiresAt += dt;
    for (const o of this.oilSlicks) o.expiresAt += dt;
  }

  useItem(car: Car): void {
    if (car.items.length === 0) return;
    const item = car.items.shift() as Item;
    car.useItemAt = null;
    if (!car.isPlayer) this.aiDriver.onConsume(car, this.scene.time.now);
    const bus = this.getAudioBus();
    switch (item) {
      case "boost":
        car.giveBoost(2.0);
        if (bus) playBoostSfx(bus, car.x, car.y);
        this.flashFor(car, "BOOST!", 700);
        break;
      case "missile":
        this.fireMissile(car);
        if (bus) playMissileLaunchSfx(bus, car.x, car.y);
        this.flashFor(car, "MISSILE!", 700);
        break;
      case "seeker":
        this.fireSeeker(car);
        if (bus) playSeekerLaunchSfx(bus, car.x, car.y);
        this.flashFor(car, "SEEKER!", 700);
        break;
      case "oil":
        this.dropOil(car);
        if (bus) playOilDropSfx(bus, car.x, car.y);
        this.flashFor(car, "OIL!", 700);
        break;
      case "shield":
        car.shielded = true;
        car.shieldExpiresAt = this.scene.time.now + SHIELD_DURATION_MS;
        if (bus) playShieldUpSfx(bus, car.x, car.y);
        this.flashFor(car, "SHIELD!", 700);
        break;
    }
  }

  private pickupCountForTrack(): number {
    const cum = this.track.centerlineCumS;
    const total = cum.length > 0 ? cum[cum.length - 1] : 0;
    if (total <= 0) return PICKUP_MIN;
    return Phaser.Math.Clamp(Math.round(total / PICKUP_SPACING), PICKUP_MIN, PICKUP_MAX);
  }

  // Picks a fresh random spot for the pickup: any centerline point, lateral offset uniform in
  // ±width/4 (so the inner half of the asphalt — the outer 25% on each side is excluded). Tries a
  // few times to avoid landing on top of another active pickup; gives up after 8 attempts and
  // accepts whatever it has.
  private relocatePickup(p: Pickup): void {
    const pts = this.track.centerline;
    const n = pts.length;
    const halfRange = this.track.width / 4;
    const minSep = 80;
    let chosenX = 0;
    let chosenY = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const idx = Math.floor(Math.random() * n);
      const a = pts[idx];
      const b = pts[(idx + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const lat = (Math.random() * 2 - 1) * halfRange;
      chosenX = a.x + nx * lat;
      chosenY = a.y + ny * lat;
      let collision = false;
      for (const other of this.pickups) {
        if (other === p) continue;
        if (!other.active) continue;
        if (Phaser.Math.Distance.Between(other.sprite.x, other.sprite.y, chosenX, chosenY) < minSep) {
          collision = true;
          break;
        }
      }
      if (!collision) break;
    }
    p.sprite.setPosition(chosenX, chosenY);
  }

  private updatePickups(now: number): void {
    for (const p of this.pickups) {
      if (!p.active) {
        if (now >= p.respawnAt) {
          // Pick a fresh random location each respawn so item placement varies across the race
          // rather than circling back to the same 8 spots.
          this.relocatePickup(p);
          p.active = true;
          p.sprite.setVisible(true);
        }
        continue;
      }
      for (const c of this.cars) {
        if (Phaser.Math.Distance.Between(c.x, c.y, p.sprite.x, p.sprite.y) < PICKUP_GRAB_RADIUS) {
          // Inventory cap. Cars at capacity skip the box (it stays active so others can grab it).
          if (c.items.length >= ITEM_INVENTORY_SIZE) continue;
          c.items.push(randomItem());
          if (!c.isPlayer) this.aiDriver.onPickup(c, now);
          p.active = false;
          p.sprite.setVisible(false);
          p.respawnAt = now + PICKUP_RESPAWN_MS;
          // Only humans trigger the chime — AI pickups are silent. The chime is feedback
          // for the player who grabbed the box, not a positional cue about distant traffic.
          const bus = this.getAudioBus();
          if (bus && c.isPlayer) playPickupChime(bus, p.sprite.x, p.sprite.y);
          break;
        }
      }
    }
  }

  private fireMissile(owner: Car): void {
    const fx = Math.cos(owner.heading);
    const fy = Math.sin(owner.heading);
    const g = this.scene.add.graphics();
    g.fillStyle(0xff5050, 1);
    g.fillCircle(0, 0, 4);
    g.lineStyle(2, 0xffaa00, 1);
    g.strokeCircle(0, 0, 6);
    g.setDepth(8);
    const x = owner.x + fx * 24;
    const y = owner.y + fy * 24;
    g.setPosition(x, y);
    this.uiCam.ignore(g);
    this.missiles.push({
      sprite: g,
      x, y,
      vx: fx * MISSILE_SPEED + owner.vx * 0.5,
      vy: fy * MISSILE_SPEED + owner.vy * 0.5,
      owner,
      expiresAt: this.scene.time.now + MISSILE_LIFETIME_MS,
    });
  }

  private updateMissiles(dt: number, now: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.sprite.setPosition(m.x, m.y);

      // Lock onto any non-owner car within range, regardless of human/AI status.
      let nearest: Car | null = null;
      let nearestD = Infinity;
      for (const c of this.cars) {
        if (c === m.owner) continue;
        const d = Phaser.Math.Distance.Between(c.x, c.y, m.x, m.y);
        if (d < nearestD) { nearestD = d; nearest = c; }
      }
      if (nearest && nearestD < MISSILE_LOCK_RANGE) {
        const ang = Math.atan2(nearest.y - m.y, nearest.x - m.x);
        const speed = Math.hypot(m.vx, m.vy);
        const turn = MISSILE_TURN_RATE * dt;
        const cur = Math.atan2(m.vy, m.vx);
        const newAng = cur + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(ang - cur), -turn, turn);
        m.vx = Math.cos(newAng) * speed;
        m.vy = Math.sin(newAng) * speed;
      }

      let hit = false;
      for (const c of this.cars) {
        if (c === m.owner) continue;
        if (Phaser.Math.Distance.Between(c.x, c.y, m.x, m.y) < MISSILE_HIT_RADIUS) {
          if (c.spin(1.2)) {
            const bus = this.getAudioBus();
            if (bus) playExplosionSfx(bus, c.x, c.y);
          } else {
            this.spawnShieldFlash(c);
          }
          hit = true;
          break;
        }
      }

      if (hit || now > m.expiresAt) {
        m.sprite.destroy();
        this.missiles.splice(i, 1);
      }
    }
  }

  private fireSeeker(owner: Car): void {
    const cl = this.track.centerline;
    const n = cl.length;
    if (n < 2) return;

    // Walk forward along the centerline ~24 px from the firing car's projected position.
    // probe.index already gives us a forward-leaning node (it advances when t >= 0.5),
    // so we start from there and accumulate segment lengths until we cover the offset.
    const probe = this.track.probe(owner.x, owner.y);
    let idx = probe.index;
    let acc = Math.hypot(cl[idx].x - owner.x, cl[idx].y - owner.y);
    let safety = n;
    while (acc < 24 && safety-- > 0) {
      const next = (idx + 1) % n;
      acc += Math.hypot(cl[next].x - cl[idx].x, cl[next].y - cl[idx].y);
      idx = next;
    }
    const sx = cl[idx].x;
    const sy = cl[idx].y;
    const nodeIdx = (idx + 1) % n;
    const tdx = cl[nodeIdx].x - sx;
    const tdy = cl[nodeIdx].y - sy;
    const tlen = Math.hypot(tdx, tdy) || 1;

    const g = this.scene.add.graphics();
    g.fillStyle(0x40e0ff, 1);
    g.fillCircle(0, 0, 5);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(0, 0, 8);
    g.setDepth(8);
    g.setPosition(sx, sy);
    this.uiCam.ignore(g);

    this.seekers.push({
      sprite: g,
      x: sx,
      y: sy,
      vx: (tdx / tlen) * SEEKER_SPEED,
      vy: (tdy / tlen) * SEEKER_SPEED,
      owner,
      expiresAt: this.scene.time.now + SEEKER_LIFETIME_MS,
      nodeIdx,
    });
  }

  private updateSeekers(dt: number, now: number): void {
    const cl = this.track.centerline;
    const n = cl.length;

    for (let i = this.seekers.length - 1; i >= 0; i--) {
      const s = this.seekers[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.sprite.setPosition(s.x, s.y);

      // Find nearest non-owner; gates the lock-on transition.
      let nearest: Car | null = null;
      let nearestD = Infinity;
      for (const c of this.cars) {
        if (c === s.owner) continue;
        const d = Phaser.Math.Distance.Between(c.x, c.y, s.x, s.y);
        if (d < nearestD) { nearestD = d; nearest = c; }
      }

      if (s.nodeIdx != null && nearest && nearestD < SEEKER_LOCK_RADIUS) {
        // First-time lock-on. Drop the centerline state — from here on it homes like a missile.
        s.nodeIdx = null;
      }

      if (s.nodeIdx == null) {
        // Homing mode: same turn-cap behaviour as the missile, no range gate once locked.
        if (nearest) {
          const ang = Math.atan2(nearest.y - s.y, nearest.x - s.x);
          const cur = Math.atan2(s.vy, s.vx);
          const turn = MISSILE_TURN_RATE * dt;
          const newAng = cur + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(ang - cur), -turn, turn);
          s.vx = Math.cos(newAng) * SEEKER_SPEED;
          s.vy = Math.sin(newAng) * SEEKER_SPEED;
        }
      } else {
        // Centerline-follow: steer straight at the next node, advance when we're close enough.
        let safety = n;
        let target = cl[s.nodeIdx];
        let dx = target.x - s.x;
        let dy = target.y - s.y;
        while (dx * dx + dy * dy < SEEKER_NODE_ARRIVE_R2 && safety-- > 0) {
          s.nodeIdx = (s.nodeIdx + 1) % n;
          target = cl[s.nodeIdx];
          dx = target.x - s.x;
          dy = target.y - s.y;
        }
        const len = Math.hypot(dx, dy) || 1;
        s.vx = (dx / len) * SEEKER_SPEED;
        s.vy = (dy / len) * SEEKER_SPEED;
      }

      let hit = false;
      for (const c of this.cars) {
        if (c === s.owner) continue;
        if (Phaser.Math.Distance.Between(c.x, c.y, s.x, s.y) < SEEKER_HIT_RADIUS) {
          if (c.spin(1.2)) {
            const bus = this.getAudioBus();
            if (bus) playExplosionSfx(bus, c.x, c.y);
          } else {
            this.spawnShieldFlash(c);
          }
          hit = true;
          break;
        }
      }

      if (hit || now > s.expiresAt) {
        s.sprite.destroy();
        this.seekers.splice(i, 1);
      }
    }
  }

  private dropOil(owner: Car): void {
    const fx = Math.cos(owner.heading);
    const fy = Math.sin(owner.heading);
    const x = owner.x - fx * 26;
    const y = owner.y - fy * 26;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.85);
    g.fillCircle(0, 0, 22);
    g.fillStyle(0x222222, 0.6);
    g.fillCircle(6, -4, 14);
    g.setPosition(x, y);
    g.setDepth(3);
    this.uiCam.ignore(g);
    this.oilSlicks.push({ sprite: g, x, y, expiresAt: this.scene.time.now + OIL_LIFETIME_MS });
  }

  private updateOilSlicks(now: number): void {
    for (let i = this.oilSlicks.length - 1; i >= 0; i--) {
      const o = this.oilSlicks[i];
      if (now > o.expiresAt) {
        o.sprite.destroy();
        this.oilSlicks.splice(i, 1);
        continue;
      }
      for (const c of this.cars) {
        if (Phaser.Math.Distance.Between(c.x, c.y, o.x, o.y) < OIL_HIT_RADIUS) {
          if (c.spin(0.9)) {
            const bus = this.getAudioBus();
            if (bus) playSpinoutSfx(bus, c.x, c.y);
          } else {
            this.spawnShieldFlash(c);
          }
          o.sprite.destroy();
          this.oilSlicks.splice(i, 1);
          break;
        }
      }
    }
  }

  private spawnShieldFlash(car: Car): void {
    const bus = this.getAudioBus();
    if (bus) playShieldBlockSfx(bus, car.x, car.y);
    const g = this.scene.add.graphics();
    g.setDepth(9);
    this.uiCam.ignore(g);
    const cx = car.x;
    const cy = car.y;
    const state = { r: 18, w: 4, a: 1 };
    this.scene.tweens.add({
      targets: state,
      r: 56,
      w: 1,
      a: 0,
      duration: 380,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        g.clear();
        g.lineStyle(state.w, SHIELD_COLOR, state.a);
        g.strokeCircle(0, 0, state.r);
        g.setPosition(cx, cy);
      },
      onComplete: () => g.destroy(),
    });
    this.flashFor(car, "BLOCKED!", 600);
  }
}
