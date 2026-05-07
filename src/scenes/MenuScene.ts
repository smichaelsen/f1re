import Phaser from "phaser";

export type CarColor = "red" | "blue" | "yellow" | "green";
export type TrackKey = "oval" | "stadium" | "temple-of-speed";

const COLORS: { key: CarColor; hex: number; label: string }[] = [
  { key: "red", hex: 0xe10600, label: "RED" },
  { key: "blue", hex: 0x1e90ff, label: "BLUE" },
  { key: "yellow", hex: 0xf2c200, label: "YELLOW" },
  { key: "green", hex: 0x2ecc40, label: "GREEN" },
];

const TRACKS: { key: TrackKey; label: string; sub: string }[] = [
  { key: "oval", label: "OVAL", sub: "sweeping bends" },
  { key: "stadium", label: "STADIUM", sub: "long straights, 4 corners" },
  { key: "temple-of-speed", label: "TEMPLE OF SPEED", sub: "chicanes & flat-out straights" },
];

export const TRACK_KEYS: TrackKey[] = TRACKS.map((t) => t.key);

export class MenuScene extends Phaser.Scene {
  selectedColor: CarColor = "red";
  selectedTrack: TrackKey = "oval";

  colorButtons: { key: CarColor; rect: Phaser.GameObjects.Rectangle }[] = [];
  trackButtons: { key: TrackKey; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }[] = [];
  startBtn!: Phaser.GameObjects.Text;
  inspectBtn!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;

  constructor() {
    super("MenuScene");
  }

  create() {
    this.colorButtons = [];
    this.trackButtons = [];

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
      .text(cx, 230, "CAR", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#888888",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const swatchSize = 80;
    const swatchGap = 20;
    const totalW = COLORS.length * swatchSize + (COLORS.length - 1) * swatchGap;
    let sx = cx - totalW / 2 + swatchSize / 2;
    for (const c of COLORS) {
      const rect = this.add
        .rectangle(sx, 290, swatchSize, swatchSize, c.hex)
        .setStrokeStyle(3, 0x333333)
        .setInteractive({ useHandCursor: true });
      rect.on("pointerdown", () => {
        this.selectedColor = c.key;
        this.refresh();
      });
      this.add
        .text(sx, 290 + swatchSize / 2 + 18, c.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#cccccc",
        })
        .setOrigin(0.5);
      this.colorButtons.push({ key: c.key, rect });
      sx += swatchSize + swatchGap;
    }

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

    this.startBtn = this.add
      .text(cx, 620, "START RACE", {
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
      .text(cx, 700, "INSPECT TRACK", {
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
    for (const b of this.colorButtons) {
      const selected = b.key === this.selectedColor;
      b.rect.setStrokeStyle(selected ? 5 : 3, selected ? 0xffd24a : 0x333333);
      b.rect.setScale(selected ? 1.08 : 1);
    }
    for (const b of this.trackButtons) {
      const selected = b.key === this.selectedTrack;
      b.bg.setStrokeStyle(selected ? 4 : 3, selected ? 0xffd24a : 0x444444);
      b.bg.setFillStyle(selected ? 0x2a2a2a : 0x1d1d1d);
      b.label.setColor(selected ? "#ffd24a" : "#ffffff");
    }
  }

  private start() {
    this.scene.start("RaceScene", {
      trackKey: this.selectedTrack,
      carColor: this.selectedColor,
    });
  }

  private inspect() {
    this.scene.start("InspectScene", { trackKey: this.selectedTrack });
  }

  private repositionForResize() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height;
    this.hintText?.setPosition(cx, cy - 30);
  }
}
