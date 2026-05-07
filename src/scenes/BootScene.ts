import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    this.makeCarTexture("car_red", 0xe10600);
    this.makeCarTexture("car_blue", 0x1e90ff);
    this.makeCarTexture("car_yellow", 0xf2c200);
    this.makeCarTexture("car_green", 0x2ecc40);
    this.makePickupTexture("pickup", 0xffffff);
  }

  create() {
    this.scene.start("MenuScene");
  }

  private makeCarTexture(key: string, color: number) {
    const w = 44;
    const h = 20;
    const g = this.add.graphics();

    const black = 0x111111;
    const dark = 0x222222;
    const silver = 0x888888;
    const white = 0xffffff;

    g.fillStyle(color, 1);
    g.fillRoundedRect(12, 3, 14, 14, 2);
    g.fillRect(5, 7, 11, 6);
    g.fillRect(24, 8, 14, 4);

    g.fillStyle(black, 1);
    g.fillRoundedRect(0, 2, 5, 16, 1);
    g.fillStyle(color, 1);
    g.fillRect(0, 9, 5, 2);

    g.fillStyle(black, 1);
    g.fillRoundedRect(38, 1, 6, 18, 1);
    g.fillStyle(color, 1);
    g.fillRect(38, 9, 6, 2);

    g.fillStyle(black, 1);
    g.fillRoundedRect(5, 0, 8, 5, 1);
    g.fillRoundedRect(5, 15, 8, 5, 1);
    g.fillRoundedRect(28, 0, 8, 5, 1);
    g.fillRoundedRect(28, 15, 8, 5, 1);

    g.fillStyle(silver, 1);
    g.fillRect(7, 1, 4, 3);
    g.fillRect(7, 16, 4, 3);
    g.fillRect(30, 1, 4, 3);
    g.fillRect(30, 16, 4, 3);

    g.fillStyle(dark, 1);
    g.fillRoundedRect(17, 7, 8, 6, 1);

    g.fillStyle(white, 1);
    g.fillCircle(21, 10, 2);

    g.fillStyle(0x000000, 1);
    g.fillRect(22, 9, 1, 2);

    g.generateTexture(key, w, h);
    g.destroy();
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
