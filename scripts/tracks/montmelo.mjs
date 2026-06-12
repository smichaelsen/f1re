import { catmullRomLoop } from "./_shared.mjs";

/**
 * Montmeló — Barcelona-Catalunya-shaped loop (2023 no-chicane layout).
 *
 * Control points were machine-traced from the sector-colored racing line of
 * the reference map (scripts/trace-overlay.py), resampled to 120 evenly
 * spaced points (~202 world units apart). Image is 1920×1035 native rendered
 * at scale 4 centered on the origin, so image px (a, b) maps to world
 * ((a − 960) × 4, (b − 517.5) × 4).
 *
 * Driving direction: clockwise on the image (real-world direction). Start is
 * the checkered mark on the main straight at image px (1377, 732), heading west.
 */
function montmeloControlPoints() {
  return [
    { x: 1670.4, y: 861.6 },
    { x: 1470.2, y: 861.6 },
    { x: 1270.5, y: 863.6 },
    { x: 1070.7, y: 863.3 },
    { x: 871.0, y: 861.8 },
    { x: 671.2, y: 864.4 },
    { x: 471.3, y: 861.6 },
    { x: 271.5, y: 864.4 },
    { x: 71.6, y: 861.6 },
    { x: -128.2, y: 864.0 },
    { x: -327.9, y: 863.0 },
    { x: -527.6, y: 862.1 },
    { x: -727.4, y: 864.4 },
    { x: -927.3, y: 861.6 },
    { x: -1128.2, y: 864.1 },
    { x: -1328.3, y: 864.4 },
    { x: -1528.1, y: 862.0 },
    { x: -1727.8, y: 863.0 },
    { x: -1927.5, y: 863.9 },
    { x: -2127.3, y: 861.6 },
    { x: -2326.7, y: 852.4 },
    { x: -2506.9, y: 777.9 },
    { x: -2551.6, y: 588.4 },
    { x: -2577.5, y: 391.8 },
    { x: -2701.3, y: 242.3 },
    { x: -2886.3, y: 165.4 },
    { x: -3071.8, y: 91.7 },
    { x: -3252.6, y: 3.4 },
    { x: -3388.1, y: -142.4 },
    { x: -3463.3, y: -327.5 },
    { x: -3479.0, y: -526.1 },
    { x: -3419.1, y: -716.2 },
    { x: -3304.0, y: -878.5 },
    { x: -3158.7, y: -1012.2 },
    { x: -2982.2, y: -1108.3 },
    { x: -2793.6, y: -1173.3 },
    { x: -2596.4, y: -1202.4 },
    { x: -2396.7, y: -1202.2 },
    { x: -2196.9, y: -1204.4 },
    { x: -1997.1, y: -1201.6 },
    { x: -1797.2, y: -1204.4 },
    { x: -1597.4, y: -1201.6 },
    { x: -1397.6, y: -1204.4 },
    { x: -1204.3, y: -1166.1 },
    { x: -1070.0, y: -1024.5 },
    { x: -1067.8, y: -829.1 },
    { x: -1157.1, y: -653.0 },
    { x: -1311.5, y: -529.7 },
    { x: -1500.3, y: -466.9 },
    { x: -1698.5, y: -450.6 },
    { x: -1898.3, y: -450.4 },
    { x: -2098.0, y: -452.4 },
    { x: -2297.9, y: -449.6 },
    { x: -2497.7, y: -452.2 },
    { x: -2660.7, y: -357.8 },
    { x: -2642.2, y: -164.9 },
    { x: -2482.2, y: -45.5 },
    { x: -2315.6, y: 65.9 },
    { x: -2149.3, y: 177.6 },
    { x: -1978.0, y: 283.1 },
    { x: -1798.9, y: 371.3 },
    { x: -1607.7, y: 425.7 },
    { x: -1410.0, y: 446.4 },
    { x: -1210.1, y: 443.6 },
    { x: -1010.3, y: 446.4 },
    { x: -825.3, y: 384.1 },
    { x: -763.6, y: 201.0 },
    { x: -758.5, y: 1.5 },
    { x: -677.4, y: -181.7 },
    { x: -559.9, y: -343.5 },
    { x: -445.8, y: -508.2 },
    { x: -330.7, y: -673.9 },
    { x: -213.6, y: -836.1 },
    { x: -95.1, y: -995.6 },
    { x: 86.3, y: -1082.1 },
    { x: 284.8, y: -1095.0 },
    { x: 467.0, y: -1017.7 },
    { x: 640.7, y: -916.0 },
    { x: 814.4, y: -814.2 },
    { x: 987.7, y: -711.9 },
    { x: 1159.2, y: -606.5 },
    { x: 1331.8, y: -504.2 },
    { x: 1504.2, y: -400.7 },
    { x: 1677.4, y: -298.0 },
    { x: 1849.7, y: -194.4 },
    { x: 2022.1, y: -92.1 },
    { x: 2193.5, y: 13.0 },
    { x: 2366.4, y: 115.9 },
    { x: 2539.9, y: 217.9 },
    { x: 2726.4, y: 279.0 },
    { x: 2863.3, y: 148.8 },
    { x: 2852.6, y: -47.6 },
    { x: 2784.3, y: -233.6 },
    { x: 2646.4, y: -374.4 },
    { x: 2461.8, y: -451.0 },
    { x: 2276.2, y: -525.1 },
    { x: 2155.6, y: -679.6 },
    { x: 2162.2, y: -876.7 },
    { x: 2283.5, y: -1027.5 },
    { x: 2476.0, y: -1066.8 },
    { x: 2666.9, y: -1009.7 },
    { x: 2855.9, y: -947.5 },
    { x: 3043.8, y: -882.1 },
    { x: 3231.7, y: -817.1 },
    { x: 3395.6, y: -707.2 },
    { x: 3487.9, y: -529.5 },
    { x: 3496.8, y: -330.3 },
    { x: 3498.8, y: -129.9 },
    { x: 3498.1, y: 70.5 },
    { x: 3499.6, y: 270.9 },
    { x: 3495.6, y: 472.0 },
    { x: 3425.4, y: 656.7 },
    { x: 3275.8, y: 787.7 },
    { x: 3085.1, y: 844.1 },
    { x: 2883.6, y: 856.0 },
    { x: 2681.4, y: 856.0 },
    { x: 2479.1, y: 856.0 },
    { x: 2276.8, y: 856.0 },
    { x: 2074.6, y: 856.0 },
    { x: 1872.3, y: 856.0 },
  ];
}

function montmeloCenterline() {
  return catmullRomLoop(montmeloControlPoints(), 3);
}

// Nearest centerline index to a reference-image pixel (for DRS anchors).
function idxAtPx(centerline, a, b) {
  const wx = (a - 960) * 4;
  const wy = (b - 517.5) * 4;
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
    width: 140,
    checkpoints: 12,
    startIndex: 0,
    runoff: {
      outside: { surface: "gravel", width: 90 },
      inside: { surface: "grass", width: 50 },
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
      scale: 4,
      alpha: 0.4,
    },
    controlPoints: montmeloControlPoints(),
    centerline,
  },
};
