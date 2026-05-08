import Phaser from "phaser";

export const CAR_DESIGN_VARIANTS = ["nose", "sidepods", "spine", "wingtips"] as const;
export type CarDesign = (typeof CAR_DESIGN_VARIANTS)[number];

export interface Livery {
  primary: number;
  secondary: number;
  variant: CarDesign;
}

const W = 44;
const H = 20;
const BLACK = 0x111111;
const DARK = 0x222222;
const SILVER = 0x888888;
const WHITE = 0xffffff;

export function carTextureKey(livery: Livery): string {
  return `car_${livery.primary.toString(16)}_${livery.secondary.toString(16)}_${livery.variant}`;
}

export function ensureCarTexture(scene: Phaser.Scene, livery: Livery): string {
  const key = carTextureKey(livery);
  if (scene.textures.exists(key)) return key;

  const g = scene.add.graphics();

  g.fillStyle(BLACK, 1);
  g.fillRoundedRect(0, 2, 5, 16, 1);
  g.fillRoundedRect(38, 1, 6, 18, 1);

  g.fillStyle(livery.primary, 1);
  g.fillRoundedRect(12, 3, 14, 14, 2);
  g.fillRect(5, 7, 11, 6);
  g.fillRect(24, 8, 14, 4);
  g.fillRect(0, 9, 5, 2);
  g.fillRect(38, 9, 6, 2);

  g.fillStyle(livery.secondary, 1);
  switch (livery.variant) {
    case "nose":
      g.fillRect(5, 7, 11, 6);
      break;
    case "sidepods":
      g.fillRect(13, 3, 12, 2);
      g.fillRect(13, 15, 12, 2);
      break;
    case "spine":
      g.fillRect(5, 9, 33, 2);
      break;
    case "wingtips":
      g.fillRect(0, 9, 5, 2);
      g.fillRect(38, 9, 6, 2);
      break;
  }

  g.fillStyle(BLACK, 1);
  g.fillRoundedRect(5, 0, 8, 5, 1);
  g.fillRoundedRect(5, 15, 8, 5, 1);
  g.fillRoundedRect(28, 0, 8, 5, 1);
  g.fillRoundedRect(28, 15, 8, 5, 1);

  g.fillStyle(SILVER, 1);
  g.fillRect(7, 1, 4, 3);
  g.fillRect(7, 16, 4, 3);
  g.fillRect(30, 1, 4, 3);
  g.fillRect(30, 16, 4, 3);

  g.fillStyle(DARK, 1);
  g.fillRoundedRect(17, 7, 8, 6, 1);

  g.fillStyle(WHITE, 1);
  g.fillCircle(21, 10, 2);

  g.fillStyle(0x000000, 1);
  g.fillRect(22, 9, 1, 2);

  g.generateTexture(key, W, H);
  g.destroy();
  return key;
}

export function randomVariant(rng: () => number): CarDesign {
  return CAR_DESIGN_VARIANTS[Math.floor(rng() * CAR_DESIGN_VARIANTS.length)];
}
