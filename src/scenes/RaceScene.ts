import Phaser from "phaser";
import { Car, DEFAULT_CAR, SHIELD_COLOR, type CarInput, type SurfaceFeel } from "../entities/Car";
import { ensureCarTexture, randomVariant } from "../entities/CarSprite";
import { DEFAULT_TEAM_ID, TEAMS, teamById, type Team, type TeamId } from "../entities/Team";
import { Track } from "../entities/Track";
import { parseTrackData, SURFACE_PARAMS } from "../entities/TrackData";
import { Hud, formatRaceTime, type PositionRow } from "../ui/Hud";
import { TouchControls } from "../ui/TouchControls";
import { DIFFICULTIES, LAPS_MAX, LAPS_MIN, OPPONENTS_MAX, OPPONENTS_MIN, PLAYERS_MAX, PLAYERS_MIN } from "./MenuScene";
import type { Difficulty, PlayerCount, TrackKey } from "./MenuScene";
import { AudioBus } from "../audio/AudioBus";
import { EngineSound } from "../audio/EngineSound";
import { SkidSound } from "../audio/SkidSound";
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
  playWallThumpSfx,
} from "../audio/ItemSfx";
import { SkidMarks } from "../entities/SkidMarks";
import { DustParticles } from "../entities/DustParticles";
import { SparkParticles } from "../entities/SparkParticles";
import { DrsAirflow } from "../entities/DrsAirflow";
import { InputReader, type InputSource } from "../input/InputSource";
import { defaultDrsModes, loadDrsModes, type DrsMode, type DrsModes } from "../input/DrsMode";

interface RaceInit {
  trackKey?: TrackKey;
  teamId?: TeamId;
  // P2's team in 2-player mode. Ignored when players === 1.
  teamId2?: TeamId;
  players?: PlayerCount;
  difficulty?: Difficulty;
  laps?: number;
  opponents?: number;
  // Per-player input source. Index 0 = P1, 1 = P2. null = use default (1P auto / 2P legacy keyboard).
  inputSources?: (InputSource | null)[];
  // Per-player DRS activation mode. Falls back to localStorage / defaults when omitted.
  drsModes?: DrsModes;
}
const ITEMS = ["boost", "missile", "seeker", "oil", "shield"] as const;
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

interface AISkillState {
  skill: number;
  aimOffset: number;
  chunk: number;
}

const AIM_CHUNK_SIZE = 6;
const AIM_OFFSET_FLOOR = 0.05;
const AIM_OFFSET_RANGE = 0.5;

// Pure-pursuit lookahead in arc length (px). Index-based lookahead failed because
// hand-authored centerline spacing varies 10× on a single track — "4 indices ahead"
// can mean 100px in dense apex regions or 1000px on a sparse approach, so AI starts
// turning toward an apex from absurdly far away. Arc-length lookahead is uniform.
const AI_LOOKAHEAD_DIST = 220;

// Curvature-based brake points. For each point ahead, compute corner speed via
// v² · κ ≤ K_LIMIT, then convert to "max speed allowed *now*" using
// v_now = √(v_corner² + 2 · brake · distance). The min over the scan window is the target
// — i.e. AI brakes only when actually within braking distance of a slower corner.
// AI_BRAKE_DECEL is slightly under cfg.brake (520) to leave headroom for grip lost
// to lateral load when braking and turning. K_LIMIT tuned so the tightest chicane
// targets ~180px/s on Champions Wall; raise if AI is too slow, lower if it slides off.
const AI_BRAKE_DECEL = 480;
const AI_BRAKE_SCAN_DIST = 1200;
const AI_LATERAL_GRIP_LIMIT = 500;
const AI_BRAKE_DEADZONE = 1.04;
const AI_THROTTLE_TAPER = 60;

const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, useItem: false, useDrs: false };

// Eligibility window: chaser within this many ms of the prior crosser at a detection point gets DRS.
const DRS_GAP_MS = 1000;
// Auto activation delay after crossing the zone-start gate. Same value for human auto mode and the
// AI base; AI adds skill-driven jitter on top.
const DRS_AUTO_DELAY_MS = 200;
// AI activation timing (ms): base + (1 - skill) * skillSpread + uniform jitter ±jitter.
const DRS_AI_SKILL_SPREAD = 600;
const DRS_AI_JITTER = 200;

// Auto-unstuck watchdog. A car that fails to advance a single checkpoint in this many ms gets
// teleported back to its last gate. 30s catches genuinely wedged cars without making slow but
// progressing recoveries (post-spin, off-track scrub) trip the watchdog.
const UNSTUCK_TIMEOUT_MS = 30_000;

interface DetectionRecord {
  car: Car;
  t: number;
}

interface DrsCarState {
  // Index of the zone whose start gate the car most recently passed while eligible. null while
  // not currently inside a DRS zone.
  insideZoneIdx: number | null;
  // Auto mode: ms timestamp after which DRS becomes active. Cleared when fired or zone ends.
  scheduledActivateAt: number | null;
  // Edge-detect "currently inside band" flags, one slot per detection / zone-start / zone-end.
  // Detections and zones are independent — `Car.drsAvailable` is the single boolean eligibility
  // flag updated by detection crosses; zones just consult it on entry.
  prevDetTouching: boolean[];
  prevStartTouching: boolean[];
  prevEndTouching: boolean[];
}

export class RaceScene extends Phaser.Scene {
  // humans[0] is always the primary player (P1). humans.length === 2 in 2P mode.
  // `player` is kept as an alias for humans[0] so the bulk of single-player code paths stay short.
  humans: Car[] = [];
  player!: Car;
  ai: Car[] = [];
  cars: Car[] = [];
  track!: Track;
  // hud is the left-side HUD (always present). hud2 only exists in 2P mode (right-side mirror).
  hud!: Hud;
  hud2: Hud | null = null;
  touch!: TouchControls;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  spaceKey!: Phaser.Input.Keyboard.Key;
  // 2P-only: WASD + Enter for the second control scheme. Bound regardless of mode but only
  // read by `runRacing` when humans.length === 2.
  wKey!: Phaser.Input.Keyboard.Key;
  aKey!: Phaser.Input.Keyboard.Key;
  sKey!: Phaser.Input.Keyboard.Key;
  dKey!: Phaser.Input.Keyboard.Key;
  enterKey!: Phaser.Input.Keyboard.Key;
  restartKey!: Phaser.Input.Keyboard.Key;

