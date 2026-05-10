import { Track } from "../entities/Track";

// Even slots take the right side (+30 lateral), odd slots take the left. Each successive slot
// sits 40 units further back along arc length. Slot 0 is pole.
const ROW_SPACING = 40;
const FIRST_ROW_OFFSET = 40;
const LATERAL_OFFSET = 30;

export interface GridSlot {
  x: number;
  y: number;
  heading: number;
}

export function gridSlot(track: Track, index: number): GridSlot {
  const distBack = FIRST_ROW_OFFSET + index * ROW_SPACING;
  const lateral = index % 2 === 0 ? LATERAL_OFFSET : -LATERAL_OFFSET;
  return slotBehindStart(track, distBack, lateral);
}

// Walks the centerline backward from the start index by `distBack` units of arc-length,
// then offsets laterally along the local normal. Keeps the grid on-track on curves.
function slotBehindStart(track: Track, distBack: number, lateral: number): GridSlot {
  const pts = track.centerline;
  const n = pts.length;
  let idx = track.startIndex;
  let acc = 0;
  let prev = idx;
  while (acc < distBack) {
    prev = (idx - 1 + n) % n;
    const seg = Math.hypot(pts[idx].x - pts[prev].x, pts[idx].y - pts[prev].y);
    if (acc + seg >= distBack) {
      const t = seg > 0 ? (distBack - acc) / seg : 0;
      const px = pts[idx].x + (pts[prev].x - pts[idx].x) * t;
      const py = pts[idx].y + (pts[prev].y - pts[idx].y) * t;
      const ux = (pts[idx].x - pts[prev].x) / (seg || 1);
      const uy = (pts[idx].y - pts[prev].y) / (seg || 1);
      return {
        x: px + -uy * lateral,
        y: py + ux * lateral,
        heading: Math.atan2(uy, ux),
      };
    }
    acc += seg;
    idx = prev;
  }
  return { x: pts[idx].x, y: pts[idx].y, heading: track.startHeading };
}
