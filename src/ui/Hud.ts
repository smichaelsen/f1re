import Phaser from "phaser";
import { createItemIcon, redrawItemIcon } from "./ItemIcon";

export interface PositionRow {
  pos: number;
  name: string;
  isPlayer: boolean;
  lapsDone: number;
  finished: boolean;
}

export type HudSide = "left" | "right";

const PRIMARY_ICON_SIZE = 40;
const SECONDARY_SCALE = 0.62;
const SLOT_PADDING = 6;
const PRIMARY_SLOT_SIZE = PRIMARY_ICON_SIZE + SLOT_PADDING * 2;
const SECONDARY_SLOT_SIZE = Math.round(PRIMARY_SLOT_SIZE * SECONDARY_SCALE);
const SLOT_CORNER_RADIUS = 6;
const SLOT_FILL = 0x111111;
const SLOT_FILL_ALPHA = 0.45;
const SLOT_STROKE = 0xffffff;
const SLOT_STROKE_ALPHA = 0.25;
// Secondary slot offset from the primary's center. Negative X = to the upper-left of the
// primary (so secondary visibly pokes out instead of being almost fully obscured).
const SECONDARY_OFFSET_X = -26;
const SECONDARY_OFFSET_Y = -20;

/**
 * Per-player HUD slot. In 1P mode there is exactly one Hud (`side: 'left'`) and it owns
 * the positions panel + countdown + results overlay. In 2P mode we instantiate a second
 * Hud (`side: 'right'`) which owns only its player's stats — the shared overlays
 * (countdown, results, positions panel) stay on the 'left' instance to avoid double-rendering.
 */
export class Hud {
  scene: Phaser.Scene;
  side: HudSide;
  speedText: Phaser.GameObjects.Text;
  lapText: Phaser.GameObjects.Text;
  timeText: Phaser.GameObjects.Text;
  bestText: Phaser.GameObjects.Text;
  // Inventory: two slot boxes. Primary (front-of-queue, big), secondary (next-up, smaller and
  // offset back-left). The slot backgrounds are always visible so empty inventory still reads as
  // "two slots". `currentItems` is the item-key list the icons currently render; we only redraw
  // on change.
  itemPrimaryBg: Phaser.GameObjects.Graphics;
  itemSecondaryBg: Phaser.GameObjects.Graphics;
  itemPrimary: Phaser.GameObjects.Container;
  itemSecondary: Phaser.GameObjects.Container;
  itemHint: Phaser.GameObjects.Text;
  currentItems: string[] = [];
  drsText: Phaser.GameObjects.Text;
  msgText: Phaser.GameObjects.Text;
  // Session-wide broadcast slot (FASTEST LAP, DRS ENABLED). Lives only on the 'left' HUD so it
  // renders once at screen center even in 2P mode, instead of being mirrored on both sides.
  broadcastText: Phaser.GameObjects.Text | null = null;
  posTitle: Phaser.GameObjects.Text | null = null;
  posRows: Phaser.GameObjects.Text[] = [];
  countdownText: Phaser.GameObjects.Text | null = null;
  resultsBg: Phaser.GameObjects.Rectangle | null = null;
  resultsText: Phaser.GameObjects.Text | null = null;
  objects: Phaser.GameObjects.GameObject[] = [];
  resultsCompact = false;
  msgFadeUntil = 0;
  broadcastFadeUntil = 0;

  constructor(scene: Phaser.Scene, side: HudSide = "left", positionRowCount = 4) {
    this.scene = scene;
    this.side = side;
    const isLeft = side === "left";
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "system-ui, sans-serif",
      fontSize: "20px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
    };

