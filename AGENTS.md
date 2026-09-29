# Repository instructions

## Product boundary

- Build VALORANT Squad Analytics as a transparent community performance dashboard for a private friend group.
- Never describe the score as MMR, Elo, official rank, or a replacement for Riot's ranked system.
- Keep V1 static and compatible with GitHub Pages. Do not add a backend, API keys, or unofficial VALORANT APIs.
- Do not copy Riot, VALORANT, VLR, or third-party visual assets or page designs.

## Technology

- Use React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.
- Keep data types, raw statistics, derived statistics, normalization, scoring weights, and UI in separate modules.
- Never place scoring logic directly inside React components.
- Prefer strict TypeScript and small, testable functions.

## Data and scoring

- Keep every derived metric transparent and document its formula in `docs/SCORING.md`.
- Treat sample-size confidence separately from performance scores.
- Handle missing advanced statistics without breaking scoring.
- Use role-aware comparisons so the system does not automatically favor Duelists.
- When scoring logic changes, update documentation and add or update tests in the same change.

## Required verification

- Before declaring work complete, run `npm run lint`, `npm test`, and `npm run build` when those scripts exist.
- Report the exact verification results and any skipped or unavailable checks.
- Do not claim a check passed unless it was run successfully in the current worktree.

## Git and security

- Use small, focused commits and preserve unrelated user changes.
- Never commit secrets, credentials, API keys, `.env` files, generated logs, or private player identifiers.
- Keep deployment compatible with a repository subpath on GitHub Pages.
- Do not rewrite history or force-push unless the user explicitly asks.

## Current stage

- TASK-001 and TASK-002A are complete. Read `docs/PROJECT_BRIEF.md`, `docs/TASKS.md`, `docs/RIOT_API_CAPABILITY.md`, and `docs/RIOT_INTEGRATION_PLAN.md` before beginning TASK-002B.
- Stay within the requested task. Record later ideas under the roadmap instead of silently expanding scope.
