# Progress Tracker

Detailed progress lives in topic files under `context/progress/`. Read the files relevant to the area you're working on; this index covers cross-cutting state.

## Index

### Tracks
- [Oval](progress/oval.md)
- [Stadium](progress/stadium.md)
- [Temple of Speed](progress/temple-of-speed.md)
- [Champions' Wall](progress/champions-wall.md)

### Systems
- [Track rendering + surface system](progress/track-rendering.md)
- [Physics + collisions + lap tracking](progress/physics.md)
- [AI driving](progress/ai-driving.md)
- [Items + pickups](progress/items.md)
- [Game chrome (menus, overlays, cars sprite, camera, inspector)](progress/game-chrome.md)
- [Audio (bus, positional sources, engine)](progress/audio.md)

## Current Phase
- Phase 2 of runoff system shipped. Per-segment runoff widths now available (see `progress/track-rendering.md`).

## Cross-Cutting Architecture Decisions
- **No persistence, no network, no third-party UI library.** Stays a single-page client-only app. Revisit only if a multiplayer or accounts feature gets prioritized.
- **Adopted Six-File Context Methodology.** Six top-level context files under `context/`. `CLAUDE.md` is the entry point at the repo root.
- Topic-specific architecture decisions live in the relevant file under `progress/`.

## Cross-Cutting Open Questions
None active across systems. See per-topic files for narrower questions.

## Cross-Cutting Next Up (User picks)
1. **Game-feel pass — audio continued** — wall-hit thump, tire skid chirp, item SFX (pickup, missile, oil, shield-block) as positional one-shots through the existing `AudioBus`. Engine voice already shipped (`progress/audio.md`).
2. **Game-feel pass — visual** — tire skid marks shipped (RenderTexture-based, see `progress/track-rendering.md` → Skid marks). Still open: dust particles on grass, sparks on wall hits.
3. **Better AI** — racing-line offset (shipped), corner brake-points, item awareness (also tracked in `progress/ai-driving.md`).
4. **Sectors + sector times** — split each track into S1/S2/S3 with per-sector best-time tracking.
5. **Car catalog** — beyond colour: `accel`, `topSpeed`, `grip` profiles per car with pick at menu.

## Session Notes
- Static build is served at `http://localhost:4273` (via `vite preview`). Dev server with hot reload runs at `http://localhost:5273` (`vite dev`). When operating in the file system, the user plays the static build to avoid hot-reload glitches.
- `window.__game` is exposed in `src/main.ts` for in-browser debugging (e.g., `window.__game.scene.scenes.find(s => s.scene.key === 'RaceScene').cameras.main.setZoom(...)`). Production code paths must not depend on it.
- Caveman mode often active in chat — keep code/commits/security writing as normal prose, terse only in conversation per the global rule.
