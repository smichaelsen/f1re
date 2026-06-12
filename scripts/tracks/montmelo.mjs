import { catmullRomLoop, clampedRunoffWidths } from "./_shared.mjs";

/**
 * Montmeló — Barcelona-Catalunya-shaped loop (2023 no-chicane layout).
 *
 * Control points are the verbatim output of:
 *   python3 scripts/trace-overlay.py public/inspect-overlays/montmelo.png > trace.json
 *   python3 scripts/trace-to-controls.py trace.json --image-size 1920x1035 \
 *       --start-px 1377,732 --scale 2.2 --eps 2 --min-radius 78
 *
 * Control points were machine-traced from the sector-colored racing line of
 * the reference map (scripts/trace-overlay.py), then Douglas-Peucker
 * simplified (eps 2 px) so straights collapse to collinear points (no
 * pixel-noise wobble) while corners keep their traced density. Long segments
 * are subdivided so interior straight points stay collinear under the spline.
 * Corners tighter than the offset-polygon limit were relaxed against the
 * sampled spline (Laplacian nudges on the involved control points until every
 * spline triple's circumradius is >= 78, above half-width 65).
 *
 * Image is 1920×1035 native rendered at SCALE centered on the origin, so
 * image px (a, b) maps to world ((a − 960) × SCALE, (b − 517.5) × SCALE).
 * SCALE 2.2 puts the lap length (~13k world units) between Temple of Speed
 * and Champions' Wall; the first cut at scale 4 (~24k) drove like an endless
 * motorway with >1:00 laps.
 *
 * Driving direction: clockwise on the image (real-world direction). Start is
 * the checkered mark on the main straight at image px (1377, 732), heading west.
 */
const SCALE = 2.2;

function montmeloControlPoints() {
  return [
    { x: 918.7, y: 473.9 },
    { x: 678.2, y: 474.1 },
    { x: 437.7, y: 474.2 },
    { x: 197.1, y: 474.4 },
    { x: -43.4, y: 474.6 },
    { x: -283.9, y: 474.7 },
    { x: -524.5, y: 474.9 },
    { x: -765.0, y: 475.1 },
    { x: -1005.5, y: 475.2 },
    { x: -1246.1, y: 475.4 },
    { x: -1324.2, y: 448.8 },
    { x: -1372.6, y: 412.9 },
    { x: -1395.4, y: 350.6 },
    { x: -1408.0, y: 242.2 },
    { x: -1424.1, y: 198.0 },
    { x: -1448.7, y: 157.7 },
    { x: -1508.3, y: 122.3 },
    { x: -1700.6, y: 46.6 },
    { x: -1775.4, y: 10.6 },
    { x: -1855.0, y: -63.8 },
    { x: -1897.7, y: -150.3 },
    { x: -1912.9, y: -220.2 },
    { x: -1910.0, y: -312.4 },
    { x: -1897.5, y: -357.5 },
    { x: -1870.4, y: -413.6 },
    { x: -1812.1, y: -493.9 },
    { x: -1732.1, y: -561.2 },
    { x: -1624.3, y: -616.7 },
    { x: -1532.1, y: -647.0 },
    { x: -1415.5, y: -662.4 },
    { x: -1182.6, y: -662.0 },
    { x: -949.7, y: -661.5 },
    { x: -716.8, y: -661.1 },
    { x: -664.0, y: -642.2 },
    { x: -617.1, y: -612.0 },
    { x: -589.4, y: -565.4 },
    { x: -575.1, y: -518.8 },
    { x: -588.5, y: -443.1 },
    { x: -615.6, y: -387.2 },
    { x: -654.3, y: -336.8 },
    { x: -698.5, y: -304.3 },
    { x: -766.7, y: -268.4 },
    { x: -861.5, y: -247.9 },
    { x: -1119.9, y: -248.3 },
    { x: -1356.2, y: -246.6 },
    { x: -1397.9, y: -223.1 },
    { x: -1428.4, y: -196.0 },
    { x: -1443.7, y: -163.9 },
    { x: -1447.5, y: -129.1 },
    { x: -1436.6, y: -93.2 },
    { x: -1405.4, y: -52.6 },
    { x: -1278.5, y: 34.0 },
    { x: -1139.8, y: 126.3 },
    { x: -1008.5, y: 197.8 },
    { x: -915.6, y: 230.8 },
    { x: -838.9, y: 245.1 },
    { x: -685.3, y: 245.1 },
    { x: -531.7, y: 245.1 },
    { x: -464.9, y: 222.0 },
    { x: -436.0, y: 189.6 },
    { x: -422.6, y: 158.2 },
    { x: -418.4, y: 5.3 },
    { x: -390.7, y: -67.1 },
    { x: -360.4, y: -119.9 },
    { x: -242.0, y: -284.9 },
    { x: -123.6, y: -449.9 },
    { x: -76.1, y: -525.6 },
    { x: -44.7, y: -552.6 },
    { x: 22.9, y: -586.7 },
    { x: 69.3, y: -601.0 },
    { x: 130.9, y: -603.7 },
    { x: 185.5, y: -597.7 },
    { x: 231.4, y: -576.2 },
    { x: 427.9, y: -458.6 },
    { x: 624.3, y: -340.9 },
    { x: 820.7, y: -223.3 },
    { x: 1017.1, y: -105.7 },
    { x: 1213.6, y: 12.0 },
    { x: 1361.4, y: 94.4 },
    { x: 1451.4, y: 132.0 },
    { x: 1497.6, y: 128.2 },
    { x: 1532.2, y: 110.3 },
    { x: 1558.3, y: 78.8 },
    { x: 1575.3, y: 32.8 },
    { x: 1565.2, y: -44.6 },
    { x: 1543.1, y: -111.5 },
    { x: 1516.9, y: -156.0 },
    { x: 1478.6, y: -191.0 },
    { x: 1389.3, y: -240.0 },
    { x: 1255.5, y: -286.0 },
    { x: 1208.9, y: -324.5 },
    { x: 1182.9, y: -381.5 },
    { x: 1183.8, y: -471.5 },
    { x: 1222.3, y: -542.3 },
    { x: 1302.0, y: -585.2 },
    { x: 1371.7, y: -586.1 },
    { x: 1579.2, y: -516.7 },
    { x: 1786.6, y: -447.3 },
    { x: 1846.9, y: -411.8 },
    { x: 1897.7, y: -343.0 },
    { x: 1920.6, y: -286.9 },
    { x: 1924.3, y: -235.8 },
    { x: 1924.2, y: 7.6 },
    { x: 1924.1, y: 251.0 },
    { x: 1921.7, y: 281.2 },
    { x: 1904.3, y: 328.0 },
    { x: 1879.7, y: 368.1 },
    { x: 1826.7, y: 419.3 },
    { x: 1771.7, y: 447.5 },
    { x: 1725.2, y: 462.0 },
    { x: 1621.4, y: 470.6 },
    { x: 1387.2, y: 471.7 },
    { x: 1152.9, y: 472.8 }
  ];
}

