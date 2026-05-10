# Car Catalog (per-team performance)

Each team owns a `perf: { topSpeed, accel, grip }` block of multipliers on `DEFAULT_CAR`. Player picks a team in the menu and gets that team's car; the menu shows three bars so the trade-offs read at a glance.

## Completed

### Schema
- `Team.perf: { topSpeed, accel, grip }` in `src/entities/Team.ts`. All three values live in `[TEAM_PERF_MIN=0.90, TEAM_PERF_MAX=1.10]`. Range is exported for the bar viz to map to a 0..1 fill.
- Each axis is a multiplier on the matching `DEFAULT_CAR` field: `topSpeed → maxSpeed`, `accel → accel`, `grip → grip`. Drag, brake, turnRate, etc. stay constant — three axes were enough to give every team a distinct character without asking the player to read more bars.

### Profiles (11 teams)
Stats roughly mirror 2026 F1 speculation. Each team is a nod to a real outfit; profiles follow that mapping so the in-game pecking order resembles the real-world hierarchy. The four top teams each get a different signature axis so picks at the top still trade off character.

| Team           | Real-world nod | top  | acc  | grp  | Tier | Character |
|----------------|----------------|------|------|------|------|-----------|
| Scuderia Rosso | Ferrari        | 1.06 | 1.06 | 1.06 | Top  | Balanced ace — strong everywhere, no peak |
| Silver Star    | Mercedes       | 1.10 | 1.04 | 1.02 | Top  | Straight-line specialist |
| Rampage Racing | Red Bull       | 1.06 | 1.08 | 1.04 | Top  | Accel master, fastest off the apex |
| Papaya GP      | McLaren        | 1.02 | 1.06 | 1.10 | Top  | Grip king, ruthless in slow corners |
| Crown Royal    | Williams       | 1.04 | 0.98 | 0.94 | Mid  | Power-circuit car, weak in handling |
| Junior Bulls   | VCARB / RB     | 0.98 | 1.04 | 1.00 | Mid  | Quick off the line, balanced grip |
| Forge Racing   | Haas           | 1.00 | 0.98 | 1.00 | Mid  | Honest mid-pack, no peaks |
| Vorsprung      | Audi / Sauber  | 0.96 | 1.00 | 1.04 | Mid  | Emerging, slight grip edge |
| Alpha Bleu     | Alpine         | 0.96 | 0.94 | 0.96 | Mid- | Across-the-board weak, no escape valve |
| Verde Sport    | Aston Martin   | 0.92 | 0.94 | 0.96 | Bot  | Fallen back, mild grip retained |
| Liberty Speed  | Cadillac (new) | 0.98 | 0.92 | 0.90 | Bot  | Rookie team, top-speed only — no handling |

Top tier is intentionally clustered (sums ~3.18–3.22) so any of the four feels race-winning depending on the track; the spread is in the signature axis, not raw pace. Bottom tier sits at sums ~2.80–2.84 — picking Cadillac or Aston Martin is a deliberate handicap, in line with their real-world 2026 expectations.

### Application (RaceScene)
- Player car gets the team's exact perf via `applyTeamPerf(team.perf)` — no jitter on top, so the menu bars match the in-game car.
- AI cars stack `DEFAULT_CAR.x × team.perf.x × Phaser.Math.FloatBetween(perfRange)` — difficulty's existing per-axis jitter still rolls per AI per axis. So a hard-mode AI on Vorsprung is faster than a hard-mode AI on Forge, and AIs on the same team still feel slightly different (each axis's jitter is an independent draw).

