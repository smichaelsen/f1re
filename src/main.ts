import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { InspectScene } from "./scenes/InspectScene";
import { MenuScene } from "./scenes/MenuScene";
import { RaceScene } from "./scenes/RaceScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1a1a1a",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [BootScene, MenuScene, RaceScene, InspectScene],
};

const game = new Phaser.Game(config);
(window as unknown as { __game: Phaser.Game }).__game = game;
