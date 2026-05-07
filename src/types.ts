export type Vec2 = { x: number; y: number };

export interface CarConfig {
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseSpeed: number;
  turnRate: number;
  grip: number;
  drag: number;
  offTrackDrag: number;
  bodyColor: number;
}

export interface CheckpointDef {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  isFinish?: boolean;
}
