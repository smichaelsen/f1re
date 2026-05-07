import Phaser from "phaser";
import { Track } from "../entities/Track";
import { parseTrackData } from "../entities/TrackData";
import { TRACK_KEYS, type TrackKey } from "./MenuScene";

interface InspectInit {
  trackKey?: TrackKey;
}

const HUD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "16px",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 4,
};

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "11px",
  color: "#ffd24a",
  stroke: "#000000",
  strokeThickness: 2,
};

const CP_LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  color: "#00ffaa",
  stroke: "#000000",
  strokeThickness: 2,
};

export class InspectScene extends Phaser.Scene {
  trackKey: TrackKey = "oval";
  track!: Track;

  overlay!: Phaser.GameObjects.Graphics;
  labels: Phaser.GameObjects.Text[] = [];

  titleText!: Phaser.GameObjects.Text;
  metaText!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;
  coordsText!: Phaser.GameObjects.Text;

  zoomInBtn!: Phaser.GameObjects.Text;
  zoomOutBtn!: Phaser.GameObjects.Text;
  fitBtn!: Phaser.GameObjects.Text;

  uiCam!: Phaser.Cameras.Scene2D.Camera;
  worldObjects: Phaser.GameObjects.GameObject[] = [];
  uiObjects: Phaser.GameObjects.GameObject[] = [];

  showPoints = true;
  showCheckpoints = true;

  overUi = false;
  isDragging = false;
  dragStartScreen = { x: 0, y: 0 };
  dragStartScroll = { x: 0, y: 0 };

  keys!: {
    esc: Phaser.Input.Keyboard.Key;
    one: Phaser.Input.Keyboard.Key;
    two: Phaser.Input.Keyboard.Key;
    zero: Phaser.Input.Keyboard.Key;
    prev: Phaser.Input.Keyboard.Key;
    next: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("InspectScene");
  }

  init(data: InspectInit) {
    this.trackKey = data.trackKey ?? "oval";
  }

  preload() {
    const key = `track-${this.trackKey}`;
    if (!this.cache.json.has(key)) {
      this.load.json(key, `tracks/${this.trackKey}.json`);
    }
  }

