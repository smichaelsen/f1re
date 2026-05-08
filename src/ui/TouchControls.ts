import Phaser from "phaser";

export interface TouchInputState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
}

type PadId = "left" | "right" | "throttle" | "brake" | "item";

interface PadZone {
  id: PadId;
  cx: number;
  cy: number;
  r: number;
  graphics: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  pressed: boolean;
}

const PAD_FILL = 0x000000;
const PAD_FILL_ALPHA_IDLE = 0.35;
const PAD_FILL_ALPHA_PRESSED = 0.6;
const PAD_STROKE = 0xffffff;
const PAD_STROKE_ALPHA = 0.6;
const PAD_STROKE_WIDTH = 3;
const PAD_DEPTH = 1300;

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  if ("ontouchstart" in window) return true;
  const maxTouch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  if (maxTouch > 0) return true;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export class TouchControls {
  scene: Phaser.Scene;
  active: boolean;
  state: TouchInputState = { left: false, right: false, throttle: false, brake: false };
  objects: Phaser.GameObjects.GameObject[] = [];

  private zones: PadZone[] = [];
  private pressedItem = false;
  private lastItemDown = false;
  private lastW = 0;
  private lastH = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.active = isTouchDevice();
    if (!this.active) return;

    scene.input.addPointer(3);

    const make = (id: PadId, r: number, glyph: string, fontPx: number): PadZone => {
      const graphics = scene.add.graphics().setScrollFactor(0).setDepth(PAD_DEPTH);
      const label = scene.add
        .text(0, 0, glyph, {
          fontFamily: "system-ui, sans-serif",
          fontSize: `${fontPx}px`,
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(PAD_DEPTH + 1);
      return { id, cx: 0, cy: 0, r, graphics, label, pressed: false };
    };

    this.zones = [
      make("left", 60, "◀", 32),
      make("right", 60, "▶", 32),
      make("throttle", 64, "▲", 34),
      make("brake", 56, "▼", 30),
      make("item", 44, "★", 24),
    ];

    for (const z of this.zones) {
      this.objects.push(z.graphics, z.label);
    }

    this.layout();
    this.draw();
  }

  update() {
    if (!this.active) return;

    const cam = this.scene.cameras.main;
    if (cam.width !== this.lastW || cam.height !== this.lastH) {
      this.layout();
    }

    const pointers = this.scene.input.manager.pointers;
    const hits: Record<PadId, boolean> = {
      left: false,
      right: false,
      throttle: false,
      brake: false,
      item: false,
    };
    for (const p of pointers) {
      if (!p.isDown) continue;
      for (const z of this.zones) {
        const dx = p.x - z.cx;
        const dy = p.y - z.cy;
        if (dx * dx + dy * dy <= z.r * z.r) hits[z.id] = true;
      }
    }

    this.state.left = hits.left;
    this.state.right = hits.right;
    this.state.throttle = hits.throttle;
    this.state.brake = hits.brake;

    if (hits.item && !this.lastItemDown) this.pressedItem = true;
    this.lastItemDown = hits.item;

    let dirty = false;
    for (const z of this.zones) {
      const pressed = hits[z.id];
      if (pressed !== z.pressed) {
        z.pressed = pressed;
        dirty = true;
      }
    }
    if (dirty) this.draw();
  }

  consumeUseItem(): boolean {
    const v = this.pressedItem;
    this.pressedItem = false;
    return v;
  }

  private layout() {
    if (!this.active) return;
    const cam = this.scene.cameras.main;
    const w = cam.width;
    const h = cam.height;
    this.lastW = w;
    this.lastH = h;

    const margin = 36;
    const gap = 24;

    const left = this.findZone("left");
    const right = this.findZone("right");
    const ly = h - margin - left.r;
    left.cx = margin + left.r;
    left.cy = ly;
    right.cx = left.cx + left.r + gap + right.r;
    right.cy = ly;

    const throttle = this.findZone("throttle");
    const brake = this.findZone("brake");
    const item = this.findZone("item");
    const stackX = w - margin - throttle.r;

    throttle.cx = stackX;
    throttle.cy = h - margin - throttle.r;
    brake.cx = stackX;
    brake.cy = throttle.cy - throttle.r - gap - brake.r;
    item.cx = stackX;
    item.cy = brake.cy - brake.r - gap - item.r;

    for (const z of this.zones) z.label.setPosition(z.cx, z.cy);
    this.draw();
  }

  private findZone(id: PadId): PadZone {
    const z = this.zones.find((p) => p.id === id);
    if (!z) throw new Error(`TouchControls: missing zone ${id}`);
    return z;
  }

  private draw() {
    if (!this.active) return;
    for (const z of this.zones) {
      const fillAlpha = z.pressed ? PAD_FILL_ALPHA_PRESSED : PAD_FILL_ALPHA_IDLE;
      z.graphics.clear();
      z.graphics.fillStyle(PAD_FILL, fillAlpha);
      z.graphics.fillCircle(z.cx, z.cy, z.r);
      z.graphics.lineStyle(PAD_STROKE_WIDTH, PAD_STROKE, PAD_STROKE_ALPHA);
      z.graphics.strokeCircle(z.cx, z.cy, z.r);
    }
  }
}
