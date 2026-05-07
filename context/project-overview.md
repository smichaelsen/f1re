# F1RE — 2D Racing Fury

## Overview

F1RE is a browser-based 2D top-down racing game built with Phaser 3. It blends real Formula 1 visual cues (open-wheel cars, recognizable circuits, kerbs, runoff, walls) with arcade fun-racer mechanics (pickups, weapons, boosts). One human player races three AI opponents on hand-authored circuits loaded from JSON. The aim is the look and pacing of an F1 race with the playful chaos of Mario Kart.

## Goals

1. Deliver an arcade racer that *reads* as F1 at a glance — open-wheel cars, kerbs, walls, sectors.
2. Keep tracks fully data-driven (JSON), so circuits can be authored, hand-edited, and inspected without code changes.
3. Run smoothly at 60 fps in the browser with no installation, no backend.
4. Stay extensible: new tracks, new car liveries, and new pickup types should drop in without touching the core engine.
5. Support a future visual track inspector and (eventually) a track editor that read/write the same JSON format.

## Core User Flow

1. Player opens the page → MenuScene loads.
2. Player picks a car colour (red / blue / yellow / green) and a track (Oval / Stadium / Temple of Speed).
3. Optional: player clicks INSPECT TRACK to pan/zoom the selected track in a read-only viewer.
4. Player clicks START RACE → RaceScene loads track JSON, places cars on the grid.
5. 3-2-1-GO countdown freezes input; on GO the race begins.
6. Player drives with arrow keys (↑ throttle, ↓ brake/reverse, ←→ steer). SPACE uses an item from the inventory slot. Pickups (boost / missile / oil / shield) spawn around the track and respawn after collection.
7. AI cars race with pure-pursuit waypoint following and use their pickups on a random 1–5s delay.
8. Race ends when a car reaches `TOTAL_LAPS`; lapped cars are forced to finish on their next CP0 crossing.
9. Compact live-results panel appears bottom-right while the player is still racing; flips to full center "RACE OVER" overlay when the player finishes.
10. R restarts the race; ESC returns to menu.

## Features

### Core Racing

- 4 cars per race (1 player + 3 AI), each in a unique colour
- Top-down arcade physics (longitudinal accel, lateral grip with slip, drag)
- 3-lap races by default
- F1-style 3-2-1-GO countdown
- Lap timer, best-lap tracking per car, total race time per car
- Live position table (P1–P4) with ✓ when finished
- Live results panel — compact bottom-right while racing, full center after the player finishes

### Tracks

- JSON-defined centerline (closed loop), width, checkpoint count, start index
- Per-track default runoff per side (`outside`, `inside`) — surface + width
- Surface patches as polygons (override default runoff in arbitrary regions)
- 3 surfaces today: asphalt, grass, gravel — each with own drag + grip
- Walls drawn at the outer edge of the runoff band (collision push-back via OBB corner sampling)
- Apex kerbs (red/white stripes) auto-detected from curvature
- White track-edge lines on both sides of the asphalt
- Visible start/finish stripe (checker), centerline dashes
- Three tracks: **Oval** (sweeping bends), **Stadium** (long straights, 4 corners, grass + gravel runoff), **Temple of Speed** (Monza-shaped: chicanes + Parabolica)

### Cars

- F1-style open-wheel sprites (sidepods, exposed wheels, cockpit, helmet, front + rear wings)
- Oriented bounding-box (OBB) collisions: corner-sampled wall push-back, SAT for car-vs-car
- Surface-driven physics: drag and grip read per-frame from the surface under the car (4-corner average)

### Pickups & Weapons

- 8 pickup boxes per track (respawn 3.5s after pickup)
- Player triggers items with SPACE; AI uses items on random 1–5s delay
- 4 items: **boost** (1.6× speed for 2s), **missile** (homing, locks on enemies in 220-unit radius), **oil slick** (drop behind, spins anyone who hits it), **shield** (consumes one incoming hit)

### UI / Tooling

- MenuScene: title, car select, track select, START RACE, INSPECT TRACK
- RaceScene HUD: speed, lap, time, best lap, item slot, position panel, message flash, results overlay
- InspectScene: read-only track viewer with pan-drag, wheel-zoom-to-cursor, +/-/fit buttons, point indices, checkpoint markers, coords readout, track cycler ([ ])
- Two-camera split (world + UI) so HUD elements don't scale with world zoom

## Scope

### In Scope

- Single-player local racing (player + 3 AI)
- Hand-authored JSON tracks generated from `scripts/gen-tracks.mjs`
- Surface system v1: per-track default runoff per side + polygon patches
- Per-side asymmetric wall positions (Phase 2: per-segment wall positions)
- Read-only track inspector
- Static build deploys (any static host)

### Out of Scope (for now)

- Multiplayer (network)
- Account system / persistence / online leaderboards
- Sound effects / music
- Particle effects / juice (skid marks, dust, sparks)
- Mobile touch controls
- Real F1 trademarks, names, liveries, logos (parody only)
- Visual track editor with drag-to-edit (the inspector is a precursor)
- Per-segment wall placement (Monaco-style walls right at edge of asphalt that vary along the track)
- Pit stops, tyre wear, fuel
- Damage model
- Car catalog beyond colour swap

## Success Criteria

1. A player can open the menu, pick a car and track, and complete a 3-lap race against 3 AI on any of the 3 tracks.
2. The lap counter ticks once per finish-line crossing and the race ends when a car reaches lap 3 (no off-by-one).
3. A car driving on grass slows visibly; on gravel slows dramatically; on asphalt is normal — measurable from cockpit feel.
4. Wall collisions push the car back along the wall normal and reflect velocity; cars cannot leave the drivable area.
5. Adding a new track is a JSON file in `public/tracks/` plus a one-line entry in `MenuScene.TRACKS` — no engine changes required.
6. The inspector accurately shows centerline points, checkpoint positions, and coords for any loaded track.
7. `npm run build` produces a static bundle that runs from any static file host with no backend.
