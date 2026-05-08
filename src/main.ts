import Phaser from "phaser";
import { onPopState } from "./router";
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
  loader: { baseURL: import.meta.env.BASE_URL },
  scene: [BootScene, MenuScene, RaceScene, InspectScene],
};

const game = new Phaser.Game(config);
(window as unknown as { __game: Phaser.Game }).__game = game;

onPopState((route) => {
  for (const key of ["MenuScene", "InspectScene", "RaceScene"]) {
    if (game.scene.isActive(key)) game.scene.stop(key);
  }
  if (route.kind === "inspect") {
    game.scene.start("InspectScene", { trackKey: route.trackKey, camera: route.camera });
  } else {
    game.scene.start("MenuScene");
  }
});
