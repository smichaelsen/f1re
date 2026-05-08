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

export class MenuScene extends Phaser.Scene {
  selectedTeam: TeamId = DEFAULT_TEAM_ID;
  selectedTrack: TrackKey = "oval";
  selectedDifficulty: Difficulty = "normal";
  laps: number = 3;
  opponents: number = 3;

  teamCarousel?: Carousel<Team>;
  trackButtons: { key: TrackKey; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }[] = [];
  difficultyButtons: { key: Difficulty; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  lapsCounter!: CounterButtons;
  opponentsCounter!: CounterButtons;
  startBtn!: Phaser.GameObjects.Text;
  inspectBtn!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;

  constructor() {
    super("MenuScene");
  }

  create() {
    this.trackButtons = [];
    this.difficultyButtons = [];

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

    this.add
      .text(cx, 230, "TEAM", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

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
      renderItem: (scene, container, team) => {
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
      },
    });

    this.add
      .text(cx, 400, "TRACK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const tw = 240;
    const th = 100;
    const tgap = 24;
    const trackTotalW = TRACKS.length * tw + (TRACKS.length - 1) * tgap;
    let tx = cx - trackTotalW / 2 + tw / 2;
    for (const t of TRACKS) {
      const bg = this.add
        .rectangle(tx, 480, tw, th, 0x222222)
        .setStrokeStyle(3, 0x444444)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(tx, 470, t.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "22px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(tx, 500, t.sub, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#aaaaaa",
        })
        .setOrigin(0.5);
      bg.on("pointerdown", () => {
        this.selectedTrack = t.key;
        this.refresh();
      });
      this.trackButtons.push({ key: t.key, bg, label, sub });
      tx += tw + tgap;
    }

    this.add
      .text(cx, 575, "DIFFICULTY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const dw = 130;
    const dh = 44;
    const dgap = 16;
    const diffTotalW = DIFFICULTY_BUTTONS.length * dw + (DIFFICULTY_BUTTONS.length - 1) * dgap;
    let dx = cx - diffTotalW / 2 + dw / 2;
    for (const d of DIFFICULTY_BUTTONS) {
      const bg = this.add
        .rectangle(dx, 620, dw, dh, 0x222222)
        .setStrokeStyle(3, 0x444444)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(dx, 620, d.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "18px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      bg.on("pointerdown", () => {
        this.selectedDifficulty = d.key;
        this.refresh();
      });
      this.difficultyButtons.push({ key: d.key, bg, label });
      dx += dw + dgap;
    }

    this.lapsCounter = this.makeCounter(cx - 180, 695, "LAPS", () => this.laps, (v) => {
      this.laps = Phaser.Math.Clamp(v, LAPS_MIN, LAPS_MAX);
      this.refresh();
    });
    this.opponentsCounter = this.makeCounter(cx + 180, 695, "OPPONENTS", () => this.opponents, (v) => {
      this.opponents = Phaser.Math.Clamp(v, OPPONENTS_MIN, OPPONENTS_MAX);
      this.refresh();
    });

    this.startBtn = this.add
      .text(cx, 770, "START RACE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        color: "#1a1a1a",
        backgroundColor: "#ffd24a",
        padding: { x: 28, y: 14 },
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.startBtn.on("pointerdown", () => this.start());
    this.startBtn.on("pointerover", () => this.startBtn.setStyle({ backgroundColor: "#ffe680" }));
    this.startBtn.on("pointerout", () => this.startBtn.setStyle({ backgroundColor: "#ffd24a" }));

    this.inspectBtn = this.add
      .text(cx, 840, "INSPECT TRACK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.inspectBtn.on("pointerdown", () => this.inspect());
    this.inspectBtn.on("pointerover", () => this.inspectBtn.setColor("#ffd24a"));
    this.inspectBtn.on("pointerout", () => this.inspectBtn.setColor("#888888"));

    this.hintText = this.add
      .text(cx, cam.height - 30, "click to pick · ENTER to start", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#666666",
      })
      .setOrigin(0.5);

    this.input.keyboard?.on("keydown-ENTER", () => this.start());
    this.input.keyboard?.on("keydown-SPACE", () => this.start());

    this.refresh();
    this.scale.on("resize", () => this.repositionForResize());
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
  }

  private makeCounter(
    cx: number,
    y: number,
    label: string,
    getValue: () => number,
    setValue: (v: number) => void,
  ): CounterButtons {
    this.add
      .text(cx, y - 28, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const btnStyle = {
      fontFamily: "system-ui, sans-serif",
      fontSize: "26px",
      color: "#ffffff",
      backgroundColor: "#2a2a2a",
      padding: { x: 14, y: 6 },
      fontStyle: "bold" as const,
    };
    const dec = this.add
      .text(cx - 60, y, "−", btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const inc = this.add
      .text(cx + 60, y, "+", btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const value = this.add
      .text(cx, y, String(getValue()), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color: "#ffd24a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    dec.on("pointerdown", () => setValue(getValue() - 1));
    inc.on("pointerdown", () => setValue(getValue() + 1));

    return { dec, inc, value };
  }

  private start() {
    this.scene.start("RaceScene", {
      trackKey: this.selectedTrack,
      teamId: this.selectedTeam,
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
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height;
    this.hintText?.setPosition(cx, cy - 30);
  }
}
