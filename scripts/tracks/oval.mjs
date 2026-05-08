import { round } from "./_shared.mjs";

function ovalCenterline() {
  const points = [];
  const steps = 64;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = Math.sin(t * 3) * 60;
    points.push({
      x: round(Math.cos(t) * (700 + wobble * 0.2)),
      y: round(Math.sin(t) * (380 + wobble * 0.5)),
    });
  }
  return points;
}

export default {
  file: "oval.json",
  data: {
    version: 2,
    name: "Oval",
    description: "sweeping bends",
    width: 150,
    checkpoints: 8,
    startIndex: 0,
    runoff: {
      outside: { surface: "grass", width: 100 },
      inside:  { surface: "grass", width: 60 },
    },
    centerline: ovalCenterline(),
  },
};
