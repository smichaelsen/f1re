import Phaser from "phaser";
import { ensureCarTexture } from "../entities/CarSprite";
import { DEFAULT_TEAM_ID, TEAMS, type Team, type TeamId } from "../entities/Team";
import { writeInspect } from "../router";
import { Carousel } from "../ui/Carousel";
import {
  describeSource,
  InputReader,
  loadAssignments,
  saveAssignments,
  shortenPadId,
  sourcesEqual,
  type InputAssignments,
  type InputSource,
} from "../input/InputSource";
import { loadDrsModes, saveDrsModes, type DrsMode, type DrsModes } from "../input/DrsMode";
import { TextInput } from "../ui/TextInput";
import { FASTEST_LAPS_PER_TRACK, loadFastestLaps, type FastestLapEntry } from "./FastestLaps";
import {
  DEFAULT_NAME_1,
  DEFAULT_NAME_2,
  NAME_MAX_LENGTH,
  loadMenuPrefs,
  sanitizeName,
  saveMenuPrefs,
} from "./MenuPrefs";

export type TrackKey = "oval" | "stadium" | "temple-of-speed" | "champions-wall";
export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyParams {
  // Multiplier ranges applied per AI on accel / grip / maxSpeed (relative to DEFAULT_CAR).
  perfRange: [number, number];
  // Aim-quality range. Higher skill → tighter racing line. See sampleAimOffset in RaceScene.
  skillRange: [number, number];
}

export const DIFFICULTIES: Record<Difficulty, DifficultyParams> = {
  easy:   { perfRange: [0.82, 0.92], skillRange: [0.15, 0.45] },
  normal: { perfRange: [0.92, 1.02], skillRange: [0.40, 1.00] },
  hard:   { perfRange: [0.98, 1.08], skillRange: [0.70, 1.00] },
};

export const LAPS_MIN = 1;
export const LAPS_MAX = 10;
export const OPPONENTS_MIN = 1;
export const OPPONENTS_MAX = 9;
export const PLAYERS_MIN = 1;
export const PLAYERS_MAX = 2;
export type PlayerCount = 1 | 2;

const TRACKS: { key: TrackKey; label: string; sub: string }[] = [
  { key: "oval", label: "OVAL", sub: "sweeping bends" },
  { key: "stadium", label: "STADIUM", sub: "long straights, 4 corners" },
  { key: "temple-of-speed", label: "TEMPLE OF SPEED", sub: "chicanes & flat-out straights" },
  { key: "champions-wall", label: "CHAMPIONS' WALL", sub: "hairpin & diagonal back-straight" },
];

const DIFFICULTY_BUTTONS: { key: Difficulty; label: string }[] = [
  { key: "easy", label: "EASY" },
  { key: "normal", label: "NORMAL" },
  { key: "hard", label: "HARD" },
];

const DRS_MODE_OPTIONS: DrsMode[] = ["auto", "manual"];

interface DrsModeButtons {
  label: Phaser.GameObjects.Text;
  buttons: { mode: DrsMode; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[];
}

type CamMode = "fixed" | "cockpit";
const CAM_MODE_OPTIONS: CamMode[] = ["fixed", "cockpit"];
interface CamModeButtons {
  label: Phaser.GameObjects.Text;
  buttons: { mode: CamMode; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[];
}

export const TRACK_KEYS: TrackKey[] = TRACKS.map((t) => t.key);

interface CounterButtons {
  dec: Phaser.GameObjects.Text;
  inc: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
}

// 2P-only press-to-join slot. The container groups the bg + label + status text so
// applyPlayersLayout can show/hide it as a unit. `playerIndex` resolves which slot
// of the assignments object this widget owns.
interface InputSlot {
  playerIndex: 0 | 1;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  sourceText: Phaser.GameObjects.Text;
  statusDot: Phaser.GameObjects.Arc;
}

const INPUT_DEBUG_ROWS = 4;

type View = "main" | "settings" | "fastestLaps";

const CONTENT_HEIGHT = 1030;

export class MenuScene extends Phaser.Scene {
  selectedTeam: TeamId = DEFAULT_TEAM_ID;
  // P2's team. Defaults to a different team than P1 so 2P out-of-the-box has visually distinct cars,
  // but the user is free to pick the same team for both — duplicate liveries are allowed.
  selectedTeam2: TeamId = (TEAMS[1]?.id ?? DEFAULT_TEAM_ID) as TeamId;
  selectedTrack: TrackKey = "oval";
  selectedDifficulty: Difficulty = "normal";
  laps: number = 3;
  opponents: number = 5;
  players: PlayerCount = 1;
  cockpitCam: boolean = false;
  name1: string = DEFAULT_NAME_1;
  name2: string = DEFAULT_NAME_2;

  view: View = "main";
  mainObjects: Phaser.GameObjects.GameObject[] = [];
  settingsObjects: Phaser.GameObjects.GameObject[] = [];
  fastestLapsObjects: Phaser.GameObjects.GameObject[] = [];

