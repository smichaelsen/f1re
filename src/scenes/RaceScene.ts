import Phaser from "phaser";
import { Car, DEFAULT_CAR, SHIELD_COLOR, type CarInput, type SurfaceFeel } from "../entities/Car";
import { Track } from "../entities/Track";
import { parseTrackData, SURFACE_PARAMS } from "../entities/TrackData";
import { Hud, formatRaceTime, type PositionRow } from "../ui/Hud";
import { DIFFICULTIES, LAPS_MAX, LAPS_MIN, OPPONENTS_MAX, OPPONENTS_MIN } from "./MenuScene";
import type { CarColor, Difficulty, TrackKey } from "./MenuScene";
import { AudioBus } from "../audio/AudioBus";
import { EngineSound } from "../audio/EngineSound";

interface RaceInit {
  trackKey?: TrackKey;
  carColor?: CarColor;
  difficulty?: Difficulty;
  laps?: number;
  opponents?: number;
}

const ALL_COLORS: CarColor[] = ["red", "blue", "yellow", "green"];
const COLOR_NAMES: Record<CarColor, string> = {
  red: "RED",
  blue: "BLU",
  yellow: "YEL",
  green: "GRN",
};
const ITEMS = ["boost", "missile", "oil", "shield"] as const;
type Item = (typeof ITEMS)[number];

type RaceState = "countdown" | "racing" | "finished";

interface Pickup {
  sprite: Phaser.GameObjects.Sprite;
  active: boolean;
  respawnAt: number;
  baseX: number;
  baseY: number;
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
  ownerIsPlayer: boolean;
  expiresAt: number;
}

interface AISkillState {
  skill: number;
  aimOffset: number;
  chunk: number;
}

const AIM_CHUNK_SIZE = 6;
const AIM_OFFSET_FLOOR = 0.05;
const AIM_OFFSET_RANGE = 0.5;

const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, useItem: false };

export class RaceScene extends Phaser.Scene {
  player!: Car;
  ai: Car[] = [];
  cars: Car[] = [];
  track!: Track;
  hud!: Hud;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  spaceKey!: Phaser.Input.Keyboard.Key;
  restartKey!: Phaser.Input.Keyboard.Key;

  pickups: Pickup[] = [];
  oilSlicks: OilSlick[] = [];
  missiles: Missile[] = [];

  private aiSkill = new Map<Car, AISkillState>();
  private audioBus: AudioBus | null = null;
  private engines = new Map<Car, EngineSound>();

  state: RaceState = "countdown";
  countdownStartedAt = 0;
  raceStartedAt = 0;
  raceEndedAt = 0;

