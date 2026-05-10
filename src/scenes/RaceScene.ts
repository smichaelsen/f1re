import Phaser from "phaser";
import { Car, DEFAULT_CAR, type CarInput, type SurfaceFeel } from "../entities/Car";
import { ensureCarTexture, randomVariant } from "../entities/CarSprite";
import { DEFAULT_TEAM_ID, TEAMS, teamById, type Team, type TeamId } from "../entities/Team";
import { Track } from "../entities/Track";
import { parseTrackData, SURFACE_PARAMS } from "../entities/TrackData";
import { Hud, formatRaceTime } from "../ui/Hud";
import { TouchControls } from "../ui/TouchControls";
import { DIFFICULTIES, LAPS_MAX, LAPS_MIN, OPPONENTS_MAX, OPPONENTS_MIN, PLAYERS_MAX, PLAYERS_MIN } from "./MenuScene";
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
}
type RaceState = "countdown" | "racing" | "finished";

const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, useItem: false, useDrs: false };

// Auto-unstuck watchdog. A car that fails to advance a single checkpoint in this many ms gets
// teleported back to its last gate. 30s catches genuinely wedged cars without making slow but
// progressing recoveries (post-spin, off-track scrub) trip the watchdog.
const UNSTUCK_TIMEOUT_MS = 30_000;

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
  escapeKey!: Phaser.Input.Keyboard.Key;
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
    this.opponentCount = Phaser.Math.Clamp(data.opponents ?? 3, OPPONENTS_MIN, OPPONENTS_MAX);
    this.inputSources = (data.inputSources ?? []).slice(0, this.playerCount);
    this.drsModes = data.drsModes ?? loadDrsModes();
    // 2P always uses fit-to-both framing; cockpit-cam is a 1P-only experiment for now.
    this.cockpitCam = (data.cockpitCam ?? false) && this.playerCount === 1;
    this.playerNames = [
      sanitizeName(data.name1, "PLAYER 1"),
      sanitizeName(data.name2, "PLAYER 2"),
    ];
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
        variant: randomVariant(Math.random),
      };
      const name = this.playerNames[i] ?? `PLAYER ${i + 1}`;
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
      const slot = gridSlot(this.track, this.humans.length + i);
      const team = aiTeamPool[i];
      const livery = {
        primary: team.primary,
        secondary: team.secondary,
        variant: randomVariant(Math.random),
      };
      const seen = (teamCounts.get(team.id) ?? 0) + 1;
      teamCounts.set(team.id, seen);
      // Two driver names per team, one per car slot; aiTeamPool ensures `seen` is 1 or 2.
      const aiName = team.drivers[Phaser.Math.Clamp(seen - 1, 0, team.drivers.length - 1)];
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
      this.aiDriver.register(aiCar, Phaser.Math.FloatBetween(sLow, sHigh));
    }
    this.cars = [...this.humans, ...this.ai];
    this.drs.init(this.cars);

    this.raceCam = new RaceCamera(this.cameras.main, this.humans, this.cockpitCam);

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

    this.audioCtrl = new RaceAudioController(this, this.cars);

    this.items = new ItemSystem(
      this,
      this.track,
      this.uiCam,
      this.cars,
      this.aiDriver,
      () => this.audioCtrl.bus(),
      (car, text, ms) => this.flashFor(car, text, ms),
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

    for (const c of this.cars) c.draft = computeDraft(c, this.cars);

    for (let i = 0; i < this.humans.length; i++) {
      const human = this.humans[i];
      const active = human.finishedAtMs == null;
      const input = active ? this.humanInput(i) : NO_INPUT;
      human.audioThrottle = input.throttle;
      human.update(dt, input, this.surfaceFeel(human));
      if (active && input.useItem) this.items.useItem(human);
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
    // Every completed lap is a candidate for the all-time top-10 board. The recorder caps
    // the list itself, so we don't need to gate on "fast enough" here.
    recordFastestLap(this.trackKey, {
      name: car.name,
      ms: lapMs,
      isPlayer: car.isPlayer,
      recordedAt: Date.now(),
    });
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

  private showResults() {
    const sorted = rankedCars(this.cars, this.track);
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
      const nameCol = car.name.padEnd(8);

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
      s.hud.setTime(elapsed);
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