  teamLabel!: Phaser.GameObjects.Text;
  teamLabel2!: Phaser.GameObjects.Text;
  teamCarousel?: Carousel<Team>;
  teamCarousel2?: Carousel<Team>;
  trackButtons: { key: TrackKey; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }[] = [];
  difficultyButtons: { key: Difficulty; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  lapsCounter!: CounterButtons;
  opponentsCounter!: CounterButtons;
  playersCounter!: CounterButtons;
  startBtn!: Phaser.GameObjects.Text;
  settingsBtn!: Phaser.GameObjects.Text;
  fastestLapsBtn!: Phaser.GameObjects.Text;
  inspectBtn!: Phaser.GameObjects.Text;
  doneBtn!: Phaser.GameObjects.Text;
  fastestLapsDoneBtn!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;
  // Fastest-laps view state.
  fastestLapsTrack: TrackKey = "oval";
  fastestLapsTrackButtons: { key: TrackKey; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  fastestLapsRows: Phaser.GameObjects.Text[] = [];
  fastestLapsEmpty: Phaser.GameObjects.Text | null = null;
  fastestLapsHeader: Phaser.GameObjects.Text | null = null;

  // Input source assignment (2P only). Persisted via localStorage so the same pad keeps its
  // slot across sessions; reassign by clicking a slot.
  assignments: InputAssignments = { p1: null, p2: null };
  inputReader!: InputReader;
  inputSlots: InputSlot[] = [];
  // Per-player DRS activation mode. Persisted alongside other prefs; pickers in the settings view
  // write this back via saveDrsModes(). RaceScene reads via init data on race start.
  drsModes: DrsModes = loadDrsModes();
  drsModeP1: DrsModeButtons | null = null;
  drsModeP2: DrsModeButtons | null = null;
  cockpitCamButtons: CamModeButtons | null = null;
  // Player-name inputs. P2 only visible when players===2 and view==='settings'. The label objects
  // are tracked separately so we can repaint them ("NAME" vs "P1 NAME" vs hidden).
  nameInput1: TextInput | null = null;
  nameInput2: TextInput | null = null;
  nameLabel1: Phaser.GameObjects.Text | null = null;
  nameLabel2: Phaser.GameObjects.Text | null = null;
  // Debug panel: list of connected pads with live trigger/stick values + which slot they're bound to.
  padDebugTitle!: Phaser.GameObjects.Text;
  padDebugRows: Phaser.GameObjects.Text[] = [];

  constructor() {
    super("MenuScene");
  }

  create() {
    this.trackButtons = [];
    this.difficultyButtons = [];
    this.mainObjects = [];
    this.settingsObjects = [];
    this.fastestLapsObjects = [];
    this.fastestLapsTrackButtons = [];
    this.fastestLapsRows = [];
    this.inputSlots = [];
    this.padDebugRows = [];

    this.assignments = loadAssignments();
    this.inputReader = new InputReader(this);

    const prefs = loadMenuPrefs();
    this.selectedTrack = prefs.track;
    this.selectedDifficulty = prefs.difficulty;
    this.selectedTeam = prefs.team;
    this.selectedTeam2 = prefs.team2;
    this.laps = prefs.laps;
    this.opponents = prefs.opponents;
    this.players = prefs.players;
    this.cockpitCam = prefs.cockpitCam;
    this.name1 = prefs.name1;
    this.name2 = prefs.name2;
    // Fastest-laps view defaults to the currently selected track for a sensible first read.
    this.fastestLapsTrack = prefs.track;

    const cam = this.cameras.main;
    const cx = cam.width / 2;

    this.add
      .text(cx, 80, "F1RE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "84px",
        color: "#e10600",
        stroke: "#000000",
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 150, this.pickSubtitle(), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    this.buildMainView(cx);
    this.buildInputSlots(cx);
    this.buildPadDebugPanel(cx);
    this.buildSettingsView(cx);
    this.buildFastestLapsView(cx);

    this.hintText = this.add
      .text(cx, cam.height - 30, "click to pick · ENTER to start", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#666666",
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    cam.setBackgroundColor("#1a1a1a");
    cam.setBounds(0, 0, cam.width, CONTENT_HEIGHT);
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.cameras.main.scrollY = Phaser.Math.Clamp(
        this.cameras.main.scrollY + dy * 0.5,
        0,
        Math.max(0, CONTENT_HEIGHT - this.cameras.main.height),
      );
    });

    // Name inputs intercept keystrokes; gate the menu hotkeys so typing "ENTER" in a name field
    // doesn't also start the race. Also routes other characters into the focused input.
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if (this.nameInput1?.handleKey(e)) {
        e.preventDefault?.();
        return;
      }
      if (this.nameInput2?.handleKey(e)) {
        e.preventDefault?.();
        return;
      }
    });
    this.input.keyboard?.on("keydown-ENTER", () => {
      if (this.isAnyNameInputFocused()) return;
      if (this.view === "main") this.start();
    });
    this.input.keyboard?.on("keydown-SPACE", () => {
      if (this.isAnyNameInputFocused()) return;
      if (this.view === "main") this.start();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.isAnyNameInputFocused()) return;
      if (this.view !== "main") this.setView("main");
    });

    // Click outside a focused input → blur (commits the value via the TextInput's own blur path).
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      for (const input of [this.nameInput1, this.nameInput2]) {
        if (!input || !input.focused) continue;
        const b = input.bg.getBounds();
        if (!Phaser.Geom.Rectangle.Contains(b, p.worldX, p.worldY)) input.blur();
      }
    });

