import Phaser from "phaser";

const TEX = "sparkParticle";
const TEX_SIZE = 4;

/**
 * Short-lived spark bursts on wall impact. One ParticleEmitter, omnidirectional fan, fast and bright.
 *
 * Spawn rule (driven by RaceScene.applyTrackBounds): on a wall hit where the velocity component
 * along the wall normal exceeds an impact threshold, explode N particles at the worst-penetrating
 * corner. Count and kinetic spread scale with impact magnitude.
 */
export class SparkParticles {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(TEX)) {
      const g = scene.add.graphics();
      g.fillStyle(0xffe49a, 1);
      g.fillCircle(TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2);
      g.generateTexture(TEX, TEX_SIZE, TEX_SIZE);
      g.destroy();
    }

    this.emitter = scene.add.particles(0, 0, TEX, {
      lifespan: { min: 180, max: 360 },
      speed: { min: 90, max: 260 },
      scale: { start: 1.2, end: 0.1 },
      alpha: { start: 1, end: 0 },
      angle: { min: 0, max: 360 },
      tint: [0xffe49a, 0xffb24a, 0xff7a1a],
      emitting: false,
    });
    this.emitter.setDepth(9);
  }

  burst(x: number, y: number, count: number) {
    if (count <= 0) return;
    this.emitter.emitParticleAt(x, y, count);
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.emitter];
  }

  destroy() {
    this.emitter.destroy();
  }
}