function montmeloCenterline() {
  return catmullRomLoop(montmeloControlPoints(), 3);
}

// Nearest centerline index to a reference-image pixel (for DRS anchors).
function idxAtPx(centerline, a, b) {
  const wx = (a - 960) * SCALE;
  const wy = (b - 517.5) * SCALE;
  let best = 0;
  let bd = Infinity;
  centerline.forEach((p, i) => {
    const d = (p.x - wx) ** 2 + (p.y - wy) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

const centerline = montmeloCenterline();

export default {
  file: "montmelo.json",
  data: {
    version: 2,
    name: "Montmeló",
    description: "Barcelona-shaped: sweeping esses, stadium loop, flat-out final corners",
    width: 130,
    checkpoints: 12,
    startIndex: 0,
    // Per-point widths: the esses fold sections to within ~180 world units of
    // each other (free gap ~50 after asphalt), so uniform 90-unit gravel made
    // adjacent sections' runoff polygons overlap — crossing walls and confused
    // wall collisions. Each point's runoff is clamped to half the free gap.
    runoff: {
      outside: { surface: "gravel", width: clampedRunoffWidths(centerline, 130, 90, "outside") },
      inside: { surface: "grass", width: clampedRunoffWidths(centerline, 130, 50, "inside") },
    },
    patches: [],
    // Two real-world DRS zones: back straight (detection before T9) and the
    // main straight (detection before the final corner).
    drs: {
      detections: [idxAtPx(centerline, 900, 200), idxAtPx(centerline, 1530, 640)],
      zones: [
        { startIndex: idxAtPx(centerline, 1050, 290), endIndex: idxAtPx(centerline, 1450, 540) },
        { startIndex: idxAtPx(centerline, 1280, 732), endIndex: idxAtPx(centerline, 420, 740) },
      ],
    },
    referenceOverlay: {
      image: "inspect-overlays/montmelo.png",
      x: 0,
      y: 0,
      scale: SCALE,
      alpha: 0.4,
    },
    controlPoints: montmeloControlPoints(),
    centerline,
  },
};