  create() {
    this.labels = [];
    this.worldObjects = [];
    this.uiObjects = [];

    const beforeTrack = new Set(this.children.list);

    const raw = this.cache.json.get(`track-${this.trackKey}`);
    this.track = Track.fromData(this, parseTrackData(raw));

    for (const c of this.children.list) {
      if (!beforeTrack.has(c)) this.worldObjects.push(c);
    }

    const cam = this.cameras.main;
    cam.setBounds(-3000, -3000, 6000, 6000);
    cam.setBackgroundColor("#1a1a1a");

    this.overlay = this.add.graphics();
    this.overlay.setDepth(100);
    this.worldObjects.push(this.overlay);
    this.drawOverlay();

    this.titleText = this.addUi(
      this.add.text(20, 20, this.track.name.toUpperCase(), {
        ...HUD_STYLE,
        fontSize: "26px",
        fontStyle: "bold",
        color: "#ffd24a",
      }),
    );

    this.metaText = this.addUi(this.add.text(20, 56, this.metaLine(), HUD_STYLE));

    this.hintText = this.addUi(
      this.add.text(
        20,
        this.scale.height - 30,
        "drag pan · wheel/buttons zoom · 0 fit · 1 points · 2 checkpoints · [ ] track · ESC menu",
        { ...HUD_STYLE, fontSize: "13px", color: "#aaaaaa" },
      ),
    );

    this.coordsText = this.addUi(
      this.add.text(this.scale.width - 20, 20, "(0, 0)", { ...HUD_STYLE, color: "#88ccff" }).setOrigin(1, 0),
    );

    this.zoomInBtn = this.makeUiButton("+", () => this.zoomBy(1.3));
    this.zoomOutBtn = this.makeUiButton("−", () => this.zoomBy(1 / 1.3));
    this.fitBtn = this.makeUiButton("⬚", () => this.fitView());

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setName("ui");
    this.applyCameraIgnore();
    this.repositionUi();

    this.scale.on("resize", () => this.repositionUi());

    const kb = this.input.keyboard!;
    this.keys = {
      esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      zero: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO),
      prev: kb.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET),
      next: kb.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET),
    };

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.overUi) return;
      this.isDragging = true;
      this.dragStartScreen = { x: p.x, y: p.y };
      this.dragStartScroll = { x: cam.scrollX, y: cam.scrollY };
    });
    this.input.on("pointerup", () => {
      this.isDragging = false;
    });
    this.input.on("pointerupoutside", () => {
      this.isDragging = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.coordsText.setText(`(${p.worldX.toFixed(0)}, ${p.worldY.toFixed(0)})`);
      if (this.isDragging) {
        const z = cam.zoom;
        cam.scrollX = this.dragStartScroll.x - (p.x - this.dragStartScreen.x) / z;
        cam.scrollY = this.dragStartScroll.y - (p.y - this.dragStartScreen.y) / z;
      }
    });
    this.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _objs: unknown,
        _dx: number,
        dy: number,
      ) => {
        const oldZoom = cam.zoom;
        const factor = dy > 0 ? 0.85 : 1.18;
        const newZoom = Phaser.Math.Clamp(oldZoom * factor, 0.08, 4);
        const wx = pointer.worldX;
        const wy = pointer.worldY;
        cam.setZoom(newZoom);
        cam.scrollX = wx - pointer.x / newZoom;
        cam.scrollY = wy - pointer.y / newZoom;
      },
    );

    this.fitView();
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
      this.scene.start("MenuScene");
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.one)) {
      this.showPoints = !this.showPoints;
      this.drawOverlay();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.two)) {
      this.showCheckpoints = !this.showCheckpoints;
      this.drawOverlay();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.zero)) {
      this.fitView();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.prev)) {
      this.cycleTrack(-1);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.next)) {
      this.cycleTrack(+1);
    }
  }

  private addUi<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    (obj as unknown as { setScrollFactor: (x: number) => void }).setScrollFactor?.(0);
    (obj as unknown as { setDepth: (d: number) => void }).setDepth?.(1000);
    this.uiObjects.push(obj);
    return obj;
  }

  private applyCameraIgnore() {
    this.cameras.main.ignore(this.uiObjects);
    if (this.uiCam) this.uiCam.ignore(this.worldObjects);
  }

  private makeUiButton(label: string, onClick: () => void): Phaser.GameObjects.Text {
    const btn = this.add
      .text(0, 0, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#dddddd",
        backgroundColor: "#2a2a2a",
        padding: { x: 14, y: 6 },
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.addUi(btn);
    btn.on("pointerover", () => {
      btn.setStyle({ backgroundColor: "#404040", color: "#ffffff" });
      this.overUi = true;
    });
    btn.on("pointerout", () => {
      btn.setStyle({ backgroundColor: "#2a2a2a", color: "#dddddd" });
      this.overUi = false;
    });
    btn.on("pointerdown", () => onClick());
    return btn;
  }

  private zoomBy(factor: number) {
    const cam = this.cameras.main;
    const oldZoom = cam.zoom;
    const newZoom = Phaser.Math.Clamp(oldZoom * factor, 0.08, 4);
    const center = cam.midPoint;
    cam.setZoom(newZoom);
    cam.centerOn(center.x, center.y);
  }

  private cycleTrack(dir: number) {
    const idx = TRACK_KEYS.indexOf(this.trackKey);
    const next = TRACK_KEYS[(idx + dir + TRACK_KEYS.length) % TRACK_KEYS.length];
    this.scene.restart({ trackKey: next });
  }

  private metaLine(): string {
    const t = this.track;
    return `${t.centerline.length} pts · width ${t.width} · ${t.checkpointCount} CPs · start@${t.startIndex}${t.description ? `   "${t.description}"` : ""}`;
  }

  private drawOverlay() {
    this.overlay.clear();
    for (const t of this.labels) {
      const i = this.worldObjects.indexOf(t);
      if (i >= 0) this.worldObjects.splice(i, 1);
      t.destroy();
    }
    this.labels = [];

    if (this.showPoints) {
      this.overlay.fillStyle(0xffd24a, 1);
      const labelStride = Math.max(1, Math.floor(this.track.centerline.length / 32));
      for (let i = 0; i < this.track.centerline.length; i++) {
        const p = this.track.centerline[i];
        this.overlay.fillCircle(p.x, p.y, 3);
        if (i % labelStride === 0) {
          const txt = this.add.text(p.x + 6, p.y - 5, String(i), LABEL_STYLE).setDepth(101);
          this.labels.push(txt);
          this.worldObjects.push(txt);
        }
      }
    }

    if (this.showCheckpoints) {
      this.overlay.lineStyle(2, 0x00ffaa, 0.9);
      for (const cp of this.track.checkpoints) {
        const nx = -Math.sin(cp.angle);
        const ny = Math.cos(cp.angle);
        this.overlay.beginPath();
        this.overlay.moveTo(cp.x - nx * cp.outsideHalf, cp.y - ny * cp.outsideHalf);
        this.overlay.lineTo(cp.x + nx * cp.insideHalf, cp.y + ny * cp.insideHalf);
        this.overlay.strokePath();
        const tag = cp.isFinish ? `CP${cp.index} ★` : `CP${cp.index}`;
        const txt = this.add
          .text(cp.x, cp.y, tag, CP_LABEL_STYLE)
          .setOrigin(0.5, 1.6)
          .setDepth(101);
        this.labels.push(txt);
        this.worldObjects.push(txt);
      }
    }
    if (this.uiCam) this.uiCam.ignore(this.labels);
  }

  private fitView() {
    const pts = this.track.centerline;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const margin = this.track.width + 80;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const cam = this.cameras.main;
    const zoom = Math.min(cam.width / w, cam.height / h);
    cam.setZoom(zoom);
    cam.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
  }

  private repositionUi() {
    const w = this.scale.width;
    const h = this.scale.height;
    if (this.uiCam) this.uiCam.setSize(w, h);
    this.coordsText.setPosition(w - 20, 20);
    this.hintText.setPosition(20, h - 30);
    const btnX = w - 40;
    let y = 70;
    for (const b of [this.zoomInBtn, this.zoomOutBtn, this.fitBtn]) {
      if (!b) continue;
      b.setPosition(btnX, y);
      y += 56;
    }
  }
}
