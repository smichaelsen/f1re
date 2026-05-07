# AI Workflow Rules

## Approach

Build F1RE incrementally using a spec-driven workflow. The six context files in `context/` define what to build, how to build it, and the current state of progress. Always implement against these specs — do not infer or invent behavior from scratch. Read all six files at the start of every session.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Don't combine unrelated system boundaries in a single implementation step.
- When in doubt about scope, finish less and verify.
- Recommend the next step but let the user pick what to do — don't chain feature work without confirmation.

## When to Split Work

Split an implementation step if it combines:

- Track-rendering changes AND lap-tracking / physics changes.
- Track-data schema changes AND any code consuming that schema (do schema first, then bump consumers).
- New surface or pickup type AND a new track that uses it (add the system first, demo on an existing track second).
- A bug fix AND a refactor (fix first, refactor in a separate change).
- Multiple unrelated subsystems (e.g., AI behavior tweak + HUD restyle in one change).

If a change can't be visually verified within a single playtest, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files.
- If a requirement is ambiguous, raise it with the user before implementing. Don't guess and refactor later.
- If a requirement is missing entirely, add it as an open question in the relevant `context/progress/<topic>.md` (or `context/progress-tracker.md` if it's truly cross-cutting) before continuing.
- When the user asks for a feature, propose a brief plan first (1–3 bullet steps) and confirm before building.

## Protected Files

Do not modify the following without explicit instruction:

- `context/*.md` — these are the source of truth. Update them deliberately as part of a unit, not as drive-by changes.
- `package.json` dependencies — adding a runtime dependency is a discussion. Adding dev tooling is a discussion. Don't drive-by `npm install`.
- `vite.config.ts`, `tsconfig.json` — build/tooling config changes get explicit approval.
- `node_modules/`, `dist/`, `.vite/` — never edit, never commit.

## Track JSON Discipline

- Source of truth for track *geometry* is `scripts/gen-tracks.mjs` for the three procedural tracks. Edit the script and regenerate, do not hand-edit those JSONs.
- Hand-authored or AI-edited tracks may exist as JSONs without a script counterpart — those are edited directly. Document which tracks are which in the per-track file under `context/progress/` or alongside the JSON.
- After regenerating tracks, sanity-check at least one track in the inspector before committing.

## Verification Process

After any non-trivial change:

1. Run `npx tsc --noEmit` — must be clean.
2. If a renderer or visible behavior changed, take a Playwright screenshot of the affected scene and verify visually before reporting "done".
3. If a physics or lap-tracking change was made, exercise it with an in-browser test (drive a lap, simulate checkpoint hits, etc.).
4. Run `npm run build` before claiming a unit is shipped.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- New scene → update `architecture.md` (System Boundaries) and `code-standards.md` (File Organization) if the location is novel.
- New entity → `architecture.md` (System Boundaries).
- New surface, new pickup, new track schema field → `architecture.md` (Surface System / Track Data) AND `code-standards.md` (Track Data) AND `ui-context.md` (Colors, if visual).
- New colour or named visual constant → `ui-context.md` (Colors).
- New invariant established by a change → `architecture.md` (Invariants).
- Anything completed or in flight → the relevant topic file under `context/progress/`. Cross-cutting state (current phase, cross-cutting next-ups) → `context/progress-tracker.md`.

If implementation diverges from a context file, update the file in the same change. Don't leave the docs trailing.

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope (verified visually or programmatically).
2. No invariant defined in `architecture.md` was violated.
3. The relevant `context/progress/<topic>.md` reflects the completed work and the next planned step (and `context/progress-tracker.md` if cross-cutting state changed).
4. `npx tsc --noEmit` passes; `npm run build` passes.
5. Any context-file divergence has been reconciled.

## Communication Style

- Match the user's caveman/terse mode for chat where appropriate; use full prose in context-file edits and code comments only when present (default: no comments).
- After finishing a unit, summarize: what files changed, what's verified, what the user can try next.
- Recommend the next step explicitly but don't take it without confirmation.
