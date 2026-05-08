import Phaser from "phaser";

export interface PositionRow {
  pos: number;
  name: string;
  isPlayer: boolean;
  lapsDone: number;
  finished: boolean;
}

export type HudSide = "left" | "right";

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
  itemText: Phaser.GameObjects.Text;
  msgText: Phaser.GameObjects.Text;
  posTitle: Phaser.GameObjects.Text | null = null;
  posRows: Phaser.GameObjects.Text[] = [];
  countdownText: Phaser.GameObjects.Text | null = null;
  resultsBg: Phaser.GameObjects.Rectangle | null = null;
  resultsText: Phaser.GameObjects.Text | null = null;
  objects: Phaser.GameObjects.GameObject[] = [];
  resultsCompact = false;
  msgFadeUntil = 0;

  constructor(scene: Phaser.Scene, side: HudSide = "left") {
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
    this.itemText = scene.add
      .text(startX, 140, "", { ...style, color: "#ffd24a" })
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
      this.itemText,
      this.msgText,
    ];

    if (isLeft) {
      this.posTitle = scene.add
        .text(0, 20, "POSITION", { ...style, fontSize: "16px", color: "#aaaaaa" })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(1000);
      for (let i = 0; i < 4; i++) {
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

      this.objects.push(this.posTitle, ...this.posRows, this.countdownText, this.resultsBg, this.resultsText);
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
  setItem(item: string | null, useKey: string = "SPACE") {
    this.itemText.setText(item ? `ITEM [${item.toUpperCase()}]  ${useKey} to use` : "");
  }
  flash(text: string, ms = 1500) {
    this.msgText.setText(text);
    this.msgFadeUntil = this.scene.time.now + ms;
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
      this.itemText.setPosition(20, 140);
    } else {
      const x = cam.width - 20;
      this.speedText.setPosition(x, 20);
      this.lapText.setPosition(x, 50);
      this.timeText.setPosition(x, 80);
      this.bestText.setPosition(x, 110);
      this.itemText.setPosition(x, 140);
    }

    // Per-side flash position: P1 just left of center, P2 just right of center.
    // In 1P mode we keep msgText centered (existing behaviour).
    if (multiplayer) {
      const offset = isLeft ? -160 : 160;
      this.msgText.setPosition(cam.width / 2 + offset, 100);
    } else {
      this.msgText.setPosition(cam.width / 2, 100);
    }

    if (this.countdownText) {
      this.countdownText.setPosition(cam.width / 2, cam.height / 2);
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
  }
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