    // Stats column. Anchor to top-left or top-right; positions are reset every update().
    const anchorX = isLeft ? 0 : 1;
    const startX = isLeft ? 20 : -20;
    this.speedText = scene.add.text(startX, 20, "", style).setOrigin(anchorX, 0).setScrollFactor(0).setDepth(1000);
    this.lapText = scene.add.text(startX, 50, "", style).setOrigin(anchorX, 0).setScrollFactor(0).setDepth(1000);
    this.timeText = scene.add.text(startX, 80, "", style).setOrigin(anchorX, 0).setScrollFactor(0).setDepth(1000);
    this.bestText = scene.add.text(startX, 110, "", style).setOrigin(anchorX, 0).setScrollFactor(0).setDepth(1000);
    // Inventory boxes + icons. Depth ordering bottom-to-top so the primary slot occludes the
    // secondary's overlap region: secondary bg (999) → secondary icon (1000) → primary bg
    // (1000.5) → primary icon (1001). Backgrounds always visible so empty slots still read.
    this.itemSecondaryBg = drawSlotBg(scene, SECONDARY_SLOT_SIZE)
      .setScrollFactor(0)
      .setDepth(999);
    this.itemSecondary = createItemIcon(scene, "boost", PRIMARY_ICON_SIZE * SECONDARY_SCALE)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
    this.itemPrimaryBg = drawSlotBg(scene, PRIMARY_SLOT_SIZE)
      .setScrollFactor(0)
      .setDepth(1000.5);
    this.itemPrimary = createItemIcon(scene, "boost", PRIMARY_ICON_SIZE)
      .setScrollFactor(0)
      .setDepth(1001)
      .setVisible(false);
    this.itemHint = scene.add
      .text(startX, 140, "", { ...style, fontSize: "14px", color: "#888888" })
      .setOrigin(anchorX, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.drsText = scene.add
      .text(startX, 170, "", { ...style, color: "#88ccff" })
      .setOrigin(anchorX, 0)
      .setScrollFactor(0)
      .setDepth(1000);

    this.msgText = scene.add
      .text(0, 0, "", { ...style, fontSize: "36px", color: "#ffd24a" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);

    this.objects = [
      this.speedText,
      this.lapText,
      this.timeText,
      this.bestText,
      this.itemSecondaryBg,
      this.itemSecondary,
      this.itemPrimaryBg,
      this.itemPrimary,
      this.itemHint,
      this.drsText,
      this.msgText,
    ];

    if (isLeft) {
      this.posTitle = scene.add
        .text(0, 20, "POSITION", { ...style, fontSize: "16px", color: "#aaaaaa" })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(1000);
      for (let i = 0; i < positionRowCount; i++) {
        const row = scene.add
          .text(0, 44 + i * 26, "", style)
          .setOrigin(1, 0)
          .setScrollFactor(0)
          .setDepth(1000);
        this.posRows.push(row);
      }
      this.countdownText = scene.add
        .text(0, 0, "", {
          ...style,
          fontSize: "120px",
          color: "#ff3030",
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1100)
        .setVisible(false);
      this.broadcastText = scene.add
        .text(0, 0, "", { ...style, fontSize: "32px", color: "#ffd24a" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1000);
      this.resultsBg = scene.add
        .rectangle(0, 0, 100, 100, 0x000000, 0.7)
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1200)
        .setVisible(false);
      this.resultsText = scene.add
        .text(0, 0, "", {
          ...style,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "20px",
          align: "left",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1201)
        .setVisible(false);

      this.objects.push(this.posTitle, ...this.posRows, this.countdownText, this.broadcastText, this.resultsBg, this.resultsText);
    }
  }

  setSpeed(kph: number) {
    this.speedText.setText(`SPD ${kph.toFixed(0)} km/h`);
  }
  setLap(lap: number, total: number) {
    this.lapText.setText(`LAP ${Math.min(lap, total)}/${total}`);
  }
  setTime(ms: number) {
    this.timeText.setText(`TIME ${formatMs(ms)}`);
  }
  setBest(ms: number | null) {
    this.bestText.setText(`BEST ${ms == null ? "—" : formatMs(ms)}`);
  }
  // Place the primary + secondary icons + the use-key hint. Side-aware: on the right HUD the
  // secondary tucks toward the right edge so the layout still reads "behind, off-screen-side".
  // Inventory is centered horizontally inside the player's screen region:
  //  - 1P: cam.width / 2
  //  - 2P left: cam.width / 4
  //  - 2P right: 3 * cam.width / 4
  // The hint label centers under the primary slot.
  private positionItemIcons(multiplayer: boolean) {
    const cam = this.scene.cameras.main;
    const baseY = 110;
    const isLeft = this.side === "left";
    const px = !multiplayer
      ? cam.width / 2
      : isLeft
        ? cam.width / 4
        : (cam.width * 3) / 4;
    this.itemPrimaryBg.setPosition(px, baseY);
    this.itemPrimary.setPosition(px, baseY);
    this.itemSecondaryBg.setPosition(px + SECONDARY_OFFSET_X, baseY + SECONDARY_OFFSET_Y);
    this.itemSecondary.setPosition(px + SECONDARY_OFFSET_X, baseY + SECONDARY_OFFSET_Y);
    this.itemHint.setPosition(px, baseY + PRIMARY_SLOT_SIZE / 2 + 6).setOrigin(0.5, 0);
  }

  setItem(items: string[], useKey: string = "SPACE") {
    // Diff against the previously rendered list; only redraw when content changes. Position is
    // re-applied every frame in update() because the HUD anchors flip on resize / 2P layout.
    const primary = items[0] ?? null;
    const secondary = items[1] ?? null;
    if (primary !== (this.currentItems[0] ?? null)) {
      if (primary) redrawItemIcon(this.itemPrimary, primary, PRIMARY_ICON_SIZE);
      this.itemPrimary.setVisible(primary != null);
    }
    if (secondary !== (this.currentItems[1] ?? null)) {
      if (secondary) redrawItemIcon(this.itemSecondary, secondary, PRIMARY_ICON_SIZE * SECONDARY_SCALE);
      this.itemSecondary.setVisible(secondary != null);
    }
    this.currentItems = items.slice();
    this.itemHint.setText(primary ? `${useKey} to use` : "");
  }
  setDrs(state: "off" | "available" | "active", drsKey: string = "RSHIFT") {
    if (state === "off") {
      this.drsText.setText("");
      return;
    }
    if (state === "active") {
      this.drsText.setText("DRS ACTIVE").setColor("#88ffff");
      return;
    }
    this.drsText.setText(`DRS  ${drsKey} to deploy`).setColor("#88ccff");
  }
  flash(text: string, ms = 1500) {
    this.msgText.setText(text);
    this.msgFadeUntil = this.scene.time.now + ms;
  }
  // Session-wide broadcast (e.g. fastest lap). No-op on the right HUD; only the left HUD owns
  // the centered broadcast slot so 2P mode shows it once instead of mirrored.
  broadcast(text: string, ms = 1500) {
    if (!this.broadcastText) return;
    this.broadcastText.setText(text);
    this.broadcastFadeUntil = this.scene.time.now + ms;
  }

  setPositions(rows: PositionRow[], totalLaps: number) {
    if (this.posRows.length === 0) return;
    for (let i = 0; i < this.posRows.length; i++) {
      const r = rows[i];
      if (!r) {
        this.posRows[i].setText("");
        continue;
      }
      const tag = r.finished ? "✓" : `L${Math.min(r.lapsDone + 1, totalLaps)}`;
      const text = `P${r.pos} ${r.name}  ${tag}`;
      this.posRows[i].setText(text);
      this.posRows[i].setColor(r.isPlayer ? "#ffd24a" : "#ffffff");
    }
  }

  showCountdown(text: string, color = "#ff3030") {
    if (!this.countdownText) return;
    this.countdownText.setText(text);
    this.countdownText.setColor(color);
    this.countdownText.setVisible(true);
  }
  hideCountdown() {
    this.countdownText?.setVisible(false);
  }

  showResults(lines: string[], compact = false) {
    if (!this.resultsText || !this.resultsBg) return;
    this.resultsCompact = compact;
    this.resultsText.setText(lines.join("\n"));
    this.resultsText.setStyle({
      ...this.resultsText.style,
      fontSize: compact ? "13px" : "20px",
    });
    this.resultsText.setVisible(true);
    this.resultsBg.setVisible(true);
  }
  hideResults() {
    this.resultsText?.setVisible(false);
    this.resultsBg?.setVisible(false);
  }

  // `multiplayer` = true reroutes the position panel to the bottom-center of the screen,
  // since the right side of the screen now belongs to the P2 stats column.
  update(multiplayer = false) {
    const cam = this.scene.cameras.main;
    const isLeft = this.side === "left";
    if (isLeft) {
      this.speedText.setPosition(20, 20);
      this.lapText.setPosition(20, 50);
      this.timeText.setPosition(20, 80);
      this.bestText.setPosition(20, 110);
      this.drsText.setPosition(20, 235);
    } else {
      const x = cam.width - 20;
      this.speedText.setPosition(x, 20);
      this.lapText.setPosition(x, 50);
      this.timeText.setPosition(x, 80);
      this.bestText.setPosition(x, 110);
      this.drsText.setPosition(x, 235);
    }
    this.positionItemIcons(multiplayer);

    // Per-side flash position: P1 just left of center, P2 just right of center. Sits below the
    // top-centered inventory in 1P (y=180) so a BOOST!/MISSILE! flash doesn't render on top of
    // the icons.
    if (multiplayer) {
      const offset = isLeft ? -160 : 160;
      this.msgText.setPosition(cam.width / 2 + offset, 180);
    } else {
      this.msgText.setPosition(cam.width / 2, 180);
    }

    if (this.countdownText) {
      this.countdownText.setPosition(cam.width / 2, cam.height / 2);
    }

    if (this.broadcastText) {
      // Sit slightly above the per-player flash slot (y=100) so a personal flash and a
      // simultaneous broadcast (e.g. PERSONAL BEST + FASTEST LAP on the same lap) don't overlap.
      this.broadcastText.setPosition(cam.width / 2, 56);
    }

    if (this.posTitle && this.posRows.length > 0) {
      if (multiplayer) {
        const baseY = cam.height - 30 - this.posRows.length * 22;
        this.posTitle.setOrigin(0.5, 1);
        this.posTitle.setPosition(cam.width / 2, baseY - 6);
        this.posTitle.setStyle({ ...this.posTitle.style, fontSize: "13px" });
        for (let i = 0; i < this.posRows.length; i++) {
          this.posRows[i].setOrigin(0.5, 0);
          this.posRows[i].setPosition(cam.width / 2, baseY + i * 22);
          this.posRows[i].setStyle({ ...this.posRows[i].style, fontSize: "16px" });
        }
      } else {
        this.posTitle.setOrigin(1, 0);
        this.posTitle.setPosition(cam.width - 20, 20);
        this.posTitle.setStyle({ ...this.posTitle.style, fontSize: "16px" });
        for (let i = 0; i < this.posRows.length; i++) {
          this.posRows[i].setOrigin(1, 0);
          this.posRows[i].setPosition(cam.width - 20, 44 + i * 26);
          this.posRows[i].setStyle({ ...this.posRows[i].style, fontSize: "20px" });
        }
      }
    }

    if (this.resultsText && this.resultsBg) {
      if (this.resultsCompact) {
        const padX = 16;
        const padY = 16;
        const txtPadX = 12;
        const txtPadY = 10;
        this.resultsText.setOrigin(1, 1);
        this.resultsText.setPosition(cam.width - padX - txtPadX, cam.height - padY - txtPadY);
        const w = Math.max(140, this.resultsText.displayWidth + txtPadX * 2);
        const h = Math.max(40, this.resultsText.displayHeight + txtPadY * 2);
        this.resultsBg.setOrigin(1, 1);
        this.resultsBg.setPosition(cam.width - padX, cam.height - padY);
        this.resultsBg.setSize(w, h);
      } else {
        this.resultsText.setOrigin(0.5);
        this.resultsText.setPosition(cam.width / 2, cam.height / 2);
        const w = Math.max(440, this.resultsText.displayWidth + 60);
        const h = Math.max(280, this.resultsText.displayHeight + 60);
        this.resultsBg.setOrigin(0.5);
        this.resultsBg.setPosition(cam.width / 2, cam.height / 2);
        this.resultsBg.setSize(w, h);
      }
    }
    if (this.scene.time.now > this.msgFadeUntil) this.msgText.setText("");
    if (this.broadcastText && this.scene.time.now > this.broadcastFadeUntil) {
      this.broadcastText.setText("");
    }
  }
}

function drawSlotBg(scene: Phaser.Scene, size: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // Centered rounded rect so the same `setPosition(x, y)` works for both bg and icon.
  g.fillStyle(SLOT_FILL, SLOT_FILL_ALPHA);
  g.fillRoundedRect(-size / 2, -size / 2, size, size, SLOT_CORNER_RADIUS);
  g.lineStyle(2, SLOT_STROKE, SLOT_STROKE_ALPHA);
  g.strokeRoundedRect(-size / 2, -size / 2, size, size, SLOT_CORNER_RADIUS);
  return g;
}

function formatMs(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function formatRaceTime(ms: number): string {
  return formatMs(ms);
}
