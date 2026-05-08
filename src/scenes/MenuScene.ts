import Phaser from "phaser";
import { ensureCarTexture } from "../entities/CarSprite";
import { DEFAULT_TEAM_ID, TEAMS, type Team, type TeamId } from "../entities/Team";
import { writeInspect } from "../router";
import { Carousel } from "../ui/Carousel";

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

export const TRACK_KEYS: TrackKey[] = TRACKS.map((t) => t.key);

interface CounterButtons {
  dec: Phaser.GameObjects.Text;
  inc: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
}

type View = "main" | "settings";

const CONTENT_HEIGHT = 940;

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

  view: View = "main";
  mainObjects: Phaser.GameObjects.GameObject[] = [];
  settingsObjects: Phaser.GameObjects.GameObject[] = [];

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
  inspectBtn!: Phaser.GameObjects.Text;
  doneBtn!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;

  constructor() {
    super("MenuScene");
  }

  create() {
    this.trackButtons = [];
    this.difficultyButtons = [];
    this.mainObjects = [];
    this.settingsObjects = [];

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
      .text(cx, 150, "2D Racing Fury", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    this.buildMainView(cx);
    this.buildSettingsView(cx);

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

    this.input.keyboard?.on("keydown-ENTER", () => {
      if (this.view === "main") this.start();
    });
    this.input.keyboard?.on("keydown-SPACE", () => {
      if (this.view === "main") this.start();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.view === "settings") this.setView("main");
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

    this.settingsBtn = this.addMain(this.add
      .text(cx - 110, 695, "SETTINGS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#aaaaaa",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true }));
    this.settingsBtn.on("pointerdown", () => this.setView("settings"));
    this.settingsBtn.on("pointerover", () => this.settingsBtn.setColor("#ffd24a"));
    this.settingsBtn.on("pointerout", () => this.settingsBtn.setColor("#aaaaaa"));

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
        this.refresh();
      });
      this.difficultyButtons.push({ key: d.key, bg, label });
      dx += dw + dgap;
    }

    this.lapsCounter = this.makeCounter(cx, 490, "LAPS", () => this.laps, (v) => {
      this.laps = Phaser.Math.Clamp(v, LAPS_MIN, LAPS_MAX);
      this.refresh();
    }, this.settingsObjects);

    this.opponentsCounter = this.makeCounter(cx, 600, "OPPONENTS", () => this.opponents, (v) => {
      this.opponents = Phaser.Math.Clamp(v, OPPONENTS_MIN, OPPONENTS_MAX);
      this.refresh();
    }, this.settingsObjects);

    this.playersCounter = this.makeCounter(cx, 700, "PLAYERS (LOCAL)", () => this.players, (v) => {
      this.players = Phaser.Math.Clamp(v, PLAYERS_MIN, PLAYERS_MAX) as PlayerCount;
      this.refresh();
    }, this.settingsObjects);

    this.doneBtn = this.addSettings(this.add
      .text(cx, 790, "DONE", {
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
      .text(cx, 850, "AUDIO CREDITS", {
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
        875,
        "Engine loop — domasx2 (OpenGameArt) — CC0",
        lineStyle,
      )
      .setOrigin(0.5));

    this.addSettings(this.add
      .text(
        cx,
        895,
        "Tire skid loop — Tom Haigh / audible-edge (OpenGameArt) — CC-BY 3.0",
        lineStyle,
      )
      .setOrigin(0.5));
  }

  private addMain<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.mainObjects.push(obj);
    return obj;
  }

  private addSettings<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.settingsObjects.push(obj);
    return obj;
  }

  private setView(view: View) {
    this.view = view;
    const onMain = view === "main";
    for (const o of this.mainObjects) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(onMain);
    for (const o of this.settingsObjects) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(!onMain);
    this.hintText?.setText(onMain ? "click to pick · ENTER to start" : "click to adjust · ESC to back");
    // P2 carousel is in `mainObjects`, so the loop above unconditionally shows it on main —
    // re-apply the players-aware layout to hide it again when in 1P mode.
    if (onMain) this.applyPlayersLayout();
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
    this.applyPlayersLayout();
  }

  // Reposition + show/hide team carousels based on `players` count. In 1P the single carousel
  // sits centered (current behaviour). In 2P we split: P1 on the left, P2 on the right, both
  // with their own labels. Carousels are created once in buildMainView and only repositioned here.
  private applyPlayersLayout() {
    if (!this.teamCarousel || !this.teamCarousel2) return;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
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
    this.scene.start("RaceScene", {
      trackKey: this.selectedTrack,
      teamId: this.selectedTeam,
      teamId2: this.selectedTeam2,
      players: this.players,
      difficulty: this.selectedDifficulty,
      laps: this.laps,
      opponents: this.opponents,
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
    cam.setBounds(0, 0, cam.width, CONTENT_HEIGHT);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, Math.max(0, CONTENT_HEIGHT - cam.height));
  }
}
