import Phaser from "phaser";
import { Car } from "../entities/Car";

const WORLD_BOUNDS = { x: -3000, y: -3000, w: 6000, h: 6000 };
const DEFAULT_ZOOM = 0.85;

const LOOKAHEAD_K = 0.35;
const LOOKAHEAD_MAX = 220;

// Multi-camera framing: pick zoom that fits both humans (or just the surviving one) plus
// margin, with a min span so two cars converging doesn't whip the zoom to its hard cap.
const MULTI_MARGIN = 280;
const MULTI_MIN_SPAN = 220;
const MULTI_ZOOM_MIN = 0.35;
const MULTI_ZOOM_MAX = 0.85;

// Frame-rate independent lerp rates. Zoom is slower than centering — sudden separations
// look jittery if zoom matches center. Tuned empirically.
const MULTI_ZOOM_LERP = 4;
const MULTI_CENTER_LERP = 6;
const COCKPIT_ROT_LERP = 4;

export class RaceCamera {
  private cockpitCamRotation = 0;

  constructor(
    private cam: Phaser.Cameras.Scene2D.Camera,
    private humans: readonly Car[],
    private cockpitCam: boolean,
  ) {
    this.cam.setBounds(WORLD_BOUNDS.x, WORLD_BOUNDS.y, WORLD_BOUNDS.w, WORLD_BOUNDS.h);
    if (this.humans.length === 1) {
      const player = this.humans[0];
      this.cam.startFollow(player.sprite, true, 0.12, 0.12);
      this.cam.setZoom(DEFAULT_ZOOM);
      if (this.cockpitCam) {
        // Align world rotation to player heading on grid so the first frame already looks
        // correct (no wind-up from rotation 0 during the countdown).
        this.cockpitCamRotation = -player.heading - Math.PI / 2;
        this.cam.setRotation(this.cockpitCamRotation);
      }
    } else {
      // 2P: camera is driven manually each frame so the zoom can dynamically fit both players.
      // Initial zoom is set conservatively until the first frame's fit-calculation runs.
      this.cam.setZoom(DEFAULT_ZOOM);
      this.cam.centerOn(this.humans[0].x, this.humans[0].y);
    }
  }

  // Per-frame camera driver. 1P uses Phaser's startFollow + per-frame look-ahead via
  // setFollowOffset (or cockpit-rotation if enabled). 2P drops follow entirely and lerps zoom +
  // center to keep both humans (or the surviving human if one has finished) framed in view with
  // margin.
  update(dt: number): void {
    if (this.humans.length === 1) {
      this.updateSingle(dt);
    } else {
      this.updateMulti(dt);
    }
  }

  private updateSingle(dt: number): void {
    const player = this.humans[0];
    if (this.cockpitCam) {
      // Rotate world so player heading always points up. Look-ahead disabled because the
      // rotation already previews what's ahead and a world-space offset would rotate with
      // the camera (sliding the car off-screen sideways).
      this.cam.setFollowOffset(0, 0);
      // While spinning the heading rotates several times per second; tracking it would induce
      // motion sickness and obscure the visual cue that *the car* is spinning. Hold the last
      // pre-spin rotation; on recovery, the lerp re-acquires the heading naturally.
      if (player.spinTimer <= 0) {
        const targetRot = -player.heading - Math.PI / 2;
        // Shortest-arc lerp so wraparound from +π to -π doesn't whip the view.
        let delta = targetRot - this.cockpitCamRotation;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const rotLerp = 1 - Math.exp(-dt * COCKPIT_ROT_LERP);
        this.cockpitCamRotation += delta * rotLerp;
      }
      this.cam.setRotation(this.cockpitCamRotation);
      return;
    }
    const lookX = Phaser.Math.Clamp(player.vx * LOOKAHEAD_K, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
    const lookY = Phaser.Math.Clamp(player.vy * LOOKAHEAD_K, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
    this.cam.setFollowOffset(-lookX, -lookY);
  }

  private updateMulti(dt: number): void {
    // Pick focus targets: any humans still racing. If both finished, fall back to all humans
    // so the camera doesn't snap. The min-span guard prevents the zoom from jumping to max
    // when both players cluster very close together.
    const active = this.humans.filter((h) => h.finishedAtMs == null);
    const focus = active.length > 0 ? active : this.humans;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of focus) {
      if (f.x < minX) minX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.x > maxX) maxX = f.x;
      if (f.y > maxY) maxY = f.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(MULTI_MIN_SPAN, maxX - minX) + MULTI_MARGIN * 2;
    const spanY = Math.max(MULTI_MIN_SPAN, maxY - minY) + MULTI_MARGIN * 2;
    const fitZoom = Math.min(this.cam.width / spanX, this.cam.height / spanY);
    const targetZoom = Phaser.Math.Clamp(fitZoom, MULTI_ZOOM_MIN, MULTI_ZOOM_MAX);

    const zoomLerp = 1 - Math.exp(-dt * MULTI_ZOOM_LERP);
    const centerLerp = 1 - Math.exp(-dt * MULTI_CENTER_LERP);
    this.cam.setZoom(this.cam.zoom + (targetZoom - this.cam.zoom) * zoomLerp);
    // Phaser's cam.scrollX is `midX - cam.width / 2` (no zoom factor); use `midPoint` to read
    // the actual world-space center so the lerp converges instead of drifting.
    const curCx = this.cam.midPoint.x;
    const curCy = this.cam.midPoint.y;
    this.cam.centerOn(
      curCx + (cx - curCx) * centerLerp,
      curCy + (cy - curCy) * centerLerp,
    );
  }
}
