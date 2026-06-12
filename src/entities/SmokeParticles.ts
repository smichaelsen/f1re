import Phaser from "phaser";

const TEX = "smokeParticle";
const TEX_SIZE = 8;

/**
 * Gray smoke puffs for hard wall impacts. One ParticleEmitter; particles expand while fading
 * so a single burst reads as a billowing cloud rather than confetti.
 *
 * Spawn rule (driven by applyTrackBounds): on a wall hit well above the spark threshold,
 * emit a handful of puffs at the impact point on top of the spark burst. Count scales with
 * impact magnitude.
 */
export class SmokeParticles {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(TEX)) {
      const g = scene.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2);
      g.generateTexture(TEX, TEX_SIZE, TEX_SIZE);
      g.destroy();
    }

    this.emitter = scene.add.particles(0, 0, TEX, {
      lifespan: { min: 450, max: 850 },
      speed: { min: 15, max: 65 },
      scale: { start: 1.2, end: 3.2 },
      alpha: { start: 0.45, end: 0 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      tint: [0x8d8d8d, 0xa6a6a6, 0x6f6f6f],
      emitting: false,
    });
    // Above cars (depth 10) and shield rings (11) so the cloud envelops the car that hit the wall.
    this.emitter.setDepth(12);
  }

  puff(x: number, y: number, count: number) {
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