### Hardcoded driver skills
- Each driver has a fixed `skill ∈ [DRIVER_SKILL_MIN=0.40, DRIVER_SKILL_MAX=1.00]` stored on `Team.driverSkills`, parallel to `Team.drivers`. Rolled offline once with team-quality bias (top tier `[0.78, 1.00]`, mid `[0.55, 0.82]`, bottom `[0.42, 0.68]`) and a "the three highest-skill drivers must all be on top-4 teams" constraint, then frozen. So Rampage Hunter (0.99) is always the sharpest AI in the field, Verde Costa (0.47) the dullest — across every race.
- Top-driver / #2 split per team is also baked: e.g. Rampage `[HUNTER, KANE] = [0.99, 0.82]` mirrors Verstappen-vs-Tsunoda; Forge `[IRONS, STEEL] = [0.80, 0.60]` mirrors a strong lead vs a developing teammate. The seat assignment in RaceScene (driver index = how many cars are already on the team when the AI is picked) means human teammates still bump the next AI to seat 1, so a player on Rampage gets paired with KANE not HUNTER.
- **Difficulty scales the range, not the ranking.** RaceScene linearly maps each driver's hardcoded skill from `[DRIVER_SKILL_MIN, DRIVER_SKILL_MAX]` into the active difficulty's `params.skillRange` (e.g. `[0.15, 0.45]` on easy). Hunter on easy → 0.445; Costa on easy → 0.16. So the relative order is identical, but easy compresses everyone toward sloppy and hard lifts everyone toward sharp. Difficulty's perfRange + skillRange both still matter; this just removes the per-race skill roll.

### Qualifying-style grid order (AI only)
- Each AI gets a `qualiScore = perfAvg + skill * 0.15 + Math.random() * 0.10`, where `perfAvg` is the mean of the team's three perf multipliers (~0.93 for bottom tier, ~1.07 for top) and `skill` is the difficulty-scaled hardcoded driver skill. AI cars are sorted descending by score and assigned grid slots `1..N` in order, so the front of the AI grid is almost always a top-team AI.
- Weights are tuned so team perf is the dominant factor (~0.13 spread between top and bottom tier on perf alone), skill is meaningful but secondary (~0.09 spread on normal at weight 0.15), and random jitter (~0.10 max) tops up. A top team beats a same-skill bottom team every time, but a mid-tier AI on a great skill+jitter draw can occasionally outqualify a top-team AI having an off day. With the new hardcoded skills the `skill` term now has a strong correlation with team tier (top-team drivers are sharper on average), reinforcing the bias.
- **Player still takes pole (slot 0) regardless of their team pick.** Pole is a player perk; if the player chooses a slow team, they keep the front spot but their car can be reeled in by the field — which makes "win in a Cadillac from pole" a self-imposed challenge instead of an automatic loss.
- The earlier random-shuffle scatter pass (which prevented teammates from sitting in adjacent slots) is replaced by the score sort. Teammates with the same team perf still sometimes end up near each other, but the alternating-side grid stagger keeps the line-up from looking like a row of one colour.

### Menu visualization
- 3 horizontal bars (`TOP / ACC / GRP`) rendered inside `renderTeam` in `MenuScene.ts`, below the carousel's `1 / N` indicator.
- Bar fill = `clamp((value − TEAM_PERF_MIN) / (TEAM_PERF_MAX − TEAM_PERF_MIN), 0, 1)`. So `1.00` = 50% fill, `1.10` = 100%, `0.90` = empty.
- 110×6 px bar with 1px stroke, dark fill `#222222`, foreground in team-name yellow `#ffd24a`. Labels in mono `#888888`. Visible on both P1 and P2 carousels in 2P.

## Architecture Decisions
- **Stats live on Team, not on a separate Car catalog.** A separate catalog would have doubled the menu surface (pick team for livery, pick car for stats) for no real upside in this arcade-scoped game. Keeping team = car keeps the carousel as the single identity selector.
- **Stack player perf without jitter, AI with jitter.** Player's bars are a contract — if the menu shows a high-grip car, the player should feel it. AI keeps the existing per-axis jitter so individual AI cars don't all feel identical inside a team.
- **Range chosen ±10%, not ±5% or ±15%.** ±5% would have been hard to feel on a single track. ±15% would make some teams obviously top-tier on every track. ±10% sits where a high-top-speed team genuinely pulls away on a long straight but still loses to a high-grip team in tight sectors.

## Open Questions
- Stat axes are hardcoded to `topSpeed/accel/grip`. Adding e.g. `brake` or `turnRate` would mean another bar — fine if there's a clear use case.
- Difficulty `perfRange` is unchanged from before this feature. With team perf stacked on top, the spread between best AI (hard + Vorsprung) and worst (easy + Junior Bulls' top speed) is now wider — may want to tune one or the other if races feel uneven.

## Next Up
- None planned. Tune profiles after a few sessions if any team feels strictly best or strictly bad on every track.