  trackKey: TrackKey = "oval";
  carColor: CarColor = "red";
  difficulty: Difficulty = "normal";
  totalLaps: number = 3;
  opponentCount: number = 3;
  escapeKey!: Phaser.Input.Keyboard.Key;
  uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super("RaceScene");
  }

  init(data: RaceInit) {
    this.trackKey = data.trackKey ?? "oval";
    this.carColor = data.carColor ?? "red";
    this.difficulty = data.difficulty ?? "normal";
    this.totalLaps = Phaser.Math.Clamp(data.laps ?? 3, LAPS_MIN, LAPS_MAX);
    this.opponentCount = Phaser.Math.Clamp(data.opponents ?? 3, OPPONENTS_MIN, OPPONENTS_MAX);
  }

  preload() {
    const key = `track-${this.trackKey}`;
    if (!this.cache.json.has(key)) {
      this.load.json(key, `tracks/${this.trackKey}.json`);
    }
  }

  create() {
    this.ai = [];
    this.cars = [];
    this.pickups = [];
    this.oilSlicks = [];
    this.missiles = [];
    this.aiSkill.clear();
    this.engines.clear();
    this.audioBus = null;
    this.state = "countdown";
    this.raceStartedAt = 0;
    this.raceEndedAt = 0;

    const raw = this.cache.json.get(`track-${this.trackKey}`);
    this.track = Track.fromData(this, parseTrackData(raw));

    const playerSlot = this.startGridSlot(0);
    this.player = new Car(
      this,
      playerSlot.x,
      playerSlot.y,
      `car_${this.carColor}`,
      "YOU",
      true,
    );
    this.player.heading = playerSlot.heading;

    const aiColors = ALL_COLORS.filter((c) => c !== this.carColor);
    const params = DIFFICULTIES[this.difficulty];
    for (let i = 0; i < this.opponentCount; i++) {
      const slot = this.startGridSlot(i + 1);
      const color = aiColors[i % aiColors.length];
      const [pLow, pHigh] = params.perfRange;
      const [sLow, sHigh] = params.skillRange;
      const aiCar = new Car(this, slot.x, slot.y, `car_${color}`, COLOR_NAMES[color], false, {
        ...DEFAULT_CAR,
        maxSpeed: DEFAULT_CAR.maxSpeed * Phaser.Math.FloatBetween(pLow, pHigh),
        accel: DEFAULT_CAR.accel * Phaser.Math.FloatBetween(pLow, pHigh),
        grip: DEFAULT_CAR.grip * Phaser.Math.FloatBetween(pLow, pHigh),
      });
      aiCar.heading = slot.heading;
      this.ai.push(aiCar);
      this.aiSkill.set(aiCar, {
        skill: Phaser.Math.FloatBetween(sLow, sHigh),
        aimOffset: 0,
        chunk: -1,
      });
    }
    this.cars = [this.player, ...this.ai];

    this.spawnPickups(8);

    this.cameras.main.setBounds(-3000, -3000, 6000, 6000);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.cameras.main.setZoom(0.85);

    this.hud = new Hud(this);

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setName("ui");
    const hudSet = new Set(this.hud.objects);
    const worldObjects = this.children.list.filter((c) => !hudSet.has(c));
    this.cameras.main.ignore(this.hud.objects);
    this.uiCam.ignore(worldObjects);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.escapeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.state = "countdown";
    this.countdownStartedAt = this.time.now;

    this.setupAudio();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disposeAudio());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.disposeAudio());
  }

  private setupAudio() {
    const buffer = this.cache.audio.get("engine") as AudioBuffer | undefined;
    if (!buffer) return;
    this.audioBus = new AudioBus();
    for (const car of this.cars) {
      const engine = new EngineSound(this.audioBus, buffer);
      engine.setPosition(car.x, car.y);
      engine.start();
      this.audioBus.add(engine);
      this.engines.set(car, engine);
    }
  }

  private disposeAudio() {
    if (!this.audioBus) return;
    this.audioBus.dispose();
    this.audioBus = null;
    this.engines.clear();
  }

  private updateAudio() {
    if (!this.audioBus) return;
    const now = this.time.now;
    this.audioBus.setListener(this.player.x, this.player.y);
    for (const car of this.cars) {
      const engine = this.engines.get(car);
      if (!engine) continue;
      engine.setPosition(car.x, car.y);
      engine.setRevs(this.revsTargetFor(car));
      engine.setFade(this.engineFadeFor(car, now));
    }
    this.audioBus.update();
  }

  private revsTargetFor(car: Car): number {
    const speedNorm = car.config.maxSpeed > 0
      ? Math.min(1.4, car.speed / car.config.maxSpeed)
      : 0;
    const throttleNorm = car.audioThrottle;
    const base = Math.max(speedNorm, throttleNorm * 0.7);
    const boost = car.boostTimer > 0 ? 0.15 : 0;
    return 0.08 + base + boost;
  }

  private engineFadeFor(car: Car, now: number): number {
    if (car.finishedAtMs == null) return 1;
    const FADE_MS = 3000;
    const elapsed = now - car.finishedAtMs;
    return Math.max(0, 1 - elapsed / FADE_MS);
  }

  update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    const now = this.time.now;

    if (Phaser.Input.Keyboard.JustDown(this.escapeKey)) {
      this.scene.start("MenuScene");
      return;
    }

    if (this.state === "countdown") {
      this.runCountdown(now);
      for (const c of this.cars) c.update(dt, NO_INPUT);
      this.player.audioThrottle = this.cursors.up?.isDown ? 1 : 0;
      for (const ai of this.ai) ai.audioThrottle = 0;
    } else {
      this.runRacing(dt, now);
    }

    this.updateHud(now);
    this.updateAudio();
  }

  // Subtle slipstream: when a car sits ~20-110u behind another car, roughly aligned and
  // laterally close, give it a small accel + top-speed bump that ramps with proximity.
  // Max effect at the close end of the range; zero at the edges or off-axis.
  private computeDraft(car: Car): number {
    if (car.spinTimer > 0 || car.speed < 60) return 1.0;
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    let best = 1.0;
    for (const other of this.cars) {
      if (other === car) continue;
      if (other.spinTimer > 0) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const along = dx * fx + dy * fy;
      if (along < 20 || along > 110) continue;
      const lat = Math.abs(-dx * fy + dy * fx);
      if (lat > 22) continue;
      const headingDot = Math.cos(other.heading - car.heading);
      if (headingDot < 0.7) continue;
      // Linear ramp: 1.0 at along=110, peak at along=20.
      const proximity = 1 - (along - 20) / 90;
      const lateralFalloff = 1 - lat / 22;
      const draft = 1.0 + 0.05 * proximity * lateralFalloff;
      if (draft > best) best = draft;
    }
    return best;
  }

  private startGridSlot(index: number): { x: number; y: number; heading: number } {
    const distBack = 40 + index * 40;
    const lateral = index % 2 === 0 ? 30 : -30;
    return this.gridSlotBehindStart(distBack, lateral);
  }

  // Walks the centerline backward from the start index by `distBack` units of arc-length,
  // then offsets laterally along the local normal. Keeps the grid on-track on curves.
  private gridSlotBehindStart(distBack: number, lateral: number): { x: number; y: number; heading: number } {
    const pts = this.track.centerline;
    const n = pts.length;
    let idx = this.track.startIndex;
    let acc = 0;
    let prev = idx;
    while (acc < distBack) {
      prev = (idx - 1 + n) % n;
      const seg = Math.hypot(pts[idx].x - pts[prev].x, pts[idx].y - pts[prev].y);
      if (acc + seg >= distBack) {
        const t = seg > 0 ? (distBack - acc) / seg : 0;
        const px = pts[idx].x + (pts[prev].x - pts[idx].x) * t;
        const py = pts[idx].y + (pts[prev].y - pts[idx].y) * t;
        const ux = (pts[idx].x - pts[prev].x) / (seg || 1);
        const uy = (pts[idx].y - pts[prev].y) / (seg || 1);
        return {
          x: px + -uy * lateral,
          y: py + ux * lateral,
          heading: Math.atan2(uy, ux),
        };
      }
      acc += seg;
      idx = prev;
    }
    return { x: pts[idx].x, y: pts[idx].y, heading: this.track.startHeading };
  }

  private runCountdown(now: number) {
    const elapsed = now - this.countdownStartedAt;
    if (elapsed < 1000) {
      this.hud.showCountdown("3");
    } else if (elapsed < 2000) {
      this.hud.showCountdown("2");
    } else if (elapsed < 3000) {
      this.hud.showCountdown("1");
    } else if (elapsed < 4000) {
      this.hud.showCountdown("GO!", "#3aff5a");
      if (this.state === "countdown") {
        this.state = "racing";
        this.raceStartedAt = now;
        for (const c of this.cars) {
          c.currentLapStartMs = now;
          c.nextCheckpoint = 1;
        }
      }
    } else {
      this.hud.hideCountdown();
    }
  }

  private runRacing(dt: number, now: number) {
    if (now - this.raceStartedAt > 1000) this.hud.hideCountdown();

    const lookK = 0.35;
    const lookMax = 220;
    const lookX = Phaser.Math.Clamp(this.player.vx * lookK, -lookMax, lookMax);
    const lookY = Phaser.Math.Clamp(this.player.vy * lookK, -lookMax, lookMax);
    this.cameras.main.setFollowOffset(-lookX, -lookY);

    const playerActive = this.player.finishedAtMs == null;
    const playerInput: CarInput = playerActive
      ? {
          throttle: this.cursors.up?.isDown ? 1 : 0,
          brake: this.cursors.down?.isDown ? 1 : 0,
          steer: (this.cursors.right?.isDown ? 1 : 0) - (this.cursors.left?.isDown ? 1 : 0),
          useItem: Phaser.Input.Keyboard.JustDown(this.spaceKey),
        }
      : NO_INPUT;
    for (const c of this.cars) c.draft = this.computeDraft(c);

    this.player.audioThrottle = playerInput.throttle;
    this.player.update(dt, playerInput, this.surfaceFeel(this.player));
    if (playerActive && playerInput.useItem) this.useItem(this.player);
    this.applyTrackBounds(this.player);

    for (const ai of this.ai) {
      const aiActive = ai.finishedAtMs == null;
      const input = aiActive ? this.aiInput(ai) : NO_INPUT;
      ai.audioThrottle = input.throttle;
      ai.update(dt, input, this.surfaceFeel(ai));
      this.applyTrackBounds(ai);
      if (aiActive && ai.itemSlot && ai.useItemAt != null && now >= ai.useItemAt) {
        this.useItem(ai);
      }
    }

    this.updatePickups();
    this.updateOilSlicks(dt);
    this.updateMissiles(dt);
    for (const c of this.cars) this.updateLapTracking(c, now);
    this.handleCarCollisions();

    const anyFinished = this.cars.some((c) => c.finishedAtMs != null);
    if (anyFinished) {
      this.showResults();
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart();
        return;
      }
    }

    if (this.state !== "finished" && this.cars.every((c) => c.finishedAtMs != null)) {
      this.state = "finished";
      this.raceEndedAt = now;
    }
  }

  private surfaceFeel(car: Car): SurfaceFeel {
    let drag = 0;
    let grip = 0;
    let n = 0;
    for (const c of car.corners()) {
      const surf = this.track.surfaceAt(c.x, c.y);
      const params = SURFACE_PARAMS[surf];
      drag += params.drag;
      grip += params.grip;
      n++;
    }
    return { drag: drag / n, grip: grip / n };
  }

  private applyTrackBounds(car: Car) {
    const half = this.track.width / 2;

    car.onTrack = this.track.probe(car.x, car.y).distance <= half;

    let worstOverflow = 0;
    let worstNx = 0;
    let worstNy = 0;
    for (const c of car.corners()) {
      const probe = this.track.probe(c.x, c.y);
      const wallAt = this.track.wallOffset(probe.side, probe.index);
      const overflow = probe.distance - wallAt;
      if (overflow > worstOverflow) {
        worstOverflow = overflow;
        worstNx = probe.nx;
        worstNy = probe.ny;
      }
    }

    if (worstOverflow <= 0) return;

    car.sprite.x -= worstNx * worstOverflow;
    car.sprite.y -= worstNy * worstOverflow;

    const vn = car.vx * worstNx + car.vy * worstNy;
    if (vn > 0) {
      const restitution = 0.35;
      const tangentialScrub = 0.9;
      const tx = -worstNy;
      const ty = worstNx;
      const vt = car.vx * tx + car.vy * ty;
      const newVn = -vn * restitution;
      const newVt = vt * tangentialScrub;
      car.vx = worstNx * newVn + tx * newVt;
      car.vy = worstNy * newVn + ty * newVt;
    }
  }

  private aiInput(ai: Car): CarInput {
    const target = this.aimNextCenterline(ai);
    const desiredAng = Math.atan2(target.y - ai.y, target.x - ai.x);
    const diff = Phaser.Math.Angle.Wrap(desiredAng - ai.heading);
    const steer = Phaser.Math.Clamp(diff * 1.8, -1, 1);
    const speed = ai.speed;
    const wantSlow = Math.abs(diff) > 0.6 && speed > 200;
    return {
      throttle: wantSlow ? 0.4 : 1,
      brake: wantSlow ? 0.3 : 0,
      steer,
      useItem: false,
    };
  }

  private aimNextCenterline(ai: Car) {
    const pts = this.track.centerline;
    const rl = this.track.racingLine.length === pts.length ? this.track.racingLine : pts;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Phaser.Math.Distance.Squared(pts[i].x, pts[i].y, ai.x, ai.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const lookahead = 4;
    const aimIdx = (bestIdx + lookahead) % pts.length;
    const aim = rl[aimIdx];

    const state = this.aiSkill.get(ai);
    if (!state) return aim;

    const currentChunk = Math.floor(bestIdx / AIM_CHUNK_SIZE);
    if (currentChunk !== state.chunk) {
      state.chunk = currentChunk;
      state.aimOffset = this.sampleAimOffset(state.skill);
    }
    if (state.aimOffset === 0) return aim;

    const n = pts.length;
    const prev = pts[(aimIdx - 1 + n) % n];
    const next = pts[(aimIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { x: aim.x + nx * state.aimOffset, y: aim.y + ny * state.aimOffset };
  }

  private sampleAimOffset(skill: number): number {
    const halfWidth = this.track.width / 2;
    const maxOff = halfWidth * (AIM_OFFSET_FLOOR + (1 - skill) * AIM_OFFSET_RANGE);
    const r = Math.random() - Math.random();
    return r * maxOff;
  }

  private spawnPickups(count: number) {
    const pts = this.track.centerline;
    const step = Math.floor(pts.length / count);
    const offset = Math.floor(step / 2);
    for (let i = 0; i < count; i++) {
      const p = pts[(i * step + offset) % pts.length];
      const sprite = this.add.sprite(p.x, p.y, "pickup").setDepth(5);
      this.pickups.push({ sprite, active: true, respawnAt: 0, baseX: p.x, baseY: p.y });
      this.tweens.add({
        targets: sprite,
        scale: { from: 0.9, to: 1.15 },
        yoyo: true,
        repeat: -1,
        duration: 600,
      });
    }
  }

  private updatePickups() {
    const now = this.time.now;
    for (const p of this.pickups) {
      if (!p.active) {
        if (now >= p.respawnAt) {
          p.active = true;
          p.sprite.setVisible(true);
        }
        continue;
      }
      for (const c of this.cars) {
        if (Phaser.Math.Distance.Between(c.x, c.y, p.baseX, p.baseY) < 22) {
          if (!c.itemSlot) {
            c.itemSlot = randomItem();
            if (!c.isPlayer) {
              c.useItemAt = now + Phaser.Math.Between(1000, 5000);
            }
          }
          p.active = false;
          p.sprite.setVisible(false);
          p.respawnAt = now + 3500;
          break;
        }
      }
    }
  }

  private useItem(car: Car) {
    if (!car.itemSlot) return;
    const item = car.itemSlot as Item;
    car.itemSlot = null;
    car.useItemAt = null;
    switch (item) {
      case "boost":
        car.giveBoost(2.0);
        if (car.isPlayer) this.hud.flash("BOOST!", 700);
        break;
      case "missile":
        this.fireMissile(car);
        if (car.isPlayer) this.hud.flash("MISSILE!", 700);
        break;
      case "oil":
        this.dropOil(car);
        if (car.isPlayer) this.hud.flash("OIL!", 700);
        break;
      case "shield":
        car.shielded = true;
        if (car.isPlayer) this.hud.flash("SHIELD!", 700);
        break;
    }
  }

  private fireMissile(owner: Car) {
    const speed = 520;
    const fx = Math.cos(owner.heading);
    const fy = Math.sin(owner.heading);
    const g = this.add.graphics();
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
      vx: fx * speed + owner.vx * 0.5,
      vy: fy * speed + owner.vy * 0.5,
      ownerIsPlayer: owner === this.player,
      expiresAt: this.time.now + 4000,
    });
  }

  private updateMissiles(dt: number) {
    const now = this.time.now;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.sprite.setPosition(m.x, m.y);

      const targets = m.ownerIsPlayer ? this.ai : [this.player];
      let nearest: Car | null = null;
      let nearestD = Infinity;
      for (const c of targets) {
        const d = Phaser.Math.Distance.Between(c.x, c.y, m.x, m.y);
        if (d < nearestD) { nearestD = d; nearest = c; }
      }
      if (nearest && nearestD < 220) {
        const ang = Math.atan2(nearest.y - m.y, nearest.x - m.x);
        const speed = Math.hypot(m.vx, m.vy);
        const turn = 4.5 * dt;
        const cur = Math.atan2(m.vy, m.vx);
        const newAng = cur + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(ang - cur), -turn, turn);
        m.vx = Math.cos(newAng) * speed;
        m.vy = Math.sin(newAng) * speed;
      }

      let hit = false;
      for (const c of this.cars) {
        if (m.ownerIsPlayer && c.isPlayer) continue;
        if (!m.ownerIsPlayer && !c.isPlayer) continue;
        if (Phaser.Math.Distance.Between(c.x, c.y, m.x, m.y) < 22) {
          if (!c.spin(1.2)) this.spawnShieldFlash(c);
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

  private dropOil(owner: Car) {
    const fx = Math.cos(owner.heading);
    const fy = Math.sin(owner.heading);
    const x = owner.x - fx * 26;
    const y = owner.y - fy * 26;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.85);
    g.fillCircle(0, 0, 22);
    g.fillStyle(0x222222, 0.6);
    g.fillCircle(6, -4, 14);
    g.setPosition(x, y);
    g.setDepth(3);
    this.uiCam.ignore(g);
    this.oilSlicks.push({ sprite: g, x, y, expiresAt: this.time.now + 12000 });
  }

  private updateOilSlicks(_dt: number) {
    const now = this.time.now;
    for (let i = this.oilSlicks.length - 1; i >= 0; i--) {
      const o = this.oilSlicks[i];
      if (now > o.expiresAt) {
        o.sprite.destroy();
        this.oilSlicks.splice(i, 1);
        continue;
      }
      for (const c of this.cars) {
        if (Phaser.Math.Distance.Between(c.x, c.y, o.x, o.y) < 22) {
          if (!c.spin(0.9)) this.spawnShieldFlash(c);
          o.sprite.destroy();
          this.oilSlicks.splice(i, 1);
          break;
        }
      }
    }
  }

  private spawnShieldFlash(car: Car) {
    const g = this.add.graphics();
    g.setDepth(9);
    this.uiCam.ignore(g);
    const cx = car.x;
    const cy = car.y;
    const state = { r: 18, w: 4, a: 1 };
    this.tweens.add({
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
    if (car.isPlayer) this.hud.flash("BLOCKED!", 600);
  }

  private handleCarCollisions() {
    const cars = this.cars;
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
          const impulse = -vn * 0.8;
          a.vx -= mtv.nx * impulse;
          a.vy -= mtv.ny * impulse;
          b.vx += mtv.nx * impulse;
          b.vy += mtv.ny * impulse;
        }
      }
    }
  }

  private updateLapTracking(car: Car, now: number) {
    if (car.finishedAtMs != null) return;
    const cp = car.nextCheckpoint;
    if (!this.track.checkpointHit(cp, car.x, car.y)) return;

    const N = this.track.checkpoints.length;
    car.nextCheckpoint = (cp + 1) % N;

    if (cp !== 0) return;

    const lapMs = now - car.currentLapStartMs;
    if (car.bestLapMs == null || lapMs < car.bestLapMs) {
      car.bestLapMs = lapMs;
      if (car.isPlayer) this.hud.flash("BEST LAP!", 1500);
    }
    car.currentLapStartMs = now;
    car.lap++;

    const winnerAlreadyFinished = this.cars.some((c) => c.finishedAtMs != null);
    if (car.lap >= this.totalLaps || winnerAlreadyFinished) {
      car.finishedAtMs = now;
    }
  }

  private computePositions(): PositionRow[] {
    const ncp = this.track.checkpoints.length;
    const rows = this.cars.map((c) => {
      const crossedThisLap = (c.nextCheckpoint - 1 + ncp) % ncp;
      const progress = c.lap * ncp + crossedThisLap;
      const cp = this.track.checkpoints[c.nextCheckpoint];
      const distToNext = Math.hypot(c.x - cp.x, c.y - cp.y);
      return { car: c, progress, distToNext };
    });
    rows.sort((a, b) => {
      if (a.car.finishedAtMs != null && b.car.finishedAtMs != null) {
        return a.car.finishedAtMs - b.car.finishedAtMs;
      }
      if (a.car.finishedAtMs != null) return -1;
      if (b.car.finishedAtMs != null) return 1;
      if (b.progress !== a.progress) return b.progress - a.progress;
      return a.distToNext - b.distToNext;
    });
    return rows.map((r, i) => ({
      pos: i + 1,
      name: r.car.name,
      isPlayer: r.car.isPlayer,
      lapsDone: r.car.lap,
      finished: r.car.finishedAtMs != null,
    }));
  }

  private showResults() {
    const positions = this.computePositions();
    const allDone = this.cars.every((c) => c.finishedAtMs != null);
    const playerActive = this.player.finishedAtMs == null;
    const compact = playerActive && !allDone;

    const lines: string[] = [];
    let prevCar: Car | null = null;
    for (const p of positions) {
      const car = this.cars.find((c) => c.name === p.name)!;

      if (compact && car.finishedAtMs == null) break;

      let timeCol: string;
      if (car.finishedAtMs == null) {
        timeCol = `LAP ${Math.min(car.lap + 1, this.totalLaps)}`;
      } else if (prevCar == null || prevCar.finishedAtMs == null) {
        timeCol = formatRaceTime(car.finishedAtMs - this.raceStartedAt);
      } else if (car.lap === prevCar.lap) {
        const gap = car.finishedAtMs - prevCar.finishedAtMs;
        timeCol = `+${formatGap(gap)}`;
      } else {
        const lapDiff = prevCar.lap - car.lap;
        timeCol = `+${lapDiff} LAP${lapDiff === 1 ? "" : "S"}`;
      }

      const tag = p.isPlayer ? " ◂ YOU" : "";
      const nameCol = car.name.padEnd(4);

      if (compact) {
        const timeColPadded = timeCol.padEnd(10);
        lines.push(`P${p.pos} ${nameCol} ${timeColPadded}`);
      } else {
        const best = car.bestLapMs != null ? formatRaceTime(car.bestLapMs) : "—";
        const timeColPadded = timeCol.padEnd(11);
        lines.push(`P${p.pos}  ${nameCol}  ${timeColPadded}  best ${best}${tag}`);
      }

      prevCar = car;
    }

    if (compact) {
      this.hud.showResults(lines, true);
    } else {
      const header = [allDone ? "RACE OVER" : "RESULTS", ""];
      const footer = ["", "R to restart · ESC for menu"];
      this.hud.showResults([...header, ...lines, ...footer], false);
    }
  }

  private updateHud(now: number) {
    const speedKph = this.player.speed * 0.36;
    this.hud.setSpeed(speedKph);
    this.hud.setLap(this.player.lap + 1, this.totalLaps);

    const elapsed =
      this.state === "countdown"
        ? 0
        : this.state === "racing"
          ? now - this.raceStartedAt
          : this.raceEndedAt - this.raceStartedAt;
    this.hud.setTime(elapsed);
    this.hud.setBest(this.player.bestLapMs);
    this.hud.setItem(this.player.itemSlot);
    this.hud.setPositions(this.computePositions(), this.totalLaps);
    this.hud.update();
  }
}

function randomItem(): Item {
  return ITEMS[Math.floor(Math.random() * ITEMS.length)];
}

function formatGap(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  if (m === 0) return `${s}.${cs.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
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
