# UI Context

## Theme

Dark race-track aesthetic. The world has a deep grass background, dark asphalt, and high-contrast overlays. UI text is light on dark, with a single warm yellow highlight colour reserved for the player and selected items. There is no light mode.

The visual language is read-at-a-glance: bright reds for danger (kerb stripes, the F1RE wordmark, the player's car if red), neutral whites/greys for asphalt and HUD text, green for grass, beige for gravel.

## Colors

All in-game colours are defined as numeric constants near where they are used. There is no CSS theming layer — Phaser draws to canvas with hex `0xRRGGBB`. Track surface colours live centrally in `SURFACE_PARAMS` (`src/entities/TrackData.ts`).

| Role                     | Where defined                            | Value      | Notes                                       |
| ------------------------ | ---------------------------------------- | ---------- | ------------------------------------------- |
| World grass background   | `Track.WORLD_GRASS`                      | `0x2a6f2a` | Deep green, fills the whole world           |
| Asphalt                  | `SURFACE_PARAMS.asphalt.color`           | `0x3a3a3a` | Mid-grey                                    |
| Grass runoff             | `SURFACE_PARAMS.grass.color`             | `0x3d8a3d` | Slightly lighter than world grass           |
| Gravel runoff            | `SURFACE_PARAMS.gravel.color`            | `0xb89568` | Beige                                       |
| Wall                     | `Track.WALL_COLOR`                       | `0x111111` | 4px dark stripe at runoff outer edge        |
| Track edge line          | `Track.TRACK_EDGE_LINE`                  | `0xffffff` | 2px white stroke at both asphalt edges      |
| Apex kerb red            | inline                                   | `0xcc1010` | Alternates with white                       |
| Apex kerb white          | inline                                   | `0xffffff` |                                             |
| Centerline dashes        | inline (RaceScene/InspectScene)          | `0xffffff` at 0.4 alpha | Thin dashed centerline       |
| Start/finish stripe      | inline                                   | `0x000000` + `0xffffff` checker tiles       |
| Car red                  | `BootScene.preload`                      | `0xe10600` | F1 red                                      |
| Car blue                 | `BootScene.preload`                      | `0x1e90ff` |                                             |
| Car yellow               | `BootScene.preload`                      | `0xf2c200` |                                             |
| Car green                | `BootScene.preload`                      | `0x2ecc40` |                                             |
| HUD text                 | `Hud` styles                             | `#ffffff` w/ `#000000` 4px stroke           |
| HUD player highlight     | `Hud.posRows` (player row), `MenuScene` selected | `#ffd24a` | Warm yellow — player + selected affordances |
| HUD muted/secondary      | `MenuScene` sub-text, hint               | `#aaaaaa` / `#888888`                       |
| Compact results bg       | `Hud.resultsBg`                          | `0x000000` at 0.7 alpha                     |
| Inspector point markers  | `InspectScene` `LABEL_STYLE.color`       | `#ffd24a` |                                              |
| Inspector checkpoint     | `InspectScene` `CP_LABEL_STYLE.color`    | `#00ffaa` | Mint cyan for CP markers + labels           |
| Inspector coords readout | `InspectScene`                           | `#88ccff` | Sky blue for cursor-coords                  |

When adding a new surface or visual element, define the colour as a named constant near the existing surface params, not inline at the call site. Inline hex is acceptable for one-off graphics primitives (a stripe, a single overlay).

## Typography

| Role          | Family                                      | Where set                  |
| ------------- | ------------------------------------------- | -------------------------- |
| HUD / general | `system-ui, sans-serif`                     | `Hud` text styles, `MenuScene`, `InspectScene` |
| Results panel | `ui-monospace, SFMono-Regular, Menlo, monospace` | `Hud.resultsText` style — required for column alignment |

Font sizes are baked into the styles inline. There's no global type scale today; sizes are picked per element (e.g., 84px for the F1RE wordmark, 26px for inspector title, 20px for HUD, 16px for sub-text, 13px for compact results, 11–13px for labels). Avoid introducing new sizes if an existing one fits.

## Layout Patterns

- **Menu (MenuScene)**: vertically stacked, centered. Title + subtitle → CAR row (4 colour swatches with labels) → TRACK row (3 panels with label + sub-text) → START RACE button (yellow) → INSPECT TRACK link.
- **Race HUD (RaceScene + Hud)**: top-left stats column (SPEED / LAP / TIME / BEST / ITEM), top-right position panel (P1–P4 with status), top-center transient flash messages, full-screen-center countdown, results panel either bottom-right (compact, while player still racing) or center (full, after player finishes).
- **Inspector (InspectScene)**: full-screen world canvas with pan/zoom; UI camera overlay holds title + meta (top-left), coords readout (top-right), zoom buttons (right edge), hint bar (bottom-left).
- **Selection state**: yellow border (`#ffd24a`, increased stroke width + small scale bump) marks the currently selected option in the menu. Player car's row in the position panel is yellow text.
- **Two-camera split** (used in `InspectScene` and to be considered for `RaceScene` if we ever zoom the race camera): main camera draws the world, ui camera at zoom 1 draws HUD; objects partition via `cameras.main.ignore(uiObjects)` and `uiCam.ignore(worldObjects)`.

## Component Library

None. There's no third-party UI library. All UI is built directly with Phaser GameObjects (`text`, `rectangle`, `graphics`, `sprite`). Stick to the same pattern when adding new UI: create the GameObject, set origin/scrollFactor/depth, attach handlers, register with the appropriate camera ignore list if there's a UI camera.

## Icons

None today. Buttons use unicode glyphs (`+`, `−`, `⬚` for inspector zoom controls). Position panel uses `✓` for finished cars, `★` for finish-line checkpoint, `◂` for the player marker.

## Sprites

Cars and pickups are generated procedurally in `BootScene` using `Graphics.generateTexture`. The car sprite is 44×20: rounded chassis, 4 corner wheels with silver hubs, sidepods, cockpit + helmet, front + rear wing tabs. Colours come from the `car_${color}` texture key. Don't replace these with PNG assets without first wiring an asset pipeline (out of scope today).