  pickups: Pickup[] = [];
  oilSlicks: OilSlick[] = [];
  missiles: Missile[] = [];
  seekers: Seeker[] = [];

  private aiSkill = new Map<Car, AISkillState>();
  private audioBus: AudioBus | null = null;
  private engines = new Map<Car, EngineSound>();
  private skids = new Map<Car, SkidSound>();
  private skidMarks: SkidMarks | null = null;
  private dust: DustParticles | null = null;
  private sparks: SparkParticles | null = null;
  private drsAirflow: DrsAirflow | null = null;

  state: RaceState = "countdown";
  countdownStartedAt = 0;
  raceStartedAt = 0;
  raceEndedAt = 0;
  // Session-wide fastest lap (across all cars in the current race). Drives the
  // "FASTEST LAP <name>" broadcast; per-car PBs live on Car.bestLapMs.
  sessionBestLapMs: number | null = null;

  trackKey: TrackKey = "oval";
  teamId: TeamId = DEFAULT_TEAM_ID;
  teamId2: TeamId = DEFAULT_TEAM_ID;
  playerCount: PlayerCount = 1;
  difficulty: Difficulty = "normal";
  totalLaps: number = 3;
  opponentCount: number = 3;
  // Per-player input source. inputSources[i] resolves the controls for humans[i].
  // null entries fall back to defaults (1P auto, 2P legacy keyboard schemes).
  inputSources: (InputSource | null)[] = [];
  inputReader!: InputReader;
  // Per-player DRS auto/manual mode. Index 0 = P1, 1 = P2. AI cars always use auto.
  drsModes: DrsModes = defaultDrsModes();
  // Becomes true on the frame the leader completes their first lap. Detection points only grant
  // eligibility while this is true; crossings logged before then are kept so the first post-enable
  // chaser can still find a prior crosser to compare against.
  drsEnabled = false;
  // Per-zone append-only crossing log. detectionLog[zoneIdx] is ordered by time.
  drsDetectionLog: DetectionRecord[][] = [];
  drsState = new Map<Car, DrsCarState>();
  escapeKey!: Phaser.Input.Keyboard.Key;
  uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super("RaceScene");
  }

  init(data: RaceInit) {
    this.trackKey = data.trackKey ?? "oval";
    this.teamId = data.teamId ?? DEFAULT_TEAM_ID;
    this.teamId2 = data.teamId2 ?? DEFAULT_TEAM_ID;
    this.playerCount = Phaser.Math.Clamp(data.players ?? 1, PLAYERS_MIN, PLAYERS_MAX) as PlayerCount;
    this.difficulty = data.difficulty ?? "normal";
    this.totalLaps = Phaser.Math.Clamp(data.laps ?? 3, LAPS_MIN, LAPS_MAX);
    this.opponentCount = Phaser.Math.Clamp(data.opponents ?? 3, OPPONENTS_MIN, OPPONENTS_MAX);
    this.inputSources = (data.inputSources ?? []).slice(0, this.playerCount);
    this.drsModes = data.drsModes ?? loadDrsModes();
  }

  preload() {
    const key = `track-${this.trackKey}`;
    if (!this.cache.json.has(key)) {
      this.load.json(key, `tracks/${this.trackKey}.json`);
    }
  }

  create() {
    this.humans = [];
    this.ai = [];
    this.cars = [];
    this.pickups = [];
    this.oilSlicks = [];
    this.missiles = [];
    this.seekers = [];
    this.aiSkill.clear();
    this.engines.clear();
    this.skids.clear();
    this.audioBus = null;
    this.skidMarks = null;
    this.dust = null;
    this.sparks = null;
    this.drsAirflow = null;
    this.hud2 = null;
    this.state = "countdown";
    this.raceStartedAt = 0;
    this.raceEndedAt = 0;
    this.sessionBestLapMs = null;
    this.drsEnabled = false;
    this.drsDetectionLog = [];
    this.drsState.clear();

    const raw = this.cache.json.get(`track-${this.trackKey}`);
    this.track = Track.fromData(this, parseTrackData(raw));

    this.skidMarks = this.createSkidMarks();
    this.dust = new DustParticles(this);
    this.sparks = new SparkParticles(this);
    this.drsAirflow = new DrsAirflow(this);

    // Spawn humans into grid slots 0..N-1. Each gets playerIndex 0/1 so per-player HUDs and
    // per-player flashes can later route by index. Slot 0 is pole, slot 1 is the row behind.
    const humanTeams: Team[] = [teamById(this.teamId)];
    if (this.playerCount === 2) humanTeams.push(teamById(this.teamId2));
    for (let i = 0; i < humanTeams.length; i++) {
      const slot = this.startGridSlot(i);
      const team = humanTeams[i];
      const livery = {
        primary: team.primary,
        secondary: team.secondary,
        variant: randomVariant(Math.random),
      };
      const name = this.playerCount === 1 ? "YOU" : `P${i + 1}`;
      const car = new Car(this, slot.x, slot.y, ensureCarTexture(this, livery), name, true);
      car.heading = slot.heading;
      car.playerIndex = i;
      this.humans.push(car);
    }
    this.player = this.humans[0];

    const params = DIFFICULTIES[this.difficulty];
    const teamCounts = new Map<string, number>();
    for (const t of humanTeams) teamCounts.set(t.id, (teamCounts.get(t.id) ?? 0) + 1);
    const aiTeamPool: typeof TEAMS[number][] = [];
    for (const t of TEAMS) {
      const slots = 2 - (teamCounts.get(t.id) ?? 0);
      for (let k = 0; k < slots; k++) aiTeamPool.push(t);
    }
    for (let i = aiTeamPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [aiTeamPool[i], aiTeamPool[j]] = [aiTeamPool[j], aiTeamPool[i]];
    }
    for (let i = 0; i < this.opponentCount; i++) {
      // AI cars start behind all humans on the grid: offset by humans.length so a 2-player race
      // puts AI in slots 2..N rather than overlapping P2.
      const slot = this.startGridSlot(this.humans.length + i);
      const team = aiTeamPool[i];
      const livery = {
        primary: team.primary,
        secondary: team.secondary,
        variant: randomVariant(Math.random),
      };
      const seen = (teamCounts.get(team.id) ?? 0) + 1;
      teamCounts.set(team.id, seen);
      const aiName = seen === 1 ? team.short : `${team.short}${seen}`;
      const [pLow, pHigh] = params.perfRange;
      const [sLow, sHigh] = params.skillRange;
      const aiCar = new Car(this, slot.x, slot.y, ensureCarTexture(this, livery), aiName, false, {
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
    this.cars = [...this.humans, ...this.ai];

    const detCount = this.track.drsDetections.length;
    const zoneCount = this.track.drsZones.length;
    this.drsDetectionLog = Array.from({ length: detCount }, () => []);
    for (const car of this.cars) {
      this.drsState.set(car, {
        insideZoneIdx: null,
        scheduledActivateAt: null,
        prevDetTouching: new Array(detCount).fill(false),
        prevStartTouching: new Array(zoneCount).fill(false),
        prevEndTouching: new Array(zoneCount).fill(false),
      });
    }

    this.spawnPickups(8);

    this.cameras.main.setBounds(-3000, -3000, 6000, 6000);
    if (this.humans.length === 1) {
      // 1P: existing follow behaviour, look-ahead applied per frame in runRacing.
      this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
      this.cameras.main.setZoom(0.85);
    } else {
      // 2P: camera is driven manually each frame in updateMultiplayerCamera() so the zoom can
      // dynamically fit both players. Initial zoom is set conservatively until the first frame's
      // fit-calculation runs.
      this.cameras.main.setZoom(0.85);
      this.cameras.main.centerOn(this.player.x, this.player.y);
    }

    this.hud = new Hud(this, "left", this.cars.length);
    if (this.humans.length === 2) this.hud2 = new Hud(this, "right", this.cars.length);
    this.touch = new TouchControls(this);

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setName("ui");
    const uiObjects = [
      ...this.hud.objects,
      ...(this.hud2?.objects ?? []),
      ...this.touch.objects,
    ];
    const uiSet = new Set<Phaser.GameObjects.GameObject>(uiObjects);
    const worldObjects = this.children.list.filter((c) => !uiSet.has(c));
    this.cameras.main.ignore(uiObjects);
    this.uiCam.ignore(worldObjects);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.aKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.sKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.dKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.escapeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.inputReader = new InputReader(this);

    this.state = "countdown";
    this.countdownStartedAt = this.time.now;

    this.setupAudio();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.disposeAudio();
      this.skidMarks = null;
      this.dust = null;
      this.sparks = null;
      this.drsAirflow = null;
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.disposeAudio();
      this.skidMarks = null;
      this.dust = null;
      this.sparks = null;
      this.drsAirflow = null;
    });
  }

  private setupAudio() {
    const engineBuf = this.cache.audio.get("engine") as AudioBuffer | undefined;
    if (!engineBuf) return;
    const skidBuf = this.cache.audio.get("skid") as AudioBuffer | undefined;
    this.audioBus = new AudioBus();
    for (const car of this.cars) {
      const engine = new EngineSound(this.audioBus, engineBuf);
      engine.setPosition(car.x, car.y);
      engine.start();
      this.audioBus.add(engine);
      this.engines.set(car, engine);
      if (skidBuf) {
        const skid = new SkidSound(this.audioBus, skidBuf);
        skid.setPosition(car.x, car.y);
        skid.start();
        this.audioBus.add(skid);
        this.skids.set(car, skid);
      }
    }
  }

  private disposeAudio() {
    if (!this.audioBus) return;
    this.audioBus.dispose();
    this.audioBus = null;
    this.engines.clear();
    this.skids.clear();
  }

  private createSkidMarks(): SkidMarks {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.track.centerline) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Margin generous enough to cover walls + any off-track skid drift before the bounds clip kicks in.
    const margin = 200;
    return new SkidMarks(this, {
      x: minX - margin,
      y: minY - margin,
      width: maxX - minX + margin * 2,
      height: maxY - minY + margin * 2,
    });
  }

  // Drop a stamp at each of the car's 4 OBB corners while it's actually skidding.
  // Reuses skidIntensityFor() so the audio gate (slip ratio + speed/lateral floors) is the same as
  // the visual gate — straight-line driving, even on grass, leaves no marks; only real sliding does.
  // Per-frame alpha is normalized to dt*60 so 30fps and 60fps build up at the same rate per second.
  private updateSkidMarks(dt: number) {
    if (!this.skidMarks) return;
    if (this.state !== "racing") return;
    const ALPHA_PER_FRAME = 0.06;
    const dtScale = Math.min(2, dt * 60);
    // First pass: pick the cars that are actually skidding so we can skip the batch entirely
    // when nothing is sliding (very common — saves the render-target bind/unbind cost).
    const skidders: { car: Car; alpha: number }[] = [];
    for (const car of this.cars) {
      const intensity = this.skidIntensityFor(car);
      if (intensity <= 0) continue;
      skidders.push({ car, alpha: ALPHA_PER_FRAME * intensity * dtScale });
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
  private updateDust() {
    if (!this.dust) return;
    if (this.state !== "racing") return;
    const SPEED_FLOOR = 60;
    for (const car of this.cars) {
      if (car.speed < SPEED_FLOOR) continue;
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
  private drsAirflowParity = false;
  private updateDrsAirflow() {
    if (!this.drsAirflow) return;
    if (this.state !== "racing") return;
    const SPEED_FLOOR = 260;
    this.drsAirflowParity = !this.drsAirflowParity;
    const sideSign = this.drsAirflowParity ? 1 : -1;
    for (const car of this.cars) {
      if (!car.drsActive) continue;
      if (car.speed < SPEED_FLOOR) continue;
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

  private updateAudio() {
    if (!this.audioBus) return;
    const now = this.time.now;
    // 1P: single listener at the player. 2P: both humans listen, each contributing 50/50
    // to every source's mix — same falloff curve, just summed and averaged.
    this.audioBus.setListeners(this.humans.map((h) => ({ x: h.x, y: h.y })));
    for (const car of this.cars) {
      const engine = this.engines.get(car);
      if (engine) {
        engine.setPosition(car.x, car.y);
        engine.setRevs(this.revsTargetFor(car));
        engine.setFade(this.engineFadeFor(car, now));
      }
      const skid = this.skids.get(car);
      if (skid) {
        skid.setPosition(car.x, car.y);
        skid.setIntensity(this.skidIntensityFor(car));
      }
    }
    this.audioBus.update();
  }

  // Slip-driven skid level. Gated on three things so steady cornering stays
  // silent: minimum speed, an absolute lateral-velocity floor, and a slip *ratio*
  // (lateral/total) — real skids have the lateral component as a meaningful share
  // of the velocity, not just a high lateral number reached by going fast in a turn.
  // Multiplied by the same finished-fade as the engine so finished cars don't keep screeching.
  private skidIntensityFor(car: Car): number {
    if (this.state !== "racing") return 0;
    if (car.speed < 80) return 0;
    const lateral = car.lateralSpeed;
    if (lateral < 70) return 0;
    const ratio = lateral / car.speed;
    const RATIO_FLOOR = 0.30;
    const RATIO_RANGE = 0.25;
    const slip = Math.max(0, ratio - RATIO_FLOOR) / RATIO_RANGE;
    const fade = this.engineFadeFor(car, this.time.now);
    return Math.min(1, slip) * fade;
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

    this.touch.update();

    if (this.state === "countdown") {
      this.runCountdown(now);
      for (const c of this.cars) c.update(dt, NO_INPUT);
      // Audio-only throttle on the grid so the engine revs pre-race. Bypass humanInput so the
      // touch's one-shot useItem latch (and pad east-button edge state) stays armed for the
      // moment the race starts. readThrottle/readAutoThrottle are deliberately side-effect-free.
      const t = this.touch.state;
      for (let i = 0; i < this.humans.length; i++) {
        const explicit = this.inputSources[i] ?? null;
        let throttle: number;
        if (explicit) {
          throttle = this.inputReader.readThrottle(explicit);
        } else if (this.humans.length === 1) {
          throttle = this.inputReader.readAutoThrottle();
        } else {
          const fallback: InputSource =
            i === 0 ? { kind: "keyboard", scheme: "wasd" } : { kind: "keyboard", scheme: "arrows" };
          throttle = this.inputReader.readThrottle(fallback);
        }
        if (i === 0 && t.throttle) throttle = 1;
        this.humans[i].audioThrottle = throttle;
      }
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

  // Maps player index → CarInput via InputReader. 1P uses readAuto (kb arrows + first pad
  // merged). 2P uses an explicit InputSource per slot (assigned in MenuScene press-to-join);
  // when no source was provided, falls back to legacy schemes (P0: WASD+Space, P1: arrows+Enter).
  // Touch always feeds P0 — sharing a phone between two players isn't a sensible UX.
  private humanInput(playerIndex: number): CarInput {
    const t = this.touch.state;
    const explicit = this.inputSources[playerIndex] ?? null;

    let base: CarInput;
    if (explicit) {
      base = this.inputReader.read(explicit);
    } else if (this.humans.length === 1) {
      base = this.inputReader.readAuto();
    } else {
      const fallback: InputSource =
        playerIndex === 0
          ? { kind: "keyboard", scheme: "wasd" }
          : { kind: "keyboard", scheme: "arrows" };
      base = this.inputReader.read(fallback);
    }

    if (playerIndex !== 0) return base;

    let steer = base.steer;
    if (t.right && !t.left) steer = Math.max(steer, 1);
    if (t.left && !t.right) steer = Math.min(steer, -1);
    return {
      throttle: Math.max(base.throttle, t.throttle ? 1 : 0),
      brake: Math.max(base.brake, t.brake ? 1 : 0),
      steer,
      useItem: base.useItem || this.touch.consumeUseItem(),
      useDrs: base.useDrs,
    };
  }

  // Camera driver. 1P uses Phaser's startFollow + per-frame look-ahead via setFollowOffset.
  // 2P drops follow entirely and lerps zoom + center to keep both humans (or the surviving
  // human if one has finished) framed in view with margin.
  private updateRaceCamera(dt: number) {
    const cam = this.cameras.main;
    if (this.humans.length === 1) {
      const lookK = 0.35;
      const lookMax = 220;
      const lookX = Phaser.Math.Clamp(this.player.vx * lookK, -lookMax, lookMax);
      const lookY = Phaser.Math.Clamp(this.player.vy * lookK, -lookMax, lookMax);
      cam.setFollowOffset(-lookX, -lookY);
      return;
    }

    // Pick focus targets: any humans still racing. If both finished, fall back to all humans
    // so the camera doesn't snap. The min-span guard prevents the zoom from jumping to max
    // when both players cluster very close together.
    const active = this.humans.filter((h) => h.finishedAtMs == null);
    const focus = active.length > 0 ? active : this.humans;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of focus) {
      if (f.x < minX) minX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.x > maxX) maxX = f.x;
      if (f.y > maxY) maxY = f.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const margin = 280;
    const spanX = Math.max(220, maxX - minX) + margin * 2;
    const spanY = Math.max(220, maxY - minY) + margin * 2;
    const fitZoom = Math.min(cam.width / spanX, cam.height / spanY);
    const targetZoom = Phaser.Math.Clamp(fitZoom, 0.35, 0.85);

    // Frame-rate independent lerp. Zoom transitions need to be slower than centering or
    // sudden separations look jittery; the rates below were tuned empirically.
    const zoomLerp = 1 - Math.exp(-dt * 4);
    const centerLerp = 1 - Math.exp(-dt * 6);
    cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * zoomLerp);
    // Phaser's cam.scrollX is `midX - cam.width / 2` (no zoom factor); use `midPoint` to read
    // the actual world-space center so the lerp converges instead of drifting.
    const curCx = cam.midPoint.x;
    const curCy = cam.midPoint.y;
    cam.centerOn(
      curCx + (cx - curCx) * centerLerp,
      curCy + (cy - curCy) * centerLerp,
    );
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
          c.lastCheckpointMs = now;
        }
      }
    } else {
      this.hud.hideCountdown();
    }
  }

  private runRacing(dt: number, now: number) {
    if (now - this.raceStartedAt > 1000) this.hud.hideCountdown();

    this.updateRaceCamera(dt);

    for (const c of this.cars) c.draft = this.computeDraft(c);

    for (let i = 0; i < this.humans.length; i++) {
      const human = this.humans[i];
      const active = human.finishedAtMs == null;
      const input = active ? this.humanInput(i) : NO_INPUT;
      human.audioThrottle = input.throttle;
      human.update(dt, input, this.surfaceFeel(human));
      if (active && input.useItem) this.useItem(human);
      this.applyTrackBounds(human);
      if (active) this.updateDrsForCar(human, input, now);
    }

    for (const ai of this.ai) {
      const aiActive = ai.finishedAtMs == null;
      const input = aiActive ? this.aiInput(ai) : NO_INPUT;
      ai.audioThrottle = input.throttle;
      ai.update(dt, input, this.surfaceFeel(ai));
      this.applyTrackBounds(ai);
      if (aiActive && ai.itemSlot && ai.useItemAt != null && now >= ai.useItemAt) {
        this.useItem(ai);
      }
      if (aiActive) this.updateDrsForCar(ai, input, now);
    }

    this.updatePickups();
    this.updateOilSlicks(dt);
    this.updateMissiles(dt);
    this.updateSeekers(dt);
    this.updateSkidMarks(dt);
    this.updateDust();
    this.updateDrsAirflow();
    for (const c of this.cars) this.updateLapTracking(c, now);
    for (const c of this.cars) this.updateUnstuck(c, now);
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
    // Both penalties scale linearly with how many corners are on the off-asphalt surface:
    // averaging drag and gripFactor across the 4 corners means 1 corner on grass contributes 25% of grass's penalty,
    // 2 corners → 50%, etc. (asphalt's gripFactor of 1.0 is the no-penalty identity in the average.)
    let drag = 0;
    let gripFactor = 0;
    let n = 0;
    for (const c of car.corners()) {
      const surf = this.track.surfaceAt(c.x, c.y);
      const params = SURFACE_PARAMS[surf];
      drag += params.drag;
      gripFactor += params.gripFactor;
      n++;
    }
    return { drag: drag / n, gripFactor: gripFactor / n };
  }

  private applyTrackBounds(car: Car) {
    const half = this.track.width / 2;

    car.onTrack = this.track.probe(car.x, car.y).distance <= half;

    let worstOverflow = 0;
    let worstNx = 0;
    let worstNy = 0;
    let worstHitX = 0;
    let worstHitY = 0;
    for (const c of car.corners()) {
      const probe = this.track.probe(c.x, c.y);
      const wallAt = this.track.wallOffset(probe.side, probe.index);
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

      // Spark burst on actual impact. Threshold filters out the constant wall-hugging contact
      // when a car drifts along a wall. Count scales with normal-velocity magnitude.
      const SPARK_VN_THRESHOLD = 60;
      if (vn > SPARK_VN_THRESHOLD) {
        // Push the emit point slightly off the wall so sparks don't visually clip into it.
        const hx = worstHitX - worstNx * 2;
        const hy = worstHitY - worstNy * 2;
        if (this.sparks) {
          const count = Math.min(20, Math.round(vn / 18));
          this.sparks.burst(hx, hy, count);
        }
        if (this.audioBus) {
          // Map vn 60 → ~0, vn 360 → 1. Same threshold as sparks so visual + audio agree.
          const intensity = Math.min(1, (vn - SPARK_VN_THRESHOLD) / 300);
          playWallThumpSfx(this.audioBus, hx, hy, intensity);
        }
      }
    }
  }

  // Per-car DRS state machine. Runs once per active car per frame *after* car.update +
  // applyTrackBounds so wall collisions have already settled the position. Detections and zones
  // are independent: detection crosses set/clear `Car.drsAvailable`; zone-start arms activation
  // if available; zone-end clears `drsActive` only (`drsAvailable` persists per spec — "stays
  // available until next detection point").
  private updateDrsForCar(car: Car, input: CarInput, now: number) {
    const detections = this.track.drsDetections;
    const zones = this.track.drsZones;
    if (detections.length === 0 && zones.length === 0) return;
    const state = this.drsState.get(car);
    if (!state) return;

    for (let d = 0; d < detections.length; d++) {
      const touching = this.track.gateHit(detections[d].gate, car.x, car.y);
      const enter = touching && !state.prevDetTouching[d];
      state.prevDetTouching[d] = touching;
      if (enter) this.onDrsDetectionCross(car, d, now);
    }

    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      const startTouching = this.track.gateHit(zone.start, car.x, car.y);
      const endTouching = this.track.gateHit(zone.end, car.x, car.y);
      const startEnter = startTouching && !state.prevStartTouching[z];
      const endEnter = endTouching && !state.prevEndTouching[z];
      state.prevStartTouching[z] = startTouching;
      state.prevEndTouching[z] = endTouching;
      if (startEnter) this.onDrsZoneStart(car, state, z, now);
      if (endEnter) this.onDrsZoneEnd(car, state, z);
    }

    // Auto activation: fire when the scheduled timestamp elapses.
    if (state.scheduledActivateAt != null && now >= state.scheduledActivateAt && !car.drsActive) {
      car.drsActive = true;
      state.scheduledActivateAt = null;
    }

    // Manual activation (humans only — AI never sets useDrs). Pressing the DRS key inside any
    // zone re-arms `drsActive` even after a lift-cancel, as long as eligibility still holds.
    if (
      input.useDrs &&
      car.drsAvailable &&
      !car.drsActive &&
      state.insideZoneIdx != null &&
      this.modeForCar(car) === "manual"
    ) {
      car.drsActive = true;
      state.scheduledActivateAt = null;
    }

    // Lift / brake cancels DRS. Doesn't clear drsAvailable — chaser can re-trigger via manual
    // press, and the eligibility flag survives until the next detection cross per spec.
    if (car.drsActive && (input.throttle === 0 || input.brake > 0)) {
      car.drsActive = false;
      state.scheduledActivateAt = null;
    }
  }

  private onDrsDetectionCross(car: Car, detIdx: number, now: number) {
    const log = this.drsDetectionLog[detIdx];
    // Most recent prior crosser at this detection point, excluding this car. Lap is intentionally
    // not considered — the gap is a physical time-difference at the line. If a leader is lapping
    // a backmarker and crosses the detection 0.5s after them, the leader is genuinely 0.5s
    // behind at the line and gets DRS to chase past, regardless of who's on which lap.
    let priorT: number | null = null;
    for (let i = log.length - 1; i >= 0; i--) {
      const r = log[i];
      if (r.car === car) continue;
      priorT = r.t;
      break;
    }
    log.push({ car, t: now });

    // Each detection cross fully overwrites the eligibility flag — "stays available until next
    // detection point", at which point we re-evaluate. Cleared if gap doesn't qualify or the
    // scene-wide DRS isn't enabled yet.
    if (!this.drsEnabled || priorT == null) {
      car.drsAvailable = false;
      return;
    }
    const gap = now - priorT;
    car.drsAvailable = gap > 0 && gap <= DRS_GAP_MS;
  }

  private onDrsZoneStart(car: Car, state: DrsCarState, zoneIdx: number, now: number) {
    if (!car.drsAvailable) return;
    state.insideZoneIdx = zoneIdx;
    if (this.modeForCar(car) === "auto") {
      state.scheduledActivateAt = now + this.drsAutoActivationDelay(car);
    }
  }

  private onDrsZoneEnd(car: Car, state: DrsCarState, zoneIdx: number) {
    // Only respond to the end gate of the zone we're currently inside. Stops a rogue end-gate
    // cross (e.g. chicane geometry) from clobbering DRS activated for a different zone.
    if (state.insideZoneIdx !== zoneIdx) return;
    car.drsActive = false;
    state.scheduledActivateAt = null;
    state.insideZoneIdx = null;
    // Note: `car.drsAvailable` is intentionally not cleared here. Eligibility persists across
    // zones until the next detection cross.
  }

  private modeForCar(car: Car): DrsMode {
    if (car.playerIndex === 0) return this.drsModes.p1;
    if (car.playerIndex === 1) return this.drsModes.p2;
    return "auto";
  }

  // Auto-activation delay (ms). Humans get a flat 200ms; AI gets a skill-driven base + jitter so
  // weaker AI react slower and there's some variation across opponents.
  private drsAutoActivationDelay(car: Car): number {
    if (car.isPlayer) return DRS_AUTO_DELAY_MS;
    const skill = this.aiSkill.get(car)?.skill ?? 0.7;
    const base = DRS_AUTO_DELAY_MS + (1 - skill) * DRS_AI_SKILL_SPREAD;
    const jitter = (Math.random() * 2 - 1) * DRS_AI_JITTER;
    return Math.max(0, base + jitter);
  }

  private aiInput(ai: Car): CarInput {
    const bestIdx = this.closestCenterlineIdx(ai);
    const speed = ai.speed;
    const target = this.aimAtRacingLine(ai, bestIdx);
    const desiredAng = Math.atan2(target.y - ai.y, target.x - ai.x);
    const diff = Phaser.Math.Angle.Wrap(desiredAng - ai.heading);
    const steer = Phaser.Math.Clamp(diff * 1.8, -1, 1);

    const targetSpeed = this.aiCornerSpeed(bestIdx, speed, ai.config.maxSpeed);
    let throttle = 1;
    let brake = 0;
    if (speed > targetSpeed * AI_BRAKE_DEADZONE) {
      brake = Phaser.Math.Clamp((speed - targetSpeed) / 80, 0.2, 1);
      throttle = 0;
    } else if (speed > targetSpeed) {
      throttle = Phaser.Math.Clamp((targetSpeed - speed) / AI_THROTTLE_TAPER + 1, 0.4, 1);
    }
    // Steer-induced safety brake: if the aim point is way off heading we're already losing
    // the corner, so dump throttle and add brake on top of the curvature-driven decision.
    if (Math.abs(diff) > 0.6 && speed > 200) {
      throttle = Math.min(throttle, 0.4);
      brake = Math.max(brake, 0.3);
    }

    return { throttle, brake, steer, useItem: false, useDrs: false };
  }

  private closestCenterlineIdx(ai: Car): number {
    const pts = this.track.centerline;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Phaser.Math.Distance.Squared(pts[i].x, pts[i].y, ai.x, ai.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  private aimAtRacingLine(ai: Car, bestIdx: number) {
    const pts = this.track.centerline;
    const rl = this.track.racingLine.length === pts.length ? this.track.racingLine : pts;
    const n = pts.length;
    // Arc-length lookahead: walk forward from bestIdx until we've covered
    // AI_LOOKAHEAD_DIST in real distance. Robust to uneven centerline spacing.
    const cumS = this.track.centerlineCumS;
    const totalLen = cumS[n];
    let aimIdx = bestIdx;
    if (cumS.length === n + 1 && totalLen > 0) {
      let acc = 0;
      for (let step = 1; step <= n; step++) {
        const cur = (bestIdx + step) % n;
        const prev = (cur - 1 + n) % n;
        const segEnd = cur === 0 ? totalLen : cumS[cur];
        const segLen = segEnd - cumS[prev];
        acc += segLen;
        if (acc >= AI_LOOKAHEAD_DIST) { aimIdx = cur; break; }
      }
    } else {
      aimIdx = (bestIdx + 4) % n;
    }
    const aim = rl[aimIdx];

    const state = this.aiSkill.get(ai);
    if (!state) return aim;

    const currentChunk = Math.floor(bestIdx / AIM_CHUNK_SIZE);
    if (currentChunk !== state.chunk) {
      state.chunk = currentChunk;
      state.aimOffset = this.sampleAimOffset(state.skill);
    }
    if (state.aimOffset === 0) return aim;

    const prev = pts[(aimIdx - 1 + n) % n];
    const next = pts[(aimIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { x: aim.x + nx * state.aimOffset, y: aim.y + ny * state.aimOffset };
  }

  // Walk the racing line forward. At each point, compute the corner-entry speed allowed by
  // its curvature, then convert to "max speed we can be at right now and still make that
  // corner" via v_now = √(v_corner² + 2 · brake · arc_length_to_point). Return the minimum
  // such threshold across the scan window. So AI cruises at maxSpeed until a corner enters
  // its actual braking horizon — no more crawling 800px before a tight bend.
  private aiCornerSpeed(bestIdx: number, _speed: number, maxSpeed: number): number {
    const curv = this.track.racingLineCurvature;
    if (curv.length === 0) return maxSpeed;
    const rl = this.track.racingLine.length === curv.length
      ? this.track.racingLine
      : this.track.centerline;
    const n = rl.length;
    let acc = 0;
    let minThreshold = maxSpeed;
    for (let step = 0; step < n; step++) {
      const i = (bestIdx + step) % n;
      const j = (bestIdx + step + 1) % n;
      acc += Math.hypot(rl[j].x - rl[i].x, rl[j].y - rl[i].y);
      const k = curv[i];
      if (k > 0) {
        const vCorner = Math.min(maxSpeed, Math.sqrt(AI_LATERAL_GRIP_LIMIT / k));
        const vNow = Math.sqrt(vCorner * vCorner + 2 * AI_BRAKE_DECEL * acc);
        if (vNow < minThreshold) minThreshold = vNow;
      }
      if (acc > AI_BRAKE_SCAN_DIST) break;
    }
    return minThreshold;
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
          // Only humans trigger the chime — AI pickups are silent. The chime is feedback
          // for the player who grabbed the box, not a positional cue about distant traffic.
          if (this.audioBus && c.isPlayer) playPickupChime(this.audioBus, p.baseX, p.baseY);
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
    const bus = this.audioBus;
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
        if (bus) playShieldUpSfx(bus, car.x, car.y);
        this.flashFor(car, "SHIELD!", 700);
        break;
    }
  }

  // Routes a HUD flash to the right HUD slot. AI cars get no flash.
  private flashFor(car: Car, text: string, ms: number) {
    if (car.playerIndex == null) return;
    const hud = car.playerIndex === 0 ? this.hud : this.hud2;
    hud?.flash(text, ms);
  }

  // Session-wide broadcast (e.g. new fastest lap, DRS enabled). Routed to the left HUD's
  // dedicated broadcast slot, which renders once at screen center — even in 2P, where the
  // per-player `flash()` slots are offset to either side.
  private flashAll(text: string, ms: number) {
    this.hud.broadcast(text, ms);
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
      owner,
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

      // Lock onto any non-owner car within range, regardless of human/AI status.
      let nearest: Car | null = null;
      let nearestD = Infinity;
      for (const c of this.cars) {
        if (c === m.owner) continue;
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
        if (c === m.owner) continue;
        if (Phaser.Math.Distance.Between(c.x, c.y, m.x, m.y) < 22) {
          if (c.spin(1.2)) {
            if (this.audioBus) playExplosionSfx(this.audioBus, c.x, c.y);
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

  private fireSeeker(owner: Car) {
    const speed = 520;
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

    const g = this.add.graphics();
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
      vx: (tdx / tlen) * speed,
      vy: (tdy / tlen) * speed,
      owner,
      expiresAt: this.time.now + 6000,
      nodeIdx,
    });
  }

  private updateSeekers(dt: number) {
    const now = this.time.now;
    const cl = this.track.centerline;
    const n = cl.length;
    const speed = 520;
    const lockRadius = 140;
    const advanceR2 = 144; // 12 px node-arrival threshold

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

      if (s.nodeIdx != null && nearest && nearestD < lockRadius) {
        // First-time lock-on. Drop the centerline state — from here on it homes like a missile.
        s.nodeIdx = null;
      }

      if (s.nodeIdx == null) {
        // Homing mode: same turn-cap behaviour as the missile, no range gate once locked.
        if (nearest) {
          const ang = Math.atan2(nearest.y - s.y, nearest.x - s.x);
          const cur = Math.atan2(s.vy, s.vx);
          const turn = 4.5 * dt;
          const newAng = cur + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(ang - cur), -turn, turn);
          s.vx = Math.cos(newAng) * speed;
          s.vy = Math.sin(newAng) * speed;
        }
      } else {
        // Centerline-follow: steer straight at the next node, advance when we're close enough.
        let safety = n;
        let target = cl[s.nodeIdx];
        let dx = target.x - s.x;
        let dy = target.y - s.y;
        while (dx * dx + dy * dy < advanceR2 && safety-- > 0) {
          s.nodeIdx = (s.nodeIdx + 1) % n;
          target = cl[s.nodeIdx];
          dx = target.x - s.x;
          dy = target.y - s.y;
        }
        const len = Math.hypot(dx, dy) || 1;
        s.vx = (dx / len) * speed;
        s.vy = (dy / len) * speed;
      }

      let hit = false;
      for (const c of this.cars) {
        if (c === s.owner) continue;
        if (Phaser.Math.Distance.Between(c.x, c.y, s.x, s.y) < 22) {
          if (c.spin(1.2)) {
            if (this.audioBus) playExplosionSfx(this.audioBus, c.x, c.y);
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
          if (c.spin(0.9)) {
            if (this.audioBus) playSpinoutSfx(this.audioBus, c.x, c.y);
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

  private spawnShieldFlash(car: Car) {
    if (this.audioBus) playShieldBlockSfx(this.audioBus, car.x, car.y);
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
    this.flashFor(car, "BLOCKED!", 600);
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
    car.lastCheckpointMs = now;

    if (cp !== 0) return;

    const lapMs = now - car.currentLapStartMs;
    const beatPersonal = car.bestLapMs == null || lapMs < car.bestLapMs;
    if (beatPersonal) car.bestLapMs = lapMs;
    const beatSession = this.sessionBestLapMs == null || lapMs < this.sessionBestLapMs;
    if (beatSession) {
      this.sessionBestLapMs = lapMs;
      this.flashAll(`FASTEST LAP ${car.name}`, 1500);
    } else if (beatPersonal) {
      this.flashFor(car, "PERSONAL BEST", 1500);
    }
    car.currentLapStartMs = now;
    car.lap++;

    // First time any car completes lap 1 → DRS becomes active for the rest of the race.
    // Skipped entirely on tracks without DRS data so we don't broadcast a meaningless message.
    if (!this.drsEnabled && car.lap >= 1 && this.track.drsZones.length > 0) {
      this.drsEnabled = true;
      this.flashAll("DRS ENABLED", 1500);
    }

    const winnerAlreadyFinished = this.cars.some((c) => c.finishedAtMs != null);
    if (car.lap >= this.totalLaps || winnerAlreadyFinished) {
      car.finishedAtMs = now;
    }
  }

  // Auto-unstuck watchdog. Any car that hasn't advanced a checkpoint in UNSTUCK_TIMEOUT_MS gets
  // teleported back to the last gate it crossed, on the centerline, facing the racing direction.
  // Catches AI getting wedged on walls and humans giving up on a recovery; trades a small
  // teleport pop for not having to ESC → restart.
  private updateUnstuck(car: Car, now: number) {
    if (car.finishedAtMs != null) return;
    if (now - car.lastCheckpointMs < UNSTUCK_TIMEOUT_MS) return;
    const N = this.track.checkpoints.length;
    const lastCp = (car.nextCheckpoint - 1 + N) % N;
    const gate = this.track.checkpoints[lastCp];
    car.sprite.x = gate.x;
    car.sprite.y = gate.y;
    car.heading = gate.angle;
    car.vx = 0;
    car.vy = 0;
    car.spinTimer = 0;
    car.boostTimer = 0;
    car.lastCheckpointMs = now;
    if (car.isPlayer) this.flashFor(car, "UNSTUCK", 1200);
  }

  private rankedCars(): Car[] {
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

  private computePositions(): PositionRow[] {
    return this.rankedCars().map((car, i) => ({
      pos: i + 1,
      name: car.name,
      isPlayer: car.isPlayer,
      lapsDone: car.lap,
      finished: car.finishedAtMs != null,
    }));
  }

  private showResults() {
    const sorted = this.rankedCars();
    const allDone = this.cars.every((c) => c.finishedAtMs != null);
    // In 2P we keep the compact panel while *any* human is still racing — flip to the full
    // RACE OVER panel only when both humans have crossed the line. Mirrors the 1P semantics
    // (where there is only one human anyway).
    const anyHumanActive = this.humans.some((h) => h.finishedAtMs == null);
    const compact = anyHumanActive && !allDone;

    const lines: string[] = [];
    let prevCar: Car | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const car = sorted[i];
      const pos = i + 1;
      const isPlayer = car.isPlayer;

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

      const tag = isPlayer ? " ◂ YOU" : "";
      const nameCol = car.name.padEnd(4);

      if (compact) {
        const timeColPadded = timeCol.padEnd(10);
        lines.push(`P${pos} ${nameCol} ${timeColPadded}`);
      } else {
        const best = car.bestLapMs != null ? formatRaceTime(car.bestLapMs) : "—";
        const timeColPadded = timeCol.padEnd(11);
        lines.push(`P${pos}  ${nameCol}  ${timeColPadded}  best ${best}${tag}`);
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
    const elapsed =
      this.state === "countdown"
        ? 0
        : this.state === "racing"
          ? now - this.raceStartedAt
          : this.raceEndedAt - this.raceStartedAt;
    const positions = this.computePositions();
    const multi = this.humans.length === 2;

    // Drive each visible HUD slot from its corresponding human car. Key labels mirror the
    // existing handedness convention: SPACE/Q belong to the WASD scheme (P0), ENTER/SHIFT to the
    // arrows scheme (P1). 1P readAuto accepts both, so either label works in 1P.
    const slots: { hud: Hud; car: Car; useKey: string; drsKey: string }[] = [
      { hud: this.hud, car: this.humans[0], useKey: "SPACE", drsKey: "Q" },
    ];
    if (multi && this.hud2)
      slots.push({ hud: this.hud2, car: this.humans[1], useKey: "ENTER", drsKey: "SHIFT" });

    for (const s of slots) {
      s.hud.setSpeed(s.car.speed * 0.36);
      s.hud.setLap(s.car.lap + 1, this.totalLaps);
      s.hud.setTime(elapsed);
      s.hud.setBest(s.car.bestLapMs);
      s.hud.setItem(s.car.itemSlot, s.useKey);
      const manual = this.modeForCar(s.car) === "manual";
      const drsState = s.car.drsActive
        ? "active"
        : s.car.drsAvailable
          ? "available"
          : "off";
      s.hud.setDrs(drsState, manual ? s.drsKey : "auto");
    }
    // Position panel only lives on the left HUD; in 2P it's repositioned to bottom-center.
    this.hud.setPositions(positions, this.totalLaps);
    this.hud.update(multi);
    this.hud2?.update(multi);
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
