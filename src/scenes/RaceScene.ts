import Phaser from "phaser";
import { Car, DEFAULT_CAR, type CarInput, type SurfaceFeel } from "../entities/Car";
import { ensureCarTexture } from "../entities/CarSprite";
import { DEFAULT_TEAM_ID, DRIVER_SKILL_MAX, DRIVER_SKILL_MIN, TEAMS, teamById, type Team, type TeamId, type TeamPerf } from "../entities/Team";
import type { CarConfig } from "../types";
import { Track } from "../entities/Track";
import { parseTrackData, SURFACE_PARAMS } from "../entities/TrackData";
import { Hud, formatRaceTime } from "../ui/Hud";
import { TouchControls } from "../ui/TouchControls";
import { DIFFICULTIES, LAPS_MAX, LAPS_MIN, OPPONENTS_MIN, PLAYERS_MAX, PLAYERS_MIN, opponentsMaxFor } from "./MenuScene";
import type { Difficulty, PlayerCount, TrackKey } from "./MenuScene";
import { recordFastestLap } from "./FastestLaps";
import { RaceAudioController } from "../audio/RaceAudioController";
import { InputReader, type InputSource } from "../input/InputSource";
import { defaultDrsModes, loadDrsModes, type DrsModes } from "../input/DrsMode";
import { AIDriver } from "../ai/AIDriver";
import { DrsManager } from "../race/DrsManager";
import { ItemSystem } from "../race/ItemSystem";
import { RaceFx } from "../race/RaceFx";
import { RaceCamera } from "../race/RaceCamera";
import { applyTrackBounds, handleCarCollisions } from "../physics/Collisions";
import { gridSlot } from "../race/Grid";
import { rankedCars, computePositions, formatGap } from "../race/Standings";
import { computeDraft } from "../race/Draft";
import { sanitizeName } from "./MenuPrefs";

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
  // 1P-only: rotate the world so player heading is always up. Ignored in 2P (split-screen camera
  // owns its own framing).
  cockpitCam?: boolean;
  // Player display names (≤8 chars). Default to "PLAYER 1" / "PLAYER 2" upstream.
  name1?: string;
  name2?: string;
  // Active cheats for this race. null = none. Forwarded only when the player has unlocked the
  // cheats menu — see MenuScene.start. AI never benefits from cheats.
  cheats?: ActiveCheats | null;
}

export interface ActiveCheats {
  diamondArmor: boolean;
  offRoadWheels: boolean;
  mazeSpin: boolean;
  hammerTime: boolean;
  deathmatch: boolean;
}

const NO_CHEATS: ActiveCheats = { diamondArmor: false, offRoadWheels: false, mazeSpin: false, hammerTime: false, deathmatch: false };

// HAMMERTIME multiplier applied to a human car's config.maxSpeed at construction time.
// Affects the absolute speed cap only — accel and grip stay untouched, so launch + cornering feel
// the same; cars just don't bleed off speed on long straights. Stacks with boost / DRS / draft.
const HAMMER_TIME_TOP_SPEED_MULT = 1.30;
type RaceState = "countdown" | "racing" | "paused" | "finished";

const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, useItem: false, useDrs: false };

// Auto-unstuck watchdog. A car that fails to advance a single checkpoint in this many ms gets
// teleported back to its last gate. 30s catches genuinely wedged cars without making slow but
// progressing recoveries (post-spin, off-track scrub) trip the watchdog.
const UNSTUCK_TIMEOUT_MS = 30_000;

