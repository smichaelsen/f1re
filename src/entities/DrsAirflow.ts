import Phaser from "phaser";

const TEX = "drsAirflowParticle";
const TEX_SIZE = 10;

/**
 * Short tilde-shaped streaks emitted from the rear of a car while DRS is active. Visualizes
 * the slipstream a real DRS car generates when the rear wing flap is open and drag drops.
 *
 * RaceScene.updateDrsAirflow is the spawn driver — it picks the rear-center of each drs-active
 * car above a speed floor and emits particles per frame oriented opposite the car's heading.
 * Particle lifespans are short (~400 ms) so the streak length scales naturally with speed.
 */
export class DrsAirflow {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  // Per-emit direction state. We update these immediately before each emitParticleAt call so
  // the angle/rotation onEmit callbacks below pull the right per-call values.
  private dirRad = 0;

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(TEX)) {
      const g = scene.add.graphics();
      // Wavy "~" glyph: two arcs in opposite directions, drawn as a polyline so each particle
      // already carries the airflow squiggle silhouette without per-frame redraw.
      g.lineStyle(1.5, 0xffffff, 1);
      const cy = TEX_SIZE / 2;
      g.beginPath();
      g.moveTo(0, cy);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = t * TEX_SIZE;
        const y = cy + Math.sin(t * Math.PI * 2) * (TEX_SIZE * 0.25);
        g.lineTo(x, y);
      }
      g.strokePath();
      g.generateTexture(TEX, TEX_SIZE, TEX_SIZE);
      g.destroy();
    }

    this.emitter = scene.add.particles(0, 0, TEX, {
      lifespan: { min: 180, max: 320 },
      speed: { min: 50, max: 110 },
      scale: { start: 0.55, end: 0.25 },
      alpha: { start: 0.35, end: 0 },
      tint: [0xbfdcff, 0xffffff, 0x88ccff],
      // Per-emit direction with a small spread cone. Pulls from `this.dirRad` set in emitAt().
      angle: {
        onEmit: () => {
          const deg = (this.dirRad * 180) / Math.PI;
          const jitter = (Math.random() - 0.5) * 22;
          return deg + jitter;
        },
      },
      rotate: {
        onEmit: () => (this.dirRad * 180) / Math.PI,
      },
      emitting: false,
    });
    this.emitter.setDepth(7);
  }

  /**
   * Emit one airflow streak at world position (x, y), drifting in direction (dx, dy).
   * Caller passes the *desired drift direction* (typically the car's reverse heading) — the
   * emitter pulls per-particle velocity magnitude from its configured `speed` range.
   */
  emitAt(x: number, y: number, dx: number, dy: number) {
    this.dirRad = Math.atan2(dy, dx);
    this.emitter.emitParticleAt(x, y, 1);
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.emitter];
  }

  destroy() {
    this.emitter.destroy();
  }
}
