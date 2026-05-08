import Phaser from "phaser";

const STAMP_KEY = "skidStamp";
const STAMP_W = 8;
const STAMP_H = 4;
const STAMP_COLOR = 0x111111;

export interface SkidMarksBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Persistent skid-mark layer. A single RenderTexture covers the track bbox; each call to
 * `drawAt` stamps a small dark blob with low alpha. Repeated stamps in the same place stack
 * (alpha accumulates) so heavy skids darken naturally.
 *
 * The stamp helper Sprite is hidden — it exists only as a positionable/rotatable source for
 * `RenderTexture.draw`. Both the RT and the stamp are returned via `objects` so the scene can
 * route them through the world camera (and away from the UI camera).
 */
export class SkidMarks {
  private rt: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Sprite;
  private originX: number;
  private originY: number;

  constructor(scene: Phaser.Scene, bounds: SkidMarksBounds) {
    if (!scene.textures.exists(STAMP_KEY)) {
      const g = scene.add.graphics();
      g.fillStyle(STAMP_COLOR, 1);
      g.fillEllipse(STAMP_W / 2, STAMP_H / 2, STAMP_W, STAMP_H);
      g.generateTexture(STAMP_KEY, STAMP_W, STAMP_H);
      g.destroy();
    }

    this.originX = bounds.x;
    this.originY = bounds.y;
    this.rt = scene.add.renderTexture(bounds.x, bounds.y, bounds.width, bounds.height);
    this.rt.setOrigin(0, 0);
    this.rt.setDepth(3);

    this.stamp = scene.add.sprite(0, 0, STAMP_KEY);
    this.stamp.setVisible(false);
  }

  /**
   * Open a batch. All `drawAt` calls between `beginFrame` and `endFrame` are committed
   * in a single WebGL render-target bind/draw/unbind cycle — without batching, each
   * `rt.draw` is its own pass and the per-frame overhead dominates once multiple cars
   * skid simultaneously.
   */
  beginFrame() {
    this.rt.beginDraw();
  }

  endFrame() {
    this.rt.endDraw();
  }

  drawAt(worldX: number, worldY: number, rotation: number, alpha: number) {
    if (alpha <= 0) return;
    const localX = worldX - this.originX;
    const localY = worldY - this.originY;
    if (localX < 0 || localY < 0 || localX > this.rt.width || localY > this.rt.height) return;
    this.stamp.setPosition(localX, localY);
    this.stamp.setRotation(rotation);
    this.stamp.setAlpha(Math.min(1, alpha));
    this.rt.batchDraw(this.stamp);
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.rt, this.stamp];
  }

  destroy() {
    this.rt.destroy();
    this.stamp.destroy();
  }
}
