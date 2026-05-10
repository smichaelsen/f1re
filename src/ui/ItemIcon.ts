import Phaser from "phaser";

// Item icon visuals mirror the in-world graphics for each item so the HUD reads as
// "the thing you're about to throw". Drawn into a Container so callers can position +
// scale the whole group cheaply.
//
// `size` is the nominal diameter in pixels. Each item draws into a [-size/2, +size/2] box.

const SHIELD_COLOR = 0x88ccff;

export function createItemIcon(scene: Phaser.Scene, item: string, size: number): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  redrawItemIcon(c, item, size);
  return c;
}

export function redrawItemIcon(container: Phaser.GameObjects.Container, item: string, size: number) {
  // Wipe and rebuild — caller invokes when the displayed item changes, not per frame.
  container.removeAll(true);
  const s = size / 48; // base unit: drawings authored at size=48.
  const g = container.scene.add.graphics();
  switch (item) {
    case "missile":
      // RaceScene.fireMissile: r=4 fill + r=6 stroke. Scaled up to fill the icon box.
      g.fillStyle(0xff5050, 1);
      g.fillCircle(0, 0, 14 * s);
      g.lineStyle(4 * s, 0xffaa00, 1);
      g.strokeCircle(0, 0, 18 * s);
      break;
    case "seeker":
      // RaceScene.fireSeeker: r=5 cyan core + r=8 white stroke.
      g.fillStyle(0x40e0ff, 1);
      g.fillCircle(0, 0, 14 * s);
      g.lineStyle(4 * s, 0xffffff, 1);
      g.strokeCircle(0, 0, 19 * s);
      break;
    case "oil":
      // RaceScene.dropOil: r=22 black blob with offset r=14 dark-grey highlight.
      g.fillStyle(0x000000, 0.95);
      g.fillCircle(0, 0, 20 * s);
      g.fillStyle(0x4a4a4a, 0.9);
      g.fillCircle(5 * s, -3 * s, 10 * s);
      break;
    case "shield":
      // Pulsing ring around the car (Car.SHIELD_COLOR). Static here.
      g.lineStyle(4 * s, SHIELD_COLOR, 1);
      g.strokeCircle(0, 0, 19 * s);
      g.lineStyle(2 * s, 0xffffff, 0.7);
      g.strokeCircle(0, 0, 12 * s);
      break;
    case "boost":
    default:
      // No in-world sprite for boost; double-chevron in flame palette reads as "go fast".
      drawChevron(g, -8 * s, 0, 10 * s, 0xffd24a);
      drawChevron(g, 2 * s, 0, 10 * s, 0xff7a1a);
      break;
  }
  container.add(g);
}

function drawChevron(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, color: number) {
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(x, y - w);
  g.lineTo(x + w, y);
  g.lineTo(x, y + w);
  g.lineTo(x - w * 0.4, y);
  g.closePath();
  g.fillPath();
}
