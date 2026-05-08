import Phaser from "phaser";

const TEX = "dustParticle";
const TEX_SIZE = 6;

/**
 * Short-lived dust puffs. Wraps a single Phaser ParticleEmitter so all dust draws batch.
 * The emitter is omnidirectional and ephemeral — particles fade out in ~500 ms; nothing persists.
 *
 * Spawn rule (driven by RaceScene): when a rear corner of a car is over a non-asphalt surface
 * and the car is moving fast enough, emit one particle at that corner each frame. The accumulation
 * is what produces the visible cloud trailing the rear wheels.
 */
export class DustParticles {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(TEX)) {
      const g = scene.add.graphics();
      g.fillStyle(0xb39a72, 1);
      g.fillCircle(TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2);
      g.generateTexture(TEX, TEX_SIZE, TEX_SIZE);
      g.destroy();
    }

    this.emitter = scene.add.particles(0, 0, TEX, {
      lifespan: { min: 350, max: 600 },
      speed: { min: 25, max: 85 },
      scale: { start: 1.6, end: 0.4 },
      alpha: { start: 0.55, end: 0 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    this.emitter.setDepth(4);
  }

  emitAt(x: number, y: number, count = 1) {
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
