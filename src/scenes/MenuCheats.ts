// Cheat flags persisted in localStorage. Unlock is a separate flag from the individual cheats
// so the user can toggle cheats off without re-entering the unlock code on next session.

export interface MenuCheats {
  unlocked: boolean;
  diamondArmor: boolean;
  offRoadWheels: boolean;
  mazeSpin: boolean;
  hammerTime: boolean;
  deathmatch: boolean;
}

const STORAGE_KEY = "f1re.cheats";
export const CHEAT_CODE = "CHEATZPLS";

export function defaultMenuCheats(): MenuCheats {
  return { unlocked: false, diamondArmor: false, offRoadWheels: false, mazeSpin: false, hammerTime: false, deathmatch: false };
}

export function loadMenuCheats(): MenuCheats {
  const defaults = defaultMenuCheats();
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MenuCheats>;
    return {
      unlocked: typeof parsed?.unlocked === "boolean" ? parsed.unlocked : defaults.unlocked,
      diamondArmor: typeof parsed?.diamondArmor === "boolean" ? parsed.diamondArmor : defaults.diamondArmor,
      offRoadWheels: typeof parsed?.offRoadWheels === "boolean" ? parsed.offRoadWheels : defaults.offRoadWheels,
      mazeSpin: typeof parsed?.mazeSpin === "boolean" ? parsed.mazeSpin : defaults.mazeSpin,
      hammerTime: typeof parsed?.hammerTime === "boolean" ? parsed.hammerTime : defaults.hammerTime,
      deathmatch: typeof parsed?.deathmatch === "boolean" ? parsed.deathmatch : defaults.deathmatch,
    };
  } catch {
    return defaults;
  }
}

export function saveMenuCheats(cheats: MenuCheats) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cheats));
  } catch {
    // Quota / privacy errors non-fatal — user just won't get persistence.
  }
}
