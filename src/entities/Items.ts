export const ITEMS = ["boost", "missile", "seeker", "oil", "shield"] as const;
export type Item = (typeof ITEMS)[number];

// Per-car inventory capacity (FIFO). Pickups roll past full cars rather than overflowing.
export const ITEM_INVENTORY_SIZE = 2;

export function randomItem(): Item {
  return ITEMS[Math.floor(Math.random() * ITEMS.length)];
}