// Apply a team's perf multipliers to DEFAULT_CAR. Used for human cars (no jitter on top —
// the player gets exactly what the menu shows). AI inlines the same multiplication next to
// the difficulty jitter roll.
function applyTeamPerf(perf: TeamPerf): CarConfig {
  return {
    ...DEFAULT_CAR,
    maxSpeed: DEFAULT_CAR.maxSpeed * perf.topSpeed,
    accel: DEFAULT_CAR.accel * perf.accel,
    grip: DEFAULT_CAR.grip * perf.grip,
  };
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

  private items!: ItemSystem;

  private aiDriver!: AIDriver;
  private audioCtrl!: RaceAudioController;
  private fx!: RaceFx;

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
  // Sanitised display names for the human players (already clamped/uppercased upstream).
  playerNames: string[] = ["PLAYER 1", "PLAYER 2"];
  inputReader!: InputReader;
  // Per-player DRS auto/manual mode. Index 0 = P1, 1 = P2. AI cars always use auto.
  // Stashed from `init(data)`; passed to DrsManager once at create() time.
  private drsModes: DrsModes = defaultDrsModes();
  private drs!: DrsManager;
  private cheats: ActiveCheats = NO_CHEATS;
  escapeKey!: Phaser.Input.Keyboard.Key;
  pauseKey!: Phaser.Input.Keyboard.Key;
  // Wall-clock time at which the current pause started. Read on resume to compute the dt
  // we shift every gameplay timestamp by, so paused intervals don't accelerate timers.
  private pausedAtMs: number | null = null;
  uiCam!: Phaser.Cameras.Scene2D.Camera;
  private cockpitCam = false;
  private raceCam!: RaceCamera;

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
    this.opponentCount = Phaser.Math.Clamp(data.opponents ?? 3, OPPONENTS_MIN, opponentsMaxFor(this.playerCount));
    this.inputSources = (data.inputSources ?? []).slice(0, this.playerCount);
    this.drsModes = data.drsModes ?? loadDrsModes();
    // 2P always uses fit-to-both framing; cockpit-cam is a 1P-only experiment for now.
    this.cockpitCam = (data.cockpitCam ?? false) && this.playerCount === 1;
    this.playerNames = [
      sanitizeName(data.name1, "PLAYER 1"),
      sanitizeName(data.name2, "PLAYER 2"),
    ];
    this.cheats = data.cheats ?? NO_CHEATS;
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
    this.hud2 = null;
    this.state = "countdown";
    this.raceStartedAt = 0;
    this.raceEndedAt = 0;
    this.sessionBestLapMs = null;

    const raw = this.cache.json.get(`track-${this.trackKey}`);
    this.track = Track.fromData(this, parseTrackData(raw));
    this.aiDriver = new AIDriver(this.track, () => this.cars);
    this.drs = new DrsManager(
      this.track,
      this.drsModes,
      (car) => this.aiDriver.skillFor(car),
      (text, ms) => this.flashAll(text, ms),
    );

    this.fx = new RaceFx(this, this.track);

    // Spawn humans into grid slots 0..N-1. Each gets playerIndex 0/1 so per-player HUDs and
    // per-player flashes can later route by index. Slot 0 is pole, slot 1 is the row behind.
    const humanTeams: Team[] = [teamById(this.teamId)];
    if (this.playerCount === 2) humanTeams.push(teamById(this.teamId2));
    for (let i = 0; i < humanTeams.length; i++) {
      const slot = gridSlot(this.track, i);
      const team = humanTeams[i];
      const livery = {
        primary: team.primary,
        secondary: team.secondary,
        variant: team.variant,
        tertiary: team.tertiary,
      };
      const name = this.playerNames[i] ?? `PLAYER ${i + 1}`;
      const cfg = applyTeamPerf(team.perf);
      if (this.cheats.hammerTime) cfg.maxSpeed *= HAMMER_TIME_TOP_SPEED_MULT;
      const car = new Car(this, slot.x, slot.y, ensureCarTexture(this, livery), name, true, cfg);
      car.heading = slot.heading;
      car.playerIndex = i;
      car.teamId = team.id;
      this.humans.push(car);
    }
    this.player = this.humans[0];

    const params = DIFFICULTIES[this.difficulty];
    const teamCounts = new Map<string, number>();
    for (const t of humanTeams) teamCounts.set(t.id, (teamCounts.get(t.id) ?? 0) + 1);
    // Pair-fill: prefer giving the next AI to a team that already has one seat taken
    // (human or earlier AI), so existing teams get rounded out to 2 before any fresh
    // team is opened. Fallback to empty teams when no team-with-one exists. Picked
    // per-iteration (not pre-shuffled into a pool) because each pick changes which
    // teams qualify as "partner needed".
    const pickAiTeam = (): typeof TEAMS[number] => {
      const partners = TEAMS.filter((t) => (teamCounts.get(t.id) ?? 0) === 1);
      const fresh = TEAMS.filter((t) => (teamCounts.get(t.id) ?? 0) === 0);
      const pool = partners.length > 0 ? partners : fresh;
      return pool[Math.floor(Math.random() * pool.length)];
    };
    // Pre-pass: pick all AI teams via pair-fill, record each AI's seat (0/1) so we can
    // look up that driver's hardcoded skill, then assign a qualifying score. The grid is
    // sorted by score (highest = slot 1, the front of the AI grid) so a top-team + top-skill
    // AI usually qualifies near pole, and a bottom-team AI almost never does. Random jitter
    // keeps the order non-deterministic — a high-skill mid-team driver can occasionally beat
    // a top-team driver on an off day, but rarely. (Player keeps slot 0 regardless of team.)
    const [sLow, sHigh] = params.skillRange;
    const driverRange = DRIVER_SKILL_MAX - DRIVER_SKILL_MIN;
    // Linear scale of a hardcoded driver skill into the active difficulty's skillRange. The
    // mapping preserves driver ranking within a difficulty: Hunter (0.99) is always the
    // sharpest AI, Costa (0.47) always the dullest, but the absolute spread compresses on
    // easy and shifts upward on hard.
    const scaleSkill = (driverSkill: number): number => {
      const t = Phaser.Math.Clamp((driverSkill - DRIVER_SKILL_MIN) / driverRange, 0, 1);
      return sLow + t * (sHigh - sLow);
    };
    const aiEntries: { team: Team; seat: number; skill: number; qualiScore: number }[] = [];
    for (let i = 0; i < this.opponentCount; i++) {
      const team = pickAiTeam();
      // teamCounts already has humans pre-loaded, so a team with 1 human gets seat=1 for
      // the first AI on it (drivers[1] = the #2 seat). Increment after reading so subsequent
      // pickAiTeam calls see the updated count for pair-fill logic.
      const seat = teamCounts.get(team.id) ?? 0;
      teamCounts.set(team.id, seat + 1);
      const driverIdx = Math.min(seat, team.driverSkills.length - 1);
      const skill = scaleSkill(team.driverSkills[driverIdx]);
      const perfAvg = (team.perf.topSpeed + team.perf.accel + team.perf.grip) / 3;
      // Weights tuned so team perf dominates (~0.13 spread between top and bottom tier on
      // perf alone), skill adds a meaningful but secondary contribution (~0.09 spread across
      // the difficulty's skillRange at weight 0.15), and random jitter (~0.10 max) tops up.
      const qualiScore = perfAvg + skill * 0.15 + Math.random() * 0.10;
      aiEntries.push({ team, seat, skill, qualiScore });
    }
    aiEntries.sort((a, b) => b.qualiScore - a.qualiScore);
    for (let i = 0; i < this.opponentCount; i++) {
      // AI cars start behind all humans on the grid: offset by humans.length so a 2-player race
      // puts AI in slots 2..N rather than overlapping P2.
      const slot = gridSlot(this.track, this.humans.length + i);
      const { team, seat, skill } = aiEntries[i];
      const livery = {
        primary: team.primary,
        secondary: team.secondary,
        variant: team.variant,
        tertiary: team.tertiary,
      };
      const driverIdx = Math.min(seat, team.drivers.length - 1);
      const aiName = team.drivers[driverIdx];
      const [pLow, pHigh] = params.perfRange;
      // AI stacks team perf × difficulty jitter on top of DEFAULT_CAR. Each axis rolls its
      // own jitter sample so a single AI can be e.g. fast on top end but slow on accel.
      const aiCar = new Car(this, slot.x, slot.y, ensureCarTexture(this, livery), aiName, false, {
        ...DEFAULT_CAR,
        maxSpeed: DEFAULT_CAR.maxSpeed * team.perf.topSpeed * Phaser.Math.FloatBetween(pLow, pHigh),
        accel: DEFAULT_CAR.accel * team.perf.accel * Phaser.Math.FloatBetween(pLow, pHigh),
        grip: DEFAULT_CAR.grip * team.perf.grip * Phaser.Math.FloatBetween(pLow, pHigh),
      });
      aiCar.heading = slot.heading;
      aiCar.teamId = team.id;
      this.ai.push(aiCar);
      this.aiDriver.register(aiCar, skill);
    }
    this.cars = [...this.humans, ...this.ai];
    this.drs.init(this.cars);

    this.raceCam = new RaceCamera(this.cameras.main, this.humans, this.cockpitCam);

    this.hud = new Hud(this, "left", this.cars.length);
    this.hud.onRestart = () => this.scene.restart();
    this.hud.onMenu = () => this.scene.start("MenuScene");
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

    this.audioCtrl = new RaceAudioController(this, this.cars);

    this.items = new ItemSystem(
      this,
      this.track,
      this.uiCam,
      this.cars,
      this.aiDriver,
      () => this.audioCtrl.bus(),
      (car, text, ms) => this.flashFor(car, text, ms),
      (car) => {
        if (this.cheats.deathmatch && !car.dead) {
          car.dead = true;
          if (car.isPlayer) this.flashFor(car, "DEAD", 1500);
        }
      },
    );
    this.items.spawn();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.aKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.sKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.dKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.escapeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.pauseKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.inputReader = new InputReader(this);

    this.state = "countdown";
    this.countdownStartedAt = this.time.now;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audioCtrl.dispose());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.audioCtrl.dispose());
  }

  update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    const now = this.time.now;

    if (Phaser.Input.Keyboard.JustDown(this.escapeKey)) {
      this.scene.start("MenuScene");
      return;
    }

    // P (keyboard) or Start/+ (any connected pad) toggles pause while racing. Allowed only
    // after countdown is over and before the race ends — pausing the grid countdown or the
    // results screen would be silly. Resume shifts every gameplay timestamp by the elapsed
    // pause duration so race time, lap timers, item respawns, missile lifetimes, AI decision
    // deadlines, and DRS detection gaps don't all jump ahead the moment the player unpauses.
    // pollPadPauseEdge runs every frame regardless of state to keep its per-pad edge state
    // fresh — otherwise a button held across a state transition would mis-read on resume.
    const padPauseEdge = this.inputReader.pollPadPauseEdge();
    const kbPauseEdge = Phaser.Input.Keyboard.JustDown(this.pauseKey);
    if (
      (kbPauseEdge || padPauseEdge) &&
      (this.state === "racing" || this.state === "paused")
    ) {
      if (this.state === "racing") {
        this.state = "paused";
        this.pausedAtMs = now;
        this.hud.showCountdown("PAUSED", "#ffd24a");
        // Ramp the audio bus to silence so engines + skid loops aren't humming in the
        // background through the pause.
        this.audioCtrl.setMuted(true);
      } else {
        const pauseDt = now - (this.pausedAtMs ?? now);
        this.shiftTimestamps(pauseDt);
        this.pausedAtMs = null;
        this.state = "racing";
        this.hud.hideCountdown();
        this.audioCtrl.setMuted(false);
      }
      return;
    }

    if (this.state === "paused") return;

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

    this.updateHud();
    this.audioCtrl.update(this.humans, this.state === "racing");
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

    this.raceCam.update(dt);

    // Diamond armor: re-shield humans every frame, with shieldExpiresAt=0 so Car.updateShieldRing
    // takes the no-expiry branch (no blink, no auto-drop). spin() still consumes the shield on
    // every hit, but the next frame restores it before any other system can read shielded.
    if (this.cheats.diamondArmor) {
      for (const h of this.humans) {
        h.shielded = true;
        h.shieldExpiresAt = 0;
      }
    }

    for (const c of this.cars) c.draft = computeDraft(c, this.cars);

    for (let i = 0; i < this.humans.length; i++) {
      const human = this.humans[i];
      const active = human.finishedAtMs == null;
      const input = active ? this.humanInput(i) : NO_INPUT;
      human.audioThrottle = input.throttle;
      human.update(dt, input, this.surfaceFeel(human));
      if (active && input.useItem) {
        // MAZESPIN: empty inventory + fire pressed → conjure a seeker. ItemSystem.useItem
        // shifts off the front, so pushing here is FIFO-safe.
        if (this.cheats.mazeSpin && human.items.length === 0) human.items.push("seeker");
        this.items.useItem(human);
      }
      applyTrackBounds(human, this.track, this.fx, this.audioCtrl.bus());
      if (active) this.drs.update(human, input, now);
    }

    for (const ai of this.ai) {
      const aiActive = ai.finishedAtMs == null;
      const input = aiActive ? this.aiDriver.input(ai, now) : NO_INPUT;
      ai.audioThrottle = input.throttle;
      ai.update(dt, input, this.surfaceFeel(ai));
      applyTrackBounds(ai, this.track, this.fx, this.audioCtrl.bus());
      if (aiActive && this.aiDriver.tickItemUse(ai, now)) {
        this.items.useItem(ai);
      }
      if (aiActive) this.drs.update(ai, input, now);
    }

    this.items.update(dt, now);
    const racing = this.state === "racing";
    this.fx.update(dt, this.cars, racing, (c) => this.audioCtrl.skidIntensityFor(c, racing));
    for (const c of this.cars) this.updateLapTracking(c, now);
    for (const c of this.cars) this.updateUnstuck(c, now);
    handleCarCollisions(this.cars);

    const anyFinished = this.cars.some((c) => c.finishedAtMs != null);
    if (anyFinished) {
      this.showResults();
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart();
        return;
      }
    }

    // DEATHMATCH end-condition: when no car can still race (every car is either dead or
    // already finished), close out the race. Dead-but-not-finished cars get finishedAtMs set
    // here so the existing results pipeline (rankedCars, showResults) can render their row.
    // The progress-based primary sort in rankedCars means rank reflects how far each dead car
    // got before being knocked out.
    if (this.state !== "finished" && this.cheats.deathmatch) {
      const allOut = this.cars.every((c) => c.dead || c.finishedAtMs != null);
      if (allOut) {
        for (const c of this.cars) {
          if (c.finishedAtMs == null) c.finishedAtMs = now;
        }
      }
    }

    if (this.state !== "finished" && this.cars.every((c) => c.finishedAtMs != null)) {
      this.state = "finished";
      this.raceEndedAt = now;
    }
  }

  // True when at least one cheat effect is active for this race. Used to gate the fastest-laps
  // recorder so cheat runs never write to the persistent board. `unlocked` is intentionally
  // excluded — that flag just means the cheats menu is reachable, not that any cheat is on.
  private anyCheatActive(): boolean {
    const c = this.cheats;
    return c.diamondArmor || c.offRoadWheels || c.mazeSpin || c.hammerTime || c.deathmatch;
  }

  private surfaceFeel(car: Car): SurfaceFeel {
    // OFF ROAD WHEELS cheat: humans always read asphalt feel regardless of which surface their
    // corners are on. Stays opt-in to humans only — cheats never apply to AI.
    if (car.isPlayer && this.cheats.offRoadWheels) {
      const asphalt = SURFACE_PARAMS.asphalt;
      return { drag: asphalt.drag, gripFactor: asphalt.gripFactor };
    }
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
    // Every completed lap is a candidate for the all-time top-10 board, *unless* any cheat is
    // active for this race — cheating runs are session-only fun and never persist to the board.
    // Gate on the cheat-on check rather than per-car so AI laps in a cheat race are also
    // excluded (the player could otherwise farm a clean AI lap on a cheat-armed run).
    if (!this.anyCheatActive()) {
      recordFastestLap(this.trackKey, {
        name: car.name,
        ms: lapMs,
        isPlayer: car.isPlayer,
        recordedAt: Date.now(),
      });
    }
    car.currentLapStartMs = now;
    car.lap++;

    this.drs.notifyLapComplete();

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
    // Dead cars (DEATHMATCH cheat) are *meant* to be stuck. Skipping the watchdog avoids
    // teleporting them back to gates they can no longer drive away from.
    if (car.dead) return;
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

  // Shift every wall-clock timestamp the race tracks forward by `dt` ms so a pause doesn't
  // accelerate any timer. Phaser's `this.time.now` keeps advancing while we sit in the
  // paused state — this method walks the systems we own and bumps their time anchors so
  // resume looks like the pause never happened.
  private shiftTimestamps(dt: number): void {
    if (dt <= 0) return;
    this.raceStartedAt += dt;
    if (this.raceEndedAt > 0) this.raceEndedAt += dt;
    for (const c of this.cars) {
      c.currentLapStartMs += dt;
      c.lastCheckpointMs += dt;
      if (c.shieldExpiresAt > 0) c.shieldExpiresAt += dt;
      if (c.useItemAt != null) c.useItemAt += dt;
      if (c.finishedAtMs != null) c.finishedAtMs += dt;
    }
    this.items.shiftTime(dt);
    this.aiDriver.shiftTime(dt);
    this.drs.shiftTime(dt);
  }

  private showResults() {
    // Defer the results panel until every human has crossed the line. While AI is
    // finishing one by one but the player is still racing, the in-race position panel
    // already conveys finish status (checkered flag next to each finished name), so a
    // duplicate compact panel was just visual noise.
    const anyHumanActive = this.humans.some((h) => h.finishedAtMs == null);
    if (anyHumanActive) {
      this.hud.hideResults();
      return;
    }
    const sorted = rankedCars(this.cars, this.track);
    const allDone = this.cars.every((c) => c.finishedAtMs != null);

    const lines: string[] = [];
    // Parallel array of car-livery texture keys for each row line; non-row lines (header,
    // blank spacers, footer) push null so the Hud's pooled icon sprites at those positions
    // stay hidden.
    const rowIcons: (string | null)[] = [];
    let prevCar: Car | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const car = sorted[i];
      const pos = i + 1;
      const isPlayer = car.isPlayer;

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
      const nameCol = car.name.padEnd(8);
      const best = car.bestLapMs != null ? formatRaceTime(car.bestLapMs) : "—";
      const timeColPadded = timeCol.padEnd(11);
      lines.push(`P${pos}  ${nameCol}  ${timeColPadded}  best ${best}${tag}`);
      rowIcons.push(car.sprite.texture.key);

      prevCar = car;
    }

    const header = [allDone ? "RACE OVER" : "RESULTS", ""];
    const footer = [""];
    const iconKeys = [
      ...header.map(() => null as string | null),
      ...rowIcons,
      ...footer.map(() => null as string | null),
    ];
    this.hud.showResults([...header, ...lines, ...footer], iconKeys, false);
  }

  private updateHud() {
    const positions = computePositions(this.cars, this.track);
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
      s.hud.setBest(s.car.bestLapMs);
      s.hud.setItem(s.car.items, s.useKey);
      const manual = this.drs.modeFor(s.car) === "manual";
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

