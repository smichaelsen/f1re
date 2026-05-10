import Phaser from "phaser";
import { parseLocation } from "../router";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    this.makePickupTexture("pickup", 0xffffff);
    this.load.audio("engine", "audio/engine.wav");
    this.load.audio("skid", "audio/skid.wav");
    // Menu subtitle pool. Plain-text, one line per subtitle; comments (lines starting with `#`)
    // and blank lines are skipped at render time. Lives in `public/` so users can edit without
    // a rebuild.
    this.load.text("menuSubtitles", "menu-subtitles.txt");
  }

  create() {
    const route = parseLocation();
    if (route.kind === "inspect") {
      this.scene.start("InspectScene", { trackKey: route.trackKey, camera: route.camera });
    } else {
      this.scene.start("MenuScene");
    }
  }

  private makePickupTexture(key: string, color: number) {
    const s = 18;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 1);
    g.fillCircle(s / 2, s / 2, s / 2);
    g.fillStyle(color, 1);
    g.fillCircle(s / 2, s / 2, s / 2 - 2);
    g.fillStyle(0xff3030, 1);
    g.fillRect(s / 2 - 1, 4, 2, s - 8);
    g.fillRect(4, s / 2 - 1, s - 8, 2);
    g.generateTexture(key, s, s);
    g.destroy();
  }
}