    this.setView("main");
    this.refresh();
    this.scale.on("resize", () => this.repositionForResize());
  }

  private buildMainView(cx: number) {
    this.teamLabel = this.addMain(this.add
      .text(cx, 230, "TEAM", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const renderTeam = (scene: Phaser.Scene, container: Phaser.GameObjects.Container, team: Team) => {
      const car = scene.add
        .sprite(0, -18, ensureCarTexture(scene, { primary: team.primary, secondary: team.secondary, variant: "sidepods" }))
        .setScale(2.4);
      const name = scene.add
        .text(0, 22, team.name.toUpperCase(), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "20px",
          color: "#ffd24a",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      container.add([car, name]);
    };

    this.teamCarousel = new Carousel<Team>({
      scene: this,
      x: cx,
      y: 305,
      width: 320,
      items: TEAMS,
      initialId: this.selectedTeam,
      onChange: (team) => {
        this.selectedTeam = team.id as TeamId;
        this.savePrefs();
      },
      renderItem: renderTeam,
    });
    this.addMain(this.teamCarousel.container);

    // P2 carousel + label live in the main view but stay hidden until 2P is selected in settings.
    // Initial position is offscreen-friendly (cx); applyPlayersLayout() repositions both when 2P toggles.
    this.teamLabel2 = this.addMain(this.add
      .text(cx, 230, "P2 TEAM", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setVisible(false));
    this.teamCarousel2 = new Carousel<Team>({
      scene: this,
      x: cx,
      y: 305,
      width: 320,
      items: TEAMS,
      initialId: this.selectedTeam2,
      onChange: (team) => {
        this.selectedTeam2 = team.id as TeamId;
        this.savePrefs();
      },
      renderItem: renderTeam,
    });
    this.teamCarousel2.container.setVisible(false);
    this.addMain(this.teamCarousel2.container);

    this.addMain(this.add
      .text(cx, 410, "TRACK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const tw = 240;
    const th = 100;
    const tgap = 24;
    const trackTotalW = TRACKS.length * tw + (TRACKS.length - 1) * tgap;
    let tx = cx - trackTotalW / 2 + tw / 2;
    for (const t of TRACKS) {
      const bg = this.addMain(this.add
        .rectangle(tx, 490, tw, th, 0x222222)
        .setStrokeStyle(3, 0x444444)
        .setInteractive({ useHandCursor: true }));
      const label = this.addMain(this.add
        .text(tx, 480, t.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "22px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5));
      const sub = this.addMain(this.add
        .text(tx, 510, t.sub, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#aaaaaa",
        })
        .setOrigin(0.5));
      bg.on("pointerdown", () => {
        this.selectedTrack = t.key;
        this.savePrefs();
        this.refresh();
      });
      this.trackButtons.push({ key: t.key, bg, label, sub });
      tx += tw + tgap;
    }

    this.startBtn = this.addMain(this.add
      .text(cx, 620, "START RACE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        color: "#1a1a1a",
        backgroundColor: "#ffd24a",
        padding: { x: 28, y: 14 },
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.startBtn.on("pointerdown", () => this.start());
    this.startBtn.on("pointerover", () => this.startBtn.setStyle({ backgroundColor: "#ffe680" }));
    this.startBtn.on("pointerout", () => this.startBtn.setStyle({ backgroundColor: "#ffd24a" }));

    this.fastestLapsBtn = this.addMain(this.add
      .text(cx - 110, 695, "FASTEST LAPS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#aaaaaa",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.fastestLapsBtn.on("pointerdown", () => this.setView("fastestLaps"));
    this.fastestLapsBtn.on("pointerover", () => this.fastestLapsBtn.setColor("#ffd24a"));
    this.fastestLapsBtn.on("pointerout", () => this.fastestLapsBtn.setColor("#aaaaaa"));

    this.inspectBtn = this.addMain(this.add
      .text(cx + 110, 695, "INSPECT TRACK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.inspectBtn.on("pointerdown", () => this.inspect());
    this.inspectBtn.on("pointerover", () => this.inspectBtn.setColor("#ffd24a"));
    this.inspectBtn.on("pointerout", () => this.inspectBtn.setColor("#888888"));

    // SETTINGS lives in the top-right corner of the main view as a small text link. Pinned with
    // setScrollFactor(0) so it stays visible while the menu camera scrolls vertically.
    this.settingsBtn = this.addMain(this.add
      .text(this.cameras.main.width - 30, 30, "SETTINGS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true }));
    this.settingsBtn.on("pointerdown", () => this.setView("settings"));
    this.settingsBtn.on("pointerover", () => this.settingsBtn.setColor("#ffd24a"));
    this.settingsBtn.on("pointerout", () => this.settingsBtn.setColor("#888888"));
  }

  // Two press-to-join slots, only visible in 2P main view (positioning handled in
  // applyPlayersLayout). Click to clear and re-pair.
  private buildInputSlots(cx: number) {
    this.inputSlots.push(this.makeInputSlot(cx - 200, 372, 0, "P1 INPUT"));
    this.inputSlots.push(this.makeInputSlot(cx + 200, 372, 1, "P2 INPUT"));
    for (const s of this.inputSlots) s.container.setVisible(false);
  }

  private makeInputSlot(x: number, y: number, playerIndex: 0 | 1, title: string): InputSlot {
    const w = 320;
    const h = 56;
    const container = this.add.container(x, y);
    const bg = this.add
      .rectangle(0, 0, w, h, 0x1d1d1d)
      .setStrokeStyle(2, 0x444444)
      .setInteractive({ useHandCursor: true });
    const titleText = this.add
      .text(-w / 2 + 12, -h / 2 + 6, title, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#888888",
        fontStyle: "bold",
      });
    const sourceText = this.add
      .text(0, 6, "PRESS A BUTTON OR KEY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#ffd24a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const statusDot = this.add.circle(w / 2 - 14, -h / 2 + 12, 5, 0x666666);
    container.add([bg, titleText, sourceText, statusDot]);
    bg.on("pointerdown", () => this.clearAssignment(playerIndex));
    this.addMain(container);
    return { playerIndex, container, bg, title: titleText, sourceText, statusDot };
  }

  private buildPadDebugPanel(cx: number) {
    this.padDebugTitle = this.addMain(
      this.add
        .text(cx, 740, "CONNECTED CONTROLLERS", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#666666",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
    for (let i = 0; i < INPUT_DEBUG_ROWS; i++) {
      const row = this.add
        .text(cx, 762 + i * 16, "", {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          color: "#888888",
        })
        .setOrigin(0.5)
        .setVisible(false);
      this.addMain(row);
      this.padDebugRows.push(row);
    }
  }

  private clearAssignment(playerIndex: 0 | 1) {
    if (playerIndex === 0) this.assignments.p1 = null;
    else this.assignments.p2 = null;
    saveAssignments(this.assignments);
    this.refreshInputSlot(playerIndex);
  }

  private refreshInputSlots() {
    this.refreshInputSlot(0);
    this.refreshInputSlot(1);
  }

  private refreshInputSlot(playerIndex: 0 | 1) {
    const slot = this.inputSlots[playerIndex];
    if (!slot) return;
    const source = playerIndex === 0 ? this.assignments.p1 : this.assignments.p2;
    if (!source) {
      slot.sourceText.setText("PRESS A BUTTON OR KEY").setColor("#ffd24a");
      slot.bg.setStrokeStyle(2, 0xffd24a);
      slot.statusDot.setFillStyle(0x666666);
      return;
    }
    const connected = source.kind === "keyboard" || this.inputReader.isPadConnected(source);
    slot.bg.setStrokeStyle(2, connected ? 0x444444 : 0xaa4444);
    slot.statusDot.setFillStyle(connected ? 0x55cc66 : 0xaa4444);
    const baseLabel = describeSource(source);
    slot.sourceText
      .setText(connected ? baseLabel : `${baseLabel} (OFFLINE)`)
      .setColor(connected ? "#ffffff" : "#aaaaaa");
  }

  private buildSettingsView(cx: number) {
    this.addSettings(this.add
      .text(cx, 230, "SETTINGS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    this.addSettings(this.add
      .text(cx, 320, "DIFFICULTY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const dw = 160;
    const dh = 56;
    const dgap = 24;
    const diffTotalW = DIFFICULTY_BUTTONS.length * dw + (DIFFICULTY_BUTTONS.length - 1) * dgap;
    let dx = cx - diffTotalW / 2 + dw / 2;
    for (const d of DIFFICULTY_BUTTONS) {
      const bg = this.addSettings(this.add
        .rectangle(dx, 380, dw, dh, 0x222222)
        .setStrokeStyle(3, 0x444444)
        .setInteractive({ useHandCursor: true }));
      const label = this.addSettings(this.add
        .text(dx, 380, d.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "20px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5));
      bg.on("pointerdown", () => {
        this.selectedDifficulty = d.key;
        this.savePrefs();
        this.refresh();
      });
      this.difficultyButtons.push({ key: d.key, bg, label });
      dx += dw + dgap;
    }

    // Counters in a single row to keep the settings panel short on 1080p screens.
    const counterRowY = 490;
    this.lapsCounter = this.makeCounter(cx - 260, counterRowY, "LAPS", () => this.laps, (v) => {
      this.laps = Phaser.Math.Clamp(v, LAPS_MIN, LAPS_MAX);
      this.savePrefs();
      this.refresh();
    }, this.settingsObjects);

    this.opponentsCounter = this.makeCounter(cx, counterRowY, "OPPONENTS", () => this.opponents, (v) => {
      this.opponents = Phaser.Math.Clamp(v, OPPONENTS_MIN, OPPONENTS_MAX);
      this.savePrefs();
      this.refresh();
    }, this.settingsObjects);

    this.playersCounter = this.makeCounter(cx + 260, counterRowY, "PLAYERS (LOCAL)", () => this.players, (v) => {
      this.players = Phaser.Math.Clamp(v, PLAYERS_MIN, PLAYERS_MAX) as PlayerCount;
      this.savePrefs();
      this.refresh();
    }, this.settingsObjects);

    this.buildNameInputs(cx, 575);

    this.drsModeP1 = this.makeDrsModePicker(cx - 200, 690, "DRS — P1", "p1");
    this.drsModeP2 = this.makeDrsModePicker(cx + 200, 690, "DRS — P2", "p2");

    this.cockpitCamButtons = this.makeCockpitCamPicker(cx, 800, "CAMERA (1P ONLY)");

    this.doneBtn = this.addSettings(this.add
      .text(cx, 890, "DONE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color: "#1a1a1a",
        backgroundColor: "#ffd24a",
        padding: { x: 28, y: 10 },
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.doneBtn.on("pointerdown", () => this.setView("main"));
    this.doneBtn.on("pointerover", () => this.doneBtn.setStyle({ backgroundColor: "#ffe680" }));
    this.doneBtn.on("pointerout", () => this.doneBtn.setStyle({ backgroundColor: "#ffd24a" }));

    this.buildCredits(cx);
  }

  private buildCredits(cx: number) {
    this.addSettings(this.add
      .text(cx, 960, "AUDIO CREDITS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#666666",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const lineStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      color: "#888888",
    };

    this.addSettings(this.add
      .text(
        cx,
        985,
        "Engine loop — domasx2 (OpenGameArt) — CC0",
        lineStyle,
      )
      .setOrigin(0.5));

    this.addSettings(this.add
      .text(
        cx,
        1005,
        "Tire skid loop — Tom Haigh / audible-edge (OpenGameArt) — CC-BY 3.0",
        lineStyle,
      )
      .setOrigin(0.5));
  }

  // Two-button auto/manual picker per player slot. Mirrors the difficulty button row layout but
  // narrower (two buttons instead of three). The whole group is shown/hidden based on `players`
  // — P2's row only appears in 2P.
  private makeDrsModePicker(
    cx: number,
    y: number,
    label: string,
    slot: "p1" | "p2",
  ): DrsModeButtons {
    const labelText = this.addSettings(this.add
      .text(cx, y - 32, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const bw = 110;
    const bh = 38;
    const gap = 12;
    const totalW = DRS_MODE_OPTIONS.length * bw + (DRS_MODE_OPTIONS.length - 1) * gap;
    let bx = cx - totalW / 2 + bw / 2;
    const buttons: DrsModeButtons["buttons"] = [];
    for (const mode of DRS_MODE_OPTIONS) {
      const bg = this.addSettings(this.add
        .rectangle(bx, y, bw, bh, 0x222222)
        .setStrokeStyle(2, 0x444444)
        .setInteractive({ useHandCursor: true }));
      const lab = this.addSettings(this.add
        .text(bx, y, mode.toUpperCase(), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5));
      bg.on("pointerdown", () => {
        this.drsModes[slot] = mode;
        saveDrsModes(this.drsModes);
        this.refresh();
      });
      buttons.push({ mode, bg, label: lab });
      bx += bw + gap;
    }
    return { label: labelText, buttons };
  }

  // Two-button camera-mode picker (FIXED top-down vs COCKPIT car-locked rotation). Mirrors the
  // DRS picker layout. The whole row only renders in 1P (gated in `refreshCockpitCamButtons`).
  private makeCockpitCamPicker(cx: number, y: number, label: string): CamModeButtons {
    const labelText = this.addSettings(this.add
      .text(cx, y - 32, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5));
    const bw = 130;
    const bh = 38;
    const gap = 12;
    const totalW = CAM_MODE_OPTIONS.length * bw + (CAM_MODE_OPTIONS.length - 1) * gap;
    let bx = cx - totalW / 2 + bw / 2;
    const buttons: CamModeButtons["buttons"] = [];
    for (const mode of CAM_MODE_OPTIONS) {
      const bg = this.addSettings(this.add
        .rectangle(bx, y, bw, bh, 0x222222)
        .setStrokeStyle(2, 0x444444)
        .setInteractive({ useHandCursor: true }));
      const lab = this.addSettings(this.add
        .text(bx, y, mode === "fixed" ? "TOP-DOWN" : "COCKPIT", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5));
      bg.on("pointerdown", () => {
        this.cockpitCam = mode === "cockpit";
        this.savePrefs();
        this.refresh();
      });
      buttons.push({ mode, bg, label: lab });
      bx += bw + gap;
    }
    return { label: labelText, buttons };
  }

  // P1 + P2 name inputs. Both are placed at the row centered on `y`. In 1P the P1 input sits
  // centered (label "NAME"); in 2P they split left/right ("P1 NAME" / "P2 NAME"). Layout
  // re-applied in `applyPlayersLayout` so the rest of the settings panel reuses the same toggle.
  private buildNameInputs(cx: number, y: number) {
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      color: "#888888",
      fontStyle: "bold",
    };
    this.nameLabel1 = this.addSettings(
      this.add.text(cx, y - 28, "NAME", labelStyle).setOrigin(0.5),
    );
    this.nameLabel2 = this.addSettings(
      this.add.text(cx + 200, y - 28, "P2 NAME", labelStyle).setOrigin(0.5).setVisible(false),
    );

    this.nameInput1 = new TextInput({
      scene: this,
      x: cx,
      y,
      width: 220,
      height: 40,
      initialValue: this.name1,
      maxLength: NAME_MAX_LENGTH,
      fallback: DEFAULT_NAME_1,
      onChange: (v) => {
        this.name1 = v;
        this.savePrefs();
      },
    });
    this.addSettings(this.nameInput1.container);

    this.nameInput2 = new TextInput({
      scene: this,
      x: cx + 200,
      y,
      width: 220,
      height: 40,
      initialValue: this.name2,
      maxLength: NAME_MAX_LENGTH,
      fallback: DEFAULT_NAME_2,
      onChange: (v) => {
        this.name2 = v;
        this.savePrefs();
      },
    });
    this.addSettings(this.nameInput2.container);
    this.nameInput2.setVisible(false);
  }

  private savePrefs() {
    saveMenuPrefs({
      track: this.selectedTrack,
      difficulty: this.selectedDifficulty,
      team: this.selectedTeam,
      team2: this.selectedTeam2,
      laps: this.laps,
      opponents: this.opponents,
      players: this.players,
      cockpitCam: this.cockpitCam,
      name1: sanitizeName(this.name1, DEFAULT_NAME_1),
      name2: sanitizeName(this.name2, DEFAULT_NAME_2),
    });
  }

  // Fastest-laps board view. Track buttons + monospaced top-10 list (humans coloured yellow,
  // AI white). Re-rendered every time the view becomes visible so newly-recorded laps appear
  // without restarting the menu.
  private buildFastestLapsView(cx: number) {
    this.addFastestLaps(this.add
      .text(cx, 230, "FASTEST LAPS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5));

    const tw = 200;
    const th = 48;
    const tgap = 16;
    const totalW = TRACKS.length * tw + (TRACKS.length - 1) * tgap;
    let tx = cx - totalW / 2 + tw / 2;
    for (const t of TRACKS) {
      const bg = this.addFastestLaps(this.add
        .rectangle(tx, 310, tw, th, 0x222222)
        .setStrokeStyle(2, 0x444444)
        .setInteractive({ useHandCursor: true }));
      const label = this.addFastestLaps(this.add
        .text(tx, 310, t.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "16px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5));
      bg.on("pointerdown", () => {
        this.fastestLapsTrack = t.key;
        this.refreshFastestLaps();
      });
      this.fastestLapsTrackButtons.push({ key: t.key, bg, label });
      tx += tw + tgap;
    }

    this.fastestLapsHeader = this.addFastestLaps(this.add
      .text(cx, 380, fastestLapsRowFormat("#", "TIME", "DRIVER"), {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "16px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0));

    for (let i = 0; i < FASTEST_LAPS_PER_TRACK; i++) {
      const row = this.addFastestLaps(this.add
        .text(cx, 410 + i * 28, "", {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "18px",
          color: "#ffffff",
        })
        .setOrigin(0.5, 0));
      this.fastestLapsRows.push(row);
    }

    this.fastestLapsEmpty = this.addFastestLaps(this.add
      .text(cx, 480, "No laps recorded yet.", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#888888",
      })
      .setOrigin(0.5, 0)
      .setVisible(false));

    this.fastestLapsDoneBtn = this.addFastestLaps(this.add
      .text(cx, 760, "DONE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color: "#1a1a1a",
        backgroundColor: "#ffd24a",
        padding: { x: 28, y: 10 },
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.fastestLapsDoneBtn.on("pointerdown", () => this.setView("main"));
    this.fastestLapsDoneBtn.on("pointerover", () => this.fastestLapsDoneBtn.setStyle({ backgroundColor: "#ffe680" }));
    this.fastestLapsDoneBtn.on("pointerout", () => this.fastestLapsDoneBtn.setStyle({ backgroundColor: "#ffd24a" }));
  }

  private refreshFastestLaps() {
    for (const b of this.fastestLapsTrackButtons) {
      const selected = b.key === this.fastestLapsTrack;
      b.bg.setStrokeStyle(selected ? 3 : 2, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
    const list: FastestLapEntry[] = loadFastestLaps()[this.fastestLapsTrack] ?? [];
    for (let i = 0; i < this.fastestLapsRows.length; i++) {
      const row = this.fastestLapsRows[i];
      const entry = list[i];
      if (!entry) {
        row.setText("");
        continue;
      }
      row.setText(fastestLapsRowFormat(String(i + 1), formatLapMs(entry.ms), entry.name));
      row.setColor(entry.isPlayer ? "#ffd24a" : "#ffffff");
    }
    this.fastestLapsEmpty?.setVisible(list.length === 0);
    this.fastestLapsHeader?.setVisible(list.length > 0);
  }

  private addMain<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.mainObjects.push(obj);
    return obj;
  }

  private addSettings<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.settingsObjects.push(obj);
    return obj;
  }

  private addFastestLaps<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.fastestLapsObjects.push(obj);
    return obj;
  }

  private setView(view: View) {
    this.view = view;
    if (view !== "settings") {
      this.nameInput1?.blur();
      this.nameInput2?.blur();
    }
    const setAll = (list: Phaser.GameObjects.GameObject[], visible: boolean) => {
      for (const o of list) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(visible);
    };
    setAll(this.mainObjects, view === "main");
    setAll(this.settingsObjects, view === "settings");
    setAll(this.fastestLapsObjects, view === "fastestLaps");
    this.hintText?.setText(view === "main" ? "click to pick · ENTER to start" : "click to adjust · ESC to back");
    // P2 carousel is in `mainObjects`, so the loop above unconditionally shows it on main —
    // re-apply the players-aware layout to hide it again when in 1P mode.
    if (view === "main") this.applyPlayersLayout();
    if (view === "fastestLaps") this.refreshFastestLaps();
    // Re-run the highlight + per-player visibility logic so the DRS picker selection state and
    // 1P/2P-aware row visibility reflect current data after the bulk visibility toggle above.
    this.refresh();
  }

  private refresh() {
    for (const b of this.trackButtons) {
      const selected = b.key === this.selectedTrack;
      b.bg.setStrokeStyle(selected ? 4 : 3, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
    for (const b of this.difficultyButtons) {
      const selected = b.key === this.selectedDifficulty;
      b.bg.setStrokeStyle(selected ? 4 : 3, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
    this.lapsCounter?.value.setText(String(this.laps));
    this.opponentsCounter?.value.setText(String(this.opponents));
    this.playersCounter?.value.setText(String(this.players));
    this.refreshDrsButtons(this.drsModeP1, this.drsModes.p1, true);
    this.refreshDrsButtons(this.drsModeP2, this.drsModes.p2, this.players === 2);
    this.refreshCockpitCamButtons();
    this.applyPlayersLayout();
  }

  private refreshCockpitCamButtons() {
    if (!this.cockpitCamButtons) return;
    const visible = this.players === 1 && this.view === "settings";
    this.cockpitCamButtons.label.setVisible(visible);
    const current: CamMode = this.cockpitCam ? "cockpit" : "fixed";
    for (const b of this.cockpitCamButtons.buttons) {
      b.bg.setVisible(visible);
      b.label.setVisible(visible);
      const selected = b.mode === current;
      b.bg.setStrokeStyle(selected ? 3 : 2, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
  }

  private refreshDrsButtons(group: DrsModeButtons | null, current: DrsMode, visible: boolean) {
    if (!group) return;
    const showOnSettings = visible && this.view === "settings";
    group.label.setVisible(showOnSettings);
    for (const b of group.buttons) {
      b.bg.setVisible(showOnSettings);
      b.label.setVisible(showOnSettings);
      const selected = b.mode === current;
      b.bg.setStrokeStyle(selected ? 3 : 2, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
  }

  // Reposition + show/hide team carousels based on `players` count. In 1P the single carousel
  // sits centered (current behaviour). In 2P we split: P1 on the left, P2 on the right, both
  // with their own labels. Carousels are created once in buildMainView and only repositioned here.
  private applyPlayersLayout() {
    if (!this.teamCarousel || !this.teamCarousel2) return;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const showInputs = this.players === 2 && this.view === "main";
    if (this.players === 2) {
      this.teamLabel?.setText("P1 TEAM");
      this.teamLabel?.setPosition(cx - 200, 230);
      this.teamCarousel.container.setPosition(cx - 200, 305);
      this.teamLabel2?.setText("P2 TEAM").setPosition(cx + 200, 230).setVisible(this.view === "main");
      this.teamCarousel2.container.setPosition(cx + 200, 305).setVisible(this.view === "main");
    } else {
      this.teamLabel?.setText("TEAM");
      this.teamLabel?.setPosition(cx, 230);
      this.teamCarousel.container.setPosition(cx, 305);
      this.teamLabel2?.setVisible(false);
      this.teamCarousel2.container.setVisible(false);
    }
    this.inputSlots[0]?.container.setPosition(cx - 200, 372).setVisible(showInputs);
    this.inputSlots[1]?.container.setPosition(cx + 200, 372).setVisible(showInputs);
    this.padDebugTitle?.setVisible(showInputs);
    for (const r of this.padDebugRows) r.setVisible(showInputs);
    if (showInputs) this.refreshInputSlots();

    // Settings-only name inputs: split left/right in 2P, single centered in 1P. Visibility is
    // gated by `view === 'settings'` because the labels + containers live in `settingsObjects`.
    const inSettings = this.view === "settings";
    if (this.players === 2) {
      this.nameLabel1?.setText("P1 NAME").setPosition(cx - 200, 547);
      this.nameInput1?.setPosition(cx - 200, 575);
      this.nameLabel2?.setPosition(cx + 200, 547).setVisible(inSettings);
      this.nameInput2?.setPosition(cx + 200, 575);
      this.nameInput2?.setVisible(inSettings);
    } else {
      this.nameLabel1?.setText("NAME").setPosition(cx, 547);
      this.nameInput1?.setPosition(cx, 575);
      this.nameLabel2?.setVisible(false);
      this.nameInput2?.setVisible(false);
    }
  }

  private isAnyNameInputFocused(): boolean {
    return Boolean(this.nameInput1?.focused || this.nameInput2?.focused);
  }

  // Random subtitle drawn from `public/menu-subtitles.txt` (loaded once in BootScene).
  // Strips comments / blanks; falls back to the original tagline if the file is missing or empty.
  private pickSubtitle(): string {
    const FALLBACK = "2D Racing Fury";
    const raw = this.cache.text.get("menuSubtitles");
    if (typeof raw !== "string") return FALLBACK;
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    if (lines.length === 0) return FALLBACK;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Phaser lifecycle. Press-to-join polling + live debug refresh, only while the 2P
  // input section is visible.
  update() {
    if (this.players !== 2 || this.view !== "main") return;

    const exclude: (InputSource | null)[] = [this.assignments.p1, this.assignments.p2];
    let changed = false;
    if (!this.assignments.p1) {
      const src = this.inputReader.pollNewPress(exclude);
      if (src) {
        this.assignments.p1 = src;
        exclude[0] = src;
        changed = true;
      }
    }
    if (!this.assignments.p2) {
      const src = this.inputReader.pollNewPress(exclude);
      if (src) {
        this.assignments.p2 = src;
        changed = true;
      }
    }
    if (changed) {
      saveAssignments(this.assignments);
      this.refreshInputSlots();
    } else {
      // Refresh status (connection state may have changed without a reassignment).
      this.refreshInputSlots();
    }

    this.refreshPadDebug();
  }

  private refreshPadDebug() {
    const pads = this.inputReader.getConnectedPads();
    if (pads.length === 0) {
      this.padDebugRows[0]?.setText("(no controllers detected — pair via Bluetooth then press a button)").setColor("#666666");
      for (let i = 1; i < this.padDebugRows.length; i++) this.padDebugRows[i].setText("");
      return;
    }
    for (let i = 0; i < this.padDebugRows.length; i++) {
      const row = this.padDebugRows[i];
      const pad = pads[i];
      if (!pad) {
        row.setText("");
        continue;
      }
      const snap = this.inputReader.getPadDebugSnapshot({ padId: pad.id, padIndex: pad.index });
      const t = snap?.throttle ?? 0;
      const b = snap?.brake ?? 0;
      const lx = snap?.steerX ?? 0;
      const padSrc: InputSource = { kind: "pad", padId: pad.id, padIndex: pad.index };
      const slot = sourcesEqual(this.assignments.p1, padSrc)
        ? "→ P1"
        : sourcesEqual(this.assignments.p2, padSrc)
          ? "→ P2"
          : "    ";
      const name = shortenPadId(pad.id).padEnd(28);
      const line = `#${pad.index} ${name}  T:${t.toFixed(2)} B:${b.toFixed(2)} LX:${lx >= 0 ? "+" : ""}${lx.toFixed(2)}  ${slot}`;
      row.setText(line).setColor("#aaaaaa");
    }
  }

  private makeCounter(
    cx: number,
    y: number,
    label: string,
    getValue: () => number,
    setValue: (v: number) => void,
    bucket: Phaser.GameObjects.GameObject[],
  ): CounterButtons {
    const labelText = this.add
      .text(cx, y - 30, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    bucket.push(labelText);

    const btnStyle = {
      fontFamily: "system-ui, sans-serif",
      fontSize: "26px",
      color: "#ffffff",
      backgroundColor: "#2a2a2a",
      padding: { x: 14, y: 6 },
      fontStyle: "bold" as const,
    };
    const dec = this.add
      .text(cx - 70, y, "−", btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    bucket.push(dec);
    const inc = this.add
      .text(cx + 70, y, "+", btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    bucket.push(inc);
    const value = this.add
      .text(cx, y, String(getValue()), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#ffd24a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    bucket.push(value);

    dec.on("pointerdown", () => setValue(getValue() - 1));
    inc.on("pointerdown", () => setValue(getValue() + 1));

    return { dec, inc, value };
  }

  private start() {
    // Only forward sources in 2P. 1P uses RaceScene's auto-merge (kb arrows + first pad).
    const inputSources =
      this.players === 2 ? [this.assignments.p1, this.assignments.p2] : undefined;
    this.scene.start("RaceScene", {
      trackKey: this.selectedTrack,
      teamId: this.selectedTeam,
      teamId2: this.selectedTeam2,
      players: this.players,
      difficulty: this.selectedDifficulty,
      laps: this.laps,
      opponents: this.opponents,
      inputSources,
      drsModes: this.drsModes,
      cockpitCam: this.players === 1 && this.cockpitCam,
      name1: sanitizeName(this.name1, DEFAULT_NAME_1),
      name2: sanitizeName(this.name2, DEFAULT_NAME_2),
    });
  }

  private inspect() {
    writeInspect(this.selectedTrack);
    this.scene.start("InspectScene", { trackKey: this.selectedTrack });
  }

  private repositionForResize() {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height;
    this.hintText?.setPosition(cx, cy - 30);
    this.settingsBtn?.setPosition(cam.width - 30, 30);
    cam.setBounds(0, 0, cam.width, CONTENT_HEIGHT);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, CONTENT_HEIGHT - cam.height));
  }
}

function formatLapMs(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

// Tabular formatter for the fastest-laps board. Uses fixed column widths so every row
// renders to the exact same character count — a `setOrigin(0.5, 0)` text then centers
// every row at the same screen X regardless of name/time content.
const FASTEST_LAPS_POS_W = 2;
const FASTEST_LAPS_TIME_W = 8;
const FASTEST_LAPS_NAME_W = 8;

function fastestLapsRowFormat(pos: string, time: string, name: string): string {
  const p = pos.slice(0, FASTEST_LAPS_POS_W).padStart(FASTEST_LAPS_POS_W, " ");
  const t = time.slice(0, FASTEST_LAPS_TIME_W).padEnd(FASTEST_LAPS_TIME_W, " ");
  const n = name.slice(0, FASTEST_LAPS_NAME_W).padEnd(FASTEST_LAPS_NAME_W, " ");
  return ` ${p}   ${t}   ${n}`;
}
