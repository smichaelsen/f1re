import Phaser from "phaser";

export const CAR_DESIGN_VARIANTS = ["nose", "sidepods", "spine", "wingtips", "bull"] as const;
export type CarDesign = (typeof CAR_DESIGN_VARIANTS)[number];

export interface Livery {
  primary: number;
  secondary: number;
  variant: CarDesign;
  // Optional third accent color. Only the "bull" variant reads it (nose paint); other
  // variants ignore it. Kept optional so existing two-color teams stay unchanged.
  tertiary?: number;
}

const W = 44;
const H = 20;
const BLACK = 0x111111;
const DARK = 0x222222;
const SILVER = 0x888888;
const WHITE = 0xffffff;

export function carTextureKey(livery: Livery): string {
  const base = `car_${livery.primary.toString(16)}_${livery.secondary.toString(16)}_${livery.variant}`;
  return livery.tertiary !== undefined ? `${base}_${livery.tertiary.toString(16)}` : base;
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
    case "bull":
      // Three-color split mirroring the Red Bull RB livery. Sprite faces +x (driver's
      // visor sits on the right of the helmet circle, so front = high x): the slim
      // x=24..38 extension is the nose cone, the wider x=5..16 block behind the cockpit
      // is the engine cover. Nose painted secondary (yellow); engine cover front half
      // (cockpit-side, high x) secondary, back half (rear-wing-side, low x) tertiary (red).
      g.fillRect(24, 8, 14, 4);
      g.fillRect(11, 7, 5, 6);
      if (livery.tertiary !== undefined) {
        g.fillStyle(livery.tertiary, 1);
        g.fillRect(5, 7, 6, 6);
      }
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
