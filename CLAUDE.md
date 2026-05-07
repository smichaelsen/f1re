# F1RE — Application Building Context

Read the following files in order before implementing or making any architectural decision:

1. `context/project-overview.md` — product definition, goals, features, and scope
2. `context/architecture.md` — system structure, boundaries, storage model, and invariants
3. `context/ui-context.md` — theme, colors, typography, and component conventions
4. `context/code-standards.md` — implementation rules and conventions
5. `context/ai-workflow-rules.md` — development workflow, scoping rules, and delivery approach
6. `context/progress-tracker.md` — current phase, completed work, open questions, and next steps

Update `context/progress-tracker.md` after each meaningful implementation change.

If implementation changes the architecture, scope, or standards documented in the context files, update the relevant file before continuing.

## Local commands

- `npm run dev` — Vite dev server, hot reload, port 5273.
- `npm run build` — type-check (`tsc --noEmit`) then bundle to `dist/`.
- `npm run preview` — serves the production bundle (default port 4273 in this project).
- `node scripts/gen-tracks.mjs` — regenerates the procedural tracks in `public/tracks/`.
